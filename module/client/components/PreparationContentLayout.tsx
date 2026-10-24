import type { ReactNode } from "react";
import { useLocation } from "wouter";
import "../publishing.preparation.css";

/** Own the entire preparation page inset, including conversation summaries. */
export function PreparationContentLayout({ children }: { children: ReactNode }) {
  const [path] = useLocation();
  const preparation = /^\/publishing\/drafts\/[^/]+\/(titles|review)\/?$/.test(path)
    || /^\/publishing\/review\/[^/]+\/?$/.test(path);
  return preparation
    ? <div className="publishing-preparation-content">{children}</div>
    : <>{children}</>;
}
