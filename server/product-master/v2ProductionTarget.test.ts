import assert from 'node:assert/strict';
import test from 'node:test';
import {resolveV2ProductionTarget,createPinnedV2Database} from './v2ProductionTarget';
const UUID='a937ff09-72b6-11f1-b04e-52540034488b';
const env={FABRIC_V2_RUNTIME:'production',FABRIC_V2_EXPECTED_DATABASE:'fabric_db',DB_DATABASE:'fabric_db',FABRIC_V2_EXPECTED_UUID:UUID,FABRIC_V2_LEGACY_ROUTE_MODE:'deny_legacy'};
test('production target is opt in, independent expected target required, malformed modes fail closed',()=>{
 assert.equal(resolveV2ProductionTarget({}),null);
 assert.deepEqual(resolveV2ProductionTarget(env),{database:'fabric_db',serverUuid:UUID});
 for(const change of [{FABRIC_V2_RUNTIME:'prod'},{FABRIC_V2_EXPECTED_DATABASE:''},{DB_DATABASE:'wrong'},{FABRIC_V2_EXPECTED_UUID:''},{FABRIC_V2_LEGACY_ROUTE_MODE:'legacy'},{FABRIC_V2_LEGACY_ROUTE_MODE:'v2'}])
  assert.throws(()=>resolveV2ProductionTarget({...env,...change}));
});
test('every read and transaction verify the actual same physical connection before business SQL',async()=>{
 const calls:string[]=[];let current=UUID,released=0;
 const connection={async query(sql:string){calls.push(sql);return [[{database_name:'fabric_db',server_uuid:current}],[]] as [unknown,unknown];},async beginTransaction(){calls.push('BEGIN');},async commit(){},async rollback(){},release(){released++;}};
 const db=createPinnedV2Database({async getConnection(){return connection;}},resolveV2ProductionTarget(env)!);
 await db.query('SELECT business');assert.match(calls[0],/DATABASE/);assert.equal(calls[1],'SELECT business');assert.equal(released,1);
 const tx=await db.getConnection();await tx.beginTransaction();tx.release();assert.match(calls[2],/DATABASE/);assert.equal(calls[3],'BEGIN');
 current='wrong';await assert.rejects(db.query('UPDATE business'),/unavailable/);assert(!calls.includes('UPDATE business'));assert.equal(released,3);
});
test('identity metadata errors are redacted and checked out connection is released',async()=>{
 let released=0;const db=createPinnedV2Database({async getConnection(){return {async query(){throw Error('secret credentials');},async beginTransaction(){},async commit(){},async rollback(){},release(){released++;}};}},resolveV2ProductionTarget(env)!);
 await assert.rejects(db.getConnection(),error=>error instanceof Error&&error.message==='V2 storage unavailable');assert.equal(released,1);
});
