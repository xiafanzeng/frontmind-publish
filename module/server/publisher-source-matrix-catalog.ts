import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { MySql2Database } from 'drizzle-orm/mysql2';

type Row = Record<string, unknown>;
export interface PublisherCatalogResource {
  id: string; name: string; externalResourceId: string; priceTenThousandths: string | bigint;
  catalogRevision: string | null; rawPayload: Row | null;
  mediaKind?: string | null; platform?: string | null; description?: string | null;
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
export function publisherPlannerCatalogRows(resource: PublisherCatalogResource): Row[] {
  const raw=object(resource.rawPayload);
  const all=Array.isArray(raw.publisher_offers_v1)?raw.publisher_offers_v1:raw.publisher_quote_v1?[raw.publisher_quote_v1]:[];
  // This adapter serves the shared catalogue only. Private/account pricing needs an explicitly scoped adapter.
  const supplied=all.filter(v=>{const o=object(v);return !['owner_id','ownerId','user_id','tenant_id','project_id','enterprise_project_id'].some(k=>o[k]!=null)&&!['private','account','tenant'].includes(String(o.visibility));});
  const attributes:Row={};
  for(const key of ['industry','industries','regions','region_coverage','restricted_regions','supported_formats']){
    const v=raw[key];if(typeof v==='string'||Array.isArray(v)&&v.every(x=>typeof x==='string'))attributes[key]=v;
  }
  for(const key of ['supports_links','supports_images','supports_video','supports_tables'])if(typeof raw[key]==='boolean')attributes[key]=raw[key];
  if(resource.imageSupport==='verified')attributes.supports_images=true;
  if(resource.imageSupport==='unsupported')attributes.supports_images=false;
  const semantic={resource_id:resource.id,name:resource.name,source_name:resource.name,publication_status:'available',external_resource_id:resource.externalResourceId,
    media_kind:resource.mediaKind??null,platform:resource.platform??null,media_intro:resource.description??null,...attributes,
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
    provider_execution:offer.provider_execution,provider_resource_id:offer.provider_resource_id,quote_status:'provider_terms',
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
export async function loadPlannerCatalog(db:MySql2Database<any>,ownerId:string,enterpriseProjectId:string):Promise<Row[]> {
  if(!ownerId||!enterpriseProjectId) throw new Error('Authorized publishing owner and project are required');
  const result=await db.execute(sql`select r.id,r.name,r.external_resource_id,cast(r.price_ten_thousandths as char) as price,r.catalog_revision,r.raw_payload,r.media_kind,r.platform,r.description,c.image_support from publisher_media_resources r left join publisher_media_capabilities c on c.media_resource_id=r.id where r.is_active=1 and r.media_kind is not null`);
  const rows=(Array.isArray(result)?result[0]:[]) as Row[];
  return rows.flatMap(row=>{let raw=object(row.raw_payload);if(typeof row.raw_payload==='string'){try{raw=object(JSON.parse(row.raw_payload));}catch{raw={};}}
    return publisherPlannerCatalogRows({id:String(row.id),name:String(row.name),externalResourceId:String(row.external_resource_id),priceTenThousandths:String(row.price),catalogRevision:row.catalog_revision==null?null:String(row.catalog_revision),rawPayload:raw,mediaKind:String(row.media_kind),platform:row.platform==null?null:String(row.platform),description:row.description==null?null:String(row.description),imageSupport:['verified','unsupported'].includes(String(row.image_support))?row.image_support as 'verified'|'unsupported':'unknown'});});
}
