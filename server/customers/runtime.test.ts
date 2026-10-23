import test from 'node:test';import assert from 'node:assert/strict';import {prepareCustomerRuntime} from './runtime';
const target={database:'fabric_db',serverUuid:'a937ff09-72b6-11f1-b04e-52540034488b'};
test('verified customer pool annotates every transaction; clean absent schema degrades, partial schema refuses legacy bypass',async()=>{
 for(const state of ['ready','absent','partial','metadata-error']){
  const calls:string[]=[];let releases=0;const pool={query:async()=>[[],[]] as [unknown,unknown],getConnection:async()=>({query:async(sql:string):Promise<[unknown,unknown]>=>{calls.push(sql);if(state==='metadata-error')throw Error('offline');return [state==='partial'?[{TABLE_NAME:'customer_session_links'}]:[],[]];},beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){releases++;}})};
  const v=await prepareCustomerRuntime(pool,target,async()=>{if(state!=='ready')throw Error('schema missing');});assert.equal(v.enabled,state==='ready');assert.equal(v.unavailable,state==='partial'||state==='metadata-error');if(v.enabled){const tx=await v.pool.getConnection();assert.equal((tx as {customerProfilesEnabled?:boolean}).customerProfilesEnabled,true);tx.release();}assert(calls.every(s=>s.startsWith('SELECT')));assert.equal(releases,1);
 }
});
