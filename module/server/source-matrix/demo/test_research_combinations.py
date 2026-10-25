"""Regression source for ZCode; not executed in this Pro delivery."""
from copy import deepcopy
import json
from pathlib import Path
import unittest

from research_combinations import validate

ROOT=Path(__file__).resolve().parent


class ResearchBoundaryTests(unittest.TestCase):
    def setUp(self):
        load=lambda name:json.loads((ROOT/name).read_text(encoding='utf-8'))
        self.request=load('inputs/budget-input.json')
        self.matrix=load('outputs/matrix.json')
        self.decisions=load('inputs/ai-research-combinations.json')
        self.as_of=self.matrix['as_of']

    def run_choice(self):
        return validate(self.request,self.matrix,self.decisions,self.as_of)

    def test_valid_research_does_not_create_financial_or_cart_permission(self):
        result=self.run_choice()
        self.assertEqual(result['status'],'research_complete')
        for combination in result['research_combinations']:
            self.assertIsNone(combination['total_cost'])
            self.assertIsNone(combination['known_total_cost'])
            self.assertIsNone(combination['total_remaining'])
            self.assertIsNone(combination['budget_feasible'])
            self.assertFalse(combination['ready_to_publish'])
            self.assertFalse(combination['cart_eligible'])

    def test_model_cannot_supply_a_price(self):
        self.decisions['research_combinations'][0]['items'][0]['price']='0'
        result=self.run_choice()
        self.assertEqual(result['research_combinations'],[])
        self.assertIn('untrusted_item_fields',[e['code'] for e in result['errors']])

    def test_other_unjudged_source_cannot_enter_combination(self):
        self.decisions['research_combinations'][0]['items'][0]['candidate_id']='unverified_offer:0'
        self.assertIn('unvalidated_candidate',[e['code'] for e in self.run_choice()['errors']])

    def test_changed_semantic_requirement_rejects_old_snapshot(self):
        self.request['task']['questions'][0]['text']='新的投放目标'
        self.assertIn('stale_matrix',[e['code'] for e in self.run_choice()['errors']])

    def test_budget_change_keeps_semantic_order_without_asserting_feasibility(self):
        self.request['budget']['total_cap']='6000'
        result=self.run_choice()
        self.assertEqual(result['matrix_version'],self.matrix['matrix_version'])
        self.assertEqual(result['matrix_fit_order'],self.matrix['matrix']['fit_order'])
        self.assertTrue(all(c['budget_feasible'] is None for c in result['research_combinations']))

    def test_exploration_cannot_bypass_authorization_or_purpose(self):
        self.request['budget']['exploration_enabled']=False
        self.assertIn('exploration_not_authorized',[e['code'] for e in self.run_choice()['errors']])
        self.request['budget']['exploration_enabled']=True
        self.decisions['research_combinations'][2]['items'][2]['purpose']='standard'
        self.assertIn('exploration_purpose_required',[e['code'] for e in self.run_choice()['errors']])

    def test_reference_institution_is_not_a_publication_target(self):
        self.decisions['research_combinations'][0]['items'][0]['usage']='publication_research'
        self.assertIn('reference_only',[e['code'] for e in self.run_choice()['errors']])

    def test_same_members_do_not_count_as_distinct_strategy(self):
        self.decisions['research_combinations'][1]=deepcopy(self.decisions['research_combinations'][0])
        self.decisions['research_combinations'][1]['strategy']='换名称的相同组合'
        self.assertIn('duplicate_combination',[e['code'] for e in self.run_choice()['errors']])


if __name__=='__main__':unittest.main()
