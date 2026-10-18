import assert from 'node:assert/strict';
import test from 'node:test';
import {searchPatternCatalog,parsePatternCatalogQuery,loadPatternEditor,PatternCatalogError} from './patternCatalog';
import express from 'express';
import type {Server} from 'node:http';
import {hashSessionToken} from '../access/password';
import {createPatternMasterRouter} from './patternMastersRoutes';
type R={created_at?:string;id:string;master_no:string;is_active:number;next_colorway_no:string;topic:string[];versions:V[]};
type V={id:string;master_id:string;colorway_no:number;pattern_image_asset_id:string|null;remark:string;is_active:number;color:string[]};
const tag:Record<string,string>={'1':'花卉','2':'植物','3':'几何','11':'蓝色','12':'绿色'};
class Fake {
 masters:R[]=[];calls:{sql:string;params:unknown[]}[]=[];
 constructor(n=100){
  for(let i=1;i<=n;i++){
   const id=String(i);
   const versions:V[]=Array.from({length:21},(_,j)=>({id:String(i*100+j+1),
    master_id:id,colorway_no:j+1,pattern_image_asset_id:j===1?'a1111111-1111-4111-8111-111111111111':null,
    remark:j===0?'设计稿':'',is_active:j===2?0:1,color:j%2?['12']:['11']}));
   this.masters.push({created_at:new Date(Date.UTC(2026,9,1,0,0,n-i)).toISOString(),id,master_no:'M'+String(i).padStart(3,'0'),
    is_active:i%19===0?0:1,next_colorway_no:'22',
    topic:i%2?['1']:['2','3'],versions});
  }
 }
 async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>{
  this.calls.push({sql,params});
  let masters=this.masters.slice(),p=0;
  if(sql.includes('m.is_active=1'))masters=masters.filter(x=>x.is_active===1);
  if(sql.includes('LOWER(m.master_no) LIKE ?')){
   const term=String(params[p++]).slice(1,-1).replace(/!(.)/g,'$1').toLowerCase();
   masters=masters.filter(x=>x.master_no.toLowerCase().includes(term));
  }
  const topic=/mt\.tag_id IN \((\?(?:,\?)*)\)/.exec(sql);
  if(topic){
   assert(sql.includes('mt.master_id=m.id'));
   const ids=topic[1].split(',').map(()=>String(params[p++]));
   masters=masters.filter(m=>m.topic.some(x=>ids.includes(x)));
  }
  const full=/LOWER\(CONCAT\(m\.master_no,'-',c\.colorway_no\)\) LIKE \?/.test(sql);
  if(sql.includes('ct.master_id=m.id')){
   const color=/ct\.tag_id IN \((\?(?:,\?)*)\)/.exec(sql)!;
   const ids=color[1].split(',').map(()=>String(params[p++]));
   masters=masters.filter(master=>ids.includes(Number(master.id)%2?'11':'12'));
  }
  const versionFilters: {number?:string;numberSuffix?:number;colorwayNo?:number;tags?:string[]}={};
  if(full)versionFilters.number=String(params[p++]).slice(1,-1).toLowerCase();
  if(sql.includes('c.colorway_no=?'))versionFilters.colorwayNo=Number(params[p++]);
  const col=/ct\.tag_id IN \((\?(?:,\?)*)\)/.exec(sql);
  if(col&&!sql.includes('ct.master_id=m.id'))versionFilters.tags=col[1].split(',').map(()=>String(params[p++]));
  const matching=(m:R,v:V)=>{
   if(sql.includes('c.is_active=1')&&!v.is_active)return false;
   if(versionFilters.number&&!((m.master_no+'-'+v.colorway_no).toLowerCase().includes(versionFilters.number)))return false;
   if(versionFilters.colorwayNo&&v.colorway_no!==versionFilters.colorwayNo)return false;
   if(versionFilters.tags&&!v.color.some(x=>versionFilters.tags!.includes(x)))return false;
   return true;
  };
  if(sql.includes('EXISTS (SELECT 1 FROM pattern_colorways c')){
   masters=masters.filter(m=>m.versions.some(v=>matching(m,v)));
  }
  if(sql.startsWith('SELECT COUNT(*) AS total'))return [[{total:masters.length}],[]];
  if(sql.includes('FROM pattern_masters m')){
   assert(sql.includes('ORDER BY m.created_at DESC,m.id DESC LIMIT ? OFFSET ?'));
   const page=masters.sort((a,b)=>(b.created_at??'').localeCompare(a.created_at??'')||(BigInt(a.id)>BigInt(b.id)?-1:1));
   return [page.slice(Number(params.at(-1)),Number(params.at(-1))+Number(params.at(-2))).map(m=>({
    id:m.id,master_no:m.master_no,is_active:m.is_active,next_colorway_no:m.next_colorway_no
   })),[]];
  }
  if(sql.includes('FROM pattern_colorways c JOIN pattern_masters m')){
   const ids=params.slice(0,sql.includes('LOWER(CONCAT')||sql.includes('c.colorway_no=?')||sql.includes('ct.tag_id IN')?this.calls.at(-2)?.params.length??0:params.length);
   // Row-lookup uses IN owner IDs first, filter params after.
   const numIds=/c\.master_id IN \((\?(?:,\?)*)\)/.exec(sql)?.[1].split(',').length??0;
   const target=params.slice(0,numIds).map(String);
   const termParams=params.slice(numIds);
   let idx=0;
   const term=sql.includes('LOWER(CONCAT')?String(termParams[idx++]).slice(1,-1).replace(/!(.)/g,'$1').toLowerCase():undefined;
   const cNo=sql.includes('c.colorway_no=?')?Number(termParams[idx++]):undefined;
   const cTags=sql.includes('ct.tag_id IN')?termParams.slice(idx).map(String):[];
   const all=this.masters.filter(m=>target.includes(m.id)).flatMap(m=>m.versions.filter(v=>
    (!sql.includes('c.is_active=1')||v.is_active)&&(!term||(m.master_no+'-'+v.colorway_no).toLowerCase().includes(term))&&
    (!cNo||v.colorway_no===cNo)&&(!cTags.length||v.color.some(t=>cTags.includes(t)))
   ).map(v=>({...v,master_no:m.master_no})));
   return [all,[]];
  }
  if(sql.includes('FROM pattern_master_tag_links l')){
   const ids=params.map(String);
   return [this.masters.filter(m=>ids.includes(m.id)).flatMap(m=>(sql.includes("dimension='color'")?[Number(m.id)%2?'11':'12']:m.topic).map(t=>({
    owner_id:m.id,id:t,name:tag[t],is_archived:0
   }))),[]];
  }
  if(sql.includes('FROM pattern_colorway_tag_links l')){
   const ids=params.map(String);
   return [this.masters.flatMap(m=>m.versions.filter(v=>ids.includes(v.id)).flatMap(v=>v.color.map(t=>({
    owner_id:v.id,id:t,name:tag[t],is_archived:t==='12'?1:0
   })))),[]];
  }
  throw Error('Unexpected SQL '+sql);
 }
}
const parse=(v:Record<string,unknown>)=>parsePatternCatalogQuery(v);
test('P4-2 parser normalizes and blocks unknown/unsupported filters, bad limits and extra dimensions',()=>{
 assert.deepEqual(parse({}),{number:'',colorwayNo:null,topicTagIds:[],colorTagIds:[],includeInactive:false,limit:20,offset:0});
 assert.deepEqual(parse({number:' m002-3 ',colorwayNo:'3',topicTagIds:'1,2',colorTagIds:'11,12',includeInactive:'true',limit:'5',offset:'20'}),{
  number:'m002-3',colorwayNo:3,topicTagIds:['1','2'],colorTagIds:['11','12'],
  includeInactive:true,limit:5,offset:20
 });
 for(const input of [{number:['M','1']},{number:'x'.repeat(200)},{review:'approved'},{colorwayNo:'0'},
  {colorwayNo:'3.5'},{limit:'51'},{offset:'-1'},{includeInactive:'false'},
  {topicTagIds:'1,invalid'},{colorTagIds:'0'},{topicTagIds:Array.from({length:11},(_,i)=>i+1).join(',')}])
  assert.throws(()=>parse(input),e=>e instanceof PatternCatalogError&&e.status===400);
});
test('P4-2 2100 versions: master pages, batch active visible versions and parent tags, <=5 SQL, no N+1',async()=>{
 const db=new Fake();
 const page=await searchPatternCatalog(db,parse({number:'M',limit:'20',offset:'20'}));
 assert.equal(page.total,95);
 assert.equal(page.items.length,20);
 assert(page.items.every(m=>m.versions.length===20&&!m.versions.some(v=>v.colorwayNo===3)));
 assert(page.items.every(m=>m.topicTags.length>0));
 assert(page.items[0].versions[0].colorTags.length>0);
 assert(db.calls.length===5);
 assert(db.calls[0].sql.startsWith('SELECT COUNT(*) AS total'));
 assert(db.calls[1].sql.includes('LIMIT ? OFFSET ?'));
 assert(db.calls[2].sql.includes('c.master_id IN'));
});
test('colors filter the pattern master and do not prune differently colored versions',async()=>{
 const db=new Fake(2);
 const result=await searchPatternCatalog(db,parse({colorTagIds:'11'}));
 const where=db.calls[0].sql;
 assert.match(where,/pattern_master_tag_links ct/);assert.match(where,/ct\.master_id=m\.id/);
 assert(!where.includes('ct.colorway_id=c.id'));
 assert(result.items.every(master=>Array.isArray(master.colorTags)));
 const versionQuery=db.calls.find(call=>call.sql.includes('FROM pattern_colorways c JOIN'))!;
 assert(!versionQuery.sql.includes('ct.tag_id IN'),'parent color does not hide sibling versions');
});
test('pattern-level colors filter the parent and preserve all matching numbered sibling versions',async()=>{
 const db=new Fake();
 const result=await searchPatternCatalog(db,parse({number:'M002-',topicTagIds:'2,3',colorTagIds:'12',includeInactive:'true'}));
 assert.equal(result.total,1);
 assert.equal(result.items[0].masterNo,'M002');
 assert(result.items[0].versions.every(v=>v.colorTags.some(t=>t.name==='绿色')));
 assert.equal(result.items[0].versions.length,21);
 assert(result.items[0].versions.every(v=>v.patternNo.startsWith('M002-')));
 assert(result.items[0].versions.some(v=>v.patternImageAssetId));
});
test('P4-2 version no exact match should return no master; empty list is single count',async()=>{
 const db=new Fake();
 const page=await searchPatternCatalog(db,parse({number:'M001-999',includeInactive:'true'}));
 assert.equal(page.total,0);assert.deepEqual(page.items,[]);
 assert.equal(db.calls.length,1);
});
test('P4-2 inactive mother/status and version number filter do not resurrect inactive siblings by default',async()=>{
 const db=new Fake();
 const noInactive=await searchPatternCatalog(db,parse({colorwayNo:'3'}));
 assert.equal(noInactive.total,0);
 const all=await searchPatternCatalog(db,parse({colorwayNo:'3',includeInactive:'true',limit:'10'}));
 assert.equal(all.total,100);
 assert.equal(all.items.length,10);
 assert(all.items.every(m=>m.versions.length===1&&m.versions[0].colorwayNo===3&&!m.versions[0].isActive));
});
test('P4-2 selected mother edit loads all 21 versions in 3 batched queries and keeps archived tags',async()=>{
 const calls:string[]=[];
 const db={async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>{
  calls.push(sql);
  if(sql.includes('FROM pattern_masters WHERE id=?'))
   return [[{id:'2',master_no:'M002',next_colorway_no:'22'}],[]];
  if(sql.includes('FROM pattern_colorways WHERE master_id=?'))
   return [Array.from({length:21},(_,i)=>({id:String(201+i),master_id:'2',
    colorway_no:i+1,pattern_image_asset_id:null,remark:i===3?'配色备注':'',is_active:i===2?0:1})),[]];
  if(sql.includes('FROM pattern_master_tag_links l')){
   assert.deepEqual(params,['2']);
   return [[{owner_id:'2',id:'12',name:'绿色',is_archived:1}],[]];
  }
  throw Error('unexpected SQL');
 }};
 const page=await loadPatternEditor(db,'2');
 assert.equal(page.nextColorwayNo,22);
 assert.equal(page.items.length,21);assert.equal(calls.length,3);
 assert.equal(page.items[1].patternNo,'M002-2');
 assert.deepEqual(page.items[1].colorTags,[{id:'12',name:'绿色',isArchived:true}]);
 assert(!page.items[2].isActive);
 await assert.rejects(loadPatternEditor(db,'0'),e=>e instanceof PatternCatalogError&&e.status===400);
});
test('P4-2 selected mother edit does not call tag query when no versions, missing master 404',async()=>{
 const calls:string[]=[];
 const db={async query(sql:string):Promise<[unknown,unknown]>{
  calls.push(sql);
  if(sql.includes('FROM pattern_masters WHERE id=?'))return [[{id:'21',master_no:'M021',next_colorway_no:'1'}],[]];
  if(sql.includes('FROM pattern_colorways WHERE master_id=?'))return [[],[]];
  throw Error('unexpected query');
 }};
 const detail=await loadPatternEditor(db,'21');
 assert.deepEqual(detail.items,[]);assert.equal(detail.nextColorwayNo,1);
 assert.equal(calls.length,2);
 const missing={async query():Promise<[unknown,unknown]>{return [[],[]];}};
 await assert.rejects(loadPatternEditor(missing,'22'),e=>e instanceof PatternCatalogError&&e.status===404);
});
test('P4-2 isolated HTTP matrix and edit endpoints require Bearer and reject unsupported filters',async()=>{
 const fake=new Fake(),app=express();
 const db={query:async(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>=>{
  if(sql.includes('JOIN v2_access_users')){
   return params[0]===hashSessionToken('a'.repeat(64))?
    [[{user_id:'2',role:'sales',username:'sales',display_name:'Sales',can_manage_products:0,
      can_manage_own_orders:0,session_id:'9'}],[]]:[[],[]];
  }
  if(sql.includes('FROM pattern_masters WHERE id=?'))
   return [[{id:'1',master_no:'M001',next_colorway_no:'22'}],[]];
  if(sql.includes('FROM pattern_colorways WHERE master_id=?'))
   return [fake.masters[0].versions.map(({color,...v})=>v),[]];
  return fake.query(sql,params);
 }};
 app.use('/api/v2',createPatternMasterRouter(db,{getConnection:async()=>{throw Error('No write');}} as never));
 const server:Server=await new Promise((resolve,reject)=>{const live=app.listen(0,'127.0.0.1',()=>resolve(live));live.once('error',reject);});
 try{
  const address=server.address();assert(address&&typeof address!=='string');
  const url='http://127.0.0.1:'+address.port+'/api/v2';
  const noAuth=await fetch(url+'/pattern-catalog');assert.equal(noAuth.status,401);
  const headers={authorization:'Bearer '+'a'.repeat(64)};
  const results=await fetch(url+'/pattern-catalog?number=M&limit=3',{headers});
  assert.equal(results.status,200);
  const data=await results.json() as {total:number;items:unknown[]};
  assert.equal(data.items.length,3);assert.equal(data.total,95);
  const editor=await fetch(url+'/pattern-masters/1/colorway-details',{headers});
  assert.equal(editor.status,200);
  const values=await editor.json() as {items:unknown[];nextColorwayNo:number};
  assert.equal(values.items.length,21);assert.equal(values.nextColorwayNo,22);
  for(const q of ['limit=100','colorwayNo=-1','dimension=unknown']){
   const response=await fetch(url+'/pattern-catalog?'+q,{headers});
   assert.equal(response.status,400,q);
  }
  const rejected=await fetch(url+'/pattern-masters/0/colorway-details',{headers});
  assert.equal(rejected.status,400);
 }finally{await new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve()));}
});

test('pattern catalog pages by creation descending with descending identity ties',async()=>{
 const db=new Fake(3);db.masters[0].created_at='2026-10-18T00:00:00Z';db.masters[1].created_at=db.masters[2].created_at='2026-10-19T00:00:00Z';const first=await searchPatternCatalog(db,parse({limit:'2',offset:'0'})),second=await searchPatternCatalog(db,parse({limit:'2',offset:'2'}));assert.deepEqual(first.items.map(x=>x.id),['3','2']);assert.deepEqual(second.items.map(x=>x.id),['1']);assert.equal(first.total,3);
 assert(db.calls.find(x=>x.sql.includes('LIMIT ? OFFSET ?'))!.sql.includes('ORDER BY m.created_at DESC,m.id DESC LIMIT ? OFFSET ?'));
});
