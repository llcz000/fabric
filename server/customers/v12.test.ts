import test from 'node:test';import assert from 'node:assert/strict';
import {fixture,sales,admin,outsider,key} from './service.testFixture';
import {parseCustomerProfile} from './model';

test('customer deletion preview counts only undeleted selections, including closed selections, while retaining history rows',async()=>{
 const f=fixture();try{
  const first=await f.service.withSampleSession(sales,{requestId:key(301),profile:{displayName:'删除统计客户'}});
  const second=await f.service.withSampleSession(sales,{requestId:key(302),customerId:first.customer.id});
  const closed=await f.service.withSampleSession(sales,{requestId:key(303),customerId:first.customer.id});
  f.db.prepare("UPDATE customer_sample_sessions SET deleted_at='2026-10-23',status='closed' WHERE id IN (?,?)").run(first.session.id,second.session.id);
  f.db.prepare("UPDATE customer_sample_sessions SET status='closed' WHERE id=?").run(closed.session.id);
  assert.deepEqual(await f.service.deletionInfo(admin,first.customer.id),{sessions:1,sample:0,bulk:0,deposit:0});
  f.db.prepare("UPDATE customer_sample_sessions SET deleted_at='2026-10-23' WHERE id=?").run(closed.session.id);
  assert.equal((await f.service.deletionInfo(admin,first.customer.id)).sessions,0);
  await f.service.delete(admin,first.customer.id,{expectedRowVersion:'1',confirm:true});
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM customer_sample_sessions').get()!.n,3);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM customer_session_links').get()!.n,3);
 }finally{f.db.close();}
});

