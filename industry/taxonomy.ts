// 这个行业的分类体系：类别、标签词表、标的与主体名录，以及防止张冠李戴的身份词典。
// 模型按这里的词表打标签，主题页（topics.json）按标签归类，筛选栏按类别分组。
// 换行业时：类别的 key 会出现在网址里（/all?category=…），上线后就不要再改；标签和名录可以随时增减。
// 这个站是跨市场投研：类别按市场分，第一个标签按证据形态分（资金、机制、日程……），名录收标的和关键机构。

/**
 * 网页上的类别（筛选栏、卡片角标、RSS 分类订阅）。key 是网址和接口里的身份，上线后不要改。
 * section 是日报里的分节标题（几个类别可以共用一节，按这里的顺序排）；guide 告诉结构抽取模型这一类收什么、
 * 和相邻类别的边界在哪（总的归类原则写在 prompts/structure.md 里）。
 * commentary 标出评论类（研究观点）：日报写过的事又有评论类的后续报道，只占一行快讯（报道它的信源够多时除外）。
 * 没归上类的资料在日报里放进第一个 key 为 industry 的类别所在的节（没有就放最后一节）。
 * tagColor 是飞书推送卡片里跟在标题后面的这一类小标签的颜色（飞书 text_tag 的颜色名）。
 * feedLabel 是分类 RSS 标题里的名字（不写就用 label）。公开接口、RSS 和 MCP 里要把一类并进另一类发布，写在站点设置里（site/site.ts 的 PUBLIC_CATEGORIES）。
 */
export const CATEGORIES = [
  { key: "crypto", tagColor: "orange", label: "加密", feedLabel: "加密资产", section: "加密", guide: "加密资产、交易所、链上协议、稳定币、代币机制（解锁、回购、销毁、治理）、加密 ETF 与加密监管。加密公司上市股票的财报归美股港股；美元流动性等宏观背景归宏观。" },
  { key: "equities", tagColor: "blue", label: "美股港股", feedLabel: "美股港股", section: "美股港股", guide: "美股、港股上市公司与股票 ETF：财报与指引、公司公告与法定披露、内部人与机构持仓、指数纳入剔除、交易规则。加密现货 ETF 的审批与资金流归加密；黄金原油 ETF 归黄金原油。" },
  { key: "commodities", tagColor: "yellow", label: "黄金原油", feedLabel: "黄金原油", section: "黄金原油", guide: "黄金与原油的供需、库存、产量政策（OPEC+）、期货持仓、交割与相关 ETF。能源和矿业公司的财报归美股港股；央行购金归这一类。" },
  { key: "fx", tagColor: "wathet", label: "外汇", feedLabel: "外汇", section: "外汇", guide: "主要货币汇率与汇率制度：美元、人民币、港元联系汇率、日元、欧元的干预、制度调整与资本流动。利率决议本身归宏观，只有材料重点是汇率时才归这一类。" },
  { key: "macro", tagColor: "indigo", label: "宏观", feedLabel: "宏观与政策", section: "宏观与政策", guide: "央行决议与官员表态、经济数据发布、财政与国债、跨市场监管政策与发布日程。只影响单一资产的监管归对应市场类别。" },
  { key: "research", tagColor: "purple", label: "研究观点", section: "研究观点", guide: "重点是作者的分析框架、判断、预测或复盘，包括研究机构报告和访谈。带新数据或新事实的报道按事实所在市场归类，不因作者是研究员就归这里。", commentary: true },
] as const satisfies ReadonlyArray<{ key: string; tagColor: string; label: string; feedLabel?: string; section: string; guide: string; commentary?: true }>;

/**
 * 这个行业最受关注的一类发布（AI 行业是新模型）：日报报头的“N 个新模型”、改分类后修订已出的报告都按它数。
 * category 是类别，tag 是标签，两者都对上才算；unit 接在数字后面。
 * 没有这样一类的行业设成 null，报头就不显示这个数。
 */
