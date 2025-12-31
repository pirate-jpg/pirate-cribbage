const socket = io();
const el = (id) => document.getElementById(id);

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
const nextGameBtn = el("nextGameBtn");
const newMatchBtn = el("newMatchBtn");
const logArea = el("logArea");

const showPanel = el("showPanel");
const cutLine = el("cutLine");
const ndTitle = el("ndTitle");
const dTitle = el("dTitle");
const cribTitle = el("cribTitle");
const ndCards = el("ndCards");
const dCards = el("dCards");
const cCards = el("cCards");
const ndBreak = el("ndBreak");
const dBreak = el("dBreak");
const cBreak = el("cBreak");
const ndTotal = el("ndTotal");
const dTotal = el("dTotal");
const cTotal = el("cTotal");

const pileArea = el("pileArea");
const countNum = el("countNum");
const peggingStatus = el("peggingStatus");
const lastScore = el("lastScore");

const p1Peg = el("p1Peg");
const p2Peg = el("p2Peg");
const p1Label = el("p1Label");
const p2Label = el("p2Label");
const ticks = el("ticks");

const p1Name = el("p1Name");
const p2Name = el("p2Name");
const p1Wins = el("p1Wins");
const p2Wins = el("p2Wins");

const qs = new URLSearchParams(location.search);
const tableId = (qs.get("table") || "JIM1").toString().trim();

// Prompt for name if not provided in URL
let name = (qs.get("name") || "").toString().trim().slice(0, 16);
if (!name) {
  const entered = (prompt("Enter your pirate name:", "") || "").toString().trim();
  name = entered.slice(0, 16);
  // optional: update the URL so refresh keeps it
  if (name) {
    qs.set("name", name);
    const newUrl = `${location.pathname}?${qs.toString()}`;
    history.replaceState(null, "", newUrl);
  }
}

let state = null;
let selectedForDiscard = new Set();

function suitClass(suit) {
  return (suit === "♥" || suit === "♦") ? "red" : "black";
}

function makeCardButton(card, opts = {}) {
  const btn = document.createElement("button");
  btn.className = `cardBtn ${suitClass(card.suit)}`;
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

  btn.appendChild(corner1);
  btn.appendChild(big);
  btn.appendChild(corner2);

  if (opts.onClick) btn.onclick = opts.onClick;
  return btn;
}

function cardValue(rank) {
  if (rank === "A") return 1;
  if (["K","Q","J"].includes(rank)) return 10;
  return parseInt(rank, 10);
}

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

function initTicks() {
  ticks.innerHTML = "";
  const marks = [0, 30, 60, 90, 121];
  for (const m of marks) {
    const span = document.createElement("span");
    span.textContent = m.toString();
    ticks.appendChild(span);
  }
}

function setPegPosition(pegEl, score) {
  const target = (state && state.gameTarget) ? state.gameTarget : 121;
  const s = clamp(score, 0, target);
  const pct = (s / target) * 100;
  pegEl.style.left = `${pct}%`;
}

function renderBoard() {
  if (!state) return;

  p1Label.textContent = state.players.PLAYER1 ? `P1 (${state.players.PLAYER1})` : "P1";
  p2Label.textContent = state.players.PLAYER2 ? `P2 (${state.players.PLAYER2})` : "P2";

  setPegPosition(p1Peg, state.scores.PLAYER1);
  setPegPosition(p2Peg, state.scores.PLAYER2);
}

function renderMatchPips() {
  if (!state) return;

  const p1 = state.players.PLAYER1 || "P1";
  const p2 = state.players.PLAYER2 || "P2";

  p1Name.textContent = `P1 (${p1})`;
  p2Name.textContent = `P2 (${p2})`;

  const goal = state.matchTargetWins || 3;
  const w1 = state.matchWins?.PLAYER1 ?? 0;
  const w2 = state.matchWins?.PLAYER2 ?? 0;

  p1Wins.innerHTML = "";
  p2Wins.innerHTML = "";

  for (let i=0;i<goal;i++){
    const a = document.createElement("div");
    a.className = "pip" + (i < w1 ? " on" : "");
    p1Wins.appendChild(a);

    const b = document.createElement("div");
    b.className = "pip" + (i < w2 ? " on" : "");
    p2Wins.appendChild(b);
  }
}

