import assert from 'node:assert/strict';
import test from 'node:test';
import {createManualSelectionReviewApi} from './manualSelectionMockApi';
import {createSampleSelectionClient} from '../components/product-master-v2/sampleSelectionClient';
import {searchManualCards} from '../components/product-master-v2/manualSelectionModel';
test('card review searches only cards, adds a subset or whole card, deduplicates and restores with a source',async()=>{
 const demo=createManualSelectionReviewApi(0),client=createSampleSelectionClient(demo.apiFetch);
 const cards=await searchManualCards(demo.apiFetch,{sessionId:'51',query:'棉麻',offset:0});
 assert.equal(cards.items[0].cardNo,'0012-F019');assert.equal(cards.items[0].products.length,2);
 assert.equal((await client.addManual('51','12',['81'])).items[0].action,'already_selected');
 assert.equal((await client.addManual('51','13',['82'])).items[0].action,'added');
 let page=await client.load('51',20,0);assert.equal(page.total,2);
 const item=page.items.find(x=>x.productId==='82')!;assert.equal(item.sources[0].cardNo,'0012-F019');assert.equal(item.sources[0].firstScanEventId,null);
 await client.remove('51',item.id);assert.equal((await client.addManual('51','13',['82'])).items[0].action,'restored');
 await client.addManual('51','13');page=await client.load('51',20,0);assert.equal(page.total,3);
 demo.updateLatest();page=await client.load('51',20,0);assert.equal(page.items.find(x=>x.productId==='82')!.current.fabricName,'棉麻平纹（资料已更新）');
 assert.equal(page.items.find(x=>x.productId==='82')!.id,item.id);
});
test('card review rejects uncarded/cross-card products, legacy product-only POST, closed and unavailable cards',async()=>{
 const demo=createManualSelectionReviewApi(0),client=createSampleSelectionClient(demo.apiFetch);
 for(const [session,card,ids] of [['51','12',['82']],['51','12',['90']],['51','14',undefined],['51','15',undefined],['52','13',undefined]] as const)
  await assert.rejects(client.addManual(session,card,ids?[...ids]:undefined),(e:unknown)=>(e as {status:number}).status===409);
 assert.equal((await demo.apiFetch('/api/v2/customer-samples/sessions/51/items/manual',{method:'POST',body:JSON.stringify({productId:'90'})})).status,400);
 assert.equal((await demo.apiFetch('/api/v2/products')).status,404);
 assert.equal((await demo.apiFetch('/api/unknown')).status,404);
 demo.failNext('search');await assert.rejects(searchManualCards(demo.apiFetch,{sessionId:'51',query:'',offset:0}));
 assert((await searchManualCards(demo.apiFetch,{sessionId:'51',query:'',offset:0})).total>20);
});
test('card search and all selection operations reject login/grant loss without losing original facts',async()=>{
 const demo=createManualSelectionReviewApi(0),client=createSampleSelectionClient(demo.apiFetch);
 for(const access of ['logged_out','revoked'] as const){
  demo.setAccess(access);const status=access==='logged_out'?401:404;
  await assert.rejects(client.load('51',20,0),(e:unknown)=>(e as {status:number}).status===status);
  await assert.rejects(client.addManual('51','13'),(e:unknown)=>(e as {status:number}).status===status);
  await assert.rejects(searchManualCards(demo.apiFetch,{sessionId:'51',query:'',offset:0}),(e:unknown)=>(e as {status:number}).status===status);
  demo.setAccess('authorized');assert.equal((await client.load('51',20,0)).total,1);
 }
});
