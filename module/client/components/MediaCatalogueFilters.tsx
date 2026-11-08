import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cataloguePriceLabel, cataloguePriceRanges, validateCatalogueNames, validateCataloguePrice } from "../mediaCatalogue";
import type { MediaFacetOption, MediaFacets, MediaFilters } from "../types";
import CatalogueChipRow from "./CatalogueChipRow";
import { mediaReadError } from "../mediaReadError";
import { isUnrestrictedMediaCoverage, normalizeMediaCoverageFilters } from "../mediaCoverage";
import { ADVANCED_FILTER_VERSION, PUBLISH_TIME_OPTIONS, ENTRY_OPTIONS, LINK_OPTIONS, FESTIVAL_OPTIONS } from "../../shared/media-advanced-filters";
import PublishingFieldHelp from "./PublishingFieldHelp";
import "../publishing.catalogue.css";

const channels = "新闻资讯 财经商业 IT科技 健康医疗 汽车网站 亲子母婴 生活消费 教育培训 食品餐饮 工业贸易 房产家居 女性时尚 游戏动漫 酒店旅游 娱乐休闲 能源环保 文化艺术 体育运动 公益三农 低价专区 一口价 优惠套餐 报纸 海外媒体".split(" ");
const portals = "新浪网 网易 凤凰网 搜狐网 腾讯网 中华网 千龙网 中国网 中国日报网 中国新闻网 国际在线 北青网 环球网 光明网 中国青年网 中国经济网 央广网 人民网 央视网 新华网 东方网 大众网 和讯网 其他门户".split(" ");
const recommendations = "急速出稿 高收录 包收录 带视频 百科可用 无免责声明 周末可发 站内搜索 可显示阅读量 可带署名 可发GEO 白名单来源 可带表格".split(" ");
const aiPlatforms = ["DeepSeek", "豆包", "通义千问", "腾讯元宝", "文心一言", "Kimi"];

const advancedExplanations = {
  publishTimeBand: "供应商目录的预计时效，起算条件以媒体要求为准，不是完成时间承诺。“内”包含更快时效和边界；范围取较慢端，“3天以上”按标注上限超过72小时归类。普通天/日按24小时名义换算；当天、半天、工作日、截稿后顺延、无单位或缺失等口径未确认，列为时效待确认并保留原值。",
  entryCategory: "指文章通常从媒体网站哪个页面进入：栏目页面是具体栏目，频道首页是频道起始页，网站首页是网站主页。“无入口”仅表示目录注明不提供对应展示入口，不代表文章没有访问链接；未注明是缺少信息。入口不代表永久推荐、固定展示时长或流量保证。",
  linkCategory: "供应商目录中的正文链接/联系方式要求。“可带电话”表示可含电话号码，其他形式需另行确认；不代表只能带电话。“可带”是否为网址文本、可点击链接或其他内容尚未确认；“不带”的限制范围未确认，不能推断禁止所有联系方式。未注明是缺少信息，具体形式以媒体发布要求为准。",
  pcWeight: "供应商自报的电脑端搜索表现参考指标，不是百度官方评分，不保证实际排名、流量或发布效果。按不低于所选值筛选；未提供为未知，不按0计算，真实0仍保留。",
  mobileWeight: "供应商自报的移动端搜索表现参考指标，不是百度官方评分，不保证实际排名、流量或发布效果。按不低于所选值筛选；未提供为未知，不按0计算，真实0仍保留。",
  includeRate: "供应商自报的文章被搜索引擎收录比例；具体搜索引擎、统计周期、样本量及完整口径未提供，不代表本次稿件必然被收录的概率。按不低于所选百分比筛选，缺失为未知，真实0仍保留。",
  successRate: "供应商自报的发布成功比例，与搜索收录率不同，非本系统统计；统计周期、样本量及完整口径未提供，不保证本次投稿成功。按不低于所选百分比筛选，缺失为未知，真实0仍保留。",
  festivalStatus: "按供应商目录的节假日发布字段筛选：明确为是、明确为否、未提供，分别对应可发布、不可发布、未注明。节假日不直接等同于周末；具体日期与接单安排需供应商确认。",
};

