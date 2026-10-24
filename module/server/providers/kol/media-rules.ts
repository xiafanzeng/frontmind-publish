/** Rules derive only from the documented catalog fields, never guessed detail APIs. */
export const KOL_MEDIA_RULES_ENDPOINT = "/api/news_resource_2/data";
// TODO(运营): confirm whether a dedicated requirements endpoint exists and document
// its request/response before replacing this documented catalog endpoint.
export type RuleField = "title_chars" | "body_chars" | "images" | "links";
export type Rule = {
  field: RuleField;
  state: "constrained" | "explicitly_unlimited" | "unknown" | "conflict";
  max?: number;
  exclusive?: boolean;
  evidence: string[];
};
export type MediaRules = {
  version: 1;
  rawRemark: string;
  collectedAt: string;
  source: string;
  rules: Rule[];
  unresolved: string[];
};
export type RuleCheck = {
  field: string;
  actual: number | string;
  rule: Rule | string;
  evidence: string[];
  status: "pass" | "fail" | "needs_review";
};
export type RulePreflight = { status: RuleCheck["status"]; items: RuleCheck[] };

/** Unicode code points INCLUDING whitespace/punctuation, matching existing titles.
 * Only complete, unqualified clauses are machine constraints. Range, minimum,
 * exceptions, ambiguous 以内 and unsupported requirements stay manual review.
 */
export function parseMediaRules(rawRemark: string, collectedAt: string, titleLimit?: number | null): MediaRules {
  const candidates = new Map<RuleField, Rule[]>();
  const add = (rule: Rule) => candidates.set(rule.field, [...(candidates.get(rule.field) ?? []), rule]);
  if (titleLimit != null && Number.isSafeInteger(titleLimit) && titleLimit > 0) {
    add({ field: "title_chars", state: "constrained", max: titleLimit, exclusive: false, evidence: [`API title_limit=${titleLimit}`] });
  }
  const unresolved: string[] = [];
  for (const clause of rawRemark.split(/[；;。\n]+/u).map(x => x.trim()).filter(Boolean)) {
    // A missing supplier requirement is not a restriction or an unresolved
    // editorial condition. Keep its original text in rawRemark for display.
    if (/^(?:(?:标题|正文|图片|配图|链接)(?:要求|字数|数量)?\s*[:：]?\s*)?(?:未注明|未提供|暂无|[-—–]+)$/u.test(clause)) continue;
    const numeric = /^(标题|正文|图片|配图|链接)(?:字数|数量)?\s*(?:限制为|限制)?\s*(不超过|最多|少于|不得超过)\s*(\d+)\s*(字|字符|张|个)$/u.exec(clause);
    const unlimited = /^(标题|正文|图片|配图|链接)(?:字数|数量)?(?:无限制|不限)$/u.exec(clause);
    const forbidden = /^(?:禁止|不允许|不得)(图片|配图|链接)$/u.exec(clause);
    // Only complete prohibitions qualify. Do not infer a ban from phrases such
    // as “不支持图片时请联系编辑” or an absence of image support evidence.
    const imageForbidden = /^(?:(?:不支持|禁止|不允许|不得)(?:添加|使用|携带)?(?:图片|配图)|(?:图片|配图)(?:不支持|不允许|禁止)|(?:仅限|仅支持|只支持|只允许)(?:纯文字|纯文本)(?:稿件|稿)?|(?:不支持|不允许|禁止)图文)$/u.test(clause);
    const match = numeric ?? unlimited;
    const field = (name: string): RuleField => name === "标题" ? "title_chars" : name === "正文" ? "body_chars" : name === "链接" ? "links" : "images";
    if (numeric) {
      const f = field(numeric[1]!);
      const compatible = f.endsWith("chars") ? /^(字|字符)$/u.test(numeric[4]!) : f === "images" ? numeric[4]! === "张" : numeric[4]! === "个";
      const max = Number(numeric[3]);
      if (compatible && Number.isSafeInteger(max)) add({ field: f, state: "constrained", max, exclusive: numeric[2] === "少于", evidence: [clause] });
      else unresolved.push(clause);
    } else if (match) add({ field: field(match[1]!), state: "explicitly_unlimited", evidence: [clause] });
    else if (forbidden) add({ field: field(forbidden[1]!), state: "constrained", max: 0, exclusive: false, evidence: [clause] });
    else if (imageForbidden) add({ field: "images", state: "constrained", max: 0, exclusive: false, evidence: [clause] });
    else unresolved.push(clause);
  }
  const rules = (["title_chars", "body_chars", "images", "links"] as RuleField[]).map(field => {
    const rows = candidates.get(field) ?? [];
    if (!rows.length) return { field, state: "unknown", evidence: [] } as Rule;
    const first = rows[0]!;
    const conflict = rows.some(x => x.state !== first.state || x.max !== first.max || x.exclusive !== first.exclusive);
    return { ...first, state: conflict ? "conflict" : first.state, evidence: rows.flatMap(x => x.evidence) } as Rule;
  });
  return { version: 1, rawRemark, collectedAt, source: KOL_MEDIA_RULES_ENDPOINT, rules, unresolved };
}

