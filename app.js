const REQUIRED = ["symbol", "name", "date", "open", "high", "low", "close", "volume", "pre_close"];
const MA_COLORS = { 5: "#ff9a62", 10: "#6c9bcf", 20: "#b192d4", 60: "#79b8a3", 120: "#a8b5c0", 250: "#c0a8a8" };
const EXTRA_MA_COLORS = ["#ff9a62", "#6c9bcf", "#b192d4", "#79b8a3", "#a8b5c0", "#c0a8a8", "#b99b68", "#8c9dab"];
const state = {
  raw: [], symbols: [], selected: new Set(), mode: "blind", aliases: new Map(), active: null,
  index: 0, dates: [], settings: {}, cashCents: 0, frozen: [], positions: new Map(), pending: [], trades: [], equity: [], finished: false, todayTrades: []
};

const $ = (id) => document.getElementById(id);
const money = (cents) => `¥${(cents / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (v) => `${(v * 100).toFixed(2)}%`;
const toCents = (v) => Math.round(Number(v) * 100);
const fromCents = (v) => v / 100;
const roundFee = (v) => Math.round(v);
const css = (name) => getComputedStyle(document.body).getPropertyValue(name).trim();

function maPeriods() {
  const raw = ($("maPeriods")?.value || "5,10,20,60,120,250").split(/[，,\s]+/);
  const periods = [...new Set(raw.map((v) => Math.floor(Number(v))).filter((v) => Number.isFinite(v) && v > 1 && v <= 500))];
  return periods.length ? periods.slice(0, 8) : [5, 10, 20, 60, 120, 250];
}

function indicatorParams(defaults) {
  const raw = ($("indicatorParams")?.value || defaults.join(",")).split(/[，,\s]+/).map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0);
  return defaults.map((d, i) => Math.floor(raw[i] || d));
}

function defaultParamsFor(type) {
  return { MACD: "12,26,9", KDJ: "9,3,3", RSI: "14", WR: "14", BOLL: "20,2", OBV: "", BIAS: "6,12,24", BRAR: "26" }[type] || "";
}

function syncIndicatorParams(reset = false) {
  const input = $("indicatorParams");
  if (!input) return;
  input.placeholder = defaultParamsFor($("indicatorSelect")?.value);
  if (reset) input.value = input.placeholder;
}

function toast(message) {
  const box = $("appError");
  if (!box) return alert(message);
  box.hidden = false;
  box.textContent = message;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { box.hidden = true; }, 2600);
}

function normalizeCode(code) {
  const s = String(code).trim().toUpperCase();
  if (s.endsWith(".XSHG")) return s.replace(".XSHG", ".SH");
  if (s.endsWith(".XSHE")) return s.replace(".XSHE", ".SZ");
  if (/^6\d{5}$/.test(s)) return `${s}.SH`;
  if (/^[013]\d{5}$/.test(s)) return `${s}.SZ`;
  return s;
}

function parseDate(v) {
  return new Date(v).toISOString().slice(0, 10);
}

function parseCsv(text) {
  const rows = text.trim().split(/\r?\n/).filter(Boolean).map((line) => line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((v) => v.replace(/^"|"$/g, "").trim()));
  const header = rows.shift().map((h) => h.trim());
  return rows.map((row) => Object.fromEntries(header.map((h, i) => [h, row[i] ?? ""])));
}

function normalizeRows(rows) {
  const missing = REQUIRED.filter((k) => !rows.some((r) => k in r));
  if (missing.length) throw new Error(`缺少必填字段: ${missing.join(", ")}`);
  return rows.map((r) => ({
    symbol: normalizeCode(r.symbol), name: String(r.name || r.symbol), date: parseDate(r.date),
    open: Number(r.open), high: Number(r.high), low: Number(r.low), close: Number(r.close),
    volume: Number(r.volume), pre_close: Number(r.pre_close)
  })).filter((r) => r.symbol && r.date && [r.open, r.high, r.low, r.close, r.volume, r.pre_close].every(Number.isFinite))
    .sort((a, b) => a.symbol.localeCompare(b.symbol) || a.date.localeCompare(b.date));
}

function groupSymbols(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.symbol)) map.set(row.symbol, { symbol: row.symbol, name: row.name, rows: [] });
    map.get(row.symbol).rows.push(row);
  }
  return [...map.values()].map((s) => {
    s.rows = s.rows.filter((r, i, arr) => i === 0 || r.date !== arr[i - 1].date);
    s.start = s.rows[0]?.date; s.end = s.rows.at(-1)?.date; s.count = s.rows.length; s.valid = s.count >= 100;
    return s;
  });
}

function sma(values, n) {
  return values.map((_, i) => i + 1 < n ? null : values.slice(i + 1 - n, i + 1).reduce((a, b) => a + b, 0) / n);
}

function latestRsi(rows, n = 14) {
  if (rows.length <= n) return 50;
  const recent = rows.slice(-n - 1);
  let gain = 0, loss = 0;
  for (let i = 1; i < recent.length; i++) {
    const d = recent[i].close - recent[i - 1].close;
    if (d >= 0) gain += d; else loss -= d;
  }
  return 100 * gain / Math.max(1e-9, gain + loss);
}

function latestMacdPositive(rows) {
  const c = rows.map((r) => r.close);
  const ema = (n) => { const k = 2 / (n + 1), out = []; c.forEach((x, i) => out[i] = i ? x * k + out[i - 1] * (1 - k) : x); return out; };
  const e12 = ema(12), e26 = ema(26), dif = c.map((_, i) => e12[i] - e26[i]);
  const dea = [];
  dif.forEach((x, i) => dea[i] = i ? x * 0.2 + dea[i - 1] * 0.8 : x);
  return dif.at(-1) > dea.at(-1);
}

function matchCondition(symbolInfo, condition, threshold = 0) {
  if (condition === "any") return true;
  const rows = symbolInfo.rows;
  if (rows.length < 60) return false;
  const closes = rows.map((r) => r.close), vols = rows.map((r) => r.volume);
  const ma5 = sma(closes, 5), ma20 = sma(closes, 20), ma60 = sma(closes, 60), vol20 = sma(vols, 20);
  const last = rows.length - 1;
  if (condition === "ma_bull") return ma5[last] != null && ma20[last] != null && (ma5[last] / ma20[last] - 1) * 100 >= threshold;
  if (condition === "above_ma60") return ma60[last] != null && (closes[last] / ma60[last] - 1) * 100 >= threshold;
  if (condition === "macd_positive") {
    if (!latestMacdPositive(rows)) return false;
    const c = rows.map((r) => r.close);
    const ema = (n) => { const k = 2 / (n + 1), out = []; c.forEach((x, i) => out[i] = i ? x * k + out[i - 1] * (1 - k) : x); return out; };
    const e12 = ema(12), e26 = ema(26), dif = c.map((_, i) => e12[i] - e26[i]);
    const dea = [];
    dif.forEach((x, i) => dea[i] = i ? x * 0.2 + dea[i - 1] * 0.8 : x);
    return threshold <= 0 || (dif.at(-1) - dea.at(-1)) / Math.max(0.01, c.at(-1)) * 100 >= threshold;
  }
  if (condition === "rsi_strong") return latestRsi(rows) >= (threshold || 50);
  if (condition === "volume_expand") return vol20[last] != null && (vols[last] / vol20[last] - 1) * 100 >= threshold;
  return true;
}

function visibleSymbols() {
  const keyword = ($("symbolSearch")?.value || "").trim().toLowerCase();
  const a = $("conditionA")?.value || "any", b = $("conditionB")?.value || "any", logic = $("conditionLogic")?.value || "and";
  const av = Number($("conditionAValue")?.value || 0), bv = Number($("conditionBValue")?.value || 0);
  return state.symbols.filter((s) => {
    if (state.mode === "asset" && keyword && !`${s.symbol} ${s.name}`.toLowerCase().includes(keyword)) return false;
    if (state.mode === "blind") {
      const ma = matchCondition(s, a, av), mb = matchCondition(s, b, bv);
      if (logic === "and" && !(ma && mb)) return false;
      if (logic === "or" && !(ma || mb)) return false;
    }
    return true;
  });
}

function applyBlindFilterSelection() {
  if (state.mode !== "blind") return;
  state.selected = new Set(visibleSymbols().filter((s) => s.valid).slice(0, 500).map((s) => s.symbol));
}

async function loadSample() {
  if (window.KLINE_SAMPLE_DATA) {
    await setData(window.KLINE_SAMPLE_DATA);
    return;
  }
  const res = await fetch("data/a_share_daily_10y.json", { cache: "no-store" });
  if (!res.ok) throw new Error("未找到 data/a_share_daily_10y.json，请先运行 npm run fetch:sample");
  await setData(await res.json());
}

async function setData(payload) {
  let rows = Array.isArray(payload) ? payload : payload.data;
  if (payload?.symbols && Array.isArray(payload.symbols)) {
    rows = payload.symbols.flatMap(([symbol, name, series]) => series.map((row) => ({
      symbol,
      name,
      date: row[0],
      open: row[1],
      high: row[2],
      low: row[3],
      close: row[4],
      volume: row[5],
      pre_close: row[6],
    })));
  }
  if (payload?.columns && Array.isArray(rows) && Array.isArray(rows[0])) {
    rows = rows.map((row) => Object.fromEntries(payload.columns.map((key, index) => [key, row[index]])));
  }
  if (!Array.isArray(rows)) throw new Error("数据格式错误：需要数组或 { data: [...] }");
  state.raw = normalizeRows(rows);
  state.symbols = groupSymbols(state.raw);
  state.selected = new Set(state.symbols.filter((s) => s.valid).slice(0, 500).map((s) => s.symbol));
  state.aliases = new Map(state.symbols.map((s, i) => [s.symbol, `标的#${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26) + 1}`]));
  renderSetup();
}

