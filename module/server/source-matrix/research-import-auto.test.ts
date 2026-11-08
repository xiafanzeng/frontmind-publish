import { describe,expect,it } from 'vitest';
import { augmentResearchRequest,validateAutomatically } from './research-import-core.js';
import { repairStoredResearchFilename,resolveResearchFilename } from './research-import-filename.js';
import { planAutomaticResearchSave } from './research-import-save.js';
import type { ParsedResearchFile,ParsedResearchSheet } from './research-import-parser.js';

function sheet(name:string,values:Record<string,string>[]):ParsedResearchSheet {
 return {name,columns:[...new Set(values.flatMap(row=>Object.keys(row)))],rows:values.map((row,i)=>({values:row,locator:`${name} · 行 ${i+2}`}))};
}
function parsed(sheets:ParsedResearchSheet[]):ParsedResearchFile {return {fingerprint:'a'.repeat(64),warnings:[],sheets};}

describe('automatic private research import',()=>{
 it('keeps all relevant worksheets and prefers an article URL over the media domain',()=>{
  const result=validateAutomatically(parsed([
   sheet('媒体统计',[{'媒体名称':'媒体甲','媒体url':'example.com','引用日期':'2026-10-16 — 2026-10-22','引用次数':'8','引用占比':'50%'}]),
   sheet('内容统计',[{'媒体名称':'媒体甲','内容URL':'https://example.com/article','媒体url':'example.com','内容标题':'产品分析','引用次数':'8'}]),
   sheet('详细表格',[{'媒体名称':'媒体甲','内容链接':'https://example.com/article','媒体url':'example.com','引用日期':'2026-10-22','模型':'平台甲','监控问题':'如何选择','内容标题':'产品分析'}]),
   sheet('字段说明',[{'字段名称':'域名','字段释义':'被引用媒体的网址域名'}]),
  ]));
  expect(result.counts).toEqual({valid:4,duplicate:0,failed:0,total:4});
  expect(result.records.filter(record=>record.purpose==='citation')).toHaveLength(1);
  expect(result.records.find(record=>record.purpose==='citation')).toMatchObject({url:'https://example.com/article',platform:'平台甲',question:'如何选择',locator:'详细表格 · 行 2'});
  expect(result.records.filter(record=>record.semantic_kind==='aggregate_context')).toHaveLength(2);
  const request=augmentResearchRequest({catalog:[],task:{}},[{id:'dataset',name:'研究.xlsx',version:'v1',...result}]);
  expect(request.catalog).toHaveLength(1);
  expect(request.task.research_materials.records.filter((record:any)=>record.semantic_kind==='aggregate_context').every((record:any)=>!record.candidate_id)).toBe(true);
 });
 it('deduplicates equal rows across sheets without dropping their source locators',()=>{
  const result=validateAutomatically(parsed([sheet('甲',[{mediaurl:'https://example.com',source_name:'甲'}]),sheet('乙',[{mediaurl:'https://example.com',source_name:'甲'}])]));
  expect(result.counts).toEqual({valid:1,duplicate:1,failed:0,total:2});
  expect(result.records[0]!.locators).toEqual(['甲 · 行 2','乙 · 行 2']);
 });
 it('rejects an unrecognized nonempty sheet instead of saving only the recognized sheet',()=>{
  expect(()=>validateAutomatically(parsed([sheet('有效',[{媒体名称:'甲'}]),sheet('未知',[{甲列:'不能丢失',乙列:'值'}])]))).toThrow(/未知/);
 });
 it('rejects conflicting same-priority URL columns instead of choosing arbitrarily',()=>{
  expect(()=>validateAutomatically(parsed([sheet('冲突',[{url:'https://one.example/a',link:'https://two.example/a'}])]))).toThrow(/冲突|歧义/);
 });
 it('rejects the whole upload when one row is unusable and includes its locator',()=>{
  try {validateAutomatically(parsed([sheet('来源',[{名称:'甲',网址:'https://example.com'},{名称:'乙',网址:'javascript:bad'}])]));throw new Error('Expected validation failure');}
  catch(error){expect(error).toMatchObject({details:{counts:{valid:1,failed:1,total:2},errors:[{locator:'来源 · 行 3'}]}});}
 });
 it('does not downgrade citation-shaped rows with missing questions to source records',()=>{
  expect(()=>validateAutomatically(parsed([sheet('引用',[{内容链接:'https://example.com/a',监控问题:'',模型:'平台甲'}])]))).toThrow(/校验/);
 });
 it('preserves question-and-answer notes as context when no URL column exists',()=>{
  const result=validateAutomatically(parsed([sheet('问答',[{问题:'如何选择',内容:'先核对需求'}])]));
  expect(result.records[0]).toMatchObject({purpose:'context',question:'如何选择',text:'先核对需求'});
 });
 it('rejects aggregate-only numerical data that cannot preserve useful context',()=>{
  expect(()=>validateAutomatically(parsed([sheet('统计',[{引用次数:'10',引用占比:'50%'}])]))).toThrow();
 });
 it('ignores truly empty sheets and reports them',()=>{
  const result=validateAutomatically(parsed([sheet('空白',[]),sheet('来源',[{媒体名称:'甲'}])]));
  expect(result.counts.valid).toBe(1);expect(result.warnings.join(' ')).toContain('空白');
 });
});

