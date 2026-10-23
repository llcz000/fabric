import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {CustomerService} from '../../server/customers/service';
import {customerEnabledPool} from '../../server/customers/sessionBridge';
/** Invoked only after restoring into the exact isolated release-check database. */
export async function rehearseCustomers(pool:any):Promise<string[]>{
const checks:string[]=[];
   const actors:any[]=[];
   for(let i=0;i<3;i++){
    const name='release_'+randomBytes(8).toString('hex');
    const [u]:any=await pool.query('INSERT INTO v2_access_users(username,username_normalized,display_name,password_hash,role) VALUES (?,?,?,?,?)',[name,name,name,'isolated-fixture-unusable',i===0?'admin':'sales']);
    const [s]:any=await pool.query('INSERT INTO v2_access_sessions(user_id,token_hash,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))',[u.insertId,randomBytes(32).toString('hex')]);
    actors.push({userId:String(u.insertId),sessionId:String(s.insertId),username:name,displayName:name,role:i===0?'admin':'sales',canManageProducts:false,canManageOwnOrders:false});
   }
   const [admin,owner,other]=actors;
   const service=new CustomerService(customerEnabledPool(pool));
   const profile={displayName:'发布演练客户',subjectType:'company',invoiceTitle:'发布演练公司',brands:['演练品牌'],contacts:[{name:'演练联系人',phone:null,wechat:'isolated-test'}],region:null,salesChannel:'both',prices:[{fabricCategory:'针织',minPrice:'10.50',maxPrice:'30.00',currency:'CNY',unit:'metre',taxBasis:'included',remark:null}],tier:'A',tierReason:'演练',relationshipStage:'sampling',stageReason:'演练'};
   const requestId=randomUUID();const input={requestId,profile};
   const created=await service.withSampleSession(owner,input),again=await service.withSampleSession(owner,input);
   assert.equal(created.customer.id,again.customer.id);assert.equal(created.session.id,again.session.id);
   checks.push('atomic profile + selection + retry idempotency');
   const cid=created.customer.id,sid=created.session.id;
   assert.equal((await service.list(owner,{query:'演练品牌'})).total,1);
   assert.equal((await service.list(owner,{waiting:true})).total,0);
   assert.equal((await service.list(other,{})).total,0);
   await assert.rejects(service.get(other,cid),(e:any)=>e.status===404);
   let dto=await service.setAccess(owner,cid,other.userId,{expectedRowVersion:'1',permission:'view'});
   assert.equal((await service.get(other,cid)).canEdit,false);
   await assert.rejects(service.update(other,cid,{expectedRowVersion:dto.rowVersion,profile}),(e:any)=>e.status===404);
   dto=await service.setAccess(owner,cid,other.userId,{expectedRowVersion:dto.rowVersion,permission:'edit'});
   dto=await service.update(other,cid,{expectedRowVersion:dto.rowVersion,profile:{...profile,displayName:'更新演练客户'}});
   await assert.rejects(service.update(owner,cid,{expectedRowVersion:'1',profile}),(e:any)=>e.status===409);
   checks.push('search/filter + customer ACL + optimistic version conflicts');
   const fid=randomUUID();const f={requestId:fid,contactedOn:'2026-10-20',feedback:'演练',outcome:'已联系',nextAction:'待寄样',nextFollowupOn:null,sessionId:sid};
   assert.deepEqual(await service.followup(owner,cid,f),await service.followup(owner,cid,f));
   const tasks=await service.tasks(owner,{customerId:cid});assert.equal(tasks.total,1);assert.equal(tasks.items[0].dueOn,null);
   await service.completeTask(owner,tasks.items[0].id,{expectedRowVersion:'1',status:'done'});
   const activity=await service.activity(owner,cid,{});assert.equal(activity.total,2);
   let link=await service.sessionLinkInfo(owner,sid);assert.equal(link.customerId,cid);
   await service.linkSession(owner,sid,{customerId:null,expectedCustomerId:cid,expectedLinkVersion:link.linkVersion,expectedCustomerReference:link.customerReference});
   link=await service.sessionLinkInfo(owner,sid);assert.equal(link.customerId,null);
   await service.linkSession(owner,sid,{customerId:cid,expectedCustomerId:null,expectedLinkVersion:link.linkVersion,expectedCustomerReference:link.customerReference});
   checks.push('followup idempotency + undated task + completion + activity + unlink/relink');
   dto=await service.get(owner,cid);dto=await service.transferOwner(admin,cid,{expectedRowVersion:dto.rowVersion,userId:other.userId});
   await assert.rejects(service.get(owner,cid),(e:any)=>e.status===404);
   dto=await service.archive(other,cid,{expectedRowVersion:dto.rowVersion,archived:true});assert.equal(dto.archived,true);
   await assert.rejects(service.withSampleSession(other,{requestId:randomUUID(),customerId:cid}),(e:any)=>e.status===409);
   checks.push('owner transfer revokes old owner and archive prevents new selection');
return checks;
}
