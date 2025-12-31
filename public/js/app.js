const socket = io();

const qs = new URLSearchParams(location.search);
const tableId = (qs.get("table") || "JIM1").toString();
const name = (qs.get("name") || "").toString();

const el = (id) => document.getElementById(id);

const tableLine = el("tableLine");
const meLine = el("meLine");
const playersLine = el("playersLine");
const stageLine = el("stageLine");
const dealerLine = el("dealerLine");
const turnLine = el("turnLine");
const scoreLine = el("scoreLine");
const pegLine = el("pegLine");
const cribLine = el("cribLine");

const handTitle = el("handTitle");
const handHelp = el("handHelp");
const handArea = el("handArea");

const discardBtn = el("discardBtn");
const goBtn = el("goBtn");
const nextHandBtn = el("nextHandBtn");

const logArea = el("logArea");

let state = null;
let me = null;
let selectedForDiscard = new Set();

function cardValue(rank) {
  if (rank === "A") return 1;
  if (["K","Q","J"].includes(rank)) return 10;
  return parseInt(rank, 10);
}

function render() {
  if (!state) return;

  tableLine.textContent = `Table: ${state.tableId}`;
  meLine.textContent = `You: ${state.me}`;

  const p1 = state.players.PLAYER1 ? state.players.PLAYER1 : "—";
  const p2 = state.players.PLAYER2 ? state.players.PLAYER2 : "—";
  playersLine.textContent = `Players: P1=${p1} | P2=${p2}`;

  stageLine.textContent = `Stage: ${state.stage}`;
  dealerLine.textContent = `Dealer: ${state.dealer}`;
  turnLine.textContent = `Turn: ${state.turn}`;
  scoreLine.textContent = `Score: P1=${state.scores.PLAYER1} | P2=${state.scores.PLAYER2}`;

  pegLine.textContent = `Peg Count: ${state.peg.count} | Pile: ${state.peg.pile.map(c => `${c.rank}${c.suit}`).join(" ")}`;
  cribLine.textContent = `Crib cards: ${state.cribCount} | Discards: P1=${state.discardsCount.PLAYER1}/2 P2=${state.discardsCount.PLAYER2}/2`;

  logArea.textContent = (state.log || []).join("\n");

  // stage-specific UI
  discardBtn.style.display = "none";
  goBtn.style.display = "none";
  nextHandBtn.style.display = "none";
  discardBtn.disabled = true;

  handArea.innerHTML = "";

  if (state.stage === "lobby") {
    handTitle.textContent = "Waiting for players…";
    handHelp.textContent = "Open this same URL in another window/incognito to join as PLAYER2.";
    return;
  }

  if (state.stage === "discard") {
    handTitle.textContent = "Your Hand";
    handHelp.textContent = "Click 2 cards to discard to the crib.";

    renderDiscardHand();
    discardBtn.style.display = "inline-block";
    discardBtn.disabled = selectedForDiscard.size !== 2;
    return;
  }

  if (state.stage === "pegging") {
    handTitle.textContent = "Pegging";
    handHelp.textContent = "Play a card without exceeding 31. If you can't play, press GO.";

    renderPeggingHand();
    return;
  }

  if (state.stage === "show") {
    handTitle.textContent = "Show / Scoring";
    handHelp.textContent = `Cut card: ${state.cut ? state.cut.rank + state.cut.suit : "—"}  •  Click Next Hand to deal again.`;
    renderShowHand();
    nextHandBtn.style.display = "inline-block";
    nextHandBtn.onclick = () => socket.emit("next_hand");
    return;
  }
}

function makeCardButton(card, opts = {}) {
  const btn = document.createElement("button");
  btn.className = "cardBtn";
  btn.textContent = `${card.rank}${card.suit}`;
  if (opts.selected) btn.classList.add("selected");
  if (opts.disabled) btn.disabled = true;
  if (opts.onClick) btn.onclick = opts.onClick;
  return btn;
}

function renderDiscardHand() {
  // In discard stage, state.myHand is still 6 until you discard
  const myHand = state.myHand || [];

  myHand.forEach(card => {
    const selected = selectedForDiscard.has(card.id);
    const btn = makeCardButton(card, {
      selected,
      onClick: () => {
        if (selected) selectedForDiscard.delete(card.id);
        else {
          if (selectedForDiscard.size >= 2) return;
          selectedForDiscard.add(card.id);
        }
        discardBtn.disabled = selectedForDiscard.size !== 2;
        render(); // refresh selection visuals
      }
    });
    handArea.appendChild(btn);
  });

  discardBtn.onclick = () => {
    if (selectedForDiscard.size !== 2) return;
    socket.emit("discard_to_crib", { cardIds: Array.from(selectedForDiscard) });
    selectedForDiscard.clear();
    discardBtn.disabled = true;
  };
}

function renderPeggingHand() {
  const myTurn = state.turn === state.me;
  const myHand = state.myHand || [];
  const count = state.peg.count;

  myHand.forEach(card => {
    const playable = myTurn && (count + cardValue(card.rank) <= 31);
    const btn = makeCardButton(card, {
      disabled: !playable,
      onClick: () => socket.emit("play_card", { cardId: card.id })
    });
    handArea.appendChild(btn);
  });

  const canPlay = myHand.some(c => (count + cardValue(c.rank) <= 31));
  if (myTurn && !canPlay) {
    goBtn.style.display = "inline-block";
    goBtn.onclick = () => socket.emit("go");
  }
}

function renderShowHand() {
  // show your 4-card hand
  const myHand = state.myHand || [];
  myHand.forEach(card => {
    const btn = makeCardButton(card, { disabled: true });
    handArea.appendChild(btn);
  });

  // also show cut card as disabled
  if (state.cut) {
    const cutBtn = makeCardButton(state.cut, { disabled: true });
    cutBtn.style.opacity = "0.9";
    handArea.appendChild(cutBtn);
  }
}

socket.on("connect", () => {
  // If user didn't provide a name param, set a friendly default (doesn't matter)
  socket.emit("join_table", { tableId, name });
});

socket.on("hello", (data) => {
  // optional; state log already shows stuff
});

socket.on("state", (s) => {
  state = s;
  me = s.me;
  render();
});

socket.on("error_msg", (msg) => alert(msg));
