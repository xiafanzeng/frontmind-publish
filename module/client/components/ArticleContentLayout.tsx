import type { ReactNode } from "react";
import { useLocation, useSearch } from "wouter";

/** Ordinary article screens share an inset; guided/embedded screens keep theirs. */
export function ArticleContentLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const search = useSearch();
  const path = location.replace(/\/$/u, "");
  const guided = new URLSearchParams(search).get("flow") === "1";
  const articlePage =
    path === "/publishing/articles" ||
    path === "/publishing/articles/edit" ||
    path === "/publishing/articles/new" ||
    path === "/publishing/articles/records" ||
    /^\/publishing\/articles\/[^/]+\/edit$/u.test(path);

  if (!articlePage || guided) return <>{children}</>;

  return <div className="publishing-article-content">{children}</div>;
}