function renderSetup() {
  const valid = state.symbols.filter((s) => s.valid).length;
  const visible = visibleSymbols();
  $("dataStatus").textContent = `已载入 ${state.symbols.length} 个标的，${valid} 个满足至少100个交易日，当前筛选显示 ${visible.length} 个。最多选择500个。`;
  $("symbolList").innerHTML = visible.map((s) => `
    <div class="symbol-item ${s.valid ? "" : "disabled"}">
      <label><input type="checkbox" data-symbol="${s.symbol}" ${state.selected.has(s.symbol) ? "checked" : ""} ${s.valid ? "" : "disabled"} />
        <span><strong>${state.mode === "blind" ? state.aliases.get(s.symbol) : `${s.name} ${s.symbol}`}</strong><span class="symbol-meta">${s.start} - ${s.end} / ${s.count} 日${s.valid ? "" : " / 交易日不足"}</span></span>
      </label>
    </div>`).join("");
  $("symbolList").innerHTML ||= `<div class="notice">没有符合筛选条件的标的。</div>`;
  document.querySelector(".asset-filter")?.classList.toggle("hidden-filter", state.mode !== "asset");
  document.querySelector(".blind-filter")?.classList.toggle("hidden-filter", state.mode !== "blind");
  $("startSim").disabled = state.selected.size === 0;
  const selected = state.symbols.filter((s) => state.selected.has(s.symbol));
  const startMin = selected.map((s) => s.rows[0].date).sort().at(-1);
  const startMax = selected.map((s) => s.rows.at(-101)?.date).sort().at(0);
  if (startMin && startMax) { $("startDate").min = startMin; $("startDate").max = startMax; if (!$("startDate").value) $("startDate").value = startMin; }
}

