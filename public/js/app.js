const socket = io();
const el = id => document.getElementById(id);

let state = null;
let selected = new Set();

socket.on("state", s => {
  state = s;
  render();
});

function render() {
  if (!state) return;

  el("tableLine").textContent = `Table: ${state.tableId}`;
  el("meLine").textContent = `You: ${state.names[state.me]}`;
  el("playersLine").textContent =
    `Players: ${state.names.PLAYER1 || "—"} vs ${state.names.PLAYER2 || "—"}`;
  el("scoreLine").textContent =
    `${state.names.PLAYER1}: ${state.scores.PLAYER1} • ${state.names.PLAYER2}: ${state.scores.PLAYER2}`;

  const hand = state.myHand || [];
  const handArea = el("handArea");
  handArea.innerHTML = "";

  if (state.stage === "discard") {
    el("handHelp").textContent = `Select 2 cards for ${state.names[state.dealer]}'s crib`;
    hand.forEach(c => {
      const b = document.createElement("button");
      b.textContent = `${c.rank}${c.suit}`;
      if (selected.has(c.id)) b.classList.add("selected");
      b.onclick = () => {
        selected.has(c.id) ? selected.delete(c.id) : selected.add(c.id);
        if (selected.size === 2) {
          socket.emit("discard_to_crib", { cardIds: [...selected] });
          selected.clear();
        }
        render();
      };
      handArea.appendChild(b);
    });
  }

  if (state.stage === "pegging") {
    el("handHelp").textContent = state.turn === state.me
      ? "Your turn"
      : "Opponent's turn";

    hand.forEach(c => {
      const b = document.createElement("button");
      b.textContent = `${c.rank}${c.suit}`;
      b.disabled = state.turn !== state.me;
      b.onclick = () => socket.emit("play_card", { cardId: c.id });
      handArea.appendChild(b);
    });
  }

  if (state.gameOver) {
    el("handHelp").textContent = `${state.names[state.winner]} wins!`;
  }
}
