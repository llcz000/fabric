import assert from 'node:assert/strict';
import test from 'node:test';
test('pattern-level color labels coexist with topics and impact/merge count both current master and legacy version links',async()=>{
 const db=new Db();
 const topic=await createSharedTag(db,sales,'topic','题材A');
 const color=await createSharedTag(db,sales,'color','颜色A');
 const target=await createSharedTag(db,sales,'color','颜色B');
 await replaceEntityTags(db,sales,'master','10',[topic.id]);
 await replaceEntityTags(db,sales,'masterColor' as never,'10',[color.id]);
 assert.deepEqual(new Set(db.links.master.get('10')),new Set([topic.id,color.id]));
 await replaceEntityTags(db,sales,'master','10',[]);
 assert.deepEqual(db.links.master.get('10'),[color.id],'saving topics must preserve colors');
 await replaceEntityTags(db,sales,'master','10',[topic.id]);
 await replaceEntityTags(db,sales,'colorway','20',[color.id]);
 assert.equal((await previewTagImpact(db,color.id)).affectedCount,2);
 await mergeSharedTags(db,admin,color.id,target.id,2);
 assert.deepEqual(new Set(db.links.master.get('10')),new Set([topic.id,target.id]));
 assert.deepEqual(db.links.colorway.get('20'),[target.id]);
 await replaceEntityTags(db,sales,'masterColor' as never,'10',[]);
 assert.deepEqual(db.links.master.get('10'),[topic.id],'clearing colors must preserve topics');
});
test('pattern custom colors are normalized and created with links in one transaction; failure rolls them back',async()=>{
 const db=new Db();
 const ids=await replaceEntityTags(db,sales,'masterColor','10',[],[' 暮霭紫 ']);
 assert.equal(ids.length,1);assert.equal(db.tags.find(tag=>tag.id===ids[0])!.name,'暮霭紫');
 assert.deepEqual(db.links.master.get('10'),ids);
 db.failLink=true;
 await assert.rejects(replaceEntityTags(db,sales,'masterColor','11',[],['不应保留的颜色']));
 assert(!db.tags.some(tag=>tag.name==='不应保留的颜色'));
 await assert.rejects(replaceEntityTags(db,sales,'masterColor','10',[],['Ａ','A']),status(400));
});
import type {AppPrincipal} from '../access/types';
import {createSharedTag,listSharedTags,replaceEntityTags,previewTagImpact,renameSharedTag,archiveSharedTag,deleteCustomTopicTag,mergeSharedTags,TagError} from './sharedTags';
import {readEntityTags} from './sharedTags';
import express from 'express';
import type {Server} from 'node:http';
import {hashSessionToken} from '../access/password';
import {createSharedTagsRouter} from './sharedTagsRoutes';