function renderPileAndHud() {
  if (!state) return;

  countNum.textContent = String(state.peg?.count ?? 0);

  pileArea.innerHTML = "";
  const pile = state.peg?.pile || [];
  const show = pile.length > 10 ? pile.slice(pile.length - 10) : pile;
  for (const c of show) {
    pileArea.appendChild(makeCardButton(c, { disabled: true }));
  }

  if (state.stage !== "pegging") {
    peggingStatus.textContent = "Pegging info appears during the pegging phase.";
    lastScore.classList.add("hidden");
    return;
  }

  const myTurn = state.turn === state.me;
  const mine = state.myHandCount;
  const opp = state.oppHandCount;

  peggingStatus.textContent =
    `${myTurn ? "Your turn" : "Opponent's turn"} • You have ${mine} card(s) • Opponent has ${opp} card(s).`;

  const ev = state.lastPegEvent;
  if (ev && ev.pts && ev.pts > 0) {
    const who = (ev.player === state.me) ? "You" : "Opponent";
    const reasonText = (ev.reasons || []).join(", ");
    lastScore.textContent = `${who} scored +${ev.pts} (${reasonText})`;
    lastScore.classList.remove("hidden");
  } else {
    lastScore.classList.add("hidden");
  }
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

function displayNameFor(playerId) {
  if (!state) return playerId;
  // state.players maps PLAYER1->name, PLAYER2->name
  return state.players?.[playerId] || playerId;
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

  ndTitle.textContent = `Non-dealer (${displayNameFor(nonDealer)})`;
  dTitle.textContent = `Dealer (${displayNameFor(dealer)})`;

  // ✅ Crib owner label
  if (cribTitle) cribTitle.textContent = `Crib (${displayNameFor(dealer)})`;

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
  dTotal.textContent = `Total: ${de.breakdown.total}`;
  cTotal.textContent = `Total: ${cr.breakdown.total}`;
}

function renderGameOver() {
  if (!state) return false;
  if (!state.gameOver && !state.matchOver) return false;

  showPanel.classList.add("hidden");
  handArea.innerHTML = "";

  const p1 = state.scores.PLAYER1;
  const p2 = state.scores.PLAYER2;

  if (state.matchOver) {
    const w = state.matchWinner;
    handTitle.textContent = "🏴‍☠️ Match Over!";
    handHelp.textContent = w ? `${displayNameFor(w)} wins the match. Final game: P1=${p1} • P2=${p2}` : `Match ended. Final game: P1=${p1} • P2=${p2}`;
    nextGameBtn.style.display = "none";
    nextHandBtn.style.display = "none";
    return true;
  }

  const w = state.winner;
  handTitle.textContent = "🏁 Game Over!";
  handHelp.textContent = w ? `${displayNameFor(w)} wins. Final score: P1=${p1} • P2=${p2}` : `Tie game. Final score: P1=${p1} • P2=${p2}`;

  nextGameBtn.style.display = "inline-block";
  nextGameBtn.onclick = () => socket.emit("next_game");

  nextHandBtn.style.display = "none";
  return true;
}

function render() {
  if (!state) return;

  tableLine.textContent = `Table: ${state.tableId}`;
  meLine.textContent = `You: ${state.me}`;

  const p1 = state.players.PLAYER1 ? state.players.PLAYER1 : "—";
  const p2 = state.players.PLAYER2 ? state.players.PLAYER2 : "—";
  playersLine.textContent = `Crew: P1=${p1} | P2=${p2}`;

  stageLine.textContent = `Stage: ${state.stage}`;
  dealerLine.textContent = `Dealer: ${displayNameFor(state.dealer)}`;
  turnLine.textContent = `Turn: ${displayNameFor(state.turn)}`;

  scoreLine.textContent = `P1 ${state.scores.PLAYER1}/${state.gameTarget || 121} • P2 ${state.scores.PLAYER2}/${state.gameTarget || 121}`;
  cribLine.textContent = `Crib: ${state.cribCount} | Discards: P1=${state.discardsCount.PLAYER1}/2 P2=${state.discardsCount.PLAYER2}/2`;

  logArea.textContent = (state.log || []).join("\n");

  initTicks();
  renderBoard();
  renderMatchPips();
  renderPileAndHud();
  renderShow();

  discardBtn.style.display = "none";
  goBtn.style.display = "none";
  nextHandBtn.style.display = "none";
  nextGameBtn.style.display = "none";
  discardBtn.disabled = true;

  if (newMatchBtn) newMatchBtn.onclick = () => socket.emit("new_match");

  if (renderGameOver()) return;

  if (state.stage === "lobby") {
    handTitle.textContent = "Waiting for crew…";
    handHelp.textContent = `Open another browser/incognito and join table "${state.tableId}".`;
    return;
  }

  if (state.stage === "discard") {
    showPanel.classList.add("hidden");
    handTitle.textContent = "Your Hand";
    handHelp.textContent = "Click 2 cards to discard to the crib.";

    handArea.innerHTML = "";
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
          render();
        }
      });
      handArea.appendChild(btn);
    });

    discardBtn.style.display = "inline-block";
    discardBtn.disabled = selectedForDiscard.size !== 2;
    discardBtn.onclick = () => {
      if (selectedForDiscard.size !== 2) return;
      socket.emit("discard_to_crib", { cardIds: Array.from(selectedForDiscard) });
      selectedForDiscard.clear();
      discardBtn.disabled = true;
    };
    return;
  }

  if (state.stage === "pegging") {
    showPanel.classList.add("hidden");
    handTitle.textContent = "Pegging";
    handHelp.textContent = "Play a card without exceeding 31. If you can’t play, press GO.";

    handArea.innerHTML = "";
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
    handHelp.textContent = "Scoring breakdown is shown below. Click Next Hand when ready.";

    nextHandBtn.style.display = "inline-block";
    nextHandBtn.onclick = () => socket.emit("next_hand");

    handArea.innerHTML = "";
    const myHand = state.myHand || [];
    myHand.forEach(card => handArea.appendChild(makeCardButton(card, { disabled: true })));
    if (state.cut) handArea.appendChild(makeCardButton(state.cut, { disabled: true }));
    return;
  }
}

socket.on("connect", () => {
  socket.emit("join_table", { tableId, name });
});

socket.on("state", (s) => {
  state = s;
  render();
});

socket.on("error_msg", (msg) => alert(msg));