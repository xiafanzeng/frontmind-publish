import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { createCatalogReservoir } from './source-matrix/candidate-ranking.js';

type Row = Record<string, unknown>;
export interface PublisherCatalogResource {
  id: string; name: string; externalResourceId: string; priceTenThousandths: string | bigint;
  catalogRevision: string | null; rawPayload: Row | null;
  mediaKind?: string | null; platform?: string | null; description?: string | null; mediaType?: string | null;
  imageSupport?: 'unknown'|'verified'|'unsupported'; area?: string|null; taxonomy?: string|null;
}
const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const canonical = (v: unknown): string => v === null || typeof v !== 'object' ? JSON.stringify(v) ?? 'null' : Array.isArray(v) ? '['+v.map(canonical).join(',')+']' : '{'+Object.entries(v as Row).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>JSON.stringify(k)+':'+canonical(x)).join(',')+'}';
const hash = (v: unknown) => createHash('sha256').update(canonical(v)).digest('hex');
/** Exact currency representation: a four-decimal legacy price is not rounded into a quote. */
export function plannerAmount(value: string | bigint): string | null {
  const text=String(value); if(!/^\d+$/.test(text)) return null;
  const n=BigInt(text); if(n%100n!==0n) return null;
  return `${n/10000n}.${String(n%10000n/100n).padStart(2,'0')}`;
}
const amount = (value: unknown): bigint | null => {
  const s=typeof value==='number'&&Number.isSafeInteger(value)?String(value):value;
  if(typeof s!=='string'||!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole,fraction='']=s.split('.'); return BigInt(whole!)*10000n+BigInt(fraction.padEnd(4,'0'));
};
const timestamp = (v: unknown): number | null => typeof v==='string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v)) ? Date.parse(v) : null;

