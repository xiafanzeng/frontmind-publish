"""Offline two-stage assembly. Inputs are data; no models or shopping cart actions."""
import argparse
from copy import deepcopy
from datetime import datetime
import json
import os
import re
from pathlib import Path
import sys
import tempfile
if __package__ in (None, ''):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.contracts import validate_request
from scripts.evidence import analyze_evidence
from scripts.matrix import assemble_matrix, _semantic, _digest
from scripts.budget import verify_plan, _amounts


def _error(code, path, message):
    return {'code':code,'path':path,'message':message}


def _date(value):
    parsed=datetime.fromisoformat(value.replace('Z','+00:00'))
    if parsed.tzinfo is None: raise ValueError('Timezone is required')
    return parsed


def _failure(status, errors):
    return {'schema_version':'1.0','status':status,'errors':errors,'budget_plans':[]}


def _shape(request, decisions, previous, as_of):
    errors=[]
    def check(condition,path):
        if not condition:errors.append(_error('invalid_type',path,'Expected documented JSON structure'))
    try:_date(as_of)
    except (TypeError,ValueError,AttributeError):check(False,'as_of')
    if not isinstance(request,dict):return errors
    for field in ('catalog','citations','industry_recommendations','selected_items'):
        if field in request:check(isinstance(request[field],list) and all(isinstance(x,dict) for x in request[field]),field)
    for field in ('scope','identity_config'):
        if field in request:check(isinstance(request[field],dict),field)
    task=request.get('task',{})
    if isinstance(task,dict):
        for field in ('manuscripts','selected_items'):
            if field in task:check(isinstance(task[field],list) and all(isinstance(x,dict) for x in task[field]),'task.'+field)
        for field in ('requirements','manuscript'):
            if field in task:check(isinstance(task[field],dict),'task.'+field)
    if decisions is not None:
        check(isinstance(decisions,dict),'decisions')
        if isinstance(decisions,dict):
            if 'matrix_decisions' in decisions:
                md=decisions['matrix_decisions'];check(isinstance(md,dict),'decisions.matrix_decisions')
                if isinstance(md,dict):
                    if 'items' in md:check(isinstance(md['items'],list) and all(isinstance(x,dict) for x in md['items']),'decisions.matrix_decisions.items')
                    for i,item in enumerate(md.get('items',[]) if isinstance(md.get('items',[]),list) else []):
                        if not isinstance(item,dict):continue
                        prefix=f'decisions.matrix_decisions.items[{i}]'
                        for field in ('primary_role','candidate_id','reason_summary','selection','supplemental_value','exploration_hypothesis'):
                            if field in item:check(isinstance(item[field],str),prefix+'.'+field)
                        for field in ('auxiliary_roles','matched_questions','reason_details','unconfirmed_items','verification_items','supplemental_to'):
                            if field in item:check(isinstance(item[field],list) and all(isinstance(x,str) for x in item[field]),prefix+'.'+field)
                        if 'references' in item:
                            refs=item['references'];check(isinstance(refs,list) and all(isinstance(x,dict) for x in refs),prefix+'.references')
                            for j,ref in enumerate(refs if isinstance(refs,list) else []):
                                if isinstance(ref,dict):
                                    for field in ('type','path','evidence_id','aggregate_id','usage'):
                                        if field in ref:check(isinstance(ref[field],str),f'{prefix}.references[{j}].'+field)
                    if 'fit_order' in md:check(isinstance(md['fit_order'],list) and all(isinstance(x,str) for x in md['fit_order']),'decisions.matrix_decisions.fit_order')
            if 'budget_plans' in decisions:
                plans=decisions['budget_plans'];check(isinstance(plans,list) and all(isinstance(x,dict) for x in plans),'decisions.budget_plans')
                if isinstance(plans,list):
                    for i,p in enumerate(plans):
                        if isinstance(p,dict):check(isinstance(p.get('items'),list) and all(isinstance(x,dict) for x in p['items']),f'decisions.budget_plans[{i}].items')
    if previous is not None:check(isinstance(previous,dict),'previous_matrix')
    return errors


