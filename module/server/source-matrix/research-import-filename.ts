import { TextDecoder } from 'node:util';

/** Only repair reversible UTF-8 bytes misread as Latin-1/Windows-1252. A
 * plausible Chinese result is required; valid Western filenames stay intact.
 * This helper handles names only, never workbook/content bytes. */
export function repairStoredResearchFilename(name:string):string {
 if(!name||/[\u3400-\u9fff\ufffd]/u.test(name))return name;
 const cp1252='€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';
 const bytes:number[]=[];
 for(const character of name){const code=character.charCodeAt(0),index=cp1252.indexOf(character);if(code<=255)bytes.push(code);else if(index>=0)bytes.push(128+index);else return name;}
 try {
  const decoded=new TextDecoder('utf-8',{fatal:true}).decode(new Uint8Array(bytes));
  if(!/[\u3400-\u9fff]/u.test(decoded)||/[\ufffd\u0000-\u001f\u007f]/u.test(decoded))return name;
  if(!Buffer.from(decoded,'utf8').equals(Buffer.from(bytes)))return name;
  return decoded;
 }catch{return name;}
}

export function resolveResearchFilename(originalName:string|undefined,transportName:string):string {
 // Browser FormData text fields arrive as UTF-8. Never Latin-1-convert an
 // explicit original_name, even if it resembles a legacy broken name.
 const chosen=originalName===undefined?repairStoredResearchFilename(transportName):originalName;
 const cleaned=chosen.normalize('NFC').replace(/[/\\\u0000-\u001f\u007f]/g,'_').replace(/[\u202a-\u202e\u2066-\u2069]/g,'').trim();
 const characters=Array.from(cleaned);if(characters.length<=255)return cleaned;
 const extension=cleaned.match(/\.[a-z0-9]{1,10}$/i)?.[0]??'';
 return characters.slice(0,255-extension.length).join('')+extension;
}
