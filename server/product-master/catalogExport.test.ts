import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import express from 'express';
import {collectExportRows,exportCatalog} from './catalogExport';
import {buildCatalogWorkbook,catalogExportHeaders} from './catalogExportWorkbook';
import {createV2ProductsRouter} from './productsV2Routes';
import {createFabricRouter} from './fabricsRoutes';
import {createPatternMasterRouter} from './patternMastersRoutes';
import {hashSessionToken} from '../access/password';
import {buildCatalogExportUrl} from '../../src/components/product-master-v2/CatalogExportButton';
const fabric={id:'1',fabricNo:'0012',fabricName:'=文字品名',composition:null,weightValue:16.5,weightUnit:'mm',widthValue:null,remark:'',isActive:true,productCount:3};
async function read(bytes:Uint8Array){const book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.from(bytes));return book;}
test('EX-01 metadata export follows all pages, rejects changed totals, duplicate or incomplete pages',async()=>{
 const offsets:number[]=[];
 const rows=await collectExportRows(async offset=>{offsets.push(offset);return {items:Array.from({length:Math.min(100,205-offset)},(_,i)=>({...fabric,id:String(offset+i+1)})) as never,total:205,limit:100,offset};});
 assert.equal(rows.length,205);assert.deepEqual(offsets,[0,100,200]);
 await assert.rejects(collectExportRows(async offset=>({items:[fabric] as never,total:offset?3:2,offset,limit:1})),/变化/);
 await assert.rejects(collectExportRows(async offset=>({items:[fabric] as never,total:2,offset,limit:1})),/变化/);
 await assert.rejects(collectExportRows(async offset=>({items:[],total:2,offset,limit:100})),/变化/);
});
test('EX-01/02 XLSX uses current visible data fields, literal strings, nulls/units; never media/IDs/URLs',async()=>{
 const f={...fabric,objectKey:'PRIVATE_OBJECT_KEY',signedUrl:'https://private.invalid/sign',patternImageAssetId:'PRIVATE_ASSET'};
 const book=await read(await buildCatalogWorkbook('fabrics',[f as never]));const sheet=book.worksheets[0];
 assert.deepEqual(sheet.getRow(1).values,[,...catalogExportHeaders.fabrics]);
 assert.equal(sheet.getCell('A2').value,'0012');assert.equal(sheet.getCell('B2').value,'=文字品名');assert.equal(sheet.getCell('B2').type,ExcelJS.ValueType.String);
 assert.equal(sheet.getCell('D2').value,'16.5 mm');assert.equal(sheet.getCell('E2').value,'');
 assert(!JSON.stringify(sheet.getSheetValues()).includes('PRIVATE'));assert.equal(book.model.media?.length??0,0);
 const pattern={id:'7',masterNo:'G0179',isActive:true,topicTags:[{name:'花卉'}],colorTags:[{name:'蓝色'}],versions:[{patternNo:'G0179-2',isActive:true,patternImageAssetId:'PRIVATE'}]};
 const p=(await read(await buildCatalogWorkbook('patterns',[pattern as never]))).worksheets[0];
 assert.deepEqual(p.getRow(1).values,[,...catalogExportHeaders.patterns]);assert.equal(p.getCell('D2').value,'G0179-2');
 const product={productNo:'G0179-2-0012',fabricName:'当前品名',composition:'棉',weightValue:null,weightUnit:null,widthCm:145,imageCounts:{fabricDisplay:1,detail:2,aiEffect:0},remark:'备注',isActive:true,isAvailableForSampling:false};
 const pr=(await read(await buildCatalogWorkbook('products',[product as never]))).worksheets[0];
 assert.deepEqual(pr.getRow(1).values,[,...catalogExportHeaders.products]);assert.equal(pr.getCell('A2').value,'G0179-2-0012');assert.equal(pr.getCell('H2').value,'已启用 / 暂不供样');
});
test('EX export client preserves current conditions and removes page-only parameters',()=>{
 assert.equal(buildCatalogExportUrl('/api/v2/products?productNo=G017&fabricName=%E4%B8%9D&offset=50&limit=50&status=all'),'/api/v2/products/export.xlsx?productNo=G017&fabricName=%E4%B8%9D&status=all');
 assert.throws(()=>buildCatalogExportUrl('/api/old/products'));
});
test('EX all three real HTTP routes require current login, accept both roles, reject unknown filters without storage writes',async()=>{
 let role='sales',active=true;const queries:string[]=[];
 const db={async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>{
  if(sql.includes('JOIN v2_access_users'))return [active&&params[0]===hashSessionToken('a'.repeat(64))?[{user_id:'1',session_id:'2',username:'u',display_name:'U',role,can_manage_own_orders:0,can_manage_products:0}]:[],[]];
  queries.push(sql);return [sql.includes('COUNT(')?[{total:0}]:[],[]];
 }};
 const pool={getConnection:async()=>{throw Error('Export must not mutate');}};
 const app=express();app.use('/api/v2',createPatternMasterRouter(db,pool as never),createFabricRouter(db,pool as never),createV2ProductsRouter(db,pool as never));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.on('listening',resolve));
 try{
  const address=server.address();assert(address&&typeof address!=='string');const base='http://127.0.0.1:'+address.port+'/api/v2';
  for(const path of ['/pattern-catalog/export.xlsx','/fabrics/catalog/export.xlsx','/products/export.xlsx']){
   assert.equal((await fetch(base+path)).status,401);
   for(role of ['sales','admin']){
    const response=await fetch(base+path,{headers:{authorization:'Bearer '+'a'.repeat(64)}});assert.equal(response.status,200);
    assert.equal(response.headers.get('cache-control'),'no-store');const sheet=(await read(new Uint8Array(await response.arrayBuffer()))).worksheets[0];assert.equal(sheet.rowCount,1);
    assert.equal((await fetch(base+path+'?secret=1',{headers:{authorization:'Bearer '+'a'.repeat(64)}})).status,400);
   }
  }
  active=false;const count=queries.length;assert.equal((await fetch(base+'/products/export.xlsx',{headers:{authorization:'Bearer '+'a'.repeat(64)}})).status,401);assert.equal(queries.length,count);
  await assert.rejects(exportCatalog(db,'products',{owner:'1'}));
 }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
