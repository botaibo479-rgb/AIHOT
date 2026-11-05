# 执行方案：用 AIHOT 框架做“以加密为主”的个人跨市场研究工具

## Context

你要把 AIHOT（行业热点站框架）从 AI 行业迁到个人投资研究：以加密为主，逐步覆盖美股/港股、黄金原油、主要指数和利率美元。新闻只当线索和证据，主输出是具体标的、行情、未来事件、三权证据、触发/失效条件，以及一份只追加、不覆盖的判断档案。
原则是复用框架，只在缺口上做最小补充。本轮只交方案，不做大规模改动。
方案依据：本仓库 HEAD `cd424b0` 的 README、`docs/*`、`industry/*`、`site/*`，以及 `apps/api`、`packages/backend` 的核心代码。
**Mass 站点（mass.holly.ink）在本环境被网络策略拒绝访问，搜索也找不到它的公开文档，所以它的 API/MCP 能力我无法核实。** 方案只借鉴你转述的方法，不接入 Mass。

---

## 1. 仓库理解（按实际代码核实）

**流程：** 信源采集 → 判重、取正文 → 预筛 → 同一标准独立评分两次 → 结构化 → 写标题摘要 → 归组成事件、算热度、写综述 → 过门槛进精选 → 日报（规则编排，不调模型）、周报月报（模型只写总述）→ 统一读取层 `packages/backend/src/publication/` → 网页、RSS、`/api/v1`、Agent Markdown、MCP。

**能直接复用到研究工具的能力：**

| 现有能力（位置） | 在研究工具里的用途 |
|---|---|
| 六种信源 + 外部推送（`docs/sources.md`）；分级 T1 / T1_5 / T2；参与方式 `hot_signal` 只当热度证据 | 收线索：交易所与项目公告、监管与央行一手发布、媒体、研究者 X 账号。分级直接就是证据可信度分层 |
| `structure.md` 抽出事实：主体、动作、对象、发生日期，外加原文证据句和前提条件。不是逐字出自原文的引文会被丢掉（`editorial/analyze.ts:167 normalizeStructure`） | “规则权”和“资本权”证据的原文出处；回答“机制是否真正执行” |
| 归组：同一件事一家媒体发十篇也只算一次（`events/group.ts`） | 区分“独立扩散”和“同一消息反复转载” |
| 热度：48 小时窗口内独立参与方各算一次，24 小时减半；和 6 小时前比，标“上升”“新”（`events/hot.ts`） | “叙事权”的注意力代理指标 |
| 主题页 company 组按 `entityId` 收报道；模块可以往主题页插部件（`topics.page` + 网页 `topicPage`） | 每个标的一个页面：新闻证据加行情、事件、判断 |
| 回执和预算熔断（`providers/receipts.ts` 的 `paidRequest`、`budgets`） | 给有额度的数据 API 做额度保护 |
| 模型调用 `chatJson`（`providers/llm.ts:148`）：带回执，受预算和 `MODEL_CALLS_ENABLED` 约束；模块可在 `models` 插口登记自己的步骤 | 抽未来事件、写候选卡 |
| `grounded(text, corpus)`（`reports/compose.ts:165`）：模型写出的名字和数字必须在输入里出现过 | 防止编造价格、概率和“共识” |
| 只追加的写法：`analyses` 只追加，`reports` + `report_revisions` 保留旧版本，`audit_log` 记录前后对照 | 判断档案“修改保留原文、时间、原因” |
| 模块系统（`packages/backend/src/modules.ts`、`apps/web/app/modules.ts`）：接口、定时任务、队列、模型步骤、`agent.abilities`（一个能力同时生成一个 MCP 工具和一个 `/api/v1/agent/...` Markdown 地址）、侧栏和底栏入口、页面、自带迁移 | 全部新功能放进一个模块，不改引擎 |