function startSimulation() {
  const selected = state.symbols.filter((s) => state.selected.has(s.symbol)).slice(0, 500);
  const dateSet = new Set(selected.flatMap((s) => s.rows.map((r) => r.date)));
  state.dates = [...dateSet].sort();
  const requested = $("startDate").value || state.dates[0];
  state.index = Math.max(0, state.dates.findIndex((d) => d >= requested));
  state.active = selected[0].symbol;
  state.settings = {
    commissionRate: Number($("commissionRate").value), stampTaxRate: Number($("stampTaxRate").value),
    slippageRate: Number($("slippageRate").value), capacityRate: Number($("capacityRate").value), initialCash: Number($("initialCash").value)
  };
  state.cashCents = toCents(state.settings.initialCash); state.frozen = []; state.positions = new Map(); state.pending = []; state.trades = []; state.equity = []; state.todayTrades = []; state.finished = false;
  $("setup").classList.add("hidden"); $("result").classList.add("hidden"); $("simulator").classList.remove("hidden");
  markEquity(); renderAll();
}

function selectedSymbols() { return state.symbols.filter((s) => state.selected.has(s.symbol)); }
function rowsOf(symbol) { return state.symbols.find((s) => s.symbol === symbol)?.rows || []; }
function rowAt(symbol, offset = 0) { const d = state.dates[state.index + offset]; return rowsOf(symbol).find((r) => r.date === d) || null; }
function lastPrice(symbol) { return rowAt(symbol)?.close ?? [...rowsOf(symbol)].reverse().find((r) => r.date <= state.dates[state.index])?.close ?? 0; }
function label(symbol) { const s = state.symbols.find((x) => x.symbol === symbol); return state.mode === "blind" ? state.aliases.get(symbol) : `${s.name} ${symbol}`; }

function positionValueCents() {
  let total = 0;
  for (const [sym, pos] of state.positions) total += toCents(lastPrice(sym)) * pos.shares;
  return total;
}
function frozenCents() { return state.frozen.reduce((a, x) => a + x.amount, 0); }
function totalAssetCents() { return state.cashCents + frozenCents() + positionValueCents(); }
function markEquity() { state.equity.push({ date: state.dates[state.index], total: totalAssetCents() }); }

function estimate(symbol, side, lots) {
  const row = rowAt(symbol); if (!row) throw new Error("该标的今日停牌，不能交易");
  const shares = lots * 100, price = row.close, gross = toCents(price) * shares;
  const commission = roundFee(gross * state.settings.commissionRate);
  const stamp = side === "sell" ? roundFee(gross * state.settings.stampTaxRate) : 0;
  const slippage = roundFee(gross * state.settings.slippageRate);
  const cash = side === "buy" ? gross + commission + slippage : gross - commission - stamp - slippage;
  return { row, shares, price, gross, commission, stamp, slippage, cash };
}

function placeOrder(side) {
  let lots = Math.max(1, Math.floor(Number($("lotInput").value) || 1));
  if (side === "buy" && $("orderByAmount")?.checked) {
    const row = rowAt(state.active);
    const amount = Math.max(0, Number($("amountInput").value) || 0);
    if (row && amount > 0) {
      lots = Math.max(1, Math.floor(amount / (row.close * 100 * (1 + state.settings.slippageRate + state.settings.commissionRate))));
      $("lotInput").value = lots;
    }
  }
  try {
    const e = estimate(state.active, side, lots);
    if (side === "buy" && e.cash > state.cashCents) throw new Error(`可用资金不足，还需 ${money(e.cash - state.cashCents)}`);
    if (side === "sell" && (state.positions.get(state.active)?.shares || 0) < e.shares) throw new Error(`持仓不足，当前仅 ${Math.floor((state.positions.get(state.active)?.shares || 0) / 100)} 手`);
    const done = executeOrder({ side, symbol: state.active, lots });
    const msg = done ? `下单成功：已按当日收盘价${side === "buy" ? "买入" : "卖出"} ${lots} 手。` : "下单未成功：委托未成交或资金/持仓不足。";
    $("tradeHint").textContent = msg;
    toast(msg);
  } catch (e) { $("tradeHint").textContent = e.message; toast(`下单未成功：${e.message}`); }
  renderAll();
}

