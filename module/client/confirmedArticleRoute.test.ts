import { describe, expect, it } from 'vitest';
import { confirmedArticleSelectionHref, isIndependentArticleSelection } from './confirmedArticleRoute';

describe('confirmed article navigation identity', () => {
  const search = '?articleId=a&articleVersion=a-v1&draftId=d&workbenchTask=w&matrixTask=m&task=m&mode=multi&titleMode=single&operatorOwnerId=9&enterpriseProjectId=p&batchDraft=d&batchArticle=a&batchArticleVersion=a-v1&excludedDraft=x&researchDataset=private-a';
  it('retains task/cart context for the exact same article and frozen version', () => {
    const url = new URL(confirmedArticleSelectionHref('/publishing/source-matrix?tab=matrix', search,
      { articleId: 'a', versionId: 'a-v1' }, { articleId: 'a', versionId: 'a-v1' }), 'https://module.invalid');
    expect(url.searchParams.get('draftId')).toBe('d');
    expect(url.searchParams.get('workbenchTask')).toBe('w');
    expect(url.searchParams.getAll('batchDraft')).toEqual(['d']);
    expect(url.searchParams.get('task')).toBe('m');
    expect(url.searchParams.get('tab')).toBe('matrix');
    expect(isIndependentArticleSelection(url.search)).toBe(false);
  });
  it.each([{ articleId: 'b', versionId: 'b-v1' }, { articleId: 'a', versionId: 'a-v2' }])('detaches bindings for a changed article/version without changing mode or project', next => {
    const url = new URL(confirmedArticleSelectionHref('/publishing/media/third', search, next,
      { articleId: 'a', versionId: 'a-v1' }), 'https://module.invalid');
    for (const key of ['draftId', 'workbenchTask', 'matrixTask', 'task', 'batchDraft', 'batchArticle', 'batchArticleVersion', 'excludedDraft', 'researchDataset'])
      expect(url.searchParams.has(key), key).toBe(false);
    expect(url.searchParams.get('articleId')).toBe(next.articleId);
    expect(url.searchParams.get('articleVersion')).toBe(next.versionId);
    expect(url.searchParams.get('mode')).toBe('multi');
    expect(url.searchParams.get('titleMode')).toBe('single');
    expect(url.searchParams.get('operatorOwnerId')).toBe('9');
    expect(url.searchParams.get('enterpriseProjectId')).toBe('p');
    expect(isIndependentArticleSelection(url.search)).toBe(true);
  });
  it('keeps legacy version-only host links compatible and preserves target hash', () => {
    expect(isIndependentArticleSelection('?articleVersion=v1')).toBe(false);
    expect(confirmedArticleSelectionHref('/publishing/source-matrix?tab=matrix#recommendations', '',
      { articleId: 'a/b', versionId: 'v1' })).toBe('/publishing/source-matrix?tab=matrix&articleId=a%2Fb&articleVersion=v1#recommendations');
  });
});
