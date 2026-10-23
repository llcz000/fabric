/**
 * P6-2/P6-3 isolated live MySQL 8 + HTTP V2 create/update/read E2E.
 * ONLY the fixed separate sandbox database. Never references fabric_db.
 */
import assert from 'node:assert/strict';
import express from 'express';
import ExcelJS from 'exceljs';
import {URL as NodeURL} from 'node:url';
import {createConnection,createPool,type Pool} from 'mysql2/promise';
import {initializeAccessSchema} from '../server/access/schema';
import {createV2AccessRouter} from '../server/access/routes';
import {hashPassword} from '../server/access/password';
import {initializeV2ProductMasterSchema,getV2ProductMasterCreateStatements} from '../server/product-master/schema';
import {getP1DAdditiveMigrationSql,inspectP1DCompatibility} from '../server/order-v2/schema';
import {getP1D2LineMigrationSql,inspectP1D2Lines} from '../server/order-v2/lineSchema';
import {createV2DocumentRouter} from '../server/order-v2/documentRoutes';
import {createV2ProductSafetyRouter} from '../server/product-master/productSafetyRoutes';
import {createLegacyCutoverGuard} from '../server/access/legacyCutoverGuard';
import {getV2DocumentDisplaySchemaSql,inspectV2DocumentDisplaySchema} from '../server/order-v2/displaySchema';

const DB='fabric_v2_test_20261012_p6documents';
if(process.env.FABRIC_V2_ISOLATED_TEST!=='I_ACKNOWLEDGE_SANDBOX')throw Error('Explicit isolated P6 documents confirmation required');
const socketPath='/var/run/mysqld/mysqld.sock';
const tables=new Set(['image_assets','company_config','orders','order_items','v2_access_users','v2_access_sessions',
 ...getV2ProductMasterCreateStatements().map(t=>t.name)]);
