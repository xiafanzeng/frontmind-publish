const root='/api/modules/publish';
export async function matrixApi<T>(path:string,signal:AbortSignal,body?:unknown):Promise<T> {
 const response=await fetch(root+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal});
 let value:any;try{value=await response.json();}catch{throw new Error('信源规划服务未返回有效数据，请稍后重试');}
 // Structured business failures remain visible in the same result panels.
 if(!response.ok&&!value.result)throw new Error(value.message??value.errors?.map((e:any)=>(e.path?String(e.path)+': ':'')+(e.message??e.code)).join('；')??'信源规划服务暂不可用');
 return value as T;
}
export function downloadUrl(taskId:string,planId?:string,planVersion?:string){
 const path=root+'/classify/'+encodeURIComponent(taskId)+'/download';
 // The legacy task-only signature still downloads latest. A visible result
 // passes both identifiers so export cannot silently switch to another version.
 if(planId===undefined&&planVersion===undefined)return path;
 const query=new URLSearchParams();if(planId!==undefined)query.set('plan_id',planId);if(planVersion!==undefined)query.set('plan_version',planVersion);
 return path+'?'+query.toString();
}
