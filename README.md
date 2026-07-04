# KlineSimilarity

一个按 `K线模拟.md` 实现的本地静态 Web 模拟训练程序，支持导入真实日线数据后进行盲选模式或资产配置模式训练。

## 功能

- CSV / JSON 数据导入，字段遵循 PRD：`symbol,name,date,open,high,low,close,volume,pre_close`
- 数据校验与标的选择，少于 100 个交易日的标的不可选
- 盲选模式隐藏真实名称，资产配置模式显示名称代码
- K 线、成交量、MA5/10/20/60/120/250 与 MACD/KDJ/RSI/WR/BOLL/OBV/BIAS/BRAR
- 逐日步进、当日收盘价成交、T+1 卖出资金冻结
- 佣金、印花税、滑点、成交容量与涨跌停流动性折减
- 持仓、交易流水、终止清仓、收益率和最大回撤统计

## 运行

直接打开 `index.html` 即可。若浏览器限制本地 `fetch`，用任意静态服务器打开：

```bash
npx serve .
```

## 获取验证数据

严格参照 `DataAccess.ipynb` 的 `rqdatac` 方式：

```bash
python scripts/fetch_rqdatac_daily.py --start 2016-01-01 --out data/a_share_daily_10y.json
```

当前仓库也提供无密钥样例获取脚本，用 Eastmoney 拉取同一批 10 支 A 股主板日线数据用于本地验证：

```bash
npm run fetch:sample
npm test
```

样例股票：浦发银行、上海机场、民生银行、中国石化、中信证券、招商银行、中国联通、上汽集团、贵州茅台、中国平安。