const sales:AppPrincipal={userId:'2',sessionId:'9',username:'sales',displayName:'Sales',role:'sales',canManageOwnOrders:false,canManageProducts:true};
const admin:AppPrincipal={...sales,userId:'1',sessionId:'8',role:'admin',username:'admin'};
type TagRow={id:string;dimension:'topic'|'color';name:string;normalized_name:string;is_archived:number};
class Db {
 tags:TagRow[]=[];links={master:new Map<string,string[]>(),colorway:new Map<string,string[]>()};
 next=1;grant=true;active=true;session=true;denyAdmin=false;httpRole:'admin'|'sales'='sales';unavailable=false;masters=new Set(['10','11']);colorways=new Set(['20','21']);
 sql:string[]=[]; commits=0;rollbacks=0;failLink=false;failArchive=false;
 async query(q:string,args:unknown[]=[]):Promise<[unknown,unknown]>{
  this.sql.push(q);
  if(this.unavailable)throw Error('PRIVATE DB ERROR');
  if(q.includes('JOIN v2_access_users')){
   if(args[0]!==hashSessionToken('a'.repeat(64))||!this.session||!this.active)return [[],[]];
   return [[{user_id:this.httpRole==='admin'?'1':'2',username:'test',display_name:'Test',
    role:this.httpRole,session_id:this.httpRole==='admin'?'8':'9',
    can_manage_products:this.grant?1:0,can_manage_own_orders:0}],[]];
  }
  if(q.includes('FROM v2_access_users'))return [this.active?[{id:String(args[0]),role:this.denyAdmin?'sales':String(args[0])==='1'?'admin':'sales',is_active:1,can_manage_products:this.grant?1:0}]:[],[]];
  if(q.includes('FROM v2_access_sessions'))return [this.session?[{id:'9'}]:[],[]];
  if(q.startsWith('SELECT id FROM pattern_masters'))return [this.masters.has(String(args[0]))?[{id:args[0]}]:[],[]];
  if(q.startsWith('SELECT id FROM pattern_colorways'))return [this.colorways.has(String(args[0]))?[{id:args[0]}]:[],[]];
  if(q.startsWith('INSERT INTO shared_tags')){
   const [dimension,name,normalized_name]=args.map(String);
   if(!this.tags.some(x=>x.dimension===dimension&&x.normalized_name===normalized_name)){
    this.tags.push({id:String(this.next++),dimension:dimension as TagRow['dimension'],name,normalized_name,is_archived:0});
   }
   return [{affectedRows:1},[]];
  }
  if(q.startsWith('SELECT')&&q.includes('FROM shared_tags')&&!q.includes('FROM shared_tags t JOIN')){
   let tags=[...this.tags];
   if(q.includes('normalized_name=?'))tags=tags.filter(t=>t.dimension===String(args[0])&&t.normalized_name===String(args[1]));
   else if(q.includes('WHERE id=?'))tags=tags.filter(t=>t.id===String(args[0]));
   else if(q.includes('WHERE id IN'))tags=tags.filter(t=>args.map(String).includes(t.id));
   else if(q.includes('dimension=?'))tags=tags.filter(t=>t.dimension===String(args[0]));
   if(q.includes('is_archived=0 OR EXISTS'))tags=tags.filter(t=>t.is_archived===0||[...this.links.master.values()].some(ids=>ids.includes(t.id)));
    else if(q.includes('is_archived=0'))tags=tags.filter(t=>t.is_archived===0);
   if(q.includes('LIKE ?')){
    const raw=String(args.at(-1)),needle=raw.slice(1,-1).replaceAll('!%','%').replaceAll('!_','_').replaceAll('!!','!');
    tags=tags.filter(t=>t.normalized_name.includes(needle));
   }
   return [tags,[]];
  }

  if(q.startsWith('SELECT t.id,t.dimension,t.name,t.is_archived FROM shared_tags t JOIN')){
   const kind=q.includes('pattern_master_tag_links')?'master':'colorway';
   const ids=this.links[kind].get(String(args[0]))??[];
   return [ids.map(id=>this.tags.find(tag=>tag.id===id)).filter(Boolean),[]];
  }
  if(q.startsWith('SELECT')&&q.includes('AS entity_id FROM')){
   const kind=q.includes('pattern_master_tag_links')?'master':'colorway';
   const id=String(args[0]);
   return [[...this.links[kind].entries()].filter(([,ids])=>ids.includes(id)).map(([entity_id])=>({entity_id})),[]];
  }
  if(q.startsWith('SELECT tag_id FROM')){
   const kind=q.includes('pattern_master_tag_links')?'master':'colorway';
   return [(this.links[kind].get(String(args[0]))??[]).map(tag_id=>({tag_id})),[]];
  }
  if(q.startsWith('INSERT INTO pattern_master_tag_links')||q.startsWith('INSERT INTO pattern_colorway_tag_links')){
   if(this.failLink)throw Error('injected link failure');
   const kind=q.includes('pattern_master_tag_links')?'master':'colorway';
   const key=String(args[0]),v=this.links[kind].get(key)??[];
   if(!v.includes(String(args[1])))v.push(String(args[1]));
   this.links[kind].set(key,v);
   return [{affectedRows:1},[]];
  }
  if(q.startsWith('DELETE FROM pattern_master_tag_links')||q.startsWith('DELETE FROM pattern_colorway_tag_links')){
   const kind=q.includes('pattern_master_tag_links')?'master':'colorway',key=String(args[0]);
   if(q.includes('WHERE tag_id=?')){for(const [owner,ids] of this.links[kind])this.links[kind].set(owner,ids.filter(id=>id!==key));return [{affectedRows:1},[]];}
   this.links[kind].set(key,(this.links[kind].get(key)??[]).filter(x=>x!==String(args[1])));
   return [{affectedRows:1},[]];
  }
  if(q.startsWith('SELECT COUNT(*) AS n FROM')){
   const kind=q.includes('pattern_master_tag_links')?'master':'colorway';
   return [[{n:[...this.links[kind].values()].filter(ids=>ids.includes(String(args[0]))).length}],[]];
  }
  if(q.startsWith('UPDATE shared_tags SET name=')){
   const tag=this.tags.find(t=>t.id===String(args[2]))!;
   if(this.tags.some(x=>x!==tag&&x.dimension===tag.dimension&&x.normalized_name===String(args[1])))
    throw Object.assign(Error('confidential SQL'),{code:'ER_DUP_ENTRY'});
   tag.name=String(args[0]);tag.normalized_name=String(args[1]);return [{affectedRows:1},[]];
  }
  if(q.startsWith('UPDATE shared_tags SET is_archived=')){
   if(this.failArchive)throw Error('injected archive failure');
   this.tags.find(t=>t.id===String(args[0]))!.is_archived=1;return [{affectedRows:1},[]];
  }
  throw Error('Unknown SQL '+q);
 }
 async getConnection(){const old={tags:structuredClone(this.tags),links:{master:structuredClone(this.links.master),colorway:structuredClone(this.links.colorway)}};
  return {query:this.query.bind(this),beginTransaction:async()=>{},commit:async()=>{this.commits++;},
   rollback:async()=>{this.tags=old.tags;this.links=old.links;this.rollbacks++;},release:()=>{}};
 }
}
const status=(code:number)=>(e:unknown)=>e instanceof TagError&&e.status===code;
test('P3-1b reuses shared value across normalization and scopes by dimension',async()=>{
 const db=new Db();
 const first=await createSharedTag(db,admin,'topic','  Ｆｌｏｗｅｒ ');
 const same=await createSharedTag(db,sales,'topic','flower');
 assert.equal(first.id,same.id);assert.equal(first.name,'Ｆｌｏｗｅｒ');
 const color=await createSharedTag(db,admin,'color','FLOWER');
 assert.notEqual(first.id,color.id);assert.equal(db.tags.length,2);
 assert.deepEqual((await listSharedTags(db,'topic')).map(t=>t.id),[first.id]);
});
test('P3-1b shared dictionary search honors NFKC and literal SQL wildcard text',async()=>{
 const db=new Db();
 const first=await createSharedTag(db,admin,'topic',' Flower%_ ');
 await createSharedTag(db,admin,'topic','Floral');
 assert.deepEqual((await listSharedTags(db,'topic',{search:'ｆＬｏＷＥＲ％＿'})).map(x=>x.id),[first.id]);
 assert.deepEqual(await listSharedTags(db,'topic',{search:'notfound'}),[]);
 assert(db.sql.some(q=>q.includes("LIKE ? ESCAPE '!'")),'search must treat input wildcards literally');
});
test('P3-1b invalid names fail closed and sales may govern tags with impact controls',async()=>{
 const db=new Db();
 for(const name of [' ','x'.repeat(33),'\u0000bad'])await assert.rejects(createSharedTag(db,sales,'topic',name),status(400));
 await assert.rejects(createSharedTag(db,sales,'style' as 'topic','x'),status(400));
 const item=await createSharedTag(db,admin,'topic','Floral');
 assert.equal((await renameSharedTag(db,sales,item.id,'New',0)).name,'New');
 assert.equal((await archiveSharedTag(db,sales,item.id)).isArchived,true);
 assert.equal(db.tags.length,1);
});
test('deleting a custom topic unlinks all matching masters while keeping unrelated topic and color links',async()=>{
 const db=new Db();
 const doomed=await createSharedTag(db,sales,'topic','手绘自定义1');
 const retained=await createSharedTag(db,sales,'topic','条纹');
 const color=await createSharedTag(db,sales,'color','红色');
 for(const masterId of ['10','11'])await replaceEntityTags(db,sales,'master',masterId,[doomed.id,retained.id]);
 await replaceEntityTags(db,sales,'masterColor','10',[color.id]);
 const preview=await previewTagImpact(db,doomed.id);
 assert.equal(preview.affectedCount,2);
 await assert.rejects(deleteCustomTopicTag(db,sales,doomed.id,1),status(409));
 assert.deepEqual((await readEntityTags(db,'master','10')).map(t=>t.name).sort(),['手绘自定义1','条纹'].sort());
 const removed=await deleteCustomTopicTag(db,sales,doomed.id,2);
 assert.equal(removed.affectedCount,2);assert.equal(removed.isArchived,true);
 assert.equal((await listSharedTags(db,'topic')).some(t=>t.id===doomed.id),false);
 for(const masterId of ['10','11'])assert.deepEqual((await readEntityTags(db,'master',masterId)).map(t=>t.id),[retained.id]);
 assert.deepEqual((await readEntityTags(db,'masterColor','10')).map(t=>t.id),[color.id]);
 await assert.rejects(replaceEntityTags(db,sales,'master','10',[doomed.id,retained.id]),status(409));
});
test('custom topic deletion refuses fixed 16 presets, other dimensions and invalid counts',async()=>{
 const db=new Db(),preset=await createSharedTag(db,sales,'topic','波点'),color=await createSharedTag(db,sales,'color','测试色'),tag=await createSharedTag(db,sales,'topic','自定义待删');
 await assert.rejects(deleteCustomTopicTag(db,sales,preset.id,0),status(400));
 await assert.rejects(deleteCustomTopicTag(db,sales,color.id,0),status(400));
 await assert.rejects(deleteCustomTopicTag(db,sales,tag.id,-1),status(400));
 assert.equal((await deleteCustomTopicTag(db,sales,tag.id,0)).isArchived,true);
 assert.equal((await deleteCustomTopicTag(db,sales,tag.id,0)).isArchived,true); // archived deletion is idempotent
});
test('older archived custom topics with live master links can be deleted and disappear from selectable dictionary',async()=>{
 const db=new Db(),tag=await createSharedTag(db,sales,'topic','旧的自定义题材');
 await replaceEntityTags(db,sales,'master','10',[tag.id]);
 await archiveSharedTag(db,sales,tag.id);
 const before=await listSharedTags(db,'topic',{includeArchived:true,linkedArchivedOnly:true});
 assert(before.some(x=>x.id===tag.id&&x.isArchived));
 const removed=await deleteCustomTopicTag(db,sales,tag.id,1);
 assert.equal(removed.isArchived,true);assert.equal(removed.affectedCount,1);
 assert.deepEqual(await readEntityTags(db,'master','10'),[]);
 const after=await listSharedTags(db,'topic',{includeArchived:true,linkedArchivedOnly:true});
 assert(!after.some(x=>x.id===tag.id));
});
test('custom topic unlink and archive rollback together on simulated DB failure',async()=>{
 const db=new Db(),tag=await createSharedTag(db,sales,'topic','测试回滚');
 await replaceEntityTags(db,sales,'master','10',[tag.id]);
 db.failArchive=true;
 await assert.rejects(deleteCustomTopicTag(db,sales,tag.id,1));
 assert.deepEqual((await readEntityTags(db,'master','10')).map(t=>t.id),[tag.id]);
 assert.equal((await previewTagImpact(db,tag.id)).isArchived,false);
});
test('P3-1b target kinds and label dimensions are exclusive, count 0..10',async()=>{
 const db=new Db();
 const topics=[];
 for(let i=0;i<11;i++)topics.push((await createSharedTag(db,admin,'topic','T'+i)).id);
 const color=(await createSharedTag(db,admin,'color','Blue')).id;
 await replaceEntityTags(db,sales,'master','10',topics.slice(0,10));
 assert.deepEqual(db.links.master.get('10'),topics.slice(0,10));
 assert.deepEqual((await readEntityTags(db,'master','10')).map(x=>x.id),topics.slice(0,10));
 await assert.rejects(replaceEntityTags(db,sales,'master','10',topics),status(400));
 await assert.rejects(replaceEntityTags(db,sales,'master','10',[color]),status(400));
 await assert.rejects(replaceEntityTags(db,sales,'colorway','20',[topics[0]]),status(400));
 assert.deepEqual(db.links.master.get('10'),topics.slice(0,10));
 await replaceEntityTags(db,sales,'master','10',[]);
 assert.deepEqual(db.links.master.get('10'),[]);
});
test('P3-1b archived links remain traceable but cannot be newly linked',async()=>{
 const db=new Db();
 const tag=await createSharedTag(db,admin,'color','米白');
 await replaceEntityTags(db,sales,'colorway','20',[tag.id]);
 await archiveSharedTag(db,admin,tag.id);
 assert.equal((await listSharedTags(db,'color')).length,0);
 assert.equal((await listSharedTags(db,'color',{includeArchived:true})).length,1);
 assert.equal((await readEntityTags(db,'colorway','20'))[0].isArchived,true);
 await replaceEntityTags(db,sales,'colorway','20',[tag.id]); // existing archived stays
 await assert.rejects(replaceEntityTags(db,sales,'colorway','21',[tag.id]),status(409));
 assert.deepEqual(db.links.colorway.get('20'),[tag.id]);
});
test('P3-1b invalid references and failed writes preserve associations; old grant ignored',async()=>{
 const db=new Db();const t=await createSharedTag(db,admin,'topic','Flower');
 for(const id of ['0','01','notid'])await assert.rejects(replaceEntityTags(db,sales,'master',id,[t.id]),status(400));
 await assert.rejects(replaceEntityTags(db,sales,'master','12',[t.id]),status(404));
 await assert.rejects(replaceEntityTags(db,sales,'master','10',[t.id,t.id]),status(400));
 db.grant=false;await replaceEntityTags(db,sales,'master','10',[t.id]);
 db.grant=true;assert.deepEqual(db.links.master.get('10'),[t.id]);
 db.failLink=true;const other=await createSharedTag(db,admin,'topic','New');
 await assert.rejects(replaceEntityTags(db,sales,'master','10',[other.id]));
 assert.deepEqual(db.links.master.get('10'),[t.id]);assert(db.rollbacks>0);
});
test('P3-1b rename preview and explicit impact confirmation protect all references',async()=>{
 const db=new Db();const tag=await createSharedTag(db,admin,'topic','Flower');
 await replaceEntityTags(db,sales,'master','10',[tag.id]);
 await replaceEntityTags(db,sales,'master','11',[tag.id]);
 assert.equal((await previewTagImpact(db,tag.id)).affectedCount,2);
 await assert.rejects(renameSharedTag(db,admin,tag.id,'Blossom',1),status(409));
 const renamed=await renameSharedTag(db,admin,tag.id,' BLOSSOM ',2);
 assert.equal(renamed.name,'BLOSSOM');assert.equal(renamed.affectedCount,2);
 assert.deepEqual(db.links.master.get('10'),[tag.id]);
});
test('P3-1b rename collision does not overwrite another shared value',async()=>{
 const db=new Db(),a=await createSharedTag(db,admin,'topic','Blue'),b=await createSharedTag(db,admin,'topic','Green');
 await assert.rejects(renameSharedTag(db,admin,b.id,'Ｂｌｕｅ',0),status(409));
 assert.equal(db.tags.find(x=>x.id===b.id)?.name,'Green');assert.equal(a.id,'1');
});

