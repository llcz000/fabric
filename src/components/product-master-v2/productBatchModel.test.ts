import assert from 'node:assert/strict';
import test from 'node:test';
import {loadBatchMasterVersions,previewProductBatch,saveProductBatch,toggleBatchVersion} from './productBatchModel';
import type {ProductPatternChoice} from './productEditorModel';
import type {FabricCatalogItem} from './fabricModel';
const version=(id:string,no:string):ProductPatternChoice=>({id,masterId:'11',colorwayNo:1,patternNo:no,patternImageAssetId:null,remark:'',isActive:true,colorTags:[],topicTags:[]});
const fabric={id:'21',fabricNo:'10151-8',fabricName:'底布',composition:null,weightValue:100,weightUnit:'gsm',widthValue:145,remark:null,isActive:true,productCount:0} as FabricCatalogItem;
test('master-to-products loads full active colorway set, not current catalogue page',async()=>{
 const all=Array.from({length:23},(_,i)=>({...version(String(i+11),'G0008-'+(i+1)),masterNo:'G0008',colorwayNo:i+1,isActive:i!==3}));
 const api=(async(url:RequestInfo|URL)=>{assert.equal(url,'/api/v2/pattern-masters/11/colorway-details');return new Response(JSON.stringify({items:all,nextColorwayNo:24}),{status:200});}) as typeof fetch;
 const loaded=await loadBatchMasterVersions(api,'11');
 assert.equal(loaded.length,22);assert(!loaded.some(v=>v.colorwayNo===4));assert.equal(loaded[0].patternNo,'G0008-1');
});
test('bulk selection spans masters and preserves choices across searches',()=>{
 const a=version('12','G0008-1'),b=version('13','G0008-2'),c=version('14','G0153-2');
 let selected:ProductPatternChoice[]=[];
 for(const v of [a,b,c])selected=toggleBatchVersion(selected,v);
 assert.deepEqual(selected.map(v=>v.id),['12','13','14']);
 assert.deepEqual(toggleBatchVersion(selected,b).map(v=>v.id),['12','14']);
 assert.throws(()=>toggleBatchVersion(Array.from({length:20},(_,i)=>version(String(i+1),'G0008-1')),version('99','G0777-1')),/20/);
});
test('batch preview uses exact 1-fabric multiple-colorways and marks existing rows',async()=>{
 let seen:any;
 const fake=async(url:RequestInfo|URL,opts?:RequestInit)=>{seen={url:String(url),method:opts?.method,body:JSON.parse(String(opts?.body))};
  return new Response(JSON.stringify({items:[{patternColorwayId:'12',productNo:'G0008-1-10151-8',existing:false},
   {patternColorwayId:'13',productNo:'G0008-2-10151-8',existing:true,id:'7'}]}),{status:200});
 };
 const selected=[version('12','G0008-1'),version('13','G0008-2')];
 const result=await previewProductBatch(fake as typeof fetch,selected,fabric);
 assert.equal(result[1].existing,true);
 assert.deepEqual(seen,{url:'/api/v2/products/batch/preview',method:'POST',body:{colorwayIds:['12','13'],fabricId:'21'}});
});
test('batch submit never sends any image IDs and reports skipped combinations',async()=>{
 const fake=async(_url:RequestInfo|URL,opts?:RequestInit)=>{
  assert.deepEqual(JSON.parse(String(opts?.body)),{colorwayIds:['12'],fabricId:'21'});
  return new Response(JSON.stringify({created:[],skipped:[{patternColorwayId:'12',productNo:'G0008-1-10151-8',id:'7'}]}),{status:201});
 };
 const result=await saveProductBatch(fake as typeof fetch,[version('12','G0008-1')],fabric);
 assert.equal(result.skipped.length,1);
});
test('empty selection, inactive fabric and inconsistent responses are rejected',async()=>{
 const fake=async()=>new Response(JSON.stringify({items:[]}),{status:200});
 await assert.rejects(previewProductBatch(fake as typeof fetch,[],fabric),/请选择/);
 await assert.rejects(previewProductBatch(fake as typeof fetch,[version('12','G0008-1')],{...fabric,isActive:false}),/启用/);
 await assert.rejects(previewProductBatch(fake as typeof fetch,[version('12','G0008-1')],fabric),/不一致/);
});
