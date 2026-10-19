import test from 'node:test';
import assert from 'node:assert/strict';
import {recordAdminDocumentAction} from './documentAudit';
const admin={role:'admin',userId:'1',sessionId:'9'} as any;
test('admin edit/delete of other or unknown legacy owner appends original ownership inside caller transaction',async()=>{
 const calls:{sql:string;args:unknown[]}[]=[];const db={async query(sql:string,args:unknown[]=[]):Promise<[unknown,unknown]>{calls.push({sql,args});return [{affectedRows:1},[]];}};
 for(const action of ['edit','delete'] as const)for(const owner of ['2',null])await recordAdminDocumentAction(db,admin,'41',owner,action);
 assert.equal(calls.length,4);assert(calls.every(c=>c.sql.startsWith('INSERT INTO v2_document_audit_events')&&c.sql.includes('SELECT')&&!c.sql.includes('UPDATE')));
 assert(calls.some(c=>c.args.includes(null)));assert(calls.some(c=>c.args.includes('2')));
 await recordAdminDocumentAction(db,admin,'41','1','edit');await recordAdminDocumentAction(db,{...admin,role:'sales'},'41','1','delete');assert.equal(calls.length,4);
 await assert.rejects(()=>recordAdminDocumentAction({async query(){throw Error('audit storage unavailable');}},admin,'41','2','delete'));
});
