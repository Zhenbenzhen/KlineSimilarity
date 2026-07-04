"""Fetch A-share daily data with rqdatac, following DataAccess.ipynb's pattern.

Usage:
  python scripts/fetch_rqdatac_daily.py --out data/a_share_daily_10y.json

Credentials are intentionally not embedded. Configure rqdatac in your environment
or edit only your local runtime to call rq.init(...).
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Iterable

import pandas as pd


DEFAULT_SYMBOLS = [
    ("600000.SH", "浦发银行"),
    ("600009.SH", "上海机场"),
    ("600016.SH", "民生银行"),
    ("600028.SH", "中国石化"),
    ("600030.SH", "中信证券"),
    ("600036.SH", "招商银行"),
    ("600050.SH", "中国联通"),
    ("600104.SH", "上汽集团"),
    ("600519.SH", "贵州茅台"),
    ("601318.SH", "中国平安"),
]


def fetch(symbols: Iterable[tuple[str, str]], start_date: str, end_date: str) -> list[dict]:
    import rqdatac as rq

    # Same conversion path as the notebook: ts_code -> RiceQuant instrument id.
    ts_codes = [code for code, _ in symbols]
    names = dict(symbols)
    rq_codes = rq.id_convert(ts_codes)
    rows: list[dict] = []

    for ts_code, rq_code in zip(ts_codes, rq_codes):
        print(f"处理 {ts_code} -> {rq_code}")
        data = rq.get_price(
            rq_code,
            start_date=pd.Timestamp(start_date).strftime("%Y-%m-%d"),
            end_date=pd.Timestamp(end_date).strftime("%Y-%m-%d"),
            frequency="1d",
            fields=["open", "high", "low", "close", "volume"],
            adjust_type="none",
        )
        if data is None or data.empty:
            print("  无数据")
            continue

        dates = data.index.get_level_values(-1) if isinstance(data.index, pd.MultiIndex) else data.index
        df = pd.DataFrame(
            {
                "date": pd.to_datetime(dates).strftime("%Y-%m-%d"),
                "open": data["open"].astype(float).to_numpy(),
                "high": data["high"].astype(float).to_numpy(),
                "low": data["low"].astype(float).to_numpy(),
                "close": data["close"].astype(float).to_numpy(),
                "volume": data["volume"].astype(float).to_numpy(),
            }
        ).drop_duplicates(subset=["date"]).sort_values("date")
        df["pre_close"] = df["close"].shift(1)
        df.loc[df.index[0], "pre_close"] = df.loc[df.index[0], "close"]
        df.insert(0, "name", names[ts_code])
        df.insert(0, "symbol", ts_code)
        rows.extend(df.to_dict(orient="records"))
        print(f"  {len(df)} 条记录 ({df['date'].iloc[0]} 到 {df['date'].iloc[-1]})")

    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", default="2016-01-01")
    parser.add_argument("--end", default=pd.Timestamp.today().strftime("%Y-%m-%d"))
    parser.add_argument("--out", default="data/a_share_daily_10y.json")
    args = parser.parse_args()

    rows = fetch(DEFAULT_SYMBOLS, args.start, args.end)
    output = {"source": "rqdatac", "start": args.start, "end": args.end, "data": rows}
    path = Path(args.out)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"写入 {path}: {len(rows)} 行")


if __name__ == "__main__":
    main()
