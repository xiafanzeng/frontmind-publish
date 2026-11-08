import { afterEach, expect, it, vi } from 'vitest';
import { BRAND_DATA_BATCHES, brandCitationRecords } from './brand-data.js';
import { compactCandidates, createDecisionAdapter, createEnvDecisionAdapter, environmentChatEndpoint } from './decisions.js';
import { SOURCE_MATRIX_INSTRUCTIONS, SOURCE_MATRIX_SKILL } from './instructions.js';
import { runPlanner } from './planner.js';
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
const platform = { FRONTMIND_SOURCE_MATRIX_LLM_API_KEY: 'fixture-server-key', FRONTMIND_SOURCE_MATRIX_LLM_MODEL: 'configured-model', FRONTMIND_SOURCE_MATRIX_LLM_BASE_URL: 'https://api.xty.app/v1', FRONTMIND_SOURCE_MATRIX_ALLOWED_LLM_BASE_URLS: 'https://api.xty.app/v1' };
const matrixInput = { request: { task: {}, catalog: [] }, prepared: {}, as_of: '2026-11-07T00:00:00Z', skill: SOURCE_MATRIX_SKILL, instructions: SOURCE_MATRIX_INSTRUCTIONS };
const envelope = (content: unknown, extra: Record<string, unknown> = {}) => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content }, ...extra }] }), { headers: { 'Content-Type': 'application/json' } });

// Production-shaped fixtures exercise the real industry-context and decision
// validators; the prompt-transport fixtures further below are deliberately partial.
function validatedMatrixInput(count=1) {
  const query={scopeType:'CATEGORY',scopeId:'123',periodType:'ALL',modelCode:'fixture-model'};
  const aggregate={aggregate_id:'industry-aggregate-fixture-verified',aggregate_scope:'industry_distribution',source_type:'external_data',source_id:'fixture-industry-provider',data_version:'fixture-industry-v1',dimension:'source_type',bucket:{code:'news',name:'新闻'},count:'12',unit:'citation_count',scope:{industry:'零售',...query},applicability:{kind:'industry_context',industry:'零售'}};
  const request={task:{industry:'零售',industry_id:'123',questions:[{question_id:'q1',text:'如何选择零售管理方案？'}],industry_context:{status:'ok',source:'molizhishu-public-industry',industry_id:'123',industry_name:'零售',query,fetched_at:matrixInput.as_of,data_version:'fixture-industry-v1',aggregates:[aggregate],limitations:[]}},catalog:Array.from({length:count},(_,index)=>({resource_id:'r'+(index+1),source_name:'测试行业媒体 '+(index+1),publication_status:'available'}))};
  const prepared=runPlanner(request,undefined,'matrix',undefined,matrixInput.as_of);
  return {...matrixInput,request,prepared};
}
function semanticDecision(id='resource:r1',aggregateId='industry-aggregate-fixture-verified') {
  return {candidate_id:id,primary_role:'authority',auxiliary_roles:[],matched_questions:['q1'],selection:'recommended',reason_summary:'结合真实行业背景提供问题研究入口',reason_details:['仅作为行业背景，不证明媒体引用或可采购身份'],unconfirmed_items:['媒体账号及稿件要求待核验'],references:[{type:'aggregate',aggregate_id:aggregateId,usage:'industry_context'}],media_intro:'测试行业研究媒体',content_direction:'比较零售管理方案的适用条件',layer_rank:1,ranking_reason:'与目标问题相关'};
}

