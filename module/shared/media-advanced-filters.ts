/** One module-owned interpretation for query membership, facets and display.
 * Supplier raw fields remain untouched. Unqualified 天/日 and 周 are literal
 * durations (24h/168h); calendar promises/qualifiers have no verified conversion.
 */
export const ADVANCED_FILTER_VERSION = 1 as const;
export const PUBLISH_TIME_OPTIONS = [
  { value: "", label: "不限" },
  { value: "within_1h", label: "1小时内" }, { value: "within_3h", label: "3小时内" },
  { value: "within_6h", label: "6小时内" }, { value: "within_12h", label: "12小时内" },
  { value: "within_1d", label: "1天内" }, { value: "within_2d", label: "2天内" },
  { value: "within_3d", label: "3天内" }, { value: "over_3d", label: "3天以上" },
  { value: "unconfirmed", label: "时效待确认" },
] as const;
export type PublishTimeBand = Exclude<(typeof PUBLISH_TIME_OPTIONS)[number]["value"], "">;
const UPPER_HOURS: Partial<Record<PublishTimeBand, number>> = {
  within_1h: 1, within_3h: 3, within_6h: 6, within_12h: 12,
  within_1d: 24, within_2d: 48, within_3d: 72,
};
export const ENTRY_OPTIONS = [
  { value: "", label: "不限" }, { value: "none", label: "无入口" },
  { value: "column", label: "栏目页面" }, { value: "channel", label: "频道首页" },
  { value: "home", label: "网站首页" }, { value: "unspecified", label: "未注明" },
] as const;
export const LINK_OPTIONS = [
  { value: "", label: "不限" },
  { value: "not_allowed_unconfirmed", label: "不带（限制范围待确认）" },
  { value: "allowed_unconfirmed", label: "可带（内容类型待确认）" },
  { value: "phone", label: "可带电话" }, { value: "unspecified", label: "未注明" },
] as const;
export const FESTIVAL_OPTIONS = [
  { value: "", label: "不限" }, { value: "publishable", label: "可发布" },
  { value: "not_publishable", label: "不可发布" }, { value: "unspecified", label: "未注明" },
] as const;
export type FestivalStatus = Exclude<(typeof FESTIVAL_OPTIONS)[number]["value"], "">;

const label = (options: readonly { value: string; label: string }[], value: string) =>
  options.find((option) => option.value === value)?.label ?? (value.startsWith("raw:") ? value.slice(4) : value);
export const publishTimeLabel = (value: string) => label(PUBLISH_TIME_OPTIONS, value);
export const entryCategoryLabel = (value: string) => label(ENTRY_OPTIONS, value);
export const linkCategoryLabel = (value: string) => label(LINK_OPTIONS, value);
export const festivalStatusLabel = (value: string) => label(FESTIVAL_OPTIONS, value);

function literalNumber(text: string): number | null {
  if (/^\d+(?:\.\d+)?$/u.test(text)) return Number(text);
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
  const parts = text.split("点");
  if (parts.length > 2 || !parts[0]) return null;
  let integer = 0;
  if (/^[零〇一二两三四五六七八九]+$/u.test(parts[0])) {
    integer = Number([...parts[0]].map((char) => digits[char]).join(""));
  } else {
    let digit: number | undefined;
    let previousUnit = Infinity;
    for (const char of parts[0]) {
      const unit = char in units ? units[char]! : undefined;
      if (char in digits) { if (digit !== undefined && digit !== 0) return null; digit = digits[char]; }
      else if (unit !== undefined && unit < previousUnit) {
        integer += (digit ?? 1) * unit; previousUnit = unit; digit = undefined;
      } else return null;
    }
    integer += digit ?? 0;
  }
  if (parts.length === 1) return integer;
  if (!parts[1] || !/^[零〇一二两三四五六七八九]+$/u.test(parts[1])) return null;
  return integer + Number(`0.${[...parts[1]].map((char) => digits[char]).join("")}`);
}

const NUMBER = "(?:\\d+(?:\\.\\d+)?|[零〇一二两三四五六七八九十百千点]+)";
const UNIT = "(?:分钟|分|小时|自然天|自然日|天|日|周|星期)";
const duration = new RegExp(`^(${NUMBER})(?:个)?(${UNIT})(?:以内|之内|内)?$`, "u");
const range = new RegExp(`^(${NUMBER})(?:个)?(${UNIT})?(?:-|–|—|~|～|至|到)(${NUMBER})(?:个)?(${UNIT})(?:以内|之内|内)?$`, "u");
const unitHours = (unit: string) => /^(分钟|分)$/u.test(unit) ? 1 / 60
  : unit === "小时" ? 1 : /^(周|星期)$/u.test(unit) ? 168 : 24;

