import test from 'node:test';
import assert from 'node:assert/strict';
import {migrateSessionLifecycle,verifySessionLifecycleSchema} from './sessionLifecycleSchema';
class Db{
 clause='((`deleted_at` is null) = (`deleted_by_user_id` is null))';
 columns:Record<string,unknown>[]=[];constraints:string[]=[];queries:string[]=[];ledger:Record<string,unknown>|null=null;wrong=false;
 async query(sql:string,args:unknown[]=[]):Promise<[unknown,unknown]>{
  this.queries.push(sql);
  if(sql.includes('INFORMATION_SCHEMA.CHECK_CONSTRAINTS'))return [[{CHECK_CLAUSE:this.clause}],[]];
  if(sql.includes('@@server_uuid'))return [[{database_name:this.wrong?'fabric_db':'fabric_v2_test_ui',server_uuid:'uuid'}],[]];
  if(sql.includes('GET_LOCK'))return [[{acquired:1}],[]];if(sql.includes('RELEASE_LOCK'))return [[{released:1}],[]];
  if(sql.includes('FROM fabric_v2_migration_ledger'))return [this.ledger?[this.ledger]:[],[]];
  if(sql.startsWith('INSERT IGNORE INTO fabric_v2_migration_ledger')){this.ledger={plan_sha256:args[1],applied_at:null};return [{affectedRows:1},[]];}
  if(sql.startsWith('UPDATE fabric_v2_migration_ledger')){this.ledger!.applied_at='now';return [{affectedRows:1},[]];}
  if(sql.includes('INFORMATION_SCHEMA.COLUMNS'))return [this.columns,[]];
  if(sql.includes('INFORMATION_SCHEMA.TABLE_CONSTRAINTS'))return [this.constraints.map(CONSTRAINT_NAME=>({CONSTRAINT_NAME,ENFORCED:'YES'})),[]];
  if(sql.includes('INFORMATION_SCHEMA.KEY_COLUMN_USAGE'))return [this.constraints.includes('fk_sample_session_deleted_actor')?[{COLUMN_NAME:'deleted_by_user_id',REFERENCED_TABLE_NAME:'v2_access_users',REFERENCED_COLUMN_NAME:'id',DELETE_RULE:'RESTRICT'}]:[],[]];
  if(sql.startsWith('ALTER TABLE')){
   if(sql.includes('ADD COLUMN deleted_at'))this.columns.push({COLUMN_NAME:'deleted_at',COLUMN_TYPE:'datetime',IS_NULLABLE:'YES'});
   if(sql.includes('ADD COLUMN deleted_by_user_id'))this.columns.push({COLUMN_NAME:'deleted_by_user_id',COLUMN_TYPE:'bigint unsigned',IS_NULLABLE:'YES'});
   if(sql.includes('ADD CONSTRAINT'))this.constraints.push(sql.match(/ADD CONSTRAINT (\w+)/)![1]);return [{},[]];
  }
  throw Error('Unexpected SQL '+sql);
 }
}
const target={database:'fabric_v2_test_ui',serverUuid:'uuid'} as never;
test('separate lifecycle migration requires backup/target/lock and repeats without changing immutable core plan or data',async()=>{
 const db=new Db();await assert.rejects(verifySessionLifecycleSchema(db));
 await migrateSessionLifecycle(db,target,'a'.repeat(64));await verifySessionLifecycleSchema(db);
 const first=db.queries.filter(q=>q.startsWith('ALTER TABLE')).length;assert.equal(first,4);
 await migrateSessionLifecycle(db,target,'a'.repeat(64));assert.equal(db.queries.filter(q=>q.startsWith('ALTER TABLE')).length,first);
 db.clause='(1)';await assert.rejects(verifySessionLifecycleSchema(db));await assert.rejects(migrateSessionLifecycle(db,target,'a'.repeat(64)));
 assert(!db.queries.some(q=>/^(DELETE|DROP|TRUNCATE|UPDATE customer)/.test(q)));
 const wrong=new Db();wrong.wrong=true;await assert.rejects(migrateSessionLifecycle(wrong,target,'a'.repeat(64)));assert(!wrong.queries.some(q=>q.startsWith('ALTER')));
 await assert.rejects(migrateSessionLifecycle(new Db(),target,'bad'));
});