test('P3-1b admin merge replaces source associations, deduplicates and archives source identity',async()=>{
 const db=new Db();
 const source=await createSharedTag(db,admin,'topic','Old'),target=await createSharedTag(db,admin,'topic','New');
 await replaceEntityTags(db,sales,'master','10',[source.id,target.id]);
 await replaceEntityTags(db,sales,'master','11',[source.id]);
 const merged=await mergeSharedTags(db,admin,source.id,target.id,2);
 assert.equal(merged.affectedCount,2);assert.equal(merged.source.isArchived,true);
 assert.deepEqual(db.links.master.get('10'),[target.id]);
 assert.deepEqual(db.links.master.get('11'),[target.id]);
 assert.equal(db.tags.find(t=>t.id===source.id)?.is_archived,1);
});
test('P3-1b admin merge enforces target dimension, confirmation, ten-tag cap and rollback',async()=>{
 const db=new Db();
 const source=await createSharedTag(db,admin,'topic','A');
 const target=await createSharedTag(db,admin,'topic','B');
 const bad=await createSharedTag(db,admin,'color','Blue');
 await replaceEntityTags(db,sales,'master','10',[source.id]);
 await assert.rejects(mergeSharedTags(db,sales,source.id,bad.id,1),status(400));
 await assert.rejects(mergeSharedTags(db,admin,source.id,bad.id,1),status(400));
 await assert.rejects(mergeSharedTags(db,admin,source.id,target.id,0),status(409));
 const extras=[];
 for(let i=0;i<9;i++)extras.push((await createSharedTag(db,admin,'topic','X'+i)).id);
 await replaceEntityTags(db,sales,'master','10',[source.id,...extras]);
 db.failLink=true;
 await assert.rejects(mergeSharedTags(db,admin,source.id,target.id,1));
 assert.deepEqual(db.links.master.get('10'),[source.id,...extras]);
 assert.equal(db.tags.find(x=>x.id===source.id)?.is_archived,0);
 db.failLink=false;
 await mergeSharedTags(db,sales,source.id,target.id,1);
 assert.deepEqual(db.links.master.get('10'),[...extras,target.id]);
 assert.equal(db.links.master.get('10')?.length,10);
});
async function withHttp(db:Db,action:(base:string)=>Promise<void>){
 const app=express();app.use('/api/v2',createSharedTagsRouter(db,db));
 const server:Server=await new Promise((resolve,reject)=>{
  const s=app.listen(0,'127.0.0.1',()=>resolve(s));s.once('error',reject);
 });
 try{const addr=server.address();assert(addr&&typeof addr!=='string');
  await action('http://127.0.0.1:'+addr.port+'/api/v2');
 }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
}
async function call(base:string,path:string,method='GET',body?:unknown,auth=true){
 return fetch(base+path,{method,headers:{...(auth?{authorization:'Bearer '+'a'.repeat(64)}:{}),
  ...(body!==undefined?{'content-type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
}
test('P3-1b HTTP tags require login; both active roles may govern with confirmation',async()=>{
 const db=new Db();
 await withHttp(db,async base=>{
  assert.equal((await call(base,'/tags?dimension=topic','GET',undefined,false)).status,401);
  const created=await call(base,'/tags','POST',{dimension:'topic',name:'几何'});
  assert.equal(created.status,201);const tag=await created.json() as {id:string;name:string};
  assert.equal(tag.name,'几何');
  assert.equal((await call(base,'/pattern-masters/10/tags','PUT',{tagIds:[tag.id]})).status,200);
  const list=await call(base,'/pattern-masters/10/tags');
  assert.equal(list.status,200);
  assert.equal((await list.json() as {items:{id:string}[]}).items[0].id,tag.id);
  assert.equal((await call(base,'/tags/'+tag.id,'PATCH',{name:'新版',confirmAffectedCount:1})).status,200);
  db.grant=false;
  assert.equal((await call(base,'/tags','POST',{dimension:'topic',name:'共享'})).status,201);
  db.grant=true;db.httpRole='admin';
  const preview=await call(base,'/tags/'+tag.id+'/impact');
  assert.equal((await preview.json() as {affectedCount:number}).affectedCount,1);
  assert.equal((await call(base,'/tags/'+tag.id,'PATCH',{name:'新几何',confirmAffectedCount:1})).status,200);
  assert.equal((await call(base,'/tags/'+tag.id+'/archive','POST',{})).status,200);
  const sibling=await call(base,'/tags','POST',{dimension:'topic',name:'备选'});
  const next=await sibling.json() as {id:string};
  assert.equal((await call(base,'/tags/'+tag.id+'/merge','POST',{targetId:next.id,confirmAffectedCount:1})).status,200);
  assert.equal((await call(base,'/pattern-masters/11/tags','PUT',{tagIds:[tag.id]})).status,409);
  assert.equal((await call(base,'/pattern-masters/10/tags','GET')).status,200);
 });
});
test('HTTP deleting a custom topic requires auth and exact impact confirmation',async()=>{
 const db=new Db(),tag=await createSharedTag(db,sales,'topic','额外题材');
 await replaceEntityTags(db,sales,'master','10',[tag.id]);
 await withHttp(db,async base=>{
  assert.equal((await call(base,'/tags/'+tag.id+'/delete','POST',{confirmAffectedCount:1},false)).status,401);
  assert.equal((await call(base,'/tags/'+tag.id+'/delete','POST',{confirmAffectedCount:0})).status,409);
  assert.equal((await call(base,'/tags/'+tag.id+'/delete','POST',{confirmAffectedCount:1})).status,200);
  assert.deepEqual((await (await call(base,'/pattern-masters/10/tags')).json() as {items:unknown[]}).items,[]);
 });
});
test('P3-1b HTTP guards malformed input, dimensions and untrusted database errors',async()=>{
 const db=new Db();
 await withHttp(db,async base=>{
  assert.equal((await call(base,'/tags')).status,400);
  assert.equal((await call(base,'/tags?dimension=style')).status,400);
  assert.equal((await call(base,'/pattern-masters/0/tags')).status,400);
  const broken=await fetch(base+'/tags',{method:'POST',headers:{authorization:'Bearer '+'a'.repeat(64),'content-type':'application/json'},body:'{broken'});
  assert.equal(broken.status,400);assert.equal((await broken.text()).includes('<html>'),false);
  db.unavailable=true;const response=await call(base,'/tags?dimension=topic');
  assert.equal(response.status,503);assert.equal((await response.text()).includes('PRIVATE DB ERROR'),false);
 });
});
