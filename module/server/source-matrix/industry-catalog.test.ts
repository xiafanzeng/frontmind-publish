import { expect, it, vi } from 'vitest';
import { flattenIndustryCatalog, mapLegacyIndustries } from '../../shared/industry-catalog.js';
import type { IndustryScopeNode } from '../../contracts/industry-source.js';
import type { ModuleHttpCore } from '../http-api.js';
import { industryProviderFor, loadIndustryCatalog } from './industry-catalog.js';
import type { Request } from 'express';

const node = (id: string, label: string, children: IndustryScopeNode[] = []): IndustryScopeNode => ({ id: `node-${id}`, scopeId: id, label, children, scopeType: 'CATEGORY' });
it('preserves every canonical scopeId, long name and hierarchy independently of local datasets', () => {
  const tree = [node('1', '商业', [node('2', '零售')]), ...Array.from({ length: 4998 }, (_, i) => node(String(i + 3), '行业'.repeat(240) + i))];
  const options = flattenIndustryCatalog(tree);
  expect(options).toHaveLength(5000);
  expect(options[1]).toEqual({ id: '2', scopeId: '2', name: '零售', label: '\u3000零售', path: ['商业', '零售'], depth: 1 });
  expect(options[4999]!.name.length).toBeGreaterThan(200);
  expect(() => flattenIndustryCatalog([node('1', '甲'), node('1', '乙')])).toThrow('invalid_industry_catalog');
});
it('maps only identities, explicit trusted scope IDs or unique exact names', () => {
  const options = flattenIndustryCatalog([node('1', '软件测试'), node('2', '重复'), node('3', '重复')]);
  expect(mapLegacyIndustries([{ id: 'legacy', name: '软件测试' }, { id: 'other', name: '重复' }, { id: 'none', name: '软件' }, { id: 'explicit', name: '旧名称', canonicalId: '3' }], options)).toEqual([
    { localId: 'legacy', localName: '软件测试', canonicalId: '1', status: 'mapped', via: 'unique_name' },
    { localId: 'other', localName: '重复', canonicalId: null, status: 'ambiguous' },
    { localId: 'none', localName: '软件', canonicalId: null, status: 'unmapped' },
    { localId: 'explicit', localName: '旧名称', canonicalId: '3', status: 'mapped', via: 'explicit' },
  ]);
  expect(mapLegacyIndustries([{ id: 'legacy', name: '软件测试', canonicalId: 'removed' }], options)[0]?.status).toBe('unmapped');
});
it('reuses the same scoped provider for catalog and the distribution router without a billed endpoint', async () => {
  const core = { context: () => ({ accountUserId: 1, actorUserId: 2, businessOwnerId: 'owner', enterpriseProjectId: 'project' }), environment: { FRONTMIND_SOURCE_MATRIX_MOLIZHISHU_API_TOKEN: 'fixture-token' } } as unknown as ModuleHttpCore;
  const provider = industryProviderFor(core);
  expect(industryProviderFor(core)).toBe(provider);
  const query = vi.spyOn(provider, 'query').mockResolvedValue({ status: 'ok', source: 'molizhishu-public-industry', fetchedAt: '2026-11-07T00:00:00Z', data: { models: [], minDate: null, maxDate: null, sourceTypes: [], industryTree: [node('101', '零售')] } });
  const request = { get: () => undefined } as unknown as Request;
  const response = await loadIndustryCatalog(core, request);
  expect(response).toMatchObject({ status: 'ok', data: { industries: [{ id: '101' }] } });
  expect(query.mock.calls[0]![0]).toBe('filters');
  expect(query.mock.calls[0]![1].toString()).toBe('');
  query.mockRestore();
});
