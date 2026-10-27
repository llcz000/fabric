import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import ExcelJS from 'exceljs';
import {createHash} from 'node:crypto';
import {createSampleSessionDirectoryRouter} from './sessionDirectoryRoutes';
const token='Stable_Real_Card_Token_123456789';
class Db{
 role='sales';grant=true;active=true;login=true;closed=false;missing=false;selected=['12'];calls:{sql:string;args:unknown[]}[]=[];commits=0;rollbacks=0;
 async getConnection(){return {beginTransaction:async()=>{},commit:async()=>{this.commits++;},rollback:async()=>{this.rollbacks++;},release(){},query:async(sql:string,args:unknown[]=[]):Promise<[unknown,unknown]>=>{
 this.calls.push({sql,args});
 if(sql.includes('FROM v2_access_users'))return [[{role:this.role,is_active:Number(this.active)}],[]];
 if(sql.includes('FROM v2_access_sessions'))return [this.login?[{id:'9'}]:[],[]];
 if(sql.includes('SELECT id FROM customer_sample_sessions'))return [[{id:'41',status:this.closed?'closed':'open'}],[]];
 if(sql.includes('FROM customer_sample_session_access'))return [this.grant?[{can_manage:1}]:[],[]];
 if(sql.includes('AS export_card_id'))return [this.selected.map(id=>({export_card_id:id})),[]];
 if(sql.includes('FROM sample_cards c'))return [this.missing?[]:args.map(id=>({id,master_id:'1',master_no:'G0012',fabric_id:'2',fabric_no:'F018',card_no:'G0012-F018',fabric_name:'绢纺',composition:'100%S',weight_value:16,weight_unit:'mm',width_value:140,qr_payload:token,token_hash:createHash('sha256').update(token).digest('hex'),is_active:1})),[]];
 throw Error('PRIVATE unexpected SQL '+sql);
 }};}
}
async function exercise(run:(base:string,db:Db)=>Promise<void>){
 const db=new Db(),app=express();app.use('/api/v2/customer-samples',createSampleSessionDirectoryRouter((req,res,next)=>{if(req.headers.authorization!=='test'){res.sendStatus(401);return;}res.locals.principal={userId:'6',sessionId:'9',role:db.role};next();},db,''));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const addr=server.address();assert(addr&&typeof addr!=='string');
 try{await run('http://127.0.0.1:'+addr.port+'/api/v2/customer-samples/sessions/41/cards/export.xlsx',db);}finally{await new Promise<void>(r=>server.close(()=>r()));}
}
test('session Excel uses exact six card-library columns, units and QR text for both roles including closed selections',async()=>exercise(async(base,db)=>{
 for(const role of ['sales','admin']){db.role=role;db.closed=role==='admin';const r=await fetch(base,{headers:{authorization:'test'}});assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');
 const wb=new ExcelJS.Workbook();await wb.xlsx.load(Buffer.from(await r.arrayBuffer()));assert.deepEqual(wb.worksheets[0].getRow(1).values,[,'色卡编号','品名','成分','克重','门幅','二维码']);assert.deepEqual(wb.worksheets[0].getRow(2).values,[,'G0012-F018','绢纺','100%S','16 mm','140 cm',token]);assert.equal(wb.worksheets[0].rowCount,2);
 }assert.equal(db.commits,2);
 const q=db.calls.find(x=>x.sql.includes('AS export_card_id'))!;assert(q.sql.includes('removed_at IS NULL'));assert(q.sql.includes('customer_sample_item_sources'));assert(q.sql.includes('customer_sample_manual_events'));assert(q.sql.includes('EXISTS'));assert(q.args.every(x=>x==='41'));assert(!q.sql.includes('LIMIT'));
}));
test('session export rejects unauthenticated and revoked grants before reading private card payloads',async()=>exercise(async(base,db)=>{
 assert.equal((await fetch(base)).status,401);assert.equal(db.calls.length,0);
 db.grant=false;assert.equal((await fetch(base,{headers:{authorization:'test'}})).status,404);assert(!db.calls.some(x=>x.sql.includes('AS export_card_id')||x.sql.includes('FROM sample_cards c')));
}));
test('empty selection or unavailable source card fails completely without an empty or partial workbook',async()=>exercise(async(base,db)=>{
 db.selected=[];assert.equal((await fetch(base,{headers:{authorization:'test'}})).status,409);
 db.selected=['12'];db.missing=true;const r=await fetch(base,{headers:{authorization:'test'}});assert.equal(r.status,409);assert(!(await r.text()).includes('PRIVATE'));assert.equal(db.commits,0);
 assert.equal((await fetch(base+'?cardIds=99',{headers:{authorization:'test'}})).status,400);
}));

test('export reads all selected cards across list pages and the library 1000-card batch boundary',async()=>exercise(async(base,db)=>{
 db.selected=Array.from({length:1001},(_,i)=>String(i+100));
 const r=await fetch(base,{headers:{authorization:'test'}});assert.equal(r.status,200);
 const wb=new ExcelJS.Workbook();await wb.xlsx.load(Buffer.from(await r.arrayBuffer()));assert.equal(wb.worksheets[0].rowCount,1002);
 assert.deepEqual(db.calls.filter(x=>x.sql.includes('FROM sample_cards c')).map(x=>x.args.length),[1000,1]);
}));