it('repairs an invalid aggregate reference once using exact kernel feedback and verified IDs', async()=>{
  const input=validatedMatrixInput(),bad={matrix_decisions:{items:[semanticDecision('resource:r1','invented-bucket-name')],fit_order:['resource:r1']}},good={matrix_decisions:{items:[semanticDecision()],fit_order:['resource:r1']}};
  const prompts:Array<Array<{role:string;content:string}>>=[];
  const adapter=createDecisionAdapter(async messages=>{prompts.push(messages);return prompts.length===1?bad:good;});
  const decisions=await adapter.matrix(input),result=runPlanner(input.request,decisions,'matrix',undefined,input.as_of);
  expect(result.matrix.status).toBe('complete');
  expect(result.matrix.layers.find((layer:any)=>layer.role==='authority').candidate_ids).toEqual(['resource:r1']);
  expect(result.matrix.candidates[0].references).toEqual([{type:'aggregate',aggregate_id:'industry-aggregate-fixture-verified',usage:'industry_context'}]);
  const payload=JSON.parse(prompts[0]![1]!.content);
  expect(payload.reference_contract.global_aggregate_ids).toEqual(['industry-aggregate-fixture-verified']);
  const repair=JSON.parse(prompts[1]![2]!.content);
  expect(repair.validation_errors).toContainEqual({code:'invalid_aggregate_reference',path:'decisions.items[0].references[0]',message:'invalid_aggregate_reference'});
  expect(repair.previous_decisions).toEqual(bad.matrix_decisions);
  expect(prompts).toHaveLength(2);
});

it('keeps invalid decisions rejected after one failed correction instead of stripping evidence', async()=>{
  const input=validatedMatrixInput(),bad={matrix_decisions:{items:[semanticDecision('resource:r1','invented')],fit_order:['resource:r1']}};
  let attempts=0;const adapter=createDecisionAdapter(async()=>{attempts++;return bad;});
  const decisions=await adapter.matrix(input),result=runPlanner(input.request,decisions,'matrix',undefined,input.as_of);
  expect(attempts).toBe(2);expect(result.matrix.status).toBe('invalid_decisions');
  expect(result.errors).toContainEqual({code:'invalid_aggregate_reference',path:'decisions.items[0].references[0]',message:'invalid_aggregate_reference'});
  expect(result.matrix.fit_order).toEqual([]);expect(result.matrix.candidates[0].primary_role).toBeNull();
  expect(decisions?.matrix_decisions.items[0].references[0].aggregate_id).toBe('invented');
});

it('preserves the invalid first response when correction transport fails', async()=>{
  const input=validatedMatrixInput(),bad={matrix_decisions:{items:[semanticDecision('resource:r1','invented')],fit_order:['resource:r1']}};
  let attempts=0;const adapter=createDecisionAdapter(async()=>{if(++attempts===1)return bad;throw new Error('provider_timeout');});
  const decisions=await adapter.matrix(input),result=runPlanner(input.request,decisions,'matrix',undefined,input.as_of);
  expect(result.matrix.status).toBe('invalid_decisions');expect(result.errors.some((error:any)=>error.code==='invalid_aggregate_reference')).toBe(true);
});

it('does not turn a failed candidate set into success by dropping its invalid member during repair', async()=>{
  const input=validatedMatrixInput(2),first=semanticDecision('resource:r1','invented'),second={...semanticDecision('resource:r2'),layer_rank:2};
  const bad={matrix_decisions:{items:[first,second],fit_order:['resource:r1','resource:r2']}},subset={matrix_decisions:{items:[{...second,layer_rank:1}],fit_order:['resource:r2']}};
  let attempts=0;const decisions=await createDecisionAdapter(async()=>++attempts===1?bad:subset).matrix(input);
  expect(runPlanner(input.request,decisions,'matrix',undefined,input.as_of).matrix.status).toBe('invalid_decisions');
  expect(decisions?.matrix_decisions.items.map((item:any)=>item.candidate_id)).toEqual(['resource:r1','resource:r2']);
});

it('keeps a large candidate pool distinct from the bounded prompt and a real validated decision subset', async()=>{
  const input=validatedMatrixInput(822);let payload:any;
  const decisions=await createDecisionAdapter(async messages=>{payload=JSON.parse(messages[1]!.content);return {matrix_decisions:{items:[semanticDecision()],fit_order:['resource:r1']}};}).matrix(input);
  const result=runPlanner(input.request,decisions,'matrix',undefined,input.as_of);
  expect(payload.candidates).toHaveLength(120);expect(result.matrix.candidates).toHaveLength(822);
  expect(result.matrix.status).toBe('complete');expect(result.matrix.fit_order).toEqual(['resource:r1']);
  expect(result.matrix.candidates.filter((candidate:any)=>candidate.semantic_decision_validated)).toHaveLength(1);
});

