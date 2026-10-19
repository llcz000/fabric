import test from 'node:test';
import assert from 'node:assert/strict';
import {migrateV2DocumentAudit,verifyV2DocumentAuditSchema} from './documentAuditSchema';
test('audit migration refuses wrong database before DDL and requires backup evidence',async()=>{
 const calls:string[]=[];const db={async query(sql:string):Promise<[unknown,unknown]>{calls.push(sql);return [[{database_name:'wrong',server_uuid:'wrong'}],[]];}},target={database:'fabric_db',serverUuid:'expected'};
 await assert.rejects(()=>migrateV2DocumentAudit(db,target,''));assert.equal(calls.length,0);
 await assert.rejects(()=>migrateV2DocumentAudit(db,target,'a'.repeat(64)));assert.equal(calls.length,1);assert(!calls.some(s=>/CREATE|INSERT|ALTER/.test(s)));
});
test('audit startup verification refuses absent or nontransactional schema without creating it',async()=>{
 const calls:string[]=[];await assert.rejects(()=>verifyV2DocumentAuditSchema({async query(sql){calls.push(sql);return [[],[]];}}));assert(calls.every(s=>s.startsWith('SELECT')));
});
