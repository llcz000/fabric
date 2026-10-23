import test from 'node:test';
import assert from 'node:assert/strict';
import {withCatalogTransaction} from './catalogTransaction';
import type {AppPrincipal} from './types';
import type {Pool,TxConn} from '../order-v2/lines';

const actor:AppPrincipal={userId:'7',sessionId:'session',role:'sales',username:'sales',displayName:'Sales',canManageOwnOrders:false,canManageProducts:false};
class CatalogError extends Error {constructor(message:string,readonly status:number){super(message);}}
const error=(message:string,status:401|403)=>new CatalogError(message,status);
function fixture(options:{user?:unknown;session?:unknown;fail?:string}={}){
 const events:string[]=[];
 const connection:TxConn={
  async beginTransaction(){events.push('begin');if(options.fail==='begin')throw Error('begin failed');},
  async commit(){events.push('commit');if(options.fail==='commit')throw Error('commit failed');},
  async rollback(){events.push('rollback');if(options.fail==='rollback')throw Error('rollback failed');},
  release(){events.push('release');},
  async query(sql,params){
   assert.match(sql,/FOR SHARE$/);
   if(sql.includes('v2_access_users')){events.push('user');assert.deepEqual(params,['7']);return [options.user??[{id:'7',role:'sales',is_active:1,can_manage_products:0}],[]];}
   assert.match(sql,/revoked_at IS NULL AND expires_at>UTC_TIMESTAMP\(\)/);
   events.push('session');assert.deepEqual(params,['session','7']);return [options.session??[{id:'session'}],[]];
  },
 };
 const pool:Pool={async getConnection(){return connection;}};
 const run=(work:(db:TxConn)=>Promise<unknown>=async()=>{events.push('work');return 42;},principal=actor)=>
  withCatalogTransaction(pool,principal,error,'Insufficient catalog permissions',work);
 return {events,connection,run};
}
test('fresh sales role permits catalog work despite obsolete grant columns; locks precede work',async()=>{
 const f=fixture();assert.equal(await f.run(),42);
 assert.deepEqual(f.events,['begin','user','session','work','commit','release']);
});
test('admin retains catalog access with obsolete grants disabled',async()=>{
 const f=fixture({user:[{id:'7',role:'admin',is_active:1,can_manage_products:0}]});
 await f.run(undefined,{...actor,role:'admin'});assert.ok(f.events.includes('commit'));
});
for(const [name,options] of Object.entries({missing:{user:[]},inactive:{user:[{role:'sales',is_active:0}]},changedRole:{user:[{role:'admin',is_active:1}]},revokedSession:{session:[]}})){
 test(name+' denies work and rolls back',async()=>{
  const f=fixture(options);await assert.rejects(f.run(),(e:CatalogError)=>e.status===401);
  assert.ok(!f.events.includes('work'));assert.deepEqual(f.events.slice(-2),['rollback','release']);
 });
}
test('missing credentials issue no SQL',async()=>{
 const f=fixture();await assert.rejects(f.run(undefined,{...actor,sessionId:''}),(e:CatalogError)=>e.status===401);
 assert.deepEqual(f.events,['begin','rollback','release']);
});
test('unexpected persistent role is denied with the caller domain error',async()=>{
 const f=fixture({user:[{role:'other',is_active:1}]});
 await assert.rejects(f.run(undefined,{...actor,role:'other' as AppPrincipal['role']}),(e:CatalogError)=>e.status===403&&e.message==='Insufficient catalog permissions');
});
test('work failure rolls back once and releases',async()=>{
 const f=fixture();await assert.rejects(f.run(async()=>{throw Error('work failed');}),/work failed/);
 assert.deepEqual(f.events,['begin','user','session','rollback','release']);
});
for(const fail of ['begin','commit','rollback'])test(fail+' failure always releases the connection',async()=>{
 const f=fixture({fail});await assert.rejects(f.run(fail==='rollback'?async()=>{throw Error('work failed');}:undefined),new RegExp(fail+' failed'));
 assert.equal(f.events.filter(x=>x==='release').length,1);
 assert.equal(f.events.filter(x=>x==='rollback').length,fail==='begin'?0:1);
});
