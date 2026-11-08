import { useCallback, useEffect, useRef, useState } from 'react';

export type BatchReadEntry<T> = { ids: string[]; items: T[]; error: string };
type Snapshot<T> = {
  scope: string; owner: unknown; loader: unknown; attempt: number;
  entries: BatchReadEntry<T>[]; loading: boolean;
};

/** Request-local successes only; nothing is shared between owners or revisions. */
export function usePartialBatchRead<T>(
  ids: string[], scope: string, owner: unknown,
  loadBatch: (ids: string[], signal: AbortSignal) => Promise<T[]>,
  messages: { timeout: string; failure: string },
) {
  const idsKey = JSON.stringify([...new Set(ids.filter(Boolean))].sort());
  const requested: string[] = JSON.parse(idsKey);
  const [attempt, setAttempt] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot<T>>();
  const latest = useRef<Snapshot<T> | undefined>(undefined);
  const retry = useCallback(() => setAttempt(value => value + 1), []);

  useEffect(() => {
    const requestedIds: string[] = JSON.parse(idsKey);
    const requestedSet = new Set(requestedIds);
    const previous = latest.current;
    const sameScope = previous?.scope === scope && previous.owner === owner && previous.loader === loadBatch;
    // Items belong to the complete identity set of their read. Retaining an
    // item's old batch after dropping one member could resurrect that member
    // when it is re-added and a fresh read correctly returns no row for it.
    // Discard such batches together and re-read their remaining identities.
    let entries: BatchReadEntry<T>[] = sameScope ? previous.entries
      .filter(entry => entry.ids.length > 0 && entry.ids.every(id => requestedSet.has(id))) : [];
    if (sameScope && previous.attempt !== attempt) {
      // A failed read retries only failed work. A normal refresh after success
      // deliberately revalidates the current evidence, as existing rules do.
      entries = entries.some(entry => entry.error) ? entries.filter(entry => !entry.error) : [];
    }
    const settled = new Set(entries.flatMap(entry => entry.ids));
    const pending = requestedIds.filter(id => !settled.has(id));
    const batches: string[][] = [];
    let chunk: string[] = [], encodedSize = 0;
    for (const id of pending) {
      // tRPC/REST reads use query strings. Long external IDs must not turn one
      // nominally small batch into an oversized URL; UUID batches still fit 100.
      const size = encodeURIComponent(id).length + 9;
      if (chunk.length && (chunk.length >= 100 || encodedSize + size > 5_000)) {
        batches.push(chunk); chunk = []; encodedSize = 0;
      }
      chunk.push(id); encodedSize += size;
    }
    if (chunk.length) batches.push(chunk);
    const parent = new AbortController();
    let active = true, next = 0, outstanding = batches.length;
    const publish = () => {
      if (!active || parent.signal.aborted) return;
      const value = { scope, owner, loader: loadBatch, attempt, entries: [...entries], loading: outstanding > 0 };
      latest.current = value;
      setSnapshot(value);
    };
    publish();
    const worker = async () => {
      while (active && !parent.signal.aborted && next < batches.length) {
        const batch = batches[next++]!;
        const child = new AbortController();
        let rejectCancellation: (error: Error) => void = () => {};
        const cancel = () => { child.abort(); rejectCancellation(new Error('读取已取消')); };
        parent.signal.addEventListener('abort', cancel, { once: true });
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          // The race enforces the deadline even if an adapter ignores signal;
          // a late promise cannot publish after this batch has settled.
          const deadline = new Promise<never>((_resolve, reject) => {
            rejectCancellation = reject;
            timer = setTimeout(() => { child.abort(); reject(new Error(messages.timeout)); }, 20_000);
          });
          const items = await Promise.race([loadBatch(batch, child.signal), deadline]);
          if (!active || parent.signal.aborted) return;
          entries.push({ ids: batch, items, error: '' });
        } catch (error) {
          if (!active || parent.signal.aborted) return;
          entries.push({ ids: batch, items: [], error: error instanceof Error ? error.message : messages.failure });
        } finally {
          if (timer !== undefined) clearTimeout(timer);
          parent.signal.removeEventListener('abort', cancel);
        }
        outstanding--;
        publish();
      }
    };
    // Fixed concurrency, with no automatic retry or whole-chain deadline.
    void Promise.all(Array.from({ length: Math.min(3, batches.length) }, worker));
    return () => { active = false; parent.abort(); };
  }, [scope, owner, loadBatch, idsKey, attempt, messages.timeout, messages.failure]);

  const visible = snapshot?.scope === scope && snapshot.owner === owner && snapshot.loader === loadBatch ? snapshot : undefined;
  const requestedSet = new Set(requested);
  const entries = visible?.entries.filter(entry => entry.ids.length > 0 && entry.ids.every(id => requestedSet.has(id))) ?? [];
  const completedIds = [...new Set(entries.filter(entry => !entry.error).flatMap(entry => entry.ids).filter(id => requestedSet.has(id)))];
  const failedIds = [...new Set(entries.filter(entry => entry.error).flatMap(entry => entry.ids).filter(id => requestedSet.has(id)))];
  const pendingCount = requested.length - completedIds.length - failedIds.length;
  const loading = requested.length > 0 && (!visible || visible.loading || visible.attempt !== attempt || pendingCount > 0);
  return {
    items: entries.filter(entry => !entry.error).flatMap(entry => entry.items),
    completedIds, failedIds, requestedCount: requested.length,
    loading, ready: !loading && failedIds.length === 0 && completedIds.length === requested.length,
    error: entries.find(entry => entry.error)?.error ?? '', retry,
  };
}
