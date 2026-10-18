import assert from 'node:assert/strict';
import test from 'node:test';
import {parseFabricCatalogQuery,searchFabricCatalog,FabricCatalogError} from './fabricCatalog';
import express from 'express';
import type {Server} from 'node:http';
import {hashSessionToken} from '../access/password';
import {createFabricRouter} from './fabricsRoutes';

test('independent fabric number/name/composition are AND conditions in count and page with literal wildcards',async()=>{
 const query=parseFabricCatalogQuery({fabricNo:'F%_',fabricName:'棉',composition:'麻'});
 const calls:{sql:string;params:unknown[]}[]=[];
 const db={async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>{calls.push({sql,params});return [sql.includes('COUNT(*)')?[{total:1}]:[],[]];}};
 await searchFabricCatalog(db,query);
 assert.equal(calls.length,2);
 for(const call of calls){assert.match(call.sql,/fabric_no LIKE.* AND fabric_name LIKE.* AND composition LIKE/);assert.deepEqual(call.params.slice(0,3),['%F!%!_%','%棉%','%麻%']);}
 for(const key of ['fabricNo','fabricName','composition'])assert.throws(()=>parseFabricCatalogQuery({[key]:['bad']}));
});

const row=(n:number)=>({
 id:String(n),fabric_no:'F'+String(n).padStart(4,'0'),fabric_name:n%2?'真丝雪纺':'棉麻混纺',
 composition:n%2?'100%真丝':'55%棉45%麻',weight_value:n%3?'16.500':null,
 weight_unit:n%3?'mm':null,width_value:n%4?'145.50':null,remark:null,
 is_active:n%13===0?0:1
});
class Db{
 all=Array.from({length:2100},(_,i)=>row(i+1));
 calls:{sql:string;params:unknown[]}[]=[];
 async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>{
  this.calls.push({sql,params});
  if(sql.includes('FROM v2_products WHERE fabric_id IN')){
   const ids=params.map(String);
   return [ids.filter(id=>Number(id)%7===0).map(id=>({owner_id:id,linked_count:'3'})),[]];
  }
  let matched=this.all.filter(r=>sql.includes('is_active=1')?r.is_active===1:true);
  if(sql.includes('fabric_no LIKE ?')){
   const needle=String(params[0]).slice(1,-1).replace(/!([!%_])/g,'$1').toLowerCase();
   matched=matched.filter(r=>[r.fabric_no,r.fabric_name,r.composition].some(x=>x.toLowerCase().includes(needle)));
  }
  if(sql.startsWith('SELECT COUNT(*) AS total'))return [[{total:String(matched.length)}],[]];
  if(sql.startsWith('SELECT id,fabric_no,')&&sql.includes('FROM v2_fabrics')){
   assert(sql.includes('ORDER BY fabric_no ASC,id ASC LIMIT ? OFFSET ?'));
   const limit=Number(params.at(-2)),offset=Number(params.at(-1));
   return [matched.slice(offset,offset+limit),[]];
  }
  throw Error('Unexpected SQL '+sql);
 }
}
test('P4-3 parses only approved keyword, active switch and bounded pagination',()=>{
 assert.deepEqual(parseFabricCatalogQuery({}),{query:'',includeInactive:false,limit:50,offset:0});
 assert.deepEqual(parseFabricCatalogQuery({query:'  雪纺 ',includeInactive:'true',limit:'25',offset:'50'}),
  {query:'雪纺',includeInactive:true,limit:25,offset:50});
 for(const input of [{query:['no','name']},{query:'x'.repeat(101)},{query:'\u0000bad'},
  {includeInactive:'false'},{limit:'0'},{limit:'101'},{offset:'-1'},
  {offset:'1000001'},{weightUnit:'gsm'},{widthMin:'50'},{status:'approved'}]){
  assert.throws(()=>parseFabricCatalogQuery(input),e=>e instanceof FabricCatalogError&&e.status===400);
 }
});
test('P4-3 2100 fabric fixture: server filters before paging, reports true total, 3 SQL on populated page',async()=>{
 const db=new Db();
 const q=parseFabricCatalogQuery({query:'F',limit:'25',offset:'50'});
 const page=await searchFabricCatalog(db,q);
 assert.equal(page.total,1939); // excludes floor(2100/13)=161 inactive
 assert.equal(page.items.length,25);
 assert.equal(page.items[0].fabricNo,'F0055');
 assert.equal(page.items[0].productCount,0);
 assert.equal(db.calls.length,3);
 assert(db.calls[0].sql.startsWith('SELECT COUNT(*) AS total'));
 assert(db.calls[1].sql.includes('LIMIT ? OFFSET ?'));
 assert(db.calls[2].sql.includes('GROUP BY fabric_id'));
 assert.equal(db.calls[2].params.length,25);
});
test('P4-3 count and item queries use exact same literal escaped % !_ keyword',async()=>{
 const db=new Db();
 const page=await searchFabricCatalog(db,parseFabricCatalogQuery({query:' %_! '}));
 assert.equal(page.total,0);assert.deepEqual(page.items,[]);
 assert.equal(db.calls.length,1);
 assert(db.calls[0].sql.includes("ESCAPE '!'"));
 assert.equal(db.calls[0].params[0],'%!%!_!!%');
});
test('P4-3 search Chinese fabric-name/composition and include inactive returns accurate counts',async()=>{
 const db=new Db();
 const name=await searchFabricCatalog(db,parseFabricCatalogQuery({query:'雪纺',includeInactive:'true',limit:'10'}));
 assert.equal(name.total,1050);assert.equal(name.items.length,10);
 const spec=await searchFabricCatalog(db,parseFabricCatalogQuery({query:'55%棉',includeInactive:'true',limit:'10'}));
 assert.equal(spec.total,1050);assert.equal(spec.items[0].composition,'55%棉45%麻');
});
test('P4-3 referenced fabric count is batched; includes zero products, no N+1',async()=>{
 const db=new Db();
 const page=await searchFabricCatalog(db,parseFabricCatalogQuery({includeInactive:'true',limit:'14'}));
 assert.equal(page.items[6].productCount,3);
 assert.equal(page.items[0].productCount,0);
 assert.equal(db.calls.length,3);
 const out=await searchFabricCatalog(db,parseFabricCatalogQuery({query:'zzz',includeInactive:'true'}));
 assert.equal(out.total,0);assert.equal(out.items.length,0);
 assert.equal(db.calls.length,4);
});
test('P4-3 offset beyond matched results preserves total but no extra SQL',async()=>{
 const db=new Db();
 const page=await searchFabricCatalog(db,parseFabricCatalogQuery({query:'雪纺',offset:'1500'}));
 assert.equal(page.total,969);
 assert.equal(page.items.length,0);assert.equal(db.calls.length,1);
});
test('P4-3 independent HTTP endpoint requires real Bearer and limits query to approved dimensions',async()=>{
 const fake=new Db(),app=express();
 const db={
  query:async(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>=>{
   if(sql.includes('JOIN v2_access_users')){
    if(params[0]!==hashSessionToken('a'.repeat(64)))return [[],[]];
    return [[{user_id:'2',username:'sales',display_name:'Sales',role:'sales',
     session_id:'9',can_manage_products:0,can_manage_own_orders:0}],[]];
   }
   return fake.query(sql,params);
  }
 };
 app.use('/api/v2',createFabricRouter(db,{getConnection:async()=>{
  throw Error('Writes disabled in this read-only HTTP test');
 }} as never));
 const server:Server=await new Promise((resolve,reject)=>{
  const live=app.listen(0,'127.0.0.1',()=>resolve(live));live.once('error',reject);
 });
 try{
  const address=server.address();assert(address&&typeof address!=='string');
  const base='http://127.0.0.1:'+address.port+'/api/v2/fabrics/catalog';
  const denied=await fetch(base);assert.equal(denied.status,401);
  const auth={authorization:'Bearer '+'a'.repeat(64)};
  const ok=await fetch(base+'?query='+encodeURIComponent('雪纺')+'&limit=10',{headers:auth});
  assert.equal(ok.status,200);
  const page=await ok.json() as {items:unknown[];total:number;limit:number;offset:number};
  assert.equal(page.total,969);assert.equal(page.items.length,10);assert.equal(page.limit,10);
  for(const q of ['weightUnit=mm','limit=200','includeInactive=false','search%5B%5D=hi']){
   const response=await fetch(base+'?'+q,{headers:auth});
   assert.equal(response.status,400,q);
  }
 }finally{
  await new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
 }
});
