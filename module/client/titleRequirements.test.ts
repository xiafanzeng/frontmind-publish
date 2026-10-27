import { describe, expect, it } from 'vitest';
import { parseMediaRules } from '../server/providers/kol/media-rules';
import { titleLimitMessage, titleRequirementDisplay } from './titleRequirements';

const collectedAt = '2026-10-27T00:00:00Z';

describe('title requirement evidence presentation', () => {
  it('does not invent a media limit when the original catalogue has none', () => {
    const display = titleRequirementDisplay(parseMediaRules('自备短标题', collectedAt, null));
    expect(display.state).toBe('unknown');
    expect(display.text).toBeUndefined();
    expect(display.max).toBeUndefined();
    expect(titleLimitMessage(200, display)).toBe('超过当前提交上限 200 字，请缩短标题。');
  });

  it('keeps a real API limit of 200 rather than treating that value as always default', () => {
    const rules = parseMediaRules('', collectedAt, 200);
    const display = titleRequirementDisplay(rules);
    expect(display).toMatchObject({ state: 'constrained', max: 200, exclusive: false, text: '目录要求：标题不超过 200 字', evidence: ['API title_limit=200'], source: rules.source, collectedAt });
    expect(titleLimitMessage(200, display)).toContain('当前目录标题要求');
  });

  it('preserves strict and inclusive original remark limits', () => {
    const strict = titleRequirementDisplay(parseMediaRules('标题少于30字', collectedAt));
    const inclusive = titleRequirementDisplay(parseMediaRules('标题不超过30字', collectedAt));
    expect(strict).toMatchObject({ state: 'constrained', max: 30, exclusive: true, evidence: ['标题少于30字'], text: '目录要求：标题少于 30 字' });
    expect(inclusive).toMatchObject({ max: 30, exclusive: false, text: '目录要求：标题不超过 30 字' });
    expect(titleLimitMessage(29, strict)).toContain('当前目录标题要求（少于 30 字）');
    expect(titleLimitMessage(30, strict)).toBe('超过当前提交上限 30 字，请缩短标题。');
  });

  it('keeps explicit unlimited distinct from unknown and from a submission cap', () => {
    const display = titleRequirementDisplay(parseMediaRules('标题字数不限', collectedAt));
    expect(display).toMatchObject({ state: 'explicitly_unlimited', text: '目录明确：标题字数不限', evidence: ['标题字数不限'] });
    expect(titleLimitMessage(200, display)).toContain('当前提交上限 200 字');
  });

  it('retains conflicting original evidence without selecting one requirement', () => {
    const display = titleRequirementDisplay(parseMediaRules('标题少于30字', collectedAt, 30));
    expect(display).toMatchObject({ state: 'conflict', text: '标题要求来源冲突，请确认媒体资料。', evidence: ['API title_limit=30', '标题少于30字'] });
    expect(display.max).toBeUndefined();
    expect(titleLimitMessage(30, display)).toContain('当前提交上限 30 字');
  });

  it('does not attribute a different frozen submission cap to current catalogue evidence', () => {
    const display = titleRequirementDisplay(parseMediaRules('标题最多300字', collectedAt));
    expect(display.max).toBe(300);
    expect(titleLimitMessage(200, display)).toBe('超过当前提交上限 200 字，请缩短标题。');
  });

  it('keeps missing catalogue rows separate from a successfully read unknown rule', () => {
    expect(titleRequirementDisplay().state).toBe('unavailable');
    expect(titleRequirementDisplay({ ...parseMediaRules('', collectedAt), rules: [] }).state).toBe('unavailable');
    expect(titleRequirementDisplay(parseMediaRules('', collectedAt)).state).toBe('unknown');
  });

  it('rejects numeric or unlimited claims without their original evidence', () => {
    const rules = parseMediaRules('', collectedAt, 200);
    expect(titleRequirementDisplay({ ...rules, rules: [{ field: 'title_chars', state: 'constrained', max: 200, evidence: [] }] }).state).toBe('unavailable');
    expect(titleRequirementDisplay({ ...rules, rules: [{ field: 'title_chars', state: 'explicitly_unlimited', evidence: [' '] }] }).state).toBe('unavailable');
    expect(titleRequirementDisplay({ ...rules, rules: [{ field: 'title_chars', state: 'constrained', max: Number.NaN, evidence: ['标题最多200字'] }] }).state).toBe('unavailable');
  });
});
