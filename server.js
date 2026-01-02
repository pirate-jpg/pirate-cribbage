// Pirate Cribbage (2P + optional AI opponent)
//
// Features:
// - Lobby join with name + table
// - Optional AI opponent (PLAYER2 = "AI Captain")
// - Discard 2 -> pegging -> show scoring breakdown
// - Pegging scoring: 15/31, pairs, runs, last card
// - Show scoring: 15s/pairs/runs/flush/nobs (with breakdown)
// - Robust GO handling + clear "GO" notices
// - Hard game end at >=121 with winner notice
//
// NOTE: This file is intentionally self-contained and avoids partial pastes.

const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const GAME_TARGET = 121;

const app = express();
app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (req, res) => res.send("ok"));

const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Listening on", PORT));

const tables = {}; // tableId -> tableState

// -------------------- Deck / helpers --------------------
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
function sanitizeName(name, fallback) {
  const n = (name || "").toString().trim().slice(0, 16);
  return n.length ? n : fallback;
}
function canPlayAny(hand, count) {
  return (hand || []).some(c => cardValue(c.rank) + count <= 31);
}

// -------------------- Table state --------------------
function ensureTable(tableId) {
  if (!tables[tableId]) {
    tables[tableId] = {
      id: tableId,

      // sockets for humans; AI uses null socket id + isAI flag
      players: { PLAYER1: null, PLAYER2: null },
      isAI:   { PLAYER1: false, PLAYER2: false },

      names: { PLAYER1: "PLAYER1", PLAYER2: "PLAYER2" },

      stage: "lobby", // lobby | discard | pegging | show
      dealer: "PLAYER1",
      turn: "PLAYER1",

      deck: [],
      cut: null,
      crib: [],

      hands:    { PLAYER1: [], PLAYER2: [] }, // preserved for show (4)
      pegHands: { PLAYER1: [], PLAYER2: [] }, // consumed during pegging

      discards: { PLAYER1: [], PLAYER2: [] },

      peg: {
        count: 0,
        pile: [],
        lastPlayer: null,
        go: { PLAYER1: false, PLAYER2: false }
      },

      scores: { PLAYER1: 0, PLAYER2: 0 },
      gameTarget: GAME_TARGET,

      gameOver: false,
      gameWinner: null, // PLAYER1/PLAYER2

      // UI notice (for "GO", winner, etc.)
      notice: "",
      noticeSeq: 0,

      log: []
    };
  }
  return tables[tableId];
}

function pushLog(t, msg) {
  t.log.push(msg);
  if (t.log.length > 200) t.log.shift();
}

function setNotice(t, msg) {
  t.notice = msg;
  t.noticeSeq += 1;
  pushLog(t, msg);
}

function checkGameEnd(t) {
  if (t.gameOver) return;
  const p1 = t.scores.PLAYER1;
  const p2 = t.scores.PLAYER2;
  if (p1 >= t.gameTarget || p2 >= t.gameTarget) {
    t.gameOver = true;
    t.gameWinner = (p1 >= t.gameTarget) ? "PLAYER1" : "PLAYER2";
    const winnerName = t.names[t.gameWinner];
    setNotice(t, `🏁 GAME OVER — ${winnerName} wins (${p1}–${p2}).`);
  }
}

// -------------------- Public state per player --------------------
function publicStateFor(t, me) {
  const opp = otherPlayer(me);
  const handForUI = (t.stage === "pegging") ? (t.pegHands[me] || []) : (t.hands[me] || []);
  return {
    tableId: t.id,
    stage: t.stage,
    dealer: t.dealer,
    turn: t.turn,
    cut: t.cut,

    scores: t.scores,
    gameTarget: t.gameTarget,
    gameOver: t.gameOver,
    gameWinner: t.gameWinner,

    names: t.names,

    players: {
      PLAYER1: t.players.PLAYER1 ? t.names.PLAYER1 : null,
      PLAYER2: (t.players.PLAYER2 || t.isAI.PLAYER2) ? t.names.PLAYER2 : null
    },

    isAI: { ...t.isAI },

    cribCount: t.crib.length,
    discardsCount: {
      PLAYER1: t.discards.PLAYER1.length,
      PLAYER2: t.discards.PLAYER2.length
    },

    peg: {
      count: t.peg.count,
      pile: t.peg.pile.map(c => ({ id: c.id, rank: c.rank, suit: c.suit })),
      lastPlayer: t.peg.lastPlayer,
      go: { ...t.peg.go }
    },

    me,
    myHand: handForUI,

    myHandCount: (t.pegHands[me] || []).length,
    oppHandCount: (t.pegHands[opp] || []).length,

    show: t.show || null,

    notice: t.notice || "",
    noticeSeq: t.noticeSeq || 0,

    log: t.log
  };
}

