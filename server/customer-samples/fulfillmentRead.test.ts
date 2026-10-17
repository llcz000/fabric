import assert from 'node:assert/strict';
import test from 'node:test';
import type {AppPrincipal} from '../access/types';
import {readSampleFulfillmentHistory} from './fulfillmentRead';
import {SampleFulfillmentError} from './fulfillmentService';

const actor:AppPrincipal={userId:'6',sessionId:'9',role:'sales',username:'s',displayName:'S',canManageProducts:false,canManageOwnOrders:false};
class Db{
 grant=true;role='sales';closed=false;calls:{sql:string;args:unknown[]}[]=[];commits=0;rollbacks=0;
 async getConnection(){
  const owner=this;return {async beginTransaction(){},async commit(){owner.commits++;},async rollback(){owner.rollbacks++;},release(){},
   async query(sql:string,args:unknown[]=[]):Promise<[unknown,unknown]>{
    owner.calls.push({sql,args});
    if(sql.includes('FROM v2_access_users'))return [[{id:'6',role:owner.role,is_active:1}],[]];
    if(sql.includes('FROM v2_access_sessions'))return [[{id:'9'}],[]];
    if(sql.includes('FROM customer_sample_sessions'))return [[{id:'41',status:owner.closed?'closed':'open'}],[]];
    if(sql.includes('FROM customer_sample_session_access'))return [owner.grant?[{can_manage:1}]:[],[]];
    if(sql.startsWith('SELECT COUNT(*) AS total FROM sample_shipments'))return [[{total:1}],[]];
    if(sql.startsWith('SELECT COUNT(*) AS total FROM sample_followups'))return [[{total:1}],[]];
    if(sql.includes('FROM sample_shipments WHERE session_id=? ORDER BY'))return [[{id:'101',actor_user_id:'6',shipped_at:'2026-10-17T09:15:00.000Z',carrier:'顺丰',tracking_no:'SF123'}],[]];
    if(sql.includes('FROM sample_shipment_items WHERE session_id=?'))return [[{shipment_id:'101',product_id:'18',quantity:2}],[]];
    if(sql.includes('FROM sample_followups WHERE session_id=? ORDER BY'))return [[{id:'102',actor_user_id:'6',contacted_on:'2026-10-17',customer_confirmed:1,feedback:'已确认',outcome:'待进一步处理',next_action:'回访',next_followup_on:'2026-10-20'}],[]];
    if(sql.includes('FROM sample_followup_products WHERE session_id=?'))return [[{followup_id:'102',product_id:'18'}],[]];
    throw Error('Unexpected SQL '+sql);
   }};
 }
}
const status=(code:number)=>(e:unknown)=>e instanceof SampleFulfillmentError&&e.status===code;
test('B3 granted active sales sees paged factual shipment and follow-up history; selection facts unchanged',async()=>{
 const db=new Db();
 const shipments=await readSampleFulfillmentHistory(db,actor,'41','shipments',{limit:10,offset:0});
 assert.deepEqual(shipments,{sessionId:'41',total:1,limit:10,offset:0,items:[
  {id:'101',actorUserId:'6',shippedAt:'2026-10-17T09:15:00.000Z',carrier:'顺丰',trackingNo:'SF123',items:[{productId:'18',quantity:2}]}
 ]});
 const followups=await readSampleFulfillmentHistory(db,actor,'41','followups',{limit:10,offset:0});
 assert.deepEqual(followups,{sessionId:'41',total:1,limit:10,offset:0,items:[
  {id:'102',actorUserId:'6',contactedOn:'2026-10-17',customerConfirmed:true,feedback:'已确认',outcome:'待进一步处理',nextAction:'回访',nextFollowupOn:'2026-10-20',productIds:['18']}
 ]});
 assert.equal(db.commits,2);
 assert(db.calls.every(c=>c.sql.startsWith('SELECT')),'read must be SELECT only');
 assert(!db.calls.some(c=>c.sql.includes('qr_payload')||c.sql.includes('customer_reference')));
});
test('B3 closed granted session can read facts, explicit grant loss and role mismatch block before private history',async()=>{
 const db=new Db();db.closed=true;
 assert.equal((await readSampleFulfillmentHistory(db,actor,'41','shipments')).total,1);
 db.grant=false;db.calls=[];
 await assert.rejects(readSampleFulfillmentHistory(db,actor,'41','followups'),status(404));
 assert(!db.calls.some(c=>c.sql.includes('sample_followups')));
 db.grant=true;db.role='admin';db.calls=[];
 await assert.rejects(readSampleFulfillmentHistory(db,actor,'41','shipments'),status(403));
 assert(!db.calls.some(c=>c.sql.includes('sample_shipments')));
});
test('B3 fails closed on invalid pagination/identity/kind and does not open SQL',async()=>{
 const db=new Db();
 for(const [id,kind,page] of [['0','shipments',{}],['41','invalid',{}],['41','shipments',{limit:1000}],['41','followups',{offset:-1}]] as const)
  await assert.rejects(readSampleFulfillmentHistory(db,actor,id,kind as never,page),status(400));
 assert.equal(db.calls.length,0);
});