**可编程入口的实际情况（已核实）：**
- **MCP `/api/mcp`**：无状态的 Streamable HTTP，**匿名、只读、没有 API Key**。只校验 Host：必须是 `SITE_URL` 的主机、localhost，或 `MCP_ALLOWED_HOSTS` 里列的主机。
  - 共 7 个工具：`<前缀>_get_latest`、`_search`、`_get_hot_topics`、`_get_story`、`_get_daily`、`_get_weekly`、`_get_monthly`（`apps/api/src/routes/mcp.ts`）。前缀是 `SITE.mcpPrefix`，现在是 `myhot`。
- **`/api/v1/*`**：只有匿名 GET，写方法一律返回 405，进程里没有限流。
- **`/api/v1/agent`**：给 Agent 读的 Markdown 指南。
- **`/agent` 网页只是接入说明页**（给出 `claude mcp add`、`codex mcp add` 的复制片段），本身不是端点。
- **唯一带令牌的写入口是 `POST /api/ingest/items`**（`INGEST_TOKEN`）。它只收 title、url、publishedAt、author、raw，**不收正文**。
- 后台接口要 cookie 会话加 CSRF，不适合脚本调用。

**缺口（现有库不能直接满足）：**
1. 没有任何行情、标的概念。旧的模型榜价格表已在迁移 0053 删除。
2. 没有未来事件日历。`structure.md` 只抽“本次已发生的动作”，并且明确规定预告不能写成已发生。
3. 没有候选机会卡，也没有判断档案（状态、修订、复盘）。
4. 日报由 `reports/edition.ts` 按规则编排，**没有给模块加栏目的插口**。所以研究简报做成模块自己的页面和 MCP 工具，引擎日报保留为“证据日报”。
5. **没有“文章分析完成”的钩子**（`articleChanged` 首次分析时不触发），模块只能按计划任务轮询公开读取层。
6. MCP 和 v1 都是匿名只读的，写判断需要模块自己带令牌的接口。

---

## 2. 行业迁移（只改 `site/`、`industry/`，引擎不动）

| 文件 | 改什么 |
|---|---|
| `site/site.ts` | 站名（你定）、`subject`、首页和关于页文案、`REPORTS` 文案、`EDITION_TIMES`（日报建议 08:00）。`mcpPrefix` 在第一次接 MCP 之前定好，之后不再改 |
| `industry/taxonomy.ts` | 见下文的分类草案。`RELEASE = null`。`IDENTITY_LEXICON` 先只放主流币和公司，短代码（如 OP、ARB）写成带边界的正则，防止误判 |
| `industry/topics.json` | company 组改名为“标的与主体”，每个标的一个主题（`entityId`）；field 组放主题：ETF 资金、衍生品、解锁与供给、监管、利率与美元；genre 组放内容形态 |
| `industry/sources.json` | 首批信源草案见下文，需要你删改确认 |
| `industry/prompts/` | `prefilter`、`selection-score`、`structure`、`content-understanding`（类型和标签列表写死在提示词正文里，要手改）、`rules-domain`（金融/加密术语）、`summarize-*`、`rules-self-contained-title` 的例子、`story-digest`、`report-period` |
| `industry/wording.ts` | 压住喊单词：暴涨、起飞、必涨、抄底、梭哈、百倍、史诗级…… |
| `industry/selection.ts` | 先保留默认门槛。跑一到两周真实信源后，用你标注的 100–200 条，按 `docs/selection.md` 校准，**不凭感觉改数字** |
| `site/models.ts` | 默认用一个便宜模型；研究卡步骤可以单独指定更强的模型 |
| 写死的残留 | `site/public/openapi-v1.json` 的描述、`scripts/mcp-check.ts:72` 搜的 “OpenAI”、后台新建信源页的占位字；报头字用 `scripts/nameplates.ts` 重新生成 |
| `tests/` | 约 40 个测试文件用了 `ai-models`、`ai-products`、Anthropic 等示例，换成新行业的对应项，测的规则不改 |

