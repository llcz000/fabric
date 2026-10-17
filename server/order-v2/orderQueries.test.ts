import test from 'node:test';
import assert from 'node:assert/strict';
import {listScopedOrders,statsScopedOrders,parseScopedOrderFilters,OrderSearchError} from './orderQueries';
import type {AppPrincipal} from '../access/types';
const actor:AppPrincipal={userId:'200',role:'sales',username:'s',displayName:'s',sessionId:'3',canManageProducts:false,canManageOwnOrders:false};
class Fake{
 sql:{sql:string;args:unknown[]}[]=[];
 async query(sql:string,args:unknown[]=[]):Promise<[unknown,unknown]>{
  this.sql.push({sql,args});
  if(sql.endsWith('ORDER BY meters_total DESC,product_name ASC LIMIT 5'))return [[],[]];
  if(sql.includes('ORDER BY o.order_date DESC,o.id DESC LIMIT 4'))return [[],[]];
  if(sql.includes('COUNT(*) AS total'))return [[{total:1}],[]];
  if(sql.includes('FROM orders o')&&sql.includes('ORDER BY'))return [[{
   id:'47',order_no:'XS0047',order_date:'2026-10-12',receiving_unit:'客户A',
   template_type:'bulk',deposit:'20',total_meters:'10',total_pieces:2,total_amount:'250',
   created_by_user_id:'200',settled:1
  }],[]];
  if(sql.includes('SUM('))return [[{order_count:2,amount_total:'500.00',meters_total:'33.00',
   sample_count:1,sample_meters:'8',sample_amount:'100',bulk_count:1,bulk_meters:'25',bulk_amount:'400',
   deposit_count:0,deposit_meters:0,deposit_contract_amount:0}],[]];
  throw Error('Unexpected query: '+sql);
 }
}

