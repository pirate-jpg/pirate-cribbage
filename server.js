const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const GAME_TARGET = 121;

const app = express();
app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_, res) => res.send("ok"));

const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Listening on", PORT));

const tables = {};

function newDeck() {
  const suits = ["♠","♥","♦","♣"];
  const ranks = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
  let id = 0;
  return suits.flatMap(s =>
    ranks.map(r => ({ id: `c${id++}`, rank: r, suit: s }))
  );
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function cardValue(r) {
  if (r === "A") return 1;
  if (["K","Q","J"].includes(r)) return 10;
  return Number(r);
}

function other(p) {
  return p === "PLAYER1" ? "PLAYER2" : "PLAYER1";
}

function ensureTable(id) {
  if (!tables[id]) {
    tables[id] = {
      id,
      players: { PLAYER1: null, PLAYER2: null },
      names: { PLAYER1: "PLAYER1", PLAYER2: "PLAYER2" },
      stage: "lobby",
      dealer: "PLAYER1",
      turn: "PLAYER1",
      deck: [],
      cut: null,
      crib: [],
      hands: { PLAYER1: [], PLAYER2: [] },
      pegHands: { PLAYER1: [], PLAYER2: [] },
      scores: { PLAYER1: 0, PLAYER2: 0 },
      peg: { count: 0, pile: [], lastPlayer: null, go: {} },
      gameOver: false,
      winner: null,
      log: []
    };
  }
  return tables[id];
}

function emitState(t) {
  ["PLAYER1","PLAYER2"].forEach(p => {
    const sid = t.players[p];
    if (sid) {
      io.to(sid).emit("state", {
        tableId: t.id,
        stage: t.stage,
        dealer: t.dealer,
        turn: t.turn,
        scores: t.scores,
        names: t.names,
        players: t.players,
        peg: t.peg,
        cut: t.cut,
        myHand: t.stage === "pegging" ? t.pegHands[p] : t.hands[p],
        me: p,
        gameOver: t.gameOver,
        winner: t.winner,
        log: t.log.slice(-6)
      });
    }
  });
}

function startHand(t) {
  t.stage = "discard";
  t.deck = shuffle(newDeck());
  t.crib = [];
  t.cut = null;
  t.peg = { count: 0, pile: [], lastPlayer: null, go: {} };

  const p1 = t.deck.splice(0,6);
  const p2 = t.deck.splice(0,6);

  t.hands.PLAYER1 = [...p1];
  t.hands.PLAYER2 = [...p2];
  t.pegHands.PLAYER1 = [...p1];
  t.pegHands.PLAYER2 = [...p2];
}

function checkGameEnd(t) {
  for (const p of ["PLAYER1","PLAYER2"]) {
    if (t.scores[p] >= GAME_TARGET) {
      t.gameOver = true;
      t.winner = p;
      t.stage = "show";
    }
  }
}

io.on("connection", socket => {

  socket.on("join_table", ({ tableId, name }) => {
    const t = ensureTable(tableId || "JIM1");
    let me = !t.players.PLAYER1 ? "PLAYER1" : !t.players.PLAYER2 ? "PLAYER2" : null;
    if (!me) return;

    t.players[me] = socket.id;
    t.names[me] = name || me;
    socket.tableId = t.id;
    socket.playerId = me;

    if (t.players.PLAYER1 && t.players.PLAYER2) {
      startHand(t);
    }
    emitState(t);
  });

  socket.on("discard_to_crib", ({ cardIds }) => {
    const t = tables[socket.tableId];
    const me = socket.playerId;
    if (!t || t.stage !== "discard") return;

    const chosen = t.hands[me].filter(c => cardIds.includes(c.id));
    if (chosen.length !== 2) return;

    t.hands[me] = t.hands[me].filter(c => !cardIds.includes(c.id));
    t.pegHands[me] = t.pegHands[me].filter(c => !cardIds.includes(c.id));
    t.crib.push(...chosen);

    if (t.crib.length === 4) {
      t.stage = "pegging";
      t.cut = t.deck.pop();
      t.turn = other(t.dealer);
    }
    emitState(t);
  });

  socket.on("play_card", ({ cardId }) => {
    const t = tables[socket.tableId];
    const me = socket.playerId;
    if (!t || t.turn !== me || t.stage !== "pegging") return;

    const hand = t.pegHands[me];
    const card = hand.find(c => c.id === cardId);
    if (!card) return;

    const v = cardValue(card.rank);
    if (t.peg.count + v > 31) return;

    t.peg.count += v;
    t.peg.pile.push(card);
    t.peg.lastPlayer = me;
    t.pegHands[me] = hand.filter(c => c.id !== cardId);
    t.turn = other(me);

    checkGameEnd(t);
    emitState(t);
  });

  socket.on("go", () => {
    const t = tables[socket.tableId];
    const me = socket.playerId;
    if (!t || t.stage !== "pegging") return;

    t.log.push(`${t.names[me]} says GO`);
    t.peg.count = 0;
    t.peg.pile = [];
    t.turn = other(me);
    emitState(t);
  });

  socket.on("disconnect", () => {
    const t = tables[socket.tableId];
    if (!t) return;
    for (const p of ["PLAYER1","PLAYER2"]) {
      if (t.players[p] === socket.id) t.players[p] = null;
    }
  });
});
