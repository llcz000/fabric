import assert from 'node:assert/strict';
import test from 'node:test';
import {applySelectedProductToDraft,buildProductSelectorUrl,validateProductSelectorPage,type PickerProduct} from './selection';
import {DocType,type DocItem} from '../../types';
const product:PickerProduct={id:'901',productNo:'G011-2',fabricName:'丝麻',masterNo:'G011',
 colorwayNo:2,composition:'70% silk',weight:15.5,weightUnit:'mm',widthCm:140,
 patternImageAssetId:null,thumbnailUrl:null};
test('P6-1 selection preserves id and business fields for all three document types',()=>{
 const sample={id:'a',itemNo:'old',colorNo:'x',productName:'OLD',composition:'old',
  weight:'110 gsm',width:'100',meters:3,price:17,amount:51,remark:'保留'};
 const sales={id:'b',itemNo:'old',colorNo:'x',productName:'OLD',rollNo:'2 3',
  width:'150',meters:5,price:18,amount:81,deductionMeters:0.5,remark:'寄样'};
 const deposit={id:'c',itemNo:'old',colorNo:'x',productName:'OLD',meters:2,price:25,
  amount:50,remark:''};
 for(const [type,old] of [[DocType.SAMPLE,sample],[DocType.SALES,sales],[DocType.DEPOSIT,deposit]] as const){
  const next=applySelectedProductToDraft(type,old as DocItem,product);
  assert.equal(next.id,old.id);assert.equal(next.itemNo,'G011-2');
  assert.equal(next.colorNo,'2');assert.equal(next.productName,'丝麻');
  assert.equal(next.meters,old.meters);assert.equal(next.price,old.price);
  assert.equal(next.amount,old.amount);assert.equal(next.remark,old.remark);
  assert.equal(next.v2ProductId,'901');assert.equal(next.v2SourceKind,'catalog');
  assert.equal(next.v2SelectionChanged,true,'Replacement must be persisted via V2 selection.productId');
  if(type===DocType.SALES){assert.equal((next as typeof sales).rollNo,'2 3');assert.equal((next as typeof sales).deductionMeters,0.5);}
  if(type===DocType.SAMPLE) assert.equal((next as typeof sample).weight,'15.5 mm');
 }
});
test('P6-1 selector uses encoded independent AND and cannot smuggle filter terms',()=>{
 assert.equal(buildProductSelectorUrl('/api/v2/document-products/selector',{productNo:'A&B',fabricName:'丝 麻',limit:20,offset:40}),
 '/api/v2/document-products/selector?productNo=A%26B&fabricName=%E4%B8%9D+%E9%BA%BB&limit=20&offset=40');
});
test('P6-1 API page parser fails closed with unexpected or unsafe payload',()=>{
 const ok=validateProductSelectorPage({items:[product],total:1,limit:20,offset:0});
 assert.equal(ok.items[0].colorwayNo,2);
 assert.throws(()=>validateProductSelectorPage({items:[{...product,id:4}],total:1,limit:20,offset:0}));
 assert.throws(()=>validateProductSelectorPage({items:[{...product,thumbnailUrl:'javascript:alert(1)'}],total:1,limit:20,offset:0}));
 assert.throws(()=>validateProductSelectorPage({items:[],total:1,limit:1000,offset:0}));
});


test('selector resolves null thumbnails by authenticated asset ID, preserving signed rows and order',async()=>{
 const {resolveProductSelectorThumbnails}=await import('./selection');
 const asset='11111111-1111-4111-8111-111111111111';
 const row={id:'1',productNo:'P1',fabricName:'真丝',masterNo:'G1',colorwayNo:1,composition:null,weight:null,weightUnit:null,widthCm:null,patternImageAssetId:asset,thumbnailUrl:null};
 const page={items:[row,{...row,id:'2'},{...row,id:'3',thumbnailUrl:'https://signed.example/existing'},{...row,id:'4',patternImageAssetId:null}],total:4,limit:20,offset:0};
 const calls:any[]=[];const controller=new AbortController();
 const api:typeof fetch=async(url,init)=>{calls.push({url:String(url),body:JSON.parse(String(init?.body)),signal:init?.signal});return Response.json({results:[{assetId:asset,variant:'thumbnail',url:'https://signed.example/thumb'}]});};
 const result=await resolveProductSelectorThumbnails(api,page,controller.signal);
 assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/image-assets/access-urls');assert.equal(calls[0].signal,controller.signal);
 assert.deepEqual(calls[0].body.requests,[{assetId:asset,variant:'thumbnail'}]);
 assert.deepEqual(result.items.map(p=>p.thumbnailUrl),['https://signed.example/thumb','https://signed.example/thumb','https://signed.example/existing',null]);
 assert.equal(page.items[0].thumbnailUrl,null);
});
