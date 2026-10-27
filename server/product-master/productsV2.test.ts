import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import type {Server} from 'node:http';
import type {AppPrincipal} from '../access/types';
import {hashSessionToken} from '../access/password';
import {createV2Product,createV2ProductsBatch,listV2Products,getV2Product,updateV2Product,deleteV2Product,V2ProductError} from './productsV2';
import {createV2ProductsRouter} from './productsV2Routes';
import {deleteUnusedV2Product,ProductMutationError} from './productProtection';
import {createV2ProductSafetyRouter} from './productSafetyRoutes';

const sales:AppPrincipal={userId:'2',sessionId:'9',username:'sales',displayName:'Sales',role:'sales',canManageProducts:true,canManageOwnOrders:false};
type P={id:string;pattern_colorway_id:string;fabric_id:string;product_no:string;remark:string;is_active:number;is_available_for_sampling:number;row_version:string};
type Img={id:string;product_id:string;asset_id:string;role:string;sort_order:number;deleted_at:string|null};
const fmt=(p:P)=>({...p,master_no:'G017',colorway_no:p.pattern_colorway_id==='13'?'3':'2',fabric_no:p.fabric_id==='21'?'F018':'F019',
 fabric_name:'雪纺',composition:'棉',weight_value:'90.000',weight_unit:'gsm',width_value:'145.00',
 master_active:1,colorway_active:1,fabric_active:1,pattern_image_asset_id:null});
