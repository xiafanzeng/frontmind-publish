// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePartialBatchRead } from './usePartialBatchRead';

afterEach(() => { cleanup(); vi.useRealTimers(); });
const messages = { timeout: 'batch timeout', failure: 'batch failed' };

describe('bounded partial batch deadlines', () => {
  it('cannot resurrect a removed batch member when a later read proves it missing', async () => {
    let reads = 0;
    const load = vi.fn(async (ids: string[], _signal: AbortSignal) => {
      // B was present initially, then disappears from the real catalogue.
      reads++;
      return reads === 1 ? ids : ids.filter(id => id !== 'B');
    });
    const owner = {};
    const view = renderHook(({ ids }) => usePartialBatchRead(ids, 'same-catalogue', owner, load, messages), {
      initialProps: { ids: ['A', 'B'] },
    });
    await waitFor(() => expect(view.result.current.ready).toBe(true));
    expect(view.result.current.items).toEqual(['A', 'B']);
    view.rerender({ ids: ['A'] });
    await waitFor(() => expect(view.result.current.ready).toBe(true));
    expect(load.mock.calls[1]?.[0]).toEqual(['A']);
    expect(view.result.current.items).toEqual(['A']);
    view.rerender({ ids: ['A', 'B'] });
    await waitFor(() => expect(view.result.current.ready).toBe(true));
    expect(load.mock.calls[2]?.[0]).toEqual(['B']);
    expect(view.result.current.completedIds.sort()).toEqual(['A', 'B']);
    expect(view.result.current.items).toEqual(['A']);
    expect(view.result.current.failedIds).toEqual([]);
  });

  it('retains successes when an adapter ignores abort and times out without automatic retries', async () => {
    vi.useFakeTimers();
    const ids = Array.from({ length: 200 }, (_, index) => `id-${String(index).padStart(3, '0')}`);
    const signals: AbortSignal[] = [];
    let resolveLate!: (value: string[]) => void;
    const late = new Promise<string[]>(yes => { resolveLate = yes; });
    const load = vi.fn(async (batch: string[], signal: AbortSignal) => {
      signals.push(signal);
      return batch.includes('id-100') ? late : batch;
    });
    const owner = {};
    const view = renderHook(() => usePartialBatchRead(ids, 'scope-1', owner, load, messages));
    await act(async () => {});
    expect(view.result.current.completedIds).toHaveLength(100);
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(view.result.current).toMatchObject({ ready: false, loading: false, error: 'batch timeout' });
    expect(view.result.current.completedIds).toHaveLength(100);
    expect(view.result.current.failedIds).toHaveLength(100);
    expect(signals[1]!.aborted).toBe(true);
    await act(async () => resolveLate(['late-result']));
    expect(view.result.current.items).not.toContain('late-result');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('cleans up active batch deadlines immediately when leaving a scope', async () => {
    vi.useFakeTimers();
    const load = vi.fn((_ids: string[], _signal: AbortSignal) => new Promise<string[]>(() => {}));
    const owner = {};
    const view = renderHook(() => usePartialBatchRead(['id-a'], 'scope-1', owner, load, messages));
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => view.unmount());
    // Cancellation rejects the deadline promise; its finally clears the timer.
    expect(vi.getTimerCount()).toBe(0);
  });
});