**分类草案（需要你确认；`key` 上线后不能改）：**
- `CATEGORIES`（按市场分，也是日报的分节）：
  - `crypto` 加密
  - `equities` 美股港股
  - `commodities` 黄金原油
  - `macro` 利率美元宏观
  - `research` 研究观点（`commentary: true`）
- `CATEGORY_TAGS`（第一个标签，表示证据形态）：资金与持仓、机制与规则、日程与催化、公告与披露、监管与政策、宏观数据、研究观点、行情复盘、其他。“其他”必须放在最后，代码要求。
- `TOPIC_TAGS`：ETF、衍生品、链上、稳定币、解锁/供给、回购/销毁、治理、上币/下架、指数调整、财报、利率、美元、黄金、原油……
- `ENTITIES`：观察清单里的标的（bitcoin、ethereum、solana、nvidia、strategy、gold、crude-oil……）和关键机构（fed、sec、blackrock、binance……）。

**评分标准改法：保留结构，只换例子。** 内容类型、五维加权、噪声压制、安全边界都保留。
- `ITEM_TYPES` 换成：`capital_flow`、`mechanism_change`、`scheduled_catalyst`、`corporate_disclosure`、`macro_release`、`research_view`、`market_recap`。
- 五个维度改成投资含义：
  - sig：对定价的实质影响
  - nov：信息增量
  - cred：证据强度，可核验的数据或官方文件
  - reson：能否落到具体标的和工具
  - act：前瞻可准备度，即有没有明确的未来时间点或可观察条件
- 各类型权重先给初稿，再用标注样本校准。
- **正常评价：** 解锁、回购、销毁、费用开关；治理通过并执行；ETF 审批与持仓披露；交易所上新和下架；指数纳入和剔除；监管落地；央行决议和数据日程；财报指引；带可核验数据的资金异常。
- **压住：** 事后涨跌归因；没有依据的价格预测和喊单；不写来源去向的“巨鲸转账”；交易所营销、空投和返佣；技术形态帖；多事件早报合集；付费群引流。

**首批信源方向（地址实施时逐个用后台“预览抓取”核实）：**
- **T1 官方：** 美联储新闻 RSS、SEC 新闻、BLS/美国财政部发布、EIA；交易所公告（Binance、OKX、Coinbase）；以太坊基金会和 Solana 等项目博客；治理论坛的 Discourse RSS；观察清单公司的 SEC EDGAR 8-K Atom。SEC 要求请求头 User-Agent 带联系方式，用什么由你决定。
- **T2：** CoinDesk、The Block、Blockworks 等加密媒体的 RSS；财经媒体 RSS。
- **`hot_signal`：** 研究者和 KOL 的 X 账号（SocialData 按请求付费，可选）。

---

## 3. 框架落地（轻量，不建图谱）

**投机市场循环 → 4 个规则标记（不调模型，标为“未验证的筛选信号”，不当因果）：**
1. **资金先动：** 未平仓量、资金费率、成交额或 ETF 流量相对自身 30 日分布异常，同时这个标的 48 小时内相关事件的独立参与方少。
2. **传播扩散：** 相关事件的独立参与方在上升（热度“上升”或“新”），开始跨层级（T1 → T2 → `hot_signal`），但价格没有明显反应。
3. **机制临近：** N 天内有“正式”等级的事件（解锁、治理执行、指数调整、议息、财报）。
4. **汇合：** 满足 2 项以上才进候选；只满足 1 项的进“线索池”，只记录不包装。

**三权证据 = 候选卡上的三栏加一栏“缺口”。** 每条证据必须引用输入里存在的编号：指标名、文章或事件 id。

| 证据 | 来源 |
|---|---|
| 资本权 | 模块采集的行情和衍生品指标（写明数据源和时间）；资金类报道的结构化事实 |
| 叙事权 | 引擎的归组和热度：独立参与方数、来源层级分布、首次出现时间、6 小时趋势 |
| 规则权 | 结构化事实的原文证据句和前提条件；事件日历的确认等级 |