test('QUERY-01 validates customer, productNo, colorNo, productName and settled filters',()=>{
 const parsed=parseScopedOrderFilters({customer:'  客户甲 ',productNo:' P_01 ',colorNo:' 12 ',productName:' 棉 ',settled:'false',limit:'15'});
 assert.equal(parsed.customer,'客户甲');assert.equal(parsed.productNo,'P_01');
 assert.equal(parsed.colorNo,'12');assert.equal(parsed.productName,'棉');
 assert.equal(parsed.settled,false);assert.equal(parsed.limit,15);
 assert.equal(parseScopedOrderFilters({settled:'true'}).settled,true);
 assert.equal(parseScopedOrderFilters({type:'sales'}).type,'bulk');
 for(const bad of [{settled:'yes'},{settled:false},{customer:33},{productNo:'A'.repeat(102)},
  {colorNo:'a'+String.fromCharCode(1)},{productName:['bad']},{customer:'%'.repeat(102)}])
  assert.throws(()=>parseScopedOrderFilters(bad),OrderSearchError);
});
test('QUERY-02 count and page use one correlated EXISTS across ALL item criteria; owner and wildcard escape intact',async()=>{
 const calls:{sql:string;args:unknown[]}[]=[];
 const db={async query(sql:string,args:unknown[]=[]):Promise<[unknown,unknown]>{
  calls.push({sql,args});if(sql.includes('COUNT(*) AS total'))return [[{total:0}],[]];
  throw Error('Unexpected SQL');
 }};
 await listScopedOrders(db,actor,parseScopedOrderFilters({
  customer:'客_户%',productNo:'货_号',colorNo:'红%',productName:'棉\\_',settled:'false'
 }));
 assert.equal(calls.length,1);
 const {sql,args}=calls[0];
 assert.match(sql,/o\.created_by_user_id = \?/);
 assert.match(sql,/o\.receiving_unit LIKE \?/);
 assert.match(sql,/o\.settled=\?/);
 assert.equal(sql.split('EXISTS (SELECT 1 FROM order_items i WHERE i.order_id=o.id').length-1,1);
 for(const field of ['product_no','color_no','product_name'])assert(sql.includes('i.'+field+' LIKE ?'));
 assert(!sql.includes('JOIN order_items i ON'),'count cannot be inflated by multiple lines');
 assert.deepEqual(args,['200','%客\\_户\\%%',0,'%货\\_号%','%红\\%%','%棉\\\\\\_%']);
});
test('QUERY-03 matching totals aggregate only qualified lines, exclude deposit and prepayment, preserve owner scope',async()=>{
 const calls:{sql:string;args:unknown[]}[]=[];
 const db={async query(sql:string,args:unknown[]=[]):Promise<[unknown,unknown]>{
  calls.push({sql,args});
  return [[{matching_line_count:2,meters_total:'13.00',amount_total:'260.00',pieces_total:3}],[]];
 }};
 const {summarizeMatchingOrderItems}=await import('./orderQueries');
 const result=await summarizeMatchingOrderItems(db,actor,parseScopedOrderFilters({
  customer:'客户',productNo:'P7',colorNo:'1',productName:'棉',type:'bulk',settled:'true'
 }));
 assert.deepEqual(result,{matchingLineCount:2,metersTotal:13,amountTotal:260,piecesTotal:3});
 assert.equal(calls.length,1);
 const {sql,args}=calls[0];
 assert.match(sql,/JOIN order_items i ON i\.order_id=o\.id/);
 assert.match(sql,/o\.created_by_user_id = \?/);
 assert.match(sql,/o\.template_type<>'deposit'/);
 assert.match(sql,/JSON_LENGTH\(i\.piece_meters\)/);
 assert(!sql.includes('SUM(o.deposit)'), 'deposit percentage or prepayment must never be summed');
 assert.equal(args[0],'200');
 for(const field of ['product_no','color_no','product_name'])assert(sql.includes('i.'+field+' LIKE ?'));
});
test('STATS-01 count each type separately; combined total excludes deposit contracts and prepayments',async()=>{
 let sql='',args:unknown[]=[];
 const db={async query(q:string,a:unknown[]=[]):Promise<[unknown,unknown]>{
  if(q.endsWith('ORDER BY meters_total DESC,product_name ASC LIMIT 5')||
   q.endsWith('ORDER BY o.order_date DESC,o.id DESC LIMIT 4'))return [[],[]];
  assert(q.startsWith('SELECT COUNT(*) AS order_count'),'unexpected summary SQL');
  sql=q;args=a;
  return [[{order_count:5,amount_total:'300',meters_total:'15',
   sample_count:2,sample_meters:'5',sample_amount:'100',
   bulk_count:2,bulk_meters:'10',bulk_amount:'200',
   deposit_count:1,deposit_meters:'9',deposit_contract_amount:'500'}],[]];
 }};
 const summary=await statsScopedOrders(db,actor,{from:'2026-10-01',to:'2026-10-31'});
 assert.equal(summary.amountTotal,300);
 assert.equal(summary.metersTotal,15);
 assert.deepEqual(summary.byType,{
  sample:{count:2,meters:5,amount:100},
  bulk:{count:2,meters:10,amount:200},
  deposit:{count:1,meters:9,contractAmount:500}
 });
 assert.match(sql,/CASE WHEN o\.template_type IN \('sample','bulk'\)/);
 assert(!/SUM\(o\.deposit\)/.test(sql));
 assert(sql.includes('o.created_by_user_id = ?'));
 assert.deepEqual(args,['200','2026-10-01','2026-10-31']);
});

