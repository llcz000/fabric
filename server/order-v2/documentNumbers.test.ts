import assert from 'node:assert/strict';
import test from 'node:test';
import {reserveV2DocumentNumber} from './documentNumbers';
const actor={userId:'7',sessionId:'11',role:'sales',username:'sales',displayName:'业务员',canManageOwnOrders:true,canManageProducts:true} as const;
test('durable document sequence advances beyond manual history and is not reused after deletion',async()=>{
 let next='1',highest='5';const calls:string[]=[];
 const connection={async beginTransaction(){},async commit(){},async rollback(){},release(){},async query(sql:string,args:unknown[]=[]){calls.push(sql);
  if(sql.includes('FROM v2_access_users'))return [[{id:'7',role:'sales',is_active:1}],[]] as [unknown,unknown];
  if(sql.includes('FROM v2_access_sessions'))return [[{id:'11'}],[]] as [unknown,unknown];
  if(sql.startsWith('INSERT INTO v2_document_number_counters'))return [{affectedRows:1},[]] as [unknown,unknown];
  if(sql.startsWith('SELECT next_number'))return [[{next_number:next}],[]] as [unknown,unknown];
  if(sql.startsWith('SELECT COALESCE(MAX'))return [[{highest}],[]] as [unknown,unknown];
  if(sql.startsWith('UPDATE v2_document_number_counters')){next=String(args[0]);return [{affectedRows:1},[]] as [unknown,unknown];}
  throw Error('Unexpected SQL');
 }};
 const pool={async getConnection(){return connection;}};
 assert.equal(await reserveV2DocumentNumber(pool,actor,{type:'sample',date:'2026-10-17'}),'YB-20261017-006');
 highest='0';assert.equal(await reserveV2DocumentNumber(pool,actor,{type:'sample',date:'2026-10-17'}),'YB-20261017-007');
 assert(!calls.some(s=>/^(UPDATE|DELETE FROM) orders/.test(s)));
});
test('invalid calendar dates or unknown type do not acquire storage',async()=>{
 let leases=0;const pool={async getConnection(){leases++;throw Error('unexpected');}};
 for(const value of [{type:'sample',date:'2026-02-30'},{type:'unknown',date:'2026-10-17'}])await assert.rejects(reserveV2DocumentNumber(pool,actor,value));assert.equal(leases,0);
});
