import { expect,it,vi } from 'vitest';
import { BindingStore,bindingFingerprint,bindingManuscripts,bindingSelectedItems,resolvePlanItems,publicationSnapshot,type BindingMediaResource,type ExistingDraftItem,type TrustedArticleBinding } from './binding.js';

it.each([
 {state:'running',latest:{status:'complete',plan_id:'plan-1',plan_version:'plan-v1'}},
 {state:'cancelled',latest:{status:'complete',plan_id:'plan-1',plan_version:'plan-v1'}},
 {state:'complete',latest:{status:'invalid_decisions',plan_id:'plan-1',plan_version:'plan-v1'}},
 {state:'complete',latest:{status:'complete',plan_id:'plan-1',plan_version:'plan-v2'}},
])('rejects a plan changed before the locked cart transaction: %j',async task=>{
 const execute=vi.fn().mockResolvedValue([[task],[]]);
 const db={transaction:async (fn:(tx:{execute:typeof execute})=>Promise<unknown>)=>fn({execute})};
 const store=new BindingStore(db as unknown as ConstructorParameters<typeof BindingStore>[0],{ownerId:'owner-1',enterpriseProjectId:'project-1'});
 const result=await store.insertPlanItems({tenantId:'trusted-tenant',draftId:'draft-1',expectedRevision:3,additions:[],mediaSnapshotFor:()=>({}),planIdentity:{taskId:'task-1',planId:'plan-1',planVersion:'plan-v1',planIndex:0}});
 expect(result).toEqual({ok:false,reason:'plan_changed'});
 expect(execute).toHaveBeenCalledTimes(1); // No draft/cart write follows a stale task revision.
});

const binding:TrustedArticleBinding={
 draftId:'draft-1',draftRevision:3,draftStatus:'draft',articleVersionId:'version-1',articleId:'article-1',
 versionNumber:2,contentHash:'hash-1',containsImages:false,articleTitle:'验收稿件',selections:[
  {mediaResourceId:'media-1',externalResourceId:'ext-1',selectedPriceTenThousandths:'1000000',selectedCatalogRevision:'cat-1'}],fingerprint:'fp',
};
const resource=(key:string,price='1000000',over:Partial<BindingMediaResource>={}):BindingMediaResource=>({id:key,name:'媒体 '+key,externalResourceId:'ext-'+key,mediaKind:'news',priceTenThousandths:price,catalogRevision:'cat-1',remark:null,titleLimit:null,rawPayload:{},imageSupport:'unknown',...over});
const existing=(id:string,price='1000000'):ExistingDraftItem=>({mediaResourceId:id,externalResourceId:'ext-'+id,submissionTitle:'标题',selectedPriceTenThousandths:price,selectedCatalogRevision:'cat-1',mediaKindSnapshot:'news',mediaSnapshot:{}});
const pass=()=>null;

it('records the frozen version identity in manuscripts and keeps draft selections as unlocked preferences',()=>{
 expect(bindingManuscripts(binding)).toEqual([{article_id:'article-1',version:'v2',title:'验收稿件',content_hash:'hash-1',contains_images:false,source:'trusted_article_version'}]);
 expect(bindingSelectedItems(binding)).toEqual([{article_id:'article-1',version:'v2',resource_id:'media-1',offer_id:null,publication_spec:null,quantity:1,locked:false}]);
});

it('changes the fingerprint when the version content, draft or cart changes',()=>{
 const base=bindingFingerprint(binding);
 expect(bindingFingerprint({...binding,contentHash:'hash-2'})).not.toBe(base);
 expect(bindingFingerprint({...binding,draftRevision:4})).not.toBe(base);
 expect(bindingFingerprint({...binding,selections:[...binding.selections,{mediaResourceId:'media-9',externalResourceId:'ext-9',selectedPriceTenThousandths:'1',selectedCatalogRevision:'cat-1'}]})).not.toBe(base);
 expect(bindingFingerprint({...binding,draftId:null,draftRevision:null})).not.toBe(base);
 expect(bindingFingerprint(binding)).toBe(base);
});

