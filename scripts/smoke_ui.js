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
  }
  addEventListener(type, cb) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(cb);
  }
  async dispatch(type, event = {}) {
    for (const cb of this.listeners.get(type) || []) await cb({ target: this, currentTarget: this, ...event });
  }
  querySelector() { return this.input || new FakeElement(); }
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
  "commissionRate", "stampTaxRate", "slippageRate", "capacityRate", "setup", "result", "simulator", "currentDate",
  "totalAsset", "cashAvailable", "frozenCash", "floatingPnl", "modeBadge", "activeTitle", "indicatorSelect", "chart",
  "crosshairInfo", "tabs", "positions", "todayPositions", "orders", "tradeHint", "orderEstimate", "lotInput", "buyBtn", "sellBtn", "cancelOrders",
  "nextDay", "finishSim", "themeToggle", "halfCash", "selectAll", "randomStart", "symbolSearch", "conditionA", "conditionB", "conditionAValue", "conditionBValue", "conditionLogic", "maPeriods", "indicatorParams", "orderByLots", "orderByAmount", "amountInput", "equityCurve", "reportStart", "reportEnd", "reportMetrics", "backHome",
];
const elements = Object.fromEntries(ids.map((id) => [id, new FakeElement(id)]));
Object.assign(elements.initialCash, { value: "100000" });
Object.assign(elements.commissionRate, { value: "0.00025" });
Object.assign(elements.stampTaxRate, { value: "0.0005" });
Object.assign(elements.slippageRate, { value: "0.001" });
Object.assign(elements.capacityRate, { value: "0.002" });
Object.assign(elements.lotInput, { value: "1" });
Object.assign(elements.indicatorSelect, { value: "MACD" });
Object.assign(elements.maPeriods, { value: "5,10,20,60,120,250" });
Object.assign(elements.conditionA, { value: "any" });
Object.assign(elements.conditionB, { value: "any" });
Object.assign(elements.conditionLogic, { value: "and" });
Object.assign(elements.conditionAValue, { value: "0" });
Object.assign(elements.conditionBValue, { value: "0" });
Object.assign(elements.indicatorParams, { value: "12,26,9" });
Object.assign(elements.orderByLots, { checked: true });
Object.assign(elements.orderByAmount, { checked: false });
Object.assign(elements.amountInput, { value: "10000" });

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
const blindFilter = new FakeElement();

const document = {
  body: new FakeElement("body"),
  getElementById: (id) => elements[id],
  querySelector: (selector) => {
    if (selector === ".asset-filter") return assetFilter;
    if (selector === ".blind-filter") return blindFilter;
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
if (!elements.dataStatus.textContent.includes("已载入 10 个标的")) throw new Error("sample data did not load");

await elements.startSim.dispatch("click");
if (elements.currentDate.textContent === "-") throw new Error("simulation did not start");

await elements.buyBtn.dispatch("click");
await elements.nextDay.dispatch("click");
if (elements.orders.innerHTML === "暂无交易") throw new Error("trade flow did not execute");

await elements.themeToggle.dispatch("click");
console.log("UI smoke test passed");