function executeOrder(order) {
  const e = estimate(order.symbol, order.side, order.lots);
  let lots = order.lots;
  const limitHit = Math.abs(e.row.close / e.row.pre_close - 1) >= 0.095;
  const capacity = Math.max(1, Math.floor((e.row.volume || 0) * state.settings.capacityRate));
  if (lots > 1 && lots > capacity) {
    const prob = Math.min(1, capacity / lots) * (limitHit ? 0.3 : 1);
    lots = Math.random() < prob ? lots : Math.max(1, capacity);
  }
  const final = estimate(order.symbol, order.side, lots);
  const pos = state.positions.get(order.symbol) || { shares: 0, costCents: 0 };
  if (order.side === "buy") {
    if (final.cash > state.cashCents) return false;
    state.cashCents -= final.cash;
    pos.costCents += final.cash; pos.shares += final.shares; state.positions.set(order.symbol, pos);
  } else {
    if (pos.shares < final.shares) return false;
    const avg = pos.shares ? pos.costCents / pos.shares : 0;
    pos.shares -= final.shares; pos.costCents -= Math.round(avg * final.shares);
    if (pos.shares <= 0) state.positions.delete(order.symbol); else state.positions.set(order.symbol, pos);
    state.frozen.push({ amount: final.cash, release: state.index + 1 });
  }
  state.trades.push({ date: state.dates[state.index], symbol: order.symbol, side: order.side, lots, price: final.price, fees: final.commission + final.stamp + final.slippage });
  state.todayTrades.push({ date: state.dates[state.index], symbol: order.symbol, side: order.side, lots, shares: final.shares, price: final.price, amount: final.cash });
  return true;
}

function nextDay() {
  state.pending = [];
  state.todayTrades = [];
  state.index += 1;
  const released = state.frozen.filter((f) => f.release <= state.index).reduce((a, f) => a + f.amount, 0);
  state.cashCents += released; state.frozen = state.frozen.filter((f) => f.release > state.index);
  if (state.index >= state.dates.length - 1) return finishSimulation();
  markEquity(); renderAll();
}

function finishSimulation() {
  state.finished = true; markEquity(); renderAll(); renderResult();
}

function updateOrderEstimate() {
  const box = $("orderEstimate");
  if (!box || !state.active) return;
  let lots = Math.max(1, Math.floor(Number($("lotInput").value) || 1));
  const row = rowAt(state.active);
  if (!row) { box.textContent = "该标的今日停牌，不能估算下单金额。"; return; }
  if ($("orderByAmount")?.checked) {
    const amount = Math.max(0, Number($("amountInput").value) || 0);
    lots = Math.max(1, Math.floor(amount / (row.close * 100 * (1 + state.settings.slippageRate + state.settings.commissionRate))));
    $("lotInput").value = lots;
  }
  const buy = estimate(state.active, "buy", lots), sell = estimate(state.active, "sell", lots);
  box.innerHTML = `手数 ${lots} / 股数 ${lots * 100}<br>买入需 ${money(buy.cash)}（含佣金和滑点）<br>卖出预计到账 ${money(sell.cash)}（T+1可用）`;
}

function calcSeries(rows) {
  const closes = rows.map((r) => r.close);
  const ma = (n) => closes.map((_, i) => i + 1 < n ? null : closes.slice(i + 1 - n, i + 1).reduce((a, b) => a + b, 0) / n);
  return { ma: Object.fromEntries(maPeriods().map((n) => [n, ma(n)])) };
}

function indicator(rows, type) {
  const c = rows.map((r) => r.close), h = rows.map((r) => r.high), l = rows.map((r) => r.low), v = rows.map((r) => r.volume);
  const ema = (n) => { const k = 2 / (n + 1), out = []; c.forEach((x, i) => out[i] = i ? x * k + out[i - 1] * (1 - k) : x); return out; };
  if (type === "MACD") { const [fast, slow, signal] = indicatorParams([12, 26, 9]); const e12 = ema(fast), e26 = ema(slow), dif = c.map((_, i) => e12[i] - e26[i]); const dea = []; const k = 2 / (signal + 1); dif.forEach((x, i) => dea[i] = i ? x * k + dea[i - 1] * (1 - k) : x); return { lines: [{ name: "DIF", values: dif }, { name: "DEA", values: dea }], bars: dif.map((x, i) => (x - dea[i]) * 2) }; }
  if (type === "RSI") { const [n] = indicatorParams([14]); let gains = [], losses = []; for (let i = 1; i < c.length; i++) { gains[i] = Math.max(0, c[i] - c[i - 1]); losses[i] = Math.max(0, c[i - 1] - c[i]); } return { lines: [{ name: `RSI${n}`, values: c.map((_, i) => i < n ? null : 100 * gains.slice(i + 1 - n, i + 1).reduce((a, b) => a + b, 0) / Math.max(1e-9, gains.slice(i + 1 - n, i + 1).reduce((a, b) => a + b, 0) + losses.slice(i + 1 - n, i + 1).reduce((a, b) => a + b, 0))) }] }; }
  if (type === "KDJ") { const [n, kSmooth, dSmooth] = indicatorParams([9, 3, 3]); const k = [], d = [], j = []; c.forEach((x, i) => { const lo = Math.min(...l.slice(Math.max(0, i + 1 - n), i + 1)), hi = Math.max(...h.slice(Math.max(0, i + 1 - n), i + 1)); const rsv = (x - lo) / Math.max(1e-9, hi - lo) * 100; k[i] = (i ? k[i - 1] * (kSmooth - 1) : 50) / kSmooth + rsv / kSmooth; d[i] = (i ? d[i - 1] * (dSmooth - 1) : 50) / dSmooth + k[i] / dSmooth; j[i] = 3 * k[i] - 2 * d[i]; }); return { lines: [{ name: "K", values: k }, { name: "D", values: d }, { name: "J", values: j }] }; }
  if (type === "WR") { const [n] = indicatorParams([14]); return { lines: [{ name: `WR${n}`, values: c.map((x, i) => { const lo = Math.min(...l.slice(Math.max(0, i + 1 - n), i + 1)), hi = Math.max(...h.slice(Math.max(0, i + 1 - n), i + 1)); return -100 * (hi - x) / Math.max(1e-9, hi - lo); }) }] }; }
  if (type === "OBV") { const out = [0]; for (let i = 1; i < c.length; i++) out[i] = out[i - 1] + (c[i] > c[i - 1] ? v[i] : c[i] < c[i - 1] ? -v[i] : 0); return { lines: [{ name: "OBV", values: out }] }; }
  if (type === "BIAS") { const periods = indicatorParams([6, 12, 24]); const m = Object.fromEntries(periods.map((n) => [n, sma(c, n)])); return { lines: periods.map((n) => ({ name: `BIAS${n}`, values: c.map((x, i) => m[n]?.[i] ? (x - m[n][i]) / m[n][i] * 100 : null) })) }; }
  if (type === "BRAR") { const [n] = indicatorParams([26]); const br = c.map((_, i) => i < n ? null : h.slice(i + 1 - n, i + 1).reduce((a, x, j) => a + x - c[i - n + j], 0) / Math.max(1e-9, c.slice(i - n, i).reduce((a, x, j) => a + x - l[i + 1 - n + j], 0)) * 100); return { lines: [{ name: "BR", values: br }] }; }
  if (type === "BOLL") { const [n, mlt] = indicatorParams([20, 2]); const ma = sma(c, n); const up = c.map((_, i) => { if (i < n - 1) return null; const arr = c.slice(i + 1 - n, i + 1), m = ma[i], sd = Math.sqrt(arr.reduce((a, x) => a + (x - m) ** 2, 0) / n); return m + mlt * sd; }); return { overlay: [{ name: "BOLL", values: ma }, { name: "UP", values: up }, { name: "LOW", values: up.map((x, i) => x == null ? null : ma[i] * 2 - x) }] }; }
  return { volume: true };
}

