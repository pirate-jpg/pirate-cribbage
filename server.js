// Pirate Cribbage - working 2-player flow with pegging + show (hand + crib scoring)

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

/** -------------------------
 *  Game State
 *  ------------------------- */

const tables = {}; // tableId -> tableState

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

function ensureTable(tableId) {
  if (!tables[tableId]) {
    tables[tableId] = {
      id: tableId,
      players: { PLAYER1: null, PLAYER2: null }, // socket.id
      names: { PLAYER1: "Pirate", PLAYER2: "PLAYER2" },

      dealer: "PLAYER1",
      stage: "lobby", // lobby | discard | pegging | show
      turn: "PLAYER1",

      deck: [],
      cut: null,
      crib: [],

      // IMPORTANT:
      // hands = 4-card "show" hands (do not mutate during pegging)
      // pegHands = hands you actually play from during pegging
      hands: { PLAYER1: [], PLAYER2: [] },
      pegHands: { PLAYER1: [], PLAYER2: [] },

      originalHands: { PLAYER1: [], PLAYER2: [] }, // 6 dealt (for optional display)
      discards: { PLAYER1: [], PLAYER2: [] },

      peg: {
        count: 0,
        pile: [],
        lastPlayer: null,
        go: { PLAYER1: false, PLAYER2: false }
      },

      scores: { PLAYER1: 0, PLAYER2: 0 },
      log: []
    };
  }
  return tables[tableId];
}

function pushLog(t, msg) {
  t.log.push(msg);
  if (t.log.length > 120) t.log.shift();
}