export const RELEASE: { category: string; tag: string; unit: string } | null = null;

/** 周报月报的总述可以直接写、不必在报道里找到出处的行业通用词（小写）。站名会自动算进去。 */
export const PLAIN_TERMS: readonly string[] = ["etf", "cpi", "ppi", "pce", "gdp", "fomc", "sec", "cftc", "defi", "usd", "ceo", "ipo", "api"];

/**
 * 内容理解一步给每篇资料判的“内容类型”（写在 prompts/content-understanding.md 里，改了类型要同步改那份提示词）。
 * 评分提示词（prompts/selection-score.md）按类型给五个维度不同的权重。
 */
export const ITEM_TYPES = ["capital_flow", "mechanism_change", "scheduled_catalyst", "corporate_disclosure", "macro_release", "research_view", "market_recap"] as const;

// ── 标签词表 ────────────────────────────────────────────────────────────────────────────

/** 每篇资料的第一个标签必须是这些“分类标签”之一（表示证据形态）。最后一个是兜底，必须放在最后。 */
export const CATEGORY_TAGS = [
  "资金与持仓", "机制与规则", "日程与催化", "公告与披露", "监管与政策", "宏观数据", "研究观点", "行情复盘",
  "其他",
] as const;

/** 可选的主题标签。 */
export const TOPIC_TAGS = [
  "ETF", "衍生品", "链上", "稳定币", "解锁/供给", "回购/销毁", "治理", "上币/下架", "安全事件", "指数调整", "财报", "内部人/机构持仓",
  "利率", "美元", "央行购金", "库存", "OPEC+",
] as const;

/** 可选的实体标签（卡片上直接显示的标的代码）。 */
export const ENTITY_TAGS = ["BTC", "ETH", "SOL", "黄金", "原油", "美联储", "SEC"] as const;

/** 模型常写的近义词，统一成词表里的写法。 */
export const TAG_SYNONYMS: Readonly<Record<string, string>> = {
  资金: "资金与持仓", 资金流: "资金与持仓", 持仓: "资金与持仓", 资金流向: "资金与持仓", "ETF资金流": "资金与持仓",
  机制: "机制与规则", 规则: "机制与规则", 代币经济: "机制与规则", 交易规则: "机制与规则",
  日程: "日程与催化", 催化: "日程与催化", 事件: "日程与催化", 未来事件: "日程与催化",
  公告: "公告与披露", 披露: "公告与披露", 财报披露: "公告与披露",
  监管: "监管与政策", 政策: "监管与政策", 法规: "监管与政策", 执法: "监管与政策",
  宏观: "宏观数据", 经济数据: "宏观数据", 数据: "宏观数据",
  观点: "研究观点", 研究: "研究观点", 分析: "研究观点", 报告: "研究观点",
  行情: "行情复盘", 复盘: "行情复盘", 盘面: "行情复盘",
  期货: "衍生品", 期权: "衍生品", 合约: "衍生品", 永续: "衍生品", 解锁: "解锁/供给", 供给: "解锁/供给",
  回购: "回购/销毁", 销毁: "回购/销毁", 上币: "上币/下架", 下架: "上币/下架", 黑客: "安全事件", 漏洞: "安全事件",
  "13F": "内部人/机构持仓", 内部人交易: "内部人/机构持仓", 比特币: "BTC", 以太坊: "ETH", 金价: "黄金", 油价: "原油",
};

// ── 标的与主体 ──────────────────────────────────────────────────────────────────────────

/**
 * 标的与主体主题：id → 显示名、卡片上显示的标签（null 表示只用 entity:<id> 归类）、别名。
 * aliases 给结构抽取模型看；orgNames 是这个主体发消息时开头用的组织名，
 * 在它自己的主题页上读者知道说的是谁，可以省去；otherNames 是其他称呼（官方账号名、子品牌、代码）。
 * 所有这些名字都用来认出说的是谁，比如把事实的主体对到发布方。
 * 观察清单不固定：这里先收常见的标的和机构，按每天的聚合情况增减。
 */
