import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from evidence import analyze_evidence, match_identity, normalize_url

SCOPE = dict(tenant_id='t', question_id='q', platform='ai', model='m', model_version='v', period={'end':'2026-10-11'})
def record(**kw):
    return dict(SCOPE, data_kind='detail', evidence_id='e', answer_record_id='a', citation_url='https://news.163.com/a?item=1', **kw)
class EvidenceTests(unittest.TestCase):
    def test_duplicate(self):
        result=analyze_evidence([record(),record()],SCOPE,{})
        self.assertEqual(result['total_citations'],1)
    def test_distinct_answers(self):
        r=record(); r['answer_record_id']='b'
        self.assertEqual(analyze_evidence([record(),r],SCOPE,{})['total_citations'],2)
    def test_scope_isolation(self):
        for field in ('model','question_id','period','model_version','tenant_id'):
            r=record(); r[field]='other'
            self.assertEqual(analyze_evidence([record(),r],{}, {})['combined_summary']['total_citations'],2)
    def test_incomplete(self):
        for field in ('answer_record_id','citation_url','model_version'):
            r=record(); del r[field]
            a=analyze_evidence([r],{},{}); self.assertIsNone(a['total_citations']); self.assertEqual(a['unknown_records'],[r])
    def test_aggregate_zero(self):
        r={'data_kind':'aggregate','count':0,'unit':'citations'}
        a=analyze_evidence([r],{},{}); self.assertEqual(a['external_aggregates'],[r]); self.assertIsNone(a['total_citations'])
    def test_supplier(self):
        r=record(source_type='supplier_claim')
        a=analyze_evidence([r],{},{}); self.assertEqual(a['actual_sources'],[])
    def test_platform(self):
        self.assertEqual(match_identity(record(),{'domain':'www.163.com'}, {'platform_domains':['163.com']})['relation'],'platform_related')
    def test_account(self):
        self.assertEqual(match_identity(record(account_id='x'),{'resource_id':'r'}, {'confirmed_account_mappings':[{'account_id':'x','resource_id':'r','domain':'news.163.com'}]})['relation'],'exact')
    def test_name_conflict(self):
        self.assertEqual(match_identity({'source_name':'A','domain':'a.com'},{'source_name':'A','domain':'b.com'}, {})['relation'],'unverified')
    def test_url_semantics(self):
        self.assertNotEqual(normalize_url('https://x.com/p?id=1'),normalize_url('https://x.com/p?id=2'))
    def test_unknown_root(self):
        self.assertEqual(match_identity({'domain':'a.example.unknown'},{'domain':'b.example.unknown'}, {})['relation'],'unverified')
    def test_no_evidence(self):
        self.assertEqual(match_identity({'source_type':'supplier_claim'}, {}, {})['relation'],'none')

    def test_age_uses_publication_not_collection(self):
        r=record(published_at='2026-10-05',collected_at='2026-01-01')
        a=analyze_evidence([r],SCOPE,{})
        self.assertEqual(a['content_age']['buckets']['0–7'],1)
    def test_age_missing_period(self):
        self.assertIsNone(analyze_evidence([record()],{}, {})['content_age']['buckets'])
    def test_content_does_not_prove_account_or_name(self):
        s=record(); r={'citation_url':s['citation_url'],'account_id':'arbitrary','source_name':'Named'}
        self.assertEqual(match_identity(s,r,{})['relation'],'unverified')
    def test_independent_account_conflict(self):
        self.assertEqual(match_identity({'domain':'x.com','account_id':'a'}, {'domain':'x.com','account_id':'b'}, {'independent_domains':['x.com']})['relation'],'unverified')
    def test_scoped_rollups(self):
        a=record(); b=record(); b['model']='other'; b['citation_url']='https://else.com/a'
        out=analyze_evidence([a,b],{}, {})
        self.assertEqual(len(out['domain_rollups']),2)
        self.assertTrue(all(row['share']==1 for row in out['domain_rollups']))
        self.assertTrue(all('scope' in row for row in out['actual_sources']))
    def test_duplicate_variants_and_incomplete_identity_retained(self):
        a=record(account_id='a'); b=record(account_id='b'); c=record(account_id='c'); del c['answer_record_id']
        out=analyze_evidence([a,b,c],{}, {})
        self.assertEqual(len(out['detail_citations'][0]['records']),2)
        self.assertEqual(out['detail_citations'][0]['status'],'identity_conflict')
        self.assertEqual(len(out['actual_sources']),3)
        self.assertTrue(any(row['status']=='incomplete' for row in out['actual_sources']))
    def test_dates_pending_reasons_and_boundaries(self):
        dates=['2026-10-04','2026-10-03','2026-10-05garbage','2026-10-12',None]
        rows=[]
        for i,d in enumerate(dates):
            r=record(published_at=d); r['answer_record_id']=str(i); r['evidence_id']=str(i); rows.append(r)
        age=analyze_evidence(rows,SCOPE,{})['content_age']
        self.assertEqual(age['buckets']['0–7'],1); self.assertEqual(age['buckets']['8–30'],1)
        self.assertEqual({p['reason'] for p in age['pending']},{'invalid_publication_date','future_publication_date','missing_publication_date'})
    def test_tracking_and_exclusion(self):
        self.assertEqual(normalize_url('https://x.com/p?id=1&utm_source=a',{'tracking_parameters':['utm_source']}),'https://x.com/p?id=1')
        r=record(); r['tenant_id']='other'
        self.assertEqual(analyze_evidence([r],SCOPE,{})['excluded_records'],[r])
    def test_all_age_interval_boundaries(self):
        from datetime import date, timedelta
        rows=[]
        for i, days in enumerate([0,7,8,30,31,365,366,1095,1096]):
            r=record(published_at=(date(2026,10,11)-timedelta(days=days)).isoformat())
            r['answer_record_id']=str(i); rows.append(r)
        buckets=analyze_evidence(rows,SCOPE,{})['content_age']['buckets']
        self.assertEqual(buckets,{'0–7':2,'8–30':2,'31–365':2,'366–1095':2,'1096+':1})
    def test_duplicate_identity_cannot_match(self):
        a=record(account_id='a'); b=record(account_id='b')
        d=analyze_evidence([a,b],SCOPE,{})['detail_citations'][0]
        d['citation_url']=a['citation_url']
        self.assertEqual(match_identity(d,{'citation_url':a['citation_url']},{})['relation'],'unverified')
    def test_cross_scope_top_count_not_denominator(self):
        a=record(); b=record(); b['model']='other'
        out=analyze_evidence([a,b],{}, {})
        self.assertIsNone(out['total_citations'])
        self.assertEqual(out['combined_summary']['total_citations'],2)
    def test_strict_timestamp_and_invalid_base(self):
        a=analyze_evidence([record(published_at='2026-10-05T12:30:00Z')],SCOPE,{})
        self.assertEqual(a['content_age']['buckets']['0–7'],1)
        scope=dict(SCOPE,period={'end':'bad'})
        r=record(); r['period']=scope['period']
        self.assertEqual(analyze_evidence([r],scope,{})['content_age']['status'],'invalid_period_end')
    def test_equal_url_missing_source_identity(self):
        url='https://news.163.com/a'
        self.assertEqual(match_identity({'citation_url':url},{'citation_url':url,'source_identity':'specific'},{})['relation'],'unverified')
    def test_equal_url_conflicting_media_names(self):
        url='https://news.163.com/a'
        self.assertEqual(match_identity({'citation_url':url,'source_name':'A'},{'citation_url':url,'source_name':'B'},{})['relation'],'unverified')
    def test_named_domain_missing_source_identity(self):
        self.assertEqual(match_identity({'domain':'x.com','source_name':'A'},{'domain':'x.com','source_name':'A','source_identity':'specific'},{})['relation'],'unverified')
    def test_independent_domain_missing_source_identity(self):
        self.assertEqual(match_identity({'domain':'x.com'},{'domain':'x.com','source_identity':'specific'},{'independent_domains':['x.com']})['relation'],'unverified')
    def test_equal_url_confirmed_alias(self):
        url='https://x.com/a'
        cfg={'confirmed_aliases':[{'domain':'x.com','names':['A','B']}]}
        self.assertEqual(match_identity({'citation_url':url,'source_name':'A'},{'citation_url':url,'source_name':'B'},cfg)['relation'],'exact')
