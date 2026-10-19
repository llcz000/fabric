import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateAndPersistOrderTotals} from './calculatedSave';
test('header-only edit computes over untouched legacy null-padded rolls without rewriting original row',async()=>{
 const writes:string[]=[];const raw={id:7,meters:'10',unit_price:'2',amount:'20',piece_meters:'[10,null,null]',deduction_meters:'0',v2_source_kind:null,v2_product_snapshot:null};
 const db={async query(sql:string):Promise<[unknown,unknown]>{if(sql.startsWith('SELECT template_type'))return [[{template_type:'bulk',deposit:0}],[]];if(sql.includes('FROM order_items'))return [[raw],[]];writes.push(sql);return [{affectedRows:1},[]];}};
 const totals=await calculateAndPersistOrderTotals(db,'41',[]);assert.equal(totals.totalPieces,1);assert.equal(raw.piece_meters,'[10,null,null]');assert(!writes.some(s=>s.startsWith('UPDATE order_items')));
});
test('a final empty document cannot be saved even through a direct authenticated API transaction',async()=>{
 const writes:string[]=[];const db={async query(sql:string):Promise<[unknown,unknown]>{if(sql.startsWith('SELECT template_type'))return [[{template_type:'sample',deposit:0}],[]];if(sql.includes('FROM order_items'))return [[],[]];writes.push(sql);return [{affectedRows:1},[]];}};
 await assert.rejects(()=>calculateAndPersistOrderTotals(db,'41',[]),/line|明细/i);assert.equal(writes.length,0);
});
