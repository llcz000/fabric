import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {
 buildCatalogUrl,reduceCatalogFilters,emptyCatalogFilters,parseCatalogPage,
 loadCatalogTags,fetchCatalogPage,createLatestRequestGuard,resolveImageUrls
} from './catalogModel';
import {CatalogV2Table,ProductCatalogV2,CatalogDeleteConfirmation} from './ProductCatalogV2';
import type {CatalogProduct} from './catalogModel';

const fake:CatalogProduct={
 id:'53',productNo:'G017-2-F018',patternColorwayId:'3',fabricId:'8',masterId:'7',
 masterNo:'G017',colorwayNo:2,fabricNo:'F018',fabricName:'轻柔雪纺',
 composition:'100% 真丝',weightValue:16.5,weightUnit:'mm',widthCm:145,
 remark:'这是一条很长的产品专属备注，必须可完整阅读',isActive:true,isAvailableForSampling:true,
 masterActive:true,colorwayActive:true,fabricActive:true,isSelectable:true,
 rowVersion:'1',patternImageAssetId:'a1111111-1111-4111-8111-111111111111',
 topicTags:[{id:'1',name:'花卉',isArchived:false}],
 colorTags:[{id:'9',name:'蓝色',isArchived:false}],
 imageCounts:{fabricDisplay:2,detail:1,aiEffect:3},totalImages:6
};
test('AC-97 standalone sampling availability shows in existing status cell, within the simplified ten-column list',()=>{
 const noSamples={...fake,isAvailableForSampling:false,isSelectable:true,isActive:true};
 const html=renderToStaticMarkup(React.createElement(CatalogV2Table,{page:{items:[noSamples],total:1,limit:50,offset:0},patternUrls:new Map(),onPatternPreview:()=>{},onProductImages:()=>{},onPage:()=>{}}));
 assert(html.includes('暂不供样'));assert(html.includes('已启用'));
 assert.equal((html.match(/<th /g)||[]).length,10);
 assert.throws(()=>parseCatalogPage({items:[{...fake,isAvailableForSampling:'false'}],total:1,limit:50,offset:0}));
});
test('P4-4 V2 filters keep two AND text inputs and reset only changed dimension/page',()=>{
 const start={...emptyCatalogFilters,productNo:'  g017  ',fabricName:' 雪纺 ',offset:100};
 const next=reduceCatalogFilters(start,{type:'productNo',value:'G018'});
 assert.equal(next.productNo,'G018');assert.equal(next.fabricName,' 雪纺 ');assert.equal(next.offset,0);
 const other=reduceCatalogFilters(next,{type:'topic',id:'1'});
 assert.deepEqual(other.topicTagIds,['1']);
 assert.deepEqual(reduceCatalogFilters(other,{type:'topic',id:'2'}).topicTagIds,['1','2']);
 assert.deepEqual(reduceCatalogFilters(other,{type:'topic',id:'1'}).topicTagIds,[]);
 assert.deepEqual(reduceCatalogFilters(other,{type:'page',offset:50}),{...other,offset:50});
 assert.deepEqual(reduceCatalogFilters(other,{type:'reset'}),emptyCatalogFilters);
});
test('P4-4 at most ten tags per dimension and never drops already selected filters',()=>{
 const selected={...emptyCatalogFilters,topicTagIds:Array.from({length:10},(_,i)=>String(i+1)),offset:50};
 assert.deepEqual(reduceCatalogFilters(selected,{type:'topic',id:'11'}),selected);
 const minus=reduceCatalogFilters(selected,{type:'topic',id:'1'});
 assert.equal(minus.topicTagIds.length,9);assert.equal(minus.offset,0);
});
test('P4-4 build real API list URL: trim, AND, same-dimension OR, status all, stable paging',()=>{
 const q=buildCatalogUrl('/api/v2/products',{
  ...emptyCatalogFilters,productNo:'  g017-2 ',fabricName:' 雪纺 ',
  topicTagIds:['1','2'],colorTagIds:['9'],status:'all',limit:50,offset:50});
 const url=new URL(q,'https://placeholder.invalid');
 assert.equal(url.pathname,'/api/v2/products');
 assert.equal(url.searchParams.get('productNo'),'g017-2');
 assert.equal(url.searchParams.get('fabricName'),'雪纺');
 assert.equal(url.searchParams.get('topicTagIds'),'1,2');
 assert.equal(url.searchParams.get('colorTagIds'),'9');
 assert.equal(url.searchParams.get('status'),'all');
 assert.equal(url.searchParams.get('limit'),'50');
 assert.equal(url.searchParams.get('offset'),'50');
 assert.equal(new URL(buildCatalogUrl('/api/v2/products',emptyCatalogFilters),'https://t.invalid').searchParams.has('productNo'),false);
});
test('P4-4 validates strongly typed catalog page before rendering; never invent missing data',()=>{
 const page=parseCatalogPage({items:[fake],total:2100,limit:50,offset:0});
 assert.equal(page.items[0].patternImageAssetId,fake.patternImageAssetId);
 assert.equal(page.items[0].remark,fake.remark);
 for(const obj of [{items:[fake],total:-1,limit:50,offset:0},
 {items:[{...fake,colorwayNo:'2'}],total:1,limit:50,offset:0},
 {items:[{...fake,topicTags:[{id:'1',name:1,isArchived:false}]}],total:1,limit:50,offset:0},
 {items:[{...fake,totalImages:9}],total:1,limit:50,offset:0},
 {items:[{...fake,id:10}],total:1,limit:50,offset:0}]){
  assert.throws(()=>parseCatalogPage(obj));
 }
});
test('P4-4 catalog client uses injected authenticated fetch; errors preserve HTTP status',async()=>{
 const seen:string[]=[];
 const fetcher=async(url:RequestInfo|URL):Promise<Response>=>{
  seen.push(String(url));return new Response(JSON.stringify({items:[fake],total:1,limit:50,offset:0}),{status:200});
 };
 const result=await fetchCatalogPage(fetcher as typeof fetch,emptyCatalogFilters);
 assert.equal(result.total,1);assert(seen[0].startsWith('/api/v2/products?'));
 await assert.rejects(fetchCatalogPage((async()=>new Response(JSON.stringify({error:'Forbidden'}),{status:403})) as typeof fetch,emptyCatalogFilters),/403/);
});
test('P4-4 latest request wins despite out-of-order resolution; teardown cancels commits',()=>{
 const gate=createLatestRequestGuard();
 const first=gate.next(),second=gate.next();
 assert(!gate.isCurrent(first));assert(gate.isCurrent(second));
 gate.cancel();
 assert(!gate.isCurrent(second));
});
test('P4-4 independent topic/color tag API reads existing dimension not legacy tag names',async()=>{
 const queried:string[]=[];
 const fetcher=(async(url:RequestInfo|URL)=>{
  queried.push(String(url));
  return new Response(JSON.stringify({items:[{id:'1',name:'花卉',dimension:'topic',isArchived:false}]}),{status:200});
 }) as typeof fetch;
 const tags=await loadCatalogTags(fetcher,'topic');
 assert.deepEqual(tags,[{id:'1',name:'花卉',isArchived:false}]);
 assert(queried[0].includes('/api/v2/tags?dimension=topic'));
 await assert.rejects(loadCatalogTags((async()=>new Response('Not Found',{status:404})) as typeof fetch,'color'),/404/);
});
test('P4-4 image access request uses real asset IDs and short-lived signed URLs only',async()=>{
 const ids=['a1111111-1111-4111-8111-111111111111','a2222222-2222-4222-8222-222222222222'];
 let body:any;
 const fetcher=(async(_url:RequestInfo|URL,options?:RequestInit)=>{
  body=JSON.parse(String(options?.body));
  return new Response(JSON.stringify({results:body.requests.map((entry:any)=>({...entry,
   url:'https://signed.invalid/'+entry.assetId,expiresAt:'2030-01-01T00:00:00Z'}))}),{status:200});
 }) as typeof fetch;
 const urls=await resolveImageUrls(fetcher,ids,'thumbnail');
 assert.deepEqual(body.requests,ids.map(assetId=>({assetId,variant:'thumbnail'})));
 assert.equal(urls.get(ids[0]),'https://signed.invalid/'+ids[0]);
 assert.equal((await resolveImageUrls(fetcher,[],'original')).size,0);
 await assert.rejects(resolveImageUrls(fetcher,['not-valid'],'original'));
});
test('P4-4 product table has exactly 10 columns with product-owned remark, name and specs',()=>{
 const html=renderToStaticMarkup(React.createElement(CatalogV2Table,{
  page:{items:[fake,{...fake,id:'54',patternImageAssetId:null,remark:'',weightValue:null,
   weightUnit:null,widthCm:null,composition:null}],total:2,limit:50,offset:0},
  patternUrls:new Map([[fake.patternImageAssetId!,'https://signed.invalid/thumb']]),
  onPatternPreview:()=>{},onProductImages:()=>{},onRemark:()=>{},onPage:()=>{},canManage:true,onEdit:()=>{}
 }));
 const headers=Array.from(html.matchAll(/<th\b[^>]*>([^<]+)/g)).map(x=>x[1]);
 assert.deepEqual(headers,['花型图','货号','品名','成分','克重','门幅 / cm',
  '图片数量','备注','启用状态','操作']);
 assert(html.includes('100% 真丝')&&html.includes('16.5 mm')&&html.includes('145'));
 assert(html.includes('G017-2-F018')&&html.includes('轻柔雪纺'));
 assert(html.includes('aria-label="查看完整备注 G017-2-F018"'));
 assert(html.includes('待上传')&&!html.includes('缺少花型原图'));
 assert(html.includes('aria-label="查看花型原图 G017-2-F018"'));
 assert.equal((html.match(/aria-label="查看花型原图/g)||[]).length,1);
 assert(html.includes('大图 2 · 细节 1 · 效果 3'));
 assert(!html.includes('审核')&&!html.includes('待完善'));
 assert(html.includes('title="这是一条很长的产品专属备注'));
});
test('P4-4 delete request requires explicit confirmation and displays complete productNo',()=>{
 const markup=renderToStaticMarkup(React.createElement(CatalogDeleteConfirmation,{
  product:fake,onCancel:()=>{},onConfirm:()=>{}
 }));
 assert(markup.includes('G017-2-F018'));
 assert(markup.includes('删除仅移除该产品及图片关联'));
 assert(markup.includes('确认删除')&&markup.includes('取消'));
 assert(markup.includes('role="alertdialog"'));
});
test('P4-4 isolated React page: filters two inputs, status, no tag filters, loading/empty/actions',()=>{
 const html=renderToStaticMarkup(React.createElement(ProductCatalogV2,{apiFetch:fetch,
  onCreate:()=>{},onEdit:()=>{},canManage:true}));
 assert(html.includes('aria-label="货号"')&&html.includes('aria-label="品名"'));
 assert(!html.includes('aria-label="题材标签"')&&!html.includes('aria-label="颜色标签"'));
 assert(html.includes('包含停用')&&html.includes('清空筛选'));
 assert(html.includes('产品库')&&html.includes('新增产品'));assert(html.includes('导出筛选结果'));
 assert(!html.includes('审核状态')&&!html.includes('克重筛选'));
 const readOnly=renderToStaticMarkup(React.createElement(ProductCatalogV2,{apiFetch:fetch,canManage:false}));
 assert(!readOnly.includes('新增产品')&&!readOnly.includes('删除产品'));
});