def _binding(request):
    return {k:deepcopy(request.get(k)) for k in ('tenant_id','task_id','brand_id')}


def _report(result):
    # The report is a data view, never an independently invented narrative/number source.
    return {k:deepcopy(result[k]) for k in ('status','plan_id','plan_version','matrix_version','scope','source_analysis','matrix','budget_plans','limitations','warnings','minimum_known_cost','errors')}


def _rebind_catalog_references(decisions, old_request, current_request):
    """Translate positional references using resource IDs plus exact nonprice facts."""
    rebound=deepcopy(decisions)
    old_catalog=old_request.get('catalog',[])
    current=current_request.get('catalog',[])
    for item in rebound.get('items',[]):
        for reference in item.get('references',[]):
            if reference.get('type')!='attribute':continue
            match=re.fullmatch(r'catalog\[(\d+)\](.*)',reference.get('path',''))
            if not match:continue
            original=old_catalog[int(match[1])]
            rid=original.get('resource_id')
            matches=[i for i,row in enumerate(current) if rid and row.get('resource_id')==rid and _semantic(row)==_semantic(original)]
            if not matches:raise ValueError('No exact trusted resource-attribute mapping for reference')
            reference['path']=f'catalog[{matches[0]}]'+match[2]
    return rebound


def _semantic_readiness(verified, result):
    candidates = {c.get('resource_id'): c for c in result['matrix']['candidates'] if c.get('resource_id')}
    pending = []
    for item in verified['items']:
        candidate = candidates.get(item.get('resource_id'), {})
        if not (candidate.get('semantic_decision_validated')
                and candidate.get('selection') in ('recommended', 'alternative')
                and candidate.get('matched_questions')):
            pending.append({'code': 'matrix_decision_required', 'resource_id': item.get('resource_id'),
                            'locked': bool(item.get('locked')),
                            'message': '保留发布项及费用；补齐并校验第一阶段适配判断后才能推荐执行'})
    verified['semantic_pending'] = pending
    verified['semantic_ready'] = not pending and bool(verified['items'])
    verified['execution_recommended'] = verified['ready_to_publish'] and verified['semantic_ready']


def _minimum_known_cost(request, result):
    """A narrow proof for declared publications, never a three-plan optimizer."""
    currency = request.get('budget', {}).get('currency')
    out = {'status': 'unproven', 'scope': 'unique_candidate_offer_and_declared_publications',
           'currency': currency, 'reason': 'requires_unique_candidate_offer_and_complete_declared_publications',
           'items': []}
    _amounts(out, {'total_cost': None, 'funding_gap': None}, currency)
    catalog = request.get('catalog', [])
    offers = {json.dumps(o, sort_keys=True, ensure_ascii=False) for o in catalog}
    candidates = [c for c in result['matrix']['candidates'] if c.get('resource_id')]
    plans = result['budget_plans']
    if len(candidates) != 1 or len(offers) != 1 or len(plans) != 1:
        return out
    offer = catalog[0]
    plan = plans[0]
    manuscripts = request['task'].get('manuscripts') or [request['task'].get('manuscript', {})]
    declared = [(m.get('article_id'), m.get('version')) for m in manuscripts]
    if ((offer.get('pricing') or {}).get('kind') != 'unit' or not plan.get('complete')
            or not plan.get('semantic_ready') or candidates[0]['channel_status'] != 'eligible'
            or any((item.get('article_id'), item.get('version')) not in declared for item in plan['items'])
            or any(error['code'] not in ('total_cap_exceeded', 'exploration_cap_exceeded', 'locked_selection_conflict') for error in plan['errors'])
            or plan.get('currency') != currency or plan.get('total_cap_minor') is None):
        out['reason'] = 'exact_unit_cost_or_declared_scope_not_proven; packages_ranges_and_other_constraints_not_optimized'
        return out
    out.update(status='confirmed_for_declared_publications', reason='唯一目录候选及唯一完整单次报价，仅证明所列已声明发布项；不声称完整任务或全局最优',
               items=deepcopy(plan['items']))
    _amounts(out, {'total_cost': plan['total_cost_minor'],
                  'funding_gap': max(0, plan['total_cost_minor'] - plan['total_cap_minor'])}, currency)
    return out


