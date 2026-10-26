"""Deterministic publication-price and dual-cap verification; no selection optimizer."""
from copy import deepcopy
from datetime import datetime
import json
from .contracts import parse_money, validate_budget, CURRENCY_PRECISION

IDENTITY = ('article_id', 'version', 'resource_id', 'publication_spec', 'quantity')

def _key(item, quantity=True):
    fields = IDENTITY if quantity else IDENTITY[:-1]
    return tuple(json.dumps(item.get(k), sort_keys=True, ensure_ascii=False) for k in fields)

def _error(code, path, message):
    return {'code': code, 'path': path, 'message': message}

def _date(value):
    if not isinstance(value,str): raise ValueError('Timezone-aware timestamp required')
    value = datetime.fromisoformat(value.replace('Z','+00:00'))
    if value.tzinfo is None: raise ValueError('Timezone-aware timestamp required')
    return value

def _money(value, currency):
    if value is None or currency not in CURRENCY_PRECISION: return None
    try: return parse_money(value, currency)
    except (ValueError, TypeError): return None

def _formatted(value, currency):
    if value is None or currency not in CURRENCY_PRECISION: return None
    precision = CURRENCY_PRECISION[currency]
    sign = '-' if value < 0 else ''; value = abs(value)
    if precision == 0: return sign + str(value)
    scale = 10 ** precision
    return f'{sign}{value // scale}.{value % scale:0{precision}d}'

def _amounts(out, values, currency):
    for name, value in values.items():
        out[name + '_minor'] = value
        out[name] = _formatted(value, currency)


def _invalid(path):
    out={'items':[], 'details':[], 'unknown_items':[{'path':path,'reasons':['invalid_type']}],
         'errors':[_error('invalid_type',path,'Malformed input; expected documented JSON structure')],
         'currency':None,'complete':False,'budget_feasible':False,'ready_to_publish':False,'status':'estimate','is_estimate':True}
    _amounts(out,{k:None for k in ('total_cost','exploration_cost','known_total_cost','known_exploration_cost',
                                 'total_cap','exploration_cap','total_remaining','exploration_remaining')},None)
    return out

def _rows_valid(rows):
    return isinstance(rows,list) and all(isinstance(r,dict) and all(r.get(k) is None or isinstance(r.get(k),str) for k in ('resource_id','offer_id','purpose','status','channel_status','article_id','version')) and ('publication_spec' not in r or r['publication_spec'] is None or isinstance(r['publication_spec'],(str,dict))) for r in rows)

