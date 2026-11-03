import type { CSSProperties } from 'react';

/**
 * Reference declarations attached to the existing media scope boundary.
 * Values follow the confirmed 白底操作台 theme: white canvas, neutral ink,
 * 10px panels and the blue accent (#2563eb), matching the index3 pages.
 * color, background and font come from the reference body rule, without changes.
 */
export const referenceScopeStyle: CSSProperties & Record<`--${string}`, string> = {
  "--brand": "#2563eb",
  "--brand-hover": "#1d4ed8",
  "--plum": "#22252c",
  "--ink": "#30343b",
  "--muted": "#626872",
  "--canvas": "#ffffff",
  "--surface": "#fff",
  "--line": "#e8e9ed",
  "--selected": "#eff4ff",
  "--radius": "10px",
  "--sidebar": "184px",
  "--x-soft": "#eff4ff",
  "--x-good": "#18704a",
  "--x-warning": "#925b12",
  "color": "var(--ink)",
  "background": "var(--canvas)",
  "font": "14px -apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei','Noto Sans SC',sans-serif",
};
