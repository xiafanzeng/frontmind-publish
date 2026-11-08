const unrestrictedCoverageAliases = new Set([
  '不限地区', '全国', '全国覆盖', '综合全国', '综合全国（待确认）', '综合全国(待确认)',
]);

export function isUnrestrictedMediaCoverage(value?: string) {
  return unrestrictedCoverageAliases.has(value?.trim() ?? '');
}
