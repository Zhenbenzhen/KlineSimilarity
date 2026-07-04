import { mkdir, writeFile } from "node:fs/promises";

const symbols = [
  ["600000.SH", "浦发银行"],
  ["600009.SH", "上海机场"],
  ["600016.SH", "民生银行"],
  ["600028.SH", "中国石化"],
  ["600030.SH", "中信证券"],
  ["600036.SH", "招商银行"],
  ["600050.SH", "中国联通"],
  ["600104.SH", "上汽集团"],
  ["600519.SH", "贵州茅台"],
  ["601318.SH", "中国平安"],
];

const start = process.argv[2] || "20160101";
const end = process.argv[3] || new Date().toISOString().slice(0, 10).replaceAll("-", "");

function secid(symbol) {
  const code = symbol.slice(0, 6);
  return `${symbol.endsWith(".SH") ? 1 : 0}.${code}`;
}

async function fetchOne(symbol, name) {
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
    return {
      symbol,
      name,
      date,
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number(volume),
      pre_close: Number(prev),
    };
  });
  console.log(`${symbol} ${name}: ${rows.length} rows`);
  return rows;
}

const data = [];
for (const [symbol, name] of symbols) data.push(...await fetchOne(symbol, name));

await mkdir("data", { recursive: true });
await writeFile(
  "data/a_share_daily_10y.json",
  JSON.stringify({ source: "eastmoney", start, end, data }, null, 0),
  "utf8",
);
console.log(`saved data/a_share_daily_10y.json: ${data.length} rows`);
