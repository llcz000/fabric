import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import type {Server} from 'node:http';
import {hashSessionToken} from '../access/password';
import {parseProductSearchQuery,searchProductCatalog,ProductSearchError} from './productSearch';
import {createV2ProductsRouter} from './productsV2Routes';

test('linked products filter uses exact fabric identity before count and paging',async()=>{
 const filter=parseProductSearchQuery({fabricId:'12',status:'all'});
 const calls:{sql:string;params:unknown[]}[]=[];
 await searchProductCatalog({async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>{calls.push({sql,params});return [sql.includes('COUNT(*)')?[{total:0}]:[],[]];}},filter);
 assert(calls.every(c=>c.sql.includes('p.fabric_id=?')&&c.params[0]==='12'));
 assert.throws(()=>parseProductSearchQuery({fabricId:'12 OR 1=1'}));
});

type P={id:string;pattern_colorway_id:string;fabric_id:string;master_id:string;master_no:string;colorway_no:number;
 product_no:string;row_version:string;fabric_name:string;fabric_no:string;composition:string|null;weight_value:string|null;
 weight_unit:'gsm'|'mm'|null;width_value:string|null;pattern_image_asset_id:string|null;
 remark:string;is_active:number;is_available_for_sampling:number;master_active:number;colorway_active:number;fabric_active:number;
 topicIds:string[];colorIds:string[];nDisplay:number;nDetail:number;nEffect:number};
