import assert from 'node:assert/strict';
import test from 'node:test';
import {assertFreshB25SandboxTarget,assertB25ConnectedSandbox,B25_SANDBOX_NAME} from './b25SandboxGuard';

const trustedUuid='3f3fa763-c4b5-4f65-99b8-95ae90e912a4';
const untrustedUuid='5555061d-e5db-4904-a81a-71ef0d53dcea';
const ack='I_ACKNOWLEDGE_B25_DISPOSABLE_TEST';
function root(actualUuid=trustedUuid){
 const sqls:string[]=[];
 return {sqls,query:async(sql:string):Promise<[unknown,unknown]>=>{
  sqls.push(sql);
  if(sql.startsWith('SELECT DATABASE() AS selected_database, VERSION()'))
   return [[{selected_database:null,mysql_version:'8.0.46',server_uuid:actualUuid}],[]];
  if(sql.startsWith('SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA'))
   return [[],[]];
  throw Error('Unexpected SQL');
 }};
}
function pool(selected:string|null=B25_SANDBOX_NAME,serverUuid=trustedUuid){
 const sqls:string[]=[];
 return {sqls,query:async(sql:string):Promise<[unknown,unknown]>=>{
  sqls.push(sql);
  if(sql==='SELECT DATABASE() AS selected_database, @@server_uuid AS server_uuid')
   return [[{selected_database:selected,server_uuid:serverUuid}],[]];
  throw Error('Unexpected SQL');
 }};
}
test('B2-5g fail closed before remote lookup when target MySQL server UUID is missing/malformed',async()=>{
 for(const expected of ['',undefined,'my-server','not-a-uuid']){
  const db=root();
  await assert.rejects(assertFreshB25SandboxTarget(db,ack,expected as string),/UUID|identity|server/i);
  assert.deepEqual(db.sqls,[]);
 }
});
test('B2-5g do not create fresh sandbox on an unexpected MySQL 8 server even with explicit acknowledgment',async()=>{
 const db=root(untrustedUuid);
 await assert.rejects(assertFreshB25SandboxTarget(db,ack,trustedUuid),/UUID|identity|server/i);
 assert.equal(db.sqls.length,1,'No schema probe after server mismatch');
});
test('B2-5g accepts explicitly pinned current server UUID and probes fixed fresh sandbox',async()=>{
 const db=root();
 assert.equal(await assertFreshB25SandboxTarget(db,ack,trustedUuid),B25_SANDBOX_NAME);
 assert.equal(db.sqls.length,2);
});
test('B2-5g pooled connection must still point at same actual server and disposable schema before ANY table creation',async()=>{
 const target=pool();
 await assertB25ConnectedSandbox(target,trustedUuid);
 assert.deepEqual(target.sqls,['SELECT DATABASE() AS selected_database, @@server_uuid AS server_uuid']);
 for(const other of [pool('company_production'),pool(B25_SANDBOX_NAME,untrustedUuid),pool(null)]){
  await assert.rejects(assertB25ConnectedSandbox(other,trustedUuid),/UUID|identity|server|sandbox/i);
  assert.equal(other.sqls.length,1);
 }
});
test('B2-5g malformed pooled database metadata cannot pass a sandbox identity check',async()=>{
 for(const row of [[],[{selected_database:B25_SANDBOX_NAME}],null]){
  const db={query:async():Promise<[unknown,unknown]>=>[row,[]]};
  await assert.rejects(assertB25ConnectedSandbox(db,trustedUuid),/UUID|identity|server|sandbox/i);
 }
});
