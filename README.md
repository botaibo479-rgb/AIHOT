# Hubble：以加密为主的个人跨市场研究工具

Hubble 是基于开源框架 [AIHOT](https://github.com/KKKKhazix/AIHOT) 做的行业迁移。框架原本是 AI 行业热点站，这里改成了个人投资研究工具：以加密为主，同时覆盖美股和港股、黄金和原油、外汇、宏观。

它不做财经新闻聚合。新闻只当线索和证据，每天的主要产出是：

- **具体标的**：现价、涨跌和异动，每个数都带数据来源和时间；
- **未来事件日历**：正式日程、暂定安排、研究推测三类分开列，不给概率；
- **候选卡**：资本权、叙事权、规则权三类证据，每条都注明出处；写明缺口、触发条件、失效条件和观察期；
- **判断档案**：只追加、不覆盖，每天按价格核对条件，判断结束时自动复盘，并统计命中率。

所有内容都可以通过网页、JSON 接口、MCP 和给 Agent 读的 Markdown 读取。

> 这份 README 是交接文档，写给接手完善和优化的人或 Agent。框架原来的说明保留在 [README.framework.md](README.framework.md)（英文版 [README.en.md](README.en.md)）。
> 动手之前，请先读 [AGENTS.md](AGENTS.md)：它是这个仓库的硬性规则，下面“必须守住的规则”一节摘了要点。

---

## 目录

1. [现在的状态](#现在的状态)
2. [它是怎么工作的](#它是怎么工作的)
3. [目录结构与改动范围](#目录结构与改动范围)
4. [研究模块详解](#研究模块详解)
5. [对外接口一览](#对外接口一览)
6. [配置与密钥](#配置与密钥)
7. [本地开发与测试](#本地开发与测试)
8. [部署](#部署)
9. [必须守住的规则](#必须守住的规则)
10. [已知问题与待办](#已知问题与待办)
11. [文档索引](#文档索引)

---

## 现在的状态

| 项目 | 状态 |
|---|---|
| 基础 | AIHOT 引擎，上游提交 `cd424b0`。引擎代码基本没动，只改了两处写死的示例文字 |
| 开发分支 | `claude/eager-sagan-xgna6p`（仓库 `botaibo479-rgb/AIHOT`） |
| 第 1 步：行业迁移 | 完成：站名 Hubble、分类、标的名录、主题、提示词、首批信源、门槛类别、用词表 |
| 第 2 步：行情与观察清单 | 完成：`modules/research`。加密、美股和 ETF、FRED 宏观行情；观察清单按报道聚合程度自动提名，由站长确认；筛选标记 |
| 第 3 步：事件日历 | 完成：官方日程表，加上模型从公开报道里抽出的未来事件；三类事件分开列 |
| 第 4 步：研究简报与判断档案 | 完成：每天的候选卡；判断档案只追加；每日按价格核对条件；结束时自动复盘 |
| 第 5 步（部分） | 完成：命中率统计；Deribit DVOL、DefiLlama 稳定币供应、CFTC 期货持仓、EIA 原油库存四个数据源 |
| 第 5 步其余 | 未做：港股行情、ETF 资金流、代币解锁数据、飞书推送简报。都要站长先准备账号、申请或推送地址 |
| 测试 | `npm run typecheck` 通过；后端测试 1057 项全部通过（研究模块 14 项）；网页构建通过；`scripts/smoke.ts`、`scripts/mcp-check.ts` 通过 |
| **没有在真实网络上验证过的** | 所有外部接口（交易所、FRED、Twelve Data、Deribit、DefiLlama、CFTC、EIA，以及 20 个信源地址）。开发环境连不上外网，只用本地假服务测过。模型的实际输出质量（事件抽取、候选卡）也还没在真实数据上看过 |

站点身份：站名 **Hubble**，行业词“投研”，MCP 工具名前缀 `hubble`。前缀上线后不要再改。计划部署在**香港服务器**、**私有访问**（建议用 Tailscale），模型用 **DeepSeek**。

---

## 它是怎么工作的

```
信源（RSS / 网页 / JSON / X / 公众号 / 外部推送）
   │  引擎：采集 → 判重 → 预筛 → 两次评分 → 结构化（事实 + 原文证据句）→ 写标题摘要
   │        → 事件归组 → 热度（独立来源计数）→ 精选 → 日报（规则编排）、周报月报
   ▼
公开读取层 packages/backend/src/publication/
   │
   ├─ 网页、RSS、/api/v1、/api/v1/agent、MCP /api/mcp（引擎原有）
   │
   └─ 研究模块 modules/research（只读引擎的公开数据，自己的数据存在自己的表里）
        ├─ 行情：交易所公开接口、Twelve Data、FRED、Deribit、DefiLlama、CFTC、EIA
        ├─ 观察清单：按报道的独立来源数自动提名 → 站长确认或放弃
        ├─ 事件日历：calendar.json（官方日程）+ 模型从报道里抽未来事件 + 站长记的
        ├─ 研究简报：核对已有判断 → 挑标的 → 写候选卡 → 合格的开立判断
        ├─ 判断档案：只追加修订；每天核对价格条件；结束时复盘
        └─ 复盘：命中率、相对 BTC/SPY 的表现
```

**“投机市场循环”和“三权”在代码里怎么落地**（详细设计见 [docs/research-plan.md](docs/research-plan.md)）：

- **资金 → 波动 → 注意力 → 参与**：落成按固定阈值计算的筛选标记，不当因果：
  - 资金异动：未平仓量、资金费率、成交额；
  - 资金先动，讨论未扩散；
  - 传播在扩散；
  - 传播扩散，价格未明显反应。

  隐含波动率（DVOL）作为背景序列给候选卡参考。
- **资本权**：行情、衍生品和持仓指标，加上报道里有出处的资金数据。
- **叙事权**：引擎的归组和热度：独立来源数、变化、来源层级。
- **规则权**：结构化事实的原文证据句和前提条件，加上事件日历。
- **硬规则**：大额转账不等于买卖，不估“主力成本”，不写概率、共识或目标价。写在提示词里，代码再过滤一遍。

---

## 目录结构与改动范围

```
AGENTS.md / CLAUDE.md        仓库规则（必读）
README.md                    本文件（Hubble 交接文档）
README.framework.md          AIHOT 框架原说明
apps/                        引擎：api（Fastify）、worker（pg-boss 任务）、web（React Router SSR）
packages/                    引擎：backend（业务代码）、contracts（共享类型）
database/migrations/         引擎的迁移
site/                        这个站自己的：站名文案（site.ts）、模型（models.ts）、品牌、条款页、public/、模块清单
industry/                    行业包：分类与名录（taxonomy.ts）、主题（topics.json）、信源（sources.json）、
                             提示词（prompts/）、门槛（selection.ts）、用词表（wording.ts）
modules/research/            研究模块（第 2–5 步的全部新功能）
docs/
  research-plan.md           执行方案：仓库理解、迁移、框架落地、数据与成本、实施步骤、示例输出
  hubble-setup-checklist.md  上线准备清单：服务器、模型、各类 key、开关、要站长做的决定
  customize.md / selection.md / sources.md / grouping.md / deploy.md / architecture.md   框架文档
scripts/                     初始化、迁移、种子、评测、smoke、mcp-check
tests/                       引擎测试（示例分类、标签、公司已换成新行业的）
```

### 相对上游改了哪些

| 位置 | 改动 |
|---|---|
| `site/site.ts` | 站名 Hubble、行业词“投研”、`mcpPrefix: "hubble"`、首页、关于页、Agent 页文案、`crawlerName` |
| `site/public/robots.txt` | 改为禁止收录（私有站） |
| `site/changelog.json`、`site/brand/nameplates/` | 上线公告；报头字按新行业词重新生成 |
| `site/modules/*.ts`、`site/package.json`、`Dockerfile` | 挂上研究模块 |
| `industry/taxonomy.ts` | 分类 `crypto`、`equities`、`commodities`、`fx`、`macro`、`research`（key 上线后不改）；首个标签按证据形态分；28 个标的与机构；`ITEM_TYPES` 换成投研的 7 类；`RELEASE = null` |
| `industry/topics.json` | 三组主题：标的与主体、研究方向、证据形态 |
| `industry/sources.json` | 首批 20 个信源：美联储、SEC、CFTC、BLS、ECB、EIA、以太坊基金会、币安和 OKX 公告、主要加密与财经媒体 |
| `industry/prompts/` | 预筛、评分（保留五维加权和噪声压制）、结构化、写作和标题规则、术语表全部改写；新增 `research-catalyst.md`（事件抽取）和 `research-card.md`（候选卡） |
| `industry/selection.ts`、`industry/wording.ts` | 门槛类别换成 `routine`（例行公告），门槛数字没改；用词表压住喊单和夸张词 |
| `.env.example` | 新增 `TWELVEDATA_API_KEY`、`FRED_API_KEY`、`EIA_API_KEY`；模型步骤里加上 `CATALYST_MODEL`、`RESEARCH_MODEL` |
| `scripts/mcp-check.ts`、`apps/web/app/routes/admin/source-new.tsx` | 两处写死的 AI 示例文字 |
| `tests/` | 约 40 个测试文件里的示例分类、标签、公司换成新行业的，测的规则没变 |

---

## 研究模块详解

模块说明在 [modules/research/README.md](modules/research/README.md)，下面是概览。

### 文件

| 文件 | 内容 |
|---|---|
| `module.ts` | 页面地址：`/brief`、`/watchlist`、`/calendar`、`/theses`；API 前缀 `/api/research/` |
| `server.ts` | 后端插口：HTTP 路由、定时任务、模型步骤、MCP 能力、主题页部件、告警、清理 |
| `web.tsx` | 网页插口：侧栏“研究”分组、“我的”页入口、主题页上的行情卡片 |
| `contract.ts` | 前后端共用的类型和格式化函数 |
| `instruments.json` | 标的目录（37 个）：数据源和代码、所属实体、`candidate` 或 `context` 角色；提名门槛；筛选阈值 |
| `calendar.json` | 官方日程：FOMC（2026-12 正式、2027 全年暂定）、BLS 非农、CPI、PPI。每年手录一次 |
| `backend/catalog.ts` | 读取并校验目录（写错就启动失败） |
| `backend/sources.ts` | 数据源适配器：Binance、OKX、FRED、Twelve Data、Deribit、DefiLlama、CFTC、EIA |
| `backend/collect.ts` | 加密快照、日线采集、快照清理 |
| `backend/read.ts` | 标的视图：价格、1 日和 7 日变化、波动率、成交额比、永续合约指标、报道热度、筛选标记、未来事件 |
| `backend/watch.ts` | 观察清单的自动提名和站长决定 |
| `backend/events.ts` | 日历同步、从报道抽事件（逐字引句校验、合并同一事件）、站长事件、撤下、列表 |
| `backend/cards.ts` | 候选卡的输入（每个事实都编号）和输出校验（引用、`grounded()`、禁用词、价位范围、降级为线索） |
| `backend/theses.ts` | 判断档案：开立、追加修订、每日核对（接近触发、已触发、已失效、到期）、复盘 |
| `backend/brief.ts` | 每日研究简报的生成（每个日期只写一次） |
| `backend/review.ts` | 命中率复盘统计 |
| `backend/markdown.ts` | 给 MCP 和 Agent 的 Markdown 回答 |
| `web/*.tsx` | 页面和部件：简报、观察清单、日历、判断档案、行情卡片、候选卡、复盘表 |
| `migrations/0200–0207` | 模块自己的 8 张表（见下） |
| `tests/` | `research.test.ts`（行情、观察清单、接口）、`events.test.ts`（日历）、`brief.test.ts`（候选卡、判断、复盘） |

### 数据表（模块自有，引擎表只读）

| 表 | 内容 |
|---|---|
| `research_quotes` | 加密快照：价格、资金费率、未平仓量、标记价、指数价。保留 30 天 |
| `research_daily` | 日值和周值：收盘价、成交额、未平仓量。永久保留 |
| `research_watch` | 观察清单状态：已提名、观察中、已放弃 |
| `research_events` | 事件：来源（日历、报道、站长）、确认等级、日期精度、原文引句、出处报道、撤下记录 |
| `research_article_scans` | 每篇报道的每个版本只读一次的记账 |
| `research_theses` / `research_thesis_revisions` | 判断，以及只追加的修订（开立、更新、状态、复盘、笔记） |
| `research_briefs` | 每日研究简报（每个日期一行，写好后不改） |

### 定时任务（北京时间，在 worker 里跑）

| 任务 | 时间 | 内容 | 受哪个开关控制 |
|---|---|---|---|
| `research.snapshots` | 每 15 分钟 | 加密快照（还没有日线的标的顺带补齐） | `COLLECT_ENABLED` |
| `research.daily` | 每天 08:12 | 全部日线和周线序列 | `COLLECT_ENABLED` |
| `research.nominate` | 每天 08:25 | 72 小时内 ≥ 3 个独立来源报道的标的自动提名 | — |
| `research.events` | 每小时 07、37 分 | 同步 calendar.json；从最近 3 天的精选和高分报道里抽未来事件 | `MODEL_CALLS_ENABLED` |
| `research.brief` | 每天 08:45 | 核对判断 → 写最多 8 张候选卡 → 生成研究简报（周一附上周复盘） | `MODEL_CALLS_ENABLED`（模型不可用时照常生成，只是没有候选卡） |

### 模型步骤（在后台“模型与评测”页可以单独换模型）

| 步骤 | 环境变量 | 提示词 |
|---|---|---|
| 研究：从报道里抽未来事件 | `CATALYST_MODEL` | `industry/prompts/research-catalyst.md` |
| 研究：候选卡（研究简报） | `RESEARCH_MODEL` | `industry/prompts/research-card.md` |

两步都走引擎的 `chatJson`：有回执、预算熔断，受 `MODEL_CALLS_ENABLED` 控制。

---

## 对外接口一览

公开读取都是**匿名只读**，所以站点要私有部署；写操作都要 `Authorization: Bearer $INGEST_TOKEN`。

### 网页

`/`、`/all`、`/hot`、`/daily`、`/topics` 是引擎原有页面，作为证据层。`/brief`（研究简报）、`/watchlist`（观察清单）、`/calendar`（事件日历）、`/theses`（判断档案与复盘）是研究模块的页面。标的主题页 `/topics/<实体>` 顶部会显示行情卡片和未来事件。

### MCP（`/api/mcp`，工具名前缀 `hubble_`）

| 工具 | 来源 | 内容 |
|---|---|---|
| `hubble_get_latest`、`hubble_search`、`hubble_get_hot_topics`、`hubble_get_story`、`hubble_get_daily`、`hubble_get_weekly`、`hubble_get_monthly` | 引擎 | 精选、搜索、热点、事件、日报、周报、月报 |
| `hubble_get_instrument` | 研究模块 | 不带参数：观察清单和市场背景；带 `symbol`：单个标的 |
| `hubble_list_events` | 研究模块 | 未来事件（`days`、`instrument`） |
| `hubble_get_brief` | 研究模块 | 研究简报（`date`） |
| `hubble_get_thesis` | 研究模块 | 不带参数：进行中的判断；带 `id`：全部修订 |
| `hubble_get_review` | 研究模块 | 命中率复盘（`days` 取 7、30、90 或 all） |

接入方式：`claude mcp add --transport http hubble <SITE_URL>/api/mcp`，或者打开站点的 `/agent` 页复制。只能读网页的 Agent 从 `/api/v1/agent` 开始读。

### 研究模块的 JSON

| 方法 | 地址 | 说明 |
|---|---|---|
| GET | `/api/research/instruments`、`/api/research/instruments/<id 或代码>` | 标的与行情（单个标的含最近 30 个日值） |
| GET | `/api/research/events?days=21&instrument=sol` | 事件日历 |
| GET | `/api/research/briefs/latest`、`/api/research/briefs/<YYYY-MM-DD>` | 研究简报 |
| GET | `/api/research/theses?status=open\|ended\|all`、`/api/research/theses/<id>` | 判断档案 |
| GET | `/api/research/review?days=7\|30\|90\|all` | 命中率复盘 |
| POST（令牌） | `/api/research/watch/<id>` | `{"state":"watching"\|"dropped","reason":"…"}` |
| POST（令牌） | `/api/research/events` | 站长添加事件 |
| POST（令牌） | `/api/research/events/<id>/withdraw` | `{"reason":"…"}` 撤下读错的事件（保留记录） |
| POST（令牌） | `/api/research/theses` | 站长开立判断 |
| POST（令牌） | `/api/research/theses/<id>/revisions` | `{"kind":"note"\|"status","status":…,"reason":"…"}` |

---

## 配置与密钥

完整清单在 [docs/hubble-setup-checklist.md](docs/hubble-setup-checklist.md)。要点如下：

- **自动生成**：`node scripts/init-env.ts --llm-key <DeepSeek Key>` 会生成 `.env`，并填好 `ADMIN_PASSWORD`、`SESSION_SECRET`、`IMG_PROXY_SIGN_SECRET`、`POSTGRES_PASSWORD`。
- **必须自己填**：
  - `LLM_API_KEY`（DeepSeek）
  - `FRED_API_KEY`、`TWELVEDATA_API_KEY`、`EIA_API_KEY`（都免费）
  - `INGEST_TOKEN`：**init-env 不会生成**，用 `openssl rand -hex 24` 生成
  - `SITE_URL`
  - `COLLECT_ENABLED=true`、`MODEL_CALLS_ENABLED=true`
- **建议**：`DASHSCOPE_API_KEY` 或其他向量服务（DeepSeek 没有向量接口，没有它事件归组会偏弱）；`site.ts` 的 `crawlerName` 里加上联系邮箱（SEC、BLS 要求）；自建 RSSHub，用来抓中文信源。
- **可选**：`SOCIALDATA_API_KEY`、`DAJIALA_KEY`、`JINA_API_KEY`、飞书告警、数据库备份。

`.env`、密钥和 `.data/` 都不要提交。

---

## 本地开发与测试

需要 **Node.js 24**（`package.json` 要求 ≥ 24.22.1）和 **PostgreSQL 16 或 17**。数据库账号要有建库权限。

```bash
npm ci
npm run typecheck
DATABASE_URL=postgres://<用户>:<密码>@127.0.0.1:5432/hubble_test npm test   # 库名必须以 _test 或 _ci 结尾，会自动建库和迁移
npm run build -w @aihot/web && npm run test:web                               # 浏览器测试需要 Playwright 对应版本的 Chromium 和 WebKit
```

只跑研究模块的测试：

```bash
DATABASE_URL=postgres://…/hubble_test node --test-global-setup=tests/databases.ts --import ./tests/databases.ts --test modules/research/tests/*.test.ts
```

本地起站：先准备 `.env`（保持 `COLLECT_ENABLED=false`、`MODEL_CALLS_ENABLED=false`），再运行：

```bash
node --env-file=.env scripts/migrate.ts && node --env-file=.env scripts/seed.ts
NODE_ENV=production node --env-file=.env apps/api/src/main.ts                 # 3001
cd apps/web && NODE_ENV=production node --env-file=../../.env server.ts       # 3000
node scripts/smoke.ts --base http://localhost:3000
node scripts/mcp-check.ts
```

测试说明：

- 测试不访问任何外部服务。数据源和模型都由本地假服务代替：研究模块测试里，数据源地址通过 `backend/sources.ts` 的 `ENDPOINTS` 指向本地，模型用 `tests/setup.ts` 的 `stub()`。
- 浏览器测试在开发环境里有 13 项失败，原因是缺 WebKit、Chromium 版本不匹配。没改动的上游代码失败的也是同样这 13 项，所以和这次改动无关。

---

## 部署

按 [docs/deploy.md](docs/deploy.md) 的“用 Docker”一节部署：

```bash
docker compose up -d --build
```

服务器建议至少 2 核 4 GB，磁盘 40 GB 以上。部署后按这个顺序检查：

1. 后台“信源”页：逐个“预览抓取” 20 个信源。
2. 后台“运行”页：看 `research.snapshots` 和 `research.daily` 的结果。Binance 不通就把 `instruments.json` 里加密标的的数据源改成 `okx`，symbol 写成 `BTC-USDT`。
3. 打开 `/brief`、`/calendar`、`/watchlist`、`/theses` 看一眼。
4. 用 `/agent` 页给的命令接上 MCP。

---

## 必须守住的规则

摘自 [AGENTS.md](AGENTS.md)，改之前务必读全文：

- **前端只通过 HTTP 读后端**：数据库、模型调用和密钥只在后端。研究模块的网页代码（`web/`、`web.tsx`）不能导入后端代码，架构测试会检查。
- **公开出口只从 `packages/backend/src/publication/` 读**：模块读引擎数据时用 `publication/scope.ts` 的条件（例如 `listedCondition`）。
- **模块不写引擎的表**：`publications`、`receipts`、`facts`、`stories` 等，架构测试会检查。模块只写自己的 `research_*` 表；模块之间不互相导入。
- **读者打开页面不调模型**：模型只在 worker 的任务里调。
- **付费请求都走回执和预算熔断**：模型调用用 `chatJson`。研究模块调用的行情接口都是免费的，所以直接用 `guardedFetch`。
- **安全阀**：`COLLECT_ENABLED`、`MODEL_CALLS_ENABLED`、`FEISHU_*_ENABLED`、`INDEXNOW_SUBMIT_ENABLED` 只有设成 `true` 才打开，开发时保持关闭。
- **数据库迁移**：放在 `modules/research/migrations/`；每个文件只放一条语句；已发布的迁移不改。迁移安全检查会拒绝 `CREATE TABLE … AS` 这类写法，连 `GENERATED … AS IDENTITY` 也会因为里面的 `AS` 被拒，所以自增 id 用 `bigserial`。索引要用 `CREATE INDEX CONCURRENTLY IF NOT EXISTS`。
- **数据库里的每一列都要有代码在用**：架构测试会检查。
- **代码读到的环境变量都要写进 `.env.example`**：架构测试会检查。
- **停用一个功能时一起删干净**：代码、测试、文档和存下的状态（表、定时任务、环境变量）。
- **新增导航入口**：要在浏览器里分别核对电脑侧栏、手机底栏、返回按钮和“我的”页。
- **不用 AIHOT 的名字和 Logo**。
- **研究内容的底线**：不写价格预测、概率、“市场共识”“已定价”、目标价；大额转账不等于买卖；只有叙事信号的不能升级为候选；判断修订只追加不覆盖。

---

## 已知问题与待办

### 需要站长提供或决定的

这些不是代码问题，但会影响能不能用，以及效果好坏：

- 准备清单里的各项 key 和开关，特别是 `INGEST_TOKEN`。
- 一个专用的联系邮箱，写进 `crawlerName`。
- 是否自建 RSSHub，用来接中文快讯和深度稿（信源清单见 [docs/research-plan.md](docs/research-plan.md) 第 2 节）。
- 条款页 `site/pages/terms.md`、`privacy.md` 还是框架模板。
- 跑一到两周后标注 100–200 条样本，用 `scripts/eval-selection.ts` 校准 `industry/selection.ts` 的门槛（见 [docs/selection.md](docs/selection.md)）。门槛不能凭感觉改。
- 第 5 步其余项要的账号：富途 OpenD（港股）、SoSoValue API 或 Farside 使用许可（ETF 资金流）、Tokenomist（代币解锁）、飞书 webhook（推送简报）。

### 部署后需要验证或可能要修的

- 所有外部接口都还没在真实网络上跑过：
  - Binance 和 OKX 的现货、永续、K 线、未平仓量历史接口；
  - FRED、Twelve Data、Deribit、DefiLlama；
  - CFTC 的合约代码（BTC 133741、ETH 146021、黄金 088691、WTI 067651）；
  - EIA 序列 `WCESTUS1`。

  取不到数据的会写在任务结果里，要按实际返回改适配器。
- 20 个信源的地址要逐个预览。币安和 OKX 公告用的是它们网站的 JSON 接口，格式可能变。
- 两个模型步骤的提示词要用真实数据看效果，再迭代：事件抽取的准确率；候选卡是否太空、证据是否读错、条件是否具体。
- `calendar.json` 只录到 2027 年 1 月的 BLS 数据和 2027 年的 FOMC，要每年更新。

### 可以继续改进的方向

在不违背上面规则的前提下：

- 港股行情、ETF 资金流、代币解锁、飞书推送简报（第 5 步其余项）。
- 观察清单目前只能提名 `instruments.json` 里有的标的。报道里频繁出现、但目录里没有的新币，还不能自动发现。
- 判断档案的“更新”修订（`update`）在类型和表里都有，但研究简报目前不会给已有判断写更新卡，进行中判断的标的会直接跳过。如果要让模型定期更新证据，可以在 `brief.ts` 里加。
- 筛选标记的阈值（`instruments.json` 的 `signals`）是初始值，应该参考复盘数据再调。
- 命中率统计目前不区分触发条件的方向；需要的话，可以在开立时让卡片声明方向。

---

## 文档索引

| 文档 | 内容 |
|---|---|
| [docs/research-plan.md](docs/research-plan.md) | 执行方案：仓库理解、行业迁移、信源分层、框架落地、数据与成本、实施步骤、示例输出、进度 |
| [docs/hubble-setup-checklist.md](docs/hubble-setup-checklist.md) | 上线准备清单 |
| [modules/research/README.md](modules/research/README.md) | 研究模块：数据源、观察清单、事件日历、研究简报、判断档案、复盘、接口 |
| [AGENTS.md](AGENTS.md) | 仓库规则 |
| [docs/customize.md](docs/customize.md) | 框架：改成另一个行业的步骤 |
| [docs/architecture.md](docs/architecture.md) | 框架：三个进程、不变的规则、模块、迁移约定 |
| [docs/sources.md](docs/sources.md) | 框架：六种信源怎么配 |
| [docs/selection.md](docs/selection.md) | 框架：精选流程与门槛校准 |
| [docs/deploy.md](docs/deploy.md) | 框架：部署、更新、备份、成本 |

## 许可

代码沿用上游的 [MIT 许可证](LICENSE)。AIHOT 的名字和 Logo 不在许可范围内，本站不使用。字体许可见 [NOTICE](NOTICE)。
