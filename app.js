const REQUIRED = ["symbol", "name", "date", "open", "high", "low", "close", "volume", "pre_close"];
const MA_COLORS = { 5: "#ff9a62", 10: "#6c9bcf", 20: "#b192d4", 60: "#79b8a3", 120: "#a8b5c0", 250: "#c0a8a8" };
const EXTRA_MA_COLORS = ["#ff9a62", "#6c9bcf", "#b192d4", "#79b8a3", "#a8b5c0", "#c0a8a8", "#b99b68", "#8c9dab"];
const INDICATORS = {
  close:      { label: "收盘价",       group: "价格" },
  open:       { label: "开盘价",       group: "价格" },
  high:       { label: "最高价",       group: "价格" },
  low:        { label: "最低价",       group: "价格" },
  change_pct: { label: "涨跌幅%",     group: "价格" },
  volume:     { label: "成交量",       group: "成交量" },
  vol_ratio:  { label: "量比",         group: "成交量" },
  ma5:        { label: "MA5",          group: "均线" },
  ma10:       { label: "MA10",         group: "均线" },
  ma20:       { label: "MA20",         group: "均线" },
  ma60:       { label: "MA60",         group: "均线" },
  ma120:      { label: "MA120",        group: "均线" },
  ma250:      { label: "MA250",        group: "均线" },
  close_ma5:  { label: "收盘/MA5%",    group: "均线" },
  close_ma20: { label: "收盘/MA20%",   group: "均线" },
  close_ma60: { label: "收盘/MA60%",   group: "均线" },
  ma5_ma20:   { label: "MA5/MA20%",    group: "均线" },
  macd_dif:   { label: "MACD DIF",     group: "MACD" },
  macd_dea:   { label: "MACD DEA",     group: "MACD" },
  macd_hist:  { label: "MACD柱",       group: "MACD" },
  rsi14:      { label: "RSI14",        group: "RSI" },
  kdj_k:      { label: "KDJ K",        group: "KDJ" },
  kdj_d:      { label: "KDJ D",        group: "KDJ" },
  kdj_j:      { label: "KDJ J",        group: "KDJ" },
  wr14:       { label: "WR14",         group: "WR" },
  bias6:      { label: "BIAS6%",       group: "BIAS" },
  bias12:     { label: "BIAS12%",      group: "BIAS" },
  bias24:     { label: "BIAS24%",      group: "BIAS" },
  boll_mid:   { label: "BOLL中轨",     group: "BOLL" },
  boll_up:    { label: "BOLL上轨",     group: "BOLL" },
  boll_low:   { label: "BOLL下轨",     group: "BOLL" },
  obv:        { label: "OBV",          group: "其他" },
  br:         { label: "BR",           group: "其他" },
};

