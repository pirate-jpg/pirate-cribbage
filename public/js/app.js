const socket = io();

const el = (id) => document.getElementById(id);
const log = (msg) => { el("log").textContent += msg + "\n"; };

let ROOM = null;
let YOU = null;
let YOU_NAME = null;
let myHand = [];

socket.on("hello", (data) => log(data.msg));
socket.on("err", (m) => el("err").textContent = m);

socket.on("room:joined", ({ code, you }) => {
  ROOM = code;
  YOU = you;
  el("tableCode").textContent = ROOM;
  el("youName").textContent = YOU_NAME;
  el("joinPanel").classList.add("hidden");
  el("gamePanel").classList.remove("hidden");
  el("err").textContent = "";
  log(`Joined table ${ROOM}`);
});

socket.on("room:update", (state) => {
  if (!ROOM) return;

  const players = state.players.map(p => `${p.name}${p.id === state.dealerId ? " (dealer)" : ""}`).join(", ");
  el("roomState").textContent =
    `Players: ${players} | Stage: ${state.stage} | Crib cards: ${state.cribCount}`;

  // show scores if present
  const myScore = state.scores?.[YOU] ?? 0;
  el("discardNote").textContent = `Your score: ${myScore}`;
});

socket.on("hand:dealt", (hand) => {
  myHand = hand;
  renderHand();
  el("revealPanel").classList.add("hidden");
});

socket.on("hand:reveal", (data) => {
  el("revealPanel").classList.remove("hidden");

  el("starter").textContent = data.starter.id;

  // pretty output
  const names = {};
  // try to infer names from DOM roomState text? skip; just show IDs shortened
  const short = (id) => (id || "").slice(0, 6);

  const dealerId = data.dealerId;
  const otherId = Object.keys(data.hands).find(k => k !== dealerId);

  const handsTxt =
`Dealer (${short(dealerId)}):
${data.hands[dealerId].map(c=>c.id).join(" ")}

Non-dealer (${short(otherId)}):
${data.hands[otherId].map(c=>c.id).join(" ")}`;

  el("handsOut").textContent = handsTxt;
  el("cribOut").textContent = data.crib.map(c=>c.id).join(" ");

  const ptsTxt =
`Dealer hand: ${data.points[dealerId]} pts
Non-dealer hand: ${data.points[otherId]} pts
Crib (dealer): ${data.points.crib} pts`;

  el("pointsOut").textContent = ptsTxt;

  const scoresTxt =
`Dealer (${short(dealerId)}): ${data.scores[dealerId]}
Non-dealer (${short(otherId)}): ${data.scores[otherId]}`;

  el("scoresOut").textContent = scoresTxt;

  log("Hand scored. Click Next Hand to continue.");
});

function renderHand() {
  const handDiv = el("hand");
  handDiv.innerHTML = "";

  myHand.forEach((c) => {
    const b = document.createElement("button");
    b.className = "cardbtn";
    b.textContent = c.id;
    b.onclick = () => discard(c.id);
    handDiv.appendChild(b);
  });

  if (myHand.length === 6) el("discardNote").textContent = "Discard 2 cards to the crib.";
  if (myHand.length === 5) el("discardNote").textContent = "Discard 1 more card to the crib.";
  if (myHand.length === 4) el("discardNote").textContent = "Waiting for the other player…";
}

function discard(cardId) {
  if (!ROOM) return;
  socket.emit("hand:discard", { code: ROOM, cardId });
}

el("joinBtn").onclick = () => {
  const code = el("code").value.trim().toUpperCase();
  const name = el("name").value.trim() || "Pirate";
  YOU_NAME = name;
  el("err").textContent = "";
  socket.emit("room:join", { code, name });
};

el("pingBtn").onclick = () => {
  socket.emit("ping");
  log("Ping sent to server");
};
socket.on("pong", (data) => log(data.msg));

el("nextHandBtn").onclick = () => {
  socket.emit("hand:next", { code: ROOM });
  log("Next hand requested");
};
