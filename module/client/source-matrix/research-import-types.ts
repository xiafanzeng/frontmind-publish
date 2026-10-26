/** Shared import ceilings. Uploads are private research, never catalog facts. */
export const RESEARCH_IMPORT_LIMITS = Object.freeze({ files:10, bytes:8*1024*1024, rows:5000, columns:64, cellChars:10000, textChars:2*1024*1024, expandedBytes:32*1024*1024, archiveEntries:1000, sheets:30, pdfPages:200, selectedRows:10000, promptChars:60000 });
export const RESEARCH_IMPORT_ACCEPT='.csv,.tsv,.xlsx,.xls,.json,.jsonl,.txt,.md,.docx,.pdf';
export type ResearchImportPurpose='source'|'citation'|'context';
export type ResearchImportField='source_name'|'url'|'platform'|'question'|'collected_at'|'text';
export type ResearchImportMapping=Partial<Record<ResearchImportField,string>>;
export interface ResearchDatasetSummary { id:string; name:string; version:string; recordCount:number; createdAt:string; status:'preview'|'confirmed'; purpose?:ResearchImportPurpose; duplicateCount?:number; failedCount?:number; }
export interface ResearchImportRow { values:Record<string,string>; locator:string; error?:string; }
export interface ResearchImportSheet { name:string; columns:string[]; recordCount:number; sample:ResearchImportRow[]; }
export interface ResearchImportPreview { id:string; name:string; status:'preview'|'confirmed'; sheets:ResearchImportSheet[]; warnings:string[]; existing?:boolean; }
export interface ResearchImportCounts { valid:number; duplicate:number; failed:number; total:number; }
export const RESEARCH_IMPORT_FIELDS:Array<{key:ResearchImportField;label:string}>=[{key:'source_name',label:'媒体或信源名称'},{key:'url',label:'URL / 域名'},{key:'platform',label:'引用样本平台'},{key:'question',label:'目标问题'},{key:'collected_at',label:'采集时间'},{key:'text',label:'内容 / 段落 / 记录说明'}];