const state = {
  raw: [], symbols: [], selected: new Set(), mode: "blind", aliases: new Map(), active: null,
  index: 0, dates: [], settings: {}, cashCents: 0, positions: new Map(), pending: [], trades: [], roundTrips: [], stopOrders: new Map(), equity: [], finished: false, todayTrades: [],
  drawings: { tool: null, draft: null, bySymbol: new Map() },
  chartView: null, simFilterActive: false,
  filter: {
    setup: { active: false, conditions: [], logic: "and", formula: "" },
    sim:   { active: false, conditions: [], logic: "and", formula: "" }
  }
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

function computeIndicators(rows, dateLimit) {
  let data = rows;
  if (dateLimit) data = rows.filter((r) => r.date <= dateLimit);
  if (data.length < 2) return {};
  const last = data.length - 1;
  const closes = data.map((r) => r.close), highs = data.map((r) => r.high), lows = data.map((r) => r.low), vols = data.map((r) => r.volume);
  const emaCalc = (n) => { const k = 2 / (n + 1), out = []; closes.forEach((x, i) => out[i] = i ? x * k + out[i - 1] * (1 - k) : x); return out; };
  const maCalc = (n) => sma(closes, n);
  const volMa = (n) => sma(vols, n);
  const e12 = emaCalc(12), e26 = emaCalc(26);
  const dif = closes.map((_, i) => e12[i] - e26[i]);
  const dea = []; dif.forEach((x, i) => dea[i] = i ? x * 0.2 + dea[i - 1] * 0.8 : x);
  const hist = dif.map((x, i) => (x - dea[i]) * 2);
  let gains = [], losses = [];
  for (let i = 1; i < closes.length; i++) { gains[i] = Math.max(0, closes[i] - closes[i - 1]); losses[i] = Math.max(0, closes[i - 1] - closes[i]); }
  const rsiFn = (n) => { if (last < n) return 50; const g = gains.slice(last + 1 - n, last + 1).reduce((a, b) => a + b, 0); const l = losses.slice(last + 1 - n, last + 1).reduce((a, b) => a + b, 0); return 100 * g / Math.max(1e-9, g + l); };
  const kArr = [], dArr = [], jArr = [];
  closes.forEach((x, i) => { const lo = Math.min(...lows.slice(Math.max(0, i + 1 - 9), i + 1)), hi = Math.max(...highs.slice(Math.max(0, i + 1 - 9), i + 1)); const rsv = (x - lo) / Math.max(1e-9, hi - lo) * 100; kArr[i] = (i ? kArr[i - 1] * 2 : 50) / 3 + rsv / 3; dArr[i] = (i ? dArr[i - 1] * 2 : 50) / 3 + kArr[i] / 3; jArr[i] = 3 * kArr[i] - 2 * dArr[i]; });
  const wrFn = (n) => { const lo = Math.min(...lows.slice(last + 1 - n, last + 1)), hi = Math.max(...highs.slice(last + 1 - n, last + 1)); return -100 * (hi - closes[last]) / Math.max(1e-9, hi - lo); };
  const biasFn = (n) => { const m = maCalc(n); return m[last] != null ? (closes[last] - m[last]) / m[last] * 100 : null; };
  const bollMa = maCalc(20), bollSd = last >= 19 ? Math.sqrt(closes.slice(last - 19, last + 1).reduce((a, x) => a + (x - bollMa[last]) ** 2, 0) / 20) : 0;
  const bollUp = bollMa[last] != null ? bollMa[last] + 2 * bollSd : null, bollLow = bollMa[last] != null ? bollMa[last] - 2 * bollSd : null;
  let obvArr = [0]; for (let i = 1; i < closes.length; i++) obvArr[i] = obvArr[i - 1] + (closes[i] > closes[i - 1] ? vols[i] : closes[i] < closes[i - 1] ? -vols[i] : 0);
  let brVal = null; if (last >= 26) { let sumUp = 0, sumDn = 0; for (let j = last - 25; j <= last; j++) { sumUp += highs[j] - (j > 0 ? closes[j - 1] : closes[j]); sumDn += (j > 0 ? closes[j - 1] : closes[j]) - lows[j]; } brVal = sumDn > 0 ? sumUp / sumDn * 100 : null; }
  return {
    close: closes[last], open: data[last].open, high: highs[last], low: lows[last],
    change_pct: data[last].pre_close ? (closes[last] / data[last].pre_close - 1) * 100 : 0,
    volume: vols[last],
    vol_ratio: volMa(20)[last] != null ? vols[last] / volMa(20)[last] : null,
    ma5: maCalc(5)[last], ma10: maCalc(10)[last], ma20: maCalc(20)[last],
    ma60: maCalc(60)[last], ma120: maCalc(120)[last], ma250: maCalc(250)[last],
    close_ma5: maCalc(5)[last] != null ? (closes[last] / maCalc(5)[last] - 1) * 100 : null,
    close_ma20: maCalc(20)[last] != null ? (closes[last] / maCalc(20)[last] - 1) * 100 : null,
    close_ma60: maCalc(60)[last] != null ? (closes[last] / maCalc(60)[last] - 1) * 100 : null,
    ma5_ma20: maCalc(20)[last] != null && maCalc(5)[last] != null ? (maCalc(5)[last] / maCalc(20)[last] - 1) * 100 : null,
    macd_dif: dif[last], macd_dea: dea[last], macd_hist: hist[last],
    rsi14: rsiFn(14), kdj_k: kArr[last], kdj_d: dArr[last], kdj_j: jArr[last],
    wr14: wrFn(14), bias6: biasFn(6), bias12: biasFn(12), bias24: biasFn(24),
    boll_mid: bollMa[last], boll_up: bollUp, boll_low: bollLow,
    obv: obvArr[last], br: brVal,
  };
}

function tokenizeFormula(formula) {
  const tokens = [], src = formula.toUpperCase().replace(/\s+/g, " ").trim();
  let i = 0;
  while (i < src.length) {
    if (" \t".includes(src[i])) { i++; continue; }
    if (/\d/.test(src[i]) || (src[i] === "." && i + 1 < src.length && /\d/.test(src[i + 1]))) { let n = ""; while (i < src.length && /[\d.]/.test(src[i])) n += src[i++]; tokens.push({ type: "num", value: parseFloat(n) }); continue; }
    if (src[i] === ">" && src[i + 1] === "=") { tokens.push({ type: "op", value: ">=" }); i += 2; continue; }
    if (src[i] === "<" && src[i + 1] === "=") { tokens.push({ type: "op", value: "<=" }); i += 2; continue; }
    if (src[i] === "!" && src[i + 1] === "=") { tokens.push({ type: "op", value: "!=" }); i += 2; continue; }
    if (src[i] === "=" && src[i + 1] === "=") { tokens.push({ type: "op", value: "==" }); i += 2; continue; }
    if (src[i] === ">" || src[i] === "<") { tokens.push({ type: "op", value: src[i] }); i++; continue; }
    if (src[i] === "(") { tokens.push({ type: "lparen" }); i++; continue; }
    if (src[i] === ")") { tokens.push({ type: "rparen" }); i++; continue; }
    if ("+-*/".includes(src[i])) { tokens.push({ type: "arith", value: src[i] }); i++; continue; }
    if (/[A-Z_]/.test(src[i])) { let id = ""; while (i < src.length && /[A-Z_0-9]/.test(src[i])) id += src[i++]; if (id === "AND") tokens.push({ type: "and" }); else if (id === "OR") tokens.push({ type: "or" }); else if (id === "NOT") tokens.push({ type: "not" }); else tokens.push({ type: "var", name: id }); continue; }
    i++;
  }
  return tokens;
}

function parseFormula(tokens) {
  let pos = 0;
  const peek = () => tokens[pos], next = () => tokens[pos++];
  function parseOr() { let l = parseAnd(); while (peek()?.type === "or") { next(); l = { type: "or", left: l, right: parseAnd() }; } return l; }
  function parseAnd() { let l = parseNot(); while (peek()?.type === "and") { next(); l = { type: "and", left: l, right: parseNot() }; } return l; }
  function parseNot() { if (peek()?.type === "not") { next(); return { type: "not", child: parseNot() }; } return parseCmp(); }
  function parseCmp() { let l = parseAdd(); if (peek()?.type === "op") { const op = next().value, r = parseAdd(); return { type: "cmp", op, left: l, right: r }; } return l; }
  function parseAdd() { let l = parseMul(); while (peek()?.type === "arith" && "+-".includes(peek().value)) { const op = next().value; l = { type: "arith", op, left: l, right: parseMul() }; } return l; }
  function parseMul() { let l = parseUnary(); while (peek()?.type === "arith" && "*/".includes(peek().value)) { const op = next().value; l = { type: "arith", op, left: l, right: parseUnary() }; } return l; }
  function parseUnary() { if (peek()?.type === "arith" && peek().value === "-") { next(); return { type: "neg", child: parsePrimary() }; } return parsePrimary(); }
  function parsePrimary() { const t = peek(); if (!t) throw new Error("公式不完整"); if (t.type === "num") { next(); return { type: "num", value: t.value }; } if (t.type === "var") { next(); return { type: "var", name: t.name }; } if (t.type === "lparen") { next(); const e = parseOr(); if (peek()?.type === "rparen") next(); return e; } throw new Error(`意外的符号: ${t.type}`); }
  return parseOr();
}

function evalAST(node, vars) {
  if (!node) return 0;
  switch (node.type) {
    case "num": return node.value;
    case "var": { const v = vars[node.name]; if (v === undefined || v === null) return 0; return v; }
    case "neg": return -evalAST(node.child, vars);
    case "not": return evalAST(node.child, vars) ? 0 : 1;
    case "arith": { const l = evalAST(node.left, vars), r = evalAST(node.right, vars); if (node.op === "+") return l + r; if (node.op === "-") return l - r; if (node.op === "*") return l * r; if (node.op === "/") return r !== 0 ? l / r : Infinity; return 0; }
    case "cmp": { const l = evalAST(node.left, vars), r = evalAST(node.right, vars); if (node.op === ">") return l > r ? 1 : 0; if (node.op === ">=") return l >= r ? 1 : 0; if (node.op === "<") return l < r ? 1 : 0; if (node.op === "<=") return l <= r ? 1 : 0; if (node.op === "==") return Math.abs(l - r) < 1e-9 ? 1 : 0; if (node.op === "!=") return Math.abs(l - r) >= 1e-9 ? 1 : 0; return 0; }
    case "and": return (evalAST(node.left, vars) && evalAST(node.right, vars)) ? 1 : 0;
    case "or": return (evalAST(node.left, vars) || evalAST(node.right, vars)) ? 1 : 0;
    default: return 0;
  }
}

function symbolMatchesFilter(symbolInfo, filterState, currentDate) {
  if (!filterState || !filterState.active) return true;
  if (filterState.formula) {
    try {
      const ind = computeIndicators(symbolInfo.rows, currentDate || undefined);
      const tokens = tokenizeFormula(filterState.formula);
      const ast = parseFormula(tokens);
      return !!evalAST(ast, ind);
    } catch { return true; }
  }
  if (!filterState.conditions || !filterState.conditions.length) return true;
  const ind = computeIndicators(symbolInfo.rows, currentDate || undefined);
  const results = filterState.conditions.map((c) => {
    const val = ind[c.indicator] ?? 0;
    switch (c.operator) {
      case ">": return val > c.value;
      case ">=": return val >= c.value;
      case "<": return val < c.value;
      case "<=": return val <= c.value;
      case "=": return Math.abs(val - c.value) < 1e-9;
      case "!=": return Math.abs(val - c.value) >= 1e-9;
      default: return true;
    }
  });
  return filterState.logic === "and" ? results.every(Boolean) : results.some(Boolean);
}

function visibleSymbols() {
  const keyword = ($("symbolSearch")?.value || "").trim().toLowerCase();
  return state.symbols.filter((s) => {
    if (state.mode === "asset" && keyword && !`${s.symbol} ${s.name}`.toLowerCase().includes(keyword)) return false;
    if (!symbolMatchesFilter(s, state.filter.setup)) return false;
    return true;
  });
}

function simFilteredList() {
  if (!state.filter.sim.active) return selectedSymbols();
  const currentDate = state.dates[state.index];
  return selectedSymbols().filter((s) => symbolMatchesFilter(s, state.filter.sim, currentDate));
}

function applyBlindFilterSelection() {
  if (state.mode !== "blind") return;
  state.selected = new Set(visibleSymbols().filter((s) => s.valid).slice(0, 500).map((s) => s.symbol));
}

function renderFilterBuilder(container, context) {
  const groups = {};
  for (const [key, info] of Object.entries(INDICATORS)) { if (!groups[info.group]) groups[info.group] = []; groups[info.group].push({ key, label: info.label }); }
  let optionsHtml = "";
  for (const [group, items] of Object.entries(groups)) { optionsHtml += `<optgroup label="${group}">`; for (const item of items) optionsHtml += `<option value="${item.key}">${item.label}</option>`; optionsHtml += "</optgroup>"; }
  const fs = state.filter[context];
  container.innerHTML = `
    <div class="condition-builder" data-context="${context}">
      <div class="condition-rows"></div>
      <div class="condition-controls">
        <button class="add-condition ghost" type="button">+ 添加条件</button>
        <label class="filter-logic-label">逻辑
          <select class="filter-logic"><option value="and">全部满足(AND)</option><option value="or">任一满足(OR)</option></select>
        </label>
      </div>
      <div class="formula-section">
        <button class="toggle-formula ghost" type="button">高级: 公式模式</button>
        <div class="formula-editor hidden">
          <textarea class="formula-input" placeholder="例: CLOSE > MA60 AND RSI14 > 50">${fs.formula || ""}</textarea>
          <div class="formula-help">
            <strong>变量:</strong> CLOSE, OPEN, HIGH, LOW, VOLUME, CHANGE_PCT, VOL_RATIO, MA5, MA10, MA20, MA60, MA120, MA250, CLOSE_MA5, CLOSE_MA20, CLOSE_MA60, MA5_MA20, MACD_DIF, MACD_DEA, MACD_HIST, RSI14, KDJ_K, KDJ_D, KDJ_J, WR14, BIAS6, BIAS12, BIAS24, BOLL_UP, BOLL_MID, BOLL_LOW, OBV, BR<br>
            <strong>运算符:</strong> &gt;, &gt;=, &lt;, &lt;=, ==, !=, +, -, *, / &nbsp; <strong>逻辑:</strong> AND, OR, NOT &nbsp; <strong>括号:</strong> ()<br>
            <strong>示例:</strong> CLOSE > MA60 AND RSI14 > 50 | (KDJ_J < 20 OR RSI14 < 30) AND CLOSE > MA5
          </div>
        </div>
      </div>
      <div class="filter-summary">${fs.active ? (fs.formula ? "公式: " + fs.formula : (fs.conditions.length ? fs.conditions.map((c) => `${INDICATORS[c.indicator]?.label || c.indicator} ${c.operator} ${c.value}`).join(fs.logic === "and" ? " AND " : " OR ") : "无条件")) : "未启用"}</div>
      <div class="filter-actions">
        <button class="apply-filter" type="button">应用筛选</button>
        <button class="clear-filter ghost" type="button">清除</button>
      </div>
    </div>`;
  const builder = container.querySelector(".condition-builder");
  const rowsContainer = builder.querySelector(".condition-rows");
  builder.querySelector(".filter-logic").value = fs.logic || "and";
  let nextRowId = 0;
  function addRow(indicator = "close", operator = ">", value = 0) {
    const row = document.createElement("div"); row.className = "condition-row"; row.dataset.rowId = nextRowId++;
    row.innerHTML = `<select class="cond-indicator">${optionsHtml}</select><select class="cond-operator"><option value=">">&gt;</option><option value=">=">&gt;=</option><option value="<">&lt;</option><option value="<=">&lt;=</option><option value="=">=</option><option value="!=">!=</option></select><input class="cond-value" type="number" step="any" value="${value}" /><button class="cond-remove ghost" type="button" title="删除条件">✕</button>`;
    row.querySelector(".cond-indicator").value = indicator;
    row.querySelector(".cond-operator").value = operator;
    rowsContainer.appendChild(row);
    row.querySelector(".cond-remove").addEventListener("click", () => { row.remove(); updateFS(); });
    row.querySelectorAll(".cond-indicator, .cond-operator, .cond-value").forEach((el) => el.addEventListener("input", updateFS));
  }
  function readConditions() {
    const conds = []; rowsContainer.querySelectorAll(".condition-row").forEach((row) => { conds.push({ indicator: row.querySelector(".cond-indicator").value, operator: row.querySelector(".cond-operator").value, value: Number(row.querySelector(".cond-value").value) || 0 }); }); return conds;
  }
  function updateFS() {
    const isFormula = !builder.querySelector(".formula-editor").classList.contains("hidden");
    fs.active = true;
    if (isFormula) { fs.formula = builder.querySelector(".formula-input").value.trim(); fs.conditions = []; } else { fs.formula = ""; fs.logic = builder.querySelector(".filter-logic").value; fs.conditions = readConditions(); }
    const summary = builder.querySelector(".filter-summary");
    summary.textContent = fs.formula ? `公式: ${fs.formula}` : (fs.conditions.length ? fs.conditions.map((c) => `${INDICATORS[c.indicator]?.label || c.indicator} ${c.operator} ${c.value}`).join(fs.logic === "and" ? " AND " : " OR ") : "无条件");
  }
  if (fs.conditions && fs.conditions.length) { fs.conditions.forEach((c) => addRow(c.indicator, c.operator, c.value)); } else { addRow(); }
  builder.querySelector(".add-condition").addEventListener("click", () => { addRow(); updateFS(); });
  builder.querySelector(".filter-logic").addEventListener("change", updateFS);
  builder.querySelector(".toggle-formula").addEventListener("click", () => { const ed = builder.querySelector(".formula-editor"); ed.classList.toggle("hidden"); builder.querySelector(".toggle-formula").textContent = ed.classList.contains("hidden") ? "高级: 公式模式" : "关闭公式模式"; });
  builder.querySelector(".apply-filter").addEventListener("click", () => { updateFS(); if (context === "setup") { applyBlindFilterSelection(); renderSetup(); } else { state.simFilterActive = fs.active; renderAll(); } });
  builder.querySelector(".clear-filter").addEventListener("click", () => { fs.active = false; fs.conditions = []; fs.formula = ""; fs.logic = "and"; rowsContainer.innerHTML = ""; addRow(); builder.querySelector(".filter-logic").value = "and"; builder.querySelector(".filter-summary").textContent = "未启用"; builder.querySelector(".formula-input").value = ""; if (context === "setup") { applyBlindFilterSelection(); renderSetup(); } else { state.simFilterActive = false; renderAll(); } });
}

async function loadSample() {
  if (window.KLINE_SAMPLE_DATA) {
    await setData(window.KLINE_SAMPLE_DATA);
    return;
  }
  const res = await fetch("data/a_share_daily_10y.json", { cache: "no-store" });
  if (!res.ok) throw new Error("未找到内置数据 data/a_share_daily_10y.json，请点击右上角「导入数据」上传 CSV/JSON 文件");
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
  state.cashCents = toCents(state.settings.initialCash); state.pending = []; state.positions = new Map(); state.trades = []; state.roundTrips = []; state.stopOrders = new Map(); state.equity = []; state.todayTrades = []; state.finished = false;
  state.drawings = { tool: null, draft: null, bySymbol: state.drawings?.bySymbol || new Map() };
  state.chartView = null;
  $("setup").classList.add("hidden"); $("result").classList.add("hidden"); $("simulator").classList.remove("hidden");
  renderFilterBuilder(document.getElementById("simFilterContainer"), "sim");
  markEquity(); renderAll();
}

function selectedSymbols() { return state.symbols.filter((s) => state.selected.has(s.symbol)); }
function rowsOf(symbol) { return state.symbols.find((s) => s.symbol === symbol)?.rows || []; }
function rowAt(symbol, offset = 0) { const d = state.dates[state.index + offset]; return rowsOf(symbol).find((r) => r.date === d) || null; }
function lastPrice(symbol) { return rowAt(symbol)?.close ?? [...rowsOf(symbol)].reverse().find((r) => r.date <= state.dates[state.index])?.close ?? 0; }
function label(symbol) { const s = state.symbols.find((x) => x.symbol === symbol); return state.mode === "blind" ? state.aliases.get(symbol) : `${s.name} ${symbol}`; }

function posOf(symbol) {
  let p = state.positions.get(symbol);
  if (!p) { p = { lots: [] }; state.positions.set(symbol, p); }
  return p;
}
function posShares(p) { return p.lots.reduce((a, l) => a + l.shares, 0); }
function posCost(p) { return p.lots.reduce((a, l) => a + l.costCents, 0); }
function posLocked(p) { return p.lots.reduce((a, l) => a + (l.index >= state.index ? l.shares : 0), 0); }
function posSellable(p) { return p.lots.reduce((a, l) => a + (l.index < state.index ? l.shares : 0), 0); }
function posExists(symbol) { const p = state.positions.get(symbol); return !!p && posShares(p) > 0; }

function positionValueCents() {
  let total = 0;
  for (const [sym, p] of state.positions) { if (posShares(p) > 0) total += toCents(lastPrice(sym)) * posShares(p); }
  return total;
}
function totalAssetCents() { return state.cashCents + positionValueCents(); }
function markEquity() { state.equity.push({ date: state.dates[state.index], total: totalAssetCents() }); }

function estimateAt(symbol, side, lots, row) {
  if (!row) throw new Error("该标的今日停牌，不能交易");
  const shares = lots * 100, price = row.close, gross = toCents(price) * shares;
  const commission = roundFee(gross * state.settings.commissionRate);
  const stamp = side === "sell" ? roundFee(gross * state.settings.stampTaxRate) : 0;
  const slippage = roundFee(gross * state.settings.slippageRate);
  const cash = side === "buy" ? gross + commission + slippage : gross - commission - stamp - slippage;
  return { row, shares, price, gross, commission, stamp, slippage, cash };
}
function estimate(symbol, side, lots) { return estimateAt(symbol, side, lots, rowAt(symbol)); }

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
  const priceMode = $("priceOpen")?.checked ? "open" : "close";
  try {
    if (priceMode === "open") {
      const nextRow = rowAt(state.active, 1) || rowAt(state.active);
      const e = estimateAt(state.active, side, lots, nextRow);
      if (side === "buy" && e.cash > state.cashCents) throw new Error(`可用资金不足，还需 ${money(e.cash - state.cashCents)}`);
      if (side === "sell") {
        const p = state.positions.get(state.active);
        const locked = p ? posLocked(p) : 0, availNow = p ? posSellable(p) : 0;
        const availNext = availNow + locked;
        if (availNext < e.shares && locked > 0) throw new Error(`持仓不足，当前${Math.floor(availNext / 100)}手可卖（含次日解冻的${locked / 100}手）`);
        if (availNext < e.shares) throw new Error(`持仓不足，当前仅 ${Math.floor(availNext / 100)} 手`);
      }
      state.pending.push({ side, symbol: state.active, lots, priceMode });
      const msg = `已挂次日开盘价委托：${side === "buy" ? "买入" : "卖出"} ${lots} 手（约按 ${money(e.cash)} 成交），可撤销。`;
      $("tradeHint").textContent = msg;
      toast(msg);
      renderAll();
      return;
    }
    tryExecute({ side, symbol: state.active, lots, priceMode });
    renderAll();
  } catch (err) { $("tradeHint").textContent = err.message; toast(`下单未成功：${err.message}`); renderAll(); }
}