test('QUERY-01/03 isolated HTTP enforces live bearer, owner scope and rejects invalid filters',async()=>{
 const express=(await import('express')).default;
 const {createV2DocumentRouter}=await import('./documentRoutes');
 const calls:{sql:string;params:unknown[]}[]=[];
 const db={
  async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>{
   calls.push({sql,params});
   if(sql.includes('JOIN v2_access_users u'))return [[{
    user_id:200,username:'s',display_name:'s',role:'sales',
    can_manage_products:0,can_manage_own_orders:0,session_id:3
   }],[]];
   if(sql.includes('matching_line_count'))return [[{
    matching_line_count:1,meters_total:'3.50',amount_total:'70.00',pieces_total:2
   }],[]];
   if(sql.includes('COUNT(*) AS total'))return [[{total:0}],[]];
   throw Error('Unexpected SQL');
  }
 };
 const app=express();
 app.use('/api/v2',createV2DocumentRouter(db as never));
 const server=await new Promise<import('node:http').Server>(resolve=>{
  const http=app.listen(0,'127.0.0.1',()=>resolve(http));
 });
 try{
  const addr=server.address();assert(addr&&typeof addr!=='string');
  const url='http://127.0.0.1:'+addr.port+'/api/v2/documents/matching-totals';
  const q='?customer='+encodeURIComponent('客户A')+'&productNo=P1&settled=true';
  assert.equal((await fetch(url+q)).status,401,'no public report');
  const token='a'.repeat(64);
  const invalid=await fetch(url+'?settled=invalid',{headers:{authorization:'Bearer '+token}});
  assert.equal(invalid.status,400);
  const response=await fetch(url+q,{headers:{authorization:'Bearer '+token}});
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{
   matchingLineCount:1,metersTotal:3.5,amountTotal:70,piecesTotal:2
  });
  const business=calls.filter(x=>x.sql.includes('matching_line_count'));
  assert.equal(business.length,1);
  assert.match(business[0].sql,/o\.created_by_user_id = \?/);
  assert.deepEqual(business[0].params.slice(0,2),['200','%客户A%']);
 }finally{
  await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
 }
});
test('P2-3b owner scope applies to order count/page search and stats, no reads of legacy JSON',async()=>{
 const db=new Fake();
 const query=await listScopedOrders(db,actor,{limit:10,offset:0,orderNo:'XS%_',type:'bulk'});
 assert.equal(query.total,1);assert.equal(query.items[0].id,'47');
 assert.equal(query.items[0].ownerId,'200');
 assert.equal(db.sql.length,2);
 for(const call of db.sql) {
  assert.match(call.sql,/o\.created_by_user_id = \?/);
  assert(!call.sql.includes('1=1'));
  assert.deepEqual(call.args.slice(0,1),['200']);
  assert(call.args.includes('%XS\\%\\_%'));
 }
 const totals=await statsScopedOrders(db,actor,{from:'2026-10-01',to:'2026-10-31'});
 assert.deepEqual(totals,{orderCount:2,amountTotal:500,metersTotal:33,byType:{
  sample:{count:1,meters:8,amount:100},bulk:{count:1,meters:25,amount:400},
  deposit:{count:0,meters:0,contractAmount:0}
 },topProducts:[],recentOrders:[]});
 assert(db.sql.at(-1)?.sql.includes('o.created_by_user_id = ?'));
});
test('P2-3b admin can view unknown-owner legacy orders, sales scope cannot by construction',async()=>{
 const db=new Fake();
 const admin={...actor,role:'admin' as const,canManageOwnOrders:true};
 await listScopedOrders(db,admin,{limit:20,offset:0});
 assert(db.sql.every(x=>!x.sql.includes('o.created_by_user_id = ?')));
 assert(db.sql.every(x=>x.sql.includes('WHERE 1=1')));
});
test('P2-3b rejects unknown keys, huge ranges, unbounded limit, invalid dates and unauthenticated actor',async()=>{
 for(const input of [{limit:'100'},{offset:'-1'},{limit:'NaN'},{other:'x'},
  {type:'other'},{from:'2026-02-31'},{to:'2026-10-01',from:'2026-11-01'},
  {orderNo:9},{orderNo:'A'.repeat(102)}])
  assert.throws(()=>parseScopedOrderFilters(input),OrderSearchError);
 const db=new Fake();
 await assert.rejects(listScopedOrders(db,null,{limit:20,offset:0}),/Unauthenticated/);
 assert.equal(db.sql.length,0);
});

