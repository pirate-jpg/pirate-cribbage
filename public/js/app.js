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

const matchP1Name = el("matchP1Name");
const matchP2Name = el("matchP2Name");
const matchP1Pips = el("matchP1Pips");
const matchP2Pips = el("matchP2Pips");

const handTitle = el("handTitle");
const handHelp = el("handHelp");
const handArea = el("handArea");

const discardBtn = el("discardBtn");
const goBtn = el("goBtn");
const nextHandBtn = el("nextHandBtn");
const logArea = el("logArea");

const showPanel = el("showPanel");
const cutLine = el("cutLine");
const ndTitle = el("ndTitle");
const dTitle = el("dTitle");
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

const boardSvg = el("boardSvg");
const p1Label = el("p1Label");
const p2Label = el("p2Label");

const gameOverModal = el("gameOverModal");
const winnerLine = el("winnerLine");
const finalLine = el("finalLine");
const newGameBtn = el("newGameBtn");
const newMatchBtn = el("newMatchBtn");

const qs = new URLSearchParams(location.search);
const tableId = (qs.get("table") || "JIM1").toString().trim();
const name = (qs.get("name") || "").toString().trim().slice(0, 16);

let state = null;
let selectedForDiscard = new Set();

// ---------- Cards ----------
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

// ---------- Match pips ----------
function renderPips(container, wins, maxShown = 10) {
  container.innerHTML = "";
  const w = Math.max(0, wins || 0);
  const shown = Math.min(w, maxShown);

  for (let i = 0; i < maxShown; i++) {
    const pip = document.createElement("span");
    pip.className = "pip" + (i < shown ? " filled" : "");
    container.appendChild(pip);
  }

  // If wins exceed maxShown, add a little text indicator
  if (w > maxShown) {
    const extra = document.createElement("span");
    extra.style.marginLeft = "8px";
    extra.style.opacity = "0.8";
    extra.style.fontWeight = "900";
    extra.textContent = `+${w - maxShown}`;
    container.appendChild(extra);
  }
}

// ---------- SVG Board (bigger / more readable) ----------
let boardInitialized = false;
let pegP1 = null;
let pegP2 = null;

function svgEl(tag) {
  return document.createElementNS("http://www.w3.org/2000/svg", tag);
}

function scoreToX(score) {
  // track from x=80..880 (800px usable)
  const s = clamp(score, 0, 121);
  return 80 + (s / 121) * 800;
}

function initBoardSvg() {
  if (boardInitialized) return;
  boardInitialized = true;

  boardSvg.innerHTML = "";

  const plate = svgEl("rect");
  plate.setAttribute("x", "20");
  plate.setAttribute("y", "20");
  plate.setAttribute("width", "920");
  plate.setAttribute("height", "240");
  plate.setAttribute("rx", "28");
  plate.setAttribute("class", "boardPlate");
  boardSvg.appendChild(plate);

  const title = svgEl("text");
  title.setAttribute("x", "480");
  title.setAttribute("y", "62");
  title.setAttribute("text-anchor", "middle");
  title.setAttribute("class", "boardEngrave");
  title.textContent = "⚓ PIRATE CRIBBAGE • 0 → 121";
  boardSvg.appendChild(title);

  const track1 = svgEl("rect");
  track1.setAttribute("x", "80");
  track1.setAttribute("y", "90");
  track1.setAttribute("width", "800");
  track1.setAttribute("height", "52");
  track1.setAttribute("rx", "26");
  track1.setAttribute("class", "track track1");
  boardSvg.appendChild(track1);

  const track2 = svgEl("rect");
  track2.setAttribute("x", "80");
  track2.setAttribute("y", "170");
  track2.setAttribute("width", "800");
  track2.setAttribute("height", "52");
  track2.setAttribute("rx", "26");
  track2.setAttribute("class", "track track2");
  boardSvg.appendChild(track2);

  const ticksGroup = svgEl("g");
  ticksGroup.setAttribute("class", "ticks");
  boardSvg.appendChild(ticksGroup);

  for (let i = 0; i <= 121; i++) {
    const x = scoreToX(i);
    const isMajor = (i % 5 === 0) || (i === 121);

    const tick = svgEl("line");
    tick.setAttribute("x1", String(x));
    tick.setAttribute("x2", String(x));
    tick.setAttribute("y1", "84");
    tick.setAttribute("y2", isMajor ? "240" : "232");
    tick.setAttribute("class", isMajor ? "tick major" : "tick minor");
    ticksGroup.appendChild(tick);

    if (isMajor && (i % 10 === 0 || i === 121)) {
      const lbl = svgEl("text");
      lbl.setAttribute("x", String(x));
      lbl.setAttribute("y", "262");
      lbl.setAttribute("text-anchor", "middle");
      lbl.setAttribute("class", "tickLabel");
      lbl.textContent = String(i);
      ticksGroup.appendChild(lbl);
    }
  }

  pegP1 = svgEl("circle");
  pegP1.setAttribute("r", "14");
  pegP1.setAttribute("cy", "116");
  pegP1.setAttribute("class", "peg p1");
  boardSvg.appendChild(pegP1);

  pegP2 = svgEl("circle");
  pegP2.setAttribute("r", "14");
  pegP2.setAttribute("cy", "196");
  pegP2.setAttribute("class", "peg p2");
  boardSvg.appendChild(pegP2);

  pegP1.setAttribute("cx", String(scoreToX(0)));
  pegP2.setAttribute("cx", String(scoreToX(0)));
}

