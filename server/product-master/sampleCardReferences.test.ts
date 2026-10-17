import assert from 'node:assert/strict';
import test from 'node:test';
import {hasSampleCardReference} from './sampleCardReferences';

test('B2-3 card reference helper uses one current locking read of every card status',async()=>{
 for(const kind of ['master','fabric'] as const){
  const calls:{sql:string;params:unknown[]|undefined}[]=[];
  const db={query:async(sql:string,params?:unknown[]):Promise<[unknown,unknown]>=>{
   calls.push({sql,params});return [[{id:'7'}],[]];
  }};
  assert.equal(await hasSampleCardReference(db,kind,'23'),true);
  assert.deepEqual(calls,[{sql:'SELECT id FROM sample_cards WHERE '+(kind==='master'?'master_id':'fabric_id')+
   '=? LIMIT 1 FOR SHARE',params:['23']}]);
 }
 const db={query:async():Promise<[unknown,unknown]>=>[[],[]]};
 assert.equal(await hasSampleCardReference(db,'master','23'),false);
});
test('B2-3 helper only tolerates its own single-table missing-table error',async()=>{
 for(const kind of ['master','fabric'] as const){
  let count=0;
  const db={query:async(sql:string):Promise<[unknown,unknown]>=>{
   count++;assert.equal((sql.match(/sample_cards/g)??[]).length,1);assert(!sql.includes('JOIN'));
   throw Object.assign(Error('PRIVATE SQL'),{code:'ER_NO_SUCH_TABLE'});
  }};
  assert.equal(await hasSampleCardReference(db,kind,'23'),false);assert.equal(count,1);
 }
});
test('B2-3 helper driver and malformed result failures are safe and closed',async()=>{
 for(const code of ['ER_BAD_FIELD_ERROR','ER_TABLEACCESS_DENIED_ERROR','ER_LOCK_DEADLOCK',
  'ER_DUP_ENTRY','ER_ROW_IS_REFERENCED_2','DRIVER_FAILURE',undefined]){
  const db={query:async():Promise<[unknown,unknown]>=>{
   throw Object.assign(Error('PRIVATE SELECT sample_cards'),{code});
  }};
  await assert.rejects(hasSampleCardReference(db,'fabric','23'),error=>
   error instanceof Error&&error.message==='Sample card references unavailable'&&!Object.hasOwn(error,'code'));
 }
 for(const raw of [null,{},[{fabric_id:'23'}],[null]]){
  const db={query:async():Promise<[unknown,unknown]>=>[raw,[]]};
  await assert.rejects(hasSampleCardReference(db,'master','23'),/Sample card references unavailable/);
 }
});
