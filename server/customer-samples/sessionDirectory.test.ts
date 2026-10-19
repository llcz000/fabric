import assert from 'node:assert/strict';
import test from 'node:test';
import {createSampleSession,listSampleSessions,readShipmentProgress,changeSampleSessionStatus,updateSampleSession,deleteSampleSession} from './sessionDirectory';
import type {AppPrincipal} from '../access/types';
const actor={userId:'6',sessionId:'9',role:'sales'} as AppPrincipal;
class Db{
 deleted=false;name='客户甲';
 status:'open'|'closed'='open';conflict=false;
 active=true;login=true;grant=true;failGrant=false;commits=0;rollbacks=0;calls:{sql:string;args:unknown[]}[]=[];
 async getConnection(){return {beginTransaction:async()=>{},commit:async()=>{this.commits++;},rollback:async()=>{this.rollbacks++;},release:()=>{},query:async(sql:string,args:unknown[]=[]):Promise<[unknown,unknown]>=>{
  this.calls.push({sql,args});
  if(sql.startsWith('SELECT id,customer_reference,status'))return [this.deleted?[]:[{id:'41',customer_reference:this.name,status:this.status}],[]];
  if(sql.startsWith('UPDATE customer_sample_sessions SET customer_reference=')){if(this.conflict)return [{affectedRows:0},[]];this.name=String(args[0]);return [{affectedRows:1},[]];}
  if(sql.startsWith('UPDATE customer_sample_sessions SET deleted_at=')){this.deleted=true;return [{affectedRows:1},[]];}
  if(sql.startsWith('UPDATE customer_sample_sessions SET status=')){if(this.conflict)return [{affectedRows:0},[]];this.status=args[0] as typeof this.status;return [{affectedRows:1},[]];}
  if(sql.includes('FROM v2_access_users'))return [this.active?[{role:'sales',is_active:1}]:[],[]];
  if(sql.includes('FROM v2_access_sessions'))return [this.login?[{id:'9'}]:[],[]];
  if(sql.startsWith('INSERT INTO customer_sample_sessions'))return [{affectedRows:1,insertId:'41'},[]];
  if(sql.startsWith('INSERT INTO customer_sample_session_access')){if(this.failGrant)throw Error('db secret');return [{affectedRows:1},[]];}
  if(sql.includes('SELECT id,status FROM customer_sample_sessions'))return [this.deleted?[]:[{id:'41',status:this.status}],[]];
  if(sql.includes('SELECT can_manage'))return [this.grant?[{can_manage:1}]:[],[]];
  if(sql.includes('AS shipped_quantity'))return [[{selected_products:'2',shipped_products:'1',shipped_quantity:'7'}],[]];
  if(sql.includes('COUNT(*) AS total'))return [[{total:this.deleted?'0':'1'}],[]];
  if(sql.includes('customer_sample_session_access'))return [this.deleted?[]:[{id:'41',customer_reference:this.name,status:'open',created_on:'2026-10-18'}],[]];
  throw Error('Unexpected SQL '+sql);
 }};}
}

test('selection rename uses current name CAS; deletion is a timestamp/actor marker without losing history and disappears from reads',async()=>{
 const db=new Db();assert.equal((await updateSampleSession(db,actor,'41',{customerReference:'客户乙',expectedCustomerReference:'客户甲'})).customerReference,'客户乙');
 await assert.rejects(updateSampleSession(db,actor,'41',{customerReference:'错误覆盖',expectedCustomerReference:'客户甲'}));
 const before=db.calls.length;await deleteSampleSession(db,actor,'41');
 assert(db.calls.slice(before).some(c=>c.sql.includes('deleted_at=UTC_TIMESTAMP()')&&c.args[0]==='6'));
 assert(!db.calls.some(c=>/^DELETE FROM|UPDATE customer_sample_items|UPDATE sample_ship/.test(c.sql)));
 assert.equal((await listSampleSessions(db,actor,{})).items.length,0);
 await assert.rejects(readShipmentProgress(db,actor,'41'));await assert.rejects(changeSampleSessionStatus(db,actor,'41',{expectedStatus:'closed',status:'open'}));
 const denied=new Db();denied.grant=false;await assert.rejects(deleteSampleSession(denied,actor,'41'));assert(!denied.deleted);
});

