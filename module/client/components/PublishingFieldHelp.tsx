import { CircleHelp } from "lucide-react";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@frontmind/module-ui/components/ui/popover";
import "./publishing.reservation-help.css";

const portalTokens = { "--publishing-surface": "--surface", "--publishing-ink": "--ink", "--publishing-muted": "--muted", "--publishing-line": "--line", "--publishing-purple": "--brand", "--publishing-purple-soft": "--selected" } as const;

/** Shared owner for field explanations, extracted from the reservation help. */
export default function PublishingFieldHelp({ label, explanation }: { label: string; explanation: string }) {
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
      const mediaScope = trigger.current.closest(".fm-media") !== null;
      for (const [token, mediaToken] of Object.entries(portalTokens)) {
        const publishingValue = computed.getPropertyValue(token).trim();
        const mediaValue = computed.getPropertyValue(mediaToken).trim();
        const value = mediaScope ? mediaValue || publishingValue : publishingValue || mediaValue;
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
      <button ref={trigger} type="button" className="publishing-field-help-trigger"
        aria-label={label} aria-describedby={open ? descriptionId : undefined}
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
    <PopoverContent ref={content} className="publishing-field-help-content" side="top" align="start"
      sideOffset={8} collisionPadding={16} style={style} aria-label={label} aria-describedby={descriptionId}
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
      <button type="button" className="publishing-field-help-close" onClick={() => { returnFocus.current = true; setPinned(false); setOpen(false); }}>关闭说明</button>
    </PopoverContent>
  </Popover>;
}

