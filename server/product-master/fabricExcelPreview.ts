/** XLSX-only V2 Fabric preview; read-only and isolated from production routes. */
import ExcelJS from 'exceljs';
import {verifyFabricXlsxArchive} from './xlsxArchiveGate';
import type {WeightUnit} from './fabrics';
export class FabricExcelError extends Error{
 constructor(message:string){super(message);this.name='FabricExcelError';}
}
export type FabricExcelKey='fabricNo'|'fabricName'|'composition'|'weightValue'|'weightUnit'|'widthValue'|'remark';
export type FabricExcelMapping=Partial<Record<FabricExcelKey,number>>;
export interface ExistingFabric{
 id:string;fabricNo:string;fabricName:string;composition:string|null;
 weightValue:number|null;weightUnit:WeightUnit|null;widthValue:number|null;
 remark:string|null;isActive:boolean;
}
export type ImportFabric=Omit<ExistingFabric,'id'|'isActive'>;
export interface FabricPreviewLine{
 rowNumber:number;action:'create'|'skip'|'error';reason:string;
 fabric:ImportFabric|null;fabricNoHint?:string;existing?:ExistingFabric;
 changes?:Record<string,{from:unknown;to:unknown}>;
}
export interface FabricExcelOptions{
 filename:string;sheetName?:string;headerRow?:number;mapping?:FabricExcelMapping;
 defaultWeightUnit?:WeightUnit;existing?:ExistingFabric[];
}
export interface FabricExcelPreview{
 sheetName:string;headerRow:number;mapping:FabricExcelMapping;
 rows:FabricPreviewLine[];counts:{create:number;skip:number;error:number};
}
const FIELDS:FabricExcelKey[]=['fabricNo','fabricName','composition','weightValue','weightUnit','widthValue','remark'];
const aliases:Record<FabricExcelKey,string[]>={
 fabricNo:['品号','面料品号'],fabricName:['品名','面料品名'],
 composition:['成分','成份','面料成分'],
 weightValue:['克重','克重数值','克重(gsm)','克重(mm)','克重(姆米)','克重(g/m²)'],
 weightUnit:['克重单位','单位','gsm/mm','克重单位(gsm/mm)'],widthValue:['门幅(cm)','门幅','门幅（cm）','门幅（里面CM）','门幅（厘米CM）'],
 remark:['备注','说明']
};
const nh=(s:string)=>s.trim().replace(/\s+/g,'').replace(/（/g,'(').replace(/）/g,')').toLowerCase();
const named=Object.fromEntries(FIELDS.map(k=>[k,new Set(aliases[k].map(nh))])) as Record<FabricExcelKey,Set<string>>;
function txt(v:unknown):string{
 if(v===null||v===undefined)return '';
 if(typeof v==='string')return v.trim();
 if(typeof v==='number'&&Number.isFinite(v))return String(v);
 throw new FabricExcelError('请将公式、日期等复杂单元格转为普通值');
}
function cell(row:ExcelJS.Row,index:number):unknown{
 const value=row.getCell(index).value;
 if(value&&typeof value==='object')throw new FabricExcelError('公式或特殊单元格不允许直接导入');
 return value;
}
function number(s:string,scale:number,intDigits:number,name:string):number|null{
 if(!s)return null;
 if(!/^[0-9]+(?:\.[0-9]+)?$/.test(s))throw new FabricExcelError(name+'须为正数');
 const [integer,part='']=s.split('.');
 if(integer.length>intDigits||part.length>scale||Number(s)<=0)
  throw new FabricExcelError(name+'精度或范围无效');
 return Number(s);
}
function no(v:unknown):string{
 const x=txt(v).toUpperCase();
 if(!x)throw new FabricExcelError('品号不能为空');
 return x;
}
function codeAt(row:ExcelJS.Row,index:number):string{
 const value=cell(row,index),format=row.getCell(index).numFmt;
 // Preserve an explicit Excel zero-padding format without inventing missing digits.
 return no(typeof value==='number'&&Number.isInteger(value)&&value>=0&&/^0+$/.test(format??'')?
  String(value).padStart(format.length,'0'):value);
}
function field(raw:unknown,max:number,mandatory=false):string|null{
 const x=txt(raw);
 if((mandatory&&!x)||[...x].length>max||/[\p{Cc}\p{Cf}]/u.test(x))
  throw new FabricExcelError('必填或字段长度不符合规范');
 return x||null;
}
const unit=(v:string):WeightUnit|undefined=>{
 const s=v.replace(/\s/g,'').toLowerCase();
 if(['gsm','g/m²','g/m2','克/平方米'].includes(s))return 'gsm';
 if(['mm','姆米'].includes(s))return 'mm';
 return undefined;
};
function weight(v:unknown,u:unknown,heading:string,fallback?:WeightUnit){
 const s=txt(v),column=txt(u);
 if(!s){
  if(column)throw new FabricExcelError('克重无值但存在单位');
  return {weightValue:null,weightUnit:null};
 }
 const match=/^([0-9]+(?:\.[0-9]+)?)\s*(gsm|g\/m²|g\/m2|克\/平方米|mm|姆米)?$/i.exec(s);
 if(!match)throw new FabricExcelError('克重格式或单位无法识别');
 const headingUnit=/^克重\s*[（(]\s*(.*?)\s*[)）]$/i.exec(heading)?.[1]??'';
 const explicit=[match[2],column,headingUnit].filter(Boolean).map(x=>unit(String(x)));
 if(explicit.some(x=>!x)||new Set(explicit).size>1)
  throw new FabricExcelError('克重单位不明确或多个来源冲突');
 const selected=explicit[0]??fallback;
 if(!selected)throw new FabricExcelError('纯数值克重必须人工指定gsm或mm');
 return {weightValue:number(match[1],3,9,'克重'),weightUnit:selected};
}
function width(v:unknown,heading:string):number|null{
 const s=txt(v);
 if(!s)return null;
 if(/[（(].*[)）]/.test(heading)&&!/\bcm\b/i.test(heading))
  throw new FabricExcelError('门幅来源单位不是cm');
 if(/[a-zA-Z一-龥]/.test(s)&&!/^\d+(?:\.\d+)?\s*cm$/i.test(s))
  throw new FabricExcelError('门幅只接受cm，不执行换算');
 return number(s.replace(/\s*cm$/i,''),2,10,'门幅');
}
function resolveHeaders(heads:string[],override?:FabricExcelMapping){
 const map:FabricExcelMapping={...override};
 for(const f of FIELDS){
  if(map[f]!==undefined)continue;
  const candidates=heads.flatMap((v,i)=>named[f].has(nh(v))?[i+1]:[]);
  if(candidates.length>1)throw new FabricExcelError(f+'表头存在重复候选，请人工确认映射');
  if(candidates.length===1)map[f]=candidates[0];
 }
 if(!map.fabricNo||!map.fabricName||map.fabricNo===map.fabricName)
  throw new FabricExcelError('品号和品名必须分别映射不同来源列');
 const mapped=Object.values(map);
 if(mapped.some(x=>!Number.isSafeInteger(x)||x<1||x>64)||new Set(mapped).size!==mapped.length)
  throw new FabricExcelError('映射列无效或同列重复使用');
 return map;
}