function tryExecute(order) {
  const e = estimate(order.symbol, order.side, order.lots);
  if (order.side === "sell") {
    const p = state.positions.get(order.symbol);
    const locked = p ? posLocked(p) : 0, avail = p ? posSellable(p) : 0;
    if (avail < e.shares && locked > 0) { $("tradeHint").textContent = `当日买入${locked / 100}手需次交易日才能卖出，当前可卖${Math.floor(avail / 100)}手`; return; }
    if (avail < e.shares) { $("tradeHint").textContent = `持仓不足，当前可卖${Math.floor(avail / 100)}手`; return; }
  }
  const done = executeOrder(order);
  const msg = done ? `下单成功：已按当日收盘价${order.side === "buy" ? "买入" : "卖出"} ${order.lots} 手。` : "下单未成功：委托未成交或资金/持仓不足。";
  $("tradeHint").textContent = msg;
  toast(msg);
}

function executeOrder(order, row) {
  const refRow = row || rowAt(order.symbol);
  const priceMode = order.priceMode || "close";
  const e = estimateAt(order.symbol, order.side, order.lots, refRow);
  let lots = order.lots;
  const limitHit = Math.abs(e.row.close / e.row.pre_close - 1) >= 0.095;
  const capacity = Math.max(1, Math.floor((e.row.volume || 0) * state.settings.capacityRate));
  if (lots > 1 && lots > capacity) {
    const prob = Math.min(1, capacity / lots) * (limitHit ? 0.3 : 1);
    lots = Math.random() < prob ? lots : Math.max(1, capacity);
  }
  const final = estimateAt(order.symbol, order.side, lots, e.row);
  const p = posOf(order.symbol);
  if (order.side === "buy") {
    if (final.cash > state.cashCents) return false;
    state.cashCents -= final.cash;
    p.lots.push({ shares: final.shares, costCents: final.cash, date: state.dates[state.index], index: state.index, priceMode });
    state.trades.push({ date: state.dates[state.index], symbol: order.symbol, side: "buy", lots, price: final.price, fees: final.commission + final.stamp + final.slippage, priceMode });
  } else {
    if (posSellable(p) < final.shares) return false;
    let remaining = final.shares;
    for (let i = 0; i < p.lots.length && remaining > 0;) {
      const lot = p.lots[i];
      if (lot.index >= state.index) { i++; continue; }
      const take = Math.min(lot.shares, remaining);
      const proceeds = Math.round(final.cash * take / final.shares);
      const cost = Math.round(lot.costCents * take / lot.shares);
      state.roundTrips.push({ buyDate: lot.date, sellDate: state.dates[state.index], symbol: order.symbol, shares: take, cost, proceeds, pnl: proceeds - cost, priceMode: lot.priceMode || "close" });
      lot.shares -= take; lot.costCents -= cost; remaining -= take;
      if (lot.shares <= 0) { p.lots.splice(i, 1); } else { i++; }
    }
    state.cashCents += final.cash;
    if (posShares(p) <= 0) state.positions.delete(order.symbol);
    state.trades.push({ date: state.dates[state.index], symbol: order.symbol, side: "sell", lots, price: final.price, fees: final.commission + final.stamp + final.slippage, priceMode });
  }
  state.todayTrades.push({ date: state.dates[state.index], symbol: order.symbol, side: order.side, lots, shares: final.shares, price: final.price, amount: final.cash, priceMode });
  return true;
}

