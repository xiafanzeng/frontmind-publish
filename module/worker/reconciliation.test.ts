import { describe, expect, it, vi } from "vitest";
import { PublisherWorkerProcessor } from "./processor.js";
import { KolProviderError, KolSubmissionUnknownError } from "../server/providers/kol/errors.js";

const now = new Date("2026-10-24T12:00:00Z");
const startedAt = new Date("2026-10-22T12:00:00Z");
function fixture() {
  const repository = {
    preparePublisherSubmission: vi.fn(async()=>({status:"ready",attemptId:"attempt",item:{resourceId:42,title:"稿件",canonicalHtml:"<p>稿件</p>"}})),
    markPublisherSubmissionUnknown:vi.fn(),markPublisherSubmissionBlocked:vi.fn(),markPublisherSubmissionRejected:vi.fn(),
    markKolCredentialAuthBlocked:vi.fn(),
    getPublisherReconciliationContext:vi.fn(async()=>({attemptNumber:1,startedAt,resourceId:42,title:"稿件"})),
    recordPublisherReconciliationCandidates:vi.fn(),
  };
  const provider = { createOrder:vi.fn(),listOrders:vi.fn(async()=>({orders:[],pagination:{currentPage:1,lastPage:1,total:0,perPage:20}})) };
  const processor = new PublisherWorkerProcessor({repository,provider,objectStore:{},logger:{warn:vi.fn()},now:()=>now} as never,
    {workerId:"test",mode:"live",realEnabled:true,publishEnabled:true,imageEnabled:false,submissionIntervalMs:0} as never);
  const run=(type:"submit_publication_item"|"reconcile_publication_unknown")=>processor.handle({id:"job",type,payload:{itemId:"item"},attemptCount:0,maxAttempts:5,leasedUntil:now});
  return {repository,provider,run};
}
describe("publisher failure boundary and reconciliation",()=>{
  it("records before-send authentication failure without freezing an unknown order",async()=>{
    const f=fixture();f.provider.createOrder.mockRejectedValue(new KolProviderError("authentication_blocked","rejected",{
      operation:"create_order_preflight",httpStatus:401,submissionPhase:"before_send"}));
    await f.run("submit_publication_item");
    expect(f.repository.markPublisherSubmissionBlocked).toHaveBeenCalledWith(expect.objectContaining({status:"auth_blocked",
      providerRaw:{failure:expect.objectContaining({httpStatus:401,submissionPhase:"before_send",submissionMayHaveSucceeded:false})}}));
    expect(f.repository.markPublisherSubmissionUnknown).not.toHaveBeenCalled();
  });
  it.each([401,403])("preserves sent HTTP %s as unknown and blocks the credential gate",async(status)=>{
    const f=fixture();f.provider.createOrder.mockRejectedValue(new KolSubmissionUnknownError(undefined,{httpStatus:status}));
    await f.run("submit_publication_item");
    expect(f.repository.markPublisherSubmissionUnknown).toHaveBeenCalledWith(expect.objectContaining({blockCredentialGate:true,
      providerRaw:{failure:expect.objectContaining({httpStatus:status,submissionPhase:"after_send",submissionMayHaveSucceeded:true})}}));
    expect(f.repository.markPublisherSubmissionBlocked).not.toHaveBeenCalled();
  });
  it("keeps empty complete scans pending; never refunds or resends",async()=>{
    const f=fixture();await expect(f.run("reconcile_publication_unknown")).rejects.toMatchObject({availableAt:new Date(now.valueOf()+600000)});
    expect(f.repository.recordPublisherReconciliationCandidates).toHaveBeenCalledWith(expect.objectContaining({orders:[],scan:expect.objectContaining({complete:true,pagesFetched:1,ordersSeen:0})}));
    expect(f.provider.createOrder).not.toHaveBeenCalled();expect(f.repository.markPublisherSubmissionRejected).not.toHaveBeenCalled();
  });
  it("retains candidates from the original old attempt and reports truncated scans",async()=>{
    const f=fixture();const order={orderId:"match",resourceId:42,title:"稿件",createdAt:startedAt.valueOf()/1000,status:"processing",raw:{}};
    f.provider.listOrders.mockImplementation(async()=>({orders:[order,{...order,orderId:"wrong",resourceId:99}],pagination:{currentPage:1,lastPage:9,total:180,perPage:20}}) as never);
    await expect(f.run("reconcile_publication_unknown")).rejects.toThrow();
    expect(f.provider.listOrders).toHaveBeenCalledTimes(5);
    const result=f.repository.recordPublisherReconciliationCandidates.mock.calls[0]![0] as any;
    expect(result.scan).toMatchObject({complete:false,pagesFetched:5,reportedLastPage:9});
    expect(result.orders.every((v:any)=>v.orderId==="match")).toBe(true);
    expect(result.orders.length).toBeGreaterThan(0);
  });
  it("does not query a resolved item",async()=>{
    const f=fixture();f.repository.getPublisherReconciliationContext.mockResolvedValue(undefined as never);
    await f.run("reconcile_publication_unknown");expect(f.provider.listOrders).not.toHaveBeenCalled();
  });
  it("blocks invalid credentials during reconciliation and keeps the freeze pending",async()=>{
    const f=fixture();f.provider.listOrders.mockRejectedValue(new KolProviderError("authentication_blocked","expired",{operation:"list_orders",httpStatus:403}));
    await expect(f.run("reconcile_publication_unknown")).rejects.toThrow();
    expect(f.repository.markKolCredentialAuthBlocked).toHaveBeenCalledWith({failedAt:now});
    expect(f.repository.recordPublisherReconciliationCandidates).not.toHaveBeenCalled();
  });
});