describe('research filenames',()=>{
 it('uses browser original_name rather than multipart header bytes',()=>{
  expect(resolveResearchFilename('仁南-信源分析.xlsx','bad.xlsx')).toBe('仁南-信源分析.xlsx');
 });
 it('repairs only reversible UTF-8-as-Latin1 Chinese mojibake',()=>{
  const bad=Buffer.from('仁南-信源分析.xlsx','utf8').toString('latin1');
  expect(repairStoredResearchFilename(bad)).toBe('仁南-信源分析.xlsx');
  expect(resolveResearchFilename(undefined,bad)).toBe('仁南-信源分析.xlsx');
  for(const name of ['中文.xlsx','café.xlsx','Müller.xlsx','Ã©tude.xlsx','损坏�.xlsx'])expect(repairStoredResearchFilename(name)).toBe(name);
 });
 it('sanitizes path separators, controls and bidi overrides without transcoding content',()=>{
  expect(resolveResearchFilename('../研究\\名单\u0000\u202e.xlsx','fallback.csv')).toBe('.._研究_名单_.xlsx');
 });
 it('truncates long names on Unicode character boundaries and keeps the extension',()=>{
  const filename=resolveResearchFilename('😀'.repeat(300)+'.xlsx','fallback.xlsx');
  expect(Array.from(filename)).toHaveLength(255);expect(filename.endsWith('.xlsx')).toBe(true);expect(filename).not.toContain('\ufffd');
 });
});

const owner={tenantId:'tenant',actorId:'actor'};
const sampleFile=()=>parsed([sheet('来源',[{名称:'甲'}])]);
const result=()=>validateAutomatically(sampleFile());
const stored=(id:string,extra:Record<string,unknown>={})=>({...owner,id,name:'旧.xlsx',fingerprint:'b'.repeat(64),status:'confirmed',version:'immutable-v1',confirmed:result(),metadata:{counts:{valid:1,failed:0,duplicate:0,total:1}},createdAt:new Date('2026-11-01T00:00:00Z'),...extra});
describe('atomic import save planning',()=>{
 it('reuses an existing fingerprint and repairs only filename metadata',()=>{
  const current=stored('same',{fingerprint:'a'.repeat(64)});
  const plan=planAutomaticResearchSave(owner,[current],{id:'same',filename:'中文.xlsx',parsed:sampleFile(),selectedIds:[]});
  expect(plan.reused).toBe(true);expect(plan.insert).toBeUndefined();expect(plan.update).toEqual({name:'中文.xlsx'});
  expect(plan.dataset.version).toBe('immutable-v1');expect(plan.dataset.confirmed).toBe(current.confirmed);
 });
 it('allows replacing at the dataset count limit without removing other data',()=>{
  const current=stored('old'),others=Array.from({length:99},(_,i)=>stored(`saved-${i}`));
  const plan=planAutomaticResearchSave(owner,[current,...others],{id:'new',filename:'新.xlsx',parsed:sampleFile(),replaceId:'old',selectedIds:[]});
  expect(plan.deleteId).toBe('old');expect(plan.insert?.id).toBe('new');expect(plan.dataset.confirmed.records).toHaveLength(1);
 });
 it('does not plan a deletion when the replacement cannot fit selection limits',()=>{
  const many=stored('selected',{confirmed:{records:Array.from({length:10000},()=>({text:'record'}))}});
  expect(()=>planAutomaticResearchSave(owner,[stored('old'),many],{id:'new',filename:'新.xlsx',parsed:sampleFile(),replaceId:'old',selectedIds:['selected']})).toThrow(/10,000/);
 });
 it('rejects an out-of-scope target and selections before proposing any write',()=>{
  expect(()=>planAutomaticResearchSave(owner,[stored('other',{actorId:'someone-else'})],{id:'new',filename:'新.xlsx',parsed:sampleFile(),replaceId:'other',selectedIds:[]})).toThrow();
  expect(()=>planAutomaticResearchSave(owner,[],{id:'new',filename:'新.xlsx',parsed:sampleFile(),selectedIds:['missing']})).toThrow();
 });
 it('treats replacement with the same fingerprint as a metadata-only no-op',()=>{
  const current=stored('same',{fingerprint:'a'.repeat(64)});
  const plan=planAutomaticResearchSave(owner,[current],{id:'same',filename:'中文.xlsx',parsed:sampleFile(),replaceId:'same',selectedIds:[]});
  expect(plan.reused).toBe(true);expect(plan.deleteId).toBeUndefined();expect(plan.update).toEqual({name:'中文.xlsx'});
 });
 it('makes a legacy single-sheet snapshot visible as partial without rewriting its records',()=>{
  const confirmed={sheet:'甲',purpose:'source',records:[{source_name:'甲'}],counts:{valid:1,duplicate:0,failed:0,total:1}};
  const current=stored('same',{fingerprint:'a'.repeat(64),confirmed,parsed:parsed([sheet('甲',[{名称:'甲'}]),sheet('乙',[{名称:'乙'}])])});
  const plan=planAutomaticResearchSave(owner,[current],{id:'same',filename:'旧.xlsx',parsed:parsed([]),selectedIds:[]});
  expect(plan.dataset.confirmed).toBe(confirmed);expect(plan.dataset.version).toBe('immutable-v1');expect(plan.update?.metadata.warnings.join(' ')).toContain('甲');expect(plan.update?.confirmed).toBeUndefined();
 });
 it('reuses the committed replacement when a lost response is retried',()=>{
  const current=stored('new',{fingerprint:'a'.repeat(64)});
  const plan=planAutomaticResearchSave(owner,[current],{id:'new',filename:'旧.xlsx',parsed:parsed([]),replaceId:'gone',selectedIds:[]});
  expect(plan.reused).toBe(true);expect(plan.replacedId).toBe('gone');expect(plan.deleteId).toBeUndefined();
 });
});