function drawChart() {
  const canvas = $("chart"), ctx = canvas.getContext("2d"), rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(900, Math.floor(rect.width * devicePixelRatio)); canvas.height = Math.floor(rect.height * devicePixelRatio); ctx.scale(devicePixelRatio, devicePixelRatio);
  const w = rect.width, h = rect.height, rows = rowsOf(state.active).filter((r) => r.date <= state.dates[state.index]);
  ctx.clearRect(0, 0, w, h); if (!rows.length) return;
  const n = Math.min(120, rows.length), view = rows.slice(-n), topH = h * 0.56, volH = h * 0.18, indH = h * 0.2, pad = 46, gap = 14;
  const max = Math.max(...view.map((r) => r.high)), min = Math.min(...view.map((r) => r.low));
  const x = (i) => pad + i * ((w - pad * 1.5) / n) + 3, bw = Math.max(3, (w - pad * 1.5) / n * 0.62), y = (p) => 12 + (max - p) / (max - min || 1) * (topH - 24);
  ctx.strokeStyle = css("--line"); ctx.lineWidth = 1; for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.moveTo(pad, 12 + i * topH / 5); ctx.lineTo(w - 10, 12 + i * topH / 5); ctx.stroke(); }
  view.forEach((r, i) => { const up = r.close >= r.open; ctx.strokeStyle = ctx.fillStyle = up ? css("--up") : css("--down"); const cx = x(i) + bw / 2; ctx.beginPath(); ctx.moveTo(cx, y(r.high)); ctx.lineTo(cx, y(r.low)); ctx.stroke(); ctx.globalAlpha = 0.88; ctx.fillRect(x(i), Math.min(y(r.open), y(r.close)), bw, Math.max(1, Math.abs(y(r.open) - y(r.close)))); ctx.globalAlpha = 1; });
  const series = calcSeries(rows); Object.entries(series.ma).forEach(([n, vals], i) => drawLine(ctx, vals.slice(-view.length), x, y, MA_COLORS[n] || EXTRA_MA_COLORS[i % EXTRA_MA_COLORS.length]));
  const type = $("indicatorSelect").value, ind = indicator(rows, type); if (ind.overlay) ind.overlay.forEach((l, i) => drawLine(ctx, l.values.slice(-view.length), x, y, ["#b192d4", "#d85a5a", "#4d9e7a"][i]));
  const baseY = topH + gap, vmax = Math.max(...view.map((r) => r.volume));
  view.forEach((r, i) => { ctx.fillStyle = r.close >= r.open ? css("--up") : css("--down"); ctx.globalAlpha = 0.55; ctx.fillRect(x(i), baseY + volH - r.volume / Math.max(1, vmax) * volH, bw, r.volume / Math.max(1, vmax) * volH); ctx.globalAlpha = 1; });
  const indY = baseY + volH + gap;
  if (ind.bars) drawBars(ctx, ind.bars.slice(-view.length), x, indY, indH, bw);
  ind.lines?.forEach((l, i) => drawIndicatorLine(ctx, l.values.slice(-view.length), x, indY, indH, ["#6c9bcf", "#ff9a62", "#b192d4"][i]));
  ctx.fillStyle = css("--muted"); ctx.font = "12px Consolas"; ctx.fillText(`${view[0].date} - ${view.at(-1).date}`, pad, h - 8); ctx.fillText(max.toFixed(2), w - 42, 20); ctx.fillText(min.toFixed(2), w - 42, topH - 4);
  ctx.fillText("VOL", pad, baseY + 12); ctx.fillText(type, pad, indY + 12);
}

