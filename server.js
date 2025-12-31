// Pirate Cribbage - full minimal working server (Express + Socket.IO) for Railway

const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => res.send("ok"));

const server = http.createServer(app);
const io = new Server(server, {
  // Railway is usually fine without special CORS when serving same origin
});

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
  for (const s of suits) {
    for (const r of ranks) {
      deck.push({ id: `c${id++}`, rank: r, suit: s });
    }
  }
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
      connectedCount: 0,

      dealer: "PLAYER1",
      stage: "lobby", // lobby | discard | pegging | show
      turn: "PLAYER1",

      // per-hand
      deck: [],
      cut: null,
      crib: [],
      hands: { PLAYER1: [], PLAYER2: [] },        // 4 after discard
      originalHands: { PLAYER1: [], PLAYER2: [] },// 6 dealt (for display if needed)

      peg: {
        count: 0,
        pile: [], // cards played since last reset (card objects)
        lastPlayer: null,
        go: { PLAYER1: false, PLAYER2: false }
      },

      scores: { PLAYER1: 0, PLAYER2: 0 },

      // discard tracking
      discards: { PLAYER1: [], PLAYER2: [] },

      log: []
    };
  }
  return tables[tableId];
}

function pushLog(t, msg) {
  t.log.push(msg);
  if (t.log.length > 100) t.log.shift();
}

function publicStateFor(table, me) {
  // send only my hand, but also send counts so UI can show something
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
    myHand: table.hands[me] || [],
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
  t.discards = { PLAYER1: [], PLAYER2: [] };
  t.peg = { count: 0, pile: [], lastPlayer: null, go: { PLAYER1:false, PLAYER2:false } };

  // deal 6 each
  const p1 = t.deck.splice(0, 6);
  const p2 = t.deck.splice(0, 6);
  t.originalHands.PLAYER1 = [...p1];
  t.originalHands.PLAYER2 = [...p2];

  // for now hands are 6 until they discard; we'll store them in originalHands and also in hands during discard
  t.hands.PLAYER1 = [...p1];
  t.hands.PLAYER2 = [...p2];

  // cut card after discards for scoring
  t.cut = null;

  // non-dealer discards first is not required; both can discard anytime in this UI
  // pegging turn set later when entering pegging
  pushLog(t, `New hand. Dealer: ${t.dealer}`);
}

function enterPegging(t) {
  t.stage = "pegging";

  // set cut card
  t.cut = t.deck.splice(0, 1)[0];
  pushLog(t, `Cut: ${t.cut.rank}${t.cut.suit}`);

  // non-dealer starts pegging
  t.turn = otherPlayer(t.dealer);

  // reset peg
  t.peg = { count: 0, pile: [], lastPlayer: null, go: { PLAYER1:false, PLAYER2:false } };

  pushLog(t, `Pegging starts. ${t.turn} to play.`);
}

function canPlayAny(hand, count) {
  return hand.some(c => cardValue(c.rank) + count <= 31);
}

