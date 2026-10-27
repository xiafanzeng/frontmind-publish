import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";

/** A single title may wrap visually without becoming a multiline submission value. */
export function PublishingTitleInput(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const input = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    const resize = () => {
      // Reset first so deleting text or widening its container can shrink the field again.
      element.style.height = "auto";
      const border = element.offsetHeight - element.clientHeight;
      element.style.height = `${Math.max(44, element.scrollHeight + border)}px`;
    };
    resize();
  }, [props.value]);

  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    let width = element.getBoundingClientRect().width;
    let active = true;
    const resize = () => {
      if (!active) return;
      element.style.height = "auto";
      const border = element.offsetHeight - element.clientHeight;
      element.style.height = `${Math.max(44, element.scrollHeight + border)}px`;
    };
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(entries => {
      const nextWidth = entries[0]?.contentRect.width;
      if (nextWidth === undefined || nextWidth === width) return;
      width = nextWidth;
      resize();
    });
    observer?.observe(element);
    window.addEventListener("resize", resize);
    // A host's web font can finish loading after the first content measurement.
    void document.fonts?.ready.then(resize);
    return () => {
      active = false;
      observer?.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <textarea {...props} ref={input} rows={1} wrap="soft" />;
}
