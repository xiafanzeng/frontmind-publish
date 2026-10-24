// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublishingFlow } from './PublishingFlowContext';
import { useMediaSelectionTask } from './useMediaSelectionTask';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
const flow = (ensureTask: PublishingFlow['ensureTask'], taskId?: string) => ({ ensureTask, taskId } as PublishingFlow);
afterEach(cleanup);

describe('first media task assignment', () => {
  it('adopts only the task returned by ensureTask without invalidating the selection scope', async () => {
    const pending = deferred<string>(), context = {};
    const { result, rerender } = renderHook(({ value }) => useMediaSelectionTask(value, context), { initialProps: { value: flow(() => pending.promise) } });
    const key = result.current.scopeKey;
    const saving = result.current.ensureTask();
    rerender({ value: flow(() => pending.promise, 'created-task') });
    expect(result.current.scopeKey).toBe(key);
    await act(async () => { pending.resolve('created-task'); await expect(saving).resolves.toBe('created-task'); });
    rerender({ value: flow(vi.fn(async () => 'other-task'), 'other-task') });
    expect(result.current.scopeKey).not.toBe(key);
  });

  it('rejects a different assigned task instead of writing the original selection into it', async () => {
    const pending = deferred<string>(), context = {};
    const { result, rerender } = renderHook(({ value }) => useMediaSelectionTask(value, context), { initialProps: { value: flow(() => pending.promise) } });
    const key = result.current.scopeKey, saving = result.current.ensureTask();
    const rejected = expect(saving).rejects.toThrow('选媒任务已切换');
    rerender({ value: flow(() => pending.promise, 'unrelated-task') });
    await act(async () => { pending.resolve('created-task'); await rejected; });
    expect(result.current.scopeKey).not.toBe(key);
  });

  it('invalidates a pending creation when its workspace or frozen-version binding changes', async () => {
    const pending = deferred<string>();
    const { result, rerender } = renderHook(({ context }) => useMediaSelectionTask(flow(() => pending.promise), context), { initialProps: { context: {} } });
    const key = result.current.scopeKey, saving = result.current.ensureTask();
    const rejected = expect(saving).rejects.toThrow('选媒任务已切换');
    rerender({ context: {} });
    expect(result.current.scopeKey).not.toBe(key);
    await act(async () => { pending.resolve('created-task'); await rejected; });
  });
});
