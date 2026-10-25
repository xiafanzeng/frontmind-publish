"""Offline scoped observation analysis; never fetch URLs or infer accounts."""
from copy import deepcopy
from datetime import date, datetime
import re
import json
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

SCOPE_FIELDS = ('tenant_id', 'question_id', 'platform', 'model', 'model_version', 'period')

def normalize_url(url, identity_config=None):
    """Remove only explicitly confirmed tracking keys, retaining semantic queries."""
    if not isinstance(url, str):
        return None
    try:
        p = urlsplit(url)
        if p.scheme not in ('http', 'https') or not p.hostname or p.username or p.password:
            return None
        drop = (identity_config or {}).get('tracking_parameters', [])
        query = urlencode([(k,v) for k,v in parse_qsl(p.query, keep_blank_values=True) if k not in drop])
        return urlunsplit((p.scheme.lower(), p.netloc.lower(), p.path, query, p.fragment))
    except ValueError:
        return None

def _domain(obj):
    url = obj.get('citation_url') or obj.get('url')
    try:
        return (urlsplit(url).hostname if url else obj.get('domain', '')).lower().rstrip('.')
    except (ValueError, AttributeError):
        return ''

def match_identity(source: dict, resource: dict, identity_config: dict) -> dict:
    """Match observed identity; a content URL alone never proves a named account."""
    ids = source.get('evidence_ids', [source['evidence_id']] if source.get('evidence_id') else [])
    def result(relation):
        return {'relation': relation, 'evidence_ids': deepcopy(ids) if relation != 'none' else []}
    if source.get('source_type') == 'supplier_claim' or source.get('data_kind') == 'aggregate':
        return result('none')
    if source.get('status') == 'identity_conflict':
        return result('unverified')
    sd, rd = _domain(source), _domain(resource)
    for field in ('account_id', 'channel_id', 'source_identity'):
        if source.get(field) and resource.get(field) and source[field] != resource[field]:
            return result('unverified')
    domain_conflict = bool(sd and rd and sd != rd)
    for mapping in identity_config.get('confirmed_account_mappings', []):
        if (source.get('account_id') and source['account_id'] == mapping.get('account_id')
                and resource.get('resource_id') and resource['resource_id'] == mapping.get('resource_id')
                and sd and sd == mapping.get('domain')):
            return result('unverified' if domain_conflict else 'exact')
    # Unobserved resource-specific identities cannot be inferred from common content.
    missing_specific = any(resource.get(f) and not source.get(f) for f in ('account_id', 'channel_id', 'source_name', 'source_identity'))
    names = (source.get('source_name'), resource.get('source_name'))
    names_confirmed = not resource.get('source_name') or names[0] == names[1]
    if not names_confirmed and sd and sd == rd:
        names_confirmed = any(alias.get('domain') == sd and
                              all(n and n in alias.get('names', []) for n in names)
                              for alias in identity_config.get('confirmed_aliases', []))
    specific_confirmed = not missing_specific and names_confirmed
    su = normalize_url(source.get('citation_url') or source.get('url'), identity_config)
    ru = normalize_url(resource.get('citation_url') or resource.get('url'), identity_config)
    if su and su == ru:
        return result('exact' if specific_confirmed else 'unverified')
    roots = identity_config.get('platform_domains', [])
    platform_related = any(sd and rd and all(d == root or d.endswith('.'+root) for d in (sd, rd)) for root in roots)
    if domain_conflict and not platform_related:
        return result('unverified')
    names = (source.get('source_name'), resource.get('source_name'))
    account_confirmed = all(not resource.get(f) or source.get(f) == resource[f] for f in ('account_id', 'channel_id', 'source_identity'))
    if sd and sd == rd and account_confirmed and specific_confirmed:
        if names[0] and names[0] == names[1]:
            return result('exact')
        for alias in identity_config.get('confirmed_aliases', []):
            if alias.get('domain') == sd and all(n and n in alias.get('names', []) for n in names):
                return result('exact')
        if sd in identity_config.get('independent_domains', []) and not missing_specific:
            return result('exact')
    return result('platform_related' if platform_related else 'unverified')


def _scope(record):
    supplied = record.get('scope', {})
    return {f: record.get(f, supplied.get(f)) for f in SCOPE_FIELDS}


def _key(value):
    return json.dumps(value, sort_keys=True)


def _identity(record):
    return {f: record.get(f) for f in ('source_name', 'account_id', 'channel_id', 'source_identity')} | {'domain': _domain(record)}


def _parse_date(value):
    if not isinstance(value, str):
        raise ValueError('Date required')
    if re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        return date.fromisoformat(value)
    if re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?', value):
        return datetime.fromisoformat(value.replace('Z', '+00:00')).date()
    raise ValueError('Unsupported date format')