/** SQL-contract fixture: rejects unrecognized queries. It does not emulate
 * MySQL aggregation, collation, or execution plans; those remain a real-DB gate. */
class StatsDb extends Fake{
 topRows:Record<string,unknown>[]=[
  {product_name:'棉麻',meters_total:'125.50'},
  {product_name:'雪纺',meters_total:'100.00'},
  {product_name:'未命名的面料',meters_total:'25.00'},
  {product_name:'针织',meters_total:'20.25'},
  {product_name:'印花',meters_total:'0.00'}
 ];
 recentRows:Record<string,unknown>[]=[
  {id:'9007199254740993',order_no:'YB001',order_date:new Date('2026-10-15T00:00:00Z'),
   receiving_unit:'测试客户',template_type:'sample',total_meters:'5.25',total_amount:'10.50'},
  {id:'8',order_no:'XS002',order_date:'2026-10-15',receiving_unit:'测试客户',
   template_type:'bulk',total_meters:'20.00',total_amount:'300.00'},
  {id:'99',order_no:'DJ003',order_date:'2026-10-14',receiving_unit:null,
   template_type:'deposit',total_meters:'9.00',total_amount:'900.00'},
  {id:'7',order_no:'YB004',order_date:'2026-10-13',receiving_unit:'测试客户',
   template_type:'sample',total_meters:'1.00',total_amount:'2.00'}
 ];
 empty=false;failRanking=false;
 override async query(sql:string,args:unknown[]=[]):Promise<[unknown,unknown]>{
  if(sql.endsWith('ORDER BY meters_total DESC,product_name ASC LIMIT 5')){
   this.sql.push({sql,args});
   if(this.failRanking)throw Error('private database connection details');
   return [this.topRows,[]];
  }
  if(sql.includes('ORDER BY o.order_date DESC,o.id DESC LIMIT 4')){
   this.sql.push({sql,args});return [this.recentRows,[]];
  }
  if(this.empty&&sql.startsWith('SELECT COUNT(*) AS order_count')){
   this.sql.push({sql,args});return [[{order_count:0}],[]];
  }
  return super.query(sql,args);
 }
}
test('STATS-01 adds database-bounded Top5 by saved product name and latest four navigable documents',async()=>{
 const db=new StatsDb();
 const result=await statsScopedOrders(db,actor);
 assert.deepEqual(result.topProducts,[
  {productName:'棉麻',meters:125.5},{productName:'雪纺',meters:100},
  {productName:'未命名的面料',meters:25},{productName:'针织',meters:20.25},
  {productName:'印花',meters:0}
 ]);
 assert.deepEqual(result.recentOrders,[
  {id:'9007199254740993',orderNo:'YB001',date:'2026-10-15',receivingUnit:'测试客户',type:'sample',totalMeters:5.25,totalAmount:10.5},
  {id:'8',orderNo:'XS002',date:'2026-10-15',receivingUnit:'测试客户',type:'bulk',totalMeters:20,totalAmount:300},
  {id:'99',orderNo:'DJ003',date:'2026-10-14',receivingUnit:'',type:'deposit',totalMeters:9,totalAmount:900},
  {id:'7',orderNo:'YB004',date:'2026-10-13',receivingUnit:'测试客户',type:'sample',totalMeters:1,totalAmount:2}
 ]);
 const rank=db.sql.find(c=>c.sql.includes('GROUP BY'))!;
 assert(rank,'ranking must aggregate in the database');
 assert.match(rank.sql,/COALESCE\(NULLIF\(TRIM\(i\.product_name\),''\),'未命名的面料'\) AS product_name/);
 assert.match(rank.sql,/SUM\(i\.meters\)/);
 assert.match(rank.sql,/JOIN order_items i ON i\.order_id=o\.id/);
 assert.match(rank.sql,/GROUP BY COALESCE\(NULLIF\(TRIM\(i\.product_name\),''\),'未命名的面料'\) ORDER BY meters_total DESC,product_name ASC LIMIT 5$/,
  'group the normalized expression; a product_name alias can collide with the physical column');
 assert(!rank.sql.includes('v2_products'),'saved document names must not follow current catalog changes');
 assert(!rank.sql.includes('deposit'),'ranking meters must not aggregate deposit money or drop a document type');
 const recent=db.sql.find(c=>c.sql.includes('LIMIT 4'))!;
 assert.match(recent.sql,/ORDER BY o\.order_date DESC,o\.id DESC LIMIT 4$/);
 assert(!recent.sql.includes('JOIN order_items'),'one recent document per header, regardless of line count');
 assert(!recent.sql.includes('o.deposit'),'no prepayment or percentage exposed as an aggregate');
});
test('STATS-02 summary, Top5 and recent documents all use the same server owner/date scope',async()=>{
 for(const role of ['sales','admin'] as const){
  const db=new StatsDb();
  await statsScopedOrders(db,{...actor,role},{from:'2026-10-01',to:'2026-10-15'});
  assert.equal(db.sql.length,3,'one summary, one ranking, one recent query');
  for(const call of db.sql){
   assert.equal(call.sql.includes('o.created_by_user_id = ?'),role==='sales',call.sql);
   assert.match(call.sql,/o\.order_date>=\? AND o\.order_date<=\?/);
   assert.deepEqual(call.args,role==='sales'?['200','2026-10-01','2026-10-15']:['2026-10-01','2026-10-15']);
  }
 }
});
test('STATS-01 empty statistics have zero summary and empty ranking/recent lists; anonymous actor reads nothing',async()=>{
 const db=new StatsDb();db.empty=true;db.topRows=[];db.recentRows=[];
 assert.deepEqual(await statsScopedOrders(db,actor),{
  orderCount:0,amountTotal:0,metersTotal:0,byType:{
   sample:{count:0,meters:0,amount:0},bulk:{count:0,meters:0,amount:0},
   deposit:{count:0,meters:0,contractAmount:0}
  },topProducts:[],recentOrders:[]
 });
 db.sql=[];
 await assert.rejects(statsScopedOrders(db,null),/Unauthenticated/);
 assert.equal(db.sql.length,0);
});
test('STATS-01 invalid meter/amount values fail the entire report instead of sending NaN or partial success',async()=>{
 for(const value of ['bad','-1','Infinity']){
  const rankDb=new StatsDb();rankDb.topRows[0].meters_total=value;
  await assert.rejects(statsScopedOrders(rankDb,actor),/Invalid statistics/);
  for(const field of ['total_meters','total_amount']){
   const recentDb=new StatsDb();recentDb.recentRows[0][field]=value;
   await assert.rejects(statsScopedOrders(recentDb,actor),/Invalid statistics/);
  }
 }
});
test('STATS-01/02 real HTTP returns scoped Top5/recent, rejects owner injection and rechecks the login',async()=>{
 const express=(await import('express')).default;
 const {createV2DocumentRouter}=await import('./documentRoutes');
 const {hashSessionToken}=await import('../access/password');
 const db=new StatsDb();let live=true;
 const salesToken='a'.repeat(64),adminToken='b'.repeat(64);
 const database={async query(sql:string,args:unknown[]=[]):Promise<[unknown,unknown]>{
  if(sql.includes('JOIN v2_access_users u')){
   const role=args[0]===hashSessionToken(adminToken)?'admin':'sales';
   assert.match(sql,/s\.revoked_at IS NULL/);assert.match(sql,/u\.is_active=1/);
   return [live?[{user_id:'200',username:'test',display_name:'test',role,
    can_manage_products:0,can_manage_own_orders:0,session_id:3}]:[],[]];
  }
  return db.query(sql,args);
 }};
 const app=express();app.use('/api/v2',createV2DocumentRouter(database as never));
 const server=await new Promise<import('node:http').Server>(resolve=>{
  const http=app.listen(0,'127.0.0.1',()=>resolve(http));
 });
 try{
  const address=server.address();assert(address&&typeof address!=='string');
  const url='http://127.0.0.1:'+address.port+'/api/v2/documents/stats';
  assert.equal((await fetch(url)).status,401);assert.equal(db.sql.length,0);
  for(const token of [salesToken,adminToken]){
   db.sql=[];const headers={authorization:'Bearer '+token};
   for(const invalid of ['?ownerId=999','?productName=棉','?limit=100','?from=2026-02-31','?from=2026-10-16&to=2026-10-01'])
    assert.equal((await fetch(url+invalid,{headers})).status,400);
   assert.equal(db.sql.length,0,'invalid requests cannot reach business data');
   const response=await fetch(url+'?from=2026-10-01&to=2026-10-15',{headers});
   assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
   const body=await response.json() as {topProducts:unknown[];recentOrders:{id:string}[]};
   assert.equal(body.topProducts.length,5);assert.equal(body.recentOrders.length,4);
   assert.equal(body.recentOrders[0].id,'9007199254740993');
   assert.equal(db.sql.length,3);
   for(const call of db.sql)assert.deepEqual(call.args,token===salesToken?
    ['200','2026-10-01','2026-10-15']:['2026-10-01','2026-10-15']);
  }
  live=false;db.sql=[];
  assert.equal((await fetch(url,{headers:{authorization:'Bearer '+salesToken}})).status,401);
  assert.equal(db.sql.length,0,'revoked/disabled login cannot read any report query');
  live=true;db.failRanking=true;
  const failed=await fetch(url,{headers:{authorization:'Bearer '+salesToken}});
  assert.equal(failed.status,503);
  assert.deepEqual(await failed.json(),{error:'Document service temporarily unavailable'});
 }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});

