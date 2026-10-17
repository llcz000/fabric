import assert from 'node:assert/strict';
import test from 'node:test';
import {prepareShipmentBatch,summarizeShipmentProgress,ShipmentBatchError} from './shipmentBatch';

const eligible=[{itemId:'81',productId:'18',removedAt:null},{itemId:'82',productId:'19',removedAt:null},{itemId:'83',productId:'20',removedAt:'2026-10-15T09:00:00Z'}];
const date='2026-10-15T06:00:00.000Z';
const request=()=>({sessionId:'41',shippedAt:date,carrier:'Courier',trackingNo:'ABC001',items:[{productId:'18',quantity:2},{productId:'19',quantity:1}]});

test('AC-81 prepare one factual shipment batch, not a card scan or auto shipment',()=>{
 const before=structuredClone(eligible),draft=request();
 const result=prepareShipmentBatch(draft,eligible,{sessionId:'41'});
 assert.deepEqual(result,{sessionId:'41',shippedAt:date,carrier:'Courier',trackingNo:'ABC001',
   items:[{itemId:'81',productId:'18',quantity:2},{itemId:'82',productId:'19',quantity:1}]});
 assert.deepEqual(eligible,before);assert.deepEqual(draft,request());
 assert.notStrictEqual(result.items,draft.items);
 assert.equal(Object.hasOwn(result,'status'),false);
});

test('AC-81 shipping one product does not auto mark other selected products shipped',()=>{
 const result=prepareShipmentBatch({sessionId:'41',shippedAt:date,items:[{productId:'18',quantity:1}]},eligible,{sessionId:'41'});
 const summary=summarizeShipmentProgress(eligible,[result],{sessionId:'41'});
 assert.deepEqual(summary,{selectedProducts:2,shippedProducts:1,pendingProducts:1,shippedQuantity:1});
});

test('AC-81 multi-batch historical records accumulate; same product in later batch is legitimate replenishment',()=>{
 const first=prepareShipmentBatch({sessionId:'41',shippedAt:date,items:[{productId:'18',quantity:2}]},eligible,{sessionId:'41'});
 const second=prepareShipmentBatch({sessionId:'41',shippedAt:'2026-10-16T06:00:00.000Z',items:[
  {productId:'18',quantity:3},{productId:'19',quantity:1}]},eligible,{sessionId:'41'});
 assert.deepEqual(summarizeShipmentProgress(eligible,[first,second],{sessionId:'41'}),{
  selectedProducts:2,shippedProducts:2,pendingProducts:0,shippedQuantity:6
 });
});

test('AC-81 removed selections never enter new shipments and do not count as current pending',()=>{
 for(const item of [{productId:'20',quantity:1},{productId:'99',quantity:1}]){
  assert.throws(()=>prepareShipmentBatch({sessionId:'41',shippedAt:date,items:[item]},eligible,{sessionId:'41'}),ShipmentBatchError);
 }
 assert.deepEqual(summarizeShipmentProgress(eligible,[],{sessionId:'41'}),{
  selectedProducts:2,shippedProducts:0,pendingProducts:2,shippedQuantity:0
 });
});

test('AC-81 IDs are strict unsigned SQL identity strings; invalid IDs and sessions fail closed',()=>{
 for(const id of ['', '0','01','-1','1e3',' 41','41 ','18446744073709551616',41,{},null] as unknown[]){
  assert.throws(()=>prepareShipmentBatch({...request(),sessionId:id},eligible,{sessionId:'41'}),ShipmentBatchError);
  assert.throws(()=>prepareShipmentBatch({...request(),items:[{productId:id,quantity:1}]},eligible,{sessionId:'41'}),ShipmentBatchError);
 }
 assert.throws(()=>prepareShipmentBatch({...request(),sessionId:'42'},eligible,{sessionId:'41'}),ShipmentBatchError);
});

