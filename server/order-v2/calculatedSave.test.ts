import assert from 'node:assert/strict';
import test from 'node:test';
import {calculateAndPersistOrderTotals,reconcileOrderLinesAndTotals} from './calculatedSave';
import {DocumentCalculationError} from './calculations';
import type {AppPrincipal} from '../access/types';
class Fake {
 calls:{sql:string;args:unknown[]}[]=[];
 items=[
  {id:51,meters:'4.00',unit_price:'12.50',amount:'50.00',piece_meters:'[1.25,2.75]',deduction_meters:'0.50'},
  {id:52,meters:'3.00',unit_price:'10.00',amount:'30.00',piece_meters:null,deduction_meters:'0.00'}
 ];
 async query(sql:string,args:unknown[]=[]):Promise<[unknown,unknown]>{
  this.calls.push({sql,args});
  if(sql.startsWith('SELECT template_type,deposit'))return [[{template_type:'bulk',deposit:'20.00'}],[]];
  if(sql.startsWith('SELECT id,meters,unit_price'))return [this.items,[]];
  if(sql.startsWith('UPDATE order_items SET amount='))return [{affectedRows:1},[]];
  if(sql.startsWith('UPDATE orders SET total_meters'))return [{affectedRows:1},[]];
  throw Error(sql);
 }
}
test('P6-1 persist recalculated touched amounts and header in same transaction; old untouched amounts left intact',async()=>{
 const db=new Fake();
 const summary=await calculateAndPersistOrderTotals(db,'11',['51']);
 assert.equal(summary.totalAmount,73.75);
 assert.equal(summary.totalMeters,7);
 assert.equal(summary.totalPieces,2);
 assert.equal(summary.totalDeductionMeters,0.5);
 assert.equal(summary.receivableAmount,53.75);
 const amountUpdates=db.calls.filter(x=>x.sql.startsWith('UPDATE order_items'));
 assert.equal(amountUpdates.length,1);
 assert.deepEqual(amountUpdates[0].args,[43.75,'51','11']);
 const hdr=db.calls.find(x=>x.sql.startsWith('UPDATE orders SET total_meters'))!;
 assert.deepEqual(hdr.args,[7,2,73.75,0.5,'11']);
});
test('P6-1 invalid existing data fails closed before SQL update',async()=>{
 const db=new Fake();
 db.items[1].amount='999';
 await assert.rejects(calculateAndPersistOrderTotals(db,'11',['51']),DocumentCalculationError);
 assert(!db.calls.some(x=>x.sql.startsWith('UPDATE')));
});
test('P6-1 duplicate, unknown touched IDs rejected before modifying header',async()=>{
 const db=new Fake();
 await assert.rejects(calculateAndPersistOrderTotals(db,'11',['51','51']));
 await assert.rejects(calculateAndPersistOrderTotals(db,'11',['999']));
 assert(!db.calls.some(x=>x.sql.startsWith('UPDATE')));
});
