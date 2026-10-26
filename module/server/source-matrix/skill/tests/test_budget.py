import unittest
from copy import deepcopy
from scripts.budget import price_items, verify_plan
NOW='2026-10-11T00:00:00Z'
def item(article='a', resource='r', **kw):
    return dict(article_id=article,version='1',resource_id=resource,offer_id='o'+resource,publication_spec='text',quantity=1,purpose='standard',**kw)
def offer(resource='r',amount='10'):
    return {'resource_id':resource,'offer_id':'o'+resource,'publication_spec':'text','pricing':{'kind':'unit','amount':amount,'currency':'CNY','quoted_at':'2026-10-01T00:00:00Z','valid_until':'2026-11-01T00:00:00Z','mandatory_fees':[]}}
def matrix(cat):
    return {'matrix_version':'m1','matrix':{'candidates':[{'resource_id':o['resource_id'],'channel_status':'eligible','offers':[o],'manuscript_checks':[]} for o in cat]}}
def request(cat):
    return {'task':{'manuscripts':[{'article_id':'a','version':'1'},{'article_id':'b','version':'1'}]},'catalog':cat,'budget':{'currency':'CNY','total_cap':'5000','exploration_cap':'800','exploration_enabled':True}}
class BudgetTests(unittest.TestCase):
    def test_formal_identity_repeat_intent_and_quantity_limit(self):
        cat=[offer()];req=request(cat);choices={'items':[dict(item(),quantity=2)]}
        out=verify_plan(choices,matrix(cat),req,NOW)
        self.assertIn('repeat_publication_not_authorized',[e['code'] for e in out['errors']])
        req['publication_intent']='repeat_existing_article';cat[0]['repeat_allowed']=True
        self.assertTrue(verify_plan(choices,matrix(cat),req,NOW)['budget_feasible'])
        choices['items'][0]['article_id']='invented';out=verify_plan(choices,matrix(cat),req,NOW)
        self.assertIn('undeclared_manuscript',[e['code'] for e in out['errors']])
        choices['items'][0].update(article_id='a',quantity=101);out=verify_plan(choices,matrix(cat),req,NOW)
        self.assertIn('quantity_limit_exceeded',[e['code'] for e in out['errors']])
    def test_spec_three_caps(self):
        for core,explore,ok in [('4200','800',True),('4500','800',False),('3800','1000',False)]:
            cat=[offer('r',core),offer('e',explore)];rows=[item(),dict(item(resource='e'),purpose='exploration')]
            out=verify_plan({'items':rows},matrix(cat),request(cat),NOW)
            self.assertEqual(out['budget_feasible'],ok);self.assertEqual(out['total_cost_minor'],int(core)*100+int(explore)*100)
            self.assertEqual(out['exploration_cost_minor'],int(explore)*100)
    def test_dedupe_multiple_articles_and_conflicts(self):
        out=price_items([item(),dict(item(),primary_role='exploration'),item('b')],[offer()],NOW)
        self.assertEqual(out['total_cost'],'20.00');self.assertEqual(len(out['items']),2)
        for update in [{'offer_id':'other'},{'purpose':'exploration'}]:
            out=price_items([item(),dict(item(),**update)],[offer()],NOW)
            self.assertIn('conflicting_publication',[e['code'] for e in out['errors']])
    def test_quantity_and_missing_fields(self):
        for q in [0,-1,True,1.5,'2',None]:
            self.assertFalse(price_items([dict(item(),quantity=q)],[offer()],NOW)['complete'])
        for key in ['article_id','version','quantity']:
            row=item();del row[key];out=price_items([row],[offer()],NOW)
            self.assertEqual(out['status'],'estimate');self.assertIsNone(out['total_cost'])
    def test_fees_exploration(self):
        o=offer();o['pricing']['mandatory_fees']=[{'amount':'2','basis':'unit'},{'amount':'3','basis':'item'}]
        out=price_items([dict(item(),quantity=2,purpose='exploration')],[o],NOW)
        self.assertEqual(out['exploration_cost'],'27.00')
    def test_unknown_never_feasible(self):
        for update in [{'amount':None},{'valid_until':'2026-10-10T00:00:00Z'},{'valid_until':None},{'mandatory_fees':None},
                       {'mandatory_fees':[{'amount':None,'basis':'unit'}]},{'kind':'range','upper_bound':None},{'kind':'package'},{'amount':1.1}]:
            o=offer();o['pricing'].update(update)
            out=verify_plan({'items':[item()]},matrix([o]),request([o]),NOW)
            self.assertFalse(out['budget_feasible']);self.assertIsNone(out['total_cost'])
    def test_timezone_free_and_currency(self):
        o=offer(amount=0);o['pricing']['valid_until']='2026-10-11T08:00:00+08:00'
        self.assertEqual(price_items([item()],[o],NOW)['total_cost'],'0.00')
        self.assertFalse(price_items([item()],[o],'2026-10-11T00:00:01Z')['complete'])
        self.assertFalse(price_items([item()],[o],'2026-10-11')['complete'])
        cat=[offer(),offer('e')];cat[1]['pricing']['currency']='USD'
        self.assertFalse(price_items([item(),item(resource='e')],cat,NOW)['complete'])
        self.assertFalse(verify_plan({'items':[item(resource='e')]},matrix(cat),request(cat),NOW)['budget_feasible'])
    def test_locked_preserved_conflict_unknown_balances(self):
        o=offer(amount='6000');req=request([o]);req['selected_items']=[dict(item(),locked=True,purpose='exploration')]
        out=verify_plan({'items':[]},matrix([o]),req,NOW)
        self.assertEqual(len(out['items']),1);self.assertIn('locked_selection_conflict',[e['code'] for e in out['errors']])
        o['pricing']['amount']=None;out=verify_plan({'items':[]},matrix([o]),req,NOW)
        self.assertIsNone(out['total_remaining']);self.assertIsNone(out['exploration_remaining'])
    def test_trusted_purpose_and_locked_changes(self):
        req=request([offer()]);req['selected_items']=[dict(item(),purpose='exploration')]
        out=verify_plan({'items':[item()]},matrix(req['catalog']),req,NOW)
        self.assertIn('exploration_relabel',[e['code'] for e in out['errors']]);self.assertFalse(out['budget_feasible'])
        req['selected_items']=[dict(item(),locked=True)]
        out=verify_plan({'items':[dict(item(),quantity=2)]},matrix(req['catalog']),req,NOW)
        self.assertFalse(out['budget_feasible']);self.assertEqual(out['items'][0]['quantity'],1)
    def test_matrix_channel_precheck(self):
        cat=[offer()];m=matrix(cat);req=request(cat)
        out=verify_plan({'items':[item()]},m,req,NOW)
        self.assertTrue(out['budget_feasible']);self.assertFalse(out['ready_to_publish'])
        for status,ready in [('passed',True),('failed',False)]:
            m['matrix']['candidates'][0]['manuscript_checks']=[{'article_id':'a','version':'1','status':status}]
            out=verify_plan({'items':[item()]},m,req,NOW)
            self.assertEqual(out['ready_to_publish'],ready);self.assertTrue(out['budget_feasible'])
        for state in ['pending','ineligible','research_only']:
            m['matrix']['candidates'][0]['channel_status']=state
            self.assertFalse(verify_plan({'items':[item()]},m,req,NOW)['budget_feasible'])
        self.assertFalse(verify_plan({'items':[item('a','new')]},matrix(cat),request([offer('new')]),NOW)['budget_feasible'])
    def test_package_once_and_exact_members(self):
        rows=[item(),item('b')];o=offer(amount='15');o['pricing'].update(kind='package',included_items=deepcopy(rows))
        self.assertEqual(price_items(rows,[o],NOW)['total_cost'],'15.00')
        self.assertFalse(price_items(rows[:1],[o],NOW)['complete'])
    def test_budget_presence_empty_immutability_exploration_and_range(self):
        cat=[offer()];req=request(cat);m=matrix(cat);before=deepcopy((req,m))
        self.assertFalse(verify_plan({'items':[]},m,req,NOW)['budget_feasible'])
        self.assertEqual(verify_plan({'items':[item()]},m,{},NOW)['status'],'needs_budget');self.assertEqual((req,m),before)
        req['budget']['exploration_enabled']=False
        self.assertFalse(verify_plan({'items':[dict(item(),purpose='exploration')]},m,req,NOW)['budget_feasible'])
        req['budget']['unit_price_max']='9'
        self.assertFalse(verify_plan({'items':[item()]},m,req,NOW)['budget_feasible'])

    def test_selected_offer_cannot_be_replaced_and_locked_omission_reported(self):
        cat=[offer()];req=request(cat);req['selected_items']=[item()]
        out=verify_plan({'items':[dict(item(),offer_id='cheaper')]},matrix(cat),req,NOW)
        self.assertIn('selected_offer_changed',[e['code'] for e in out['errors']])
        req['selected_items'][0]['locked']=True
        out=verify_plan({'items':[]},matrix(cat),req,NOW)
        self.assertIn('locked_selection_removed',[e['code'] for e in out['errors']])
        self.assertEqual(out['items'][0]['offer_id'],'or')
    def test_missing_fee_declaration_and_range_upper_bound(self):
        o=offer();del o['pricing']['mandatory_fees']
        self.assertFalse(price_items([item()],[o],NOW)['complete'])
        o=offer();o['pricing'].update(kind='range',upper_bound='20')
        self.assertEqual(price_items([item()],[o],NOW)['total_cost'],'20.00')
        self.assertTrue(price_items([item()],[o],NOW)['is_estimate'])
    def test_package_unit_price_limit_requires_rule(self):
        rows=[item(),item('b')];o=offer(amount='15');o['pricing'].update(kind='package',included_items=deepcopy(rows))
        req=request([o]);req['budget']['unit_price_max']='20'
        out=verify_plan({'items':rows},matrix([o]),req,NOW)
        self.assertFalse(out['budget_feasible'])
        self.assertIn('package_unit_limit_unresolved',[e['code'] for e in out['errors']])
    def test_malformed_boundaries_return_structured_errors(self):
        for rows,cat in [(None,[]),([None],[]),([dict(item(),offer_id=[])],[offer()]),([item()],None),([item()],[None]),([item()],[dict(offer(),pricing='bad')])]:
            out=price_items(rows,cat,NOW)
            self.assertFalse(out['complete']);self.assertTrue(out['errors'])
        for plan,m,req in [(None,{},{}),({},None,{}),({},{},None),({'items':None},{},{}),({}, {'matrix':None},{}),({}, {}, {'selected_items':[None]})]:
            out=verify_plan(plan,m,req,NOW)
            self.assertFalse(out['budget_feasible']);self.assertTrue(out['errors'])
    def test_two_locked_quantities_are_distinct_publications(self):
        rows=[dict(item(),locked=True),dict(item(),quantity=2,locked=True)]
        req=request([offer()]);req['selected_items']=deepcopy(rows)
        # Quantity above one requires the explicit repeat intent and channel permission
        # even for locked selections (PUBLICATION_QUANTITY contract).
        req['publication_intent']='repeat_existing_article';req['catalog'][0]['repeat_allowed']=True
        out=verify_plan({'items':rows},matrix(req['catalog']),req,NOW)
        self.assertTrue(out['budget_feasible']);self.assertEqual(len(out['items']),2)
        self.assertEqual(out['total_cost'],'30.00');self.assertEqual(out['total_remaining'],'4970.00')
    def test_cross_resource_package_is_unresolved_independent_of_order(self):
        rows=[dict(item(resource=r),offer_id='same') for r in ['r','e']]
        cat=[dict(offer(r,amount),offer_id='same') for r,amount in [('r','10'),('e','100')]]
        for o in cat:o['pricing'].update(kind='package',included_items=deepcopy(rows))
        for chosen in [rows,list(reversed(rows))]:
            out=price_items(chosen,cat,NOW)
            self.assertFalse(out['complete']);self.assertIsNone(out['total_cost'])
            self.assertEqual(out['known_total_cost'],'0.00')
    def test_range_upper_cannot_prove_minimum(self):
        o=offer();o['pricing'].update(kind='range',amount='1',upper_bound='20')
        req=request([o]);req['budget']['unit_price_min']='15'
        out=verify_plan({'items':[item()]},matrix([o]),req,NOW)
        self.assertFalse(out['budget_feasible'])
        o['pricing']['lower_bound']='16'
        self.assertTrue(verify_plan({'items':[item()]},matrix([o]),req,NOW)['budget_feasible'])
    def test_complete_package_partly_locked_has_known_balances(self):
        rows=[dict(item(),locked=True),item('b')];o=offer(amount='80');o['pricing'].update(kind='package',included_items=deepcopy(rows))
        req=request([o]);req['selected_items']=[rows[0]]
        req['budget'].update(total_cap='100',exploration_cap='50')
        out=verify_plan({'items':rows},matrix([o]),req,NOW)
        self.assertTrue(out['budget_feasible']);self.assertEqual(out['total_remaining'],'20.00')
        self.assertEqual(out['exploration_remaining'],'50.00')
    def test_matrix_version_required(self):
        for version in [None,'',False,2,[]]:
            m=matrix([offer()]);m['matrix_version']=version
            out=verify_plan({'items':[item()]},m,request([offer()]),NOW)
            self.assertFalse(out['budget_feasible']);self.assertTrue(out['errors'])
    def test_publication_identity_and_spec_types(self):
        for field in ['article_id','version','publication_spec']:
            for value in [False,True,1,1.5,[],['x']]:
                row=dict(item(),**{field:value});o=offer()
                if field=='publication_spec':o[field]=value
                out=price_items([row],[o],NOW)
                self.assertFalse(out['complete']);self.assertTrue(out['errors'])
    def test_trusted_allowed_purposes_offer_constraint(self):
        o=offer();o['allowed_purposes']=['exploration']
        out=verify_plan({'items':[item()]},matrix([o]),request([o]),NOW)
        self.assertFalse(out['budget_feasible'])
        self.assertTrue(verify_plan({'items':[dict(item(),purpose='exploration')]},matrix([o]),request([o]),NOW)['budget_feasible'])
        for invalid in [None,[],False,'exploration',['invented'],['exploration',None]]:
            o['allowed_purposes']=invalid
            self.assertFalse(price_items([item()],[o],NOW)['complete'])
        o['allowed_purposes']=['standard','exploration']
        self.assertTrue(price_items([item(),dict(item('b'),purpose='exploration')],[o],NOW)['complete'])
    def test_quantity_edit_does_not_erase_trusted_exploration(self):
        req=request([offer()]);req['selected_items']=[dict(item(),purpose='exploration')]
        out=verify_plan({'items':[dict(item(),quantity=2)]},matrix(req['catalog']),req,NOW)
        self.assertFalse(out['budget_feasible'])
        self.assertEqual(out['items'][0]['purpose'],'exploration')