test('customer activity excludes feedback of deleted selections without deleting saved feedback',async()=>{
 const f=fixture();try{
  const a=await f.service.withSampleSession(sales,{requestId:key(304),profile:{displayName:'选样反馈客户'}});
  const b=await f.service.withSampleSession(sales,{requestId:key(305),customerId:a.customer.id});
  f.db.prepare("INSERT INTO sample_followups VALUES(1,?,'2026-10-23','已删除选样反馈')").run(a.session.id);
  f.db.prepare("INSERT INTO sample_followups VALUES(2,?,'2026-10-23','保留的选样反馈')").run(b.session.id);
  f.db.prepare("UPDATE customer_sample_sessions SET deleted_at='2026-10-23',status='closed' WHERE id=?").run(a.session.id);
  const history=await f.service.activity(admin,a.customer.id,{});
  assert.equal(history.items.length,2);
  assert(history.items.every(item=>item.sessionId===b.session.id));
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM sample_followups').get()!.n,2);
 }finally{f.db.close();}
});
// AC-108
test('activity uses the selection creation instant for Shanghai dates and paginates after date conversion',async()=>{
 const f=fixture();try{
  f.db.function('UNIX_TIMESTAMP',(value:any)=>Date.parse(String(value).replace(' ','T')+'+08:00')/1000);
  const earlier=await f.service.withSampleSession(sales,{requestId:key(306),profile:{displayName:'选样日期客户'}});
  const customerId=earlier.customer.id;
  const later=await f.service.withSampleSession(sales,{requestId:key(307),customerId});
  const setTime=f.db.prepare('UPDATE customer_sample_sessions SET created_at=? WHERE id=?');
  setTime.run('2026-11-09 23:59:59',earlier.session.id);
  setTime.run('2026-11-10 00:00:00',later.session.id);
  f.db.prepare("INSERT INTO sample_followups VALUES(1,?,'2026-11-09','选样反馈')").run(earlier.session.id);
  f.db.prepare("INSERT INTO orders VALUES(1,'sample','2026-11-08','YB1','选样日期客户',100,2)").run();
  f.db.prepare('INSERT INTO customer_order_links VALUES(1,?,1,2)').run(customerId);

  const history=await f.service.activity(sales,customerId,{});
  assert.deepEqual(history.items.map(({kind,id,occurredOn})=>[kind,id,occurredOn]),[
   ['session',later.session.id,'2026-11-10'],
   ['sample-followup','1','2026-11-09'],
   ['session',earlier.session.id,'2026-11-09'],
   ['document','1','2026-11-08'],
  ]);
  const firstPage=await f.service.activity(sales,customerId,{limit:2,offset:0});
  assert.equal(firstPage.total,4);
  assert.deepEqual(firstPage.items,history.items.slice(0,2));
 }finally{f.db.close();}
});
test('V1.2 name only, simple preferences and one followup date',async()=>{
 const p=parseCustomerProfile({displayName:'新客户',important:true,notes:'偏好素色',styleTagIds:[],commonFabricIds:[],nextFollowupOn:'2026-10-20',followupNote:'确认需求'});assert.equal(p.important,true);assert.deepEqual(p.prices,[]);
 const f=fixture();try{const c=await f.service.create(sales,{requestId:key(100),profile:p});assert.equal((await f.service.list(sales,{due:'today'})).total,1);assert.equal((await f.service.list(sales,{due:'overdue'})).total,0);await f.service.update(sales,c.id,{expectedRowVersion:c.rowVersion,profile:{...p,nextFollowupOn:null}});assert.equal((await f.service.list(sales,{due:'today'})).total,0);}finally{f.db.close();}
});
test('V1.2 admin logical deletion preserves histories and original customer snapshot',async()=>{
 const f=fixture();try{const c=await f.service.withSampleSession(sales,{requestId:key(101),profile:{displayName:'原名'}});await assert.rejects(f.service.delete(sales,c.customer.id,{expectedRowVersion:'1',confirm:true}),{status:403});await assert.rejects(f.service.deletionInfo(outsider,c.customer.id),{status:403});assert.equal((await f.service.deletionInfo(admin,c.customer.id)).sessions,1);await assert.rejects(f.service.delete(admin,c.customer.id,{expectedRowVersion:'1',confirm:true}),{status:409,code:'customer_has_selections'});f.db.prepare("UPDATE customer_sample_sessions SET deleted_at='2026-10-28' WHERE id=?").run(c.session.id);await f.service.delete(admin,c.customer.id,{expectedRowVersion:'1',confirm:true});assert.equal((await f.service.list(admin,{})).total,0);assert.equal(f.db.prepare('SELECT customer_reference FROM customer_sample_sessions').get()!.customer_reference,'原名');await assert.rejects(f.service.withSampleSession(sales,{requestId:key(102),customerId:c.customer.id}),{status:409});assert.equal((await f.service.get(sales,c.customer.id)).canEdit,false);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM customer_session_links').get()!.n,1);}finally{f.db.close();}
});

test('V1.2 activity includes three saved documents; sales amount excludes deposits and uses full bulk amount and owner scope',async()=>{
 const f=fixture();try{const c=await f.service.withSampleSession(sales,{requestId:key(103),profile:{displayName:'同名'}});f.db.exec(`INSERT INTO orders VALUES(1,'sample','2026-10-20','YB1','同名',100,2),(2,'bulk','2026-10-20','XS1','同名',500,2),(3,'deposit','2026-10-20','DJ1','同名',200,2),(4,'bulk','2026-10-20','他人','同名',900,3),(5,'bulk','2026-10-20','未关联','同名',800,2);INSERT INTO customer_order_links VALUES(1,${c.customer.id},1,2),(2,${c.customer.id},1,2),(3,${c.customer.id},1,2),(4,${c.customer.id},1,3);INSERT INTO sample_shipments VALUES(1,${c.session.id},'2026-10-20');`);const r=await f.service.activity(sales,c.customer.id,{});assert.equal(r.salesAmount,'600');assert.equal(r.items.filter(x=>x.kind==='document').length,3);assert.equal(r.items.some(x=>x.kind==='shipment'),false);assert.equal((await f.service.activity(admin,c.customer.id,{})).salesAmount,'1500');await assert.rejects(f.service.activity(outsider,c.customer.id,{}),{status:404});}finally{f.db.close();}
});

test('V1.2 price range can be recorded without fabricated metadata; preferences reject unknown identities',async()=>{
 const p=parseCustomerProfile({displayName:'客户',prices:[{fabricCategory:'',minPrice:'0',maxPrice:'100.50',currency:'',unit:null,taxBasis:'unknown',remark:null}]});assert.equal(p.prices[0].unit,null);assert.throws(()=>parseCustomerProfile({...p,deletedAt:'today'}));assert.throws(()=>parseCustomerProfile({...p,nextFollowupOn:'2026-02-30'}));
 const f=fixture();try{f.db.exec("CREATE TABLE shared_tags(id INTEGER PRIMARY KEY,dimension TEXT,is_archived INTEGER);CREATE TABLE v2_fabrics(id INTEGER PRIMARY KEY,is_active INTEGER);INSERT INTO shared_tags VALUES(1,'topic',0),(2,'color',0);INSERT INTO v2_fabrics VALUES(1,1)");await assert.rejects(f.service.create(sales,{requestId:key(130),profile:{displayName:'错误风格',styleTagIds:['2']}}),{status:400});const c=await f.service.create(sales,{requestId:key(131),profile:{displayName:'偏好客户',styleTagIds:['1'],commonFabricIds:['1']}});f.db.exec('UPDATE shared_tags SET is_archived=1;UPDATE v2_fabrics SET is_active=0');await f.service.update(sales,c.id,{expectedRowVersion:c.rowVersion,profile:{...c.profile,notes:'保留旧偏好'}});}finally{f.db.close();}
});

test('LITE customer deletion writes only minimal identity and actor; audit failure keeps profile untouched',async()=>{const f=fixture();try{const c=await f.service.create(sales,{requestId:key(910),profile:{displayName:'最小留痕'}});await f.service.delete(admin,c.id,{expectedRowVersion:'1',confirm:true});const log=f.db.prepare('SELECT entity_type,entity_id,entity_label,actor_user_id FROM business_delete_events').get();assert.deepEqual({...log},{entity_type:'customer',entity_id:c.id,entity_label:'最小留痕',actor_user_id:admin.userId});assert.equal((await f.service.list(sales,{})).total,0);const c2=await f.service.create(sales,{requestId:key(911),profile:{displayName:'日志失败保留'}});f.db.exec("CREATE TRIGGER audit_fail BEFORE INSERT ON business_delete_events BEGIN SELECT RAISE(ABORT,'audit failed'); END;");await assert.rejects(f.service.delete(admin,c2.id,{expectedRowVersion:'1',confirm:true}),/audit failed/);assert.equal((await f.service.get(sales,c2.id)).deleted,false);assert.equal((await f.service.get(sales,c2.id)).rowVersion,'1');assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM business_delete_events').get()!.n,1);}finally{f.db.close();}});

test('fabric note persists through customer create update and read without losing unavailable fabric preferences',async()=>{
 const f=fixture();try{f.db.exec("CREATE TABLE v2_fabrics(id INTEGER PRIMARY KEY,is_active INTEGER);INSERT INTO v2_fabrics VALUES(10,1),(11,1)");
 const c=await f.service.create(sales,{requestId:key(920),profile:{displayName:'面料备注客户',commonFabricIds:['10','11'],fabricNote:'  优先真丝  '}});
 assert.equal(c.profile.fabricNote,'优先真丝');f.db.exec('UPDATE v2_fabrics SET is_active=0 WHERE id=10');
 await f.service.update(sales,c.id,{expectedRowVersion:c.rowVersion,profile:{...c.profile,fabricNote:'不接受偏硬'}});
 const read=await f.service.get(sales,c.id);assert.equal(read.profile.fabricNote,'不接受偏硬');assert.deepEqual(read.profile.commonFabricIds,['10','11']);
 await f.service.update(sales,c.id,{expectedRowVersion:read.rowVersion,profile:{...read.profile,fabricNote:''}});assert.equal((await f.service.get(sales,c.id)).profile.fabricNote,null);
 }finally{f.db.close();}
});


// Persisted pre-guard data must remain readable/deletable; new deletes are guarded below.
function seedLegacyDeletedCustomer(f:ReturnType<typeof fixture>,customerId:string){
 f.db.prepare("UPDATE customers SET profile_json=JSON_SET(profile_json,'$.deletedAt','2026-10-28T02:12:00.000Z'),row_version=row_version+1 WHERE id=?").run(customerId);
}
// AC-164 / AC-146: deleting a customer does not implicitly delete selections.
import {listSampleSessions,deleteSampleSession,updateSampleSession} from '../customer-samples/sessionDirectory';
import {lockSelectionAccess} from '../customer-samples/sessionManual';

test('deleted-customer selections expose deletion independently from editing for admin, owner and edit grants',async()=>{
 for(const actor of [admin,sales,outsider]){const f=fixture();try{
  f.db.exec('ALTER TABLE customer_sample_sessions ADD COLUMN deleted_by_user_id INTEGER');
  const c=await f.service.withSampleSession(sales,{requestId:key(930),profile:{displayName:'历史选样保留'}});
  if(actor===outsider)f.db.prepare("INSERT INTO customer_access VALUES(?,?,'edit',?)").run(c.customer.id,outsider.userId,admin.userId);
  f.db.prepare('INSERT INTO customer_sample_items VALUES(?,?,NULL)').run(c.session.id,81);
  f.db.prepare('INSERT INTO sample_followups VALUES(?,?,?,?)').run(1,c.session.id,'2026-10-28','原反馈');
  seedLegacyDeletedCustomer(f,c.customer.id);
  const listed=await listSampleSessions(f.pool,actor,{});assert.equal(listed.items.length,1);
  assert.equal(listed.items[0].canManage,false);assert.equal(listed.items[0].canDelete,true);
  await assert.rejects(updateSampleSession(f.pool,actor,c.session.id,{customerReference:'不得改名',expectedCustomerReference:'历史选样保留'}),{status:409});
  await assert.rejects(lockSelectionAccess(await f.pool.getConnection(),actor,c.session.id,true),{status:409});
  await deleteSampleSession(f.pool,actor,c.session.id);
  assert.equal((await listSampleSessions(f.pool,actor,{})).total,0);
  assert.equal(f.db.prepare('SELECT deleted_by_user_id FROM customer_sample_sessions').get()!.deleted_by_user_id,Number(actor.userId));
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM customer_sample_items').get()!.n,1);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM sample_followups').get()!.n,1);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM customer_session_links').get()!.n,1);
  assert.equal((await f.service.get(admin,c.customer.id)).deleted,true);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM business_delete_events WHERE entity_type='selection'").get()!.n,1);
  await assert.rejects(deleteSampleSession(f.pool,actor,c.session.id),{status:404});
 }finally{f.db.close();}}
});

test('historical selection deletion denies view-only, unrelated and revoked identities without legacy-grant bypass',async()=>{
 for(const kind of ['view','unrelated','revoked'] as const){const f=fixture();try{
  f.db.exec('ALTER TABLE customer_sample_sessions ADD COLUMN deleted_by_user_id INTEGER');
  const c=await f.service.withSampleSession(sales,{requestId:key(931),profile:{displayName:'权限不扩大'}});
  f.db.prepare('INSERT INTO customer_sample_session_access(session_id,user_id,can_manage) VALUES(?,?,1)').run(c.session.id,outsider.userId);
  if(kind==='view')f.db.prepare("INSERT INTO customer_access VALUES(?,?,'view',?)").run(c.customer.id,outsider.userId,admin.userId);
  seedLegacyDeletedCustomer(f,c.customer.id);
  if(kind==='revoked')f.db.prepare("UPDATE v2_access_sessions SET revoked_at='2026-10-28' WHERE id=?").run(outsider.sessionId);
  if(kind==='view'){const r=await listSampleSessions(f.pool,outsider,{});assert.equal(r.items[0].canManage,false);assert.equal(r.items[0].canDelete,false);}
  await assert.rejects(deleteSampleSession(f.pool,outsider,c.session.id),{status:kind==='revoked'?403:404});
  assert.equal(f.db.prepare('SELECT deleted_at FROM customer_sample_sessions').get()!.deleted_at,null);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM business_delete_events WHERE entity_type='selection'").get()!.n,0);
 }finally{f.db.close();}}
});

test('historical selection audit failure rolls back deletion and leaves its customer unchanged',async()=>{
 const f=fixture();try{
  f.db.exec('ALTER TABLE customer_sample_sessions ADD COLUMN deleted_by_user_id INTEGER');
  const c=await f.service.withSampleSession(sales,{requestId:key(932),profile:{displayName:'失败可重试'}});
  seedLegacyDeletedCustomer(f,c.customer.id);
  const before=f.db.prepare('SELECT profile_json,row_version FROM customers').get();
  f.db.exec("CREATE TRIGGER audit_selection_fail BEFORE INSERT ON business_delete_events WHEN NEW.entity_type='selection' BEGIN SELECT RAISE(ABORT,'audit failed'); END;");
  await assert.rejects(deleteSampleSession(f.pool,sales,c.session.id),/audit failed/);
  assert.equal(f.db.prepare('SELECT deleted_at FROM customer_sample_sessions').get()!.deleted_at,null);
  assert.deepEqual(f.db.prepare('SELECT profile_json,row_version FROM customers').get(),before);
  f.db.exec('DROP TRIGGER audit_selection_fail');await deleteSampleSession(f.pool,sales,c.session.id);
 }finally{f.db.close();}
});


test('archived customer histories remain read-only but deletable; deletion rechecks changed grants',async()=>{
 const f=fixture();try{
  f.db.exec('ALTER TABLE customer_sample_sessions ADD COLUMN deleted_by_user_id INTEGER');
  const c=await f.service.withSampleSession(sales,{requestId:key(933),profile:{displayName:'旧归档历史'}});
  f.db.prepare("UPDATE customers SET archived_at='2026-10-28' WHERE id=?").run(c.customer.id);
  f.db.prepare("INSERT INTO customer_access VALUES(?,?,'edit',?)").run(c.customer.id,outsider.userId,admin.userId);
  const r=await listSampleSessions(f.pool,outsider,{});assert.equal(r.items[0].canManage,false);assert.equal(r.items[0].canDelete,true);
  await assert.rejects(updateSampleSession(f.pool,sales,c.session.id,{customerReference:'不允许编辑',expectedCustomerReference:'旧归档历史'}),{status:409});
  f.db.prepare("UPDATE customer_access SET permission='view' WHERE customer_id=? AND user_id=?").run(c.customer.id,outsider.userId);
  await assert.rejects(deleteSampleSession(f.pool,outsider,c.session.id),{status:404});
  await deleteSampleSession(f.pool,admin,c.session.id);
  assert.equal(f.db.prepare('SELECT archived_at FROM customers').get()!.archived_at,'2026-10-28');
 }finally{f.db.close();}
});


test('customer deletion is blocked by any undeleted selection and rechecks after preview before any audit/write',async()=>{
 const f=fixture();try{
  const c=await f.service.create(sales,{requestId:key(940),profile:{displayName:'先删选样客户'}});
  assert.equal((await f.service.deletionInfo(admin,c.id)).sessions,0);
  const created=await f.service.withSampleSession(sales,{requestId:key(941),customerId:c.id});
  f.db.prepare("UPDATE customer_sample_sessions SET status='closed' WHERE id=?").run(created.session.id);
  const before=f.db.prepare('SELECT profile_json,row_version FROM customers WHERE id=?').get(c.id);
  await assert.rejects(f.service.delete(admin,c.id,{expectedRowVersion:'1',confirm:true}),{status:409,code:'customer_has_selections',selectionCount:1});
  assert.deepEqual(f.db.prepare('SELECT profile_json,row_version FROM customers WHERE id=?').get(c.id),before);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM business_delete_events WHERE entity_type='customer'").get()!.n,0);
  f.db.prepare("UPDATE customer_sample_sessions SET deleted_at='2026-10-28' WHERE id=?").run(created.session.id);
  await f.service.delete(admin,c.id,{expectedRowVersion:'1',confirm:true});
  assert.equal((await f.service.get(admin,c.id)).deleted,true);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM customer_sample_sessions').get()!.n,1);
 }finally{f.db.close();}
});
