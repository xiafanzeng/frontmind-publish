import { describe, expect, it } from 'vitest';
import { mediaAiPlatforms, mediaCoverageProvinces, normalizedCoverageFacets, normalizedTagFacets } from './media-catalog-filters.js';
import { isMatrixTargetPlatform, matrixHourLabel, matrixRegionDraft, normalizeMatrixRegions, normalizeMatrixTargetPlatform } from './matrix-requirements.js';

describe('shared matrix requirement vocabulary', () => {
  it('offers only reviewed provincial choices and the catalogue AI platforms', () => {
    expect(mediaCoverageProvinces).toContain('香港');
    for (const excluded of ['全国覆盖', '综合全国（待确认）', '港澳台', '海外']) expect(mediaCoverageProvinces).not.toContain(excluded);
    expect(normalizedCoverageFacets([{ value: '广东省', count: 1 }]).coverageProvinces[0]?.value).toBe(mediaCoverageProvinces.find(value => value === '广东'));
    expect(normalizedTagFacets([{ tags: ['kimi'], count: 1 }]).aiPlatforms[0]?.value).toBe(normalizeMatrixTargetPlatform('kimi'));
    expect(mediaAiPlatforms.every(isMatrixTargetPlatform)).toBe(true);
    expect(isMatrixTargetPlatform('百度文心-手机版')).toBe(false);
  });
  it('normalizes legacy aliases without dropping unknown regions or retaining conflicting nationwide entries', () => {
    expect(normalizeMatrixRegions('全国、广东省、深圳、旧城区、海外、港澳台')).toEqual(['广东', '深圳', '旧城区', '海外', '港澳台']);
    expect(normalizeMatrixRegions(['全国覆盖', '综合全国（待确认）'])).toEqual([]);
    expect(normalizeMatrixRegions(['广东省 广州市', '广州市', '深圳'])).toEqual(['广东省 广州市', '广州市', '深圳']);
    expect(matrixRegionDraft('', false)).toEqual({ regions: '', regionsUnrestricted: false });
    expect(matrixRegionDraft('全国')).toEqual({ regions: '', regionsUnrestricted: true });
    expect(matrixRegionDraft('全国、广东', true)).toEqual({ regions: '广东', regionsUnrestricted: false });
  });
  it('labels preset and old hours without rounding or interpreting zero as unlimited', () => {
    expect(matrixHourLabel('24')).toBe('1天以内');
    expect(matrixHourLabel('48')).toBe('原设置：48 小时');
    expect(matrixHourLabel('0')).toBe('原设置：0 小时');
    expect(matrixHourLabel('')).toBe('不限时效');
  });
});
