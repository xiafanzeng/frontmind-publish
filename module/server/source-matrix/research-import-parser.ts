import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import { inflateRawSync } from 'node:zlib';
import { RESEARCH_IMPORT_LIMITS as L,type ResearchImportRow } from '../../client/source-matrix/research-import-types.js';
export interface ParsedResearchSheet { name:string; columns:string[]; rows:ResearchImportRow[]; }
export interface ParsedResearchFile { sheets:ParsedResearchSheet[]; warnings:string[]; fingerprint:string; }
export class ResearchImportError extends Error { readonly publicMessage:string; constructor(message:string,readonly status=400,readonly code:string='research_import_failed'){super(message);this.publicMessage=message;} }
function fail(message:string):never {throw new ResearchImportError(message);}
function checkAbort(signal?:AbortSignal){if(signal?.aborted)throw new ResearchImportError('解析已取消',499);}
function decode(bytes:Buffer):string {
 if(bytes[0]===0xff&&bytes[1]===0xfe)return new TextDecoder('utf-16le',{fatal:true}).decode(bytes.subarray(2));
 if(bytes[0]===0xfe&&bytes[1]===0xff)return new TextDecoder('utf-16be',{fatal:true}).decode(bytes.subarray(2));
 try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,'');}
 catch{try{return new TextDecoder('gb18030',{fatal:true}).decode(bytes);}catch{return fail('无法识别中文编码，请另存为 UTF-8 或 GB18030 后重试');}}
}
/** Preflight ZIP central directory before any archive decompression. Reject
 * ZIP64, encrypted entries and inconsistent declarations; parser still verifies CRC. */
