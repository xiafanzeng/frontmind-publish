import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { MatrixDialog } from './SourceMatrixPresentation';
import { MediaDialog } from './MediaMarket';
import { RESEARCH_IMPORT_ACCEPT, RESEARCH_IMPORT_LIMITS as L, type ResearchDatasetSummary, type ResearchImportCounts } from './research-import-types';
import './research-import.css';

type Props = { open: boolean; scopeKey?: string; onClose: () => void; selectedIds: string[]; onChange: (ids: string[], datasets: ResearchDatasetSummary[]) => void; onRefresh?: (datasets: ResearchDatasetSummary[]) => void; onNotice?: (message: string) => void };
type Pending = { key: number; file: File; replaceId?: string; status: 'queued' | 'uploading' | 'failed'; error?: string };
type AutoImportResult = { dataset: ResearchDatasetSummary; reused: boolean; replacedId?: string; validation: { counts: ResearchImportCounts; warnings: string[] } };
const API = '/api/modules/publish/matrix/imports';

function conciseError(reason: unknown, fallback: string) {
  return reason instanceof Error && reason.name !== 'TypeError' ? reason.message.replace(/\s+/g, ' ').slice(0, 180) || fallback : fallback;
}
function selectionError(ids: string[], datasets: ResearchDatasetSummary[]) {
  if (ids.length > L.files) return `最多选用 ${L.files} 个文件，请先取消部分选择。`;
  if (datasets.filter(item => ids.includes(item.id)).reduce((total, item) => total + item.recordCount, 0) > L.selectedRows) return '所选数据超过 10,000 条，请先取消部分选择。';
  return '';
}
function savedStatus(dataset: ResearchDatasetSummary, concise = true) {
  const parts = [`已保存 · ${dataset.recordCount.toLocaleString('zh-CN')} 条`];
  if (dataset.duplicateCount) parts.push(`去重 ${dataset.duplicateCount} 条`);
  if (dataset.failedCount) parts.push(`跳过 ${dataset.failedCount} 条`);
  if (dataset.warnings?.length) {
    const warnings = dataset.warnings.join('；');
    parts.push(concise && warnings.length > 140 ? warnings.slice(0, 140) + '…' : warnings);
  }
  return parts.join(' · ');
}

/** A new owner (task/article/workspace) or a closed dialog cannot receive old callbacks. */
export function ResearchImportDialog({ open, scopeKey, ...props }: Props) {
  return open ? <ResearchImportSession key={scopeKey ?? 'imports'} {...props} /> : null;
}