export function normalizePublishTime(raw: string | null | undefined): {
  upperHours: number | null; band: PublishTimeBand; reason: string;
} {
  const text = raw?.trim().replace(/\s+/gu, "") ?? "";
  const unknown = (reason: string) => ({ upperHours: null, band: "unconfirmed" as const, reason });
  if (!text) return unknown("missing");
  if (/[\d零〇一二两三四五六七八九十百千点]\s+[\d零〇一二两三四五六七八九十百千点]/u.test(raw ?? "")) return unknown("unsupported_number");
  // Full-string syntax deliberately rejects qualifiers, approximations, open-ended
  // lower bounds, bare numbers, calendar half-days/same-day promises and months.
  let upperHours: number | null = null;
  let reason = "literal_duration";
  if (/^半(?:个)?小时(?:以内|之内|内)?$/u.test(text)) upperHours = 0.5;
  else if (/^半分钟(?:以内|之内|内)?$/u.test(text)) upperHours = 1 / 120;
  else {
    const bounds = range.exec(text);
    const single = duration.exec(text);
    if (bounds) {
      const low = literalNumber(bounds[1]!);
      const high = literalNumber(bounds[3]!);
      if (low === null || high === null) return unknown("unsupported_number");
      const lowHours = low * unitHours(bounds[2] ?? bounds[4]!);
      upperHours = high * unitHours(bounds[4]!);
      if (lowHours > upperHours) return unknown("invalid_range");
      reason = "literal_range_upper_bound";
    } else if (single) {
      const amount = literalNumber(single[1]!);
      if (amount !== null) upperHours = amount * unitHours(single[2]!);
    }
  }
  if (upperHours === null || !Number.isFinite(upperHours) || upperHours < 0) return unknown("unconfirmed_basis");
  const hours = upperHours;
  const band = PUBLISH_TIME_OPTIONS.find(({ value }) => value && UPPER_HOURS[value] !== undefined
    && hours <= UPPER_HOURS[value]!)?.value as PublishTimeBand | undefined;
  return { upperHours, band: band ?? "over_3d", reason };
}

export function publishTimeMatches(raw: string | null | undefined, selection: PublishTimeBand): boolean {
  const normalized = normalizePublishTime(raw);
  if (selection === "unconfirmed") return normalized.upperHours === null;
  if (normalized.upperHours === null) return false;
  if (selection === "over_3d") return normalized.upperHours > 72;
  const limit = UPPER_HOURS[selection];
  return limit !== undefined && normalized.upperHours <= limit;
}

export function normalizeEntry(raw: string | null | undefined) {
  const text = raw?.trim() ?? "";
  const aliases: Record<string, string> = { 没有入口: "none", 无入口: "none", 栏目页面: "column", 频道首页: "channel", 首页入口: "home", 网站首页: "home" };
  const alias = Object.prototype.hasOwnProperty.call(aliases, text) ? aliases[text]! : undefined;
  const value = !text || ["未注明", "未提供", "未知", "—", "-"].includes(text) ? "unspecified"
    : alias ?? `raw:${raw}`;
  return { value, label: entryCategoryLabel(value) };
}
export function normalizeLink(raw: string | null | undefined) {
  const text = raw?.trim() ?? "";
  const aliases: Record<string, string> = { 不带: "not_allowed_unconfirmed", 可带: "allowed_unconfirmed", 电话: "phone", 可带电话: "phone" };
  const alias = Object.prototype.hasOwnProperty.call(aliases, text) ? aliases[text]! : undefined;
  const value = !text || ["未注明", "未提供", "未知", "—", "-"].includes(text) ? "unspecified"
    : alias ?? `raw:${raw}`;
  return { value, label: linkCategoryLabel(value) };
}
export type RawAdvancedFacet = { value: string | null; count: number };
export function normalizedPublishTimeFacets(rows: readonly RawAdvancedFacet[]) {
  return PUBLISH_TIME_OPTIONS.filter(({ value }) => value !== "").map(({ value }) => ({
    value, count: rows.reduce((sum, row) => sum + (publishTimeMatches(row.value, value as PublishTimeBand) ? row.count : 0), 0),
  }));
}
function categoryFacets(rows: readonly RawAdvancedFacet[], options: readonly { value: string }[], normalize: typeof normalizeEntry) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const { value } = normalize(row.value);
    counts.set(value, (counts.get(value) ?? 0) + row.count);
  }
  const fixed = options.filter(({ value }) => value !== "").map(({ value }) => ({ value, count: counts.get(value) ?? 0 }));
  const known = new Set(options.map(({ value }) => value));
  return [...fixed, ...[...counts].filter(([value]) => !known.has(value))
    .sort(([left], [right]) => left.localeCompare(right)).map(([value, count]) => ({ value, count }))];
}
export const normalizedEntryFacets = (rows: readonly RawAdvancedFacet[]) => categoryFacets(rows, ENTRY_OPTIONS, normalizeEntry);
export const normalizedLinkFacets = (rows: readonly RawAdvancedFacet[]) => categoryFacets(rows, LINK_OPTIONS, normalizeLink);
