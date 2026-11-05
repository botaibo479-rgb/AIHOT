# 研究模块：标的、行情与观察清单

Hubble 的第 2 步（[执行方案](../../docs/research-plan.md)）。这个模块只管三件事：

- 给目录里的标的取行情；
- 按报道的聚合程度提名观察清单，再由你确认；
- 通过网页、JSON、MCP 把这些数据交出去。

模块不调模型，也不改引擎。

## 标的目录：`instruments.json`

这里列的是“能取到行情的标的”，不是观察清单。每一项的字段：

| 字段 | 含义 |
|---|---|
| `id` | 网址和接口里用的名字，上线后不要改 |
| `market` / `kind` | 市场与工具类型（现货与永续、股票、ETF、指数、利率、汇率、商品现货），页面上写清楚是哪一种 |
| `entityId` | 对应 `industry/taxonomy.ts` 的 `ENTITIES`，用它数相关报道，也用它把行情放到主题页上 |
| `role` | `candidate` 可以被提名；`context` 是市场背景（指数、利率、美元、汇率），不提名，总在背景里显示 |
| `quote` | `binance`、`okx`（加密，公开接口不要 key）、`twelvedata`（美股和 ETF 日线）、`fred`（指数、利率、汇率、原油现货日价）；`null` 表示还没接行情（港股） |

`nominate` 是提名门槛：默认 72 小时内至少 3 个独立来源报道。`signals` 是筛选标记的阈值。

改了目录，重启 api 和 worker 生效。名字写错、实体不存在或数据源和类型对不上时，进程启动就报错。

## 数据源

| 数据源 | 用在哪 | 需要 | 频率 |
|---|---|---|---|
| Binance 公开接口 | 加密现货价格、24 小时成交额，USDT 永续的资金费率、未平仓量、标记价和指数价，日 K 与每日未平仓量 | 不要 key | 快照每 15 分钟，日线每天 08:12（北京时间） |
| OKX 公开接口 | 同上（symbol 写成 `BTC-USDT`，永续自动用 `BTC-USDT-SWAP`） | 不要 key | 同上 |
| Twelve Data | 美股和 ETF 日线收盘 | `TWELVEDATA_API_KEY`（免费档） | 每天一次，每个标的一次请求 |
| FRED | 标普 500、纳指、VIX、美债收益率、实际利率、美元指数、汇率、WTI 与 Brent 现货 | `FRED_API_KEY`（免费） | 每天一次 |

这些接口在写代码的机器上都连不上，只用本地假服务测过。部署到香港服务器后，先实测再用：

1. 在 `.env` 里设 `COLLECT_ENABLED=true`，重启 worker。
2. 看后台“运行”页里 `research.snapshots` 和 `research.daily` 的结果，失败的标的会写出原因。
3. Binance 不通就把目录里加密标的的 `source` 改成 `okx`，symbol 改成 `BTC-USDT` 这种写法。

没配 key 的数据源，它的标的会被跳过，运行结果里写明缺哪个 key，不影响别的标的。

## 观察清单

观察清单不预先写死，分三步：

1. **提名**：每天 08:25 按 `nominate` 门槛自动提名。
2. **你来决定**：观察或放弃，接口是 `POST /api/research/watch/<id>`，用推送令牌鉴权。

   ```bash
   curl -X POST http://<主机>:3000/api/research/watch/sol \
     -H "Authorization: Bearer $INGEST_TOKEN" -H "Content-Type: application/json" \
     -d '{"state":"watching","reason":"升级前观察"}'
   ```

3. **提名不会改掉你的决定**：你放弃过的标的，之后报道再多也不会被重新提名，要改只能由你再调一次这个接口。

## 筛选标记

标记都按 `signals` 里的固定阈值算，只是“值得看一眼”的提示，不是验证过的交易信号：

- **资金异动**：未平仓量 7 日变化、成交额相对 20 日均值、资金费率，任一项超过阈值。
- **资金先动，讨论未扩散**：有资金异动，但 48 小时内报道它的来源很少。
- **传播在扩散**：48 小时内的独立来源够多，并且比前 48 小时多。
- **传播扩散，价格未明显反应**：在“传播在扩散”的基础上，24 小时涨跌还很小。

## 读取

| 地址 | 内容 |
|---|---|
| `/watchlist` | 网页：观察中、已提名、市场背景、其他可查的标的 |
| `/topics/<实体>` | 标的的主题页顶部显示它的行情卡片 |
| `GET /api/research/instruments` | 全部标的的 JSON |
| `GET /api/research/instruments/<id 或代码>` | 单个标的，含最近 30 个日值 |
| MCP `hubble_get_instrument` | 不带参数返回观察清单和市场背景，带 `symbol`（如 `btc`、`IBIT`、`dgs10`）返回单个标的 |
| `/api/v1/agent/instruments` | 给只能读网页的 Agent 的 Markdown |

快照保留 30 天，日线永久保留。
