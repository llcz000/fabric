import assert from 'node:assert/strict';
import test from 'node:test';
import {migrateV2Production} from './v2ProductionMigration';
const target={database:'fabric_db',serverUuid:'a937ff09-72b6-11f1-b04e-52540034488b'};
test('migration requires backup reference before any SQL',async()=>{
 const calls:string[]=[];const db={async query(sql:string){calls.push(sql);return [[],[]] as [unknown,unknown];}};
 await assert.rejects(migrateV2Production(db,target,{backupSha256:'',confirmation:'APPLY_ADDITIVE_V2'}));assert.equal(calls.length,0);
});
test('migration refuses wrong physical target before any DDL',async()=>{
 const calls:string[]=[];const db={async query(sql:string){calls.push(sql);return [[{database_name:'other',server_uuid:target.serverUuid}],[]] as [unknown,unknown];}};
 await assert.rejects(migrateV2Production(db,target,{backupSha256:'a'.repeat(64),confirmation:'APPLY_ADDITIVE_V2'}));assert.equal(calls.length,1);assert(!calls.some(s=>/CREATE|ALTER/.test(s)));
});
test('migration refuses lock contention without writing and does not release another connection lock',async()=>{
 const calls:string[]=[];const db={async query(sql:string){calls.push(sql);return [sql.includes('DATABASE()')?[{database_name:target.database,server_uuid:target.serverUuid}]:[{acquired:0}],[]] as [unknown,unknown];}};
 await assert.rejects(migrateV2Production(db,target,{backupSha256:'a'.repeat(64),confirmation:'APPLY_ADDITIVE_V2'}),/lock/);
 assert(!calls.some(s=>/CREATE|ALTER|RELEASE_LOCK/.test(s)));
});
