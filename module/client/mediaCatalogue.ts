import type { CatalogFreshness, MediaFilters } from "./types";

/** Never derive inventory from a result page or combine different snapshots. */
export function catalogueInventory(catalog?: CatalogFreshness) {
  if (!catalog || catalog.countStatus === "unavailable" || catalog.kindComplete === false) return undefined;
  const { mediaCount, newsCount, selfMediaCount } = catalog;
  if (![mediaCount, newsCount, selfMediaCount].every(value => typeof value === "number" && Number.isSafeInteger(value) && value >= 0)) return undefined;
  if (mediaCount !== newsCount! + selfMediaCount!) return undefined;
  return { all: mediaCount!, news: newsCount!, selfMedia: selfMediaCount! };
}

/** Cached result pages may be older than the last completed inventory read. */
export function chooseCatalogueSnapshot(current: CatalogFreshness | undefined, previous: CatalogFreshness | undefined, reading: boolean) {
  if (!previous) return current;
  if (reading || !current) return previous;
  if (current.countStatus === "unavailable" || current.kindComplete === false) return current;
  const currentTime = Date.parse(current.lastSyncedAt), previousTime = Date.parse(previous.lastSyncedAt);
  return Number.isFinite(currentTime) && Number.isFinite(previousTime) && currentTime < previousTime ? previous : current;
}

export const cataloguePriceRanges = [
  { label: "不限", min: "", max: "", exclusive: false },
  { label: "0–50", min: "0", max: "50", exclusive: false },
  { label: "大于 50–100", min: "50", max: "100", exclusive: true },
  { label: "大于 100–150", min: "100", max: "150", exclusive: true },
  { label: "大于 150–200", min: "150", max: "200", exclusive: true },
  { label: "大于 200", min: "200", max: "", exclusive: true },
] as const;

function moneyUnits(value: string): bigint | undefined {
  if (!/^\d+(?:\.\d{1,4})?$/u.test(value)) return undefined;
  const [whole = "", fraction = ""] = value.split(".");
  const amount = BigInt(whole) * 10_000n + BigInt(fraction.padEnd(4, "0"));
  return amount <= 1_000_000_000_000n ? amount : undefined;
}

export function validateCataloguePrice(minimum: string, maximum: string) {
  const min = minimum.trim(), max = maximum.trim();
  const a = min ? moneyUnits(min) : undefined, b = max ? moneyUnits(max) : undefined;
  if ((min && a === undefined) || (max && b === undefined)) return { error: "请输入 0 至 1 亿元的金额，最多保留 4 位小数。" };
  if (a !== undefined && b !== undefined && a > b) return { error: "最低价不能高于最高价。" };
  return { min, max };
}

export function validateCatalogueNames(value: string) {
  const names = [...new Set(value.split(/[\r\n,，]/u).map(name => name.trim()).filter(Boolean))];
  if (names.length > 50) return { error: "一次最多搜索 50 个不同的媒体名称，请减少后再试。", names };
  if (names.some(name => name.length > 120)) return { error: "每个媒体名称最多 120 个字符。", names };
  return { names, error: "" };
}

export function cataloguePriceLabel(filters: MediaFilters) {
  const min = filters.priceMin ?? "", max = filters.priceMax ?? "";
  if (!min && !max) return "";
  return `${min ? `${filters.priceMinExclusive ? ">" : "≥"}${min}` : ""}${min && max ? "，" : ""}${max ? `≤${max}` : ""} 元`;
}
