import { useId, useState } from "react";
import "../publishing.remarks.css";

/** Presentation only: shows the supplied remark without interpreting it as a rule. */
export function PublishingRemark({ text, label = "发布备注" }: { text?: string; label?: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const content = text?.trim() || "未提供发布备注，请核对媒体要求";
  return (
    <span className="publishing-remark" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <span className="publishing-remark-label">{label}</span>
      <button type="button" className="publishing-remark-trigger" aria-label={`${label}：${content}`}
        aria-describedby={open ? id : undefined} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        onClick={() => setOpen(true)} onKeyDown={event => { if (event.key === "Escape") { setOpen(false); event.stopPropagation(); } }}>
        {content}
      </button>
      {open && <span id={id} role="tooltip" className="publishing-remark-tip">{content}</span>}
    </span>
  );
}