function processPending() {
  if (!state.pending.length) return;
  const pending = state.pending;
  state.pending = [];
  for (const o of pending) {
    const row = rowAt(o.symbol);
    if (!row) { toast(`${label(o.symbol)} 今日停牌，委托已撤销`); continue; }
    const done = executeOrder({ side: o.side, symbol: o.symbol, lots: o.lots, priceMode: o.priceMode || "open" }, row);
    if (!done) toast(`${label(o.symbol)} 的${o.side === "buy" ? "买入" : "卖出"}委托未成交（资金/持仓不足或流动性太差）`);
  }
}

function cancelPendingOrders() {
  if (!state.pending.length) { toast("当前没有可撤销的委托"); return; }
  const n = state.pending.length;
  state.pending = [];
  $("tradeHint").textContent = `已撤销 ${n} 笔未成交委托。`;
  renderAll();
}

function setStopOrder() {
  const stop = Math.max(0, Number($("slStop")?.value || 0) || 0);
  const take = Math.max(0, Number($("slTake")?.value || 0) || 0);
  const lots = Math.max(0, Math.floor(Number($("slLots")?.value || 0) || 0));
  if (!stop && !take) { toast("请至少填写止损价或止盈价"); return; }
  if (!posExists(state.active)) { toast("当前标的没有持仓，无法设置条件单"); return; }
  state.stopOrders.set(state.active, { stop: stop || null, take: take || null, shares: lots ? lots * 100 : 0 });
  renderAll();
  toast(`已为 ${label(state.active)} 设置止盈止损`);
}