test('AC-81 malformed batches cannot log empty, duplicate or zero/unsafe quantity rows',()=>{
 const variants=[[],null,{},'bad',
  [{productId:'18',quantity:0}], [{productId:'18',quantity:-1}],
  [{productId:'18',quantity:0.5}], [{productId:'18',quantity:Number.MAX_SAFE_INTEGER+1}],
  [{productId:'18',quantity:'2'}], [{productId:'18',quantity:1},{productId:'18',quantity:1}],
  [{productId:'18',quantity:1,actor:'spoof'}]];
 for(const items of variants){
  assert.throws(()=>prepareShipmentBatch({...request(),items},eligible,{sessionId:'41'}),ShipmentBatchError,JSON.stringify(items));
 }
});

test('AC-81 no silent trust of client-selected ids, actor/status, or old attribute snapshots',()=>{
 for(const extra of [{actorUserId:'999'},{status:'shipped'},{fabricName:'tampered'},{cardId:'44'}]){
  assert.throws(()=>prepareShipmentBatch({...request(),...extra},eligible,{sessionId:'41'}),ShipmentBatchError);
 }
 assert.throws(()=>prepareShipmentBatch({...request(),items:[{productId:'18',quantity:1,price:50}]},eligible,{sessionId:'41'}),ShipmentBatchError);
});

test('AC-81 preserve real timestamp and optional shipment carrier/tracking text; no fabricated defaults',()=>{
 const result=prepareShipmentBatch({sessionId:'41',shippedAt:date,items:[{productId:'18',quantity:1}]},eligible,{sessionId:'41'});
 assert.equal(result.carrier,null);assert.equal(result.trackingNo,null);
 for(const shippedAt of ['', 'yesterday','2026-10-15','2026-02-30T00:00:00Z','2026-10-15T06:00:00+08:00',null] as unknown[]){
  assert.throws(()=>prepareShipmentBatch({...request(),shippedAt},eligible,{sessionId:'41'}),ShipmentBatchError);
 }
 for(const carrier of ['', ' '.repeat(2),'a'.repeat(161),7]){
  assert.throws(()=>prepareShipmentBatch({...request(),carrier},eligible,{sessionId:'41'}),ShipmentBatchError);
 }
});

test('AC-81 reject inconsistent, spoofed or malformed DB selection and shipment history',()=>{
 const all=[{itemId:'81',productId:'18',removedAt:null}];
 for(const bad of [null,{},[{itemId:'81',productId:'18',removedAt:null},{itemId:'82',productId:'18',removedAt:null}],
  [{itemId:'0',productId:'18',removedAt:null}],
  [{itemId:'81',productId:'18',removedAt:false}]]){
  assert.throws(()=>prepareShipmentBatch({...request(),items:[{productId:'18',quantity:1}]},bad,{sessionId:'41'}),ShipmentBatchError);
 }
 const good=prepareShipmentBatch({sessionId:'41',shippedAt:date,items:[{productId:'18',quantity:1}]},all,{sessionId:'41'});
 assert.throws(()=>summarizeShipmentProgress(all,[{...good,sessionId:'999'}],{sessionId:'41'}),ShipmentBatchError);
 assert.throws(()=>summarizeShipmentProgress(all,[{...good,items:[{...good.items[0],quantity:0}]}],{sessionId:'41'}),ShipmentBatchError);
});

test('AC-81 historical delivered rows stay historical after later removal, without declaring removed product pending',()=>{
 const before=prepareShipmentBatch({sessionId:'41',shippedAt:date,items:[{productId:'18',quantity:2}]},eligible,{sessionId:'41'});
 const updated=[{itemId:'81',productId:'18',removedAt:'2026-10-18T06:00:00Z'},...eligible.slice(1)];
 assert.deepEqual(summarizeShipmentProgress(updated,[before],{sessionId:'41'}),{
  selectedProducts:1,shippedProducts:0,pendingProducts:1,shippedQuantity:2
 });
});
