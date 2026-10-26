import "../publishing.titles.css";
import { FileText, WandSparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearch } from "wouter";

import { usePublisherGateway, usePublisherQuery } from "../PublishingContext";
import { MediaMark, PublishingError, PublishingLoading, PublishingPage } from "../components/PublishingUi";
import { usePublishingChoice } from "../components/PublishingConversation";
import { unicodeLength } from "../queryState";
import { formatPublishingMoney, type PublicationDraft } from "../types";
import type { PublisherGateway } from "../gateway";
import { usePublishingFlow, usePublishingOperationScope, publishingTaskUrl } from "../PublishingFlowContext";
import { useWorkspaceDraftGuard } from "../host";
import { readPublishingBatch, withPublishingBatch } from "../batchPublishing";
import { acceptTitleEditorSave, readTitleEditors, reconcileTitleEditor, sameDraftSelection, titleEditorSignature, type TitleEditor } from "../titleEditors";
import { publishingTitleStage, saveUpstreamDraftTitles } from "../titleFlow";
import { restoreReviewSession } from "../reviewSession";
import { reviewDraftContext } from "../reviewPreflight";
import PublishingConfirmation, { type PreparedPublishingConfiguration } from "./ReviewPage";
import { usePreparationEntryScroll } from "../usePreparationEntryScroll";
import { publicationLineTotal, publicationQuantity } from "../publicationAmounts";

// Hosts without task-value persistence still retain edits while moving between steps.
// Never share private snapshots between authenticated gateway instances.
const localEditors = new WeakMap<PublisherGateway, Map<string, string>>();
const titleLimit = (limit: number) => Number.isFinite(limit) && limit > 0 ? limit : 200;

const configurationSignature = (editors: Record<string, TitleEditor>, ids: string[]) => JSON.stringify(ids.map(id => {
  const editor = editors[id];
  return editor ? [id, reviewDraftContext(editor.draft), titleEditorSignature(editor)] : [id];
}));
const selectedDrafts = (editors: Record<string, TitleEditor>, ids: string[]): PublicationDraft[] => ids.flatMap(id => {
  const editor = editors[id];
  return editor ? [{...editor.draft, items:editor.items.filter(item => editor.checked.includes(item.media.id)).map(item => ({...item,
    title:editor.mode === "single" ? editor.sharedTitle : editor.titles[item.media.id] ?? ""}))}] : [];
});