硬规则写进提示词，再由校验兜底：
- 大额转账不等于买卖；钱包标签不等于身份；不推断内幕。
- 没有可靠成本数据就不估“主力成本”。
- 不写概率、“市场共识”或“已经定价多少”。
- 缺失的证据写进“缺口”；只有叙事信号的，等级只能是“线索”。

**判断档案（只追加）：**
- `research_theses`：判断的身份（标的、创建时间、来自自动生成还是手工）。
- `research_thesis_revisions`：只追加。每条修订包含序号、时间、类型（开立、更新、状态变化、复盘、备注）、状态，以及内容 JSON（为什么现在、催化、三权证据、缺口、触发条件、失效条件、风险、观察截止日）、原因、作者（模型还是人）、回执 id、开立时的参考价和数据时间。
- 状态：观察中 / 接近触发 / 已触发 / 已失效 / 到期 / 撤销。当前状态取最新一条修订。代码里只有 INSERT，没有 UPDATE 或 DELETE 路径，并用测试守住。
- 触发和失效条件写成 `{text, check?}`。能机器核对的（价格、资金费率、未平仓量变化相对阈值）每天按规则核对；不能核对的只列出来，留给你或复盘时处理。
- 到期或进入终态时，自动追加一条复盘：期间涨跌，相对 BTC 或 SPY 的表现，命中了哪条条件。

---

## 4. 必要补充：一个模块 `modules/research/`（不改引擎）

| 部分 | 插口 | 内容 |
|---|---|---|
| 观察清单 | 模块里的 `instruments.json` | 代码、市场、工具类型（现货/永续/ETF/股票/指数/宏观序列）、数据源和源内代码、对应的 `entityId` |
| 行情采集 | `schedules` | 加密每 15 分钟一次；美股/ETF 收盘后一次；FRED 每天一次。无 key 的公开接口直接用 `guardedFetch`；有额度的 key 走 `paidRequest` 加预算，上限在后台设置 |
| 信号计算 | `schedules` | 每小时算第 3 节的 4 个标记。叙事数据只读引擎表，公开范围用 `publication/scope.ts` 的条件，这是架构测试的要求 |
| 事件抽取 | `schedules` + `models.catalyst` | 每 30 分钟扫描新入选或高分的报道，抽未来事件：标的、日期和精度、确认等级（正式/暂定/推测）、原文证据句（逐字核对，做法同 `normalizeStructure`） |
| 官方日程 | 模块里的 `calendar.json` | FOMC、CPI、非农等，每年手录一次，带官方链接，等级为“正式” |
| 研究简报 | `schedules` + `models.research` | 每天 08:30 生成，步骤如下表 |
| 提示词 | `industry/prompts/research-catalyst.md`、`research-card.md` | 用 `promptText` 读取，行业知识仍然留在 `industry/` |
| 页面 | `module.ts` pages + `web.tsx` 的侧栏和底栏 | `/brief`、`/brief/:date`、`/calendar`、`/theses`、`/theses/:id`；标的主题页插行情、事件、开放中判断的部件 |
| 只读 JSON | `http` + `apiPaths` | `GET /api/research/instruments[/:symbol]`、`/events?from&to&symbol`、`/briefs/latest`、`/briefs/:date`、`/theses?status=`、`/theses/:id`（含全部修订） |
| MCP 和 Agent Markdown | `agent.abilities` | `get_instrument`、`list_events`、`get_brief`、`get_thesis`。参数都可选，传 `{}` 也能调用，`scripts/mcp-check.ts` 会这样检查 |
| 写接口（建议首版做） | `http` | 复用 `INGEST_TOKEN` 做 Bearer 鉴权（`ingest.ts` 的注释说明模块客户端用同一个令牌）：`POST /api/research/theses`、`POST /api/research/theses/:id/revisions`（只追加，含撤销）、`POST /api/research/events`。MCP 保持只读 |
| 告警和清理 | `alerts`、`retention` | 告警：加密行情超过 1 小时没更新、日线超过 2 个交易日没更新、简报缺期。清理：分钟级行情保留 30 天，日线永久保留 |
| 迁移 | `modules/research/migrations/` | 每个文件一条语句，编号从 0200 起：`research_quotes`、`research_events`、`research_article_scans`、`research_theses`、`research_thesis_revisions`、`research_briefs`；索引另开文件，用 `CONCURRENTLY IF NOT EXISTS` |

