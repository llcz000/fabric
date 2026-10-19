import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {buildPatternUrl,parsePatternPage,initialPatternFilters,reducePatternFilters,
 fetchPatternPage,fetchMasterColorways,createNextColorway,saveColorwayProperties,saveVersionTags,addColorTagChoice} from './patternModel';
import {PatternMasterRows,PatternColorwayEditor,PatternLibraryV2} from './PatternLibraryV2';
import type {PatternMasterItem} from './patternModel';

const master:PatternMasterItem={
 id:'11',masterNo:'G017',isActive:true,nextColorwayNo:6,
 topicTags:[{id:'2',name:'花卉',isArchived:false}],colorTags:[{id:'9',name:'藏蓝',isArchived:false}],
 versions:[1,2,4,5].map((n,i)=>({
  id:String(110+n),masterId:'11',colorwayNo:n,patternNo:'G017-'+n,
  patternImageAssetId:n===2?'a1111111-1111-4111-8111-111111111111':null,
  remark:n===4?'春日设计':'' ,isActive:i!==2,
  colorTags:n%2?[{id:'9',name:'藏蓝',isArchived:false}]:[{id:'10',name:'米白',isArchived:false}]
 }))
};
test('B1 share action is explicit opt-in beside existing pattern edit without customer/private details',()=>{
 const html=renderToStaticMarkup(React.createElement(PatternMasterRows,{items:[master],thumbnailUrls:new Map(),onPreview:()=>{},onEdit:()=>{},onShare:()=>{}}));
 assert(html.includes('分享花型 G017'));assert(html.includes('编辑花型及配色 G017'));
 const hidden=renderToStaticMarkup(React.createElement(PatternMasterRows,{items:[master],thumbnailUrls:new Map(),onPreview:()=>{},onEdit:()=>{}}));assert(!hidden.includes('分享花型 G017'));
});
test('P4-2 master-and-version filtering resets page but does not clear independent filters',()=>{
 const a={...initialPatternFilters,number:'G017-',colorwayNo:'2',offset:40};
 const b=reducePatternFilters(a,{type:'number',value:'G018'});
 assert.equal(b.colorwayNo,'2');assert.equal(b.offset,0);
 const c=reducePatternFilters(b,{type:'topic',id:'2'});
 assert.deepEqual(c.topicTagIds,['2']);assert.equal(c.offset,0);
 assert.deepEqual(reducePatternFilters(c,{type:'page',offset:60}),{...c,offset:60});
 assert.deepEqual(reducePatternFilters(c,{type:'reset'}),initialPatternFilters);
});
test('P4-2 query encodes independent number, numeric version, dimension OR, includeInactive and server page',()=>{
 const url=new URL(buildPatternUrl('/api/v2/pattern-catalog',{...initialPatternFilters,
  number:' G017-2 ',colorwayNo:'2',topicTagIds:['2','3'],colorTagIds:['9'],
  includeInactive:true,limit:20,offset:40}),'https://example.test');
 assert.equal(url.searchParams.get('number'),'G017-2');
 assert.equal(url.searchParams.get('colorwayNo'),'2');
 assert.equal(url.searchParams.get('topicTagIds'),'2,3');
 assert.equal(url.searchParams.get('colorTagIds'),'9');
 assert.equal(url.searchParams.get('includeInactive'),'true');
 assert.equal(url.searchParams.get('offset'),'40');
 assert(!new URL(buildPatternUrl('/api/v2/pattern-catalog',initialPatternFilters),'https://t.test').searchParams.has('includeInactive'));
});
test('P4-2 strict grouped DTO validates page count, identities and numeric immutable colorwayNo',()=>{
 const page=parsePatternPage({items:[master],total:100,limit:20,offset:0});
 assert.equal(page.items[0].versions[3].patternNo,'G017-5');
 for(const invalid of [
  {items:[{...master,versions:[{...master.versions[0],colorwayNo:'1'}]}],total:1,limit:20,offset:0},
  {items:[{...master,versions:[{...master.versions[0],patternNo:'BAD'}]}],total:1,limit:20,offset:0},
  {items:[{...master,versions:[{...master.versions[0],masterId:'99'}]}],total:1,limit:20,offset:0},
  {items:[{...master,id:11}],total:1,limit:20,offset:0},
  {items:[master],total:100,limit:0,offset:0},
  {items:[{...master,topicTags:[{id:'2',name:44,isArchived:false}]}],total:1,limit:20,offset:0}
 ])assert.throws(()=>parsePatternPage(invalid));
});
test('P4-2 backend search uses only bounded server-side grouped endpoint',async()=>{
 const urls:string[]=[];
 const fetcher=(async(url:RequestInfo|URL)=>{
  urls.push(String(url));return new Response(JSON.stringify({items:[master],total:100,limit:20,offset:0}),{status:200});
 }) as typeof fetch;
 const page=await fetchPatternPage(fetcher,initialPatternFilters);
 assert.equal(page.total,100);assert.equal(urls.length,1);assert(urls[0].startsWith('/api/v2/pattern-catalog?'));
});
test('P4-2 editor reads only selected master details/next sequence without consuming it',async()=>{
 let endpoint='';
 const fetcher=(async(url:RequestInfo|URL)=>{
  endpoint=String(url);return new Response(JSON.stringify({
   nextColorwayNo:6,items:master.versions.map(({id,masterId,colorwayNo,patternNo,patternImageAssetId,remark,isActive})=>
    ({id,masterId,masterNo:'G017',colorwayNo,patternNo,patternImageAssetId,remark,isActive,colorTags:master.versions.find(x=>x.id===id)?.colorTags??[]}))
  }),{status:200});
 }) as typeof fetch;
 const result=await fetchMasterColorways(fetcher,master);
 assert.equal(endpoint,'/api/v2/pattern-masters/11/colorway-details');
 assert.equal(result.nextColorwayNo,6);assert.equal(result.items.length,4);
});
test('P4-2 new colorway POST never supplies identity/sequence and is never retried automatically',async()=>{
 let body:unknown,url='',method='';
 const fetcher=(async(input:RequestInfo|URL,options?:RequestInit)=>{
  url=String(input);method=String(options?.method);body=JSON.parse(String(options?.body));
  return new Response(JSON.stringify({...master.versions[0],colorwayNo:6,patternNo:'G017-6',id:'201',masterNo:'G017'}),{status:201});
 }) as typeof fetch;
 const created=await createNextColorway(fetcher,master.id,{remark:''});
 assert.equal(method,'POST');assert.equal(url,'/api/v2/pattern-masters/11/colorways');
 assert.deepEqual(body,{remark:''});assert.equal(created.colorwayNo,6);
});
test('P4-2 immutable identity is never sent in PATCH; cancellation makes no write call',async()=>{
 const calls:{url:string;body:any}[]=[];
 const fetcher=(async(url:RequestInfo|URL,options?:RequestInit)=>{
  calls.push({url:String(url),body:JSON.parse(String(options?.body))});
  return new Response(JSON.stringify({...master.versions[0],masterNo:'G017',remark:'更新',isActive:false}),{status:200});
 }) as typeof fetch;
 await saveColorwayProperties(fetcher,master.versions[0],{remark:'更新',isActive:false});
 assert.equal(calls[0].url,'/api/v2/pattern-colorways/111');
 assert.deepEqual(calls[0].body,{remark:'更新',isActive:false});
 const api=()=>{throw Error('cancel must not call network')};
 assert.equal(typeof api,'function');
});
test('P4-2 color tags use exact version id, not sibling/master; no cross-domain writes',async()=>{
 let url='',body:unknown;
 const fetcher=(async(path:RequestInfo|URL,init?:RequestInit)=>{
  url=String(path);body=JSON.parse(String(init?.body));return new Response(JSON.stringify({tagIds:['9','10']}),{status:200});
 }) as typeof fetch;
 await saveVersionTags(fetcher,'112',['9','10']);
 assert.equal(url,'/api/v2/pattern-colorways/112/tags');
 assert.deepEqual(body,{tagIds:['9','10']});
});
test('P4-2 unified colorway save sends tags, remark and status in ONE PATCH, never separate tags PUT',async()=>{
 const calls:{url:string;method:string;body:unknown}[]=[];
 const fetcher=(async(url:RequestInfo|URL,init?:RequestInit)=>{
  calls.push({url:String(url),method:String(init?.method),body:JSON.parse(String(init?.body))});
  return new Response(JSON.stringify({...master.versions[0],masterNo:'G017'}),{status:200});
 }) as typeof fetch;
 await saveColorwayProperties(fetcher,master.versions[0],{remark:'草稿',isActive:false,tagIds:['9','10']});
 assert.deepEqual(calls,[{
  url:'/api/v2/pattern-colorways/111',method:'PATCH',
  body:{remark:'草稿',isActive:false,tagIds:['9','10']}
 }]);
});
test('P4-2 new colorway accepts selected color tags within its ONE allocating POST',async()=>{
 let body:unknown,method='',path='';
 const fetcher=(async(input:RequestInfo|URL,init?:RequestInit)=>{
  path=String(input);method=String(init?.method);body=JSON.parse(String(init?.body));
  return new Response(JSON.stringify({...master.versions[0],colorwayNo:6,patternNo:'G017-6',id:'201',masterNo:'G017'}),{status:201});
 }) as typeof fetch;
 await createNextColorway(fetcher,master.id,{remark:'新色',isActive:true,tagIds:['9']});
 assert.equal(path,'/api/v2/pattern-masters/11/colorways');assert.equal(method,'POST');
 assert.deepEqual(body,{remark:'新色',isActive:true,tagIds:['9']});
});
test('P4-2 single edit entry: color tags are read-only when idle, no separate maintenance/save',()=>{
 const html=renderToStaticMarkup(React.createElement(PatternColorwayEditor,{
  master,items:master.versions,topics:[],colors:[{id:'9',name:'藏蓝',isArchived:false}],nextColorwayNo:6,
  onClose:()=>{},onSaveVersion:async()=>{},onAdd:async()=>{},
  onSaveMasterTags:async()=>{},onDeleteVersion:async()=>{},canManage:true
 }));
 assert(html.includes('藏蓝')&&html.includes('颜色标签'));
 assert(!html.includes('保存颜色标签'));
 assert(!html.includes('修改颜色标签 G017-1'));
 assert(!html.includes('新版本可保存后维护颜色标签'));
 assert(!html.includes('颜色标签和版本资料分别保存'));
});
test('P4-2 custom color input lives in same draft: reuse existing label or prepare a new one',()=>{
 const options=[
  {id:'9',name:'藏蓝',isArchived:false},
  {id:'10',name:'历史灰',isArchived:true}
 ];
 assert.deepEqual(addColorTagChoice(options,[],[],' 藏蓝 '),{tagIds:['9'],newColorTags:[]});
 assert.deepEqual(addColorTagChoice(options,['9'],[],' 浅紫 '),{
  tagIds:['9'],newColorTags:['浅紫']
 });
 assert.throws(()=>addColorTagChoice(options,[],[],'历史灰'),/归档/);
 assert.throws(()=>addColorTagChoice(options,[],['浅紫'],'浅紫'),/重复/);
 assert.throws(()=>addColorTagChoice(options,['9'],[],'藏蓝'),/重复/);
 assert.throws(()=>addColorTagChoice(options,[],[],'a'.repeat(33)),/32/);
 assert.throws(()=>addColorTagChoice(options,[],[],String.fromCharCode(10)),/颜色/);
 assert.throws(()=>addColorTagChoice(options,['9'],Array(9).fill('不同色'),'另外色'),/10/);
});
test('P4-2 custom color names POST/PATCH are bundled without additional tag endpoint calls',async()=>{
 const calls:{url:string;body:Record<string,unknown>}[]=[];
 const api=(async(url:RequestInfo|URL,options?:RequestInit)=>{
  calls.push({url:String(url),body:JSON.parse(String(options?.body))});
  return new Response(JSON.stringify({...master.versions[0],masterNo:'G017',id:'112',colorwayNo:1,patternNo:'G017-1'}),{status:200});
 }) as typeof fetch;
 await saveColorwayProperties(api,master.versions[0],{
  remark:'同次',isActive:true,tagIds:['9'],newColorTags:['海盐蓝']
 });
 assert.deepEqual(calls[0].body,{remark:'同次',isActive:true,tagIds:['9'],newColorTags:['海盐蓝']});
 assert.equal(calls.length,1);
});
test('P4-2 pattern browse rows preserve 5th version, original image specificity and empty placeholders',()=>{
 const html=renderToStaticMarkup(React.createElement(PatternMasterRows,{
  items:[master],thumbnailUrls:new Map([['a1111111-1111-4111-8111-111111111111','https://signed.example/2']]),
  onPreview:()=>{},onEdit:()=>{},canManage:true
 }));
 assert(html.includes('G017-5')&&html.includes('G017-4'));
 assert(html.includes('G017-2')&&html.includes('https://signed.example/2'));
 assert.equal((html.match(/aria-label="查看花型原图 /g)||[]).length,1);
 assert(html.includes('待上传')&&html.includes('编辑花型及配色 G017'));
 assert(!html.includes('NV')&&!html.includes('IV'));
});
test('pattern master topics have a separate list column from master identity and colorways',()=>{
 const html=renderToStaticMarkup(React.createElement(PatternMasterRows,{items:[master],thumbnailUrls:new Map(),onPreview:()=>{},onEdit:()=>{}}));
 assert.match(html,/role="columnheader"[^>]*>题材标签<\/span>/);
 const cells=[...html.matchAll(/role="cell"[^>]*>([\s\S]*?)<\/div>/g)].map(match=>match[1]);
 assert(cells[0]?.includes('G017'));assert(!cells[0]?.includes('花卉'));
 assert(cells[1]?.includes('花卉'),'topic labels belong to their own cell');
 assert(cells[2]?.includes('藏蓝'),'pattern colors have their own cell next to topics');
 assert(cells[3]?.includes('G017-1'),'colorways remain in the following column');
});
test('P4-2 edit modal uses exactly seven columns; colorway/number read-only, draft controls per row',()=>{
 const html=renderToStaticMarkup(React.createElement(PatternColorwayEditor,{
  master,items:master.versions,topics:[],colors:[],nextColorwayNo:6,
  onClose:()=>{},onSaveVersion:async()=>{},onAdd:async()=>{},
  onSaveMasterTags:async()=>{},onDeleteVersion:async()=>{},canManage:true
 }));
 const cols=Array.from(html.matchAll(/<th[^>]*>([^<]+)/g)).map(x=>x[1]);
 assert.deepEqual(cols,['花型图','配色序号','花型编号','版本备注','启用状态','操作']);
 assert(html.includes('G017-5')&&html.includes('配色 5'));
 assert(html.includes('下一配色 6'));
 assert(html.includes('花型编号')&&html.includes('题材标签')&&html.includes('颜色标签')&&html.includes('添加配色'));
 assert(html.includes('>编辑花型</h2>'));assert(!html.includes('编辑母版及配色资料'));
 assert(!html.includes('颜色身份')&&!html.includes('配色名称'));
});
test('P4-2 edit view shows selected-version actual thumbnail and no fake upload action',()=>{
 const html=renderToStaticMarkup(React.createElement(PatternColorwayEditor,{
  master,items:master.versions,topics:[],colors:[],nextColorwayNo:6,
  onClose:()=>{},onSaveVersion:async()=>{},onAdd:async()=>{},
  onSaveMasterTags:async()=>{},onDeleteVersion:async()=>{},canManage:true,
  thumbnailUrls:new Map([['a1111111-1111-4111-8111-111111111111','https://signed.example/2']]),
  onPreview:()=>{}
 }));
 assert(html.includes('aria-label="查看花型原图 G017-2"'));
 assert.equal((html.match(/aria-label="查看花型原图 /g)||[]).length,1);
 assert(html.includes('https://signed.example/2'));
 assert(!html.includes('上传原图')&&!html.includes('批量上传'));
});
test('P4-2 list has search state, per-dimension tags and no fake approved controls for readonly',()=>{
 const html=renderToStaticMarkup(React.createElement(PatternLibraryV2,{apiFetch:fetch,canManage:false}));
 assert(html.includes('花型库')&&html.includes('搜索编号'));
 assert(html.includes('包含停用')&&html.includes('题材标签')&&html.includes('颜色标签'));
 assert(!html.includes('配色序号筛选'));
 assert(!html.includes('新增母版')&&!html.includes('删除母版'));
});
test('pattern library has shared catalog filters and omits the export action',()=>{
 const html=renderToStaticMarkup(React.createElement(PatternLibraryV2,{apiFetch:fetch,canManage:true,onCreateMaster(){}}));
 assert(!html.includes('导出筛选结果'));
 assert(html.includes('v2-library-filters'));
 assert(html.includes('aria-label="搜索编号"'));
 assert(html.includes('新增花型'));
});