/** Only explicit provider/imported terms are promoted; a catalogue price proves neither zero fees nor a validity period. */
export function publisherPlannerCatalogRows(resource: PublisherCatalogResource, includePlannerContext = false): Row[] {
  const raw=object(resource.rawPayload);
  const all=Array.isArray(raw.publisher_offers_v1)?raw.publisher_offers_v1:raw.publisher_quote_v1?[raw.publisher_quote_v1]:[];
  // This adapter serves the shared catalogue only. Private/account pricing needs an explicitly scoped adapter.
  const supplied=all.filter(v=>{const o=object(v);return !['owner_id','ownerId','user_id','tenant_id','project_id','enterprise_project_id'].some(k=>o[k]!=null)&&!['private','account','tenant'].includes(String(o.visibility));});
  const attributes:Row={};
  for(const key of ['industry','industries','regions','region_coverage','restricted_regions','supported_formats',...(includePlannerContext?['allowed_industries','prohibited_industries','authority_type','authority_evidence']:[])]){
    const v=raw[key];if(typeof v==='string'||Array.isArray(v)&&v.every(x=>typeof x==='string'))attributes[key]=v;
  }
  for(const key of ['supports_links','supports_images','supports_video','supports_tables'])if(typeof raw[key]==='boolean')attributes[key]=raw[key];
  if(includePlannerContext&&typeof raw.authority_verified==='boolean')attributes.authority_verified=raw.authority_verified;
  if(includePlannerContext&&Array.isArray(raw.hard_conditions))attributes.hard_conditions=raw.hard_conditions;
  if(includePlannerContext&&typeof raw.authenticationDescription==='string')attributes.authentication_description=raw.authenticationDescription;
  if(resource.imageSupport==='verified')attributes.supports_images=true;
  if(resource.imageSupport==='unsupported')attributes.supports_images=false;
  const semantic={resource_id:resource.id,name:resource.name,source_name:resource.name,publication_status:'available',external_resource_id:resource.externalResourceId,
    media_kind:resource.mediaKind??null,platform:resource.platform??null,media_intro:resource.description??null,
    ...(includePlannerContext?{taxonomy:resource.taxonomy??null,area:resource.area??null,media_type:resource.mediaType??null}:{}),...attributes,
    ...(includePlannerContext&&attributes.regions==null&&attributes.region_coverage==null&&resource.area?{region_coverage:resource.area.split(/[、,，;；\n|/]+/u).map(value=>value.trim()).filter(Boolean)}:{}),
    ...(typeof raw.account_id==='string'?{account_id:raw.account_id}:{}),
    ...(typeof raw.domain==='string'?{domain:raw.domain}:{}),
    ...(raw.mapping_scope==='shared_catalog'&&Array.isArray(raw.source_mappings)?{source_mappings:raw.source_mappings}:{}),
    source:'publisher_media_resources',catalog_revision:resource.catalogRevision};
  if(!supplied.length) return [{...semantic,offer_id:null,publication_spec:null,
    pricing:{kind:'unit',amount:plannerAmount(resource.priceTenThousandths),currency:'CNY',quoted_at:null,valid_until:null,mandatory_fees:null},
    quote_status:'terms_unconfirmed',repeat_allowed:false}];
  return supplied.map(v=>{const offer=object(v);return {...semantic,
    offer_id:typeof offer.offer_id==='string'?offer.offer_id:null,publication_spec:offer.publication_spec??null,
    pricing:object(offer.pricing),...(offer.allowed_purposes===undefined?{}:{allowed_purposes:offer.allowed_purposes}),
    ...(offer.min_quantity===undefined?{}:{min_quantity:offer.min_quantity}),...(offer.max_quantity===undefined?{}:{max_quantity:offer.max_quantity}),repeat_allowed:offer.repeat_allowed===true,
    provider_execution:offer.provider_execution,provider_resource_id:offer.provider_resource_id,quote_status:includePlannerContext&&typeof offer.quote_status==='string'?offer.quote_status:'provider_terms',
  };});
}
export interface PublisherQuoteChoice { offerId: string; publicationSpec: unknown; quantity: number; purpose: string; }
export type PublisherQuote = {ok:false;reason:string}|{ok:true;unitPriceTenThousandths:string;totalPriceTenThousandths:string;perPublicationTenThousandths:string[];quoteFingerprint:string;repeatAllowed:boolean;pricing:Row};
/** Re-used at application, preflight and final submission; never accepts prices from the browser/model. */
export function resolvePublisherQuote(resource:PublisherCatalogResource,choice:PublisherQuoteChoice,asOf=new Date().toISOString()):PublisherQuote {
  if(!Number.isSafeInteger(choice.quantity)||choice.quantity<1||choice.quantity>100) return {ok:false,reason:'发布数量须为 1 至 100 的整数'};
  const offers=publisherPlannerCatalogRows(resource).filter(o=>o.offer_id===choice.offerId&&canonical(o.publication_spec)===canonical(choice.publicationSpec));
  if(offers.length!==1) return {ok:false,reason:'报价或发布规格未匹配到唯一可信目录记录'};
  const offer=offers[0]!,pricing=object(offer.pricing),now=timestamp(asOf),start=timestamp(pricing.quoted_at),end=timestamp(pricing.valid_until);
  if(now===null||start===null||end===null||end<start||now<start||now>end) return {ok:false,reason:'报价有效期未知、尚未生效或已过期'};
  if(pricing.currency!=='CNY') return {ok:false,reason:'当前发布钱包只接受已确认的人民币报价'};
  if(!Array.isArray(pricing.mandatory_fees)) return {ok:false,reason:'必要附加费尚未确认，不能作为完整费用采用'};
  if(pricing.kind!=='unit'||offer.provider_execution!=='independent_unit_orders') return {ok:false,reason:'此套餐或规格尚无可逐篇执行的供应商契约，请保留为规划草案'};
  if(offer.provider_resource_id!==resource.externalResourceId) return {ok:false,reason:'所选报价尚未绑定当前供应商可执行的资源编号'};
  if(!['standard','exploration'].includes(choice.purpose)) return {ok:false,reason:'发布用途必须明确为标准或探索'};
  if(offer.allowed_purposes!==undefined&&(!Array.isArray(offer.allowed_purposes)||!offer.allowed_purposes.includes(choice.purpose))) return {ok:false,reason:'报价不允许当前标准或探索用途'};
  for(const [key,comparison] of [['min_quantity',(x:number)=>choice.quantity<x],['max_quantity',(x:number)=>choice.quantity>x]] as const){const value=offer[key];if(value!==undefined&&(!Number.isSafeInteger(value)||Number(value)<1||comparison(Number(value))))return {ok:false,reason:'发布数量不满足报价数量限制'};}
  if(choice.quantity>1&&offer.repeat_allowed!==true) return {ok:false,reason:'供应商未明确允许同一冻结稿件重复发布'};
  const unit=amount(pricing.amount);if(unit===null) return {ok:false,reason:'报价金额或精度无效'};
  if(unit!==BigInt(resource.priceTenThousandths)) return {ok:false,reason:'该报价与当前供应商资源客户单价不同，请完成报价同步后重新确认'};
  let each=unit,once=0n;
  for(const value of pricing.mandatory_fees){const fee=object(value),n=amount(fee.amount);if(n===null||!['unit','item'].includes(String(fee.basis)))return {ok:false,reason:'必要附加费金额或计费方式尚未确认'};if(fee.basis==='unit')each+=n;else once+=n;}
  // One item-level fee is charged to the first real order only; the sum is exact.
  const allocation=Array.from({length:choice.quantity},(_,i)=>(each+(i===0?once:0n)).toString());
  return {ok:true,unitPriceTenThousandths:unit.toString(),totalPriceTenThousandths:(each*BigInt(choice.quantity)+once).toString(),perPublicationTenThousandths:allocation,
    quoteFingerprint:hash({resource:resource.id,external:resource.externalResourceId,revision:resource.catalogRevision,choice,offer}),repeatAllowed:offer.repeat_allowed===true,pricing};
}

