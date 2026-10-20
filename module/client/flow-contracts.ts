/**
 * 给 B/C 页面的使用说明：
 * - import type { ContentReadyDetail, MediaReadyDetail, OrdersCreatedDetail,
 *   PublishingHandoffEventMap } from "../flow-contracts"（按页面目录调整相对路径）。
 *   跨包也可从 @frontmind/module-publish/client/flow-contracts 导入（已补显式导出）。
 * - 这三个 Detail 严格对应本轮《新版设计.html》最终生效的 CustomEvent.detail：
 *   frontmind:content-ready（schemaVersion=1）、frontmind:media-ready（最终覆盖为 3）、
 *   frontmind:orders-created（含 skipped）。媒体交接不是早期的 schemaVersion=1/2。
 * - 参考稿中的 price/fee/quote 是数字主单位，budgetStage 的 *Cents 是整数分；
 *   dataType=local_fictional_preview 必须保留，不能将这些演示快照当作真实报价或订单。
 * - 本仓库实际跨助手使用 flow.handoff / flow.record，未派发上述浏览器事件。
 *   实际接入请用 ArticleReadyHandoff / MediaReadyHandoff / OrderCreatedRecord；
 *   三种 Detail 仅为参考事件边界，不自动触发事件或替换现有 API/服务器契约。
 * - 若外壳监听 CustomEvent，可写 CustomEvent<PublishingHandoffEventMap[事件名]>；
 *   类型不是运行时校验，外部消息仍须核验来源、schemaVersion、数据类型和真实业务状态。
 * 本文件仅导出类型，无副作用；原工作台类型保持兼容。
 */
/** Optional main-workbench connections, independent of login/tenant machinery. */
export type BusinessWorkspaceOutput = {id:string;title:string;description?:string;type?:string;version?:string|number;status?:string;source?:string;pendingChanges?:boolean;onOpen?:()=>void;onRevise?:()=>void};
export type WorkbenchOutputRef = {resource:{kind:'article'|'article_version'|'publication_draft'|'publication_batch';id:string;label?:string};version?:string;sourceStepId:string;sourceMessageId?:string};
export type WorkbenchTaskState = {resources:Array<{kind:string;id:string;label?:string}>;step:string;values:Record<string,unknown>;records:Array<{id:string;label:string;status:'completed'|'failed'|'pending';detail?:string;timestamp:number;targetTask?:{conversationId:string;agentId:string}}>};


/** 原型稿件快照，来自 newDoc/contentContract，不是服务器 ArticleDetail。 */
export type HandoffArticleSnapshot = {
  id: string;
  title: string;
  html: string;
  tags: string[];
  brand: string;
  cluster: string;
  version: number;
  updatedAt: number;
};
export type ContentReadyArticle = {
  articleId: string;
  version: number;
  /** multi 模式下为 null，实际逐媒体标题在 titles 中。 */
  title: string | null;
  internalName: string;
  bodyHtml: string;
  tags: string[];
  brand: string;
  questionCluster: string;
};
/** frontmind:content-ready -> contentContract(c)。 */
export type ContentReadyDetail = {
  schemaVersion: 1;
  draftId: string;
  revision: number;
  mode: "single" | "multi";
  titlePolicy: "per_media" | "per_article_shared";
  articles: ContentReadyArticle[];
  selectedMedia: Record<string, string[]>;
  /** 键由 articleId + "|" + mediaId 构成。 */
  titles: Record<string, string>;
};
export type HandoffPreflight = {
  signature: string;
  passed: boolean;
  issues: string[];
  checkedAt: number;
};
/** X_rules/Y_rules 的合并结果；未知限制保留 null，不变成“无限制”。 */
export type HandoffMediaRequirements = {
  maxTitleChars: number | null;
  titleOperator: "lt" | "lte";
  minBodyChars: number;
  maxBodyChars: number | null;
  bodyOperator: "lt" | "lte";
  allowImages: boolean | null;
  maxImages: number | null;
  prohibitedWords: string[];
  note: string;
  allowLinks?: boolean | null;
  allowTables?: boolean | null;
  allowContact?: boolean | null;
  titleState?: string;
  bodyState?: string;
  imageState?: string;
  confirmed?: boolean;
  evidence?: string;
  confirmedAt?: number;
};
export type HandoffCartItem = {
  id: string;
  sources: string[];
  articleIds: string[];
  supplier: string;
  quote: number | null;
  quoteTime: string | null;
  versions: Record<string, number>;
  confirmedQuote?: boolean;
  manualQuote?: boolean;
  budgetRole?: "core" | "explore";
};
export type HandoffBudgetLimits = {
  totalCents: number;
  explorationCents: number;
  minPriceCents: number | null;
  maxPriceCents: number | null;
};
export type HandoffBudgetRow = {
  id: string;
  name: string;
  role: "core" | "explore";
  rank: number;
  existing: boolean;
  unitCents: number | null;
  quantity: number;
  articleIds: string[];
  status: "pending" | "retained" | "excluded" | "selected";
  pendingReasons: string[];
  inMatrix: boolean;
  costCents: number | null;
  reason: string;
};
export type HandoffBudgetApplied = {
  caps: HandoffBudgetLimits;
  draft: { total: string; explore: string; minPrice: string; maxPrice: string };
  appliedAt: number;
  signature: string;
  result: {
    rows: HandoffBudgetRow[];
    newIds: string[];
    totalCents: number;
    exploreCents: number;
    committedCents: number;
    remainingCents: number;
    blockers: string[];
  };
};
/** 参考 HTML 的本地内容矩阵快照，不等同于真实后端 MatrixResult。
 * 媒体层和输入快照属于参考稿扩展数据，消费者必须先检查实际字段再解释。 */
