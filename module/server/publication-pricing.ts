import {publicationSelection, type PublicationSelection} from '../shared/publication-selection.js';
import {resolvePublisherQuote,type PublisherCatalogResource} from './publisher-source-matrix-catalog.js';

export function publicationPricing(snapshot:Record<string,unknown>|null|undefined,resource:PublisherCatalogResource,articleVersionId:string,asOf:string):{
  publication?:PublicationSelection;total:bigint;allocation:string[];blocker?:string;
}{
  const publication=publicationSelection(snapshot);
  if(!publication){return {total:BigInt(resource.priceTenThousandths),allocation:[String(resource.priceTenThousandths)],...(snapshot?.publication?{blocker:'历史发布方案缺少完整身份或数量契约，请重新生成并采用组合'}:{})};}
  const previous={publication,total:BigInt(publication.totalPriceTenThousandths),allocation:[] as string[]};
  if(publication.articleVersionId!==articleVersionId||publication.resourceId!==resource.id||(publication.quantity>1&&publication.quantityMeaning!=='repeat_same_article'))return {...previous,blocker:'发布项稿件版本、资源或数量含义已变化，请重新采用方案'};
  const quote=resolvePublisherQuote(resource,{offerId:publication.offerId,publicationSpec:publication.publicationSpec,quantity:publication.quantity,purpose:publication.purpose},asOf);
  if(!quote.ok)return {...previous,blocker:quote.reason};
  if(quote.quoteFingerprint!==publication.quoteFingerprint||quote.totalPriceTenThousandths!==publication.totalPriceTenThousandths)return {...previous,blocker:'报价、费用或数量规则已变化，请在矩阵更新组合后重新确认'};
  return {publication,total:BigInt(quote.totalPriceTenThousandths),allocation:quote.perPublicationTenThousandths};
}
