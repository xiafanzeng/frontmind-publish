"""无预算候选、可审计的 AI 语义决定；不执行输入文本、不推断报价。"""
from copy import deepcopy
from hashlib import sha256
import json
import re
import math
from .evidence import match_identity, _domain

ROLES = {'authority':'权威参考', 'industry':'行业核心', 'regional':'地域覆盖',
         'supplement':'覆盖补充', 'exploration':'探索验证'}
# Supplier/offer identity and billing metadata do not describe editorial fitness.
PRICE_FIELDS = {'publication_spec','allowed_purposes','budget','selected_items','offer_id','supplier','supplier_id','price','unit_price',
                'currency','quote_date','quoted_at','quote_valid_until','valid_until','expires_at',
                'pricing_basis','billing_basis','billing_unit','pricing','fees','mandatory_fees',
                'tax','taxes','service_fee','price_min','price_max','quote','quotes','total_cap',
                'exploration_cap','unit_price_min','unit_price_max','quantity','article_quantity',
                'min_quantity','max_quantity','repeat_allowed','provider_execution','provider_resource_id','catalog_revision','quote_fingerprint','quote_status','publication_intent'}
IDENTITY_FIELDS = {'source_name','domain','account_id','channel_id','source_identity','url','citation_url'}
DECISION_FIELDS = {'candidate_id','primary_role','auxiliary_roles','matched_questions','references',
                   'reason_summary','reason_details','unconfirmed_items','selection',
                   'supplemental_value','supplemental_to','exploration_hypothesis','verification_items',
                   'media_intro','content_direction','layer_rank','ranking_reason'}


def _json(obj):
    return json.dumps(obj,ensure_ascii=False,sort_keys=True,separators=(',',':'))


def _semantic(obj):
    if isinstance(obj,dict):
        return {k:_semantic(v) for k,v in obj.items() if k not in PRICE_FIELDS}
    if isinstance(obj,list):
        return [_semantic(v) for v in obj]
    return obj


def _digest(obj):
    return sha256(_json(obj).encode()).hexdigest()[:24]


def _error(code,path,message):
    return {'code':code,'path':path,'message':message}


def _strings(value):
    if isinstance(value,str):return [value]
    return value if isinstance(value,list) else []


def _channel(resource,task):
    failed, pending = [], []
    status=resource.get('publication_status')
    if status in ('unavailable','inactive','closed','not_for_sale','suspended'):
        failed.append('publication_unavailable')
    elif status != 'available':pending.append('publication_status_unknown')
    requirements=task.get('requirements') or {}
    # Adapter-provided hard facts; unsupported rules remain pending, never inferred.
    checks={'formats':'supported_formats','links':'supports_links','images':'supports_images',
            'video':'supports_video','tables':'supports_tables'}
    for key,expected in requirements.items():
        if expected in (None,False,[],{}):continue
        attr=checks.get(key)
        if not attr:pending.append('unknown_requirement:'+key);continue
        actual=resource.get(attr)
        if actual is None:pending.append('unknown_requirement:'+key)
        elif key=='formats' and not set(_strings(expected)).issubset(set(_strings(actual))):failed.append('unsupported:'+key)
        elif key!='formats' and actual != expected:failed.append('unsupported:'+key)
    if resource.get('allowed_industries') is not None and task.get('industry') not in _strings(resource['allowed_industries']):
        failed.append('industry_not_allowed')
    if task.get('industry') in _strings(resource.get('prohibited_industries')):failed.append('industry_prohibited')
    regions=task.get('regions')
    if regions and regions!='nationwide' and regions!=['nationwide'] and resource.get('restricted_regions') is not None:
        if not set(_strings(regions)).issubset(set(_strings(resource['restricted_regions']))):failed.append('region_not_allowed')
    for check in resource.get('hard_conditions',[]):
        if not isinstance(check,dict):pending.append('invalid_hard_condition');continue
        if check.get('status')=='fail':failed.append(check.get('rule_id','hard_condition_failed'))
        elif check.get('status')!='pass':pending.append(check.get('rule_id','hard_condition_unknown'))
    return ('ineligible' if failed else 'pending' if pending else 'eligible'),failed,pending