function cancelStopOrder(symbol) {
  state.stopOrders.delete(symbol);
  renderAll();
}

function processStopOrders() {
  for (const [sym, so] of [...state.stopOrders]) {
    const p = state.positions.get(sym);
    if (!p || posShares(p) <= 0) { state.stopOrders.delete(sym); continue; }
    const row = rowAt(sym);
    if (!row) continue;
    const hitStop = so.stop !== null && row.close <= so.stop;
    const hitTake = so.take !== null && row.close >= so.take;
    if (!hitStop && !hitTake) continue;
    const avail = posSellable(p);
    const shares = Math.min(so.shares || avail, avail);
    if (shares < 100) continue;
    state.stopOrders.delete(sym);
    const done = executeOrder({ side: "sell", symbol: sym, lots: Math.floor(shares / 100) }, row);
    toast(done
      ? (hitStop ? `止损触发：${label(sym)} ${Math.floor(shares / 100)}手按当日收盘价卖出` : `止盈触发：${label(sym)} ${Math.floor(shares / 100)}手按当日收盘价卖出`)
      : `止盈/止损触发但成交失败（流动性不足或持仓锁定）`);
  }
}

function nextDay() {
  state.todayTrades = [];
  state.index += 1;
  const reachedEnd = state.index >= state.dates.length - 1;
  if (reachedEnd) {
    state.pending = [];
    processStopOrders();
    return finishSimulation();
  }
  processPending();
  processStopOrders();
  markEquity(); renderAll();
}

function finishSimulation() {
  state.finished = true;
  if (state.pending.length) { state.pending = []; toast("模拟结束，未成交委托已撤销"); }
  markEquity(); renderAll(); renderResult();
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
  const priceMode = $("priceOpen")?.checked ? "open" : "close";
  const refRow = priceMode === "open" ? (rowAt(state.active, 1) || row) : row;
  const buy = estimateAt(state.active, "buy", lots, refRow), sell = estimateAt(state.active, "sell", lots, refRow);
  const priceNote = priceMode === "open" ? "（次日开盘价估算）" : "（当日收盘价）";
  const p = state.positions.get(state.active);
  const locked = p ? posLocked(p) : 0, availNow = p ? posSellable(p) : 0;
  const availRef = priceMode === "open" ? availNow + locked : availNow;
  const lockNote = availRef < lots * 100 && locked > 0 ? `<br><span class="down">当日买入${locked / 100}手需次交易日才能卖出，当前可卖${Math.floor(availRef / 100)}手</span>` : "";
  box.innerHTML = `手数 ${lots} / 股数 ${lots * 100}${priceNote}<br>买入需 ${money(buy.cash)}（含佣金和滑点）<br>卖出预计到账 ${money(sell.cash)}（当日可用可再买入）${lockNote}`;
}

const PERIOD_LABEL = { day: "日线", week: "周线", month: "月线" };

function periodOf() { return $("periodSelect")?.value || "day"; }

function weekKey(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}
function monthKey(dateStr) { return dateStr.slice(0, 7); }

function aggregateRows(rows, period) {
  const groups = [];
  let cur = null;
  for (const r of rows) {
    const key = period === "week" ? weekKey(r.date) : monthKey(r.date);
    if (!cur || cur.key !== key) { cur = { key, rows: [] }; groups.push(cur); }
    cur.rows.push(r);
  }
  const bars = groups.map((g) => {
    const rs = g.rows;
    return {
      symbol: rs[0].symbol, name: rs[0].name, date: rs[rs.length - 1].date, days: rs.length,
      open: rs[0].open, high: Math.max(...rs.map((r) => r.high)), low: Math.min(...rs.map((r) => r.low)),
      close: rs[rs.length - 1].close, volume: rs.reduce((a, r) => a + r.volume, 0), pre_close: rs[0].pre_close
    };
  });
  return bars.map((b, i, arr) => { b.pre_close = i ? arr[i - 1].close : rows[0].pre_close; return b; });
}

function chartRows(symbol) {
  const rows = rowsOf(symbol).filter((r) => r.date <= state.dates[state.index]);
  const period = periodOf();
  return period === "day" ? rows : aggregateRows(rows, period);
}

function chartHit(e) {
  const cv = state.chartView;
  if (!cv || !cv.view.length) return null;
  const rect = e.currentTarget.getBoundingClientRect();
  const px = e.clientX - rect.left, py = e.clientY - rect.top;
  if (py < 12 || py > cv.topH) return null;
  const i = Math.max(0, Math.min(cv.view.length - 1, Math.floor((px - 46) / ((rect.width - 69) / cv.view.length))));
  const p = cv.max - (py - 12) * (cv.max - cv.min) / (cv.topH - 24);
  return { i, date: cv.view[i].date, p };
}

function pushDrawing(item) {
  const list = state.drawings.bySymbol.get(state.active) || [];
  list.push(item);
  state.drawings.bySymbol.set(state.active, list);
  drawChart();
}

function drawItems() { return state.drawings.bySymbol.get(state.active) || []; }

function pointIndexByDate(view, date) {
  let lo = 0, hi = view.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; view[mid].date < date ? lo = mid + 1 : hi = mid; }
  if (lo >= view.length) return view[date > view[view.length - 1].date ? -1 : 0];
  return lo < 0 ? -1 : lo;
}