function drawLine(ctx, values, x, y, color) { ctx.strokeStyle = color; ctx.beginPath(); values.forEach((v, i) => { if (v == null) return; const xx = x(i) + 3, yy = y(v); i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); }); ctx.stroke(); }
function drawIndicatorLine(ctx, values, x, baseY, volH, color) { const vs = values.filter((v) => v != null); const max = Math.max(...vs), min = Math.min(...vs); drawLine(ctx, values, x, (v) => baseY + (max - v) / (max - min || 1) * volH, color); }
function drawBars(ctx, values, x, baseY, volH, bw) { const m = Math.max(1e-9, ...values.map(Math.abs)); values.forEach((v, i) => { ctx.fillStyle = v >= 0 ? css("--up") : css("--down"); const z = baseY + volH / 2; ctx.fillRect(x(i), v >= 0 ? z - Math.abs(v) / m * volH / 2 : z, bw, Math.max(1, Math.abs(v) / m * volH / 2)); }); }

function renderAll() {
  const row = rowAt(state.active), total = totalAssetCents(), pnl = total - toCents(state.settings.initialCash || 0);
  $("currentDate").textContent = state.dates[state.index] || "-"; $("totalAsset").textContent = money(total); $("cashAvailable").textContent = money(state.cashCents); $("frozenCash").textContent = money(frozenCents());
  $("floatingPnl").textContent = `${pnl >= 0 ? "+" : ""}${money(pnl)}`; $("floatingPnl").className = pnl >= 0 ? "up" : "down";
  $("modeBadge").textContent = state.mode === "blind" ? "盲选模式" : "资产配置模式"; $("activeTitle").textContent = label(state.active);
  $("tabs").innerHTML = selectedSymbols().map((s) => `<button class="tab ${s.symbol === state.active ? "active" : ""}" data-tab="${s.symbol}">${label(s.symbol)}</button>`).join("");
  $("positions").innerHTML = [...state.positions].map(([sym, p]) => { const val = toCents(lastPrice(sym)) * p.shares, pnl = val - p.costCents; return `<div class="position-card"><strong>${label(sym)}</strong><span>${p.shares / 100}手 / 市值 ${money(val)}</span><br><span class="${pnl >= 0 ? "up" : "down"}">盈亏 ${money(pnl)} ${pct(pnl / Math.max(1, p.costCents))}</span></div>`; }).join("") || "暂无持仓";
  $("todayPositions").innerHTML = state.todayTrades.filter((t) => t.side === "buy").map((t) => `<div class="position-card"><strong>${label(t.symbol)}</strong><span>今日买入 ${t.lots}手 @ ${t.price.toFixed(2)}</span><br><span>成交额 ${money(t.amount)}</span></div>`).join("") || "暂无当日成交持仓";
  $("orders").innerHTML = state.trades.slice(-20).reverse().map((t) => `<div class="order-card"><strong>${t.date} ${label(t.symbol)}</strong>${t.side === "buy" ? "买入" : "卖出"} ${t.lots}手 @ ${t.price.toFixed(2)} / 费用 ${money(t.fees)}</div>`).join("") || "暂无交易";
  $("tradeHint").textContent = row ? `现价 ${row.close.toFixed(2)}，涨跌幅 ${pct(row.close / row.pre_close - 1)}，当日委托按收盘价成交。` : "该标的今日停牌，不能交易。";
  updateOrderEstimate();
  drawChart();
}

function renderResult() {
  const first = state.equity[0]?.total || toCents(state.settings.initialCash), last = totalAssetCents();
  let peak = first, maxDd = 0; for (const e of state.equity) { peak = Math.max(peak, e.total); maxDd = Math.min(maxDd, e.total / peak - 1); }
  const returns = state.equity.slice(1).map((e, i) => e.total / state.equity[i].total - 1).filter(Number.isFinite);
  const avg = returns.reduce((a, b) => a + b, 0) / Math.max(1, returns.length);
  const variance = returns.reduce((a, b) => a + (b - avg) ** 2, 0) / Math.max(1, returns.length - 1);
  const vol = Math.sqrt(variance) * Math.sqrt(252);
  const annual = (last / first) ** (252 / Math.max(1, returns.length)) - 1;
  const downside = returns.filter((r) => r < 0);
  const downsideVol = Math.sqrt(downside.reduce((a, b) => a + b ** 2, 0) / Math.max(1, downside.length)) * Math.sqrt(252);
  const sharpe = vol ? annual / vol : 0;
  const sortino = downsideVol ? annual / downsideVol : 0;
  const calmar = maxDd ? annual / Math.abs(maxDd) : 0;
  const best = Math.max(0, ...returns), worst = Math.min(0, ...returns);
  $("result").classList.remove("hidden");
  $("simulator").classList.add("hidden");
  $("result").innerHTML = `<div class="section-title"><p class="eyebrow">Result</p><h2>模拟结果</h2></div><div class="setup-grid"><label>报告起始日<input id="reportStart" type="date" value="${state.equity[0]?.date || ""}" /></label><label>报告结束日<input id="reportEnd" type="date" value="${state.equity.at(-1)?.date || ""}" /></label></div><div id="reportMetrics" class="result-grid">
    <div class="metric"><span>总收益率</span><strong class="${last >= first ? "up" : "down"}">${pct(last / first - 1)}</strong></div>
    <div class="metric"><span>年化收益率</span><strong class="${annual >= 0 ? "up" : "down"}">${pct(annual)}</strong></div>
    <div class="metric"><span>年化波动率</span><strong>${pct(vol)}</strong></div>
    <div class="metric"><span>夏普比率</span><strong>${sharpe.toFixed(2)}</strong></div>
    <div class="metric"><span>卡玛比率</span><strong>${calmar.toFixed(2)}</strong></div>
    <div class="metric"><span>索提诺比率</span><strong>${sortino.toFixed(2)}</strong></div>
    <div class="metric"><span>下行波动率</span><strong>${pct(downsideVol)}</strong></div>
    <div class="metric"><span>最大回撤</span><strong class="down">${pct(maxDd)}</strong></div>
    <div class="metric"><span>最佳单日</span><strong class="up">${pct(best)}</strong></div>
    <div class="metric"><span>最差单日</span><strong class="down">${pct(worst)}</strong></div>
    <div class="metric"><span>交易笔数</span><strong>${state.trades.length}</strong></div>
    <div class="metric"><span>累计费用</span><strong>${money(state.trades.reduce((a, t) => a + t.fees, 0))}</strong></div>
    <div class="metric"><span>最终资产</span><strong>${money(last)}</strong></div>
  </div><canvas id="equityCurve" class="equity-curve" width="1200" height="260"></canvas><div class="report-actions"><button id="backHome" type="button">返回首页</button></div>`;
  updateReportRange();
  $("reportStart").addEventListener("change", updateReportRange);
  $("reportEnd").addEventListener("change", updateReportRange);
  $("backHome").addEventListener("click", () => { $("result").classList.add("hidden"); $("setup").classList.remove("hidden"); renderSetup(); });
}

