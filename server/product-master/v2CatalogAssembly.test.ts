import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import type {Server} from 'node:http';
import {hashPassword,hashSessionToken} from '../access/password';
import ExcelJS from 'exceljs';
import {createV2CatalogAssembly} from './v2CatalogAssembly';

type Role='admin'|'sales';
interface Member{id:string;name:string;role:Role;active:boolean;canManageProducts:boolean;canManageOwnOrders:boolean;hash:string}
const sessionToken='a'.repeat(64);
class IsolatedDb{
 members:Member[]=[];sessionOwner='2';sessionActive=true;failed=false;
 issuedSessions=new Map<string,string>();
 calls:{sql:string;params:unknown[]}[]=[];
 async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>{
  this.calls.push({sql,params});
  if(this.failed)throw new Error('private mysql password should never leak');
  if(sql==='SELECT DATABASE() AS database_name, @@server_uuid AS server_uuid')
   return [[{database_name:'fabric_v2_test_20261014_p7',server_uuid:'test-uuid'}],[]];
  if(sql.includes('v2_access_users WHERE username_normalized')){
   const row=this.members.find(x=>x.name===params[0]);
   return [row?[{id:row.id,password_hash:row.hash,is_active:row.active?1:0}]:[],[]];
  }
  if(sql.includes('INSERT INTO v2_access_sessions')){
   this.issuedSessions.set(String(params[1]),String(params[0]));return [{insertId:'9'},[]];
  }
  if(sql.includes('JOIN v2_access_users')&&sql.includes('s.token_hash')){
   const owner=params[0]===hashSessionToken(sessionToken)?this.sessionOwner:
    this.issuedSessions.get(String(params[0]));
   if(!this.sessionActive||!owner)return [[],[]];
   const member=this.members.find(x=>x.id===owner);
   if(!member||!member.active)return [[],[]];
   return [[{user_id:member.id,username:member.name,display_name:member.name,
    role:member.role,can_manage_own_orders:member.canManageOwnOrders?1:0,
    can_manage_products:member.canManageProducts?1:0,session_id:'9'}],[]];
  }
  if(sql.includes('FROM v2_access_users WHERE id=?')){
   const member=this.members.find(x=>x.id===params[0]);
   return [member?[{id:member.id,role:member.role,is_active:member.active?1:0,
    can_manage_products:member.canManageProducts?1:0}]:[],[]];
  }
  if(sql.includes('FROM v2_access_sessions WHERE id=?'))
   return [this.sessionActive?[{id:'9'}]:[],[]];
  if(sql.startsWith('UPDATE v2_access_sessions SET revoked_at')){this.sessionActive=false;return [{affectedRows:1},[]];}
  if(sql.includes('FROM v2_products WHERE id=? FOR UPDATE'))return [[{id:'7',is_active:1}],[]];
  if(sql.includes('FROM order_items WHERE v2_product_id=?'))return [[{total:1}],[]];
  if(sql.startsWith('UPDATE v2_products SET is_active=0'))return [{affectedRows:1},[]];
  if(sql.startsWith('SELECT')&&sql.includes('FROM pattern_masters'))return [[],[]];
  if(sql.startsWith('SELECT')&&sql.includes('FROM shared_tags'))return [[],[]];
  if(sql.startsWith('SELECT')&&sql.includes('FROM v2_fabrics')&&sql.includes('COUNT(*)'))
   return [[{total:0}],[]];
  if(sql.startsWith('SELECT')&&sql.includes('FROM v2_fabrics'))return [[],[]];
  if(sql.startsWith('SELECT')&&sql.includes('FROM v2_products')&&sql.includes('COUNT(*)'))
   return [[{total:0}],[]];
  if(sql.startsWith('SELECT COUNT(*) AS order_count')&&sql.includes('FROM orders o'))
   return [[{order_count:0,amount_total:0,meters_total:0}],[]];
  if(sql.startsWith("SELECT COALESCE(NULLIF(TRIM(i.product_name),''),'未命名的面料') AS product_name,")&&
   sql.includes('FROM orders o JOIN order_items i ON i.order_id=o.id WHERE ' )&&
   sql.endsWith('ORDER BY meters_total DESC,product_name ASC LIMIT 5'))return [[],[]];
  if(sql.startsWith('SELECT o.id,o.order_no,o.order_date,o.receiving_unit,o.template_type,o.total_meters,o.total_amount FROM orders o WHERE ' )&&
   sql.endsWith('ORDER BY o.order_date DESC,o.id DESC LIMIT 4'))return [[],[]];
  if(sql.startsWith('SELECT COUNT(*)')&&sql.includes('FROM orders o'))return [[{total:0}],[]];
  if(sql.startsWith('SELECT COUNT(*)')&&sql.includes('FROM v2_products p'))return [[{total:0}],[]];
  // Deliberately fail closed for SQL contracts not supported by this HTTP fixture.
  throw new Error('Unexpected SQL shape (must be checked against real sandbox) '+sql.slice(0,40));
 }
 async getConnection(){
  return {query:this.query.bind(this),beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release:()=>{}};
 }
}

