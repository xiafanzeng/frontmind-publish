// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseMediaRules } from '../server/providers/kol/media-rules';
import { titleRequirementDisplay } from './titleRequirements';
import { useMarketRules } from './useMediaRules';

vi.mock('./host', () => ({ usePublishingWorkspaceKey: () => 'workspace-1' }));

const mediaId = 'media-1';
const rules = parseMediaRules('标题不超过30字', '2026-10-27T00:00:00Z');
const response = (items = [{ id: mediaId, rules }]) => ({ ok: true, json: async () => ({ items }) }) as Response;
function deferredResponse() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>(yes => { resolve = yes; });
  return { promise, resolve };
}
function harness() {
  let owner: object = {};
  let revision = 'draft-1:catalogue-1';
  const renders: ReturnType<typeof useMarketRules>[] = [];
  function Probe() {
    renders.push(useMarketRules([mediaId], revision, owner));
    return null;
  }
  const view = render(<Probe />);
  return {
    renders,
    current: () => renders.at(-1)!,
    changeOwner: () => { owner = {}; renders.length = 0; view.rerender(<Probe />); },
    changeRevision: () => { revision = 'draft-2:catalogue-2'; renders.length = 0; view.rerender(<Probe />); },
  };
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('shared media rule read scope', () => {
  it('masks an old owner immediately and ignores its late response after another owner change', async () => {
    const second = deferredResponse();
    const third = deferredResponse();
    const fetcher = vi.fn().mockResolvedValueOnce(response()).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise);
    vi.stubGlobal('fetch', fetcher);
    const view = harness();
    await waitFor(() => expect(view.current().ready).toBe(true));
    view.changeOwner();
    expect(view.renders[0]).toMatchObject({ ready: false, loading: true, rules: {} });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    const secondSignal = fetcher.mock.calls[1]![1]!.signal as AbortSignal;
    view.changeOwner();
    expect(secondSignal.aborted).toBe(true);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    await act(async () => { third.resolve(response([])); });
    await waitFor(() => expect(view.current().ready).toBe(true));
    await act(async () => { second.resolve(response()); });
    expect(view.current().rules).toEqual({});
  });

  it('masks a previous draft/catalogue scope before loading its replacement', async () => {
    const next = deferredResponse();
    const fetcher = vi.fn().mockResolvedValueOnce(response()).mockReturnValueOnce(next.promise);
    vi.stubGlobal('fetch', fetcher);
    const view = harness();
    await waitFor(() => expect(view.current().ready).toBe(true));
    view.changeRevision();
    expect(view.renders[0]).toMatchObject({ ready: false, loading: true, rules: {} });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await act(async () => { next.resolve(response()); });
    await waitFor(() => expect(view.current().ready).toBe(true));
  });

  it('does not synthesize unknown rules for missing requested media', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([])));
    const view = harness();
    await waitFor(() => expect(view.current().ready).toBe(true));
    expect(view.current().rules[mediaId]).toBeUndefined();
    expect(titleRequirementDisplay(view.current().rules[mediaId]).state).toBe('unavailable');
  });
});
