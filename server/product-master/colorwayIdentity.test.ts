import assert from 'node:assert/strict';
import test from 'node:test';
import type {AppPrincipal} from '../access/types';
import {createColorway,listColorways,updateColorway,deleteColorway,ColorwayIdentityError} from './colorwayIdentity';

const actor:AppPrincipal={userId:'2',sessionId:'9',username:'sales',displayName:'Sales',role:'sales',canManageProducts:true,canManageOwnOrders:false};
type Row={id:string;master_id:string;colorway_no:number;pattern_image_asset_id:string|null;remark:string;is_active:number};
/** SQL boundary double: confirms transaction rollback effects, not real MySQL locking. */
class Database {
 next=1; nextId=100; data:Row[]=[]; committed=0; rolledBack=0; queries:string[]=[];
 granted=true; active=true; session=true; master=true; insertFails=false; referenced=false; fkRace=false; unsafeInsertId=false; released=0;
 async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]> {
  this.queries.push(sql);
  if(sql.includes('FROM v2_access_users'))return [this.active?[{id:'2',role:'sales',is_active:1,can_manage_products:this.granted?1:0}]:[],[]];
  if(sql.includes('FROM v2_access_sessions'))return [this.session?[{id:'9'}]:[],[]];
  if(sql.includes('FROM pattern_masters'))return [this.master?[{id:'1',master_no:'1234',next_colorway_no:String(this.next)}]:[],[]];
  if(sql.startsWith('UPDATE pattern_masters')){this.next++;return [{affectedRows:1},[]];}
  if(sql.startsWith('INSERT INTO pattern_colorways')){
   if(this.insertFails)throw Error('injected insert failure');
   const id=String(this.nextId++);
   this.data.push({id,master_id:String(params[0]),colorway_no:Number(params[1]),remark:String(params[2]),is_active:Number(params[3]),pattern_image_asset_id:null});
   return [{insertId:this.unsafeInsertId?9007199254740992:id,affectedRows:1},[]];
  }
  if(sql.startsWith('SELECT')&&sql.includes('FROM pattern_colorways'))return [this.data.filter(r=>sql.includes('master_id=?')?r.master_id===String(params[0]):r.id===String(params[0])),[]];
  if(sql.startsWith('UPDATE pattern_colorways')){
   const row=this.data.find(r=>r.id===String(params[2]));if(!row)return [{affectedRows:0},[]];
   row.remark=String(params[0]);row.is_active=Number(params[1]);return [{affectedRows:1},[]];
  }
  if(sql.includes('FROM v2_products'))return [this.referenced?[{id:'18'}]:[],[]];
  if(sql.startsWith('DELETE FROM pattern_colorways')){
   if(this.fkRace)throw Object.assign(Error('internal FK details'),{code:'ER_ROW_IS_REFERENCED_2'});
   const old=this.data.length;this.data=this.data.filter(r=>r.id!==String(params[0]));return [{affectedRows:old-this.data.length},[]];
  }
  if(sql.startsWith('INSERT INTO business_delete_events'))return [{affectedRows:1},[]];
  throw Error('Unexpected SQL '+sql);
 }
 async getConnection(){
  const snapshot={next:this.next,data:structuredClone(this.data)};
  return {query:this.query.bind(this),beginTransaction:async()=>{},commit:async()=>{this.committed++;},rollback:async()=>{this.next=snapshot.next;this.data=snapshot.data;this.rolledBack++;},release:()=>{this.released++;}};
 }
}
const hasStatus=(status:number)=>(e:unknown)=>e instanceof ColorwayIdentityError&&e.status===status;
test('pattern image draft saves atomically, validates ready product assets and preserves shared references on replace/remove',async()=>{
 const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
 class Images extends Database{
  assets=new Map([[a,{id:a,status:'ready',purpose:'product_image',ref_count:2}],[b,{id:b,status:'ready',purpose:'product_image',ref_count:0}]]);
  override async query(sql:string,args:unknown[]=[]):Promise<[unknown,unknown]>{
   if(sql.includes('FROM image_assets WHERE id IN'))return [[...this.assets.values()].filter(row=>args.includes(row.id)),[]];
   if(sql.startsWith('UPDATE image_assets SET ref_count=ref_count+1')){this.assets.get(String(args[0]))!.ref_count++;return [{affectedRows:1},[]];}
   if(sql.startsWith('UPDATE image_assets SET status=IF')){const row=this.assets.get(String(args[0]))!;row.ref_count--;if(row.ref_count===0)row.status='recycled';return [{affectedRows:1},[]];}
   if(sql.startsWith('UPDATE pattern_colorways SET pattern_image_asset_id=')){this.data.find(row=>row.id===String(args[1]))!.pattern_image_asset_id=args[0] as string|null;return [{affectedRows:1},[]];}
   return super.query(sql,args);
  }
  override async getConnection(){const assets=structuredClone(this.assets),conn=await super.getConnection();return {...conn,rollback:async()=>{this.assets=assets;await conn.rollback();}};}
 }
 const created=new Images();const first=await createColorway(created,actor,'1',{patternImageAssetId:a});
 assert.equal(first.patternImageAssetId,a);assert.equal(created.assets.get(a)!.ref_count,3);
 created.assets.get(b)!.status='processing';await assert.rejects(createColorway(created,actor,'1',{patternImageAssetId:b}),hasStatus(409));
 assert.equal(created.next,2);assert.equal(created.data.length,1);
 const single=new Images();const pictured=await createColorway(single,actor,'1',{patternImageAssetId:b});
 await deleteColorway(single,actor,pictured.id);assert.equal(single.data.length,0);assert.equal(single.assets.get(b)!.ref_count,0);assert.equal(single.assets.get(b)!.status,'recycled');assert.equal(single.next,2);
 const shared=new Images();const sharedPicture=await createColorway(shared,actor,'1',{patternImageAssetId:a});
 await deleteColorway(shared,actor,sharedPicture.id);assert.equal(shared.assets.get(a)!.ref_count,2);assert.equal(shared.assets.get(a)!.status,'ready');
 const atomic=new Images();const protectedPicture=await createColorway(atomic,actor,'1',{patternImageAssetId:b});atomic.fkRace=true;
 await assert.rejects(deleteColorway(atomic,actor,protectedPicture.id),hasStatus(409));assert.equal(atomic.data.length,1);assert.equal(atomic.assets.get(b)!.ref_count,1);assert.equal(atomic.data[0].pattern_image_asset_id,b);
 const db=new Images();db.data=[{id:'100',master_id:'1',colorway_no:1,pattern_image_asset_id:a,remark:'原备注',is_active:1}];
 const changed=await updateColorway(db,actor,'100',{remark:'新备注',isActive:true,patternImageAssetId:b});
 assert.equal(changed.patternImageAssetId,b);assert.equal(db.assets.get(a)!.ref_count,1);assert.equal(db.assets.get(a)!.status,'ready');assert.equal(db.assets.get(b)!.ref_count,1);
 await updateColorway(db,actor,'100',{patternImageAssetId:null});
 assert.equal(db.data[0].pattern_image_asset_id,null);assert.equal(db.assets.get(b)!.ref_count,0);assert.equal(db.assets.get(b)!.status,'recycled');
 db.assets.get(b)!.status='processing';
 await assert.rejects(updateColorway(db,actor,'100',{remark:'不应保存',patternImageAssetId:b}),hasStatus(409));
 assert.equal(db.data[0].remark,'新备注');assert.equal(db.rolledBack,1);
 await assert.rejects(updateColorway(db,actor,'100',{patternImageAssetId:'https://untrusted/image.png'}),hasStatus(400));
 db.active=false;await assert.rejects(updateColorway(db,actor,'100',{patternImageAssetId:a}),hasStatus(401));
});

