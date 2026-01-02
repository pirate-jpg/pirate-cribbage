const socket = io();
const el = (id) => document.getElementById(id);

// Top chips
const tableLine = el("tableLine");
const meLine = el("meLine");

// Crew
const playersLine = el("playersLine");
const stageLine = el("stageLine");
const dealerLine = el("dealerLine");
const turnLine = el("turnLine");
const scoreLine = el("scoreLine");
const cribLine = el("cribLine");

// Play panel
const handTitle = el("handTitle");
const handHelp = el("handHelp");
const handArea = el("handArea");
const goBtn = el("goBtn");
const nextHandBtn = el("nextHandBtn");

// Pegging HUD
const pileArea = el("pileArea");
const countNum = el("countNum");
const peggingStatus = el("peggingStatus");

// Board
const p1Peg = el("p1Peg");
const p2Peg = el("p2Peg");
const p1Label = el("p1Label");
const p2Label = el("p2Label");
const ticks = el("ticks");

// Notice banner
const noticeBar = el("noticeBar");
const noticeText = el("noticeText");

// Show panel
const showPanel = el("showPanel");
const cutLine = el("cutLine");
const ndTitle = el("ndTitle");
const dTitle = el("dTitle");
const cTitle = el("cTitle");
const ndCards = el("ndCards");
const dCards = el("dCards");
const cCards = el("cCards");
const ndBreak = el("ndBreak");
const dBreak = el("dBreak");
const cBreak = el("cBreak");
const ndTotal = el("ndTotal");
const dTotal = el("dTotal");
const cTotal = el("cTotal");

// Join overlay
const joinOverlay = el("joinOverlay");
const nameInput = el("nameInput");
const tableInput = el("tableInput");
const aiCheck = el("aiCheck");
const nameJoinBtn = el("nameJoinBtn");

let state = null;
let joined = false;
let selectedForDiscard = new Set();
let lastNoticeSeq = 0;

function cardValue(rank) {
  if (rank === "A") return 1;
  if (["K","Q","J"].includes(rank)) return 10;
  return parseInt(rank, 10);
}

function suitClass(suit) {
  return (suit === "♥" || suit === "♦") ? "red" : "black";
}

function makeCardButton(card, opts = {}) {
  const btn = document.createElement("button");
  btn.className = `cardBtn ${suitClass(card.suit)}`;
  btn.type = "button";
  if (opts.selected) btn.classList.add("selected");
  if (opts.disabled) btn.disabled = true;

  const corner1 = document.createElement("div");
  corner1.className = "corner";
  corner1.textContent = card.rank;

  const big = document.createElement("div");
  big.className = "suitBig";
  big.textContent = card.suit;

  const corner2 = document.createElement("div");
  corner2.className = "corner bottom";
  corner2.textContent = card.rank;

  btn.append(corner1, big, corner2);

  if (opts.onClick) btn.addEventListener("click", opts.onClick, { passive: true });
  return btn;
}

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

function initTicksOnce() {
  if (!ticks) return;
  if (ticks.childElementCount > 0) return;
  [0, 30, 60, 90, 121].forEach(n => {
    const span = document.createElement("span");
    span.textContent = String(n);
    ticks.appendChild(span);
  });
}

function setPegPosition(pegEl, score) {
  const s = clamp(score, 0, 121);
  const pct = (s / 121) * 100;
  pegEl.style.left = `${pct}%`;
}

function renderBoard() {
  if (!state) return;
  const n1 = state.names?.PLAYER1 || "P1";
  const n2 = state.names?.PLAYER2 || "P2";

  p1Label.textContent = n1;
  p2Label.textContent = n2;

  setPegPosition(p1Peg, state.scores.PLAYER1);
  setPegPosition(p2Peg, state.scores.PLAYER2);
}

function renderPileAndHud() {
  if (!state) return;

  countNum.textContent = String(state.peg?.count ?? 0);

  pileArea.innerHTML = "";
  const pile = state.peg?.pile || [];
  const show = pile.length > 10 ? pile.slice(pile.length - 10) : pile;
  for (const c of show) pileArea.appendChild(makeCardButton(c, { disabled: true }));

  if (state.stage !== "pegging") {
    peggingStatus.textContent = "";
    return;
  }

  const myTurn = state.turn === state.me;
  const oppName = state.names[ state.me === "PLAYER1" ? "PLAYER2" : "PLAYER1" ] || "Opponent";
  const meName  = state.names[state.me] || "You";

  peggingStatus.textContent = myTurn
    ? `Your turn • You: ${state.myHandCount} card(s) • Opponent: ${state.oppHandCount} card(s)`
    : `${oppName}'s turn • You: ${state.myHandCount} card(s) • Opponent: ${state.oppHandCount} card(s)`;
}

