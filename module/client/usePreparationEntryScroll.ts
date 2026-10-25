import { useLayoutEffect, useRef } from "react";

/** Only ancestors can own this page's viewport; never reset its tables or dialogs. */
function resetPreparationAncestors(page: HTMLElement) {
  const document = page.ownerDocument;
  const view = document.defaultView;
  if (!view) return;
  const surface = page.closest<HTMLElement>(".publishing-preparation-content") ?? page;
  const owners = new Set<HTMLElement>();
  for (let node: HTMLElement | null = surface; node; node = node.parentElement) {
    if (/(auto|scroll|overlay)/.test(view.getComputedStyle(node).overflowY)) owners.add(node);
  }
  owners.add((document.scrollingElement ?? document.documentElement) as HTMLElement);
  for (const owner of owners) {
    // Do not animate a route entrance even when the host uses smooth scrolling.
    const value = owner.style.getPropertyValue("scroll-behavior");
    const priority = owner.style.getPropertyPriority("scroll-behavior");
    owner.style.setProperty("scroll-behavior", "auto", "important");
    owner.scrollTop = 0;
    if (value) owner.style.setProperty("scroll-behavior", value, priority);
    else owner.style.removeProperty("scroll-behavior");
  }
}

/**
 * Titles and review enter at the top of their actual host viewport. Reconcile
 * once when initial async content settles, then leave edits/reloads alone.
 * A user interaction cancels deferred corrections so reading is never pinned.
 */
export function usePreparationEntryScroll(entryKey: string, ready: boolean) {
  const pageRef = useRef<HTMLDivElement>(null);
  const entrance = useRef<{
    key: string;
    settled: boolean;
    interrupted: boolean;
    correct: () => void;
  } | null>(null);

  useLayoutEffect(() => {
    const page = pageRef.current;
    const view = page?.ownerDocument.defaultView;
    if (!page || !view) return;
    let frame: number | undefined;
    let alive = true;
    const cancelFrame = () => {
      if (frame !== undefined) view.cancelAnimationFrame(frame);
      frame = undefined;
    };
    const state = { key: entryKey, settled: false, interrupted: false, correct: () => {} };
    const reset = () => {
      if (alive && !state.interrupted && page.isConnected) resetPreparationAncestors(page);
    };
    state.correct = () => {
      cancelFrame();
      reset();
      // Bound the correction to the entrance commit and two rendering frames,
      // including parent layout effects and browser history restoration.
      if (alive && !state.interrupted && typeof view.requestAnimationFrame === "function") {
        frame = view.requestAnimationFrame(() => {
          reset();
          frame = alive && !state.interrupted
            ? view.requestAnimationFrame(() => { reset(); frame = undefined; })
            : undefined;
        });
      }
    };
    entrance.current = state;
    const interrupt = () => { state.interrupted = true; cancelFrame(); };
    const events = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    for (const name of events) page.ownerDocument.addEventListener(name, interrupt, { capture: true, passive: true });
    const restorePage = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      state.interrupted = false;
      // Review refreshes metadata after BFCache restoration. Its next ready
      // transition belongs to this new entrance, not the old completed one.
      state.settled = false;
      state.correct();
    };
    view.addEventListener("pageshow", restorePage);
    state.correct();
    return () => {
      alive = false;
      cancelFrame();
      for (const name of events) page.ownerDocument.removeEventListener(name, interrupt, true);
      view.removeEventListener("pageshow", restorePage);
      if (entrance.current === state) entrance.current = null;
    };
  }, [entryKey]);

  useLayoutEffect(() => {
    const state = entrance.current;
    if (!ready || !state || state.key !== entryKey || state.settled) return;
    state.settled = true;
    if (!state.interrupted) state.correct();
  }, [entryKey, ready]);

  return pageRef;
}