function ResearchImportSession({ onClose, selectedIds, onChange, onRefresh, onNotice }: Omit<Props, 'open' | 'scopeKey'>) {
  const [datasets, setDatasets] = useState<ResearchDatasetSummary[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const [uploading, setUploading] = useState(false), [removing, setRemoving] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<ResearchDatasetSummary | null>(null);
  const [removeError, setRemoveError] = useState('');
  const input = useRef<HTMLInputElement>(null), id = useId();
  const alive = useRef(false), mutation = useRef(false), serial = useRef(0);
  const controllers = useRef(new Set<AbortController>()), replace = useRef<string | undefined>(undefined);
  const selected = useRef(selectedIds), saved = useRef(datasets), queued = useRef(pending), callback = useRef(onChange);
  const refresh = useRef(onRefresh);
  selected.current = selectedIds; callback.current = onChange; refresh.current = onRefresh;
  const working = uploading || removing !== null;

  useLayoutEffect(() => {
    alive.current = true;
    return () => { alive.current = false; controllers.current.forEach(controller => controller.abort()); controllers.current.clear(); };
  }, []);

  async function request<T,>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController(); controllers.current.add(controller);
    const timer = setTimeout(() => controller.abort(), init.method === 'POST' ? 90_000 : 30_000);
    try {
      const response = await fetch(API + path, { ...init, credentials: 'same-origin', signal: controller.signal });
      const data = await response.json().catch(() => null) as ({ message?: string } & T) | null;
      if (!response.ok || !data) throw new Error(data?.message || '暂时无法读取结果，请重试。');
      return data;
    } catch (reason) {
      if (controller.signal.aborted) throw new Error('请求超时，请重试核对结果。');
      throw reason;
    } finally { clearTimeout(timer); controllers.current.delete(controller); }
  }
  function writeSaved(items: ResearchDatasetSummary[]) { saved.current = items; setDatasets(items); }
  function writePending(items: Pending[]) { queued.current = items; setPending(items); }
  function patch(key: number, value: Partial<Pending>) { writePending(queued.current.map(item => item.key === key ? { ...item, ...value } : item)); }
  function choose(ids: string[], items = saved.current) {
    const unique = [...new Set(ids)], issue = selectionError(unique, items);
    const reducing = unique.length < selected.current.length && unique.every(value => selected.current.includes(value));
    if (issue && !reducing) { setError(issue); return false; }
    selected.current = unique;
    callback.current(unique, items.filter(item => unique.includes(item.id)));
    return true;
  }

  useEffect(() => {
    let current = true;
    setLoadState('loading'); setLoadError('');
    void request<{ datasets: ResearchDatasetSummary[] }>('').then(data => {
      if (!current || !alive.current) return;
      const items = [...new Map(data.datasets.filter(item => item.status === 'confirmed').map(item => [item.id, item])).values()];
      writeSaved(items); setLoadState('ready');
      const valid = selected.current.filter(value => items.some(item => item.id === value));
      if (valid.length !== selected.current.length) {
        choose(valid, items); setMessage('已取消失效文件的选用，请核对当前选择。'); onNotice?.('已取消失效文件的选用，请核对当前选择。');
      } else {
        // Refresh names/counts without marking an unchanged selection as a user edit.
        refresh.current?.(items.filter(item => valid.includes(item.id)));
      }
    }).catch(reason => {
      if (!current || !alive.current) return;
      setLoadState('failed'); setLoadError(conciseError(reason, '文件列表读取失败，请重试。'));
    });
    return () => { current = false; };
  }, [loadAttempt]);

  async function runFiles(items: Pending[]) {
    if (mutation.current || loadState !== 'ready' || !alive.current) return;
    mutation.current = true; setUploading(true); setError(''); setMessage('');
    try {
      for (const item of items) {
        if (!alive.current) break;
        const file = item.file;
        patch(item.key, { status: 'uploading', error: undefined });
        if (file.size <= 0 || file.size > L.bytes) { patch(item.key, { status: 'failed', error: '请选择非空且不超过 8 MiB 的文件。' }); continue; }
        const extension = '.' + (file.name.split('.').pop()?.toLowerCase() ?? '');
        if (!RESEARCH_IMPORT_ACCEPT.split(',').includes(extension)) { patch(item.key, { status: 'failed', error: '不支持此格式，请选择下方列出的文件类型。' }); continue; }
        try {
          const body = new FormData();
          body.append('file', file); body.append('original_name', file.name);
          body.append('selected_ids', JSON.stringify([...new Set(selected.current.filter(value => value !== item.replaceId))]));
          if (item.replaceId) body.append('replace_id', item.replaceId);
          const result = await request<AutoImportResult>('/auto', { method: 'POST', body });
          if (!alive.current) break;
          // The server commits replacement atomically. Never issue a client-side remove here.
          const dataset = { ...result.dataset, warnings: result.dataset.warnings ?? result.validation.warnings };
          const next = [dataset, ...saved.current.filter(value => value.id !== dataset.id && value.id !== result.replacedId)];
          writeSaved(next);
          writePending(queued.current.filter(value => value.key !== item.key));
          const retained = selected.current.filter(value => value !== result.replacedId);
          if (choose([...retained, dataset.id], next)) setMessage(result.reused ? '已复用并选用已有文件。' : item.replaceId ? '文件已替换并选用。' : '文件已保存并选用。');
          else {
            // Selection may have changed elsewhere while the request was pending.
            if (retained.length !== selected.current.length) choose(retained, next);
            setMessage('文件已保存；请减少当前选择后选用。');
          }
        } catch (reason) {
          if (alive.current) patch(item.key, { status: 'failed', error: conciseError(reason, '未收到导入结果，请重试核对。') });
        }
      }
    } finally {
      mutation.current = false;
      if (alive.current) setUploading(false);
    }
  }

  function addFiles(files: FileList | File[] | null, replaceId?: string) {
    if (!files?.length || mutation.current || loadState !== 'ready' || confirmRemove) return;
    const values = Array.from(files);
    if (replaceId && values.length !== 1) { setError('替换时请选择一个文件。'); return; }
    const previous = queued.current.filter(item => !replaceId || item.replaceId !== replaceId);
    if (values.length > L.files || previous.length + values.length > L.files) { setError('一次最多处理 10 个文件，请先移除失败文件。'); return; }
    const added = values.map(file => ({ key: ++serial.current, file, replaceId, status: 'queued' as const }));
    writePending([...previous, ...added]);
    void runFiles(added);
  }
  function pickFile(replaceId?: string) {
    if (!input.current || mutation.current || loadState !== 'ready') return;
    replace.current = replaceId;
    input.current.multiple = !replaceId; input.current.value = ''; input.current.click();
  }
  function discardPending(key: number) { if (!mutation.current) writePending(queued.current.filter(item => item.key !== key)); }
  function close() {
    alive.current = false;
    controllers.current.forEach(controller => controller.abort()); controllers.current.clear();
    onClose();
  }
  async function removeDataset(dataset: ResearchDatasetSummary) {
    if (mutation.current || !alive.current) return;
    mutation.current = true; setRemoving(dataset.id); setRemoveError(''); setError('');
    try {
      await request('/' + encodeURIComponent(dataset.id) + '/remove', { method: 'POST' });
      if (!alive.current) return;
      const next = saved.current.filter(item => item.id !== dataset.id);
      writeSaved(next); writePending(queued.current.filter(item => item.replaceId !== dataset.id));
      choose(selected.current.filter(value => value !== dataset.id), next);
      setConfirmRemove(null); setMessage('文件已删除，已有生成结果保留原快照。');
    } catch (reason) { if (alive.current) setRemoveError(conciseError(reason, '未确认删除结果，请重试核对。')); }
    finally { mutation.current = false; if (alive.current) setRemoving(null); }
  }

  function pendingActions(item: Pending) {
    return <><button type="button" className="link small" disabled={working} onClick={() => void runFiles([item])}>重试</button><button type="button" className="link small" disabled={working} onClick={() => discardPending(item.key)}>{item.replaceId ? '取消替换' : '移除'}</button></>;
  }
  return <>
    <MatrixDialog open={!confirmRemove} title="导入数据" width={920} onClose={close} footer={<button type="button" className="button primary" onClick={close}>完成</button>}>
      <div className="sm-research-import">
        <div className="sm-import-drop" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); addFiles(event.dataTransfer.files); }}>
          <button className="button secondary" type="button" disabled={working || loadState !== 'ready'} onClick={() => pickFile()}>{uploading ? '正在导入…' : '选择文件 / 拖拽到此处'}</button>
          <input ref={input} className="sr" type="file" multiple accept={RESEARCH_IMPORT_ACCEPT} aria-label="选择导入文件" aria-describedby={`${id}-limits`} disabled={working || loadState !== 'ready'} onChange={event => {
            const files = Array.from(event.target.files ?? []), replaceId = replace.current;
            replace.current = undefined; event.target.value = ''; addFiles(files, replaceId);
          }}/>
          <p className="small muted" id={`${id}-limits`}>每个文件不超过 8 MiB；任务最多选用 10 个文件、合计 10,000 条。</p>
          <p className="small muted">CSV、TSV、Excel、JSON、JSONL、TXT、Markdown、DOCX、文字型 PDF</p>
        </div>
        <section className="sm-import-list-section" aria-label="导入文件">
          <div className="sm-import-list-heading"><h3>文件列表</h3><span className="small muted">已选用 {selectedIds.length} / {L.files}</span></div>
          <div className="sm-import-feedback" aria-live="polite">{error && <p className="block-error" role="alert">{error}</p>}{message && <p className="small" role="status">{message}</p>}</div>
          {loadState === 'loading' && <p role="status">正在读取已保存文件…</p>}
          {loadState === 'failed' && <div className="sm-import-load-error"><p className="block-error" role="alert">{loadError}</p><button className="link small" type="button" onClick={() => setLoadAttempt(value => value + 1)}>重新读取文件列表</button></div>}
          {loadState === 'ready' && <>
            {!datasets.length && !pending.length && <p className="small muted">暂无文件，选择文件后将自动保存并选用。</p>}
            <ul className="sm-import-list">
              {datasets.map(dataset => {
                const replacement = pending.find(item => item.replaceId === dataset.id);
                const status = replacement ? replacement.status === 'failed' ? `替换 ${replacement.file.name}：${replacement.error}` : `正在替换：${replacement.file.name}` : savedStatus(dataset);
                const fullStatus = replacement ? status : savedStatus(dataset, false), shortened = fullStatus !== status;
                return <li className="sm-import-row" key={dataset.id} aria-busy={replacement?.status === 'uploading'}>
                  <label className="sm-import-selection"><input type="checkbox" checked={selectedIds.includes(dataset.id)} disabled={working} aria-label={`选用 ${dataset.name}`} onChange={event => { setError(''); choose(event.target.checked ? [...selected.current, dataset.id] : selected.current.filter(value => value !== dataset.id)); }}/><span className="sm-import-file-text"><strong>{dataset.name}</strong><small className={replacement?.status === 'failed' ? 'block-error' : 'muted'} title={shortened ? fullStatus : undefined} role={replacement?.status === 'failed' ? 'alert' : undefined}><span aria-hidden={shortened || undefined}>{status}</span>{shortened && <span className="sr">{fullStatus}</span>}</small></span></label>
                  <div className="sm-import-actions">{replacement?.status === 'failed' ? pendingActions(replacement) : <><button type="button" className="link small" disabled={working} onClick={() => pickFile(dataset.id)}>替换</button><button type="button" className="link small" disabled={working} onClick={() => { setRemoveError(''); setConfirmRemove(dataset); }}>删除</button></>}</div>
                </li>;
              })}
              {pending.filter(item => !item.replaceId).map(item => <li className="sm-import-row" key={`pending-${item.key}`} aria-busy={item.status !== 'failed'}>
                <div className="sm-import-selection"><input type="checkbox" checked={false} disabled aria-label={`选用 ${item.file.name}`}/><span className="sm-import-file-text"><strong>{item.file.name}</strong><small className={item.status === 'failed' ? 'block-error' : 'muted'} role={item.status === 'failed' ? 'alert' : 'status'}>{item.status === 'failed' ? item.error : item.status === 'queued' ? '等待导入…' : '正在导入…'}</small></span></div>
                <div className="sm-import-actions">{item.status === 'failed' && pendingActions(item)}</div>
              </li>)}
            </ul>
            <p className="small muted">取消勾选仅停止在当前任务中选用。选用资料将在生成推荐时发送给当前服务商。</p>
          </>}
        </section>
      </div>
    </MatrixDialog>
    <MediaDialog open={!!confirmRemove} title="删除文件" confirmLabel="删除文件" busy={removing !== null} onCancel={() => { if (!mutation.current) setConfirmRemove(null); }} onConfirm={() => { if (confirmRemove) void removeDataset(confirmRemove); }}>
      <p>删除“{confirmRemove?.name}”后，将从已保存文件和当前任务选择中移除。已有生成结果保留原快照。</p>
      {removeError && <p className="block-error" role="alert">{removeError}</p>}
    </MediaDialog>
  </>;
}