export default function PublishingTitlesPage({ draftId }: {
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
  const confirmationBusy = useRef(false);
  const [reviewProgress] = usePublishingChoice("publishingBatchReview:" + batch.draftIds.join(","));
  const submitting = useRef(false);
  const persistenceQueue = useRef<Promise<void>>(Promise.resolve());
  const persistenceOwner = useRef({ flow, scopeKey, gateway, choiceKey, acceptPersisted });
  persistenceOwner.current = { flow, scopeKey, gateway, choiceKey, acceptPersisted };

  useEffect(() => {
    submitting.current = false;
    setBusy(false);
    setError("");
    setPersistenceError("");
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
        publishingDraftTitleModes: Object.fromEntries(Object.values(next).map(editor => [editor.draft.id, editor.draft.titleMode])),
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
    const restored = restoreReviewSession(gateway, publishingTaskUrl("/", flow?.taskId) + ":" + (flow?.scopeKey ?? "") + ":", batch.draftIds, reviewProgress, flow?.selections);
    const next = Object.fromEntries(query.data.map(draft => {
      const protectedDraft = Boolean(restored.acceptedIds[draft.id] || restored.progress.requests[draft.id]);
      // A historical unsaved snapshot must never replace the actual dispatched configuration.
      let editor = reconcileTitleEditor(draft, protectedDraft ? undefined : saved[draft.id]);
      // A deep link from review still labels a wholly excluded draft when no local snapshot exists.
      if (!protectedDraft && !saved[draft.id] && batch.excludedDraftIds.includes(draft.id)) {
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
  const titleStage = publishingTitleStage(groups.map(editor => editor.draft));
  const reviewScope = publishingTaskUrl("/", flow?.taskId) + ":" + (flow?.scopeKey ?? "") + ":";
  const protection = () => restoreReviewSession(gateway, reviewScope, batch.draftIds, reviewProgress, flow?.selections);
  const protectedSession = protection();
  const protectedDraft = (id: string) => Boolean(protectedSession.acceptedIds[id] || protectedSession.progress.requests[id]);
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
  const invalidCount = groups.filter(editor => !protectedDraft(editor.draft.id)).reduce((sum, editor) => sum + [...(validation[editor.draft.id] ?? new Map<string, { value: string; length: number; limit: number; message: string }>()).values()].filter(item => item.message).length, 0);
  const selectedCount = groups.filter(editor => !protectedDraft(editor.draft.id)).reduce((sum, editor) => sum + editor.checked.length, 0);
  const ready = groups.length === batch.draftIds.length && !query.loading && !query.refreshing && !query.error && !flow?.pending;
  const entryRef = usePreparationEntryScroll(`titles:${scopeKey}`, ready || Boolean(query.error));
  const invalidSingleGroups = groups.filter(editor => !protectedDraft(editor.draft.id) && editor.mode === "single" && [...(validation[editor.draft.id]?.values() ?? [])].some(item => item.message));
  useWorkspaceDraftGuard({
    dirty: Boolean(persistenceError) || groups.some(editor => !protectedDraft(editor.draft.id) && titleEditorSignature(editor) !== editor.savedSignature),
    label: "发布标题与媒体勾选",
  });

  const updateEditor = (id: string, update: (editor: TitleEditor) => TitleEditor) => {
    const currentProtection = protection();
    if (busy || confirmationBusy.current || Object.keys(currentProtection.progress.requests).length || currentProtection.acceptedIds[id] || !editorRef.current[id]) return;
    replaceEditors({ ...editorRef.current, [id]: update(editorRef.current[id]) });
  };
  const applyTitleToAll = (id: string, value: string) => updateEditor(id, current => ({ ...current,
    titles: Object.fromEntries(current.items.map(item => [item.media.id, value])) }));

  const prepareConfiguration = async (): Promise<PreparedPublishingConfiguration | undefined> => {
    const currentProtection = protection();
    if (!ready || !titleStage || Object.keys(currentProtection.progress.requests).length || invalidCount || busy || submitting.current) return;
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
        if (currentProtection.acceptedIds[draft.id]) continue;
        const current = next[draft.id];
        if (!current || !sameDraftSelection(current.draft, draft)) changed = true;
        next[draft.id] = reconcileTitleEditor(draft, current);
      }
      replaceEditors(next);
      await persistEditors(next);
      if (!isCurrent()) return;
      if (changed) {
        setError("部分草稿已更新，已同步最新媒体和版本并保留可用标题。请核对后再次点击确认发布。");
        return;
      }
      for (const id of batch.draftIds) {
        let editor = next[id];
        if (!editor || !editor.checked.length || currentProtection.acceptedIds[id]) continue;
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
        const saved = editor.mode === "single" ? await saveUpstreamDraftTitles(gateway, editor.draft) : await gateway.saveDraftTitles(id, {
          mode: "per_media",
          titles: Object.fromEntries(editor.checked.map(mediaId => [mediaId, editor.titles[mediaId] ?? ""])),
          expectedRevision: editor.draft.revision,
        });
        if (!isCurrent()) return;
        next = { ...next, [id]: acceptTitleEditorSave(editor, saved, true) };
        replaceEditors(next);
        await persistEditors(next);
        if (!isCurrent()) return;
        if (editor.mode === "per_media") await flow?.record({
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
        const editor = next[id];
        if (editor && !editor.checked.length) next[id] = { ...editor, savedSignature: titleEditorSignature(editor) };
      }
      replaceEditors(next);
      await persistEditors(next);
      if (!isCurrent()) return;
      return {signature:configurationSignature(next, batch.draftIds), drafts:selectedDrafts(next, batch.draftIds)};
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
      if (isCurrent()) setError(`${savingId ? `${next[savingId]?.draft.articleTitle ?? "稿件"}：` : ""}${reason instanceof Error ? reason.message : "标题保存失败"}。已保存的稿件会保留，可重试。`);
    } finally {
      if (isCurrent()) { submitting.current = false; setBusy(false); }
    }
  };

  const mediaPath = publishingTaskUrl(withPublishingBatch(
    `/publishing/drafts/${encodeURIComponent(draftId)}/media${routeSearch}`, batch.draftIds,
    ready ? groups.filter(editor => !editor.checked.length).map(editor => editor.draft.id) : batch.excludedDraftIds,
  ), flow?.taskId);
  return (
    <PublishingPage title="配置标题" description="核对各稿件的媒体、发布标题与费用，确认后在本页完成发布前核验。" busy={query.loading || busy}>
      <div className="am-title-config" ref={entryRef}>
        {query.loading || (query.refreshing && !groups.length) || flow?.pending ? <PublishingLoading label="正在读取发布草稿…" /> : null}
        {query.error ? <PublishingError error={query.error} onRetry={query.reload} /> : null}
        <PublishingConfirmation draftId={draftId}
          configuration={{signature:configurationSignature(editors, batch.draftIds), drafts:selectedDrafts(editors, batch.draftIds), ready, invalid:Boolean(invalidCount) || !titleStage, saving:busy, mediaHref:mediaPath, loading:query.loading || query.refreshing || Boolean(flow?.pending), error:query.error}}
          prepareConfiguration={prepareConfiguration} onReloadConfiguration={query.reload}>
          {view => {
            confirmationBusy.current = view.busy;
            return <><div className="publishing-titles-layout">
          {groups.map(editor => {
            const id = editor.draft.id;
            const group = view.groups.find(group => group.draftId === id);
            const accepted = Boolean(view.acceptedIds[id]);
            const unknown = view.unknownIds.includes(id);
            const locked = busy || view.busy || view.unknown || accepted;
            const states = validation[id] ?? new Map<string, { value: string; length: number; limit: number; message: string }>();
            const invalid = editor.items.filter(item => states.get(item.media.id)?.message || group?.preflight?.items.find(result => result.media.id === item.media.id)?.blockers.length).length;
            const lineAmount = (item: (typeof editor.items)[number]) => group?.preflight?.items.find(result => result.media.id === item.media.id)?.priceTenThousandths ?? publicationLineTotal(item);
            const checkedAmounts = editor.items.filter(item => editor.checked.includes(item.media.id)).map(lineAmount);
            const checkedTotal = checkedAmounts.reduce<bigint>((sum, amount) => sum + BigInt(amount ?? '0'), 0n);
            const unknownAmount = checkedAmounts.some(amount => amount === null);
            const visible = editor.items.filter(item => !editor.onlyErrors || states.get(item.media.id)?.message || group?.preflight?.items.find(result => result.media.id === item.media.id)?.blockers.length);
            const domId = `title-draft-${encodeURIComponent(id)}`;
            return (
              <section className="publishing-panel publishing-title-draft-card" key={id} aria-labelledby={`${domId}-heading`}>
                <header className="publishing-draft-summary">
                  <span className="publishing-file-icon"><FileText size={21} /></span>
                  <div><h2 id={`${domId}-heading`}>{editor.draft.articleTitle}</h2><span>冻结版本 v{editor.draft.articleVersion} · {editor.items.length} 家媒体</span></div>
                  <span className="publishing-title-card-status">{accepted ? "发布请求已受理" : unknown ? "存在待核实请求" : !editor.checked.length ? "本篇未参与本次发布" : view.unknown ? "尚未提交，等待原请求核实" : `已选 ${editor.checked.length} 家`}</span>
                </header>
                <div className="publishing-title-tools">
                  <p className="publishing-title-selection" role="status">已选 <strong>{editor.checked.length} 家媒体</strong> · 已知费用 <strong>{unknownAmount && checkedAmounts.every(amount => amount === null) ? "待确认" : formatPublishingMoney(checkedTotal.toString())}</strong>{unknownAmount ? ' · 部分费用待确认' : ''}</p>
                  <label className="publishing-title-error-filter"><input type="checkbox" checked={editor.onlyErrors} disabled={locked} onChange={event => updateEditor(id, current => ({ ...current, onlyErrors: event.target.checked }))} />只看错误项 ({invalid})</label>
                  {editor.mode === "per_media" ? <button className="publishing-button publishing-button-secondary" type="button" disabled={locked} onClick={() => applyTitleToAll(id, editor.draft.articleTitle)}><WandSparkles size={15} />用稿件标题填充本稿全部媒体</button> : <span className="publishing-title-selection-note">沿用稿件阶段确认的统一标题</span>}
                </div>
                <p className="publishing-title-selection-note">{accepted ? "本稿发布请求已受理，以下配置仅供核对，不计入本次待提交费用。" : "取消勾选的媒体不计入费用、校验与本次发布；重新勾选后保留已填写标题。标题限制以媒体目录为准，缺失时上限为 200 字。"}</p>
                <div className="publishing-title-table-scroll" role="region" aria-label={`${editor.draft.articleTitle}的媒体和发布标题，可横向滚动`} tabIndex={0}>
                  <table className="publishing-title-table">
                    <colgroup><col className="title-col-check" /><col className="title-col-media" /><col className="title-col-original" /><col className="title-col-publish" /><col className="title-col-requirement" /></colgroup>
                    <thead><tr><th scope="col">选择</th><th scope="col">媒体</th><th scope="col">稿件原标题</th><th scope="col">实际发布标题</th><th scope="col">标题要求与发布检查</th></tr></thead>
                    <tbody>{visible.map(item => {
                      const result = states.get(item.media.id)!;
                      const included = editor.checked.includes(item.media.id);
                      const check = included && !accepted ? group?.preflight?.items.find(value => value.media.id === item.media.id) : undefined;
                      const inputId = `${domId}-${encodeURIComponent(item.media.id)}`;
                      return <tr key={item.media.id} className={included ? "" : "is-excluded"}>
                        <td><label className="publishing-title-check"><input type="checkbox" checked={included} disabled={locked} onChange={() => updateEditor(id, current => ({ ...current, checked: current.checked.includes(item.media.id) ? current.checked.filter(mediaId => mediaId !== item.media.id) : [...current.checked, item.media.id] }))} aria-label={`${editor.draft.articleTitle} · ${item.media.name}参与本次发布`} /></label></td>
                        <th scope="row"><span className="publishing-media-name"><MediaMark name={item.media.shortName} id={item.media.id} logoUrl={item.media.logoUrl} logoSource={item.media.logoSource} logoResolutionStatus={item.media.logoResolutionStatus} /><span><strong>{item.media.name}</strong><small>{item.media.kind === "self_media" ? "自媒体" : "软文媒体"} · 单价 {formatPublishingMoney(check?.media.priceTenThousandths ?? item.media.priceTenThousandths)}</small>{item.publication ? <small>{publicationQuantity(item) ?? '待确认'} 次发布 · 小计 {lineAmount(item) === null ? '待确认' : formatPublishingMoney(lineAmount(item)!)}{item.publication.quantityMeaning === 'repeat_same_article' ? ' · 同稿同标题重复发布' : ''}</small> : null}</span></span></th>
                        <td className="publishing-title-original">{editor.draft.articleTitle}</td>
                        <td>{editor.mode === "single" ? <><span className="publishing-title-single" aria-label={`${editor.draft.articleTitle} · ${item.media.name}统一标题`}>{result.value || "尚未确认统一标题"}</span><small>统一标题 · 请返回稿件编辑调整</small></> : <><label className="publishing-title-input-label" htmlFor={inputId}>实际发布标题</label><input type="text" id={inputId} value={result.value} disabled={locked || !included} aria-invalid={Boolean(result.message)} aria-describedby={`${inputId}-state`} aria-label={`${editor.draft.articleTitle} · ${item.media.name}独立标题`} onChange={event => updateEditor(id, current => ({ ...current, titles: { ...current.titles, [item.media.id]: event.target.value } }))} /><button type="button" className="publishing-title-copy" disabled={locked || !included} onClick={() => applyTitleToAll(id, result.value)}>应用到本稿全部媒体</button></>}</td>
                        <td id={`${inputId}-state`} className={result.message ? "publishing-title-requirement is-error" : "publishing-title-requirement"}><strong>上限 ≤ {result.limit} 字</strong><small>{included ? `${result.length} / ${result.limit} 字` : "未纳入本次发布"}</small><span>{!included ? "重新勾选后恢复" : result.message || "长度有效"}</span>
                          {included ? <div className="publishing-title-content-check" aria-live="polite">{accepted ? <span>已受理，不重复提交</span> : check ? <><strong className={check.blockers.length ? "is-danger" : "is-success"}>{check.blockers.length ? "内容检查不通过" : "内容检查通过"}</strong>{check.checks.map((entry, index) => <span key={`check-${index}`} className={entry.passed ? "is-success" : "is-danger"}>{entry.passed ? "✓ " : "× "}{entry.label}</span>)}{check.blockers.map((message, index) => <span className="is-danger" key={`blocker-${index}`}>{message}</span>)}{check.warnings.map((message, index) => <span key={`warning-${index}`}>{message}</span>)}</> : <span>{unknown ? "受理结果待核实" : view.unknown ? "尚未提交，等待原请求核实" : group?.check?.phase === "checking" ? "正在核验…" : group?.check?.phase === "failed" ? "核验失败，请重试" : "内容检查：— · 待核验"}</span>}</div> : null}
                        </td>
                      </tr>;
                    })}</tbody>
                  </table>
                  {!visible.length ? <p className="publishing-title-empty">{editor.onlyErrors ? "本稿没有需要修改的标题。" : "本稿暂无媒体，请返回选择媒体。"}</p> : null}
                </div>
                {view.feedback(id)}
              </section>
            );
          })}
        </div>
        {invalidSingleGroups.length ? <p className="publishing-form-error" role="alert">{invalidSingleGroups.map(editor => editor.draft.articleTitle).join("、")}的单标题尚未确认或不符合已选媒体要求，请返回稿件或媒体选择环节调整。</p> : null}
        {ready && !titleStage ? <p className="publishing-form-error" role="alert">标题模式无法恢复，请返回稿件或媒体选择环节重新确认。</p> : null}
        {ready && !selectedCount && !Object.keys(view.acceptedIds).length && !view.unknown ? <p className="publishing-form-error" role="status">本次未选择投放媒体，无法确认发布；请重新勾选或返回选择媒体。</p> : null}
        {error ? <p className="publishing-form-error" role="alert">{error}</p> : null}
        {persistenceError ? <p className="publishing-form-error" role="alert">{persistenceError}<button type="button" disabled={busy || view.busy} onClick={() => { void persistEditors(editorRef.current).then(() => setPersistenceError("")).catch(() => undefined); }}>重试同步</button></p> : null}
        </>;
          }}
        </PublishingConfirmation>
      </div>
    </PublishingPage>
  );
}
