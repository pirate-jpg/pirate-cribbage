let socket = null;
let state = null;

const el = id => document.getElementById(id);

// UI
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

const p1Peg = el("p1Peg");
const p2Peg = el("p2Peg");
const p1Label = el("p1Label");
const p2Label = el("p2Label");
const ticks = el("ticks");

// helpers
function cardValue(rank){
  if (rank === "A") return 1;
  if (["K","Q","J"].includes(rank)) return 10;
  return parseInt(rank,10);
}

function suitClass(s){
  return (s === "♥" || s === "♦") ? "red" : "black";
}

function makeCard(card, opts={}){
  const b = document.createElement("button");
  b.className = `cardBtn ${suitClass(card.suit)}`;
  if (opts.disabled) b.disabled = true;
  if (opts.onClick) b.onclick = opts.onClick;

  const c1 = document.createElement("div");
  c1.className = "corner";
  c1.textContent = card.rank;

  const mid = document.createElement("div");
  mid.className = "suitBig";
  mid.textContent = card.suit;

  const c2 = document.createElement("div");
  c2.className = "corner bottom";
  c2.textContent = card.rank;

  b.append(c1, mid, c2);
  return b;
}

function initTicks(){
  ticks.innerHTML = "";
  [0,30,60,90,121].forEach(n=>{
    const s = document.createElement("span");
    s.textContent = n;
    ticks.appendChild(s);
  });
}

function setPeg(el, score){
  const pct = Math.min(score,121)/121*100;
  el.style.left = `${pct}%`;
}

function render(){
  if (!state) return;

  playersLine.textContent =
    `Players: ${state.players.PLAYER1||"—"} vs ${state.players.PLAYER2||"—"}`;

  stageLine.textContent = `Stage: ${state.stage}`;
  dealerLine.textContent = `Dealer: ${state.dealer}`;
  turnLine.textContent = `Turn: ${state.turn}`;
  scoreLine.textContent =
    `P1 ${state.scores.PLAYER1} • P2 ${state.scores.PLAYER2}`;

  cribLine.textContent = `Crib (${state.dealer})`;

  countNum.textContent = state.peg.count;

  p1Label.textContent = state.players.PLAYER1 || "P1";
  p2Label.textContent = state.players.PLAYER2 || "P2";
  setPeg(p1Peg, state.scores.PLAYER1);
  setPeg(p2Peg, state.scores.PLAYER2);

  peggingStatus.textContent =
    state.stage === "pegging"
      ? (state.turn === state.me ? "Your turn" : "Opponent’s turn")
      : "";

  if (state.lastPegEvent?.pts){
    lastScore.textContent =
      `${state.lastPegEvent.player === state.me ? "You" : "Opponent"} +${state.lastPegEvent.pts}`;
    lastScore.classList.remove("hidden");
  } else lastScore.classList.add("hidden");

  pileArea.innerHTML = "";
  state.peg.pile.forEach(c =>
    pileArea.appendChild(makeCard(c,{disabled:true}))
  );

  handArea.innerHTML = "";
  discardBtn.style.display = "none";
  goBtn.style.display = "none";
  nextHandBtn.style.display = "none";

  if (state.stage === "discard"){
    handTitle.textContent = "Discard to Crib";
    handHelp.textContent = "Select 2 cards.";
    discardBtn.style.display = "inline-block";
  }

  if (state.stage === "pegging"){
    handTitle.textContent = "Pegging";
    handHelp.textContent = "Play or GO";
    goBtn.style.display = "inline-block";
    goBtn.onclick = ()=>socket.emit("go");
  }

  if (state.stage === "show"){
    handTitle.textContent = "Show";
    nextHandBtn.style.display = "inline-block";
    nextHandBtn.onclick = ()=>socket.emit("next_hand");
  }

  state.myHand.forEach(card=>{
    const playable =
      state.stage === "pegging" &&
      state.turn === state.me &&
      state.peg.count + cardValue(card.rank) <= 31;

    handArea.appendChild(
      makeCard(card,{
        disabled: !playable,
        onClick: ()=>socket.emit("play_card",{cardId:card.id})
      })
    );
  });
}

socket = io();
socket.on("state", s=>{
  state = s;
  initTicks();
  render();
});
