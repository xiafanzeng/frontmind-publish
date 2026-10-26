"""New extension regression source; execution belongs to receiving ZCode run."""
from copy import deepcopy
import unittest
from scripts.content_planning import verify_content_plans

NOW='2026-10-26T10:00:00+08:00'
class ContentPlanningTests(unittest.TestCase):
    def setup_input(self):
        matrix={'matrix_version':'m1','matrix':{'status':'complete','candidates':[{'candidate_id':'resource:r','resource_id':'r','semantic_decision_validated':True,'selection':'recommended','channel_status':'eligible'}]}}
        request={'matrix_version':'m1','task':{},'budget':{'currency':'CNY','total_cap':'3000'},'catalog':[{'resource_id':'r','offer_id':'o','publication_spec':'text','publication_status':'available','pricing':{'kind':'unit','amount':'100.00','currency':'CNY','quoted_at':'2026-01-01T00:00:00Z','valid_until':'2027-01-01T00:00:00Z','mandatory_fees':[{'amount':'10','basis':'unit'},{'amount':'5','basis':'item'}]}}]}
        plan={'strategy':'方法与案例','reason_summary':'各一篇相互补充','items':[{'candidate_id':'resource:r','resource_id':'r','offer_id':'o','publication_spec':'text','quantity':2,'quantity_mode':'new_articles','content_tasks':['方法','案例'],'quantity_reason':'分别解释方法和案例','purpose':'standard'}],'explanation':{'objective':'帮助采购理解服务','selection_logic':['结构互补'],'content_allocation':[{'candidate_id':'resource:r','responsibility':'技术解释','content_angle':'方法与案例'}],'tradeoffs':['不覆盖地域'],'excluded_candidates':[],'fit_conditions':['材料充分'],'verification_items':['逐篇绑定稿件']}}
        return request,matrix,plan
    def test_quantity_fees_and_nonexecution(self):
        request,matrix,plan=self.setup_input();out=verify_content_plans(request,matrix,[plan],NOW)['content_plans'][0]
        self.assertEqual(out['total_cost'],'225.00');self.assertEqual(out['total_remaining'],'2775.00');self.assertTrue(out['budget_feasible']);self.assertFalse(out['cart_eligible']);self.assertNotIn('article_id',out['items'][0])
    def test_unknown_fees_do_not_become_zero(self):
        request,matrix,plan=self.setup_input();del request['catalog'][0]['pricing']['mandatory_fees'];out=verify_content_plans(request,matrix,[plan],NOW)['content_plans'][0]
        self.assertIsNone(out['total_cost']);self.assertIsNone(out['budget_feasible']);self.assertIsNone(out['total_remaining'])
    def test_expired_quote_and_cap(self):
        request,matrix,plan=self.setup_input();request['budget']['total_cap']='200';out=verify_content_plans(request,matrix,[plan],NOW)['content_plans'][0]
        self.assertFalse(out['budget_feasible']);self.assertEqual(out['total_remaining'],'-25.00')
        request['catalog'][0]['pricing']['valid_until']='2025-01-01T00:00:00Z';out=verify_content_plans(request,matrix,[plan],NOW)['content_plans'][0];self.assertIsNone(out['total_cost'])
    def test_wrong_matrix_and_price_injection(self):
        request,matrix,plan=self.setup_input();request['matrix_version']='m2';self.assertEqual(verify_content_plans(request,matrix,[plan],NOW)['status'],'stale_matrix')
        request['matrix_version']='m1';plan['items'][0]['price']='1';self.assertEqual(verify_content_plans(request,matrix,[plan],NOW)['status'],'invalid_decisions')
    def test_research_mapping_is_not_name_matching(self):
        request,matrix,plan=self.setup_input();matrix['matrix']['candidates'][0]['resource_id']=None;self.assertEqual(verify_content_plans(request,matrix,[plan],NOW)['status'],'invalid_decisions')
        request['resource_selections']=[{k:deepcopy(plan['items'][0][k]) for k in ('candidate_id','resource_id','offer_id','publication_spec')}];self.assertEqual(verify_content_plans(request,matrix,[plan],NOW)['status'],'complete')
    def test_locks_retained_and_never_counted_as_free(self):
        request,matrix,plan=self.setup_input();request['selected_items']=[{'locked':True,'article_id':'real','quantity':1}];out=verify_content_plans(request,matrix,[plan],NOW)['content_plans'][0]
        self.assertIsNone(out['budget_feasible']);self.assertEqual(out['retained_locked_items'],request['selected_items'])
    def test_mapped_resource_retains_all_channel_hard_conditions(self):
        changes=[({'requirements':{'images':True}},{'supports_images':False}),({'industry':'software'},{'prohibited_industries':['software']}),({'regions':['Shanghai']},{'restricted_regions':['Beijing']}),({}, {'hard_conditions':[{'rule_id':'legal_review','status':'fail'}]}),({'requirements':{'images':True}}, {})]
        for task,attrs in changes:
            request,matrix,plan=self.setup_input();request['task']=task;request['catalog'][0].update(attrs)
            out=verify_content_plans(request,matrix,[plan],NOW)['content_plans'][0]
            self.assertIsNone(out['budget_feasible']);self.assertTrue(any('channel_conditions_unconfirmed' in x['reasons'] for x in out['unknown_items']))
if __name__=='__main__':unittest.main()
