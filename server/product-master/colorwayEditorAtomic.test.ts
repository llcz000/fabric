import assert from 'node:assert/strict';
import test from 'node:test';
import type {AppPrincipal} from '../access/types';
import {createColorway,updateColorway,ColorwayIdentityError} from './colorwayIdentity';
const actor:AppPrincipal={userId:'2',sessionId:'9',username:'sales',displayName:'Sales',role:'sales',canManageProducts:true,canManageOwnOrders:false};
type Colorway={id:string;master_id:string;colorway_no:number;remark:string;is_active:number;pattern_image_asset_id:null};
class Db {
 next=1;serial=100;items:Colorway[]=[];links=new Map<string,string[]>();
 tags=new Map([['7',{id:'7',dimension:'color',is_archived:0}],['8',{id:'8',dimension:'color',is_archived:0}],
 ['9',{id:'9',dimension:'topic',is_archived:0}],['10',{id:'10',dimension:'color',is_archived:1}]]);
 names=new Map<string,string>();nextTag=200;
 calls:string[]=[];commits=0;rollbacks=0;failLink=false;permitted=true;
 async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>{
  this.calls.push(sql);
  if(sql.includes('FROM v2_access_users'))return [[{id:'2',role:'sales',is_active:1,can_manage_products:this.permitted?1:0}],[]];
  if(sql.includes('FROM v2_access_sessions'))return [[{id:'9'}],[]];
  if(sql.includes('FROM pattern_masters'))return [[{id:'1',master_no:'G017',next_colorway_no:String(this.next)}],[]];
  if(sql.startsWith('UPDATE pattern_masters')){this.next++;return [{affectedRows:1},[]];}
  if(sql.startsWith('INSERT INTO pattern_colorways')){
   const id=String(this.serial++);
   this.items.push({id,master_id:String(params[0]),colorway_no:Number(params[1]),
    remark:String(params[2]),is_active:Number(params[3]),pattern_image_asset_id:null});
   return [{insertId:id,affectedRows:1},[]];
  }
  if(sql.includes('FROM pattern_colorways')){
   return [this.items.filter(x=>x.id===String(params[0])),[]];
  }
  if(sql.startsWith('UPDATE pattern_colorways')){
   const row=this.items.find(x=>x.id===String(params[2]))!;
   row.remark=String(params[0]);row.is_active=Number(params[1]);
   return [{affectedRows:1},[]];
  }
  if(sql.startsWith('INSERT INTO shared_tags')){
   const normalized=String(params[2]),id=this.names.get(normalized)??String(this.nextTag++);
   this.names.set(normalized,id);
   if(!this.tags.has(id))this.tags.set(id,{id,dimension:'color',is_archived:0});
   return [{affectedRows:1},[]];
  }
  if(sql.includes('FROM shared_tags')&&sql.includes('normalized_name=?')){
   const id=this.names.get(String(params[1]));
   return [id?[this.tags.get(id)!]:[],[]];
  }
  if(sql.startsWith('SELECT tag_id FROM pattern_colorway_tag_links'))
   return [(this.links.get(String(params[0]))??[]).map(tag_id=>({tag_id})),[]];
  if(sql.includes('FROM shared_tags'))return [params.map(x=>this.tags.get(String(x))).filter(Boolean),[]];
  if(sql.startsWith('DELETE FROM pattern_colorway_tag_links')){
   const id=String(params[0]);
   this.links.set(id,(this.links.get(id)??[]).filter(x=>x!==String(params[1])));
   return [{affectedRows:1},[]];
  }
  if(sql.startsWith('INSERT INTO pattern_colorway_tag_links')){
   if(this.failLink)throw Error('simulate FK/constraint failure');
   const id=String(params[0]);
   this.links.set(id,[...(this.links.get(id)??[]),String(params[1])]);
   return [{affectedRows:1},[]];
  }
  throw Error('Unexpected SQL: '+sql);
 }
 async getConnection(){
  const before={next:this.next,serial:this.serial,items:structuredClone(this.items),
   links:structuredClone(this.links),tags:structuredClone(this.tags),
   names:structuredClone(this.names),nextTag:this.nextTag};
  return {query:this.query.bind(this),beginTransaction:async()=>{},
   commit:async()=>{this.commits++;},rollback:async()=>{
    this.next=before.next;this.serial=before.serial;this.items=before.items;this.links=before.links;
    this.tags=before.tags;this.names=before.names;this.nextTag=before.nextTag;this.rollbacks++;
   },release:()=>{}};
 }
}
const err=(status:number)=>(e:unknown)=>e instanceof ColorwayIdentityError&&e.status===status;
test('combined create saves selected live color tags with permanent sequence in one transaction',async()=>{
 const db=new Db();
 const result=await createColorway(db as never,actor,'1',{remark:'藏蓝',isActive:true,tagIds:['7','8']});
 assert.equal(result.patternNo,'G017-1');assert.equal(db.next,2);
 assert.deepEqual(db.links.get(result.id),['7','8']);assert.equal(db.commits,1);
 assert(db.calls.some(x=>x.includes('shared_tags')&&x.includes('FOR SHARE')));
});
test('combined edit updates remark and tags atomically, retains archived links and rejects retired deactivation',async()=>{
 const db=new Db();
 const a=await createColorway(db as never,actor,'1',{});
 db.links.set(a.id,['10','7']);
 const before=structuredClone(db.items);const calls=db.calls.length;
 await assert.rejects(updateColorway(db as never,actor,a.id,{remark:'不应保存',isActive:false,tagIds:['10','8']}),err(400));
 assert.deepEqual(db.items,before);assert.deepEqual(db.links.get(a.id),['10','7']);assert.equal(db.calls.length,calls);
 const b=await updateColorway(db as never,actor,a.id,{remark:'更新',tagIds:['10','8']});
 assert.equal(b.remark,'更新');assert.equal(b.isActive,true);
 assert.deepEqual(db.links.get(a.id),['10','8']);
 assert.equal(db.commits,2);
});
test('combined create/edit reject wrong dimensions, duplicates, archived new tags, IDs and unknown fields before commit',async()=>{
 const db=new Db();
 for(const tags of [['9'],['10'],['7','7'],['0'],Array(11).fill('7')]){
  await assert.rejects(createColorway(db as never,actor,'1',{tagIds:tags}),err(tags[0]==='10'?409:400));
 }
 assert.equal(db.next,1);assert.equal(db.commits,0);
 for(const bad of [{tagIds:'7'},{tagIds:[7]},{tagIds:null},{productNo:'fake'},{colorwayNo:9}]){
  await assert.rejects(createColorway(db as never,actor,'1',bad),err(400));
 }
 const saved=await createColorway(db as never,actor,'1',{});
 await assert.rejects(updateColorway(db as never,actor,saved.id,{tagIds:['9']}),err(400));
});
test('combined tag link insertion failure rolls back version update, all links, and creation number',async()=>{
 const db=new Db();
 const saved=await createColorway(db as never,actor,'1',{remark:'旧'});
 db.failLink=true;
 await assert.rejects(updateColorway(db as never,actor,saved.id,{remark:'新',tagIds:['7']}),/simulate/);
 assert.equal(db.items[0].remark,'旧');assert.equal(db.links.has(saved.id),false);
 const next=db.next;
 await assert.rejects(createColorway(db as never,actor,'1',{remark:'不能创建',tagIds:['7']}),/simulate/);
 assert.equal(db.next,next);assert.equal(db.items.length,1);assert.equal(db.rollbacks,2);
});
test('legacy separate property PATCH without tagIds leaves existing tags intact',async()=>{
 const db=new Db(),saved=await createColorway(db as never,actor,'1',{tagIds:['7']});
 await updateColorway(db as never,actor,saved.id,{remark:'无需改标签'});
 assert.deepEqual(db.links.get(saved.id),['7']);
 assert.equal(db.calls.filter(x=>x.startsWith('DELETE FROM pattern_colorway_tag_links')).length,0);
});
test('custom color names create/reuse shared tags and bind to the colorway atomically',async()=>{
 const db=new Db();
 const result=await createColorway(db as never,actor,'1',{
  remark:'蓝调',tagIds:['7'],newColorTags:['  浅紫  ','浅杏']
 });
 assert.equal(db.commits,1);
 const linked=db.links.get(result.id)??[];
 assert.equal(linked.length,3);assert(linked.includes('7'));
 assert(db.calls.some(x=>x.startsWith('INSERT INTO shared_tags')));
 const initial=linked[1];
 const second=await createColorway(db as never,actor,'1',{
  tagIds:[],newColorTags:['浅紫']
 });
 assert.equal(db.links.get(second.id)?.[0],initial,'must reuse normalized color term');
});
test('invalid or archived custom color and later link failure rollback new shared names, version and sequence',async()=>{
 const db=new Db();
 for(const custom of [[''],['x'.repeat(33)],['同名',' 同名 '],['x\nline']]){
  await assert.rejects(createColorway(db as never,actor,'1',{
   tagIds:[],newColorTags:custom
  }),(e:unknown)=>e instanceof ColorwayIdentityError&&e.status===400);
 }
 await createColorway(db as never,actor,'1',{tagIds:['10']}).then(
  ()=>assert.fail('archived tag must be rejected'),
  e=>assert(e instanceof ColorwayIdentityError&&e.status===409));
 const first=await createColorway(db as never,actor,'1',{});
 db.failLink=true;
 const next=db.next,originalTagCount=db.tags.size;
 await assert.rejects(updateColorway(db as never,actor,first.id,{
  remark:'失败',tagIds:[],newColorTags:['全新海盐蓝']
 }),/simulate/);
 assert.equal(db.tags.size,originalTagCount);
 assert.equal(db.items[0].remark,'');
 assert.equal(db.next,next);
});
test('deprecated product grant does not block authenticated colorway edits or tag transactions',async()=>{
 const db=new Db(),saved=await createColorway(db as never,actor,'1',{tagIds:['7']});
 db.permitted=false;
 await updateColorway(db as never,actor,saved.id,{tagIds:['8'],remark:'允许共享编辑'});
 assert.deepEqual(db.links.get(saved.id),['8']);
});
