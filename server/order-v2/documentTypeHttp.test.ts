import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import ExcelJS from 'exceljs';
import {createV2DocumentRouter} from './documentRoutes';
import {hashSessionToken} from '../access/password';

type Row=Record<string,unknown>;
const bearer='f'.repeat(64);
/** Transactional SQL substitute for real HTTP/services/XLSX; never connects to MySQL. */
class MemoryDocumentDb{
 orders=new Map<string,Row>();items=new Map<string,Row[]>();rollbacks=0;
 async getConnection(){const db=this;let orders:Map<string,Row>,items:Map<string,Row[]>;return {
  query:db.query.bind(db),async beginTransaction(){orders=structuredClone(db.orders);items=structuredClone(db.items);},async commit(){},
  async rollback(){db.orders=orders;db.items=items;db.rollbacks++;},release(){}
 };}
 async query(sql:string,args:unknown[]=[]):Promise<[unknown,unknown]>{
  const reply=(value:unknown):[unknown,unknown]=>[value,[]];
  if(sql.includes('s.token_hash'))return reply(args[0]===hashSessionToken(bearer)?[{user_id:'1',session_id:'9',username:'admin',display_name:'测试管理员',role:'admin',can_manage_products:1,can_manage_own_orders:1}]:[]);
  if(sql.includes('FROM v2_access_users'))return reply([{id:'1',role:'admin',is_active:1,can_manage_products:1,can_manage_own_orders:1}]);
  if(sql.includes('FROM v2_access_sessions'))return reply([{id:'9'}]);
  if(sql.includes('FROM company_config'))return reply([{company_name:'当前公司',address:'地址',phone:'电话',default_terms:'当前条款',deposit_terms:'定金条款'}]);
  if(sql.startsWith('SELECT id,created_by_user_id,order_no FROM orders')){
   const row=this.orders.get(String(args[0]));return reply(row?[row]:[]);
  }
  if(sql.startsWith('SELECT id FROM orders WHERE order_no')){
   return reply([...this.orders.values()].filter(row=>row.order_no===args[0]).map(row=>({id:row.id})));
  }
  if(sql.startsWith('SELECT id FROM order_items WHERE order_id')){
   return reply((this.items.get(String(args[0]))??[]).map(item=>({id:item.id})));
  }
  if(sql.startsWith('INSERT INTO orders')&&sql.includes(' SELECT ')){
   const original=this.orders.get(String(args[3]));assert(original);
   const id=String(100+this.orders.size);
   this.orders.set(id,{...original,id,order_no:args[0],order_date:args[1],created_by_user_id:args[2]});
   this.items.set(id,[]);return reply({insertId:id,affectedRows:1});
  }
  if(sql.startsWith('INSERT INTO order_items')&&sql.includes(' SELECT ')){
   const id=String(args[0]),source=String(args[1]),sourceRows=this.items.get(source)??[];
   this.items.set(id,structuredClone(sourceRows).map((x,index)=>({...x,id:String(Number(id)*10+index+1),order_id:id})));
   return reply({affectedRows:sourceRows.length});
  }
  if(sql.startsWith('DELETE FROM order_items')){this.items.set(String(args[0]),[]);return reply({affectedRows:1});}
  if(sql.startsWith('DELETE FROM orders')){
   const deleted=this.orders.delete(String(args[0]));this.items.delete(String(args[0]));
   return reply({affectedRows:deleted?1:0});
  }
  if(sql.startsWith('INSERT INTO orders')){
   const id=String(100+this.orders.size);const columns=['order_no','order_date','receiving_unit','template_type','deposit','created_by_user_id','style_no','sign_person','receiver','receiver_phone','receiver_address','settled','v2_display_snapshot'];
   this.orders.set(id,{id,...Object.fromEntries(columns.map((name,i)=>[name,args[i]]))});this.items.set(id,[]);return reply({insertId:id,affectedRows:1});
  }
  if(sql.startsWith('INSERT INTO order_items')){
   const orderId=String(args[0]),rows=this.items.get(orderId)!;const id=String(Number(orderId)*10+rows.length+1);
   const columns=['order_id','meters','unit_price','remark','piece_meters','deduction_meters','v2_product_id','v2_source_kind','v2_product_snapshot','product_no','product_name','color_no','composition','weight','width'];
   rows.push({id,amount:0,...Object.fromEntries(columns.map((name,i)=>[name,args[i]]))});return reply({insertId:id,affectedRows:1});
  }
  if(sql.startsWith('SELECT id,created_by_user_id FROM orders')||sql.startsWith('SELECT template_type')||sql.startsWith('SELECT o.id,'))return reply(this.orders.has(String(args[0]))?[this.orders.get(String(args[0]))!]:[]);
  if(sql.includes('FROM order_items'))return reply(this.items.get(String(args[0]))??[]);
  if(sql.startsWith('UPDATE order_items SET amount=')){
   const row=[...this.items.values()].flat().find(x=>x.id===String(args[1]));assert(row);row.amount=args[0];return reply({affectedRows:1});
  }
  if(sql.startsWith('UPDATE orders SET ')){
   const id=String(args.at(-1)),row=this.orders.get(id);assert(row);
   const names=sql.split(' SET ')[1].split(' WHERE ')[0].split(',').map(s=>s.split('=')[0]);names.forEach((name,i)=>row[name]=args[i]);return reply({affectedRows:1});
  }
  throw Error('Unsupported test SQL '+sql);
 }
}
test('DOC-05/07 real private HTTP save, reread, patch, print and actual XLSX preserve type-specific money',async()=>{
 const db=new MemoryDocumentDb(),app=express();app.use('/api/v2',createV2DocumentRouter(db));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 const address=server.address();assert(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}/api/v2/documents`;
 const request=(path:string,method='GET',body?:unknown)=>fetch(base+path,{method,headers:{Authorization:'Bearer '+bearer,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 try{
  assert.equal((await fetch(base+'/100')).status,401);
  for(const type of ['sample','deposit','bulk'] as const){
   const response=await request('','POST',{orderNo:'TEST-'+type,date:'2026-10-17',receivingUnit:'测试客户',type,deposit:type==='deposit'?50:0,
    items:[{manual:{productNo:'M001',productName:'测试面料'},fields:{meters:0.01,unitPrice:1,...(type==='bulk'?{pieceMeters:[0.01],deductionMeters:0}:{})}}]});
   assert.equal(response.status,201);const saved=await response.json();assert.equal(saved.totalAmount,0.01);assert.equal(saved.totalPieces,type==='deposit'?0:1);
   const reread=await request('/'+saved.id);assert.deepEqual(await reread.json(),saved);
   const printable=await request('/'+saved.id+'/print-model');assert.equal(printable.status,200);const model=await printable.json();
   assert.match(model.summaries[1].right,type==='deposit'?/应收金额：¥0.00/:/¥0.01/);
   const xlsx=await request('/'+saved.id+'/export.xlsx');assert.equal(xlsx.status,200);
   const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(Buffer.from(await xlsx.arrayBuffer()));
   const values:string[]=[];workbook.worksheets[0].eachRow(row=>row.eachCell(c=>{if(typeof c.value==='string')values.push(c.value);}));
   assert(values.includes(model.summaries[1].right));
   const duplicate=await request('/'+saved.id+'/copy','POST',{orderNo:'COPY-'+type,date:'2026-10-17'});
   assert.equal(duplicate.status,422,'new copies cannot silently inherit manual mode');
   assert.equal((await request('/'+saved.id)).status,200);

   if(type==='sample'||type==='deposit'){
    const before=structuredClone(db.orders.get(saved.id));
    const bad=await request('/'+saved.id,'PATCH',{items:[{id:saved.items[0].id,fields:{}}],removeIds:[],...(type==='sample'?{deposit:1}:{settled:true})});
    assert.equal(bad.status,400);assert.deepEqual(db.orders.get(saved.id),before);
    // Emulate a pre-existing legacy field; a normal unrelated edit omits that field.
    const raw=db.orders.get(saved.id)!;const hidden=type==='sample'?'deposit':'settled',oldValue=type==='sample'?33:1;
    raw[hidden]=oldValue;const originalSnapshot=structuredClone(db.items.get(saved.id)![0].v2_product_snapshot);
    const edited=await request('/'+saved.id,'PATCH',{items:[{id:saved.items[0].id,fields:{}}],removeIds:[],issuer:'仅修改开单人',...(type==='sample'?{settled:true}:{deposit:50})});
    assert.equal(edited.status,200);assert.equal(db.orders.get(saved.id)![hidden],oldValue,'omitted historical fields survive normal edits');
    assert.equal(db.items.get(saved.id)![0].v2_product_snapshot,originalSnapshot);
    const normalized=await edited.json();assert.equal(type==='sample'?normalized.deposit:normalized.settled,type==='sample'?0:false);
   }
  }
  assert.equal(db.rollbacks,5);
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});

test('authorized print HTTP embeds current company raster in JSON and real XLSX with current signature captions',async()=>{
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPWsAAAAASUVORK5CYII=','base64');
 const db=new MemoryDocumentDb(),app=express();
 app.use('/api/v2',createV2DocumentRouter(db,{
  async loadCurrentCompany(){return {company_name:'当前图片公司',address:'地址',phone:'电话',default_terms:'当前条款',deposit_terms:'定金条款',issuer_label:'开票签名',receiver_label:'客户签名'};},
  async loadImages(){return {brand_logo:{body:png,mime:'image/png' as const}};}
 }));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const base='http://127.0.0.1:'+(server.address() as {port:number}).port+'/api/v2/documents';
 const headers={Authorization:'Bearer '+bearer,'Content-Type':'application/json'};
 try{
  const made=await fetch(base,{method:'POST',headers,body:JSON.stringify({orderNo:'OUTPUT-TEST',date:'2026-10-17',receivingUnit:'测试客户',type:'sample',deposit:0,items:[{manual:{productNo:'M001',productName:'测试'},fields:{meters:1,unitPrice:1}}]})});assert.equal(made.status,201);
  const saved=await made.json(),response=await fetch(base+'/'+saved.id+'/print-model',{headers}),model=await response.json();
  assert.equal(model.companyName,'当前图片公司');assert.equal(model.signatureLabels.issuer,'开票签名');assert.equal(model.companyImages.brand_logo,'data:image/png;base64,'+png.toString('base64'));
  const file=await fetch(base+'/'+saved.id+'/export.xlsx',{headers});assert.equal(file.status,200);const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(Buffer.from(await file.arrayBuffer()));assert(workbook.getImage(0));
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
