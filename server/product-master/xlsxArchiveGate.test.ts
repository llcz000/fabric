import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import {strToU8,zipSync} from 'fflate';
import {verifyFabricXlsxArchive} from './xlsxArchiveGate';
import {FabricExcelError,previewFabricXlsx} from './fabricExcelPreview';

const sig=(hex:string)=>Buffer.from(hex,'hex');
const little=(buf:Buffer,signature:string)=>buf.indexOf(sig(signature));
const zip=(extras:Record<string,Uint8Array>={})=>Buffer.from(zipSync({
 '[Content_Types].xml':strToU8('<Types/>'),
 'xl/workbook.xml':strToU8('<workbook/>'),
 'xl/worksheets/sheet1.xml':strToU8('<worksheet/>'),
 ...extras
}));
const assertRejected=(buf:Buffer,pattern:RegExp=/XLSX|ZIP|压缩|存档|文件|安全|结构|支持/)=>
 assert.throws(()=>verifyFabricXlsxArchive(buf),pattern);
async function workbook(){
 const w=new ExcelJS.Workbook();
 const sheet=w.addWorksheet('面料资料');
 sheet.addRow(['品号','品名','成分','克重','克重单位','门幅(cm)','备注']);
 sheet.addRow(['F018','新花布','棉',98,'gsm',150,'客户确认']);
 return Buffer.from(await w.xlsx.writeBuffer());
}
test('P5 normal ExcelJS workbook stays valid; real preview still reads text IDs and units',async()=>{
 const buf=await workbook();
 verifyFabricXlsxArchive(buf);
 const result=await previewFabricXlsx(buf,{filename:'fabrics.xlsx'});
 assert.equal(result.rows[0].fabric?.fabricNo,'F018');
 assert.equal(result.rows[0].fabric?.weightUnit,'gsm');
 assert.equal(result.counts.create,1);
});
test('P5 rejects compressed workbook carrying multi-megabyte expandable data BEFORE ExcelJS',()=>{
 const bomb=zip({'xl/worksheets/bomb.xml':new Uint8Array(35*1024*1024)});
 assertRejected(bomb);
 assert(bomb.length<8*1024*1024);
});
test('P5 rejects strongly compressed huge 2MiB entry regardless of total size',()=>{
 const bomb=zip({'xl/worksheets/bomb.xml':new Uint8Array(2*1024*1024)});
 assertRejected(bomb);
});
test('P5 denies active content, linked workbooks, embeddings and media even with normal ZIP',()=>{
 for(const file of [
  'xl/vbaProject.bin','xl/externalLinks/externalLink1.xml',
  'xl/activeX/activeX1.bin','xl/embeddings/oleObject1.bin',
  'xl/media/image1.png','xl/connections.xml','customXml/item1.xml'
 ]){
  assertRejected(zip({[file]:strToU8('x')}),/不支持|XLSX|ZIP|安全/);
 }
});
test('P5 refuses zip-slip paths, Windows separators, noncanonical names and duplicates',()=>{
 for(const file of ['xl/../attack.xml','../evil','xl\\worksheets\\sheet2.xml',
  '/xl/worksheets/sheet2.xml','xl//worksheets/sheet2.xml','xl/./']){
  assertRejected(zip({[file]:strToU8('x')}));
 }
 const dup=zip();
 const cd=little(dup,'504b0102');assert(cd>=0);
 // Rename another central entry to duplicate existing filename without changing
 // length, exploiting ZIP duplicate-name confusion.
 const raw=Buffer.from(dup);
 const nameLen=raw.readUInt16LE(cd+28);
 const next=cd+46+nameLen+raw.readUInt16LE(cd+30)+raw.readUInt16LE(cd+32);
 const len2=raw.readUInt16LE(next+28);
 if(len2===nameLen){
  raw.copy(raw,next+46,cd+46,cd+46+nameLen);
  assertRejected(raw);
 }
});
test('P5 rejects forged central-directory decompressed size and central-directory corruption',()=>{
 const original=zip();
 const cd=little(original,'504b0102');assert(cd>=0);
 for(const mutate of [(b:Buffer)=>b.writeUInt32LE(0x7fffffff,cd+24),
  (b:Buffer)=>b.writeUInt32LE(0x7fffffff,cd+20),
  (b:Buffer)=>b.writeUInt32LE(0xffffffff,cd+42),
  (b:Buffer)=>b.writeUInt32LE(0xffffffff,cd+16),
  (b:Buffer)=>b.writeUInt16LE(0xffff,cd+28)]){
  const corrupt=Buffer.from(original);mutate(corrupt);assertRejected(corrupt);
 }
});
test('P5 rejects encrypted ZIP, unsafe ZIP compression and local/central mismatch',()=>{
 const original=zip();
 const cd=little(original,'504b0102');assert(cd>=0);
 const local=little(original,'504b0304');assert(local>=0);
 for(const [position,value] of [[cd+8,1],[local+6,1],[cd+10,99],
  [local+8,99]] as const){
  const corrupted=Buffer.from(original);corrupted.writeUInt16LE(value,position);
  assertRejected(corrupted);
 }
 const tamper=Buffer.from(original);tamper[local+30]^=0x20;
 assertRejected(tamper);
});
test('P5 rejects appended polyglot payload, broken EOCD disk, truncated or ZIP64 metadata',()=>{
 const original=zip();
 const eocd=original.lastIndexOf(sig('504b0506'));assert(eocd>=0);
 for(const buf of [
  Buffer.concat([original,Buffer.from('<script>malicious</script>')]),
  original.subarray(0,original.length-8),
  (()=>{const t=Buffer.from(original);t.writeUInt16LE(1,eocd+4);return t;})(),
  (()=>{const t=Buffer.from(original);t.writeUInt16LE(0xffff,eocd+10);return t;})(),
  (()=>{const t=Buffer.from(original);t.writeUInt32LE(0xffffffff,eocd+12);return t;})()
 ])assertRejected(buf);
});
test('P5 rejects archives over 256 members and duplicate case-insensitive workbook members',()=>{
 const entries:Record<string,Uint8Array>={};
 for(let i=0;i<260;i++)entries['xl/worksheets/s'+i+'.xml']=strToU8('x');
 assertRejected(zip(entries));
 assertRejected(zip({'xl/WORKBOOK.XML':strToU8('another case')}));
});
test('P5 rejects central directory local offsets overlapping another entry',()=>{
 const original=zip();
 const first=little(original,'504b0102');assert(first>=0);
 const second=first+46+original.readUInt16LE(first+28)+original.readUInt16LE(first+30)+original.readUInt16LE(first+32);
 const forged=Buffer.from(original);
 forged.writeUInt32LE(forged.readUInt32LE(first+42),second+42);
 assertRejected(forged);
});
test('P5 forged tiny central sizes must not allow massive actual deflate expansion',()=>{
 const large=zip({'xl/worksheets/extra.xml':new Uint8Array(4*1024*1024)});
 // The compressed payload remains a valid ~4KB deflate stream, but the
 // attacker lowers the central-directory expanded length to just one byte.
 // The old header-only preflight accepted this forged promise.
 const cd=little(large,'504b0102');assert(cd>=0);
 let entry=cd,changed=false;
 while(entry<large.length&&large.readUInt32LE(entry)===0x02014b50){
  const filename=large.subarray(entry+46,entry+46+large.readUInt16LE(entry+28)).toString();
  const next=entry+46+large.readUInt16LE(entry+28)+large.readUInt16LE(entry+30)+large.readUInt16LE(entry+32);
  if(filename==='xl/worksheets/extra.xml'){
   const local=large.readUInt32LE(entry+42);
   const forged=Buffer.from(large);
   forged.writeUInt32LE(1,entry+24);
   if((forged.readUInt16LE(local+6)&8)===0)forged.writeUInt32LE(1,local+22);
   assertRejected(forged);
   changed=true;break;
  }
  entry=next;
 }
 assert(changed);
});
test('P5 corrupted compressed entry CRC cannot bypass matching local and central ZIP headers',async()=>{
 const validWorkbook=await workbook();
 const cd=little(validWorkbook,'504b0102');assert(cd>=0);
 const local=validWorkbook.readUInt32LE(cd+42);
 const modified=Buffer.from(validWorkbook);
 modified.writeUInt32LE((modified.readUInt32LE(cd+16)^1)>>>0,cd+16);
 if((modified.readUInt16LE(local+6)&8)===0)
  modified.writeUInt32LE(modified.readUInt32LE(cd+16),local+14);
 assertRejected(modified);
});
test('P5 changing one compressed payload byte must fail even when header size is plausible',()=>{
 const original=zip({'xl/worksheets/extra.xml':strToU8('some valid repeated text '.repeat(100))});
 const cd=little(original,'504b0102');assert(cd>=0);
 let cursor=cd,found=-1;
 while(cursor<original.length&&original.readUInt32LE(cursor)===0x02014b50){
  const size=original.readUInt16LE(cursor+28);
  const name=original.subarray(cursor+46,cursor+46+size).toString();
  if(name==='xl/worksheets/extra.xml'){found=cursor;break;}
  cursor+=46+size+original.readUInt16LE(cursor+30)+original.readUInt16LE(cursor+32);
 }
 assert(found>=0);
 const offset=original.readUInt32LE(found+42);
 const pos=offset+30+original.readUInt16LE(offset+26)+original.readUInt16LE(offset+28);
 const modified=Buffer.from(original);modified[pos+3]^=1;
 assertRejected(modified);
});
test('P5 malformed XLSX is rejected before worksheet parsing with a public safe message',async()=>{
 const attacker=zip({'xl/vbaProject.bin':strToU8('not a macro')});
 await assert.rejects(previewFabricXlsx(attacker,{filename:'safe.xlsx'}),FabricExcelError);
});