it('never advertises invalid global industry IDs as kernel-approved references', async()=>{
  const input=validatedMatrixInput();input.request.task.industry_context.status='unavailable';
  let payload:any;await createDecisionAdapter(async messages=>{payload=JSON.parse(messages[1]!.content);return {matrix_decisions:{items:[],fit_order:[]}};}).matrix(input);
  expect(payload.reference_contract.global_aggregate_ids).toEqual([]);
});

it('keeps a verified candidate-local aggregate usable when shared industry context is unavailable', async()=>{
  const input=validatedMatrixInput(),request={...input.request,
    task:{...input.request.task,industry_context:{...input.request.task.industry_context,status:'upstream_error',aggregates:[]}},
    catalog:[{...input.request.catalog[0]!,domain:'fixture.example'}],
    citations:[{aggregate_id:'media-only-verified',data_kind:'aggregate',source_type:'external_data',source_id:'fixture-local-study',data_version:'local-v1',count:3,unit:'mentions',source_name:'测试行业媒体 1',domain:'fixture.example',scope:{industry:'零售'},applicability:{kind:'industry_context',industry:'零售'}}],
  };
  const prepared=runPlanner(request,undefined,'matrix',undefined,input.as_of);let payload:any;
  const decisions=await createDecisionAdapter(async messages=>{payload=JSON.parse(messages[1]!.content);return {matrix_decisions:{items:[semanticDecision('resource:r1','media-only-verified')],fit_order:['resource:r1']}};}).matrix({...input,request,prepared});
  expect(payload.reference_contract.global_aggregate_ids).toEqual([]);
  expect(payload.reference_contract.candidate_aggregate_ids).toEqual({'resource:r1':['media-only-verified']});
  expect(runPlanner(request,decisions,'matrix',undefined,input.as_of).matrix.status).toBe('complete');
});

it('shares the platform deadline with correction and retains the invalid result when the remainder expires', async()=>{
  vi.useFakeTimers();const input=validatedMatrixInput(),bad={matrix_decisions:{items:[semanticDecision('resource:r1','invented')],fit_order:['resource:r1']}};
  let attempts=0,correctionSignal:AbortSignal|undefined,settled=false;
  vi.stubGlobal('fetch',vi.fn((_url:unknown,init:RequestInit)=>new Promise<Response>((resolve,reject)=>{
    if(++attempts===1)setTimeout(()=>resolve(envelope(JSON.stringify(bad))),200_000);
    else {correctionSignal=init.signal??undefined;init.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});}
  })));
  const pending=createEnvDecisionAdapter(platform)!.matrix(input).then(value=>{settled=true;return value;});
  await vi.advanceTimersByTimeAsync(239_999);expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);const decisions=await pending;
  expect(attempts).toBe(2);expect(correctionSignal?.aborted).toBe(true);
  expect(runPlanner(input.request,decisions,'matrix',undefined,input.as_of).matrix.status).toBe('invalid_decisions');
});

it('preserves yihang sample provenance and honest unknown dates', () => {
  const batch = BRAND_DATA_BATCHES[0]!;
  expect(BRAND_DATA_BATCHES).toHaveLength(1);
  expect(batch.sourceFile).toBe('一航软件-信源分析-20260913-214944.xlsx');
  expect(batch.sourceSha256).toBe('639e43735887ff20852f99aa4bc643853259dbd7f44aba163598064720a60e0d');
  expect(batch.recordCount).toBe(502);
  expect(batch.period).toEqual({ start: '2026-09-07', end: '2026-09-13' });
  const records = brandCitationRecords(batch.id);
  expect(records).toHaveLength(502);
  expect(records[0]).toMatchObject({ data_kind: 'detail', source_type: 'observation', published_at: null, quality: { missing_answer_id: true, missing_publication_date: true } });
  expect(String(records[0]!.evidence_id)).toMatch(/^sample:/);
  expect(records.filter(record => record.published_at !== null)).toHaveLength(0);
  const filtered = brandCitationRecords(batch.id, ['通义千问-手机版']);
  expect(filtered).toHaveLength(49);
  expect(new Set(filtered.map(record => record.scope.platform))).toEqual(new Set(['通义千问-手机版']));
  expect(records.filter(record => record.source_name === null)).toHaveLength(3);
});

