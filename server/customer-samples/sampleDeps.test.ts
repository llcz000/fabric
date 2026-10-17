import assert from 'node:assert/strict';
import test from 'node:test';
import type {AppPrincipal} from '../access/types';
import {createMySQLSampleScanDependencies,type SampleDb} from './sampleDeps';

const actor:AppPrincipal={role:'sales',userId:'6',username:'sales',displayName:'Sales',
 sessionId:'test',canManageProducts:true,canManageOwnOrders:true};
test('B2-2 SQL authorization requires explicit sample-session grant; unrelated product/order grants irrelevant',async()=>{
 const calls:{sql:string;params:unknown[]}[]=[];
 let granted=false;
 const db={async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>{
  calls.push({sql,params});
  return [granted?[{id:'11'}]:[],[]];
 }} as SampleDb;
 const deps=createMySQLSampleScanDependencies(db);
 assert.equal(await deps.authorize(actor,'11'),false);
 granted=true;
 assert.equal(await deps.authorize(actor,'11'),true);
 assert.deepEqual(calls[1].params,['11','6']);
 assert.match(calls[1].sql,/JOIN customer_sample_session_access/);
 assert.match(calls[1].sql,/a\.can_manage=1/);
 assert.match(calls[1].sql,/s\.status='open'/);
 assert.equal(await deps.authorize({...actor,role:'admin'},'11'),true);
 assert.equal(await deps.authorize({...actor,userId:'7'},'0'),false);
 assert.equal(calls.length,3,'invalid actor/ID must not query customer records');
});
