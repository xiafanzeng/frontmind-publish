import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";

import { usePublisherGateway, usePublisherQuery } from "../PublishingContext";
import { PublishingError } from "../components/PublishingUi";
import { requestWorkspaceNavigation } from "../host";
import type { PublicationPreflight } from "../types";
import { Btn, Icon, PageHeading, WorkflowPosition, money, toast, useIndex3Dialog } from "./ui";

type CheckState = "idle" | "loading" | "failed" | "passed";

/** index3 配置标题: per-media titles, fee panel and the real preflight + submit pipeline. */
export default function Index3Titles({ draftId }: { draftId: string }) {
  const gateway = usePublisherGateway();
  const [, navigate] = useLocation();
  const dialog = useIndex3Dialog();
  const loadDraft = useCallback((signal: AbortSignal) => gateway.getDraft(draftId, signal), [gateway, draftId]);
  const draftQuery = usePublisherQuery(loadDraft, `index3-titles-${draftId}`);

  const [titles, setTitles] = useState<Record<string, string>>({});
  const [check, setCheck] = useState<CheckState>("idle");
  const [preflight, setPreflight] = useState<PublicationPreflight | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [walletAvailable, setWalletAvailable] = useState<string | null>(null);

  const draft = draftQuery.data;
  useEffect(() => {
    if (draft) {
      setTitles(Object.fromEntries(draft.items.map((item) => [item.media.id, item.title])));
    }
  }, [draft]);

  useEffect(() => {
    let alive = true;
    // Promise.resolve guards test doubles whose gateways omit dashboard APIs.
    void Promise.resolve()
      .then(() => gateway.getDashboard())
      .then((data) => {
        if (alive) setWalletAvailable(data.wallet.availableTenThousandths);
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [gateway]);

  const prices = useMemo(
    () => (draft?.items ?? []).map((item) => item.media.priceTenThousandths),
    [draft],
  );
  const unknownCount = prices.filter((price) => !price).length;
  const knownTotal = prices.reduce((sum, price) => sum + BigInt(price || "0"), 0n).toString();
  const totalText = unknownCount && prices.every((price) => !price) ? "待核验" : money(knownTotal);

  const runCheck = async () => {
    if (!draft || check === "loading") return;
    setCheck("loading");
    try {
      // Titles are persisted first so the preflight quote reflects this exact list.
      const saved = await gateway.saveDraftTitles(draftId, {
        mode: draft.titleMode,
        titles,
        expectedRevision: draft.revision,
      });
      draftQuery.reload();
      const result = await gateway.preflightDraft(draftId);
      setPreflight(result);
      if (result.blockers.length) {
        setCheck("failed");
        return;
      }
      setCheck("passed");
      openFinalConfirm(result);
    } catch (reason) {
      setCheck("failed");
      setPreflight(null);
      toast(reason instanceof Error ? reason.message : "核验未完成，请重试。");
    }
  };

  const openFinalConfirm = (result: PublicationPreflight) => {
    dialog.open({
      title: "最终确认 · 提交发布",
      body: (
        <>
          <div className="notice info">提交后会冻结相应费用并开始执行发布；已成功的媒体不会重复提交。</div>
          <dl className="details-grid" style={{ margin: "18px 0" }}>
            <div><dt>稿件</dt><dd>{result.article.title}</dd></div>
            <div><dt>发布范围</dt><dd>{result.items.length} 家媒体 · 每家 1 次</dd></div>
            <div><dt>总金额</dt><dd className="amount">{money(result.totalTenThousandths)}</dd></div>
            <div><dt>内容检查</dt><dd className="success-text">预检通过</dd></div>
          </dl>
          <p className="small muted">{result.items.map((item) => item.media.name).join("、")}</p>
        </>
      ),
      footer: (
        <FinalConfirmActions
          disabled={submitting}
          onConfirm={async () => {
            if (!draft) return;
            setSubmitting(true);
            try {
              await gateway.submitDraft({
                draftId,
                preflightRevision: result.revision,
                quoteFingerprint: result.quoteFingerprint,
                acknowledged: true,
                idempotencyKey: `titles-${draftId}-${result.revision}`,
              });
              dialog.close();
              toast("发布请求已受理，可在发布记录中跟踪执行状态。");
              navigate("/publishing/articles/records");
            } catch (reason) {
              toast(reason instanceof Error ? reason.message : "提交失败，请重试。");
            } finally {
              setSubmitting(false);
            }
          }}
        />
      ),
    });
  };

  if (draftQuery.loading) {
    return (
      <>
        <PageHeading title="配置标题与确认发布" />
        <div className="empty"><h3>正在读取投放草稿…</h3></div>
      </>
    );
  }
  if (draftQuery.error || !draft) {
    return (
      <>
        <PageHeading title="配置标题与确认发布" />
        <div className="panel-body">
          <PublishingError error={draftQuery.error ?? new Error("投放草稿不存在。")} onRetry={draftQuery.reload} />
        </div>
      </>
    );
  }
  if (!draft.items.length) {
    return (
      <>
        <PageHeading title="配置标题与确认发布">
          <Link className="btn" href={`/publishing/drafts/${encodeURIComponent(draftId)}/media`}>返回选择媒体</Link>
        </PageHeading>
        <div className="empty">
          <h3>尚未选择媒体</h3>
          <p>返回媒体库选择投放媒体后，再配置标题。</p>
          <Link className="btn" href={`/publishing/drafts/${encodeURIComponent(draftId)}/media`}>选择媒体</Link>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeading title="配置标题与确认发布">
        <Link className="btn" href={`/publishing/drafts/${encodeURIComponent(draftId)}/media`}>
          <Icon name="left" />返回选择媒体
        </Link>
      </PageHeading>
      <WorkflowPosition
        step={2}
        onStepSelect={(index) => {
          // 与“返回选择媒体”按钮等价的面包屑式回退：0=编辑稿件、1=选择媒体。
          if (index === 0) {
            navigate(`/publishing/articles/${encodeURIComponent(draft.articleId)}/edit`);
          } else if (index === 1) {
            navigate(`/publishing/drafts/${encodeURIComponent(draftId)}/media`);
          }
        }}
      />

      <div className="page-context">
        <span className="dot" />
        <span>{draft.articleTitle}</span>
        <span className="numeric">v{draft.articleVersion}</span>
        <span>· {draft.titleMode === "single" ? "单标题投放" : "多标题投放"}</span>
        <span>· {draft.items.length} 家媒体</span>
      </div>

      <section className="panel">
        <div className="titles-article">
          <div><h2>发布标题</h2></div>
          <Link className="link" href={`/publishing/articles/${encodeURIComponent(draft.articleId)}/edit`}>编辑原稿</Link>
        </div>
        <div className="table-wrap">
          <table className="titles-table">
            <caption className="sr-only">逐媒体标题配置</caption>
            <thead>
              <tr>
                <th style={{ width: "17%" }}>媒体</th>
                <th style={{ width: "27%" }}>稿件原标题</th>
                <th>实际发布标题</th>
                <th className="right">操作</th>
              </tr>
            </thead>
            <tbody>
              {draft.items.map((item) => {
                const limit = item.media.titleLimit;
                const value = titles[item.media.id] ?? "";
                const tooLong = limit ? Array.from(value).length > limit : false;
                return (
                  <tr key={item.media.id}>
                    <td>
                      <strong style={{ fontSize: 13, fontWeight: 500 }}>{item.media.name}</strong>
                      <div className="table-sub">{item.media.mediaType || item.media.platform}</div>
                    </td>
                    <td className="title-original">{draft.sharedTitle ?? draft.articleTitle}</td>
                    <td>
                      <div className="field">
                        <label className="sr-only" htmlFor={`title-${item.media.id}`}>{item.media.name}的发布标题</label>
                        <textarea
                          className="title-area"
                          id={`title-${item.media.id}`}
                          rows={2}
                          readOnly={draft.titleMode === "single"}
                          aria-invalid={tooLong ? "true" : undefined}
                          value={draft.titleMode === "single" ? (draft.sharedTitle ?? draft.articleTitle) : value}
                          onChange={(event) => {
                            setTitles((current) => ({ ...current, [item.media.id]: event.target.value }));
                            setCheck("idle");
                          }}
                        />
                      </div>
                      <div className={`check-line ${tooLong ? "danger-text" : "muted"}`}>
                        {draft.titleMode === "single"
                          ? "沿用稿件标题，在稿件阶段修改。"
                          : limit
                            ? `媒体要求：不超过 ${limit} 字。`
                            : "未取得明确的媒体标题要求。"}
                      </div>
                    </td>
                    <td className="right">
                      <button
                        type="button"
                        className="link"
                        onClick={() => requestWorkspaceNavigation(async () => {
                          try {
                            await gateway.updateDraftMedia(
                              draftId,
                              draft.items.filter((entry) => entry.media.id !== item.media.id).map((entry) => entry.media.id),
                              draft.revision,
                            );
                            draftQuery.reload();
                            setCheck("idle");
                            toast("已移除媒体。");
                          } catch (reason) {
                            toast(reason instanceof Error ? reason.message : "移除失败，请重试。");
                          }
                        })}
                      >
                        移除
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel money-panel">
        <div className="panel-header">
          <h2>费用与预算核验</h2>
          <Btn
            variant="subtle small"
            aria-label="了解待预占费用"
            onClick={() => dialog.open({
              title: "“本次待预占”说明",
              body: (
                <>
                  <p>入页金额来自当前清单的报价，只是预估。未知报价不能按零元计算；完整费用未知时应先补齐报价或移除此项。</p>
                  <p>有效核验后才能确认当前可提交范围和金额。展示余额或待预占金额，不代表已经冻结或扣款。</p>
                </>
              ),
            })}
          >
            <Icon name="help" />费用说明
          </Btn>
        </div>
        <div className="money-grid">
          <div className="money-box">
            <div className="money-label">本次待预占 <span className="tag">{check === "passed" ? "已核验" : "预估"}</span></div>
            <div className="money-value">{totalText}</div>
            <p className="money-note">
              {unknownCount
                ? `已知费用 ${money(knownTotal)}，另 ${unknownCount} 家报价未知。`
                : `${draft.items.length} 家媒体 × 1 次 · 合计 ${money(knownTotal)}`}
            </p>
          </div>
          <div className="money-box">
            <div className="money-label">可用余额</div>
            <div className="money-value">{walletAvailable ? money(walletAvailable) : "—"}</div>
            <p className="money-note">这里只展示余额信息，尚未冻结或扣除资金。</p>
          </div>
        </div>
        <div className="check-summary">
          <div>
            {check === "loading" ? (
              <div className="review-state" role="status">
                <span className="spinner" style={{ color: "var(--brand)" }} />
                <div><div className="state-title">正在核验</div></div>
              </div>
            ) : check === "failed" ? (
              <div className="review-state">
                <span className="danger-text"><Icon name="warning" /></span>
                <div>
                  <div className="state-title">核验未通过</div>
                  <div className="state-text">
                    {(preflight?.blockers.length ? preflight.blockers : ["请修改标题或移除待核验媒体，再重新确认。"]).join("；")}
                  </div>
                </div>
              </div>
            ) : check === "passed" ? (
              <div className="review-state">
                <span className="success-text"><Icon name="check" /></span>
                <div>
                  <div className="state-title">核验已通过</div>
                  <div className="state-text">{draft.items.length} 家媒体 · 内容检查通过 · 尚未提交。</div>
                </div>
              </div>
            ) : (
              <div className="review-state">
                <div><div className="state-title">发布前核验 <span className="tag">待核验</span></div></div>
              </div>
            )}
          </div>
          <div className="actions">
            <Btn
              variant="primary"
              disabled={check === "loading" || submitting || !draft.items.length}
              onClick={() => {
                if (check === "passed" && preflight) {
                  openFinalConfirm(preflight);
                } else {
                  void runCheck();
                }
              }}
            >
              {check === "loading" ? "核验中" : "确认发布"}<Icon name="arrow" />
            </Btn>
          </div>
        </div>
      </section>
    </>
  );
}

function FinalConfirmActions({ onConfirm, disabled }: { onConfirm: () => void; disabled: boolean }) {
  const [agreed, setAgreed] = useState(false);
  return (
    <>
      <label className="dialog-check" style={{ marginRight: "auto" }}>
        <input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />
        <span>我已核对发布标题、媒体范围和金额。</span>
      </label>
      <Btn variant="primary" disabled={disabled || !agreed} onClick={() => { setAgreed(false); onConfirm(); }}>
        {disabled ? "提交中…" : "确认提交发布"}
      </Btn>
    </>
  );
}