def run(request: dict, decisions: dict | None, stage: str, previous_matrix: dict | None, as_of: str) -> dict:
    errors=validate_request(request,stage)+_shape(request,decisions,previous_matrix,as_of)
    if errors:return _failure('invalid_input',errors)
    request=deepcopy(request);decisions=deepcopy(decisions or {})
    if set(decisions)-{'matrix_decisions','budget_plans'}:
        return _failure('invalid_input',[_error('unknown_field','decisions','Use matrix_decisions and budget_plans containers')])
    try:
        analysis=analyze_evidence(request.get('citations',[]),request.get('scope',{}),request.get('identity_config',{}))
        md=decisions.get('matrix_decisions',{})
        if stage=='budget':
            if previous_matrix is None:return _failure('needs_matrix',[_error('matrix_required','previous_matrix','Budget stage requires complete matrix snapshot')])
            snapshot=previous_matrix.get('snapshot',{})
            if not isinstance(snapshot,dict):return _failure('invalid_input',[_error('invalid_type','snapshot','Snapshot metadata must be object')])
            expired=snapshot.get('expires_at') and _date(as_of)>_date(snapshot['expires_at'])
            fresh=assemble_matrix(request,analysis,{})
            if expired or snapshot.get('binding')!=_binding(request) or fresh['matrix_version']!=previous_matrix.get('matrix_version'):
                return _failure('stale_matrix',[_error('stale_matrix','previous_matrix','Task, evidence or semantic catalog changed, or snapshot expired; regenerate matrix')])
            md=snapshot.get('matrix_decisions',{})
            if decisions.get('matrix_decisions') is not None and decisions['matrix_decisions']!=md:
                return _failure('invalid_decisions',[_error('matrix_decisions_changed','decisions.matrix_decisions','Budget stage must preserve original semantic decisions')])
            original_request=previous_matrix.get('scope',{}).get('input_snapshot')
            if not isinstance(original_request,dict):
                return _failure('stale_matrix',[_error('snapshot_input_required','previous_matrix.scope.input_snapshot','Original trusted request is required to rebind references')])
            md=_rebind_catalog_references(md,original_request,request)
        result=assemble_matrix(request,analysis,md)
        if any(e['code']=='invalid_type' for e in result['errors']):
            return _failure('invalid_input',result['errors'])
    except (TypeError,ValueError,AttributeError,KeyError,IndexError) as exc:
        return _failure('invalid_input',[_error('invalid_structure','request','Malformed nested input: '+type(exc).__name__)])
    result['stage']=stage;result['as_of']=as_of
    result['snapshot']={'binding':_binding(request),'matrix_decisions':deepcopy(md),'generated_at':as_of}
    if stage=='budget' and previous_matrix.get('snapshot',{}).get('expires_at'):
        result['snapshot']['expires_at']=previous_matrix['snapshot']['expires_at']
    result['scope']['input_snapshot']=deepcopy(request)
    result['scope']['generated_at']=as_of
    result['selected_items']=deepcopy(request.get('selected_items',request['task'].get('selected_items',[])))
    if stage!='matrix' and result['matrix']['status']=='complete':
        plans=decisions.get('budget_plans',[]);unique={};plan_errors=[]
        for i,plan in enumerate(plans):
            if set(plan)-{'strategy','reason_summary','items','coverage','gaps','tradeoffs','unconfirmed_items'}:
                plan_errors.append(_error('untrusted_plan_field',f'budget_plans[{i}]','Plans may supply only choices and explanatory fields'))
            if any(not isinstance(plan.get(k),str) or not plan[k].strip() for k in ('strategy','reason_summary')):
                plan_errors.append(_error('missing_plan_reason',f'budget_plans[{i}]','Explicit strategy and reason_summary are required'))
            choice_fields={'article_id','version','resource_id','offer_id','publication_spec','quantity','purpose'}
            for j,item in enumerate(plan['items']):
                if set(item)-choice_fields:
                    plan_errors.append(_error('untrusted_item_field',f'budget_plans[{i}].items[{j}]','AI items accept only publication choice fields; locks and facts must come from trusted request'))
            # Ignore order, duplicated item rows and display-only metadata for combination equality.
            fields=('article_id','version','resource_id','offer_id','publication_spec','quantity','purpose')
            signature=tuple(sorted({json.dumps({k:item.get(k) for k in fields},sort_keys=True,ensure_ascii=False) for item in plan['items']}))
            unique.setdefault(signature,plan)
        if len(unique)>3:plan_errors.append(_error('too_many_plans','budget_plans','At most three distinct meaningful plans are accepted'))
        if plan_errors:result['status']='invalid_decisions';result['errors'].extend(plan_errors)
        else:
            for plan in unique.values():
                try:
                    verified=verify_plan(plan,result,request,as_of)
                except (TypeError,ValueError,AttributeError,KeyError,IndexError) as exc:
                    return _failure('invalid_input',[_error('invalid_structure','budget_plans','Malformed nested input: '+type(exc).__name__)])
                if any(e['code']=='invalid_type' for e in verified['errors']):
                    return _failure('invalid_input',verified['errors'])
                for key in ('strategy','reason_summary','coverage','gaps','tradeoffs','unconfirmed_items'):
                    if key in plan:verified[key]=deepcopy(plan[key])
                _semantic_readiness(verified, result)
                result['budget_plans'].append(verified)
            result['status']='needs_budget' if 'budget' not in request else 'needs_budget_plans' if not unique else 'complete'
    result['warnings'] = []
    budget = request.get('budget', {})
    if budget.get('exploration_enabled') is True and budget.get('exploration_cap') is None:
        result['warnings'].append({'code': 'exploration_cap_required', 'path': 'budget.exploration_cap',
                                   'message': '探索已启用，请补充子上限；普通方案仍可复核'})
    result['minimum_known_cost'] = _minimum_known_cost(request, result)
    identity = _binding(request)
    if not request.get('task_id'):
        identity['research_task'] = _semantic(request['task'])
    result['plan_id'] = 'plan-' + _digest(identity)
    result['plan_version'] = 'plan-version-' + _digest({'request': request, 'matrix_decisions': md,
        'budget_plans': result['budget_plans'], 'status': result['status'], 'matrix_version': result['matrix_version']})
    result['report']=_report(result)
    return result


