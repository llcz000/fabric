import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import {strToU8,zipSync} from 'fflate';
import express from 'express';
import type {Server} from 'node:http';
import {hashSessionToken} from '../access/password';
import {createFabricExcelImportRouter} from './fabricExcelImportRoutes';
import type {AppPrincipal} from '../access/types';
import {FabricImportError,createFabricImportService} from './fabricExcelImport';
const admin:AppPrincipal={userId:'1',sessionId:'11',username:'admin',displayName:'Admin',role:'admin',canManageOwnOrders:true,canManageProducts:true};
const sales:AppPrincipal={...admin,userId:'2',sessionId:'22',username:'sales',role:'sales'};
type Row={id:string;fabric_no:string;fabric_name:string;composition:string|null;weight_value:string|null;weight_unit:string|null;width_value:string|null;remark:string|null;is_active:number};
const row=(no:string,name:string,id='8'):Row=>({id,fabric_no:no,fabric_name:name,composition:'棉',weight_value:'98.000',weight_unit:'gsm',width_value:'150.00',remark:'原注',is_active:1});
class DB{
 items:Row[]=[];seq=10;active=true;role:'admin'|'sales'='admin';canManage=true;
 sessions=true;failInsert=false;commits=0;rollbacks=0;reprintMarks=0;
 async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>{
  if(sql.includes('JOIN v2_access_users')){
   if(params[0]!==hashSessionToken('a'.repeat(64))||!this.active||!this.sessions)return [[],[]];
   return [[{user_id:'1',username:'admin',display_name:'Admin',role:this.role,
    can_manage_products:this.canManage?1:0,can_manage_own_orders:1,session_id:'11'}],[]];
  }
  if(sql.includes('FROM v2_access_users'))return [this.active?[{id:String(params[0]),role:this.role,is_active:1,can_manage_products:this.canManage?1:0}]:[],[]];
  if(sql.includes('FROM v2_access_sessions'))return [this.sessions?[{id:String(params[0])}]:[],[]];
  if(sql.includes('FROM v2_fabrics')&&sql.includes(' IN (')){
   const codes=new Set(params.map(String));return [this.items.filter(x=>codes.has(x.fabric_no)),[]];
  }
  if(sql.includes('FROM v2_fabrics')&&sql.includes('fabric_no=?'))return [this.items.filter(x=>x.fabric_no===String(params[0])),[]];
  if(sql.startsWith('INSERT INTO v2_fabrics')){
   if(this.failInsert)throw Error('secret connection error');
   if(this.items.some(x=>x.fabric_no===params[0]))throw Object.assign(Error('secret duplicate'),{code:'ER_DUP_ENTRY'});
   const id=String(this.seq++);
   this.items.push({id,fabric_no:String(params[0]),fabric_name:String(params[1]),composition:params[2] as string|null,
    weight_value:params[3]===null?null:String(params[3]),weight_unit:params[4] as string|null,
    width_value:params[5]===null?null:String(params[5]),remark:params[6] as string|null,is_active:1});
   return [{affectedRows:1,insertId:id},[]];
  }
  if(sql.startsWith('UPDATE sample_cards SET reprint_revision=')){
   this.reprintMarks++;return [{affectedRows:2},[]];
  }
  if(sql.startsWith('UPDATE v2_fabrics')){
   const x=this.items.find(y=>y.id===String(params.at(-1)))!;
   [x.fabric_name,x.composition,x.weight_value,x.weight_unit,x.width_value,x.remark]=[
    String(params[0]),params[1] as string|null,params[2]===null?null:String(params[2]),
    params[3] as string|null,params[4]===null?null:String(params[4]),params[5] as string|null];
   return [{affectedRows:1},[]];
  }
  throw Error('Unsupported SQL '+sql);
 }
 async getConnection(){
  const snapshot=structuredClone(this.items);
  return {query:this.query.bind(this),beginTransaction:async()=>{},
   commit:async()=>{this.commits++;},rollback:async()=>{this.items=snapshot;this.rollbacks++;},release:()=>{}};
 }
}
async function book(data:(string|number|null)[][]){
 const b=new ExcelJS.Workbook(),w=b.addWorksheet('面料资料');
 w.addRow(['品号','品名','成分','克重','克重单位','门幅(cm)','备注']);
 for(const r of data)w.addRow(r);
 return Buffer.from(await b.xlsx.writeBuffer());
}
const errorStatus=(status:number)=>(e:unknown)=>e instanceof FabricImportError&&e.status===status;
test('P5 sales can create, existing rows skipped, token consumed after commit',async()=>{
 const db=new DB();db.role='sales';db.items=[row('F018','旧面料')];
 const svc=createFabricImportService(db as never,db as never);
 const p=await svc.preview(sales,await book([['F018','新版',null,null,null,null,null],['F019','新建',null,null,null,null,null]]),{filename:'ok.xlsx'});
 assert.deepEqual(p.rows.map(x=>x.action),['skip','create']);
 // Under current policy a salesperson may explicitly confirm duplicate updates.
 assert.doesNotMatch(p.rows[0].reason,/只有管理员/);
 const done=await svc.commit(sales,{token:p.token,confirm:true,updateRows:[]});
 assert.deepEqual(done.counts,{created:1,updated:0,skipped:1,failed:0});
 assert.equal(db.items[0].fabric_name,'旧面料');
 await assert.rejects(svc.commit(sales,{token:p.token,confirm:true,updateRows:[]}),errorStatus(409));
});
test('P5 sales may explicitly confirm a repeated fabric update under simplified roles',async()=>{
 const db=new DB();db.role='sales';db.canManage=false;db.items=[row('F018','旧面料')];
 const actor={...sales,canManageProducts:false,canManageOwnOrders:false};
 const svc=createFabricImportService(db as never,db as never);
 const p=await svc.preview(actor,await book([['F018','覆盖',null,null,null,null,null]]),{filename:'x.xlsx'});
 const approved=await svc.commit(actor,{token:p.token,confirm:true,updateRows:[2]});
 assert.equal(approved.counts.updated,1);
 assert.equal(db.items[0].fabric_name,'覆盖');
 assert.equal(db.reprintMarks,1);
});
test('P5 admin explicitly updates, empty Excel name/weight/remark keep original',async()=>{
 const db=new DB();db.items=[row('F018','原名称')];const svc=createFabricImportService(db as never,db as never);
 const p=await svc.preview(admin,await book([['F018',null,'丝棉',null,null,null,null]]),{filename:'x.xlsx'});
 assert.equal(p.rows[0].action,'skip');assert.equal(p.rows[0].fabric?.fabricName,'原名称');
 const done=await svc.commit(admin,{token:p.token,confirm:true,updateRows:[2]});
 assert.equal(done.counts.updated,1);
 assert.equal(db.items[0].fabric_name,'原名称');assert.equal(db.items[0].composition,'丝棉');
 assert.equal(db.items[0].id,'8');assert.equal(db.items[0].is_active,1);
 assert.equal(db.reprintMarks,1,'admin XLSX overwrite must mark every linked physical card in the same row transaction');
});
test('P5 concurrent changed original is never overwritten',async()=>{
 const db=new DB();db.items=[row('F018','旧面料')];const svc=createFabricImportService(db as never,db as never);
 const p=await svc.preview(admin,await book([['F018','更新',null,null,null,null,null]]),{filename:'x.xlsx'});
 db.items[0].fabric_name='其他人刚修改';
 const done=await svc.commit(admin,{token:p.token,confirm:true,updateRows:[2]});
 assert.equal(done.counts.failed,1);assert.equal(db.items[0].fabric_name,'其他人刚修改');
 assert(done.rows[0].reason.includes('重新预览'));
});
test('P5 newly conflicting fabric from another user is skipped',async()=>{
 const db=new DB(),svc=createFabricImportService(db as never,db as never);
 const p=await svc.preview(admin,await book([['F099','新',null,null,null,null,null]]),{filename:'x.xlsx'});
 db.items.push(row('F099','别人刚新增'));
 const done=await svc.commit(admin,{token:p.token,confirm:true,updateRows:[]});
 assert.equal(done.counts.skipped,1);assert.equal(db.items[0].fabric_name,'别人刚新增');
});
test('P5 duplicate group, malformed row do not prevent valid create',async()=>{
 const db=new DB(),svc=createFabricImportService(db as never,db as never);
 const p=await svc.preview(admin,await book([['F01','甲',null,null,null,null,null],
  [' f01 ','乙',null,null,null,null,null],['F02','好',null,null,null,null,null],
  ['F03','错误',null,90,null,null,null]]),{filename:'x.xlsx'});
 assert.deepEqual(p.rows.map(x=>x.action),['skip','skip','create','error']);
 const done=await svc.commit(admin,{token:p.token,confirm:true,updateRows:[]});
 assert.deepEqual(done.counts,{created:1,updated:0,skipped:2,failed:1});
 assert.equal(db.items.length,1);assert.equal(db.items[0].fabric_no,'F02');
});
test('P5 re-preview invalidates old token, owner mismatch rejected, no confirm rejects',async()=>{
 const db=new DB(),svc=createFabricImportService(db as never,db as never);
 const data=await book([['F101','布',null,null,null,null,null]]);
 const a=await svc.preview(admin,data,{filename:'x.xlsx'}),b=await svc.preview(admin,data,{filename:'x.xlsx'});
 await assert.rejects(svc.commit(admin,{token:a.token,confirm:true,updateRows:[]}),errorStatus(409));
 await assert.rejects(svc.commit({...admin,sessionId:'99'},{token:b.token,confirm:true,updateRows:[]}),errorStatus(409));
 await assert.rejects(svc.commit(admin,{token:b.token,confirm:false,updateRows:[]}),errorStatus(400));
 assert.equal(db.items.length,0);
});
test('P5 role and session rechecked on commit, downgrade blocks overwrite',async()=>{
 const db=new DB();db.items=[row('F018','旧')];const svc=createFabricImportService(db as never,db as never);
 const p=await svc.preview(admin,await book([['F018','新',null,null,null,null,null]]),{filename:'x.xlsx'});
 db.role='sales';
 await assert.rejects(svc.commit(admin,{token:p.token,confirm:true,updateRows:[2]}),errorStatus(401));
 assert.equal(db.items[0].fabric_name,'旧');
});
test('P5 malformed update rows and unexpected properties are rejected before writes',async()=>{
 const db=new DB(),svc=createFabricImportService(db as never,db as never);
 const p=await svc.preview(admin,await book([['F100','布',null,null,null,null,null]]),{filename:'x.xlsx'});
 for(const req of [
  {token:p.token,confirm:true,updateRows:[1]},
  {token:p.token,confirm:true,updateRows:[2]},
  {token:p.token,confirm:true,updateRows:[2,2]},
  {token:p.token,confirm:true,updateRows:[],fabricNo:'F666'},
  {token:p.token,confirm:'yes',updateRows:[]}
 ])await assert.rejects(svc.commit(admin,req as never),errorStatus(400));
 assert.equal(db.items.length,0);
});
test('P5 V2 HTTP preview & commit require Bearer/valid MIME and do not write before confirm',async()=>{
 const db=new DB(),app=express();
 app.use('/api/v2',createFabricExcelImportRouter(db as never,db as never));
 const server:Server=await new Promise((resolve,reject)=>{
  const live=app.listen(0,'127.0.0.1',()=>resolve(live));live.once('error',reject);
 });
 try{
  const addr=server.address();assert(addr&&typeof addr!=='string');
  const base='http://127.0.0.1:'+addr.port+'/api/v2/fabrics/import/';
  const body=JSON.stringify({fileBase64:(await book([['F551','新',null,null,null,null,null]])).toString('base64'),
   options:{filename:'demo.xlsx'}});
  const unauthorized=await fetch(base+'preview',{method:'POST',headers:{'Content-Type':'application/json'},body});
  assert.equal(unauthorized.status,401);
  const h={authorization:'Bearer '+'a'.repeat(64),'Content-Type':'application/json'};
  const wrongMime=await fetch(base+'preview',{method:'POST',headers:{authorization:h.authorization,'Content-Type':'text/plain'},body});
  assert.equal(wrongMime.status,400);
  // Real HTTP must reject an unsafe XLSX before creating a preview token
  // or touching business writes; the following valid preview still succeeds.
  const hostile=Buffer.from(zipSync({
   '[Content_Types].xml':strToU8('<Types/>'),
   'xl/workbook.xml':strToU8('<workbook/>'),
   'xl/worksheets/sheet1.xml':strToU8('<worksheet/>'),
   'xl/vbaProject.bin':strToU8('forbidden payload')
  }));
  const invalid=await fetch(base+'preview',{method:'POST',headers:h,
   body:JSON.stringify({fileBase64:hostile.toString('base64'),options:{filename:'evil.xlsx'}})});
  assert.equal(invalid.status,400);
  assert.match(String((await invalid.json() as {error:string}).error),/XLSX/);
  assert.equal(db.items.length,0);
  // A ZIP with a tiny *forged* directory size and a 4MiB actual DEFLATE
  // payload previously passed the static header-only gate. HTTP must refuse
  // actual decompression mismatch before issuing any preview credential.
  const forged=Buffer.from(zipSync({
   '[Content_Types].xml':strToU8('<Types/>'),
   'xl/workbook.xml':strToU8('<workbook/>'),
   'xl/worksheets/sheet1.xml':new Uint8Array(4*1024*1024)
  }));
  let at=forged.indexOf(Buffer.from('504b0102','hex')),found=false;
  while(at>=0&&at+46<forged.length&&forged.readUInt32LE(at)===0x02014b50){
   const length=forged.readUInt16LE(at+28);
   const name=forged.subarray(at+46,at+46+length).toString('utf8');
   const next=at+46+length+forged.readUInt16LE(at+30)+forged.readUInt16LE(at+32);
   if(name==='xl/worksheets/sheet1.xml'){
    const local=forged.readUInt32LE(at+42);
    forged.writeUInt32LE(1,at+24);
    if((forged.readUInt16LE(local+6)&8)===0)forged.writeUInt32LE(1,local+22);
    found=true;break;
   }
   at=next;
  }
  assert(found);
  const rejected=await fetch(base+'preview',{method:'POST',headers:h,
   body:JSON.stringify({fileBase64:forged.toString('base64'),options:{filename:'forged.xlsx'}})});
  assert.equal(rejected.status,400);
  assert.match(String((await rejected.json() as {error:string}).error),/XLSX/);
  assert.equal(db.items.length,0);
  const ok=await fetch(base+'preview',{method:'POST',headers:h,body});
  assert.equal(ok.status,200);
  const preview=await ok.json() as {token:string;counts:{create:number}};
  assert.equal(preview.counts.create,1);assert.equal(db.items.length,0);
  const confirmed=await fetch(base+'commit',{method:'POST',headers:h,
   body:JSON.stringify({token:preview.token,confirm:true,updateRows:[]})});
  assert.equal(confirmed.status,200);
  assert.equal(db.items.length,1);assert.equal(db.items[0].fabric_no,'F551');
  const replay=await fetch(base+'commit',{method:'POST',headers:h,
   body:JSON.stringify({token:preview.token,confirm:true,updateRows:[]})});
  assert.equal(replay.status,409);
 }finally{
  await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
 }
});
test('P5 failed insert rolls back current row and hides DB secret',async()=>{
 const db=new DB();db.failInsert=true;const svc=createFabricImportService(db as never,db as never);
 const p=await svc.preview(admin,await book([['F400','布',null,null,null,null,null]]),{filename:'x.xlsx'});
 const r=await svc.commit(admin,{token:p.token,confirm:true,updateRows:[]});
 assert.equal(r.counts.failed,1);assert.equal(db.items.length,0);assert.equal(db.rollbacks,1);
 assert(!r.rows[0].reason.includes('secret'));
});
