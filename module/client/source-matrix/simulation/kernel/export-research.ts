import { clone,digest,object,semantic,stableJson,type Row } from './common.js';

/** Native website port of export_research's observation boundary. Input is the
 * trusted importer's preserved JSON, never model-provided rows. locator_key is
 * only a sheet/row locator: deliberately no evidence_id or answer_record_id. */
export function prepareExportResearch(batch:Row,task:Row,models:string[]=[]):Row {
 const originals:Array<Row>=Array.isArray(batch.records)?batch.records:[];
 const filtered=originals.filter(r=>!models.length||models.includes(String(r.model??'')));
 const groups=new Map<string,Row>();
 for(const r of filtered){
  const name=r.mediaName??r.source_name??null,url=r.mediaUrl??r.media_url??null;
  const key='export:'+digest({file:batch.sourceSha256,name,url});
  if(!groups.has(key))groups.set(key,{candidate_key:key,source_name:name,media_url:url,domain:host(url),raw_observations:[]});
  groups.get(key)!.raw_observations.push({locator_key:'row:'+digest({file:batch.sourceSha256,sheet:r.sourceSheet,row:r.sourceRow,id:r.id}),source_sheet:r.sourceSheet??null,source_row:r.sourceRow??null,model:r.model??null,cited_at:r.citedAt??null,monitor_question:r.question??null,content_title:r.title??null,content_url:r.url??null,raw:clone(r)});
 }
 const relevant=semantic({...task,brand:undefined}),inputVersion='export-input-'+digest({file:batch.sourceSha256,task:relevant,models:[...models].sort(),records:filtered});
 return {schema_version:'export-research/1.1-website',input_version:inputVersion,source_sha256:batch.sourceSha256??null,source_file:batch.sourceFile??null,period:clone(batch.period??null),sample_models:models.length?models:null,raw_rows:filtered.length,unique_urls:new Set(filtered.map(r=>r.url).filter(Boolean)).size,distinct_export_rows:new Set(filtered.map(r=>stableJson([r.citedAt,r.model,r.question,r.title,r.url,r.mediaName,r.mediaUrl]))).size,exact_citation_count:null,records:clone(filtered),groups:[...groups.values()],limitations:['导出行不是独立回答或精确引用事件；locator_key 只用于原表追溯。','品牌样本不是行业总量，域名与名称不证明具体账号可售。']};
}
function host(value:unknown):string|null {if(typeof value!=='string'||!value)return null;try{return new URL(value.includes('://')?value:'https://'+value).hostname.toLowerCase();}catch{return null;}}

/** Preserve observation candidates independently of purchasable directory rows.
 * Related directory entries are suggestions, not automatic identity matches. */
export function researchCatalog(observation:Row,directory:Row[]):Row[] {
 return (observation.groups??[]).map((group:Row)=>({data_kind:'raw_brand_observation_context',candidate_key:group.candidate_key,source_name:group.source_name,domain:group.domain,media_url:group.media_url,observation_input_version:observation.input_version,raw_observations:clone(group.raw_observations),directory_suggestions:[...new Map(directory.filter(row=>(group.domain&&row.domain===group.domain)||(group.source_name&&row.source_name===group.source_name)).map(row=>{const match={resource_id:row.resource_id,source_name:row.source_name,account_id:row.account_id??null,channel_id:row.channel_id??null,relation:'suggested'};return [stableJson(match),match] as const;})).values()].sort((a,b)=>stableJson(a).localeCompare(stableJson(b)))}));
}

/** Directory associations are procurement options; no input URL is upgraded to
 * cited-account evidence. Only trusted explicit mappings permit a quote plan. */
export function candidateCatalogMatches(candidate:Row,catalog:Row[],mappings:Row[]=[]):Row[] {
 const source=candidate.attributes??{},ids=new Set<string>();
 if(candidate.resource_id)ids.add(candidate.resource_id);
 for(const row of catalog)if(row.resource_id&&((source.domain&&source.domain===row.domain)||(source.source_name&&source.source_name===row.source_name)))ids.add(row.resource_id);
 for(const map of mappings)if(map.candidate_key===source.candidate_key&&typeof map.resource_id==='string')ids.add(map.resource_id);
 return [...ids].map(resource_id=>{const offers=catalog.filter(row=>row.resource_id===resource_id),first=offers[0]??{},confirmed=resource_id===candidate.resource_id||mappings.some(m=>m.candidate_key===source.candidate_key&&m.resource_id===resource_id&&m.status==='confirmed');return {resource_id,source_name:first.source_name??null,account_id:first.account_id??null,channel_id:first.channel_id??null,identity_relation:confirmed?'confirmed':'suggested',offers:offers.map(row=>({offer_id:row.offer_id??null,publication_spec:row.publication_spec??null,pricing:clone(row.pricing??null),pricing_status:object(row.pricing)&&Array.isArray(row.pricing.mandatory_fees)&&row.pricing.quoted_at&&row.pricing.valid_until?'terms_provided':'terms_unconfirmed'}))};});
}
