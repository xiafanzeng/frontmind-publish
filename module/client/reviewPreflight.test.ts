import { expect, it } from "vitest";
import type { PublicationDraft, PublicationPreflight } from "./types";
import { preflightMatchesReviewDraft, reviewDraftContext } from "./reviewPreflight";

function draft(): PublicationDraft {
  return {id:"draft-a",revision:3,articleId:"article-a",articleVersionId:"version-a",articleVersionHash:"hash-a",
    titleMode:"per_media",items:[{media:{id:"shared-media",priceTenThousandths:"10000",kind:"news",catalogRevision:"catalog"},title:"本稿正式标题"}]} as PublicationDraft;
}
function preflight(): PublicationPreflight {
  return {draftRevision:3,article:{id:"article-a",versionId:"version-a",hash:"hash-a"},titleMode:"per_media",
    items:[{media:{id:"shared-media"},title:"本稿正式标题"}]} as PublicationPreflight;
}

it("keys an approval by real draft, version, mode, media selection and title", () => {
  const current=draft();
  const key=reviewDraftContext(current);
  const variants=[
    {...current,id:"draft-b"}, {...current,articleVersionId:"version-b"}, {...current,revision:4},
    {...current,titleMode:"single" as const}, {...current,sharedTitle:"另一个统一标题"},
    {...current,items:[]}, {...current,items:current.items.map(item=>({...item,title:"其他标题"}))},
  ];
  for(const value of variants) expect(reviewDraftContext(value)).not.toBe(key);
});

it("accepts an omitted optional mode without rewriting the approval snapshot", () => {
  const value=preflight();delete value.titleMode;
  expect(preflightMatchesReviewDraft(draft(),value)).toBe(true);
  expect(value.titleMode).toBeUndefined();
});

it("rejects results for stale revisions, frozen versions, titles, mode or media", () => {
  const current=draft();const value=preflight();
  expect(preflightMatchesReviewDraft(current,value)).toBe(true);
  for(const stale of [
    {...value,draftRevision:2}, {...value,article:{...value.article,versionId:"other"}},
    {...value,article:{...value.article,hash:"other"}}, {...value,titleMode:"single" as const},
    {...value,items:[]}, {...value,items:value.items.map(item=>({...item,title:"旧标题"}))},
    {...value,items:value.items.map(item=>({...item,media:{...item.media,id:"other"}}))},
  ]) expect(preflightMatchesReviewDraft(current,stale)).toBe(false);
});

it("invalidates an approval when publication quantity or exact offer changes at the same amount", () => {
  const current=draft(), value=preflight();
  const publication: NonNullable<PublicationDraft['items'][number]['publication']> = {
    schemaVersion:1,source:'source_matrix_budget_plan',taskId:'task',planId:'plan',planVersion:'pv',planIndex:0,
    articleId:'article-a',articleVersionId:'version-a',articleVersion:'1',resourceId:'shared-media',offerId:'offer-a',
    publicationSpec:'article',quantity:2,quantityMeaning:'repeat_same_article',purpose:'standard',
    unitPriceTenThousandths:'10000',totalPriceTenThousandths:'20000',quoteFingerprint:'a'.repeat(64),locked:false,
  };
  current.items[0].publication=publication;value.items[0].publication={...publication};
  expect(preflightMatchesReviewDraft(current,value)).toBe(true);
  const context=reviewDraftContext(current);
  value.items[0].publication.quantity=3;
  expect(preflightMatchesReviewDraft(current,value)).toBe(false);
  current.items[0].publication={...publication,offerId:'offer-b'};
  expect(reviewDraftContext(current)).not.toBe(context);
});