function renderBoard() {
  if (!state) return;
  initBoardSvg();

  p1Label.textContent = state.players.PLAYER1 ? `P1 (${state.players.PLAYER1})` : "P1";
  p2Label.textContent = state.players.PLAYER2 ? `P2 (${state.players.PLAYER2})` : "P2";

  const s1 = state.scores?.PLAYER1 ?? 0;
  const s2 = state.scores?.PLAYER2 ?? 0;

  pegP1.setAttribute("cx", String(scoreToX(s1)));
  pegP2.setAttribute("cx", String(scoreToX(s2)));
}

// ---------- Pegging HUD ----------
function renderPileAndHud() {
  if (!state) return;

  countNum.textContent = String(state.peg?.count ?? 0);

  pileArea.innerHTML = "";
  const pile = state.peg?.pile || [];
  const show = pile.length > 10 ? pile.slice(pile.length - 10) : pile;
  for (const c of show) pileArea.appendChild(makeCardButton(c, { disabled: true }));

  if (state.stage !== "pegging") {
    peggingStatus.textContent = "Pegging info appears during the pegging phase.";
    lastScore.classList.add("hidden");
    return;
  }

  const myTurn = state.turn === state.me;
  const mine = state.myHandCount;
  const opp = state.oppHandCount;

  peggingStatus.textContent =
    `${myTurn ? "Your turn" : "Opponent's turn"} • You: ${mine} card(s) • Opponent: ${opp} card(s).`;

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

// ---------- Show panel ----------
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

  ndTitle.textContent = `Non-dealer (${nonDealer})`;
  dTitle.textContent = `Dealer (${dealer})`;

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

  if (cr && cr.cards) {
    for (const c of cr.cards) cCards.appendChild(makeCardButton(c, { disabled: true }));
    cCards.appendChild(makeCardButton(cut, { disabled: true }));
  }

  renderBreakdown(ndBreak, nd.breakdown);
  renderBreakdown(dBreak, de.breakdown);
  renderBreakdown(cBreak, cr?.breakdown);

  ndTotal.textContent = `Total: ${nd.breakdown.total}`;
  dTotal.textContent = `Total: ${de.breakdown.total}`;
  cTotal.textContent = `Total: ${cr?.breakdown?.total ?? 0}`;
}

// ---------- Game Over modal ----------
function renderGameOver() {
  if (!state) return;

  if (state.stage !== "gameover" || !state.gameOver) {
    gameOverModal.classList.add("hidden");
    gameOverModal.setAttribute("aria-hidden", "true");
    return;
  }

  const w = state.gameOver.winner;
  const winnerName = (w === "PLAYER1" ? (state.players.PLAYER1 || "P1") : (state.players.PLAYER2 || "P2"));

  winnerLine.textContent = `${winnerName} wins! (${state.gameOver.reason})`;
  finalLine.textContent =
    `Final: P1 ${state.gameOver.scores.PLAYER1} • P2 ${state.gameOver.scores.PLAYER2} | Match: P1 ${state.gameOver.matchWins.PLAYER1} – P2 ${state.gameOver.matchWins.PLAYER2}`;

  gameOverModal.classList.remove("hidden");
  gameOverModal.setAttribute("aria-hidden", "false");
}

