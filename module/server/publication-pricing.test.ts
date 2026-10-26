import {describe,it,expect} from 'vitest';
import {plannerAmount,publisherPlannerCatalogRows,resolvePublisherQuote,type PublisherCatalogResource} from './publisher-source-matrix-catalog.js';
import {publicationPricing} from './publication-pricing.js';

const asOf='2026-10-26T12:00:00+08:00';
const offer={offer_id:'o1',publication_spec:'text',provider_resource_id:'provider-1',provider_execution:'independent_unit_orders',repeat_allowed:true,
  pricing:{kind:'unit',amount:'100.00',currency:'CNY',quoted_at:'2026-10-01T00:00:00+08:00',valid_until:'2026-11-01T00:00:00+08:00',mandatory_fees:[{basis:'unit',amount:'10.00'},{basis:'item',amount:'5.00'}]}};
const resource=(value:unknown=offer):PublisherCatalogResource=>({id:'r1',name:'具体账号',externalResourceId:'provider-1',catalogRevision:'cat1',priceTenThousandths:'1000000',rawPayload:{publisher_quote_v1:value}});
const choice={offerId:'o1',publicationSpec:'text',quantity:3,purpose:'standard'};
describe('trusted publication quote and quantity',()=>{
  it('keeps unknown fees unknown and never rounds a four-decimal legacy price',()=>{
    expect(plannerAmount('1234567')).toBeNull();expect(plannerAmount('1234500')).toBe('123.45');
    expect(publisherPlannerCatalogRows({...resource(),rawPayload:{}})[0]).toMatchObject({offer_id:null,pricing:{mandatory_fees:null,amount:'100.00'}});
    expect(resolvePublisherQuote(resource({...offer,pricing:{...offer.pricing,mandatory_fees:undefined}}),choice,asOf).ok).toBe(false);
  });
  it('allocates unit fees per copy and the item fee once without rounding',()=>{
    const quote=resolvePublisherQuote(resource(),choice,asOf);expect(quote.ok).toBe(true);if(!quote.ok)return;
    expect(quote.totalPriceTenThousandths).toBe('3350000');
    expect(quote.perPublicationTenThousandths).toEqual(['1150000','1100000','1100000']);
    expect(quote.perPublicationTenThousandths.reduce((sum,n)=>sum+BigInt(n),0n).toString()).toBe(quote.totalPriceTenThousandths);
  });
  it('rejects ambiguous offers, unsupported package execution and unconfirmed repetitions',()=>{
    expect(resolvePublisherQuote({...resource(),rawPayload:{publisher_offers_v1:[offer,offer]}},choice,asOf).ok).toBe(false);
    expect(resolvePublisherQuote(resource({...offer,repeat_allowed:false}),choice,asOf).ok).toBe(false);
    expect(resolvePublisherQuote(resource({...offer,pricing:{...offer.pricing,kind:'package'}}),choice,asOf).ok).toBe(false);
    expect(resolvePublisherQuote(resource(),{...choice,quantity:0},asOf).ok).toBe(false);
    expect(resolvePublisherQuote(resource(),choice,'2026-12-01T00:00:00+08:00').ok).toBe(false);
  });
  it('invalidates the frozen publication when a quote, version or total changes',()=>{
    const quote=resolvePublisherQuote(resource(),choice,asOf);if(!quote.ok)throw new Error(quote.reason);
    const publication={schemaVersion:1,source:'source_matrix_budget_plan',taskId:'task1',planId:'plan1',planVersion:'pv1',planIndex:0,
      articleId:'article1',articleVersionId:'version1',articleVersion:'v1',resourceId:'r1',offerId:'o1',publicationSpec:'text',quantity:3,quantityMeaning:'repeat_same_article',purpose:'standard',
      unitPriceTenThousandths:quote.unitPriceTenThousandths,totalPriceTenThousandths:quote.totalPriceTenThousandths,quoteFingerprint:quote.quoteFingerprint,locked:false};
    expect(publicationPricing({publication},resource(),'version1',asOf).blocker).toBeUndefined();
    expect(publicationPricing({publication},resource(),'version2',asOf).blocker).toBeDefined();
    expect(publicationPricing({publication},resource({...offer,pricing:{...offer.pricing,mandatory_fees:[]}}),'version1',asOf).blocker).toBeDefined();
  });
});
