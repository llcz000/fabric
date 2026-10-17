import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import {createV2CompanyPrintSettingsRouter,parseCompanyPrintSettings} from './companyPrintSettings';
import {hashSessionToken} from '../access/password';

const token='b'.repeat(64);
const latest={
 company_name:'最新公司',brand_name:'新字标',address:'工厂',phone:'123456',
 default_terms:'最新通用条款',deposit_terms:'最新定金条款',
 issuer_label:'制单人签章',receiver_label:'客户签字'
};
test('COMPANY-01 exact configured fields, nonblank name/signature labels and no spoofed owner',()=>{
 assert.deepEqual(parseCompanyPrintSettings(latest),latest);
 for(const body of [{...latest,ownerId:'9'},{...latest,issuer_label:''},{...latest,company_name:''},
  {...latest,receiver_label:55}, {...latest,brand_name:'a'.repeat(256)},{...latest,issuer_label:'a'.repeat(101)}]){
  assert.throws(()=>parseCompanyPrintSettings(body),/invalid/i);
 }
});
test('COMPANY-01 authenticated GET and admin-only PATCH persist all fields atomically, sales cannot write',async()=>{
 const record={...latest},calls:string[]=[],transactions:string[]=[];
 const db={
  async query(sql:string,args:unknown[]=[]):Promise<[unknown,unknown]>{
   calls.push(sql);
   if(sql.includes('s.token_hash'))return [args[0]===hashSessionToken(token)?
    [{user_id:'2',session_id:'9',username:'admin',display_name:'Admin',role:db.role,
     can_manage_own_orders:1,can_manage_products:1}]:[],[]];
   if(sql.includes('FROM company_config'))return [[record],[]];
   if(sql.includes('FROM v2_company_print_labels'))return [[record],[]];
   if(sql.startsWith('UPDATE company_config')){Object.assign(record,Object.fromEntries(
    ['company_name','brand_name','address','phone','default_terms','deposit_terms'].map((key,i)=>[key,args[i]])));return [{affectedRows:1},[]];}
   if(sql.startsWith('INSERT INTO v2_company_print_labels')){
    record.issuer_label=String(args[0]);record.receiver_label=String(args[1]);return [{affectedRows:1},[]];}
   throw Error('Unsupported SQL '+sql);
  },
  role:'admin' as 'admin'|'sales',
  async getConnection(){return {query:db.query.bind(db),async beginTransaction(){transactions.push('begin');},
   async commit(){transactions.push('commit');},async rollback(){transactions.push('rollback');},
   release(){transactions.push('release');}}}
 };
 const app=express();app.use('/api/v2',createV2CompanyPrintSettingsRouter(db,db));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 try{
  const info=server.address();assert(info&&typeof info!=='string');
  const url='http://127.0.0.1:'+info.port+'/api/v2/company-print-settings';
  const call=(method:'GET'|'PATCH',body?:unknown)=>fetch(url,{method,
   headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
  assert.equal((await fetch(url)).status,401);
  const first=await call('GET');assert.equal(first.status,200);assert.deepEqual(await first.json(),latest);
  const updated={...latest,company_name:'新改名公司',issuer_label:'最新盖章人'};
  const saved=await call('PATCH',updated);assert.equal(saved.status,200);
  assert.deepEqual(await saved.json(),updated);
  assert.equal(transactions.join(','),'begin,commit,release');
  assert.deepEqual(await (await call('GET')).json(),updated);
  const invalid=await call('PATCH',{...updated,createdBy:'3'});
  assert.equal(invalid.status,400);assert.deepEqual(transactions,['begin','commit','release']);
  db.role='sales';
  assert.equal((await call('PATCH',updated)).status,403);
  assert.deepEqual(transactions,['begin','commit','release']);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