**研究简报每天的生成步骤：**

| 步骤 | 做什么 | 调模型吗 |
|---|---|---|
| 1 | 每个标的：指标和标记、21 天内事件、7 天内关联报道（publications 里的 `entity:<id>` 标签）、开放中判断的条件核对和到期处理 | 否 |
| 2 | 有标记或接近触发的标的，每个调一次模型，上限约 8 次。输入只给这个标的的数据，输出用 zod 严格校验 | 是 |
| 3 | 校验：引用的编号必须存在，用 `grounded()` 核对名字和数字，不合格的条目丢弃 | 否 |
| 4 | 新候选开立判断；已有判断只在内容有实质变化时追加修订 | 否 |
| 5 | 简报每天一行，保存后不改写 | 否 |

挂进三份清单：`site/modules/{index,server,web}.ts`，加上 `site/package.json` 依赖和 `Dockerfile` 里的 `COPY` 一行。

---

## 5. 首版范围

| 市场 | 首版 | 数据 | 说明 |
|---|---|---|---|
| 加密现货和永续 | BTC、ETH、SOL，加上你选的 5–10 个 | 一家交易所的公开接口，不需要 key | 价格、24 小时和 7 日涨跌、成交额、资金费率、未平仓量、基差 |
| 美股和 ETF | 你选 5–10 只（例如 IBIT、COIN、MSTR、NVDA、GLD、USO、SPY、QQQ） | Twelve Data 免费档 | 日线收盘 |
| 指数 | 标普 500、纳指综合、VIX | FRED | 日线，晚一天 |
| 黄金和原油 | GLD/IAU（ETF）；WTI、Brent 现货日价（FRED） | 同上 | 页面上写明 ETF、现货、期货的区别 |
| 宏观 | 2 年和 10 年美债、10 年实际利率、广义美元指数、联邦基金利率目标 | FRED | |
| 港股 | **第二阶段** | 免费数据源未核实（Twelve Data 的港股在 Pro 档） | 首版只收公告和新闻，没有行情 |

- **输出：** 研究简报、事件日历、判断档案、标的页（主题页加行情部件）。引擎原有的精选、热点、日报保留，作为“证据层”。
- **入口：** 网页；MCP（原有 7 个工具加研究 4 个）；REST JSON `/api/research/*`；带令牌的写接口。

---

## 6. 数据、权限与成本

| 来源 | 用途 | 鉴权 | 费用和限制 | 核实状态 |
|---|---|---|---|---|
| Binance 或 OKX 公开接口 | 加密价格和衍生品 | 无 | 按 IP 权重限流。Binance 对美国 IP 拒绝服务；服务器在大陆要设 `EGRESS_PROXY_URL` | 本环境网络受限，没法实测；按服务器所在地选一家，实施时先实测 |
| CoinGecko Demo | 交易所没有的币 | 免费 key | 约 1 万次/月，100 次/分钟，要求署名（来源是第三方文章） | 待到官网复核 |
| FRED | 指数、利率、美元、原油 | 免费 key | 约 120 次/分钟（二手来源） | 待复核 |
| Twelve Data Basic | 美股和 ETF | 免费 key | 800 credits/天，8 次/分钟；港股在 Pro 档 | 待实测 |
| SoSoValue | BTC/ETH 现货 ETF 流量 | 发邮件申请 client id/secret | 是否免费未确认 | 第二阶段 |
| Tokenomist / DefiLlama | 代币解锁 | Tokenomist 的 API 要试用或付费；DefiLlama 的解锁端点是否免费，官方页面说法矛盾 | — | 第二阶段。首版从公告和新闻里抽解锁事件 |
| SocialData | 研究者在 X 上的传播 | 按请求付费，已有预算熔断 | — | 可选 |
| 模型（DeepSeek 等 OpenAI 兼容接口） | 全流程 | key | 按 token 计费。`docs/deploy.md` 实测：首次导入 152 条约用 930 次调用。研究步骤每天约 10 次，事件抽取每天几十次 | 后台“模型与评测”页能看到用量 |