const TEXTS=['雪纺','高端棉布','花式真丝','轻纱面料','素色亚麻','温柔雪纺','缎面丝绸'];
function fixtures():P[]{
 const records:P[]=[];
 for(let i=0;i<2100;i++){
  const m=Math.floor(i/21)+1,colorway=Math.floor(i%21/7)+1,fabric=i%7+1;
  records.push({
   id:String(i+1),pattern_colorway_id:String(m*10+colorway),fabric_id:String(fabric),
   master_id:String(m),master_no:'M'+String(m).padStart(3,'0'),colorway_no:colorway,
   product_no:'M'+String(m).padStart(3,'0')+'-'+colorway+'-F'+String(fabric).padStart(3,'0'),row_version:'1',
   fabric_name:TEXTS[fabric-1],fabric_no:'F'+String(fabric).padStart(3,'0'),
   composition:fabric%4===0?null:'真丝',weight_value:fabric%4===0?null:'95.500',
   weight_unit:fabric%4===0?null:'gsm',width_value:fabric%4===0?null:'145.00',
   pattern_image_asset_id:colorway===2?'a1111111-1111-4111-8111-111111111111':null,
   remark:i%17===0?'样品备注':'',is_active:i%13===0?0:1,is_available_for_sampling:i%19===0?0:1,
   master_active:m%17===0?0:1,colorway_active:colorway===3?0:1,fabric_active:fabric===7?0:1,
   topicIds:[m%2===0?'1':'2', ...(m%5===0?['3']:[])],
   colorIds:m%3===1?['10']:m%3===2?['11','12']:['13'],
   nDisplay:i%3,nDetail:i%2,nEffect:i%5===0?1:0
  });
 }
 return records;
}
const tagNames:Record<string,{name:string;isArchived:boolean}>={
 '1':{name:'花卉',isArchived:false},'2':{name:'植物',isArchived:false},
 '3':{name:'古典',isArchived:true},'10':{name:'蓝色',isArchived:false},
 '11':{name:'绿色',isArchived:false},'12':{name:'墨绿',isArchived:true},
 '13':{name:'红色',isArchived:false}
};
const likeNeedle=(value:unknown):string=>String(value).slice(1,-1).replace(/!(.)/g,'$1').toLowerCase();
class Db {
 readonly all=fixtures(); statements:{sql:string;params:unknown[]}[]=[];failure=false;readable=true;
 async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>{
  this.statements.push({sql,params});
  if(this.failure)throw Error('PRODUCTION_CREDENTIALS_MUST_NOT_LEAK');
  if(sql.includes('JOIN v2_access_users')){
   if(!this.readable||params[0]!==hashSessionToken('a'.repeat(64)))return [[],[]];
   return [[{user_id:'2',role:'sales',username:'sales',display_name:'Sales',can_manage_products:1,
    can_manage_own_orders:0,session_id:'9'}],[]];
  }
  if(sql.includes('FROM v2_products p JOIN pattern_colorways c ON c.id=p.pattern_colorway_id')){
   assert(sql.includes('JOIN pattern_masters m ON m.id=c.master_id'));
   assert(sql.includes('JOIN v2_fabrics f ON f.id=p.fabric_id'));
   let index=0;let records=this.all.slice();
   if(sql.includes('p.is_active=?')){const state=Number(params[index++]);records=records.filter(x=>x.is_active===state);}
   if(sql.includes('LOWER(p.product_no) LIKE ?')){
    const text=likeNeedle(params[index++]);
    records=records.filter(x=>x.product_no.toLowerCase().includes(text));
   }
   if(sql.includes('LOWER(f.fabric_name) LIKE ?')){
    const text=likeNeedle(params[index++]);
    records=records.filter(x=>x.fabric_name.toLowerCase().includes(text));
   }
   const topicMatch=/mt\.tag_id IN \((\?(?:,\?)*)\)/.exec(sql);
   if(topicMatch){
    assert(sql.includes("t.dimension='topic'")&&sql.includes('mt.master_id=m.id'));
    const ids=topicMatch[1].split(',').map(()=>String(params[index++]));
    records=records.filter(x=>x.topicIds.some(y=>ids.includes(y)));
   }
   const colorMatch=/ct\.tag_id IN \((\?(?:,\?)*)\)/.exec(sql);
   if(colorMatch){
    assert(sql.includes("t.dimension='color'")&&sql.includes('ct.master_id=m.id'));
    const ids=colorMatch[1].split(',').map(()=>String(params[index++]));
    records=records.filter(x=>x.colorIds.some(y=>ids.includes(y)));
   }
   if(sql.startsWith('SELECT COUNT(*) AS total'))return [[{total:records.length}],[]];
   assert(sql.includes('ORDER BY p.product_no ASC,p.id ASC LIMIT ? OFFSET ?'));
   assert.equal(index+2,params.length);
   records.sort((a,b)=>a.product_no.localeCompare(b.product_no)||Number(a.id)-Number(b.id));
   const limit=Number(params[index]),offset=Number(params[index+1]);
   return [records.slice(offset,offset+limit),[]];
  }
  if(sql.includes('FROM pattern_master_tag_links l JOIN shared_tags t')){
   const color=sql.includes("t.dimension='color'");assert(sql.includes('l.master_id IN ('));
   return [this.all.filter(x=>params.includes(x.master_id)).flatMap(x=>(color?x.colorIds:x.topicIds).map(tagId=>({
    owner_id:x.master_id,id:tagId,name:tagNames[tagId].name,is_archived:tagNames[tagId].isArchived?1:0
   }))).filter((v,i,a)=>a.findIndex(u=>u.owner_id===v.owner_id&&u.id===v.id)===i),[]];
  }
  if(sql.includes('FROM pattern_colorway_tag_links l JOIN shared_tags t')){
   assert(sql.includes("t.dimension='color'"));assert(sql.includes('l.colorway_id IN ('));
   return [this.all.filter(x=>params.includes(x.pattern_colorway_id)).flatMap(x=>x.colorIds.map(tagId=>({
    owner_id:x.pattern_colorway_id,id:tagId,name:tagNames[tagId].name,is_archived:tagNames[tagId].isArchived?1:0
   }))).filter((v,i,a)=>a.findIndex(u=>u.owner_id===v.owner_id&&u.id===v.id)===i),[]];
  }
  if(sql.includes('FROM v2_product_image_assets')&&sql.includes('GROUP BY')){
   assert(sql.includes('deleted_at IS NULL'));assert(sql.includes('product_id IN ('));
   return [this.all.filter(x=>params.includes(x.id)).flatMap(x=>[
    {product_id:x.id,role:'fabric_display',image_count:x.nDisplay},
    {product_id:x.id,role:'detail',image_count:x.nDetail},
    {product_id:x.id,role:'ai_effect',image_count:x.nEffect}
   ]).filter(x=>x.image_count>0),[]];
  }
  throw Error('Unexpected SQL '+sql);
 }
}
const s=(x:Record<string,unknown>)=>parseProductSearchQuery(x);
const fail=(err:unknown)=>err instanceof ProductSearchError&&err.status===400;
test('P3-5 parse: independent text boxes, normalized duplicate-safe tag sets and defaults',()=>{
 assert.deepEqual(s({}),{productNo:'',fabricName:'',topicTagIds:[],colorTagIds:[],status:'active',cardAssociation:'all',limit:50,offset:0});
 assert.deepEqual(s({productNo:'  m001-1  ',fabricName:' 真丝 ',topicTagIds:'2,1,2',
  colorTagIds:'11,10',status:'all',limit:'20',offset:'40'}),{
  productNo:'m001-1',fabricName:'真丝',topicTagIds:['2','1'],colorTagIds:['11','10'],
  status:'all',cardAssociation:'all',limit:20,offset:40
 });
 assert.equal(s({includeInactive:'true'}).status,'all');
});
test('P3-5 reject unsupported filters, malformed query, repeated params and wild pagination',()=>{
 for(const input of [
  {weightUnit:'gsm'},{weightMin:'50'},{colorwayName:'blue'},{fabricName:['a','b']},
  {productNo:{nested:'true'}},{status:'unknown'},{includeInactive:'false'},
  {includeInactive:'true',status:'inactive'},{limit:'0'},{limit:'101'},{offset:'-1'},
  {offset:'1000001'},{offset:'01'},{topicTagIds:'1,not-a-number'},
  {colorTagIds:'0'},{topicTagIds:'18446744073709551616'},
  {topicTagIds:Array.from({length:11},(_,i)=>i+1).join(',')},
  {topicTagIds:'1,,2'},{productNo:'x'.repeat(162)}, {fabricName:'a\nb'}
 ])assert.throws(()=>s(input),fail,JSON.stringify(input));
});
test('P3-5 2100 records: filters AND across number+name+dimensions, OR within tag dimensions, pre-pagination count',async()=>{
 const db=new Db();
 const params=s({productNo:' m0 ',fabricName:'  雪纺 ',topicTagIds:'1,2',
  colorTagIds:'10,11',status:'all',limit:'3',offset:'3'});
 const result=await searchProductCatalog(db,params);
 const expected=db.all.filter(x=>x.product_no.toLowerCase().includes('m0')&&x.fabric_name.includes('雪纺')&&
  ['1','2'].some(id=>x.topicIds.includes(id))&&['10','11'].some(id=>x.colorIds.includes(id)))
  .sort((a,b)=>a.product_no.localeCompare(b.product_no));
 assert.equal(result.total,expected.length);
 assert.deepEqual(result.items.map(x=>x.productNo),expected.slice(3,6).map(x=>x.product_no));
 assert.equal(result.limit,3);assert.equal(result.offset,3);
 assert(db.statements[0].sql.startsWith('SELECT COUNT(*) AS total'));
 assert(db.statements[1].sql.includes('LIMIT ? OFFSET ?'));
 assert(!db.statements[0].sql.includes('LIMIT ? OFFSET ?'));
 assert.equal(db.statements.filter(x=>x.sql.includes('FROM v2_product_image_assets')).length,1);
 assert.equal(db.statements.length,5);
});
test('P3-5 empty/single filters and escaped SQL LIKE metacharacters remain independent',async()=>{
 const db=new Db();
 const empty=await searchProductCatalog(db,s({productNo:' m002-1 ',fabricName:'No such fabric'}));
 assert.equal(empty.total,0);assert.deepEqual(empty.items,[]);
 assert.equal(db.statements.length,1);
 const onlyName=await searchProductCatalog(db,s({fabricName:'真丝'}));
 assert(onlyName.total>0);
 const special=await searchProductCatalog(db,s({productNo:'%_!'}));
 assert.equal(special.total,0);
 assert(db.statements.some(x=>x.sql.includes("ESCAPE '!'")&&x.params.some(y=>typeof y==='string'&&String(y).includes('!%'))));
 const onlyNo=await searchProductCatalog(db,s({productNo:'m001-1',status:'all'}));
 assert.equal(onlyNo.total,7);
});
test('topics and colors both belong to pattern master, sibling products inherit the same labels',async()=>{
 const db=new Db();
 const blue=await searchProductCatalog(db,s({topicTagIds:'2',colorTagIds:'10',status:'all'}));
 assert(blue.total>0);
 assert(blue.items.every(x=>x.colorTags.some(tag=>tag.id==='10')));
 assert(new Set(blue.items.map(item=>item.colorwayNo)).size>1);
 const green=await searchProductCatalog(db,s({topicTagIds:'2',colorTagIds:'11,12',status:'all'}));
 assert(green.total>0);
 assert(new Set(green.items.map(item=>item.colorwayNo)).size>1);
 assert(green.items[0].colorTags.some(tag=>tag.isArchived===true));
 assert(!green.items[0].colorTags.some(tag=>tag.id==='10'));
});
test('P3-5 status active/inactive/all product own status; four-level selectability shown independently',async()=>{
 const db=new Db();
 const active=await searchProductCatalog(db,s({status:'active'}));
 const inactive=await searchProductCatalog(db,s({status:'inactive'}));
 const all=await searchProductCatalog(db,s({status:'all'}));
 assert.equal(all.total,2100);assert.equal(active.total+inactive.total,all.total);
 assert(active.items.every(x=>x.isActive));assert(inactive.items.every(x=>!x.isActive));
 assert(all.items.some(x=>!x.isSelectable));
 assert(all.items.every(x=>x.isSelectable===(x.isActive&&x.masterActive&&x.colorwayActive&&x.fabricActive)));
});
test('AC-97 catalog exposes independent no-sampling state without disabling order selectability or adding list columns',async()=>{
 const db=new Db();const items=await searchProductCatalog(db,s({status:'all',limit:'100'}));
 assert(db.statements.some(q=>q.sql.includes('p.is_available_for_sampling')));
 assert(items.items.some(x=>x.isActive&&x.isAvailableForSampling===false));
 const row=items.items.find(x=>x.isActive&&x.isAvailableForSampling===false&&x.masterActive&&x.colorwayActive&&x.fabricActive);
 if(row)assert.equal(row.isSelectable,true,'temporary sample hold must not disable orders');
});
test('P3-5 12-column data materialization from JOIN, archived tags, image counts, no full images',async()=>{
 const db=new Db();
 const page=await searchProductCatalog(db,s({status:'all',limit:'30'}));
 assert.equal(page.items.length,30);
 const selected=page.items.find(x=>x.masterNo==='M001'&&x.colorwayNo===2);
 assert(selected);
 assert.equal(selected.fabricName,db.all.find(x=>x.id===selected.id)?.fabric_name);
 assert.equal(selected.patternImageAssetId,'a1111111-1111-4111-8111-111111111111');
 assert(selected.topicTags.length>0&&selected.colorTags.length>0);
 assert.equal(selected.totalImages,selected.imageCounts.fabricDisplay+selected.imageCounts.detail+selected.imageCounts.aiEffect);
 assert.deepEqual(Object.keys(selected.imageCounts),['fabricDisplay','detail','aiEffect']);
 assert.equal(typeof selected.remark,'string');assert.equal(typeof selected.productNo,'string');
 assert(!db.statements.some(x=>x.sql.includes('FROM image_assets')||x.sql.includes('storage_key')));
});
test('P3-5 2000+ fixtures across multi-colorway/multi-fabric: bounded batch and SQL page-only retrieval',async()=>{
 const db=new Db();
 const p1=await searchProductCatalog(db,s({status:'all',limit:'100',offset:'1900'}));
 assert.equal(p1.items.length,100);assert.equal(p1.total,2100);
 assert.equal(db.statements.length,5);
 assert(db.statements.filter(x=>x.sql.includes('IN (')).every(x=>x.params.length<=100));
 assert(db.statements.every(x=>!x.sql.includes('SELECT *')));
 const p2=await searchProductCatalog(db,s({status:'all',limit:'100',offset:'2000'}));
 assert.equal(p2.items.length,100);
 assert(new Set([...p1.items,...p2.items].map(x=>x.id)).size===200);
 const end=await searchProductCatalog(db,s({status:'all',offset:'2100',limit:'20'}));
 assert.equal(end.items.length,0);assert.equal(end.total,2100);
});
async function serve(db:Db,callback:(root:string)=>Promise<void>){
 const app=express();const noWritePool={getConnection:async()=>{throw Error('Unexpected write');}};
 app.use('/api/v2',createV2ProductsRouter(db,noWritePool as never));
 const server:Server=await new Promise((resolve,reject)=>{const instance=app.listen(0,'127.0.0.1',()=>resolve(instance));instance.once('error',reject);});
 try{const addr=server.address();assert(addr&&typeof addr!=='string');await callback('http://127.0.0.1:'+addr.port+'/api/v2');}
 finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
}
test('P3-5 HTTP GET /api/v2/products authenticates, combines filters, returns total and pagination',async()=>{
 const db=new Db();
 await serve(db,async base=>{
  const noAuth=await fetch(base+'/products?topicTagIds=1');assert.equal(noAuth.status,401);
  const r=await fetch(base+'/products?productNo=m0&fabricName=%E7%9C%9F%E4%B8%9D&topicTagIds=1,2&colorTagIds=10,11&status=all&limit=5&offset=5',{
   headers:{authorization:'Bearer '+'a'.repeat(64)}});
  assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');
  const result=await r.json() as {total:number;limit:number;offset:number;items:unknown[]};
  assert(result.total>5);assert.equal(result.items.length,5);assert.equal(result.limit,5);assert.equal(result.offset,5);
  for(const qs of ['weightValue=5','topicTagIds=0','limit=300','status=unapproved','colorTagIds=1&colorTagIds=2','cardAssociation=invalid','cardAssociation=linked&cardAssociation=unlinked']){
   const bad=await fetch(base+'/products?'+qs,{headers:{authorization:'Bearer '+'a'.repeat(64)}});
   assert.equal(bad.status,400,qs);
  }
  db.failure=true;
  const failure=await fetch(base+'/products',{headers:{authorization:'Bearer '+'a'.repeat(64)}});
  assert.equal(failure.status,503);assert(!((await failure.text()).includes('PRODUCTION_CREDENTIALS_MUST_NOT_LEAK')));
 });
});

test('card patterns apply exact master AND fabric identity to both count and page',async()=>{const filter=parseProductSearchQuery({masterId:'9',fabricId:'12',status:'all'});const calls:{sql:string;params:unknown[]}[]=[];await searchProductCatalog({async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>{calls.push({sql,params});return [sql.includes('COUNT(*)')?[{total:1}]:[],[]];}},filter);assert(calls.length>=2);assert(calls.every(c=>c.sql.includes('m.id=?')&&c.sql.includes('p.fabric_id=?')&&c.params.includes('9')&&c.params.includes('12')));for(const id of ['0','9 OR 1=1',[],9])assert.throws(()=>parseProductSearchQuery({masterId:id}));});
