import { describe, expect, it } from 'vitest';
import { publicationIdentity, publicationLineTotal, publicationSelectionAmounts } from './publicationAmounts';
import type { MediaResource, PublicationDraftItem } from './types';

const media = { id: 'media-1', priceTenThousandths: '1000000' } as MediaResource;
const repeated = (): PublicationDraftItem => ({ media, title: '已冻结标题', publication: {
  schemaVersion: 1, source: 'source_matrix_budget_plan', taskId: 'task-1', planId: 'plan-1', planVersion: 'plan-v1', planIndex: 0,
  articleId: 'article-1', articleVersionId: 'version-1', articleVersion: 'v1',
  resourceId: media.id, offerId: 'offer-1', publicationSpec: 'article', quantity: 3,
  quantityMeaning: 'repeat_same_article', purpose: 'standard', unitPriceTenThousandths: '1000000',
  totalPriceTenThousandths: '3100000', quoteFingerprint: 'a'.repeat(64), locked: false,
} });

describe('publication amount presentation', () => {
  it('uses the confirmed line total once, including the flat fee', () => {
    const row = repeated();
    expect(publicationLineTotal(row)).toBe('3100000');
    expect(publicationSelectionAmounts([media], [row]).knownTotal).toBe('3100000');
  });
  it('adds separate bound manuscripts without collapsing the shared media', () => {
    const first = repeated(), second = repeated();
    second.publication = { ...second.publication!, articleId: 'article-2', articleVersionId: 'version-2', quantity: 1, quantityMeaning: 'single', totalPriceTenThousandths: '1000000' };
    const result = publicationSelectionAmounts([media], [first, second]);
    expect(result.quantity).toBe(4);
    expect(result.knownTotal).toBe('4100000');
  });
  it('keeps an invalid stored quantity unknown rather than silently showing one', () => {
    const row = repeated(); row.publication!.quantity = 0;
    const result = publicationSelectionAmounts([media], [row]);
    expect(result.total).toBeNull(); expect(result.quantity).toBeNull(); expect(result.pending).toBe(1);
  });
  it('invalidates identity when quantity, quote or purpose changes', () => {
    const row = repeated(), original = publicationIdentity(row);
    row.publication!.quantity = 2;
    expect(publicationIdentity(row)).not.toBe(original);
  });
});
