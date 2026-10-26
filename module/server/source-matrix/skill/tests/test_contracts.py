import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.contracts import parse_money, validate_budget, validate_request


class MoneyTests(unittest.TestCase):
    def test_money_uses_major_units_and_exact_minor_units(self):
        self.assertEqual(parse_money('5000', 'CNY'), 500000)
        self.assertEqual(parse_money(800, 'CNY'), 80000)
        self.assertEqual(parse_money('0.29', 'USD'), 29)
        self.assertEqual(parse_money('1.20', 'EUR'), 120)
        self.assertEqual(parse_money('12', 'JPY'), 12)

    def test_rejects_unsafe_or_invalid_money(self):
        for value in [-1, '-0.01', True, 1.2, 'NaN', 'Infinity', '1.001', '', '1e2']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                parse_money(value, 'CNY')
        for value, currency in [('1.0', 'JPY'), ('1', 'GBP')]:
            with self.subTest(currency=currency), self.assertRaises(ValueError):
                parse_money(value, currency)


class BudgetTests(unittest.TestCase):
    def test_valid_nested_caps(self):
        self.assertEqual(validate_budget({'total_cap': '5000', 'exploration_cap': '800', 'currency': 'CNY', 'exploration_enabled': True}), [])

    def test_exploration_cannot_exceed_total(self):
        errors = validate_budget({'total_cap': '5000', 'exploration_cap': '5001', 'currency': 'CNY'})
        self.assertEqual(errors[0]['path'], 'budget.exploration_cap')
        self.assertEqual(errors[0]['code'], 'exploration_cap_exceeds_total')

    def test_disabled_missing_and_zero_caps_are_valid_without_authorizing_exploration(self):
        for fields in [{'exploration_enabled': False}, {'exploration_enabled': True}, {'exploration_enabled': True, 'exploration_cap': '0'}]:
            self.assertEqual(validate_budget(dict(total_cap='5000', currency='CNY', **fields)), [])

    def test_field_errors_are_structured(self):
        for field, value in [('total_cap', True), ('exploration_cap', '-1'), ('unit_price_min', 'NaN'), ('unit_price_max', 1.5)]:
            errors = validate_budget({'currency': 'CNY', 'total_cap': '5000', field: value})
            self.assertTrue(any(e['path'] == 'budget.' + field for e in errors))
            self.assertTrue(all(set(e) == {'code', 'path', 'message'} for e in errors))

    def test_currency_required_and_price_range_ordered(self):
        self.assertEqual(validate_budget({'total_cap': '1'})[0]['path'], 'budget.currency')
        self.assertTrue(validate_budget({'total_cap': '5', 'currency': 'CNY', 'unit_price_min': '3', 'unit_price_max': '2'}))

    def test_budget_wrong_type_and_boolean_flag_rejected(self):
        self.assertTrue(validate_budget(None))
        self.assertTrue(validate_budget({'total_cap': '1', 'currency': 'CNY', 'exploration_enabled': 'true'}))


class RequestTests(unittest.TestCase):
    def request(self):
        return {'task': {'industry': '制造', 'questions': [{'question_id': 'q1', 'text': '如何选型？'}]}}

    def test_matrix_and_both_allow_missing_budget(self):
        for stage in ['matrix', 'both']:
            self.assertEqual(validate_request(self.request(), stage), [])

    def test_budget_stage_requires_budget(self):
        self.assertIn('budget', [e['path'] for e in validate_request(self.request(), 'budget')])

    def test_required_task_fields_have_paths(self):
        errors = validate_request({'task': {}}, 'matrix')
        self.assertEqual({e['path'] for e in errors}, {'task.industry', 'task.questions'})

    def test_question_fields_and_types(self):
        payload = self.request()
        payload['task']['questions'] = [{'question_id': '', 'text': ''}, 'bad']
        self.assertEqual({e['path'] for e in validate_request(payload, 'matrix')}, {'task.questions[0].question_id', 'task.questions[0].text', 'task.questions[1]'})

    def test_invalid_stage_and_payload(self):
        self.assertEqual(validate_request({}, 'wrong')[0]['path'], 'stage')
        self.assertEqual(validate_request(None, 'matrix')[0]['path'], '$')

    def test_unknown_fields_are_not_inferred_or_mutated(self):
        payload = self.request()
        payload['guess_industry'] = 'ignored'
        before = repr(payload)
        self.assertEqual(validate_request(payload, 'matrix'), [])
        self.assertEqual(repr(payload), before)

    def test_supplied_invalid_budget_is_checked_in_all_stages(self):
        for stage in ['matrix', 'budget', 'both']:
            payload = self.request()
            payload['budget'] = {'currency': 'CNY', 'total_cap': '-1'}
            self.assertEqual(validate_request(payload, stage)[0]['path'], 'budget.total_cap')


if __name__ == '__main__':
    unittest.main()
