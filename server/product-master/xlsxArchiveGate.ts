/**
 * P5 XLSX pre-decompression guard. ZIP headers, entry paths, compressed and
 * actual bounded DEFLATE sizes and CRC are checked BEFORE ExcelJS inflates.
 * Conservative profile: single-disk Zip32, deflate/store, no opaque images,
 * external workbooks, macros, encryption, nested ZIPs or exotic names.
 *
 * This bounds verified total uncompressed bytes even if ZIP headers lie, but
 * cannot bound synchronous CPU to a deadline. Process isolation/timeout and
 * independent data-entry validation remain separate production release gates.
 */
import {Buffer} from 'node:buffer';
import {inflateRawSync} from 'node:zlib';

const KB=1024,MB=1024*KB;
const MAX_ENTRIES=256,MAX_TOTAL_UNPACKED=32*MB;
const MAX_ENTRY_UNPACKED=16*MB,MAX_INFLATE_RATIO=500;
const MAX_FILENAME=240;
const bad=()=>new Error('XLSX 压缩存档结构或安全限制不符合要求');
function ensure(ok:unknown):asserts ok{if(!ok)throw bad();}
// Inspect actual decompressed data in a hard-limited buffer. This closes the
// gap between an untrusted ZIP advertised size and its real DEFLATE payload.
// Keep this guard ahead of any Workbook.xlsx.load() that might inflate twice.
const CRC_TABLE=Uint32Array.from({length:256},(_,n)=>{
 let c=n;
 for(let bit=0;bit<8;bit++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;
 return c>>>0;
});
function crc32(value:Buffer):number{
 let crc=0xffffffff;
 for(const byte of value)crc=(CRC_TABLE[(crc^byte)&255]^(crc>>>8))>>>0;
 return (crc^0xffffffff)>>>0;
}
function checkActualEntry(input:Buffer,method:number,offset:number,
 compressed:number,claimed:number,checksum:number):void{
 try{
  const bytes=input.subarray(offset,offset+compressed);
  // The +1 catches a stream that exceeds its claimed size without ever
  // allocating or inflating its full potentially enormous untrusted content.
  const actual=method===0?bytes:
   inflateRawSync(bytes,{maxOutputLength:claimed+1});
  ensure(actual.length===claimed&&crc32(actual)===checksum);
 }catch{throw bad();}
}
const u16=(b:Buffer,o:number)=>b.readUInt16LE(o);
const u32=(b:Buffer,o:number)=>b.readUInt32LE(o);
const header=(b:Buffer,o:number,n:number)=>o>=0&&n>=0&&o+n<=b.length;
const pathAllowed=(path:string)=>{
 if(!/^[\x20-\x7e]+$/.test(path)||path.length>MAX_FILENAME||
  !/^[A-Za-z0-9_[\]./+-]+$/.test(path)||path.startsWith('/')||
  path.includes('//')||path.includes('\\')||path.includes(':')||
  path.replace(/\/$/,'').split('/').some(seg=>seg==='..'||seg==='.'||!seg))
  return false;
 const lower=path.toLowerCase();
 if(lower.includes('..')||lower.endsWith('.exe')||lower.endsWith('.dll')||
    lower.endsWith('.bin')||lower.endsWith('.zip')||lower.endsWith('.js')||
    lower.includes('vba')||lower.includes('macro')||lower.includes('externallinks')||
    lower.includes('activex')||lower.includes('embeddings')||
    lower.startsWith('customxml/')||lower.startsWith('xl/media/')||
    lower.startsWith('xl/connections')||lower.includes('oleobject')||
    lower.includes('webextensions/')||lower.includes('/querytables/'))return false;
 return true;
};
function zip64Extra(b:Buffer,from:number,length:number):boolean{
 const end=from+length;
 for(let off=from;off+4<=end;){
  const id=u16(b,off),sz=u16(b,off+2);
  if(off+4+sz>end)throw bad();
  if(id===1)return true;
  off+=4+sz;
  if(off===end)return false;
  if(off+4>end)throw bad();
 }
 return length!==0;
}
export function verifyFabricXlsxArchive(input:Buffer):void{
 ensure(Buffer.isBuffer(input)&&input.length>=22&&input.length<=8*MB);
 const b=input;
 ensure(u32(b,0)===0x04034b50);
 // EOCD is the final record. Reject appended polyglots/ZIP comments and
 // multi-disk or ZIP64 archives; ExcelJS exports ordinary Zip32 workbooks.
 let eocd=-1;
 for(let pos=b.length-22;pos>=Math.max(0,b.length-65557);pos--){
  if(u32(b,pos)===0x06054b50&&header(b,pos,22)&&
     pos+22+u16(b,pos+20)===b.length){eocd=pos;break;}
 }
 ensure(eocd>=0&&u16(b,eocd+20)===0);
 ensure(u16(b,eocd+4)===0&&u16(b,eocd+6)===0);
 const entries=u16(b,eocd+10),diskEntries=u16(b,eocd+8);
 ensure(entries>0&&entries<=MAX_ENTRIES&&entries===diskEntries&&entries!==0xffff);
 const directorySize=u32(b,eocd+12),start=u32(b,eocd+16);
 ensure(directorySize!==0xffffffff&&start!==0xffffffff&&
   start>0&&directorySize>=46*entries&&
   start+directorySize===eocd);
 let at=start,expanded=0,seenSheets=0;
 const names=new Set<string>(),ranges:{first:number;end:number}[]=[];
 for(let i=0;i<entries;i++){
  ensure(header(b,at,46)&&u32(b,at)===0x02014b50);
  const flags=u16(b,at+8),method=u16(b,at+10);
  // Optional deflate quality bits + data descriptors + UTF8 names only.
  ensure((flags&~(0x0006|0x0008|0x0800))===0);
  ensure(method===0||method===8);
  const compressed=u32(b,at+20),unpacked=u32(b,at+24);
  const nameLen=u16(b,at+28),extraLen=u16(b,at+30);
  const commentLen=u16(b,at+32),disk=u16(b,at+34);
  const offset=u32(b,at+42);
  ensure(disk===0&&compressed!==0xffffffff&&unpacked!==0xffffffff&&
    offset!==0xffffffff&&nameLen>0&&nameLen<=MAX_FILENAME&&
    header(b,at+46,nameLen+extraLen+commentLen)&&
    at+46+nameLen+extraLen+commentLen<=eocd);
  ensure(!zip64Extra(b,at+46+nameLen,extraLen));
  const name=b.subarray(at+46,at+46+nameLen).toString('utf8');
  ensure(pathAllowed(name)&&!names.has(name.toLowerCase()));
  names.add(name.toLowerCase());
  if(/^xl\/worksheets\/sheet[1-9][0-9]*\.xml$/i.test(name))seenSheets++;
  ensure(unpacked<=MAX_ENTRY_UNPACKED);
  expanded+=unpacked;
  ensure(expanded<=MAX_TOTAL_UNPACKED);
  if(unpacked>MB)ensure(compressed>0&&unpacked<=compressed*MAX_INFLATE_RATIO);
  if(name.endsWith('/'))ensure(unpacked===0&&compressed===0);
  if(method===0)ensure(compressed===unpacked);
  ensure(header(b,offset,30)&&u32(b,offset)===0x04034b50);
  const localFlags=u16(b,offset+6),localMethod=u16(b,offset+8);
  const localName=u16(b,offset+26),localExtra=u16(b,offset+28);
  ensure(localFlags===flags&&localMethod===method&&localName===nameLen&&
    header(b,offset+30,localName+localExtra)&&
    b.subarray(offset+30,offset+30+localName).equals(b.subarray(at+46,at+46+nameLen)));
  ensure(!zip64Extra(b,offset+30+localName,localExtra));
  if((flags&0x8)===0)ensure(
    u32(b,offset+18)===compressed&&u32(b,offset+22)===unpacked&&
    u32(b,offset+14)===u32(b,at+16));
  const dataStart=offset+30+localName+localExtra;
  ensure(dataStart+compressed<=start);
  // ZIP central metadata is attacker-controlled. Before ExcelJS we must
  // verify that the real inflation does not overrun the advertised lengths.
  checkActualEntry(b,method,dataStart,compressed,unpacked,u32(b,at+16));
  ranges.push({first:offset,end:dataStart+compressed});
  at+=46+nameLen+extraLen+commentLen;
 }
 ensure(at===eocd&&names.has('[content_types].xml')&&
   names.has('xl/workbook.xml')&&seenSheets>0&&seenSheets<=20);
 ranges.sort((a,b)=>a.first-b.first);
 for(let j=1;j<ranges.length;j++)ensure(ranges[j-1].end<=ranges[j].first);
}
