import { useEffect, useRef, useState, type ReactNode } from "react";
import { MediaDialog } from "../source-matrix/MediaMarket";
import { cataloguePriceLabel, cataloguePriceRanges, validateCatalogueNames, validateCataloguePrice } from "../mediaCatalogue";
import type { MediaFacetOption, MediaFacets, MediaFilters } from "../types";
import "../publishing.catalogue.css";

const channels = "新闻资讯 财经商业 IT科技 健康医疗 汽车网站 亲子母婴 生活消费 教育培训 食品餐饮 工业贸易 房产家居 女性时尚 游戏动漫 酒店旅游 娱乐休闲 能源环保 文化艺术 体育运动 公益三农 低价专区 一口价 优惠套餐 报纸 海外媒体".split(" ");
const portals = "新浪网 网易 凤凰网 搜狐网 腾讯网 中华网 千龙网 中国网 中国日报网 中国新闻网 国际在线 北青网 环球网 光明网 中国青年网 中国经济网 央广网 人民网 央视网 新华网 东方网 大众网 和讯网 其他门户".split(" ");
const regions = "全国 北京 上海 广东 浙江 天津 重庆 湖北 湖南 河北 河南 山东 山西 江苏 江西 四川 辽宁 吉林 福建 安徽 黑龙江 内蒙古 广西 海南 贵州 云南 西藏 陕西 甘肃 青海 宁夏 新疆 海外 港澳台".split(" ");
const recommendations = "急速出稿 高收录 包收录 带视频 百科可用 无免责声明 周末可发 站内搜索 可显示阅读量 可带署名 可发GEO 白名单来源 最近上新 可带表格".split(" ");
const aiPlatforms = ["DeepSeek", "豆包", "通义千问", "腾讯元宝", "文心一言", "Kimi", "其他"];

function orderedOptions(options: MediaFacetOption[] = [], order: string[] = []) {
  return [...options].sort((a, b) => {
    const ai = order.indexOf(a.value), bi = order.indexOf(b.value);
    return (ai < 0 ? order.length : ai) - (bi < 0 ? order.length : bi) || a.label.localeCompare(b.label, "zh-CN");
  });
}

function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  return <div className="mc-filter-row" role="group" aria-label={label}><span className="mc-filter-label">{label}</span><div className="mc-filter-values">{children}</div></div>;
}

function OptionChips({ label, value, options, onChange, disabled }: {
  label: string; value: string; options: MediaFacetOption[]; onChange: (value: string) => void; disabled?: boolean;
}) {
  return <FilterRow label={label}>
    <button type="button" className={value ? "" : "active"} aria-pressed={!value} onClick={() => onChange("")}>不限</button>
    {options.map(option => <button type="button" key={option.value} disabled={disabled} className={value === option.value ? "active" : ""} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}</button>)}
    {!options.length && <span className="mc-note">{disabled ? "正在读取可用选项" : "目录暂未提供可用选项"}</span>}
    {value && !options.some(option => option.value === value) && <span className="mc-note">当前条件：{value}（保留匹配条件）</span>}
  </FilterRow>;
}

type Props = {
  filters: MediaFilters;
  facets?: MediaFacets;
  facetsLoading: boolean;
  facetsError?: string;
  onRetry: () => void;
  onChange: (filters: MediaFilters) => void;
  onReset: () => void;
};

