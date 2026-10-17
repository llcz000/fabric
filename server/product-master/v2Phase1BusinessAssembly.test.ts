import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import {createV2Phase1BusinessAssembly} from './v2Phase1BusinessAssembly';
import {hashSessionToken} from '../access/password';

const bearer='c'.repeat(64);
test('third-batch phase-one assembly mounts actual 7-screen catalogs, company settings and optional media without B2/B3',async()=>{
 const calls:string[]=[];
 const db={
  async query(sql:string,args:unknown[]=[]):Promise<[unknown,unknown]>{
   calls.push(sql);
   if(sql==='SELECT DATABASE() AS database_name, @@server_uuid AS server_uuid')
    return [[{database_name:'fabric_v2_test_phase1',server_uuid:'sandbox-uuid'}],[]];
   if(sql.includes('s.token_hash'))return [args[0]===hashSessionToken(bearer)?
    [{user_id:'2',session_id:'9',username:'admin',display_name:'Admin',role:'admin',can_manage_products:1,can_manage_own_orders:1}]:[],[]];
   if(sql.includes('FROM company_config'))
    return [[{company_name:'公司A',brand_name:'A',address:'地址',phone:'123',
     default_terms:'条款',deposit_terms:'定金条款'}],[]];
   if(sql.includes('FROM v2_company_print_labels'))
    return [[{issuer_label:'签发人',receiver_label:'收货人'}],[]];
   throw Error('Unexpected business SQL '+sql);
  },
  async getConnection(){
   return {query:db.query.bind(db),async beginTransaction(){},async commit(){},
    async rollback(){},release(){}};
  }
 };
 const routes=await createV2Phase1BusinessAssembly(db,db,{database:'fabric_v2_test_phase1',confirmation:'I_ACKNOWLEDGE_SANDBOX'});
 const app=express();app.use('/api/v2',routes);
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 try{
  const addr=server.address();assert(addr&&typeof addr!=='string');
  const base='http://127.0.0.1:'+addr.port+'/api/v2';
  assert.equal((await fetch(base+'/media-capabilities')).status,401);
  const options={headers:{Authorization:'Bearer '+bearer}};
  const m=await fetch(base+'/media-capabilities',options);
  assert.equal(m.status,200);assert.deepEqual(await m.json(),{available:false,companyImagesAvailable:false});
  const settings=await fetch(base+'/company-print-settings',options);
  assert.equal(settings.status,200);
  assert.deepEqual(await settings.json(),{
   company_name:'公司A',brand_name:'A',address:'地址',phone:'123',
   default_terms:'条款',deposit_terms:'定金条款',
   issuer_label:'签发人',receiver_label:'收货人'
  });
  // Phase two must not bleed into the phase-one business route group.
  for(const path of ['/sample-cards','/customer-samples/sessions','/legacy-orders']){
   const response=await fetch(base+path,options);assert.equal(response.status,404,path);
  }
  assert(calls.every(sql=>sql.startsWith('SELECT')),'read-only HTTP emits no writes');
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
