import { describe, expect, it } from 'vitest';
import { parseMoney, validateBudget } from './contracts.js';
describe('exact major-unit money boundary', () => {
  it('keeps precision without floats and rejects ambiguous representations', () => {
    expect(parseMoney('800.01','CNY')).toBe(80001n);
    expect(parseMoney(800,'JPY')).toBe(800n);
    for (const v of [true, 0.1, '-1', '1e3', ' 1', '1.001', 'NaN']) expect(() => parseMoney(v,'CNY')).toThrow();
    expect(() => parseMoney('1.0','JPY')).toThrow();
  });
  it('validates independent sublimit without enabling exploration implicitly', () => {
    expect(validateBudget({currency:'CNY',total_cap:'10',exploration_cap:'11'}).map(e=>e.code)).toContain('exploration_cap_exceeds_total');
    expect(validateBudget({currency:'CNY',total_cap:'10',exploration_enabled:true})).toEqual([]);
  });
});