function renderBreakdown(listEl, breakdown) {
  listEl.innerHTML = "";
  if (!breakdown || !breakdown.items || breakdown.items.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No points.";
    listEl.appendChild(li);
    return;
  }
  for (const item of breakdown.items) {
    const li = document.createElement("li");
    li.textContent = `${item.label} = ${item.pts}`;
    listEl.appendChild(li);
  }
}

function renderShow() {
  if (!state || state.stage !== "show" || !state.show) {
    showPanel.classList.add("hidden");
    return;
  }
  showPanel.classList.remove("hidden");

  const cut = state.show.cut;
  cutLine.textContent = `Cut: ${cut.rank}${cut.suit}`;

  const nonDealer = state.show.nonDealer;
  const dealer = state.show.dealer;

  const ndName = state.names[nonDealer] || nonDealer;
  const dName  = state.names[dealer] || dealer;

  ndTitle.textContent = `Non-dealer (${ndName})`;
  dTitle.textContent = `Dealer (${dName})`;
  cTitle.textContent = `Crib (${dName})`;

  ndCards.innerHTML = "";
  dCards.innerHTML = "";
  cCards.innerHTML = "";

  const nd = state.show.hand[nonDealer];
  const de = state.show.hand[dealer];
  const cr = state.show.crib;

  for (const c of nd.cards) ndCards.appendChild(makeCardButton(c, { disabled: true }));
  ndCards.appendChild(makeCardButton(cut, { disabled: true }));

  for (const c of de.cards) dCards.appendChild(makeCardButton(c, { disabled: true }));
  dCards.appendChild(makeCardButton(cut, { disabled: true }));

  for (const c of cr.cards) cCards.appendChild(makeCardButton(c, { disabled: true }));
  cCards.appendChild(makeCardButton(cut, { disabled: true }));

  renderBreakdown(ndBreak, nd.breakdown);
  renderBreakdown(dBreak, de.breakdown);
  renderBreakdown(cBreak, cr.breakdown);

  ndTotal.textContent = `Total: ${nd.breakdown.total}`;
  dTotal.textContent  = `Total: ${de.breakdown.total}`;
  cTotal.textContent  = `Total: ${cr.breakdown.total}`;
}

function renderNotice() {
  if (!state) return;

  // Only animate/show if noticeSeq advanced
  const seq = state.noticeSeq || 0;
  const msg = state.notice || "";

  if (!msg) {
    noticeBar.classList.add("hidden");
    return;
  }

  if (seq !== lastNoticeSeq) {
    lastNoticeSeq = seq;
    noticeText.textContent = msg;
    noticeBar.classList.remove("hidden");
    noticeBar.classList.add("pulse");
    setTimeout(() => noticeBar.classList.remove("pulse"), 600);
  } else {
    // keep it visible
    noticeText.textContent = msg;
    noticeBar.classList.remove("hidden");
  }
}