test('QUERY-01 list sorts by business date then id; settled scope excludes deposit contracts',async()=>{
 const db=new Fake();
 const page=await listScopedOrders(db,actor,parseScopedOrderFilters({settled:'false'}));
 assert.equal(page.items[0].settled,true,'list must return stored settlement state');
 assert.equal(db.sql.length,2);
 for(const call of db.sql)assert.match(call.sql,/o\.template_type IN \('sample','bulk'\).*o\.settled=\?/);
 assert.match(db.sql[1].sql,/ORDER BY o\.order_date DESC,o\.id DESC LIMIT \? OFFSET \?$/);
});
test('QUERY-03 sample rows count as one piece; bulk uses saved piece array; deposit excluded',async()=>{
 const db={async query(sql:string):Promise<[unknown,unknown]>{
  assert.match(sql,/WHEN o\.template_type='sample' THEN 1/);
  assert.match(sql,/WHEN o\.template_type='bulk' THEN COALESCE\(JSON_LENGTH\(i\.piece_meters\),0\)/);
  return [[{matching_line_count:2,meters_total:'3',amount_total:'30',pieces_total:3}],[]];
 }};
 const {summarizeMatchingOrderItems}=await import('./orderQueries');
 assert.equal((await summarizeMatchingOrderItems(db,actor,{limit:20,offset:0})).piecesTotal,3);
});
test('QUERY-02 matching detail endpoint reuses all line conditions and owner scope, with bounded pagination',async()=>{
 const listMatchingOrderItems=Reflect.get(await import('./orderQueries'),'listMatchingOrderItems');
 assert.equal(typeof listMatchingOrderItems,'function','authorized matching-line read is missing');
 const calls:{sql:string;args:unknown[]}[]=[];
 const db={async query(sql:string,args:unknown[]=[]):Promise<[unknown,unknown]>{
  calls.push({sql,args});
  if(sql.startsWith('SELECT o.id '))return [[{id:'47'}],[]];
  if(sql.includes('COUNT(*) AS total'))return [[{total:1}],[]];
  return [[{id:'51',product_no:'P1',color_no:'2',product_name:'棉',meters:'3.5',amount:'70',pieces:2}],[]];
 }};
 const filters=parseScopedOrderFilters({productNo:'P1',colorNo:'2',productName:'棉',limit:'10',offset:'5'});
 assert.deepEqual(await listMatchingOrderItems(db,actor,'47',filters),{
  orderId:'47',total:1,limit:10,offset:5,
  items:[{id:'51',productNo:'P1',colorNo:'2',productName:'棉',meters:3.5,amount:70,pieces:2}]
 });
 assert.equal(calls.length,3);
 for(const call of calls){
  assert.match(call.sql,/o\.created_by_user_id = \?/);assert.match(call.sql,/o\.id=\?/);
  for(const name of ['product_no','color_no','product_name'])assert(call.sql.includes('i.'+name+' LIKE ?'));
  assert.deepEqual(call.args.slice(0,5),['200','%P1%','%2%','%棉%','47']);
 }
 assert.match(calls[2].sql,/ORDER BY i\.id LIMIT \? OFFSET \?$/);
 assert.deepEqual(calls[2].args.slice(-2),[10,5]);
 for(const actorValue of [actor,{...actor,role:'admin' as const}]){
  const hidden={async query():Promise<[unknown,unknown]>{return [[],[]];}};
  await assert.rejects(listMatchingOrderItems(hidden,actorValue,'47',filters),e=>e instanceof OrderSearchError&&e.status===404);
 }
 await assert.rejects(listMatchingOrderItems(db,actor,'../47',filters),OrderSearchError);
 await assert.rejects(listMatchingOrderItems(db,null,'47',filters),/Unauthenticated/);
});
test('QUERY-02 real HTTP matching-items hides other owners, validates filters and preserves no-store',async()=>{
 const express=(await import('express')).default;
 const {createV2DocumentRouter}=await import('./documentRoutes');
 const {hashSessionToken}=await import('../access/password');
 const business:string[]=[];
 const db={async query(sql:string,args:unknown[]=[]):Promise<[unknown,unknown]>{
  if(sql.includes('JOIN v2_access_users u'))return [[{user_id:200,username:'test',display_name:'test',
   role:args[0]===hashSessionToken('b'.repeat(64))?'admin':'sales',session_id:3}],[]];
  business.push(sql);
  if(sql.startsWith('SELECT o.id ')){
   const target=String(args.at(-1));
   return [target==='47'||!sql.includes('o.created_by_user_id = ?')?[{id:target}]:[],[]];
  }
  if(sql.includes('COUNT(*) AS total'))return [[{total:1}],[]];
  assert.match(sql,/i\.product_no LIKE \?.*i\.color_no LIKE \?/);
  return [[{id:'1',product_no:'P1',color_no:'2',product_name:'棉',meters:'1',amount:'20',pieces:1}],[]];
 }};
 const app=express();app.use('/api/v2',createV2DocumentRouter(db as never));
 const server=await new Promise<import('node:http').Server>(resolve=>{const http=app.listen(0,'127.0.0.1',()=>resolve(http));});
 try{
  const addr=server.address();assert(addr&&typeof addr!=='string');const base='http://127.0.0.1:'+addr.port+'/api/v2/documents/';
  assert.equal((await fetch(base+'47/matching-items')).status,401);assert.equal(business.length,0);
  const headers={authorization:'Bearer '+'a'.repeat(64)};
  assert.equal((await fetch(base+'47/matching-items?ownerId=999',{headers})).status,400);assert.equal(business.length,0);
  assert.equal((await fetch(base+'48/matching-items',{headers})).status,404);assert.equal(business.length,1);
  const allowed=await fetch(base+'47/matching-items?productNo=P1&colorNo=2',{headers});assert.equal(allowed.status,200);
  assert.equal(allowed.headers.get('cache-control'),'no-store');
  assert.equal((await allowed.json() as {items:{id:string}[]}).items[0].id,'1');
  assert.equal((await fetch(base+'48/matching-items?productNo=P1&colorNo=2',{headers:{authorization:'Bearer '+'b'.repeat(64)}})).status,200);
 }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});
