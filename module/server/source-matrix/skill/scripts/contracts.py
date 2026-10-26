"""Validation only: no inference, mutation, exchange conversion or authorization."""
import re

CURRENCY_PRECISION = {'CNY': 2, 'USD': 2, 'EUR': 2, 'JPY': 0}


def parse_money(value: str | int, currency: str) -> int:
    """Parse major-unit input into exact integer minor units; raise ValueError."""
    if not isinstance(currency, str) or currency not in CURRENCY_PRECISION:
        raise ValueError('Unsupported currency')
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        raise ValueError('Amount must be a decimal string or integer')
    raw = str(value)
    if not re.fullmatch(r'[0-9]+(?:\.[0-9]+)?', raw):
        raise ValueError('Amount must be a nonnegative plain decimal')
    whole, _, fraction = raw.partition('.')
    precision = CURRENCY_PRECISION[currency]
    if len(fraction) > precision:
        raise ValueError('Amount exceeds currency precision')
    return int(whole) * (10 ** precision) + int(fraction.ljust(precision, '0') or '0')


def _error(code, path, message):
    return {'code': code, 'path': path, 'message': message}


def validate_budget(budget: dict) -> list[dict]:
    """Validate nested budget caps without enabling or allocating exploration."""
    if not isinstance(budget, dict):
        return [_error('invalid_type', 'budget', 'Budget must be an object')]
    errors = []
    currency = budget.get('currency')
    if not isinstance(currency, str) or currency not in CURRENCY_PRECISION:
        errors.append(_error('invalid_currency', 'budget.currency', 'A supported currency is required'))
    amounts = {}
    for field in ('total_cap', 'exploration_cap', 'unit_price_min', 'unit_price_max'):
        if field not in budget:
            if field == 'total_cap':
                errors.append(_error('required', 'budget.total_cap', 'Total budget is required'))
            continue
        if isinstance(currency, str) and currency in CURRENCY_PRECISION:
            try:
                amounts[field] = parse_money(budget[field], currency)
            except ValueError as exc:
                errors.append(_error('invalid_money', 'budget.' + field, str(exc)))
    if 'exploration_enabled' in budget and not isinstance(budget['exploration_enabled'], bool):
        errors.append(_error('invalid_type', 'budget.exploration_enabled', 'Exploration flag must be boolean'))
    if 'exploration_cap' in amounts and 'total_cap' in amounts and amounts['exploration_cap'] > amounts['total_cap']:
        errors.append(_error('exploration_cap_exceeds_total', 'budget.exploration_cap', 'Exploration cap must not exceed total cap'))
    if 'unit_price_min' in amounts and 'unit_price_max' in amounts and amounts['unit_price_min'] > amounts['unit_price_max']:
        errors.append(_error('invalid_price_range', 'budget.unit_price_max', 'Maximum price must not be below minimum price'))
    return errors


def validate_request(payload: dict, stage: str) -> list[dict]:
    """Validate task fields and any supplied budget, permitting research mode."""
    if stage not in ('matrix', 'budget', 'both'):
        return [_error('invalid_stage', 'stage', 'Stage must be matrix, budget or both')]
    if not isinstance(payload, dict):
        return [_error('invalid_type', '$', 'Request must be an object')]
    errors = []
    task = payload.get('task')
    if not isinstance(task, dict):
        errors.append(_error('invalid_type', 'task', 'Task must be an object'))
    else:
        if not isinstance(task.get('industry'), str) or not task['industry'].strip():
            errors.append(_error('required', 'task.industry', 'Industry is required'))
        questions = task.get('questions')
        if not isinstance(questions, list) or not questions:
            errors.append(_error('required', 'task.questions', 'A nonempty question list is required'))
        else:
            for index, question in enumerate(questions):
                path = f'task.questions[{index}]'
                if not isinstance(question, dict):
                    errors.append(_error('invalid_type', path, 'Question must be an object'))
                    continue
                for field in ('question_id', 'text'):
                    if not isinstance(question.get(field), str) or not question[field].strip():
                        errors.append(_error('required', path + '.' + field, 'Nonempty question field is required'))
    if 'budget' in payload:
        errors.extend(validate_budget(payload['budget']))
    elif stage == 'budget':
        errors.append(_error('required', 'budget', 'Budget is required for budget stage'))
    return errors
