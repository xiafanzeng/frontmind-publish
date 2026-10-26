import sys
import unittest
from copy import deepcopy
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.matrix import prepare_candidates, validate_decisions, assemble_matrix


def request():
    return {'task': {'industry':'医疗', 'questions':[{'question_id':'q1','text':'如何选择服务？'}],
                     'regions':'nationwide','manuscripts':[{'article_id':'a1','version':'1','content':'正文'}]},
            'catalog':[{'resource_id':'r1','offer_id':'o1','source_name':'医学刊物','domain':'med.test',
                        'publication_status':'available','industry':['医疗'],'price':'100','currency':'CNY'}]}


def decision(cid='resource:r1', role='industry'):
    return {'items':[{'candidate_id':cid,'primary_role':role,'auxiliary_roles':[],
                     'matched_questions':['q1'],'references':[{'type':'attribute','path':'catalog[0].industry'}],
                     'reason_summary':'专业读者与问题相关','reason_details':['行业适配'],
                     'unconfirmed_items':[],'selection':'recommended'}], 'fit_order':[cid]}


class MatrixTests(unittest.TestCase):
    def test_missing_decisions_not_recommendation(self):
        result=assemble_matrix(request(),{}, {})
        self.assertEqual(result['status'],'needs_ai_decisions')
        self.assertEqual(result['matrix']['fit_order'],[])
    def test_observed_sources_preserved_without_forced_purchase(self):
        a={'actual_sources':[{'identity':{'source_name':'不可购研究源'},'evidence_ids':['e1'],'scope':{'question_id':'q1'}}]}
        out=assemble_matrix(request(),a,decision())
        self.assertEqual(out['source_analysis'],a)
        self.assertEqual(len(out['matrix']['candidates']),2)
        self.assertEqual(out['matrix']['fit_order'],['resource:r1'])
    def test_catalog_free_recommendation_research_only(self):
        r=request();r.pop('catalog');r['industry_recommendations']=[{'recommendation_id':'rec1','source_name':'旧名称'}]
        c=prepare_candidates(r,{})['candidates'][0]
        self.assertEqual(c['channel_status'],'research_only');self.assertIsNone(c['resource_id'])
    def test_missing_manuscript_is_independently_pending(self):
        r=request();r['task'].pop('manuscripts')
        c=prepare_candidates(r,{})['candidates'][0]
        self.assertEqual(c['channel_status'],'eligible');self.assertEqual(c['manuscript_status'],'needs_manuscript_check')
    def test_multi_manuscript_is_not_discarded(self):
        r=request();r['task']['manuscripts'].append({'article_id':'a2','version':'2'})
        c=prepare_candidates(r,{})['candidates'][0]
        self.assertEqual([x['article_id'] for x in c['manuscripts']],['a1','a2'])
    def test_nationwide_does_not_create_regional_role(self):
        self.assertTrue(validate_decisions(decision(role='regional'),prepare_candidates(request(),{}),request()))
    def test_missing_regions_not_nationwide(self):
        r=request();r['task'].pop('regions');self.assertIn('missing_regions',prepare_candidates(r,{})['limitations'])
    def test_duplicate_offers_one_resource(self):
        r=request();r['catalog'].append(dict(r['catalog'][0],offer_id='o2',price='200'))
        c=prepare_candidates(r,{})['candidates'];self.assertEqual(len(c),1);self.assertEqual(len(c[0]['offers']),2)
    def test_hard_failure_and_unknown_conditions(self):
        r=request();r['task']['requirements']={'formats':['video']};r['catalog'][0]['supported_formats']=['text']
        self.assertEqual(prepare_candidates(r,{})['candidates'][0]['channel_status'],'ineligible')
        r['catalog'][0].pop('supported_formats')
        self.assertEqual(prepare_candidates(r,{})['candidates'][0]['channel_status'],'pending')
    def test_unknown_requirement_is_pending(self):
        r=request();r['task']['requirements']={'embargo':'2027-01-01'}
        self.assertEqual(prepare_candidates(r,{})['candidates'][0]['channel_status'],'pending')
    def test_ai_cannot_overwrite_trusted_fields(self):
        for field,value in [('channel_status','eligible'),('evidence_relation','exact'),('resource_id','new'),('score',99),('offers',[])]:
            d=decision();d['items'][0][field]=value
            self.assertTrue(validate_decisions(d,prepare_candidates(request(),{}),request()),field)
    def test_fake_candidate_question_evidence_path_rejected(self):
        variants=[]
        d=decision('fake');variants.append(d)
        d=decision();d['items'][0]['matched_questions']=['fake'];variants.append(d)
        d=decision();d['items'][0]['references']=[{'type':'evidence','evidence_id':'fake'}];variants.append(d)
        d=decision();d['items'][0]['references']=[{'type':'attribute','path':'catalog[99].industry'}];variants.append(d)
        d=decision();d['items'][0]['references']=[];variants.append(d)
        for d in variants:self.assertTrue(validate_decisions(d,prepare_candidates(request(),{}),request()))
    def test_price_reference_forbidden(self):
        d=decision();d['items'][0]['references']=[{'type':'attribute','path':'catalog[0].price'}]
        self.assertTrue(validate_decisions(d,prepare_candidates(request(),{}),request()))
    def test_exploration_and_supplement_need_explanations(self):
        for role in ['exploration','supplement']:
            self.assertTrue(validate_decisions(decision(role=role),prepare_candidates(request(),{}),request()))
    def test_role_uniqueness(self):
        d=decision();d['items'][0]['auxiliary_roles']=['industry']
        self.assertTrue(validate_decisions(d,prepare_candidates(request(),{}),request()))
        d=decision();d['items'].append(deepcopy(d['items'][0]))
        self.assertTrue(validate_decisions(d,prepare_candidates(request(),{}),request()))
    def test_no_citations_can_still_be_industry(self):
        out=assemble_matrix(request(),{},decision());self.assertEqual(out['status'],'complete')
        self.assertEqual(out['matrix']['candidates'][0]['primary_role'],'industry')
        self.assertEqual(out['matrix']['candidates'][0]['evidence_relation'],'none')
    def test_budget_and_price_do_not_change_version_or_order(self):
        r=request();a=assemble_matrix(r,{},decision())
        r['budget']={'total_cap':'1000','currency':'CNY'};r['catalog'][0]['price']='999'
        r['catalog'][0]['quote_valid_until']='2027-01-01'
        b=assemble_matrix(r,{},decision());self.assertEqual(a['matrix_version'],b['matrix_version']);self.assertEqual(a['matrix']['fit_order'],b['matrix']['fit_order'])
        r['task']['questions'][0]['text']='另一个目标'
        self.assertNotEqual(b['matrix_version'],assemble_matrix(r,{},decision())['matrix_version'])
    def test_media_properties_change_version(self):
        r=request();a=prepare_candidates(r,{})['matrix_version'];r['catalog'][0]['industry']=['制造业']
        self.assertNotEqual(a,prepare_candidates(r,{})['matrix_version'])
    def test_conflicting_supplier_attributes_pending(self):
        r=request();r['catalog'].append(dict(r['catalog'][0],offer_id='o2',industry=['制造业']))
        self.assertEqual(prepare_candidates(r,{})['candidates'][0]['channel_status'],'pending')
    def test_evidence_bound_to_candidate_and_question(self):
        r=request();a={'actual_sources':[{'identity':{'source_name':'医学刊物','domain':'med.test'},'scope':{'question_id':'q2'},'evidence_ids':['e1']}]}
        d=decision();d['items'][0]['references']=[{'type':'evidence','evidence_id':'e1'}]
        self.assertTrue(validate_decisions(d,prepare_candidates(r,a),r))
        a['actual_sources'][0]['scope']['question_id']='q1'
        self.assertEqual(validate_decisions(d,prepare_candidates(r,a),r),[])
        a['actual_sources'][0]['identity']={'source_name':'别的刊物','domain':'else.test'}
        self.assertTrue(validate_decisions(d,prepare_candidates(r,a),r))
    def test_other_candidate_attribute_not_allowed(self):
        r=request();r['catalog'].append(dict(r['catalog'][0],resource_id='r2'))
        d=decision();d['items'][0]['references']=[{'type':'attribute','path':'catalog[1].industry'}]
        self.assertTrue(validate_decisions(d,prepare_candidates(r,{}),r))
    def test_hard_failure_cannot_be_lost_in_conflict(self):
        r=request();r['catalog'].append(dict(r['catalog'][0],offer_id='o2',publication_status='closed'))
        out=assemble_matrix(r,{},decision());self.assertEqual(out['matrix']['candidates'][0]['channel_status'],'ineligible')
    def test_legacy_manuscript_only_when_explicit(self):
        r=request();r['task'].pop('manuscripts');r['task']['manuscript']={'article_id':'legacy','version':'1'}
        self.assertEqual(prepare_candidates(r,{})['candidates'][0]['manuscripts'][0]['article_id'],'legacy')
    def test_trusted_manuscript_checks_and_multiarticle_failure(self):
        r=request();r['catalog'][0]['manuscript_checks']=[{'article_id':'a1','version':'1','status':'pass'}]
        self.assertEqual(prepare_candidates(r,{})['candidates'][0]['manuscript_status'],'passed')
        r['task']['manuscripts'].append({'article_id':'a2','version':'1'})
        self.assertEqual(prepare_candidates(r,{})['candidates'][0]['manuscript_status'],'needs_manuscript_check')
    def test_malformed_supplement_references_return_errors(self):
        d=decision(role='supplement');d['items'][0]['supplemental_to']=[{}]
        self.assertTrue(validate_decisions(d,prepare_candidates(request(),{}),request()))
    def test_platform_reference_does_not_upgrade_identity(self):
        r=request();r['catalog'][0].update(domain='news.portal.test',source_name='具体账号',account_id='acc')
        r['identity_config']={'platform_domains':['portal.test']}
        a={'actual_sources':[{'identity':{'source_name':'门户','domain':'portal.test'},'scope':{'question_id':'q1'},'evidence_ids':['e1']}]}
        d=decision();d['items'][0]['references']=[{'type':'evidence','evidence_id':'e1'}]
        out=assemble_matrix(r,a,d)
        self.assertEqual(out['status'],'complete');self.assertEqual(out['matrix']['candidates'][0]['evidence_relation'],'platform_related')
    def test_conflict_version_order_independent(self):
        r=request();r['catalog'].append(dict(r['catalog'][0],offer_id='o2',industry=['制造业']))
        a=prepare_candidates(r,{})
        r['catalog'].reverse();b=prepare_candidates(r,{})
        self.assertEqual(a['matrix_version'],b['matrix_version'])
        self.assertEqual(a['candidates'][0]['channel_status'],b['candidates'][0]['channel_status'])
    def test_conflicting_identity_is_unverified_and_order_independent(self):
        r=request();r['catalog'].append(dict(r['catalog'][0],offer_id='o2',source_name='另一站点',domain='other.test'))
        a={'actual_sources':[{'identity':{'source_name':'医学刊物','domain':'med.test'},'scope':{'question_id':'q1'},'evidence_ids':['e1']}]}
        d=decision();d['items'][0]['references']=[{'type':'evidence','evidence_id':'e1'}]
        first=prepare_candidates(r,a);errors=validate_decisions(d,first,r)
        r['catalog'].reverse();second=prepare_candidates(r,a)
        self.assertEqual(first['matrix_version'],second['matrix_version'])
        for field in ('attributes','attribute_variants','evidence_relation','evidence_ids','identity_matches'):
            self.assertEqual(first['candidates'][0][field],second['candidates'][0][field],field)
        self.assertEqual(first['candidates'][0]['evidence_relation'],'unverified')
        self.assertNotIn('domain',first['candidates'][0]['attributes'])
        self.assertEqual(errors,validate_decisions(d,second,r))
        self.assertEqual(len(first['candidates']),len(second['candidates']))
    def test_conflicting_regions_consistently_reject_regional_role(self):
        r=request();r['task']['regions']=['北京'];r['catalog'][0]['regions']=['北京']
        r['catalog'].append(dict(r['catalog'][0],offer_id='o2',regions=['上海']))
        d=decision(role='regional');first=prepare_candidates(r,{})
        errors=validate_decisions(d,first,r)
        r['catalog'].reverse();second=prepare_candidates(r,{})
        self.assertEqual(first['matrix_version'],second['matrix_version'])
        self.assertEqual(errors,validate_decisions(d,second,r))
        self.assertIn('regional_coverage_unconfirmed',[e['code'] for e in errors])
        self.assertNotIn('regions',first['candidates'][0]['attributes'])
    def test_conflicting_attribute_reference_is_consistently_rejected(self):
        r=request();r['catalog'].append(dict(r['catalog'][0],offer_id='o2'))
        r['catalog'][0]['regions']=['北京']
        d=decision();d['items'][0]['references']=[{'type':'attribute','path':'catalog[0].regions'}]
        first=prepare_candidates(r,{});errors=validate_decisions(d,first,r)
        r['catalog'].reverse();second=prepare_candidates(r,{})
        self.assertTrue(errors);self.assertEqual(errors,validate_decisions(d,second,r))
    def test_inputs_immutable(self):
        r=request();d=decision();orig=deepcopy((r,d));assemble_matrix(r,{},d);self.assertEqual((r,d),orig)

if __name__=='__main__':unittest.main()
