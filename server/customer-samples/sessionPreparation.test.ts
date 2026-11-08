// AC-177
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import express from 'express';
import {IncomingMessage,ServerResponse} from 'node:http';
import {Socket} from 'node:net';
import {createSampleSessionDirectoryRouter} from './sessionDirectoryRoutes';

async function fixture(run:(f:{db:DatabaseSync;send:(ids:unknown,extra?:string,authenticated?:boolean)=>Promise<Response>;queries:string[]})=>Promise<void>){
 const db=new DatabaseSync(':memory:'),queries:string[]=[];
 db.exec(`CREATE TABLE customers(id INTEGER PRIMARY KEY,owner_user_id INTEGER,display_name TEXT,profile_json TEXT,archived_at TEXT,row_version INTEGER);
 CREATE TABLE customer_access(customer_id INTEGER,user_id INTEGER,permission TEXT);
 CREATE TABLE customer_session_links(session_id INTEGER,customer_id INTEGER,row_version INTEGER);
 CREATE TABLE customer_sample_sessions(id INTEGER PRIMARY KEY,status TEXT,deleted_at TEXT,card_review TEXT,customer_reference TEXT,contact_name TEXT,contact_id TEXT);
 CREATE TABLE customer_sample_items(id INTEGER PRIMARY KEY,session_id INTEGER,product_id INTEGER,removed_at TEXT);
 CREATE TABLE v2_products(id INTEGER PRIMARY KEY,product_no TEXT,row_version INTEGER,pattern_colorway_id INTEGER,fabric_id INTEGER);
 CREATE TABLE pattern_colorways(id INTEGER PRIMARY KEY,master_id INTEGER,colorway_no INTEGER,pattern_image_asset_id TEXT);
 CREATE TABLE pattern_masters(id INTEGER PRIMARY KEY,master_no TEXT);
 CREATE TABLE v2_fabrics(id INTEGER PRIMARY KEY,fabric_no TEXT,fabric_name TEXT,composition TEXT,weight_value REAL,weight_unit TEXT,width_value REAL);
 CREATE TABLE sample_cards(id INTEGER PRIMARY KEY,master_id INTEGER,fabric_id INTEGER,card_no TEXT,qr_payload TEXT,is_active INTEGER,deleted_at TEXT,reprint_revision INTEGER,printed_revision INTEGER);
 CREATE TABLE sample_card_tokens(card_id INTEGER,token_hash TEXT,revoked_at TEXT);
 CREATE TABLE customer_sample_item_sources(session_id INTEGER,product_id INTEGER,card_id INTEGER);
 CREATE TABLE customer_sample_manual_events(session_id INTEGER,product_id INTEGER,card_id INTEGER);
 INSERT INTO customers VALUES(1,6,'甲公司','{"displayName":"甲公司"}',NULL,1),(2,6,'乙公司','{"displayName":"乙公司"}',NULL,1),(3,8,'无权限公司','{"displayName":"无权限公司"}',NULL,1);
 INSERT INTO customer_sample_sessions VALUES(41,'open',NULL,NULL,'旧名','张','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),(42,'open',NULL,NULL,'甲公司','李','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),(43,'closed',NULL,NULL,'甲公司','张','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),(44,'open',NULL,NULL,'乙公司',NULL,NULL),(45,'open',NULL,NULL,'无权限公司','王',NULL),(46,'open',NULL,NULL,'甲公司','张','cccccccccccccccccccccccccccccccc');
 INSERT INTO customer_session_links VALUES(41,1,1),(42,1,1),(43,1,1),(44,2,1),(45,3,1),(46,1,1);
 INSERT INTO pattern_masters VALUES(1,'G0907');
 INSERT INTO pattern_colorways VALUES(1,1,1,'dddddddd-4444-4444-8444-000000000001'),(2,1,2,NULL);
 INSERT INTO v2_fabrics VALUES(1,'F018','雪纺',NULL,80,'gsm',145),(2,'F025','真丝',NULL,16,'mm',140);
 INSERT INTO v2_products VALUES(100,'G0907-1-F018',1,1,1),(101,'G0907-2-F018',1,2,1),(102,'G0907-1-F025',1,1,2),(103,'未选配色',1,2,2);
 INSERT INTO sample_cards VALUES(12,1,1,'G0907-F018','Preparation_Card_Token_1234567890',1,NULL,0,0),(13,1,2,'G0907-F025','Preparation_Card_Token_1234567891',1,NULL,0,0);
 INSERT INTO customer_sample_items VALUES(1,41,100,NULL),(2,42,100,NULL),(3,43,100,NULL),(4,44,100,NULL),(5,41,101,NULL),(6,42,102,NULL),(7,41,102,'removed'),(8,45,100,NULL),(9,46,100,NULL);
 INSERT INTO customer_sample_item_sources VALUES(41,100,12),(42,100,12),(43,100,12),(44,100,12),(41,101,12),(42,102,13),(45,100,12),(46,100,12);`);
 for(const [id,token] of [[12,'Preparation_Card_Token_1234567890'],[13,'Preparation_Card_Token_1234567891']] as const)db.prepare('INSERT INTO sample_card_tokens VALUES(?,?,NULL)').run(id,createHash('sha256').update(token).digest('hex'));
 const tx={customerProfilesEnabled:true,beginTransaction:async()=>{db.exec('BEGIN');},commit:async()=>{db.exec('COMMIT');},rollback:async()=>{db.exec('ROLLBACK');},release(){},query:async(sql:string,args:unknown[]=[]):Promise<[unknown,unknown]>=>{
  queries.push(sql);
  if(sql.includes('FROM v2_access_users'))return [[{id:6,role:'sales',is_active:1}],[]];
  if(sql.includes('FROM v2_access_sessions'))return [[{id:9}],[]];
  const clean=sql.replace(/FOR (?:SHARE|UPDATE)/g,'');
  assert.match(clean.trim(),/^SELECT/i,'summary must never write business data');
  return [db.prepare(clean).all(...args as any[]),[]];
 }};
 const app=express();app.use('/api/v2/customer-samples',createSampleSessionDirectoryRouter((req,res,next)=>{if(req.headers.authorization!=='test'){res.sendStatus(401);return;}res.locals.principal={userId:'6',sessionId:'9',role:'sales'};next();},{getConnection:async()=>tx},''));
 // Exercise the actual Express middleware/router with HTTP streams, without binding a TCP port.
 const send=(ids:unknown,extra='',authenticated=true)=>new Promise<Response>((resolve,reject)=>{
  const body=Buffer.from(JSON.stringify({sessionIds:ids})),req=new IncomingMessage(new Socket()),res=new ServerResponse(req);
  req.method='POST';req.url='/api/v2/customer-samples/sessions/preparation'+extra;
  req.headers={'content-type':'application/json','content-length':String(body.length),...(authenticated?{authorization:'test'}:{})};
  res.end=((chunk?:any)=>{resolve(new Response(chunk??null,{status:res.statusCode,headers:res.getHeaders() as Record<string,string>}));return res;}) as typeof res.end;
  (app as any).handle(req,res,(e:unknown)=>{if(e)reject(e);else{res.statusCode=404;res.end();}});req.push(body);req.push(null);
 });
 try{await run({db,send,queries});}finally{db.close();}
}

