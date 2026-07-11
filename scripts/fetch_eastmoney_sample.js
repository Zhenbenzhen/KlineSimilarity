import { mkdir, readFile, writeFile } from "node:fs/promises";

const start = process.argv[2] || "20160101";
const end = process.argv[3] || new Date().toISOString().slice(0, 10).replaceAll("-", "");
const targetCount = Number(process.argv[4] || 500);
const columns = ["date", "open", "high", "low", "close", "volume", "pre_close"];

function isMainBoard(code) {
  return /^(600|601|603|605|000|001|002|003)\d{3}$/.test(code);
}

function symbolOf(code) {
  return `${code}.${code.startsWith("6") ? "SH" : "SZ"}`;
}

function secid(symbol) {
  const code = symbol.slice(0, 6);
  return `${symbol.endsWith(".SH") ? 1 : 0}.${code}`;
}

async function fetchStockList() {
  const stocks = [];
  const listTarget = Math.min(1600, Math.ceil(targetCount * 2.6));
  for (let page = 1; stocks.length < listTarget && page <= 80; page++) {
    const params = new URLSearchParams({
      pn: String(page),
      pz: "100",
      po: "1",
      np: "1",
      fltt: "2",
      invt: "2",
      fid: "f12",
      fs: "m:1+t:2,m:0+t:6",
      fields: "f12,f14",
    });
    const url = `https://push2.eastmoney.com/api/qt/clist/get?${params}`;
    let items = [];
    for (let attempt = 1; attempt <= 6; attempt++) {
      try {
        const res = await fetch(url, { headers: { referer: "https://quote.eastmoney.com/" } });
        if (!res.ok) throw new Error(`stock list HTTP ${res.status}`);
        items = (await res.json()).data?.diff || [];
        break;
      } catch (error) {
        if (attempt === 6) throw error;
        await new Promise((resolve) => setTimeout(resolve, 600 * attempt));
      }
    }
    if (!items.length) break;
    for (const item of items) {
      const code = String(item.f12 || "");
      if (!isMainBoard(code)) continue;
      stocks.push([symbolOf(code), item.f14 || code]);
      if (stocks.length >= listTarget) break;
    }
  }
  return stocks;
}

async function fetchOne(symbol, name, index, total) {
  const params = new URLSearchParams({
    secid: secid(symbol),
    fields1: "f1,f2,f3,f4,f5,f6",
    fields2: "f51,f52,f53,f54,f55,f56,f57,f61",
    klt: "101",
    fqt: "0",
    beg: start,
    end,
  });
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?${params}`;
  const res = await fetch(url, { headers: { referer: "https://quote.eastmoney.com/" } });
  if (!res.ok) throw new Error(`${symbol} HTTP ${res.status}`);
  const json = await res.json();
  const klines = json.data?.klines || [];
  const rows = klines.map((line, i) => {
    const [date, open, close, high, low, volume] = line.split(",");
    const prev = i === 0 ? close : klines[i - 1].split(",")[2];
    return [date, Number(open), Number(high), Number(low), Number(close), Number(volume), Number(prev)];
  });
  console.log(`${String(index + 1).padStart(3, "0")}/${total} ${symbol} ${name}: ${rows.length} rows`);
  return rows;
}

async function fetchOneWithRetry(symbol, name, index, total) {
  let lastError;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      return await fetchOne(symbol, name, index, total);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  throw lastError;
}

const stocks = await fetchStockList();
if (stocks.length < targetCount) console.warn(`only found ${stocks.length} main-board symbols`);

const symbols = [];
try {
  const existing = JSON.parse(await readFile("data/a_share_daily_10y.json", "utf8"));
  if (Array.isArray(existing.symbols)) symbols.push(...existing.symbols.filter((item) => item[2]?.length >= 100));
  console.log(`seeded ${symbols.length} existing symbols`);
} catch {}
const existingCodes = new Set(symbols.map((item) => item[0]));
const batchSize = 1;
for (let i = 0; i < stocks.length; i += batchSize) {
  const batch = stocks.slice(i, i + batchSize);
  if (batch.every(([symbol]) => existingCodes.has(symbol))) continue;
  const results = await Promise.all(batch.map(([symbol, name], j) => fetchOneWithRetry(symbol, name, i + j, stocks.length).then((rows) => [symbol, name, rows]).catch((error) => {
    console.warn(`${symbol} failed: ${error.message}`);
    return [symbol, name, []];
  })));
  symbols.push(...results.filter((item) => item[2].length >= 100));
  if (symbols.length >= targetCount) break;
  await new Promise((resolve) => setTimeout(resolve, 260));
}

await mkdir("data", { recursive: true });
const payload = { source: "eastmoney", compact: "grouped", start, end, columns, symbols: symbols.slice(0, targetCount) };
await writeFile("data/a_share_daily_10y.json", JSON.stringify(payload), "utf8");
await writeFile("data/sample-data.js", `window.KLINE_SAMPLE_DATA = ${JSON.stringify(payload)};\n`, "utf8");
console.log(`saved ${Math.min(symbols.length, targetCount)} symbols, ${symbols.slice(0, targetCount).reduce((a, item) => a + item[2].length, 0)} rows`);
