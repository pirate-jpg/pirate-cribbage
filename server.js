// Pirate Cribbage - working 2P game (Railway)
// npm start -> node server.js

const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (req, res) => res.send("ok"));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

const PORT = process.env.PORT || 8080;

/** -----------------------
 *  Game State (in-memory)
 *  ----------------------*/
const rooms = new Map();
// roomCode -> {
//   players: [{id, name}],
//   dealerIndex: 0/1,
//   deck: [], hands: {socketId: [card,...]}, discards: {socketId:[card,...]},
//   crib: [], starter: null,
//   stage: "lobby"|"dealt"|"discarding"|"reveal",
//   scores: {socketId:number}
// }

function getRoom(code) {
  if (!rooms.has(code)) {
    rooms.set(code, {
      players: [],
      dealerIndex: 0,
      deck: [],
      hands: {},
      discards: {},
      crib: [],
      starter: null,
      stage: "lobby",
      scores: {},
    });
  }
  return rooms.get(code);
}

/** -----------------------
 *  Cards + Scoring
 *  ----------------------*/
const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];

function card(rank, suit) {
  return { rank, suit, id: `${rank}${suit}` };
}
function makeDeck() {
  const d = [];
  for (const s of SUITS) for (const r of RANKS) d.push(card(r, s));
  return d;
}
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function rankValue15(r) {
  if (r === "A") return 1;
  if (["J","Q","K"].includes(r)) return 10;
  return parseInt(r, 10);
}
function rankOrder(r) {
  if (r === "A") return 1;
  if (r === "J") return 11;
  if (r === "Q") return 12;
  if (r === "K") return 13;
  return parseInt(r, 10);
}

// Score a 4-card hand + starter. isCrib affects flush rules.
function scoreHand(hand4, starter, isCrib = false) {
  const all = [...hand4, starter];
  let points = 0;

  // 15s: all combos that sum to 15 = 2 pts each
  for (let mask = 1; mask < (1 << all.length); mask++) {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < all.length; i++) {
      if (mask & (1 << i)) {
        sum += rankValue15(all[i].rank);
        count++;
      }
    }
    if (count >= 2 && sum === 15) points += 2;
  }

  // pairs: each pair = 2
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      if (all[i].rank === all[j].rank) points += 2;
    }
  }

  // runs: find all run combos length>=3; score only longest runs with multiplicity
  // Approach: enumerate combos, keep maxLen, count multiplicity
  let maxLen = 0;
  let runCount = 0;
  for (let mask = 1; mask < (1 << all.length); mask++) {
    const subset = [];
    for (let i = 0; i < all.length; i++) if (mask & (1 << i)) subset.push(all[i]);
    if (subset.length < 3) continue;
    const vals = subset.map(c => rankOrder(c.rank)).sort((a,b)=>a-b);
    // must be strictly consecutive and no duplicates
    let ok = true;
    for (let i = 1; i < vals.length; i++) {
      if (vals[i] === vals[i-1]) { ok = false; break; }
      if (vals[i] !== vals[i-1] + 1) { ok = false; break; }
    }
    if (!ok) continue;
    if (subset.length > maxLen) {
      maxLen = subset.length;
      runCount = 1;
    } else if (subset.length === maxLen) {
      runCount++;
    }
  }
  if (maxLen >= 3) points += maxLen * runCount;

  // flush:
  const suits4 = hand4.map(c => c.suit);
  const allSame4 = suits4.every(s => s === suits4[0]);
  if (allSame4) {
    if (starter.suit === suits4[0]) points += 5;
    else if (!isCrib) points += 4; // crib needs 5-card flush
  }

  // knobs: jack in hand matching starter suit = 1
  if (hand4.some(c => c.rank === "J" && c.suit === starter.suit)) points += 1;

  return points;
}

/** -----------------------
 *  Room helpers
 *  ----------------------*/
function publicRoomState(room) {
  // Hide other player's hand contents
  const players = room.players.map(p => ({ id: p.id, name: p.name }));
  return {
    players,
    dealerId: room.players[room.dealerIndex]?.id || null,
    stage: room.stage,
    starter: room.starter,
    cribCount: room.crib.length,
    scores: room.scores,
  };
}

function emitRoom(code) {
  const room = getRoom(code);
  io.to(code).emit("room:update", publicRoomState(room));
}

function dealNewHand(code) {
  const room = getRoom(code);
  if (room.players.length !== 2) return;

  room.deck = shuffle(makeDeck());
  room.hands = {};
  room.discards = {};
  room.crib = [];
  room.starter = null;
  room.stage = "dealt";

  for (const p of room.players) {
    room.hands[p.id] = room.deck.splice(0, 6);
    room.discards[p.id] = [];
    if (room.scores[p.id] == null) room.scores[p.id] = 0;
    io.to(p.id).emit("hand:dealt", room.hands[p.id]);
  }

  room.stage = "discarding";
  emitRoom(code);
}