export default function MediaCatalogueFilters(props: Props) {
  const { filters, facets, facetsLoading, facetsError, onRetry, onChange, onReset } = props;
  const [query, setQuery] = useState(filters.query);
  const [queryError, setQueryError] = useState("");
  const [composing, setComposing] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batch, setBatch] = useState(filters.batchQuery ?? "");
  const [batchError, setBatchError] = useState("");
  const [minimum, setMinimum] = useState(filters.priceMin ?? "");
  const [maximum, setMaximum] = useState(filters.priceMax ?? "");
  const [priceError, setPriceError] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef(props);
  latest.current = props;
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
    cancelSearch(); setQuery(""); setBatch(""); setMinimum(""); setMaximum("");
    setPriceError(""); setQueryError(""); setBatchError(""); onReset();
  };
  const applyPrice = () => {
    const validated = validateCataloguePrice(minimum, maximum);
    if (validated.error) { setPriceError(validated.error); return; }
    setPriceError("");
    change({ priceMin: validated.min, priceMax: validated.max, priceMinExclusive: false, price: "" });
  };
  const applyBatch = () => {
    const parsed = validateCatalogueNames(batch);
    if (parsed.error) { setBatchError(parsed.error); return; }
    change({ batchQuery: parsed.names.join("\n") }); setBatchOpen(false); setBatchError("");
  };

  const advancedFields: Array<{ key: keyof MediaFilters; label: string; options: MediaFacetOption[] }> = [
    { key: "mediaType", label: "媒体类型", options: facets?.mediaTypes ?? [] },
    { key: "includeType", label: "收录类型", options: facets?.includeTypes ?? [] },
    { key: "publishSpeed", label: "发布速度", options: facets?.publishSpeeds ?? [] },
    { key: "entryType", label: "入口类型", options: facets?.entryTypes ?? [] },
    { key: "linkType", label: "链接类型", options: facets?.linkTypes ?? [] },
    { key: "pcWeight", label: "百度 PC 权重", options: facets?.pcWeightThresholds ?? [] },
    { key: "mobileWeight", label: "百度移动权重", options: facets?.mobileWeightThresholds ?? [] },
    { key: "includeRate", label: "收录率", options: facets?.includeRateThresholds ?? [] },
    { key: "successRate", label: "通过率（发布成功率）", options: facets?.successRateThresholds ?? [] },
  ];
  const selected: Array<{ key: string; label: string; remove: () => void }> = [];
  const selectedField = (key: keyof MediaFilters, label: string, options: MediaFacetOption[] = []) => {
    const value = filters[key];
    if (typeof value !== "string" || !value) return;
    selected.push({ key, label: `${label}：${options.find(option => option.value === value)?.label ?? value}`, remove: () => change({ [key]: "" }) });
  };
  selectedField("taxonomy", "频道", facets?.taxonomies);
  selectedField("platform", "门户", facets?.platforms);
  selectedField("area", "地区", facets?.areas);
  selectedField("recommendationTag", "推荐标签", facets?.recommendationTags);
  for (const field of advancedFields) selectedField(field.key, field.label, field.options);
  for (const [key, label] of [["recommended", "推荐媒体"], ["authenticated", "已认证"], ["festival", "节假日可发"]] as const) {
    if (filters[key]) selected.push({ key, label, remove: () => change({ [key]: "" }) });
  }
  selectedField("capability", "稿件适配", [{ value: "text", label: "仅文字", count: 0 }, { value: "image", label: "支持图文", count: 0 }, { value: "image_pending", label: "图文待确认", count: 0 }]);
  selectedField("channel", "兼容频道"); selectedField("region", "兼容地区"); selectedField("price", "兼容价格区间");
  const priceLabel = cataloguePriceLabel(filters);
  if (priceLabel) selected.push({ key: "priceRange", label: `价格：${priceLabel}`, remove: () => change({ priceMin: "", priceMax: "", priceMinExclusive: false, price: "" }) });
  if (filters.query) selected.push({ key: "query", label: `名称：${filters.query}`, remove: clearQuery });
  if (filters.batchQuery) selected.push({ key: "batchQuery", label: `批量名称：${validateCatalogueNames(filters.batchQuery).names.length} 个`, remove: () => { setBatch(""); change({ batchQuery: "" }); } });

  const realTags = facets?.recommendationTags ?? [];
  // The provider's literal tag is authoritative; timestamps and free-form remarks are not tag inference.
  const allowedTags = realTags.filter(option => option.value !== "最近上新");
  const unavailableTags = recommendations.filter(name => !allowedTags.some(option => option.value === name));
  const noRecommendation = !filters.recommended && !filters.recommendationTag;
  return <section className="panel mc-filters" aria-label="第三方媒体筛选">
    {facetsError && <p className="mc-status" role="alert">筛选选项读取失败：{facetsError}。{facets ? "下方保留上次读取的选项。" : "请重试。"}<button type="button" className="link" onClick={onRetry}>重试</button></p>}
    <OptionChips label="频道类型" value={filters.taxonomy ?? ""} options={orderedOptions(facets?.taxonomies, channels)} onChange={taxonomy => change({ taxonomy, channel: "" })} disabled={facetsLoading} />
    <OptionChips label="综合门户" value={filters.platform ?? ""} options={orderedOptions(facets?.platforms, portals)} onChange={platform => change({ platform })} disabled={facetsLoading} />
    <FilterRow label="媒体推荐">
      <button type="button" className={noRecommendation ? "active" : ""} aria-pressed={noRecommendation} onClick={() => change({ recommended: "", recommendationTag: "" })}>不限</button>
      <button type="button" disabled={!facets?.recommendedOptions.some(option => option.value === "true")} className={filters.recommended ? "active" : ""} aria-pressed={filters.recommended === "true"} onClick={() => change({ recommended: "true", recommendationTag: "" })}>推荐媒体</button>
      {orderedOptions(allowedTags, recommendations).map(option => <button type="button" key={option.value} disabled={facetsLoading} className={filters.recommendationTag === option.value ? "active" : ""} aria-pressed={filters.recommendationTag === option.value} onClick={() => change({ recommended: "", recommendationTag: option.value })}>{option.label}</button>)}
      {unavailableTags.map(label => <button type="button" key={`unavailable:${label}`} disabled title={label === "最近上新" ? "上架时间口径尚未确认" : "当前目录未提供可核实的对应标签"}>{label}</button>)}
      <p className="mc-note mc-full">仅开放目录已提供的推荐标签；灰色选项暂不可筛选。标签为供应商说明，不代表发布或收录保证。</p>
    </FilterRow>
    <FilterRow label="AI 类型">
      <span className="mc-note">暂不可筛选：尚无可关联到媒体的 AI 平台数据。</span>
      {aiPlatforms.map(name => <button type="button" disabled key={name}>{name}</button>)}
    </FilterRow>
    <OptionChips label="覆盖区域" value={filters.area ?? ""} options={orderedOptions(facets?.areas, regions)} onChange={area => change({ area, region: "" })} disabled={facetsLoading} />
    <FilterRow label="价格区间">
      {cataloguePriceRanges.map(range => {
        const active = (filters.priceMin ?? "") === range.min && (filters.priceMax ?? "") === range.max && Boolean(filters.priceMinExclusive) === range.exclusive && !filters.price;
        return <button type="button" key={range.label} className={active ? "active" : ""} aria-pressed={active} onClick={() => { setPriceError(""); setMinimum(range.min); setMaximum(range.max); change({ priceMin: range.min, priceMax: range.max, priceMinExclusive: range.exclusive, price: "" }); }}>{range.label}</button>;
      })}
      <form className="mc-price-form" noValidate onSubmit={event => { event.preventDefault(); applyPrice(); }}>
        <label className="sr" htmlFor="mc-price-min">最低价（元）</label><input id="mc-price-min" inputMode="decimal" value={minimum} placeholder="最低价" aria-invalid={!!priceError} aria-describedby={priceError ? "mc-price-error" : "mc-price-note"} onChange={event => setMinimum(event.target.value)} />
        <span>～</span><label className="sr" htmlFor="mc-price-max">最高价（元）</label><input id="mc-price-max" inputMode="decimal" value={maximum} placeholder="最高价" aria-invalid={!!priceError} aria-describedby={priceError ? "mc-price-error" : "mc-price-note"} onChange={event => setMaximum(event.target.value)} /><span>元</span><button type="submit" className="mc-apply">确定</button>
      </form>
      {priceError && <p id="mc-price-error" className="mc-error mc-full" role="alert">{priceError}</p>}
      <p id="mc-price-note" className="mc-note mc-full">区间上限包含边界，下限标注“大于”的不含边界；自定义范围含两端，可只填一端。价格与下方展示口径一致。</p>
    </FilterRow>
    <div className="mc-search-row">
      <form className="mc-search-form" noValidate onSubmit={event => { event.preventDefault(); searchNow(); }}>
        <label htmlFor="mc-query">媒体搜索</label><input ref={input} id="mc-query" type="search" placeholder="输入媒体名称" value={query} aria-invalid={!!queryError} aria-describedby={queryError ? "mc-query-error" : undefined} onChange={event => setQuery(event.target.value)} onCompositionStart={() => { cancelSearch(); setComposing(true); }} onCompositionEnd={event => { setComposing(false); setQuery(event.currentTarget.value); }} onKeyDown={event => { if (event.key === "Enter" && (event.nativeEvent.isComposing || composing)) event.preventDefault(); }} />
        {query && <button type="button" aria-label="清空媒体搜索" onClick={clearQuery}>×</button>}<button type="submit" className="mc-apply">搜索</button>
      </form>
      <button type="button" className="mc-outline" onClick={() => { setBatch(filters.batchQuery ?? ""); setBatchError(""); setBatchOpen(true); }}>批量搜索</button>
      <label className="mc-sort">排序<select aria-label="媒体排序" value={filters.sort ?? "recommended"} onChange={event => change({ sort: event.target.value as MediaFilters["sort"] })}><option value="recommended">推荐顺序</option><option value="price_asc">价格从低到高</option><option value="price_desc">价格从高到低</option><option value="success_desc">发布成功率从高到低</option><option value="include_desc">收录率从高到低</option><option value="weight_desc">百度 PC 权重从高到低</option><option value="updated_desc">目录更新从新到旧</option></select></label>
      {queryError && <p id="mc-query-error" className="mc-error mc-full" role="alert">{queryError}</p>}
    </div>
    <div className="mc-advanced">
      <button type="button" className="mc-disclosure" aria-expanded={advanced} aria-controls="mc-advanced-options" onClick={() => setAdvanced(!advanced)}>{advanced ? "收起" : "展开"}高级选项：媒体类型、收录类型、发布速度、入口、链接、百度权重、收录率、通过率</button>
      <div id="mc-advanced-options" hidden={!advanced}>
        <div className="mc-advanced-grid">{advancedFields.map(field => <label key={field.key}>{field.label}<select value={String(filters[field.key] ?? "")} disabled={facetsLoading || (!field.options.length && !filters[field.key])} onChange={event => change({ [field.key]: event.target.value })}><option value="">不限{!field.options.length ? "（暂无可用数据）" : ""}</option>{field.options.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}{filters[field.key] && !field.options.some(option => option.value === filters[field.key]) && <option value={String(filters[field.key])}>{String(filters[field.key])}（当前条件）</option>}</select></label>)}</div>
        <div className="mc-extra-options">
          <label><input type="checkbox" checked={filters.authenticated === "true"} disabled={!facets?.authenticatedOptions.some(option => option.value === "true") && !filters.authenticated} onChange={event => change({ authenticated: event.target.checked ? "true" : "" })} />已认证</label>
          <label><input type="checkbox" checked={filters.festival === "true"} disabled={!facets?.festivalPublishableOptions.some(option => option.value === "true") && !filters.festival} onChange={event => change({ festival: event.target.checked ? "true" : "" })} />节假日可发（不等于周末可发）</label>
        </div>
        <p className="mc-note">发布速度按目录提供的档位匹配；全国按地区原值匹配。链接类型保留供应商原值；通过率指供应商发布成功率。字段未提供时不按 0 计算。</p>
      </div>
    </div>
    <FilterRow label="已选条件">
      {selected.map(item => <button type="button" className="mc-selected" key={item.key} aria-label={`移除${item.label}`} onClick={item.remove}>{item.label}<span aria-hidden="true"> ×</span></button>)}
      {!selected.length && <span className="mc-note">未设置筛选条件</span>}
      <button type="button" className="mc-outline" onClick={clearAll}>全部清空</button>
    </FilterRow>
    <MediaDialog open={batchOpen} title="批量搜索媒体" description="按媒体名称包含匹配；多个名称满足任一项，再与其他条件组合。" confirmLabel="查找匹配" onCancel={() => setBatchOpen(false)} onConfirm={applyBatch}>
      <label htmlFor="mc-batch">媒体名称（最多 50 个，换行或中英文逗号分隔）</label>
      <textarea id="mc-batch" rows={8} value={batch} style={{ resize: "none", width: "100%", overflowY: "auto" }} aria-invalid={!!batchError} aria-describedby={batchError ? "mc-batch-error" : undefined} onChange={event => { setBatch(event.target.value); setBatchError(""); }} />
      {batchError && <p id="mc-batch-error" role="alert" className="mc-error">{batchError}</p>}
    </MediaDialog>
  </section>;
}
