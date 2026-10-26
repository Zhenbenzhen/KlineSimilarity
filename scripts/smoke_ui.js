import { readFile } from "node:fs/promises";
import vm from "node:vm";

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(name) { this.values.add(name); }
  remove(name) { this.values.delete(name); }
  toggle(name, force) {
    const next = force === undefined ? !this.values.has(name) : force;
    if (next) this.add(name); else this.remove(name);
    return next;
  }
  contains(name) { return this.values.has(name); }
}

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.value = "";
    this.textContent = "";
    this.innerHTML = "";
    this.hidden = false;
    this.dataset = {};
    this.checked = false;
    this.disabled = false;
    this.className = "";
    this.classList = new FakeClassList();
    this.listeners = new Map();
    this.children = [];
  }
  addEventListener(type, cb) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(cb);
  }
  async dispatch(type, event = {}) {
    for (const cb of this.listeners.get(type) || []) await cb({ target: this, currentTarget: this, ...event });
  }
  querySelector() { return this.input || new FakeElement(); }
  querySelectorAll() { return []; }
  appendChild() {}
  getBoundingClientRect() { return { width: 1200, height: 720, left: 0, top: 0 }; }
  getContext() {
    return {
      scale() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillRect() {}, fillText() {},
      set strokeStyle(_) {}, set fillStyle(_) {}, set lineWidth(_) {}, set font(_) {}, set globalAlpha(_) {},
    };
  }
}

const ids = [
  "appError", "loadSample", "fileInput", "dataStatus", "symbolList", "startSim", "startDate", "initialCash",
  "commissionRate", "stampTaxRate", "slippageRate", "capacityRate", "minCommission", "priceClose", "priceOpen", "periodSelect", "setup", "result", "simulator", "currentDate",
  "totalAsset", "cashAvailable", "positionValue", "floatingPnl", "modeBadge", "activeTitle", "indicatorSelect", "chart",
  "crosshairInfo", "tabs", "positions", "todayPositions", "orders", "pendingOrders", "slList", "tradeHint", "orderEstimate", "lotInput", "buyBtn", "sellBtn", "cancelOrders",
  "nextDay", "finishSim", "themeToggle", "halfCash", "selectAll", "randomStart", "symbolSearch", "maPeriods", "indicatorParams",
  "orderByLots", "orderByAmount", "amountInput", "equityCurve", "reportStart", "reportEnd", "reportMetrics", "backHome",
  "setupFilterContainer", "simFilterContainer", "slStop", "slTake", "slLots", "slSet", "slCancel",
];
const elements = Object.fromEntries(ids.map((id) => [id, new FakeElement(id)]));
Object.assign(elements.initialCash, { value: "100000" });
Object.assign(elements.commissionRate, { value: "0.00025" });
Object.assign(elements.stampTaxRate, { value: "0.0005" });
Object.assign(elements.slippageRate, { value: "0.001" });
Object.assign(elements.capacityRate, { value: "0.002" });
Object.assign(elements.minCommission, { value: "0" });
Object.assign(elements.lotInput, { value: "1" });
Object.assign(elements.indicatorSelect, { value: "MACD" });
Object.assign(elements.maPeriods, { value: "5,10,20,60,120,250" });
Object.assign(elements.indicatorParams, { value: "12,26,9" });
Object.assign(elements.orderByLots, { checked: true });
Object.assign(elements.orderByAmount, { checked: false });
Object.assign(elements.amountInput, { value: "10000" });
Object.assign(elements.periodSelect, { value: "day" });
Object.assign(elements.priceClose, { checked: true });
Object.assign(elements.priceOpen, { checked: false });

const modeInputs = [new FakeElement(), new FakeElement()];
modeInputs[0].value = "blind";
modeInputs[0].checked = true;
modeInputs[1].value = "asset";
const modeCards = [new FakeElement(), new FakeElement()];
modeCards[0].input = modeInputs[0];
modeCards[1].input = modeInputs[1];
const lotButtons = [new FakeElement(), new FakeElement()];
lotButtons[0].dataset.lots = "1";
lotButtons[1].dataset.lots = "10";
const assetFilter = new FakeElement();

const document = {
  body: new FakeElement("body"),
  getElementById: (id) => elements[id],
  createElement: (tag) => new FakeElement(tag),
  querySelector: (selector) => {
    if (selector === ".asset-filter") return assetFilter;
    if (selector === "#simulator .side") return new FakeElement("sim-side");
    return null;
  },
  querySelectorAll: (selector) => {
    if (selector === "input[name=mode]") return modeInputs;
    if (selector === ".mode-card") return modeCards;
    if (selector === ".lot-quick") return lotButtons;
    return [];
  },
};

const context = {
  window: { addEventListener() {} },
  document,
  console,
  alert: (message) => { throw new Error(String(message)); },
  setTimeout: () => 0,
  clearTimeout: () => {},
  getComputedStyle: () => ({ getPropertyValue: () => "#888" }),
  devicePixelRatio: 1,
  Set,
  Map,
  Date,
  Math,
  Number,
  String,
  Object,
  Array,
};
context.window.window = context.window;
context.window.document = document;

vm.createContext(context);
vm.runInContext(await readFile("data/sample-data.js", "utf8"), context);
vm.runInContext(await readFile("app.js", "utf8"), context);

await elements.loadSample.dispatch("click");
if (!/已载入 \d+ 个标的/.test(elements.dataStatus.textContent)) throw new Error("sample data did not load");

await elements.startSim.dispatch("click");
if (elements.currentDate.textContent === "-") throw new Error("simulation did not start");

await elements.buyBtn.dispatch("click");
await elements.nextDay.dispatch("click");
if (elements.orders.innerHTML === "暂无交易") throw new Error("trade flow did not execute");

// T+1 check: a position bought today cannot be sold on the same trading day
const K = context.window.KLINE;
if (!K || !K.state) throw new Error("internals not exposed");
const st = K.state;
await elements.buyBtn.dispatch("click");
await elements.sellBtn.dispatch("click");
if (st.positions.size === 0) throw new Error("buy did not create a position");
const activeSym = st.active;
if (st.positions.get(activeSym) === undefined) throw new Error("position missing");
if (K.posSellable(st.positions.get(activeSym)) !== 0) throw new Error("T+1 lock failed: same-day buy became sellable");
// next trading day unlocks
await elements.nextDay.dispatch("click");
if (K.posSellable(st.positions.get(activeSym)) <= 0) throw new Error("T+1 unlock failed: next-day buy not sellable");
const sellBefore = st.cashCents;
await elements.sellBtn.dispatch("click");
if (st.cashCents <= sellBefore) throw new Error("T+1 sell proceeds not available same day");
if (st.roundTrips.length === 0) throw new Error("round-trip pairing did not record a completed trade");

// Verify simulator layout and new filter containers exist
if (!elements.setupFilterContainer) throw new Error("setup filter container missing");
if (!elements.simFilterContainer) throw new Error("sim filter container missing");
if (!elements.nextDay) throw new Error("nextDay button missing");
if (!elements.buyBtn) throw new Error("buy button missing");
if (!elements.positionValue) throw new Error("positionValue element missing");
if (!elements.pendingOrders) throw new Error("pendingOrders element missing");
if (!elements.slList) throw new Error("slList element missing");

await elements.themeToggle.dispatch("click");
console.log("UI smoke test passed");