/** Shared catalogue access follows the same authorized customer route boundary as media.list. */
export const PLANNER_CATALOG_PAGE_SIZE = 400;
export interface PlannerCatalogOptions { task?: Record<string,any>; deadline?: number; signal?: AbortSignal; includeResourceIds?: readonly string[]; }
export interface PlannerCatalogResult { catalog: Row[]; coverage: Record<string,any>; }
const resultRows = (result:unknown):Row[] => Array.isArray(result)&&Array.isArray(result[0])?result[0] as Row[]:[];
function catalogResourceRows(row:Row):Row[] {
  let raw=object(row.raw_payload);if(typeof row.raw_payload==='string'){try{raw=object(JSON.parse(row.raw_payload));}catch{raw={};}}
  return publisherPlannerCatalogRows({id:String(row.id),name:String(row.name),externalResourceId:String(row.external_resource_id),priceTenThousandths:String(row.price),catalogRevision:row.catalog_revision==null?null:String(row.catalog_revision),rawPayload:raw,
    mediaKind:row.media_kind==null?null:String(row.media_kind),platform:row.platform==null?null:String(row.platform),description:row.description==null?null:String(row.description),area:row.area==null?null:String(row.area),taxonomy:row.taxonomy==null?null:String(row.taxonomy),mediaType:row.media_type==null?null:String(row.media_type),imageSupport:['verified','unsupported'].includes(String(row.image_support))?row.image_support as 'verified'|'unsupported':'unknown'},true);
}
/** Full keyset scan, bounded live-read boundary and memory. Only the ranked
 * reservoir reaches expensive evidence matching. No id-ordered prefix is used. */