test('preparation groups exact selected products and deduplicates customer/contact identities across orders',()=>fixture(async({send})=>{
 const response=await send(['41','42','43','44']);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 const result=await response.json();assert.equal(result.rows.length,3);
 const one=result.rows.find((r:any)=>r.productId==='100');assert.equal(one.quantity,3);assert.equal(one.cardNo,'G0907-F018');assert.equal(one.patternNo,'G0907-1');
 assert.equal(one.patternImageAssetId,'dddddddd-4444-4444-8444-000000000001');
 assert.deepEqual(one.recipients,[{customerName:'甲公司',contactName:'张'},{customerName:'甲公司',contactName:'李'},{customerName:'乙公司',contactName:null}]);
 assert.equal(result.rows.find((r:any)=>r.productId==='101').quantity,1);assert.equal(result.rows.find((r:any)=>r.productId==='101').patternImageAssetId,null);
 assert.equal(result.rows.find((r:any)=>r.productId==='102').quantity,1);assert(!result.rows.some((r:any)=>r.productId==='103'));
 assert(!JSON.stringify(result).includes('qrPayload'));assert(!JSON.stringify(result).includes('Preparation_Card_Token'));
}));
test('same-name replacement contacts remain distinct and removed selections do not add recipients',()=>fixture(async({send})=>{
 const r=await send(['41','46']);assert.equal(r.status,200);const result=await r.json();assert.equal(result.rows.find((r:any)=>r.productId==='100').quantity,2);assert(!result.rows.some((r:any)=>r.productId==='102'));
}));
test('summary validates exact nonempty distinct IDs and authenticates the entire batch before reading products',()=>fixture(async({send,queries})=>{
 for(const ids of [[],['41','41'],['0'],Array.from({length:51},(_,i)=>String(i+1))])assert.equal((await send(ids)).status,400);
 assert.equal((await send(['41'],'?extra=1')).status,400);assert.equal((await send(['41'],'',false)).status,401);
 queries.length=0;assert.equal((await send(['41','45'])).status,404);assert(!queries.some(q=>q.includes('AS review_item_id')||q.includes('pattern_image_asset_id')));
 assert.equal((await send(['41','999'])).status,404);
}));
test('empty orders and unresolved or missing current cards block the entire summary',()=>fixture(async({db,send})=>{
 db.exec('DELETE FROM customer_sample_items WHERE session_id=44');let r=await send(['41','44']);assert.equal(r.status,409);assert.deepEqual(await r.json(),{error:'BATCH_SELECTION_BLOCKED',sessionId:'44',reason:'empty'});
 db.exec('UPDATE sample_cards SET is_active=0 WHERE id=12');r=await send(['41']);assert.equal(r.status,409);assert.equal((await r.json()).reason,'review');
}));
test('legacy saved contact names deduplicate only within their customer and missing contacts are explicit',()=>fixture(async({db,send})=>{
 db.exec("UPDATE customer_sample_sessions SET contact_id=NULL WHERE id IN(41,43); UPDATE customer_sample_sessions SET contact_name='张' WHERE id=44");
 let r=await send(['41','43','44']);assert.equal(r.status,200);assert.equal((await r.json()).rows.find((r:any)=>r.productId==='100').quantity,2);
 db.exec('UPDATE customer_sample_sessions SET contact_name=NULL WHERE id IN(41,43)');r=await send(['41','43']);assert.equal(r.status,200);const first=(await r.json()).rows.find((r:any)=>r.productId==='100');assert.equal(first.quantity,1);assert.equal(first.recipients[0].contactName,null);
}));
test('read-only customer grant permits summary while deletion or grant revocation denies the entire result',()=>fixture(async({db,send})=>{
 db.exec("UPDATE customers SET owner_user_id=8 WHERE id=1; INSERT INTO customer_access VALUES(1,6,'view')");assert.equal((await send(['41'])).status,200);
 db.exec('UPDATE customer_sample_sessions SET deleted_at=\'deleted\' WHERE id=41');assert.equal((await send(['41'])).status,404);
 db.exec('UPDATE customer_sample_sessions SET deleted_at=NULL WHERE id=41; DELETE FROM customer_access');assert.equal((await send(['41'])).status,404);
}));
test('a legacy name and the same uniquely identified current contact count once across old and new orders',()=>fixture(async({db,send})=>{
 db.prepare('UPDATE customers SET profile_json=? WHERE id=1').run(JSON.stringify({displayName:'甲公司',contacts:[{id:'a'.repeat(32),name:'张',phone:null,wechat:null}]}));
 db.exec('UPDATE customer_sample_sessions SET contact_id=NULL WHERE id=43');
 const r=await send(['41','43']);assert.equal(r.status,200);assert.equal((await r.json()).rows.find((r:any)=>r.productId==='100').quantity,1);
}));
test('ambiguous same-name legacy contact does not merge with either stable person',()=>fixture(async({db,send})=>{
 db.prepare('UPDATE customers SET profile_json=? WHERE id=1').run(JSON.stringify({displayName:'甲公司',contacts:[{id:'a'.repeat(32),name:'张',phone:null,wechat:null},{id:'b'.repeat(32),name:'张',phone:null,wechat:null}]}));
 db.exec('UPDATE customer_sample_sessions SET contact_id=NULL WHERE id=43');
 const r=await send(['41','43']);assert.equal(r.status,200);assert.equal((await r.json()).rows.find((r:any)=>r.productId==='100').quantity,2);
}));
