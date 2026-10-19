import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {FabricImportV2,FabricImportPreviewTable,FabricWorkspaceV2} from './FabricImportV2';
import {previewFabricImport,commitFabricImport,parseFabricImportPreview,validateSelectedRows,formatFabricImportStatus} from './fabricImportModel';
const preview={
 token:'a'.repeat(64),expiresInSeconds:900,sheetName:'面料资料',headerRow:1,
 mapping:{fabricNo:1,fabricName:2},counts:{create:1,skip:1,error:1},
 rows:[
  {rowNumber:2,action:'create',reason:'可以新增',fabric:{
   fabricNo:'F010',fabricName:'真丝',composition:'丝',weightValue:16.5,weightUnit:'mm',widthValue:145,remark:null},fabricNoHint:'F010'},
  {rowNumber:3,action:'skip',reason:'重复品号默认跳过',fabric:{
   fabricNo:'F011',fabricName:'雪纺',composition:null,weightValue:null,weightUnit:null,widthValue:null,remark:null},
   existing:{id:'9',fabricNo:'F011',fabricName:'旧品名',composition:null,weightValue:null,weightUnit:null,
    widthValue:null,remark:null,isActive:true},
   changes:{fabricName:{from:'旧品名',to:'雪纺'}}},
  {rowNumber:4,action:'error',reason:'克重单位缺失',fabric:null,fabricNoHint:'F012'}
 ]
};
test('P5 result statuses use concise Chinese labels instead of raw API codes',()=>{
 assert.deepEqual(['created','updated','skipped','failed'].map(x=>formatFabricImportStatus(x as 'created'|'updated'|'skipped'|'failed')),
  ['新增','更新','跳过','失败']);
});
test('P5 UI validates server preview and only allows selected existing skip rows for updates',()=>{
 const parsed=parseFabricImportPreview(preview);
 assert.equal(parsed.rows.length,3);
 assert.deepEqual(validateSelectedRows(parsed,[3],true),[3]);
 assert.throws(()=>validateSelectedRows(parsed,[3],false),/管理员/);
 assert.throws(()=>validateSelectedRows(parsed,[2],true),/更新/);
 assert.throws(()=>validateSelectedRows(parsed,[3,3],true),/重复/);
 assert.throws(()=>parseFabricImportPreview({...preview,token:'fake'}),/预览/);
});
test('P5 UI preview/commit use same isolated paths and never client-supplied record payload',async()=>{
 const log:{url:string;body:any}[]=[];
 const fetcher=(async(url:RequestInfo|URL,request?:RequestInit)=>{
  log.push({url:String(url),body:JSON.parse(String(request?.body))});
  return new Response(JSON.stringify(log.length===1?preview:{
   counts:{created:1,updated:1,skipped:0,failed:1},
   rows:[{rowNumber:2,status:'created',reason:'成功',fabricNo:'F010'},
    {rowNumber:3,status:'updated',reason:'成功',fabricNo:'F011'},
    {rowNumber:4,status:'failed',reason:'单位',fabricNo:'F012'}]
  }),{status:200});
 }) as typeof fetch;
 await previewFabricImport(fetcher,'AQID',{filename:'test.xlsx'});
 await commitFabricImport(fetcher,preview.token,[3]);
 assert.deepEqual(log.map(x=>x.url),['/api/v2/fabrics/import/preview','/api/v2/fabrics/import/commit']);
 assert.deepEqual(log[1].body,{token:preview.token,confirm:true,updateRows:[3]});
 assert(!('fabricNo' in log[1].body)&&!('rows' in log[1].body));
});
test('P5 UI eight preview columns, real row numbers, status and admin explicit update toggles',()=>{
 const html=renderToStaticMarkup(React.createElement(FabricImportPreviewTable,{
  preview:parseFabricImportPreview(preview),isAdmin:true,selected:[3],
  onToggle:()=>{},filter:'all'
 }));
 const headers=Array.from(html.matchAll(/<th\b[^>]*>([^<]+)/g)).map(x=>x[1]);
 assert.deepEqual(headers,['Excel行','品号','品名','成分','克重','门幅 / cm','处理','原因／确认']);
 assert(html.includes('F010')&&html.includes('F011')&&html.includes('F012'));
 assert(html.includes('更新')&&html.includes('克重单位缺失'));
 assert(html.includes('type="checkbox"'));
 const readOnly=renderToStaticMarkup(React.createElement(FabricImportPreviewTable,{
  preview:parseFabricImportPreview(preview),isAdmin:false,selected:[],
  onToggle:()=>{},filter:'all'
 }));
 assert(!readOnly.includes('type="checkbox"'));
});
test('P5 Stitch-density table keeps eight visible columns, compact rows and accessible horizontal scroll',()=>{
 const html=renderToStaticMarkup(React.createElement(FabricImportPreviewTable,{
  preview:parseFabricImportPreview(preview),isAdmin:true,selected:[],
  onToggle:()=>{},filter:'all'
 }));
 assert(html.includes('aria-label="面料导入预览横向滚动表格"'));
 assert(html.includes('tabindex="0"'),'horizontal table must be keyboard reachable');
 assert(html.includes('overscroll-x-contain'),'mobile scroll should stay inside table');
 assert(html.includes('px-2 py-2'),'Stitch compact header padding');
 assert(html.includes('px-2 py-1.5'),'Stitch compact row padding');
 assert(html.includes('py-0.5'),'compact status badge');
});
test('P5 UI unconnected preview is inert until real .xlsx file and previous stage confirmed',()=>{
 const html=renderToStaticMarkup(React.createElement(FabricImportV2,{
  apiFetch:fetch,canManage:true,isAdmin:false,onCancel:()=>{}
 }));
 assert(html.includes('从Excel导入面料')&&html.includes('.xlsx'));
 assert(html.includes('工作表')&&html.includes('表头行')&&html.includes('克重缺省单位'));
 assert(html.includes('生成预览'));
 assert(!html.includes('确认导入'),'cannot confirm before a valid server preview exists');
 assert(!html.includes('覆盖已有'));
 const readonly=renderToStaticMarkup(React.createElement(FabricImportV2,{
  apiFetch:fetch,canManage:false,isAdmin:false,onCancel:()=>{}
 }));
 assert(!readonly.includes('确认导入'));
 const workspace=renderToStaticMarkup(React.createElement(FabricWorkspaceV2,{
  apiFetch:fetch,canManage:true,isAdmin:false
 }));
 assert(workspace.includes('面料库')&&workspace.includes('从Excel导入'));
});