export async function loadPlannerCatalog(db:MySql2Database<any>,ownerId:string,enterpriseProjectId:string,options:PlannerCatalogOptions={}):Promise<PlannerCatalogResult> {
  if(!ownerId||!enterpriseProjectId) throw new Error('Authorized publishing owner and project are required');
  const reservoir=createCatalogReservoir(options.task??{}), pinnedIds=new Set(options.includeResourceIds??[]), pinned=new Map<string,Row[]>();
  const coverage:Record<string,any>={status:'incomplete',total_resources:null,scanned_resources:0,pages:0,page_size:PLANNER_CATALOG_PAGE_SIZE,consistency:'bounded_live_scan',ranking:'task_attribute_prefilter_v1',reason:null};
  const deadline=options.deadline??Date.now()+60_000;
  const interrupted=()=>options.signal?.aborted?'catalog_scan_cancelled':Date.now()>=deadline?'catalog_scan_deadline':null;
  const execute=(query:Parameters<typeof db.execute>[0])=>boundedCatalogQuery(()=>db.execute(query),deadline,options.signal);
  let cursor='',upper='';
  try {
    const before=interrupted();if(before){coverage.reason=before;return {catalog:[],coverage};}
    const bounds=resultRows(await execute(sql`select max(r.id) as upper_id,count(*) as total from publisher_media_resources r where r.is_active=1 and r.media_kind is not null`))[0];
    if(!bounds||!Number.isSafeInteger(Number(bounds.total))||Number(bounds.total)<0)throw new Error('catalog_bounds_invalid');
    upper=bounds.upper_id==null?'':String(bounds.upper_id);coverage.total_resources=Number(bounds.total);
    if(!upper){coverage.status=coverage.total_resources===0?'complete':'incomplete';coverage.reason=coverage.total_resources===0?null:'catalog_bounds_invalid';}
    while(upper){
      const stop=interrupted();if(stop){coverage.reason=stop;break;}
      const page=resultRows(await execute(sql`select r.id,r.name,r.external_resource_id,cast(r.price_ten_thousandths as char) as price,r.catalog_revision,r.raw_payload,r.media_kind,r.platform,r.description,r.area,r.taxonomy,r.media_type,c.image_support from publisher_media_resources r left join publisher_media_capabilities c on c.media_resource_id=r.id where r.is_active=1 and r.media_kind is not null and r.id > ${cursor} and r.id <= ${upper} order by r.id limit ${PLANNER_CATALOG_PAGE_SIZE}`));
      coverage.pages++;
      if(!page.length){coverage.status=coverage.scanned_resources===coverage.total_resources?'complete':'incomplete';coverage.reason=coverage.status==='complete'?null:'catalog_changed_during_scan';break;}
      const seen=new Set<string>();let next=cursor;
      for(const row of page){
        const id=String(row.id??'');if(!id||id===cursor||seen.has(id))continue;seen.add(id);next=id;
        const resourceRows=catalogResourceRows(row);reservoir.offer(resourceRows);if(pinnedIds.has(id))pinned.set(id,resourceRows);coverage.scanned_resources++;
      }
      if(next===cursor){coverage.reason='catalog_cursor_not_advanced';break;}cursor=next;
      if(page.length<PLANNER_CATALOG_PAGE_SIZE||cursor===upper){coverage.status=coverage.scanned_resources===coverage.total_resources?'complete':'incomplete';coverage.reason=coverage.status==='complete'?null:'catalog_changed_during_scan';break;}
    }
  } catch(error) { coverage.status=coverage.scanned_resources?'incomplete':'failed';coverage.reason=interrupted()??(error instanceof Error&&error.message==='catalog_scan_deadline'?'catalog_scan_deadline':'catalog_request_failed'); }
  const ranked=reservoir.finish(), byResource=new Map<string,Row[]>();
  for(const row of ranked.catalog){const id=String(row.resource_id);if(!byResource.has(id))byResource.set(id,[]);byResource.get(id)!.push(row);}
  for(const [id,rows] of pinned)if(!byResource.has(id))byResource.set(id,rows);
  const {catalog:_catalog,...counts}=ranked;
  return {catalog:[...byResource.entries()].sort(([a],[b])=>a.localeCompare(b)).flatMap(([,rows])=>rows),coverage:{...coverage,...counts,retained_resources:byResource.size,pinned_resources:pinned.size}};
}

