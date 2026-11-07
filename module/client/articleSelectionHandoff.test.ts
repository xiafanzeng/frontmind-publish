import { afterEach, expect, it, vi } from 'vitest';
import type { PublisherGateway } from './gateway';
import type { LatestArticleSelection } from './latestArticleSelection';
import { consumePreparedArticleSelection, prepareArticleSelection } from './articleSelectionHandoff';

afterEach(() => vi.restoreAllMocks());

it('transfers the complete verified binding once and isolates gateway, workspace, article and version', () => {
  const gateway = {} as PublisherGateway;
  const other = {} as PublisherGateway;
  const selection = { article: { id: 'a', bodyHtml: '<p>Latest content</p>' }, version: { id: 'a-v2' } } as LatestArticleSelection;
  prepareArticleSelection(gateway, 1, selection);
  expect(consumePreparedArticleSelection(other, 1, 'a', 'a-v2')).toBeUndefined();
  expect(consumePreparedArticleSelection(gateway, 1, 'a', 'a-v2')).toBe(selection);
  expect(consumePreparedArticleSelection(gateway, 1, 'a', 'a-v2')).toBeUndefined();
  for (const [workspace, articleId, versionId] of [[2, 'a', 'a-v2'], [1, 'b', 'a-v2'], [1, 'a', 'a-v1']] as const) {
    prepareArticleSelection(gateway, 1, selection);
    expect(consumePreparedArticleSelection(gateway, workspace, articleId, versionId)).toBeUndefined();
  }
});

it('does not reuse an abandoned handoff after its short navigation window', () => {
  const gateway = {} as PublisherGateway;
  const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
  prepareArticleSelection(gateway, 1, { article: { id: 'a' }, version: { id: 'v' } } as LatestArticleSelection);
  now.mockReturnValue(61_001);
  expect(consumePreparedArticleSelection(gateway, 1, 'a', 'v')).toBeUndefined();
});