function emitState(tableId) {
  const t = tables[tableId];
  if (!t) return;

  // Emit to PLAYER1 if connected
  if (t.players.PLAYER1) io.to(t.players.PLAYER1).emit("state", publicStateFor(t, "PLAYER1"));

  // Emit to PLAYER2 if connected (human)
  if (t.players.PLAYER2) io.to(t.players.PLAYER2).emit("state", publicStateFor(t, "PLAYER2"));
}

// -------------------- Hand flow --------------------
function startHand(t) {
  if (t.gameOver) return;

  t.stage = "discard";
  t.deck = shuffle(newDeck());
  t.crib = [];
  t.cut = null;
  t.show = null;

  t.discards = { PLAYER1: [], PLAYER2: [] };
  t.peg = { count: 0, pile: [], lastPlayer: null, go: { PLAYER1: false, PLAYER2: false } };

  const p1 = t.deck.splice(0, 6);
  const p2 = t.deck.splice(0, 6);

  t.hands.PLAYER1 = [...p1];
  t.hands.PLAYER2 = [...p2];
  t.pegHands.PLAYER1 = [...p1];
  t.pegHands.PLAYER2 = [...p2];

  // discard phase turn not used; but we keep it as dealer for UI
  t.turn = t.dealer;

  setNotice(t, `🃏 New hand. Dealer: ${t.names[t.dealer]}.`);
}

function enterPegging(t) {
  t.stage = "pegging";
  t.cut = t.deck.splice(0, 1)[0];

  // Now hands are 4 each, pegHands copy those 4 for pegging
  t.pegHands.PLAYER1 = [...t.hands.PLAYER1];
  t.pegHands.PLAYER2 = [...t.hands.PLAYER2];

  // non-dealer leads pegging
  t.turn = otherPlayer(t.dealer);
  t.peg = { count: 0, pile: [], lastPlayer: null, go: { PLAYER1: false, PLAYER2: false } };

  setNotice(t, `✂️ Cut: ${t.cut.rank}${t.cut.suit}. Pegging starts — ${t.names[t.turn]} leads.`);
}

// -------------------- Pegging scoring --------------------
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

  // pairs / trips / quads
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

  if (pts) {
    t.scores[player] += pts;
    setNotice(t, `🏴‍☠️ ${t.names[player]} scores +${pts} (${reasons.join(", ")}).`);
    checkGameEnd(t);
  }

  return pts;
}

function awardLastCardIfNeeded(t) {
  if (t.peg.count !== 0 && t.peg.count !== 31 && t.peg.lastPlayer) {
    const p = t.peg.lastPlayer;
    t.scores[p] += 1;
    setNotice(t, `🪙 ${t.names[p]} scores 1 for last card.`);
    checkGameEnd(t);
  }
}

function resetPegCount(t) {
  t.peg.count = 0;
  t.peg.pile = [];
  t.peg.lastPlayer = null;
  t.peg.go = { PLAYER1: false, PLAYER2: false };
  setNotice(t, `🔁 Count resets to 0.`);
}

function endSequenceAndContinue(t, nextTurnPlayer) {
  awardLastCardIfNeeded(t);
  resetPegCount(t);

  // if pegging ended
  if (t.pegHands.PLAYER1.length === 0 && t.pegHands.PLAYER2.length === 0) {
    scoreShowAndAdvance(t);
    return;
  }

  t.turn = nextTurnPlayer;
  setNotice(t, `➡️ ${t.names[t.turn]} to play.`);
}

// -------------------- Show scoring --------------------
function combos(arr, k, start = 0, prefix = [], out = []) {
  if (prefix.length === k) { out.push(prefix); return out; }
  for (let i = start; i <= arr.length - (k - prefix.length); i++) {
    combos(arr, k, i + 1, prefix.concat([arr[i]]), out);
  }
  return out;
}

