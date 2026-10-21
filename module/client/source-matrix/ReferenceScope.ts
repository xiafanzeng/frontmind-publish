import type { CSSProperties } from 'react';

/**
 * Exact reference declarations attached to the existing media scope boundary.
 * Custom properties come from top-level :root rules in source order (later wins).
 * color, background and font come from the reference body rule, without changes.
 * CSS selectors retain only the uniform .fm-media prefix; no root/body aliases.
 */
export const referenceScopeStyle: CSSProperties & Record<`--${string}`, string> = {
  "--brand": "#b33467",
  "--brand-hover": "#962654",
  "--plum": "#4c1467",
  "--ink": "#202134",
  "--muted": "#737991",
  "--canvas": "#f5f6fa",
  "--surface": "#fff",
  "--line": "#e6e8f1",
  "--selected": "#f9eff5",
  "--radius": "16px",
  "--sidebar": "184px",
  "--x-soft": "#faf5f8",
  "--x-good": "#20815b",
  "--x-warning": "#aa7227",
  "color": "var(--ink)",
  "background": "var(--canvas)",
  "font": "14px 'Microsoft YaHei','PingFang SC',system-ui,Arial,sans-serif",
};
