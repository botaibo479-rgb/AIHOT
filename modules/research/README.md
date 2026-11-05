# 研究模块：行情、观察清单、事件日历、研究简报与判断档案

Hubble 的第 2–4 步（[执行方案](../../docs/research-plan.md)）。这个模块管五件事：

- 给目录里的标的取行情；
- 按报道的聚合程度提名观察清单，再由你确认；
- 事件日历：官方日程表，加上从公开报道里读出的未来事件；
- 每天一份研究简报：候选卡，以及只追加、不覆盖的判断档案；
- 通过网页、JSON、MCP 把这些数据交出去。

调模型的只有两步：“研究：从报道里抽未来事件”和“研究：候选卡”。引擎不改。

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

## 事件日历

事件有三个来源：

1. **官方日程表** `calendar.json`：FOMC、非农、CPI、PPI 等，每年从官方页面手录一次，每项带 `url`。
   - `confirmation` 只能是 `official`（机构已确认）或 `tentative`（机构自己标为暂定，比如 Fed 下一年的会议）。
   - 每 30 分钟同步一次：改了日期的跟着改，删掉的撤下（留记录）。
   - 现在录的是 2026 年 12 月的 FOMC、非农、CPI、PPI，2027 年 1 月的非农和 CPI，以及 2027 年全年的 FOMC（暂定）。2026-11-05 录入，用前到 url 再核对一次。
2. **公开报道**：每 30 分钟读最近 3 天的精选和高分报道（平均分不低于 `industry/selection.ts` 的 `understandFloor`），每篇的每个版本只读一次。提示词是 `industry/prompts/research-catalyst.md`。模型说的事件要过这几道检查才上日历：
   - 原文里找得到逐字引句；
   - 涉及的实体在名录里；
   - 日期真实存在，并且还没过去；
   - 没有日期的“正式事件”降为暂定。

   同一日期、同一精度、至少有一个相同实体的事件算同一件：后来的报道并进去，保留每篇出处；确认等级只升不降。
3. **你自己记的**：用推送令牌调用接口添加。

   ```bash
   curl -X POST http://<主机>:3000/api/research/events -H "Authorization: Bearer $INGEST_TOKEN" -H "Content-Type: application/json" \
     -d '{"title":"某交易所上线 SOL 新合约","date":"2026-11-12","confirmation":"official","entities":["solana"],"url":"https://…"}'
   ```

读错的事件用 `POST /api/research/events/<id>/withdraw`（body 写 `{"reason":"…"}`）撤下，不删除。

三类事件始终分开列：

- **正式日程**：机构已公布的日期。
- **暂定安排**：计划、预计、机构自己标为暂定的日期。
- **研究推测**：只是有人这样猜，不是日程。

不给概率，不写“市场共识”。

## 研究简报与判断档案

研究简报每天 08:45（北京时间）生成一次，写好后不改。顺序是：

1. **核对进行中的判断**：只看带价位的条件。
   - 价格越过失效价 → 已失效；越过触发价 → 已触发；离触发价不到 3% → 接近触发；过了观察期 → 到期。
   - 每次变化追加一条修订；判断结束时自动追加复盘：期间涨跌，以及同期 BTC（加密）或 SPY（其他）的涨跌。
2. **挑标的写候选卡**：最多 8 个，按以下顺序优先：观察中、已提名、有筛选标记、7 天内有正式事件。已有进行中判断的标的不再写。
   - 提示词是 `industry/prompts/research-card.md`，可以用 `RESEARCH_MODEL` 单独换模型。
   - 模型看到的每个事实都有编号：行情指标如 `perp.openInterestChange7d`，报道 `a:<id>`，事件 `e:<id>`。
3. **检查候选卡**，以下内容会被去掉：
   - 引用了输入里没有的编号的证据；
   - 写了输入里没有的名字或数字的句子（用引擎的 `grounded()` 核对）；
   - 带“概率、共识、已定价、目标价、必涨、主力成本”等词的句子；
   - 离现价 10 倍以外的价位。
4. **决定等级**：既没有资本权也没有规则权证据，或缺少触发、失效条件的，只能算线索，不开立判断。
5. **开立判断**：合格候选开立一条判断，记下开立时的价格。

模型调用关闭、预算用完或服务出错时，简报照常生成，只是没有候选卡，并在“生成时的问题”里写明原因。

判断档案只追加：开立、状态变化、复盘、笔记，每次一条修订，写明时间、原因、是谁（模型、规则核对、站长），之前的修订原样保留。你自己的判断和决定用推送令牌写：

```bash
# 开立一条自己的判断
curl -X POST http://<主机>:3000/api/research/theses -H "Authorization: Bearer $INGEST_TOKEN" -H "Content-Type: application/json" \
  -d '{"instrument":"gld","whyNow":"…","triggers":[{"text":"站上 250","price":250,"op":">="}],"invalidations":[{"text":"跌破 230","price":230,"op":"<="}],"horizonDays":21}'
# 追加笔记，或改状态（watching / triggered / invalidated / withdrawn）
curl -X POST http://<主机>:3000/api/research/theses/<id>/revisions -H "Authorization: Bearer $INGEST_TOKEN" -H "Content-Type: application/json" \
  -d '{"kind":"status","status":"withdrawn","reason":"逻辑不成立"}'
```

已结束的判断只能追加笔记，不能重新打开。

## 读取

| 地址 | 内容 |
|---|---|
| `/brief` | 网页：最新的研究简报 |
| `/theses` | 网页：判断档案，每条判断带全部修订 |
| `/watchlist` | 网页：观察中、已提名、市场背景、其他可查的标的 |
| `/calendar` | 网页：未来 45 天的事件，正式、暂定、推测分开 |
| `/topics/<实体>` | 标的的主题页顶部显示它的行情卡片和未来 21 天的事件 |
| `GET /api/research/instruments` | 全部标的的 JSON |
| `GET /api/research/instruments/<id 或代码>` | 单个标的，含最近 30 个日值 |
| MCP `hubble_get_instrument` | 不带参数返回观察清单和市场背景，带 `symbol`（如 `btc`、`IBIT`、`dgs10`）返回单个标的 |
| `GET /api/research/events?days=21&instrument=sol` | 事件日历的 JSON（`days` 是 1–90，`instrument` 可选） |
| MCP `hubble_list_events` | 同上，参数 `days`、`instrument` 都可选 |
| `GET /api/research/briefs/latest`、`/api/research/briefs/<日期>` | 研究简报的 JSON |
| `GET /api/research/theses?status=open\|ended\|all`、`/api/research/theses/<id>` | 判断档案的 JSON |
| MCP `hubble_get_brief`、`hubble_get_thesis` | 研究简报（可带 `date`）；判断档案（不带 `id` 列进行中的，带 `id` 给全部修订） |
| `/api/v1/agent/instruments`、`/events`、`/brief`、`/theses` | 给只能读网页的 Agent 的 Markdown |

快照保留 30 天，日线永久保留。
