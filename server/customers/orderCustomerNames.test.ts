// AC-107, AC-118
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,admin,sales,key} from './service.testFixture';
import {createV2Document,readV2Document,updateV2Document} from '../order-v2/documents';
import {listScopedOrders,listMatchingOrderItems,summarizeMatchingOrderItems,statsScopedOrders,parseScopedOrderFilters} from '../order-v2/orderQueries';
import {buildV2DocumentPrintModel,buildV2DocumentWorkbook} from '../order-v2/print';
import {createV2DocumentRouter} from '../order-v2/documentRoutes';
import express from 'express';
import ExcelJS from 'exceljs';

test('revision check uses current reads even when an earlier customer lookup established an old transaction snapshot',async()=>{
 const f=documentsFixture();
 try{
  const original=await f.create('sample',39),tx=await f.pool.getConnection();
  let oldHeader!:[unknown,unknown],oldItems!:[unknown,unknown];
  await readV2Document({...tx,query:async(sql:string,args:unknown[]=[])=>{const result=await tx.query(sql,args);if(sql.startsWith('SELECT o.id,'))oldHeader=result;if(sql.startsWith('SELECT i.id,'))oldItems=result;return result;}},admin,original.id);
  // Model an already-established REPEATABLE READ snapshot: plain reads see
  // old rows, while locking reads see the last committed business changes.
  f.db.prepare('UPDATE orders SET order_no=? WHERE id=?').run('NEWER-COMMIT',original.id);
  const stale={...f.pool,getConnection:async()=>{const connection=await f.pool.getConnection();return {...connection,query:async(sql:string,args:unknown[]=[])=>{
   if(!sql.includes('FOR UPDATE')){
    if(sql.startsWith('SELECT o.id,'))return oldHeader;
    if(sql.startsWith('SELECT i.id,'))return oldItems;
   }
   return connection.query(sql,args);
  }};}};
  await assert.rejects(updateV2Document(stale,admin,original.id,{expectedRevision:original.revision,orderNo:'STALE-OVERWRITE',items:original.items.map(i=>({id:i.id,fields:{remark:'stale'}})),removeIds:[],customer:{customerId:original.customerLink!.customerId,expectedCustomerId:original.customerLink!.customerId,expectedLinkVersion:'1'}}),{status:409});
  assert.equal(f.db.prepare('SELECT order_no FROM orders WHERE id=?').get(original.id)!.order_no,'NEWER-COMMIT');
 }finally{f.db.close();}
});

test('saved document revision rejects stale edits with retained line IDs without partial writes for all types',async()=>{
 const f=documentsFixture();
 try{for(const [n,type] of (['sample','bulk','deposit'] as const).entries()){
  const original=await f.create(type,30+n),revision=(original as any).revision;
  assert.match(revision??'',/^[a-f0-9]{64}$/);
  const input={expectedRevision:revision,items:original.items.map(i=>({id:i.id,fields:{remark:'first save'}})),removeIds:[],orderNo:'UPDATED-'+n};
  const saved=await updateV2Document(f.pool,admin,original.id,input);
  assert.notEqual((saved as any).revision,revision);
  const before=await readV2Document(await f.pool.getConnection(),admin,original.id);
  await assert.rejects(updateV2Document(f.pool,admin,original.id,{...input,orderNo:'STALE',items:original.items.map(i=>({id:i.id,fields:{remark:'stale'}}))}),{status:409});
  assert.deepEqual(await readV2Document(await f.pool.getConnection(),admin,original.id),before);
  await assert.rejects(updateV2Document(f.pool,admin,original.id,{items:input.items,removeIds:[]}),{status:400});
 }}finally{f.db.close();}
});

