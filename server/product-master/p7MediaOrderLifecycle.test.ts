import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import type {Server} from 'node:http';
import {hashSessionToken} from '../access/password';
import {createV2CatalogAssembly} from './v2CatalogAssembly';

/** P7-5b: real localhost HTTP/assembly/services, in-memory SQL state only.
 * No real DB, network targets (except loopback) or COS operation. */
type Row=Record<string,unknown>;
type Image={id:string;product_id:string;asset_id:string;role:string;sort_order:number;deleted_at:string|null};
type Asset={status:'ready'|'recycled';ref_count:number;recycled_at:string|null;purge_after:string|null};
const target='fabric_v2_test_20261014_p7_media_http',TOKEN='a'.repeat(64);
const shared='a1111111-1111-4111-8111-111111111111';
const unique='a2222222-2222-4222-8222-222222222222';
const rollbackImage='a3333333-3333-4333-8333-333333333333';
const empty=()=>({fabricDisplay:[] as string[],detail:[] as string[],aiEffect:[] as string[]});
const assets=[shared,unique,rollbackImage];

class Db{
 products:Row[]=[];images:Image[]=[];orders:Row[]=[];lines:Row[]=[];
 assets=new Map<string,Asset>(assets.map(id=>[id,{status:'ready',ref_count:0,recycled_at:null,purge_after:null}]));
 trace:{sql:string;params:unknown[]}[]=[];nextProduct=7;nextImg=1;nextOrder=40;nextLine=70;
 commits=0;rollbacks=0;releases=0;begins=0;
 failAfterAssetDecrement=false;fkProduct:string|null=null;
 async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>{
  this.trace.push({sql,params});
  const out=(x:unknown):[unknown,unknown]=>[x,[]];
  if(sql==='SELECT DATABASE() AS database_name, @@server_uuid AS server_uuid')
   return out([{database_name:target,server_uuid:'p7-local-only-instance'}]);
  if(sql.includes('JOIN v2_access_users')&&sql.includes('s.token_hash'))
   return out(params[0]===hashSessionToken(TOKEN)?[{user_id:'2',username:'sales',display_name:'Sales',
    role:'sales',can_manage_own_orders:1,can_manage_products:1,session_id:'9'}]:[]);
  if(sql.startsWith('SELECT id,role,is_active')&&sql.includes('FROM v2_access_users'))
   return out([{id:'2',role:'sales',is_active:1,can_manage_products:1,can_manage_own_orders:1}]);
  if(sql.startsWith('SELECT id FROM v2_access_sessions WHERE id=?'))return out([{id:'9'}]);
  if(sql.startsWith('SELECT')&&sql.includes('FROM pattern_colorways c JOIN pattern_masters m'))
   return out([{id:'12',master_id:'11',colorway_no:2,master_no:'G017',is_active:1,master_active:1}]);
  if(sql.startsWith('SELECT id,fabric_no,is_active FROM v2_fabrics WHERE id=?'))
   return out(['21','22','23'].includes(String(params[0]))?
    [{id:String(params[0]),fabric_no:'F0'+params[0],is_active:1}]:[]);
  if(sql.startsWith('INSERT INTO v2_products')){
   const [colorId,fabricId,productNo,remark,isActive,sampling]=params;
   if(this.products.some(p=>p.pattern_colorway_id===colorId&&p.fabric_id===fabricId))
    throw Object.assign(Error('simulated duplicate product'),{code:'ER_DUP_ENTRY'});
   const id=String(this.nextProduct++);
   this.products.push({id,pattern_colorway_id:String(colorId),fabric_id:String(fabricId),
    product_no:String(productNo),remark:String(remark),is_active:Number(isActive),
    is_available_for_sampling:Number(sampling),row_version:'1'});
   return out({insertId:id,affectedRows:1});
  }
  if(sql.startsWith('SELECT id,pattern_colorway_id,fabric_id,product_no,remark,is_active,is_available_for_sampling,row_version FROM v2_products WHERE id=?'))
   return out(this.products.filter(item=>item.id===String(params[0])));
  if(sql.startsWith('SELECT ')&&sql.includes('FROM v2_products p')){
   let items=this.products;
   if(sql.includes('p.id=?'))items=items.filter(p=>p.id===String(params[0]));
   return out(items.map(p=>({...p,master_no:'G017',colorway_no:2,fabric_no:'F0'+p.fabric_id,
    fabric_name:'丝质雪纺',composition:'70%S 30%C',weight_value:'16.00',weight_unit:'mm',
    width_value:'140.00',pattern_image_asset_id:null,
    master_active:1,colorway_active:1,fabric_active:1,product_active:p.is_active})));
  }
  if(sql.startsWith('SELECT')&&sql.includes('FROM v2_product_image_assets WHERE product_id=?'))
   return out(this.images.filter(img=>img.product_id===String(params[0])&&img.deleted_at===null));
  if(sql.startsWith('SELECT id,status,ref_count FROM image_assets WHERE id IN')){
   return out(params.map(id=>this.assets.get(String(id))?{id,...this.assets.get(String(id))}:null).filter(Boolean));
  }
  if(sql.startsWith('INSERT INTO v2_product_image_assets')){
   const [product_id,asset_id,role,sort_order]=params;
   this.images.push({id:String(this.nextImg++),product_id:String(product_id),asset_id:String(asset_id),
    role:String(role),sort_order:Number(sort_order),deleted_at:null});
   return out({insertId:String(this.nextImg-1),affectedRows:1});
  }
  if(sql.startsWith('UPDATE image_assets SET ref_count=ref_count+1')){
   const asset=this.assets.get(String(params[0]));
   if(!asset||asset.status!=='ready')return out({affectedRows:0});
   asset.ref_count++;return out({affectedRows:1});
  }
  if(sql.startsWith('UPDATE image_assets SET status=IF(ref_count=1')){
   const asset=this.assets.get(String(params[0]));
   if(!asset||asset.ref_count<=0)return out({affectedRows:0});
   asset.ref_count--;
   if(asset.ref_count===0){
    asset.status='recycled';asset.recycled_at='simulated-now';asset.purge_after='simulated-30-days';
   }
   if(this.failAfterAssetDecrement)throw Error('PRIVATE_IMAGE_LEDGER_FAILURE');
   return out({affectedRows:1});
  }
  if(sql.startsWith('UPDATE v2_product_image_assets SET deleted_at=')){
   const image=this.images.find(i=>i.id===String(params[0]));
   if(image)image.deleted_at='simulated-now';
   return out({affectedRows:image?1:0});
  }
  if(sql.startsWith('DELETE FROM v2_product_image_assets WHERE product_id=?')){
   const n=this.images.length;this.images=this.images.filter(i=>i.product_id!==String(params[0]));
   return out({affectedRows:n-this.images.length});
  }
  if(sql.startsWith('SELECT COUNT(*) AS total FROM order_items WHERE v2_product_id=?')){
   const total=this.lines.filter(i=>i.v2_product_id===String(params[0])).length;
   return out([{total}]);
  }
  if(sql.startsWith('DELETE FROM v2_products WHERE id=?')){
   if(this.fkProduct===String(params[0]))
    throw Object.assign(Error('PRIVATE_PRODUCT_FK'),{code:'ER_ROW_IS_REFERENCED_2'});
   const n=this.products.length;this.products=this.products.filter(p=>p.id!==String(params[0]));
   return out({affectedRows:n-this.products.length});
  }
  if(sql.startsWith('INSERT INTO orders')){
   const id=String(this.nextOrder++);
   this.orders.push({id,order_no:params[0],order_date:params[1],receiving_unit:params[2],
    template_type:params[3],deposit:params[4],created_by_user_id:params[5],
    style_no:params[6],sign_person:params[7],receiver:params[8],receiver_phone:params[9],
    receiver_address:params[10],settled:params[11],v2_display_snapshot:params[12],
    total_meters:0,total_pieces:0,total_amount:0,deduction_meters:0});
   return out({insertId:id});
  }
  if(sql.startsWith('SELECT id,created_by_user_id FROM orders WHERE id=?'))
   return out(this.orders.filter(o=>o.id===String(params[0]))
    .map(o=>({id:o.id,created_by_user_id:o.created_by_user_id})));
  if(sql.startsWith('SELECT id,order_id,v2_product_id,v2_source_kind'))
   return out(this.lines.filter(i=>i.order_id===String(params[0])));
  if(sql.startsWith('INSERT INTO order_items')){
   const id=String(this.nextLine++);
   this.lines.push({id,order_id:String(params[0]),meters:params[1],unit_price:params[2],
    remark:params[3],piece_meters:params[4],deduction_meters:params[5],
    v2_product_id:params[6],v2_source_kind:params[7],v2_product_snapshot:params[8],
    product_no:params[9],product_name:params[10],color_no:params[11],composition:params[12],
    weight:params[13],width:params[14],amount:0});
   return out({insertId:id});
  }
  if(sql.startsWith('SELECT template_type,deposit FROM orders WHERE id=?'))
   return out(this.orders.filter(o=>o.id===String(params[0])));
  if(sql.startsWith('SELECT id,meters,unit_price,amount,piece_meters,deduction_meters,v2_source_kind,v2_product_snapshot FROM order_items'))
   return out(this.lines.filter(i=>i.order_id===String(params[0])));
  if(sql.startsWith('UPDATE order_items SET amount=')){
   const item=this.lines.find(i=>i.id===String(params[1]));
   if(item)item.amount=params[0];
   return out({affectedRows:item?1:0});
  }
  if(sql.startsWith('UPDATE orders SET total_meters=')){
   const order=this.orders.find(o=>o.id===String(params[4]));
   if(order)Object.assign(order,{total_meters:params[0],total_pieces:params[1],
    total_amount:params[2],deduction_meters:params[3]});
   return out({affectedRows:order?1:0});
  }
  if(sql.startsWith('SELECT o.id,')&&sql.includes('FROM orders o WHERE o.id=?'))
   return out(this.orders.filter(o=>o.id===String(params[0])));
  if(sql.startsWith('SELECT i.id,i.order_id,')&&sql.includes('FROM order_items i WHERE i.order_id=?'))
   return out(this.lines.filter(i=>i.order_id===String(params[0])));
  throw Error('Unexpected P7-5b SQL '+sql.slice(0,110));
 }
 async getConnection(){
  const db=this;let original:ReturnType<typeof db.snapshot>|null=null;
  return {
   query:db.query.bind(db),
   async beginTransaction(){db.begins++;original=db.snapshot();},
   async commit(){db.commits++;original=null;},
   async rollback(){db.rollbacks++;if(original)db.restore(original);},
   release(){db.releases++;}
  };
 }
 snapshot(){return structuredClone({products:this.products,images:this.images,assets:this.assets,
   orders:this.orders,lines:this.lines});}
 restore(s:ReturnType<Db['snapshot']>){
  this.products=s.products;this.images=s.images;this.assets=s.assets;this.orders=s.orders;this.lines=s.lines;
 }
}
async function http(db:Db,run:(base:string)=>Promise<void>){
 const app=express();
 app.use('/api/v2',await createV2CatalogAssembly(db,db,{database:target,confirmation:'I_ACKNOWLEDGE_SANDBOX'}));
 const started:Server=await new Promise((resolve,reject)=>{
  const s=app.listen(0,'127.0.0.1',()=>resolve(s));s.on('error',reject);
 });
 try{const addr=started.address();assert(addr&&typeof addr!=='string');
  await run('http://127.0.0.1:'+addr.port+'/api/v2');
 }finally{await new Promise<void>((resolve,reject)=>started.close(e=>e?reject(e):resolve()));}
}
async function req(base:string,path:string,method='GET',body?:unknown){
 const response=await fetch(base+path,{method,headers:{
  authorization:'Bearer '+TOKEN,...(body===undefined?{}:{'content-type':'application/json'})
 },...(body===undefined?{}:{body:JSON.stringify(body)})});
 return {status:response.status,data:await response.json() as Row};
}
async function create(base:string,fabric:string,images:{fabricDisplay:string[];detail:string[];aiEffect:string[]}){
 const r=await req(base,'/products','POST',{patternColorwayId:'12',fabricId:fabric,images});
 assert.equal(r.status,201,'product created: '+JSON.stringify(r.data));
 return r.data;
}
const sample=(id:string)=>({orderNo:'P7-5B-'+id,date:'2026-10-14',type:'sample',
 receivingUnit:'演练客户',deposit:0,items:[{selection:{productId:id},fields:{meters:3,unitPrice:5}}]});