function reportStats(equity) {
  const first = equity[0]?.total || 1, last = equity.at(-1)?.total || first;
  let peak = first, maxDd = 0;
  const drawdowns = equity.map((e) => { peak = Math.max(peak, e.total); const dd = e.total / peak - 1; maxDd = Math.min(maxDd, dd); return { date: e.date, value: dd }; });
  const returns = equity.slice(1).map((e, i) => e.total / equity[i].total - 1).filter(Number.isFinite);
  const avg = returns.reduce((a, b) => a + b, 0) / Math.max(1, returns.length);
  const vol = Math.sqrt(returns.reduce((a, b) => a + (b - avg) ** 2, 0) / Math.max(1, returns.length - 1)) * Math.sqrt(252);
  const annual = (last / first) ** (252 / Math.max(1, returns.length)) - 1;
  const downside = returns.filter((r) => r < 0);
  const downsideVol = Math.sqrt(downside.reduce((a, b) => a + b ** 2, 0) / Math.max(1, downside.length)) * Math.sqrt(252);
  return { first, last, returns, drawdowns, maxDd, vol, annual, downsideVol, sharpe: vol ? annual / vol : 0, sortino: downsideVol ? annual / downsideVol : 0, calmar: maxDd ? annual / Math.abs(maxDd) : 0, best: Math.max(0, ...returns), worst: Math.min(0, ...returns) };
}

function updateReportRange() {
  const start = $("reportStart")?.value || "0000-00-00", end = $("reportEnd")?.value || "9999-99-99";
  const range = state.equity.filter((e) => e.date >= start && e.date <= end);
  const s = reportStats(range.length >= 2 ? range : state.equity);
  $("reportMetrics").innerHTML = `
    <div class="metric"><span>区间收益率</span><strong class="${s.last >= s.first ? "up" : "down"}">${pct(s.last / s.first - 1)}</strong></div>
    <div class="metric"><span>年化收益率</span><strong class="${s.annual >= 0 ? "up" : "down"}">${pct(s.annual)}</strong></div>
    <div class="metric"><span>年化波动率</span><strong>${pct(s.vol)}</strong></div>
    <div class="metric"><span>夏普比率</span><strong>${s.sharpe.toFixed(2)}</strong></div>
    <div class="metric"><span>卡玛比率</span><strong>${s.calmar.toFixed(2)}</strong></div>
    <div class="metric"><span>索提诺比率</span><strong>${s.sortino.toFixed(2)}</strong></div>
    <div class="metric"><span>下行波动率</span><strong>${pct(s.downsideVol)}</strong></div>
    <div class="metric"><span>最大回撤</span><strong class="down">${pct(s.maxDd)}</strong></div>
    <div class="metric"><span>最佳单日</span><strong class="up">${pct(s.best)}</strong></div>
    <div class="metric"><span>最差单日</span><strong class="down">${pct(s.worst)}</strong></div>
    <div class="metric"><span>交易笔数</span><strong>${state.trades.length}</strong></div>
    <div class="metric"><span>累计费用</span><strong>${money(state.trades.reduce((a, t) => a + t.fees, 0))}</strong></div>`;
  drawEquityCurve(range.length >= 2 ? range : state.equity, s.drawdowns);
}

