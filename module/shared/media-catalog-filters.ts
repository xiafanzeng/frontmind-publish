/** Reviewed exact values from references/facet-values-live.json (2026-10-24).
 * These describe supplier coverage/tags, never an inferred location or AI outcome.
 * Unreviewed values deliberately have no normalized match; legacy exact filters survive.
 */
export type Coverage = { province: string; city?: string };
type AliasGroup = readonly [value: string, rawValues: readonly string[]];

const provinceGroups: readonly AliasGroup[] = [
  ["全国覆盖", ["全国"]], ["综合全国（待确认）", ["综合全国"]],
  ["北京", ["北京", "北京市"]], ["上海", ["上海", "上海市"]],
  ["天津", ["天津", "天津市"]], ["重庆", ["重庆", "重庆市"]],
  ["广东", ["广东", "广东省"]], ["江苏", ["江苏", "江苏省"]],
  ["浙江", ["浙江", "浙江省"]], ["山东", ["山东", "山东省"]],
  ["河南", ["河南", "河南省"]], ["河北", ["河北", "河北省"]],
  ["四川", ["四川", "四川省"]], ["湖北", ["湖北", "湖北省"]],
  ["湖南", ["湖南", "湖南省"]], ["福建", ["福建", "福建省"]],
  ["安徽", ["安徽", "安徽省"]], ["江西", ["江西", "江西省"]],
  ["山西", ["山西", "山西省"]], ["陕西", ["陕西", "陕西省"]],
  ["辽宁", ["辽宁", "辽宁省"]], ["吉林", ["吉林", "吉林省"]],
  ["黑龙江", ["黑龙江", "黑龙江省"]], ["海南", ["海南", "海南省"]],
  ["云南", ["云南", "云南省"]], ["贵州", ["贵州", "贵州省"]],
  ["甘肃", ["甘肃", "甘肃省"]], ["青海", ["青海", "青海省"]],
  ["广西", ["广西", "广西壮族自治区"]],
  ["内蒙古", ["内蒙古", "内蒙古自治区"]],
  ["宁夏", ["宁夏", "宁夏回族自治区"]],
  ["新疆", ["新疆", "新疆维吾尔自治区"]], ["西藏", ["西藏"]],
  // These are separate supplier coverage categories, not ordinary province/city pairs.
  ["香港", ["香港"]], ["港澳台", ["港澳台"]], ["海外", ["海外"]],
];

const cityGroups: readonly (readonly [province: string, city: string, rawValues: readonly string[]])[] = [
  ["广东", "深圳市", ["广东省 深圳市", "广东省  深圳市", "深圳"]],
  ["广东", "广州市", ["广东省 广州市"]], ["广东", "佛山市", ["广东省 佛山市"]],
  ["浙江", "杭州市", ["浙江省 杭州市"]], ["浙江", "嘉兴市", ["浙江省 嘉兴市"]],
  ["浙江", "宁波市", ["浙江省 宁波市"]],
  ["四川", "成都市", ["四川省 成都市", "四川 成都"]],
  ["四川", "乐山市", ["四川省 乐山市"]], ["四川", "德阳市", ["四川省 德阳市"]],
  ["辽宁", "沈阳市", ["辽宁省 沈阳市"]], ["辽宁", "大连市", ["辽宁省 大连市", "大连"]],
  ["辽宁", "盘锦市", ["辽宁省 盘锦市"]],
  ["山东", "济南市", ["山东省 济南市"]], ["山东", "淄博市", ["山东省 淄博市"]],
  ["山东", "潍坊市", ["山东省 潍坊市"]], ["山东", "烟台市", ["山东省 烟台市"]],
  ["河南", "洛阳市", ["河南省 洛阳市"]], ["河南", "郑州市", ["河南省 郑州市"]],
  ["河南", "周口市", ["河南省 周口市"]], ["河南", "驻马店市", ["河南省 驻马店市"]],
  ["河南", "鹤壁市", ["河南省 鹤壁市"]], ["湖北", "武汉市", ["湖北省 武汉市"]],
  ["湖南", "长沙市", ["湖南省  长沙市", "湖南省 长沙市"]],
  ["黑龙江", "哈尔滨市", ["黑龙江省 哈尔滨市"]],
  ["黑龙江", "牡丹江市", ["黑龙江省 牡丹江市"]],
  ["安徽", "合肥市", ["安徽省 合肥市"]], ["安徽", "安庆市", ["安徽省 安庆市"]],
  ["安徽", "滁州市", ["安徽省 滁州市"]], ["安徽", "阜阳市", ["安徽省 阜阳市"]],
  ["江苏", "南京市", ["江苏省 南京市"]], ["江苏", "苏州市", ["江苏省 苏州市", "苏州"]],
  ["甘肃", "兰州市", ["甘肃省 兰州市"]], ["福建", "厦门市", ["福建省 厦门市"]],
  ["福建", "莆田市", ["福建省 莆田市"]], ["贵州", "贵阳市", ["贵州省 贵阳市"]],
];

const aiGroups: readonly AliasGroup[] = [
  ["DeepSeek", ["DeepSeek"]], ["Kimi", ["kimi"]], ["腾讯元宝", ["腾讯元宝"]],
  ["通义千问", ["通义千问"]], ["文心一言", ["文心一言"]], ["豆包", ["豆包"]],
];