type Row=Record<string,unknown>;
const rows=(raw:unknown):Row[]=>{if(!Array.isArray(raw))throw Error('Expected SQL rows');return raw as Row[];};
async function main(){
 // The single-file esbuild test runner bundles ExcelJS browser shims, which
 // can replace global URL with a non-constructor. Restore native Node URL
 // ONLY inside this sandbox process before using native fetch.
 globalThis.URL=NodeURL as typeof URL;
 const bootstrap=await createConnection({user:'root',socketPath});
 let db:Pool|undefined,seeded=false,server:ReturnType<ReturnType<typeof express>['listen']>|undefined;
 try{
  const [present]=await bootstrap.query('SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=?',[DB]);
  if(rows(present).some(t=>!tables.has(String(t.TABLE_NAME))))throw Error('Unexpected tables in P6-only sandbox');
  await bootstrap.query('CREATE DATABASE IF NOT EXISTS '+DB+' CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci');
  db=createPool({user:'root',socketPath,database:DB,connectionLimit:6,waitForConnections:true});
  await db.query("CREATE TABLE IF NOT EXISTS company_config(id INT PRIMARY KEY,company_name VARCHAR(255),address VARCHAR(500),phone VARCHAR(100),default_terms TEXT,deposit_terms TEXT) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
  await db.query("CREATE TABLE IF NOT EXISTS image_assets (id VARCHAR(36) NOT NULL PRIMARY KEY,ref_count INT UNSIGNED NOT NULL DEFAULT 0) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
  await initializeV2ProductMasterSchema(db);
  await initializeAccessSchema(db);
  await db.query(`CREATE TABLE IF NOT EXISTS orders (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,order_no VARCHAR(100) NOT NULL,
    order_date DATE NOT NULL,receiving_unit VARCHAR(100) NOT NULL,
    template_type VARCHAR(20) NOT NULL DEFAULT 'sample',
    deposit DECIMAL(12,2) NOT NULL DEFAULT 0,
    total_meters DECIMAL(12,2) NOT NULL DEFAULT 0,
    total_pieces INT NOT NULL DEFAULT 0,
    total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    deduction_meters DECIMAL(12,2) NOT NULL DEFAULT 0
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await db.query(`CREATE TABLE IF NOT EXISTS order_items(
   id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,order_id INT NOT NULL,
   product_no VARCHAR(50) DEFAULT '',product_name VARCHAR(100) DEFAULT '',
   color_no VARCHAR(100) DEFAULT '',composition VARCHAR(50) DEFAULT '',
   weight DECIMAL(10,2) NULL,width DECIMAL(10,2) NULL,
   meters DECIMAL(10,2) DEFAULT 0,unit_price DECIMAL(10,2) DEFAULT 0,
   amount DECIMAL(10,2) DEFAULT 0,remark TEXT,
   piece_meters JSON NULL,deduction_meters DECIMAL(12,2) DEFAULT 0,
   KEY idx_order_id(order_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  // Isolated rehearsal: old sandbox table predates business header columns.
  // Only additive changes within fixed P6 sandbox. Real production already has these fields.
  for(const [name,ddl] of Object.entries({
   style_no:"VARCHAR(100) DEFAULT ''",sign_person:"VARCHAR(100) DEFAULT ''",
   receiver:"VARCHAR(100) DEFAULT ''",receiver_phone:"VARCHAR(100) DEFAULT ''",
   receiver_address:"VARCHAR(500) DEFAULT ''",settled:'TINYINT(1) DEFAULT 0'
  })){
   const [col]=await db.query('SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',['orders',name]);
   if(rows(col).length===0)await db.query('ALTER TABLE orders ADD COLUMN '+name+' '+ddl);
  }
  if((await inspectV2DocumentDisplaySchema(db))==='legacy')for(const sql of getV2DocumentDisplaySchemaSql())await db.query(sql);
  assert.equal(await inspectV2DocumentDisplaySchema(db),'expanded');
  if((await inspectP1DCompatibility(db)).state==='legacy'){
   for(const sql of getP1DAdditiveMigrationSql())await db.query(sql);
  }
  if(await inspectP1D2Lines(db)==='legacy'){
   for(const sql of getP1D2LineMigrationSql())await db.query(sql);
  }
  assert.equal((await inspectP1DCompatibility(db)).state,'expanded');
  assert.equal(await inspectP1D2Lines(db),'expanded');
  for(const table of tables){
   const [count]=await db.query('SELECT COUNT(*) AS n FROM '+table);
   assert.equal(Number(rows(count)[0]?.n),0,'Sandbox must be initially empty: '+table);
  }
  seeded=true;
  await db.query("INSERT INTO company_config(id,company_name,address,phone,default_terms,deposit_terms) VALUES (1,'当前公司','当前地址','当前电话','当前样布条款','当前定金条款')");
  const [master]=await db.query("INSERT INTO pattern_masters(master_no) VALUES ('G088')");
  const [color]=await db.query('INSERT INTO pattern_colorways(master_id,colorway_no) VALUES (?,4)',[(master as {insertId:number}).insertId]);
  const [fabric]=await db.query("INSERT INTO v2_fabrics(fabric_no,fabric_name,composition,weight_value,weight_unit,width_value) VALUES ('FAB088','设计棉','棉/麻',120.00,'gsm',150.00)");
  const [product]=await db.query("INSERT INTO v2_products(pattern_colorway_id,fabric_id,product_no) VALUES (?,?,'G088FAB088')",[(color as {insertId:number}).insertId,(fabric as {insertId:number}).insertId]);
  const productId=String((product as {insertId:number}).insertId);
  const password='p6-checked-test-secret';
  const hash=await hashPassword(password);
  const identities:[string,'admin'|'sales',number,number][]=[
   ['p6admin','admin',1,1],['p6seller','sales',1,0],['p6other','sales',1,0],['p6catalog','sales',0,1]
  ];
  for(const [name,role,grant,productGrant] of identities)
   await db.query('INSERT INTO v2_access_users (username,username_normalized,display_name,password_hash,role,can_manage_own_orders,can_manage_products) VALUES (?,?,?,?,?,?,?)',
    [name,name,name,hash,role,grant,productGrant]);
  await db.query("INSERT INTO orders (id,order_no,order_date,receiving_unit,template_type) VALUES (71,'OLD-PRESERVE','2026-10-12','Old Customer','sample')");
  await db.query("INSERT INTO order_items (id,order_id,product_no,product_name,meters,unit_price,amount) VALUES (81,71,'OLDMAN','原始手工',5,15,75)");
  const [historic]=await db.query('SELECT * FROM order_items WHERE id=81');
  const history=JSON.stringify(historic);

  const app=express();
  app.use('/auth',createV2AccessRouter(db));
  app.use('/v2',createV2DocumentRouter(db));
  app.use('/v2/products',createV2ProductSafetyRouter(db));
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const addr=server.address();assert(addr&&typeof addr!=='string');
  const base='http://127.0.0.1:'+addr.port;
  async function call(path:string,method='GET',token?:string,body?:unknown){
   const response=await fetch(base+path,{method,headers:{
    ...(token?{Authorization:'Bearer '+token}:{}),
    ...(body!==undefined?{'Content-Type':'application/json'}:{})
   },...(body!==undefined?{body:JSON.stringify(body)}:{})});
   return {status:response.status,body:await response.json() as Record<string,unknown>};
  }
  async function login(username:string){
   const response=await call('/auth/login','POST',undefined,{username,password});
   assert.equal(response.status,200,'Login '+username);
   return String(response.body.token);
  }
  const admin=await login('p6admin'),seller=await login('p6seller'),other=await login('p6other'),catalog=await login('p6catalog');
  assert.equal((await call('/v2/documents/71')).status,401);
  assert.equal((await call('/v2/documents/71','GET',seller)).status,404);
  assert.equal((await call('/v2/documents/71','GET',admin)).status,200);
  const legacy=await call('/v2/documents/71','GET',admin);
  assert.equal(legacy.body.displaySnapshot,null,'Historical unknown company display must remain null');
  const make=(type:'sample'|'deposit'|'sales',suffix:string)=>({
   orderNo:'D-V2-'+suffix,date:'2026-10-12',receivingUnit:'Live Fixture '+suffix,type,deposit:type==='deposit'?25:20,
   items:[{selection:{productId},fields:type==='sales'?
    {meters:7,unitPrice:12.5,deductionMeters:0.5,pieceMeters:[3.5,3.5],remark:'keep'}:
    {meters:3,unitPrice:12.5,remark:'keep'}}]
  });
  const ids:string[]=[];
  const display={companyName:'歌朗设计2026',companyAddress:'绍兴柯桥',companyPhone:'0575-1234',terms:'已确认合同条款'};

  for(const t of ['sample','deposit','sales'] as const){
   const create=await call('/v2/documents','POST',seller,{...make(t,t),styleNo:'STYLE001',issuer:'销售甲',receiver:'客户签收甲',receiverPhone:'13800000000',receiverAddress:'上海静安',settled:t==='sample',displaySnapshot:display});
   assert.equal(create.status,201,'Create '+t+' '+JSON.stringify(create.body));
   const id=String(create.body.id);ids.push(id);
   assert.equal(create.body.type,t==='sales'?'bulk':t);
   assert.equal(create.body.totalAmount,t==='sales'?81.25:37.5);
   assert.equal(create.body.issuer,'销售甲');
   assert.equal(create.body.receiver,'客户签收甲');
   assert.equal(create.body.receiverPhone,'13800000000');
   assert.equal(create.body.receiverAddress,'上海静安');
   assert.equal(create.body.styleNo,'STYLE001');
   assert.equal(create.body.settled,t==='sample');
   assert.deepEqual(create.body.displaySnapshot,display);
   const createdLine=(create.body.items as Row[])[0];
   assert.equal(createdLine.productId,productId);
   assert.equal(createdLine.source,'catalog');
   assert.equal((createdLine.snapshot as Row).productNo,'G088FAB088');
   if(t==='sales'){
    assert.deepEqual(createdLine.pieceMeters,[3.5,3.5]);
    assert.equal(createdLine.deductionMeters,0.5);
    assert.equal(create.body.totalPieces,2);
   }
   const read=await call('/v2/documents/'+id,'GET',seller);
   assert.equal(read.status,200);
   assert.deepEqual(read.body.items,create.body.items,'round-trip stored line '+t);
   assert.equal((await call('/v2/documents/'+id,'GET',other)).status,404);
   assert.equal((await call('/v2/documents/'+id,'PATCH',other,{items:[],removeIds:[]})).status,404);
  }
  console.log('PASS P6-2 real MySQL HTTP create/read 3 templates, DB productId+snapshot, owner isolation, sales rolls');
  // P2-3b: count/page/stats require the exact server-owned scope.
  const otherCreated=await call('/v2/documents','POST',other,make('sample','other-owner'));
  assert.equal(otherCreated.status,201,JSON.stringify(otherCreated.body));
  assert.equal((await call('/v2/documents')).status,401);
  const sellerPage=await call('/v2/documents?limit=10&offset=0','GET',seller);
  assert.equal(sellerPage.status,200);
  assert.equal(sellerPage.body.total,3,'Only own orders for seller');
  assert.equal((sellerPage.body.items as Row[]).length,3);
  assert((sellerPage.body.items as Row[]).every(x=>x.ownerId!==null&&x.orderNo!=='OLD-PRESERVE'&&String(x.receivingUnit).startsWith('Live Fixture')));
  const otherPage=await call('/v2/documents?limit=10&offset=0','GET',other);
  assert.equal(otherPage.body.total,1);
  const adminPage=await call('/v2/documents?limit=20&offset=0','GET',admin);
  assert.equal(adminPage.body.total,5,'Admin sees all four owners + legacy ownerless');
  assert((adminPage.body.items as Row[]).some(x=>x.ownerId===null));
  const catalogPage=await call('/v2/documents','GET',catalog);
  assert.equal(catalogPage.body.total,0);
  const sellerStats=await call('/v2/documents/stats','GET',seller);
  assert.equal(sellerStats.status,200);
  assert.equal(sellerStats.body.orderCount,3);
  assert.equal(sellerStats.body.amountTotal,156.25);
  assert.equal((await call('/v2/documents/stats','GET',admin)).body.orderCount,5);
  assert.equal((await call('/v2/documents?limit=1000','GET',seller)).status,400);
  assert.equal((await call('/v2/documents/stats?ownerId=999','GET',seller)).status,400);
  console.log('PASS P2-3b SQL-scoped list/search/stats admin vs two sellers vs unknown owner');
  // Real InnoDB FK is the final concurrent deletion guard.
  assert.equal((await call('/v2/products/'+productId,'DELETE',seller)).status,403);
  assert.equal((await call('/v2/products/'+productId,'DELETE',catalog)).status,409);
  let fkDenied=false;
  try{await db.query('DELETE FROM v2_products WHERE id=?',[productId]);}
  catch(e){fkDenied=(e as {code?:string}).code==='ER_ROW_IS_REFERENCED_2';}
  assert(fkDenied,'InnoDB FK prevents referenced product delete even bypassing service');
  const [freeFabric]=await db.query("INSERT INTO v2_fabrics(fabric_no,fabric_name) VALUES ('FABFREE','无引用面料')");
  const [freeProduct]=await db.query("INSERT INTO v2_products(pattern_colorway_id,fabric_id,product_no) VALUES (?,?,'G088FREE')",[(color as {insertId:number}).insertId,(freeFabric as {insertId:number}).insertId]);
  const freeId=String((freeProduct as {insertId:number}).insertId);
  assert.equal((await call('/v2/products/'+freeId,'DELETE',catalog)).status,200);
  const [freeLeft]=await db.query('SELECT id FROM v2_products WHERE id=?',[freeId]);
  assert.equal(rows(freeLeft).length,0);
  console.log('PASS P6-5 owner grants, referenced FK/409 vs unused delete');
  const id=ids[0];
  // P6-4: both preview JSON and real binary Excel are generated from the
  // same owner-authorized persisted data and frozen company snapshot.
  assert.equal((await call('/v2/documents/'+ids[0]+'/print-model')).status,401);
  assert.equal((await call('/v2/documents/'+ids[0]+'/print-model','GET',other)).status,404);
  assert.equal((await call('/v2/documents/'+ids[0]+'/export.xlsx','GET',other)).status,404);
  const samplePrint=await call('/v2/documents/'+ids[0]+'/print-model','GET',seller);
  assert.equal(samplePrint.status,200,JSON.stringify(samplePrint.body));
  assert.equal(samplePrint.body.companyName,'歌朗设计2026');
  assert.equal((samplePrint.body.rows as string[][])[0][0],'G088FAB088');
  assert.equal((samplePrint.body.rows as string[][])[0][4],'120 gsm');
  const depositPrint=await call('/v2/documents/'+ids[1]+'/print-model','GET',seller);
  assert.equal(depositPrint.status,200);
  assert.match(String((depositPrint.body.summaries as Row[])[1].left),/定金金额：25%/);
  const salesPrint=await call('/v2/documents/'+ids[2]+'/print-model','GET',seller);
  assert.equal(salesPrint.status,200);
  assert.equal((salesPrint.body.rows as string[][])[0][13],'2');
  assert.equal((salesPrint.body.rows as string[][])[0][16],'¥12.50');
  async function excel(id:string,token:string){
   return fetch(base+'/v2/documents/'+id+'/export.xlsx',{headers:{Authorization:'Bearer '+token}});
  }
  const response=await excel(ids[0],seller);
  assert.equal(response.status,200);
  assert.match(String(response.headers.get('content-type')),/spreadsheetml/);
  const excelBook=new ExcelJS.Workbook();
  await excelBook.xlsx.load(Buffer.from(await response.arrayBuffer()));
  assert.equal(excelBook.worksheets[0].getCell('C1').value,'歌朗设计2026');
  assert.equal(excelBook.worksheets[0].getCell('E7').value,'120 gsm');
  const salesXlsx=await excel(ids[2],seller);
  assert.equal(salesXlsx.status,200);
  const salesBook=new ExcelJS.Workbook();await salesBook.xlsx.load(Buffer.from(await salesXlsx.arrayBuffer()));
  assert.equal(salesBook.worksheets[0].getCell('N7').value,'2');
  // Admin can access legacy ownerless orders; explicit null display snapshot
  // falls back to current company only, without rewriting history.
  const legacyPrint=await call('/v2/documents/71/print-model','GET',admin);
  assert.equal(legacyPrint.status,200);
  assert.equal(legacyPrint.body.companyName,'当前公司');
  console.log('PASS P6-4 V2 owner-scoped preview/Excel, frozen GSM/rolls/deposit, old-null fallback');
  const before=await call('/v2/documents/'+id,'GET',seller);
  const row=(before.body.items as Row[])[0];
  const originalHeader=before.body.displaySnapshot;
  const editedHeader=await call('/v2/documents/'+id,'PATCH',seller,{items:[{id:String(row.id),fields:{}}],removeIds:[],issuer:'销售乙',receiver:'新签收人',settled:false,displaySnapshot:{...display,terms:'此次修订条款'}});
  assert.equal(editedHeader.status,200,JSON.stringify(editedHeader.body));
  assert.equal(editedHeader.body.issuer,'销售乙');
  assert.equal(editedHeader.body.settled,false);
  assert.equal((editedHeader.body.displaySnapshot as Row).terms,'此次修订条款');
  const previousDepositHeader=await call('/v2/documents/'+ids[1],'GET',seller);
  assert.deepEqual(previousDepositHeader.body.displaySnapshot,originalHeader,'Editing one order must not rewrite a different historical header');
  const invalidHeader=await call('/v2/documents/'+id,'PATCH',seller,{items:[{id:String(row.id),fields:{meters:99}}],removeIds:[],receiverPhone:'X'.repeat(102)});
  assert.equal(invalidHeader.status,400,'Invalid header must not mutate line values');
  const afterInvalid=await call('/v2/documents/'+id,'GET',seller);
  assert.equal((afterInvalid.body.items as Row[])[0].meters,3);
  assert.equal(afterInvalid.body.issuer,'销售乙');
  await db.query("UPDATE v2_fabrics SET composition='已改变资料' WHERE id=?",[(fabric as {insertId:number}).insertId]);
  const snapshotAfterMaster=await call('/v2/documents/'+ids[1],'GET',seller);
  assert.deepEqual(snapshotAfterMaster.body.displaySnapshot,display,'Company display snapshot must remain frozen independent of product changes');
  const reread=await call('/v2/documents/'+id,'GET',seller);
  assert.equal(((reread.body.items as Row[])[0].snapshot as Row).composition,'棉/麻','Existing snapshots never refresh');
  const change=await call('/v2/documents/'+id,'PATCH',seller,{items:[
   {id:String(row.id),fields:{meters:4,unitPrice:12.5,remark:'edited'}}
  ],removeIds:[],deposit:5});
  assert.equal(change.status,200,JSON.stringify(change.body));
  assert.equal((change.body.items as Row[])[0].id,row.id,'ID stable after update');
  assert.equal(change.body.totalAmount,50);
  assert.equal(change.body.deposit,5);
  assert.equal(((change.body.items as Row[])[0].snapshot as Row).composition,'棉/麻');
  // Inactive products cannot be newly selected, but the old line can still be edited.
  const deactivated=await call('/v2/products/'+productId+'/deactivate','POST',catalog);
  assert.equal(deactivated.status,200,JSON.stringify(deactivated.body));
  assert.equal(deactivated.body.active,false);
  assert.equal((await call('/v2/products/'+productId,'DELETE',catalog)).status,409,'Inactive reference stays protected');
  const [priorCount]=await db.query('SELECT COUNT(*) AS n FROM orders');
  const failCreate=await call('/v2/documents','POST',seller,make('sample','inactive-new'));
  assert.equal(failCreate.status,422,'Inactive selection rejected even when client submits a valid ID');
  const [nextCount]=await db.query('SELECT COUNT(*) AS n FROM orders');
  assert.equal(Number(rows(nextCount)[0].n),Number(rows(priorCount)[0].n),'Failed create must roll back its new order header');
  const blocked=await call('/v2/documents/'+id,'PATCH',seller,{items:[
   {id:String(row.id),selection:{productId},fields:{meters:11}}
  ],removeIds:[]});
  assert.equal(blocked.status,422);
  const unchanged=await call('/v2/documents/'+id,'GET',seller);
  assert.equal(unchanged.body.totalAmount,50);
  assert.equal((unchanged.body.items as Row[])[0].meters,4,'Rejected whole patch rolled back');
  assert.equal((await call('/v2/documents/'+id,'PATCH',seller,{items:[
   {id:String(row.id),fields:{meters:6,unitPrice:12.5}}
  ],removeIds:[]})).status,200,'Already linked inactive product retained for business edit');
  assert.equal((await call('/v2/documents','POST',catalog,make('sample','invalid'))).status,403);
  // Active grant change must cancel previously minted HTTP bearer for writes.
  const [salesIds]=await db.query("SELECT id FROM v2_access_users WHERE username='p6seller'");
  await db.query('UPDATE v2_access_users SET can_manage_own_orders=0 WHERE id=?',[rows(salesIds)[0].id]);
  assert.equal((await call('/v2/documents','POST',seller,make('sample','nogrant'))).status,403);
  assert.equal((await call('/v2/documents/'+id,'PATCH',seller,{items:[{id:String(row.id),fields:{meters:2}}],removeIds:[]})).status,403);
  await db.query('UPDATE v2_access_users SET can_manage_own_orders=1 WHERE id=?',[rows(salesIds)[0].id]);
  // Successfully replace the product, preserving all unchanged business values.
  const [fabricB]=await db.query("INSERT INTO v2_fabrics(fabric_no,fabric_name,composition,weight_value,weight_unit,width_value) VALUES ('FAB089','替换丝棉','新成分',15.50,'mm',140.00)");
  const [productB]=await db.query("INSERT INTO v2_products(pattern_colorway_id,fabric_id,product_no) VALUES (?,?,'G088FAB089')",[(color as {insertId:number}).insertId,(fabricB as {insertId:number}).insertId]);
  const replacementId=String((productB as {insertId:number}).insertId);
  const replacement=await call('/v2/documents/'+id,'PATCH',seller,{items:[
   {id:String(row.id),selection:{productId:replacementId},fields:{}}
  ],removeIds:[]});
  assert.equal(replacement.status,200,JSON.stringify(replacement.body));
  assert.equal((replacement.body.items as Row[])[0].id,row.id);
  assert.equal((replacement.body.items as Row[])[0].productId,replacementId);
  assert.equal((replacement.body.items as Row[])[0].meters,6);
  assert.equal((replacement.body.items as Row[])[0].unitPrice,12.5);
  assert.equal((replacement.body.items as Row[])[0].amount,75);
  assert.equal(((replacement.body.items as Row[])[0].snapshot as Row).weightUnit,'mm');
  console.log('PASS P6-3 actual product replacement preserves line ID/amount/business fields');
  const manualCreate=await call('/v2/documents','POST',admin,{
   orderNo:'P6-MANUAL',date:'2026-10-12',receivingUnit:'Admin manual',type:'sample',deposit:0,
   items:[{manual:{productNo:'M088',productName:'临时手工',composition:'100%棉'},fields:{meters:2,unitPrice:15}}]
  });
  assert.equal(manualCreate.status,201,JSON.stringify(manualCreate.body));
  assert.equal((manualCreate.body.items as Row[])[0].source,'manual');
  assert.equal((manualCreate.body.items as Row[])[0].productId,null);
  const salesManual=await call('/v2/documents','POST',seller,{
   orderNo:'P6-SALESMANUAL',date:'2026-10-12',receivingUnit:'Invalid manual',type:'sample',deposit:0,
   items:[{manual:{productNo:'M088',productName:'业务员绕过'},fields:{meters:2,unitPrice:15}}]
  });
  assert.equal(salesManual.status,403);
  console.log('PASS P6-3 admin explicit manual source and sales manual escalation blocked');
  assert.equal((await call('/v2/documents/71','GET',admin)).status,200);
  const [historyAfter]=await db.query('SELECT * FROM order_items WHERE id=81');
  assert.equal(JSON.stringify(historyAfter),history,'Unowned legacy item untouched');
  console.log('PASS P6-3 replace/stable-id/old snapshot, inactive original, transaction rollback, live grants, history untouched');
  // P2-3b real cutover rehearsal: same live MySQL & accounts, but the new
  // strictly independent app has the deny gate BEFORE every old handler.
  // Neither this app nor V2 routes are mounted on production server.ts.
  const gateApp=express();let oldReached=0;
  gateApp.use(createLegacyCutoverGuard('deny_legacy'));
  gateApp.get('/api/health',(_req,res)=>res.json({status:'ok'}));
  gateApp.post('/api/login',(_req,res)=>{oldReached++;res.json({legacyToken:'leak'});});
  gateApp.get('/api/orders',(_req,res)=>{oldReached++;res.json({legacyOrders:'leak'});});
  gateApp.get('/api/export_template/:id',(_req,res)=>{oldReached++;res.json({legacyExcel:'leak'});});
  gateApp.get('/api/inventory/ledger',(_req,res)=>{oldReached++;res.json({legacyInventory:'leak'});});
  gateApp.post('/api/products/batch-delete',(_req,res)=>{oldReached++;res.json({deleted:true});});
  gateApp.get('/api/company',(_req,res)=>{oldReached++;res.json({companySecret:'leak'});});
  gateApp.get('/uploads/private.jpg',(_req,res)=>{oldReached++;res.send('image bytes');});
  gateApp.use('/api/v2/auth',createV2AccessRouter(db));
  gateApp.use('/api/v2',createV2DocumentRouter(db));
  const gateServer=await new Promise<ReturnType<typeof express.application.listen>>(resolve=>{
   const s=gateApp.listen(0,'127.0.0.1',()=>resolve(s));
  });
  try{
   const gateAddr=gateServer.address();assert(gateAddr&&typeof gateAddr!=='string');
   const url='http://127.0.0.1:'+gateAddr.port;
   async function check(path:string,method='GET',token?:string,body?:unknown){
    const res=await fetch(url+path,{method,headers:{
     ...(token?{Authorization:'Bearer '+token}:{}),
     ...(body!==undefined?{'Content-Type':'application/json'}:{})
    },...(body!==undefined?{body:JSON.stringify(body)}:{})});
    return {status:res.status,body:await res.json() as Record<string,unknown>};
   }
   for(const [method,path] of [
    ['GET','/api/orders'],['POST','/api/login'],['GET','/api/export_template/71'],
    ['GET','/api/inventory/ledger'],['POST','/api/products/batch-delete'],
    ['GET','/api/company'],['GET','/uploads/private.jpg']
   ]){
    assert.equal((await check(path,method,seller)).status,410,'No legacy bypass: '+method+' '+path);
   }
   assert.equal(oldReached,0,'No legacy handler may execute under cutover');
   assert.equal((await check('/api/health')).status,200);
   assert.equal((await check('/api/v2/documents')).status,401);
   assert.equal((await check('/api/v2/documents','GET','a'.repeat(64))).status,401);
   const v2Login=await check('/api/v2/auth/login','POST',undefined,{username:'p6seller',password});
   assert.equal(v2Login.status,200,'Only independently authenticated V2 credentials work');
   const freshBearer=String(v2Login.body.token);
   const own=await check('/api/v2/documents','GET',freshBearer);
   assert.equal(own.status,200);
   assert.equal(own.body.total,3);
   assert.equal((await check('/api/v2/documents/71','GET',freshBearer)).status,404);
   assert.equal((await check('/api/v2/documents/71','GET',admin)).status,200);
   assert.equal((await check('/api/v2/documents/'+ids[1]+'/print-model','GET',freshBearer)).status,200);
   console.log('PASS P2-3b actual MySQL and V2 login behind first-position deny_legacy gate; 7 old endpoints blocked');
  }finally{await new Promise<void>((resolve,reject)=>gateServer.close(err=>err?reject(err):resolve()));}
  console.log('P6_V2_DOCUMENTS_REAL_MYSQL_ISOLATED_PASS database='+DB);
 }finally{
  if(server)await new Promise<void>((resolve,reject)=>server!.close(e=>e?reject(e):resolve()));
  if(db){
   if(seeded){
    await db.query('DELETE FROM order_items');
    await db.query('DELETE FROM orders');
    await db.query('DELETE FROM company_config');
    for(const table of ['v2_access_sessions','v2_access_users','v2_product_image_assets','v2_products','pattern_master_tag_links',
     'pattern_colorway_tag_links','pattern_colorways','pattern_masters','v2_fabrics','shared_tags','image_assets'])
     await db.query('DELETE FROM '+table);
    for(const table of tables){
     const [raw]=await db.query('SELECT COUNT(*) AS n FROM '+table);
     assert.equal(Number(rows(raw)[0].n),0,'Cleanup incomplete '+table);
    }
    console.log('PASS P6-2/P6-3 isolated DB 0 business rows');
   }
   await db.end();
  }
  await bootstrap.end();
 }
}
void main().catch(e=>{console.error('P6-2/P6-3 sandbox error',e instanceof Error?e.stack:'unknown',e instanceof Error?(e as Error&{cause?:unknown}).cause:'');process.exitCode=1;});
