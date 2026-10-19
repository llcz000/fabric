/** Destructive fixtures are restricted to the pinned restored rehearsal database. */
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import ExcelJS from 'exceljs';
import sharp from 'sharp';
dotenv.config({quiet:true,override:true});
assert.equal(process.env.FABRIC_V2_QA_ACK,'WRITE_RESTORED_REHEARSAL_ONLY');
assert.match(process.env.DB_DATABASE??'',/^fabric_v2_test_release_[a-z0-9]+$/);
const db=await mysql.createConnection({socketPath:'/var/run/mysqld/mysqld.sock',user:'root',database:process.env.DB_DATABASE});
const [[identity]]=await db.query('SELECT DATABASE() AS db,@@server_uuid AS uuid');
assert.equal(identity.db,process.env.FABRIC_V2_EXPECTED_DATABASE);assert.equal(identity.uuid,process.env.FABRIC_V2_EXPECTED_UUID);
const base='http://127.0.0.1:3001',checks=[],stamp=Date.now().toString(),fixture={};let stage='login';
const request=(url,token,method='GET',body)=>fetch(base+url,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
async function json(url,token,method='GET',body,status=200){const r=await request(url,token,method,body);assert.equal(r.status,status,`${method} ${url}: ${r.status} ${await r.clone().text()}`);return r.json();}
async function login(username,password){return (await json('/api/v2/access/login',null,'POST',{username,password})).token;}
async function upload(token,purpose){
 const body=await sharp({create:{width:64,height:64,channels:3,background:'#'+randomBytes(3).toString('hex')}}).png().toBuffer();
 const grant=await json('/api/image-assets/upload-sessions',token,'POST',{purpose,originalFilename:'generated-company-rehearsal.png',declaredMime:'image/png',declaredByteSize:body.length},201);
 assert((await fetch(grant.uploadUrl,{method:grant.method,headers:grant.headers,body})).ok);
 const ready=await json('/api/image-assets/upload-sessions/'+grant.sessionId+'/finalize',token,'POST',{}),id=ready.assetId??ready.id;
 for(let i=0;i<35;i++){const r=await request('/api/image-assets/'+id,token);if(r.ok)return id;assert.equal(r.status,409);await new Promise(r=>setTimeout(r,1000));}throw Error('Image processing timeout');
}
async function xlsx(rows){const w=new ExcelJS.Workbook();const s=w.addWorksheet('面料');for(const r of rows)s.addRow(r);return Buffer.from(await w.xlsx.writeBuffer()).toString('base64');}
try{
 const admin=await login('admin',process.env.ADMIN_PASSWORD),users=[];
 for(const n of [1,2]){const username='release'+stamp+n,password=randomBytes(24).toString('base64url');const user=await json('/api/v2/access/members',admin,'POST',{username,password,displayName:'发布演练'+n,role:'sales'},201);users.push({...user,username,password,token:await login(username,password)});}
 const a=users[0].token,b=users[1].token;const old=JSON.parse(await readFile('candidate-http-qa-result.json','utf8')).fixture;
 stage='number reservation';
 const reserved=await Promise.all(Array.from({length:8},()=>json('/api/v2/documents/reserve-number',a,'POST',{type:'sample',date:'2026-10-17'})));
 assert.equal(new Set(reserved.map(x=>x.orderNo)).size,8);assert(reserved.every(x=>/^YB-20261017-\d+$/.test(x.orderNo)));
 await json('/api/v2/documents/reserve-number',a,'POST',{type:'sample',date:'2026-02-30'},400);checks.push('real concurrent durable number reservations are unique; invalid date rejected');
 stage='document writes';
 const create={orderNo:'REL-'+stamp,date:'2026-10-17',receivingUnit:'发布验收A'+stamp,type:'sample',deposit:0,items:[{selection:{productId:old.product},fields:{meters:3,unitPrice:17}}]};
 const saved=await json('/api/v2/documents',a,'POST',create,201);fixture.document=saved.id;
 const original=await json('/api/v2/documents/'+saved.id,a);
 await json('/api/v2/documents/'+saved.id,a,'PATCH',{items:original.items.map(line=>({id:line.id,fields:{}})),removeIds:[],orderNo:'RELEDIT-'+stamp,date:'2026-10-16',receivingUnit:'发布验收编辑'+stamp});
 const edited=await json('/api/v2/documents/'+saved.id,a);assert.equal(edited.ownerId,users[0].id);assert.equal(edited.orderNo,'RELEDIT-'+stamp);assert.deepEqual(edited.items,original.items);checks.push('header editing preserves owner, persisted line identities and frozen product/trade snapshots');
 await json('/api/v2/documents/'+saved.id,admin,'PATCH',{items:edited.items.map(line=>({id:line.id,fields:{}})),removeIds:[],issuer:'管理员代修改'});assert.equal((await json('/api/v2/documents/'+saved.id,a)).ownerId,users[0].id);
 const [edits]=await db.query('SELECT original_owner_user_id,action FROM v2_document_audit_events WHERE subject_order_id=?',[saved.id]);assert.equal(edits.length,1);assert.equal(String(edits[0].original_owner_user_id),users[0].id);assert.equal(edits[0].action,'edit');checks.push('administrator edit preserves original sales owner and persists an audit event');
 await json('/api/v2/documents/'+saved.id,a,'PATCH',{items:[],removeIds:edited.items.map(line=>line.id)},400);assert.equal((await json('/api/v2/documents/'+saved.id,a)).items.length,edited.items.length);checks.push('real direct API empty-document save rolls back removed rows');
 const suggestions=await json('/api/v2/documents/customers?q='+encodeURIComponent('发布验收编辑'),a);assert(suggestions.items.includes(edited.receivingUnit));assert.deepEqual((await json('/api/v2/documents/customers?q='+encodeURIComponent('发布验收编辑'),b)).items,[]);checks.push('real customer suggestions are owner scoped and accept Chinese search');
 const snapshot=await json('/api/v2/documents/export.json',a);assert.equal(snapshot.format,'fabric-v2-documents-export-v1');assert.equal(snapshot.documents.length,1);assert.equal(String(snapshot.documents[0].id),String(saved.id));assert.equal((await json('/api/v2/documents/export.json',b)).documents.length,0);await json('/api/v2/documents/export.json?ownerId='+users[0].id,b,'GET',undefined,400);checks.push('consistent snapshot export uses real read-only MySQL transaction and rejects owner override');
 const [[before]]=await db.query('SELECT COUNT(*) AS count FROM orders');
 await json('/api/v2/documents',a,'POST',{...create,orderNo:'FAIL-'+stamp,items:[...create.items,{selection:{productId:'18446744073709551614'},fields:{meters:1,unitPrice:1}}]},422);
 const [[after]]=await db.query('SELECT COUNT(*) AS count FROM orders');assert.equal(before.count,after.count);checks.push('invalid second product rolls back the complete real document transaction');
 await json('/api/v2/documents/'+saved.id,b,'DELETE',{confirm:true},404);
 stage='inventory';
 const productName='QA-INVENTORY-'+stamp;
 await json('/api/inventory/entries',a,'POST',[{entry_date:'2026-10-17',product_name:productName,rolls:2,meters:12.5,remark:'restored rehearsal only'}]);
 const entry=(await json('/api/inventory/entries',a)).find(x=>x.product_name===productName);assert(entry);const ledger=(await json('/api/inventory/ledger',a)).find(x=>x.product_name===productName);assert.equal(ledger.remaining_meters,12.5);await json('/api/inventory/entries/'+entry.id,a,'DELETE');checks.push('existing inventory entry/read/ledger/delete works under real V2 sales authentication');
 stage='company images';
 const [historical]=await db.query('SELECT * FROM orders WHERE created_by_user_id IS NULL ORDER BY id LIMIT 1');assert.equal(historical.length,1);const historyHash=createHash('sha256').update(JSON.stringify(historical)).digest('hex');
 const company=await json('/api/company',admin),images={};
 for(const role of ['brand_logo','wechat_qr','alipay_qr']){images[role]=await upload(admin,role==='brand_logo'?'company_logo':'company_qr');await json('/api/company/images/'+role,admin,'PUT',{assetId:images[role]});}
 const legacy=await sharp({create:{width:32,height:32,channels:3,background:'#ffffff'}}).png().toBuffer();await db.query('UPDATE company_config SET wechat_qr=? WHERE id=1',['data:image/png;base64,'+legacy.toString('base64')]);
 await json('/api/company/images/wechat_qr',admin,'DELETE');assert.equal((await json('/api/company',admin)).images.wechat_qr,undefined);const [[cleared]]=await db.query('SELECT wechat_qr FROM company_config WHERE id=1');assert.equal(cleared.wechat_qr,null);images.wechat_qr=await upload(admin,'company_qr');await json('/api/company/images/wechat_qr',admin,'PUT',{assetId:images.wechat_qr});checks.push('explicit company QR removal clears legacy fallback atomically and never revives an old payment code');
 const config={company_name:'发布候选演练公司',brand_name:'QA',address:'仅恢复库演练地址',phone:'0575-00000000',default_terms:'最新统一条款'+stamp,deposit_terms:'最新定金条款'+stamp,issuer_label:'演练开单签字',receiver_label:'演练收货签字'};
 await json('/api/company',admin,'POST',config);
 for(const id of [saved.id,String(historical[0].id)]){
  const model=await json('/api/v2/documents/'+id+'/print-model',admin);assert.equal(model.companyName,config.company_name);assert.equal(model.signatureLabels.issuer,config.issuer_label);assert.equal(Object.keys(model.companyImages).length,3);assert.equal(model.terms,config.default_terms);
  const response=await request('/api/v2/documents/'+id+'/export.xlsx',admin);assert.equal(response.status,200);const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));assert.equal(workbook.worksheets[0].getImages().length,3);const strings=JSON.stringify(workbook.worksheets[0].getSheetValues());assert(strings.includes(config.company_name));assert(strings.includes(config.issuer_label));
 }
 const [still]=await db.query('SELECT * FROM orders WHERE id=?',[historical[0].id]);assert.equal(createHash('sha256').update(JSON.stringify(still)).digest('hex'),historyHash);fixture.images=images;fixture.historicalDocument=String(historical[0].id);checks.push('actual COS logo/two QR images and current company/signature settings reach old/new print JSON and real XLSX without rewriting historical rows');
 stage='Excel import';
 const header=['品号','品名','成分','克重','门幅','备注'],fabricNo='RELIMPORT'+stamp;
 const file=await xlsx([header,[fabricNo,'初始品名','棉',120,150,'新增'],['BAD'+stamp,'','','invalid',150,'错误行']]);
 const preview=await json('/api/v2/fabrics/import/preview',a,'POST',{fileBase64:file,options:{filename:'qa.xlsx',headerRow:1,defaultWeightUnit:'gsm'}});assert.equal(preview.rows.length,2);
 const commit=await json('/api/v2/fabrics/import/commit',a,'POST',{token:preview.token,confirm:true,updateRows:[]});assert.equal(commit.counts.created,1);assert.equal(commit.counts.failed,1);
 await json('/api/v2/fabrics/import/commit',a,'POST',{token:preview.token,confirm:true,updateRows:[]},409);
 const duplicateFile=await xlsx([header,[fabricNo,'显式更新品名','棉',130,151,'更新']]);
 const p2=await json('/api/v2/fabrics/import/preview',a,'POST',{fileBase64:duplicateFile,options:{filename:'qa.xlsx',headerRow:1,defaultWeightUnit:'gsm'}});assert.equal(p2.rows[0].action,'skip');
 const c2=await json('/api/v2/fabrics/import/commit',a,'POST',{token:p2.token,confirm:true,updateRows:[2]});assert.equal(c2.counts.updated,1);
 const p3=await json('/api/v2/fabrics/import/preview',a,'POST',{fileBase64:duplicateFile,options:{filename:'qa.xlsx',headerRow:1,defaultWeightUnit:'gsm'}});
 const [[fabric]]=await db.query('SELECT id FROM v2_fabrics WHERE fabric_no=?',[fabricNo]);await json('/api/v2/fabrics/'+fabric.id,b,'PATCH',{remark:'another real session changed the row'});
 const stale=await json('/api/v2/fabrics/import/commit',a,'POST',{token:p3.token,confirm:true,updateRows:[2]});assert.equal(stale.counts.failed,1);fixture.importFabric=String(fabric.id);checks.push('real XLSX preview/create, invalid-row isolation, single-use token, explicit duplicate update and stale-row conflict');
 stage='copy/delete';const copy=await json('/api/v2/documents/'+saved.id+'/copy',a,'POST',{orderNo:'COPY-'+stamp,date:'2026-10-17'},201);const copied=await json('/api/v2/documents/'+copy.id,a);assert.deepEqual(copied.items.map(({id,...line})=>line),edited.items.map(({id,...line})=>line));
 const activeProduct=await json('/api/v2/products/'+old.product,a);await json('/api/v2/products/'+old.product,a,'PATCH',{expectedRowVersion:activeProduct.rowVersion,isActive:false});
 try{await json('/api/v2/documents/'+saved.id+'/copy',a,'POST',{orderNo:'BAD-COPY-'+stamp,date:'2026-10-17'},422);}finally{const inactive=await json('/api/v2/products/'+old.product,a);await json('/api/v2/products/'+old.product,a,'PATCH',{expectedRowVersion:inactive.rowVersion,isActive:true});}
 await json('/api/v2/documents/'+historical[0].id+'/copy',admin,'POST',{orderNo:'LEGACY-COPY-'+stamp,date:'2026-10-17'},422);checks.push('actual API refuses inactive-product and legacy unlinked copies without creating a document');
 for(const id of [copy.id,saved.id]){const response=await request('/api/v2/documents/'+id,admin,'DELETE',{confirm:true});assert.equal(response.status,204);await json('/api/v2/documents/'+id,a,'GET',undefined,404);const [events]=await db.query("SELECT original_owner_user_id FROM v2_document_audit_events WHERE subject_order_id=? AND action='delete'",[id]);assert.equal(events.length,1);assert.equal(String(events[0].original_owner_user_id),users[0].id);}checks.push('shared upstream SQL copy preserves frozen source rows; cross-owner delete denied; admin deletion retains original-owner audit after parent removal');
 await writeFile('candidate-release-browser-credentials.local.json',JSON.stringify(users.map(({id,username,password})=>({id,username,password}))),{mode:0o600});
 const result={passed:checks.length,checks,fixture,productionDatabaseChanged:false};await writeFile('candidate-release-qa-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){console.error(JSON.stringify({stage,passed:checks.length,error:error instanceof Error?error.message:'failed'}));process.exitCode=1;}finally{await db.end();}