function score15sDetailed(cards) {
  let count = 0;
  for (let k = 2; k <= 5; k++) {
    for (const set of combos(cards, k)) {
      const sum = set.reduce((a, c) => a + cardValue(c.rank), 0);
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
    for (let start = 1; start <= 13 - len + 1; start++) {
      let mult = 1;
      for (let r = start; r < start + len; r++) {
        if (counts[r] === 0) { mult = 0; break; }
        mult *= counts[r];
      }
      if (mult > 0) total += mult;
    }
    return total;
  }

  for (let len = 5; len >= 3; len--) {
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

function scoreHandBreakdown(hand4, cut, isCrib = false) {
  const all = hand4.concat([cut]);
  const items = [];

  const fif = score15sDetailed(all);
  if (fif.count > 0) items.push({ label: `${fif.count} fifteens`, pts: fif.pts });

  const pr = scorePairsDetailed(all);
  if (pr.pairs > 0) items.push({ label: `${pr.pairs} pair${pr.pairs === 1 ? "" : "s"}`, pts: pr.pts });

  const ru = runsMultiplicity(all);
  if (ru.len >= 3) {
    const label = ru.mult === 1 ? `run of ${ru.len}` : `${ru.mult} runs of ${ru.len}`;
    items.push({ label, pts: ru.pts });
  }

  const fl = scoreFlushDetailed(hand4, cut, isCrib);
  if (fl.pts > 0) items.push({ label: fl.type, pts: fl.pts });

  const nb = scoreNobsDetailed(hand4, cut);
  if (nb.pts > 0) items.push({ label: "nobs (jack matches cut suit)", pts: 1 });

  const total = items.reduce((a, i) => a + i.pts, 0);
  return { total, items };
}

function scoreShowAndAdvance(t) {
  const nonDealer = otherPlayer(t.dealer);
  const dealer = t.dealer;

  const nonBD = scoreHandBreakdown(t.hands[nonDealer], t.cut, false);
  const deaBD = scoreHandBreakdown(t.hands[dealer], t.cut, false);
  const cribBD = scoreHandBreakdown(t.crib, t.cut, true);

  // Apply points
  t.scores[nonDealer] += nonBD.total;
  t.scores[dealer] += deaBD.total + cribBD.total;

  // Build payload for UI
  t.show = {
    nonDealer,
    dealer,
    cut: t.cut,
    cribOwner: dealer,
    hand: {
      [nonDealer]: { cards: t.hands[nonDealer], breakdown: nonBD },
      [dealer]: { cards: t.hands[dealer], breakdown: deaBD }
    },
    crib: { cards: t.crib, breakdown: cribBD }
  };

  t.stage = "show";

  setNotice(t, `📜 SHOW: ${t.names[nonDealer]} +${nonBD.total}, ${t.names[dealer]} +${deaBD.total}, crib +${cribBD.total}.`);
  checkGameEnd(t);

  // If game ends here, announce winner loudly
  if (t.gameOver) {
    const p1 = t.scores.PLAYER1;
    const p2 = t.scores.PLAYER2;
    setNotice(t, `🏁 GAME OVER — ${t.names[t.gameWinner]} wins (${p1}–${p2}).`);
  }
}

// -------------------- AI logic --------------------
function aiChooseDiscard(hand6) {
  // Dumb-but-stable: discard the two highest-value cards
  const sorted = [...hand6].sort((a, b) => cardValue(b.rank) - cardValue(a.rank));
  return [sorted[0], sorted[1]];
}

function aiChoosePegCard(hand, count) {
  // Simple: play the highest card that doesn't exceed 31
  const playable = hand
    .filter(c => cardValue(c.rank) + count <= 31)
    .sort((a, b) => cardValue(b.rank) - cardValue(a.rank));
  return playable.length ? playable[0] : null;
}

function maybeAIMove(t) {
  // Only AI is PLAYER2 in this build
  if (!t || !t.isAI.PLAYER2 || t.gameOver) return;

  // If table doesn't have a human PLAYER1, don't do anything
  if (!t.players.PLAYER1) return;

  // AI acts in discard and pegging, and only when it’s its “turn” logically
  // (discard has no strict turn, so we act when AI hasn't discarded yet)
  setTimeout(() => {
    if (!tables[t.id]) return;
    const tt = tables[t.id];
    if (tt.gameOver) { emitState(tt.id); return; }

    if (tt.stage === "discard") {
      // If AI already discarded, done
      if (tt.discards.PLAYER2.length === 2) return;

      // If AI still has 6 cards, discard now
      const hand = tt.hands.PLAYER2;
      if (!hand || hand.length < 6) return;

      const chosen = aiChooseDiscard(hand);
      const ids = chosen.map(c => c.id);
      // Use same path as discard handler, but directly here
      applyDiscardToCrib(tt, "PLAYER2", ids);
      emitState(tt.id);

      // If both done, enterPegging already called; if pegging starts and AI leads, keep going
      maybeAIMove(tt);
      return;
    }

    if (tt.stage === "pegging") {
      if (tt.turn !== "PLAYER2") return;

      // If AI has no cards, nothing to do
      const hand = tt.pegHands.PLAYER2 || [];
      if (hand.length === 0) return;

      const card = aiChoosePegCard(hand, tt.peg.count);
      if (card) {
        applyPlayCard(tt, "PLAYER2", card.id);
        emitState(tt.id);
        // continue if AI still has turn (opponent out etc.)
        maybeAIMove(tt);
      } else {
        // Can't play -> say GO
        applyGo(tt, "PLAYER2");
        emitState(tt.id);
        maybeAIMove(tt);
      }
    }
  }, 250);
}

// -------------------- Core actions (shared by sockets + AI) --------------------
function applyDiscardToCrib(t, me, cardIds) {
  if (!t || t.stage !== "discard" || t.gameOver) return false;
  const ids = Array.isArray(cardIds) ? cardIds : [];
  if (!me || ids.length !== 2) return false;

  const hand = t.hands[me];
  const chosen = [];
  for (const id of ids) {
    const idx = hand.findIndex(c => c.id === id);
    if (idx === -1) return false;
    chosen.push(hand[idx]);
  }

  t.hands[me] = t.hands[me].filter(c => !ids.includes(c.id));
  t.pegHands[me] = t.pegHands[me].filter(c => !ids.includes(c.id));

  t.discards[me] = chosen;
  t.crib.push(...chosen);

  setNotice(t, `🧺 ${t.names[me]} discards 2 to ${t.names[t.dealer]}'s crib.`);

  const p1Done = t.discards.PLAYER1.length === 2;
  const p2Done = t.discards.PLAYER2.length === 2;

  if (p1Done && p2Done && t.crib.length === 4) {
    enterPegging(t);
  }
  return true;
}

function applyPlayCard(t, me, cardId) {
  if (!t || t.stage !== "pegging" || t.gameOver) return false;
  if (!me || t.turn !== me) return false;

  const hand = t.pegHands[me] || [];
  const idx = hand.findIndex(c => c.id === cardId);
  if (idx === -1) return false;

  const card = hand[idx];
  const val = cardValue(card.rank);
  if (t.peg.count + val > 31) return false;

  // play it
  hand.splice(idx, 1);
  t.pegHands[me] = hand;

  t.peg.count += val;
  t.peg.pile.push(card);
  t.peg.lastPlayer = me;

  // reset go flags on a play
  t.peg.go.PLAYER1 = false;
  t.peg.go.PLAYER2 = false;

  setNotice(t, `🃏 ${t.names[me]} plays ${card.rank}${card.suit}. Count=${t.peg.count}`);

  // scoring
  pegPointsAfterPlay(t, me, card);
  if (t.gameOver) return true;

  // handle exact 31 -> reset and pass lead to other
  if (t.peg.count === 31) {
    resetPegCount(t);
    t.turn = otherPlayer(me);
    setNotice(t, `➡️ ${t.names[t.turn]} to play.`);
    return true;
  }

  const opp = otherPlayer(me);

  // If opponent out of cards, current player keeps turn IF can play
  if ((t.pegHands[opp]?.length || 0) === 0) {
    t.turn = me;

    // If blocked, end the sequence automatically
    if (!canPlayAny(t.pegHands[me], t.peg.count) && t.peg.count > 0) {
      setNotice(t, `⛔ ${t.names[me]} is blocked while opponent is out — ending sequence.`);
      endSequenceAndContinue(t, me);
      return true;
    }
  } else {
    t.turn = opp;
  }

  // if pegging is over
  if (t.pegHands.PLAYER1.length === 0 && t.pegHands.PLAYER2.length === 0) {
    awardLastCardIfNeeded(t);
    scoreShowAndAdvance(t);
  } else {
    setNotice(t, `➡️ ${t.names[t.turn]} to play.`);
  }

  return true;
}

function applyGo(t, me) {
  if (!t || t.stage !== "pegging" || t.gameOver) return false;
  if (!me || t.turn !== me) return false;

  const opp = otherPlayer(me);

  // If I *can* play, GO not allowed
  if (canPlayAny(t.pegHands[me], t.peg.count)) return false;

  // Mark GO + announce
  t.peg.go[me] = true;
  setNotice(t, `🗣️ ${t.names[me]} says GO.`);

  // Special: opponent has 0 cards left -> end sequence immediately (me keeps lead)
  if ((t.pegHands[opp]?.length || 0) === 0) {
    endSequenceAndContinue(t, me);
    return true;
  }

  // If opponent can play -> pass turn
  if (canPlayAny(t.pegHands[opp], t.peg.count)) {
    t.turn = opp;
    setNotice(t, `➡️ ${t.names[opp]} to play.`);
    return true;
  }

  // Both cannot play -> end sequence; lead goes to lastPlayer (or non-dealer fallback)
  const lead = t.peg.lastPlayer ? t.peg.lastPlayer : otherPlayer(t.dealer);
  endSequenceAndContinue(t, lead);
  return true;
}

// -------------------- Socket.IO --------------------
io.on("connection", (socket) => {
  socket.on("join_table", ({ tableId, name, ai }) => {
    tableId = (tableId || "JIM1").toString().trim().slice(0, 24);
    const t = ensureTable(tableId);

    // Assign human as PLAYER1 if empty, else PLAYER2 if empty and not AI filled
    let me = null;
    if (!t.players.PLAYER1) me = "PLAYER1";
    else if (!t.players.PLAYER2 && !t.isAI.PLAYER2) me = "PLAYER2";
    else {
      return socket.emit("error_msg", "Table is full (2 players).");
    }

    t.players[me] = socket.id;
    t.isAI[me] = false;
    t.names[me] = sanitizeName(name, me);

    socket.tableId = tableId;
    socket.playerId = me;

    setNotice(t, `👋 ${t.names[me]} joined as ${me}.`);

    // If player1 joined and requested AI and table has no PLAYER2, fill PLAYER2 with AI
    if (me === "PLAYER1" && !!ai && !t.players.PLAYER2 && !t.isAI.PLAYER2) {
      t.players.PLAYER2 = null;
      t.isAI.PLAYER2 = true;
      t.names.PLAYER2 = "AI Captain";
      setNotice(t, `🤖 AI Captain has joined as PLAYER2.`);
    }

    emitState(tableId);

    // Start hand when we have two participants: (P1 human + P2 human) OR (P1 human + P2 AI)
    const hasTwo =
      !!t.players.PLAYER1 &&
      ( !!t.players.PLAYER2 || t.isAI.PLAYER2 );

    if (hasTwo && t.stage === "lobby" && !t.gameOver) {
      startHand(t);
      emitState(tableId);
      maybeAIMove(t);
    }
  });

  socket.on("discard_to_crib", ({ cardIds }) => {
    const t = tables[socket.tableId];
    if (!t) return;
    const me = socket.playerId;
    if (!me) return;

    const ok = applyDiscardToCrib(t, me, cardIds);
    if (!ok) return;

    emitState(socket.tableId);
    maybeAIMove(t);
  });

  socket.on("play_card", ({ cardId }) => {
    const t = tables[socket.tableId];
    if (!t) return;
    const me = socket.playerId;
    if (!me) return;

    const ok = applyPlayCard(t, me, cardId);
    if (!ok) return;

    emitState(socket.tableId);
    maybeAIMove(t);
  });

  socket.on("go", () => {
    const t = tables[socket.tableId];
    if (!t) return;
    const me = socket.playerId;
    if (!me) return;

    const ok = applyGo(t, me);
    if (!ok) return;

    emitState(socket.tableId);
    maybeAIMove(t);
  });

  socket.on("next_hand", () => {
    const t = tables[socket.tableId];
    if (!t || t.stage !== "show") return;

    if (t.gameOver) {
      // If game already ended, do nothing (keeps winner on screen)
      return emitState(socket.tableId);
    }

    // rotate dealer
    t.dealer = otherPlayer(t.dealer);
    startHand(t);
    emitState(socket.tableId);
    maybeAIMove(t);
  });

  socket.on("new_game", () => {
    const t = tables[socket.tableId];
    if (!t) return;

    // reset scores + state, keep players
    t.scores = { PLAYER1: 0, PLAYER2: 0 };
    t.gameOver = false;
    t.gameWinner = null;
    t.stage = "lobby";
    t.dealer = "PLAYER1";
    t.turn = "PLAYER1";
    t.show = null;
    setNotice(t, `🧭 New game started. First to ${t.gameTarget}.`);

    const hasTwo =
      !!t.players.PLAYER1 &&
      ( !!t.players.PLAYER2 || t.isAI.PLAYER2 );

    if (hasTwo) {
      startHand(t);
    }
    emitState(socket.tableId);
    maybeAIMove(t);
  });

  socket.on("disconnect", () => {
    const t = tables[socket.tableId];
    if (!t) return;

    const me = socket.playerId;
    if (me && t.players[me] === socket.id) {
      t.players[me] = null;
      t.isAI[me] = false;
      setNotice(t, `💨 ${t.names[me]} disconnected.`);
    }

    // If PLAYER1 disconnects, kill the AI seat too (prevents ghost tables)
    if (!t.players.PLAYER1) {
      t.players.PLAYER2 = null;
      t.isAI.PLAYER2 = false;
      t.names.PLAYER2 = "PLAYER2";
      t.stage = "lobby";
    }

    emitState(socket.tableId);
  });
});
