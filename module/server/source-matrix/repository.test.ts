import { expect,it,vi } from 'vitest';
import { MatrixRepository } from './repository.js';
it('compares the requested revision inside the row lock, not only before begin',async()=>{
 const update=vi.fn(),row={state:'complete',latest:{plan_version:'newer'}};
 const select={from:()=>select,where:()=>select,limit:()=>select,for:async()=>[row]};
 const tx={select:()=>select,update};
 const db={transaction:async(fn:(value:unknown)=>Promise<unknown>)=>fn(tx)};
 const repo=new MatrixRepository(db as any,'tenant');
 expect(await repo.begin('task','older')).toBe(false);expect(update).not.toHaveBeenCalled();
});
it('allows a matching current revision and keeps cancellation closed',async()=>{
 const row={state:'complete',latest:{plan_version:'current'}},write=vi.fn(async()=>undefined);
 const select={from:()=>select,where:()=>select,limit:()=>select,for:async()=>[row]};
 const tx={select:()=>select,update:()=>({set:()=>({where:write})})};
 const db={transaction:async(fn:(value:unknown)=>Promise<unknown>)=>fn(tx)},repo=new MatrixRepository(db as any,'tenant');
 expect(await repo.begin('task','current')).toBe(true);expect(write).toHaveBeenCalledOnce();row.state='cancelled';expect(await repo.begin('task','current')).toBe(false);
});
it('persists a reusable matrix revision after both detailed and short budget rejections',async()=>{
 for(const failure of [{status:'invalid_decisions',stage:'budget',matrix:{status:'complete'},errors:[{code:'untrusted_plan_field'}]},{status:'invalid_input',errors:[{code:'invalid_type'}]}]){
  const valid={plan_id:'plan-original',plan_version:'plan-version-original',matrix_version:'matrix-original',matrix:{status:'complete',candidates:[]},snapshot:{matrix_decisions:{items:[]}},scope:{input_snapshot:{task:{}}},budget_plans:[{strategy:'prior'}],report:{}};
  const row:any={state:'running',latest:valid};let inserted:any;
  const select={from:()=>select,where:()=>select,limit:()=>select,for:async()=>[row]};
  const tx={select:()=>select,insert:()=>({values:(value:any)=>{inserted=value;return {onDuplicateKeyUpdate:async()=>undefined};}}),update:()=>({set:(value:any)=>({where:async()=>Object.assign(row,value)})})};
  const repo=new MatrixRepository({transaction:async(fn:(value:unknown)=>Promise<unknown>)=>fn(tx)} as any,'tenant');
  expect(await repo.save('task',failure)).toBe(true);
  expect(row.latest.status).toBe(failure.status);expect(row.latest.retryable_budget).toBe(true);
  expect(row.latest.budget_plans).toEqual([]);expect(row.latest.content_plans).toEqual([]);
  expect(inserted.planVersion).toBe(row.latest.plan_version);expect(inserted.result.matrix_version).toBe(valid.matrix_version);
  expect(inserted.result.snapshot).toEqual(valid.snapshot);expect(await repo.begin('task',row.latest.plan_version)).toBe(true);
 }
});
