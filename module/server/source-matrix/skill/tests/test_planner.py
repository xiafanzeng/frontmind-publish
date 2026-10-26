import json
import subprocess
import sys
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from scripts.planner import run

NOW='2026-10-11T00:00:00Z'
ROOT=Path(__file__).resolve().parents[1]
def fixture():
    r={'task_id':'fictional-task','task':{'industry':'软件','questions':[{'question_id':'q1','text':'如何评估软件？'}], 'manuscripts':[{'article_id':'a1','version':'v1'}]},'catalog':[{'resource_id':'r1','offer_id':'o1','source_name':'虚构软件刊物','industry':['软件'],'publication_status':'available','publication_spec':'text','allowed_purposes':['standard'],'manuscript_checks':[{'article_id':'a1','version':'v1','status':'pass'}],'pricing':{'kind':'unit','amount':'100.00','currency':'CNY','quoted_at':'2026-10-01T00:00:00Z','valid_until':'2026-11-01T00:00:00Z','mandatory_fees':[]}}], 'budget':{'currency':'CNY','total_cap':'500.00','exploration_enabled':True,'exploration_cap':'50.00'}}
    item={'article_id':'a1','version':'v1','resource_id':'r1','offer_id':'o1','publication_spec':'text','quantity':1,'purpose':'standard'}
    d={'matrix_decisions':{'items':[{'candidate_id':'resource:r1','primary_role':'industry','auxiliary_roles':[],'matched_questions':['q1'],'references':[{'type':'attribute','path':'catalog[0].industry'}],'reason_summary':'软件读者匹配评估问题','reason_details':['依据可信行业属性'],'unconfirmed_items':[],'selection':'recommended'}],'fit_order':['resource:r1']},'budget_plans':[{'strategy':'行业覆盖','reason_summary':'用一个行业渠道覆盖目标问题','items':[item]}]}
    return r,d
