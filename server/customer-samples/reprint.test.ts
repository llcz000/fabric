import assert from 'node:assert/strict';
import test from 'node:test';
import {markCardsForReprintOnFabricChange} from './reprint';

const base={fabricName:'真丝雪纺',composition:'100%真丝',weightValue:16,weightUnit:'mm' as const,widthValue:140,remark:'旧备注'};
class Db {
 calls:{sql:string;params:unknown[]}[]=[];
 async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>{
  this.calls.push({sql,params});
  if(sql.startsWith('UPDATE sample_cards SET reprint_revision='))return [{affectedRows:2},[]];
  throw Error('Unexpected SQL '+sql);
 }
}
test('AC-98 no-op or non-printable remark change never raises a reprint marker',async()=>{
 const db=new Db();
 assert.equal(await markCardsForReprintOnFabricChange(db,'23',base,{...base}),false);
 assert.equal(await markCardsForReprintOnFabricChange(db,'23',base,{...base,remark:'新备注'}),false);
 assert.deepEqual(db.calls,[]);
});
test('AC-98 missing optional phase-2 table does not break phase-one edits; other card failures never silently lose reprint work',async()=>{
 const prior={...base},next={...base,composition:'丝棉'};
 const missing={async query():Promise<[unknown,unknown]>{throw Object.assign(Error('missing'),{code:'ER_NO_SUCH_TABLE'});}};
 assert.equal(await markCardsForReprintOnFabricChange(missing,'23',prior,next),false);
 const forbidden={async query():Promise<[unknown,unknown]>{throw Object.assign(Error('private error'),{code:'ER_TABLEACCESS_DENIED_ERROR'});}};
 await assert.rejects(markCardsForReprintOnFabricChange(forbidden,'23',prior,next),/private error/);
});
test('AC-98 each changed printed field marks every current card referencing fabric, once per save',async()=>{
 for(const changed of [
  {fabricName:'真丝乔其'}, {composition:'93%丝 7%涤'}, {weightValue:18},
  {weightUnit:'gsm' as const},{widthValue:150}
 ]){
  const db=new Db(),newValue={...base,...changed};
  assert.equal(await markCardsForReprintOnFabricChange(db,'23',base,newValue),true);
  assert.equal(db.calls.length,1);
  assert.match(db.calls[0].sql,/UPDATE sample_cards SET reprint_revision=reprint_revision\+1/);
  assert.match(db.calls[0].sql,/fabric_id=\? AND deleted_at IS NULL/);
  assert.deepEqual(db.calls[0].params,['23']);
 }
});
