import { expect,it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseResearchFile } from './research-import-parser.js';
import { validateAutomatically } from './research-import-core.js';

it('reads saved Unicode workbook values independently of its Chinese filename',async()=>{
 const workbook=XLSX.utils.book_new();
 XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['媒体名称','媒体url'],['中文媒体','example.com']]),'媒体表');
 XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['字段名称','字段释义'],['名称','真实中文正文']]),'说明');
 const bytes=XLSX.write(workbook,{type:'buffer',bookType:'xlsx'});
 const result=await parseResearchFile('中文信源.xlsx',bytes);
 expect(result.sheets.map(sheet=>sheet.name)).toEqual(['媒体表','说明']);
 expect(result.sheets[0]!.rows[0]!.values['媒体名称']).toBe('中文媒体');
 expect(validateAutomatically(result).counts.valid).toBe(2);
 const renamed=await parseResearchFile('renamed.xlsx',bytes);expect(renamed.fingerprint).toBe(result.fingerprint);
});

it('uses the first nonempty spreadsheet row as its header and preserves real row numbers',async()=>{
 const workbook=XLSX.utils.book_new(),ws=XLSX.utils.aoa_to_sheet([[],['媒体名称','url'],['媒体甲','https://example.com']]);
 ws['!ref']='A1:B3';XLSX.utils.book_append_sheet(workbook,ws,'来源');
 const result=await parseResearchFile('研究.xlsx',XLSX.write(workbook,{type:'buffer',bookType:'xlsx'}));
 expect(result.sheets[0]!.columns).toEqual(['媒体名称','url']);
 expect(result.sheets[0]!.rows[0]!.locator).toBe('来源 · 行 3');
});

it('distinguishes a blank worksheet from a recognized header without data',async()=>{
 const workbook=XLSX.utils.book_new();
 XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['媒体名称'],['媒体甲']]),'来源');
 XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([]),'空白');
 XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['媒体名称','url']]),'待补充');
 const result=validateAutomatically(await parseResearchFile('研究.xlsx',XLSX.write(workbook,{type:'buffer',bookType:'xlsx'})));
 expect(result.counts).toEqual({valid:1,duplicate:0,failed:0,total:1});
 expect(result.warnings.some(warning=>warning.includes('空白')&&warning.includes('为空'))).toBe(true);
 expect(result.warnings.some(warning=>warning.includes('待补充')&&warning.includes('仅有已识别表头'))).toBe(true);
 expect(result.warnings.some(warning=>warning.includes('待补充')&&warning.includes('为空'))).toBe(false);
});

it.each([true,false])('rejects an unrecognized single-row worksheet with its name (other data: %s)',async includeData=>{
 const workbook=XLSX.utils.book_new();
 if(includeData)XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['媒体名称'],['媒体甲']]),'来源');
 XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['本轮样本只覆盖华南地区']]),'采样说明');
 await expect(parseResearchFile('研究.xlsx',XLSX.write(workbook,{type:'buffer',bookType:'xlsx'}))).rejects.toThrow(/采样说明.*无法识别/);
});

it('does not accept an ambiguous header-only worksheet as empty',async()=>{
 const workbook=XLSX.utils.book_new();
 XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['媒体名称'],['媒体甲']]),'来源');
 XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['url','URL']]),'冲突表头');
 await expect(parseResearchFile('研究.xlsx',XLSX.write(workbook,{type:'buffer',bookType:'xlsx'}))).rejects.toThrow(/冲突表头.*歧义/);
});

it('rejects repeated normalized headers instead of hiding values behind aliases',async()=>{
 const result=await parseResearchFile('研究.csv',Buffer.from('URL,url\nhttps://one.example,https://two.example','utf8'));
 expect(()=>validateAutomatically(result)).toThrow(/歧义/);
});

it('does not save a malformed CSV row alongside valid records',async()=>{
 const result=await parseResearchFile('研究.csv',Buffer.from('媒体名称,url\n甲,https://example.com\n乙,https://other.example,extra','utf8'));
 expect(()=>validateAutomatically(result)).toThrow(/字段数量/);
});

it('decodes UTF-16 text without applying filename recovery to document content',async()=>{
 const bytes=Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from('媒体名称\tmediaurl\r\n中文媒体\texample.com','utf16le')]);
 const result=await parseResearchFile('资料.tsv',bytes);
 expect(validateAutomatically(result).records[0]!.source_name).toBe('中文媒体');
});
