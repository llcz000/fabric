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
test('V1.2 name only, simple preferences and one followup date',async()=>{
 const p=parseCustomerProfile({displayName:'新客户',important:true,notes:'偏好素色',styleTagIds:[],commonFabricIds:[],nextFollowupOn:'2026-10-20',followupNote:'确认需求'});assert.equal(p.important,true);assert.deepEqual(p.prices,[]);
 const f=fixture();try{const c=await f.service.create(sales,{requestId:key(100),profile:p});assert.equal((await f.service.list(sales,{due:'today'})).total,1);assert.equal((await f.service.list(sales,{due:'overdue'})).total,0);await f.service.update(sales,c.id,{expectedRowVersion:c.rowVersion,profile:{...p,nextFollowupOn:null}});assert.equal((await f.service.list(sales,{due:'today'})).total,0);}finally{f.db.close();}
});
test('V1.2 admin logical deletion preserves histories and original customer snapshot',async()=>{
 const f=fixture();try{const c=await f.service.withSampleSession(sales,{requestId:key(101),profile:{displayName:'原名'}});await assert.rejects(f.service.delete(sales,c.customer.id,{expectedRowVersion:'1',confirm:true}),{status:403});await assert.rejects(f.service.deletionInfo(outsider,c.customer.id),{status:403});assert.equal((await f.service.deletionInfo(admin,c.customer.id)).sessions,1);await f.service.delete(admin,c.customer.id,{expectedRowVersion:'1',confirm:true});assert.equal((await f.service.list(admin,{})).total,0);assert.equal(f.db.prepare('SELECT customer_reference FROM customer_sample_sessions').get()!.customer_reference,'原名');await assert.rejects(f.service.withSampleSession(sales,{requestId:key(102),customerId:c.customer.id}),{status:409});assert.equal((await f.service.get(sales,c.customer.id)).canEdit,false);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM customer_session_links').get()!.n,1);}finally{f.db.close();}
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