class DB {
 products:P[]=[];images:Img[]=[];assets=new Map<string,{status:string;ref_count:number}>();
 cards:Record<string,any>[]=[];tokens:Record<string,any>[]=[];failCard=false;failRevoke=false;
 next=1;nextImage=1;hasOrder=false;grant=true;active=true;session=true;parentActive=true;
 failImage=false;fkFailure=false;unavailable=false;queries:string[]=[];rollbacks=0;commits=0;
 async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>{
  this.queries.push(sql);
  if(this.unavailable)throw Error('PRIVATE SQL DETAILS');
  if(sql.includes('JOIN v2_access_users')){
   if(params[0]!==hashSessionToken('a'.repeat(64))||!this.active||!this.session)return [[],[]];
   return [[{user_id:'2',username:'sales',display_name:'Sales',role:'sales',session_id:'9',can_manage_products:this.grant?1:0,can_manage_own_orders:0}],[]];
  }
  if(sql.includes('FROM v2_access_users'))return [this.active?[{id:'2',role:'sales',is_active:1,can_manage_products:this.grant?1:0}]:[],[]];
  if(sql.includes('FROM v2_access_sessions'))return [this.session?[{id:'9'}]:[],[]];
  if(sql.startsWith('SELECT id FROM pattern_colorways WHERE master_id=?'))return [[{id:'12'},{id:'13'}],[]];
  if(sql.includes('FROM pattern_masters WHERE id=?'))return [[{id:String(params[0]),master_no:'G017',is_active:1}],[]];
  if(sql.includes('SELECT c.id,c.card_no,c.master_id,c.fabric_id,c.deleted_at FROM sample_cards'))return [this.cards.filter(c=>c.id===String(params[0])),[]];
  if(sql.startsWith('SELECT master_id,fabric_id FROM sample_cards'))return [this.cards.filter(c=>c.id===String(params[0])),[]];
  if(sql.startsWith('SELECT')&&sql.includes('FROM sample_cards c'))return [this.cards.filter(c=>c.deleted_at==null&&c.master_id===String(params[0])&&c.fabric_id===String(params[1])).map(c=>({...c,master_no:'G017',fabric_no:c.fabric_id==='21'?'F018':'F019',fabric_name:'雪纺',composition:null,weight_value:null,weight_unit:null,width_value:null,token_hash:this.tokens.find(t=>t.card_id===c.id)?.token_hash})),[]];
  if(sql.startsWith('INSERT INTO sample_cards')){
   if(this.failCard)throw Error('synthetic card failure');
   const id=String(this.cards.length+1);this.cards.push({id,master_id:String(params[0]),fabric_id:String(params[1]),card_no:params[2],qr_payload:params[3],is_active:1,reprint_revision:'0',printed_revision:'0'});return [{insertId:id},[]];
  }
  if(sql.startsWith('INSERT INTO sample_card_tokens')){this.tokens.push({card_id:String(params[0]),token_hash:params[1]});return [{affectedRows:1},[]];}
  if(sql.startsWith('SELECT token_hash,revoked_at FROM sample_card_tokens'))return [this.tokens.filter(t=>t.card_id===String(params[0])),[]];
  if(sql.startsWith('UPDATE sample_card_tokens SET revoked_at=')){
   if(this.failRevoke)throw Error('synthetic revoke failure');
   this.tokens.find(t=>t.card_id===String(params[0]))!.revoked_at='now';return [{affectedRows:1},[]];
  }
  if(sql.startsWith('UPDATE sample_cards SET deleted_at=')){Object.assign(this.cards.find(c=>c.id===String(params[0]))!,{deleted_at:'now',is_active:0});return [{affectedRows:1},[]];}
  if(sql.startsWith('SELECT p.id FROM v2_products p JOIN pattern_colorways c'))return [this.products.filter(p=>p.fabric_id===String(params[1])).map(p=>({id:p.id})),[]];
  if(sql.startsWith('SELECT')&&sql.includes('FROM pattern_colorways c JOIN pattern_masters m')){
   return [['12','13'].includes(String(params[0]))?[{id:String(params[0]),master_id:'11',colorway_no:String(params[0])==='13'?'3':'2',master_no:'G017',is_active:this.parentActive?1:0,master_active:1}]:[],[]];
  }
  if(sql.startsWith('SELECT')&&sql.includes('FROM v2_fabrics WHERE id=?')){
   return [['21','22'].includes(String(params[0]))?[{id:String(params[0]),fabric_no:String(params[0])==='21'?'F018':'F019',is_active:this.parentActive?1:0}]:[],[]];
  }
  if(sql.startsWith('SELECT')&&sql.includes('FROM v2_products p JOIN')){
   let items=this.products.map(fmt);
   if(sql.includes('p.id=?'))items=items.filter(p=>p.id===String(params[0]));
   if(sql.includes('p.is_active=1'))items=items.filter(p=>p.is_active===1);
   if(sql.includes('LIMIT ? OFFSET ?'))items=items.slice(Number(params.at(-1)),Number(params.at(-1))+Number(params.at(-2)));
   return [items,[]];
  }
  if(sql.startsWith('SELECT')&&sql.includes('FROM v2_products WHERE pattern_colorway_id=? AND fabric_id=?'))
   return [this.products.filter(p=>p.pattern_colorway_id===String(params[0])&&p.fabric_id===String(params[1])).map(p=>({id:p.id})),[]];
  if(sql.startsWith('SELECT')&&sql.includes('FROM v2_products WHERE id=?'))
   return [structuredClone(this.products.filter(p=>p.id===String(params[0]))),[]];
  if(sql.startsWith('SELECT')&&sql.includes('FROM order_items'))
   return [[{total:this.hasOrder?1:0}],[]];
  if(sql.startsWith('INSERT INTO v2_products')){
   const [colorId,fabricId,no,remark,isActive,sampling]=params.map(String);
   if(this.products.some(p=>p.product_no===no||p.pattern_colorway_id===colorId&&p.fabric_id===fabricId))
    throw Object.assign(Error('private duplicate'),{code:'ER_DUP_ENTRY'});
   const row:P={id:String(this.next++),pattern_colorway_id:colorId,fabric_id:fabricId,product_no:no,remark,
    is_active:Number(isActive),is_available_for_sampling:Number(sampling),row_version:'1'};
   this.products.push(row);return [{insertId:row.id,affectedRows:1},[]];
  }
  if(sql.startsWith('UPDATE v2_products SET')){
   const [colorId,fabricId,no,remark,isActive,sampling,id,expectedVersion]=params.map(String);
   const item=this.products.find(x=>x.id===id&&x.row_version===expectedVersion);
   if(!item)return [{affectedRows:0},[]];
   if(this.products.some(p=>p!==item&&(p.product_no===no||p.pattern_colorway_id===colorId&&p.fabric_id===fabricId)))
    throw Object.assign(Error('private duplicate'),{code:'ER_DUP_ENTRY'});
   Object.assign(item,{pattern_colorway_id:colorId,fabric_id:fabricId,product_no:no,remark,is_active:Number(isActive),is_available_for_sampling:Number(sampling),
    row_version:String(BigInt(item.row_version)+1n)});
   return [{affectedRows:1},[]];
  }
  if(sql.startsWith('DELETE FROM v2_products WHERE')){
   if(this.fkFailure)throw Object.assign(Error('private FK'),{code:'ER_ROW_IS_REFERENCED_2'});
   const old=this.products.length;this.products=this.products.filter(x=>x.id!==String(params[0]));
   return [{affectedRows:old-this.products.length},[]];
  }
  if(sql.startsWith('SELECT')&&sql.includes('FROM v2_product_image_assets WHERE product_id IN'))
   return [this.images.filter(x=>params.map(String).includes(x.product_id)&&x.deleted_at===null),[]];
  if(sql.startsWith('SELECT')&&sql.includes('FROM v2_product_image_assets WHERE product_id=?'))
   return [this.images.filter(x=>x.product_id===String(params[0])&&(!sql.includes('deleted_at IS NULL')||x.deleted_at===null)),[]];
  if(sql.startsWith('SELECT')&&sql.includes('FROM image_assets WHERE id IN')){
   return [params.map(id=>this.assets.get(String(id))?{id:String(id),...this.assets.get(String(id))}:null).filter(Boolean),[]];
  }
  if(sql.startsWith('UPDATE v2_product_image_assets SET role=')){
   const [role,order,id]=params;Object.assign(this.images.find(x=>x.id===String(id))!,{role,sort_order:Number(order)});
   return [{affectedRows:1},[]];
  }
  if(sql.startsWith('UPDATE v2_product_image_assets SET deleted_at=')){
   this.images.find(x=>x.id===String(params[0]))!.deleted_at='now';return [{affectedRows:1},[]];
  }
  if(sql.startsWith('DELETE FROM v2_product_image_assets WHERE product_id=?')){
   this.images=this.images.filter(x=>x.product_id!==String(params[0]));return [{affectedRows:1},[]];
  }
  if(sql.startsWith('INSERT INTO v2_product_image_assets')){
   if(this.failImage)throw Error('PRIVATE IMAGE SQL ERROR');
   const [product_id,asset_id,role,sort_order]=params.map(String);
   this.images.push({id:String(this.nextImage++),product_id,asset_id,role,sort_order:Number(sort_order),deleted_at:null});
   return [{affectedRows:1},[]];
  }
  if(sql.startsWith('UPDATE image_assets SET ref_count=ref_count+1')){
   this.assets.get(String(params[0]))!.ref_count+=1;return [{affectedRows:1},[]];
  }
  if(sql.startsWith('UPDATE image_assets SET status=IF(ref_count=1')){
   const asset=this.assets.get(String(params[0]))!;asset.ref_count-=1;
   if(asset.ref_count===0)asset.status='recycled';return [{affectedRows:1},[]];
  }
  if(sql.startsWith('INSERT INTO business_delete_events'))return [{affectedRows:1},[]];
  throw Error('Unknown SQL '+sql);
 }
 async getConnection(){
  const old={products:structuredClone(this.products),images:structuredClone(this.images),
   assets:structuredClone(this.assets),cards:structuredClone(this.cards),tokens:structuredClone(this.tokens)};
  return {query:this.query.bind(this),beginTransaction:async()=>{},
   commit:async()=>{this.commits++;},rollback:async()=>{this.rollbacks++;this.products=old.products;this.images=old.images;this.assets=old.assets;this.cards=old.cards;this.tokens=old.tokens;},
   release:()=>{}};
 }
}
const status=(code:number)=>(e:unknown)=>e instanceof V2ProductError&&e.status===code;
const newInput={patternColorwayId:'12',fabricId:'21',remark:'细腻'};
test('automatic cards: first product creates a card, sibling colorways reuse it and other fabrics get their own',async()=>{
 const db=new DB();await createV2Product(db,sales,newInput);
 assert.equal(db.cards.length,1);const qr=db.cards[0].qr_payload;
 await createV2Product(db,sales,{...newInput,patternColorwayId:'13'});
 assert.equal(db.cards.length,1);assert.equal(db.cards[0].qr_payload,qr);
 await createV2Product(db,sales,{...newInput,fabricId:'22'});assert.equal(db.cards.length,2);
});
test('automatic cards: batch and duplicate batch reuse the same card; card failure rolls back products',async()=>{
 const db=new DB();await createV2ProductsBatch(db,sales,{colorwayIds:['12','13'],fabricId:'21'});
 assert.equal(db.cards.length,1);await createV2ProductsBatch(db,sales,{colorwayIds:['12','13'],fabricId:'21'});assert.equal(db.cards.length,1);
 const broken=new DB();broken.failCard=true;await assert.rejects(createV2Product(broken,sales,newInput),/card failure/);
 assert.equal(broken.products.length,0);assert.equal(broken.cards.length,0);
 await assert.rejects(createV2ProductsBatch(broken,sales,{colorwayIds:['12','13'],fabricId:'21'}),/card failure/);assert.equal(broken.products.length,0);
});
test('automatic cards: last product retires card and QR, rebuild creates a new identity; partial deletion preserves card',async()=>{
 const db=new DB(),one=await createV2Product(db,sales,newInput),two=await createV2Product(db,sales,{...newInput,patternColorwayId:'13'});
 const original={...db.cards[0]};await deleteV2Product(db,sales,one.id);assert.equal(db.cards[0].deleted_at,undefined);
 await deleteV2Product(db,sales,two.id);assert(db.cards[0].deleted_at);assert(db.tokens[0].revoked_at);
 await createV2Product(db,sales,newInput);assert.equal(db.cards.length,2);assert.notEqual(db.cards[1].qr_payload,original.qr_payload);assert.notEqual(db.cards[1].id,original.id);
});
test('automatic cards: retiring failure rolls back deletion, card and media; ordered product remains protected',async()=>{
 const db=new DB(),one=await createV2Product(db,sales,newInput);db.hasOrder=true;
 await assert.rejects(deleteV2Product(db,sales,one.id),status(409));assert.equal(db.cards[0].deleted_at,undefined);
 db.hasOrder=false;db.failRevoke=true;await assert.rejects(deleteV2Product(db,sales,one.id),/revoke failure/);
 assert.equal(db.products.length,1);assert.equal(db.cards[0].deleted_at,undefined);assert.equal(db.tokens[0].revoked_at,undefined);
});
test('automatic cards: identity edits create target card and retire empty source, ordinary edits keep the QR',async()=>{
 const db=new DB(),one=await createV2Product(db,sales,newInput),qr=db.cards[0]?.qr_payload;
 await updateV2Product(db,sales,one.id,{expectedRowVersion:'1',remark:'updated'});assert.equal(db.cards[0]?.qr_payload,qr);
 await updateV2Product(db,sales,one.id,{expectedRowVersion:'2',fabricId:'22'});
 assert.equal(db.cards.length,2);assert(db.cards[0].deleted_at);assert.equal(db.cards[1].fabric_id,'22');
});
test('automatic cards lock sibling colorways before shared media to avoid a colorway-image lock cycle',async()=>{
 const db=new DB(),asset='a1111111-1111-4111-8111-111111111111';db.assets.set(asset,{status:'ready',ref_count:0});
 const one=await createV2Product(db,sales,{...newInput,images:{fabricDisplay:[asset],detail:[],aiEffect:[]}});
 db.queries=[];await updateV2Product(db,sales,one.id,{expectedRowVersion:'1',images:{fabricDisplay:[],detail:[],aiEffect:[]}});
 const siblings=db.queries.findIndex(q=>q.startsWith('SELECT id FROM pattern_colorways WHERE master_id=?'));
 assert(siblings>=0);assert(siblings<db.queries.findIndex(q=>q.includes('FROM image_assets WHERE id IN')));
});
test('P3-4 create derives immutable productNo from colorway identity plus fabric, not card number',async()=>{
 const db=new DB();
 const item=await createV2Product(db,sales,newInput);
 assert.equal(item.productNo,'G017-2-F018');assert.equal(item.patternColorwayId,'12');
 assert.equal(item.rowVersion,'1');assert.equal(item.fabricName,'雪纺');
 assert.deepEqual(item.images,{fabricDisplay:[],detail:[],aiEffect:[]});
 assert.equal((await listV2Products(db)).length,1);
 await assert.rejects(createV2Product(db,sales,newInput),status(409));
 assert.equal(db.products.length,1);
});
test('batch creates one independent blank-image product per selected colorway and skips existing combos',async()=>{
 const db=new DB();
 const first=await createV2ProductsBatch(db,sales,{colorwayIds:['12','13'],fabricId:'21'});
 assert.equal(first.created.length,2);assert.equal(first.skipped.length,0);
 assert(first.created.every(x=>x.productNo.includes('-F018')));
 assert(db.products.every(x=>x.is_available_for_sampling===1));
 assert.equal(db.images.length,0);
 const again=await createV2ProductsBatch(db,sales,{colorwayIds:['12','13'],fabricId:'21'});
 assert.equal(again.created.length,0);assert.equal(again.skipped.length,2);
 assert.equal(db.products.length,2);
});
test('batch enforces unique colorway IDs, one fabric, max 20 and no image copying',async()=>{
 const db=new DB();
 for(const input of [{colorwayIds:[],fabricId:'21'},{colorwayIds:['12','12'],fabricId:'21'},
  {colorwayIds:Array.from({length:21},(_,i)=>String(i+12)),fabricId:'21'},
  {colorwayIds:['12'],fabricId:'21',images:{fabricDisplay:[],detail:[],aiEffect:[]}},
  {colorwayIds:['12'],fabricId:'none'}])await assert.rejects(createV2ProductsBatch(db,sales,input),status(400));
 assert.equal(db.products.length,0);
});
test('P3-4 rejects forged productNo, version, malformed IDs and unknown fields before transaction',async()=>{
 const db=new DB();
 for(const body of [{...newInput,productNo:'FAKE'}, {...newInput,id:'15'}, {...newInput,rowVersion:'99'},
  {...newInput,patternColorwayId:'0'},{...newInput,fabricId:'A1'}, {fabricId:'21'}, {...newInput,remark:99},
  {...newInput,isActive:'false'}, {...newInput,images:{fabricDisplay:['not-uuid']}},null])
  await assert.rejects(createV2Product(db,sales,body),status(400));
 assert.equal(db.queries.length,0);
});
test('LITE product availability and disabled writes are no longer configurable',async()=>{
 const db=new DB(),made=await createV2Product(db,sales,newInput);
 for(const patch of [{isAvailableForSampling:false},{isActive:false}])await assert.rejects(updateV2Product(db,sales,made.id,{expectedRowVersion:made.rowVersion,...patch}),status(400));
 for(const raw of [false,'no',0,null])await assert.rejects(createV2Product(db,sales,{...newInput,isAvailableForSampling:raw}),status(400));
 assert.equal(made.isActive,true);assert.equal(made.isAvailableForSampling,true);
});
test('P3-4 refuses inactive selection and absent colorway/fabric',async()=>{
 const db=new DB();db.parentActive=false;
 await assert.rejects(createV2Product(db,sales,newInput),status(409));
 db.parentActive=true;
 await assert.rejects(createV2Product(db,sales,{...newInput,patternColorwayId:'99'}),status(404));
 await assert.rejects(createV2Product(db,sales,{...newInput,fabricId:'99'}),status(404));
});
test('P3-4 optimistic version prevents stale edits; used product identity cannot change',async()=>{
 const db=new DB();const item=await createV2Product(db,sales,newInput);
 const edited=await updateV2Product(db,sales,item.id,{expectedRowVersion:'1',remark:'改进'});
 assert.equal(edited.rowVersion,'2');assert.equal(edited.remark,'改进');
 await assert.rejects(updateV2Product(db,sales,item.id,{expectedRowVersion:'1',remark:'旧草稿'}),status(409));
 db.hasOrder=true;
 await assert.rejects(updateV2Product(db,sales,item.id,{expectedRowVersion:'2',fabricId:'22'}),status(409));
 await assert.rejects(updateV2Product(db,sales,item.id,{expectedRowVersion:'2',isActive:false}),status(400));
 db.products[0].is_active=0;
 assert.equal((await listV2Products(db)).length,0);
 assert.equal((await listV2Products(db,{includeInactive:true})).length,1);
 await assert.rejects(deleteV2Product(db,sales,item.id),status(409));
});
test('P3-4 unused product may switch fabric/colorway combo, catches duplicate after DB UNIQUE',async()=>{
 const db=new DB();const first=await createV2Product(db,sales,newInput);
 const swapped=await updateV2Product(db,sales,first.id,{expectedRowVersion:'1',fabricId:'22'});
 assert.equal(swapped.productNo,'G017-2-F019');
 const other=await createV2Product(db,sales,newInput);
 await assert.rejects(updateV2Product(db,sales,other.id,{expectedRowVersion:'1',fabricId:'22'}),status(409));
 assert.equal(db.products.length,2);
});
test('P3-4 list fetches product images in one batch query per page (not N+1)',async()=>{
 const db=new DB();
 const first=await createV2Product(db,sales,newInput);
 const second=await createV2Product(db,sales,{...newInput,fabricId:'22'});
 assert(first.id!==second.id);
 const before=db.queries.length;
 const all=await listV2Products(db);
 assert.equal(all.length,2);
 const statements=db.queries.slice(before);
 assert.equal(statements.filter(sql=>sql.includes('FROM v2_product_image_assets')).length,1);
 assert(statements.some(sql=>sql.includes('WHERE product_id IN (?,?)')));
});
test('P3-4 ordered product with attached assets cannot be hard deleted or detach any asset',async()=>{
 const db=new DB(),a='a1111111-1111-4111-8111-111111111111';
 db.assets.set(a,{status:'ready',ref_count:0});
 const item=await createV2Product(db,sales,{...newInput,images:{fabricDisplay:[a],detail:[],aiEffect:[]}});
 db.hasOrder=true;
 const before=db.queries.length;
 await assert.rejects(deleteV2Product(db,sales,item.id),status(409));
 assert.equal(db.images.filter(x=>x.deleted_at===null).length,1);
 assert.equal(db.assets.get(a)?.ref_count,1);
 assert(!db.queries.slice(before).some(sql=>sql.startsWith('DELETE FROM v2_product_image_assets')));
});
test('P3-4 image layouts 3 categories <=10, no duplicate assets, transactional lifecycle and reuse',async()=>{
 const db=new DB();
 const asset='a1111111-1111-4111-8111-111111111111';
 const asset2='a2222222-2222-4222-8222-222222222222';
 db.assets.set(asset,{status:'ready',ref_count:0});db.assets.set(asset2,{status:'ready',ref_count:1});
 const item=await createV2Product(db,sales,{...newInput,images:{fabricDisplay:[asset],detail:[asset2],aiEffect:[]}});
 assert.deepEqual(item.images.fabricDisplay,[asset]);
 assert.equal(db.assets.get(asset)?.ref_count,1);assert.equal(db.assets.get(asset2)?.ref_count,2);
 assert.equal((await getV2Product(db,item.id)).images.detail[0],asset2);
 const replaced=await updateV2Product(db,sales,item.id,{expectedRowVersion:'1',
  images:{fabricDisplay:[],detail:[asset2],aiEffect:[]}});
 assert.deepEqual(replaced.images.fabricDisplay,[]);
 assert.equal(db.assets.get(asset)?.ref_count,0);assert.equal(db.assets.get(asset)?.status,'recycled');
 assert.equal(db.assets.get(asset2)?.ref_count,2);
 assert(!db.queries.some(sql=>sql.startsWith('DELETE FROM image_assets')));
 await assert.rejects(updateV2Product(db,sales,item.id,{expectedRowVersion:'2',
  images:{fabricDisplay:[asset2],detail:[asset2],aiEffect:[]}}),status(400));
});
test('P3-4 image invalid/oversized/recycled and mid-batch failure roll everything back',async()=>{
 const db=new DB();const a='a1111111-1111-4111-8111-111111111111';
 db.assets.set(a,{status:'ready',ref_count:0});
 const i=await createV2Product(db,sales,newInput);
 await assert.rejects(updateV2Product(db,sales,i.id,{expectedRowVersion:'1',
  images:{fabricDisplay:Array.from({length:11},()=>a),detail:[],aiEffect:[]}}),status(400));
 db.failImage=true;
 await assert.rejects(updateV2Product(db,sales,i.id,{expectedRowVersion:'1',
  images:{fabricDisplay:[a],detail:[],aiEffect:[]}}));
 assert.equal(db.products[0].row_version,'1');assert.equal(db.assets.get(a)?.ref_count,0);
});
test('P3-4 delete unused product clears only associations, adjusts ref counts, not assets',async()=>{
 const db=new DB();const a='a1111111-1111-4111-8111-111111111111';
 db.assets.set(a,{status:'ready',ref_count:1});
 const i=await createV2Product(db,sales,{...newInput,images:{fabricDisplay:[a],detail:[],aiEffect:[]}});
 assert.equal(db.assets.get(a)?.ref_count,2);
 assert.deepEqual(await deleteV2Product(db,sales,i.id),{id:i.id,deleted:true});
 assert.equal(db.products.length,0);assert.equal(db.images.length,0);
 assert.equal(db.assets.get(a)?.ref_count,1);
 db.fkFailure=true;
 const next=await createV2Product(db,sales,newInput);
 await assert.rejects(deleteV2Product(db,sales,next.id),status(409));
});
test('P7-2 both delete entrypoints use same ledger-safe algorithm with shared and last image refs',async()=>{
 const db=new DB(),a='a1111111-1111-4111-8111-111111111111';
 db.assets.set(a,{status:'ready',ref_count:0});
 const first=await createV2Product(db,sales,{...newInput,images:{fabricDisplay:[a],detail:[],aiEffect:[]}});
 const second=await createV2Product(db,sales,{...newInput,fabricId:'22',
  images:{fabricDisplay:[],detail:[a],aiEffect:[]}});
 assert.equal(db.assets.get(a)?.ref_count,2);
 assert.deepEqual(await deleteUnusedV2Product(db,sales,first.id),{id:first.id,deleted:true});
 assert.equal(db.assets.get(a)?.ref_count,1);
 assert.equal(db.assets.get(a)?.status,'ready','shared image must not be recycled');
 assert.equal(db.images.filter(x=>x.product_id===second.id).length,1);
 assert.equal(db.images.filter(x=>x.product_id===first.id).length,0);
 assert.deepEqual(await deleteV2Product(db,sales,second.id),{id:second.id,deleted:true});
 assert.equal(db.assets.get(a)?.ref_count,0);
 assert.equal(db.assets.get(a)?.status,'recycled','last image reference moves to delayed recycle');
 assert(!db.queries.some(q=>q.startsWith('DELETE FROM image_assets')));
});
test('P7-2 old safety delete rejects ordered product before any shared-image ledger update',async()=>{
 const db=new DB(),a='a2222222-2222-4222-8222-222222222222';
 db.assets.set(a,{status:'ready',ref_count:0});
 const i=await createV2Product(db,sales,{...newInput,images:{fabricDisplay:[a],detail:[],aiEffect:[]}});
 db.hasOrder=true;
 const before=db.queries.length;
 await assert.rejects(deleteUnusedV2Product(db,sales,i.id),
  (error:unknown)=>error instanceof ProductMutationError&&error.status===409);
 assert(db.products.some(p=>p.id===i.id));
 assert.equal(db.assets.get(a)?.ref_count,1);
 assert(!db.queries.slice(before).some(q=>q.startsWith('UPDATE image_assets')));
});
test('P7-2 failed product FK deletion rolls back detached image refs from both entries',async()=>{
 const db=new DB(),a='a3333333-3333-4333-8333-333333333333';
 db.assets.set(a,{status:'ready',ref_count:0});
 const i=await createV2Product(db,sales,{...newInput,images:{fabricDisplay:[a],detail:[],aiEffect:[]}});
 const beforeRollback=db.rollbacks;
 db.fkFailure=true;
 await assert.rejects(deleteUnusedV2Product(db,sales,i.id),
  (error:unknown)=>error instanceof ProductMutationError&&error.status===409);
 assert.equal(db.rollbacks,beforeRollback+1);
 assert(db.products.some(p=>p.id===i.id));
 assert.equal(db.images.filter(x=>x.product_id===i.id).length,1);
 assert.deepEqual(db.assets.get(a),{status:'ready',ref_count:1});
});
test('P3-4 permission/session revocation and missing IDs fail closed, no silent SQL errors',async()=>{
 const db=new DB();
 for(const field of ['session','active'] as const){
  db[field]=false;await assert.rejects(createV2Product(db,sales,newInput),status(401));db[field]=true;
 }
 db.grant=false;
 assert.equal((await createV2Product(db,sales,newInput)).isActive,true);
 db.grant=true;
 await assert.rejects(getV2Product(db,'55'),status(404));
 for(const id of ['0','01','notid','18446744073709551616'])
  await assert.rejects(deleteV2Product(db,sales,id),status(400));
});
async function server(db:DB,fn:(base:string)=>Promise<void>,mode:'catalog'|'safety'='catalog'){
 const app=express();
 if(mode==='safety')app.use('/api/v2/products',createV2ProductSafetyRouter(db));
 else app.use('/api/v2',createV2ProductsRouter(db,db));
 const s:Server=await new Promise((resolve,reject)=>{const srv=app.listen(0,'127.0.0.1',()=>resolve(srv));srv.once('error',reject);});
 try{const a=s.address();assert(a&&typeof a!=='string');await fn('http://127.0.0.1:'+a.port+'/api/v2');}
 finally{await new Promise<void>((resolve,reject)=>s.close(e=>e?reject(e):resolve()));}
}
function call(base:string,path:string,method='GET',body?:unknown,auth=true){
 return fetch(base+path,{method,headers:{...(auth?{authorization:'Bearer '+'a'.repeat(64)}:{}),
  ...(body===undefined?{}:{'content-type':'application/json'})},
  ...(body===undefined?{}:{body:JSON.stringify(body)})});
}
test('P7-2 HTTP DELETE on catalog and compatibility safety router has identical safe image results',async()=>{
 const a='a4444444-4444-4444-8444-444444444444';
 for(const kind of ['catalog','safety'] as const){
  const db=new DB();
  db.assets.set(a,{status:'ready',ref_count:1}); // shared from another owner
  const product=await createV2Product(db,sales,{...newInput,
   images:{fabricDisplay:[],detail:[a],aiEffect:[]}});
  await server(db,async base=>{
   assert.equal((await call(base,'/products/'+product.id,'DELETE',undefined,false)).status,401);
   db.grant=false;
   db.hasOrder=true;
   assert.equal((await call(base,'/products/'+product.id,'DELETE')).status,409);
   assert.equal(db.assets.get(a)?.ref_count,2,'ordered image is never detached');
   db.hasOrder=false;
   const response=await call(base,'/products/'+product.id,'DELETE');
   assert.equal(response.status,200,kind);
   assert.deepEqual(await response.json(),{id:product.id,deleted:true});
   assert.equal(db.assets.get(a)?.ref_count,1,'shared image is still in use');
   assert.equal(db.assets.get(a)?.status,'ready');
   assert.equal(db.images.length,0);
   assert.equal(db.products.length,0);
  },kind);
 }
});
test('P3-4 HTTP real Express authentication, conflict/rowVersion, safe parse errors',async()=>{
 const db=new DB();await server(db,async base=>{
  assert.equal((await call(base,'/products','GET',undefined,false)).status,401);
  const created=await call(base,'/products','POST',newInput);
  assert.equal(created.status,201);const item=await created.json() as {id:string;productNo:string};
  assert.equal(item.productNo,'G017-2-F018');
  assert.equal((await call(base,'/products/'+item.id)).status,200);
  assert.equal((await call(base,'/products','POST',newInput)).status,409);
  assert.equal((await call(base,'/products/'+item.id,'PATCH',{expectedRowVersion:'1',remark:'New'})).status,200);
  assert.equal((await call(base,'/products/'+item.id,'PATCH',{expectedRowVersion:'1',remark:'Old'})).status,409);
  db.grant=false;
  assert.equal((await call(base,'/products/'+item.id,'PATCH',{expectedRowVersion:'2',remark:'共享修改'})).status,200);
  db.grant=true;
  const bad=await fetch(base+'/products',{method:'POST',headers:{authorization:'Bearer '+'a'.repeat(64),
   'content-type':'application/json'},body:'{bad'});
  assert.equal(bad.status,400);assert(!((await bad.text()).includes('<html>')));
  db.unavailable=true;const failed=await call(base,'/products');
  assert.equal(failed.status,503);assert(!((await failed.text()).includes('PRIVATE SQL DETAILS')));
 });
});
