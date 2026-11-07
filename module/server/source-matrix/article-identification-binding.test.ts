import { expect, it, vi } from 'vitest';
import { BindingStore } from './binding.js';

it('reads plain_text from the exact authorized frozen row, not a working-copy body', async () => {
  const execute = vi.fn().mockResolvedValue([[{ id: 'version-2', article_id: 'article-1', version: 2, content_hash: 'hash-2', plain_text: '完整冻结正文', working_name: '真实当前稿件名称' }], []]);
  const store = new BindingStore({ execute } as any, { ownerId: 'owner-1', enterpriseProjectId: 'project-1' });
  expect(await store.loadIdentificationArticle({ articleVersionId: 'version-2' })).toEqual({ article: { articleVersionId: 'version-2', articleId: 'article-1', versionNumber: 2, contentHash: 'hash-2', body: '完整冻结正文', title: '真实当前稿件名称' } });
});

it('does not read frozen content for a draft from another owner or a mismatched version', async () => {
  const execute = vi.fn().mockResolvedValue([[], []]);
  const store = new BindingStore({ execute } as any, { ownerId: 'owner-1', enterpriseProjectId: 'project-1' });
  expect(await store.loadIdentificationArticle({ articleVersionId: 'version-2', draftId: 'other-draft' })).toEqual({ failure: 'draft_not_found' });
  expect(execute).toHaveBeenCalledTimes(1);
  execute.mockClear(); execute.mockResolvedValue([[{ id: 'draft-1', article_version_id: 'version-1', status: 'draft', revision: 1 }], []]);
  expect(await store.loadIdentificationArticle({ articleVersionId: 'version-2', draftId: 'draft-1' })).toEqual({ failure: 'draft_version_mismatch' });
  expect(execute).toHaveBeenCalledTimes(1);
});
