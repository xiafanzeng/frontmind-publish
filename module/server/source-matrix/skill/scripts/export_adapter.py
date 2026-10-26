"""Read analysis exports into a bounded research contract, never a sales catalog.

Optional dependency: openpyxl. The original planner remains standard-library-only.
Cell values and formulas are untrusted data and are never executed or fetched.
"""
import argparse
from collections import Counter
from copy import deepcopy
from datetime import date, datetime
import hashlib
import json
from pathlib import Path
import re

ALIASES = {
    '引用日期':'observed_date', '模型':'model', '监控问题':'question',
    '内容标题':'title', '内容链接':'content_url', '内容url':'content_url',
    '媒体名称':'source_name', '媒体url':'media_domain', '域名':'media_domain',
    '引用次数':'reported_count', '引用占比':'reported_share', '引用排行':'reported_rank',
}
DETAIL_FIELDS = {'observed_date','model','question','title','content_url','source_name','media_domain'}
ROLES = {'authority','industry','regional','supplement','exploration'}

def digest(value):
    return hashlib.sha256(json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()

def _cell(value):
    if isinstance(value,(datetime,date)): return value.isoformat()
    if value is None or isinstance(value,(str,int,float,bool)): return value
    return str(value)

def _key(header):
    return re.sub(r'\s+','',str(header or '')).lower()

def _metrics(records, detail_available=True):
    if not detail_available:
        return {k:None for k in ('raw_rows','distinct_export_rows','extra_identical_rows','unique_urls','source_groups','exact_citation_count')}
    tuples = {json.dumps([r.get(k) for k in sorted(DETAIL_FIELDS)],ensure_ascii=False) for r in records}
    return {'raw_rows':len(records), 'distinct_export_rows':len(tuples),
            'extra_identical_rows':len(records)-len(tuples),
            'unique_urls':len({r['content_url'] for r in records if r.get('content_url')}),
            'source_groups':len({(r.get('source_name'),r.get('media_domain')) for r in records}),
            'exact_citation_count':None}

def _groups(records):
    buckets = {}
    for r in records:
        identity = (r.get('source_name'),r.get('media_domain'))
        buckets.setdefault(identity,[]).append(r)
    out = []
    for (name,domain), rows in buckets.items():
        out.append({'candidate_key':'research:'+digest([name,domain])[:16], 'source_name':name,
                    'media_domain':domain, 'raw_rows':len(rows),
                    'unique_urls':len({r['content_url'] for r in rows if r.get('content_url')}),
                    'models':dict(Counter(r.get('model') for r in rows)),
                    'questions':dict(Counter(r.get('question') for r in rows)),
                    'locator_keys':[r['locator_key'] for r in rows]})
    return sorted(out,key=lambda x:(-x['raw_rows'],str(x['source_name']),str(x['media_domain'])))

def _total(rows):
    if not rows: return None
    counts = [r.get('reported_count') for r in rows]
    if any(isinstance(x,bool) or not isinstance(x,(int,float)) or x < 0 or x != int(x) for x in counts): return None
    return sum(int(x) for x in counts)

def _summary_groups(rows):
    """Summary rows are independent observations; duplicate identities stay visible."""
    buckets={}
    for r in rows:
        identity=(r.get('source_name'),r.get('media_domain'))
        buckets.setdefault(identity,[]).append(r)
    return [dict(candidate_key='research:'+digest([name,domain])[:16],source_name=name,media_domain=domain,
                 raw_rows=None,unique_urls=None,reported_count=_total(records),
                 locator_keys=[r['locator_key'] for r in records]) for (name,domain),records in buckets.items()]

def read_export(path):
    """Retain every row and original summary independently, with file/sheet/row locators."""
    from openpyxl import load_workbook
    path = Path(path)
    if path.suffix.lower() != '.xlsx': raise ValueError('Expected .xlsx analysis export')
    sha = hashlib.sha256(path.read_bytes()).hexdigest()
    w = load_workbook(path,read_only=True,data_only=False,keep_links=False)
    detail = []; media = []; content = []; sheets = []; detail_sheets = []; issues = []
    try:
        for s in w:
            all_rows = list(s.values)
            if not all_rows: continue
            header_index = None
            for index, row in enumerate(all_rows[:20]):
                fields = {ALIASES.get(_key(h)) for h in row}
                if DETAIL_FIELDS <= fields or {'source_name','media_domain','reported_count'} <= fields:
                    header_index = index; break
            if header_index is None:
                sheets.append({'sheet':s.title,'role':'unrecognized','rows':max(0,len(all_rows)-1)}); continue
            headers = [str(x or '') for x in all_rows[header_index]]
            mapped = [ALIASES.get(_key(h)) for h in headers]
            recognized = [x for x in mapped if x]
            if len(recognized) != len(set(recognized)): raise ValueError('Ambiguous duplicate columns: '+s.title)
            role = 'detail' if DETAIL_FIELDS <= set(mapped) else 'content_summary' if 'content_url' in mapped else 'media_summary'
            if role == 'detail': detail_sheets.append(s.title)
            target = detail if role == 'detail' else content if role == 'content_summary' else media
            n = 0
            for row_number, row in enumerate(all_rows[header_index+1:],header_index+2):
                if not any(x is not None and x != '' for x in row): continue
                raw = {h:_cell(v) for h,v in zip(headers,row) if h}
                record = {key:_cell(v) for key,v in zip(mapped,row) if key}
                record.update(raw=raw, locator={'file':path.name,'sha256':sha,'sheet':s.title,'row':row_number},
                              locator_key=f'{sha}:{s.title}:{row_number}')
                if role == 'detail' and any(not record.get(k) for k in DETAIL_FIELDS):
                    issues.append({'code':'incomplete_export_row','locator_key':record['locator_key']})
                target.append(record); n += 1
            sheets.append({'sheet':s.title,'role':role,'rows':n,'header_row':header_index+1})
    finally: w.close()
    if len(detail_sheets)>1: raise ValueError('Multiple detail sheets; select/export one scope explicitly')
    if not detail_sheets and not media and not content: raise ValueError('No recognized analysis table')
    available = bool(detail_sheets)
    m = _metrics(detail,available); mt = _total(media); ct = _total(content)
    comparable = available and (mt is not None or ct is not None)
    reconciled = comparable and all(x == len(detail) for x in (mt,ct) if x is not None)
    return {'schema_version':'export-observation/1.0','status':'partial_observation' if available else 'aggregate_only',
            'source_file':{'name':path.name,'sha256':sha}, 'sheets':sheets,'records':detail,
            'media_summary':media,'content_summary':content,'groups':_groups(detail) if available else _summary_groups(media or content), 'metrics':m,
            'models':dict(Counter(r.get('model') for r in detail)),
            'monitored_questions':dict(Counter(r.get('question') for r in detail)),
            'observed_dates':dict(Counter(r.get('observed_date') for r in detail)),
            'reported_periods':sorted({str(r['observed_date']) for r in media+content if r.get('observed_date')}),
            'reconciliation':{'status':'matched_totals_only' if reconciled else 'mismatch' if comparable else 'not_comparable',
                              'media_reported_total':mt,'content_reported_total':ct,'detail_rows':m['raw_rows'],
                              'note':'Only totals reconciled. No inference of answer IDs, complete coverage, collection time or publication time.'},
            'issues':issues, 'missing_evidence_fields':['answer_record_id','evidence_id','model_version','account_id','published_at'],
            'limitations':['导出明细行不等于独立回答数或去重引用次数。','各统计表是同一导出的不同视图，分别核对，不能相加。',
                           '未联网验证内容、媒体身份、刊发能力或报价。','样本是品牌/问题观察，不能作为完整行业分布。']}

def normalize_brief(brief):
    if not isinstance(brief,dict): raise ValueError('brief must be an object')
    out = deepcopy(brief)
    for field in ('brand_product','target_industry','audience','material_requirement'):
        value = out.get(field)
        if value is not None and not isinstance(value,str): raise ValueError(field+' must be text')
        out[field] = value.strip() if value and value.strip() else None
    for field in ('regions','target_questions','sample_models'):
        value = out.get(field)
        if isinstance(value,str):
            value = re.split(r'[\n\r]+' if field=='target_questions' else r'[、,，\n\r]+',value)
        if value is not None and (not isinstance(value,list) or any(not isinstance(x,str) for x in value)):
            raise ValueError(field+' must be text list')
        out[field] = list(dict.fromkeys(x.strip() for x in value if x.strip())) if value else ([] if field=='target_questions' else None)
    hours = out.get('expected_publish_hours')
    if hours in (None,''): out['expected_publish_hours'] = None
    else:
        if isinstance(hours,bool): raise ValueError('Publish hours must be positive')
        try: hours = float(hours)
        except (ValueError,TypeError): raise ValueError('Publish hours must be positive')
        if not (0 < hours < float('inf')): raise ValueError('Publish hours must be positive')
        out['expected_publish_hours'] = hours
    return out

def _draft_explanation_errors(explanation, choices, judged):
    """Check explanatory scope without inventing reasons, prices or purchase facts."""
    errors=[]
    fields={'objective','selection_logic','content_allocation','tradeoffs','excluded_candidates','fit_conditions','verification_items'}
    if not isinstance(explanation,dict) or set(explanation)!=fields:
        return ['explanation must contain exactly the documented explanatory fields']
    if not isinstance(explanation['objective'],str) or not explanation['objective'].strip():errors.append('explanation objective must be text')
    for field in ('selection_logic','tradeoffs','fit_conditions','verification_items'):
        values=explanation[field]
        if not isinstance(values,list) or not values or any(not isinstance(v,str) or not v.strip() for v in values):
            errors.append(field+' must be a nonempty text list')
    allocations=explanation['content_allocation']; assigned=[]
    if not isinstance(allocations,list) or not allocations:errors.append('content_allocation must be nonempty list')
    else:
        for row in allocations:
            if not isinstance(row,dict) or set(row)!={'candidate_key','responsibility','content_angle'}:
                errors.append('invalid content allocation fields');continue
            if any(not isinstance(row.get(k),str) or not row[k].strip() for k in row):
                errors.append('content allocation values must be text');continue
            if row['candidate_key'] not in choices:errors.append('content allocation candidate not selected')
            assigned.append(row['candidate_key'])
        if len(assigned)!=len(choices) or set(assigned)!=set(choices):errors.append('content allocation must explain every selected candidate once')
    excluded=explanation['excluded_candidates'];seen=set()
    if not isinstance(excluded,list):errors.append('excluded_candidates must be a list')
    else:
        for row in excluded:
            if not isinstance(row,dict) or set(row)!={'candidate_key','reason'}:
                errors.append('invalid excluded candidate');continue
            key=row['candidate_key'];reason=row['reason']
            if not isinstance(key,str) or key not in judged or key in choices or key in seen:
                errors.append('excluded candidate must be judged, distinct and outside this draft');continue
            seen.add(key)
            if not isinstance(reason,str) or not reason.strip():errors.append('excluded reason required')
    return errors

def research_matrix(analysis, brief, decisions=None):
    """Verify agent-authored semantic research decisions against exact export locators.

    No classifier, optimizer, model call or purchase readiness is implied.
    """
    brief = normalize_brief(brief); observation = deepcopy(analysis)
    selected = brief.get('sample_models')
    if selected:
        records = [r for r in analysis['records'] if r.get('model') in selected]
        observation.update(records=records,groups=_groups(records),metrics=_metrics(records,analysis['status']!='aggregate_only'))
        observation['models'] = dict(Counter(r.get('model') for r in records))
        observation['monitored_questions'] = dict(Counter(r.get('question') for r in records))
        observation['observed_dates'] = dict(Counter(r.get('observed_date') for r in records))
        observation['reconciliation']['original_detail_rows'] = analysis['metrics']['raw_rows']
        observation['reconciliation']['detail_rows'] = len(records) if analysis['status']!='aggregate_only' else None
        observation['reconciliation']['status'] = 'not_comparable_filtered'
    semantic_brief = {k:v for k,v in brief.items() if k not in ('budget','assumptions')}
    version = 'export-input:'+digest({'file':analysis['source_file']['sha256'],'brief':semantic_brief,'adapter':'1.0'})
    result = {'schema_version':'export-research/1.0','mode':'export_research','status':'needs_semantic_decisions',
              'input_version':version,'brief':brief,'observation':observation,'matrix':[],'research_drafts':[],
              'budget_plans':[], 'industry_distribution_available':False,'budget_feasible':None,
              'ready_to_publish':None,'execution_recommended':False,'errors':[],
              'limitations':analysis['limitations']+['没有可信媒体目录、报价、稿件冻结版本与数量，不生成采购发布方案。']}
    if not brief['target_industry'] or not brief['target_questions']:
        result['status']='needs_requirements'; return result
    if selected and not observation['records']:
        result['status']='empty_selection'; return result
    if decisions is None: return result
    if not isinstance(decisions,dict) or set(decisions)-{'input_version','items','drafts'}:
        result.update(status='invalid_decisions',errors=['decisions must be an object with input_version, items and drafts only']);return result
    if decisions.get('input_version') != version:
        result['status']='stale_decisions'; return result
    groups = {g['candidate_key']:g for g in observation['groups']}
    records = {r['locator_key']:r for r in observation['records']}
    summary_records = observation['media_summary'] or observation['content_summary']
    if analysis['status']=='aggregate_only':
        for r in summary_records:
            records[r['locator_key']]=r
    errors=[]; judged=set(); items=decisions.get('items',[])
    if not isinstance(items,list): items=[]; errors.append('items must be a list')
    ranked_mode=any(isinstance(x,dict) and ('layer_rank' in x or 'ranking_reason' in x) for x in items)
    for item in items:
        if not isinstance(item,dict): errors.append('item must be object'); continue
        before=len(errors)
        key=item.get('candidate_key'); group=groups.get(key) if isinstance(key,str) else None
        if not group or key in judged: errors.append('unknown or duplicate candidate'); continue
        judged.add(key)
        allowed={'candidate_key','primary_role','matched_questions','reason','content_direction','media_intro','layer_rank','ranking_reason','references','verification_items',
                 'supplemental_to','supplemental_value','exploration_hypothesis','disposition','caution'}
        if set(item)-allowed: errors.append('untrusted decision fields')
        role=item.get('primary_role'); refs=item.get('references',[]); questions=item.get('matched_questions',[])
        if not isinstance(role,str) or role not in ROLES: errors.append('unknown role')
        def text_list(value):return isinstance(value,list) and all(isinstance(x,str) and x.strip() for x in value)
        if not text_list(refs) or not refs or any(ref not in group['locator_keys'] for ref in refs): errors.append('reference outside candidate or empty')
        if not text_list(questions) or not questions or any(q not in brief['target_questions'] for q in questions): errors.append('unknown or empty target question')
        for field in ('reason','content_direction'):
            if not isinstance(item.get(field),str) or not item[field].strip(): errors.append(field+' must be nonempty text')
        if 'media_intro' in item and (not isinstance(item['media_intro'],str) or not item['media_intro'].strip()):
            errors.append('media_intro must be nonempty text')
        if ranked_mode:
            rank=item.get('layer_rank')
            if not isinstance(rank,int) or isinstance(rank,bool) or rank<1:errors.append('layer_rank must be a positive integer')
            if not isinstance(item.get('ranking_reason'),str) or not item['ranking_reason'].strip():errors.append('ranking_reason must be nonempty text')
        for field in ('verification_items','supplemental_to'):
            if field in item and not text_list(item[field]):errors.append(field+' must be a text list')
        for field in ('supplemental_value','exploration_hypothesis','caution'):
            if field in item and not isinstance(item[field],str):errors.append(field+' must be text')
        if item.get('disposition','consider') not in ('consider','reference_only','hold'):errors.append('invalid disposition')
        if role=='regional' and (not brief.get('regions') or not item.get('verification_items')): errors.append('regional needs explicit regions and coverage verification')
        if role=='exploration' and (not item.get('exploration_hypothesis') or not item.get('verification_items')): errors.append('exploration needs hypothesis and verification')
        if role=='supplement' and (not item.get('supplemental_to') or not item.get('supplemental_value')): errors.append('supplement needs core and incremental value')
        if len(errors)>before:continue
        result['matrix'].append(dict(deepcopy(group),**deepcopy(item),resource_id=None,offer_id=None,
                                     channel_status='research_only',identity_relation='unverified',
                                     references_detail=[records[x] for x in refs if x in records]))
    for item in result['matrix']:
        if item['primary_role']=='supplement':
            cores={x['candidate_key'] for x in result['matrix'] if x['primary_role'] in ('authority','industry','regional')}
            if any(x not in cores for x in item.get('supplemental_to',[])): errors.append('supplemental core not judged')
    if ranked_mode:
        for role in ROLES:
            ranks=[x['layer_rank'] for x in result['matrix'] if x['primary_role']==role]
            if sorted(ranks)!=list(range(1,len(ranks)+1)):errors.append('layer ranks must be unique and contiguous within each role')
    drafts=decisions.get('drafts',[])
    if not isinstance(drafts,list) or len(drafts)>3: drafts=[]; errors.append('at most three research drafts')
    signatures=set()
    for draft in drafts:
        if not isinstance(draft,dict):errors.append('draft must be an object');continue
        before=len(errors)
        choices=draft.get('candidate_keys',[])
        if set(draft)-{'name','reason','candidate_keys','content_direction','explanation'}: errors.append('untrusted draft fields')
        for field in ('name','reason','content_direction'):
            if not isinstance(draft.get(field),str) or not draft[field].strip():errors.append(field+' must be nonempty text')
        if not isinstance(choices,list) or not choices or any(not isinstance(x,str) or x not in judged for x in choices): errors.append('invalid research draft candidates')
        if len(errors)>before:continue
        if len(choices)!=len(set(choices)):errors.append('duplicate research draft candidate');continue
        if 'explanation' in draft:
            errors.extend(_draft_explanation_errors(draft['explanation'],choices,judged))
            if len(errors)>before:continue
        signature=tuple(sorted(choices))
        if signature in signatures: errors.append('duplicate draft')
        signatures.add(signature)
        result['research_drafts'].append(dict(deepcopy(draft),explanation_status='complete' if 'explanation' in draft else 'needs_explanation',status='research_draft',total_cost=None,budget_feasible=None,ready_to_publish=None,execution_recommended=False))
    if errors:
        result.update(status='invalid_decisions',matrix=[],research_drafts=[],errors=errors)
    elif items:
        result['status']='research_draft'
        if ranked_mode:
            result['ranking_policy']={'method':'explicit_semantic_layer_order','default_visible_per_layer':3,
                'observation_groups':len(observation['groups']),'judged_candidates':len(result['matrix']),
                'note':'序号与引用范围已校验；具体语义判断仍由本轮理由说明。'}
    return result

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--xlsx',required=True); parser.add_argument('--brief'); parser.add_argument('--decisions'); parser.add_argument('--output',required=True)
    args=parser.parse_args()
    load=lambda p:json.loads(Path(p).read_text(encoding='utf-8-sig'))
    result=research_matrix(read_export(args.xlsx),load(args.brief) if args.brief else {},load(args.decisions) if args.decisions else None)
    output=Path(args.output); output.parent.mkdir(parents=True,exist_ok=True)
    temporary=output.with_name(output.name+'.tmp'); temporary.write_text(json.dumps(result,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8'); temporary.replace(output)
    return 2 if result['status']=='invalid_decisions' else 0

if __name__=='__main__': raise SystemExit(main())
