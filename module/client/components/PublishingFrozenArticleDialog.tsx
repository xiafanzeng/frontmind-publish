import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@frontmind/module-ui/components/ui/dialog";
import type { PublicationPreflight } from "../types";
import "./publishing.frozen-article-dialog.css";

const portalTokens = [
  "--publishing-surface",
  "--publishing-ink",
  "--publishing-muted",
  "--publishing-line",
  "--publishing-purple",
  "--publishing-purple-dark",
  "--publishing-purple-soft",
  "--publishing-focus",
  "--publishing-radius",
] as const;

/** Read-only view of the parent's current, validated frozen preflight article. */
export default function PublishingFrozenArticleDialog({
  article,
  trigger,
  onClose,
}: {
  article?: PublicationPreflight["article"];
  trigger?: HTMLButtonElement;
  onClose: () => void;
}) {
  const lastTrigger = useRef<HTMLButtonElement | undefined>(undefined);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [portalStyle, setPortalStyle] = useState<CSSProperties>({});

  useLayoutEffect(() => {
    if (!trigger) return;
    lastTrigger.current = trigger;
    // Radix portals preserve context, but not the publishing-page CSS ancestry.
    const computed = getComputedStyle(trigger);
    const properties: Record<string, string> = { fontFamily: computed.fontFamily };
    for (const token of portalTokens) {
      const value = computed.getPropertyValue(token).trim();
      if (value) properties[token] = value;
    }
    setPortalStyle(properties as CSSProperties);
  }, [trigger]);

  return (
    <Dialog open={Boolean(article)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="publishing-frozen-article-dialog"
        overlayClassName="publishing-frozen-article-overlay"
        showCloseButton={false}
        style={portalStyle}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          closeButton.current?.focus({ preventScroll: true });
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          // The parent may clear its selected row while Radix is closing.
          if (lastTrigger.current?.isConnected) {
            lastTrigger.current.focus({ preventScroll: true });
          }
        }}
      >
        <header className="publishing-frozen-article-dialog-header">
          <div className="publishing-frozen-article-dialog-heading">
            <span className="publishing-frozen-article-dialog-eyebrow">冻结正文</span>
            <DialogTitle className="publishing-frozen-article-dialog-title">
              {article?.title || "冻结正文"}
            </DialogTitle>
            <DialogDescription className="publishing-frozen-article-dialog-description">
              {article ? <>冻结版本 v{article.version} · 只读 · {article.imageCount} 张图片</> : "只读冻结版本"}
            </DialogDescription>
            {article?.hash ? <p className="publishing-frozen-article-dialog-hash">版本指纹：{article.hash}</p> : null}
          </div>
          <DialogClose asChild>
            <button ref={closeButton} type="button" className="publishing-frozen-article-dialog-close" aria-label="关闭冻结正文">关闭</button>
          </DialogClose>
        </header>
        {article ? (
          <div
            key={JSON.stringify([article.id, article.versionId, article.hash])}
            className="publishing-frozen-article-dialog-scroll"
            role="region"
            aria-label="冻结正文内容"
            tabIndex={0}
          >
            {article.bodyHtml ? (
              <article
                className="publishing-frozen-article-dialog-body"
                // Preserve the existing publisher canonical HTML rendering contract.
                dangerouslySetInnerHTML={{ __html: article.bodyHtml }}
              />
            ) : <p className="publishing-frozen-article-dialog-empty" role="status">该冻结版本未返回正文内容。</p>}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