function pegPointsAfterPlay(t, player, playedCard) {
  let pts = 0;

  if (t.peg.count === 15) pts += 2;
  if (t.peg.count === 31) pts += 2;

  // pairs based on most recent consecutive same ranks in pile
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
  // If the last sequence ended without 31, lastPlayer gets 1.
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
    const cs = combos(cards, k);
    for (const set of cs) {
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
  // Standard cribbage run scoring with duplicates.
  // Approach: count multiplicities of ranks 1..13 and compute runs of length 5..3
  const counts = Array(14).fill(0);
  for (const c of cards) counts[rankNum(c.rank)]++;

  // find all run segments
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

  // longest runs score, shorter runs ignored if longer exist
  for (let len=5; len>=3; len--) {
    const rc = runCount(len);
    if (rc > 0) return rc * len;
  }
  return 0;
}

function scoreFlush(hand4, cut, isCrib) {
  // In hand: 4-card flush = 4, +1 if cut matches suit => 5
  // In crib: must be 5-card flush => 5
  const suit = hand4[0].suit;
  const all4 = hand4.every(c => c.suit === suit);
  if (!all4) return 0;
  const cutMatches = cut && cut.suit === suit;

  if (isCrib) return cutMatches ? 5 : 0;
  return cutMatches ? 5 : 4;
}

function scoreNobs(hand4, cut) {
  // Jack in hand matching cut suit => 1
  if (!cut) return 0;
  return hand4.some(c => c.rank === "J" && c.suit === cut.suit) ? 1 : 0;
}

function scoreHand(hand4, cut, isCrib=false) {
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
  // Non-dealer scores first, then dealer, then crib (dealer)
  const nonDealer = otherPlayer(t.dealer);
  const dealer = t.dealer;

  const nonPts = scoreHand(t.hands[nonDealer], t.cut, false);
  const dealPts = scoreHand(t.hands[dealer], t.cut, false);
  const cribPts = scoreHand(t.crib, t.cut, true);

  t.scores[nonDealer] += nonPts;
  t.scores[dealer] += dealPts;
  t.scores[dealer] += cribPts;

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
      socket.emit("error_msg", "Table is full (2 players). Open a different tableId.");
      return;
    }

    t.players[me] = socket.id;
    t.names[me] = (name || me).toString().trim().slice(0, 16) || me;
    socket.join(tableId);
    socket.tableId = tableId;
    socket.playerId = me;

    pushLog(t, `${t.names[me]} joined as ${me}.`);
    socket.emit("hello", { msg: `Ahoy! Pirate Cribbage server is alive.` });
    emitState(tableId);

    // start if both connected and still in lobby
    if (t.players.PLAYER1 && t.players.PLAYER2 && t.stage === "lobby") {
      startHand(t);
      emitState(tableId);
    }
  });

  socket.on("discard_to_crib", ({ cardIds }) => {
    const tableId = socket.tableId;
    const t = tables[tableId];
    if (!t) return;
    if (t.stage !== "discard") return;

    const me = socket.playerId;
    if (!me) return;

    const ids = Array.isArray(cardIds) ? cardIds : [];
    if (ids.length !== 2) return;

    // ensure both cards are in current 6-card hand
    const hand = t.hands[me];
    const chosen = [];
    for (const id of ids) {
      const idx = hand.findIndex(c => c.id === id);
      if (idx === -1) return;
      chosen.push(hand[idx]);
    }

    // remove from hand
    t.hands[me] = hand.filter(c => !ids.includes(c.id));
    t.discards[me] = chosen;
    t.crib.push(...chosen);

    pushLog(t, `${me} discards 2 to crib.`);

    // After discard, hand should be 4 cards each
    const p1Done = t.discards.PLAYER1.length === 2;
    const p2Done = t.discards.PLAYER2.length === 2;

    if (p1Done && p2Done) {
      // Ensure crib is exactly 4 cards
      if (t.crib.length === 4) {
        enterPegging(t);
      }
    }

    emitState(tableId);
  });

  socket.on("play_card", ({ cardId }) => {
    const t = tables[socket.tableId];
    if (!t) return;
    if (t.stage !== "pegging") return;

    const me = socket.playerId;
    if (!me) return;
    if (t.turn !== me) return;

    const hand = t.hands[me];
    const idx = hand.findIndex(c => c.id === cardId);
    if (idx === -1) return;

    const card = hand[idx];
    const val = cardValue(card.rank);
    if (t.peg.count + val > 31) return; // illegal

    // play it
    hand.splice(idx, 1);
    t.hands[me] = hand;

    t.peg.count += val;
    t.peg.pile.push(card);
    t.peg.lastPlayer = me;
    t.peg.go.PLAYER1 = false;
    t.peg.go.PLAYER2 = false;

    pushLog(t, `${me} plays ${card.rank}${card.suit}. Count=${t.peg.count}`);

    const pts = pegPointsAfterPlay(t, me, card);
    if (pts) t.scores[me] += pts;

    if (t.peg.count === 31) {
      // After 31, reset and turn passes
      resetPegCount(t);
      t.turn = otherPlayer(me);
      pushLog(t, `${t.turn} to play.`);
    } else {
      // normal pass
      t.turn = otherPlayer(me);
    }

    // If both hands empty, go to show scoring
    if (t.hands.PLAYER1.length === 0 && t.hands.PLAYER2.length === 0) {
      // award last card if needed
      awardLastCardIfNeeded(t);
      scoreShowAndAdvance(t);
    }

    emitState(socket.tableId);
  });

  socket.on("go", () => {
    const t = tables[socket.tableId];
    if (!t) return;
    if (t.stage !== "pegging") return;

    const me = socket.playerId;
    if (!me) return;
    if (t.turn !== me) return;

    // only allow if truly cannot play
    if (canPlayAny(t.hands[me], t.peg.count)) return;

    t.peg.go[me] = true;
    pushLog(t, `${me} says GO.`);

    const other = otherPlayer(me);

    // if other can play, give them turn
    if (canPlayAny(t.hands[other], t.peg.count)) {
      t.turn = other;
      pushLog(t, `${other} to play.`);
      emitState(socket.tableId);
      return;
    }

    // Both cannot play -> award last card (unless 31 already handled), reset
    awardLastCardIfNeeded(t);
    resetPegCount(t);

    // After a reset, the player who played last leads. If nobody, non-dealer leads.
    const leader = t.peg.lastPlayer || otherPlayer(t.dealer);
    t.turn = leader;
    pushLog(t, `${t.turn} to play.`);

    // If both hands empty, show
    if (t.hands.PLAYER1.length === 0 && t.hands.PLAYER2.length === 0) {
      scoreShowAndAdvance(t);
    }

    emitState(socket.tableId);
  });

  socket.on("next_hand", () => {
    const t = tables[socket.tableId];
    if (!t) return;
    if (t.stage !== "show") return;

    // alternate dealer
    t.dealer = otherPlayer(t.dealer);

    // start new hand only if both still connected
    if (t.players.PLAYER1 && t.players.PLAYER2) {
      startHand(t);
      emitState(socket.tableId);
    }
  });

  socket.on("disconnect", () => {
    const tableId = socket.tableId;
    const t = tables[tableId];
    if (!t) return;

    const me = socket.playerId;
    if (me && t.players[me] === socket.id) {
      t.players[me] = null;
      pushLog(t, `${me} disconnected.`);
    }

    // if both gone, clean up eventually (optional)
    emitState(tableId);
  });
});
