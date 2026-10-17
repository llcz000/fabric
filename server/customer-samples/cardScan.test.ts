import assert from 'node:assert/strict';
import test from 'node:test';
import {planCardScan,CardScanInputError} from './cardScan';

const card={id:'12',fabricId:'23',masterIds:['41']};

test('v1.50 planning produces product identities only, not frozen product attributes',()=>{
 const result=planCardScan(card,[product('8',1)],[]);
 assert.deepEqual(result.newlyAdded,[{productId:'8'}]);
});
const product=(id:string,colorwayNo:number,fabricId='23',masterId='41')=>({
  id,masterId,fabricId,productNo:'G041-'+colorwayNo+'-S23',
  colorwayNo
});

test('B2 same-fabric all current colorways are added, scoped to the card master',()=>{
 const result=planCardScan(card,[product('8',1),product('9',2)],[]);
 assert.deepEqual(result.resolvedProductIds,['8','9']);
 assert.deepEqual(result.newlyAdded.map(x=>x.productId),['8','9']);
 assert.equal(result.unchangedProductIds.length,0);
});
test('B2 rescanning adds only new colorway and leaves selected product identities untouched',()=>{
 const first=planCardScan(card,[product('8',1),product('9',2)],[]);
 const saved=first.newlyAdded.map(x=>({productId:x.productId}));
 const oldJson=JSON.stringify(saved);
 const repeat=planCardScan(card,[product('8',1),product('9',2)],saved);
 assert.deepEqual(repeat.newlyAdded,[]);
 const withNew=planCardScan(card,[product('8',1),product('9',2),product('10',3)],saved);
 assert.deepEqual(withNew.newlyAdded.map(x=>x.productId),['10']);
 assert.deepEqual(withNew.unchangedProductIds,['8','9']);
 assert.equal(JSON.stringify(saved),oldJson,'selected identities are untouched');
});
test('B2 same-pattern product on a different fabric is never included or silently accepted',()=>{
 assert.throws(()=>planCardScan(card,[product('8',1),product('12',1,'35')],[]),CardScanInputError);
 assert.throws(()=>planCardScan(card,[product('8',1),product('13',2,'23','42')],[]),CardScanInputError);
});
test('B2 refuses card without a specific fabric or master pattern range, and invalid product identity',()=>{
 assert.throws(()=>planCardScan({...card,masterIds:[]},[product('8',1)],[]),CardScanInputError);
 assert.throws(()=>planCardScan({...card,fabricId:''},[product('8',1)],[]),CardScanInputError);
 assert.throws(()=>planCardScan(card,[{...product('8',1),id:''}],[]),CardScanInputError);
});
test('B3 duplicate source products cannot add duplicate selection rows',()=>{
 const result=planCardScan(card,[product('9',2),product('9',2),product('8',1)],[{productId:'8'}]);
 assert.deepEqual(result.resolvedProductIds,['8','9']);
 assert.deepEqual(result.newlyAdded.map(x=>x.productId),['9']);
 assert.deepEqual(result.unchangedProductIds,['8']);
});