/** B2-4 unified assembly SQL substitute: real HTTP + real card/scan services. */
class CardAssemblyDb extends IsolatedDb{
 card:Record<string,unknown>|null=null;tokenHash='';granted=true;products=1;
 items:Record<string,unknown>[]=[];event=0;removalEvents=0;manualEvents:Record<string,unknown>[]=[];sourceProducts=new Set<string>();drift=false;
 async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>{
  if(sql==='SELECT DATABASE() AS database_name, @@server_uuid AS server_uuid'&&this.drift){
   this.calls.push({sql,params});return [[{database_name:'fabric_db',server_uuid:'test-uuid'}],[]];
  }
  const reply=(data:unknown):[unknown,unknown]=>{this.calls.push({sql,params});return [data,[]];};
  if(sql.startsWith('SELECT')&&sql.includes('FROM pattern_masters WHERE id=?'))return reply([{id:'41',master_no:'0012',next_colorway_no:2,is_active:1}]);
  if(sql.startsWith('SELECT')&&sql.includes('FROM v2_fabrics WHERE id=?'))return reply([{id:'23',fabric_no:'F018',fabric_name:'丝绸',composition:'100%S',weight_value:'16',weight_unit:'mm',width_value:'140',remark:null,is_active:1}]);
  if(sql.startsWith('INSERT INTO sample_cards')){this.card={id:'12',master_id:params[0],fabric_id:params[1],card_no:params[2],qr_payload:params[3],is_active:1,deleted_at:null};return reply({insertId:'12'});}
  if(sql.startsWith('INSERT INTO sample_card_tokens')){this.tokenHash=String(params[1]);return reply({insertId:'1'});}
  if(sql.includes('SELECT sc.id AS card_id'))return reply(Array.from({length:this.products},(_,i)=>({card_id:'12',id:String(81+i),product_no:`0012-${i+1}-F018`,colorway_no:i+1,pattern_no:`0012-${i+1}`,pattern_image_asset_id:null})));
  if(sql.includes('FROM sample_cards')){
   const row=this.card?{...this.card,master_no:'0012',fabric_no:'F018',fabric_name:'丝绸',composition:'100%S',weight_value:'16',weight_unit:'mm',width_value:'140',token_hash:this.tokenHash}:null;
   return reply(sql.includes('COUNT(*)')?[{total:row?1:0}]:row?[row]:[]);
  }
  if(sql.includes('FROM sample_card_tokens')){
   const lockingByCard=/WHERE (?:t\.)?card_id=\?/.test(sql);
   const matched=this.card&&(lockingByCard?params[0]==='12':this.tokenHash===params[0]);
   return reply(matched?[{card_id:'12',master_id:'41',fabric_id:'23',is_active:1,token_hash:this.tokenHash,revoked_at:null}]:[]);
  }
  if(sql.includes('FROM customer_sample_sessions s'))return reply(this.granted?[{id:'51'}]:[]);
  if(sql.includes('FROM customer_sample_sessions'))return reply([{id:'51',status:'open',created_by_user_id:'2'}]);
  if(sql.includes('FROM customer_sample_session_access'))return reply(this.granted?[{can_manage:1}]:[]);
  if(sql.includes('FROM v2_products p')&&sql.includes('WHERE p.id=? FOR SHARE')){
   return reply(params[0]==='81'?[{id:'81',product_active:1,sampling_available:1,colorway_active:1,master_active:1,fabric_active:1}]:[]);
  }
  if(sql.includes('FROM v2_products p')&&sql.includes('FOR SHARE')){
   assert.deepEqual(params,['23','41']);return reply(Array.from({length:this.products},(_,i)=>({id:String(81+i),fabric_id:'23',master_id:'41',product_no:'0012-'+(i+1)+'-F018',colorway_no:i+1,master_no:'0012',fabric_name:'丝绸',composition:'100%S',weight_value:16,weight_unit:'mm',width_value:140,product_active:1,sampling_available:1,colorway_active:1,master_active:1,fabric_active:1})));
  }
  if(sql.includes('FROM v2_products')||sql.includes('FROM pattern_colorways'))return reply([]);
  if(sql.includes('SELECT product_id,removed_at FROM customer_sample_items'))return reply(this.items.map(item=>({...item,removed_at:item.removed_at??null})));
  if(sql.startsWith('SELECT id,product_id,removed_at,removed_by_user_id FROM customer_sample_items')&&sql.includes('product_id=?')){
   const index=this.items.findIndex(item=>item.product_id===params[1]);
   return reply(index<0?[]:[{id:String(index+61),...this.items[index],removed_at:this.items[index].removed_at??null,removed_by_user_id:this.items[index].removed_by_user_id??null}]);
  }
  if(sql.startsWith('SELECT id,product_id,removed_at,removed_by_user_id FROM customer_sample_items')){
   const index=this.items.findIndex((item,i)=>String(i+61)===String(params[1]));
   return reply(index<0?[]:[{id:String(index+61),...this.items[index],removed_at:this.items[index].removed_at??null,removed_by_user_id:this.items[index].removed_by_user_id??null}]);
  }
  if(sql.startsWith('UPDATE customer_sample_items SET removed_at=UTC_TIMESTAMP()')){
   const index=this.items.findIndex((item,i)=>String(i+61)===String(params[2]));
   if(index<0||this.items[index].removed_at!=null)return reply({affectedRows:0});
   this.items[index].removed_at='2026-10-15 10:00:00';this.items[index].removed_by_user_id=params[0];
   return reply({affectedRows:1});
  }
  if(sql.startsWith('UPDATE customer_sample_items SET removed_at=NULL')){
   const index=this.items.findIndex(item=>item.product_id===params[1]);
   if(index<0||this.items[index].removed_at==null)return reply({affectedRows:0});
   this.items[index].removed_at=null;this.items[index].removed_by_user_id=null;
   return reply({affectedRows:1});
  }
  if(sql.startsWith('INSERT INTO customer_sample_item_removal_events')){this.removalEvents++;return reply({affectedRows:1,insertId:this.removalEvents});}
  if(sql.startsWith('INSERT INTO customer_sample_manual_events')){
   this.manualEvents.push({session_id:params[0],product_id:params[1],actor_user_id:params[2],action:params[3],card_id:params[4]});
   return reply({insertId:this.manualEvents.length,affectedRows:1});
  }
  if(sql.startsWith('INSERT INTO customer_sample_item_sources'))this.sourceProducts.add(String(params[1]));
  if(sql.startsWith('INSERT INTO customer_sample_scan_events'))return reply({insertId:String(++this.event)});
  if(sql.startsWith('INSERT INTO customer_sample_items')){this.items.push({product_id:params[1],removed_at:null,removed_by_user_id:null,selected_by_user_id:params[2]});return reply({insertId:String(60+this.items.length),affectedRows:1});}
  if(sql.startsWith('INSERT INTO customer_sample_'))return reply({insertId:'1'});
  if(sql.includes('COUNT(*) AS total FROM customer_sample_selected_cards'))return reply([{total:1}]);
  return super.query(sql,params);
 }
 async getConnection(){
  const db=this;let verified=false,snapshot:typeof this.card=null,oldHash='',oldItems:typeof this.items=[];
  return {
   query:async(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>=>{
    if(sql.startsWith('SELECT DATABASE()'))verified=true;else assert(verified,'same physical connection identity before all business queries');
    return db.query(sql,params);
   },
   beginTransaction:async()=>{assert(verified);snapshot=db.card;oldHash=db.tokenHash;oldItems=[...db.items];},
   commit:async()=>{},rollback:async()=>{db.card=snapshot;db.tokenHash=oldHash;db.items=oldItems;},release:()=>{}
  };
 }
}
/** B3 selected identities remain stable while descriptions read current master data. */
class HistoryAssemblyDb extends CardAssemblyDb{
 retired=false;currentFabricName='更新后丝绸';
 async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>{
  const reply=(data:unknown):[unknown,unknown]=>{this.calls.push({sql,params});return [data,[]];};
  if(sql.includes('AS selected_card_count')){
   assert.deepEqual(params,['51']);
   return reply([{customer_reference:'客户A',total:this.items.filter(x=>x.removed_at==null).length,selected_card_count:this.event||this.manualEvents.length?1:0}]);
  }
  if(sql.startsWith('SELECT i.id,i.product_id,p.product_no')){
   assert.deepEqual(params,['51',50,0]);
   return reply(this.items.flatMap((item,index)=>item.removed_at!=null?[]:[{id:String(index+61),product_id:item.product_id,product_no:'0012-1-F018',master_no:'0012',colorway_no:1,fabric_no:'F018',fabric_name:this.currentFabricName,composition:'更新成分',weight_value:'18.000',weight_unit:'gsm',width_value:'145.00'}]));
  }
  if(sql.includes('FROM customer_sample_item_sources src')){
   assert.deepEqual(params,['51',...this.items.map(item=>item.product_id)]);
   return reply(this.items.filter(item=>this.sourceProducts.has(String(item.product_id))).map(item=>({product_id:item.product_id,card_id:'12',card_no:'0012-F018',deleted_at:this.retired?'2026-10-14':null,first_scan_event_id:'1'})));
  }
  if(sql.includes('FROM customer_sample_manual_events e')){
   return reply([...new Set(this.manualEvents.map(x=>String(x.product_id)))].map(product_id=>({product_id,card_id:'12',card_no:'0012-F018',deleted_at:this.retired?'2026-10-14':null,first_manual_event_id:String(this.manualEvents.findIndex(x=>x.product_id===product_id)+1)})));
  }
  return super.query(sql,params);
 }
}
test('B3 unified V2 HTTP mounts private single-item removal with fresh authentication',async()=>{
 const db=new HistoryAssemblyDb();db.members=(await setup()).members;
 await withHttp(db,async base=>{
  const route='/customer-samples/sessions/51/items/61';
  const anonymous=await request(base,route,'DELETE',undefined,null);
  assert.equal(anonymous.status,401);
  const missing=await request(base,route,'DELETE');
  assert.equal(missing.status,404,'authorized missing item returns 404 via real service');
  assert.equal(missing.headers.get('cache-control'),'no-store');
  for(const [type,payload] of [['application/json','{"productId":"9"}'],['text/plain','productId=9']] as const){
   const bodyResponse=await fetch(base+route,{method:'DELETE',headers:{authorization:'Bearer '+sessionToken,'content-type':type},body:payload});
   assert.equal(bodyResponse.status,400,'DELETE must reject hidden payloads even without an Express body parser');
  }
  const created=await request(base,'/sample-cards','POST',{masterId:'41',fabricId:'23'});
  assert.equal(created.status,201);const card=(await created.json()).card;
  assert.equal((await request(base,'/sample-cards/scan','POST',{cardToken:card.qrPayload,sessionId:'51'})).status,200);
  const removed=await request(base,route,'DELETE');assert.equal(removed.status,200);
  assert.equal(db.removalEvents,1);
  const hidden=await request(base,'/customer-samples/sessions/51');
  assert.equal(hidden.status,200);assert.equal((await hidden.json()).total,0);
  const restored=await request(base,'/sample-cards/scan','POST',{cardToken:card.qrPayload,sessionId:'51'});
  assert.equal(restored.status,200);assert.deepEqual((await restored.json()).addedProductIds,['81']);
  const visible=await request(base,'/customer-samples/sessions/51');
  assert.equal(visible.status,200);assert.equal((await visible.json()).total,1);
  assert.equal(db.removalEvents,1,'restore must not erase append-only removal audit');
 });
});
test('AC-84 unified HTTP requires a card, reads latest data, records manual card provenance and restores removed rows',async()=>{
 const db=new HistoryAssemblyDb();db.members=(await setup()).members;
 await withHttp(db,async base=>{
  const url='/customer-samples/sessions/51/items/manual',view='/customer-samples/sessions/51';
  assert.equal((await request(base,url,'POST',{productId:'81'},null)).status,401);
  assert.equal((await request(base,url,'POST',{productId:'81',actor_user_id:'2'})).status,400);
  assert.equal((await request(base,url,'POST',{productId:'81'})).status,400);
  assert.equal((await request(base,'/sample-cards','POST',{masterId:'41',fabricId:'23'})).status,201);
  const candidates=await request(base,'/customer-samples/sessions/51/cards?query=0012&limit=20&offset=0');assert.equal(candidates.status,200);
  const search=await candidates.json();assert.equal(search.items[0].cardNo,'0012-F018');assert.equal(search.items[0].products[0].id,'81');assert(!JSON.stringify(search).includes('qrPayload'));
  const added=await request(base,url,'POST',{cardId:'12',productIds:['81']});assert.equal(added.status,200);
  assert.deepEqual(await added.json(),{sessionId:'51',cardId:'12',items:[{productId:'81',itemId:'61',action:'added'}]});
  let page=await request(base,view);assert.equal(page.status,200);
  let json=await page.json();assert.equal(json.total,1);assert.equal(json.selectedCardCount,1);
  assert.deepEqual(json.items[0].sources,[{cardId:'12',cardNo:'0012-F018',retired:false,firstScanEventId:null,firstManualEventId:'1'}],'manual card source must not forge a scan event');
  assert.equal(json.items[0].current.fabricName,'更新后丝绸','manual selection reads live attributes');
  const repeat=await request(base,url,'POST',{cardId:'12'});assert.equal(repeat.status,200);
  assert.equal((await repeat.json()).items[0].action,'already_selected');assert.equal(db.items.length,1);
  const removed=await request(base,'/customer-samples/sessions/51/items/61','DELETE');assert.equal(removed.status,200);
  const restore=await request(base,url,'POST',{cardId:'12',productIds:['81']});assert.equal(restore.status,200);
  assert.equal((await restore.json()).items[0].action,'restored');
  assert.equal(db.items.length,1);assert.equal(db.manualEvents.length,3);
  assert.deepEqual(db.manualEvents.map(x=>x.action),['added','already_selected','restored']);
  assert.equal(db.removalEvents,1);assert.equal(db.event,0);
  db.granted=false;assert.equal((await request(base,url,'POST',{cardId:'12'})).status,404);
  db.drift=true;assert.equal((await request(base,url,'POST',{cardId:'12'})).status,503);
 });
});
test('AC-84 manually preselected product is deduplicated on later card scan; physical source is appended without changing item',async()=>{
 const db=new HistoryAssemblyDb();db.members=(await setup()).members;
 await withHttp(db,async base=>{
  const created=await request(base,'/sample-cards','POST',{masterId:'41',fabricId:'23'});
  assert.equal(created.status,201);const card=(await created.json()).card;
  assert.equal((await request(base,'/customer-samples/sessions/51/items/manual','POST',{cardId:card.id,productIds:['81']})).status,200);
  const selected=await request(base,'/sample-cards/scan','POST',{cardToken:card.qrPayload,sessionId:'51'});
  assert.equal(selected.status,200);
  const result=await selected.json();assert.deepEqual(result.addedProductIds,[]);
  assert.deepEqual(result.alreadySelectedProductIds,['81']);
  const view=await request(base,'/customer-samples/sessions/51');assert.equal(view.status,200);
  const data=await view.json();assert.equal(data.total,1);assert.equal(data.selectedCardCount,1);
  assert.equal(data.items.length,1);
  assert.deepEqual(data.items[0].sources,[{cardId:'12',cardNo:'0012-F018',retired:false,firstScanEventId:'1',firstManualEventId:'1'}]);
  assert.equal(db.items.length,1);assert.equal(db.manualEvents.length,1);
 });
});
test('B3 unified HTTP reads granted live history for sales and admin and audits admin removal',async()=>{
 const db=new HistoryAssemblyDb();db.members=(await setup()).members;
 await withHttp(db,async base=>{
  const path='/customer-samples/sessions/51';
  assert.equal((await request(base,path,'GET',undefined,null)).status,401);
  const empty=await request(base,path);assert.equal(empty.status,200);assert.deepEqual((await empty.json()).items,[]);
  assert(!db.calls.some(c=>c.sql.includes('FROM customer_sample_item_sources src')),'empty page skips source query');
  const made=await request(base,'/sample-cards','POST',{masterId:'41',fabricId:'23'});assert.equal(made.status,201);
  const card=(await made.json()).card;
  assert.equal((await request(base,'/sample-cards/scan','POST',{cardToken:card.qrPayload,sessionId:'51'})).status,200);
  db.products=0;db.retired=true;
  const start=db.calls.length,read=await request(base,path);assert.equal(read.status,200);
  assert.equal(read.headers.get('cache-control'),'no-store');
  const page=await read.json();assert.equal(page.total,1);assert.equal(page.selectedCardCount,1);
  assert.equal(page.items[0].productId,'81');assert.equal(page.items[0].current.fabricName,'更新后丝绸');
  assert.equal(page.items[0].current.weightUnit,'gsm');
  assert.deepEqual(page.items[0].sources,[{cardId:'12',cardNo:'0012-F018',retired:true,firstScanEventId:'1'}]);
  assert(db.calls.slice(start).some(c=>c.sql.includes('JOIN v2_products')&&c.sql.includes('JOIN v2_fabrics')),'reads current catalog in authorized transaction');
  assert(!db.calls.slice(start).some(c=>/product_snapshot_json|qr_payload|^(INSERT|UPDATE|DELETE)/.test(c.sql)),'read-only history does not fetch archived attributes or QR payload');
  db.sessionOwner='1';
  const adminPage=await request(base,path);assert.equal(adminPage.status,200);
  assert.equal((await adminPage.json()).items[0].productId,'81');
  const adminRemove=await request(base,'/customer-samples/sessions/51/items/61','DELETE');
  assert.equal(adminRemove.status,200);
  assert.equal(db.items[0].removed_by_user_id,'1','admin removal actor must be recorded independently of selection owner');
  assert.equal(db.items[0].selected_by_user_id,'2','original selected-by identity stays unchanged');
  assert.equal(db.removalEvents,1);
  db.granted=false;assert.equal((await request(base,path)).status,404);
  assert.equal((await request(base,'/customer-samples/sessions/51/items/61','DELETE')).status,404);
  db.sessionActive=false;assert.equal((await request(base,path)).status,401);
 });
});
test('B2-4 unified admin parent routes preserve printed card number and payload despite zero products',async()=>{
 const db=await cardDb();
 await withHttp(db,async base=>{
  const made=await request(base,'/sample-cards','POST',{masterId:'41',fabricId:'23'});assert.equal(made.status,201);
  const original=(await made.json()).card;db.sessionOwner='1';
  for(const [path,method,body] of [['/pattern-masters/41','PATCH',{masterNo:'9999'}],['/fabrics/23','PATCH',{fabricNo:'F999'}],['/pattern-masters/41','DELETE',undefined],['/fabrics/23','DELETE',undefined]] as const){
   const response=await request(base,path,method,body);assert.equal(response.status,409,path);
  }
  assert(!db.calls.some(c=>/^(UPDATE|DELETE FROM) (pattern_masters|v2_fabrics)/.test(c.sql)),'no parent identity DML after card reference');
  const fresh=await request(base,'/sample-cards');assert.equal(fresh.status,200);
  const persisted=(await fresh.json()).items[0];assert.equal(persisted.cardNo,original.cardNo);assert.equal(persisted.qrPayload,original.qrPayload);
 });
});
async function cardDb(){const db=new CardAssemblyDb();db.members=(await setup()).members;return db;}
test('B2-4 unified guarded HTTP exposes sales card create/read/text Excel and authorized delta scan',async()=>{
 const db=await cardDb();
 await withHttp(db,async base=>{
  const body={masterId:'41',fabricId:'23'};
  assert.equal((await request(base,'/sample-cards','POST',body,null)).status,401);
  const created=await request(base,'/sample-cards','POST',body);assert.equal(created.status,201);
  const first=await created.json();assert.equal(first.card.cardNo,'0012-F018');
  const duplicate=await request(base,'/sample-cards','POST',body);assert.equal(duplicate.status,200);assert.equal((await duplicate.json()).card.qrPayload,first.card.qrPayload);
  const list=await request(base,'/sample-cards');assert.equal(list.status,200);assert.equal((await list.json()).items[0].qrPayload,first.card.qrPayload);
  const file=await request(base,'/sample-cards/export','POST',{cardIds:['12']});assert.equal(file.status,200);
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(Buffer.from(await file.arrayBuffer()));
  assert.equal(workbook.worksheets[0].getCell('F2').value,first.card.qrPayload);
  const scan={cardToken:first.card.qrPayload,sessionId:'51'};
  const selected=await request(base,'/sample-cards/scan','POST',scan);assert.equal(selected.status,200);assert.deepEqual((await selected.json()).addedProductIds,['81']);
  db.products=2;const more=await request(base,'/sample-cards/scan','POST',scan);assert.equal(more.status,200);assert.deepEqual((await more.json()).addedProductIds,['82']);
  db.granted=false;assert.equal((await request(base,'/sample-cards/scan','POST',scan)).status,403);
  db.sessionOwner='1';assert.equal((await request(base,'/sample-cards/export','POST',{cardIds:['12']})).status,200);
  assert.equal((await request(base,'/sample-cards/scan','POST',scan)).status,403);
  db.members[0].active=false;assert.equal((await request(base,'/sample-cards')).status,401);
 });
});
test('B2-4 cards use the guarded pool for all reads/writes; target drift rejects before any business query',async()=>{
 const db=await cardDb();
 await withHttp(db,async base=>{
  db.drift=true;const start=db.calls.length;
  for(const [path,method,body] of [['/sample-cards','GET',undefined],['/sample-cards','POST',{masterId:'41',fabricId:'23'}],['/sample-cards/export','POST',{cardIds:['12']}],['/sample-cards/scan','POST',{cardToken:'a'.repeat(43),sessionId:'51'}],['/customer-samples/sessions/51','GET',undefined]] as const){
   const response=await request(base,path,method,body);assert.equal(response.status,503);
   assert(!JSON.stringify(await response.json()).includes('fabric_db'));
  }
  assert(db.calls.slice(start).every(c=>c.sql.startsWith('SELECT DATABASE()')),'no auth, catalog or DML on drifted physical connection');
 });
});
test('B2-4 unified scan parser authenticates then accepts JSON; malformed and oversized bodies are safe',async()=>{
 const db=await cardDb();
 await withHttp(db,async base=>{
  const post=(body:string,token:string|null=sessionToken)=>fetch(base+'/sample-cards/scan',{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body});
  assert.equal((await post('{',null)).status,401);
  const malformed=await post('{');assert.equal(malformed.status,400);assert(!((await malformed.text()).includes('SyntaxError')));
  assert.equal((await post(JSON.stringify({extra:'x'.repeat(10000)}))).status,413);
  db.sessionOwner='1';
  assert.equal((await post('{')).status,403,'admin role rejected before parsing');
  const nonJson=await fetch(base+'/sample-cards/scan',{method:'POST',headers:{authorization:'Bearer '+sessionToken,'content-type':'text/plain'},body:'{}'});
  assert.equal(nonJson.status,403);
 });
});
async function setup(){
 const db=new IsolatedDb();
 db.members=[
  {id:'1',name:'admin',role:'admin',active:true,canManageProducts:true,canManageOwnOrders:true,hash:await hashPassword('catalog-admin-example')},
  {id:'2',name:'sales',role:'sales',active:true,canManageProducts:false,canManageOwnOrders:false,hash:await hashPassword('catalog-sales-example')}
 ];
 return db;
}
async function withHttp(db:IsolatedDb,go:(root:string)=>Promise<void>,pool:{getConnection:()=>Promise<unknown>}=db,accessDb:{query:(sql:string,params?:unknown[])=>Promise<[unknown,unknown]>}=db){
 const app=express();
 app.use('/api/v2',await createV2CatalogAssembly(accessDb as never,pool as never,{database:'fabric_v2_test_20261014_p7',confirmation:'I_ACKNOWLEDGE_SANDBOX'}));
 const server:Server=await new Promise((resolve,reject)=>{
  const started=app.listen(0,'127.0.0.1',()=>resolve(started));started.on('error',reject);
 });
 try{
  const addr=server.address();assert(addr&&typeof addr!=='string');
  await go('http://127.0.0.1:'+addr.port+'/api/v2');
 }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
}
const paths=[
 '/access/me','/pattern-catalog','/pattern-masters','/pattern-masters/1/colorways',
 '/pattern-masters/1/colorway-details','/tags?dimension=color',
 '/fabrics','/fabrics/catalog','/products','/products/1'
];
async function request(base:string,path:string,method='GET',body?:unknown,token:string|null=sessionToken){
 return fetch(base+path,{method,headers:{
  ...(token?{authorization:'Bearer '+token}:{}),
  ...(body===undefined?{}:{'content-type':'application/json'})
 },...(body===undefined?{}:{body:JSON.stringify(body)})});
}
test('P7-4 preflight rejects any production or absent explicit sandbox consent before issuing SQL',async()=>{
 const database={query:async()=>{throw Error('production must not be contacted');}};
 const pool={getConnection:async()=>{throw Error('production pool must not connect');}};
 for(const options of [
  undefined,
  {database:'fabric_db',confirmation:'I_ACKNOWLEDGE_SANDBOX'},
  {database:'fabric_v2_test_20261014_p7',confirmation:'wrong'},
  {database:'fabric_v2_test_20261014_p7;DROP',confirmation:'I_ACKNOWLEDGE_SANDBOX'}
 ]){
  await assert.rejects(
   async()=>createV2CatalogAssembly(database as never,pool as never,options as never),
   /sandbox|isolated|confirmation|target/i
  );
 }
});
test('P7-4 preflight refuses different auth/transaction MySQL schema or server, always releases connection',async()=>{
 const opts={database:'fabric_v2_test_20261014_p7',confirmation:'I_ACKNOWLEDGE_SANDBOX'} as const;
 const target='fabric_v2_test_20261014_p7';
 for(const [authDb,txDb,authServer,txServer] of [
  [target,'fabric_db','serverA','serverA'],
  ['fabric_db',target,'serverA','serverA'],
  [target,target,'serverA','serverB'],
  [target,target,'','serverA'],
  [target,target,'serverA',null],
 ]){
  const statements:string[]=[];let released=0;
  const db={query:async(sql:string)=>{statements.push('auth '+sql);return [[{database_name:authDb,server_uuid:authServer}],[]] as [unknown,unknown];}};
  const pool={getConnection:async()=>({
   query:async(sql:string)=>{statements.push('tx '+sql);return [[{database_name:txDb,server_uuid:txServer}],[]] as [unknown,unknown];},
   release:()=>{released++;}
  })};
  await assert.rejects(
   async()=>createV2CatalogAssembly(db as never,pool as never,opts),
   /target|database|instance|identity|unavailable|mismatch/i
  );
  assert.equal(released,authDb===target&&Boolean(authServer)?1:0,'opened connections always released; bad auth target never reaches pool');
  assert(statements.every(sql=>sql.includes('SELECT DATABASE()')&&sql.includes('@@server_uuid')),'metadata SELECT only, never DDL/DML');
 }
});
test('P7-4 preflight refuses missing or failed identity results without leaking SQL failures',async()=>{
 const opts={database:'fabric_v2_test_20261014_p7',confirmation:'I_ACKNOWLEDGE_SANDBOX'} as const;
 for(const authRows of [[],[{}],null]){
  let connections=0;
  const db={query:async()=>[authRows,[]]};
  const pool={getConnection:async()=>{connections++;throw Error('must not connect');}};
  await assert.rejects(async()=>createV2CatalogAssembly(db as never,pool as never,opts),/identity|unavailable|database/i);
  assert.equal(connections,0,'do not open transaction pool when auth identity invalid');
 }
 const db={query:async()=>{throw Error('PRIVATE_CONNECTION_PASSWORD');}};
 await assert.rejects(async()=>createV2CatalogAssembly(db as never,{getConnection:async()=>{throw Error('unused');}} as never,opts),
  error=>{assert(error instanceof Error);assert(!error.message.includes('PRIVATE_CONNECTION_PASSWORD'));return true;});
});
test('P7-4a preflight hides malicious transaction connector diagnostics and releases connection',async()=>{
 const target='fabric_v2_test_20261014_p7',opts={database:target,confirmation:'I_ACKNOWLEDGE_SANDBOX'} as const;
 const db={query:async()=>[[{database_name:target,server_uuid:'server-A'}],[]]};
 let released=0;
 const pool={getConnection:async()=>({query:async()=>{throw Error('V2 database identity unavailable: PRIVATE_TX_DATABASE_CREDENTIAL');},release:()=>{released++;}})};
 await assert.rejects(
  async()=>createV2CatalogAssembly(db as never,pool as never,opts),
  error=>{assert(error instanceof Error);assert(!error.message.includes('PRIVATE_TX_DATABASE_CREDENTIAL'));return true;}
 );
 assert.equal(released,1);
});
test('P7-4a preflight never exposes untrusted pool acquisition error containing V2 diagnostic prefix',async()=>{
 const target='fabric_v2_test_20261014_p7';
 const db={query:async()=>[[{database_name:target,server_uuid:'server-A'}],[]]};
 const pool={getConnection:async()=>{throw Error('V2 database identity unavailable PRIVATE_POOL_SECRET');}};
 await assert.rejects(
  async()=>createV2CatalogAssembly(db as never,pool as never,{database:target,confirmation:'I_ACKNOWLEDGE_SANDBOX'}),
  error=>{assert(error instanceof Error);assert(!error.message.includes('PRIVATE_POOL_SECRET'));return true;}
 );
});
test('P7-4 preflight allows exactly matched sandbox MySQL instance+database before exposing API router',async()=>{
 const target='fabric_v2_test_20261014_p7';let released=0;
 const queries:string[]=[];
 const db={query:async(sql:string)=>{queries.push('access:'+sql);return [[{database_name:target,server_uuid:'test-uuid'}],[]] as [unknown,unknown];}};
 const pool={getConnection:async()=>({query:async(sql:string)=>{
  queries.push('tx:'+sql);return [[{database_name:target,server_uuid:'test-uuid'}],[]] as [unknown,unknown];},
  release:()=>{released++;}
 })};
 const router=await createV2CatalogAssembly(db as never,pool as never,{database:target,confirmation:'I_ACKNOWLEDGE_SANDBOX'});
 assert.equal(typeof router,'function');
 assert.equal(released,1);
 assert.deepEqual(queries.map(x=>x.split(':')[0]),['access','tx']);
});

test('P7-4b every transaction checkout rejects a switched database or MySQL instance before BEGIN/UPDATE',async()=>{
 const cases=[
  {schema:'fabric_db',server:'test-uuid'},
  {schema:'fabric_v2_test_20261014_p7',server:'other-server'},
  {schema:'fabric_v2_test_20261014_p7',server:''}
 ];
 for(const candidate of cases){
  const db=await setup();db.sessionOwner='1';
  let checkout=0,release=0,business=0,begin=0;
  const pool={async getConnection(){
   checkout++;
   return {
    async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>{
     if(sql.startsWith('SELECT DATABASE()'))return [[{database_name:checkout<=2?'fabric_v2_test_20261014_p7':candidate.schema,server_uuid:checkout<=2?'test-uuid':candidate.server}],[]];
     if(sql.includes('JOIN v2_access_users'))return db.query(sql,params);
     business++;return db.query(sql,params);
    },
    async beginTransaction(){begin++;},
    async commit(){},async rollback(){},
    release(){release++;}
   };
  }};
  await withHttp(db,async base=>{
   const response=await request(base,'/products/7/deactivate','POST');
   assert.equal(response.status,503,'do not begin transaction on a drifted checkout');
   assert(!JSON.stringify(await response.json()).includes(candidate.schema),'safe HTTP error');
  },pool);
  assert.equal(checkout,3,'startup, authenticated read, and one business transaction checkout');
  assert.equal(release,3,'every checked connection returned to pool');
  assert.equal(begin,0,'transaction cannot begin before identity is checked');
  assert.equal(business,0,'no business reads or writes run on unexpected target');
 }
});
test('P7-4b fresh matching checkout can still deactivate product and releases transaction once',async()=>{
 const db=await setup();db.sessionOwner='1';
 let checkout=0,release=0,begin=0;
 const pool={async getConnection(){
  checkout++;
  return {
   async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>{
    if(sql.startsWith('SELECT DATABASE()'))return [[{database_name:'fabric_v2_test_20261014_p7',server_uuid:'test-uuid'}],[]];
    return db.query(sql,params);
   },
   async beginTransaction(){begin++;},
   async commit(){},async rollback(){},release(){release++;}
  };
 }};
 await withHttp(db,async base=>{
  const response=await request(base,'/products/7/deactivate','POST');
  assert.equal(response.status,200,'approved transaction proceeds');
  assert.deepEqual(await response.json(),{id:'7',active:false});
 },pool);
 assert.equal(checkout,3);
 assert.equal(release,3);
 assert.equal(begin,1);
 assert(db.calls.some(x=>x.sql.startsWith('UPDATE v2_products SET is_active=0')));
});
test('P7-4b metadata failure after startup returns safe 503 and releases without transactions',async()=>{
 const db=await setup();db.sessionOwner='1';
 let checkout=0,release=0,begin=0;
 const pool={async getConnection(){
  checkout++;
  return {
   async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>{
    if(sql.startsWith('SELECT DATABASE()')){
     if(checkout<=2)return [[{database_name:'fabric_v2_test_20261014_p7',server_uuid:'test-uuid'}],[]];
     throw new Error('PRIVATE_POOL_SECRET after failover');
    }
    return db.query(sql,params);
   },
   async beginTransaction(){begin++;},async commit(){},async rollback(){},release(){release++;}
  };
 }};
 await withHttp(db,async base=>{
  const response=await request(base,'/products/7/deactivate','POST');
  assert.equal(response.status,503);
  assert(!JSON.stringify(await response.json()).includes('PRIVATE_POOL_SECRET'));
 },pool);
 assert.equal(checkout,3);assert.equal(release,3);assert.equal(begin,0);
});

test('P7-4c runtime auth and read queries use guarded pool, not a stale startup access adapter',async()=>{
 const db=await setup();
 const expected='fabric_v2_test_20261014_p7';
 let staleQueries=0;
 const startupOnlyAccess={async query(sql:string):Promise<[unknown,unknown]>{
  if(sql==='SELECT DATABASE() AS database_name, @@server_uuid AS server_uuid')
   return [[{database_name:expected,server_uuid:'test-uuid'}],[]];
  staleQueries++;
  throw Error('PRIVATE_STALE_AUTH_CONNECTION: NEVER RUN USER QUERIES');
 }};
 await withHttp(db,async base=>{
  const me=await request(base,'/access/me');
  assert.equal(me.status,200,'session auth must use the verified connection pool');
  const actor=await me.json() as {username:string};
  assert.equal(actor.username,'sales');
  const listing=await request(base,'/fabrics/catalog');
  assert.equal(listing.status,200,'business reads must use the guarded pool');
 },db,startupOnlyAccess);
 assert.equal(staleQueries,0,'no runtime calls touch the separate bootstrap adapter');
});
test('P7-4c a later switched connection refuses session lookup before querying wrong tenant',async()=>{
 const db=await setup();
 let checkout=0,release=0,business=0;
 const pool={async getConnection(){
  checkout++;
  return {
   async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>{
    if(sql.startsWith('SELECT DATABASE()'))
     return [[{database_name:checkout===1?'fabric_v2_test_20261014_p7':'fabric_db',server_uuid:'test-uuid'}],[]];
    business++;
    return db.query(sql,params);
   },
   async beginTransaction(){},async commit(){},async rollback(){},release(){release++;}
  };
 }};
 await withHttp(db,async base=>{
  const response=await request(base,'/access/me');
  assert.equal(response.status,503);
  assert(!JSON.stringify(await response.json()).includes('fabric_db'));
 },pool);
 assert.equal(checkout,2);
 assert.equal(release,2);
 assert.equal(business,0,'no user/session SQL on a switched database');
});
test('P2/P3/P4/P5 assembled HTTP: anonymous or forged bearers denied across V2 catalog before any SELECT',async()=>{
 const db=await setup();
 await withHttp(db,async base=>{
  for(const path of paths){
   assert.equal((await request(base,path,'GET',undefined,null)).status,401,path);
   assert.equal((await request(base,path,'GET',undefined,'b'.repeat(64))).status,401,path);
  }
  assert(db.calls.filter(x=>!x.sql.startsWith('SELECT DATABASE()')).every(x=>x.sql.includes('JOIN v2_access_users')));
  assert(db.calls.filter(x=>x.sql.startsWith('SELECT DATABASE()')).length>=2,'startup probes both connection sources');
 });
});
test('P2/P3/P4/P5 assembled HTTP: both active roles reach catalog routes while validation and ownership apply',async()=>{
 const db=await setup();
 await withHttp(db,async base=>{
  for(const path of ['/pattern-masters','/tags?dimension=topic','/fabrics/catalog']){
   const response=await request(base,path);
   assert.equal(response.status,200,path);
   assert.equal(response.headers.get('cache-control'),'no-store');
  }  // Unknown master identity is a normal domain 404, not a missing mounted route.
  const absent=await request(base,'/pattern-masters/1/colorways');
  assert.equal(absent.status,404);
  assert.equal(absent.headers.get('cache-control'),'no-store');

  for(const [path,method,body] of [
   ['/pattern-masters','POST',{masterNo:'ZZ'}],
   ['/pattern-masters/1/colorways','POST',{remark:'x'}],
   ['/pattern-colorways/1','PATCH',{remark:'x'}],
   ['/tags','POST',{dimension:'topic',name:'x'}],
   ['/fabrics','POST',{fabricNo:'X01',fabricName:'x'}],
   ['/fabrics/1','PATCH',{fabricName:'x'}],
   ['/products','POST',{fabricId:'1',patternColorwayId:'1'}],
   ['/products/1','DELETE',undefined],
   ['/fabrics/import/preview','POST',{fileBase64:'UEsDBA==',options:{filename:'a.xlsx'}}],
   ['/fabrics/import/commit','POST',{token:'a'.repeat(64),confirm:true,updateRows:[]}]
  ] as const){
   const response=await request(base,path,method,body);
   assert.notEqual(response.status,403,method+' '+path+' must not be forbidden solely by deprecated grant');
   assert.notEqual(response.status,401,method+' '+path+' active sales session remains valid');
  }
 });
});
test('P2/P3/P4/P5 assembled HTTP: old grant toggles do not deny sales and disabled user is revoked',async()=>{
 const db=await setup();
 await withHttp(db,async base=>{
  const uri='/fabrics';
  assert.equal((await request(base,uri,'POST',{fabricName:'test'})).status,400);
  db.members[1].canManageProducts=true;
  const granted=await request(base,uri,'POST',{fabricName:'test',role:'admin'});
  assert.equal(granted.status,400,'granted passes permission middleware and rejects illegal fields');
  db.members[1].canManageProducts=false;
  assert.equal((await request(base,uri,'POST',{fabricName:'test',canManageProducts:true})).status,400);
  db.members[1].active=false;
  assert.equal((await request(base,'/fabrics/catalog')).status,401);
 });
});
test('P2/P3/P4/P5 assembled HTTP: admin permissions reach service, invalid XLSX and row confirmation reject, DB errors safe',async()=>{
 const db=await setup();db.sessionOwner='1';
 await withHttp(db,async base=>{
  assert.equal((await request(base,'/access/me')).status,200);
  const bad=await request(base,'/fabrics/import/preview','POST',{fileBase64:'not-a-file',options:{filename:'bad.xlsx'}});
  assert.equal(bad.status,400);
  const submit=await request(base,'/fabrics/import/commit','POST',{token:'a'.repeat(64),confirm:false,updateRows:[]});
  assert.equal(submit.status,400);
  assert.equal((await request(base,'/fabrics/catalog?limit=0')).status,400);
  const validJson=await request(base,'/pattern-masters','POST',{bogus:true});
  assert.notEqual(validJson.status,403);
  db.failed=true;
  for(const route of ['/fabrics','/fabrics/catalog','/pattern-masters','/tags?dimension=color','/products']){
   const response=await request(base,route);
   assert.equal(response.status,503,route);
   assert(!JSON.stringify(await response.json()).includes('private mysql password'));
  }
 });
});
test('P2/P3/P4/P5 assembled HTTP: password login issues bearer, me role and logout revokes',async()=>{
 const db=await setup();
 await withHttp(db,async base=>{
  const wrong=await request(base,'/access/login','POST',{username:'sales',password:'invalid-example'},null);
  assert.equal(wrong.status,401);
  const answer=await request(base,'/access/login','POST',{
   username:'sales',password:'catalog-sales-example'
  },null);
  assert.equal(answer.status,200);
  const issued=await answer.json() as {token:string;expiresIn:number};
  assert.match(issued.token,/^[a-f0-9]{64}$/);
  assert.equal(issued.expiresIn,12*3600);
  assert(!JSON.stringify(db.calls).includes(issued.token),'raw bearer must not appear in DB audit');
  const me=await request(base,'/access/me','GET',undefined,issued.token);
  assert.equal(me.status,200);
  const actor=await me.json() as {role:string;username:string};
  assert.equal(actor.role,'sales');assert.equal(actor.username,'sales');
  assert.equal('canManageProducts' in actor,false);
  assert.equal((await request(base,'/fabrics','POST',{fabricNo:'X1'},issued.token)).status,400);
  assert.equal((await request(base,'/access/logout','POST',undefined,issued.token)).status,200);
  assert.equal((await request(base,'/access/me','GET',undefined,issued.token)).status,401);
 });
});
test('P5 assembled HTTP: real ExcelJS XLSX bytes preview with bearer and fresh permissions',async()=>{
 const db=await setup();
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('面料资料');
 sheet.addRow(['品号','品名','成分','克重','克重单位','门幅(cm)','备注']);
 sheet.addRow(['F029','回环测试',null,22,'mm',143,null]);
 sheet.addRow(['F030','缺少克重单位',null,77,null,140,null]);
 const bytes=Buffer.from(await book.xlsx.writeBuffer());
 const body={fileBase64:bytes.toString('base64'),options:{filename:'demo.xlsx'}};
 await withHttp(db,async base=>{
  assert.equal((await request(base,'/fabrics/import/preview','POST',body,null)).status,401);
  assert.equal(db.members[1].canManageProducts,false);
  const result=await request(base,'/fabrics/import/preview','POST',body);
  assert.equal(result.status,200);
  const preview=await result.json() as {
   token:string;rows:{rowNumber:number;action:string;fabric?:{fabricNo:string}}[];
   counts:{create:number;error:number};
  };
  assert.match(preview.token,/^[a-f0-9]{64}$/);
  assert.deepEqual(preview.rows.map(row=>row.action),['create','error']);
  assert.equal(preview.rows[0].fabric?.fabricNo,'F029');
  assert.deepEqual([preview.counts.create,preview.counts.error],[1,1]);
  assert(db.calls.some(x=>x.sql.includes('FROM v2_fabrics')));
  db.members[1].active=false;
  const blocked=await request(base,'/fabrics/import/commit','POST',{
   token:preview.token,confirm:true,updateRows:[]
  });
  assert.equal(blocked.status,401,'deactivated user cannot commit stale preview');
 });
});
test('P7-1 isolated unified HTTP mounts referenced-product deactivation safely',async()=>{
 const db=await setup();
 await withHttp(db,async base=>{
  assert.equal((await request(base,'/products/7/deactivate','POST',undefined,null)).status,401);
  db.members[1].active=false;
  assert.equal((await request(base,'/products/7/deactivate','POST')).status,401);
  db.members[1].active=true;db.sessionOwner='1';
  assert.equal((await request(base,'/products/0/deactivate','POST')).status,400);
  const response=await request(base,'/products/7/deactivate','POST');
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{id:'7',active:false});
  assert(db.calls.some(x=>x.sql.startsWith('UPDATE v2_products SET is_active=0')));
  assert(!db.calls.some(x=>x.sql.startsWith('DELETE FROM order_items')));
  assert(!db.calls.some(x=>x.sql.startsWith('DELETE FROM v2_products')));
 });
});
test('P7-2 unified DELETE HTTP refuses ordered product before modifying image or order references',async()=>{
 const db=await setup();
 await withHttp(db,async base=>{
  assert.equal((await request(base,'/products/7','DELETE',undefined,null)).status,401);
  assert.equal((await request(base,'/products/7','DELETE')).status,409,'sales role still honors saved-order reference');
  db.sessionOwner='1';
  assert.equal((await request(base,'/products/0','DELETE')).status,400);
  const ordered=await request(base,'/products/7','DELETE');
  assert.equal(ordered.status,409);
  assert.equal((await ordered.json() as {error:string}).error.includes('Ordered product'),true);
  assert(db.calls.some(x=>x.sql.includes('FROM order_items WHERE v2_product_id')));
  assert(!db.calls.some(x=>x.sql.startsWith('DELETE FROM v2_products')));
  assert(!db.calls.some(x=>x.sql.startsWith('UPDATE image_assets')));
 });
});
test('P7-3 combined V2 HTTP isolates document selector by own-order grant, not product-management grant',async()=>{
 const db=await setup();
 await withHttp(db,async base=>{
  const url='/document-products/selector?limit=1';
  assert.equal((await request(base,url,'GET',undefined,null)).status,401);
  assert.equal((await request(base,url,'GET',undefined,'b'.repeat(64))).status,401);
  assert.equal((await request(base,url)).status,200,'registered sales can select despite old own-orders flag');
  db.members[1].canManageProducts=true;
  assert.equal((await request(base,url)).status,200,'deprecated product-grant flag is irrelevant');
  db.members[1].canManageOwnOrders=true;
  const allowed=await request(base,url);
  assert.equal(allowed.status,200,'sales granted own-order permission sees picker');
  assert.deepEqual(await allowed.json(),{items:[],total:0,limit:1,offset:0});
  assert.equal((await request(base,'/document-products/selector?limit=0')).status,400);
  db.members[1].canManageOwnOrders=false;
  assert.equal((await request(base,url)).status,200,'deprecated own-order grant revocation no longer limits valid role');
 });
});
test('P7-3 combined V2 HTTP mounts owner-scoped document list, safe statistics and write gate',async()=>{
 const db=await setup();
 await withHttp(db,async base=>{
  assert.equal((await request(base,'/documents','GET',undefined,null)).status,401);
  assert.equal((await request(base,'/documents/stats','GET',undefined,null)).status,401);
  assert.equal((await request(base,'/documents','GET',undefined,'b'.repeat(64))).status,401);
  const salesList=await request(base,'/documents');
  assert.equal(salesList.status,200);
  assert.deepEqual(await salesList.json(),{total:0,limit:20,offset:0,items:[]});
  const salesScope=db.calls.find(x=>x.sql.includes('FROM orders o')&&x.sql.includes('COUNT(*)'));
  assert(salesScope?.sql.includes('o.created_by_user_id = ?'));
  assert.deepEqual(salesScope?.params,['2']);
  const beforeStats=db.calls.length;
  const salesStats=await request(base,'/documents/stats?from=2026-10-01&to=2026-10-16');
  assert.equal(salesStats.status,200);
  const statsQueries=db.calls.slice(beforeStats).filter(x=>x.sql.includes('FROM orders o'));
  assert.equal(statsQueries.length,3);
  for(const call of statsQueries){
   assert(call.sql.includes('o.created_by_user_id = ?'));
   assert.deepEqual(call.params,['2','2026-10-01','2026-10-16']);
  }
  assert.equal((await request(base,'/documents?limit=0')).status,400);
  assert.equal((await request(base,'/documents','POST',{})).status,400,'sales reaches real document validator');
  db.members[1].canManageOwnOrders=true;
  assert.equal((await request(base,'/documents','POST',{})).status,400,'granted write reaches payload validator');
  db.members[1].canManageOwnOrders=false;
  assert.equal((await request(base,'/documents','POST',{})).status,400,'legacy capability toggle does not change active role');
  db.sessionOwner='1';
  const adminList=await request(base,'/documents');
  assert.equal(adminList.status,200);
  assert.deepEqual(await adminList.json(),{total:0,limit:20,offset:0,items:[]});
  assert(db.calls.some(x=>x.sql.includes('FROM orders o WHERE 1=1')));
  assert.equal((await request(base,'/documents/stats?invalid=1')).status,400);
  const stats=await request(base,'/documents/stats');
  assert.equal(stats.status,200);
  assert.deepEqual(await stats.json(),{orderCount:0,amountTotal:0,metersTotal:0,byType:{
   sample:{count:0,meters:0,amount:0},bulk:{count:0,meters:0,amount:0},
   deposit:{count:0,meters:0,contractAmount:0}
  },topProducts:[],recentOrders:[]});
 });
});
test('P2/P3/P4/P5 assembled HTTP: legacy routes do NOT exist, malformed JSON cannot return HTML trace',async()=>{
 const db=await setup();db.sessionOwner='1';
 await withHttp(db,async base=>{
  const actualOrigin=base.replace(/\/api\/v2$/,'');
  for(const route of ['/api/products','/api/login','/api/export_template/1']){
   const response=await fetch(actualOrigin+route);
   assert.equal(response.status,404);
  }
  for(const route of ['/access/login','/fabrics','/pattern-masters','/products']){
   const response=await fetch(base+route,{method:'POST',headers:{
    authorization:'Bearer '+sessionToken,'content-type':'application/json'
   },body:'{"open":'});
   assert.equal(response.status,400,route);
   assert.match(response.headers.get('content-type')??'',/^application\/json/);
   const body=await response.json() as {error?:string};
   assert.equal(typeof body.error,'string');assert(!JSON.stringify(body).includes('<pre>'));
  }
 });
});
