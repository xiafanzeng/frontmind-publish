import { expect,it } from 'vitest';
import { bindingFingerprint,bindingManuscripts,bindingSelectedItems,resolvePlanItems,type BindingMediaResource,type ExistingDraftItem,type TrustedArticleBinding } from './binding.js';

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

it('merges applicable plan items and reports every skip honestly',()=>{
 const plan={items:[
  {article_id:'article-1',version:'v2',resource_id:'media-2',offer_id:'offer-2',publication_spec:{channel:'news'},quantity:1,purpose:'standard'},
  {article_id:'article-1',version:'v2',resource_id:'media-1',offer_id:'offer-1',publication_spec:null,quantity:1,purpose:'standard'},
  {article_id:'article-other',version:'v2',resource_id:'media-3',offer_id:'offer-3',publication_spec:null,quantity:1,purpose:'standard'},
  {article_id:'article-1',version:'v9',resource_id:'media-4',offer_id:'offer-4',publication_spec:null,quantity:1,purpose:'standard'},
  {article_id:'article-1',version:'v2',resource_id:'media-5',offer_id:'offer-5',publication_spec:null,quantity:3,purpose:'standard'},
  {article_id:'article-1',version:'v2',resource_id:'media-6',offer_id:'offer-6',publication_spec:null,quantity:1,purpose:'standard'},
  {article_id:'article-1',version:'v2',resource_id:'media-7',offer_id:'offer-7',publication_spec:null,quantity:1,purpose:'standard'},
 ],details:[{reason:'命中目标问题'}]};
 const resources=new Map([['media-2',resource('media-2')],['media-1',resource('media-1')],['media-6',resource('media-6','0')],['media-7',resource('media-7','1000000',{imageSupport:'unsupported'})]]);
 const diff=resolvePlanItems(plan,binding,[existing('media-1')],resources,(r)=>r.imageSupport==='unsupported'?'媒体明确不支持图片':pass());
 expect(diff.additions).toHaveLength(1);
 expect(diff.additions[0]).toMatchObject({mediaResourceId:'media-2',offerId:'offer-2',publicationSpec:{channel:'news'},purpose:'standard',reason:'命中目标问题'});
 expect(diff.alreadySelected).toEqual([{mediaResourceId:'media-1',name:'媒体 media-1',reason:'已在购物车，保留原选择与报价身份'}]);
 expect(diff.skipped.map(entry=>entry.reason)).toEqual([
  '组合发布项与当前绑定稿件或版本不一致','组合发布项与当前绑定稿件或版本不一致',
  '发布数量 3 暂不支持一键加入，请单独处理','媒体当前无有效报价，需先询价','媒体明确不支持图片',
 ]);
 expect(diff.mergedCount).toBe(2);
 expect(diff.knownTotalTenThousandths).toBe('2000000');
 expect(diff.pendingPriced).toBe(0);
 expect(diff.overLimit).toBe(false);
});

it('keeps known totals honest with unpriced entries and flags the twenty-media cap',()=>{
 const items=Array.from({length:21},(_,index)=>({article_id:'article-1',version:'v2',resource_id:'media-'+index,offer_id:null,publication_spec:null,quantity:1,purpose:'standard'}));
 const resources=new Map(items.map((_,index)=>['media-'+index,resource('media-'+index,index===0?'0':'100')]));
 const diff=resolvePlanItems({items},binding,[existing('media-x','0')],resources,pass);
 expect(diff.overLimit).toBe(true);
 expect(diff.mergedCount).toBe(21);
 expect(diff.pendingPriced).toBe(1);
 expect(diff.knownTotalTenThousandths).toBe((20*100).toString());
});

it('resolves plan items that carry the external resource id instead of the internal id',()=>{
 const plan={items:[{article_id:'article-1',version:'v2',resource_id:'ext-9',offer_id:'offer-9',publication_spec:null,quantity:1,purpose:'standard'}]};
 const diff=resolvePlanItems(plan,binding,[],new Map([['media-9',resource('media-9','1000000',{externalResourceId:'ext-9'})]]),pass);
 expect(diff.additions).toHaveLength(1);
 expect(diff.additions[0]!.mediaResourceId).toBe('media-9');
});