function renderDrawings(ctx, view, x, y, w) {
  const brand = css("--brand"), muted = css("--muted");
  const items = drawItems();
  ctx.lineWidth = 1.2;
  for (const d of items) {
    ctx.strokeStyle = brand;
    if (d.type === "hline") {
      const yy = y(d.p);
      ctx.beginPath(); ctx.moveTo(46, yy); ctx.lineTo(w - 10, yy); ctx.stroke();
      ctx.fillStyle = muted; ctx.font = "11px Consolas"; ctx.fillText(d.p.toFixed(2), w - 46, yy - 4);
      continue;
    }
    const i1 = pointIndexByDate(view, d.d1), i2 = pointIndexByDate(view, d.d2);
    if (i1 < 0 || i2 < 0) continue;
    const x1 = x(i1) + 3, x2 = x(i2) + 3, y1 = y(d.p1), y2 = y(d.p2);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.fillStyle = brand;
    ctx.fillRect(x1 - 2, y1 - 2, 4, 4); ctx.fillRect(x2 - 2, y2 - 2, 4, 4);
  }
  const draft = state.drawings.draft;
  if (draft && state.chartView) {
    const i1 = pointIndexByDate(view, draft.d1);
    if (i1 >= 0) {
      ctx.strokeStyle = muted;
      if (draft.type === "trend") {
        const i2 = pointIndexByDate(view, draft.d2);
        if (i2 >= 0) { ctx.beginPath(); ctx.moveTo(x(i1) + 3, y(draft.p1)); ctx.lineTo(x(i2) + 3, y(draft.p2)); ctx.stroke(); }
      }
    }
  }
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
  const w = rect.width, h = rect.height, period = periodOf(), rows = chartRows(state.active);
  ctx.clearRect(0, 0, w, h); if (!rows.length) return;
  const n = Math.min(120, rows.length), view = rows.slice(-n), topH = h * 0.56, volH = h * 0.18, indH = h * 0.2, pad = 46, gap = 14;
  const max = Math.max(...view.map((r) => r.high)), min = Math.min(...view.map((r) => r.low));
  const x = (i) => pad + i * ((w - pad * 1.5) / n) + 3, bw = Math.max(3, (w - pad * 1.5) / n * 0.62), y = (p) => 12 + (max - p) / (max - min || 1) * (topH - 24);
  state.chartView = { view, max, min, topH, rectWidth: w, rectHeight: h, period };
  view.forEach((r, i) => { const up = r.close >= r.open; ctx.strokeStyle = ctx.fillStyle = up ? css("--up") : css("--down"); const cx = x(i) + bw / 2; ctx.beginPath(); ctx.moveTo(cx, y(r.high)); ctx.lineTo(cx, y(r.low)); ctx.stroke(); ctx.globalAlpha = 0.88; ctx.fillRect(x(i), Math.min(y(r.open), y(r.close)), bw, Math.max(1, Math.abs(y(r.open) - y(r.close)))); ctx.globalAlpha = 1; });
  const series = calcSeries(rows); Object.entries(series.ma).forEach(([n2, vals], i) => drawLine(ctx, vals.slice(-view.length), x, y, MA_COLORS[n2] || EXTRA_MA_COLORS[i % EXTRA_MA_COLORS.length]));
  const type = $("indicatorSelect").value, ind = indicator(rows, type); if (ind.overlay) ind.overlay.forEach((l, i) => drawLine(ctx, l.values.slice(-view.length), x, y, ["#b192d4", "#d85a5a", "#4d9e7a"][i]));
  const baseY = topH + gap, vmax = Math.max(...view.map((r) => r.volume));
  view.forEach((r, i) => { ctx.fillStyle = r.close >= r.open ? css("--up") : css("--down"); ctx.globalAlpha = 0.55; ctx.fillRect(x(i), baseY + volH - r.volume / Math.max(1, vmax) * volH, bw, r.volume / Math.max(1, vmax) * volH); ctx.globalAlpha = 1; });
  const indY = baseY + volH + gap;
  if (ind.bars) drawBars(ctx, ind.bars.slice(-view.length), x, indY, indH, bw);
  ind.lines?.forEach((l, i) => drawIndicatorLine(ctx, l.values.slice(-view.length), x, indY, indH, ["#6c9bcf", "#ff9a62", "#b192d4"][i]));
  ctx.fillStyle = css("--muted"); ctx.font = "12px Consolas"; ctx.fillText(`${PERIOD_LABEL[period] || "日线"} ${view[0].date} - ${view.at(-1).date}（${period === "day" ? "逐日" : "每根含" + view.at(-1).days + "个交易日"}）`, pad, h - 8);
  ctx.fillText("VOL", pad, baseY + 12); ctx.fillText(type, pad, indY + 12);
  let hiI = 0, loI = 0;
  view.forEach((r, i) => { if (r.high > view[hiI].high) hiI = i; if (r.low < view[loI].low) loI = i; });
  drawRangeMark(ctx, "最高", view[hiI].high, view[hiI].date, css("--up"), x, y, w);
  drawRangeMark(ctx, "最低", view[loI].low, view[loI].date, css("--down"), x, y, w);
  renderDrawings(ctx, view, x, y, w);
}

function drawRangeMark(ctx, tag, value, dateStr, color, x, y, w) {
  const yy = y(value);
  ctx.strokeStyle = color; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(46, yy); ctx.lineTo(w - 10, yy); ctx.stroke();
  const text = `${tag} ${value.toFixed(2)} ${dateStr}`;
  ctx.font = "10px Consolas";
  const tw = Math.ceil(text.length * 6.2) + 14;
  const cx = Math.max(46, w - 16 - tw);
  ctx.fillStyle = color;
  ctx.fillRect(cx, yy - 9, tw, 18);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, cx + 7, yy + 4);
}

function drawLine(ctx, values, x, y, color) { ctx.strokeStyle = color; ctx.beginPath(); values.forEach((v, i) => { if (v == null) return; const xx = x(i) + 3, yy = y(v); i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); }); ctx.stroke(); }
function drawIndicatorLine(ctx, values, x, baseY, volH, color) { const vs = values.filter((v) => v != null); const max = Math.max(...vs), min = Math.min(...vs); drawLine(ctx, values, x, (v) => baseY + (max - v) / (max - min || 1) * volH, color); }
function drawBars(ctx, values, x, baseY, volH, bw) { const m = Math.max(1e-9, ...values.map(Math.abs)); values.forEach((v, i) => { ctx.fillStyle = v >= 0 ? css("--up") : css("--down"); const z = baseY + volH / 2; ctx.fillRect(x(i), v >= 0 ? z - Math.abs(v) / m * volH / 2 : z, bw, Math.max(1, Math.abs(v) / m * volH / 2)); }); }

