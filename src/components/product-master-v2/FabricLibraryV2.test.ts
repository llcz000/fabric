import assert from 'node:assert/strict';
import {emptyFabricDraft} from './fabricModel';
import test from 'node:test';
test('new fabric weight defaults to gsm without requiring a weight or rewriting saved mm/null',()=>{
 assert.equal(emptyFabricDraft.weightUnit,'gsm');
 const blank=validateFabricDraft({...emptyFabricDraft,fabricNo:'FNEW',fabricName:'新面料'},'create');
 assert.equal(blank.weightValue,null);assert.equal(blank.weightUnit,null);
 const weighted=validateFabricDraft({...emptyFabricDraft,fabricNo:'FNEW',fabricName:'新面料',weightValue:'120'},'create');
 assert.equal(weighted.weightValue,120);assert.equal(weighted.weightUnit,'gsm');
 assert.equal(fabricToDraft(silk).weightUnit,'mm');
 assert.equal(fabricToDraft(empty).weightUnit,'');
});
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {
 emptyFabricFilters,reduceFabricFilters,buildFabricCatalogUrl,parseFabricCatalogPage,
 fabricToDraft,validateFabricDraft,fetchFabricCatalog,createFabric,updateFabric,deleteFabric,
 FabricHttpError
} from './fabricModel';
import {FabricLibraryV2,FabricV2Table,FabricV2InlineDraft,ConfirmFabricDelete} from './FabricLibraryV2';
import type {FabricCatalogItem} from './fabricModel';
const silk:FabricCatalogItem={
 id:'1',fabricNo:'F018',fabricName:'丝质雪纺',composition:'100%真丝',
 weightValue:16.5,weightUnit:'mm',widthValue:145.5,
 remark:'可用于高档礼服',isActive:true,productCount:3
};
const empty:FabricCatalogItem={
 id:'2',fabricNo:'F019',fabricName:'棉麻',composition:null,
 weightValue:null,weightUnit:null,widthValue:null,remark:null,isActive:true,productCount:0
};
test('P4-3 independent keyword filters number/name/composition, includeInactive, resets page',()=>{
 const start={...emptyFabricFilters,query:' 真丝 ',offset:100,includeInactive:true};
 const changed=reduceFabricFilters(start,{type:'query',value:'雪纺'});
 assert.equal(changed.query,'雪纺');assert(changed.includeInactive);assert.equal(changed.offset,0);
 assert.deepEqual(reduceFabricFilters(changed,{type:'page',offset:50}),{...changed,offset:50});
 assert.deepEqual(reduceFabricFilters(changed,{type:'reset'}),emptyFabricFilters);
 const url=new URL(buildFabricCatalogUrl({...start,limit:25}),'https://test.invalid');
 assert.equal(url.pathname,'/api/v2/fabrics/catalog');
 assert.equal(url.searchParams.get('query'),'真丝');
 assert.equal(url.searchParams.get('includeInactive'),'true');
 assert.equal(url.searchParams.get('limit'),'25');
 assert.equal(url.searchParams.get('offset'),'100');
 assert(!buildFabricCatalogUrl(emptyFabricFilters).includes('weightUnit'));
});
test('P4-3 strict rows reject fake widths, unsafe identity, fabricated counts, non-number weight',()=>{
 const page=parseFabricCatalogPage({items:[silk,empty],total:2000,limit:50,offset:0});
 assert.equal(page.items[0].productCount,3);
 for(const bad of [
  {items:[{...silk,id:9007199254740992}],total:1,limit:50,offset:0},
  {items:[{...silk,productCount:-1}],total:1,limit:50,offset:0},
  {items:[{...silk,weightUnit:'oz'}],total:1,limit:50,offset:0},
  {items:[{...silk,weightValue:'16.5'}],total:1,limit:50,offset:0},
  {items:[{...silk,weightValue:null}],total:1,limit:50,offset:0},
  {items:[{...silk,widthValue:0}],total:1,limit:50,offset:0},
  {items:[silk],total:-1,limit:50,offset:0}
 ])assert.throws(()=>parseFabricCatalogPage(bad));
});
test('P4-3 initialize edit draft from actual fabric values, never coerce missing to zero',()=>{
 const result=fabricToDraft(empty);
 assert.equal(result.weightValue,'');assert.equal(result.weightUnit,'');
 assert.equal(result.widthValue,'');assert.equal(result.composition,'');
 const silkDraft=fabricToDraft(silk);
 assert.equal(silkDraft.weightValue,'16.5');
 assert.equal(silkDraft.weightUnit,'mm');
 assert.equal(silkDraft.widthValue,'145.5');
});
test('P4-3 valid payload keeps gsm/mm separate, optional nulls and no extra fields',()=>{
 const blank=validateFabricDraft({...fabricToDraft(empty),fabricNo:' f020 ',fabricName:' 贡缎 '},'create');
 assert.deepEqual(blank,{
  fabricNo:'F020',fabricName:'贡缎',composition:null,weightValue:null,weightUnit:null,
  widthValue:null,remark:null
 });
 const weight=validateFabricDraft({...fabricToDraft(silk),weightValue:' 88.125 ',weightUnit:'gsm',
  widthValue:'152.50'},'update');
 assert.equal(weight.weightValue,88.125);assert.equal(weight.weightUnit,'gsm');assert.equal(weight.widthValue,152.5);
 assert.equal(weight.fabricNo,'F018');assert.equal(weight.isActive,true);
});
test('P4-3 rejects invalid fabric No/name, half-empty weight, nonpositive or excessive precision',()=>{
 const good=fabricToDraft(silk);
 for(const bad of ([
  {...good,fabricNo:'A-2'}, {...good,fabricNo:''},{...good,fabricName:'  '},
  {...good,weightValue:'',weightUnit:'mm'},
  {...good,weightValue:'88',weightUnit:''},
  {...good,weightValue:'0'},
  {...good,weightValue:'-16'},
  {...good,weightValue:'1.1234'},
  {...good,widthValue:'0'},
  {...good,widthValue:'145.123'},
  {...good,widthValue:'not number'},
  {...good,composition:'x'.repeat(501)}
 ] as ReturnType<typeof fabricToDraft>[]))assert.throws(()=>validateFabricDraft(bad,'update'));
});
test('P4-3 injected V2 fetch handles 201/200 and 409; backend still owns references/uniqueness',async()=>{
 const calls:{url:string;method:string;body:any}[]=[];
 const fetcher=(async(url:RequestInfo|URL,init?:RequestInit)=>{
  calls.push({url:String(url),method:init?.method??'GET',body:init?.body?JSON.parse(String(init.body)):null});
  if(init?.method==='POST')return new Response(JSON.stringify({...empty,id:'9',fabricNo:'F020'}),{status:201});
  if(init?.method==='DELETE')return new Response(JSON.stringify({id:'1',deleted:true}),{status:200});
  if(init?.method==='PATCH')return new Response(JSON.stringify({...silk,fabricName:'新丝绸'}),{status:200});
  return new Response(JSON.stringify({items:[silk],total:1,limit:50,offset:0}),{status:200});
 }) as typeof fetch;
 assert.equal((await fetchFabricCatalog(fetcher,emptyFabricFilters)).total,1);
 await createFabric(fetcher,validateFabricDraft({...fabricToDraft(empty),fabricNo:'F020'},'create'));
 await updateFabric(fetcher,'1',validateFabricDraft({...fabricToDraft(silk),fabricName:'新丝绸'},'update'));
 await deleteFabric(fetcher,'1');
 assert.deepEqual(calls.map(x=>x.method),['GET','POST','PATCH','DELETE']);
 assert.equal(calls[1].body.isActive,undefined);
 assert.equal(calls[2].body.fabricName,'新丝绸');
 const conflict=(async()=>new Response(JSON.stringify({error:'Fabric is referenced; deactivate instead'}),{status:409})) as typeof fetch;
 await assert.rejects(deleteFabric(conflict,'1'),(e:unknown)=>e instanceof FabricHttpError&&e.status===409);
});
test('P4-3 table matches nine Stitch columns, explicit 3 referenced, optional blanks, no fake audit flags',()=>{
 const html=renderToStaticMarkup(React.createElement(FabricV2Table,{
  page:{items:[silk,empty],total:2,limit:50,offset:0},
  onPage:()=>{},onEdit:()=>{},onDelete:()=>{},canManage:true
 }));
 const headers=Array.from(html.matchAll(/<th\b[^>]*>([^<]+)/g)).map(x=>x[1]);
 assert.deepEqual(headers,['品号','品名','成分','克重','门幅 / cm','备注','启用状态','关联产品','操作']);
 assert(html.includes('F018')&&html.includes('丝质雪纺'));
 assert(html.includes('16.5 mm')&&html.includes('145.5'));
 assert(html.includes('title="可用于高档礼服"'));
 assert(html.includes('已关联 3'));
 assert(html.includes('—'));
 assert(!html.includes('待完善')&&!html.includes('审核状态'));
 assert(html.includes('编辑')&&html.includes('删除'));
});
test('P4-3 referenced inline edit locks only fabricNo while name/weight remain editable',()=>{
 const locked=renderToStaticMarkup(React.createElement(FabricV2InlineDraft,{
  original:silk,mode:'update',onCancel:()=>{},onSave:async()=>{},busy:false
 }));
 assert(locked.includes('品号已被产品引用'));
 assert(locked.includes('readonly=""')||locked.includes('readOnly=""'));
 assert(locked.includes('aria-label="品名"')&&locked.includes('aria-label="克重单位"'));
 assert(locked.includes('保存')&&locked.includes('取消'));
 const available=renderToStaticMarkup(React.createElement(FabricV2InlineDraft,{
  original:empty,mode:'update',onCancel:()=>{},onSave:async()=>{},busy:false
 }));
 assert(!available.includes('品号已被产品引用'));
});
test('P4-3 create inline row has blank values, save/cancel, all specs optional',()=>{
 const html=renderToStaticMarkup(React.createElement(FabricV2InlineDraft,{
  original:null,mode:'create',onCancel:()=>{},onSave:async()=>{},busy:false
 }));
 assert(html.includes('aria-label="品号"'));
 assert(html.includes('aria-label="成分"'));
 assert(html.includes('aria-label="克重数值"'));
 assert(html.includes('aria-label="门幅"'));
 assert(html.includes('aria-label="备注"'));
 assert(html.includes('保存')&&html.includes('取消'));
});
test('P4-3 deletion warning includes full number, refs server-locked and cancellation',()=>{
 const html=renderToStaticMarkup(React.createElement(ConfirmFabricDelete,{
  item:silk,onCancel:()=>{},onConfirm:()=>{}
 }));
 assert(html.includes('F018')&&html.includes('3'));
 assert(html.includes('可停用'));
 assert(html.includes('确认删除')&&html.includes('取消')&&html.includes('role="alertdialog"'));
});
test('fabric page restricts mutators by permission and has three independent search inputs',()=>{
 const readOnly=renderToStaticMarkup(React.createElement(FabricLibraryV2,{apiFetch:fetch,canManage:false}));
 assert(readOnly.includes('面料库'));
 for(const label of ['搜索品号','搜索品名','搜索成分'])assert(readOnly.includes('aria-label="'+label+'"'));
 assert(readOnly.includes('包含停用'));
 assert(!readOnly.includes('新增面料'));
 const manage=renderToStaticMarkup(React.createElement(FabricLibraryV2,{apiFetch:fetch,canManage:true}));
 assert(manage.includes('新增面料'));
 assert(!manage.includes('克重筛选')&&!manage.includes('门幅筛选'));
});
