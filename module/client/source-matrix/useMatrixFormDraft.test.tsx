// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMatrixFormDraft, type MatrixFormDraft } from './useMatrixFormDraft';

const empty: MatrixFormDraft = { product: '', industry: '', audience: '', questions: '', regions: '', hours: '', assetKind: '', samplePlatform: '', brandData: '', currency: 'CNY', total: '', exploration: '', enabled: false, min: '', max: '' };
beforeEach(() => { sessionStorage.clear(); vi.restoreAllMocks(); });
describe('matrix ancillary form ownership', () => {
  it('restores a verified article draft after remount and never carries it into another article', () => {
    const owner = {};
    const first = renderHook(({ scope }) => useMatrixFormDraft(owner, scope, empty, scope), { initialProps: { scope: 'actor:A:v1:task1' } });
    act(() => first.result.current.setField('regions', '香港'));
    first.rerender({ scope: 'actor:B:v1:task1' });
    expect(first.result.current.values.regions).toBe('');
    first.unmount();
    const restored = renderHook(() => useMatrixFormDraft({}, 'actor:A:v1:task1', empty, 'actor:A:v1:task1'));
    expect(restored.result.current.values.regions).toBe('香港');
  });
  it('keeps a deliberate empty edit and adopts a new task without restoring saved defaults over it', () => {
    const owner = {};
    const hook = renderHook(({ scope }) => useMatrixFormDraft(owner, scope, { ...empty, regions: '全国' }, scope), { initialProps: { scope: 'new' } });
    act(() => { hook.result.current.setField('regions', ''); hook.result.current.adoptScope('created', 'created'); });
    hook.rerender({ scope: 'created' });
    act(() => hook.result.current.hydrate({ regions: '全国' }));
    expect(hook.result.current.values.regions).toBe('');
    expect(hook.result.current.hasEdits).toBe(true);
  });
  it('keeps pending typed choices when server authorization supplies the final scope', () => {
    const owner = {};
    const hook = renderHook(({ verified }) => useMatrixFormDraft(owner, verified ? 'verified' : 'pending', empty, verified ? 'verified' : undefined, 'pending'), { initialProps: { verified: false } });
    act(() => hook.result.current.setField('hours', '48'));
    expect(sessionStorage.length).toBe(0);
    hook.rerender({ verified: true });
    expect(hook.result.current.values.hours).toBe('48');
  });
  it('reports failed storage honestly so the page keeps its unsaved-navigation guard', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('disabled'); });
    const owner = {};
    const hook = renderHook(() => useMatrixFormDraft(owner, 'actor:A', empty, 'actor:A'));
    act(() => hook.result.current.setField('total', '100'));
    expect(hook.result.current.values.total).toBe('100');
    expect(hook.result.current.hasEdits).toBe(true);
    expect(hook.result.current.persisted).toBe(false);
  });
  it('hydrates untouched saved choices even if the user has already cleared one field', () => {
    const owner = {};
    const hook = renderHook(() => useMatrixFormDraft(owner, 'pending-task', empty));
    act(() => hook.result.current.setField('regions', ''));
    act(() => hook.result.current.hydrate({ regions: '全国', hours: '24', total: '500' }));
    expect(hook.result.current.values.regions).toBe('');
    expect(hook.result.current.values.hours).toBe('24');
    expect(hook.result.current.values.total).toBe('500');
  });
  it('preserves edits during context revalidation when returning to an existing verified entry', () => {
    const owner = {};
    const hook = renderHook(({ verified }) => useMatrixFormDraft(owner, verified ? 'verified' : 'pending', empty, verified ? 'verified' : undefined, 'pending'), { initialProps: { verified: true } });
    act(() => hook.result.current.setField('total', '500'));
    hook.rerender({ verified: false });
    act(() => hook.result.current.setField('regions', '香港'));
    hook.rerender({ verified: true });
    expect(hook.result.current.values.regions).toBe('香港');
    expect(hook.result.current.values.total).toBe('500');
  });
});