def _paths(value,prefix=''):
    out={}
    if isinstance(value,dict):
        for k,v in value.items():out.update(_paths(v,prefix+'.'+k if prefix else k))
    elif isinstance(value,list):
        for i,v in enumerate(value):out.update(_paths(v,f'{prefix}[{i}]'))
    if value is not None and value!='' and value!=[] and value!={}:out[prefix]=value
    return out


def _merge_attributes(rows):
    """Only unanimous nonprice fields are trusted; preserve all conflicting variants."""
    variants=[json.loads(value) for value in sorted({_json(_semantic(row)) for _,row in rows})]
    fields=sorted(set().union(*(set(row) for row in variants)))
    common={}
    conflicts=[]
    for field in fields:
        if all(field in row for row in variants) and all(row[field]==variants[0][field] for row in variants):
            common[field]=deepcopy(variants[0][field])
        else:
            conflicts.append(field)
    return common,variants,conflicts


def _manuscript_checks(manuscripts, rows):
    results=[]
    for manuscript in manuscripts:
        matches=[check for _,row in rows for check in row.get('manuscript_checks',[])
                 if check.get('article_id')==manuscript.get('article_id')
                 and check.get('version')==manuscript.get('version')
                 and manuscript.get('article_id') and manuscript.get('version')]
        states={check.get('status') for check in matches}
        state='failed' if 'fail' in states else 'passed' if states=={'pass'} else 'needs_manuscript_check'
        results.append({'article_id':manuscript.get('article_id'),'version':manuscript.get('version'),
                        'status':state,'checks':deepcopy(matches)})
    status='failed' if any(r['status']=='failed' for r in results) else 'passed' if results and all(r['status']=='passed' for r in results) else 'needs_manuscript_check'
    return status,results