test('close/reopen require locked current identity, explicit grant and expected state, conflicts roll back',async()=>{
 const db=new Db();assert.equal((await changeSampleSessionStatus(db,actor,'41',{expectedStatus:'open',status:'closed'})).status,'closed');
 assert.equal((await changeSampleSessionStatus(db,actor,'41',{expectedStatus:'closed',status:'open'})).status,'open');
 assert(db.calls.some(c=>c.sql.includes('can_manage')&&c.sql.includes('FOR UPDATE')));
 for(const setup of [(d:Db)=>{d.grant=false;},(d:Db)=>{d.login=false;},(d:Db)=>{d.status='closed';},(d:Db)=>{d.conflict=true;}]){
  const denied=new Db();setup(denied);await assert.rejects(changeSampleSessionStatus(denied,actor,'41',{expectedStatus:'open',status:'closed'}));assert.equal(denied.commits,0);assert.equal(denied.rollbacks,1);
 }
});
test('new customer selection stores actor and its explicit grant in one transaction',async()=>{
 const db=new Db();assert.deepEqual(await createSampleSession(db,actor,{customerReference:' 客户甲 '}),{id:'41',customerReference:'客户甲',status:'open'});
 assert.deepEqual(db.calls.find(x=>x.sql.startsWith('INSERT INTO customer_sample_sessions'))?.args,['客户甲','6']);
 assert.deepEqual(db.calls.find(x=>x.sql.startsWith('INSERT INTO customer_sample_session_access'))?.args,['41','6']);assert.equal(db.commits,1);
});
test('new session grant failure rolls back and invalid customer/spoofed owner performs no writes',async()=>{
 const db=new Db();db.failGrant=true;await assert.rejects(createSampleSession(db,actor,{customerReference:'客户甲'}));assert.equal(db.rollbacks,1);
 for(const input of [{customerReference:''},{customerReference:'客户',ownerId:'7'},{customerReference:'x\n'},{customerReference:'a'.repeat(161)}]){
  const clean=new Db();await assert.rejects(createSampleSession(clean,actor,input));assert.equal(clean.calls.length,0);
 }
});
test('directory filters by current explicit grant and safely binds literal search/pagination',async()=>{
 const db=new Db();const result=await listSampleSessions(db,actor,{query:'客%_',limit:20,offset:0});assert.equal(result.items[0].id,'41');
 const queries=db.calls.filter(x=>x.sql.includes('customer_sample_session_access'));
 assert.equal(queries.length,2);assert(queries.every(x=>x.sql.includes('a.user_id=?')&&x.sql.includes('a.can_manage=1')));
 assert.deepEqual(queries[0].args,['6','%客!%!_%']);assert.equal(db.commits,1);
});
test('revoked or disabled identities cannot list/create, and missing session grant cannot expose progress',async()=>{
 for(const property of ['active','login'] as const){const db=new Db();db[property]=false;await assert.rejects(listSampleSessions(db,actor,{}));assert.equal(db.commits,0);}
 const db=new Db();db.grant=false;await assert.rejects(readShipmentProgress(db,actor,'41'));assert(!db.calls.some(x=>x.sql.includes('AS shipped_quantity')));
});
test('shipment progress counts complete current selection and all actual batches, including historical shipped quantity',async()=>{
 const db=new Db();assert.deepEqual(await readShipmentProgress(db,actor,'41'),{sessionId:'41',selectedProducts:2,shippedProducts:1,pendingProducts:1,shippedQuantity:7});
 const query=db.calls.find(x=>x.sql.includes('AS shipped_quantity'))!;assert(query.sql.includes('removed_at IS NULL'));assert(!query.sql.includes('LIMIT'));assert(query.sql.includes('SUM(si.quantity)'));
});

test('directory returns stored creation date without changing grant, sorting or records',async()=>{
 const db=new Db(),result=await listSampleSessions(db,actor,{});assert.equal((result.items[0] as {createdOn?:string}).createdOn,'2026-10-18');
 const query=db.calls.find(x=>x.sql.includes('ORDER BY s.id DESC'))!;assert(query.sql.includes("DATE_FORMAT(s.created_at,'%Y-%m-%d') AS created_on"));assert(!db.calls.some(x=>/^(UPDATE|INSERT|DELETE)/.test(x.sql)));
});