test('P7-5b unified HTTP: order-linked product blocks delete; removing unreferenced sharer retains asset and recycles only last unique ref',async()=>{
 const db=new Db();
 await http(db,async base=>{
  const first=await create(base,'21',{...empty(),fabricDisplay:[shared]});
  const second=await create(base,'22',{...empty(),detail:[shared],aiEffect:[unique]});
  assert.equal(db.assets.get(shared)?.ref_count,2);
  assert.equal(db.assets.get(unique)?.ref_count,1);
  const saved=await req(base,'/documents','POST',sample(String(first.id)));
  assert.equal(saved.status,201,'saved document '+JSON.stringify(saved.data));
  assert.equal(db.lines.length,1);
  assert.equal(db.lines[0].v2_product_id,first.id,'order writes actual product identity into shared simulated SQL state');
  const frozen=JSON.parse(String(db.lines[0].v2_product_snapshot)) as Row;
  assert.equal(frozen.productId,first.id);assert.equal(frozen.source,'catalog');
  const blockedStart=db.trace.length;
  const blocked=await req(base,'/products/'+first.id,'DELETE');
  assert.equal(blocked.status,409);
  assert(!db.trace.slice(blockedStart).some(c=>c.sql.startsWith('UPDATE image_assets')||
   c.sql.startsWith('DELETE FROM v2_product_image_assets')||c.sql.startsWith('DELETE FROM v2_products')),
   'referenced deletion must stop BEFORE touching the image ledger');
  assert.equal(db.assets.get(shared)?.ref_count,2,'blocked deletion leaves all shared refs');
  assert.equal(db.images.filter(x=>x.product_id===String(first.id)&&x.deleted_at===null).length,1);
  const before=db.trace.length;
  const removed=await req(base,'/products/'+second.id,'DELETE');
  assert.equal(removed.status,200);
  assert.equal(db.assets.get(shared)?.ref_count,1);
  assert.equal(db.assets.get(shared)?.status,'ready');
  assert.equal(db.assets.get(unique)?.ref_count,0);
  assert.equal(db.assets.get(unique)?.status,'recycled');
  assert.equal(db.assets.get(unique)?.purge_after,'simulated-30-days');
  assert(db.trace.slice(before).some(c=>c.sql.includes('DATE_ADD(NOW(), INTERVAL 30 DAY)')));
  const retained=await req(base,'/products/'+first.id);
  assert.equal(retained.status,200);
  assert.deepEqual((retained.data.images as Row).fabricDisplay,[shared]);
  assert(!db.trace.some(c=>c.sql.startsWith('DELETE FROM image_assets')));
 });
 assert.equal(db.products.length,1);
 assert.equal(db.orders.length,1);
 assert.equal(db.lines.length,1);
 assert.equal(db.rollbacks,1);
 assert(db.commits>=4);
 assert(db.releases>=db.begins);
});
test('P7-5b unified HTTP: late FK failure rolls back image deletion and asset ledger; retry recycles last reference',async()=>{
 const db=new Db();
 await http(db,async base=>{
  const product=await create(base,'23',{...empty(),fabricDisplay:[rollbackImage]});
  assert.equal(db.assets.get(rollbackImage)?.ref_count,1);
  const prior=structuredClone(db.snapshot()),commits=db.commits;
  db.fkProduct=String(product.id);
  const failed=await req(base,'/products/'+product.id,'DELETE');
  assert.equal(failed.status,409);
  assert.deepEqual(db.snapshot(),prior,'FK race restores all product/asset/link rows atomically');
  assert.equal(db.commits,commits);assert.equal(db.rollbacks,1);
  db.fkProduct=null;
  const deleted=await req(base,'/products/'+product.id,'DELETE');
  assert.equal(deleted.status,200);
  assert.equal(db.assets.get(rollbackImage)?.ref_count,0);
  assert.equal(db.assets.get(rollbackImage)?.status,'recycled');
  assert.equal(db.assets.get(rollbackImage)?.purge_after,'simulated-30-days');
 });
 assert.equal(db.products.length,0);assert.equal(db.images.length,0);
});
test('P7-5b unified HTTP: thrown asset ledger error after mutation must roll back product and shared ref',async()=>{
 const db=new Db();
 await http(db,async base=>{
  const p=await create(base,'23',{...empty(),fabricDisplay:[rollbackImage]});
  const before=structuredClone(db.snapshot()),commits=db.commits;
  db.failAfterAssetDecrement=true;
  const failure=await req(base,'/products/'+p.id,'DELETE');
  assert.equal(failure.status,503);
  assert(!JSON.stringify(failure.data).includes('PRIVATE_IMAGE_LEDGER_FAILURE'));
  assert.deepEqual(db.snapshot(),before,'decremented ledger, image link and product restored');
  assert.equal(db.commits,commits);
  assert.equal(db.rollbacks,1);
 });
});
