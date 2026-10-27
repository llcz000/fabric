import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import sharp from 'sharp';
import ExcelJS from 'exceljs';
import {createV2DocumentRouter} from './documentRoutes';
import {hashSessionToken} from '../access/password';
import type {CompanyImageRuntime} from '../image-assets/companyImages';

test('COMPANY-01 current logo/WeChat/Alipay are read through order-scope V2 auth, in JSON/PNG/Excel',async()=>{
 const token='d'.repeat(64);
 const png=await sharp({create:{width:2,height:2,channels:4,background:'#ffffff'}}).png().toBuffer();
 const company={company_name:'最新公司',brand_name:'最新字标',address:'新地址',phone:'新电话',
  default_terms:'通用最新条款',deposit_terms:'定金最新条款',brand_logo:'',wechat_qr:'',alipay_qr:'',
  issuer_label:'制单人签章',receiver_label:'客户签收'};
 const roles={brand_logo:'image-1',wechat_qr:'image-2',alipay_qr:'image-3'};
 const images={
  enabled:true,service:{
   async getDescriptor(id:string){return {id,status:'ready'};},
   async readContent(){return {body:png,mime:'image/png'};},
   async replaceCompanyImage(){}
  },async findAssociation(role:keyof typeof roles){return roles[role]??null;},
  async getCompany(){return company;},async readLegacy(){return null;}
 } as unknown as CompanyImageRuntime;
 const db={
  async getConnection(){throw Error('GET routes must not write or open transactions');},
  async query(sql:string,args:unknown[]=[]):Promise<[unknown,unknown]>{
   const reply=(rows:unknown)=>[rows,[]] as [unknown,unknown];
   if(sql.includes('s.token_hash'))return reply(args[0]===hashSessionToken(token)?
    [{user_id:'1',session_id:'8',username:'admin',display_name:'Admin',role:'admin',can_manage_products:1,can_manage_own_orders:1}]:[]);
   if(sql.includes('FROM company_config'))return reply([company]);
   if(sql.includes('FROM orders o'))return reply([{id:'123',order_no:'XS123',order_date:'2026-10-17',
    receiving_unit:'客户甲',template_type:'bulk',created_by_user_id:'1',
    total_meters:2,total_pieces:1,total_amount:20,deposit:0,deduction_meters:0,settled:0,
    sign_person:'销售甲',receiver:'客户甲',receiver_phone:'138000',receiver_address:'门店'}]);
   if(sql.includes('FROM order_items'))return reply([{id:'900',order_id:'123',product_no:'F99',
    product_name:'面料',color_no:'1',composition:'棉',weight:100,width:150,meters:2,
    unit_price:10,amount:20,remark:'',piece_meters:'[2]',deduction_meters:0}]);
   throw Error('Unexpected query '+sql);
  }
 };
 const app=express();
 app.use('/api/v2',createV2DocumentRouter(db, {companyImages:images}));
 const server=app.listen(0,'127.0.0.1');
 await new Promise<void>(resolve=>server.once('listening',resolve));
 try{
  const address=server.address();assert(address&&typeof address!=='string');
  const base='http://127.0.0.1:'+address.port+'/api/v2/documents/123';
  assert.equal((await fetch(base+'/company-image/brand_logo')).status,401);
  const request=(path:string)=>fetch(base+path,{headers:{Authorization:'Bearer '+token}});
  const modelResponse=await request('/print-model');assert.equal(modelResponse.status,200);
  const model=await modelResponse.json();
  assert.equal(model.companyName,'最新公司');assert.equal(model.brandName,'最新字标');
  assert.deepEqual(model.signatureLabels,{issuer:'开单人签字',receiver:'收货人签字'});
  assert.equal(Object.keys(model.companyImages).length,3);
  for(const role of Object.keys(roles)){
   const reply=await request('/company-image/'+role);
   assert.equal(reply.status,200);
   assert.match(reply.headers.get('content-type')??'',/image\/png/);
   assert((await reply.arrayBuffer()).byteLength>50);
  }
  assert.equal((await request('/company-image/not-a-role')).status,404);
  const exported=await request('/export.xlsx');
  assert.equal(exported.status,200);
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(Buffer.from(await exported.arrayBuffer()));
  assert.equal(workbook.worksheets[0].getImages().length,3);
  const values:string[]=[];workbook.worksheets[0].eachRow(row=>row.eachCell(c=>{
   if(typeof c.value==='string')values.push(c.value);
  }));
  assert(values.some(v=>v.includes('开单人签字')));assert(values.some(v=>v.includes('收货人签字')));assert(!values.some(v=>v.includes('制单人签章')));
  assert(!values.some(v=>v.includes('客户签收')));
  assert(values.includes('备注条款：通用最新条款'));
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