function renderAll() {
  const row = rowAt(state.active), total = totalAssetCents(), pnl = total - toCents(state.settings.initialCash || 0);
  $("currentDate").textContent = state.dates[state.index] || "-"; $("totalAsset").textContent = money(total); $("cashAvailable").textContent = money(state.cashCents); $("positionValue").textContent = money(positionValueCents());
  $("floatingPnl").textContent = `${pnl >= 0 ? "+" : ""}${money(pnl)}`; $("floatingPnl").className = pnl >= 0 ? "up" : "down";
  $("modeBadge").textContent = state.mode === "blind" ? "盲选模式" : "资产配置模式"; $("activeTitle").textContent = label(state.active);
  $("tabs").innerHTML = simFilteredList().map((s) => `<button class="tab ${s.symbol === state.active ? "active" : ""}" data-tab="${s.symbol}">${label(s.symbol)}</button>`).join("");
  if (state.simFilterActive && !simFilteredList().find((s) => s.symbol === state.active) && simFilteredList().length) { state.active = simFilteredList()[0].symbol; }
  $("positions").innerHTML = [...state.positions].map(([sym, p]) => { const shares = posShares(p), val = toCents(lastPrice(sym)) * shares, pnlPos = val - posCost(p); const locked = posLocked(p); return `<div class="position-card"><strong>${label(sym)}</strong><span>${shares / 100}手 / 均价 ${(posCost(p) / Math.max(1, shares)).toFixed(2)} / 市值 ${money(val)}${locked ? `（当日买入${locked / 100}手锁定）` : ""}</span><br><span class="${pnlPos >= 0 ? "up" : "down"}">盈亏 ${money(pnlPos)} ${pct(pnlPos / Math.max(1, posCost(p)))}</span></div>`; }).join("") || "暂无持仓";
  $("todayPositions").innerHTML = state.todayTrades.filter((t) => t.side === "buy").map((t) => `<div class="position-card"><strong>${label(t.symbol)}</strong><span>今日买入 ${t.lots}手 @ ${t.price.toFixed(2)}</span><br><span>成交额 ${money(t.amount)}（${t.priceMode === "open" ? "次日开盘价" : "当日收盘价"}成交）</span></div>`).join("") || "暂无当日成交持仓";
  $("orders").innerHTML = state.trades.slice(-20).reverse().map((t) => `<div class="order-card"><strong>${t.date} ${label(t.symbol)}</strong>${t.side === "buy" ? "买入" : "卖出"} ${t.lots}手 @ ${t.price.toFixed(2)} / 费用 ${money(t.fees)}</div>`).join("") || "暂无交易";
  $("pendingOrders").innerHTML = state.pending.length
    ? state.pending.map((o, i) => `<div class="order-card pending-item"><span>${o.side === "buy" ? "买入" : "卖出"} ${label(o.symbol)} ${o.lots}手（次日开盘价成交）</span></div>`).join("")
    : "暂无挂单";
  $("pendingOrders").classList.toggle("empty", !state.pending.length);
  $("slList").innerHTML = state.stopOrders.size
    ? [...state.stopOrders].map(([sym, so]) => `<div class="sl-item"><strong>${label(sym)}</strong><span class="sl-meta">${so.stop !== null ? `止损 ≤ ${so.stop.toFixed(2)}` : ""}${so.stop !== null && so.take !== null ? " / " : ""}${so.take !== null ? `止盈 ≥ ${so.take.toFixed(2)}` : ""} · ${so.shares ? `${so.shares / 100}手` : "全部可卖"}</span><button class="ghost sl-cancel-pos" type="button" data-symbol="${sym}">取消</button></div>`).join("")
    : "暂无条件单";
  $("tradeHint").textContent = row ? `委托按${$("priceOpen")?.checked ? "次日开盘价" : "当日收盘价"}成交，现价 ${row.close.toFixed(2)}，涨跌幅 ${pct(row.close / row.pre_close - 1)}。` : "该标的今日停牌，不能交易。";
  updateOrderEstimate();
  drawChart();
}

