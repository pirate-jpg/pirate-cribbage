// Pirate Cribbage - discard -> pegging -> show -> next hand
// Fixes & Enhancements:
// - Pegging run scoring
// - Auto-reset when opponent has 0 cards but count blocks remaining player (prevents stall)
// - Game ends at 121 (no more dealing past 121)
// - Match wins tracking (first to 3 by default)
// - Emits richer state for UI (gameOver, matchWins, winner, matchOver)

const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (req, res) => res.send("ok"));

const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Listening on", PORT));

const tables = {}; // tableId -> tableState

const GAME_TARGET = 121;
const MATCH_TARGET_WINS = 3;

/* -------------------------
   Helpers: cards/deck
--------------------------*/
function newDeck() {
  const suits = ["♠", "♥", "♦", "♣"];
  const ranks = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
  const deck = [];
  let id = 0;
  for (const s of suits) for (const r of ranks) deck.push({ id: `c${id++}`, rank: r, suit: s });
  return deck;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function cardValue(rank) {
  if (rank === "A") return 1;
  if (["K","Q","J"].includes(rank)) return 10;
  return parseInt(rank, 10);
}

function rankNum(rank) {
  if (rank === "A") return 1;
  if (rank === "J") return 11;
  if (rank === "Q") return 12;
  if (rank === "K") return 13;
  return parseInt(rank, 10);
}

function otherPlayer(p) {
  return p === "PLAYER1" ? "PLAYER2" : "PLAYER1";
}

/* -------------------------
   Table state
--------------------------*/
function ensureTable(tableId) {
  if (!tables[tableId]) {
    tables[tableId] = {
      id: tableId,
      players: { PLAYER1: null, PLAYER2: null },
      names: { PLAYER1: "Pirate", PLAYER2: "PLAYER2" },

      dealer: "PLAYER1",
      stage: "lobby", // lobby | discard | pegging | show | gameover | matchover
      turn: "PLAYER1",

      deck: [],
      cut: null,
      crib: [],

      hands: { PLAYER1: [], PLAYER2: [] },     // preserved for show
      pegHands: { PLAYER1: [], PLAYER2: [] },  // consumed during pegging

      discards: { PLAYER1: [], PLAYER2: [] },

      peg: {
        count: 0,
        pile: [],
        lastPlayer: null,
        go: { PLAYER1: false, PLAYER2: false }
      },

      scores: { PLAYER1: 0, PLAYER2: 0 }, // game points

      matchWins: { PLAYER1: 0, PLAYER2: 0 }, // games won
      winner: null,       // game winner playerId
      matchWinner: null,  // match winner playerId
      gameOver: false,
      matchOver: false,

      show: null,         // show breakdown payload
      lastPegEvent: null, // { player, pts, reasons[] }

      log: []
    };
  }
  return tables[tableId];
}

function pushLog(t, msg) {
  t.log.push(msg);
  if (t.log.length > 140) t.log.shift();
}

/* -------------------------
   Public state for client
--------------------------*/
function publicStateFor(t, me) {
  const handForUI = (t.stage === "pegging") ? (t.pegHands[me] || []) : (t.hands[me] || []);
  return {
    tableId: t.id,
    stage: t.stage,
    dealer: t.dealer,
    turn: t.turn,
    cut: t.cut,

    scores: t.scores,
    matchWins: t.matchWins,
    gameTarget: GAME_TARGET,
    matchTargetWins: MATCH_TARGET_WINS,

    gameOver: t.gameOver,
    matchOver: t.matchOver,
    winner: t.winner,
    matchWinner: t.matchWinner,

    players: {
      PLAYER1: t.players.PLAYER1 ? t.names.PLAYER1 : null,
      PLAYER2: t.players.PLAYER2 ? t.names.PLAYER2 : null
    },

    cribCount: t.crib.length,
    discardsCount: {
      PLAYER1: t.discards.PLAYER1.length,
      PLAYER2: t.discards.PLAYER2.length
    },

    peg: {
      count: t.peg.count,
      pile: t.peg.pile.map(c => ({ rank: c.rank, suit: c.suit })),
      lastPlayer: t.peg.lastPlayer,
      go: t.peg.go
    },

    me,
    myHand: handForUI,
    myHandCount: t.pegHands[me] ? t.pegHands[me].length : 0,
    oppHandCount: t.pegHands[otherPlayer(me)] ? t.pegHands[otherPlayer(me)].length : 0,

    lastPegEvent: t.lastPegEvent,
    show: t.show,

    log: t.log
  };
}

function emitState(tableId) {
  const t = tables[tableId];
  if (!t) return;
  for (const p of ["PLAYER1","PLAYER2"]) {
    const sid = t.players[p];
    if (sid) io.to(sid).emit("state", publicStateFor(t, p));
  }
}

/* -------------------------
   Game lifecycle helpers
--------------------------*/
function resetForNewGame(t) {
  t.stage = "lobby";
  t.turn = "PLAYER1";
  t.dealer = "PLAYER1";

  t.deck = [];
  t.cut = null;
  t.crib = [];

  t.hands = { PLAYER1: [], PLAYER2: [] };
  t.pegHands = { PLAYER1: [], PLAYER2: [] };
  t.discards = { PLAYER1: [], PLAYER2: [] };

  t.peg = { count: 0, pile: [], lastPlayer: null, go: { PLAYER1:false, PLAYER2:false } };

  t.scores = { PLAYER1: 0, PLAYER2: 0 };

  t.show = null;
  t.lastPegEvent = null;

  t.winner = null;
  t.gameOver = false;
}

function resetForNewMatch(t) {
  resetForNewGame(t);
  t.matchWins = { PLAYER1: 0, PLAYER2: 0 };
  t.matchOver = false;
  t.matchWinner = null;
  pushLog(t, "New match started. First to 3 wins.");
}

function checkForGameWin(t) {
  if (t.gameOver || t.matchOver) return;

  const p1 = t.scores.PLAYER1;
  const p2 = t.scores.PLAYER2;

  if (p1 >= GAME_TARGET || p2 >= GAME_TARGET) {
    // Winner is higher score (if both crossed due to last scoring edge cases)
    const winner = p1 === p2 ? null : (p1 > p2 ? "PLAYER1" : "PLAYER2");
    t.gameOver = true;
    t.winner = winner;
    t.stage = "gameover";

    if (winner) {
      t.matchWins[winner] += 1;
      pushLog(t, `🏁 GAME OVER: ${winner} wins (${p1}–${p2}). Match wins: P1=${t.matchWins.PLAYER1}, P2=${t.matchWins.PLAYER2}`);
    } else {
      pushLog(t, `🏁 GAME OVER: tie (${p1}–${p2}).`);
    }

    if (winner && t.matchWins[winner] >= MATCH_TARGET_WINS) {
      t.matchOver = true;
      t.matchWinner = winner;
      t.stage = "matchover";
      pushLog(t, `🏴‍☠️ MATCH OVER: ${winner} wins the match!`);
    }
  }
}

function startHand(t) {
  // Don't start hands if match/game over
  if (t.matchOver || t.gameOver) return;

  t.stage = "discard";
  t.deck = shuffle(newDeck());
  t.crib = [];
  t.cut = null;
  t.show = null;
  t.lastPegEvent = null;

  t.discards = { PLAYER1: [], PLAYER2: [] };
  t.peg = { count: 0, pile: [], lastPlayer: null, go: { PLAYER1:false, PLAYER2:false } };

  const p1 = t.deck.splice(0, 6);
  const p2 = t.deck.splice(0, 6);

  t.hands.PLAYER1 = [...p1];
  t.hands.PLAYER2 = [...p2];
  t.pegHands.PLAYER1 = [...p1];
  t.pegHands.PLAYER2 = [...p2];

  pushLog(t, `New hand. Dealer: ${t.dealer}`);
}

function enterPegging(t) {
  if (t.matchOver || t.gameOver) return;

  t.stage = "pegging";
  t.cut = t.deck.splice(0, 1)[0];
  t.lastPegEvent = null;

  pushLog(t, `Cut: ${t.cut.rank}${t.cut.suit}`);

  // pegHands = copy of show hands (now 4 cards each)
  t.pegHands.PLAYER1 = [...t.hands.PLAYER1];
  t.pegHands.PLAYER2 = [...t.hands.PLAYER2];

  // non-dealer starts pegging
  t.turn = otherPlayer(t.dealer);
  t.peg = { count: 0, pile: [], lastPlayer: null, go: { PLAYER1:false, PLAYER2:false } };

  pushLog(t, `Pegging starts. ${t.turn} to play.`);
}

function canPlayAny(hand, count) {
  return (hand || []).some(c => cardValue(c.rank) + count <= 31);
}

/* -------------------------
   Pegging scoring (includes runs)
--------------------------*/
function peggingRunPoints(pile) {
  const maxLookback = Math.min(pile.length, 7);
  for (let len = maxLookback; len >= 3; len--) {
    const slice = pile.slice(pile.length - len);
    const vals = slice.map(c => rankNum(c.rank));
    const set = new Set(vals);
    if (set.size !== len) continue;
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    if (max - min !== len - 1) continue;
    return len;
  }
  return 0;
}

function pegPointsAfterPlay(t, player, playedCard) {
  let pts = 0;
  const reasons = [];

  if (t.peg.count === 15) { pts += 2; reasons.push("15 for 2"); }
  if (t.peg.count === 31) { pts += 2; reasons.push("31 for 2"); }

  // pairs/trips/quads
  let same = 1;
  for (let i = t.peg.pile.length - 2; i >= 0; i--) {
    if (t.peg.pile[i].rank === playedCard.rank) same++;
    else break;
  }
  if (same === 2) { pts += 2; reasons.push("pair for 2"); }
  else if (same === 3) { pts += 6; reasons.push("three of a kind for 6"); }
  else if (same === 4) { pts += 12; reasons.push("four of a kind for 12"); }

  // runs
  const runPts = peggingRunPoints(t.peg.pile);
  if (runPts >= 3) { pts += runPts; reasons.push(`run of ${runPts} for ${runPts}`); }

  t.lastPegEvent = { player, pts, reasons };

  if (pts) pushLog(t, `${player} scores ${pts} pegging point(s) (${reasons.join(", ")}).`);
  return pts;
}

function awardLastCardIfNeeded(t) {
  // "last card for 1" (not when ending at 31)
  if (t.peg.count !== 0 && t.peg.count !== 31 && t.peg.lastPlayer) {
    t.scores[t.peg.lastPlayer] += 1;
    t.lastPegEvent = { player: t.peg.lastPlayer, pts: 1, reasons: ["last card for 1"] };
    pushLog(t, `${t.peg.lastPlayer} scores 1 for last card.`);
    checkForGameWin(t);
  }
}

function resetPegCount(t) {
  t.peg.count = 0;
  t.peg.pile = [];
  t.peg.lastPlayer = null;
  t.peg.go = { PLAYER1:false, PLAYER2:false };
  pushLog(t, `Count resets to 0.`);
}

/**
 * Critical anti-stall:
 * If one player has 0 cards left, and the remaining player cannot play to current count,
 * then we award last card (if appropriate) and reset count automatically so play can continue.
 */
function maybeAutoResetForSoloPlayer(t) {
  if (t.stage !== "pegging") return false;

  const p1n = t.pegHands.PLAYER1.length;
  const p2n = t.pegHands.PLAYER2.length;

  if (p1n === 0 && p2n === 0) return false;

  let solo = null;
  if (p1n > 0 && p2n === 0) solo = "PLAYER1";
  if (p2n > 0 && p1n === 0) solo = "PLAYER2";
  if (!solo) return false;

  // If solo player cannot play any card to current count, reset the count.
  if (!canPlayAny(t.pegHands[solo], t.peg.count)) {
    awardLastCardIfNeeded(t);
    resetPegCount(t);
    t.turn = solo; // solo continues
    pushLog(t, `${solo} continues (opponent out of cards).`);
    return true;
  }

  // otherwise: ensure it's solo's turn (since opp has none)
  t.turn = solo;
  return false;
}

/* -------------------------
   SHOW scoring with breakdown
--------------------------*/
function combos(arr, k, start=0, prefix=[], out=[]) {
  if (prefix.length === k) { out.push(prefix); return out; }
  for (let i = start; i <= arr.length - (k - prefix.length); i++) {
    combos(arr, k, i+1, prefix.concat([arr[i]]), out);
  }
  return out;
}

function score15sDetailed(cards) {
  let count = 0;
  for (let k = 2; k <= 5; k++) {
    for (const set of combos(cards, k)) {
      const sum = set.reduce((a,c)=>a+cardValue(c.rank),0);
      if (sum === 15) count++;
    }
  }
  return { count, pts: count * 2 };
}

function scorePairsDetailed(cards) {
  const byRank = {};
  for (const c of cards) byRank[c.rank] = (byRank[c.rank] || 0) + 1;

  let pairCount = 0;
  let pts = 0;

  for (const r of Object.keys(byRank)) {
    const n = byRank[r];
    if (n >= 2) {
      const comb = (n * (n - 1)) / 2;
      pairCount += comb;
      pts += comb * 2;
    }
  }
  return { pairs: pairCount, pts };
}

function runsMultiplicity(cards) {
  const counts = Array(14).fill(0);
  for (const c of cards) counts[rankNum(c.rank)]++;

  function runCount(len) {
    let total = 0;
    for (let start=1; start<=13-len+1; start++) {
      let mult = 1;
      for (let r=start; r<start+len; r++) {
        if (counts[r] === 0) { mult = 0; break; }
        mult *= counts[r];
      }
      if (mult > 0) total += mult;
    }
    return total;
  }

  for (let len=5; len>=3; len--) {
    const mult = runCount(len);
    if (mult > 0) return { len, mult, pts: len * mult };
  }
  return { len: 0, mult: 0, pts: 0 };
}

function scoreFlushDetailed(hand4, cut, isCrib) {
  const suit = hand4[0].suit;
  const all4 = hand4.every(c => c.suit === suit);
  if (!all4) return { type: "none", pts: 0 };

  const cutMatches = cut.suit === suit;

  if (isCrib) {
    return cutMatches ? { type: "5-card flush", pts: 5 } : { type: "crib needs 5-card flush", pts: 0 };
  }

  if (cutMatches) return { type: "5-card flush", pts: 5 };
  return { type: "4-card flush", pts: 4 };
}

function scoreNobsDetailed(hand4, cut) {
  const has = hand4.some(c => c.rank === "J" && c.suit === cut.suit);
  return { has, pts: has ? 1 : 0 };
}

function scoreHandBreakdown(hand4, cut, isCrib=false) {
  const all = hand4.concat([cut]);
  const items = [];

  const fif = score15sDetailed(all);
  if (fif.count > 0) items.push({ label: `${fif.count} fifteens`, pts: fif.pts });

  const pr = scorePairsDetailed(all);
  if (pr.pairs > 0) items.push({ label: `${pr.pairs} pair${pr.pairs===1?"":"s"}`, pts: pr.pts });

  const ru = runsMultiplicity(all);
  if (ru.len >= 3) {
    const label = ru.mult === 1 ? `run of ${ru.len}` : `${ru.mult} runs of ${ru.len}`;
    items.push({ label, pts: ru.pts });
  }

  const fl = scoreFlushDetailed(hand4, cut, isCrib);
  if (fl.pts > 0) items.push({ label: fl.type, pts: fl.pts });

  const nb = scoreNobsDetailed(hand4, cut);
  if (nb.pts > 0) items.push({ label: "nobs (jack matches cut suit)", pts: 1 });

  const total = items.reduce((a,i)=>a+i.pts,0);
  return { total, items };
}

function scoreShowAndAdvance(t) {
  if (t.matchOver || t.gameOver) return;

  const nonDealer = otherPlayer(t.dealer);
  const dealer = t.dealer;

  const nonBD = scoreHandBreakdown(t.hands[nonDealer], t.cut, false);
  const deaBD = scoreHandBreakdown(t.hands[dealer], t.cut, false);
  const cribBD = scoreHandBreakdown(t.crib, t.cut, true);

  t.scores[nonDealer] += nonBD.total;
  t.scores[dealer] += (deaBD.total + cribBD.total);

  t.show = {
    nonDealer,
    dealer,
    cut: t.cut,
    hand: {
      [nonDealer]: { cards: t.hands[nonDealer], breakdown: nonBD },
      [dealer]: { cards: t.hands[dealer], breakdown: deaBD }
    },
    crib: { cards: t.crib, breakdown: cribBD }
  };

  pushLog(t, `SHOW: ${nonDealer} +${nonBD.total}, ${dealer} +${deaBD.total}, crib +${cribBD.total}`);
  checkForGameWin(t);

  // If game ended, don't go to show stage; go to gameover/matchover
  if (t.matchOver || t.gameOver) return;

  t.stage = "show";
}

/* -------------------------
   Socket.IO
--------------------------*/
io.on("connection", (socket) => {

  socket.on("join_table", ({ tableId, name }) => {
    tableId = (tableId || "JIM1").toString().trim().slice(0, 24);
    const t = ensureTable(tableId);

    let me = null;
    if (!t.players.PLAYER1) me = "PLAYER1";
    else if (!t.players.PLAYER2) me = "PLAYER2";
    else return socket.emit("error_msg", "Table is full (2 players).");

    t.players[me] = socket.id;
    t.names[me] = (name || me).toString().trim().slice(0, 16) || me;

    socket.tableId = tableId;
    socket.playerId = me;

    pushLog(t, `${t.names[me]} joined as ${me}.`);
    emitState(tableId);

    // Start match/game if first time and both players present
    if (t.players.PLAYER1 && t.players.PLAYER2 && t.stage === "lobby") {
      // Ensure match initialized
      if (!t.matchWins) t.matchWins = { PLAYER1: 0, PLAYER2: 0 };
      startHand(t);
      emitState(tableId);
    }
  });

  socket.on("discard_to_crib", ({ cardIds }) => {
    const t = tables[socket.tableId];
    if (!t || t.stage !== "discard") return;
    if (t.gameOver || t.matchOver) return;

    const me = socket.playerId;
    const ids = Array.isArray(cardIds) ? cardIds : [];
    if (!me || ids.length !== 2) return;

    const hand = t.hands[me];
    const chosen = [];
    for (const id of ids) {
      const idx = hand.findIndex(c => c.id === id);
      if (idx === -1) return;
      chosen.push(hand[idx]);
    }

    t.hands[me] = t.hands[me].filter(c => !ids.includes(c.id));
    t.pegHands[me] = t.pegHands[me].filter(c => !ids.includes(c.id));

    t.discards[me] = chosen;
    t.crib.push(...chosen);

    pushLog(t, `${me} discards 2 to crib.`);

    const p1Done = t.discards.PLAYER1.length === 2;
    const p2Done = t.discards.PLAYER2.length === 2;
    if (p1Done && p2Done && t.crib.length === 4) enterPegging(t);

    emitState(socket.tableId);
  });

  socket.on("play_card", ({ cardId }) => {
    const t = tables[socket.tableId];
    if (!t || t.stage !== "pegging") return;
    if (t.gameOver || t.matchOver) return;

    const me = socket.playerId;
    if (!me || t.turn !== me) return;

    const hand = t.pegHands[me];
    const idx = hand.findIndex(c => c.id === cardId);
    if (idx === -1) return;

    const card = hand[idx];
    const val = cardValue(card.rank);
    if (t.peg.count + val > 31) return;

    // play it
    hand.splice(idx, 1);
    t.pegHands[me] = hand;

    t.peg.count += val;
    t.peg.pile.push(card);
    t.peg.lastPlayer = me;
    t.peg.go.PLAYER1 = false;
    t.peg.go.PLAYER2 = false;

    pushLog(t, `${me} plays ${card.rank}${card.suit}. Count=${t.peg.count}`);

    const pts = pegPointsAfterPlay(t, me, card);
    if (pts) {
      t.scores[me] += pts;
      checkForGameWin(t);
      if (t.matchOver || t.gameOver) return emitState(socket.tableId);
    }

    // hit 31 => reset and pass lead
    if (t.peg.count === 31) {
      resetPegCount(t);
      t.turn = otherPlayer(me);
      pushLog(t, `${t.turn} to play.`);
      maybeAutoResetForSoloPlayer(t);
      return emitState(socket.tableId);
    }

    // normal turn pass unless opponent has 0 cards
    const opp = otherPlayer(me);
    if ((t.pegHands[opp]?.length || 0) === 0) {
      t.turn = me; // opponent out; keep turn
    } else {
      t.turn = opp;
    }

    // Anti-stall check (solo player blocked by count)
    maybeAutoResetForSoloPlayer(t);

    // If pegging is over (both empty)
    if (t.pegHands.PLAYER1.length === 0 && t.pegHands.PLAYER2.length === 0) {
      awardLastCardIfNeeded(t);
      if (t.matchOver || t.gameOver) return emitState(socket.tableId);
      scoreShowAndAdvance(t);
    }

    emitState(socket.tableId);
  });

  socket.on("go", () => {
    const t = tables[socket.tableId];
    if (!t || t.stage !== "pegging") return;
    if (t.gameOver || t.matchOver) return;

    const me = socket.playerId;
    if (!me || t.turn !== me) return;

    const opp = otherPlayer(me);

    // If opponent has 0 cards, GO isn't needed; rely on auto-reset logic
    if ((t.pegHands[opp]?.length || 0) === 0) {
      maybeAutoResetForSoloPlayer(t);
      return emitState(socket.tableId);
    }

    // If you can play, GO is invalid
    if (canPlayAny(t.pegHands[me], t.peg.count)) return;

    t.peg.go[me] = true;
    pushLog(t, `${me} says GO.`);

    // If opponent can play, pass turn
    if (canPlayAny(t.pegHands[opp], t.peg.count)) {
      t.turn = opp;
      pushLog(t, `${opp} to play.`);
      return emitState(socket.tableId);
    }

    // Both cannot play => last card + reset
    awardLastCardIfNeeded(t);
    if (t.matchOver || t.gameOver) return emitState(socket.tableId);

    resetPegCount(t);

    // After reset, non-dealer leads
    t.turn = otherPlayer(t.dealer);
    pushLog(t, `${t.turn} to play.`);

    // If both empty, score show
    if (t.pegHands.PLAYER1.length === 0 && t.pegHands.PLAYER2.length === 0) {
      scoreShowAndAdvance(t);
    }

    emitState(socket.tableId);
  });

  socket.on("next_hand", () => {
    const t = tables[socket.tableId];
    if (!t || t.stage !== "show") return;
    if (t.gameOver || t.matchOver) return;

    t.dealer = otherPlayer(t.dealer);
    startHand(t);
    emitState(socket.tableId);
  });

  socket.on("next_game", () => {
    const t = tables[socket.tableId];
    if (!t) return;
    if (!t.gameOver || t.matchOver) return;

    // Start next game in match: reset scores, keep matchWins
    t.gameOver = false;
    t.winner = null;
    t.stage = "lobby";

    // Alternate dealer each new game
    t.dealer = otherPlayer(t.dealer);

    // Reset game points and hand state
    t.scores = { PLAYER1: 0, PLAYER2: 0 };
    t.cut = null;
    t.crib = [];
    t.show = null;
    t.lastPegEvent = null;
    t.hands = { PLAYER1: [], PLAYER2: [] };
    t.pegHands = { PLAYER1: [], PLAYER2: [] };
    t.discards = { PLAYER1: [], PLAYER2: [] };
    t.peg = { count: 0, pile: [], lastPlayer: null, go: { PLAYER1:false, PLAYER2:false } };

    pushLog(t, `⚓ Next game starting. Dealer: ${t.dealer}`);

    if (t.players.PLAYER1 && t.players.PLAYER2) startHand(t);
    emitState(socket.tableId);
  });

  socket.on("new_match", () => {
    const t = tables[socket.tableId];
    if (!t) return;

    resetForNewMatch(t);

    if (t.players.PLAYER1 && t.players.PLAYER2) {
      startHand(t);
    }
    emitState(socket.tableId);
  });

  socket.on("disconnect", () => {
    const t = tables[socket.tableId];
    if (!t) return;

    const me = socket.playerId;
    if (me && t.players[me] === socket.id) {
      t.players[me] = null;
      pushLog(t, `${me} disconnected.`);
    }
    emitState(socket.tableId);
  });
});
