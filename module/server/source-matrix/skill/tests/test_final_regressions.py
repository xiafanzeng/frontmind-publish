"""Whole-branch findings: real CLI/process and planner regressions."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from copy import deepcopy
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.planner import run

P = Path(__file__).resolve().parents[1]
NOW = '2026-10-11T00:00:00Z'
SCOPE = dict(tenant_id='t', question_id='q1', platform='ai', model='m', model_version='v', period={'end':'2026-10-11'})

def fixture():
    return (json.loads((P/'examples/request.json').read_text()), json.loads((P/'examples/decisions.json').read_text()))

def aggregate_fixture():
    r,d = fixture()
    r['scope'] = SCOPE
    r['catalog'][0].update(domain='publication.example', source_identity='fictional-publication')
    r['citations'] = [{'aggregate_id':'ag1', 'data_kind':'aggregate', 'source_type':'external_data',
        'data_version':'2026-09', 'source_id':'fictional-study', 'source_identity':'fictional-publication',
        'source_name':r['catalog'][0]['source_name'], 'domain':'publication.example',
        'scope':{'industry':'软件', 'question_id':'industry-question', 'period':{'end':'2026-09-30'}, 'model':'industry-model'},
        'applicability':{'kind':'industry_context', 'industry':'软件'}, 'count':12, 'unit':'研究报告原始引用次数'}]
    d['matrix_decisions']['items'][0]['references'] = [{'type':'aggregate','aggregate_id':'ag1','usage':'industry_context'}]
    return r,d

class FinalRegressions(unittest.TestCase):
    def test_hashseed_matrix_budget_reuse(self):
        r,d = fixture(); r['scope'] = SCOPE
        r['citations'] = [dict(SCOPE, data_kind='detail', evidence_id=domain, answer_record_id=domain,
                               citation_url='https://'+domain+'/a') for domain in ('a.com','b.com','c.com')]
        duplicate = deepcopy(r['citations'][0]); duplicate['published_at']='2026-10-01'
        r['citations'].append(duplicate)
        with tempfile.TemporaryDirectory() as folder:
            p=Path(folder)
            (p/'r.json').write_text(json.dumps(r)); (p/'d.json').write_text(json.dumps(d))
            def cli(seed,stage,output,previous=None):
                args=[sys.executable,str(P/'scripts/planner.py'),'--input',str(p/'r.json'),'--decisions',str(p/'d.json'),
                      '--as-of',NOW,'--stage',stage,'--output',str(p/output)]
                if previous: args += ['--matrix',str(p/previous)]
                process=subprocess.run(args,env=dict(os.environ,PYTHONHASHSEED=str(seed)),capture_output=True,text=True)
                self.assertEqual(process.returncode,0,process.stderr)
                return json.loads((p/output).read_text())
            one=cli(1,'matrix','m1.json'); two=cli(2,'matrix','m2.json')
            self.assertEqual(one['matrix_version'],two['matrix_version'])
            self.assertEqual(one['source_analysis'],two['source_analysis'])
            budget=cli(2,'budget','b.json','m1.json')
            self.assertEqual(budget['status'],'complete'); self.assertTrue(budget['budget_plans'][0]['execution_recommended'])

    def test_undecided_and_locked_keep_cost_but_block_execution(self):
        for locked in (False,True):
            with self.subTest(locked=locked):
                r,d=fixture(); extra=deepcopy(r['catalog'][0]); extra.update(resource_id='r2',offer_id='o2',industry=['gardening']); r['catalog'].append(extra)
                item=d['budget_plans'][0]['items'][0]; item.update(resource_id='r2',offer_id='o2')
                if locked: r['selected_items']=[dict(item,locked=True)]
                out=run(r,d,'both',None,NOW); plan=out['budget_plans'][0]
                self.assertFalse(plan['execution_recommended'])
                self.assertTrue(plan['budget_feasible']); self.assertTrue(plan['ready_to_publish'])
                self.assertEqual(plan['total_cost'],'100.00'); self.assertEqual(plan['items'][0]['resource_id'],'r2')
                self.assertEqual(plan['semantic_pending'][0]['code'],'matrix_decision_required')
                if locked:self.assertTrue(plan['items'][0]['locked'])

    def test_explicit_alternative_is_executable(self):
        r,d=fixture(); d['matrix_decisions']['items'][0]['selection']='alternative'
        self.assertTrue(run(r,d,'both',None,NOW)['budget_plans'][0]['execution_recommended'])

    def test_aggregate_industry_context_is_independent_referencable(self):
        r,d=aggregate_fixture(); out=run(r,d,'both',None,NOW)
        self.assertEqual(out['status'],'complete',out.get('errors'))
        c=out['matrix']['candidates'][0]
        self.assertEqual(c['aggregate_ids'],['ag1']); self.assertEqual(c['evidence_ids'],[])
        self.assertEqual(c['evidence_relation'],'none'); self.assertEqual(c['identity_matches'],[])
        self.assertEqual(c['aggregate_matches'][0]['record'],r['citations'][0])
        self.assertEqual(c['aggregate_matches'][0]['applicability'],'industry_context')
        a=out['source_analysis']; self.assertEqual(a['known_detail_count'],0); self.assertIsNone(a['total_citations'])
        self.assertEqual(a['actual_sources'],[]); self.assertEqual(a['detail_citations'],[])
        self.assertEqual(a['external_aggregates'],r['citations'])
        self.assertTrue(out['budget_plans'][0]['execution_recommended'])

    def test_aggregate_unusable_boundaries(self):
        for change in ('scope','applicability','supplier','zero','missing_unit','missing_version','identity','duplicate_id','brand_usage'):
            with self.subTest(change=change):
                r,d=aggregate_fixture(); a=r['citations'][0]
                if change=='scope':a['scope']['industry']='gardening'
                elif change=='applicability':a['applicability']['industry']='gardening'
                elif change=='supplier':a['source_type']='supplier_claim'
                elif change=='zero':a['count']=0
                elif change=='missing_unit':a.pop('unit')
                elif change=='missing_version':a.pop('data_version')
                elif change=='identity':a['source_identity']='other'
                elif change=='duplicate_id':r['citations'].append(dict(a,count=17))
                else:d['matrix_decisions']['items'][0]['references'][0]['usage']='question_observation'
                out=run(r,d,'both',None,NOW)
                self.assertEqual(out['status'],'invalid_decisions',out)
                self.assertTrue(any(e['code']=='invalid_aggregate_reference' for e in out['errors']))
                if change=='supplier':
                    self.assertEqual(out['source_analysis']['external_aggregates'],[])
                    self.assertEqual(out['source_analysis']['supplier_claims'],[a])
                if change=='zero':self.assertEqual(out['source_analysis']['external_aggregates'][0]['count'],0)

    def test_url_integrated_exact_and_account_conflict(self):
        for account in (None,'other'):
            with self.subTest(account=account):
                r,d=fixture(); offer=r['catalog'][0]; offer.pop('source_name')
                offer.update(url='https://publication.example/a',source_identity='confirmed-publication')
                a=dict(SCOPE,data_kind='detail',evidence_id='e1',answer_record_id='a',citation_url=offer['url'],source_identity=offer['source_identity'])
                if account:offer['account_id']=account; a['account_id']='observed'
                r['citations']=[a]; r['scope']=SCOPE
                d['matrix_decisions']['items'][0]['references']=[{'type':'evidence','evidence_id':'e1'}]
                out=run(r,d,'matrix',None,NOW)
                c=next(c for c in out['matrix']['candidates'] if c['resource_id']=='r1')
                self.assertEqual(c['evidence_relation'],'unverified' if account else 'exact')
                self.assertEqual(c['evidence_ids'],['e1'])

    def test_missing_exploration_cap_is_nonblocking_report_warning(self):
        r,d=fixture(); r['budget'].pop('exploration_cap'); out=run(r,d,'both',None,NOW)
        self.assertTrue(out['budget_plans'][0]['budget_feasible'])
        self.assertIn('exploration_cap_required',[w['code'] for w in out.get('warnings',[])])
        self.assertEqual(out['report']['warnings'],out['warnings'])

    def test_plan_identity_and_revision(self):
        r,d=fixture(); one=run(r,d,'both',None,NOW)
        self.assertTrue(one.get('plan_id')); self.assertTrue(one.get('plan_version'))
        self.assertEqual(one,run(r,d,'both',None,NOW))
        r['catalog'][0]['pricing']['amount']='120.00'; two=run(r,d,'both',None,NOW)
        self.assertEqual(one['matrix_version'],two['matrix_version']); self.assertEqual(one['plan_id'],two['plan_id'])
        self.assertNotEqual(one['plan_version'],two['plan_version'])
        d['budget_plans'][0]['items'][0]['quantity']=2; three=run(r,d,'both',None,NOW)
        self.assertNotEqual(two['plan_version'],three['plan_version'])
        for result in (one,two,three):
            self.assertEqual(result['report']['plan_id'],result['plan_id']); self.assertEqual(result['report']['plan_version'],result['plan_version'])

    def test_minimum_known_unique_declared_publication(self):
        r,d=fixture(); r['budget'].update(total_cap='50.00',exploration_cap='0.00')
        out=run(r,d,'both',None,NOW); plan=out['budget_plans'][0]
        self.assertEqual(plan['status'],'no_feasible_plan')
        minimum=out.get('minimum_known_cost',{})
        self.assertEqual(minimum.get('status'),'confirmed_for_declared_publications')
        self.assertEqual(minimum['total_cost'],'100.00'); self.assertEqual(minimum['funding_gap'],'50.00')
        self.assertEqual(minimum['scope'],'unique_candidate_offer_and_declared_publications')
        self.assertEqual(out['report']['minimum_known_cost'],minimum)

    def test_minimum_not_global_from_submitted_plans(self):
        for change in ('candidate','offer','package','no_items','range','undeclared_article'):
            with self.subTest(change=change):
                r,d=fixture(); r['budget'].update(total_cap='50.00',exploration_cap='0.00')
                if change=='candidate':
                    extra=deepcopy(r['catalog'][0]);extra.update(resource_id='r2',offer_id='o2');r['catalog'].append(extra)
                elif change=='offer':
                    extra=deepcopy(r['catalog'][0]);extra['offer_id']='o2';r['catalog'].append(extra)
                elif change=='package':r['catalog'][0]['pricing']['kind']='package'
                elif change=='no_items':d['budget_plans']=[]
                elif change=='range':r['catalog'][0]['pricing'].update(kind='range',upper_bound='100.00',lower_bound='70.00')
                else:d['budget_plans'][0]['items'][0]['article_id']='not-declared'
                out=run(r,d,'both',None,NOW); minimum=out.get('minimum_known_cost',{})
                self.assertEqual(minimum.get('status'),'unproven')
                self.assertIsNone(minimum['total_cost']); self.assertIsNone(minimum['funding_gap']); self.assertTrue(minimum['reason'])

    def test_minimum_unknown_quote_remains_structured(self):
        r,d=fixture(); r['catalog'][0]['pricing']=None
        out=run(r,d,'both',None,NOW)
        self.assertEqual(out['minimum_known_cost']['status'],'unproven')
        self.assertIsNone(out['minimum_known_cost']['total_cost'])
        self.assertFalse(out['budget_plans'][0]['execution_recommended'])
