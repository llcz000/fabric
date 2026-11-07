import test from 'node:test';import assert from 'node:assert/strict';import {migrateSampleCardReview,verifySampleCardReviewSchema} from './sessionCardReviewSchema';
test('review schema migration requires target identity and backup, adds only the nullable JSON column and repeats safely',async()=>{
 let column=false,applied=false,ddl=0;const target={database:'fabric_db',serverUuid:'a937ff09-72b6-11f1-b04e-52540034488b'};
 const db={query:async(sql:string,args:unknown[]=[]):Promise<[any,any]>=>{
 if(sql.includes('DATABASE() AS database_name'))return [[{database_name:target.database,server_uuid:target.serverUuid}],[]];
 if(sql.includes('GET_LOCK'))return [[{acquired:1}],[]];if(sql.includes('RELEASE_LOCK'))return [[],[]];
 if(sql.includes('INFORMATION_SCHEMA.COLUMNS'))return [column?[{COLUMN_NAME:'card_review',COLUMN_TYPE:'json',IS_NULLABLE:'YES'}]:[],[]];
 if(sql.startsWith('SELECT plan_sha256'))return [applied?[{plan_sha256:plan,applied_at:'done'}]:[],[]];
 if(sql.startsWith('ALTER TABLE')){ddl++;assert.match(sql,/customer_sample_sessions ADD COLUMN card_review JSON NULL/);column=true;return [[],[]];}
 if(sql.startsWith('UPDATE fabric_v2'))applied=true;return [[],[]];
 }};let plan='';
 await assert.rejects(migrateSampleCardReview(db,target,'no-backup'),/backup/i);await assert.rejects(verifySampleCardReviewSchema(db),/schema/i);
 const first=await migrateSampleCardReview(db,target,'a'.repeat(64));plan=first.planSha256;assert.equal(ddl,1);assert.equal(first.alreadyApplied,false);assert.equal((await migrateSampleCardReview(db,target,'a'.repeat(64))).alreadyApplied,true);assert.equal(ddl,1);
});
