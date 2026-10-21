import { sha256Hex, stableJson } from './hash.js';
/** JSON dictionaries mirror the upstream extensible catalog/evidence contract.
 * Never use these as authorization objects. All runtime boundaries are validated. */
export type Row = Record<string, any>;
export type Issue = { code:string; path:string; message:string };
export const issue = (code:string,path:string,message=code):Issue => ({code,path,message});
export const object = (v:unknown):v is Row => !!v && typeof v==='object' && !Array.isArray(v);
export const rows = (v:unknown):v is Row[] => Array.isArray(v) && v.every(object);
export const text = (v:unknown):v is string => typeof v==='string' && !!v.trim();
export const strings = (v:unknown):v is string[] => Array.isArray(v) && v.every(x=>typeof x==='string');
export const list = (v:unknown):string[] => typeof v==='string' ? [v] : strings(v) ? v : [];
export const clone = <T>(v:T):T => structuredClone(v);
export const equal = (a:unknown,b:unknown) => stableJson(a)===stableJson(b);
export const unique = <T>(values:T[]):T[] => [...new Map(values.map(v=>[stableJson(v),v])).values()];
export const digest = (v:unknown) => sha256Hex(stableJson(v)).slice(0,24);
export { stableJson };
export const roles:Record<string,string> = {authority:'权威参考',industry:'行业核心',regional:'地域覆盖',supplement:'覆盖补充',exploration:'探索验证'};
export const priceFields = new Set('publication_spec allowed_purposes budget selected_items offer_id supplier supplier_id price unit_price currency quote_date quoted_at quote_valid_until valid_until expires_at pricing_basis billing_basis billing_unit pricing fees mandatory_fees tax taxes service_fee price_min price_max quote quotes total_cap exploration_cap unit_price_min unit_price_max quantity article_quantity'.split(' '));
export const identityFields = ['source_name','domain','account_id','channel_id','source_identity','url','citation_url'];
export function semantic(v:any):any {
  if (Array.isArray(v)) return v.map(semantic);
  if (object(v)) return Object.fromEntries(Object.entries(v).filter(([k])=>!priceFields.has(k)).map(([k,x])=>[k,semantic(x)]));
  return v;
}
export function timestamp(v:unknown):number {
  if(typeof v!=='string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v)) throw new Error('Timezone-aware timestamp required');
  calendarDay(v.slice(0,10));
  const n=Date.parse(v); if(!Number.isFinite(n) || Number(v.slice(11,13))>23 || Number(v.slice(14,16))>59 || Number(v.slice(17,19))>59) throw new Error('Invalid timestamp');
  return n;
}
export function calendarDay(v:unknown):number {
  if(typeof v!=='string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(v)) throw new Error('Invalid date');
  const day=v.slice(0,10), n=Date.parse(day+'T00:00:00Z');
  if(!Number.isFinite(n)||new Date(n).toISOString().slice(0,10)!==day) throw new Error('Invalid date');
  if(v.length>10 && (!Number.isFinite(Date.parse(v))||Number(v.slice(11,13))>23||Number(v.slice(14,16))>59||Number(v.slice(17,19))>59)) throw new Error('Invalid time');
  return n/86400000;
}
