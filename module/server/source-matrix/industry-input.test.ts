import { expect, it, vi } from 'vitest';
import { liveIndustryInput, liveInputIdentity, savedIndustryInput } from './industry-input.js';

it('derives a stable industry identity without inventing resources, quotes or legacy data', () => {
 const first=liveIndustryInput('201'),again=liveIndustryInput('201'),other=liveIndustryInput('202');
 expect(first).toEqual(again);expect(first.brandId).not.toBe(other.brandId);
 expect(first).toEqual({industryId:'201',brandId:expect.stringMatching(/^canonical-industry-[a-f0-9]{24}$/),dataset:{}});
});
it('replays the original live input even if legacy enrichment is configured later', async () => {
 const industry=liveIndustryInput('201'),read=vi.fn(async()=>({industryId:'201',brandId:'new-local-brand',dataset:{catalog:[{resource_id:'unrelated'}]}}));
 const task={industryId:industry.industryId,brandId:industry.brandId,task:{industry_id:'201',recommendation_input:liveInputIdentity(industry)}};
 expect(await savedIndustryInput(task,{industry:read})).toEqual(industry);expect(read).not.toHaveBeenCalled();
});
it('retains the original local lookup for existing tasks and refuses corrupted live identity', async () => {
 const configured={industryId:'legacy-1',brandId:'brand-1',dataset:{citations:[{evidence_id:'existing'}]}};
 const read=vi.fn(async()=>configured);
 expect(await savedIndustryInput({industryId:'legacy-1',brandId:'brand-1',task:{}},{industry:read})).toEqual(configured);
 const live=liveIndustryInput('201');
 for(const patch of [{industryId:'202'},{brandId:'changed'},{task:{industry_id:'202',recommendation_input:liveInputIdentity(live)}}]){
  expect(await savedIndustryInput({industryId:'201',brandId:live.brandId,task:{industry_id:'201',recommendation_input:liveInputIdentity(live)},...patch},{industry:read})).toBeUndefined();
 }
 expect(read).toHaveBeenCalledTimes(1);
});