export type HandoffContentMatrix = {
  version: number;
  generatedAt: number;
  decisionStage: "content_only";
  conditions: Record<string, string>;
  layers: Array<Record<string, unknown>>;
  [key: string]: unknown;
};
export type MediaReadyItem = {
  articleId: string;
  version: number;
  resourceId: string;
  mediaName: string;
  title: string;
  price: number | null;
  requirements: HandoffMediaRequirements;
  characterCountPolicy: "unicode-codepoints; body-excludes-whitespace";
  preflight: HandoffPreflight | null;
  budgetRole: "core" | "explore";
};
/** frontmind:media-ready -> 最终 X_handoffData(c)，包括预算阶段覆盖。 */
export type MediaReadyDetail = Omit<ContentReadyDetail, "schemaVersion"> & {
  schemaVersion: 3;
  path: "third";
  thirdPartyCart: HandoffCartItem[];
  mediaItems: MediaReadyItem[];
  dataType: "local_fictional_preview";
  contentMatrix: HandoffContentMatrix | null;
  budgetStage: { limits: HandoffBudgetLimits | null; lastApplied: HandoffBudgetApplied | null };
  budgetSemantics: "exploration_is_included_in_total";
};
export type CreatedHandoffOrder = {
  id: string;
  batchId: string;
  draftId: string;
  articleId: string;
  snapshot: HandoffArticleSnapshot;
  title: string;
  mediaId: string;
  mediaName: string;
  tags: string[];
  fee: number;
  status: "processing";
  url: null;
  response: string;
  submittedAt: number;
  updatedAt: number;
  path: "owned" | "third";
  publishMode: "draft" | "publish" | "third";
  preflight: HandoffPreflight | null;
};
/** frontmind:orders-created -> submitOrders 的派发载荷。
 * Z_baseSubmit 返回后才给本地订单补 budgetRole/budgetLimits；派发时的 clone 不含这些字段。 */
export type OrdersCreatedDetail = {
  draftId: string;
  batchId: string;
  orders: CreatedHandoffOrder[];
  skipped: number;
};
export type PublishingHandoffEventMap = {
  "frontmind:content-ready": ContentReadyDetail;
  "frontmind:media-ready": MediaReadyDetail;
  "frontmind:orders-created": OrdersCreatedDetail;
};
export type PublishingHandoffEvent<Name extends keyof PublishingHandoffEventMap> = CustomEvent<PublishingHandoffEventMap[Name]>;

/** 以下对应当前仓库已运行的 flow 载荷，不新增或派发浏览器事件。 */
export type ArticleReadyHandoff = {
  targetAgentId: "media";
  title: string;
  resources: Array<{ kind: "article" | "article_version"; id: string }>;
  idempotencyKey: string;
  route: string;
};
export type MediaReadyHandoff = {
  targetAgentId: "publishing";
  title: string;
  resources: Array<{ kind: "article_version" | "publication_draft"; id: string }>;
  idempotencyKey: string;
  route: string;
};
export type OrderCreatedRecord = {
  id: string;
  label: string;
  detail: string;
  resources: Array<{ kind: "publication_batch"; id: string }>;
  outputRefs: WorkbenchOutputRef[];
};