function tryReveal(code) {
  const room = getRoom(code);
  if (room.players.length !== 2) return;
  const [p1, p2] = room.players;
  if (room.discards[p1.id].length !== 2) return;
  if (room.discards[p2.id].length !== 2) return;

  // build crib
  room.crib = [...room.discards[p1.id], ...room.discards[p2.id]];
  // flip starter
  room.starter = room.deck.splice(0, 1)[0];
  room.stage = "reveal";

  // score
  const dealerId = room.players[room.dealerIndex].id;
  const nonDealerId = room.players[1 - room.dealerIndex].id;

  const dealerHand4 = room.hands[dealerId];
  const nonDealerHand4 = room.hands[nonDealerId];

  const dealerPts = scoreHand(dealerHand4, room.starter, false);
  const nonDealerPts = scoreHand(nonDealerHand4, room.starter, false);
  const cribPts = scoreHand(room.crib, room.starter, true);

  room.scores[dealerId] += dealerPts + cribPts;
  room.scores[nonDealerId] += nonDealerPts;

  io.to(code).emit("hand:reveal", {
    starter: room.starter,
    dealerId,
    hands: {
      [dealerId]: dealerHand4,
      [nonDealerId]: nonDealerHand4,
    },
    crib: room.crib,
    points: {
      [dealerId]: dealerPts,
      [nonDealerId]: nonDealerPts,
      crib: cribPts,
    },
    scores: room.scores,
  });

  emitRoom(code);
}

/** -----------------------
 *  Socket.IO
 *  ----------------------*/
io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  socket.emit("hello", { msg: "🏴‍☠️ Ahoy! Pirate Cribbage server is alive." });

  socket.on("room:join", ({ code, name }) => {
    const roomCode = String(code || "").trim().toUpperCase();
    const playerName = String(name || "Pirate").trim().slice(0, 20);

    if (!roomCode) return socket.emit("err", "Enter a table code.");

    const room = getRoom(roomCode);

    if (room.players.length >= 2 && !room.players.find(p => p.id === socket.id)) {
      return socket.emit("err", "That table already has 2 players.");
    }

    // join
    socket.join(roomCode);

    // upsert player
    if (!room.players.find(p => p.id === socket.id)) {
      room.players.push({ id: socket.id, name: playerName });
      room.scores[socket.id] = room.scores[socket.id] ?? 0;
    } else {
      room.players = room.players.map(p => p.id === socket.id ? ({...p, name: playerName}) : p);
    }

    socket.emit("room:joined", { code: roomCode, you: socket.id });
    emitRoom(roomCode);

    // auto-deal when 2 players
    if (room.players.length === 2 && room.stage === "lobby") {
      dealNewHand(roomCode);
    }
  });

  socket.on("hand:discard", ({ code, cardId }) => {
    const roomCode = String(code || "").trim().toUpperCase();
    const room = rooms.get(roomCode);
    if (!room) return;

    const hand = room.hands[socket.id];
    if (!hand) return;
    if (room.stage !== "discarding") return;

    const already = room.discards[socket.id] || [];
    if (already.length >= 2) return;

    const idx = hand.findIndex(c => c.id === cardId);
    if (idx === -1) return;

    const [c] = hand.splice(idx, 1);
    room.discards[socket.id].push(c);

    // send updated hand back to that player only
    io.to(socket.id).emit("hand:dealt", hand);

    // update room
    emitRoom(roomCode);

    // if both have 2 discards -> reveal
    tryReveal(roomCode);
  });

  socket.on("hand:next", ({ code }) => {
    const roomCode = String(code || "").trim().toUpperCase();
    const room = rooms.get(roomCode);
    if (!room) return;
    if (room.players.length !== 2) return;

    // alternate dealer
    room.dealerIndex = 1 - room.dealerIndex;
    dealNewHand(roomCode);
  });

  socket.on("ping", () => {
    socket.emit("pong", { msg: "🏴‍☠️ Pong!" });
  });

  socket.on("disconnect", () => {
    console.log("Socket disconnected:", socket.id);

    // remove from any room
    for (const [code, room] of rooms.entries()) {
      const before = room.players.length;
      room.players = room.players.filter(p => p.id !== socket.id);
      delete room.hands[socket.id];
      delete room.discards[socket.id];
      // keep score entry optional; leaving it is fine

      if (before !== room.players.length) {
        room.stage = "lobby";
        emitRoom(code);
      }
      if (room.players.length === 0) rooms.delete(code);
    }
  });
});

server.listen(PORT, () => console.log("Listening on", PORT));
