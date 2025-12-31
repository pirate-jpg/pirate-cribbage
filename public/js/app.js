let socket = null;
let state = null;
let joined = false;

const el = (id) => document.getElementById(id);

// Join screen
const joinScreen = el("joinScreen");
const gameScreen = el("gameScreen");
const nameInput = el("nameInput");
const nameJoinBtn = el("nameJoinBtn");

// Game UI
const tableLine = el("tableLine");
const meLine = el("meLine");
const playersLine = el("playersLine");
const stageLine = el("stageLine");
const dealerLine = el("dealerLine");
const turnLine = el("turnLine");
const scoreLine = el("scoreLine");
const cribLine = el("cribLine");

const handTitle = el("handTitle");
const handHelp = el("handHelp");
const handArea = el("handArea");

const discardBtn = el("discardBtn");
const goBtn = el("goBtn");
const nextHandBtn = el("nextHandBtn");

const pileArea = el("pileArea");
const countNum = el("countNum");
const peggingStatus = el("peggingStatus");
const lastScore = el("lastScore");
const logArea = el("logArea");

const qs = new URLSearchParams(location.search);
const tableId = (qs.get("table") || "JIM1").trim();

function connectAndJoin() {
  if (joined) return;

  const name = (nameInput.value || "").trim().slice(0, 16);
  if (!name) {
    alert("Enter a pirate name first.");
    return;
  }

  socket = io();

  socket.on("connect", () => {
    socket.emit("join_table", { tableId, name });
    joined = true;

    joinScreen.classList.add("hidden");
    gameScreen.classList.remove("hidden");
  });

  socket.on("state", (s) => {
    state = s;
    render();
  });

  socket.on("error_msg", (msg) => alert(msg));
}

nameJoinBtn.addEventListener("click", connectAndJoin);

function render() {
  if (!state) return;

  tableLine.textContent = `Table: ${state.tableId}`;
  meLine.textContent = `You: ${state.me}`;
  playersLine.textContent =
    `Players: P1=${state.players.PLAYER1 || "—"} | P2=${state.players.PLAYER2 || "—"}`;

  stageLine.textContent = `Stage: ${state.stage}`;
  dealerLine.textContent = `Dealer: ${state.dealer}`;
  turnLine.textContent = `Turn: ${state.turn}`;

  scoreLine.textContent =
    `Score: P1 ${state.scores.PLAYER1} • P2 ${state.scores.PLAYER2}`;

  cribLine.textContent = `Crib cards: ${state.cribCount}`;

  countNum.textContent = state.peg?.count ?? 0;

  peggingStatus.textContent =
    state.stage === "pegging"
      ? `${state.turn === state.me ? "Your turn" : "Opponent’s turn"}`
      : "";

  lastScore.textContent = state.lastPegEvent
    ? `${state.lastPegEvent.player} scored ${state.lastPegEvent.pts}`
    : "";

  logArea.textContent = (state.log || []).join("\n");

  handArea.innerHTML = "";
  pileArea.innerHTML = "";

  (state.peg?.pile || []).forEach(c => {
    const d = document.createElement("div");
    d.textContent = `${c.rank}${c.suit}`;
    pileArea.appendChild(d);
  });

  (state.myHand || []).forEach(card => {
    const btn = document.createElement("button");
    btn.textContent = `${card.rank}${card.suit}`;
    btn.disabled =
      state.stage !== "pegging" ||
      state.turn !== state.me ||
      state.peg.count + cardValue(card.rank) > 31;

    btn.onclick = () =>
      socket.emit("play_card", { cardId: card.id });

    handArea.appendChild(btn);
  });

  discardBtn.style.display = "none";
  goBtn.style.display = "none";
  nextHandBtn.style.display = "none";

  if (state.stage === "discard") {
    handTitle.textContent = "Discard";
    handHelp.textContent = "Select 2 cards (logic handled server-side)";
    discardBtn.style.display = "inline-block";
  }

  if (state.stage === "pegging") {
    handTitle.textContent = "Pegging";
    handHelp.textContent = "Play a card or GO";
    goBtn.style.display = "inline-block";
    goBtn.onclick = () => socket.emit("go");
  }

  if (state.stage === "show") {
    handTitle.textContent = "Show";
    nextHandBtn.style.display = "inline-block";
    nextHandBtn.onclick = () => socket.emit("next_hand");
  }
}

function cardValue(rank) {
  if (rank === "A") return 1;
  if (["K","Q","J"].includes(rank)) return 10;
  return parseInt(rank, 10);
}