const asOf='2026-10-26T12:00:00+08:00';
const quoted=(id:string):BindingMediaResource=>resource(id,'1000000',{rawPayload:{publisher_quote_v1:{offer_id:'offer-'+id,publication_spec:'text',provider_resource_id:'ext-'+id,provider_execution:'independent_unit_orders',repeat_allowed:true,pricing:{kind:'unit',amount:'100.00',currency:'CNY',quoted_at:'2026-10-01T00:00:00+08:00',valid_until:'2026-11-01T00:00:00+08:00',mandatory_fees:[{amount:'5.00',basis:'item'}]}}}});
const item=(quantity=1)=>({article_id:'article-1',version:'v2',resource_id:'media-2',offer_id:'offer-media-2',publication_spec:'text',quantity,purpose:'standard'});
const options={publicationIntent:'repeat_existing_article',asOf,taskId:'task-1'};
it('uses the same effective title limit as the ordinary draft/preflight snapshot',()=>{
 const current=quoted('media-2');
 const addition=resolvePlanItems({items:[item()]},binding,[],new Map([[current.id,current]]),pass,options).additions[0]!;
 const snapshot=publicationSnapshot(current,addition,{taskId:'task-1',planId:'plan-1',planVersion:'plan-v1',planIndex:0});
 expect(current.titleLimit).toBeNull();expect(snapshot.titleLimit).toBe(200);
});
it('retains explicit repeat quantity, exact full price and identity',()=>{
 const diff=resolvePlanItems({items:[item(3)]},binding,[],new Map([['media-2',quoted('media-2')]]),pass,options);
 expect(diff.skipped).toEqual([]);
 expect(diff.additions[0]).toMatchObject({quantity:3,quantityMeaning:'repeat_same_article',articleVersionId:'version-1',offerId:'offer-media-2',priceTenThousandths:'1000000',totalPriceTenThousandths:'3050000'});
 expect(diff.knownTotalTenThousandths).toBe('3050000');
});
it('does not reinterpret new article count as repeating one frozen article',()=>{
 const diff=resolvePlanItems({items:[item(3)]},binding,[],new Map([['media-2',quoted('media-2')]]),pass,{asOf});
 expect(diff.additions).toEqual([]);expect(diff.skipped[0]?.reason).toContain('逐篇绑定');
});
it('rejects price-only legacy data, external identity guesses, wrong versions and duplicate specs',()=>{
 const map=new Map([['media-2',quoted('media-2')]]);
 expect(resolvePlanItems({items:[item()]},binding,[],new Map([['media-2',resource('media-2')]]),pass,options).additions).toEqual([]);
 expect(resolvePlanItems({items:[{...item(),resource_id:'ext-media-2'}]},binding,[],map,pass,options).additions).toEqual([]);
 expect(resolvePlanItems({items:[{...item(),version:'v3'}]},binding,[],map,pass,options).additions).toEqual([]);
 expect(resolvePlanItems({items:[item(),{...item(),publication_spec:'image'}]},binding,[],map,pass,options).skipped).toHaveLength(1);
});
it('idempotently keeps identical items and revises quantity only for this unlocked origin',()=>{
 const map=new Map([['media-2',quoted('media-2')]]);
 const first=resolvePlanItems({items:[item(3)]},binding,[],map,pass,options).additions[0]!;
 const snapshot=publicationSnapshot(quoted('media-2'),first,{taskId:'task-1',planId:'plan-1',planVersion:'plan-v1',planIndex:0});
 const previous={...existing('media-2'),mediaSnapshot:snapshot};
 expect(resolvePlanItems({items:[item(3)]},binding,[previous],map,pass,options).additions).toEqual([]);
 const changed=resolvePlanItems({items:[item(2)]},binding,[previous],map,pass,options);
 expect(changed.additions[0]).toMatchObject({quantity:2,replaceExisting:true});expect(changed.mergedCount).toBe(1);
 expect(changed.knownTotalTenThousandths).toBe('2050000');
 expect(resolvePlanItems({items:[item(2)]},binding,[{...previous,mediaSnapshot:{...snapshot,publication:{...(snapshot.publication as Record<string,unknown>),locked:true}}}],map,pass,options).additions).toEqual([]);
 expect(resolvePlanItems({items:[item(2)]},binding,[existing('media-2')],map,pass,options).skipped[0]?.reason).toContain('手动项');
});
