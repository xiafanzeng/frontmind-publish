import type { CSSProperties } from 'react';

/**
 * Reference declarations attached to the existing media scope boundary.
 * Values follow the confirmed 黑白 operating-console theme: white canvas,
 * neutral ink, 10px panels and a near-black accent (#111111), matching the
 * index3 pages.
 * color, background and font come from the reference body rule, without changes.
 */
export const referenceScopeStyle: CSSProperties & Record<`--${string}`, string> = {
  "--brand": "#111111",
  "--brand-hover": "#000000",
  "--plum": "#272727",
  "--ink": "#363636",
  "--muted": "#6a6a6a",
  "--canvas": "#ffffff",
  "--surface": "#fff",
  "--line": "#ebebeb",
  "--selected": "#f7f7f7",
  "--radius": "10px",
  "--sidebar": "184px",
  "--x-soft": "#f7f7f7",
  "--x-good": "#18704a",
  "--x-warning": "#925b12",
  "color": "var(--ink)",
  "background": "var(--canvas)",
  "font": "14px -apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei','Noto Sans SC',sans-serif",
};
