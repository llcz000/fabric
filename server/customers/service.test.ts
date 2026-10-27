import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {CustomerService} from './service';import {lockCustomerSessionAccess} from './sessionBridge';import {profile} from './customer.testFixture';
import {lockSelectionAccess} from '../customer-samples/sessionManual';
import {createSampleSession,listSampleSessions,deleteSampleSession} from '../customer-samples/sessionDirectory';
import {fixture,sales,admin,outsider,key} from './service.testFixture';
test('customer + selection atomic idempotency; same key different content conflicts and rollback leaves no orphan',async()=>{
 const f=fixture();try{const a=await f.service.withSampleSession(sales,{requestId:key(1),profile:profile()});const b=await f.service.withSampleSession(sales,{requestId:key(1),profile:profile()});assert.equal(a.session.id,b.session.id);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM customers').get()!.n,1);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM customer_sample_sessions').get()!.n,1);
 await assert.rejects(f.service.withSampleSession(sales,{requestId:key(1),profile:{...profile(),displayName:'另一个'}}),{status:409});
 f.failSession();await assert.rejects(f.service.withSampleSession(sales,{requestId:key(2),profile:profile()}));assert.equal(f.db.prepare('SELECT COUNT(*) n FROM customers').get()!.n,1);
 }finally{f.db.close();}
});
test('ACL scopes search/count/direct IDs and existing linked sessions; view cannot write, revoke overrides old grant',async()=>{
 const f=fixture();try{const a=await f.service.withSampleSession(sales,{requestId:key(1),profile:profile()});assert.equal((await f.service.list(outsider,{})).total,0);await assert.rejects(f.service.get(outsider,a.customer.id),{status:404});
 let c=await f.service.setAccess(sales,a.customer.id,'3',{expectedRowVersion:a.customer.rowVersion,permission:'view'});assert.equal((await f.service.list(outsider,{})).total,1);await assert.rejects(f.service.update(outsider,c.id,{expectedRowVersion:c.rowVersion,profile:profile()}),{status:404});
 const tx=await f.pool.getConnection();await tx.beginTransaction();assert.equal((await lockCustomerSessionAccess(tx,outsider,a.session.id,false))?.canEdit,false);await tx.rollback();await tx.beginTransaction();await assert.rejects(lockCustomerSessionAccess(tx,outsider,a.session.id,true),{status:404});await tx.rollback();
 f.db.prepare('INSERT INTO customer_sample_session_access(session_id,user_id,can_manage) VALUES(?,?,1)').run(a.session.id,3);c=await f.service.setAccess(sales,c.id,'3',{expectedRowVersion:c.rowVersion,permission:null});await tx.beginTransaction();await assert.rejects(lockCustomerSessionAccess(tx,outsider,a.session.id,false),{status:404});await tx.rollback();assert.equal((await f.service.list(admin,{})).total,1);
 }finally{f.db.close();}
});
test('customer updates version conflict, archive restricts new work, contact tasks use explicit date and status',async()=>{
 const f=fixture();try{let c=await f.service.create(sales,{requestId:key(1),profile:profile()});c=await f.service.update(sales,c.id,{expectedRowVersion:c.rowVersion,profile:{...profile(),tier:'A',tierReason:'年度重点开发'}});await assert.rejects(f.service.update(sales,c.id,{expectedRowVersion:'1',profile:profile()}),{status:409});
 await f.service.followup(sales,c.id,{requestId:key(2),contactedOn:'2026-10-19',feedback:'确认',outcome:'安排复样',nextAction:'联系客户',nextFollowupOn:'2026-10-20'});const tasks=await f.service.tasks(sales,{due:'today'});assert.equal(tasks.total,1);const t=tasks.items[0];await f.service.completeTask(sales,t.id,{expectedRowVersion:t.rowVersion,status:'done'});assert.equal((await f.service.tasks(sales,{due:'today'})).total,0);assert.equal((await f.service.tasks(sales,{status:'done'})).total,1);
 c=await f.service.archive(sales,c.id,{expectedRowVersion:c.rowVersion,archived:true});await assert.rejects(f.service.withSampleSession(sales,{requestId:key(3),customerId:c.id}),{status:409});assert.equal((await f.service.get(sales,c.id)).archived,true);
 }finally{f.db.close();}
});
test('existing sample entry points honor customer revoke, administrator/view grants and require client selection on creation',async()=>{
 const f=fixture();try{const a=await f.service.withSampleSession(sales,{requestId:key(1),profile:profile()});f.db.prepare('INSERT INTO customer_sample_session_access(session_id,user_id,can_manage) VALUES(?,?,1)').run(a.session.id,3);
 const tx=await f.pool.getConnection();await tx.beginTransaction();await assert.rejects(lockSelectionAccess(tx,outsider,a.session.id,false),{status:404});await tx.rollback();
 assert.equal((await listSampleSessions(f.pool,outsider,{})).total,0);assert.equal((await listSampleSessions(f.pool,admin,{})).total,1);
 await assert.rejects(createSampleSession(f.pool,sales,{customerReference:'不能绕过档案'}),{status:400});
 const granted=await f.service.setAccess(sales,a.customer.id,'3',{expectedRowVersion:a.customer.rowVersion,permission:'view'});await tx.beginTransaction();await lockSelectionAccess(tx,outsider,a.session.id,false);await tx.rollback();await assert.rejects(deleteSampleSession(f.pool,outsider,a.session.id),{status:404});
 assert.equal(f.db.prepare('SELECT deleted_at FROM customer_sample_sessions WHERE id=?').get(a.session.id)!.deleted_at,null);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM business_delete_events').get()!.n,0);
 await f.service.setAccess(sales,a.customer.id,'3',{expectedRowVersion:granted.rowVersion,permission:null});
 }finally{f.db.close();}
});
test('explicit historical linking preserves original text and version tombstones prevent stale reassociation',async()=>{
 const f=fixture();try{const c=await f.service.create(sales,{requestId:key(1),profile:profile()});f.db.prepare("INSERT INTO customer_sample_sessions(id,customer_reference,created_by_user_id) VALUES(90,'旧公司称呼',2)").run();f.db.prepare('INSERT INTO customer_sample_session_access(session_id,user_id,can_manage) VALUES(90,2,1)').run();
 let linked=await f.service.linkSession(sales,'90',{customerId:c.id,expectedCustomerId:null,expectedLinkVersion:'0',expectedCustomerReference:'旧公司称呼'});assert.equal(linked.rowVersion,'1');assert.equal(f.db.prepare('SELECT customer_reference FROM customer_sample_sessions WHERE id=90').get()!.customer_reference,'旧公司称呼');
 linked=await f.service.linkSession(sales,'90',{customerId:null,expectedCustomerId:c.id,expectedLinkVersion:'1',expectedCustomerReference:'旧公司称呼'});assert.equal(linked.rowVersion,'2');const tx=await f.pool.getConnection();await tx.beginTransaction();assert.equal(await lockCustomerSessionAccess(tx,sales,'90',false),null);await tx.rollback();
 assert.equal((await listSampleSessions(f.pool,sales,{})).items.some(s=>s.id==='90'),true);
 await assert.rejects(f.service.linkSession(sales,'90',{customerId:c.id,expectedCustomerId:null,expectedLinkVersion:'0',expectedCustomerReference:'旧公司称呼'}),{status:409});
 }finally{f.db.close();}
});
test('multiple customer reads acquire ascending locks while keeping newest-first presentation',async()=>{
 const f=fixture();try{await f.service.create(sales,{requestId:key(1),profile:profile()});await f.service.create(sales,{requestId:key(2),profile:{...profile(),displayName:'第二客户'}});f.locks.length=0;const result=await f.service.list(sales,{});assert.deepEqual(f.locks,['1','2']);assert.deepEqual(result.items.map(c=>c.id),['2','1']);}finally{f.db.close();}
});
test('next action without a date remains an undated task and followup locking matches creation idempotency order',async()=>{
 const f=fixture();try{const c=await f.service.create(sales,{requestId:key(1),profile:profile()});f.calls.length=0;await f.service.followup(sales,c.id,{requestId:key(2),contactedOn:'2026-10-20',feedback:null,outcome:'继续沟通',nextAction:'整理报价',nextFollowupOn:null});const keyLock=f.calls.findIndex(s=>s.startsWith('SELECT payload_hash')),customerLock=f.calls.findIndex(s=>s.startsWith('SELECT * FROM customers'));assert(keyLock<customerLock);const tasks=await f.service.tasks(sales,{});assert.equal(tasks.total,1);assert.equal(tasks.items[0].dueOn,null);}finally{f.db.close();}
});

