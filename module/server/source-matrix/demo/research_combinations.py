"""Independent research-only extension to the original Skill publication contract.

The unchanged Skill checks the semantic matrix again. This extension validates
AI-selected research groups without inventing article/resource/offer identities.
It never outputs a formal budget_plan, known cost, or cart permission.
"""
import argparse
from copy import deepcopy
from datetime import datetime
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'skill-original'))
from scripts.contracts import validate_request, parse_money
from scripts.matrix import _semantic
from scripts.planner import run


def digest(value):
    return hashlib.sha256(json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()[:24]


def validate(request, snapshot, envelope, as_of):
    errors = validate_request(request, 'budget')
    def fail(code,path,message): errors.append({'code':code,'path':path,'message':message})
    parsed=datetime.fromisoformat(as_of.replace('Z','+00:00'))
    if parsed.tzinfo is None: fail('timezone_required','as_of','必须明确时区')
    if snapshot.get('matrix',{}).get('status') != 'complete' or snapshot.get('errors'):
        fail('matrix_required','snapshot','必须使用已通过全部语义校验的矩阵')
    old = snapshot.get('scope',{}).get('input_snapshot')
    if not old or _semantic(old) != _semantic(request):
        fail('stale_matrix','request','任务或非价格观察已变化，需重新生成矩阵')
    decisions = snapshot.get('snapshot',{}).get('matrix_decisions')
    fresh = run(request,{'matrix_decisions':decisions},'matrix',None,as_of)
    if fresh.get('status')!='complete' or fresh.get('errors') or fresh.get('matrix_version') != snapshot.get('matrix_version'):
        fail('matrix_revalidation_failed','snapshot','原 Skill 对当前语义输入复核失败')
    elif fresh['matrix']['fit_order'] != snapshot['matrix']['fit_order']:
        fail('matrix_order_changed','snapshot','预算阶段不得改变适配顺序')
    if not isinstance(envelope,dict) or set(envelope)!={'research_combinations'}:
        fail('invalid_envelope','decisions','仅接受 research_combinations')
    drafts=envelope.get('research_combinations',[]) if isinstance(envelope,dict) else []
    if not isinstance(drafts,list) or not 1<=len(drafts)<=3:
        fail('invalid_count','research_combinations','必须提供1至3套有差异的研究组合');drafts=[]
    candidates={c['candidate_id']:c for c in fresh.get('matrix',{}).get('candidates',[])}
    allowed={'strategy','reason_summary','items','coverage','gaps','tradeoffs','unconfirmed_items'}
    combinations=[];seen=set()
    budget=request.get('budget',{}); currency=budget.get('currency')
    for index,draft in enumerate(drafts):
        path=f'research_combinations[{index}]'
        if not isinstance(draft,dict) or set(draft)!=allowed:
            fail('untrusted_draft_fields',path,'研究决定仅能提交选择和解释，不能提交金额或发布事实');continue
        for key in ('strategy','reason_summary'):
            if not isinstance(draft[key],str) or not draft[key].strip():fail('missing_reason',path+'.'+key,'必须说明策略与理由')
        for key in ('coverage','gaps','tradeoffs','unconfirmed_items'):
            if not isinstance(draft[key],list) or not draft[key] or any(not isinstance(v,str) or not v.strip() for v in draft[key]):
                fail('invalid_explanation',path+'.'+key,'必须为非空说明列表')
        items=draft['items']; ids=[];purposes={};uses={}
        if not isinstance(items,list) or not items:fail('empty_combination',path+'.items','组合不可为空');continue
        for j,item in enumerate(items):
            location=f'{path}.items[{j}]'
            if not isinstance(item,dict) or set(item)!={'candidate_id','purpose','usage'}:
                fail('untrusted_item_fields',location,'只能提交候选ID、用途和研究使用方式');continue
            cid=item['candidate_id'];c=candidates.get(cid) if isinstance(cid,str) else None
            if not c or not c.get('semantic_decision_validated') or c.get('selection') not in ('recommended','alternative'):
                fail('unvalidated_candidate',location,'必须选择本次已校验候选');continue
            if c.get('channel_status')=='ineligible':fail('ineligible_candidate',location,'硬条件不适用的候选不能进入组合')
            if cid in ids:fail('duplicate_candidate',location,'同一候选不可重复选择')
            if item['purpose'] not in ('standard','exploration'):fail('invalid_purpose',location,'用途必须明确')
            if item['usage'] not in ('reference','publication_research'):fail('invalid_usage',location,'区分研究参考与发布渠道研究')
            # Reference institutions have no commercial channel in this export.
            if c.get('primary_role')=='authority' and item['usage']!='reference':
                fail('reference_only',location,'本演示权威来源仅作为参考，不能当成商业发布位')
            if c.get('primary_role')=='exploration' and item['purpose']!='exploration':
                fail('exploration_purpose_required',location,'本演示探索验证候选不得更改用途规避子上限')
            if item['purpose']=='exploration':
                cap=budget.get('exploration_cap')
                if budget.get('exploration_enabled') is not True or cap is None or parse_money(cap,currency)<=0:
                    fail('exploration_not_authorized',location,'探索须启用并提供正子上限')
            ids.append(cid);purposes[cid]=item['purpose'];uses[cid]=item['usage']
        signature=tuple(sorted(ids))
        if signature in seen:fail('duplicate_combination',path,'相同候选集合不能伪装成不同策略')
        seen.add(signature)
        precision=0 if currency=='JPY' else 2
        def amount(value):
            minor=parse_money(value,currency)
            return str(minor) if precision==0 else f'{minor//100}.{minor%100:02d}'
        combinations.append({k:deepcopy(draft[k]) for k in allowed if k!='items'} | {
            'combination_id':'research-'+digest({'matrix_version':snapshot.get('matrix_version'),'items':items}),
            'candidate_ids':ids,'purpose_by_candidate':purposes,'usage_by_candidate':uses,
            'status':'research_draft','currency':currency,'total_cap':amount(budget['total_cap']),
            'exploration_cap':amount(budget['exploration_cap']) if budget.get('exploration_cap') is not None else None,
            'total_cost':None,'known_total_cost':None,'exploration_cost':None,'total_remaining':None,
            'exploration_remaining':None,'budget_feasible':None,'ready_to_publish':False,
            'execution_recommended':False,'errors':[],
            'cost_status':'unknown_no_quotes','cart_eligible':False,
            'validation':{'matrix_membership':'checked','semantic_decisions':'checked','duplicates':'checked',
                'roles_and_usage':'checked','exploration_authorization':'checked','price_feasibility':'unknown'}})
    return {'schema_version':'research-combinations/1.0',
        'status':'invalid_research_combinations' if errors else 'research_complete',
        'as_of':as_of,'matrix_version':snapshot.get('matrix_version'),'matrix_fit_order':snapshot.get('matrix',{}).get('fit_order',[]),
        'research_revision':'research-version-'+digest({'matrix_version':snapshot.get('matrix_version'),'budget':budget,'decisions':envelope}),
        'research_combinations':[] if errors else combinations,'errors':errors,
        'original_skill_revalidation':{'status':fresh.get('status'),'errors':fresh.get('errors',[]),'matrix_version':fresh.get('matrix_version')},
        'limitations':['仅复核研究组合的成员、角色、用途与预算输入；费用及预算可行性未知。',
          '无稿件、报价和可售渠道身份；不能加入真实购物车或作为发布许可。']}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for field in ('input','matrix','decisions','output','as-of'):parser.add_argument('--'+field,required=True)
    args=parser.parse_args()
    try:
        load=lambda path:json.loads(Path(path).read_text(encoding='utf-8'))
        result=validate(load(args.input),load(args.matrix),load(args.decisions),args.as_of)
        Path(args.output).write_text(json.dumps(result,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8')
        print(json.dumps({'status':result['status'],'errors':result['errors'],'combinations':len(result['research_combinations'])},ensure_ascii=False))
        return 0 if not result['errors'] else 2
    except (ValueError,TypeError,KeyError,OSError) as exc:
        print(json.dumps({'status':'invalid_input','message':str(exc)},ensure_ascii=False),file=sys.stderr)
        return 2


if __name__=='__main__':sys.exit(main())
