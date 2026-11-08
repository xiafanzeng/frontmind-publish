// @vitest-environment jsdom
// Source-only lifecycle regressions; not executed in the Pro workspace.
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useMatrixFormScope } from './useMatrixFormScope';
import { useMatrixFormDraft, type MatrixFormDraft } from './useMatrixFormDraft';

const defaults:MatrixFormDraft={product:'',industry:'',audience:'',questions:'',regions:'',hours:'',assetKind:'',samplePlatform:'',brandData:'',currency:'CNY',total:'',exploration:'',enabled:false,min:'',max:''};
const response=(scopeKey:string)=>({ok:true,json:async()=>({scopeKey})});
afterEach(()=>{cleanup();sessionStorage.clear();vi.unstubAllGlobals();});

it('does not expose an old account scope while a different gateway is loading or after failure',async()=>{
  const oldOwner={},newOwner={};let complete!:(value:unknown)=>void;
  const pending=new Promise(resolve=>{complete=resolve;});
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(response('a'.repeat(64))).mockReturnValueOnce(pending));
  const hook=renderHook(({owner})=>useMatrixFormScope(owner,1,true),{initialProps:{owner:oldOwner}});
  await waitFor(()=>expect(hook.result.current.scopeKey).toBe('a'.repeat(64)));
  hook.rerender({owner:newOwner});expect(hook.result.current.scopeKey).toBeUndefined();
  await act(async()=>complete({ok:false,json:async()=>({message:'unauthorized'})}));
  await waitFor(()=>expect(hook.result.current.error).toBeTruthy());expect(hook.result.current.scopeKey).toBeUndefined();
});

it('ignores an old delayed scope response and retries only the current workspace',async()=>{
  const owner={};let complete!:(value:unknown)=>void;
  const pending=new Promise(resolve=>{complete=resolve;});
  const fetcher=vi.fn().mockReturnValueOnce(pending).mockResolvedValueOnce({ok:false,json:async()=>({message:'temporarily unavailable'})}).mockResolvedValueOnce(response('c'.repeat(64)));
  vi.stubGlobal('fetch',fetcher);
  const hook=renderHook(({workspace})=>useMatrixFormScope(owner,workspace,true),{initialProps:{workspace:1}});
  hook.rerender({workspace:2});await waitFor(()=>expect(hook.result.current.error).toBeTruthy());
  await act(async()=>complete(response('a'.repeat(64))));expect(hook.result.current.scopeKey).toBeUndefined();
  act(()=>hook.result.current.retry());await waitFor(()=>expect(hook.result.current.scopeKey).toBe('c'.repeat(64)));
});

it('saves pending research choices after authorization and restores them only for that authenticated scope',async()=>{
  let complete!:(value:unknown)=>void;const pending=new Promise(resolve=>{complete=resolve;});
  const fetcher=vi.fn().mockReturnValueOnce(pending).mockResolvedValueOnce(response('a'.repeat(64))).mockResolvedValueOnce(response('b'.repeat(64)));
  vi.stubGlobal('fetch',fetcher);
  const useForm=(owner:object)=>{
    const authorized=useMatrixFormScope(owner,1,true);
    const key=authorized.scopeKey?JSON.stringify([authorized.scopeKey,'research',1,'new']):'pending';
    const form=useMatrixFormDraft(owner,key,defaults,authorized.scopeKey?key:undefined,'pending');
    return {...form,authenticatedScope:authorized.scopeKey};
  };
  const firstOwner={},first=renderHook(()=>useForm(firstOwner));
  act(()=>{first.result.current.setRegions('',false);first.result.current.setField('targetPlatform','Kimi');first.result.current.setField('hours','48');});
  expect(sessionStorage.length).toBe(0);
  await act(async()=>complete(response('a'.repeat(64))));
  await waitFor(()=>expect(first.result.current.persisted).toBe(true));first.unmount();
  const sameOwner={},restored=renderHook(()=>useForm(sameOwner));
  await waitFor(()=>expect(restored.result.current.values.targetPlatform).toBe('Kimi'));
  expect(restored.result.current.values).toMatchObject({regions:'',regionsUnrestricted:false,hours:'48'});restored.unmount();
  const otherOwner={},other=renderHook(()=>useForm(otherOwner));
  await waitFor(()=>expect(other.result.current.authenticatedScope).toBe('b'.repeat(64)));
  expect(other.result.current.values).toMatchObject({regions:'',regionsUnrestricted:true,targetPlatform:'',hours:''});
});

it('reauthenticates every enabled cycle before exposing a previous scope',async()=>{
 const owner={};let complete!:(value:unknown)=>void;const pending=new Promise(resolve=>{complete=resolve;});
 vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(response('a'.repeat(64))).mockReturnValueOnce(pending));
 const hook=renderHook(({enabled})=>useMatrixFormScope(owner,1,enabled),{initialProps:{enabled:true}});
 await waitFor(()=>expect(hook.result.current.scopeKey).toBe('a'.repeat(64)));
 hook.rerender({enabled:false});expect(hook.result.current.scopeKey).toBeUndefined();
 hook.rerender({enabled:true});expect(hook.result.current.scopeKey).toBeUndefined();
 await act(async()=>complete(response('b'.repeat(64))));
 await waitFor(()=>expect(hook.result.current.scopeKey).toBe('b'.repeat(64)));
});