- **密钥：** 写在 `.env` 或 `AIHOT_CREDENTIALS_DIR/collectors.env`。新增的变量（`TWELVEDATA_API_KEY`、`FRED_API_KEY`、`COINGECKO_API_KEY`）在 `.env.example` 里只留空占位，不进仓库、不进任何输出。
- **部署建议私有：** 本机 Docker，或小 VPS 配 Tailscale / 只开放内网。观察清单和判断档案不放公网；robots 设为禁止，IndexNow 和飞书推送保持关闭。
  - 接 MCP：`claude mcp add --transport http <名字> http://<主机>:3000/api/mcp`，或 `codex mcp add`。主机不是 `SITE_URL` 的主机时，把它写进 `MCP_ALLOWED_HOSTS`。
  - 如果你坚持部署在公网，研究类读取要改成带令牌，不能挂进匿名 MCP。这会改动第 4 节的设计。
- **不做：** 钱包、Orbio、私钥、托管资金、下单。

---

## 7. 实施步骤

**这份方案已经存为 `docs/research-plan.md`。**

**第 0 步：你来定，定下来之前不动手。**
1. 站名
2. 观察清单（具体代码）
3. 信源清单（我先给初稿，你来删改）
4. 分类草案
5. 部署方式和服务器所在地（决定用哪家交易所接口）
6. 用哪家模型

**第 1 步：行业迁移，只改配置。**
- 改第 2 节列出的文件，同时改测试里的示例。
- 检查：`npm run typecheck`；`DATABASE_URL=…_test npm test`；`npm run build -w @aihot/web && npm run test:web`；`node scripts/smoke.ts`；`node scripts/mcp-check.ts`。
- 用真实信源跑一周，在后台“信源”页确认抓取成功；你标注 100–200 条，用 `scripts/eval-selection.ts` 和 SelectBench 校准门槛。

**第 2 步：行情和标的。**
- `instruments.json`、数据接口适配、`research_quotes`、信号计算、标的主题页部件、`get_instrument`、过期告警。
- 测试用本地假服务回放保存的 JSON，不访问外部服务。

**第 3 步：事件日历。**
- `catalyst` 模型步骤、`calendar.json`、`/calendar` 页面、`list_events`、`POST /events`。

**第 4 步：候选卡和判断档案。**
- `research` 模型步骤、`/brief`、判断档案和修订、每日核对、写接口、`get_brief`、`get_thesis`。
- 测试重点：
  - 修订只追加，旧内容逐字保留
  - 引用不存在的编号会被丢弃
  - 数字不在输入里时，这一段被丢弃
  - 只有叙事信号时只能是“线索”
  - 到期自动复盘
  - 写接口没有令牌返回 401

**第 5 步（看使用效果再定）：** 港股行情、ETF 流量、解锁 API、飞书推送简报、每周命中率统计。

**暂不做：** 自动交易、钱包集成、多用户和订阅、回测平台、实体图谱、复杂评分、接入 Mass、价格预测。

**关键文件：**
- 新增：`modules/research/`（`module.ts`、`server.ts`、`web.tsx`、`migrations/`、`tests/`、`instruments.json`、`calendar.json`）、`industry/prompts/research-*.md`
- 修改：`site/modules/{index,server,web}.ts`、`site/package.json`、`Dockerfile`、`industry/*`、`site/site.ts`、`site/public/openapi-v1.json`、`.env.example`、`tests/*`
- 复用：`chatJson`、`paidRequest`、`guardedFetch`、`promptText`、`grounded`、`publication/scope.ts` 的条件、`credential("auth","INGEST_TOKEN")`