function render() {
  if (!state) return;

  const myName = state.names[state.me] || state.me;
  tableLine.textContent = `Table: ${state.tableId}`;
  meLine.textContent = `You: ${myName}`;

  const p1n = state.players.PLAYER1 ? (state.names.PLAYER1 || state.players.PLAYER1) : "—";
  const p2n = state.players.PLAYER2 ? (state.names.PLAYER2 || state.players.PLAYER2) : "—";
  playersLine.textContent = `Players: ${p1n} vs ${p2n}`;

  stageLine.textContent = `Stage: ${state.stage}`;
  dealerLine.textContent = `Dealer: ${state.names[state.dealer] || state.dealer}`;
  turnLine.textContent = `Turn: ${state.names[state.turn] || state.turn}`;

  // Score line uses names (not P1/P2)
  scoreLine.textContent = `${state.names.PLAYER1 || "P1"} ${state.scores.PLAYER1} • ${state.names.PLAYER2 || "P2"} ${state.scores.PLAYER2}`;

  // Crib owner line + discards
  const cribOwnerName = state.names[state.dealer] || state.dealer;
  cribLine.textContent =
    `Crib (${cribOwnerName}) • Discards: ${state.names.PLAYER1 || "P1"} ${state.discardsCount.PLAYER1}/2  ${state.names.PLAYER2 || "P2"} ${state.discardsCount.PLAYER2}/2`;

  initTicksOnce();
  renderBoard();
  renderPileAndHud();
  renderShow();
  renderNotice();

  // Reset buttons & content
  goBtn.style.display = "none";
  nextHandBtn.style.display = "none";
  handArea.innerHTML = "";

  // GAME OVER banner pinned
  if (state.gameOver && state.gameWinner) {
    const winnerName = state.names[state.gameWinner] || state.gameWinner;
    handTitle.textContent = "Game Over";
    handHelp.textContent = `${winnerName} wins. Refresh to start again (or add a New Game button later).`;
    return;
  }

  // STAGES
  if (state.stage === "lobby") {
    handTitle.textContent = "Waiting…";
    handHelp.textContent = state.isAI?.PLAYER2
      ? "AI opponent ready. Starting shortly…"
      : `Open the same table on another device to play 2-player: "${state.tableId}".`;
    showPanel.classList.add("hidden");
    return;
  }

  if (state.stage === "discard") {
    showPanel.classList.add("hidden");

    const cribOwnerName = state.names[state.dealer] || state.dealer;
    handTitle.textContent = "Discard";
    handHelp.textContent = `Select exactly 2 cards to send to ${cribOwnerName}'s crib.`;

    const myHand = state.myHand || [];

    myHand.forEach(card => {
      const selected = selectedForDiscard.has(card.id);
      const btn = makeCardButton(card, {
        selected,
        onClick: () => {
          // Toggle selection
          if (selected) selectedForDiscard.delete(card.id);
          else {
            if (selectedForDiscard.size >= 2) return;
            selectedForDiscard.add(card.id);
          }

          // Auto-send once 2 selected
          if (selectedForDiscard.size === 2) {
            socket.emit("discard_to_crib", { cardIds: Array.from(selectedForDiscard) });
            selectedForDiscard.clear();
          }

          render();
        }
      });
      handArea.appendChild(btn);
    });

    return;
  }

  if (state.stage === "pegging") {
    showPanel.classList.add("hidden");
    handTitle.textContent = "Pegging";
    handHelp.textContent = "Play a card without exceeding 31. If you can’t play, press GO.";

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

    const canPlay = myHand.some(c => count + cardValue(c.rank) <= 31);
    if (myTurn && myHand.length > 0 && !canPlay) {
      goBtn.style.display = "inline-block";
      goBtn.onclick = () => socket.emit("go");
    }
    return;
  }

  if (state.stage === "show") {
    handTitle.textContent = "Show";
    handHelp.textContent = "Review scoring. Click Next Hand when ready.";

    nextHandBtn.style.display = "inline-block";
    nextHandBtn.onclick = () => socket.emit("next_hand");

    const myHand = state.myHand || [];
    myHand.forEach(card => handArea.appendChild(makeCardButton(card, { disabled: true })));
    if (state.cut) handArea.appendChild(makeCardButton(state.cut, { disabled: true }));
    return;
  }
}

// JOIN FLOW
function doJoin() {
  const name = (nameInput.value || "").trim().slice(0, 16);
  const tableId = (tableInput.value || "").trim().slice(0, 24) || "JIM1";
  const ai = !!aiCheck?.checked;

  if (!name) { alert("Enter a name."); return; }

  socket.emit("join_table", { tableId, name, ai });
  joined = true;
  joinOverlay.style.display = "none";
}

// Defaults
(function initJoinDefaults(){
  const qs = new URLSearchParams(location.search);
  const table = (qs.get("table") || "JIM1").toString().trim().slice(0, 24);
  const name = (qs.get("name") || "").toString().trim().slice(0, 16);
  const ai = (qs.get("ai") || "").toString().toLowerCase() === "1";
  tableInput.value = table;
  if (name) nameInput.value = name;
  if (aiCheck) aiCheck.checked = ai;
})();

nameJoinBtn.onclick = doJoin;
nameInput.addEventListener("keydown", (e)=>{ if (e.key === "Enter") doJoin(); });
tableInput.addEventListener("keydown", (e)=>{ if (e.key === "Enter") doJoin(); });

socket.on("state", (s) => {
  state = s;
  render();
});

socket.on("error_msg", (msg) => alert(msg));
