import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {CustomerService} from '../../server/customers/service';
import {customerEnabledPool} from '../../server/customers/sessionBridge';
import {verifyCustomerOrderSchema} from '../../server/customers/orderLinkSchema';
import {createV2Document,readV2Document,updateV2Document} from '../../server/order-v2/documents';
import {saveSampleFollowup,saveShipmentBatch} from '../../server/customer-samples/fulfillmentService';
/** Business fixtures are written only into the freshly restored release-check database. */
export async function rehearseCustomerV12(pool:any,target:{database:string;serverUuid:string}):Promise<string[]>{
 const [identity]=await pool.query('SELECT DATABASE() AS db');
 assert.equal(identity[0].db,target.database);assert.match(target.database,/^fabric_release_check_[a-f0-9]{16}$/);
 await verifyCustomerOrderSchema(pool,target);
 const db=customerEnabledPool(pool),service=new CustomerService(db),checks:string[]=[],actors:any[]=[];
 for(let i=0;i<3;i++){
  const name='v12_'+randomBytes(8).toString('hex');
  const [u]=await pool.query('INSERT INTO v2_access_users(username,username_normalized,display_name,password_hash,role) VALUES (?,?,?,?,?)',[name,name,name,'isolated-unusable',i===0?'admin':'sales']);
  const [s]=await pool.query('INSERT INTO v2_access_sessions(user_id,token_hash,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))',[u.insertId,randomBytes(32).toString('hex')]);
  actors.push({userId:String(u.insertId),sessionId:String(s.insertId),username:name,displayName:name,role:i===0?'admin':'sales',canManageProducts:true,canManageOwnOrders:true});
 }
 const [admin,owner,other]=actors,brand='fixture_'+randomBytes(6).toString('hex'),longName='长'.repeat(160);
 const requestId=randomUUID(),payload={requestId,profile:{displayName:longName,brands:[brand],important:true}};
 const [first,retry]=await Promise.all([service.withSampleSession(owner,payload),service.withSampleSession(owner,payload)]);
 assert.equal(first.session.id,retry.session.id);assert.equal(first.customer.id,retry.customer.id);
 const cid=first.customer.id,sid=first.session.id;
 checks.push('real MySQL concurrent name-only profile/selection retry is atomic and idempotent');
 const due=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 let customer=await service.update(owner,cid,{expectedRowVersion:first.customer.rowVersion,profile:{...first.customer.profile,nextFollowupOn:due,followupNote:'恢复库演练'}});
 assert.equal((await service.list(owner,{query:brand,due:'today'})).total,1);
 assert.equal((await service.list(other,{query:brand})).total,0);await assert.rejects(service.get(other,cid),(e:any)=>e.status===404);
 const concurrent=await Promise.allSettled(['A','B'].map(notes=>service.update(owner,cid,{expectedRowVersion:customer.rowVersion,profile:{...customer.profile,notes}})));
 assert.equal(concurrent.filter(x=>x.status==='fulfilled').length,1);assert.equal(concurrent.filter(x=>x.status==='rejected'&&(x.reason as any).status===409).length,1);
 checks.push('Shanghai due filter, customer ACL and real optimistic-write contention');
 const documents:any[]=[];
 for(const type of ['sample','bulk','deposit']){
  const input={orderNo:'V12-'+randomBytes(10).toString('hex'),date:due,receivingUnit:'服务端保留完整客户名',type,deposit:type==='deposit'?30:type==='bulk'?10:0,
   customer:{customerId:cid,requestId:randomUUID()},items:[{manual:{productNo:'V12-FIXTURE',productName:'隔离演练面料'},fields:{meters:10,unitPrice:3.25}}]};
  const saved=await createV2Document(db,admin,input);assert.equal(saved.receivingUnit,longName);assert.equal(saved.customerLink?.customerId,cid);assert.equal(saved.totalAmount,32.5);
  assert.equal((await createV2Document(db,admin,input)).id,saved.id);documents.push(saved);
 }
 const activity=await service.activity(admin,cid,{});assert.equal(Number(activity.salesAmount),65);assert.equal(activity.items.filter(x=>x.kind==='document').length,3);
 await service.setAccess(owner,cid,other.userId,{expectedRowVersion:(await service.get(owner,cid)).rowVersion,permission:'view'});
 const tx=await db.getConnection();try{await assert.rejects(readV2Document(tx,other,documents[0].id),(e:any)=>e.status===404);}finally{tx.release();}
 assert.equal((await service.activity(other,cid,{})).items.filter(x=>x.kind==='document').length,0);
 checks.push('all three real document writes/readbacks/retries preserve 160-character names; sales total excludes deposits and uses full bulk amount; customer view never expands document owner access');
 const failedKey=randomUUID(),bad={orderNo:'V12-FAIL-'+randomBytes(8).toString('hex'),date:due,receivingUnit:'失败回滚',type:'sample',deposit:0,customer:{profile:{displayName:'不能留下孤立档案',brands:[brand+'-failed']},requestId:failedKey},items:[{manual:{productNo:'FAIL',productName:'失败'},fields:{meters:-1,unitPrice:1}}]};
 await assert.rejects(createV2Document(db,admin,bad));assert.equal((await service.list(admin,{query:brand+'-failed'})).total,0);
 const [requests]=await pool.query('SELECT COUNT(*) AS total FROM customer_requests WHERE actor_user_id=? AND request_id=?',[admin.userId,failedKey]);assert.equal(Number(requests[0].total),0);
 checks.push('actual invalid document rollback leaves neither customer nor idempotency request');
 const targetCustomer=await service.create(owner,{requestId:randomUUID(),profile:{displayName:'人工核对关联'}}),original=documents[0];
 const edit={items:original.items.map((i:any)=>({id:i.id,fields:{}})),removeIds:[],customer:{customerId:targetCustomer.id,expectedCustomerId:cid,expectedLinkVersion:original.customerLink.linkVersion,requestId:randomUUID()}};
 const linked=await updateV2Document(db,admin,original.id,edit);assert.equal(linked.receivingUnit,longName);assert.deepEqual(linked.items[0].snapshot,original.items[0].snapshot);
 await assert.rejects(updateV2Document(db,admin,original.id,{...edit,customer:{...edit.customer,requestId:randomUUID()}}),(e:any)=>e.status===409);
 await updateV2Document(db,admin,original.id,{...edit,customer:{customerId:cid,expectedCustomerId:targetCustomer.id,expectedLinkVersion:linked.customerLink!.linkVersion,requestId:randomUUID()}});
 await saveSampleFollowup(db,owner,{sessionId:sid,contactedOn:due,outcome:'选样直接反馈',feedback:'无需寄样',productIds:[]});
 await assert.rejects(saveSampleFollowup(db,other,{sessionId:sid,contactedOn:due,outcome:'只读不得写',productIds:[]}),(e:any)=>e.status===404);
 await assert.rejects(saveShipmentBatch(db,owner,{sessionId:sid}),(e:any)=>e.status===409);
 checks.push('manual association/conflicts retain historical name/product snapshots; direct sample feedback and read-only denial; shipment writes retired');
 const info=await service.deletionInfo(admin,cid);assert.deepEqual(info,{sessions:1,sample:1,bulk:1,deposit:1});
 await assert.rejects(service.delete(owner,cid,{expectedRowVersion:(await service.get(owner,cid)).rowVersion,confirm:true}),(e:any)=>e.status===403);
 await service.delete(admin,cid,{expectedRowVersion:(await service.get(admin,cid)).rowVersion,confirm:true});
 assert.equal((await service.list(admin,{query:brand})).total,0);assert.equal((await service.activity(admin,cid,{})).items.filter(x=>x.kind==='document').length,3);
 await assert.rejects(service.withSampleSession(owner,{requestId:randomUUID(),customerId:cid}),(e:any)=>e.status===409);
 await assert.rejects(createV2Document(db,admin,{...bad,items:[{manual:{productNo:'VALID',productName:'有效'},fields:{meters:1,unitPrice:1}}],customer:{customerId:cid,requestId:randomUUID()}}),(e:any)=>e.status===409);
 checks.push('admin-only logical deletion hides candidates, rejects new links and preserves all selection/feedback/three-document history');
 return checks;
}