test('AC-71 creates more than four identities from persistent counter without client identity',async()=>{
 const db=new Database();
 for(let n=1;n<=6;n++){
  const saved=await createColorway(db,actor,'1',{});
  assert.equal(saved.colorwayNo,n);assert.equal(saved.patternNo,'1234-'+n);assert.equal(saved.patternImageAssetId,null);
 }
 assert.equal(db.next,7);assert.equal(db.committed,6);
 assert(db.queries.some(q=>q.includes('next_colorway_no')&&q.includes('FOR UPDATE')));
});
test('AC-71 failed insertion rolls back counter and retry allocates the uncommitted number',async()=>{
 const db=new Database();db.insertFails=true;
 await assert.rejects(createColorway(db,actor,'1',{}),/injected/);
 assert.equal(db.next,1);assert.equal(db.data.length,0);assert.equal(db.rolledBack,1);assert.equal(db.released,1);
 db.insertFails=false;assert.equal((await createColorway(db,actor,'1',{})).colorwayNo,1);
});
test('AC-71 deleting middle identity and deactivating do not reuse or renumber',async()=>{
 const db=new Database();
 const a=await createColorway(db,actor,'1',{}),b=await createColorway(db,actor,'1',{}),c=await createColorway(db,actor,'1',{});
 await deleteColorway(db,actor,b.id);await assert.rejects(updateColorway(db,actor,a.id,{isActive:false}));
 const next=await createColorway(db,actor,'1',{});assert.equal(next.colorwayNo,4);
 assert.equal(db.data.find(r=>r.id===c.id)?.colorway_no,3);
});
test('AC-71 reading expected next identity neither starts a transaction nor consumes it',async()=>{
 const db=new Database();const result=await listColorways(db,'1');
 assert.equal(result.nextColorwayNo,1);assert.deepEqual(result.items,[]);assert.equal(db.next,1);assert.equal(db.committed,0);
});
test('AC-71 update rejects identity changes even when no product references the version',async()=>{
 const db=new Database();const item=await createColorway(db,actor,'1',{remark:'first'});
 for(const body of [{colorwayNo:8},{masterId:'2'},{patternNo:'999-9'},{patternImageAssetId:'asset'}])
  await assert.rejects(updateColorway(db,actor,item.id,body),hasStatus(400));
 const updated=await updateColorway(db,actor,item.id,{remark:'changed'});
 assert.equal(updated.remark,'changed');assert.equal(updated.isActive,true);assert.equal(updated.colorwayNo,1);
});
test('AC-34 create rejects client sequence, invalid IDs and malformed attributes before opening connection',async()=>{
 const db=new Database();
 for(const body of [{colorwayNo:1},{remark:7},{remark:'x'.repeat(501)},{isActive:1},null,[]])
  await assert.rejects(createColorway(db,actor,'1',body),hasStatus(400));
 for(const id of ['0','-1','1.2','01','18446744073709551616'])await assert.rejects(createColorway(db,actor,id,{}),hasStatus(400));
 assert.equal(db.queries.length,0);
});
test('AC-20 registered active role can allocate despite deprecated product-grant column',async()=>{
 const db=new Database();db.granted=false;
 const saved=await createColorway(db,actor,'1',{});
 assert.equal(saved.colorwayNo,1);assert.equal(db.next,2);assert.equal(db.data.length,1);assert.equal(db.rolledBack,0);
 assert(db.queries.some(q=>q.includes('v2_access_users')&&q.includes('FOR SHARE')));
});
test('AC-23 inactive user or revoked session cannot allocate',async()=>{
 for(const field of ['active','session'] as const){const db=new Database();db[field]=false;
  await assert.rejects(createColorway(db,actor,'1',{}),hasStatus(401));assert.equal(db.next,1);}
});
test('AC-58 referenced and concurrent FK-referenced versions cannot be deleted',async()=>{
 for(const mode of ['referenced','fkRace']){
  const db=new Database();const item=await createColorway(db,actor,'1',{});
  if(mode==='referenced')db.referenced=true;
  if(mode==='fkRace')db.fkRace=true;
  await assert.rejects(deleteColorway(db,actor,item.id),hasStatus(409));assert.equal(db.data.length,1);assert.equal(db.next,2);
 }
});
test('allocator rejects exhausted INT range without advancing persistent BIGINT counter',async()=>{
 const db=new Database();db.next=4294967295;
 assert.equal((await createColorway(db,actor,'1',{})).colorwayNo,4294967295);
 await assert.rejects(createColorway(db,actor,'1',{}),hasStatus(409));assert.equal(db.next,4294967296);
});
test('missing master and version return not found with released transactions',async()=>{
 const db=new Database();db.master=false;
 await assert.rejects(createColorway(db,actor,'1',{}),hasStatus(404));
 await assert.rejects(listColorways(db,'1'),hasStatus(404));
 await assert.rejects(updateColorway(db,actor,'100',{}),hasStatus(404));
 await assert.rejects(deleteColorway(db,actor,'100'),hasStatus(404));assert.equal(db.released,3);
});
test('unsafe numeric BIGINT insert result is rejected and allocation rolled back instead of returning a rounded ID',async()=>{
 const db=new Database();db.unsafeInsertId=true;
 await assert.rejects(createColorway(db,actor,'1',{}),/Unsafe database identity/);
 assert.equal(db.next,1);assert.equal(db.data.length,0);assert.equal(db.rolledBack,1);
});