type AdvancedOption = { value: string; label: string; count?: number };
type AdvancedField = {
  key: keyof MediaFilters; label: string; options: readonly AdvancedOption[];
  help?: string; normalized?: boolean; legacyKey?: "publishSpeed" | "entryType" | "linkType" | "festival";
};

// Fixed choices may have a real zero count; missing counts are never invented.
function fixedOptions(definitions: readonly AdvancedOption[], facets: MediaFacetOption[] = []): AdvancedOption[] {
  return [...definitions.filter(option => option.value).map(option => ({ ...option, count: facets.find(item => item.value === option.value)?.count })),
    ...facets.filter(option => option.value && !definitions.some(item => item.value === option.value))];
}

function orderedOptions(options: MediaFacetOption[] = [], order: string[] = []) {
  return [...options].sort((a, b) => {
    const ai = order.indexOf(a.value), bi = order.indexOf(b.value);
    return (ai < 0 ? order.length : ai) - (bi < 0 ? order.length : bi) || a.label.localeCompare(b.label, "zh-CN");
  });
}

function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  return <div className="mc-filter-row" role="group" aria-label={label}><span className="mc-filter-label">{label}</span><div className="mc-filter-values">{children}</div></div>;
}

function OptionChips({ label, value, options, onChange, disabled, emptyMessage }: {
  label: string; value: string; options: MediaFacetOption[]; onChange: (value: string) => void; disabled?: boolean; emptyMessage?: string;
}) {
  return <CatalogueChipRow label={label} value={value} options={options} onChange={onChange} loading={disabled} emptyMessage={emptyMessage} />;
}

type Props = {
  filters: MediaFilters;
  facets?: MediaFacets;
  facetsLoading: boolean;
  facetsRefreshing?: boolean;
  facetsVersionMismatch?: boolean;
  facetsError?: string;
  onRetry: () => void;
  onChange: (filters: MediaFilters) => void;
  onReset: () => void;
};