// ---------- Main render ----------
function render() {
  if (!state) return;

  tableLine.textContent = `Table: ${state.tableId}`;
  meLine.textContent = `You: ${state.me}`;

  const p1 = state.players.PLAYER1 ? state.players.PLAYER1 : "—";
  const p2 = state.players.PLAYER2 ? state.players.PLAYER2 : "—";
  playersLine.textContent = `Crew: P1=${p1} | P2=${p2}`;

  stageLine.textContent = `Stage: ${state.stage}`;
  dealerLine.textContent = `Dealer: ${state.dealer}`;
  turnLine.textContent = `Turn: ${state.turn ?? "—"}`;

  const win = state.winScore ?? 121;
  scoreLine.textContent = `P1 ${state.scores.PLAYER1}/${win}  •  P2 ${state.scores.PLAYER2}/${win}`;

  // Match pips + names
  const mw = state.matchWins || { PLAYER1: 0, PLAYER2: 0 };
  matchP1Name.textContent = state.players.PLAYER1 ? `P1 (${state.players.PLAYER1})` : "P1";
  matchP2Name.textContent = state.players.PLAYER2 ? `P2 (${state.players.PLAYER2})` : "P2";
  renderPips(matchP1Pips, mw.PLAYER1, 10);
  renderPips(matchP2Pips, mw.PLAYER2, 10);

  cribLine.textContent = `Crib: ${state.cribCount} | Discards: P1=${state.discardsCount.PLAYER1}/2 P2=${state.discardsCount.PLAYER2}/2`;
  logArea.textContent = (state.log || []).join("\n");

  renderBoard();
  renderPileAndHud();
  renderShow();
  renderGameOver();

  // reset buttons + hand
  discardBtn.style.display = "none";
  goBtn.style.display = "none";
  nextHandBtn.style.display = "none";
  goBtn.classList.remove("goPulse");
  discardBtn.disabled = true;
  handArea.innerHTML = "";

  if (state.stage === "gameover") {
    handTitle.textContent = "Game Over";
    handHelp.textContent = "Start the next game (match carries) or reset the whole match.";
    showPanel.classList.add("hidden");
    return;
  }

  if (state.stage === "lobby") {
    handTitle.textContent = "Waiting for crew…";
    handHelp.textContent = `Open another browser/incognito and join table "${state.tableId}".`;
    showPanel.classList.add("hidden");
    return;
  }

  if (state.stage === "discard") {
    showPanel.classList.add("hidden");
    handTitle.textContent = "Your Hand";
    handHelp.textContent = "Choose 2 cards to toss into the crib.";

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
    handHelp.textContent = "Play a card without exceeding 31. If you can’t play, hit GO.";

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
      goBtn.classList.add("goPulse");
      goBtn.onclick = () => socket.emit("go");
    }
    return;
  }

  if (state.stage === "show") {
    handTitle.textContent = "Show";
    handHelp.textContent = "Scoring breakdown is shown below. Click Next Hand when ready.";
    nextHandBtn.style.display = "inline-block";
    nextHandBtn.onclick = () => socket.emit("next_hand");

    const myHand = state.myHand || [];
    myHand.forEach(card => handArea.appendChild(makeCardButton(card, { disabled: true })));
    if (state.cut) handArea.appendChild(makeCardButton(state.cut, { disabled: true }));
    return;
  }
}

newGameBtn.onclick = () => socket.emit("new_game");
newMatchBtn.onclick = () => socket.emit("new_match");

socket.on("connect", () => {
  socket.emit("join_table", { tableId, name });
});

socket.on("state", (s) => {
  state = s;
  render();
});

socket.on("error_msg", (msg) => alert(msg));
