import assert from 'node:assert/strict';
import test from 'node:test';
import type {AppPrincipal} from '../access/types';
import {saveShipmentBatch,saveSampleFollowup,SampleFulfillmentError} from './fulfillmentService';
import {getFulfillmentSchemaStatements} from './fulfillmentSchema';

const actor:AppPrincipal={userId:'6',sessionId:'9',role:'sales',username:'s',displayName:'S',
 canManageOwnOrders:false,canManageProducts:false};
const shipment={sessionId:'41',shippedAt:'2026-10-17T09:15:00.000Z',carrier:'顺丰',trackingNo:'SF123',items:[{productId:'18',quantity:3}]};
const follow={sessionId:'41',contactedOn:'2026-10-17',customerConfirmed:true,feedback:'已确认',outcome:'需再寄样',nextAction:'下周回访',nextFollowupOn:'2026-10-20',productIds:['18']};
type Row=Record<string,unknown>;
class Db {
 calls:{sql:string;args:unknown[]}[]=[];commits=0;rollbacks=0;releases=0;
 userRole='sales';active=true;login=true;granted=true;status='open';selected=true;failAt='';
 shipments:Row[]=[];lines:Row[]=[];followups:Row[]=[];links:Row[]=[];
 async getConnection(){
  const owner=this;let backup:{shipments:Row[];lines:Row[];followups:Row[];links:Row[]}|null=null;
  return {beginTransaction:async()=>{backup={shipments:owner.shipments.slice(),lines:owner.lines.slice(),followups:owner.followups.slice(),links:owner.links.slice()};},
   commit:async()=>{if(owner.failAt==='commit')throw Error('secret failure');owner.commits++;backup=null;},
   rollback:async()=>{owner.rollbacks++;if(backup){owner.shipments=backup.shipments;owner.lines=backup.lines;owner.followups=backup.followups;owner.links=backup.links;}},
   release:()=>{owner.releases++;},
   query:async(sql:string,args:unknown[]=[]):Promise<[unknown,unknown]>=>{
    owner.calls.push({sql,args});
    if(sql.includes('FROM v2_access_users'))return [owner.active?[{role:owner.userRole,is_active:1}]:[],[]];
    if(sql.includes('FROM v2_access_sessions'))return [owner.login?[{id:'9'}]:[],[]];
    if(sql.includes('FROM customer_sample_sessions'))return [[{id:'41',status:owner.status}],[]];
    if(sql.includes('FROM customer_sample_session_access'))return [owner.granted?[{can_manage:1}]:[],[]];
    if(sql.startsWith('SELECT')&&sql.includes('FROM customer_sample_items'))return [owner.selected?[{id:'81',product_id:'18',removed_at:null}]:[],[]];
    if(sql.startsWith('INSERT')&&owner.failAt==='line'&&sql.includes('sample_shipment_items'))throw Error('secret failure');
    if(sql.startsWith('INSERT')&&owner.failAt==='followLink'&&sql.includes('sample_followup_products'))throw Error('secret failure');
    if(sql.startsWith('INSERT INTO sample_shipments')){owner.shipments.push({args});return [{affectedRows:1,insertId:'101'},[]];}
    if(sql.startsWith('INSERT INTO sample_shipment_items')){owner.lines.push({args});return [{affectedRows:1},[]];}
    if(sql.startsWith('INSERT INTO sample_followups')){owner.followups.push({args});return [{affectedRows:1,insertId:'102'},[]];}
    if(sql.startsWith('INSERT INTO sample_followup_products')){owner.links.push({args});return [{affectedRows:1},[]];}
    throw Error('Unknown SQL');
   }};
 }
}
const status=(n:number)=>(e:unknown)=>e instanceof SampleFulfillmentError&&e.status===n;
test('SHIP-01: authorized write saves a real batch + product quantities atomically, not selected state',async()=>{
 const db=new Db(),result=await saveShipmentBatch(db,actor,shipment);
 assert.deepEqual(result,{id:'101',sessionId:'41',itemCount:1});
 assert.equal(db.shipments.length,1);assert.equal(db.lines.length,1);
 assert.deepEqual((db.shipments[0].args as unknown[]).slice(0,2),['41','6']);
 assert.deepEqual((db.lines[0].args as unknown[]).slice(1),['41','18',3]);
 assert.equal(db.commits,1);assert.equal(db.releases,1);
 assert(db.calls.filter(c=>/^INSERT/.test(c.sql)).every(c=>!c.sql.includes('customer_sample_items')));
});
test('FOLLOW-01: authorized write stores factual result with selected product link and no auto order',async()=>{
 const db=new Db();db.userRole='admin';const result=await saveSampleFollowup(db,{...actor,role:'admin'},follow);
 assert.deepEqual(result,{id:'102',sessionId:'41',linkedProductCount:1});
 assert.equal(db.followups.length,1);assert.equal(db.links.length,1);
 assert.equal(db.followups[0].args[1],'6');
 assert(db.calls.every(c=>!c.sql.includes('orders')));
});
test('SHIP/FOLLOW: grant, login, role and closed session fail before writes',async()=>{
 for(const kind of ['grant','login','role','closed','selection'] as const){
  for(const save of [(db:Db)=>saveShipmentBatch(db,actor,shipment),(db:Db)=>saveSampleFollowup(db,actor,follow)]){
   const db=new Db();
   if(kind==='grant')db.granted=false;
   if(kind==='login')db.login=false;
   if(kind==='role')db.userRole='admin';
   if(kind==='closed')db.status='closed';
   if(kind==='selection')db.selected=false;
   await assert.rejects(save(db),status(kind==='grant'?404:kind==='login'||kind==='role'?403:409));
   assert.equal(db.rollbacks,1);assert.equal(db.commits,0);
   assert(!db.calls.some(c=>/^INSERT/.test(c.sql)));
  }
 }
});
test('SHIP/FOLLOW: line/link and commit failures restore batch, followup and references',async()=>{
 for(const [failAt,save] of [
  ['line', (db:Db)=>saveShipmentBatch(db,actor,shipment)],
  ['followLink',(db:Db)=>saveSampleFollowup(db,actor,follow)],
  ['commit',(db:Db)=>saveShipmentBatch(db,actor,shipment)]
 ] as const){
  const db=new Db();db.failAt=failAt;
  await assert.rejects(save(db),/secret failure/);
  assert.deepEqual([db.shipments,db.lines,db.followups,db.links],[[],[],[],[]]);
  assert.equal(db.rollbacks,1);assert.equal(db.releases,1);
 }
});
test('B3 opt-in fresh schema declares restrictive historical references and transaction tables without applying DDL',()=>{
 const list=getFulfillmentSchemaStatements();
 assert.deepEqual(list.map(t=>t.name),['sample_shipments','sample_shipment_items','sample_followups','sample_followup_products']);
 for(const t of list){assert.match(t.sql,/ENGINE=InnoDB/);assert.match(t.sql,/ON DELETE RESTRICT/);assert(!/DROP|ALTER|IF NOT EXISTS/.test(t.sql));}
 assert.match(list[1].sql,/FOREIGN KEY \(session_id,product_id\) REFERENCES customer_sample_items\(session_id,product_id\)/);
 assert.match(list[3].sql,/FOREIGN KEY \(session_id,product_id\) REFERENCES customer_sample_items\(session_id,product_id\)/);
 for(const [parent,child] of [[0,1],[2,3]]){
  assert.match(list[parent].sql,/UNIQUE KEY uq_\w+_session \(id,session_id\)/);
  assert.match(list[child].sql,/FOREIGN KEY \((?:shipment_id|followup_id),session_id\) REFERENCES \w+\(id,session_id\)/);
 }

});