---

## 8. 日常使用效果（**以下全部是示例数据：价格、日期、事件都是虚构的，只用来确认格式**）

```
研究简报 · 2026-11-06【示例】   生成 08:30 ｜ 加密行情截至 08:15（Binance）｜ 美股 11-05 收盘（Twelve Data）｜ FRED 截至 11-04

一、优先关注（今天 2 个，没有更多合格候选）
1) SOL ｜ 加密 ｜ SOLUSDT 永续（Binance）
   价格 182.4【示例】  24h +1.2%  7d +6.8%  资金费率 0.006%/8h  未平仓量 7 日 +21%（30 日分位 92%）
   为什么现在：资金先动——未平仓量连续上升，资金费率仍中性；相关事件 48 小时只有 2 个独立参与方，讨论没有扩散
   未来催化：【正式】11-18 主网升级激活（官方博客原文，链接）
   资本 ✔ 未平仓量、成交额上升（Binance 指标）   ✘ 缺口：没有可靠的现货大户或 ETF 持仓数据
   叙事 ◐ 2 个来源（官方 T1、媒体 T2），研究者和 KOL 还没跟进
   规则 ✔ 升级公告原文：“…”（链接）
   触发：收盘站上 195 且未平仓量不回落；或升级前出现 4 家以上独立报道
   失效：跌破 165；发布升级延期公告；资金费率高于 0.05% 但价格不涨（拥挤）
   风险：未平仓量上升可能来自对冲或空头加仓，方向没有证据
   观察期至 11-25 ｜ 档案 #T-0042 rev1
2) GLD ｜ 美股 ETF（不是现货金，也不是期货）…（格式同上）

二、线索池（只有单一信号，不算机会）
- ENA：只有叙事信号（X 讨论 6 小时内上升），资金和规则都没有证据 → 只记录
- NVDA：【正式】11-19 财报；资金和叙事都没有异常 → 等事件

三、未来 3 周事件
正式日程：11-07 美国非农（BLS）→ 2 年美债、美元指数、GLD、BTC
          会改变判断的结果：…  需要的市场确认：…
暂定安排：11 月下旬 XXX 代币解锁（项目方写的是“计划”，没有精确日期）
研究推测：有讨论说可能有 ETF 审批窗口——没有官方日期，不给概率，不进日程

四、已有判断更新
#T-0035 ETH → 接近触发（距触发线 2.1%）
#T-0031 BTC → 已失效（11-04 收盘跌破失效线；rev3，rev1–2 原文保留）
#T-0029 WTI → 到期（期间没有触发；-3.2%，相对 SPY -4.0%；已追加复盘）

五、观察清单行情（节选）
标的 | 工具 | 价格 | 24h | 7d | 资金费率 | 未平仓量 7d | 标记 | 数据时间
```

**用 Agent 调用的例子：**
- `<前缀>_get_instrument {"symbol":"SOL"}` 返回行情、指标、21 天内事件、开放中的判断。
- `<前缀>_get_thesis {"id":"T-0031"}` 返回 rev1–3 的全文、时间和原因。
- 写一条修订：

  ```bash
  curl -X POST http://<主机>:3000/api/research/theses/T-0031/revisions -H "Authorization: Bearer $INGEST_TOKEN" -H "Content-Type: application/json" -d '{"kind":"note","reason":"…"}'
  ```

## 验证（整体）

- 每一步都跑仓库规定的四项检查，外加 `scripts/mcp-check.ts`。工具列表里要出现研究的 4 个工具，传 `{}` 能成功调用。
- 本地 Docker 起站后：`/brief`、`/calendar`、`/theses`、标的主题页都能打开；`/api/research/*` 返回 JSON；用 `claude mcp add` 接上后能查到标的和判断。
- 行情用本地假服务回放核对指标和标记。真实接口只在你自己的部署上实测，并在 PR 里写明结果。