def price_items(items: list[dict], catalog: list[dict], as_of: str, publication_identity: bool = True) -> dict:
    """Price deduplicated publications. See budget-rules.md for the single contract."""
    if not _rows_valid(items): return _invalid('items')
    if not _rows_valid(catalog): return _invalid('catalog')
    for o in catalog:
        pricing=o.get('pricing')
        if pricing is not None and not isinstance(pricing,dict): return _invalid('catalog.pricing')
        if isinstance(pricing,dict):
            if pricing.get('currency') is not None and not isinstance(pricing['currency'],str): return _invalid('catalog.pricing.currency')
            included=pricing.get('included_items')
            if included is not None and not _rows_valid(included): return _invalid('catalog.pricing.included_items')
    errors=[]; unique={}
    for index, original in enumerate(items):
        row=deepcopy(original); key=_key(row) if publication_identity else tuple(json.dumps(row.get(k),sort_keys=True) for k in ('candidate_id','resource_id','offer_id','publication_spec','quantity','purpose'))
        if key in unique:
            if any(row.get(f)!=unique[key].get(f) for f in ('offer_id','purpose')):
                errors.append(_error('conflicting_publication',f'items[{index}]','Same publication has conflicting offer or purpose'))
            unique[key]['locked'] = bool(unique[key].get('locked') or row.get('locked'))
        else: unique[key]=row
    rows=list(unique.values()); details=[]; unknown=[]; currencies=set(); totals=[]; explores=[]
    groups={}
    for row in rows: groups.setdefault(row.get('offer_id'),[]).append(row)
    charged_packages=set()
    for index,row in enumerate(rows):
        reasons=[]; path=f'items[{index}]'; quantity=row.get('quantity')
        valid_quantity=type(quantity) is int and quantity>0
        if not valid_quantity: reasons.append('quantity_required_positive_integer')
        required=IDENTITY[:-1] if publication_identity else ('resource_id','publication_spec')
        if any(row.get(k) in (None,'',{},[]) for k in required): reasons.append('publication_identity_incomplete')
        if row.get('purpose') not in ('standard','exploration'): reasons.append('purpose_required')
        matches=[o for o in catalog if o.get('offer_id')==row.get('offer_id') and o.get('resource_id')==row.get('resource_id') and row.get('offer_id')]
        # Identical catalog replicas are harmless; contradictory quotes are not.
        matches=list({json.dumps(o,sort_keys=True):json.loads(json.dumps(o)) for o in matches}.values())
        offer=matches[0] if len(matches)==1 else {}
        if len(matches)!=1: reasons.append('offer_missing_or_ambiguous')
        if offer.get('publication_spec')!=row.get('publication_spec'): reasons.append('offer_spec_mismatch')
        for field in ('min_quantity','max_quantity'):
            if field in offer and (type(offer[field]) is not int or offer[field]<1): reasons.append('quantity_limit_invalid')
        if valid_quantity and ((type(offer.get('min_quantity')) is int and quantity<offer['min_quantity']) or (type(offer.get('max_quantity')) is int and quantity>offer['max_quantity'])):
            reasons.append('quantity_out_of_range')
        if 'allowed_purposes' in offer:
            allowed=offer['allowed_purposes']
            if not isinstance(allowed,list) or not allowed or any(p not in ('standard','exploration') for p in allowed):
                reasons.append('allowed_purposes_invalid')
            elif row.get('purpose') not in allowed: reasons.append('purpose_not_allowed')
        pricing=offer.get('pricing') or {}; currency=pricing.get('currency')
        if currency in CURRENCY_PRECISION: currencies.add(currency)
        else: reasons.append('currency_unknown')
        try:
            if not _date(pricing.get('quoted_at')) <= _date(as_of) <= _date(pricing.get('valid_until')):
                reasons.append('quote_not_valid')
        except (TypeError,ValueError): reasons.append('quote_dates_unknown')
        kind=pricing.get('kind'); is_package=kind=='package'
        base=_money(pricing.get('upper_bound' if kind=='range' else 'amount'),currency)
        if base is None: reasons.append('price_unknown')
        lower=_money(pricing.get('lower_bound'),currency) if kind=='range' else base
        if kind=='range' and 'lower_bound' in pricing and (lower is None or base is None or lower>base):
            reasons.append('range_bounds_invalid')
        if kind not in ('unit','range','package'): reasons.append('pricing_rule_unknown')
        if is_package:
            included=pricing.get('included_items')
            chosen=groups.get(row.get('offer_id'),[])
            if len({x.get('resource_id') for x in chosen})!=1 or any(
                    o.get('offer_id')==row.get('offer_id') and o.get('resource_id')!=row.get('resource_id') for o in catalog):
                reasons.append('package_cross_resource_unresolved')
            if not isinstance(included,list) or not included or sorted(_key(x) for x in included)!=sorted(_key(x) for x in chosen):
                reasons.append('package_members_unresolved')
            if len({x.get('purpose') for x in chosen})!=1: reasons.append('package_purpose_allocation_unknown')
        multiplier=1 if is_package else quantity if valid_quantity else None
        known=base*multiplier if base is not None and multiplier is not None else 0
        fees=pricing.get('mandatory_fees')
        if not isinstance(fees,list): reasons.append('mandatory_fees_unknown'); fees=[]
        for fee in fees:
            if not isinstance(fee,dict): reasons.append('mandatory_fee_unknown'); continue
            amount=_money(fee.get('amount'),currency); basis=fee.get('basis')
            multiple=1 if basis=='item' else quantity if basis=='unit' and valid_quantity and not is_package else None
            if amount is None or multiple is None: reasons.append('mandatory_fee_unknown')
            else: known+=amount*multiple
        # An expired/mismatched quote is not a confirmed known amount.
        if any(r in reasons for r in ('quote_not_valid','quote_dates_unknown','offer_spec_mismatch','package_members_unresolved','pricing_rule_unknown','package_cross_resource_unresolved')):
            known=0
        if is_package:
            if row.get('offer_id') in charged_packages: known=0
            charged_packages.add(row.get('offer_id'))
        full=known if not reasons else None
        detail={'item':deepcopy(row),'currency':currency,'unknown_reasons':reasons,'cost_basis':'confirmed_upper_bound' if kind=='range' else 'exact'}
        _amounts(detail,{'cost':full,'known_cost':known,'lower_cost':known-(base-lower)*multiplier if not reasons and base is not None and lower is not None and multiplier is not None else None},currency);details.append(detail)
        if reasons:
            unknown.append({'item':deepcopy(row),'reasons':reasons})
            errors.extend(_error(r,path,r) for r in reasons if r in ('quantity_required_positive_integer','purpose_required'))
        totals.append(known);explores.append(known if row.get('purpose')=='exploration' else 0)
    currency=next(iter(currencies)) if len(currencies)==1 else None
    if len(currencies)>1: errors.append(_error('multiple_currencies','items','No exchange conversion is supported'))
    complete=bool(rows) and not errors and not unknown
    known_total=sum(totals) if len(currencies)<=1 else None
    known_exploration=sum(explores) if len(currencies)<=1 else None
    exploration_unknown=any(x['item'].get('purpose')=='exploration' for x in unknown)
    out={'items':rows,'details':details,'unknown_items':unknown,'errors':errors,'currency':currency,'complete':complete,'status':'complete' if complete else 'estimate'}
    out['is_estimate']=not complete or any(d['cost_basis']=='confirmed_upper_bound' for d in details)
    _amounts(out,{'total_cost':known_total if complete else None,'exploration_cost':known_exploration if not exploration_unknown and not errors else None,
                 'known_total_cost':known_total,'known_exploration_cost':known_exploration},currency)
    return out


