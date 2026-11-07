import test from 'node:test';import assert from 'node:assert/strict';import {migrateSampleContactIdentity,verifySampleContactIdentitySchema} from './sessionContactIdentitySchema';
test('contact schema migration requires target identity and backup, adds only the nullable contact column and repeats safely',async()=>{
 let column=false,applied=false,ddl=0;const target={database:'fabric_db',serverUuid:'a937ff09-72b6-11f1-b04e-52540034488b'};
 const db={query:async(sql:string,args:unknown[]=[]):Promise<[any,any]>=>{
 if(sql.includes('DATABASE() AS database_name'))return [[{database_name:target.database,server_uuid:target.serverUuid}],[]];
 if(sql.includes('GET_LOCK'))return [[{acquired:1}],[]];if(sql.includes('RELEASE_LOCK'))return [[],[]];
 if(sql.includes('INFORMATION_SCHEMA.COLUMNS'))return [column?[{COLUMN_NAME:'contact_id',COLUMN_TYPE:'char(32)',IS_NULLABLE:'YES'}]:[],[]];
 if(sql.startsWith('SELECT plan_sha256'))return [applied?[{plan_sha256:plan,applied_at:'done'}]:[],[]];
 if(sql.startsWith('ALTER TABLE')){ddl++;assert.match(sql,/customer_sample_sessions ADD COLUMN contact_id CHAR\(32\) NULL/);column=true;return [[],[]];}
 if(sql.startsWith('UPDATE fabric_v2'))applied=true;return [[],[]];
 }};let plan='';
 await assert.rejects(migrateSampleContactIdentity(db,target,'no-backup'),/backup/i);await assert.rejects(verifySampleContactIdentitySchema(db),/schema/i);
 const first=await migrateSampleContactIdentity(db,target,'a'.repeat(64));plan=first.planSha256;assert.equal(ddl,1);assert.equal(first.alreadyApplied,false);assert.equal((await migrateSampleContactIdentity(db,target,'a'.repeat(64))).alreadyApplied,true);assert.equal(ddl,1);
});