it('requires an explicit model and matching platform allowlist without guessing defaults', () => {
  expect(createEnvDecisionAdapter({})).toBeUndefined();
  expect(createEnvDecisionAdapter({ FRONTMIND_SOURCE_MATRIX_LLM_API_KEY: 'fixture-key' })).toBeUndefined();
  for (const missing of ['FRONTMIND_SOURCE_MATRIX_LLM_MODEL', 'FRONTMIND_SOURCE_MATRIX_ALLOWED_LLM_BASE_URLS']) {
    expect(createEnvDecisionAdapter({ ...platform, [missing]: '' })).toBeUndefined();
  }
  expect(createEnvDecisionAdapter({ ...platform, FRONTMIND_SOURCE_MATRIX_ALLOWED_LLM_BASE_URLS: 'https://other.invalid/v1' })).toBeUndefined();
  expect(createEnvDecisionAdapter({ ...platform, FRONTMIND_SOURCE_MATRIX_LLM_BASE_URL: 'https://open.bigmodel.cn/api/paas/v4/chat/completions' })).toBeUndefined();
});

it('normalizes platform root, v1 and complete endpoint once, including allowlist roots', () => {
  for (const base of ['https://api.xty.app', 'https://api.xty.app/', 'https://api.xty.app/v1/', 'https://api.xty.app/v1/chat/completions/']) {
    expect(environmentChatEndpoint({ FRONTMIND_SOURCE_MATRIX_LLM_BASE_URL: base })).toBe('https://api.xty.app/v1/chat/completions');
    expect(createEnvDecisionAdapter({ ...platform, FRONTMIND_SOURCE_MATRIX_LLM_BASE_URL: base, FRONTMIND_SOURCE_MATRIX_ALLOWED_LLM_BASE_URLS: base })?.identify).toBeTypeOf('function');
  }
  for (const base of ['http://api.xty.app/v1', 'https://user@api.xty.app/v1', 'https://api.xty.app/v1?key=x', 'https://api.xty.app/v1/../v1', 'https://api.xty.app.evil.invalid/v1']) {
    expect(() => environmentChatEndpoint({ FRONTMIND_SOURCE_MATRIX_LLM_BASE_URL: base })).toThrow('endpoint_not_allowed');
  }
});

it('sends configured platform Bearer and parses a complete fenced JSON response', async () => {
  const fence = String.fromCharCode(96).repeat(3);
  const fetchMock = vi.fn(async (_url: unknown, _init: RequestInit) => envelope(fence + 'json\n{"matrix_decisions":{"items":[],"fit_order":[]}}\n' + fence));
  vi.stubGlobal('fetch', fetchMock);
  expect(await createEnvDecisionAdapter(platform)!.matrix(matrixInput)).toBeUndefined();
  const [url, init] = fetchMock.mock.calls[0]!;
  expect(url).toBe('https://api.xty.app/v1/chat/completions');
  expect(init.redirect).toBe('error'); expect(init.headers).toMatchObject({ Authorization: 'Bearer fixture-server-key' });
  expect(JSON.parse(String(init.body)).model).toBe('configured-model');
  expect(String(init.body)).toContain(SOURCE_MATRIX_SKILL);
});

