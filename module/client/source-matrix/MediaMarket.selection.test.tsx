// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaRules } from '../../server/providers/kol/media-rules';
import type { MediaResource } from '../types';
import { MarketRow, useMarketRules } from './MediaMarket';
import { mediaSelectionBlocker } from '../mediaShortlist';

const workspace = vi.hoisted(() => ({ value: 1 }));
vi.mock('../host', () => ({
  usePublishingWorkspaceKey: () => workspace.value,
  projectWorkspaceUrl: (path: string) => path,
}));

const media: MediaResource = {
  id: 'media-1', name: '测试媒体', shortName: '测试', kind: 'news', platform: '平台',
  taxonomy: '', mediaType: '', channel: '', region: '', titleLimit: 200,
  priceTenThousandths: '10000', turnaround: '', active: true, capability: 'image_pending',
  catalogRevision: 'revision-1', logoSource: 'generated_fallback', logoResolutionStatus: 'pending',
};
const rules: MediaRules = {
  version: 1, rawRemark: '供应商原始要求', collectedAt: '2026-10-23T00:00:00Z',
  source: '/api/news_resource_2/data', unresolved: [],
  rules: [
    { field: 'title_chars', state: 'unknown', evidence: [] },
    { field: 'body_chars', state: 'unknown', evidence: [] },
    { field: 'images', state: 'unknown', evidence: [] },
    { field: 'links', state: 'unknown', evidence: [] },
  ],
};
const response = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response;
const rulesResponse = (remark = rules.rawRemark) => response({
  items: [{ id: media.id, rules: { ...rules, rawRemark: remark } }],
});
function deferredResponse() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>(yes => { resolve = yes; });
  return { promise, resolve };
}
function harness() {
  const renders: ReturnType<typeof useMarketRules>[] = [];
  function Probe() {
    const state = useMarketRules([media.id], 'revision-1');
    renders.push(state);
    return <div>{state.rules[media.id]?.rawRemark ?? state.error}</div>;
  }
  const view = render(<Probe />);
  return { ...view, renders, current: () => renders.at(-1)!, switchWorkspace: () => {
    workspace.value += 1;
    renders.length = 0;
    view.rerender(<Probe />);
  } };
}

beforeEach(() => { workspace.value = 1; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('media selection controls', () => {
  it('lets the real checkbox select unspecified image requirements without a blocking warning', () => {
    const onToggle = vi.fn();
    const blocker = mediaSelectionBlocker(media, true);
    render(<MarketRow media={media} rules={rules} disabled={Boolean(blocker)} selectionDisabledReason={blocker} onToggle={onToggle} />);
    const checkbox = screen.getByRole('checkbox', { name: '选择 测试媒体 平台' }) as HTMLInputElement;
    expect(checkbox.disabled).toBe(false);
    expect(checkbox.getAttribute('aria-describedby')).toBeNull();
    expect(screen.queryByText('当前稿件含图片，此媒体的图文能力尚未确认')).toBeNull();
    expect(screen.getAllByText('未注明').length).toBeGreaterThan(0);
    fireEvent.click(checkbox);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(media.capability).toBe('image_pending');
  });
  it('explains a legitimate selection restriction without enabling the checkbox', () => {
    const onToggle = vi.fn();
    const textOnly = { ...media, capability: 'text' as const };
    const reason = mediaSelectionBlocker(textOnly, true);
    render(<MarketRow media={textOnly} disabled selectionDisabledReason={reason} onToggle={onToggle} />);
    const checkbox = screen.getByRole('checkbox', { name: '选择 测试媒体 平台', description: reason }) as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);
    expect(screen.getByText(reason)).toBeTruthy();
    checkbox.click();
    expect(onToggle).not.toHaveBeenCalled();
  });
});

describe('media rules recovery', () => {
  it('retries failed rules for the same media ids and catalog revision', async () => {
    let unavailable = true;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/status')
      ? response({ configured: true })
      : unavailable ? response({ message: '规则暂不可用' }, false) : rulesResponse()));
    const view = harness();
    await waitFor(() => expect(view.current().error).toBe('规则暂不可用'));
    expect(view.current().ready).toBe(false);
    unavailable = false;
    await act(async () => view.current().reload());
    await waitFor(() => expect(view.current().ready).toBe(true));
    expect(view.current().rules[media.id]?.rawRemark).toBe('供应商原始要求');
    expect(view.current().error).toBe('');
  });

  it('masks the previous workspace rules on the first render of a new workspace', async () => {
    const next = deferredResponse();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/status')
      ? response({ configured: true })
      : workspace.value === 1 ? rulesResponse('旧工作区规则') : next.promise));
    const view = harness();
    await waitFor(() => expect(view.current().ready).toBe(true));
    view.switchWorkspace();
    expect(view.renders.every(state => Object.keys(state.rules).length === 0 && !state.ready)).toBe(true);
    expect(view.renders[0].loading).toBe(true);
    await act(async () => next.resolve(rulesResponse('新工作区规则')));
    expect(view.current().rules[media.id]?.rawRemark).toBe('新工作区规则');
  });

  it('aborts an old workspace request and ignores a late response even if fetch disregards abort', async () => {
    const previous = deferredResponse(), next = deferredResponse();
    const previousRequest: { signal?: AbortSignal | null } = {};
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/status')) return response({ configured: true });
      if (workspace.value === 1) { previousRequest.signal = init?.signal; return previous.promise; }
      return next.promise;
    }));
    const view = harness();
    await act(async () => {});
    view.switchWorkspace();
    expect(previousRequest.signal?.aborted).toBe(true);
    await act(async () => previous.resolve(rulesResponse('过期规则')));
    expect(view.current().ready).toBe(false);
    expect(view.current().rules).toEqual({});
    await act(async () => next.resolve(rulesResponse('当前工作区规则')));
    expect(view.current().rules[media.id]?.rawRemark).toBe('当前工作区规则');
  });

  it('ends stalled loading after 20 seconds, ignores its late rules and permits a retry', async () => {
    vi.useFakeTimers();
    const pending = deferredResponse();
    let stalled = true;
    const pendingRequest: { signal?: AbortSignal | null } = {};
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/status')) return response({ configured: true });
      if (stalled) { pendingRequest.signal = init?.signal; return pending.promise; }
      return rulesResponse('重试规则');
    }));
    const view = harness();
    await act(async () => {});
    await act(async () => vi.advanceTimersByTime(20_000));
    expect(pendingRequest.signal?.aborted).toBe(true);
    expect(view.current()).toMatchObject({ ready: false, loading: false });
    expect(view.current().error).toContain('超时');
    await act(async () => pending.resolve(rulesResponse('超时后的规则')));
    expect(view.current().rules).toEqual({});
    stalled = false;
    await act(async () => view.current().reload());
    expect(view.current()).toMatchObject({ ready: true, loading: false, error: '' });
    expect(view.current().rules[media.id]?.rawRemark).toBe('重试规则');
    expect(vi.getTimerCount()).toBe(0);
  });
});