class PlannerTests(unittest.TestCase):
    def test_modes_and_reproducibility(self):
        r,d=fixture();m=run(r,d,'matrix',None,NOW)
        self.assertEqual(m['budget_plans'],[])
        b=run(r,d,'budget',m,NOW);out=run(r,d,'both',None,NOW)
        self.assertEqual(b['budget_plans'],out['budget_plans']);self.assertEqual(out,run(r,d,'both',None,NOW))
        self.assertTrue(out['budget_plans'][0]['ready_to_publish'])
        self.assertEqual(out['report']['budget_plans'],out['budget_plans']);self.assertNotIn('charts',out)
    def test_missing_budget_and_ai(self):
        r,d=fixture();r.pop('budget')
        self.assertEqual(run(r,d,'both',None,NOW)['status'],'needs_budget')
        out=run(r,None,'both',None,NOW);self.assertEqual(out['matrix']['status'],'needs_ai_decisions')
        self.assertEqual(out['matrix']['fit_order'],[])
    def test_snapshot_changes(self):
        r,d=fixture();m=run(r,d,'matrix',None,NOW)
        for change in ('task','evidence','task_id'):
            x=deepcopy(r)
            if change=='task':x['task']['industry']='其他'
            elif change=='evidence':x['citations']=[{'evidence_id':'e1','data_kind':'aggregate','count':1}]
            else:x['task_id']='other'
            self.assertEqual(run(x,d,'budget',m,NOW)['status'],'stale_matrix')
        m['snapshot']['expires_at']='2026-10-10T00:00:00Z'
        self.assertEqual(run(r,d,'budget',m,NOW)['status'],'stale_matrix')
    def test_reprice_and_multiple_offer_semantics(self):
        r,d=fixture();m=run(r,d,'matrix',None,NOW)
        r['catalog'][0]['pricing']['amount']='120';r['budget']['total_cap']='150'
        extra=deepcopy(r['catalog'][0]);extra.update(offer_id='o2',publication_spec='video',allowed_purposes=['exploration']);r['catalog'].append(extra)
        out=run(r,d,'budget',m,NOW)
        self.assertEqual(out['matrix_version'],m['matrix_version']);self.assertEqual(out['matrix']['fit_order'],m['matrix']['fit_order'])
        self.assertTrue(out['budget_plans'][0]['budget_feasible']);self.assertEqual(out['budget_plans'][0]['total_cost'],'120.00')
    def test_deduplicate_and_limit(self):
        r,d=fixture();d['budget_plans']*=4
        self.assertEqual(len(run(r,d,'both',None,NOW)['budget_plans']),1)
        for i in range(4):d['budget_plans'][i]=deepcopy(d['budget_plans'][i]);d['budget_plans'][i]['items'][0]['quantity']=i+1
        self.assertEqual(run(r,d,'both',None,NOW)['status'],'invalid_decisions')
    def test_locked_exploration_and_manuscript_failure(self):
        r,d=fixture();r['selected_items']=[dict(d['budget_plans'][0]['items'][0],locked=True)];d['budget_plans'][0]['items']=[]
        out=run(r,d,'both',None,NOW)['budget_plans'][0];self.assertEqual(out['items'],r['selected_items']);self.assertFalse(out['budget_feasible'])
        r,d=fixture();d['budget_plans'][0]['items'][0]['purpose']='exploration';r['budget']['exploration_enabled']=False
        self.assertFalse(run(r,d,'both',None,NOW)['budget_plans'][0]['budget_feasible'])
        r,d=fixture();r['catalog'][0]['manuscript_checks'][0]['status']='fail'
        p=run(r,d,'both',None,NOW)['budget_plans'][0];self.assertTrue(p['budget_feasible']);self.assertFalse(p['ready_to_publish'])
    def test_cli_bad_inputs_preserve_output(self):
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory);out=p/'output.json';out.write_text('old');inp=p/'input.json'
            for value,stage in [('oops','both'),('[]','both'),(json.dumps(fixture()[0]),'wrong'),(json.dumps(dict(fixture()[0],catalog=[None])),'both')]:
                inp.write_text(value)
                proc=subprocess.run([sys.executable,str(ROOT/'scripts/planner.py'),'--input',str(inp),'--stage',stage,'--as-of',NOW,'--output',str(out)],capture_output=True)
                self.assertNotEqual(proc.returncode,0);self.assertEqual(out.read_text(),'old')
    def test_cli_success_and_business_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory);r,d=fixture();r['budget']['total_cap']='50';r['budget']['exploration_cap']='0'
            inp=p/'input.json';dec=p/'decisions.json';out=p/'output.json'
            inp.write_text(json.dumps(r));dec.write_text(json.dumps(d));out.write_text('old')
            proc=subprocess.run([sys.executable,str(ROOT/'scripts/planner.py'),'--input',str(inp),'--decisions',str(dec),'--stage','both','--as-of',NOW,'--output',str(out)],capture_output=True)
            self.assertEqual(proc.returncode,0,proc.stderr)
            self.assertEqual(json.loads(out.read_text())['budget_plans'][0]['status'],'no_feasible_plan')
    def test_snapshot_does_not_supply_trusted_channel_override(self):
        r,d=fixture();r['catalog'][0]['publication_status']='closed';m=run(r,d,'matrix',None,NOW)
        m['matrix']['candidates'][0]['channel_status']='eligible'
        self.assertFalse(run(r,d,'budget',m,NOW)['budget_plans'][0]['budget_feasible'])
    def test_missing_quantity_and_reselection(self):
        r,d=fixture();d['budget_plans'][0]['items'][0].pop('quantity')
        p=run(r,d,'both',None,NOW)['budget_plans'][0];self.assertIsNone(p['total_cost']);self.assertFalse(p['budget_feasible'])
        r,d=fixture();m=run(r,d,'matrix',None,NOW);d['budget_plans'][0]['items'][0]['quantity']=2
        out=run(r,d,'budget',m,NOW);self.assertEqual(out['budget_plans'][0]['total_cost'],'200.00');self.assertEqual(out['matrix']['fit_order'],m['matrix']['fit_order'])
    def test_malformed_decision_lists_are_input_errors(self):
        r,d=fixture();d['matrix_decisions']['items']='bad'
        self.assertEqual(run(r,d,'both',None,NOW)['status'],'invalid_input')
    def test_inputs_immutable(self):
        r,d=fixture();original=deepcopy((r,d));run(r,d,'both',None,NOW)
        self.assertEqual((r,d),original)
    def test_cli_inner_matrix_structure_preserves_output(self):
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory);r,d=fixture();inp=p/'input.json';dec=p/'decisions.json';out=p/'output.json'
            inp.write_text(json.dumps(r))
            for field,value in [('reason_details','wrong shape'),('references','wrong shape'),('auxiliary_roles',42),('references',[{'type':'attribute','path':[]}])]:
                malformed=deepcopy(d);malformed['matrix_decisions']['items'][0][field]=value
                dec.write_text(json.dumps(malformed));out.write_text('LAST SUCCESS')
                proc=subprocess.run([sys.executable,str(ROOT/'scripts/planner.py'),'--input',str(inp),'--decisions',str(dec),'--stage','both','--as-of',NOW,'--output',str(out)],capture_output=True)
                self.assertNotEqual(proc.returncode,0,field);self.assertEqual(out.read_text(),'LAST SUCCESS',field)
    def test_ai_item_cannot_inject_trusted_fields(self):
        for key,value in [('locked',True),('total_cost','0.00'),('ready_to_publish',True),('status','passed')]:
            r,d=fixture();d['budget_plans'][0]['items'][0][key]=value
            out=run(r,d,'both',None,NOW)
            self.assertEqual(out['status'],'invalid_decisions',key);self.assertEqual(out['budget_plans'],[])
            self.assertIn('untrusted_item_field',[e['code'] for e in out['errors']])
    def test_rebind_catalog_reorder_and_inserted_offer(self):
        r,d=fixture();second=deepcopy(r['catalog'][0]);second.update(resource_id='r2',offer_id='o2',source_name='另一虚构刊物')
        r['catalog'].append(second)
        other=deepcopy(d['matrix_decisions']['items'][0]);other['candidate_id']='resource:r2';other['references'][0]['path']='catalog[1].industry'
        d['matrix_decisions']['items'].append(other);d['matrix_decisions']['fit_order'].append('resource:r2')
        snapshot=run(r,d,'matrix',None,NOW)
        for variant in ('reorder','insert'):
            current=deepcopy(r)
            if variant=='reorder':current['catalog'].reverse()
            else:
                alternate=deepcopy(second);alternate.update(offer_id='o3',publication_spec='video',allowed_purposes=['exploration']);current['catalog'].insert(0,alternate)
            out=run(current,d,'budget',snapshot,NOW)
            self.assertEqual(out['status'],'complete',variant);self.assertEqual(out['matrix_version'],snapshot['matrix_version'])
            self.assertEqual(out['matrix']['fit_order'],snapshot['matrix']['fit_order']);self.assertTrue(out['budget_plans'][0]['budget_feasible'])
            for old,new in zip(snapshot['matrix']['candidates'],out['matrix']['candidates']):
                self.assertEqual(old['reason_summary'],new['reason_summary']);self.assertEqual(old['reason_details'],new['reason_details'])
                index=int(new['references'][0]['path'].split('[')[1].split(']')[0])
                self.assertEqual(current['catalog'][index]['resource_id'],new['resource_id'])
    def test_invalid_run_structures(self):
        r,d=fixture()
        for request,decisions in [(r,[]),(dict(r,catalog=[None]),d),(dict(r,task={'industry':'x','questions':[1]}),d)]:
            self.assertEqual(run(request,decisions,'both',None,NOW)['status'],'invalid_input')
if __name__=='__main__':unittest.main()
