import { PublisherGatewayError, type PublisherGateway } from '../module/client/gateway';
import type { ArticleDetail, MediaResource, PublicationDraft, MediaFacets } from '../module/client/types';
/** Synthetic local UI adapter. It never submits work or pretends a provider ran. */
export function createPreviewGateway():PublisherGateway {
  const now=()=>new Date().toISOString();
  const article:ArticleDetail={id:'preview-article',title:'本地预览：企业知识服务介绍',status:'draft',currentVersion:0,wordCount:18,imageCount:0,updatedAt:now(),revision:1,bodyText:'这是一份用于检查编辑、选媒和报价界面的合成稿件。',bodyHtml:'<p>这是一份用于检查编辑、选媒和报价界面的合成稿件。</p>',images:[],versions:[],importChecks:{docxSafe:true,externalLinkCount:0,structureValid:true}};
  const articles=new Map([[article.id,article]]),drafts=new Map<string,PublicationDraft>();
  const media:MediaResource[]=[{id:'preview-media',name:'预览科技资讯',shortName:'预览',kind:'news',platform:'合成媒体',taxonomy:'科技',mediaType:'行业资讯',channel:'科技',region:'全国',logoSource:'generated_fallback',logoResolutionStatus:'missing',titleLimit:60,priceTenThousandths:'500000',turnaround:'仅预览',capability:'text',active:true,catalogRevision:'preview-catalog'}];
  const wallet={availableTenThousandths:'10000000',reservedTenThousandths:'0',frozenTenThousandths:'0'};
  const catalog={activeRevision:'preview-catalog',mediaCount:media.length,newsCount:1,selfMediaCount:0,kindComplete:true,lastSyncedAt:now(),stale:false};
  const clone=<T,>(value:T):T=>structuredClone(value);
  const getArticle=(id:string)=>{const value=articles.get(id);if(!value)throw new PublisherGatewayError('预览稿件不存在','not_found');return value;};
  const getDraft=(id:string)=>{const value=drafts.get(id);if(!value)throw new PublisherGatewayError('预览投放草稿不存在','not_found');return value;};
  const unavailable=()=>{throw new PublisherGatewayError('本地预览不执行供应商调用，请在开发域名验收。','unavailable');};
  const facets:MediaFacets={kinds:{news:1,self_media:0},platforms:[],taxonomies:[],mediaTypes:[],areas:[],includeTypes:[],publishSpeeds:[],entryTypes:[],linkTypes:[],imageSupports:[],pcWeightThresholds:[],includeRateThresholds:[],successRateThresholds:[],recommendedOptions:[],authenticatedOptions:[],festivalPublishableOptions:[],catalog};
  return {
    async getDashboard(){return {wallet,catalog,articleCount:articles.size,actionableItemCount:0,resumableDraftCount:drafts.size,resumableDrafts:[...drafts.values()].map(d=>({id:d.id,articleTitle:d.articleTitle,articleVersion:d.articleVersion,status:'draft',updatedAt:d.updatedAt})),processingBatchCount:0,processingBatches:[],recentBatches:[],resumableArticles:clone([...articles.values()])};},
    async listArticles(){return clone([...articles.values()]);},
    async getArticle(id){return clone(getArticle(id));},
    async importDocx(file){const value={...clone(article),id:crypto.randomUUID(),title:`本地预览：${file.name}`,updatedAt:now()};articles.set(value.id,value);return {importId:`preview:${value.id}`,articleId:value.id};},
    async uploadArticleImage(){return unavailable();},
    async saveArticle(input){const value=getArticle(input.articleId);if(value.revision!==input.expectedRevision)throw new PublisherGatewayError('预览稿件版本冲突','conflict');Object.assign(value,{title:input.title,bodyText:input.bodyText,bodyHtml:input.bodyHtml,editorJson:input.editorJson,images:input.images,revision:value.revision+1,updatedAt:now(),wordCount:input.bodyText.length});return clone(value);},
    async freezeArticle(id,revision){const value=getArticle(id);if(value.revision!==revision)throw new PublisherGatewayError('预览稿件版本冲突','conflict');value.currentVersion++;value.currentVersionId=crypto.randomUUID();value.currentVersionHash='preview-version';value.versions.push({id:value.currentVersionId,version:value.currentVersion,hash:'preview-version',containsImages:false,frozen:true,createdAt:now(),createdBy:'本地预览'});value.status='frozen';value.revision++;return clone(value);},
    async getMediaFacets(){return clone(facets);},
    async listMedia(filters){const items=media.filter(m=>(!filters.query||m.name.includes(filters.query))&&(!filters.kind||m.kind===filters.kind));return {items:clone(items),total:items.length,page:filters.page,pageSize:filters.pageSize,catalog};},
    async createDraft(version,ids){const a=[...articles.values()].find(a=>a.currentVersionId===version);if(!a)throw new PublisherGatewayError('请先保存并冻结预览稿件','validation');const d:PublicationDraft={id:crypto.randomUUID(),articleId:a.id,articleVersionId:version,articleTitle:a.title,articleVersion:a.currentVersion,articleVersionHash:'preview-version',articleContainsImages:false,revision:1,titleMode:'per_media',items:media.filter(m=>ids.includes(m.id)).map(m=>({media:m,title:a.title})),updatedAt:now()};drafts.set(d.id,d);return clone(d);},
    async getDraft(id){return clone(getDraft(id));},
    async updateDraftMedia(id,ids,revision){const d=getDraft(id);if(d.revision!==revision)throw new PublisherGatewayError('预览投放版本冲突','conflict');d.items=media.filter(m=>ids.includes(m.id)).map(m=>({media:m,title:d.articleTitle}));d.revision++;return clone(d);},
    async refreshDraftMedia(id){return clone(getDraft(id));},
    async saveDraftTitles(id,input){const d=getDraft(id);const typed=input as {titles?:Record<string,string>;sharedTitle?:string;mode?:'single'|'per_media'};const titles=typed.titles??input as Record<string,string>;d.items=d.items.map(item=>({...item,title:typed.sharedTitle??titles[item.media.id]??item.title}));d.titleMode=typed.mode??'per_media';d.revision++;return clone(d);},
    async preflightDraft(id){const d=getDraft(id),a=getArticle(d.articleId);const total=d.items.reduce((sum,item)=>sum+BigInt(item.media.priceTenThousandths),0n).toString();return {revision:String(d.revision),draftRevision:d.revision,quoteFingerprint:'preview-only',mode:'test',expiresAt:new Date(Date.now()+60000).toISOString(),article:{id:a.id,title:a.title,version:a.currentVersion,versionId:d.articleVersionId,hash:'preview-version',wordCount:a.wordCount,imageCount:0,bodyHtml:a.bodyHtml??'',images:[]},catalogRevision:'preview-catalog',items:d.items.map(item=>({...item,priceTenThousandths:item.media.priceTenThousandths,checks:[],blockers:[],warnings:['合成报价，仅用于界面预览']})),totalTenThousandths:total,wallet,availableAfterTenThousandths:(BigInt(wallet.availableTenThousandths)-BigInt(total)).toString(),blockers:['本地预览不发稿、不扣费'],warnings:[],gates:[{label:'真实运行环境',passed:false}]};},
    async submitDraft(){return unavailable();},async listBatches(){return {items:[],total:0,page:1,pageSize:20};},async getBatch(){return unavailable();},batchCsvUrl(){return '#local-preview';}
  };
}