def _load(path):
    def reject(value):raise ValueError('Nonfinite JSON numbers are unsupported: '+value)
    with open(path,encoding='utf-8') as handle:return json.load(handle,parse_constant=reject)


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input',required=True);parser.add_argument('--decisions')
    parser.add_argument('--stage',choices=('matrix','budget','both'),default='both')
    parser.add_argument('--matrix');parser.add_argument('--as-of',required=True);parser.add_argument('--output',required=True)
    args=parser.parse_args(argv)
    try:
        result=run(_load(args.input),_load(args.decisions) if args.decisions else None,args.stage,_load(args.matrix) if args.matrix else None,args.as_of)
        if result['status']=='invalid_input':
            print(json.dumps(result,ensure_ascii=False),file=sys.stderr);return 2
        destination=Path(args.output);temporary=None
        try:
            with tempfile.NamedTemporaryFile(mode='w',encoding='utf-8',dir=destination.parent,prefix='.'+destination.name+'.',delete=False) as handle:
                temporary=handle.name;json.dump(result,handle,ensure_ascii=False,indent=2,allow_nan=False);handle.write('\n');handle.flush();os.fsync(handle.fileno())
            os.replace(temporary,destination)
        finally:
            if temporary and os.path.exists(temporary):os.unlink(temporary)
    except (OSError,ValueError,TypeError) as exc:
        print(json.dumps(_failure('invalid_input',[_error('input_or_output_error','$',str(exc))]),ensure_ascii=False),file=sys.stderr);return 2
    return 0

if __name__=='__main__':sys.exit(main())