it('rejects HTTP errors, refusal, incomplete, empty, oversized and malformed output safely', async () => {
  const fetchMock = vi.fn(async () => new Response('', { status: 503 }));
  vi.stubGlobal('fetch', fetchMock);
  const adapter = createEnvDecisionAdapter(platform)!;
  await expect(adapter.matrix(matrixInput)).rejects.toThrow('llm_http_503');
  const cases: Array<[Response, string]> = [
    [envelope('{}', { message: { content: '{}', refusal: 'refused' } }), 'provider_refused'],
    [envelope('{}', { finish_reason: 'content_filter' }), 'provider_refused'],
    [envelope('{}', { finish_reason: 'length' }), 'provider_incomplete_response'],
    [envelope(''), 'provider_empty_response'],
    [envelope('prefix {"matrix_decisions":{}} trailing'), 'provider_invalid_response'],
    [envelope('[]'), 'provider_invalid_response'],
    [new Response('{not-json'), 'provider_invalid_response'],
    [new Response('', { headers: { 'content-length': '2000001' } }), 'provider_response_too_large'],
  ];
  for (const [response, error] of cases) { fetchMock.mockResolvedValueOnce(response); await expect(adapter.matrix(matrixInput)).rejects.toThrow(error); }
  fetchMock.mockRejectedValueOnce(new Error('private upstream details'));
  await expect(adapter.matrix(matrixInput)).rejects.toThrow('provider_invalid_response');
});

it('aborts platform requests at the bounded deadline', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn((_url: unknown, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  })));
  const check = expect(createEnvDecisionAdapter(platform)!.matrix(matrixInput)).rejects.toThrow('provider_timeout');
  await vi.advanceTimersByTimeAsync(240_000); await check;
});

it('includes complete frozen content and aggregate provenance without turning buckets into candidates', async () => {
  const aggregate = { aggregate_id: 'industry:type:news', source_id: 'molizhishu', data_version: 'snapshot-v1', unit: 'citation_count', count: '9223372036854775807', scope: { industry: 'retail', modelCode: 'm', periodType: 'WEEK', date: '2026-11-01' }, applicability: { kind: 'industry_context', industry: 'retail' }, aggregate_scope: 'industry_distribution', dimension: 'source_type', bucket: 'news' };
  const specific = { aggregate_id: 'media-summary', identity_relation: 'exact', record: { aggregate_id: 'media-summary', source_id: 'report', unit: 'mentions', data_version: 'v1', scope: { industry: 'retail' }, count: 3 } };
  const industry_context = { status: 'ready', message: '真实分布', source: 'molizhishu', industry_id: 'retail', industry_name: '零售', query: { scopeId: '123', modelCode: 'm', periodType: 'WEEK', date: '2026-11-01' }, fetched_at: '2026-11-07T00:00:00Z', data_version: 'snapshot-v1', aggregates: [aggregate], limitations: [], source_type_distribution: [], publish_time_distribution: [] };
  const manuscripts = [{ article_id: 'article-1', version: 'v2', content_excerpt: '已授权冻结稿件正文片段', content_excerpt_truncated: true, content_source: 'frozen_article_version' }];
  const request = { task: { industry: 'retail', manuscripts, industry_context, model_connection: { revision: 'legacy' }, model_source: 'user' } };
  const prepared = { matrix: { candidates: [{ candidate_id: 'resource:r1', attributes: { source_name: '真实目录媒体' }, aggregate_ids: ['media-summary'], aggregate_matches: [specific], industry_aggregate_ids: [aggregate.aggregate_id] }] } };
  const compact = compactCandidates(request, prepared)[0]!;
  expect(compact.aggregate_matches).toEqual([specific]);
  expect(compact).not.toHaveProperty('industry_aggregate_ids'); expect(compact).not.toHaveProperty('industry_aggregates');
  const send = vi.fn(async (_messages: any) => ({ matrix_decisions: { items: [], fit_order: [] } }));
  await createDecisionAdapter(send).matrix({ ...matrixInput, request, prepared });
  const messages = send.mock.calls[0]![0], payload = JSON.parse(messages[1].content);
  expect(payload.task.industry_context).toEqual(industry_context); expect(payload.task.manuscripts).toEqual(manuscripts);
  expect(payload.task).not.toHaveProperty('model_connection'); expect(payload.task).not.toHaveProperty('model_source');
  expect(payload.candidates).toHaveLength(1); expect(messages[0].content).toContain('不是媒体名称、账号、渠道或可购买候选');
});