def prepare_candidates(request: dict, analysis: dict) -> dict:
    """建立可信事实候选；报价只附带，身份/约束不交给 AI 修改。"""
    request,analysis=deepcopy(request),deepcopy(analysis)
    task=request.get('task',{})
    manuscripts=deepcopy(task.get('manuscripts',[]))
    if not manuscripts and isinstance(task.get('manuscript'),dict) and task['manuscript']:
        manuscripts=[deepcopy(task['manuscript'])]
    manuscript_status='needs_manuscript_check' # Presence is not an editorial preflight.
    grouped={}
    for i,row in enumerate(request.get('catalog',[])):
        rid=row.get('resource_id')
        key='resource:'+str(rid) if rid else 'unverified_offer:'+str(i)
        grouped.setdefault(key,[]).append((i,row))
    candidates=[]
    actual=analysis.get('actual_sources',[])
    matched_actual=set()
    for cid,rows in grouped.items():
        resource,semantics,conflict_fields=_merge_attributes(rows)
        conflict=bool(conflict_fields)
        identity_conflict=bool(IDENTITY_FIELDS.intersection(conflict_fields))
        status,fail,pending=_channel(rows[0][1],task)
        # Any known disqualifying fact wins over a contradictory supplier copy.
        for _,other in rows[1:]:
            _,other_fail,other_pending=_channel(other,task)
            fail.extend(x for x in other_fail if x not in fail)
            pending.extend(x for x in other_pending if x not in pending)
        fail.sort();pending.sort()
        if fail:status='ineligible'
        elif conflict:status='pending';pending.append('conflicting_resource_attributes')
        elif pending:status='pending'
        if not resource.get('resource_id'):status='research_only'
        article_status,article_checks=_manuscript_checks(manuscripts,rows)
        matches=[]
        for j,source in enumerate(actual):
            observations = source.get('records') or [dict(source.get('identity', {}), evidence_ids=source.get('evidence_ids', []))]
            for record in observations:
                observation = dict(record, status=source.get('status'))
                related_results = []
                for variant in semantics:
                    result = match_identity(observation, variant, request.get('identity_config', {}))
                    related = (_domain(observation) and _domain(observation) == _domain(variant)) or result['relation'] in ('exact', 'platform_related')
                    if related:
                        related_results.append(result)
                if related_results:
                    relation = 'unverified' if identity_conflict else next(
                        relation for relation in ('exact', 'platform_related', 'unverified', 'none')
                        if any(result['relation'] == relation for result in related_results))
                    if relation == 'exact':
                        matched_actual.add(j)
                    ids = [record['evidence_id']] if record.get('evidence_id') else deepcopy(record.get('evidence_ids', []))
                    matches.append({'relation': relation, 'evidence_ids': ids,
                                    'scope': deepcopy(source.get('scope', {})), 'source_index': j})
        relation=next((r for r in ('exact','platform_related','unverified') if any(m['relation']==r for m in matches)),'none')
        candidates.append({'candidate_id':cid,'resource_id':resource.get('resource_id'),
                           'attributes':resource, 'attribute_variants':semantics,'conflicting_attributes':conflict_fields,
                           'attribute_paths':[f'catalog[{n}]' for n,_ in rows],
                           'offers':[deepcopy(row) for _,row in rows if row.get('offer_id')],
                           'channel_status':status,'hard_failures':fail,'pending_conditions':pending,
                           'manuscript_status':article_status,'manuscript_checks':article_checks,'manuscripts':deepcopy(manuscripts),
                           'evidence_relation':relation,'identity_matches':matches,
                           'evidence_ids':list(dict.fromkeys(e for m in matches for e in m['evidence_ids'])),
                           'recommendation_basis':[]})
    for i,rec in enumerate(request.get('industry_recommendations',[])):
        # Resource binding must be explicit; name-only recommendation never creates a sales channel.
        match=next((c for c in candidates if rec.get('resource_id') and c['resource_id']==rec['resource_id']),None)
        if match:
            match['recommendation_basis'].append(deepcopy(rec));match['attribute_paths'].append(f'industry_recommendations[{i}]')
        else:
            candidates.append({'candidate_id':'recommendation:'+str(rec.get('recommendation_id',i)),
                'resource_id':None,'attributes':deepcopy(rec),'attribute_paths':[f'industry_recommendations[{i}]'],
                'offers':[],'channel_status':'research_only','hard_failures':[],'pending_conditions':['unverified_publication_channel'],
                'manuscript_status':manuscript_status,'manuscripts':deepcopy(manuscripts),
                'evidence_relation':'none','identity_matches':[],'evidence_ids':[], 'recommendation_basis':[deepcopy(rec)]})
    for i,source in enumerate(actual):
        if i in matched_actual:continue
        candidates.append({'candidate_id':'observed:'+_digest([source.get('scope'),source.get('identity'),source.get('evidence_ids')]),
            'resource_id':None,'attributes':deepcopy(source.get('identity',{})),'attribute_paths':[],
            'offers':[],'channel_status':'research_only','hard_failures':[],'pending_conditions':['no_confirmed_publication_channel'],
            'manuscript_status':manuscript_status,'manuscripts':deepcopy(manuscripts),
            'evidence_relation':'unverified' if source.get('status')=='identity_conflict' else 'exact',
            'identity_matches':[{'relation':'unverified' if source.get('status')=='identity_conflict' else 'exact',
                                 'evidence_ids':deepcopy(source.get('evidence_ids',[])),'scope':deepcopy(source.get('scope',{}))}],
            'evidence_ids':deepcopy(source.get('evidence_ids',[])),'recommendation_basis':[]})
    # Aggregate provenance is independent of detail IDs and question observations.
    aggregates = analysis.get('external_aggregates', [])
    for candidate in candidates:
        candidate['aggregate_matches'] = []
        for aggregate in aggregates:
            aid = aggregate.get('aggregate_id')
            if not isinstance(aid, str) or not aid or sum(a.get('aggregate_id') == aid for a in aggregates) != 1:
                continue
            applicability = aggregate.get('applicability')
            original_scope = aggregate.get('scope')
            count = aggregate.get('count')
            complete = (aggregate.get('source_type') == 'external_data'
                        and all(isinstance(aggregate.get(f), str) and aggregate[f].strip()
                                for f in ('source_id', 'data_version', 'unit'))
                        and (type(count) is int or type(count) is float and math.isfinite(count)) and count > 0
                        and isinstance(original_scope, dict) and original_scope.get('industry') == task.get('industry')
                        and isinstance(applicability, dict) and applicability.get('kind') == 'industry_context'
                        and applicability.get('industry') == task.get('industry'))
            if not complete or IDENTITY_FIELDS.intersection(candidate.get('conflicting_attributes', [])):
                continue
            # The identity matcher is reused only for identity, never detail counting.
            identity = {k: deepcopy(aggregate[k]) for k in IDENTITY_FIELDS if k in aggregate}
            relation = match_identity(identity, candidate['attributes'], request.get('identity_config', {}))['relation']
            if relation == 'exact':
                candidate['aggregate_matches'].append({'aggregate_id': aid, 'identity_relation': relation,
                    'applicability': 'industry_context', 'record': deepcopy(aggregate),
                    'detail_status': '汇总来源，暂无逐条证据'})
        candidate['aggregate_ids'] = [a['aggregate_id'] for a in candidate['aggregate_matches']]
    # Duplicate supplier offers of identical media attributes do not create a new semantic version.
    version_catalog=sorted(set(_json(_semantic(row)) for row in request.get('catalog',[])))
    version_input={'task':_semantic(task),'analysis':analysis,'catalog':version_catalog,
                   'industry_recommendations':request.get('industry_recommendations',[]),
                   'identity_config':request.get('identity_config',{})}
    limitations=[name for key,name in [('product','missing_product'),('audience','missing_audience'),('regions','missing_regions')] if not task.get(key)]
    return {'matrix_version':'matrix-'+_digest(version_input),'candidates':candidates,'limitations':limitations}


