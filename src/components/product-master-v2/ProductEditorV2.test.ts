import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {
 EMPTY_IMAGES,emptyProductDraft,initialProductDraft,buildProductNumberPreview,
 addDraftAsset,replaceDraftAsset,removeDraftAssets,moveDraftAsset,updateSelectedImages,
 productEditorPayload,parseProductDetails,loadProductForEdit,saveProductDraft,
 fetchColorwayChoices,fetchFabricChoices,ProductEditorHttpError
} from './productEditorModel';
import {ProductEditorV2,ProductImageTabs,ProductIdentityChoices} from './ProductEditorV2';
import type {CatalogProduct} from './catalogModel';
import type {FabricCatalogItem} from './fabricModel';
import type {PatternMasterItem} from './patternModel';

const imageA='a1111111-1111-4111-8111-111111111111';
const imageB='b2222222-2222-4222-8222-222222222222';
const imageC='c3333333-3333-4333-8333-333333333333';
const imageD='d4444444-4444-4444-8444-444444444444';
const fabric:FabricCatalogItem={
 id:'8',fabricNo:'F018',fabricName:'轻柔雪纺',composition:'100%真丝',weightValue:16.5,
 weightUnit:'mm',widthValue:145,remark:null,isActive:true,productCount:0
};
const pattern:PatternMasterItem={
 id:'2',masterNo:'G017',isActive:true,nextColorwayNo:4,
 topicTags:[{id:'7',name:'花卉',isArchived:false}],
 versions:[
 {id:'3',masterId:'2',colorwayNo:2,patternNo:'G017-2',patternImageAssetId:imageA,
  remark:'',isActive:true,colorTags:[{id:'9',name:'蓝色',isArchived:false}]},
 {id:'4',masterId:'2',colorwayNo:3,patternNo:'G017-3',patternImageAssetId:null,
  remark:'',isActive:false,colorTags:[]}
 ]
};
const existing={
 id:'11',patternColorwayId:'3',fabricId:'8',masterNo:'G017',colorwayNo:2,
 fabricNo:'F018',fabricName:'轻柔雪纺',composition:'100%真丝',
 weightValue:16.5,weightUnit:'mm',widthCm:145,patternImageAssetId:imageA,
 productNo:'G017-2-F018',remark:'丝质底布',isActive:true,isAvailableForSampling:true,rowVersion:'4',
 masterActive:true,colorwayActive:true,fabricActive:true,
 images:{fabricDisplay:[imageB,imageC],detail:[imageD],aiEffect:[]}
};
test('P4-5 create is empty, initial editor populates one immutable product identity and all three image groups',()=>{
 assert.deepEqual(emptyProductDraft().images,EMPTY_IMAGES);
 assert.equal(emptyProductDraft().patternColorwayId,'');
 const item=parseProductDetails(existing);
 const draft=initialProductDraft(item);
 assert.equal(draft.patternColorwayId,'3');assert.equal(draft.fabricId,'8');
 assert.equal(draft.rowVersion,'4');
 assert.deepEqual(draft.images.fabricDisplay,[imageB,imageC]);
 assert.equal(draft.remark,'丝质底布');
});
test('product maintenance hides sampling control and preserves existing sampling state in payload with rowVersion',()=>{
 const current=parseProductDetails({...existing,isAvailableForSampling:false});
 assert.equal(initialProductDraft(current).isAvailableForSampling,false);
 assert.equal(emptyProductDraft().isAvailableForSampling,true);
 const edited=productEditorPayload(initialProductDraft(current),'edit');
 assert.equal(edited.isActive,true);assert.equal(edited.isAvailableForSampling,false);assert.equal(edited.expectedRowVersion,'4');
 assert.throws(()=>productEditorPayload({...initialProductDraft(current),isAvailableForSampling:'off' as never},'edit'),/供样|状态/);
 const html=renderToStaticMarkup(React.createElement(ProductEditorV2,{mode:'create',apiFetch:fetch,canManage:true,onSaved:()=>{},onCancel:()=>{}}));
 assert(!html.includes('允许供样'));assert(html.includes('启用状态'));
});
test('P4-5 preview is read-only derived from selected live reference, not arbitrary input',()=>{
 const chosen=pattern.versions[0];
 assert.equal(buildProductNumberPreview(chosen,fabric),'G017-2-F018');
 assert.equal(buildProductNumberPreview(chosen,null),'待选面料');
 assert.equal(buildProductNumberPreview(null,fabric),'待选花型');
 assert.equal(buildProductNumberPreview(chosen,{...fabric,fabricNo:'F-018'}),null);
});
test('P4-5 ready asset adds once, respects max 10/category and no cross-category duplicate',()=>{
 const begin=emptyProductDraft();
 const one=addDraftAsset(begin,'fabricDisplay',imageA);
 assert.deepEqual(one.images.fabricDisplay,[imageA]);
 assert.throws(()=>addDraftAsset(one,'detail',imageA),/重复/);
 assert.throws(()=>addDraftAsset(one,'fabricDisplay',imageA),/重复/);
 assert.deepEqual(begin.images,EMPTY_IMAGES);
 let next=one;
 for(let i=1;i<10;i++){
  const id=String(i).padStart(8,'0')+'-1111-4111-8111-111111111111';
  next=addDraftAsset(next,'fabricDisplay',id);
 }
 assert.equal(next.images.fabricDisplay.length,10);
 assert.throws(()=>addDraftAsset(next,'fabricDisplay',imageB),/10/);
 assert.throws(()=>addDraftAsset(next,'detail','not-a-uuid'),/图片/);
});
test('P4-5 replace one ready asset in place without changing category/order or mutating baseline',()=>{
 const original={...emptyProductDraft(),images:{fabricDisplay:[imageA,imageB],detail:[imageC],aiEffect:[]}};
 const changed=replaceDraftAsset(original,'fabricDisplay',0,imageD);
 assert.deepEqual(changed.images.fabricDisplay,[imageD,imageB]);
 assert.deepEqual(changed.images.detail,[imageC]);
 assert.deepEqual(original.images.fabricDisplay,[imageA,imageB]);
 assert.throws(()=>replaceDraftAsset(original,'fabricDisplay',0,imageC),/重复/);
 assert.throws(()=>replaceDraftAsset(original,'fabricDisplay',99,imageD),/图片/);
 assert.deepEqual(replaceDraftAsset(original,'fabricDisplay',1,imageB).images.fabricDisplay,[imageA,imageB]);
});
test('P4-5 image order changes only within active category and preserves original draft on cancel',()=>{
 const draft={...emptyProductDraft(),images:{fabricDisplay:[imageA,imageB,imageC],detail:[imageD],aiEffect:[]}};
 const moved=moveDraftAsset(draft,'fabricDisplay',2,-1);
 assert.deepEqual(moved.images.fabricDisplay,[imageA,imageC,imageB]);
 assert.deepEqual(moved.images.detail,[imageD]);
 assert.deepEqual(moveDraftAsset(draft,'fabricDisplay',0,-1).images.fabricDisplay,[imageA,imageB,imageC]);
 assert.deepEqual(draft.images.fabricDisplay,[imageA,imageB,imageC]);
});
test('P4-5 multi-select removal affects selected current group only, not shared image assets or other groups',()=>{
 const original={...emptyProductDraft(),images:{fabricDisplay:[imageA,imageB],detail:[imageC],aiEffect:[]}};
 const marked=updateSelectedImages([],imageA,true);
 const checked=updateSelectedImages(marked,imageB,true);
 assert.deepEqual(checked,[imageA,imageB]);
 assert.deepEqual(updateSelectedImages(checked,imageA,false),[imageB]);
 const cleared=removeDraftAssets(original,'fabricDisplay',checked);
 assert.deepEqual(cleared.images.fabricDisplay,[]);
 assert.deepEqual(cleared.images.detail,[imageC]);
 assert.deepEqual(original.images.fabricDisplay,[imageA,imageB]);
});
test('P4-5 save payload is a single mutation with backend-generated no and rowVersion CAS',()=>{
 const draft={...initialProductDraft(parseProductDetails(existing)),remark:'  更新备注  ',isActive:false};
 const edit=productEditorPayload(draft,'edit');
 assert.deepEqual(edit,{
  patternColorwayId:'3',fabricId:'8',remark:'更新备注',isActive:false,isAvailableForSampling:true,
  images:{fabricDisplay:[imageB,imageC],detail:[imageD],aiEffect:[]},
  expectedRowVersion:'4'
 });
 const create=productEditorPayload({...emptyProductDraft(),patternColorwayId:'3',fabricId:'8'},'create');
 assert(!Object.hasOwn(create,'expectedRowVersion'));
 assert(!Object.hasOwn(create,'productNo'));
 assert.deepEqual(create.images,{fabricDisplay:[],detail:[],aiEffect:[]});
 assert.throws(()=>productEditorPayload(emptyProductDraft(),'create'),/花型|面料/);
});
test('P4-5 invalid duplicates, too many images, remarks and identity reject before network',()=>{
 const draft={...emptyProductDraft(),patternColorwayId:'3',fabricId:'8'};
 for(const x of [
  {...draft,patternColorwayId:'0'},
  {...draft,remark:'a'.repeat(5001)},
  {...draft,images:{fabricDisplay:[imageA],detail:[imageA],aiEffect:[]}},
  {...draft,images:{fabricDisplay:Array(11).fill(imageA),detail:[],aiEffect:[]}},
  {...draft,rowVersion:'0'},
 ])assert.throws(()=>productEditorPayload(x,'edit'));
});
test('P4-5 real HTTP requests: only POST/create or PATCH/edit, complete images, no silent retry',async()=>{
 const calls:{url:string;body:any;method?:string}[]=[];
 const fetcher=(async(url:RequestInfo|URL,options?:RequestInit)=>{
  const body=JSON.parse(String(options?.body));
  calls.push({url:String(url),body,method:options?.method});
  return new Response(JSON.stringify(existing),{status:200});
 }) as typeof fetch;
 const value=initialProductDraft(parseProductDetails(existing));
 const edited=await saveProductDraft(fetcher,'edit',value,'11');
 assert.equal(edited.productNo,'G017-2-F018');
 await saveProductDraft(fetcher,'create',{...emptyProductDraft(),patternColorwayId:'3',fabricId:'8'});
 assert.deepEqual(calls.map(c=>c.method),['PATCH','POST']);
 assert.equal(calls[0].url,'/api/v2/products/11');
 assert.equal(calls[1].url,'/api/v2/products');
 assert.equal(calls[0].body.expectedRowVersion,'4');
 assert.deepEqual(calls[0].body.images.detail,[imageD]);
 assert(!('productNo' in calls[1].body));
});
test('P4-5 stale revision, existing combination and ordered identity locked become visible 409',async()=>{
 const fetcher=(async()=>new Response(JSON.stringify({error:'Ordered product identity is locked'}),{status:409})) as typeof fetch;
 await assert.rejects(saveProductDraft(fetcher,'edit',initialProductDraft(parseProductDetails(existing)),'11'),
  (e:unknown)=>e instanceof ProductEditorHttpError&&e.status===409);
});
test('P4-5 identity choices use filtered server-side endpoints, include only active versions/fabrics',async()=>{
 const calls:string[]=[];
 const fetcher=(async(url:RequestInfo|URL)=>{
  calls.push(String(url));
  if(String(url).includes('pattern-catalog'))return new Response(JSON.stringify({items:[pattern],total:1,limit:20,offset:0}),{status:200});
  return new Response(JSON.stringify({items:[fabric],total:1,limit:50,offset:0}),{status:200});
 }) as typeof fetch;
 const versions=await fetchColorwayChoices(fetcher,'G017');
 assert.equal(versions.items.length,1);assert.equal(versions.items[0].patternNo,'G017-2');
 assert.deepEqual(versions.items[0].topicTags,[{id:'7',name:'花卉',isArchived:false}]);
 const fabrics=await fetchFabricChoices(fetcher,'雪纺');
 assert.equal(fabrics.items.length,1);
 assert(calls[0].includes('/api/v2/pattern-catalog?'));
 assert(calls[0].includes('number=G017'));
 assert(calls[1].includes('/api/v2/fabrics/catalog?'));
});
test('P4-5 tabs show three categories and each count /10; selected state does not conflate categories',()=>{
 const draft=initialProductDraft(parseProductDetails(existing));
 const html=renderToStaticMarkup(React.createElement(ProductImageTabs,{
  images:draft.images,selected:[],activeRole:'fabricDisplay',onRole:()=>{},
  onSelect:()=>{},onDeleteSelected:()=>{},onMove:()=>{},canManage:true,
  urls:new Map([[imageB,'https://images.example/b']])
 }));
 assert(html.includes('面料大图')&&html.includes('面料细节图')&&html.includes('效果图'));
 assert(html.includes('2 / 10')&&html.includes('1 / 10')&&html.includes('0 / 10'));
 assert(html.includes('https://images.example/b'));
 assert(html.includes('批量删除选中'));
 assert(!html.includes('上传图片'));
});
test('P4-5 actual upload bridge exposes add/replace only when provided, not on unauthenticated default',()=>{
 const draft=initialProductDraft(parseProductDetails(existing));
 const html=renderToStaticMarkup(React.createElement(ProductImageTabs,{
  images:draft.images,selected:[],activeRole:'fabricDisplay',onRole:()=>{},
  onSelect:()=>{},onDeleteSelected:()=>{},onMove:()=>{},canManage:true,
  urls:new Map(),onUploadClick:()=>{},onReplaceClick:()=>{}
 }));
 assert(html.includes('上传图片'));
 assert(html.includes('替换第1张'));
 assert(html.includes('替换第2张'));
});
test('P4-5 both searchable selectors have readonly details and no editable fabric attributes',()=>{
 const html=renderToStaticMarkup(React.createElement(ProductIdentityChoices,{
  version:{...pattern.versions[0],topicTags:pattern.topicTags},fabric,onChooseVersion:()=>{},onChooseFabric:()=>{},
  canChange:true
 }));
 assert(html.includes('G017-2')&&html.includes('F018')&&html.includes('轻柔雪纺'));
 assert(html.includes('100%真丝')&&html.includes('16.5 mm'));
 assert(html.includes('题材标签：花卉'));
 assert(html.includes('选择花型版本')&&html.includes('选择面料'));
 assert(!html.includes('配色名称')&&!html.includes('审核状态'));
});
test('P4-5 main panel contains generated code, compact remark/status and cancel/save, no fake upload',()=>{
 const html=renderToStaticMarkup(React.createElement(ProductEditorV2,{
  apiFetch:fetch,mode:'create',onCancel:()=>{},onSaved:()=>{},canManage:true
 }));
 assert(html.includes('保存产品')&&html.includes('取消'));
 assert(html.includes('自动货号')&&html.includes('备注')&&html.includes('启用状态'));
 assert(html.includes('面料大图')&&html.includes('面料细节图')&&html.includes('效果图'));
 assert(!html.includes('上传图片'));
});