function documentsFixture(){
 const f=fixture();
 f.db.function('JSON_LENGTH',(value:any)=>value==null?null:JSON.parse(String(value)).length);
 f.db.function('GREATEST',{varargs:true},(...values:any[])=>Math.max(...values.map(Number)));
 f.db.exec('ALTER TABLE v2_access_users ADD COLUMN can_manage_own_orders INTEGER DEFAULT 1;ALTER TABLE v2_access_users ADD COLUMN can_manage_products INTEGER DEFAULT 1;');
 for(const column of ['deposit','style_no','sign_person','receiver','receiver_phone','receiver_address','settled','v2_display_snapshot','total_meters','total_pieces','deduction_meters'])
  f.db.exec('ALTER TABLE orders ADD COLUMN '+column+' '+(['deposit','settled','total_meters','total_pieces','deduction_meters'].includes(column)?'NUMERIC DEFAULT 0':'TEXT'));
 f.db.exec('CREATE TABLE order_items(id INTEGER PRIMARY KEY AUTOINCREMENT,order_id INTEGER,meters NUMERIC,unit_price NUMERIC,remark TEXT,piece_meters TEXT,deduction_meters NUMERIC,v2_product_id INTEGER,v2_source_kind TEXT,v2_product_snapshot TEXT,product_no TEXT,product_name TEXT,color_no TEXT,composition TEXT,weight NUMERIC,width NUMERIC,amount NUMERIC DEFAULT 0);');
 const pool={...f.pool,getConnection:async()=>{const tx=await f.pool.getConnection();return {...tx,query:(sql:string,args:unknown[]=[])=>tx.query(sql.replaceAll("ESCAPE '\\\\'","ESCAPE '\\'"),args)};}};
 const create=async(type:'sample'|'bulk'|'deposit',n:number)=>createV2Document(pool,admin,{
  orderNo:'NAME-'+n,date:'2026-11-08',receivingUnit:'旧客户',type,deposit:0,
  customer:{profile:{displayName:'旧客户'+n},requestId:key(800+n)},
  items:[{manual:{productNo:'M1',productName:'历史面料'},fields:{meters:1,unitPrice:100,...(type==='bulk'?{pieceMeters:[1]}:{})}}],
 });
 return {...f,pool,create};
}

test('linked document detail, preview and Excel use renamed customer while stored snapshots remain intact for every type',async()=>{
 const f=documentsFixture();
 try{for(const [n,type] of (['sample','bulk','deposit'] as const).entries()){
  const original=await f.create(type,n),customerId=original.customerLink!.customerId!;
  await f.service.update(admin,customerId,{expectedRowVersion:'1',profile:{displayName:'新客户'+n}});
  const detail=await readV2Document(await f.pool.getConnection(),admin,original.id);
  assert.equal(detail.receivingUnit,'新客户'+n);
  assert.equal(detail.receivingUnitSnapshot,'旧客户'+n);
  assert.deepEqual(detail.items,original.items);
  const company={company_name:'公司',address:'地址',phone:'电话',default_terms:'',deposit_terms:''};
  assert(JSON.stringify(buildV2DocumentPrintModel(detail,company)).includes('新客户'+n));
  const workbook=buildV2DocumentWorkbook(detail,company);
  assert(JSON.stringify(workbook.worksheets[0].getSheetValues()).includes('新客户'+n));
  await updateV2Document(f.pool,admin,original.id,{expectedRevision:original.revision,items:original.items.map(item=>({id:item.id,fields:{remark:'仅改备注'}})),removeIds:[],receivingUnit:'伪造或陈旧名称',customer:{customerId,expectedCustomerId:customerId,expectedLinkVersion:'1'}});
  assert.equal(f.db.prepare('SELECT receiving_unit FROM orders WHERE id=?').get(original.id)!.receiving_unit,'旧客户'+n);
  await assert.rejects(readV2Document(await f.pool.getConnection(),sales,original.id),{status:404});
 }}finally{f.db.close();}
});

test('renamed customer has one name across document list, filters, matching totals and dashboard recent orders',async()=>{
 const f=documentsFixture();
 try{
  const original=await f.create('sample',1),customerId=original.customerLink!.customerId!;
  await f.service.update(admin,customerId,{expectedRowVersion:'1',profile:{displayName:'更新后的客户'}});
  const tx=await f.pool.getConnection(),db={customerProfilesEnabled:true,query:tx.query};
  const filters=parseScopedOrderFilters({customer:'更新后的客户'});
  const list=await listScopedOrders(db,admin,filters);
  assert.equal(list.total,1);assert.equal(list.items[0].receivingUnit,'更新后的客户');
  assert.equal((await listScopedOrders(db,admin,parseScopedOrderFilters({customer:'旧客户1'}))).total,0);
  assert.equal((await listMatchingOrderItems(db,admin,original.id,filters)).total,1);
  assert.equal((await summarizeMatchingOrderItems(db,admin,filters)).amountTotal,100);
  assert.equal((await statsScopedOrders(db,admin)).recentOrders[0].receivingUnit,'更新后的客户');
  assert.equal((await listScopedOrders(db,sales,filters)).total,0);
 }finally{f.db.close();}
});

