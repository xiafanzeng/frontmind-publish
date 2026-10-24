import "../publishing.titles.css";
import { ArrowLeft, ArrowRight, FileText, LoaderCircle, WandSparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";

import { usePublisherGateway, usePublisherQuery } from "../PublishingContext";
import { MediaMark, PublishingConfirmDialog, PublishingError, PublishingLoading, PublishingPage } from "../components/PublishingUi";
import { usePublishingChoice } from "../components/PublishingConversation";
import PublishingFlowSteps, { flowStagesForMode } from "../components/PublishingFlowSteps";
import { unicodeLength } from "../queryState";
import { formatPublishingMoney, type PublisherTitleMode } from "../types";
import type { PublisherGateway } from "../gateway";
import { usePublishingFlow, usePublishingSummary, usePublishingOperationScope, publishingTaskUrl } from "../PublishingFlowContext";
import { performApprovedWorkspaceNavigation, useWorkspaceDraftGuard } from "../host";
import { readPublishingBatch, withPublishingBatch } from "../batchPublishing";
import { acceptTitleEditorSave, readTitleEditors, reconcileTitleEditor, sameDraftSelection, titleEditorSignature, type TitleEditor } from "../titleEditors";

// Hosts without task-value persistence still retain edits while moving between steps.
// Never share private snapshots between authenticated gateway instances.
const localEditors = new WeakMap<PublisherGateway, Map<string, string>>();
const titleLimit = (limit: number) => Number.isFinite(limit) && limit > 0 ? limit : 200;

export default function PublishingTitlesPage({ draftId, onSaved }: {
  draftId: string;
  onSaved?: (reviewPath?: string) => void;
}) {
  const gateway = usePublisherGateway();
  const flow = usePublishingFlow();
  const search = useSearch();
  const routeSearch = search ? `?${search.replace(/^\?/, "")}` : "";
  const batch = useMemo(() => readPublishingBatch(draftId, search), [draftId, search]);
  const batchKey = JSON.stringify(batch.draftIds);
  const scopeKey = `${flow?.scopeKey ?? "standalone"}:${flow?.taskId ?? "new"}:${batchKey}`;
  const choiceKey = `publishingTitleEditors:${batchKey}`;
  const [persisted, , acceptPersisted] = usePublishingChoice(choiceKey);
  const [, navigate] = useLocation();
  const operationScope = usePublishingOperationScope(batchKey);
  const load = useCallback((signal: AbortSignal) =>
    Promise.all((JSON.parse(batchKey) as string[]).map(id => gateway.getDraft(id, signal))),
  [batchKey, gateway]);
  const query = usePublisherQuery(load, `title-editors:${scopeKey}`);
  const [state, setState] = useState<{ gateway: PublisherGateway; scope: string; editors: Record<string, TitleEditor> }>();
  const editors = state?.gateway === gateway && state.scope === scopeKey ? state.editors : {};
  const editorRef = useRef(editors);
  editorRef.current = editors;
  const hydrated = useRef<{ gateway: PublisherGateway; scope: string; data: typeof query.data } | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [persistenceError, setPersistenceError] = useState("");
  const [confirmSingle, setConfirmSingle] = useState<string | null>(null);
  const submitting = useRef(false);
  const persistenceQueue = useRef<Promise<void>>(Promise.resolve());
  const persistenceOwner = useRef({ flow, scopeKey, gateway, choiceKey, acceptPersisted });
  persistenceOwner.current = { flow, scopeKey, gateway, choiceKey, acceptPersisted };

  useEffect(() => {
    submitting.current = false;
    setBusy(false);
    setError("");
    setPersistenceError("");
    setConfirmSingle(null);
  }, [gateway, scopeKey]);

  const replaceEditors = (next: Record<string, TitleEditor>) => {
    editorRef.current = next;
    setState({ gateway, scope: scopeKey, editors: next });
  };
  const persistEditors = useCallback((next: Record<string, TitleEditor>) => {
    const owner = persistenceOwner.current;
    const value = JSON.stringify(next);
    owner.acceptPersisted(value);
    if (!owner.flow?.saveValues) {
      let cache = localEditors.get(owner.gateway);
      if (!cache) { cache = new Map(); localEditors.set(owner.gateway, cache); }
      cache.set(owner.scopeKey, value);
      return Promise.resolve();
    }
    // Serialize values writes so a slow older keystroke cannot replace a later edit.
    const write = persistenceQueue.current.catch(() => undefined).then(() =>
      owner.flow!.saveValues!({
        [owner.choiceKey]: value,
        batchDraftIds: Object.keys(next),
        excludedDraftIds: Object.values(next).filter(editor => !editor.checked.length).map(editor => editor.draft.id),
      }));
    persistenceQueue.current = write;
    return write;
  }, []);

  useEffect(() => {
    if (!query.data || query.refreshing || flow?.pending) return;
    const current = hydrated.current;
    if (current?.gateway === gateway && current.scope === scopeKey && current.data === query.data) return;
    const sameScope = current?.gateway === gateway && current.scope === scopeKey;
    const saved = sameScope ? editorRef.current : readTitleEditors(
      persisted || (!flow?.saveValues ? localEditors.get(gateway)?.get(scopeKey) ?? "" : ""),
    );
    const next = Object.fromEntries(query.data.map(draft => {
      let editor = reconcileTitleEditor(draft, saved[draft.id]);
      // A deep link from review still labels a wholly excluded draft when no local snapshot exists.
      if (!saved[draft.id] && batch.excludedDraftIds.includes(draft.id)) {
        editor = { ...editor, checked: [] };
        editor.savedSignature = titleEditorSignature(editor);
      }
      return [draft.id, editor];
    }));
    hydrated.current = { gateway, scope: scopeKey, data: query.data };
    editorRef.current = next;
    setState({ gateway, scope: scopeKey, editors: next });
    setError("");
  }, [query.data, query.refreshing, flow?.pending, flow?.saveValues, gateway, scopeKey, persisted, batch.excludedDraftIds]);

  useEffect(() => {
    if (!state || state.gateway !== gateway || state.scope !== scopeKey) return;
    const inOperation = operationScope();
    const isCurrent = () => inOperation() && persistenceOwner.current.gateway === gateway && persistenceOwner.current.scopeKey === scopeKey;
    const timer = setTimeout(() => {
      void persistEditors(state.editors).then(() => {
        if (isCurrent()) setPersistenceError("");
      }).catch(() => {
        if (isCurrent()) setPersistenceError("标题修改暂未同步，请重试保存后再离开页面。");
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [state, gateway, scopeKey, operationScope, persistEditors]);

  const groups = batch.draftIds.map(id => editors[id]).filter((editor): editor is TitleEditor => Boolean(editor));
  const validation = useMemo(() => Object.fromEntries(groups.map(editor => [editor.draft.id,
    new Map(editor.items.map(item => {
      const value = editor.mode === "single" ? editor.sharedTitle : editor.titles[item.media.id] ?? "";
      const length = unicodeLength(value);
      const limit = titleLimit(item.media.titleLimit);
      const message = !editor.checked.includes(item.media.id) ? "" : !value.trim() ? "标题不能为空"
        : length > limit ? `超过该媒体 ${limit} 字限制` : "";
      return [item.media.id, { value, length, limit, message }];
    })),
  ])), [state, batchKey]);
  const invalidCount = groups.reduce((sum, editor) => sum + [...validation[editor.draft.id].values()].filter(item => item.message).length, 0);
  const selectedCount = groups.reduce((sum, editor) => sum + editor.checked.length, 0);
  const ready = groups.length === batch.draftIds.length && !query.loading && !query.refreshing && !query.error;
  useWorkspaceDraftGuard({
    dirty: Boolean(persistenceError) || groups.some(editor => titleEditorSignature(editor) !== editor.savedSignature),
    label: "发布标题与媒体勾选",
  });
  usePublishingSummary({ title: "发布准备", items: [
    { label: "稿件", value: `${groups.length} 篇` },
    { label: "投放组合", value: `${selectedCount} 项` },
    { label: "标题状态", value: busy ? "保存中" : invalidCount ? `${invalidCount} 项需要修改` : selectedCount ? "可继续预检" : "尚未勾选媒体" },
  ] });

  const updateEditor = (id: string, update: (editor: TitleEditor) => TitleEditor) => {
    if (busy || !editorRef.current[id]) return;
    replaceEditors({ ...editorRef.current, [id]: update(editorRef.current[id]) });
  };
  const requestMode = (id: string, next: PublisherTitleMode) => {
    const editor = editorRef.current[id];
    if (!editor || editor.mode === next) return;
    if (next === "per_media") {
      updateEditor(id, current => ({ ...current, mode: next,
        titles: Object.fromEntries(current.items.map(item => [item.media.id, current.sharedTitle])) }));
      return;
    }
    const distinct = [...new Set(Object.values(editor.titles).map(title => title.trim()).filter(Boolean))];
    if (distinct.length > 1) setConfirmSingle(id);
    else updateEditor(id, current => ({ ...current, mode: "single", sharedTitle: distinct[0] ?? current.draft.articleTitle }));
  };
  const applyTitleToAll = (id: string, value: string) => updateEditor(id, current => ({ ...current,
    titles: Object.fromEntries(current.items.map(item => [item.media.id, value])) }));

  const submit = async () => {
    if (!ready || invalidCount || busy || submitting.current) return;
    if (!selectedCount) { setError("请至少保留一个稿件的投放媒体，或返回选择媒体调整。"); return; }
    const inOperation = operationScope();
    const isCurrent = () => inOperation() && persistenceOwner.current.gateway === gateway && persistenceOwner.current.scopeKey === scopeKey;
    submitting.current = true;
    setBusy(true);
    setError("");
    let next = { ...editorRef.current };
    let savingId = "";
    try {
      // Re-read every draft before the first write. A changed revision needs another review click.
      const latest = await Promise.all(batch.draftIds.map(id => gateway.getDraft(id)));
      if (!isCurrent()) return;
      let changed = false;
      for (const draft of latest) {
        if (!sameDraftSelection(next[draft.id].draft, draft)) changed = true;
        next[draft.id] = reconcileTitleEditor(draft, next[draft.id]);
      }
      replaceEditors(next);
      await persistEditors(next);
      if (!isCurrent()) return;
      if (changed) {
        setError("部分草稿已更新，已同步最新媒体和版本并保留可用标题。请核对后再次进入预检。");
        return;
      }
      for (const id of batch.draftIds) {
        let editor = next[id];
        if (!editor.checked.length) continue;
        savingId = id;
        const selected = new Set(editor.checked);
        const serverIds = editor.draft.items.map(item => item.media.id);
        if (serverIds.length !== selected.size || !serverIds.every(mediaId => selected.has(mediaId))) {
          editor = { ...editor, pendingMedia: { expectedRevision: editor.draft.revision, mediaIds: [...editor.checked] } };
          next = { ...next, [id]: editor };
          replaceEditors(next);
          await persistEditors(next);
          if (!isCurrent()) return;
          const reduced = await gateway.updateDraftMedia(id, editor.checked, editor.draft.revision);
          if (!isCurrent()) return;
          editor = acceptTitleEditorSave(editor, reduced, false);
          next = { ...next, [id]: editor };
          replaceEditors(next);
          await persistEditors(next);
          if (!isCurrent()) return;
        }
        const saved = await gateway.saveDraftTitles(id, {
          mode: editor.mode,
          ...(editor.mode === "single" ? { sharedTitle: editor.sharedTitle.trim() } : {}),
          titles: Object.fromEntries(editor.checked.map(mediaId => [mediaId, editor.titles[mediaId] ?? ""])),
          expectedRevision: editor.draft.revision,
        });
        if (!isCurrent()) return;
        next = { ...next, [id]: acceptTitleEditorSave(editor, saved, true) };
        replaceEditors(next);
        await persistEditors(next);
        if (!isCurrent()) return;
        await flow?.record({
          id: `titles:${id}:${saved.revision}`, label: "发布标题已保存",
          detail: `${editor.draft.articleTitle} · ${editor.checked.length} 家媒体`,
          resources: batch.draftIds.map(draftId => ({ kind: "publication_draft" as const, id: draftId })),
          outputRefs: [{ resource: { kind: "publication_draft", id, label: editor.draft.articleTitle },
            version: String(saved.revision), sourceStepId: `titles:${id}:${saved.revision}` }],
        }).catch(() => undefined);
        if (!isCurrent()) return;
      }
      // Zero-selected groups remain in the batch route, but review must skip their API/fees.
      for (const id of batch.draftIds) {
        if (!next[id].checked.length) next[id] = { ...next[id], savedSignature: titleEditorSignature(next[id]) };
      }
      replaceEditors(next);
      await persistEditors(next);
      if (!isCurrent()) return;
      const reviewPath = publishingTaskUrl(withPublishingBatch(
        `/publishing/drafts/${encodeURIComponent(draftId)}/review${routeSearch}`, batch.draftIds,
        batch.draftIds.filter(id => !next[id].checked.length),
      ), flow?.taskId);
      performApprovedWorkspaceNavigation(() => onSaved ? onSaved(reviewPath) : navigate(reviewPath));
    } catch (reason) {
      if (!isCurrent()) return;
      // A timed-out response may already have committed. Recover its revision before retrying.
      if (savingId) {
        try {
          const fresh = await gateway.getDraft(savingId);
          if (!isCurrent()) return;
          next = { ...next, [savingId]: reconcileTitleEditor(fresh, next[savingId]) };
          replaceEditors(next);
          await persistEditors(next);
        } catch { /* Keep the recoverable local snapshot; retry re-reads every draft. */ }
      }
      if (isCurrent()) setError(`${savingId ? `${next[savingId].draft.articleTitle}：` : ""}${reason instanceof Error ? reason.message : "标题保存失败"}。已保存的稿件会保留，可重试。`);
    } finally {
      if (isCurrent()) { submitting.current = false; setBusy(false); }
    }
  };

  const mediaPath = publishingTaskUrl(withPublishingBatch(`/publishing/drafts/${encodeURIComponent(draftId)}/media${routeSearch}`, batch.draftIds), flow?.taskId);
  return (
    <PublishingPage title="配置发布标题" description="按稿件配置各媒体的正式发布标题；取消勾选的投放项不参与本次发布。" busy={query.loading || busy}>
      <div className="am-title-config">
        {!flow && <PublishingFlowSteps stages={flowStagesForMode("per_media")} doneCount={2} activeIndex={2} />}
        {query.loading || (query.refreshing && !groups.length) || flow?.pending ? <PublishingLoading label="正在读取发布草稿…" /> : null}
        {query.error ? <PublishingError error={query.error} onRetry={query.reload} /> : null}
        <div className="publishing-titles-layout">
          {groups.map(editor => {
            const id = editor.draft.id;
            const states = validation[id];
            const invalid = [...states.values()].filter(item => item.message).length;
            const checkedTotal = editor.items.filter(item => editor.checked.includes(item.media.id)).reduce((sum, item) => sum + BigInt(item.media.priceTenThousandths), 0n);
            const visible = editor.items.filter(item => !editor.onlyErrors || states.get(item.media.id)?.message);
            const domId = `title-draft-${encodeURIComponent(id)}`;
            return (
              <section className="publishing-panel publishing-title-draft-card" key={id} aria-labelledby={`${domId}-heading`}>
                <header className="publishing-draft-summary">
                  <span className="publishing-file-icon"><FileText size={21} /></span>
                  <div><h2 id={`${domId}-heading`}>{editor.draft.articleTitle}</h2><span>冻结版本 v{editor.draft.articleVersion} · {editor.items.length} 家媒体</span></div>
                  <span className="publishing-title-card-status">{editor.checked.length ? `已选 ${editor.checked.length} 家` : "本篇未参与本次发布"}</span>
                </header>
                <div className="publishing-title-mode-tabs" role="group" aria-label={`${editor.draft.articleTitle}的标题模式`}>
                  <button type="button" disabled={busy} aria-pressed={editor.mode === "single"} className={editor.mode === "single" ? "is-active" : ""} onClick={() => requestMode(id, "single")}><strong>单标题</strong><span>本稿所有媒体使用同一标题</span></button>
                  <button type="button" disabled={busy} aria-pressed={editor.mode === "per_media"} className={editor.mode === "per_media" ? "is-active" : ""} onClick={() => requestMode(id, "per_media")}><strong>多标题</strong><span>本稿逐家媒体独立配置</span></button>
                </div>
                {editor.mode === "single" ? <div className="publishing-shared-title">
                  <label htmlFor={`${domId}-shared`}>实际发布标题 · 本稿媒体共用</label>
                  <textarea id={`${domId}-shared`} value={editor.sharedTitle} rows={3} disabled={busy} aria-invalid={Boolean(invalid)} aria-describedby={`${domId}-shared-help`} onChange={event => updateEditor(id, current => ({ ...current, sharedTitle: event.target.value }))} />
                  <small id={`${domId}-shared-help`}>{unicodeLength(editor.sharedTitle)} 字 · 为已选媒体分别校验；各媒体要求见下表{invalid ? ` · ${invalid} 项需要修改` : ""}</small>
                </div> : null}
                <div className="publishing-title-tools">
                  <p className="publishing-title-selection" role="status">已选 <strong>{editor.checked.length} 家媒体</strong> · 有效费用 <strong>{formatPublishingMoney(checkedTotal.toString())}</strong></p>
                  <label className="publishing-title-error-filter"><input type="checkbox" checked={editor.onlyErrors} disabled={busy} onChange={event => updateEditor(id, current => ({ ...current, onlyErrors: event.target.checked }))} />只看错误项 ({invalid})</label>
                  {editor.mode === "per_media" ? <button className="publishing-button publishing-button-secondary" type="button" disabled={busy} onClick={() => applyTitleToAll(id, editor.draft.articleTitle)}><WandSparkles size={15} />用稿件标题填充本稿全部媒体</button> : null}
                </div>
                <p className="publishing-title-selection-note">取消勾选的媒体不计入费用、校验与本次发布；重新勾选后保留已填写标题。标题限制以媒体目录为准，缺失时上限为 200 字。</p>
                <div className="publishing-title-table-scroll" role="region" aria-label={`${editor.draft.articleTitle}的媒体和发布标题，可横向滚动`} tabIndex={0}>
                  <table className="publishing-title-table">
                    <colgroup><col className="title-col-check" /><col className="title-col-media" /><col className="title-col-original" /><col className="title-col-publish" /><col className="title-col-requirement" /></colgroup>
                    <thead><tr><th scope="col">选择</th><th scope="col">媒体</th><th scope="col">稿件原标题</th><th scope="col">实际发布标题</th><th scope="col">标题要求</th></tr></thead>
                    <tbody>{visible.map(item => {
                      const result = states.get(item.media.id)!;
                      const included = editor.checked.includes(item.media.id);
                      const inputId = `${domId}-${encodeURIComponent(item.media.id)}`;
                      return <tr key={item.media.id} className={included ? "" : "is-excluded"}>
                        <td><label className="publishing-title-check"><input type="checkbox" checked={included} disabled={busy} onChange={() => updateEditor(id, current => ({ ...current, checked: current.checked.includes(item.media.id) ? current.checked.filter(mediaId => mediaId !== item.media.id) : [...current.checked, item.media.id] }))} aria-label={`${editor.draft.articleTitle} · ${item.media.name}参与本次发布`} /></label></td>
                        <th scope="row"><span className="publishing-media-name"><MediaMark name={item.media.shortName} id={item.media.id} logoUrl={item.media.logoUrl} logoSource={item.media.logoSource} logoResolutionStatus={item.media.logoResolutionStatus} /><span><strong>{item.media.name}</strong><small>{item.media.kind === "self_media" ? "自媒体" : "软文媒体"} · {formatPublishingMoney(item.media.priceTenThousandths)}</small></span></span></th>
                        <td className="publishing-title-original">{editor.draft.articleTitle}</td>
                        <td>{editor.mode === "single" ? <p className="publishing-title-shared-value">{result.value || "尚未填写"}</p> : <><label className="publishing-title-input-label" htmlFor={inputId}>实际发布标题</label><input type="text" id={inputId} value={result.value} disabled={busy || !included} aria-invalid={Boolean(result.message)} aria-describedby={`${inputId}-state`} aria-label={`${editor.draft.articleTitle} · ${item.media.name}独立标题`} onChange={event => updateEditor(id, current => ({ ...current, titles: { ...current.titles, [item.media.id]: event.target.value } }))} /><button type="button" className="publishing-title-copy" disabled={busy || !included} onClick={() => applyTitleToAll(id, result.value)}>应用到本稿全部媒体</button></>}</td>
                        <td id={`${inputId}-state`} className={result.message ? "publishing-title-requirement is-error" : "publishing-title-requirement"}><strong>上限 ≤ {result.limit} 字</strong><small>{included ? `${result.length} / ${result.limit} 字` : "未纳入本次发布"}</small><span>{!included ? "重新勾选后恢复" : result.message || "长度有效"}</span></td>
                      </tr>;
                    })}</tbody>
                  </table>
                  {!visible.length ? <p className="publishing-title-empty">{editor.onlyErrors ? "本稿没有需要修改的标题。" : "本稿暂无媒体，请返回选择媒体。"}</p> : null}
                </div>
              </section>
            );
          })}
        </div>
        {error ? <p className="publishing-form-error" role="alert">{error}</p> : null}
        {persistenceError ? <p className="publishing-form-error" role="alert">{persistenceError}<button type="button" disabled={busy} onClick={() => { void persistEditors(editorRef.current).then(() => setPersistenceError("")).catch(() => undefined); }}>重试同步</button></p> : null}
        {groups.length ? <footer className="publishing-workflow-footer">
          <Link className="publishing-button publishing-button-secondary" href={mediaPath}><ArrowLeft size={16} />返回选择媒体</Link>
          <button className="publishing-button publishing-button-accent" type="button" onClick={submit} disabled={!ready || Boolean(invalidCount) || busy}><span className="publishing-title-submit-icon">{busy ? <LoaderCircle className="publishing-spin" size={17} /> : <ArrowRight size={17} />}</span>{busy ? "保存标题中…" : "预检与发布"}</button>
        </footer> : null}
      </div>
      <PublishingConfirmDialog open={Boolean(confirmSingle)} title="切换为单标题？" description="本稿媒体使用了不同标题。切换后将用稿件标题作为本稿全部媒体的发布标题，其他稿件不受影响。" confirmLabel="覆盖并切换" onCancel={() => setConfirmSingle(null)} onConfirm={() => { if (confirmSingle) updateEditor(confirmSingle, current => ({ ...current, mode: "single", sharedTitle: current.draft.articleTitle })); setConfirmSingle(null); }} />
    </PublishingPage>
  );
}