function publicStateFor(table, me) {
  const handForUI =
    table.stage === "pegging"
      ? (table.pegHands[me] || [])
      : (table.hands[me] || []);

  return {
    tableId: table.id,
    stage: table.stage,
    dealer: table.dealer,
    turn: table.turn,
    cut: table.cut,
    peg: {
      count: table.peg.count,
      pile: table.peg.pile.map(c => ({ rank: c.rank, suit: c.suit })),
      lastPlayer: table.peg.lastPlayer,
      go: table.peg.go
    },
    scores: table.scores,
    players: {
      PLAYER1: table.players.PLAYER1 ? table.names.PLAYER1 : null,
      PLAYER2: table.players.PLAYER2 ? table.names.PLAYER2 : null
    },
    me,
    myHand: handForUI,
    myOriginalHand: table.originalHands[me] || [],
    cribCount: table.crib.length,
    discardsCount: {
      PLAYER1: table.discards.PLAYER1.length,
      PLAYER2: table.discards.PLAYER2.length
    },
    log: table.log
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

function startHand(t) {
  t.stage = "discard";
  t.deck = shuffle(newDeck());
  t.crib = [];
  t.cut = null;

  t.discards = { PLAYER1: [], PLAYER2: [] };

  t.peg = { count: 0, pile: [], lastPlayer: null, go: { PLAYER1:false, PLAYER2:false } };

  // deal 6 each
  const p1 = t.deck.splice(0, 6);
  const p2 = t.deck.splice(0, 6);

  t.originalHands.PLAYER1 = [...p1];
  t.originalHands.PLAYER2 = [...p2];

  // In discard stage, both hands and pegHands hold the same 6 until discards complete
  t.hands.PLAYER1 = [...p1];
  t.hands.PLAYER2 = [...p2];
  t.pegHands.PLAYER1 = [...p1];
  t.pegHands.PLAYER2 = [...p2];

  pushLog(t, `New hand. Dealer: ${t.dealer}`);
}

function enterPegging(t) {
  t.stage = "pegging";
  t.cut = t.deck.splice(0, 1)[0];
  pushLog(t, `Cut: ${t.cut.rank}${t.cut.suit}`);

  // Copy show-hands into pegHands so pegging can consume pegHands
  t.pegHands.PLAYER1 = [...t.hands.PLAYER1];
  t.pegHands.PLAYER2 = [...t.hands.PLAYER2];

  // non-dealer starts pegging
  t.turn = otherPlayer(t.dealer);

  t.peg = { count: 0, pile: [], lastPlayer: null, go: { PLAYER1:false, PLAYER2:false } };
  pushLog(t, `Pegging starts. ${t.turn} to play.`);
}

function canPlayAny(hand, count) {
  return hand.some(c => cardValue(c.rank) + count <= 31);
}

/** -------------------------
 *  Pegging scoring
 *  ------------------------- */

function pegPointsAfterPlay(t, player, playedCard) {
  let pts = 0;

  if (t.peg.count === 15) pts += 2;
  if (t.peg.count === 31) pts += 2;

  // pairs based on most recent consecutive same ranks
  let same = 1;
  for (let i = t.peg.pile.length - 2; i >= 0; i--) {
    if (t.peg.pile[i].rank === playedCard.rank) same++;
    else break;
  }
  if (same === 2) pts += 2;
  else if (same === 3) pts += 6;
  else if (same === 4) pts += 12;

  if (pts) pushLog(t, `${player} scores ${pts} pegging point(s).`);
  return pts;
}

function awardLastCardIfNeeded(t) {
  if (t.peg.count !== 0 && t.peg.count !== 31 && t.peg.lastPlayer) {
    t.scores[t.peg.lastPlayer] += 1;
    pushLog(t, `${t.peg.lastPlayer} scores 1 for last card.`);
  }
}

function resetPegCount(t) {
  t.peg.count = 0;
  t.peg.pile = [];
  t.peg.lastPlayer = null;
  t.peg.go = { PLAYER1:false, PLAYER2:false };
  pushLog(t, `Count resets to 0.`);
}

/** -------------------------
 *  Hand scoring (15s, pairs, runs, flush, nobs)
 *  ------------------------- */

function combos(arr, k, start=0, prefix=[], out=[]) {
  if (prefix.length === k) { out.push(prefix); return out; }
  for (let i = start; i <= arr.length - (k - prefix.length); i++) {
    combos(arr, k, i+1, prefix.concat([arr[i]]), out);
  }
  return out;
}

function score15s(cards) {
  let pts = 0;
  for (let k = 2; k <= 5; k++) {
    for (const set of combos(cards, k)) {
      const sum = set.reduce((a,c)=>a+cardValue(c.rank),0);
      if (sum === 15) pts += 2;
    }
  }
  return pts;
}

function scorePairs(cards) {
  let pts = 0;
  for (let i=0;i<cards.length;i++) {
    for (let j=i+1;j<cards.length;j++) {
      if (cards[i].rank === cards[j].rank) pts += 2;
    }
  }
  return pts;
}

function scoreRuns(cards) {
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
    const rc = runCount(len);
    if (rc > 0) return rc * len;
  }
  return 0;
}

function scoreFlush(hand4, cut, isCrib) {
  if (!hand4 || hand4.length !== 4 || !cut) return 0;
  const suit = hand4[0].suit;
  const all4 = hand4.every(c => c.suit === suit);
  if (!all4) return 0;
  const cutMatches = cut.suit === suit;

  if (isCrib) return cutMatches ? 5 : 0;
  return cutMatches ? 5 : 4;
}

function scoreNobs(hand4, cut) {
  if (!hand4 || hand4.length !== 4 || !cut) return 0;
  return hand4.some(c => c.rank === "J" && c.suit === cut.suit) ? 1 : 0;
}

function scoreHand(hand4, cut, isCrib=false) {
  if (!hand4 || hand4.length !== 4 || !cut) return 0;
  const all = hand4.concat([cut]);
  let pts = 0;
  pts += score15s(all);
  pts += scorePairs(all);
  pts += scoreRuns(all);
  pts += scoreFlush(hand4, cut, isCrib);
  pts += scoreNobs(hand4, cut);
  return pts;
}

function scoreShowAndAdvance(t) {
  const nonDealer = otherPlayer(t.dealer);
  const dealer = t.dealer;

  // crib must be 4 cards
  if (t.crib.length !== 4) {
    pushLog(t, `SHOW ERROR: crib has ${t.crib.length} cards (expected 4).`);
  }

  const nonPts = scoreHand(t.hands[nonDealer], t.cut, false);
  const dealPts = scoreHand(t.hands[dealer], t.cut, false);
  const cribPts = scoreHand(t.crib, t.cut, true);

  t.scores[nonDealer] += nonPts;
  t.scores[dealer] += dealPts + cribPts;

  pushLog(t, `SHOW: ${nonDealer} hand +${nonPts}`);
  pushLog(t, `SHOW: ${dealer} hand +${dealPts}`);
  pushLog(t, `SHOW: Crib (dealer) +${cribPts}`);

  t.stage = "show";
}

/** -------------------------
 *  Socket.IO
 *  ------------------------- */

io.on("connection", (socket) => {
  socket.on("join_table", ({ tableId, name }) => {
    tableId = (tableId || "JIM1").toString().trim().slice(0, 24);
    const t = ensureTable(tableId);

    let me = null;
    if (!t.players.PLAYER1) me = "PLAYER1";
    else if (!t.players.PLAYER2) me = "PLAYER2";
    else {
      socket.emit("error_msg", "Table is full (2 players). Use a different table name.");
      return;
    }

    t.players[me] = socket.id;
    t.names[me] = (name || me).toString().trim().slice(0, 16) || me;

    socket.tableId = tableId;
    socket.playerId = me;

    pushLog(t, `${t.names[me]} joined as ${me}.`);
    socket.emit("hello", { msg: `Ahoy! Pirate Cribbage server is alive.` });

    emitState(tableId);

    if (t.players.PLAYER1 && t.players.PLAYER2 && t.stage === "lobby") {
      startHand(t);
      emitState(tableId);
    }
  });

  socket.on("discard_to_crib", ({ cardIds }) => {
    const t = tables[socket.tableId];
    if (!t || t.stage !== "discard") return;

    const me = socket.playerId;
    if (!me) return;

    const ids = Array.isArray(cardIds) ? cardIds : [];
    if (ids.length !== 2) return;

    const hand = t.hands[me];
    const chosen = [];
    for (const id of ids) {
      const idx = hand.findIndex(c => c.id === id);
      if (idx === -1) return;
      chosen.push(hand[idx]);
    }

    // remove from BOTH (they are equivalent in discard stage)
    t.hands[me] = t.hands[me].filter(c => !ids.includes(c.id));
    t.pegHands[me] = t.pegHands[me].filter(c => !ids.includes(c.id));

    t.discards[me] = chosen;
    t.crib.push(...chosen);

    pushLog(t, `${me} discards 2 to crib.`);

    const p1Done = t.discards.PLAYER1.length === 2;
    const p2Done = t.discards.PLAYER2.length === 2;

    if (p1Done && p2Done && t.crib.length === 4) {
      // at this moment, t.hands are 4-card show hands
      enterPegging(t);
    }

    emitState(socket.tableId);
  });

  socket.on("play_card", ({ cardId }) => {
    const t = tables[socket.tableId];
    if (!t || t.stage !== "pegging") return;

    const me = socket.playerId;
    if (!me || t.turn !== me) return;

    const hand = t.pegHands[me];
    const idx = hand.findIndex(c => c.id === cardId);
    if (idx === -1) return;

    const card = hand[idx];
    const val = cardValue(card.rank);
    if (t.peg.count + val > 31) return;

    // play from pegHands ONLY
    hand.splice(idx, 1);
    t.pegHands[me] = hand;

    t.peg.count += val;
    t.peg.pile.push(card);
    t.peg.lastPlayer = me;
    t.peg.go.PLAYER1 = false;
    t.peg.go.PLAYER2 = false;

    pushLog(t, `${me} plays ${card.rank}${card.suit}. Count=${t.peg.count}`);

    const pts = pegPointsAfterPlay(t, me, card);
    if (pts) t.scores[me] += pts;

    if (t.peg.count === 31) {
      resetPegCount(t);
      t.turn = otherPlayer(me);
      pushLog(t, `${t.turn} to play.`);
    } else {
      t.turn = otherPlayer(me);
    }

    // End of pegging when BOTH pegHands empty
    if (t.pegHands.PLAYER1.length === 0 && t.pegHands.PLAYER2.length === 0) {
      awardLastCardIfNeeded(t);
      scoreShowAndAdvance(t);
    }

    emitState(socket.tableId);
  });

  socket.on("go", () => {
    const t = tables[socket.tableId];
    if (!t || t.stage !== "pegging") return;

    const me = socket.playerId;
    if (!me || t.turn !== me) return;

    // GO only if you truly cannot play from pegHands
    if (canPlayAny(t.pegHands[me], t.peg.count)) return;

    t.peg.go[me] = true;
    pushLog(t, `${me} says GO.`);

    const other = otherPlayer(me);

    if (canPlayAny(t.pegHands[other], t.peg.count)) {
      t.turn = other;
      pushLog(t, `${other} to play.`);
      emitState(socket.tableId);
      return;
    }

    // Both cannot play -> award last, reset
    awardLastCardIfNeeded(t);
    resetPegCount(t);

    // after reset, the player who played last leads; fallback non-dealer
    const leader = t.peg.lastPlayer || otherPlayer(t.dealer);
    t.turn = leader;
    pushLog(t, `${t.turn} to play.`);

    if (t.pegHands.PLAYER1.length === 0 && t.pegHands.PLAYER2.length === 0) {
      scoreShowAndAdvance(t);
    }

    emitState(socket.tableId);
  });

  socket.on("next_hand", () => {
    const t = tables[socket.tableId];
    if (!t || t.stage !== "show") return;

    t.dealer = otherPlayer(t.dealer);

    if (t.players.PLAYER1 && t.players.PLAYER2) {
      startHand(t);
      emitState(socket.tableId);
    }
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