export default function MediaCatalogueFilters(props: Props) {
  const { facets, facetsLoading, facetsRefreshing, facetsVersionMismatch, facetsError, onRetry, onChange, onReset } = props;
  const filters = normalizeMediaCoverageFilters(props.filters);
  const [query, setQuery] = useState(filters.query);
  const [queryError, setQueryError] = useState("");
  const [composing, setComposing] = useState(false);
  const [minimum, setMinimum] = useState(filters.priceMin ?? "");
  const [maximum, setMaximum] = useState(filters.priceMax ?? "");
  const [priceError, setPriceError] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const fieldId = useId();
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef(props);
  latest.current = { ...props, filters };
  const pendingSearch = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancelSearch = () => { if (pendingSearch.current !== undefined) clearTimeout(pendingSearch.current); };

  useEffect(() => { setQuery(filters.query); setQueryError(""); }, [filters.query]);
  useEffect(() => { setMinimum(filters.priceMin ?? ""); setMaximum(filters.priceMax ?? ""); setPriceError(""); }, [filters.priceMin, filters.priceMax]);
  useEffect(() => {
    cancelSearch();
    if (composing || query.trim() === filters.query) return;
    if (query.trim().length > 120) { setQueryError("媒体名称最多 120 个字符。"); return; }
    setQueryError("");
    pendingSearch.current = setTimeout(() => {
      const current = latest.current;
      current.onChange({ ...current.filters, query: query.trim(), searchScope: "name", page: 1 });
    }, 300);
    return cancelSearch;
  }, [query, filters.query, composing]);

  const change = (patch: Partial<MediaFilters>) => onChange({ ...filters, ...patch, searchScope: "name", page: 1 });
  const searchNow = () => {
    cancelSearch();
    if (composing) return;
    if (query.trim().length > 120) { setQueryError("媒体名称最多 120 个字符。"); input.current?.focus(); return; }
    setQueryError("");
    change({ query: query.trim() });
  };
  const clearQuery = () => { cancelSearch(); setQuery(""); setQueryError(""); change({ query: "" }); input.current?.focus(); };
  const clearAll = () => {
    cancelSearch(); setQuery(""); setMinimum(""); setMaximum("");
    setPriceError(""); setQueryError(""); onReset();
  };
  const applyPrice = () => {
    const validated = validateCataloguePrice(minimum, maximum);
    if (validated.error) { setPriceError(validated.error); return; }
    setPriceError("");
    change({ priceMin: validated.min, priceMax: validated.max, priceMinExclusive: false, price: "" });
  };

  const advancedSupported = facets?.advancedFilterVersion === ADVANCED_FILTER_VERSION && !facetsVersionMismatch;
  const advancedFields: AdvancedField[] = [
    { key: "mediaType", label: "媒体类型", options: facets?.mediaTypes ?? [] },
    { key: "includeType", label: "收录类型", options: facets?.includeTypes ?? [] },
    { key: "publishTimeBand", label: "预计发布时效", options: fixedOptions(PUBLISH_TIME_OPTIONS, facets?.publishTimeBands), normalized: true, legacyKey: "publishSpeed", help: advancedExplanations.publishTimeBand },
    { key: "entryCategory", label: "文章展示入口", options: fixedOptions(ENTRY_OPTIONS, facets?.entryCategories), normalized: true, legacyKey: "entryType", help: advancedExplanations.entryCategory },
    { key: "linkCategory", label: "链接与联系方式", options: fixedOptions(LINK_OPTIONS, facets?.linkCategories), normalized: true, legacyKey: "linkType", help: advancedExplanations.linkCategory },
    { key: "pcWeight", label: "百度电脑端权重", options: facets?.pcWeightThresholds ?? [], help: advancedExplanations.pcWeight },
    { key: "mobileWeight", label: "百度移动端权重", options: facets?.mobileWeightThresholds ?? [], help: advancedExplanations.mobileWeight },
    { key: "includeRate", label: "收录率", options: facets?.includeRateThresholds ?? [], help: advancedExplanations.includeRate },
    { key: "successRate", label: "发布成功率", options: facets?.successRateThresholds ?? [], help: advancedExplanations.successRate },
    { key: "festivalStatus", label: "节假日发布", options: fixedOptions(FESTIVAL_OPTIONS, facets?.festivalStatuses), normalized: true, legacyKey: "festival", help: advancedExplanations.festivalStatus },
  ];
  const selected: Array<{ key: string; label: string; remove: () => void }> = [];
  const selectedField = (key: keyof MediaFilters, label: string, options: readonly AdvancedOption[] = []) => {
    const value = filters[key];
    if (typeof value !== "string" || !value) return;
    selected.push({ key, label: `${label}：${options.find(option => option.value === value)?.label ?? value}`, remove: () => change({ [key]: "" }) });
  };
  selectedField("taxonomy", "频道", facets?.taxonomies);
  selectedField("platform", "门户", facets?.platforms);
  selectedField("area", "原地区条件", facets?.areas);
  selectedField("province", "省份/地区", facets?.coverageProvinces);
  // Removing the parent must also remove its dependent city.
  const provinceChip = selected.find(item => item.key === "province");
  if (provinceChip) provinceChip.remove = () => change({ province: "", city: "" });
  selectedField("city", "城市", facets?.coverageCities);
  selectedField("aiPlatform", "AI 类型", facets?.aiPlatforms);
  selectedField("recommendationGroup", "媒体推荐", facets?.recommendationGroups);
  selectedField("recommendationTag", "原推荐条件", facets?.recommendationTags);
  for (const field of advancedFields) selectedField(field.key, field.label, field.options);
  for (const [key, label] of [["recommended", "推荐媒体"], ["festival", "原条件 · 节假日可发"], ["authenticated", "原条件 · 已认证（目录未提供认证数据，可移除原条件）"]] as const) {
    if (filters[key]) selected.push({ key, label, remove: () => change({ [key]: "" }) });
  }
  selectedField("publishSpeed", "原条件 · 发布速度");
  selectedField("entryType", "原条件 · 入口类型");
  selectedField("linkType", "原条件 · 链接类型");
  selectedField("capability", "稿件适配", [{ value: "text", label: "仅文字", count: 0 }, { value: "image", label: "支持图文", count: 0 }, { value: "image_pending", label: "图文待确认", count: 0 }]);
  selectedField("channel", "兼容频道"); selectedField("region", "兼容地区"); selectedField("price", "兼容价格区间");
  const priceLabel = cataloguePriceLabel(filters);
  if (priceLabel) selected.push({ key: "priceRange", label: `价格：${priceLabel}`, remove: () => change({ priceMin: "", priceMax: "", priceMinExclusive: false, price: "" }) });
  if (filters.query) selected.push({ key: "query", label: `名称：${filters.query}`, remove: clearQuery });
  if (filters.batchQuery) selected.push({ key: "batchQuery", label: `多个名称：${validateCatalogueNames(filters.batchQuery).names.length} 个`, remove: () => change({ batchQuery: "" }) });

  const normalized = facets?.filterSchemaVersion === 2;
  const provinces = normalized ? (facets?.coverageProvinces ?? []).filter(option => Boolean(option.value) && !isUnrestrictedMediaCoverage(option.value) && !isUnrestrictedMediaCoverage(option.label)) : [];
  const cities = normalized ? (facets?.coverageCities ?? []).filter(option => option.province === filters.province) : [];
  const recommendationOptions = normalized ? orderedOptions(facets?.recommendationGroups, recommendations) : [];
  const aiOptions = normalized ? orderedOptions(facets?.aiPlatforms, aiPlatforms) : [];
  // Legacy exact constraints must not make the row claim that it is unrestricted.
  // This display-only value preserves the narrower raw query until the user changes it.
  const legacyRecommendation = filters.recommendationTag || (filters.recommended ? `推荐状态 ${filters.recommended}` : "");
  const recommendationValue = filters.recommended === "true" ? "__recommended"
    : filters.recommendationGroup || (legacyRecommendation ? `原推荐条件：${legacyRecommendation}` : "");
  const legacyArea = filters.area || filters.region;
  const provinceValue = filters.province || (legacyArea ? "__legacy_area" : "");
  const chooseProvince = (province: string) => change({ province, city: "", area: "", region: "" });
  const optionsUnavailable = !facets && Boolean(facetsError || facetsVersionMismatch);
  const emptyMessage = optionsUnavailable ? "选项尚未读取，请重试" : undefined;
  return <section className="panel mc-filters" aria-label="第三方媒体筛选">
    {facetsVersionMismatch && <p className="mc-status" role="status">媒体目录版本已变化，旧版筛选选项暂不展示。{facetsRefreshing ? "正在更新选项。" : "请重新读取选项。"}<button type="button" className="link" onClick={onRetry}>重新读取</button></p>}
    {!facetsVersionMismatch && facetsRefreshing && facets && <p className="mc-status" role="status">正在更新筛选选项；当前显示上次读取的真实选项，更新后以当前目录版本为准。</p>}
    {facetsError && <p className="mc-status" role="alert">筛选选项读取失败：{mediaReadError(facetsError, "暂时无法读取筛选选项，请重试。")} {facets ? "下方保留上次读取的选项。" : "已选条件保持不变。"}<button type="button" className="link" onClick={onRetry}>重试</button></p>}
    <OptionChips label="频道类型" value={filters.taxonomy ?? ""} options={orderedOptions(facets?.taxonomies, channels)} onChange={taxonomy => change({ taxonomy, channel: "" })} disabled={facetsLoading} emptyMessage={emptyMessage} />
    <OptionChips label="综合门户" value={filters.platform ?? ""} options={orderedOptions(facets?.platforms, portals)} onChange={platform => change({ platform })} disabled={facetsLoading} emptyMessage={emptyMessage} />
    <CatalogueChipRow label="媒体推荐" value={recommendationValue} loading={facetsLoading} emptyMessage={emptyMessage}
      options={[
        ...(facets?.recommendedOptions.some(option => option.value === "true") ? [{ value: "__recommended", label: "推荐媒体" }] : []),
        ...recommendationOptions,
      ]}
      onChange={value => change({ recommended: value === "__recommended" ? "true" : "", recommendationGroup: value === "__recommended" ? "" : value, recommendationTag: "" })} />
    <CatalogueChipRow label="AI 类型" value={filters.aiPlatform ?? ""} options={aiOptions} loading={facetsLoading} emptyMessage={emptyMessage}
      hint="按供应商平台标签筛选，不代表已验证的 AI 收录或引用。"
      onChange={aiPlatform => change({ aiPlatform })} />
    <FilterRow label="覆盖区域">
      <label className="mc-region-control">省份/地区<select aria-label="省份/地区" value={provinceValue} disabled={facetsLoading || optionsUnavailable}
        onChange={event => chooseProvince(event.target.value)}>
        <option value="">不限地区</option>
        {provinces.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        {filters.province && !provinces.some(option => option.value === filters.province) && <option value={filters.province}>{filters.province}（当前条件）</option>}
        {!filters.province && legacyArea && <option value="__legacy_area">原地区：{legacyArea}</option>}
      </select></label>
      <label className="mc-region-control">城市<select aria-label="城市" value={filters.city ?? ""}
        disabled={facetsLoading || optionsUnavailable || (!cities.length && !filters.city)} onChange={event => change({ city: event.target.value })}>
        <option value="">{facetsLoading ? "正在读取城市…" : optionsUnavailable ? "城市选项尚未读取" : cities.length ? "全部城市" : filters.province ? "暂无可筛选城市" : "请先选择省份/地区"}</option>
        {cities.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        {filters.city && !cities.some(option => option.value === filters.city) && <option value={filters.city}>{filters.city}（当前条件）</option>}
      </select></label>
    </FilterRow>
    {!facetsLoading && facets && !normalized && <p className="mc-status" role="status">当前媒体服务暂未提供整理后的地区和 AI 选项；已有条件仍会保留，请更新服务后重试。</p>}
    <FilterRow label="价格区间">
      {cataloguePriceRanges.map(range => {
        const active = (filters.priceMin ?? "") === range.min && (filters.priceMax ?? "") === range.max && Boolean(filters.priceMinExclusive) === range.exclusive && !filters.price;
        return <button type="button" key={range.label} className={active ? "active" : ""} aria-pressed={active} onClick={() => { setPriceError(""); setMinimum(range.min); setMaximum(range.max); change({ priceMin: range.min, priceMax: range.max, priceMinExclusive: range.exclusive, price: "" }); }}>{range.label}</button>;
      })}
      <form className="mc-price-form" noValidate onSubmit={event => { event.preventDefault(); applyPrice(); }}>
        <label className="sr" htmlFor="mc-price-min">最低价（元）</label><input id="mc-price-min" inputMode="decimal" value={minimum} placeholder="最低价" aria-invalid={!!priceError} aria-describedby={priceError ? "mc-price-error" : undefined} onChange={event => setMinimum(event.target.value)} />
        <span>～</span><label className="sr" htmlFor="mc-price-max">最高价（元）</label><input id="mc-price-max" inputMode="decimal" value={maximum} placeholder="最高价" aria-invalid={!!priceError} aria-describedby={priceError ? "mc-price-error" : undefined} onChange={event => setMaximum(event.target.value)} /><span>元</span><button type="submit" className="mc-apply">确定</button>
      </form>
      {priceError && <p id="mc-price-error" className="mc-error mc-full" role="alert">{priceError}</p>}
    </FilterRow>
    <div className="mc-search-row">
      <form className="mc-search-form" noValidate onSubmit={event => { event.preventDefault(); searchNow(); }}>
        <label htmlFor="mc-query">媒体搜索</label><input ref={input} id="mc-query" type="search" placeholder="输入媒体名称" value={query} aria-invalid={!!queryError} aria-describedby={queryError ? "mc-query-error" : undefined} onChange={event => setQuery(event.target.value)} onCompositionStart={() => { cancelSearch(); setComposing(true); }} onCompositionEnd={event => { setComposing(false); setQuery(event.currentTarget.value); }} onKeyDown={event => { if (event.key === "Enter" && (event.nativeEvent.isComposing || composing)) event.preventDefault(); }} />
        {query && <button type="button" aria-label="清空媒体搜索" onClick={clearQuery}>×</button>}<button type="submit" className="mc-apply">搜索</button>
      </form>
      {queryError && <p id="mc-query-error" className="mc-error mc-full" role="alert">{queryError}</p>}
    </div>
    <div className="mc-advanced">
      <button type="button" className="mc-disclosure" aria-expanded={advanced} aria-controls="mc-advanced-options" onClick={() => setAdvanced(!advanced)}>{advanced ? "收起" : "展开"}高级选项：媒体类型、收录类型、预计发布时效、文章展示入口、链接与联系方式、百度权重、收录率、发布成功率、节假日发布</button>
      <div id="mc-advanced-options" hidden={!advanced}>
        {facetsLoading && <p className="mc-advanced-status" role="status">正在读取高级筛选选项…</p>}
        {!facetsLoading && !facetsError && !facetsVersionMismatch && !advancedSupported && <p className="mc-advanced-status" role="status">{facets ? "当前媒体服务尚未支持新版高级筛选，原条件保持精确匹配。请更新服务后重新读取。" : "高级筛选选项尚未读取，已选条件保持不变。"}<button type="button" className="link" onClick={onRetry}>重新读取</button></p>}
        <div className="mc-advanced-grid">{advancedFields.map(field => {
          const current = String(filters[field.key] ?? "");
          const legacy = field.legacyKey ? filters[field.legacyKey] : "";
          const options = field.normalized && !advancedSupported ? [] : field.options;
          const value = current || (legacy ? "__legacy_exact" : "");
          const id = `${fieldId}-${field.key}`;
          const unavailable = facetsLoading || facetsVersionMismatch || (!facets && Boolean(facetsError));
          const emptyLabel = facetsLoading ? "正在读取选项…" : facetsVersionMismatch ? "目录版本已变化，请重新读取" : (!facets && facetsError) ? "选项读取失败，请重试" : field.normalized && !advancedSupported ? "新版筛选尚未就绪" : !options.length ? "暂无可用数据" : "不限";
          return <div key={field.key} className="mc-advanced-field">
            <div className="mc-advanced-label"><label htmlFor={id}>{field.label}</label>{field.help && <PublishingFieldHelp label={`${field.label}说明`} explanation={field.help} />}</div>
            <select id={id} value={value} disabled={unavailable || (field.normalized && !advancedSupported) || (!options.length && !value)}
              onChange={event => { if (event.target.value !== "__legacy_exact") change({ [field.key]: event.target.value, ...(field.legacyKey ? { [field.legacyKey]: "" } : {}) }); }}>
              <option value="">{emptyLabel}</option>
              {options.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}
              {legacy && !current && <option value="__legacy_exact">原条件：{field.legacyKey === "festival" ? "节假日可发" : legacy}</option>}
              {current && !options.some(option => option.value === current) && <option value={current}>{field.options.find(option => option.value === current)?.label ?? current}（当前条件）</option>}
            </select>
          </div>;
        })}</div>
      </div>
    </div>
    <FilterRow label="已选条件">
      {selected.map(item => <button type="button" className="mc-selected" key={item.key} aria-label={`移除${item.label}`} onClick={item.remove}>{item.label}<span aria-hidden="true"> ×</span></button>)}
      {!selected.length && <span className="mc-note">未设置筛选条件</span>}
      <button type="button" className="mc-outline" onClick={clearAll}>全部清空</button>
    </FilterRow>
  </section>;
}