/** A timeout stops further pages; at most one bounded DB page can remain in flight. */
async function boundedCatalogQuery<T>(query:()=>Promise<T>,deadline:number,signal?:AbortSignal):Promise<T> {
  if(signal?.aborted)throw new Error('catalog_scan_cancelled');
  if(Date.now()>=deadline)throw new Error('catalog_scan_deadline');
  let timer:ReturnType<typeof setTimeout>|undefined,abort:()=>void=()=>{};
  const interrupted=new Promise<never>((_,reject)=>{
    timer=setTimeout(()=>reject(new Error('catalog_scan_deadline')),Math.max(1,deadline-Date.now()));
    abort=()=>reject(new Error('catalog_scan_cancelled'));signal?.addEventListener('abort',abort,{once:true});
  });
  try{return await Promise.race([query(),interrupted]);}finally{if(timer)clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
/** Exact-name lookup for supplier industry-ranking media that the bounded
 * reservoir did not retain: the ranking only supplies display names, so the
 * pinned rows are still real shared-catalogue resources with their own offers.
 * A name that matches nothing stays a reference entry, never a candidate. */
export async function lookupPlannerCatalogResourcesByName(db:MySql2Database<any>,ownerId:string,enterpriseProjectId:string,names:readonly string[]):Promise<Row[]> {
  if(!ownerId||!enterpriseProjectId)return [];
  const list=[...new Set(names.map(name=>String(name??'').trim()).filter(Boolean))].slice(0,20);
  if(!list.length)return [];
  const deadline=Date.now()+10_000;
  try{
    const result=await boundedCatalogQuery(()=>db.execute(sql`select r.id,r.name,r.external_resource_id,cast(r.price_ten_thousandths as char) as price,r.catalog_revision,r.raw_payload,r.media_kind,r.platform,r.description,r.area,r.taxonomy,r.media_type,c.image_support from publisher_media_resources r left join publisher_media_capabilities c on c.media_resource_id=r.id where r.is_active=1 and r.media_kind is not null and r.name in (${sql.join(list.map(name=>sql`${name}`),sql`,`)}) order by r.id`),deadline);
    return resultRows(result).flatMap(catalogResourceRows);
  }catch{return [];}
}

/** Quantity edits refresh the exact saved candidate identities; they do not run
 * another complete catalogue scan or replace the matrix with a new shortlist. */
export async function reloadPlannerCatalog(db:MySql2Database<any>,ownerId:string,enterpriseProjectId:string,resourceIds:readonly string[]):Promise<Row[]> {
  if(!ownerId||!enterpriseProjectId)throw new Error('Authorized publishing owner and project are required');
  const ids=[...new Set(resourceIds.filter(id=>typeof id==='string'&&id.length>0))].sort(),catalog:Row[]=[],deadline=Date.now()+20_000;
  for(let offset=0;offset<ids.length;offset+=200){
    const batch=ids.slice(offset,offset+200);
    const result=await boundedCatalogQuery(()=>db.execute(sql`select r.id,r.name,r.external_resource_id,cast(r.price_ten_thousandths as char) as price,r.catalog_revision,r.raw_payload,r.media_kind,r.platform,r.description,r.area,r.taxonomy,r.media_type,c.image_support from publisher_media_resources r left join publisher_media_capabilities c on c.media_resource_id=r.id where r.is_active=1 and r.media_kind is not null and r.id in (${sql.join(batch.map(id=>sql`${id}`),sql`,`)}) order by r.id`),deadline);
    for(const row of resultRows(result))catalog.push(...catalogResourceRows(row));
  }
  return catalog;
}
