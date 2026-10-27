import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import type {Server} from 'node:http';
import {hashSessionToken} from '../access/password';
import {createColorwayIdentityRouter} from './colorwayIdentityRoutes';

const token='a'.repeat(64);
class Database {
 deletionEvents:string[]=[];
 next=1;nextId=100;items:Record<string,unknown>[]=[];grant=true;active=true;session=true;fail=false;revokeAfterHttp=false;role='sales';referenced=false;commits=0;
 async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>{
  if(this.fail)throw Error('secret database credentials');
  if(sql.includes('JOIN v2_access_users')){
   if(!this.active||!this.session||params[0]!==hashSessionToken(token))return [[],[]];
   return [[{user_id:'2',username:'sales',display_name:'Sales',role:this.role,can_manage_own_orders:0,can_manage_products:this.grant?1:0,session_id:'9'}],[]];
  }
  if(sql.includes('FROM v2_access_users'))return [this.active?[{id:'2',role:this.role,is_active:1,can_manage_products:this.revokeAfterHttp?0:this.grant?1:0}]:[],[]];
  if(sql.includes('FROM v2_access_sessions'))return [this.session?[{id:'9'}]:[],[]];
  if(sql.startsWith('INSERT INTO business_delete_events')){this.deletionEvents.push(String(params[1]));return [{affectedRows:1},[]];}
  if(sql.includes('FROM pattern_masters'))return [params[0]==='1'?[{id:'1',master_no:'1234',next_colorway_no:String(this.next)}]:[],[]];
  if(sql.startsWith('UPDATE pattern_masters')){this.next++;return [{affectedRows:1},[]];}
  if(sql.startsWith('INSERT INTO pattern_colorways')){
   const id=String(this.nextId++);this.items.push({id,master_id:'1',colorway_no:Number(params[1]),remark:params[2],is_active:params[3],pattern_image_asset_id:null});return [{insertId:id},[]];
  }
  if(sql.startsWith('SELECT')&&sql.includes('FROM pattern_colorways'))return [this.items.filter(r=>sql.includes('master_id=?')?r.master_id===params[0]:r.id===params[0]),[]];
  if(sql.startsWith('UPDATE pattern_colorways')){const r=this.items.find(i=>i.id===params[2])!;r.remark=params[0];r.is_active=params[1];return [{affectedRows:1},[]];}
  if(sql.includes('FROM v2_products'))return [this.referenced?[{id:'8'}]:[],[]];
  if(sql.startsWith('DELETE FROM pattern_colorways')){const old=this.items.length;this.items=this.items.filter(r=>r.id!==params[0]);return [{affectedRows:old-this.items.length},[]];}
  throw Error('Unexpected SQL '+sql);
 }
 async getConnection(){const snapshot={next:this.next,items:structuredClone(this.items),deletionEvents:[...this.deletionEvents]};
  return {query:this.query.bind(this),beginTransaction:async()=>{},commit:async()=>{this.commits++;},rollback:async()=>{this.next=snapshot.next;this.items=snapshot.items;this.deletionEvents=snapshot.deletionEvents;},release(){}};
 }
}
async function withServer(db:Database,action:(base:string)=>Promise<void>){
 const app=express();app.use('/api/v2',createColorwayIdentityRouter(db,db));
 const server:Server=await new Promise((resolve,reject)=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));s.once('error',reject);});
 try{const address=server.address();assert(address&&typeof address!=='string');await action('http://127.0.0.1:'+address.port);}
 finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
}
async function send(base:string,path:string,method='GET',body?:unknown,bearer:string|null=token){
 return fetch(base+'/api/v2'+path,{method,headers:{...(bearer?{authorization:'Bearer '+bearer}:{}),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
}
const collection='/pattern-masters/1/colorways';
test('HTTP AC-71 persisted identities and immutable update, deletion gaps and read-only preview',async()=>{
 const db=new Database();await withServer(db,async base=>{
  for(let n=1;n<=6;n++){const r=await send(base,collection,'POST',{});assert.equal(r.status,201);const body=await r.json() as {colorwayNo:number;patternNo:string};assert.equal(body.colorwayNo,n);assert.equal(body.patternNo,'1234-'+n);}
  assert.equal((await send(base,'/pattern-colorways/100','PATCH',{colorwayNo:99})).status,400);
  const before=structuredClone(db.items),commits=db.commits;
  assert.equal((await send(base,'/pattern-colorways/100','PATCH',{remark:'must not save',isActive:false})).status,400);
  assert.deepEqual(db.items,before);assert.equal(db.commits,commits);
  const patch=await send(base,'/pattern-colorways/100','PATCH',{remark:'revised'});assert.equal(patch.status,200);
  const revised=await patch.json() as {colorwayNo:number;remark:string;isActive:boolean};assert.equal(revised.colorwayNo,1);assert.equal(revised.remark,'revised');assert.equal(revised.isActive,true);
  assert.equal((await send(base,'/pattern-colorways/101','DELETE')).status,200);
  assert.deepEqual(db.deletionEvents,['101']);
  const next=await send(base,collection,'POST',{});assert.equal((await next.json() as {colorwayNo:number}).colorwayNo,7);
  const read=await send(base,collection);assert.equal(read.status,200);assert.equal(read.headers.get('cache-control'),'no-store');
  const list=await read.json() as {items:{colorwayNo:number}[];nextColorwayNo:number};assert.equal(list.nextColorwayNo,8);assert.deepEqual(list.items.map(i=>i.colorwayNo),[1,3,4,5,6,7]);assert.equal(db.next,8);
 });
});
test('HTTP read requires bearer and writes use live role rather than old grant',async()=>{
 const db=new Database();await withServer(db,async base=>{
  assert.equal((await send(base,collection,'GET',undefined,null)).status,401);
  assert.equal((await send(base,collection,'GET',undefined,'b'.repeat(64))).status,401);
  db.grant=false;assert.equal((await send(base,collection)).status,200);
  assert.equal((await send(base,collection,'POST',{})).status,201);
  db.grant=true;db.revokeAfterHttp=true;assert.equal((await send(base,collection,'POST',{})).status,201);assert.equal(db.next,3);
  db.active=false;assert.equal((await send(base,collection)).status,401);
 });
});
test('HTTP invalid input, missing IDs, references and database failures have safe status codes',async()=>{
 const db=new Database();await withServer(db,async base=>{
  assert.equal((await send(base,collection,'POST',{isActive:1})).status,400);
  assert.equal((await send(base,'/pattern-masters/2/colorways','POST',{})).status,404);
  assert.equal((await send(base,'/pattern-colorways/400','PATCH',{})).status,404);
  assert.equal((await send(base,collection,'POST',{})).status,201);db.referenced=true;
  assert.equal((await send(base,'/pattern-colorways/100','DELETE')).status,409);
  db.fail=true;const r=await send(base,collection);assert.equal(r.status,503);assert(!JSON.stringify(await r.json()).includes('secret'));
 });
});
test('HTTP admin management does not depend on sales grant flag',async()=>{
 const db=new Database();db.role='admin';db.grant=false;await withServer(db,async base=>{
  assert.equal((await send(base,collection,'POST',{})).status,201);assert.equal(db.commits,1);
 });
});
test('HTTP malformed JSON, oversized bodies and unsupported content type return safe JSON without stack traces',async()=>{
 const db=new Database();await withServer(db,async base=>{
  for(const [contentType,body,status] of [
   ['application/json','{"remark":',400],
   ['application/json',JSON.stringify({remark:'x'.repeat(20000)}),413],
   ['text/plain','{"remark":"hello"}',400]
  ] as const){
   const response=await fetch(base+'/api/v2'+collection,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':contentType},body});
   assert.equal(response.status,status);assert.match(response.headers.get('content-type')??'',/^application\/json/);
   const payload=await response.json() as {error:string};assert.equal(typeof payload.error,'string');
   assert(!JSON.stringify(payload).includes('SyntaxError'));assert(!JSON.stringify(payload).includes('at '));
  }
  assert.equal(db.next,1);assert.equal(db.items.length,0);
 });
});