function roundTripStats(rts) {
  const sorted = [...rts].sort((a, b) => a.sellDate.localeCompare(b.sellDate));
  const wins = sorted.filter((r) => r.pnl > 0), losses = sorted.filter((r) => r.pnl < 0);
  const winRate = sorted.length ? wins.length / sorted.length : 0;
  const avgWin = wins.length ? wins.reduce((a, r) => a + r.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((a, r) => a + r.pnl, 0) / losses.length : 0;
  const plRatio = avgLoss ? Math.abs(avgWin / avgLoss) : (avgWin ? Infinity : 0);
  let maxConsLoss = 0, cur = 0;
  for (const r of sorted) { if (r.pnl < 0) { cur += 1; maxConsLoss = Math.max(maxConsLoss, cur); } else cur = 0; }
  return { total: sorted.length, wins: wins.length, losses: losses.length, winRate, avgWin, avgLoss, plRatio, maxConsLoss };
}

function tradeStatsHtml(s, extra) {
  const plText = Number.isFinite(s.plRatio) ? s.plRatio.toFixed(2) : "∞";
  return `
    <div class="metric"><span>完整交易</span><strong>${s.total}</strong></div>
    <div class="metric"><span>胜率</span><strong class="${s.winRate >= 0.5 ? "up" : "down"}">${pct(s.winRate)}</strong></div>
    <div class="metric"><span>盈利/亏损笔数</span><strong><span class="up">${s.wins}</span> / <span class="down">${s.losses}</span></strong></div>
    <div class="metric"><span>盈亏比</span><strong>${plText}</strong></div>
    <div class="metric"><span>平均每笔盈利</span><strong class="up">${money(s.avgWin)}</strong></div>
    <div class="metric"><span>平均每笔亏损</span><strong class="down">${money(s.avgLoss)}</strong></div>
    <div class="metric"><span>最大连续亏损</span><strong class="down">${s.maxConsLoss} 次</strong></div>${extra || ""}`;
}

function roundTripsHtml(rts) {
  if (!rts.length) return `<div class="notice small">暂无已完成交易，先买入并在之后的交易日卖出才会产生完整交易记录。</div>`;
  const list = [...rts].sort((a, b) => b.sellDate.localeCompare(a.sellDate)).slice(0, 30);
  return list.map((r) => `<div class="order-card"><strong>${r.buyDate} → ${r.sellDate} ${label(r.symbol)}</strong>${r.shares / 100}股 / 成本 ${money(r.cost)} / 回款 ${money(r.proceeds)} / <span class="${r.pnl >= 0 ? "up" : "down"}">盈亏 ${money(r.pnl)}</span> <span class="meta-note">${r.priceMode === "open" ? "次日开盘价买入" : "当日收盘价买入"}</span></div>`).join("");
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
  const rt = roundTripStats(state.roundTrips);
  $("result").classList.remove("hidden");
  $("simulator").classList.add("hidden");
  $("result").innerHTML = `<div class="section-title"><p class="eyebrow">Result</p><h2>模拟结果</h2></div><div class="setup-grid"><label>报告起始日<input id="reportStart" type="date" value="${state.equity[0]?.date || ""}" /></label><label>报告结束日<input id="reportEnd" type="date" value="${state.equity.at(-1)?.date || ""}" /></label><label>训练模式<input id="reportMode" type="text" value="${state.mode === "blind" ? "盲选模式" : "资产配置模式"}" disabled /></label></div><div id="reportMetrics" class="result-grid">
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
    <div class="metric"><span>累计费用</span><strong>${money(state.trades.reduce((a, t) => a + t.fees, 0))}</strong></div>
    <div class="metric"><span>最终资产</span><strong>${money(last)}</strong></div>
    ${tradeStatsHtml(rt, "")}
  </div><h3 class="section-title compact">交易复盘（按卖出日倒序，最多展示30条）</h3><div id="roundTrips" class="orders">${roundTripsHtml(state.roundTrips)}</div><canvas id="equityCurve" class="equity-curve" width="1200" height="260"></canvas><div class="report-actions"><button id="backHome" type="button">返回首页</button></div>`;
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
  const rt = roundTripStats(state.roundTrips.filter((r) => r.sellDate >= start && r.sellDate <= end));
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
    ${tradeStatsHtml(rt, `<div class="metric"><span>区间累计费用</span><strong>${money(state.trades.filter((t) => t.date >= start && t.date <= end).reduce((a, t) => a + t.fees, 0))}</strong></div>`)}
  `;
  const roundTripsEl = $("roundTrips");
  if (roundTripsEl) roundTripsEl.innerHTML = roundTripsHtml(state.roundTrips.filter((r) => r.sellDate >= start && r.sellDate <= end));
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

// Old applySimFilter/clearSimFilter replaced by renderFilterBuilder

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
$("symbolList").addEventListener("change", (e) => { const sym = e.target.dataset.symbol; if (!sym) return; e.target.checked ? state.selected.add(sym) : state.selected.delete(sym); if (state.selected.size > 500) { state.selected.delete(sym); e.target.checked = false; alert("最多选择500个标的"); } renderSetup(); });
$("selectAll").addEventListener("click", () => { state.selected = new Set(visibleSymbols().filter((s) => s.valid).slice(0, 500).map((s) => s.symbol)); renderSetup(); });
$("randomStart").addEventListener("click", () => { const min = new Date($("startDate").min), max = new Date($("startDate").max); if (!Number.isFinite(min.getTime()) || !Number.isFinite(max.getTime())) return; $("startDate").value = new Date(min.getTime() + Math.random() * (max - min)).toISOString().slice(0, 10); });
$("startSim").addEventListener("click", startSimulation);
$("tabs").addEventListener("click", (e) => { if (e.target.dataset.tab) { state.active = e.target.dataset.tab; renderAll(); } });
$("buyBtn").addEventListener("click", () => placeOrder("buy")); $("sellBtn").addEventListener("click", () => placeOrder("sell"));
$("cancelOrders").addEventListener("click", cancelPendingOrders); $("nextDay").addEventListener("click", nextDay); $("finishSim").addEventListener("click", () => finishSimulation());
$("periodSelect")?.addEventListener("change", () => { state.chartView = null; drawChart(); });
$("slSet")?.addEventListener("click", setStopOrder);
$("slCancel")?.addEventListener("click", () => { if (state.stopOrders.has(state.active)) { cancelStopOrder(state.active); toast("已取消当前标的条件单"); } else toast("当前标的没有条件单"); });
$("slList")?.addEventListener("click", (e) => { const sym = e.target?.dataset?.symbol; if (sym) cancelStopOrder(sym); });
document.querySelectorAll(".draw-tool").forEach((b) => b.addEventListener("click", () => {
  const tool = state.drawings.tool === b.dataset.tool ? null : b.dataset.tool;
  state.drawings.tool = tool; state.drawings.draft = null;
  document.querySelectorAll(".draw-tool").forEach((x) => x.classList.toggle("active", x.dataset.tool === tool));
  toast(tool ? (tool === "trend" ? "趋势线：点击主图选取起点，再选终点" : "水平线：点击主图任意价位即可画线") : "已退出画线模式");
}));
document.querySelector(".draw-undo")?.addEventListener("click", () => { const list = drawItems(); if (!list.length) return toast("当前标的没有画线"); list.pop(); drawChart(); });
document.querySelector(".draw-clear")?.addEventListener("click", () => { state.drawings.bySymbol.delete(state.active); state.drawings.draft = null; drawChart(); toast("已清除当前标的画线"); });
window.addEventListener("keydown", (e) => { if (e.key === "Escape" && state.drawings.tool) { state.drawings.tool = null; state.drawings.draft = null; document.querySelectorAll(".draw-tool").forEach((x) => x.classList.remove("active")); drawChart(); } });
const chartEl = $("chart");
chartEl?.addEventListener("pointerdown", (e) => {
  if (!state.drawings.tool || !state.active) return;
  const hit = chartHit(e); if (!hit) return;
  e.preventDefault();
  if (state.drawings.tool === "hline") { pushDrawing({ type: "hline", p: hit.p }); return; }
  if (!state.drawings.draft) { state.drawings.draft = { type: "trend", d1: hit.date, p1: hit.p, d2: hit.date, p2: hit.p }; drawChart(); }
  else { pushDrawing({ type: "trend", d1: state.drawings.draft.d1, p1: state.drawings.draft.p1, d2: hit.date, p2: hit.p }); state.drawings.draft = null; }
});
chartEl?.addEventListener("pointermove", (e) => {
  if (!state.drawings.tool || !state.drawings.draft) return;
  const hit = chartHit(e); if (!hit) return;
  state.drawings.draft.d2 = hit.date; state.drawings.draft.p2 = hit.p;
  drawChart();
});
$("indicatorSelect").addEventListener("change", () => { syncIndicatorParams(true); drawChart(); }); $("maPeriods").addEventListener("input", drawChart); $("indicatorParams").addEventListener("input", drawChart); $("themeToggle").addEventListener("click", () => { document.body.classList.toggle("dark"); $("themeToggle").textContent = document.body.classList.contains("dark") ? "亮色" : "深色"; drawChart(); });
[$("lotInput"), $("amountInput"), $("orderByLots"), $("orderByAmount")].forEach((el) => el?.addEventListener("input", updateOrderEstimate));
[$("orderByLots"), $("orderByAmount")].forEach((el) => el?.addEventListener("change", updateOrderEstimate));
[$("priceClose"), $("priceOpen")].forEach((el) => el?.addEventListener("change", () => { if (state.active) { updateOrderEstimate(); renderAll(); } }));
document.querySelectorAll(".lot-quick").forEach((b) => b.addEventListener("click", () => { $("lotInput").value = b.dataset.lots; updateOrderEstimate(); }));
$("halfCash").addEventListener("click", () => { const r = rowAt(state.active); if (r) { $("lotInput").value = Math.max(1, Math.floor(fromCents(state.cashCents) * 0.5 / r.close / 100)); updateOrderEstimate(); } });
$("chart").addEventListener("mousemove", (e) => {
  const rows = state.chartView?.view || chartRows(state.active).slice(-120);
  if (!rows.length) return;
  const rect = e.currentTarget.getBoundingClientRect(), i = Math.max(0, Math.min(rows.length - 1, Math.floor((e.clientX - rect.left - 46) / ((rect.width - 69) / rows.length))));
  const r = rows[i];
  $("crosshairInfo").textContent = `${PERIOD_LABEL[periodOf()] || "日线"} ${r.date} 开:${r.open.toFixed(2)} 高:${r.high.toFixed(2)} 低:${r.low.toFixed(2)} 收:${r.close.toFixed(2)} 量:${Math.round(r.volume).toLocaleString()} 涨跌幅:${pct(r.close / r.pre_close - 1)}`;
});
window.addEventListener("resize", () => state.active && drawChart());
syncIndicatorParams(false);
renderFilterBuilder(document.getElementById("setupFilterContainer"), "setup");
loadSample().catch(showError);
}

try {
  boot();
} catch (error) {
  showError(error);
}

if (typeof window !== "undefined") {
  window.KLINE = { state, posShares, posCost, posSellable, posLocked, roundTripStats };
}
