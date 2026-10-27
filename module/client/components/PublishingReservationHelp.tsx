import { CircleHelp } from "lucide-react";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@frontmind/module-ui/components/ui/popover";
import "./publishing.reservation-help.css";

const explanation = "预计为本次所选稿件、媒体及发布次数预留的金额。当前展示不代表资金已冻结；最终确认提交时以服务端核验金额为准。已取消、已排除及已受理项目不重复计入。";
const portalTokens = ["--publishing-surface", "--publishing-ink", "--publishing-muted", "--publishing-line", "--publishing-purple"] as const;

/** Reuses the shared, collision-aware portal used by source-matrix help. */
export default function PublishingReservationHelp() {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({});
  const trigger = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const suppressFocus = useRef(false);
  const returnFocus = useRef(false);
  const descriptionId = useId();
  const cancelClose = () => { if (timer.current !== undefined) clearTimeout(timer.current); };
  const show = () => {
    cancelClose();
    if (trigger.current) {
      const computed = getComputedStyle(trigger.current);
      const values: Record<string, string> = {fontFamily: computed.fontFamily};
      for (const token of portalTokens) {
        const value = computed.getPropertyValue(token).trim();
        if (value) values[token] = value;
      }
      setStyle(values as CSSProperties);
    }
    setOpen(true);
  };
  const leave = () => {
    cancelClose();
    if (!pinned) timer.current = setTimeout(() => {
      if (document.activeElement !== trigger.current && !content.current?.contains(document.activeElement)) setOpen(false);
    }, 160);
  };
  useEffect(() => () => { if (timer.current !== undefined) clearTimeout(timer.current); }, []);

  return <Popover open={open} onOpenChange={value => {
    cancelClose();
    setOpen(value);
    if (!value) setPinned(false);
  }}>
    <PopoverTrigger asChild>
      <button ref={trigger} type="button" className="publishing-reservation-help-trigger"
        aria-label="本次待预占说明" aria-describedby={open ? descriptionId : undefined}
        onMouseEnter={show} onMouseLeave={leave}
        onFocus={() => { if (suppressFocus.current) { suppressFocus.current = false; return; } returnFocus.current = true; show(); }}
        onBlur={() => { suppressFocus.current = false; leave(); }}
        onClick={event => {
          // The first touch pins the explanation even if focus has already opened it.
          event.preventDefault();
          returnFocus.current = true;
          cancelClose();
          if (pinned) { setPinned(false); setOpen(false); } else { setPinned(true); show(); }
        }}>
        <CircleHelp size={16} aria-hidden="true" />
      </button>
    </PopoverTrigger>
    <PopoverContent ref={content} className="publishing-reservation-help-content" side="top" align="start"
      sideOffset={8} collisionPadding={16} style={style} aria-label="本次待预占说明" aria-describedby={descriptionId}
      onOpenAutoFocus={event => event.preventDefault()}
      onCloseAutoFocus={event => {
        // Hover dismissal must not move focus. Escape/close from the explanation
        // returns keyboard focus without immediately reopening it.
        event.preventDefault();
        if (returnFocus.current && trigger.current && document.activeElement !== trigger.current) {
          suppressFocus.current = true;
          trigger.current.focus({preventScroll:true});
        }
        returnFocus.current = false;
      }}
      onPointerDownOutside={() => { returnFocus.current = false; }}
      onFocusOutside={() => { returnFocus.current = false; }}
      onFocusCapture={() => { returnFocus.current = true; }}
      onMouseEnter={cancelClose} onMouseLeave={leave}>
      <p id={descriptionId}>{explanation}</p>
      <button type="button" className="publishing-reservation-help-close" onClick={() => { returnFocus.current = true; setPinned(false); setOpen(false); }}>关闭说明</button>
    </PopoverContent>
  </Popover>;
}
