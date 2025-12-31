// Pirate Cribbage - discard -> pegging -> show -> next hand
// Enhancements:
// - pegging run scoring
// - auto-reset when opponent has 0 cards but count blocks remaining player (prevents stall)
// - game ends at 121 (no dealing past 121)
// - match wins tracking (first to 3)
// - crib owner tracked for UI ("Crib (PLAYER1)" / name)

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
      players: { PLAYER1: null, PLAYER2: null },
      names: { PLAYER1: "Pirate", PLAYER2: "PLAYER2" },

      dealer: "PLAYER1",
      stage: "lobby", // lobby | discard | pegging | show
      turn: "PLAYER1",

      deck: [],
      cut: null,
      crib: [],
      cribOwner: "PLAYER1",

      hands: { PLAYER1: [], PLAYER2: [] },     // preserved for show
      pegHands: { PLAYER1: [], PLAYER2: [] },  // consumed during pegging

      originalHands: { PLAYER1: [], PLAYER2: [] },
      discards: { PLAYER1: [], PLAYER2: [] },

      peg: {
        count: 0,
        pile: [], // card objects since last reset
        lastPlayer: null,
        go: { PLAYER1: false, PLAYER2: false }
      },

      scores: { PLAYER1: 0, PLAYER2: 0 },

      matchWins: { PLAYER1: 0, PLAYER2: 0 },
      matchTargetWins: MATCH_TARGET_WINS,

      gameOver: false,
      matchOver: false,
      gameWinner: null,

      show: null,
      lastPegEvent: null,

      log: []
    };
  }
  return tables[tableId];
}

function pushLog(t, msg) {
  t.log.push(msg);
  if (t.log.length > 160) t.log.shift();
}

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
    matchTargetWins: t.matchTargetWins,

    gameOver: t.gameOver,
    matchOver: t.matchOver,
    gameWinner: t.gameWinner,

    cribOwner: t.cribOwner,

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

function checkGameOver(t) {
  if (t.gameOver) return true;
  const p1 = t.scores.PLAYER1;
  const p2 = t.scores.PLAYER2;

  if (p1 >= GAME_TARGET || p2 >= GAME_TARGET) {
    t.gameOver = true;
    t.gameWinner = (p1 >= GAME_TARGET && p2 >= GAME_TARGET)
      ? (p1 >= p2 ? "PLAYER1" : "PLAYER2")
      : (p1 >= GAME_TARGET ? "PLAYER1" : "PLAYER2");

    t.matchWins[t.gameWinner] += 1;

    pushLog(t, `🏁 GAME OVER — ${t.gameWinner} wins this game.`);
    pushLog(t, `Match: P1=${t.matchWins.PLAYER1} • P2=${t.matchWins.PLAYER2}`);

    if (t.matchWins[t.gameWinner] >= t.matchTargetWins) {
      t.matchOver = true;
      pushLog(t, `🏴‍☠️ MATCH OVER — ${t.gameWinner} wins the match!`);
    }
    return true;
  }
  return false;
}

function startHand(t) {
  if (t.gameOver || t.matchOver) return;

  t.stage = "discard";
  t.deck = shuffle(newDeck());
  t.crib = [];
  t.cut = null;
  t.show = null;
  t.lastPegEvent = null;

  t.cribOwner = t.dealer;

  t.discards = { PLAYER1: [], PLAYER2: [] };
  t.peg = { count: 0, pile: [], lastPlayer: null, go: { PLAYER1:false, PLAYER2:false } };

  const p1 = t.deck.splice(0, 6);
  const p2 = t.deck.splice(0, 6);

  t.originalHands.PLAYER1 = [...p1];
  t.originalHands.PLAYER2 = [...p2];

  t.hands.PLAYER1 = [...p1];
  t.hands.PLAYER2 = [...p2];
  t.pegHands.PLAYER1 = [...p1];
  t.pegHands.PLAYER2 = [...p2];

  pushLog(t, `New hand. Dealer: ${t.dealer} (Crib: ${t.cribOwner})`);
}

function enterPegging(t) {
  t.stage = "pegging";
  t.cut = t.deck.splice(0, 1)[0];
  t.lastPegEvent = null;

  pushLog(t, `Cut: ${t.cut.rank}${t.cut.suit}`);

  t.pegHands.PLAYER1 = [...t.hands.PLAYER1];
  t.pegHands.PLAYER2 = [...t.hands.PLAYER2];

  t.turn = otherPlayer(t.dealer);
  t.peg = { count: 0, pile: [], lastPlayer: null, go: { PLAYER1:false, PLAYER2:false } };

  pushLog(t, `Pegging starts. ${t.turn} to play.`);
}

function canPlayAny(hand, count) {
  return hand.some(c => cardValue(c.rank) + count <= 31);
}

/** Pegging run scoring */
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

  let same = 1;
  for (let i = t.peg.pile.length - 2; i >= 0; i--) {
    if (t.peg.pile[i].rank === playedCard.rank) same++;
    else break;
  }
  if (same === 2) { pts += 2; reasons.push("pair for 2"); }
  else if (same === 3) { pts += 6; reasons.push("three of a kind for 6"); }
  else if (same === 4) { pts += 12; reasons.push("four of a kind for 12"); }

  const runPts = peggingRunPoints(t.peg.pile);
  if (runPts >= 3) { pts += runPts; reasons.push(`run of ${runPts} for ${runPts}`); }

  t.lastPegEvent = { player, pts, reasons };
  if (pts) pushLog(t, `${player} scores ${pts} pegging point(s) (${reasons.join(", ")}).`);
  return pts;
}

function awardLastCardIfNeeded(t) {
  if (t.peg.count !== 0 && t.peg.count !== 31 && t.peg.lastPlayer) {
    t.scores[t.peg.lastPlayer] += 1;
    t.lastPegEvent = { player: t.peg.lastPlayer, pts: 1, reasons: ["last card for 1"] };
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

/** SHOW scoring with breakdown (same as your working version) */
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
  for (const c of cards) byRank[c.rank