export const ENTITIES: Record<string, { name: string; displayTag: string | null; aliases: string[]; orgNames?: string[]; otherNames?: string[] }> = {
  // 加密资产
  bitcoin: { name: "比特币 BTC", displayTag: "BTC", aliases: ["Bitcoin", "BTC", "比特币"] },
  ethereum: { name: "以太坊 ETH", displayTag: "ETH", aliases: ["Ethereum", "ETH", "以太坊", "Ether"], orgNames: ["Ethereum Foundation", "以太坊基金会"] },
  solana: { name: "Solana SOL", displayTag: "SOL", aliases: ["Solana", "SOL"], orgNames: ["Solana Foundation"] },
  bnb: { name: "BNB", displayTag: null, aliases: ["BNB", "BNB Chain"] },
  xrp: { name: "XRP", displayTag: null, aliases: ["XRP", "Ripple"], orgNames: ["Ripple"] },
  hyperliquid: { name: "Hyperliquid HYPE", displayTag: null, aliases: ["Hyperliquid", "HYPE"] },
  tether: { name: "Tether USDT", displayTag: null, aliases: ["Tether", "USDT"], orgNames: ["Tether"] },
  circle: { name: "Circle USDC", displayTag: null, aliases: ["Circle", "USDC"], orgNames: ["Circle"], otherNames: ["CRCL"] },
  // 交易所与发行商
  binance: { name: "Binance 币安", displayTag: null, aliases: ["Binance", "币安"], orgNames: ["Binance", "币安"], otherNames: ["Binance Research", "币安合约"] },
  coinbase: { name: "Coinbase", displayTag: null, aliases: ["Coinbase", "COIN"], orgNames: ["Coinbase"] },
  okx: { name: "OKX", displayTag: null, aliases: ["OKX", "欧易"], orgNames: ["OKX", "欧易"] },
  blackrock: { name: "贝莱德 BlackRock", displayTag: null, aliases: ["BlackRock", "贝莱德", "iShares", "IBIT"], orgNames: ["BlackRock", "iShares"] },
  strategy: { name: "Strategy MSTR", displayTag: null, aliases: ["MicroStrategy", "MSTR", "Strategy Inc"], orgNames: ["Strategy", "MicroStrategy"] },
  // 股票
  nvidia: { name: "英伟达 NVDA", displayTag: null, aliases: ["NVIDIA", "NVDA", "英伟达"], orgNames: ["NVIDIA", "英伟达"] },
  tesla: { name: "特斯拉 TSLA", displayTag: null, aliases: ["Tesla", "TSLA", "特斯拉"], orgNames: ["Tesla", "特斯拉"] },
  tencent: { name: "腾讯控股 0700", displayTag: null, aliases: ["腾讯", "Tencent", "0700.HK"], orgNames: ["腾讯控股", "腾讯"] },
  hkex: { name: "香港交易所", displayTag: null, aliases: ["港交所", "HKEX", "香港交易所"], orgNames: ["香港交易及结算所", "港交所", "HKEX"] },
  // 商品
  gold: { name: "黄金", displayTag: "黄金", aliases: ["黄金", "金价", "Gold", "XAU", "GLD"] },
  "crude-oil": { name: "原油", displayTag: "原油", aliases: ["原油", "油价", "WTI", "Brent", "布伦特", "Crude"] },
  opec: { name: "OPEC+", displayTag: null, aliases: ["OPEC", "OPEC+", "欧佩克"], orgNames: ["OPEC", "欧佩克"] },
  // 货币与央行、监管
  "us-dollar": { name: "美元", displayTag: null, aliases: ["美元", "美元指数", "DXY", "USD"] },
  fed: { name: "美联储", displayTag: "美联储", aliases: ["美联储", "Federal Reserve", "Fed", "FOMC"], orgNames: ["Federal Reserve", "美联储", "FOMC"] },
  pboc: { name: "中国人民银行", displayTag: null, aliases: ["人民银行", "央行", "PBOC", "PBoC"], orgNames: ["中国人民银行"] },
  hkma: { name: "香港金管局", displayTag: null, aliases: ["金管局", "HKMA"], orgNames: ["香港金融管理局", "金管局"] },
  boj: { name: "日本央行", displayTag: null, aliases: ["日本央行", "日银", "BOJ", "Bank of Japan"], orgNames: ["Bank of Japan", "日本银行"] },
  sec: { name: "美国 SEC", displayTag: "SEC", aliases: ["SEC", "美国证监会", "Securities and Exchange Commission"], orgNames: ["SEC", "美国证券交易委员会"] },
  cftc: { name: "美国 CFTC", displayTag: null, aliases: ["CFTC", "商品期货交易委员会"], orgNames: ["CFTC"] },
  sfc: { name: "香港证监会", displayTag: null, aliases: ["香港证监会", "SFC"], orgNames: ["证券及期货事务监察委员会", "香港证监会"] },
};

