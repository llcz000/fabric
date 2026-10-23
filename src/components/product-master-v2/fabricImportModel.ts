/** P5 XLSX-only preview/confirm client contract. No legacy route or authority. */
export type FabricImportKey='fabricNo'|'fabricName'|'composition'|'weightValue'|'weightUnit'|'widthValue'|'remark';
export type FabricImportMapping=Partial<Record<FabricImportKey,number>>;
export type FabricImportOptions={filename:string;sheetName?:string;headerRow?:number;
 defaultWeightUnit?:'gsm'|'mm';mapping?:FabricImportMapping};
export interface FabricImportRow{
 rowNumber:number;action:'create'|'skip'|'error';reason:string;
 fabric:null|{fabricNo:string;fabricName:string;composition:string|null;weightValue:number|null;
  weightUnit:'gsm'|'mm'|null;widthValue:number|null;remark:string|null};
 fabricNoHint?:string;
 existing?:{id:string;fabricNo:string;fabricName:string;composition:string|null;weightValue:number|null;
  weightUnit:'gsm'|'mm'|null;widthValue:number|null;remark:string|null;isActive:boolean};
 changes?:Record<string,{from:unknown;to:unknown}>;
}
export interface FabricImportPreview{
 token:string;expiresInSeconds:number;sheetName:string;headerRow:number;
 mapping:FabricImportMapping;rows:FabricImportRow[];
 counts:{create:number;skip:number;error:number};
}
export interface FabricImportResult{
 rows:{rowNumber:number;status:'created'|'updated'|'skipped'|'failed';reason:string;fabricNo:string|null}[];
 counts:{created:number;updated:number;skipped:number;failed:number};
}
export function formatFabricImportStatus(status:FabricImportResult['rows'][number]['status']):string{
 return {created:'新增',updated:'更新',skipped:'跳过',failed:'失败'}[status];
}

const id=(s:unknown)=>typeof s==='string'&&/^[1-9]\d{0,19}$/.test(s)&&BigInt(s)<=18446744073709551615n;
export function parseFabricImportPreview(data:unknown):FabricImportPreview{
 if(!data||typeof data!=='object'||Array.isArray(data))throw Error('预览资料无效');
 const p=data as Record<string,unknown>;
 if(typeof p.token!=='string'||!/^[0-9a-f]{64}$/.test(p.token)||
  !Number.isSafeInteger(p.expiresInSeconds)||Number(p.expiresInSeconds)<=0||
  typeof p.sheetName!=='string'||!Number.isSafeInteger(p.headerRow)||
  !p.mapping||typeof p.mapping!=='object'||!Array.isArray(p.rows)||p.rows.length>3000||
  !p.counts||typeof p.counts!=='object')
  throw Error('预览数据格式错误');
 const c=p.counts as Record<string,unknown>;
 if(!['create','skip','error'].every(k=>Number.isSafeInteger(c[k])&&Number(c[k])>=0)||
  ['create','skip','error'].reduce((n,k)=>n+Number(c[k]),0)!==p.rows.length)
  throw Error('预览统计不一致');
 const seen=new Set<number>();
 for(const item of p.rows){
  if(!item||typeof item!=='object')throw Error('预览行无效');
  const row=item as FabricImportRow;
  if(!Number.isSafeInteger(row.rowNumber)||row.rowNumber<2||seen.has(row.rowNumber)||
   !['create','skip','error'].includes(row.action)||typeof row.reason!=='string'||row.reason.length>500||
   !(row.fabric===null||typeof row.fabric==='object'))
   throw Error('预览行格式无效');
  if(row.existing&&!id(row.existing.id))throw Error('原面料身份无效');
  if(row.action==='create'&&!row.fabric)throw Error('新增行内容缺失');
  seen.add(row.rowNumber);
 }
 return data as FabricImportPreview;
}
export function validateSelectedRows(preview:FabricImportPreview,selected:number[],canManage:boolean){
 if(!Array.isArray(selected)||new Set(selected).size!==selected.length)throw Error('重复的更新行');
 if(!canManage&&selected.length)throw Error('当前账号没有面料更新权限');
 const eligible=new Set(preview.rows.filter(r=>r.action==='skip'&&r.existing&&r.fabric).map(r=>r.rowNumber));
 if(selected.some(x=>!eligible.has(x)))throw Error('只能选择预览中的已有面料更新行');
 return [...selected].sort((a,b)=>a-b);
}
async function read(res:Response){
 if(!res.ok){
  if(res.status===409)throw Error('预览已过期或出现并发冲突，请重新预览');
  if(res.status===403)throw Error('当前账号没有执行本操作的权限');
  if(res.status===401)throw Error('登录状态已失效，请重新登录');
  if(res.status===413)throw Error('文件太大，请拆分后重试');
  if(res.status===400)throw Error('文件、表头、单位或确认资料不符合规则');
  throw Error('面料导入服务暂不可用');
 }
 return res.json();
}
export async function previewFabricImport(fetcher:typeof fetch,fileBase64:string,options:FabricImportOptions){
 return parseFabricImportPreview(await read(await fetcher('/api/v2/fabrics/import/preview',{
  method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({fileBase64,options})
 })));
}
export async function commitFabricImport(fetcher:typeof fetch,token:string,updateRows:number[]){
 if(!/^[0-9a-f]{64}$/.test(token)||!Array.isArray(updateRows)||updateRows.some(x=>!Number.isSafeInteger(x)))
  throw Error('确认资料无效');
 const json=await read(await fetcher('/api/v2/fabrics/import/commit',{
  method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({token,confirm:true,updateRows})
 }));
 if(!json||typeof json!=='object'||!Array.isArray((json as FabricImportResult).rows))
  throw Error('导入结果格式无效');
 return json as FabricImportResult;
}
export async function fileAsBase64(file:File):Promise<string>{
 if(!file.name.toLowerCase().endsWith('.xlsx')||file.size>8*1024*1024)
  throw Error('请选择不超过8MB的.xlsx文件');
 return new Promise((resolve,reject)=>{
  const reader=new FileReader();
  reader.onerror=()=>reject(Error('文件读取失败'));
  reader.onload=()=>{
   const value=reader.result;
   if(typeof value!=='string'||!value.includes(','))reject(Error('无法读取Excel文件'));
   else resolve(value.slice(value.indexOf(',')+1));
  };
  reader.readAsDataURL(file);
 });
}
