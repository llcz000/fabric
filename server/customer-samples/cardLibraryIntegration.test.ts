import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import express from 'express';
import ExcelJS from 'exceljs';
import {hashSessionToken} from '../access/password';
import {createSampleCardLibraryRouter,createMySQLSampleCardLibraryDependencies} from './cardLibraryRoutes';
import {createSampleCardScanRouter} from './cardScanRoutes';
import {persistSampleCardScan} from './scanRepository';

type Row=Record<string,unknown>;
const bearer='c'.repeat(64);
/** SQL substitute, not a real MySQL execution. Shared state crosses real services and real HTTP. */
class IntegratedDb{
 role:'admin'|'sales'='sales';active=true;grant=true;
 card:Row|null=null;tokenHash='';productVersions=1;items:Row[]=[];event=0;
 async query(sql:string,args:unknown[]=[]):Promise<[unknown,unknown]>{
  if(sql.includes('JOIN v2_access_users'))return [this.active&&args[0]===hashSessionToken(bearer)?[{user_id:'6',session_id:'1',username:'user',display_name:'用户',role:this.role,can_manage_products:0,can_manage_own_orders:0}]:[],[]];
  if(sql.includes('FROM v2_access_users'))return [this.active?[{id:'6',role:this.role,is_active:1,can_manage_products:0,can_manage_own_orders:0}]:[],[]];
  if(sql.includes('FROM v2_access_sessions'))return [this.active?[{id:'1'}]:[],[]];
  if(sql==='SELECT id,is_active FROM pattern_masters WHERE id=? FOR SHARE')return [[{id:'41',is_active:1}],[]];
  if(sql==='SELECT id,is_active FROM v2_fabrics WHERE id=? FOR SHARE')return [[{id:'23',is_active:1}],[]];
  if(sql.startsWith('SELECT id,master_no'))return [[{id:'41',master_no:'0012',is_active:1}],[]];
  if(sql.startsWith('SELECT id,fabric_no'))return [[{id:'23',fabric_no:'F018',is_active:1}],[]];
  if(sql.startsWith('INSERT INTO sample_cards')){this.card={id:'12',master_id:args[0],fabric_id:args[1],card_no:args[2],qr_payload:args[3],is_active:1};return [{insertId:'12'},[]];}
  if(sql.startsWith('INSERT INTO sample_card_tokens')){this.tokenHash=String(args[1]);return [{insertId:'1'},[]];}
  if(sql.includes('FROM sample_cards c')){
   const found=this.card?[{...this.card,master_no:'0012',fabric_no:'F018',fabric_name:'丝绸',composition:'100%S',weight_value:'16',weight_unit:'mm',width_value:'140',token_hash:this.tokenHash}]:[];
   if(sql.includes('COUNT(*)'))return [[{total:found.length}],[]];
   return [found,[]];
  }
  if(sql.includes('FROM customer_sample_sessions'))return [[{id:'51',status:'open',created_by_user_id:'6'}],[]];
  if(sql.includes('FROM customer_sample_session_access'))return [this.grant?[{can_manage:1}]:[],[]];
  if(sql.includes('FROM sample_card_tokens t')){
   const lockingByCard=sql.includes('t.card_id=?');
   const matched=this.card&&(lockingByCard?args[0]==='12':this.tokenHash===args[0]);
   return [matched?[{card_id:'12',master_id:'41',fabric_id:'23',is_active:1,token_hash:this.tokenHash,revoked_at:null}]:[],[]];
  }
  if(sql.includes('FROM v2_products p')){
   assert.deepEqual(args,['23','41']);
   return [Array.from({length:this.productVersions},(_,i)=>({id:String(i+81),fabric_id:'23',master_id:'41',product_no:'0012-'+(i+1)+'-F018',colorway_no:i+1,master_no:'0012',fabric_name:'丝绸',composition:'100%S',weight_value:16,weight_unit:'mm',width_value:140,product_active:1,sampling_available:1,colorway_active:1,master_active:1,fabric_active:1})),[]];
  }
  if(sql.includes('SELECT product_id,removed_at FROM customer_sample_items'))return [this.items.map(item=>({...item,removed_at:null})),[]];
  if(sql.startsWith('INSERT INTO customer_sample_scan_events'))return [{insertId:String(++this.event)},[]];
  if(sql.startsWith('INSERT INTO customer_sample_items')){this.items.push({product_id:args[1]});return [{insertId:this.items.length},[]];}
  if(sql.startsWith('INSERT INTO customer_sample_'))return [{insertId:'1'},[]];
  if(sql.includes('COUNT(*) AS total FROM customer_sample_selected_cards'))return [[{total:1}],[]];
  throw Error('Unexpected integrated SQL');
 }
 async getConnection(){
  const db=this;let oldCard:Row|null=null,oldToken='',oldItems:Row[]=[];
  return {query:db.query.bind(db),async beginTransaction(){oldCard=db.card;oldToken=db.tokenHash;oldItems=[...db.items];},async commit(){},async rollback(){db.card=oldCard;db.tokenHash=oldToken;db.items=oldItems;},release(){}};
 }
}
test('B2-3 actual create/list/Excel service and sales scan agree on one stable payload; new version appends delta',async()=>{
 const db=new IntegratedDb(),app=express();
 app.use('/api/v2/sample-cards',createSampleCardLibraryRouter(db,createMySQLSampleCardLibraryDependencies(db,db)));
 app.use('/api/v2/sample-cards',express.json(),createSampleCardScanRouter(db,{
  authorize:async()=>db.grant,scan:(input,actor)=>persistSampleCardScan(db,actor,input)
 }));
 const server=await new Promise<ReturnType<typeof app.listen>>(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 try{
  const address=server.address();assert(address&&typeof address!=='string');const base='http://127.0.0.1:'+address.port+'/api/v2/sample-cards';
  const call=(path:string,body?:unknown)=>fetch(base+path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+bearer,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const created=await call('',{masterId:'41',fabricId:'23'});assert.equal(created.status,201);const first=await created.json();
  assert.equal(first.card.cardNo,'0012-F018');assert.equal(db.tokenHash,createHash('sha256').update(first.card.qrPayload).digest('hex'));
  const repeated=await call('',{masterId:'41',fabricId:'23'});assert.equal(repeated.status,200);assert.equal((await repeated.json()).card.qrPayload,first.card.qrPayload);
  const list=await call('');assert.equal(list.status,200);assert.equal((await list.json()).items[0].qrPayload,first.card.qrPayload);
  const exported=await call('/export',{cardIds:['12']});assert.equal(exported.status,200);
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(Buffer.from(await exported.arrayBuffer()));
  assert.equal(workbook.worksheets[0].getCell('A2').value,'0012-F018');assert.equal(workbook.worksheets[0].getCell('F2').value,first.card.qrPayload);
  const scanBody={cardToken:first.card.qrPayload,sessionId:'51'};
  const scan=await call('/scan',scanBody);assert.equal(scan.status,200);assert.deepEqual((await scan.json()).addedProductIds,['81']);
  const original=db.items[0].product_id;db.productVersions=2;
  const rescan=await call('/scan',scanBody);assert.equal(rescan.status,200);const delta=await rescan.json();assert.deepEqual(delta.addedProductIds,['82']);assert.equal(delta.selectedCardCount,1);assert.equal(db.items[0].product_id,original);
  db.role='admin';assert.equal((await call('/export',{cardIds:['12']})).status,200);assert.equal((await call('/scan',scanBody)).status,403);
  db.role='sales';db.grant=false;assert.equal((await call('/scan',scanBody)).status,403);
  db.active=false;assert.equal((await call('/export',{cardIds:['12']})).status,401);
 }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});