test('name-only customer creates selection atomically and contact can be added later',async()=>{
 const f=fixture();try{const p={...profile(),contacts:[]};const a=await f.service.withSampleSession(sales,{requestId:key(21),profile:p});assert.deepEqual(a.customer.profile.contacts,[]);const updated=await f.service.update(sales,a.customer.id,{expectedRowVersion:a.customer.rowVersion,profile:{...p,contacts:[{name:'小王',phone:'123',wechat:null}]}});assert.equal(updated.profile.contacts[0].phone,'123');assert.equal((await f.service.get(sales,a.customer.id)).profile.contacts[0].name,'小王');}finally{f.db.close();}
});

test('repeat selections for one customer stay independent and directory counts only cards with a current chosen product',async()=>{
 const f=fixture();try{
  const first=await f.service.withSampleSession(sales,{requestId:key(31),profile:profile()});
  const second=await f.service.withSampleSession(sales,{requestId:key(32),customerId:first.customer.id});
  assert.notEqual(first.session.id,second.session.id);assert.equal(second.customer.id,first.customer.id);
  f.db.prepare("UPDATE customer_sample_sessions SET created_at='2026-10-25 01:00:00' WHERE id=?").run(first.session.id);
  f.db.prepare("UPDATE customer_sample_sessions SET created_at='2026-10-26 01:00:00' WHERE id=?").run(second.session.id);
  f.db.prepare('INSERT INTO customer_sample_selected_cards(session_id,card_id) VALUES(?,501),(?,502),(?,503)').run(first.session.id,first.session.id,first.session.id);
  f.db.prepare("INSERT INTO customer_sample_items(session_id,product_id,removed_at) VALUES(?,100,NULL),(?,101,'2026-10-26'),(?,102,NULL)").run(first.session.id,first.session.id,first.session.id);
  f.db.prepare('INSERT INTO customer_sample_item_sources(session_id,product_id,card_id) VALUES(?,100,501),(?,101,502)').run(first.session.id,first.session.id);
  f.db.prepare('INSERT INTO customer_sample_manual_events(session_id,product_id,card_id) VALUES(?,100,501),(?,102,503),(?,102,503)').run(first.session.id,first.session.id,first.session.id);
  const result=await listSampleSessions(f.pool,sales,{});
  assert.deepEqual(result.items.map(x=>x.id),[second.session.id,first.session.id]);
  assert.deepEqual(result.items.map(x=>x.selectedCardCount),[0,2]);
  assert.deepEqual(result.items.map(x=>x.createdAt),['2026-10-26T01:00:00.000Z','2026-10-25T01:00:00.000Z']);
 }finally{f.db.close();}
});