function decode(row:ExcelJS.Row,map:FabricExcelMapping,heads:Record<FabricExcelKey,string>,fallback?:WeightUnit,existingName?:string):ImportFabric{
 const read=(k:FabricExcelKey)=>map[k]===undefined?null:cell(row,map[k]!);
 const fabricNo=codeAt(row,map.fabricNo!);
 const fabricName=field(read('fabricName'),255,false)??existingName;
 if(!fabricName)throw new FabricExcelError('新增面料品名必填');
 const composition=field(read('composition'),500);
 const weights=weight(read('weightValue'),read('weightUnit'),heads.weightValue,fallback);
 return {fabricNo,fabricName,composition,...weights,
  widthValue:width(read('widthValue'),heads.widthValue),remark:field(read('remark'),5000)};
}
function differences(f:ImportFabric,original:ExistingFabric):Record<string,{from:unknown;to:unknown}>{
 const result:Record<string,{from:unknown;to:unknown}>={};
 for(const key of FIELDS){
  const incoming=f[key],before=original[key];
  // Existing value is retained when the corresponding import field is empty.
  if(incoming!==null&&incoming!==before)result[key]={from:before,to:incoming};
 }
 return result;
}
export async function previewFabricXlsx(input:Buffer,opts:FabricExcelOptions):Promise<FabricExcelPreview>{
 if(!opts||typeof opts.filename!=='string'||!opts.filename.toLowerCase().endsWith('.xlsx'))
  throw new FabricExcelError('仅支持xlsx工作簿；请将旧版文件另存为xlsx');
 if(!Buffer.isBuffer(input)||input.length<8||input.length>8*1024*1024||
  input[0]!==0x50||input[1]!==0x4b)
  throw new FabricExcelError('XLSX格式无效或文件超过8MB');
 if(opts.defaultWeightUnit!==undefined&&opts.defaultWeightUnit!=='gsm'&&opts.defaultWeightUnit!=='mm')
  throw new FabricExcelError('克重默认单位必须为gsm或mm');
 // Do not let ExcelJS inflate a hostile ZIP before structural bounds checks.
 try{verifyFabricXlsxArchive(input);}
 catch{throw new FabricExcelError('XLSX 压缩存档结构或安全限制不符合要求');}
 const book=new ExcelJS.Workbook();
 try{await book.xlsx.load(input as never);}
 catch{throw new FabricExcelError('无法读取有效的XLSX工作簿');}
 if(book.worksheets.length>20)throw new FabricExcelError('最多解析20个工作表');
 const ws=opts.sheetName?book.getWorksheet(opts.sheetName):
  (book.getWorksheet('面料资料')??book.worksheets[0]);
 if(!ws)throw new FabricExcelError('找不到工作表');
 const headerRow=opts.headerRow??1;
 if(!Number.isSafeInteger(headerRow)||headerRow<1||headerRow>50)
  throw new FabricExcelError('表头行只能为1至50');
 if(ws.rowCount>3000||ws.columnCount>64)throw new FabricExcelError('一次最多3000行/64列');
 const header=ws.getRow(headerRow);
 const headers=Array.from({length:ws.columnCount},(_,i)=>txt(cell(header,i+1)));
 const mapping=resolveHeaders(headers,opts.mapping);
 const columnHeaders=Object.fromEntries(FIELDS.map(k=>[k,headers[(mapping[k]??0)-1]??''])) as Record<FabricExcelKey,string>;
 const existing=new Map((opts.existing??[]).map(x=>[x.fabricNo.trim().toUpperCase(),x]));
 const rows:FabricPreviewLine[]=[];
 for(let i=headerRow+1;i<=ws.rowCount;i++){
  const sheetRow=ws.getRow(i);
  const hasValue=FIELDS.some(k=>mapping[k]!==undefined&&
   sheetRow.getCell(mapping[k]!).value!=null&&String(sheetRow.getCell(mapping[k]!).value).trim());
  if(!hasValue)continue;
  let fabricNoHint:string|undefined;
  try{fabricNoHint=codeAt(sheetRow,mapping.fabricNo!);}catch{/* The row decoder reports the error. */}
  const code=fabricNoHint??'';
  try{
   const fabric=decode(sheetRow,mapping,columnHeaders,opts.defaultWeightUnit,
    existing.get(code)?.fabricName);
   rows.push({rowNumber:i,action:'create',reason:'可以新增',fabric,fabricNoHint});
  }catch(error){
   rows.push({rowNumber:i,action:'error',reason:error instanceof Error?error.message:'无法解析该行',fabric:null,fabricNoHint});
  }
 }
 const duplicate=new Map<string,number[]>();
 for(const row of rows){
  const code=row.fabricNoHint;
  if(code)
   duplicate.set(code,[...(duplicate.get(code)??[]),row.rowNumber]);
 }
 for(const row of rows){
  const code=row.fabricNoHint??'';
  const same=duplicate.get(code)??[];
  if(same.length>1){
   row.action='skip';row.reason='文件内重复品号，所有相关行：'+same.join('、');
  }else if(row.action==='create'&&row.fabric){
   const old=existing.get(row.fabric.fabricNo);
   if(old){
    row.action='skip';row.reason='品号已存在，默认跳过，当前登录用户明确确认后才可更新';
    row.existing=old;row.changes=differences(row.fabric,old);
   }
  }
 }
 const counts={create:0,skip:0,error:0};
 for(const r of rows)counts[r.action]++;
 return {sheetName:ws.name,headerRow,mapping,rows,counts};
}