function inspectZip(buffer:Buffer){
 let end=-1;for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--)if(buffer.readUInt32LE(i)===0x06054b50){end=i;break;}
 if(end<0)fail('压缩文档已损坏');
 if(buffer.readUInt16LE(end+4)||buffer.readUInt16LE(end+6))fail('不支持分卷压缩文档');
 const count=buffer.readUInt16LE(end+10),size=buffer.readUInt32LE(end+12),offset=buffer.readUInt32LE(end+16);
 if(count===65535||offset===0xffffffff||size===0xffffffff||count>L.archiveEntries||offset+size>end)fail('压缩文档过大或使用不支持的 ZIP64 格式');
 let cursor=offset,total=0;
 for(let i=0;i<count;i++){
  if(cursor+46>offset+size||buffer.readUInt32LE(cursor)!==0x02014b50)fail('压缩目录无效');
  const flags=buffer.readUInt16LE(cursor+8),compressed=buffer.readUInt32LE(cursor+20),expanded=buffer.readUInt32LE(cursor+24),nameSize=buffer.readUInt16LE(cursor+28),extraSize=buffer.readUInt16LE(cursor+30),commentSize=buffer.readUInt16LE(cursor+32),local=buffer.readUInt32LE(cursor+42);
  if(flags&1||expanded===0xffffffff||local+30>offset||buffer.readUInt32LE(local)!==0x04034b50)fail('不支持加密或损坏的压缩文档');
  if(buffer.readUInt16LE(local+6)!==flags||buffer.readUInt16LE(local+8)!==buffer.readUInt16LE(cursor+10))fail('压缩目录与文件头不一致');
  if(!(flags&8)&&(buffer.readUInt32LE(local+18)!==compressed||buffer.readUInt32LE(local+22)!==expanded))fail('压缩大小声明不一致');
  const dataStart=local+30+buffer.readUInt16LE(local+26)+buffer.readUInt16LE(local+28);
  if(dataStart+compressed>offset)fail('压缩数据越界');
  total+=expanded;if(total>L.expandedBytes||expanded>L.expandedBytes)fail('解压后超过 32 MiB 上限，请拆分文件');
  const method=buffer.readUInt16LE(cursor+10),data=buffer.subarray(dataStart,dataStart+compressed);
  if(method!==0&&method!==8)fail('不支持此压缩算法');
  // Enforce actual output size, not only attacker-controlled ZIP declarations.
  const actual=method===0?data:inflateRawSync(data,{maxOutputLength:Math.max(1,Math.min(expanded+1,L.expandedBytes))});
  if(actual.length!==expanded)fail('压缩文件实际解压大小与声明不一致');
  const name=buffer.subarray(cursor+46,cursor+46+nameSize).toString('utf8');
  if(/(?:vbaProject\.bin|embeddings\/|externalLinks\/)/i.test(name))fail('请移除宏、嵌入对象或外部工作簿链接后重新导入');
  cursor+=46+nameSize+extraSize+commentSize;
 }
 if(cursor!==offset+size)fail('压缩目录长度不一致');
}
function scalar(value:unknown):string {const out=value==null?'':typeof value==='object'?JSON.stringify(value):String(value);if(out.length>L.cellChars)fail('单元格或段落超过 10,000 字符，请拆分');return out;}
function sheet(name:string,source:Array<{value:unknown;locator:string;error?:string}>):ParsedResearchSheet {
 const columns:string[]=[];const rows=source.map(({value,locator,error})=>{
  if(!value||typeof value!=='object'||Array.isArray(value))return {values:{},locator,error:error??'记录必须是对象'};
  const values=Object.fromEntries(Object.entries(value).map(([key,v])=>{if(key.length>200)fail('列名超过 200 字符');if(!columns.includes(key))columns.push(key);return [key,scalar(v)];}));
  if(columns.length>L.columns)fail('超过 64 列上限');return {values,locator,...(error?{error}:{})};
 });return {name,columns,rows};
}
function delimited(input:string,separator:string):ParsedResearchSheet {
 const grid:Array<{values:string[];line:number}>=[];let row:string[]=[],cell='',quoted=false,afterQuote=false,line=1,startLine=1;
 const put=()=>{if(cell.length>L.cellChars)fail('单元格超过 10,000 字符');row.push(cell);cell='';afterQuote=false;if(row.length>L.columns)fail('超过 64 列上限');};
 const end=()=>{put();if(row.some(x=>x.trim()))grid.push({values:row,line:startLine});row=[];if(grid.length>L.rows+1)fail('超过 5,000 条记录上限');};
 for(let i=0;i<input.length;i++){
  const char=input[i]!;
  if(quoted){if(char==='"'){if(input[i+1]==='"'){cell+='"';i++;}else{quoted=false;afterQuote=true;}}else{cell+=char;if(char==='\n'||char==='\r'&&input[i+1]!=='\n')line++;}}
  else if(char==='"'&&!cell&&!afterQuote)quoted=true;
  else if(char===separator)put();
  else if(char==='\n'||char==='\r'){if(char==='\r'&&input[i+1]==='\n')i++;end();line++;startLine=line;}
  else if(afterQuote&&char.trim())fail('CSV 引号结束后存在无效字符');else cell+=char;
 }
 if(quoted)fail('CSV 引号未闭合');if(cell||row.length||afterQuote)end();
 const header=grid.shift();if(!header?.values.length)fail('没有可读取的表头或记录');
 const columns=header.values.map((v,i)=>v.trim()||`列${i+1}`);if(new Set(columns).size!==columns.length)fail('表头重复，请使用不同列名');
 return sheet('数据',grid.map(({values,line})=>({value:Object.fromEntries(columns.map((key,j)=>[key,values[j]??''])),locator:`行 ${line}`,...(values.length!==columns.length?{error:'字段数量与表头不一致'}:{})})));
}
function separatorOf(text:string){const scores=new Map<string,number>([[',',0],['\t',0],[';',0]]);let quoted=false;for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'){if(quoted&&text[i+1]==='"')i++;else quoted=!quoted;}else if(!quoted){if(ch==='\n'||ch==='\r')break;if(ch&&scores.has(ch))scores.set(ch,scores.get(ch)!+1);}}return [...scores].sort((a,b)=>b[1]-a[1])[0]?.[0]??',';}
function paragraphs(text:string,prefix:string):Array<{value:unknown;locator:string}>{return text.split(/\n\s*\n/).map(x=>x.trim()).filter(Boolean).map((content,i)=>({value:{text:content},locator:`${prefix} · 段落 ${i+1}`}));}
export async function parseResearchFile(name:string,buffer:Buffer,signal?:AbortSignal):Promise<ParsedResearchFile>{
 checkAbort(signal);if(!buffer.length||buffer.length>L.bytes)fail('文件必须大于 0 且不超过 8 MiB');
 const extension=name.split('.').pop()?.toLowerCase(),warnings:string[]=[];let sheets:ParsedResearchSheet[]=[];
 if(extension==='xlsx'||extension==='docx')inspectZip(buffer);
 if(extension==='csv'||extension==='tsv'){
  const text=decode(buffer);const separator=extension==='tsv'?'\t':separatorOf(text);
  sheets=[delimited(text,separator)];warnings.push('第一条非空记录作为表头；编码按 UTF-8 / UTF-16 / GB18030 识别。');
 }else if(extension==='json'||extension==='jsonl'){
  const text=decode(buffer);let entries:Array<{value:unknown;locator:string;error?:string}>;
  if(extension==='jsonl'){entries=[];for(const [i,line] of text.split(/\r?\n/).entries()){if(!line.trim())continue;if(entries.length>=L.rows)fail('超过 5,000 条记录上限');try{entries.push({value:JSON.parse(line),locator:`行 ${i+1}`});}catch{entries.push({value:{},locator:`行 ${i+1}`,error:'JSON 语法错误'});}}}
  else{let root:unknown;try{root=JSON.parse(text);}catch{return fail('JSON 语法错误');}const data=Array.isArray(root)?root:root&&typeof root==='object'&&Array.isArray((root as Record<string,unknown>).records)?(root as {records:unknown[]}).records:null;if(!data)fail('JSON 须为对象数组，或包含 records 数组的对象');if(data.length>L.rows)fail('超过 5,000 条记录上限');entries=data.map((value,i)=>({value,locator:`记录 ${i+1}`}));}
  sheets=[sheet('数据',entries)];
 }else if(extension==='xlsx'||extension==='xls'){
  const workbook=XLSX.read(buffer,{type:'buffer',cellFormula:false,cellHTML:false,cellDates:false,bookVBA:false,bookDeps:false,sheetRows:L.rows+2});
  if(workbook.SheetNames.length>L.sheets)fail('超过 30 个工作表上限');
  sheets=workbook.SheetNames.map(name=>{const ws=workbook.Sheets[name];if(!ws)return sheet(name,[]);const full=String(ws['!fullref']??ws['!ref']??'A1'),range=XLSX.utils.decode_range(full);if(range.e.r-range.s.r>L.rows||range.e.c-range.s.c>=L.columns)fail('工作表超过 5,000 条记录或 64 列上限');
   const grid=XLSX.utils.sheet_to_json<unknown[]>(ws,{header:1,raw:false,defval:'',blankrows:true});const header=grid.shift()??[],keys=header.map((x,i)=>scalar(x).trim()||`列${i+1}`);if(new Set(keys).size!==keys.length)fail(`工作表 ${name} 存在重复表头`);
   return sheet(name,grid.flatMap((values,i)=>values.some(v=>String(v??'').trim())?[{value:Object.fromEntries(keys.map((key,j)=>[key,values[j]??''])),locator:`${name} · 行 ${range.s.r+i+2}`}]:[]));
  });warnings.push('仅读取已保存的单元格值，不计算公式、不执行宏；公式结果可能需要在原文件中更新。');
 }else if(extension==='txt'||extension==='md')sheets=[sheet('资料',paragraphs(decode(buffer),'正文'))];
 else if(extension==='docx'){
  // JSZip validates the bounded archive before mammoth; no HTML or links rendered.
  await JSZip.loadAsync(buffer,{checkCRC32:true});checkAbort(signal);const result=await mammoth.extractRawText({buffer});sheets=[sheet('资料',paragraphs(result.value,'文档'))];
 }else if(extension==='pdf'){
  const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loading=pdfjs.getDocument({data:new Uint8Array(buffer),isEvalSupported:false,disableFontFace:true,useSystemFonts:false,useWorkerFetch:false,stopAtErrors:true});
  const abort=()=>{void loading.destroy();};signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(abort,20000);
  try{const document=await loading.promise;if(document.numPages>L.pdfPages)fail('PDF 超过 200 页，请拆分');const entries:Array<{value:unknown;locator:string}>=[];let chars=0;
   for(let i=1;i<=document.numPages;i++){checkAbort(signal);const page=await document.getPage(i),content=await page.getTextContent(),text=content.items.map(item=>'str' in item?item.str+('hasEOL' in item&&item.hasEOL?'\n':' '):'').join('').trim();chars+=text.length;if(chars>L.textChars)fail('PDF 文字超过 2 MiB 上限');entries.push(...paragraphs(text,`第 ${i} 页`));page.cleanup();}
   if(!entries.length)fail('PDF 未提取到文字，可能是扫描件；请先进行 OCR 或改传文字文档');sheets=[sheet('资料',entries)];
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);await loading.destroy();}
 }else fail('不支持此文件格式');
 checkAbort(signal);const count=sheets.reduce((sum,s)=>sum+s.rows.length,0);if(!count)fail('没有可导入的记录');if(count>L.rows)fail('文件全部工作表合计超过 5,000 条记录，请拆分');
 if(JSON.stringify(sheets).length>L.textChars)fail('解析后文字超过 2 MiB 上限，请拆分文件');
 return {sheets,warnings,fingerprint:createHash('sha256').update(buffer).digest('hex')};
}
