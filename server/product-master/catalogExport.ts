import type {RequestHandler} from 'express';
import {parsePatternCatalogQuery,searchPatternCatalog} from './patternCatalog';
import {parseFabricCatalogQuery,searchFabricCatalog} from './fabricCatalog';
import {parseProductSearchQuery,searchProductCatalog} from './productSearch';
import {buildCatalogWorkbook,type CatalogExportKind,type CatalogExportItem} from './catalogExportWorkbook';
type Query={query(sql:string,params?:unknown[]):Promise<[unknown,unknown]>};
export class CatalogExportError extends Error{readonly status=409;}
export interface ExportPage{items:CatalogExportItem[];total:number;offset:number;limit:number}
/** Reject detected count/page drift and duplicate rows. This is not a database snapshot. */
export async function collectExportRows(read:(offset:number)=>Promise<ExportPage>):Promise<CatalogExportItem[]>{
 const result:CatalogExportItem[]=[],seen=new Set<string>();let expected:number|undefined;
 for(let offset=0;;){
  const page=await read(offset);
  if(!Number.isSafeInteger(page.total)||page.total<0||page.total>1048575||page.offset!==offset||page.limit<1||page.items.length>page.limit||
    (expected!==undefined&&expected!==page.total))throw new CatalogExportError('资料已变化或超过Excel容量，请缩小筛选后重试');
  expected=page.total;
  for(const row of page.items){if(seen.has(row.id))throw new CatalogExportError('资料已变化，请重试导出');seen.add(row.id);result.push(row);}
  if(result.length>expected)throw new CatalogExportError('资料已变化，请重试导出');
  if(result.length===expected)return result;
  if(page.items.length!==page.limit)throw new CatalogExportError('资料已变化，请重试导出');
  offset+=page.items.length;
 }
}
export async function exportCatalog(db:Query,kind:CatalogExportKind,raw:unknown):Promise<Uint8Array>{
 let read:(offset:number)=>Promise<ExportPage>;
 // Validate the original query first; only pagination is replaced for a full filtered export.
 if(kind==='patterns'){
  const query=parsePatternCatalogQuery(raw);read=offset=>searchPatternCatalog(db,{...query,limit:100,offset});
 }else if(kind==='fabrics'){
  const query=parseFabricCatalogQuery(raw);read=offset=>searchFabricCatalog(db,{...query,limit:100,offset});
 }else{
  const query=parseProductSearchQuery(raw);read=offset=>searchProductCatalog(db,{...query,limit:100,offset});
 }
 return buildCatalogWorkbook(kind,await collectExportRows(read));
}
/** Caller must install fresh principal and products.read middleware before this handler. */
export function catalogExportHandler(db:Query,kind:CatalogExportKind):RequestHandler{
 return async(req,res)=>{
  try{
   const bytes=await exportCatalog(db,kind,req.query);
   res.setHeader('Cache-Control','no-store');
   res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
   res.setHeader('Content-Disposition','attachment; filename="'+kind+'.xlsx"');
   res.send(Buffer.from(bytes));
  }catch(error){
   const status=error&&typeof error==='object'&&'status' in error?Number(error.status):503;
   res.status(status===400?400:status===409?409:503).json({error:status===400?'筛选条件无效':status===409?'资料已变化或超出Excel容量，请重试':'资料导出暂不可用'});
  }
 };
}
