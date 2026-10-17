import test from 'node:test';import assert from 'node:assert/strict';
import {migratePatternShareLinks,PATTERN_SHARE_PLAN_SHA256} from './patternShareMigration';
import {verifyPatternLinkRuntimeSchema} from './patternLinkSchemaContract';
test('B1 operator migration requires separate explicit acknowledgement, verified digest and matching physical target before DDL',async()=>{
 const calls:string[]=[];const db={async query(sql:string):Promise<[unknown,unknown]>{calls.push(sql);return [[{database_name:'other',server_uuid:'a937ff09-72b6-11f1-b04e-52540034488b'}],[]];}};
 const target={database:'fabric_db',serverUuid:'a937ff09-72b6-11f1-b04e-52540034488b'};
 for(const [confirmation,sha] of [['APPLY_ADDITIVE_V2','a'.repeat(64)],['APPLY_B1_SHARE','bad']])await assert.rejects(migratePatternShareLinks(db,target,sha,confirmation));
 assert.equal(calls.length,0);await assert.rejects(migratePatternShareLinks(db,target,'a'.repeat(64),'APPLY_B1_SHARE'));assert.equal(calls.length,1);assert(!calls.some(x=>/CREATE|ALTER|INSERT/.test(x)));assert.match(PATTERN_SHARE_PLAN_SHA256,/^[a-f0-9]{64}$/);
});
test('B1 runtime schema gate rejects unconfigured identity without borrowing the sandbox exemption',async()=>{
 let opened=0;const pool={async getConnection(){opened++;throw Error('must not open');}};
 await assert.rejects(verifyPatternLinkRuntimeSchema(pool,{database:'fabric_db; DROP',serverUuid:'a937ff09-72b6-11f1-b04e-52540034488b'}));assert.equal(opened,0);
});
