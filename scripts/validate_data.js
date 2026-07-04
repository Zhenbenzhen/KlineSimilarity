import { readFile } from "node:fs/promises";

const file = process.argv[2] || "data/a_share_daily_10y.json";
const required = ["symbol", "name", "date", "open", "high", "low", "close", "volume", "pre_close"];
const payload = JSON.parse(await readFile(file, "utf8"));
const rows = Array.isArray(payload) ? payload : payload.data;
if (!Array.isArray(rows)) throw new Error("data must be an array or {data: array}");

const missing = required.filter((key) => rows.some((row) => !(key in row)));
if (missing.length) throw new Error(`missing fields: ${missing.join(", ")}`);

const groups = new Map();
for (const row of rows) {
  for (const key of ["open", "high", "low", "close", "volume", "pre_close"]) {
    if (!Number.isFinite(Number(row[key]))) throw new Error(`${row.symbol} ${row.date} invalid ${key}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) throw new Error(`${row.symbol} invalid date ${row.date}`);
  if (!groups.has(row.symbol)) groups.set(row.symbol, []);
  groups.get(row.symbol).push(row);
}

const summary = [];
for (const [symbol, list] of groups) {
  list.sort((a, b) => a.date.localeCompare(b.date));
  const dates = new Set(list.map((row) => row.date));
  if (dates.size !== list.length) throw new Error(`${symbol} has duplicated dates`);
  if (list.length < 100) throw new Error(`${symbol} has less than 100 trading days`);
  summary.push({ symbol, count: list.length, start: list[0].date, end: list.at(-1).date });
}

if (groups.size < 10) throw new Error(`expected about 10 symbols, got ${groups.size}`);
console.table(summary);
console.log(`validated ${rows.length} rows across ${groups.size} symbols`);