def _content_age(details, scope):
    age = {'status': 'missing_period_end', 'buckets': None, 'pending': []}
    period = scope.get('period')
    end = period.get('end') if isinstance(period, dict) else None
    if not end:
        return age
    try:
        reference = _parse_date(end)
    except ValueError:
        age['status'] = 'invalid_period_end'
        return age
    intervals = scope.get('content_age_intervals', [
        {'label':'0–7','min_days':0,'max_days':7}, {'label':'8–30','min_days':8,'max_days':30},
        {'label':'31–365','min_days':31,'max_days':365}, {'label':'366–1095','min_days':366,'max_days':1095},
        {'label':'1096+','min_days':1096,'max_days':None}])
    buckets = {i['label']: 0 for i in intervals}
    for detail in details:
        values = {r.get('published_at') for r in detail['records']}
        reason = None
        if len(values) > 1:
            reason = 'conflicting_publication_dates'
        else:
            value = next(iter(values))
            if value in (None, ''):
                reason = 'missing_publication_date'
            else:
                try:
                    days = (reference - _parse_date(value)).days
                    if days < 0:
                        reason = 'future_publication_date'
                    else:
                        hits = [i for i in intervals if days >= i['min_days'] and (i.get('max_days') is None or days <= i['max_days'])]
                        if len(hits) == 1:
                            buckets[hits[0]['label']] += 1
                        else:
                            reason = 'invalid_interval_assignment'
                except ValueError:
                    reason = 'invalid_publication_date'
        if reason:
            age['pending'].append({'reason': reason, 'evidence_ids': detail['evidence_ids'], 'published_at_values': sorted(values, key=_key)})
    age.update(status='configured' if any(buckets.values()) else 'no_valid_publication_dates',
               reference_date=end, buckets=buckets if any(buckets.values()) else None, unknown_count=len(age['pending']))
    return age


def analyze_evidence(records: list[dict], scope: dict, identity_config: dict) -> dict:
    """Count scoped content once, while retaining every observed identity variant."""
    aggregates, unknown, claims, excluded, details = [], [], [], [], []
    seen, groups, identities = {}, {}, {}
    for original in records:
        r = deepcopy(original)
        values = _scope(r)
        # Industry context retains its original question/model/period; tenant scope
        # remains a hard boundary. It never enters observed-detail statistics.
        industry_context = (r.get('data_kind') == 'aggregate'
                            and isinstance(r.get('applicability'), dict)
                            and r['applicability'].get('kind') == 'industry_context')
        filter_fields = ('tenant_id',) if industry_context else SCOPE_FIELDS
        if any(f in scope and values[f] is not None and values[f] != scope[f] for f in filter_fields):
            excluded.append(r)
            continue
        if r.get('source_type') == 'supplier_claim':
            claims.append(r)
            continue
        if r.get('data_kind') == 'aggregate':
            aggregates.append(r)
            continue
        url = normalize_url(r.get('citation_url'), identity_config)
        complete = r.get('data_kind') == 'detail' and r.get('answer_record_id') and url and all(values[f] not in (None,'') for f in SCOPE_FIELDS)
        group = groups.setdefault(_key(values), {'scope': values, 'citations': [], 'unknown_records': []})
        identity = _identity(r)
        row = identities.setdefault(_key([values, identity]), {'scope':values, 'identity':identity, 'domain':identity['domain'], 'records':[], 'citations':[], 'evidence_ids':[], 'status':'complete'})
        row['records'].append(r)
        if r.get('evidence_id') and r['evidence_id'] not in row['evidence_ids']:
            row['evidence_ids'].append(r['evidence_id'])
        if not complete:
            unknown.append(r)
            group['unknown_records'].append(r)
            row['status'] = 'incomplete'
            continue
        key = _key([values, r['answer_record_id'], url])
        if key not in seen:
            detail = {'scope':values, 'normalized_url':url, 'domain':_domain(r), 'record':r, 'records':[], 'identity_variants':[], 'evidence_ids':[], 'status':'complete'}
            seen[key] = detail
            details.append(detail)
            group['citations'].append(detail)
        detail = seen[key]
        detail['records'].append(r)
        if identity not in detail['identity_variants']:
            detail['identity_variants'].append(identity)
        if len(detail['identity_variants']) > 1:
            detail['status'] = 'identity_conflict'
        if r.get('evidence_id') and r['evidence_id'] not in detail['evidence_ids']:
            detail['evidence_ids'].append(r['evidence_id'])
        if not any(d is detail for d in row['citations']):
            row['citations'].append(detail)
    rollups = []
    for group in groups.values():
        total = len(group['citations']) if group['citations'] and not group['unknown_records'] else None
        group.update(total_citations=total, known_detail_count=len(group['citations']))
        domains = set(d['domain'] for d in group['citations']) | set(_domain(r) for r in group['unknown_records'])
        for domain in sorted(domains):
            matching = [d for d in group['citations'] if d['domain'] == domain]
            rollups.append({'scope':group['scope'], 'domain':domain, 'count':len(matching) if total is not None else None,
                            'share':len(matching)/total if total else None, 'citations':matching})
    for row in identities.values():
        group = groups[_key(row['scope'])]
        total = group['total_citations']
        row['count'] = len(row['citations']) if total is not None and row['status'] == 'complete' else None
        row['share'] = row['count']/total if total and row['count'] is not None else None
        if any(d['status'] == 'identity_conflict' for d in row['citations']):
            row['status'] = 'identity_conflict'
    exact = bool(details) and not unknown
    # Combined count is explicitly a cross-scope summary, never a share denominator.
    return {'scope':deepcopy(scope), 'actual_sources':list(identities.values()), 'domain_rollups':rollups,
            'detail_citations':details, 'groups':list(groups.values()), 'total_citations':len(details) if exact and len(groups) == 1 else None,
            'combined_summary':{'scope_groups':len(groups), 'known_detail_count':len(details), 'total_citations':len(details) if exact else None, 'share':None},
            'known_detail_count':len(details), 'status':'complete' if exact else 'incomplete' if unknown else 'no_detail_data',
            'unknown_records':unknown, 'external_aggregates':aggregates, 'supplier_claims':claims,
            'excluded_records':excluded, 'content_age':_content_age(details, scope),
            'data_quality':{'exact_count_available':exact, 'aggregate_reconciliation':'not_performed'}}
