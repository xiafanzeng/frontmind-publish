"""Publication research explanations must stay tied to the selected candidates."""
import copy
import unittest
from tests import test_export_adapter as fixture
from scripts.export_adapter import read_export,research_matrix

class DraftExplanationTests(unittest.TestCase):
    def setup_draft(self):
        a=read_export(fixture.ExportAdapterTests.workbook(self))
        d=fixture.ExportAdapterTests.decision(self,a); key=d['items'][0]['candidate_key']
        explanation={'objective':'解释测试服务选型问题','selection_logic':['用专业内容支持技术采购判断'],
            'content_allocation':[{'candidate_key':key,'responsibility':'核心技术说明','content_angle':'测试范围与报告交付'}],
            'tradeoffs':['未覆盖短视频场景'], 'excluded_candidates':[],
            'fit_conditions':['受众需要详细测试说明'], 'verification_items':['确认作者账号与有效报价']}
        d['drafts']=[{'name':'专业内容组合','reason':'聚焦技术选型','candidate_keys':[key],
                      'content_direction':'以测试范围和报告交付为主线','explanation':explanation}]
        return a,d

    def test_detailed_explanation_survives_without_becoming_purchase_facts(self):
        a,d=self.setup_draft(); r=research_matrix(a,fixture.BRIEF,d)
        self.assertEqual(r['status'],'research_draft',r['errors'])
        self.assertEqual(r['research_drafts'][0]['explanation'],d['drafts'][0]['explanation'])
        self.assertEqual(r['research_drafts'][0]['explanation_status'],'complete')
        self.assertIsNone(r['research_drafts'][0]['total_cost'])
        self.assertFalse(r['research_drafts'][0]['execution_recommended'])

    def test_work_allocation_cannot_refer_to_an_unselected_candidate(self):
        a,d=self.setup_draft();d['drafts'][0]['explanation']['content_allocation'][0]['candidate_key']='invented'
        self.assertEqual(research_matrix(a,fixture.BRIEF,d)['status'],'invalid_decisions')

    def test_explanation_arrays_cannot_be_strings_or_hide_price_claims(self):
        for field,value in [('tradeoffs','非数组'),('content_allocation',[None]),('total_cost','100')]:
            with self.subTest(field=field):
                a,d=self.setup_draft();d['drafts'][0]['explanation'][field]=value
                self.assertEqual(research_matrix(a,fixture.BRIEF,d)['status'],'invalid_decisions')

    def test_legacy_draft_is_explicitly_missing_detailed_explanation(self):
        a,d=self.setup_draft();del d['drafts'][0]['explanation']
        r=research_matrix(a,fixture.BRIEF,d)
        self.assertEqual(r['status'],'research_draft')
        self.assertEqual(r['research_drafts'][0]['explanation_status'],'needs_explanation')

if __name__=='__main__':unittest.main()
