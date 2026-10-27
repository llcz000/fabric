import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import ExcelJS from 'exceljs';
import {hashSessionToken} from '../access/password';
import {createSampleCardLibraryRouter} from './cardLibraryRoutes';
import {SampleCardError} from './cardLibrary';

const bearer='a'.repeat(64);
const card=(id='11',no='0012-F018')=>({id,masterId:'1',masterNo:'0012',fabricId:'2',fabricNo:'F018',cardNo:no,description:'绢纺',composition:'100%S',weightValue:16,weightUnit:'mm' as const,widthValue:140,qrPayload:'A_raw_stable_card_token_1234567890_'+id,isActive:true});
class AuthDb{
 active=true;role:'admin'|'sales'='admin';
 async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>{
  if(sql.includes('JOIN v2_access_users'))return [this.active&&params[0]===hashSessionToken(bearer)?[{user_id:'1',session_id:'3',username:'user',display_name:'用户',role:this.role,can_manage_own_orders:0,can_manage_products:0}]:[],[]];
  throw Error('Unexpected auth SQL');
 }
}
async function exercise(run:(url:string,db:AuthDb,state:{calls:string[];failure:Error|null;mismatch:boolean})=>Promise<void>){
 const db=new AuthDb(),state={calls:[] as string[],failure:null as Error|null,mismatch:false};
 const app=express();
 app.use('/api/v2/sample-cards',createSampleCardLibraryRouter(db,{
  list:async input=>{state.calls.push('list');if(state.failure)throw state.failure;return {items:[card()],total:1,limit:input.limit??50,offset:input.offset??0};},
  create:async (input,actor)=>{state.calls.push('create');assert.equal(actor.userId,'1');assert.deepEqual(input,{masterId:'1',fabricId:'2'});if(state.failure)throw state.failure;return {card:card(),created:state.calls.filter(x=>x==='create').length===1};},
  retire:async (identity,actor)=>{state.calls.push('retire');assert.equal(identity,'11');assert.equal(actor.userId,'1');if(state.failure)throw state.failure;return {id:identity,retired:true};},
  confirmReprinted:async (identity,revision,actor)=>{
   state.calls.push('reprint');assert.equal(identity,'11');assert.equal(revision,'2');assert.equal(actor.userId,'1');
   if(state.failure)throw state.failure;
   return {id:identity,reprintRevision:revision,needsReprint:false};
  },
  selected:async ids=>{state.calls.push('selected');if(state.failure)throw state.failure;return (state.mismatch?[...ids].reverse():ids).map(id=>card(id,id==='12'?'0012-F019':'0012-F018'));},
 }));
 const server=await new Promise<ReturnType<typeof app.listen>>(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 try{const addr=server.address();assert(addr&&typeof addr!=='string');await run('http://127.0.0.1:'+addr.port+'/api/v2/sample-cards',db,state);}
 finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
}
function request(url:string,method='GET',body?:unknown,auth=true){return fetch(url,{method,headers:{...(auth?{authorization:'Bearer '+bearer}:{}),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});}
test('product-linked card retirement returns only the validated count without exposing internal SQL',async()=>{
 await exercise(async(url,_db,state)=>{
  state.failure=new SampleCardError('Card has 3 products; delete associated products first',409);
  const response=await request(url+'/11','DELETE');assert.equal(response.status,409);
  assert.deepEqual(await response.json(),{error:'Card has products',productCount:3});
 });
});
test('B2-3 admin and sales can manage/export without product/order permission; disabled session immediately denied',async()=>{
 await exercise(async(url,db,state)=>{
  assert.equal((await request(url,'GET',undefined,false)).status,401);
  assert.equal(state.calls.length,0);
  for(const role of ['admin','sales'] as const){
   db.role=role;
   const list=await request(url);assert.equal(list.status,200);assert.equal(list.headers.get('cache-control'),'no-store');
   const created=await request(url,'POST',{masterId:'1',fabricId:'2'});assert.equal(created.status,role==='admin'?201:200);
   const payload=await created.json();assert.equal(payload.card.cardNo,'0012-F018');assert.equal(payload.card.qrPayload,card().qrPayload);
   assert.equal((await request(url+'/export','POST',{cardIds:['11']})).status,200);
  }
  const count=state.calls.length;db.active=false;
  for(const [path,method,body] of [['','GET',undefined],['','POST',{masterId:'1',fabricId:'2'}],['/export','POST',{cardIds:['11']}]] as const)
   assert.equal((await request(url+path,method,body)).status,401);
  assert.equal(state.calls.length,count);
 });
});
test('AC-96 B2-5 card DELETE is admin/sales only, validates ID before touching storage, and hides storage failures',async()=>{
 await exercise(async(url,db,state)=>{
  const unauth=await request(url+'/11','DELETE',undefined,false);assert.equal(unauth.status,401);
  for(const id of ['abc','0','18446744073709551616'])
   assert.equal((await request(url+'/'+id,'DELETE')).status,400);
  assert.equal(state.calls.length,0);
  for(const role of ['sales','admin'] as const){
   db.role=role;const response=await request(url+'/11','DELETE');
   assert.equal(response.status,200);assert.deepEqual(await response.json(),{id:'11',retired:true});
  }
  assert.deepEqual(state.calls,['retire','retire']);
  state.failure=Error('PRIVATE MYSQL ERROR');
  const broken=await request(url+'/11','DELETE');assert.equal(broken.status,503);
  assert(!(await broken.text()).includes('PRIVATE'));
  const count=state.calls.length;db.active=false;
  assert.equal((await request(url+'/11','DELETE')).status,401);assert.equal(state.calls.length,count);
 });
});
test('AC-98 B2-5 list pending only requires literal true or false, forwards filter to backend',async()=>{
 await exercise(async(url,_db,state)=>{
  for(const value of ['1','yes','0','TRUE'])assert.equal((await request(url+'?needsReprint='+value)).status,400);
  assert.equal(state.calls.length,0);
  assert.equal((await request(url+'?needsReprint=true')).status,200);
  assert.equal((await request(url+'?needsReprint=false')).status,200);
 });
});
test('AC-99 B2-5 admin/sales may confirm reprint with expected revision, invalid or unauthenticated requests cannot change state',async()=>{
 await exercise(async(url,db,state)=>{
  assert.equal((await request(url+'/11/confirm-reprinted','POST',{expectedRevision:'2'},false)).status,401);
  for(const body of [{expectedRevision:2},{expectedRevision:'-1'},{expectedRevision:'2',cardId:'11'},{}])
   assert.equal((await request(url+'/11/confirm-reprinted','POST',body)).status,400);
  assert.equal(state.calls.length,0);
  for(const role of ['sales','admin'] as const){
   db.role=role;const ok=await request(url+'/11/confirm-reprinted','POST',{expectedRevision:'2'});
   assert.equal(ok.status,200);
   assert.deepEqual(await ok.json(),{id:'11',reprintRevision:'2',needsReprint:false});
  }
  assert.deepEqual(state.calls,['reprint','reprint']);
  state.failure=Error('PRIVATE DB CONTENT');
  const failed=await request(url+'/11/confirm-reprinted','POST',{expectedRevision:'2'});
  assert.equal(failed.status,503);assert(!(await failed.text()).includes('PRIVATE'));
 });
});
test('B2-3 strict IDs, pagination, selection and JSON before repository calls',async()=>{
 await exercise(async(url,_db,state)=>{
  for(const body of [{masterId:'1',fabricId:'2',cardNo:'fake'}, {masterId:'0',fabricId:'2'},{masterId:'1',fabricId:'18446744073709551616'}, {masterId:1,fabricId:'2'},[]])
   assert.equal((await request(url,'POST',body)).status,400);
  for(const body of [{cardIds:[]},{cardIds:['11','11']},{cardIds:['0']},{cardIds:['11'],role:'admin'},{cardIds:Array.from({length:1001},(_,i)=>String(i+1))}])
   assert.equal((await request(url+'/export','POST',body)).status,400);
  for(const query of ['?limit=0','?limit=101','?offset=-1','?query[x]=a','?offset=9007199254740992','?extra=x'])
   assert.equal((await request(url+query)).status,400);
  const bad=await fetch(url,{method:'POST',headers:{authorization:'Bearer '+bearer,'content-type':'application/json'},body:'{'});
  assert.equal(bad.status,400);assert(!((await bad.text()).includes('SyntaxError')));
  const plain=await fetch(url,{method:'POST',headers:{authorization:'Bearer '+bearer,'content-type':'text/plain'},body:'{}'});
  assert.equal(plain.status,400);
  assert.equal(state.calls.length,0);
 });
});
test('B2-3 actual HTTP Excel has exactly selected rows and six columns; QRcode is raw payload text',async()=>{
 await exercise(async(url)=>{
  const response=await request(url+'/export','POST',{cardIds:['12','11']});
  assert.equal(response.status,200);assert.match(response.headers.get('content-type')??'',/spreadsheetml/);assert.match(response.headers.get('content-disposition')??'',/attachment/);
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
  const sheet=workbook.worksheets[0];assert.equal(sheet.rowCount,3);assert.equal(sheet.columnCount,6);
  assert.deepEqual(sheet.getRow(1).values,[,'色卡编号','品名','成分','克重','门幅','二维码']);
  assert.equal(sheet.getCell('A2').value,'0012-F019');assert.equal(sheet.getCell('A3').value,'0012-F018');
  assert.equal(sheet.getCell('F2').value,card('12').qrPayload);assert.equal(sheet.getCell('F3').value,card('11').qrPayload);
  assert.equal(sheet.getImages().length,0);assert.equal(typeof sheet.getCell('F2').value,'string');
 });
});
test('B2-3 internal errors never disclose SQL/token or provide public QR/details fallback',async()=>{
 await exercise(async(url,_db,state)=>{
  state.failure=Error('SECRET token or connection details');
  for(const [path,method,body] of [['','GET',undefined],['','POST',{masterId:'1',fabricId:'2'}],['/export','POST',{cardIds:['11']}]] as const){
   const response=await request(url+path,method,body);assert.equal(response.status,503);assert(!((await response.text()).includes('SECRET')));
  }
  assert.equal((await request(url+'/11','GET',undefined,false)).status,404);
 });
});
test('B2-3 repository statuses are safe and export rejects adapter identity mismatch',async()=>{
 const {SampleCardError}=await import('./cardLibrary');
 await exercise(async(url,_db,state)=>{
  for(const status of [400,401,403,404,409] as const){
   state.failure=new SampleCardError('SECRET card state',status);
   const response=await request(url,'POST',{masterId:'1',fabricId:'2'});
   assert.equal(response.status,status);assert(!((await response.text()).includes('SECRET')));
  }
  state.failure=null;state.mismatch=true;
  const response=await request(url+'/export','POST',{cardIds:['11','12']});
  assert.equal(response.status,503);assert(!((await response.text()).includes('mismatch')));
 });
});
test('B2-3 oversized private body is bounded and authentication runs before parser',async()=>{
 await exercise(async(url,_db,state)=>{
  const response=await fetch(url,{method:'POST',headers:{authorization:'Bearer '+bearer,'content-type':'application/json'},body:JSON.stringify({padding:'x'.repeat(70000)})});
  assert.equal(response.status,413);
  const anonymous=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:'{'});
  assert.equal(anonymous.status,401);assert.equal(state.calls.length,0);
 });
});