def validate_decisions(decisions: dict, candidates: dict, request: dict) -> list[dict]:
    """严格白名单 AI 字段和引用；任何无效决定均不装配为推荐。"""
    errors=[]
    if not isinstance(decisions,dict):return [_error('invalid_decisions','decisions','AI 判断必须为对象')]
    for key in decisions:
        if key not in ('items','fit_order'):errors.append(_error('untrusted_field','decisions.'+key,'不允许覆盖可信事实字段'))
    items=decisions.get('items',[])
    if not isinstance(items,list):return errors+[_error('invalid_type','decisions.items','判断必须为列表')]
    by_id={c['candidate_id']:c for c in candidates.get('candidates',[])}
    questions={q['question_id'] for q in request.get('task',{}).get('questions',[]) if isinstance(q,dict) and 'question_id' in q}
    paths=_paths(_semantic({k:v for k,v in request.items() if k in ('task','catalog','industry_recommendations')}))
    seen=[]
    for i,item in enumerate(items):
        path=f'decisions.items[{i}]'
        if not isinstance(item,dict):errors.append(_error('invalid_type',path,'判断必须为对象'));continue
        for key in item:
            if key not in DECISION_FIELDS:errors.append(_error('untrusted_field',path+'.'+key,'不允许覆盖可信事实字段或编造评分'))
        for key in ('media_intro','content_direction','ranking_reason'):
            if key in item and (not isinstance(item[key],str) or not item[key].strip()):errors.append(_error('invalid_type',path+'.'+key,'应为非空文本'))
        if 'layer_rank' in item and (type(item['layer_rank']) is not int or item['layer_rank']<1):errors.append(_error('invalid_type',path+'.layer_rank','应为正整数'))
        cid=item.get('candidate_id');candidate=by_id.get(cid) if isinstance(cid,str) else None
        if not candidate:errors.append(_error('unknown_candidate',path+'.candidate_id','候选不存在'));continue
        if cid in seen:errors.append(_error('duplicate_candidate',path+'.candidate_id','每个资源只允许一个主层判断'))
        seen.append(cid)
        primary=item.get('primary_role');aux=item.get('auxiliary_roles',[])
        if not isinstance(aux,list) or any(not isinstance(r,str) for r in aux):
            errors.append(_error('invalid_roles',path+'.auxiliary_roles','辅助角色必须为字符串列表'));aux=[]
        roles=[primary]+aux
        if any(not isinstance(r,str) or r not in ROLES for r in roles) or len(set(str(r) for r in roles))!=len(roles):
            errors.append(_error('invalid_roles',path+'.primary_role','主层唯一，辅助角色不可重复'))
        matched=item.get('matched_questions',[])
        if not isinstance(matched,list) or not matched or any(not isinstance(q,str) or q not in questions for q in matched):
            errors.append(_error('unknown_question',path+'.matched_questions','必须关联现有问题'));matched=[]
        for field in ('reason_summary',):
            if not isinstance(item.get(field),str) or not item[field].strip():errors.append(_error('missing_reason',path+'.'+field,'必须说明推荐依据'))
        if item.get('selection') not in ('recommended','alternative'):
            errors.append(_error('invalid_selection',path+'.selection','区分建议候选与备选'))
        for field in ('reason_details','unconfirmed_items'):
            if not isinstance(item.get(field),list) or any(not isinstance(s,str) for s in item[field]):errors.append(_error('invalid_type',path+'.'+field,'字段必须为说明列表'))
        refs=item.get('references',[])
        if not isinstance(refs,list) or not refs:errors.append(_error('missing_references',path+'.references','必须引用属性或证据'));refs=[]
        for j,ref in enumerate(refs):
            rp=f'{path}.references[{j}]'
            if not isinstance(ref,dict):errors.append(_error('invalid_reference',rp,'引用必须为类型对象'));continue
            if ref.get('type') == 'attribute':
                expected_keys = {'type', 'path'}
            elif ref.get('type') == 'aggregate':
                expected_keys = {'type', 'aggregate_id', 'usage'}
            else:
                expected_keys = {'type', 'evidence_id'}
            if set(ref)!=expected_keys:errors.append(_error('invalid_reference',rp,'引用只允许类型和对应标识字段'))
            if ref.get('type')=='attribute':
                attr=ref.get('path','')
                allowed=isinstance(attr,str) and (attr.startswith('task.') or any(attr==p or attr.startswith(p+'.') for p in candidate['attribute_paths']))
                catalog_field=re.match(r'^catalog\[\d+\](?:\.([^.[\]]+))?',attr) if isinstance(attr,str) else None
                conflicts=candidate.get('conflicting_attributes',[])
                conflicted=bool(catalog_field and conflicts and
                                (catalog_field.group(1) is None or catalog_field.group(1) in conflicts))
                if not allowed or attr not in paths or attr in ('task','catalog','industry_recommendations') or conflicted:
                    errors.append(_error('invalid_attribute_reference',rp,'属性必须存在、有值、无冲突且属于当前候选或任务'))
                # Referencing an entire object with stripped prices must not sneak in price reasoning.
                if isinstance(attr,str) and any(segment in PRICE_FIELDS for segment in re.split(r'[.\[\]]+',attr)):
                    errors.append(_error('price_reference',rp,'价格不能作为适配依据'))
            elif ref.get('type')=='evidence':
                eid=ref.get('evidence_id')
                valid=eid in candidate['evidence_ids'] and any(eid in m['evidence_ids'] and m.get('scope',{}).get('question_id') in matched for m in candidate['identity_matches'])
                if not valid:errors.append(_error('invalid_evidence_reference',rp,'证据必须关联当前候选和目标问题'))
            elif ref.get('type') == 'aggregate':
                if ref.get('usage') != 'industry_context' or ref.get('aggregate_id') not in candidate.get('aggregate_ids', []):
                    errors.append(_error('invalid_aggregate_reference', rp, '汇总须身份可靠、范围适用、正值且来源完整；仅作为行业背景，不表示当前问题命中'))
            else:
                errors.append(_error('invalid_reference_type', rp, '引用类型必须为 attribute、evidence 或 aggregate'))
        if 'regional' in roles:
            regions=request.get('task',{}).get('regions')
            if not regions or regions=='nationwide' or regions==['nationwide']:
                errors.append(_error('regional_not_applicable',path,'地域角色需要明确局部地域目标'))
            coverage=candidate['attributes'].get('regions') or candidate['attributes'].get('region_coverage')
            region_conflict=bool({'regions','region_coverage'}.intersection(candidate.get('conflicting_attributes',[])))
            if region_conflict or not coverage or not set(_strings(regions)).intersection(_strings(coverage)):
                errors.append(_error('regional_coverage_unconfirmed',path,'地域角色需要明确地域覆盖属性'))
        if 'supplement' in roles:
            if not isinstance(item.get('supplemental_value'),str) or not item['supplemental_value'].strip():errors.append(_error('missing_increment',path,'覆盖补充需要说明新增覆盖'))
            base=item.get('supplemental_to',[])
            if not isinstance(base,list) or not base or any(not isinstance(x,str) or x not in by_id or x==cid for x in base):errors.append(_error('invalid_supplement_base',path,'补充角色必须关联已有核心候选'))
        if 'exploration' in roles:
            if not isinstance(item.get('exploration_hypothesis'),str) or not item['exploration_hypothesis'].strip():errors.append(_error('missing_hypothesis',path,'探索角色必须说明假设'))
            if not isinstance(item.get('verification_items'),list) or not item['verification_items'] or any(not isinstance(x,str) or not x.strip() for x in item['verification_items']):errors.append(_error('missing_verification',path,'探索角色必须列出待验证事项'))
    order=decisions.get('fit_order',[])
    if not isinstance(order,list) or any(not isinstance(x,str) for x in order) or len(set(order))!=len(order) or set(order)!=set(seen):
        errors.append(_error('invalid_fit_order','decisions.fit_order','适配顺序须完整且不重复地引用已判断候选'))
    decision_by_id={item.get('candidate_id'):item for item in items if isinstance(item,dict) and isinstance(item.get('candidate_id'),str)}
    if any(isinstance(item,dict) and ('layer_rank' in item or 'ranking_reason' in item) for item in items):
        for role in ROLES:
            members=[item for item in items if isinstance(item,dict) and item.get('primary_role')==role]
            ranks=[item.get('layer_rank') for item in members]
            if any(type(rank) is not int for rank in ranks) or sorted(ranks)!=list(range(1,len(members)+1)) or any(not isinstance(item.get('ranking_reason'),str) or not item['ranking_reason'].strip() for item in members):errors.append(_error('invalid_layer_ranks','decisions.items','层内次序必须连续且有理由'))
            elif isinstance(order,list) and [cid for cid in order if cid in {item['candidate_id'] for item in members}]!=[item['candidate_id'] for item in sorted(members,key=lambda x:x['layer_rank'])]:errors.append(_error('layer_rank_order_mismatch','decisions.fit_order','fit_order与层内次序不一致'))
    for i,item in enumerate(items):
        if not isinstance(item,dict):continue
        for base in item.get('supplemental_to',[]) if isinstance(item.get('supplemental_to',[]),list) else []:
            if not isinstance(base,str) or decision_by_id.get(base,{}).get('primary_role') not in ('authority','industry','regional'):
                errors.append(_error('invalid_supplement_base',f'decisions.items[{i}]','新增覆盖必须相对已判断的核心候选'))
    return errors


