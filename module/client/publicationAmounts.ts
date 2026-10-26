import type { MediaResource, PublicationDraftItem } from './types';

/** Display only: authoritative prices and quantities are verified by the server.
 * A publication total already includes quantity and any confirmed mandatory fees.
 * Never multiply that total again or substitute a catalogue unit price for it. */
export function publicationQuantity(item: PublicationDraftItem): number | null {
  if (!item.publication) return 1;
  const quantity = item.publication.quantity;
  return Number.isSafeInteger(quantity) && quantity > 0 ? quantity : null;
}

export function publicationLineTotal(item: PublicationDraftItem): string | null {
  if (item.publication) {
    const total = item.publication.totalPriceTenThousandths;
    return publicationQuantity(item) !== null && typeof total === 'string' && /^\d+$/.test(total) ? total : null;
  }
  const amount = item.media.priceTenThousandths;
  return /^\d+$/.test(amount) && BigInt(amount) > 0n ? amount : null;
}

/** A shared media row can contain several frozen manuscripts in batch mode. */
export function publicationSelectionAmounts(media: MediaResource[], items: PublicationDraftItem[] = []) {
  const byMedia = new Map<string, { quantity: number | null; total: string | null; knownTotal: string; pending: number; boundRows: number }>();
  for (const resource of media) {
    const bound = items.filter(item => item.media.id === resource.id);
    const rows = bound.length ? bound : [{ media: resource, title: '' }];
    let quantity: number | null = 0, known = 0n, pending = 0;
    for (const row of rows) {
      const count = publicationQuantity(row), amount = publicationLineTotal(row);
      quantity = count === null || quantity === null ? null : quantity + count;
      if (amount === null) pending++; else known += BigInt(amount);
    }
    byMedia.set(resource.id, { quantity, total: pending ? null : known.toString(), knownTotal: known.toString(), pending, boundRows: bound.length });
  }
  const rows = [...byMedia.values()];
  const pending = rows.filter(row => row.pending > 0).length;
  const quantity = rows.some(row => row.quantity === null) ? null : rows.reduce((sum, row) => sum + row.quantity!, 0);
  const knownTotal = rows.reduce((sum, row) => sum + BigInt(row.knownTotal), 0n).toString();
  return { byMedia, quantity, pending, knownTotal, total: pending ? null : knownTotal };
}

export function publicationIdentity(item: PublicationDraftItem) {
  const value = item.publication;
  return value ? JSON.stringify([value.schemaVersion, value.source, value.taskId, value.planId, value.planVersion, value.planIndex,
    value.articleId, value.articleVersionId, value.articleVersion,
    value.resourceId, value.offerId, value.publicationSpec, value.quantity, value.quantityMeaning,
    value.purpose, value.unitPriceTenThousandths, value.totalPriceTenThousandths, value.quoteFingerprint, value.locked]) : '';
}