def verify_plan(plan: dict, matrix: dict, request: dict, as_of: str) -> dict:
    """Verify requested choices against trusted snapshot and selected items; never optimize."""
    if not isinstance(plan,dict): return _invalid('plan')
    if not isinstance(matrix,dict) or not isinstance(matrix.get('matrix',matrix),dict): return _invalid('matrix')
    if not isinstance(matrix.get('matrix_version'),str) or not matrix['matrix_version'].strip(): return _invalid('matrix_version')
    if not isinstance(request,dict) or not isinstance(request.get('task',{}),dict): return _invalid('request')
    candidates=matrix.get('matrix',matrix).get('candidates',[])
    if not _rows_valid(candidates): return _invalid('matrix.candidates')
    for c in candidates:
        if not _rows_valid(c.get('offers',[])) or not _rows_valid(c.get('manuscript_checks',[])): return _invalid('matrix.candidates')
    errors=[]; rows=deepcopy(plan.get('items',[])); selected=request.get('selected_items',request.get('task',{}).get('selected_items',[]))
    if not _rows_valid(rows) or not _rows_valid(selected): return _invalid('items')
    locked_selected=[r for r in selected if r.get('locked')]
    locked_keys={_key(r) for r in locked_selected}
    locked_bases={_key(r,False) for r in locked_selected}
    retained=[]
    for row in rows:
        if _key(row,False) in locked_bases and _key(row) not in locked_keys:
            errors.append(_error('locked_selection_changed','items','Locked quantity cannot be changed'))
        else: retained.append(row)
    rows=retained
    for trusted in selected:
        related=[r for r in rows if _key(r, bool(trusted.get('locked')))==_key(trusted, bool(trusted.get('locked')))]
        for r in related:
            if r.get('offer_id') != trusted.get('offer_id'):
                errors.append(_error('selected_offer_changed','items','Selected supplier offer cannot be replaced'))
        if trusted.get('locked'):
            if not related:
                errors.append(_error('locked_selection_removed','items','Omitted locked publication was retained'))
            for r in related:
                if any(r.get(k)!=trusted.get(k) for k in ('offer_id','purpose')):
                    errors.append(_error('locked_selection_changed','items','Locked publication cannot be changed'))
            rows=[r for r in rows if _key(r)!=_key(trusted)]
            rows.append(deepcopy(trusted))
        elif trusted.get('purpose')=='exploration':
            for row in related:
                if row.get('purpose')!='exploration':
                    errors.append(_error('exploration_relabel','items','Trusted exploration purpose cannot be relabelled'))
                    row['purpose']='exploration'
    candidates=matrix.get('matrix',matrix).get('candidates',[])
    by_resource={c.get('resource_id'):c for c in candidates if c.get('resource_id')}
    # Current prices may change; candidate membership and chosen offer remain explicit.
    catalog=request.get('catalog',[o for c in candidates for o in c.get('offers',[])])
    out=price_items(rows,catalog,as_of);errors.extend(out['errors']);prechecks=[]
    if any(e['code']=='invalid_type' for e in errors): return out
    for i,row in enumerate(out['items']):
        if type(row.get('quantity')) is int and row['quantity']>100:
            errors.append(_error('quantity_limit_exceeded',f'items[{i}]','At most 100 publications per item'))
        task=request.get('task',{})
        declared=task.get('manuscripts') or ([task['manuscript']] if task.get('manuscript') else [])
        if not any(isinstance(m,dict) and m.get('article_id')==row.get('article_id') and m.get('version')==row.get('version') for m in declared):
            errors.append(_error('undeclared_manuscript',f'items[{i}]','Publication must bind a real declared frozen manuscript'))
        candidate=by_resource.get(row.get('resource_id'))
        if candidate is None: errors.append(_error('outside_matrix',f'items[{i}]','Resource is outside original matrix'))
        elif candidate.get('channel_status')!='eligible': errors.append(_error('channel_not_eligible',f'items[{i}]','Channel hard constraints must be known and satisfied'))
        if type(row.get('quantity')) is int and row['quantity']>1:
            offers=[o for o in catalog if o.get('resource_id')==row.get('resource_id') and o.get('offer_id')==row.get('offer_id') and o.get('publication_spec')==row.get('publication_spec')]
            if request.get('publication_intent')!='repeat_existing_article' or len(offers)!=1 or offers[0].get('repeat_allowed') is not True:
                errors.append(_error('repeat_publication_not_authorized',f'items[{i}]','Repeated frozen articles require explicit user intent and verified channel permission'))
        checks=[x for x in (candidate or {}).get('manuscript_checks',[]) if x.get('article_id')==row.get('article_id') and x.get('version')==row.get('version')]
        statuses={x.get('status') for x in checks}
        state='failed' if 'failed' in statuses else 'passed' if statuses=={'passed'} else 'needs_manuscript_check'
        prechecks.append({'article_id':row.get('article_id'),'version':row.get('version'),'resource_id':row.get('resource_id'),'status':state})
    budget=request.get('budget'); caps={};currency=budget.get('currency') if isinstance(budget,dict) else out['currency']
    if budget is not None:
        budget_errors=validate_budget(budget);errors.extend(budget_errors)
        if isinstance(budget,dict):
            if not isinstance(currency,str): return _invalid('budget.currency')
            caps={k:_money(budget.get(k),currency) for k in ('total_cap','exploration_cap','unit_price_min','unit_price_max')}
            if out['currency'] and out['currency']!=currency:errors.append(_error('currency_mismatch','budget','Budget and quotes must use same currency'))
            if any(r.get('purpose')=='exploration' for r in rows) and (budget.get('exploration_enabled') is not True or not caps.get('exploration_cap')):
                errors.append(_error('exploration_not_enabled','budget','Exploration needs enabled flag and positive sublimit'))
            if any(caps.get(k) is not None for k in ('unit_price_min','unit_price_max')) and any(
                    (o.get('pricing') or {}).get('kind')=='package' and any(r.get('offer_id')==o.get('offer_id') for r in rows) for o in catalog):
                errors.append(_error('package_unit_limit_unresolved','budget','Package does not provide a comparable unit price'))
            for detail in out['details']:
                q=detail['item'].get('quantity'); amount=detail['cost_minor']
                if amount is None or type(q) is not int or q<=0:continue
                if caps.get('unit_price_min') is not None:
                    lower_cost=detail['lower_cost_minor']
                    if lower_cost is None: errors.append(_error('unit_price_min_unresolved','items','Confirmed lower bound required for minimum price'))
                    elif lower_cost<caps['unit_price_min']*q:errors.append(_error('unit_price_below_min','items','Publication cost below unit minimum'))
                if caps.get('unit_price_max') is not None and amount>caps['unit_price_max']*q:errors.append(_error('unit_price_above_max','items','Publication cost above unit maximum'))
    for cost,cap in [('total','total_cap'),('exploration','exploration_cap')]:
        known=out.get('known_'+cost+'_cost_minor');limit=caps.get(cap)
        if known is not None and limit is not None and known>limit:errors.append(_error(cost+'_cap_exceeded','budget.'+cap,'Known cost exceeds cap'))
    locked=[r for r in out['items'] if r.get('locked')]
    package_ids={o.get('offer_id') for o in catalog if (o.get('pricing') or {}).get('kind')=='package'}
    locked_package_ids={r.get('offer_id') for r in locked if r.get('offer_id') in package_ids}
    locked_details=[d for d in out['details'] if d['item'].get('locked') or d['item'].get('offer_id') in locked_package_ids]
    locked_unknown=any(d['unknown_reasons'] for d in locked_details)
    locked_total=sum(d['known_cost_minor'] or 0 for d in locked_details)
    locked_exploration=sum(d['known_cost_minor'] or 0 for d in locked_details if d['item'].get('purpose')=='exploration')
    if out['currency']==currency and any(caps.get(k+'_cap') is not None and value>caps[k+'_cap'] for k,value in [('total',locked_total),('exploration',locked_exploration)]):
        errors.append(_error('locked_selection_conflict','selected_items','Locked items exceed budget; retained unchanged'))
    feasible=budget is not None and bool(caps) and out['complete'] and not errors
    out.update(errors=errors,matrix_version=matrix.get('matrix_version'),budget_feasible=feasible,
               manuscript_checks=prechecks,manuscript_status='failed' if any(c['status']=='failed' for c in prechecks) else 'passed' if prechecks and all(c['status']=='passed' for c in prechecks) else 'needs_manuscript_check',
               ready_to_publish=feasible and bool(prechecks) and all(c['status']=='passed' for c in prechecks),
               status='needs_budget' if budget is None else 'budget_feasible' if feasible else 'estimate' if not out['complete'] else 'no_feasible_plan')
    balances={}
    for cost in ('total','exploration'):
        value=out[cost+'_cost_minor'];cap=caps.get(cost+'_cap')
        balances[cost+'_cap']=cap
        balances[cost+'_remaining']=cap-value if cap is not None and value is not None and not locked_unknown and out['currency']==currency else None
    _amounts(out,balances,currency)
    return out
