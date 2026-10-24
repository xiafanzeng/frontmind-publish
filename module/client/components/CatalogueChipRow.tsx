import { useId, useLayoutEffect, useRef, useState } from "react";

export type CatalogueChip = { value: string; label: string; disabled?: boolean };

/** Fit complete chips to the available row; hidden choices are not focusable. */
export function fitCatalogueChips(widths: readonly number[], available: number, gap: number, toggle: number) {
  const total = widths.reduce((sum, width) => sum + width, 0) + Math.max(0, widths.length - 1) * gap;
  if (total <= available) return widths.length;
  let used = 0, count = 0;
  for (const width of widths) {
    const next = used + (count ? gap : 0) + width;
    if (next + gap + toggle > available) break;
    used = next;
    count += 1;
  }
  return count;
}

export default function CatalogueChipRow({ label, value, options, onChange, loading = false, hint }: {
  label: string;
  value: string;
  options: CatalogueChip[];
  onChange: (value: string) => void;
  loading?: boolean;
  hint?: string;
}) {
  const id = useId();
  const container = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const toggleMeasure = useRef<HTMLSpanElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [visibleCount, setVisibleCount] = useState(1);
  const all: CatalogueChip[] = [{ value: "", label: "不限" }, ...options];
  const identity = JSON.stringify(all.map(option => option.label));

  useLayoutEffect(() => {
    let alive = true;
    const update = () => {
      if (!alive || !container.current || !measure.current) return;
      const available = container.current.getBoundingClientRect().width;
      // Hidden routes have no measurable width. ResizeObserver measures on reveal.
      if (available <= 0) return;
      const widths = Array.from(measure.current.children).map(node => node.getBoundingClientRect().width);
      const gap = parseFloat(getComputedStyle(measure.current).columnGap) || 8;
      const toggle = toggleMeasure.current?.getBoundingClientRect().width ?? 64;
      setVisibleCount(fitCatalogueChips(widths, available, gap, toggle));
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update);
    if (container.current) observer?.observe(container.current);
    if (measure.current) observer?.observe(measure.current);
    window.addEventListener("resize", update);
    void document.fonts?.ready.then(update);
    return () => { alive = false; observer?.disconnect(); window.removeEventListener("resize", update); };
  }, [identity]);

  const overflow = visibleCount < all.length;
  const shown = expanded ? all : all.slice(0, visibleCount);
  const selected = options.find(option => option.value === value)?.label ?? value;
  return <div className="mc-filter-row mc-chip-row" role="group" aria-label={label}>
    <span className="mc-filter-label" title={hint}>{label}</span>
    <div className="mc-chip-body" ref={container}>
      <div className="mc-chip-measure" ref={measure} aria-hidden="true">
        {all.map(option => <span className="mc-chip" key={option.value}>{option.label}</span>)}
      </div>
      <span ref={toggleMeasure} className="mc-chip-toggle-measure mc-chip-toggle" aria-hidden="true">展开 ▾</span>
      <div className={`mc-chip-options${expanded ? " is-expanded" : ""}`} id={id}>
        {shown.map(option => <button type="button" className={`mc-chip${value === option.value ? " active" : ""}`} key={option.value}
          disabled={option.value !== "" && (loading || option.disabled)} aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}>{option.label}</button>)}
        {overflow && <button type="button" className="mc-chip-toggle" aria-controls={id} aria-expanded={expanded}
          aria-label={`${expanded ? "收起" : "展开"}${label}选项`} onClick={() => setExpanded(current => !current)}>{expanded ? "收起 ▴" : "展开 ▾"}</button>}
        {!options.length && <span className="mc-note mc-chip-empty">{loading ? "正在读取选项…" : "暂无可用选项"}</span>}
      </div>
      {hint && <span className="sr">{hint}</span>}
      {value && <span className="sr">{label}已选：{selected}；可在已选条件中删除。</span>}
    </div>
  </div>;
}
