import { describe, expect, it } from 'vitest';
import type { IndustryCatalogResponse } from '../../shared/industry-catalog';
import { canonicalizeMatrixInputIndustry, resolveSavedTaskIndustry } from './saved-task-industry';

const catalog = {
  status: 'configured', catalogVersion: 'revision-a', filters: null, brand_data_batches: [],
  industries: [
    { id: '101', scopeId: '101', name: '软件服务', label: '软件服务', path: ['科技', '软件服务'], depth: 1 },
    { id: '202', scopeId: '202', name: '设备', label: '设备', path: ['医疗', '设备'], depth: 1 },
    { id: '303', scopeId: '303', name: '设备', label: '设备', path: ['工业', '设备'], depth: 1 },
  ],
  legacyMappings: [{ localId: 'legacy-software', localName: '旧软件服务', canonicalId: '101', status: 'mapped', via: 'explicit' }],
} satisfies IndustryCatalogResponse;

describe('saved industry compatibility', () => {
  it('prefers an existing canonical identity and maps a proven legacy identity', () => {
    expect(resolveSavedTaskIndustry({ industry_id: '202', industry: '旧名称' }, catalog).id).toBe('202');
    expect(resolveSavedTaskIndustry({ industry_dataset_id: 'legacy-software' }, catalog).id).toBe('101');
  });
  it('recovers name-only old tasks without guessing among duplicate labels', () => {
    expect(resolveSavedTaskIndustry({ industry: '软件服务' }, catalog).id).toBe('101');
    expect(resolveSavedTaskIndustry({ industry: '设备' }, catalog)).toEqual({ id: null, reason: 'ambiguous' });
    expect(resolveSavedTaskIndustry({ industry: '医疗 / 设备' }, catalog).id).toBe('202');
  });
  it('leaves unresolved legacy requirements visible as unresolved, not a software fallback', () => {
    expect(resolveSavedTaskIndustry({}, catalog)).toEqual({ id: null, reason: 'missing' });
    expect(resolveSavedTaskIndustry({ industry: '尚未接入分类' }, catalog)).toEqual({ id: null, reason: 'unmapped' });
  });
  it('replaces only the saved snapshot industry when a late directory resolves it', () => {
    expect(canonicalizeMatrixInputIndustry(JSON.stringify(['', 'saved brand', 'audience', ['question']]), '101'))
      .toBe(JSON.stringify(['101', 'saved brand', 'audience', ['question']]));
    expect(canonicalizeMatrixInputIndustry(null, '101')).toBeNull();
  });
});