// Preserve exact single-tag semantics. In particular, no weekend/festival equivalence,
// no composite splitting, no generic AI/GEO -> platform inference, no raw 推荐 -> is_recommend.
const recommendationGroups: readonly AliasGroup[] = [
  ["周末可发", ["周末可发"]], ["可带表格", ["可带表格"]], ["高收录", ["高收录"]],
  ["包收录", ["包收录"]], ["急速出稿", ["急速出稿"]], ["极速出稿", ["极速出稿"]],
  ["带视频", ["带视频"]], ["可带视频", ["可带视频"]], ["百科可用", ["百科可用"]],
  ["可显示阅读量", ["可显示阅读量"]], ["可带署名", ["可带署名"]],
  ["官方自媒体", ["官方自媒体"]], ["站内搜索", ["站内搜索"]],
  ["可首发", ["可首发"]], ["可挂商品链接", ["可挂商品链接"]],
  ["可重发百家号", ["可重发百家号"]],
  // PRO_TASK's reviewed spelling normalization; still a supplier label, not a verified guarantee.
  ["无免责声明", ["无免责申明", "无免责声明"]], ["首页展示", ["首页展示"]],
  ["白名单来源", ["白名单来源"]], ["国庆可发", ["国庆可发"]],
  ["节假日可发", ["节假日可发"]], ["AI", ["AI"]],
  ["GEO排名", ["GEO排名"]], ["可发GEO", ["可发GEO"]],
];

function normalizeAlias(groups: readonly AliasGroup[], raw: string): string | undefined {
  return groups.find(([, values]) => values.includes(raw))?.[0];
}

function aliasValues(groups: readonly AliasGroup[], value: string): readonly string[] {
  return groups.find(([id]) => id === value)?.[1] ?? [];
}

export function normalizeCoverage(raw: string): Coverage | undefined {
  const province = normalizeAlias(provinceGroups, raw);
  if (province) return { province };
  const city = cityGroups.find(([, , values]) => values.includes(raw));
  return city ? { province: city[0], city: city[1] } : undefined;
}

export function coverageRawValues(province: string, city?: string): readonly string[] {
  if (city) return cityGroups.find(([parent, value]) => parent === province && value === city)?.[2] ?? [];
  return [
    ...aliasValues(provinceGroups, province),
    ...cityGroups.filter(([parent]) => parent === province).flatMap(([, , values]) => values),
  ];
}

export const normalizeAiPlatform = (raw: string) => normalizeAlias(aiGroups, raw);
export const normalizeRecommendation = (raw: string) => normalizeAlias(recommendationGroups, raw);
export const aiPlatformRawValues = (value: string): readonly string[] => aliasValues(aiGroups, value);
export const recommendationRawValues = (value: string): readonly string[] => aliasValues(recommendationGroups, value);

export type CountedValue = { value: string; count: number };
export type CountedCity = CountedValue & { province: string };

/** Stable review order, never a rank that changes with result counts. */
export function normalizedCoverageFacets(areas: readonly CountedValue[]) {
  const provinces = new Map<string, number>();
  const cities = new Map<string, number>();
  for (const { value, count } of areas) {
    const coverage = normalizeCoverage(value);
    if (!coverage) continue;
    provinces.set(coverage.province, (provinces.get(coverage.province) ?? 0) + count);
    if (coverage.city) {
      const key = `${coverage.province}/${coverage.city}`;
      cities.set(key, (cities.get(key) ?? 0) + count);
    }
  }
  return {
    coverageProvinces: provinceGroups.flatMap(([value]) => {
      const count = provinces.get(value) ?? 0;
      return count > 0 ? [{ value, count }] : [];
    }),
    coverageCities: cityGroups.flatMap(([province, value]) => {
      const count = cities.get(`${province}/${value}`) ?? 0;
      return count > 0 ? [{ province, value, count }] : [];
    }),
  };
}

/** Each row represents one exact stored tag array and its resource count.
 * Deduplicate canonical ids inside that array BEFORE adding the resource count.
 * Summing individual tag facets would double-count a media with two equivalent aliases.
 */
export function normalizedTagFacets(rows: readonly { tags: readonly string[]; count: number }[]) {
  const ai = new Map<string, number>();
  const recommendations = new Map<string, number>();
  for (const row of rows) {
    const aiIds = new Set(row.tags.map(normalizeAiPlatform).filter((id): id is string => id !== undefined));
    const recommendationIds = new Set(row.tags.map(normalizeRecommendation).filter((id): id is string => id !== undefined));
    for (const id of aiIds) ai.set(id, (ai.get(id) ?? 0) + row.count);
    for (const id of recommendationIds) recommendations.set(id, (recommendations.get(id) ?? 0) + row.count);
  }
  const options = (groups: readonly AliasGroup[], counts: Map<string, number>) =>
    groups.flatMap(([value]) => (counts.get(value) ?? 0) > 0 ? [{ value, count: counts.get(value)! }] : []);
  return { aiPlatforms: options(aiGroups, ai), recommendationGroups: options(recommendationGroups, recommendations) };
}