test('deleted, archived or unlinked customers fall back to saved names without matching another customer by name',async()=>{
 const f=documentsFixture();
 try{
  const original=await f.create('sample',2),cid=original.customerLink!.customerId!;
  await f.service.update(admin,cid,{expectedRowVersion:'1',profile:{displayName:'已改名客户'}});
  await assert.rejects(f.service.delete(admin,cid,{expectedRowVersion:'2',confirm:true}),{status:409,code:'customer_has_documents'});
  // Compatibility only: seed an already-deleted historical customer.
  f.db.prepare("UPDATE customers SET profile_json=json_set(profile_json,'$.deletedAt','2026-10-20') WHERE id=?").run(cid);
  assert.equal((await readV2Document(await f.pool.getConnection(),admin,original.id)).receivingUnit,'旧客户2');
  await f.service.create(admin,{requestId:key(890),profile:{displayName:'已改名客户'}});
  const tx=await f.pool.getConnection(),db={customerProfilesEnabled:true,query:tx.query};
  assert.equal((await listScopedOrders(db,admin,parseScopedOrderFilters({customer:'已改名客户'}))).total,0);
  f.db.exec('UPDATE customers SET profile_json=json_remove(profile_json,\'$.deletedAt\'),archived_at=\'2026-11-08\' WHERE id='+cid);
  assert.equal((await readV2Document(tx,admin,original.id)).receivingUnit,'旧客户2');
  f.db.exec('DELETE FROM customer_order_links');
  assert.equal((await readV2Document(tx,admin,original.id)).receivingUnit,'旧客户2');
 }finally{f.db.close();}
});

test('actual document HTTP uses the renamed customer in suggestions, list, detail, print model and downloaded Excel',async()=>{
 const f=documentsFixture(),original=await f.create('sample',5),cid=original.customerLink!.customerId!;
 await f.service.update(admin,cid,{expectedRowVersion:'1',profile:{displayName:'HTTP更名后的客户'}});
 const tx=await f.pool.getConnection(),db={...f.pool,async query(sql:string,args:unknown[]=[]):Promise<[unknown,unknown]>{
  if(sql.includes('JOIN v2_access_users u'))return [[{user_id:1,username:'admin',display_name:'管理员',role:'admin',session_id:11}],[]];
  return tx.query(sql,args);
 }};
 const app=express();app.use('/api/v2',createV2DocumentRouter(db,{loadCurrentCompany:async()=>({company_name:'公司',address:'地址',phone:'电话',default_terms:'',deposit_terms:''})}));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 const address=server.address();assert(address&&typeof address!=='string');const base='http://127.0.0.1:'+address.port+'/api/v2/documents';
 const get=(path:string)=>fetch(base+path,{headers:{authorization:'Bearer '+'a'.repeat(64)}});
 try{
  assert.equal((await fetch(base)).status,401);
  const suggestions=await get('/customers?q='+encodeURIComponent('HTTP更名'));assert.equal(suggestions.status,200);assert.deepEqual(await suggestions.json(),{items:['HTTP更名后的客户']});
  assert.deepEqual(await(await get('/customers?q='+encodeURIComponent('旧客户5'))).json(),{items:[]});
  const list=await get('?customer='+encodeURIComponent('HTTP更名'));assert.equal(list.status,200);assert.equal((await list.json()).items[0].receivingUnit,'HTTP更名后的客户');
  assert.equal((await(await get('/'+original.id)).json()).receivingUnit,'HTTP更名后的客户');
  assert.equal((await(await get('/'+original.id+'/print-model')).json()).customerName,'HTTP更名后的客户');
  const excel=await get('/'+original.id+'/export.xlsx');assert.equal(excel.status,200);
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(Buffer.from(await excel.arrayBuffer()) as never);
  const headers={authorization:'Bearer '+'a'.repeat(64),'Content-Type':'application/json'};
  const body={expectedRevision:original.revision,items:original.items.map(i=>({id:i.id,fields:{remark:'HTTP fresh'}})),removeIds:[]};
  const patch=()=>fetch(base+'/'+original.id,{method:'PATCH',headers,body:JSON.stringify(body)});
  assert.equal((await patch()).status,200);
  assert.equal((await patch()).status,409);
  const after=await(await get('/'+original.id)).json();assert.equal(after.items[0].remark,'HTTP fresh');
  assert.notEqual(after.revision,original.revision);
  assert(JSON.stringify(workbook.worksheets[0].getSheetValues()).includes('HTTP更名后的客户'));
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));f.db.close();}
});
