"""Versioned, nonexecuting content/quote plan validator. Never creates articles.

Website uses the native TypeScript implementation in website-runtime; this
offline entry accepts a trusted normalized website snapshot or export_research
result plus explicit adapter-owned candidate_to_resource mappings.
"""
import argparse
from copy import deepcopy
from datetime import datetime
import json
from pathlib import Path
import sys
import tempfile
import os
if __package__ in (None, ''):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.budget import price_items, _amounts, _money
from scripts.contracts import validate_budget
from scripts.matrix import _channel, _merge_attributes

ITEM_FIELDS={'candidate_id','resource_id','offer_id','publication_spec','quantity','quantity_mode','content_tasks','purpose','quantity_reason'}
PLAN_FIELDS={'strategy','reason_summary','items','explanation'}
def text(v): return isinstance(v,str) and bool(v.strip())
def texts(v): return isinstance(v,list) and all(text(x) for x in v)
def error(code,path): return {'code':code,'path':path,'message':code}

def verify_content_plans(request, matrix, decisions, as_of):
    """Returns proposals only. This does not turn an observation into an offer."""
    try:
        now=datetime.fromisoformat(as_of.replace('Z','+00:00'))
        if now.tzinfo is None: raise ValueError()
    except (TypeError,ValueError,AttributeError):
        return {'status':'invalid_input','content_plans':[],'errors':[error('timezone_required','as_of')]}
    if not isinstance(request,dict) or not isinstance(matrix,dict) or not isinstance(decisions,list) or len(decisions)>3:
        return {'status':'invalid_input','content_plans':[],'errors':[error('invalid_type','$')]}
    if not isinstance(matrix.get('matrix'),(dict,list)) or (request.get('budget') is not None and not isinstance(request['budget'],dict)):
        return {'status':'invalid_input','content_plans':[],'errors':[error('invalid_type','matrix/budget')]}
    is_export=isinstance(matrix.get('matrix'),list)
    if (is_export and matrix.get('status')!='research_draft') or (not is_export and matrix.get('matrix',{}).get('status')!='complete'):
        return {'status':'invalid_input','content_plans':[],'errors':[error('validated_matrix_required','matrix')]}
    original=matrix['matrix'] if is_export else matrix['matrix']['candidates']
    candidates={str(c.get('candidate_key') if is_export else c.get('candidate_id')):c for c in original if (c.get('disposition')!='hold' if is_export else c.get('semantic_decision_validated') and c.get('selection') in ('recommended','alternative'))}
    expected_version=matrix.get('input_version') if is_export else matrix.get('matrix_version')
    if request.get('matrix_version')!=expected_version:
        return {'status':'stale_matrix','content_plans':[],'errors':[error('matrix_version_mismatch','request.matrix_version')]}
    budget=request.get('budget');catalog=request.get('catalog',[]);plans=[];errors=[];seen=set()
    if not isinstance(catalog,list) or any(not isinstance(x,dict) for x in catalog):
        return {'status':'invalid_input','content_plans':[],'errors':[error('invalid_catalog','catalog')]}
    for index,plan in enumerate(decisions):
        path=f'content_plans[{index}]'; before=len(errors)
        if not isinstance(plan,dict) or set(plan)-PLAN_FIELDS or not text(plan.get('strategy')) or not text(plan.get('reason_summary')) or not isinstance(plan.get('items'),list) or not plan['items']:
            errors.append(error('invalid_content_plan',path));continue
        ids=[x.get('candidate_id') for x in plan['items'] if isinstance(x,dict)]
        if len(set(ids))!=len(ids) or len(ids)!=len(plan['items']):errors.append(error('duplicate_or_invalid_candidate',path))
        explanation=plan.get('explanation',{})
        allowed={'objective','selection_logic','content_allocation','tradeoffs','excluded_candidates','fit_conditions','verification_items'}
        if not isinstance(explanation,dict) or set(explanation)!=allowed:
            errors.append(error('explanation_required',path));continue
        if not text(explanation.get('objective')) or any(not texts(explanation.get(k)) or not explanation[k] for k in ('selection_logic','tradeoffs','fit_conditions','verification_items')):
            errors.append(error('invalid_explanation',path))
        allocation=explanation.get('content_allocation')
        if not isinstance(allocation,list) or any(not isinstance(x,dict) or set(x)!={'candidate_id','responsibility','content_angle'} or not text(x['responsibility']) or not text(x['content_angle']) for x in allocation) or sorted(x.get('candidate_id','') for x in allocation if isinstance(x,dict))!=sorted(ids):
            errors.append(error('allocation_must_cover_selected',path))
        excluded=explanation.get('excluded_candidates')
        if not isinstance(excluded,list) or any(not isinstance(x,dict) or set(x)!={'candidate_id','reason'} or x['candidate_id'] not in candidates or x['candidate_id'] in ids or not text(x['reason']) for x in excluded):errors.append(error('invalid_excluded_candidate',path))
        unknown=[]; mode='repeat_article' if request.get('publication_intent')=='repeat_existing_article' else 'new_articles'
        for i,item in enumerate(plan['items']):
            p=f'{path}.items[{i}]'
            if not isinstance(item,dict) or set(item)-ITEM_FIELDS or item.get('candidate_id') not in candidates:
                errors.append(error('untrusted_content_item',p));continue
            c=candidates[item['candidate_id']];q=item.get('quantity')
            if type(q) is not int or not 1<=q<=100 or item.get('quantity_mode')!=mode or item.get('purpose') not in ('standard','exploration') or not text(item.get('quantity_reason')) or not texts(item.get('content_tasks')):
                errors.append(error('invalid_content_quantity',p));continue
            mapping=[m for m in request.get('resource_selections',[]) if isinstance(m,dict) and m.get('candidate_id')==item['candidate_id']]
            confirmed=[m for m in request.get('candidate_to_resource',[]) if isinstance(m,dict) and m.get('candidate_id')==item['candidate_id'] and m.get('resource_id')==item.get('resource_id') and m.get('status')=='confirmed']
            if item.get('resource_id') and item['resource_id']!=c.get('resource_id') and not confirmed and not any(all(m.get(k)==item.get(k) for k in ('resource_id','offer_id','publication_spec')) for m in mapping):errors.append(error('resource_mapping_requires_confirmation',p))
            if mapping and not any(all(m.get(k)==item.get(k) for k in ('resource_id','offer_id','publication_spec')) for m in mapping):errors.append(error('selected_resource_changed',p))
            matches=[o for o in catalog if o.get('resource_id')==item.get('resource_id') and o.get('offer_id')==item.get('offer_id') and o.get('publication_spec')==item.get('publication_spec')]
            if mode=='new_articles' and len(item['content_tasks'])!=q:unknown.append({'candidate_id':item['candidate_id'],'reasons':['content_tasks_incomplete']})
            if mode=='repeat_article' and (not request.get('task',{}).get('manuscripts') or len(matches)!=1 or matches[0].get('repeat_allowed') is not True):unknown.append({'candidate_id':item['candidate_id'],'reasons':['repeat_publication_not_authorized']})
            if c.get('channel_status')=='ineligible' or c.get('hard_failures'):unknown.append({'candidate_id':item['candidate_id'],'reasons':['channel_not_eligible']})
            if item.get('resource_id'):
                resource_rows=[(n,o) for n,o in enumerate(catalog) if o.get('resource_id')==item['resource_id']]
                # Use the same nonprice channel rules as matrix preparation.
                # A matching offer cannot bypass image/industry/region rules or
                # conflicting supplier attributes for the mapped resource.
                conflicts=_merge_attributes(resource_rows)[2] if resource_rows else []
                if not resource_rows or conflicts or any(_channel(o,request.get('task',{}))[0]!='eligible' for _,o in resource_rows):
                    unknown.append({'candidate_id':item['candidate_id'],'reasons':['channel_conditions_unconfirmed']})
        if before!=len(errors):continue
        key=json.dumps(sorted(plan['items'],key=lambda x:x['candidate_id']),sort_keys=True,ensure_ascii=False)
        if key in seen:errors.append(error('duplicate_content_plan',path));continue
        seen.add(key)
        priced=price_items(plan['items'],catalog,as_of,publication_identity=False)
        plan_errors=list(priced['errors'])+(validate_budget(budget) if budget is not None else [])
        currency=(budget or {}).get('currency') or priced['currency'];cap=_money((budget or {}).get('total_cap'),currency);ecap=_money((budget or {}).get('exploration_cap'),currency)
        total=priced['total_cost_minor'];ecost=priced['exploration_cost_minor']
        unit_min=_money((budget or {}).get('unit_price_min'),currency);unit_max=_money((budget or {}).get('unit_price_max'),currency)
        if (unit_min is not None or unit_max is not None) and any(o.get('pricing',{}).get('kind')=='package' and any(x.get('resource_id')==o.get('resource_id') and x.get('offer_id')==o.get('offer_id') for x in plan['items']) for o in catalog):plan_errors.append(error('package_unit_limit_unresolved',path))
        for detail in priced['details']:
            amount=detail['cost_minor'];lower=detail['lower_cost_minor'];q=detail['item']['quantity']
            if amount is None:continue
            if unit_min is not None:
                if lower is None:plan_errors.append(error('unit_price_min_unresolved',path))
                elif lower<unit_min*q:plan_errors.append(error('unit_price_below_min',path))
            if unit_max is not None and amount>unit_max*q:plan_errors.append(error('unit_price_above_max',path))
        if priced['currency'] and currency!=priced['currency']:plan_errors.append(error('currency_mismatch',path))
        if total is not None and cap is not None and total>cap:plan_errors.append(error('total_cap_exceeded',path))
        if any(x['purpose']=='exploration' for x in plan['items']):
            if not budget or budget.get('exploration_enabled') is not True or ecap is None or ecap<=0:plan_errors.append(error('exploration_not_enabled',path))
            elif ecost is not None and ecost>ecap:plan_errors.append(error('exploration_cap_exceeded',path))
        locked=[deepcopy(x) for x in request.get('selected_items',[]) if isinstance(x,dict) and x.get('locked') is True]
        if locked:unknown.append({'reasons':['locked_publications_require_formal_plan'],'items':locked})
        complete=priced['complete'] and not unknown
        out={**deepcopy(plan),'schema_version':'content-planning/1.0','matrix_version':expected_version,'details':priced['details'],'kind':'quoted_content_plan' if any(x.get('resource_id') for x in plan['items']) else 'research_content_plan','total_articles':sum(x['quantity'] for x in plan['items']),'currency':currency,'total_cost':priced['total_cost'],'known_total_cost':priced['known_total_cost'],'budget_feasible':bool(budget and not plan_errors) if complete else None,'ready_to_publish':False,'execution_recommended':False,'cart_eligible':False,'unknown_items':priced['unknown_items']+unknown,'errors':plan_errors,'retained_locked_items':locked}
        _amounts(out,{'total_cap':cap,'total_remaining':cap-total if complete and cap is not None and total is not None else None,'exploration_cap':ecap,'exploration_remaining':ecap-ecost if complete and ecap is not None and ecost is not None else None},currency)
        plans.append(out)
    return {'schema_version':'content-planning/1.0','status':'invalid_decisions' if errors else 'complete','content_plans':[] if errors else plans,'errors':errors}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--input',required=True);parser.add_argument('--matrix',required=True);parser.add_argument('--decisions',required=True);parser.add_argument('--as-of',required=True);parser.add_argument('--output',required=True);args=parser.parse_args()
    load=lambda p:json.loads(Path(p).read_text(encoding='utf-8'))
    result=verify_content_plans(load(args.input),load(args.matrix),load(args.decisions),args.as_of)
    if result['status'] in ('invalid_input','invalid_decisions','stale_matrix'):
        print(json.dumps(result,ensure_ascii=False),file=sys.stderr);return 2
    target=Path(args.output);target.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.NamedTemporaryFile('w',encoding='utf-8',dir=target.parent,delete=False) as stream:
        json.dump(result,stream,ensure_ascii=False,indent=2);temp=stream.name
    os.replace(temp,target);return 0
if __name__=='__main__':raise SystemExit(main())