it('keeps one shared industry snapshot with 120 candidates instead of repeating global records or IDs', async () => {
  const aggregate = { aggregate_id: 'global-only-once', source_id: 'molizhishu', data_version: 'version-only-once', unit: 'citation_count', count: '100', scope: { industry: 'retail' }, applicability: { kind: 'industry_context', industry: 'retail' }, aggregate_scope: 'industry_distribution', dimension: 'source_type', bucket: 'news' };
  const request = { task: { industry_context: { status: 'ready', aggregates: [aggregate] }, manuscripts: [{ content_excerpt: 'frozen-body-only-once', content_excerpt_truncated: false }] } };
  const prepared = { matrix: { candidates: Array.from({ length: 120 }, (_, index) => ({ candidate_id: 'resource:' + index, attributes: { source_name: 'Media ' + index }, aggregate_matches: [], industry_aggregate_ids: [aggregate.aggregate_id] })) } };
  const send = vi.fn(async (_messages: any) => ({ matrix_decisions: { items: [], fit_order: [] } }));
  await createDecisionAdapter(send).matrix({ ...matrixInput, request, prepared });
  const messages = send.mock.calls[0]![0], encoded = messages[1].content, payload = JSON.parse(encoded);
  expect(payload.candidates).toHaveLength(120);
  expect(payload.task.industry_context.aggregates).toEqual([aggregate]);
  expect(encoded.split('global-only-once')).toHaveLength(2);
  expect(encoded.split('version-only-once')).toHaveLength(2);
  expect(encoded.split('frozen-body-only-once')).toHaveLength(2);
  expect(payload.candidates.every((candidate: Record<string, unknown>) => !('industry_aggregate_ids' in candidate) && !('industry_aggregates' in candidate))).toBe(true);
  expect(messages[0].content).toContain('全部候选共享');
});

it('passes the saved industry snapshot to budget with at most three combined plans', async () => {
  const send = vi.fn(async (_messages: any) => ({ budget_plans: [], content_plans: [] }));
  const industry_context = { status: 'unavailable', message: '行业映射失败', aggregates: [], limitations: ['industry_unmapped'] };
  expect(await createDecisionAdapter(send).budget({ request: { task: { industry_context, manuscripts: [] } }, matrix: { matrix: { candidates: [] }, matrix_version: 'saved' }, as_of: 'x', skill: SOURCE_MATRIX_SKILL, instructions: SOURCE_MATRIX_INSTRUCTIONS })).toEqual({ budget_plans: [], content_plans: [] });
  const messages = send.mock.calls[0]![0], payload = JSON.parse(messages[1].content);
  expect(payload.industry_context).toEqual(industry_context); expect(payload.selectable_candidates).toEqual([]);
  expect(messages[0].content).toContain('两数组合计最多3套');
});

it('delivers independent target to both planning stages without using the sample filter or selecting a model', async () => {
 const send=vi.fn(async(_messages:Array<{role:string;content:string}>)=>({matrix_decisions:{items:[],fit_order:[]},budget_plans:[],content_plans:[]}));
 const adapter=createDecisionAdapter(send),request={task:{target_platforms:['Kimi'],brand:{batch_id:'legacy',platforms:['百度文心-手机版']}},catalog:[]};
 await adapter.matrix({...matrixInput,request});
 const matrixPayload=JSON.parse(send.mock.calls[0]![0][1]!.content);
 expect(matrixPayload.task.target_platforms).toEqual(['Kimi']);expect(matrixPayload.task.brand.platforms).toEqual(['百度文心-手机版']);
 await adapter.budget({...matrixInput,request,matrix:{matrix_version:'v1',matrix:{candidates:[]}}});
 const budgetPayload=JSON.parse(send.mock.calls[1]![0][1]!.content);
 expect(budgetPayload.target_platforms).toEqual(['Kimi']);
 expect(SOURCE_MATRIX_INSTRUCTIONS).toContain('目标平台引用依据待核验');
 expect(SOURCE_MATRIX_INSTRUCTIONS).toContain('不得修改实际执行模型');
});
