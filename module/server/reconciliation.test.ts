import { describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { mysqlTable, varchar } from "drizzle-orm/mysql-core";
import { createPublishSchema } from "../schema/index.js";
import { createPublishingPersistence } from "./publisher-repository.js";
import { assertPublisherNoOrderResolution, publisherReconciliationScan } from "./reconciliation.js";

const tables=createPublishSchema({users:mysqlTable("test_users",{id:varchar("id",{length:36}).primaryKey()}),currentMonitoringEnterpriseProjectId:()=>null});
function fixture(overrides:Record<string,unknown>={}) {
  const item:any={id:"item",batchId:"batch",ownerId:"owner",status:"submission_unknown",fundsStatus:"frozen",externalOrderId:null,attemptCount:1,...overrides};
  const audits=new Map<string,any>();const writes:any[]=[];let bound=false;
  const db:any={
    transaction:async(action:any)=>{const snapshot={...item};const size=writes.length;const saved=new Map(audits);
      try{return await action(db);}catch(error){Object.assign(item,snapshot);writes.splice(size);audits.clear();for(const [k,v]of saved)audits.set(k,v);throw error;}},
    select:()=>({from:(table:any)=>{const name=getTableName(table);const rows=()=>name==="publisher_items"?[item]:name==="publisher_reconciliation_candidates"&&bound?[{id:"bound"}]:[];
      const query:any={where:()=>query,for:()=>query,limit:async()=>rows(),then:(yes:any,no:any)=>Promise.resolve(rows()).then(yes,no)};return query;}}),
    update:(table:any)=>({set:(values:any)=>({where:async()=>{const name=getTableName(table);writes.push({name,values});if(name==="publisher_items")Object.assign(item,values);}})}),
  };
  const settle=vi.fn(async(_tx:any,input:any)=>{writes.push({name:"settlement",input});item.fundsStatus=input.settlement;return true;});
  const audit=vi.fn(async(_tx:any,value:any)=>{audits.set(value.id,value);});
  const core:any={tables,settlePublisherItemMoney:settle,derivePublisherBatchFundsStatus:()=>item.fundsStatus,
    readAudit:async(_tx:any,id:string)=>audits.get(id),audit};
  const {PublishingRepository}=createPublishingPersistence(core);const repository=new PublishingRepository(db);
  const resolve=()=>repository.resolvePublisherNoOrder({itemId:"item",actorId:"admin",expectedAttemptNumber:1,reason:"供应商确认未成单",evidenceReference:"客服核对记录20261024"});
  return {item,settle,audit,writes,audits,resolve,bind:()=>{bound=true;}};
}
describe("administrator-confirmed no-order settlement",()=>{
  it("releases once, closes the item/batch and records independent evidence without resubmission",async()=>{
    const f=fixture();await f.resolve();await f.resolve();
    expect(f.settle).toHaveBeenCalledTimes(1);expect(f.item).toMatchObject({status:"failed",fundsStatus:"released",nextPollAt:null});
    expect(f.audit).toHaveBeenCalledTimes(1);expect([...f.audits.values()][0]).toMatchObject({action:"admin.publisher_unknown_no_order_released",metadata:{evidenceReference:"客服核对记录20261024"}});
    expect(f.writes.some(v=>v.name==="publisher_jobs")).toBe(false);
  });
  it.each([{attemptCount:2},{externalOrderId:"created"},{fundsStatus:"consumed"},{status:"processing"}])("rejects stale or already accepted state %j before touching money",async(change)=>{
    const f=fixture(change);await expect(f.resolve()).rejects.toThrow();expect(f.settle).not.toHaveBeenCalled();expect(f.writes).toEqual([]);
  });
  it("rejects an already bound supplier candidate",async()=>{
    const f=fixture();f.bind();await expect(f.resolve()).rejects.toThrow();expect(f.settle).not.toHaveBeenCalled();
  });
  it("rolls the settlement and state back when the audit cannot be persisted",async()=>{
    const f=fixture();f.audit.mockRejectedValue(new Error("database failure"));await expect(f.resolve()).rejects.toThrow("database failure");
    expect(f.item).toMatchObject({status:"submission_unknown",fundsStatus:"frozen"});expect(f.writes).toEqual([]);
  });
  it("requires the unknown frozen attempt even without any candidates",()=>{
    expect(()=>assertPublisherNoOrderResolution({status:"processing",fundsStatus:"frozen",attemptCount:1},1,false)).toThrow();
  });
  it("exposes only a validated scan summary, not arbitrary provider data",()=>{
    expect(publisherReconciliationScan({observedAt:"bad",complete:true})).toBeUndefined();
    expect(publisherReconciliationScan({observedAt:"2026-10-24T00:00:00Z",since:"2026-10-23T00:00:00Z",pagesFetched:5,ordersSeen:10,complete:false,token:"private"})).not.toHaveProperty("token");
  });
});