/**
 * 身份词典：摘要和标题里出现的主体，必须在原文里也出现过，否则退回原标题、丢掉摘要（防止模型张冠李戴）。
 * 行业没有这个问题时可以留空数组。短代码容易和普通词撞，只收带边界的大写写法。
 */
export const IDENTITY_LEXICON: ReadonlyArray<{ id: string; name: string; patterns: RegExp[] }> = [
  { id: "bitcoin", name: "比特币", patterns: [/bitcoin|比特币|\bBTC\b/i] },
  { id: "ethereum", name: "以太坊", patterns: [/ethereum|以太坊|\bETH\b/i] },
  { id: "solana", name: "Solana", patterns: [/\bsolana\b|\bSOL\b/] },
  { id: "binance", name: "币安", patterns: [/binance|币安/i] },
  { id: "coinbase", name: "Coinbase", patterns: [/coinbase/i] },
  { id: "blackrock", name: "贝莱德", patterns: [/blackrock|贝莱德|\bIBIT\b/i] },
  { id: "strategy", name: "Strategy", patterns: [/microstrategy|\bMSTR\b/i] },
  { id: "nvidia", name: "英伟达", patterns: [/nvidia|英伟达|\bNVDA\b/i] },
  { id: "tesla", name: "特斯拉", patterns: [/tesla|特斯拉|\bTSLA\b/i] },
  { id: "tencent", name: "腾讯", patterns: [/腾讯|tencent/i] },
  { id: "opec", name: "OPEC", patterns: [/\bOPEC\b|欧佩克/i] },
];

/** 这些域名上的文章，发布方就是对应的主体（托管别人文件的站点，如 sec.gov 的 EDGAR，不算）。 */
export const PUBLISHER_DOMAINS: ReadonlyArray<{ entityId: string; domains: readonly string[] }> = [
  { entityId: "binance", domains: ["binance.com"] },
  { entityId: "coinbase", domains: ["coinbase.com"] },
  { entityId: "okx", domains: ["okx.com"] },
  { entityId: "blackrock", domains: ["blackrock.com", "ishares.com"] },
  { entityId: "fed", domains: ["federalreserve.gov"] },
  { entityId: "hkma", domains: ["hkma.gov.hk"] },
  { entityId: "sfc", domains: ["sfc.hk"] },
  { entityId: "cftc", domains: ["cftc.gov"] },
  { entityId: "opec", domains: ["opec.org"] },
  { entityId: "ethereum", domains: ["blog.ethereum.org"] },
];

/** 原文里的这些写法也算提到了对应主体。 */
export const IDENTITY_CONTEXT_ALIASES: ReadonlyArray<{ entityId: string; pattern: RegExp }> = [
  { entityId: "fed", pattern: /\bFOMC\b/ },
];
