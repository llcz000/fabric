import assert from 'node:assert/strict';
import test from 'node:test';
import type {AppPrincipal} from '../access/types';
import {addManualSampleItem,SampleSessionManualError} from './sessionManual';
import {getSampleSchemaStatements} from './schema';

const actor:AppPrincipal={userId:'6',sessionId:'1',role:'sales',username:'sales',displayName:'销售',canManageProducts:false,canManageOwnOrders:false};
import {CardSelectionFixture} from './sessionCardSelection.testFixture';
const input={sessionId:'11',cardId:'44'};
const status=(code:number)=>(e:unknown)=>e instanceof SampleSessionManualError&&e.status===code;
test('card-only manual selection atomically adds the whole card and records card provenance without scan events',async()=>{
 const db=new CardSelectionFixture();const result=await addManualSampleItem(db,actor,input);
 assert.deepEqual(result.items.map(x=>[x.productId,x.action]),[['8','added'],['9','added']]);
 assert.equal(result.cardId,'44');assert.equal(db.events.length,2);assert(db.events.every(args=>args.includes('44')));
 assert.deepEqual([...db.cards],['44']);assert(!db.calls.some(x=>x.sql.includes('INSERT INTO customer_sample_scan_events')));
 assert.equal(db.commits,1);assert.equal(db.released,1);
});
test('card subset supports duplicate and restoration without changing original selector or source',async()=>{
 const db=new CardSelectionFixture();db.items=[{id:'80',product_id:'8',removed_at:'2026-10-16',removed_by_user_id:'7',selected_by_user_id:'5'}];
 let result=await addManualSampleItem(db,actor,{...input,productIds:['8']});
 assert.equal(result.items[0].action,'restored');assert.equal(db.items[0].selected_by_user_id,'5');assert.equal(db.items.length,1);
 result=await addManualSampleItem(db,actor,{...input,productIds:['8']});assert.equal(result.items[0].action,'already_selected');
 assert.equal(db.events.length,2);
});
test('card-only input rejects bare product IDs, empty/duplicate/invalid subsets before connecting',async()=>{
 for(const value of [{sessionId:'11',productId:'8'},{...input,productIds:[]},{...input,productIds:['8','8']},{...input,productIds:['0']}]){
  const db=new CardSelectionFixture();await assert.rejects(addManualSampleItem(db,actor,value as Parameters<typeof addManualSampleItem>[2]),status(400));assert.equal(db.calls.length,0);
 }
});
test('card scope rejects uncarded/cross-card products and stale unavailable selections without any writes',async()=>{
 for(const ids of [['99'],['8','99']]){
  const db=new CardSelectionFixture();await assert.rejects(addManualSampleItem(db,actor,{...input,productIds:ids}),status(409));assert.equal(db.events.length,0);assert.equal(db.items.length,0);
 }
 const db=new CardSelectionFixture();db.products[1].sampling_available=0;
 await assert.rejects(addManualSampleItem(db,actor,{...input,productIds:['8','9']}),status(409));
 const result=await addManualSampleItem(db,actor,input);assert.deepEqual(result.items.map(x=>x.productId),['8']);
});
test('retired/absent cards, disabled parents, revoked token/login/grant and closed session fail closed',async()=>{
 for(const field of ['card','parentActive','token','login','grant','open'] as const){
  const db=new CardSelectionFixture();db[field]=false;
  await assert.rejects(addManualSampleItem(db,actor,input));assert.equal(db.items.length,0);assert.equal(db.events.length,0);assert.equal(db.rollbacks,1);
 }
 const db=new CardSelectionFixture();db.retired=true;await assert.rejects(addManualSampleItem(db,actor,input),status(404));
});
test('whole-card failure rolls back earlier products, source card and all audit events',async()=>{
 for(const failure of ['insert','audit','commit']){
  const db=new CardSelectionFixture();db.failure=failure;await assert.rejects(addManualSampleItem(db,actor,input),/PRIVATE/);
  assert.deepEqual(db.items,[]);assert.deepEqual(db.events,[]);assert.equal(db.cards.size,0);assert.equal(db.rollbacks,1);
 }
});
test('new manual audit schema retains nullable legacy card references with a restrict foreign key',()=>{
 const ddl=getSampleSchemaStatements().find(x=>x.name==='customer_sample_manual_events')!.sql;
 assert.match(ddl,/card_id BIGINT UNSIGNED NULL/);assert.match(ddl,/FOREIGN KEY \(card_id\) REFERENCES sample_cards\(id\) ON DELETE RESTRICT/);
});