def assemble_matrix(request: dict, analysis: dict, decisions: dict) -> dict:
    """在完整可信候选快照上附加合法 AI 语义判断；失败仍保留事实。"""
    prepared=prepare_candidates(request,analysis)
    errors=validate_decisions(decisions,prepared,request)
    missing=not isinstance(decisions,dict) or not decisions.get('items')
    status='invalid_decisions' if errors else 'needs_ai_decisions' if missing else 'complete'
    order=[]
    rows=deepcopy(prepared['candidates'])
    if not errors and not missing:
        by_id={d['candidate_id']:d for d in decisions['items']}
        order=deepcopy(decisions['fit_order'])
        for c in rows:
            if c['candidate_id'] in by_id:
                c.update(deepcopy(by_id[c['candidate_id']]))
                c['semantic_decision_validated'] = True
        positions={cid:i for i,cid in enumerate(order)}
        rows.sort(key=lambda c:positions.get(c['candidate_id'],len(order)))
    for c in rows:
        c.setdefault('semantic_decision_validated', False)
        c.setdefault('primary_role',None);c.setdefault('auxiliary_roles',[])
        c.setdefault('selection','undecided');c.setdefault('matched_questions',[])
    layers=[{'role':role,'display_name':name,'status':'populated' if any(c['primary_role']==role for c in rows) else 'empty',
             'candidate_ids':[c['candidate_id'] for c in rows if c['primary_role']==role],
             'auxiliary_candidate_ids':[c['candidate_id'] for c in rows if role in c['auxiliary_roles']]} for role,name in ROLES.items()]
    return {'schema_version':'1.0','matrix_version':prepared['matrix_version'],'status':status,
            'source_analysis':deepcopy(analysis),'data_quality':deepcopy(analysis.get('data_quality',{})),'scope':{'task':deepcopy(request.get('task',{})),'evidence_scope':deepcopy(analysis.get('scope',{}))},
            'matrix':{'status':status,'candidates':rows,'layers':layers,'fit_order':order,'coverage_kind':'semantic_relevance'},
            'research_only':[deepcopy(c) for c in rows if c['channel_status']=='research_only'],
            'pending_items':[{'candidate_id':c['candidate_id'],'conditions':c['pending_conditions'], 'manuscript_status':c['manuscript_status']} for c in rows if c['pending_conditions'] or c['manuscript_status']=='needs_manuscript_check'],
            'limitations':prepared['limitations'],'errors':errors,'budget_plans':[]}
