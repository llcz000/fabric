/** Writes fixtures ONLY to an explicitly pinned restored rehearsal database. Never production data. */
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import ExcelJS from 'exceljs';
dotenv.config({quiet:true,override:true});
assert.equal(process.env.FABRIC_V2_QA_ACK,'WRITE_RESTORED_REHEARSAL_ONLY');
assert.match(process.env.DB_DATABASE??'',/^fabric_v2_test_release_[a-z0-9]+$/);
assert.equal(process.env.FABRIC_V2_EXPECTED_DATABASE,process.env.DB_DATABASE);
const db=await mysql.createConnection({socketPath:'/var/run/mysqld/mysqld.sock',user:'root',database:process.env.DB_DATABASE});
const [[identity]]=await db.query('SELECT DATABASE() AS db,@@server_uuid AS uuid');
assert.equal(identity.db,process.env.DB_DATABASE);assert.equal(identity.uuid,process.env.FABRIC_V2_EXPECTED_UUID);
const base='http://127.0.0.1:3001',checks=[],stamp=Date.now().toString(),fixture={};
let stage='health';
const record=(name)=>checks.push(name);
const request=(url,token,method='GET',body)=>fetch(base+url,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
async function json(url,token,method='GET',body,status=200){const response=await request(url,token,method,body);assert.equal(response.status,status,`${method} ${url}: ${response.status} ${await response.clone().text()}`);return response.json();}
async function login(username,password){return (await json('/api/v2/access/login',null,'POST',{username,password})).token;}
try{
 assert.equal((await json('/api/health')).storage,'mysql');record('candidate health storage=mysql');
 assert.equal((await request('/api/orders')).status,410);assert.equal((await request('/api/v2/products')).status,401);record('legacy API disabled and anonymous V2 denied');
 const admin=await login('admin',process.env.ADMIN_PASSWORD);assert.equal((await json('/api/v2/access/me',admin)).role,'admin');record('real scrypt administrator login');
 for(const path of ['/api/v2/pattern-catalog','/api/v2/fabrics/catalog','/api/v2/products','/api/v2/sample-cards','/api/company','/api/v2/documents/stats'])await json(path,admin);
 record('real initial catalog, cards, company, statistics reads');
 const users=[];
 for(const index of [1,2]){
  const username='qa'+stamp+index,password=randomBytes(24).toString('base64url');
  const user=await json('/api/v2/access/members',admin,'POST',{username,password,displayName:'部署验收'+index,role:'sales'},201);
  users.push({id:user.id,token:await login(username,password)});
 }
 record('administrator creates two real sales accounts');const sales=users[0].token,other=users[1].token;
 assert.equal((await request('/api/v2/access/members',sales)).status,403);record('sales cannot manage accounts');
 stage='catalog';
 const master=await json('/api/v2/pattern-masters',sales,'POST',{masterNo:'QA'+stamp},201);fixture.master=master.id;
 const colorway=await json('/api/v2/pattern-masters/'+master.id+'/colorways',sales,'POST',{remark:'部署验收'},201);
 const fabric=await json('/api/v2/fabrics',sales,'POST',{fabricNo:'QAF'+stamp,fabricName:'部署验收面料',composition:'棉',weightValue:120,weightUnit:'gsm',widthValue:150},201);fixture.fabric=fabric.id;
 const product=await json('/api/v2/products',sales,'POST',{patternColorwayId:colorway.id,fabricId:fabric.id},201);fixture.product=product.id;
 record('sales persists real pattern, allocated colorway, fabric and product');
 await json('/api/v2/products/'+product.id,other);record('both sales share catalog access');
 stage='documents';const documents=[];
 for(const type of ['sample','bulk','deposit']){
  const saved=await json('/api/v2/documents',sales,'POST',{orderNo:'QA-'+type+'-'+stamp,date:'2026-10-17',receivingUnit:'部署验收客户',type,deposit:type==='deposit'?25:0,items:[{selection:{productId:product.id},fields:{meters:4,unitPrice:20,...(type==='bulk'?{pieceMeters:[1.25,2.75],deductionMeters:0.5}:{})}}]},201);
  documents.push(saved.id);const read=await json('/api/v2/documents/'+saved.id,sales);assert.equal(read.ownerId,users[0].id);
  assert.equal((await request('/api/v2/documents/'+saved.id,other)).status,404);await json('/api/v2/documents/'+saved.id,admin);
  const model=await json('/api/v2/documents/'+saved.id+'/print-model',sales);assert(model.companyName);
  const output=await request('/api/v2/documents/'+saved.id+'/export.xlsx',sales);assert.equal(output.status,200);const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(Buffer.from(await output.arrayBuffer()));assert(workbook.worksheets.length);
  record(type+' SQL save/reread, same-owner/admin read, cross-owner denial, print and real XLSX');
 }
 fixture.documents=documents;
 const own=await json('/api/v2/documents',sales),their=await json('/api/v2/documents',other);assert.equal(own.total,3);assert.equal(their.total,0);record('real SQL owner scope for document list');
 const stats=await json('/api/v2/documents/stats',sales);assert.equal(stats.orderCount,3);assert.equal(stats.byType.deposit.count,1);record('real SQL three-type statistics');
 assert.equal((await request('/api/v2/products/'+product.id,sales,'DELETE')).status,409);record('saved document references prohibit product deletion');
 stage='revocation';await json('/api/v2/access/members/'+users[0].id,admin,'PATCH',{isActive:false});assert.equal((await request('/api/v2/documents',sales)).status,401);record('real account deactivation invalidates existing session');
 await writeFile('candidate-http-qa-result.json',JSON.stringify({passed:checks.length,checks,fixture,database:identity.db,productionDatabaseChanged:false},null,2));
 console.log(JSON.stringify({passed:checks.length,checks,fixture,productionDatabaseChanged:false}));
}catch(error){console.error(JSON.stringify({stage,passed:checks.length,error:error instanceof Error?error.message:'failed'}));process.exitCode=1;}
finally{await db.end();}
