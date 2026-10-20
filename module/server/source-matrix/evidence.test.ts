import { expect,it } from 'vitest';
import { analyzeEvidence,matchIdentity,normalizeUrl } from './evidence.js';
const scope={tenant_id:'t',question_id:'q1',platform:'p',model:'m',model_version:'v',period:{end:'2026-10-01'}};
const record={...scope,data_kind:'detail',answer_record_id:'a',citation_url:'https://example.com/a?utm=1&part=2#section',source_name:'甲',evidence_id:'e1'};
it('deduplicates content per complete scope while retaining identity conflicts',()=>{
 const out=analyzeEvidence([record,{...record,evidence_id:'e2',source_name:'乙'},{...record,question_id:'q2',evidence_id:'e3'}]);
 expect(out.known_detail_count).toBe(2);expect(out.total_citations).toBeNull();expect(out.actual_sources).toHaveLength(3);
 expect(out.detail_citations[0].status).toBe('identity_conflict');expect(out.combined_summary.share).toBeNull();
});
it('never mixes aggregates or supplier claims into detail counts',()=>{
 const a=analyzeEvidence([{data_kind:'aggregate',count:0},{...record,source_type:'supplier_claim'},{source_name:'未知'}]);
 expect(a.external_aggregates[0].count).toBe(0);expect(a.supplier_claims).toHaveLength(1);expect(a.total_citations).toBeNull();expect(a.actual_sources).toHaveLength(1);
});
it('retains semantic URL parameters and cannot infer an account from shared content',()=>{
 expect(normalizeUrl(record.citation_url,{tracking_parameters:['utm']})).toBe('https://example.com/a?part=2#section');
 expect(matchIdentity(record,{source_name:'甲',account_id:'a1',url:record.citation_url},{}).relation).toBe('unverified');
 expect(matchIdentity({...record,domain:'example.com'},{domain:'example.com',source_name:'甲'},{}).relation).toBe('exact');
});
it('does not borrow missing scope fields and retains unknown sources',()=>{
 const {model_version,...incomplete}=record;
 const out=analyzeEvidence([incomplete],scope);
 expect(out.status).toBe('incomplete');expect(out.total_citations).toBeNull();expect(out.actual_sources[0].count).toBeNull();expect(out.unknown_records).toHaveLength(1);
});
it('keeps publication and collection times independent, rejects impossible dates',()=>{
 const out=analyzeEvidence([{...record,collected_at:'2026-09-30',published_at:'2026-02-30'}],scope);
 expect(out.content_age.pending[0].reason).toBe('invalid_publication_date');expect(out.detail_citations[0].record.collected_at).toBe('2026-09-30');
 const missing=analyzeEvidence([{...record,collected_at:'2026-09-30'}],scope);
 expect(missing.content_age.pending[0].reason).toBe('missing_publication_date');
});
