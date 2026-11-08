import type { ResearchImportField,ResearchImportMapping } from '../../client/source-matrix/research-import-types.js';

export const normalizeResearchHeader=(value:string)=>value.normalize('NFKC').toLowerCase().replace(/[\s_\-./\\:：()（）\[\]【】]+/g,'');
// Higher-priority article links win over generic links and media domains.
// Ties are reported to the caller; column order never resolves ambiguity.
const aliases:Record<ResearchImportField,string[][]>={
 source_name:[['sourcename','medianame','媒体名称','信源名称','来源名称','媒体或信源名称','媒体','信源'],['name','名称']],
 url:[['contenturl','articleurl','citationurl','内容url','内容链接','文章url','文章链接','引用url','引用链接'],['url','link','网址','链接'],['mediaurl','sourceurl','domain','媒体url','媒体网址','媒体链接','媒体域名','信源url','信源网址','来源url','来源网址','域名']],
 platform:[['platform','model','aimodel','aiplatform','模型','平台','引用平台','样本平台','引用样本平台','ai平台']],
 question:[['question','query','prompt','targetquestion','监控问题','目标问题','问题','提问','查询词']],
 collected_at:[['collectedat','collecteddate','citationdate','citedat','采集时间','采集日期','采样日期','引用时间','引用日期','收集时间'],['date','日期','时间']],
 text:[['text','content','body','paragraph','内容','正文','段落','记录说明','资料内容','内容摘要','摘要'],['contenttitle','articletitle','title','内容标题','文章标题','标题'],['description','note','notes','说明','描述','备注','推荐理由']],
};
const aggregateNames=new Set(['引用次数','被引次数','引用数量','引用总数','引用占比','被引占比','引用率','引用排行','引用排名','citationcount','citations','citationrate','citationratio','citationrank','referencecount','count'].map(normalizeResearchHeader));
const glossaryNames=new Set(['字段名称','字段名','fieldname','field'].map(normalizeResearchHeader));
const glossaryDefinitions=new Set(['字段释义','字段说明','字段含义','definition','fielddescription'].map(normalizeResearchHeader));

export function recognizeResearchColumns(columns:string[]){
 const mapping:ResearchImportMapping={},ambiguous:string[]=[];
 for(const [field,tiers] of Object.entries(aliases) as Array<[ResearchImportField,string[][]]>){
  for(const tier of tiers){const matches=columns.filter(column=>tier.includes(normalizeResearchHeader(column)));if(!matches.length)continue;if(matches.length>1)ambiguous.push(`${field}: ${matches.join('、')}`);else mapping[field]=matches[0];break;}
 }
 const aggregate=columns.some(column=>aggregateNames.has(normalizeResearchHeader(column)));
 const glossaryField=columns.filter(column=>glossaryNames.has(normalizeResearchHeader(column))),glossaryDefinition=columns.filter(column=>glossaryDefinitions.has(normalizeResearchHeader(column)));
 if(glossaryField.length>1||glossaryDefinition.length>1)ambiguous.push('字段说明列存在歧义');
 const glossary=glossaryField.length===1&&glossaryDefinition.length===1?{field:glossaryField[0]!,definition:glossaryDefinition[0]!}:undefined;
 return {mapping,ambiguous,aggregate,glossary};
}

