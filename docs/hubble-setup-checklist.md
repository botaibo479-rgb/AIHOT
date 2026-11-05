# Hubble 上线准备清单

按这份清单把东西准备好，Hubble 就能在你的香港服务器上跑起来。分四类：

- **必须准备**：没有就跑不起来，或者核心功能不工作。
- **建议准备**：不影响启动，但效果差很多。
- **可选**：用得上再办。
- **要你本人做的决定和核对**：不是密钥，但只能你来做。

所有密钥都写在服务器上项目根目录的 `.env` 里（模板是 `.env.example`），不要提交到 Git，也不要发给任何人或写进聊天记录。

---

## 一、必须准备

### 1. 服务器

| 项目 | 要求 |
|---|---|
| 位置 | 香港（已定）；访问海外信源和交易所接口一般不用代理 |
| 配置 | 至少 2 核 CPU、4 GB 内存（构建镜像时要用），磁盘建议 40 GB 以上（数据库和行情日线会慢慢增长） |
| 软件 | Docker（带 Compose）；Node.js 24（运行 `scripts/init-env.ts` 生成 `.env` 时用，也可以在别的机器上生成后拷过去） |
| 访问方式 | 建议私有：在服务器和你的电脑、手机上都装 [Tailscale](https://tailscale.com/)，只通过 Tailscale 地址访问，不对公网开放 |

### 2. 自动生成的项（不用你准备，但要知道在哪）

在服务器上运行：

```bash
node scripts/init-env.ts --llm-key <你的 DeepSeek API Key>
```

它会生成 `.env`，并自动填好以下各项，把管理员密码打印出来。请把这个密码存进你的密码管理器。

| 变量 | 作用 |
|---|---|
| `ADMIN_PASSWORD` | 登录 `/admin` 后台的密码 |
| `SESSION_SECRET`、`IMG_PROXY_SIGN_SECRET` | 会话和图片代理的签名密钥 |
| `POSTGRES_PASSWORD` | 数据库密码 |

### 3. 模型：DeepSeek API Key

| 项目 | 说明 |
|---|---|
| 去哪里办 | DeepSeek 开放平台：注册、实名、充值，创建 API Key |
| 填在哪 | `LLM_API_KEY`（`init-env` 的 `--llm-key` 参数会帮你填） |
| 相关设置 | `LLM_BASE_URL=https://api.deepseek.com/v1`、`LLM_MODEL`、`LLM_EXTRA_JSON` 用 `.env.example` 里的默认值。先到 DeepSeek 控制台确认模型名和当前价格，和默认值对不上就改 `LLM_MODEL` |
| 用在哪 | 资料的预筛、两次评分、结构化、写标题摘要、事件归组和综述、周报月报总述、从报道里抽未来事件、研究简报的候选卡 |
| 花多少 | 按 token 计费，用量和每天进来的资料条数成正比。仓库实测：首次导入 152 条资料约用 930 次调用；研究模块每天另加约 8 次候选卡和几十次事件抽取。后台“模型与评测”页能看到每一步的调用次数和 token |
| 防止超支 | 后台“设置 → 付费请求上限”给模型服务设每分钟、每小时、每天的上限 |

### 4. 行情数据的三个免费 Key

| 变量 | 去哪里办 | 用在哪 | 费用 |
|---|---|---|---|
| `FRED_API_KEY` | 在 St. Louis Fed 的 FRED 网站注册账号，在账号页申请 API Key | 标普 500、纳指、VIX、美债收益率、实际利率、美元指数、美元兑人民币／日元／港元、WTI 与 Brent 现货日价 | 免费 |
| `TWELVEDATA_API_KEY` | 在 Twelve Data 官网注册免费账号（Basic 档） | 美股和 ETF 日线：IBIT、COIN、MSTR、CRCL、NVDA、TSLA、GLD、USO、SPY、QQQ | 免费档每天 800 次额度，我们每天约用 10 次 |
| `EIA_API_KEY` | 在 EIA Open Data 免费注册 | 美国商业原油库存周值 | 免费 |

不填也能启动，只是这些标的没有行情，后台“运行”页会写明缺哪个 key。加密行情、Deribit 波动率、DefiLlama 稳定币供应、CFTC 期货持仓都用公开接口，不需要 key。

### 5. 推送令牌 `INGEST_TOKEN`（你自己生成）

`init-env` **不会**生成它，但所有写操作都要用它：确认或放弃观察清单、记事件、撤下读错的事件、开立判断、加笔记、改状态。

```bash
openssl rand -hex 24
```

把结果填进 `INGEST_TOKEN=`（至少 16 位）。在 Codex、Claude Code 或脚本里调用写接口时，带上请求头 `Authorization: Bearer <这个值>`。

### 6. 安全开关（改 `.env`）

```bash
COLLECT_ENABLED=true          # 抓信源、取行情
MODEL_CALLS_ENABLED=true      # 调模型（精选、事件日历、研究简报）
FEISHU_CONTENT_PUSH_ENABLED=false
FEISHU_INTERNAL_ENABLED=false
INDEXNOW_SUBMIT_ENABLED=false # 私有站，不提交搜索引擎
```

只有设成 `true` 的才会打开。

### 7. 访问地址

| 变量 | 填什么 |
|---|---|
| `SITE_URL` | 你实际访问站点的地址。用 Tailscale 就填 `http://<服务器的 Tailscale 主机名>:3000` |
| `MCP_ALLOWED_HOSTS` | 访问用的主机名和 `SITE_URL` 不一样时，逗号分隔写在这里（比如同时用 Tailscale 的 IP 和主机名），否则 MCP 会拒绝请求 |
| `TRUST_PROXY` | 前面有 Caddy、Nginx 反向代理时设 `true`；直接访问保持 `false` |

不需要买域名。只有你打算公开到公网、要 HTTPS 时才需要（不建议，判断档案不该公开）。

---

## 二、建议准备

### 8. 向量服务（让事件归组更准）

DeepSeek 不提供向量（embedding）接口。不配向量服务也能跑，但归组只能比文字重合度，只作热度证据的讨论帖大多挂不到事件上，“叙事权”的扩散计数会偏低。二选一：

| 方式 | 填什么 |
|---|---|
| 阿里云百炼（最简单） | `DASHSCOPE_API_KEY`，自动用 `text-embedding-v4`，按百炼价格计费 |
| 其他 OpenAI 兼容的向量接口 | `EMBEDDING_BASE_URL`、`EMBEDDING_API_KEY`、`EMBEDDING_MODEL` |

### 9. 抓取标识里的联系方式

SEC 和 BLS 要求抓取方在 User-Agent 里写联系方式，否则可能拒绝。请准备一个专门用于抓取的邮箱（不要求是主邮箱），改 `site/site.ts` 的 `crawlerName`，例如 `HubbleBot/1.0 (+mailto:你的邮箱)`。这是代码配置，改完要重新构建；你给我邮箱，我来改。

### 10. 中文信源用的自建 RSSHub

PANews、Odaily、律动、ChainCatcher、华尔街见闻、财联社等大多没有官方订阅源，需要在同一台服务器上用 Docker 跑一个 RSSHub，再在 `.env` 设 `PRIVATE_FEED_HOSTS=rsshub`。不需要账号或费用，但要你同意在服务器上多跑一个服务。确认后我把 docker-compose 配置和信源加上。

---

## 三、可选（用得上再办）

| 项目 | 变量 | 用途 | 费用 |
|---|---|---|---|
| X（推特）账号的帖子 | `SOCIALDATA_API_KEY` | 跟踪研究者、项目方的 X 账号，作为传播热度的证据 | 按请求计费，有预算上限 |
| 抓不到正文时的渲染兜底 | `JINA_API_KEY` | 只对显式配置了 Jina 的网页列表信源生效 | 按次计费 |
| 微信公众号 | `DAJIALA_KEY` | 抓公众号文章（极致了） | 按请求计费 |
| GitHub 接口配额 | `GITHUB_TOKEN` | 只在添加 GitHub 类信源时用 | 免费（只读权限即可） |
| 飞书告警 | `FEISHU_ALERT_WEBHOOK_URL`，并设 `FEISHU_INTERNAL_ENABLED=true` | 数据源失败、行情过期、简报缺期时发消息给你 | 免费 |
| 数据库每日备份 | `DB_BACKUP_STORE_*` 一组 | 备份到 S3 兼容的对象存储（腾讯云 COS、阿里云 OSS、AWS S3） | 按存储量计费 |
| 出网代理 | `EGRESS_PROXY_URL` | 香港服务器一般不需要；只有某个信源连不上时才配 | — |

### 第 5 步各项需要的准备

命中率统计，以及 Deribit、DefiLlama、CFTC、EIA 四个免费数据源已经做完（2026-11-05）。EIA 需要你注册一个免费的 `EIA_API_KEY`，不填的话原油库存这一项没有数据。其余几项还要你决定：

| 项目 | 你需要准备 | 费用 |
|---|---|---|
| 飞书推送每日研究简报 | 一个飞书群自定义机器人的 webhook 地址 | 免费 |
| 港股行情 | 富途账户，并在服务器上运行富途 OpenD（行情权限看账户等级） | 看账户 |
| BTC/ETH 现货 ETF 资金流 | 向 SoSoValue 发邮件申请 API；或者你确认可以抓 Farside 网页（要先看它的使用条款） | 是否收费待确认 |
| 代币解锁数据 | Tokenomist API（要申请试用或付费） | 付费 |

---

## 四、要你本人做的决定和核对

1. **条款页**：`site/pages/terms.md`、`site/pages/privacy.md` 还是框架模板。私有站影响不大，但上线前请看一遍；改成“仅供个人使用”就行，告诉我我来改。
2. **逐个试抓信源**：上线后在后台“信源”页对 20 个首批信源逐个点“预览抓取”，抓不到的告诉我（或直接在后台暂停）。
3. **交易所接口二选一**：服务器上看后台“运行”页里 `research.snapshots` 的结果。Binance 不通就告诉我，改用 OKX。
4. **观察清单**：每天会有自动提名，你决定观察还是放弃（调用 `POST /api/research/watch/<id>`，或者让 Agent 帮你调）。
5. **官方日程表**：`modules/research/calendar.json` 每年从 Fed、BLS 官方页面更新一次（2027 年其余月份的非农、CPI 等还没录）。你确认后我来录。
6. **标注样本**：跑一到两周后，从“全部动态”里挑 100–200 条，标“该选／不该选”，用来校准入选门槛。格式见 `docs/selection.md`。
7. **使用反馈**：一两周后告诉我研究简报的候选卡哪里不合用：太空、证据读错、条件不具体、标的选得不对等。
8. **第 5 步其余项**：飞书推送简报、港股行情、ETF 资金流、代币解锁，从上面的表里选。

---

## 附：`.env` 里你要填或改的项（汇总）

```bash
# 必须
SITE_URL=http://<服务器的 Tailscale 主机名>:3000
LLM_API_KEY=<DeepSeek API Key>          # init-env 的 --llm-key 会填
FRED_API_KEY=<FRED Key>
TWELVEDATA_API_KEY=<Twelve Data Key>
EIA_API_KEY=<EIA Key>                   # 美国原油库存周值，免费注册
INGEST_TOKEN=<openssl rand -hex 24 的结果>
COLLECT_ENABLED=true
MODEL_CALLS_ENABLED=true

# 建议
DASHSCOPE_API_KEY=<阿里云百炼 Key>       # 或 EMBEDDING_BASE_URL / EMBEDDING_API_KEY / EMBEDDING_MODEL
# MCP_ALLOWED_HOSTS=<其他访问用的主机名>

# 可选
# SOCIALDATA_API_KEY=
# FEISHU_ALERT_WEBHOOK_URL=   （同时设 FEISHU_INTERNAL_ENABLED=true）
# DB_BACKUP_STORE_SECRET_ID= / DB_BACKUP_STORE_SECRET_KEY= / DB_BACKUP_STORE_BUCKET= / DB_BACKUP_STORE_REGION=
```

准备好以后，按 `docs/deploy.md` 的“用 Docker”一节部署：`docker compose up -d --build`。然后打开 `<SITE_URL>/admin` 登录后台检查信源，打开 `<SITE_URL>/agent` 复制 MCP 接入方式。