export function preflightMediaRules(rules: MediaRules, article: { title: string; body: string; images: number; links: number }): RulePreflight {
  const values: Record<RuleField, number> = { title_chars: Array.from(article.title).length, body_chars: Array.from(article.body).length, images: article.images, links: article.links };
  const items: RuleCheck[] = rules.rules.map(rule => {
    const actual = values[rule.field];
    let status: RuleCheck["status"] = "needs_review";
    // Natural-language character limits do not establish the supplier's counting
    // convention. A breach of our count requires review; only title_limit is a
    // verified numeric catalog contract used by existing publication validation.
    const verifiedCount = !rule.field.endsWith("chars") || rule.evidence.some(x => x.startsWith("API title_limit="));
    // Unknown stays unknown in the returned evidence; it imposes no additional
    // media requirement and does not require a supplier confirmation to pass.
    if (rule.state === "unknown" || rule.state === "explicitly_unlimited") status = "pass";
    if (rule.state === "constrained" && rule.max !== undefined && verifiedCount) status = (rule.exclusive ? actual < rule.max : actual <= rule.max) ? "pass" : "fail";
    return { field: rule.field, actual, rule, evidence: rule.evidence, status };
  });
  for (const evidence of rules.unresolved) items.push({ field: "editorial", actual: "待人工核对稿件", rule: evidence, evidence: [evidence], status: "needs_review" });
  if (!article.title.trim() || !article.body.trim()) items.push({ field: "article", actual: "标题或正文为空", rule: "稿件标题与正文不能为空", evidence: [], status: "fail" });
  return { items, status: items.some(x => x.status === "fail") ? "fail" : items.some(x => x.status === "needs_review") ? "needs_review" : "pass" };
}

/** Read the existing server-controlled requirements snapshot when available. */
export function mediaRulesEvidence(remark: string | null | undefined, apiLimit: number | null | undefined, raw?: Record<string, unknown> | null) {
  const saved = raw?.frontmindMediaRules;
  if (saved && typeof saved === "object" && !Array.isArray(saved)) {
    const value = saved as Record<string, unknown>;
    if (typeof value.rawRemark === "string" && typeof value.collectedAt === "string") {
      return { remark: value.rawRemark, apiLimit: typeof value.apiTitleLimit === "number" ? value.apiTitleLimit : null };
    }
  }
  return { remark: remark ?? "", apiLimit };
}
export function mediaRulesTitleLimit(remark: string | null | undefined, apiLimit: number | null | undefined, raw?: Record<string, unknown> | null): number {
  const effective = mediaRulesEvidence(remark, apiLimit, raw);
  const parsed = parseMediaRules(effective.remark, "", effective.apiLimit);
  const title = parsed.rules.find(x => x.field === "title_chars")!;
  if (title.state === "constrained" && title.max !== undefined) return Math.max(0, Math.min(effective.apiLimit ?? 200, title.max - (title.exclusive ? 1 : 0)));
  return effective.apiLimit ?? 200;
}

/** The media-specific image rule shared by selection, saving and preflight.
 * Unknown requirements are permitted without changing their evidence state.
 * The existing technical image format and asset checks remain separate.
 */
export function mediaRulesImageBlocker(
  remark: string | null | undefined,
  apiLimit: number | null | undefined,
  raw: Record<string, unknown> | null | undefined,
  images: number,
): string | null {
  if (!Number.isSafeInteger(images) || images < 0) {
    throw new TypeError("Image count must be a non-negative safe integer");
  }
  // Image-specific restrictions do not apply to a text-only frozen article.
  if (images === 0) return null;
  const effective = mediaRulesEvidence(remark, apiLimit, raw);
  const imageRule = parseMediaRules(effective.remark, "", effective.apiLimit)
    .rules.find(rule => rule.field === "images")!;
  if (imageRule.state === "conflict") return "媒体图片要求存在冲突，请核对后重试。";
  if (imageRule.state !== "constrained" || imageRule.max === undefined) return null;
  const matches = imageRule.exclusive ? images < imageRule.max : images <= imageRule.max;
  if (matches) return null;
  if (imageRule.max === 0) return "此媒体明确不支持图片，请选择其他媒体或使用不含图片的稿件。";
  return `此媒体要求图片${imageRule.exclusive ? "少于" : "不超过"} ${imageRule.max} 张，当前稿件含 ${images} 张图片。`;
}