function drawEquityCurve(equity = state.equity, drawdowns = reportStats(equity).drawdowns) {
  const canvas = $("equityCurve"); if (!canvas) return;
  const ctx = canvas.getContext("2d"), rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(900, Math.floor(rect.width || 900)); canvas.height = Math.floor(rect.height || 260);
  const w = canvas.width, h = canvas.height, vals = equity.map((e) => e.total);
  const max = Math.max(...vals), min = Math.min(...vals), pad = 28;
  ctx.clearRect(0, 0, w, h); ctx.strokeStyle = css("--line"); ctx.beginPath(); ctx.moveTo(pad, h - pad); ctx.lineTo(w - pad, h - pad); ctx.stroke();
  ctx.strokeStyle = css("--brand"); ctx.lineWidth = 2; ctx.beginPath();
  vals.forEach((v, i) => { const x = pad + i / Math.max(1, vals.length - 1) * (w - pad * 2), y = pad + (max - v) / Math.max(1, max - min) * (h * 0.6 - pad); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.stroke();
  ctx.strokeStyle = css("--down"); ctx.beginPath();
  drawdowns.forEach((d, i) => { const x = pad + i / Math.max(1, drawdowns.length - 1) * (w - pad * 2), y = h * 0.7 + Math.abs(d.value) / Math.max(0.01, Math.abs(Math.min(...drawdowns.map((x) => x.value)))) * (h * 0.22); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.stroke();
  ctx.fillStyle = css("--muted"); ctx.font = "12px Consolas"; ctx.fillText(`${equity[0]?.date || ""} ${money(vals[0] || 0)}  -  ${equity.at(-1)?.date || ""} ${money(vals.at(-1) || 0)}`, pad, 18); ctx.fillText("净值曲线 / 回撤曲线", pad, h - 10);
}

function showError(error) {
  const box = $("appError");
  if (!box) return alert(error.message || String(error));
  box.hidden = false;
  box.textContent = error.message || String(error);
}

function boot() {
$("loadSample").addEventListener("click", () => loadSample().catch(showError));
$("fileInput").addEventListener("change", async (e) => {
  try {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    await setData(file.name.toLowerCase().endsWith(".csv") ? parseCsv(text) : JSON.parse(text));
  } catch (err) {
    showError(err);
  }
});
document.querySelectorAll("input[name=mode]").forEach((el) => el.addEventListener("change", () => { state.mode = el.value; document.querySelectorAll(".mode-card").forEach((c) => c.classList.toggle("selected", c.querySelector("input").checked)); renderSetup(); }));
$("symbolSearch")?.addEventListener("input", renderSetup);
[$("conditionA"), $("conditionB"), $("conditionAValue"), $("conditionBValue"), $("conditionLogic")].forEach((el) => el?.addEventListener("input", () => { applyBlindFilterSelection(); renderSetup(); }));
[$("conditionA"), $("conditionB"), $("conditionAValue"), $("conditionBValue"), $("conditionLogic")].forEach((el) => el?.addEventListener("change", () => { applyBlindFilterSelection(); renderSetup(); }));
$("symbolList").addEventListener("change", (e) => { const sym = e.target.dataset.symbol; if (!sym) return; e.target.checked ? state.selected.add(sym) : state.selected.delete(sym); if (state.selected.size > 500) { state.selected.delete(sym); e.target.checked = false; alert("最多选择500个标的"); } renderSetup(); });
$("selectAll").addEventListener("click", () => { state.selected = new Set(visibleSymbols().filter((s) => s.valid).slice(0, 500).map((s) => s.symbol)); renderSetup(); });
$("randomStart").addEventListener("click", () => { const min = new Date($("startDate").min), max = new Date($("startDate").max); if (!Number.isFinite(min.getTime()) || !Number.isFinite(max.getTime())) return; $("startDate").value = new Date(min.getTime() + Math.random() * (max - min)).toISOString().slice(0, 10); });
$("startSim").addEventListener("click", startSimulation);
$("tabs").addEventListener("click", (e) => { if (e.target.dataset.tab) { state.active = e.target.dataset.tab; renderAll(); } });
$("buyBtn").addEventListener("click", () => placeOrder("buy")); $("sellBtn").addEventListener("click", () => placeOrder("sell"));
$("cancelOrders").addEventListener("click", () => { $("tradeHint").textContent = "提示已清空。"; }); $("nextDay").addEventListener("click", nextDay); $("finishSim").addEventListener("click", () => finishSimulation());
$("indicatorSelect").addEventListener("change", () => { syncIndicatorParams(true); drawChart(); }); $("maPeriods").addEventListener("input", drawChart); $("indicatorParams").addEventListener("input", drawChart); $("themeToggle").addEventListener("click", () => { document.body.classList.toggle("dark"); $("themeToggle").textContent = document.body.classList.contains("dark") ? "亮色" : "深色"; drawChart(); });
[$("lotInput"), $("amountInput"), $("orderByLots"), $("orderByAmount")].forEach((el) => el?.addEventListener("input", updateOrderEstimate));
[$("orderByLots"), $("orderByAmount")].forEach((el) => el?.addEventListener("change", updateOrderEstimate));
document.querySelectorAll(".lot-quick").forEach((b) => b.addEventListener("click", () => { $("lotInput").value = b.dataset.lots; updateOrderEstimate(); }));
$("halfCash").addEventListener("click", () => { const r = rowAt(state.active); if (r) { $("lotInput").value = Math.max(1, Math.floor(fromCents(state.cashCents) * 0.5 / r.close / 100)); updateOrderEstimate(); } });
$("chart").addEventListener("mousemove", (e) => { const rows = rowsOf(state.active).filter((r) => r.date <= state.dates[state.index]).slice(-120); if (!rows.length) return; const rect = e.currentTarget.getBoundingClientRect(), i = Math.max(0, Math.min(rows.length - 1, Math.floor((e.clientX - rect.left - 46) / ((rect.width - 69) / rows.length)))); const r = rows[i]; $("crosshairInfo").textContent = `${r.date} 开:${r.open.toFixed(2)} 高:${r.high.toFixed(2)} 低:${r.low.toFixed(2)} 收:${r.close.toFixed(2)} 量:${Math.round(r.volume).toLocaleString()} 涨跌幅:${pct(r.close / r.pre_close - 1)}`; });
window.addEventListener("resize", () => state.active && drawChart());
syncIndicatorParams(false);
loadSample().catch(showError);
}

try {
  boot();
} catch (error) {
  showError(error);
}
