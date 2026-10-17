import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import type {AppPrincipal} from '../access/types';
import {persistSampleCardScan,SampleScanError} from './scanRepository';
import {removeSampleSessionItem} from './sessionRemove';
type Row=Record<string,unknown>;
const actor:AppPrincipal={userId:'6',username:'user6',displayName:'业务员',role:'sales',
 canManageOwnOrders:false,canManageProducts:false,sessionId:'1'};
const cardToken='longStablePhysicalCardToken_123456789';
const tokenHash=createHash('sha256').update(cardToken).digest('hex');
class Fixture {
 user:Row|null={id:'6',role:'sales',is_active:1};
 login:Row|null={id:'1',user_id:'6',revoked_at:null,expires_at:new Date(Date.now()+3600000)};
 queries:{sql:string;args:unknown[]}[]=[];
 candidateFailure:Error|null=null;
 releases=0;
 sessions=new Map<string,Row>([['11',{id:'11',status:'open',created_by_user_id:'6'}]]);
 grants=new Set(['11:6']);
 card={id:'12',master_id:'41',fabric_id:'23',is_active:1};
 master:Row|null={id:'41',is_active:1};fabric:Row|null={id:'23',is_active:1};
 finalCard:Row|null|undefined=undefined;
 products:Row[]=[
 {id:'8',fabric_id:'23',master_id:'41',product_no:'G041-1-S23',colorway_no:1,master_no:'G041',fabric_name:'丝绸',
  composition:'桑蚕丝',weight_value:'16',weight_unit:'mm',width_value:'140',product_active:1,sampling_available:1,colorway_active:1,master_active:1,fabric_active:1},
 {id:'9',fabric_id:'23',master_id:'41',product_no:'G041-2-S23',colorway_no:2,master_no:'G041',fabric_name:'丝绸',
  composition:'桑蚕丝',weight_value:'16',weight_unit:'mm',width_value:'140',product_active:1,sampling_available:1,colorway_active:1,master_active:1,fabric_active:1}
 ];
 items=new Map<string,Row>(); cards=new Set<string>(); events:Row[]=[]; sources:Row[]=[];
 removals:Row[]=[];
 txCount=0; rollbacks=0;failOnProduct:string|null=null;
 failOnRestore=false;
 async getConnection(){
  const owner=this;
  let backup:{items:Map<string,Row>;cards:Set<string>;events:Row[];sources:Row[];removals:Row[]}|undefined;
  return {
   async beginTransaction(){owner.txCount++;backup={items:new Map(owner.items),cards:new Set(owner.cards),
    events:[...owner.events],sources:[...owner.sources],removals:[...owner.removals]};},
   async commit(){backup=undefined;},
   async rollback(){owner.rollbacks++;if(!backup)return;owner.items=backup.items;owner.cards=backup.cards;
    owner.events=backup.events;owner.sources=backup.sources;owner.removals=backup.removals;backup=undefined;},
   release(){owner.releases++;},
   async query(sql:string,args:unknown[]=[]):Promise<[unknown,unknown]>{
    owner.queries.push({sql,args});
    if(sql.includes('FROM v2_access_users'))
     return [owner.user&&String(owner.user.id)===String(args[0])?[owner.user]:[],[]];
    if(sql.includes('FROM v2_access_sessions')){
     const login=owner.login;
     return [login&&String(login.id)===String(args[0])&&String(login.user_id)===String(args[1])&&
      login.revoked_at==null&&(login.expires_at as Date).getTime()>Date.now()?[{id:login.id}]:[],[]];
    }
    if(sql.includes('FROM customer_sample_sessions')&&sql.includes('FOR UPDATE'))
     return [owner.sessions.has(String(args[0]))?[owner.sessions.get(String(args[0]))]:[],[]];
    if(sql.includes('FROM customer_sample_session_access'))
     return [owner.grants.has(String(args[0])+':'+String(args[1]))?[{can_manage:1}]:[],[]];
    if(sql.includes('FROM pattern_masters')&&!sql.includes('JOIN'))return [owner.master?[owner.master]:[],[]];
    if(sql.includes('FROM v2_fabrics')&&!sql.includes('JOIN'))return [owner.fabric?[owner.fabric]:[],[]];
    if(sql.includes('FROM sample_cards c WHERE c.id=? FOR UPDATE')){
     const raw=owner.finalCard===undefined?{...owner.card}:owner.finalCard;
     const card=raw?{id:raw.card_id??raw.id,master_id:raw.master_id,
      fabric_id:raw.fabric_id,is_active:raw.is_active,deleted_at:raw.deleted_at??null}:null;
     return [String(args[0])===owner.card.id&&card?[card]:[],[]];
    }
    if(sql.includes('FROM sample_card_tokens t WHERE t.card_id=? FOR SHARE')){
     const token=owner.finalCard===undefined?
      {card_id:owner.card.id,token_hash:tokenHash,revoked_at:null}:owner.finalCard;
     return [String(args[0])===owner.card.id&&token?[token]:[],[]];
    }
    if(sql.includes('FROM sample_card_tokens')){
     const card={card_id:owner.card.id,master_id:owner.card.master_id,
      fabric_id:owner.card.fabric_id,is_active:owner.card.is_active,token_hash:tokenHash};
     return [String(args[0])===tokenHash?[card]:[],[]];
    }
    if(sql.includes('FROM v2_products p')){
     if(owner.candidateFailure)throw owner.candidateFailure;
     return [owner.products,[]];
    }
    if(sql.includes('FROM customer_sample_items')&&sql.includes('FOR UPDATE'))return [
     [...owner.items.values()].filter(item=>!sql.includes('AND id=?')||item.id===args[1]),[]];
    if(sql.startsWith('UPDATE customer_sample_items')){
     if(sql.includes('removed_at=UTC_TIMESTAMP()')){
      const entry=[...owner.items.entries()].find(([,item])=>item.id===args[2]);assert(entry);
      owner.items.set(entry[0],{...entry[1],removed_at:'2026-10-15',removed_by_user_id:args[0]});
      return [{affectedRows:1},[]];
     }
     if(owner.failOnRestore)throw Error('synthetic restore failure');
     const k=String(args[0])+':'+String(args[1]),item=owner.items.get(k);
     assert(item);assert.match(sql,/removed_at=NULL,removed_by_user_id=NULL/);
     owner.items.set(k,{...item,removed_at:null,removed_by_user_id:null});
     return [{affectedRows:1},[]];
    }
    if(sql.startsWith('INSERT INTO customer_sample_item_removal_events')){
     const item=[...owner.items.values()].find(item=>item.id===args[1]);assert(item);
     owner.removals.push({session_id:args[0],product_id:item.product_id,actor_user_id:item.removed_by_user_id,removed_at:item.removed_at});
     return [{affectedRows:1},[]];
    }
    if(sql.startsWith('INSERT INTO customer_sample_selected_cards')){owner.cards.add(String(args[0])+':'+String(args[1]));return [{insertId:1},[]];}
    if(sql.startsWith('INSERT INTO customer_sample_scan_events')){
     owner.events.push({session_id:args[0],card_id:args[1],actor_id:args[2],resolved:JSON.parse(String(args[3])),added:JSON.parse(String(args[4]))});
     return [{insertId:owner.events.length},[]];
    }
    if(sql.startsWith('INSERT INTO customer_sample_items')){
     if(owner.failOnProduct===String(args[1]))throw new Error('synthetic DB insert failure');
     const k=String(args[0])+':'+String(args[1]);
     if(owner.items.has(k))throw new Error('duplicate key');
     owner.items.set(k,{product_id:args[1]});
     return [{insertId:owner.items.size},[]];
    }
    if(sql.startsWith('INSERT INTO customer_sample_item_sources')){
     if(!owner.sources.some(source=>[0,1,2].every(i=>String((source.args as unknown[])[i])===String(args[i]))))owner.sources.push({args});
     return [{insertId:1},[]];
    }
    if(sql.includes('COUNT(*) AS total')&&sql.includes('customer_sample_selected_cards'))return [[{total:owner.cards.size}],[]];
    throw Error('Unexpected SQL: '+sql);
   }
  };
 }
}
test('B3 full remove/rescan/remove cycle retains immutable audits and old card source across card recreation',async()=>{
 const db=new Fixture();await persistSampleCardScan(db,actor,{cardToken,sessionId:'11'});
 db.items.set('11:8',{...db.items.get('11:8'),id:'81',selected_by_user_id:'7',selected_at:'2026-10-01',removed_at:null,removed_by_user_id:null});
 const source=JSON.stringify(db.sources[0]),firstScan=JSON.stringify(db.events[0]);
 await removeSampleSessionItem(db,actor,'11','81');const audit=JSON.stringify(db.removals[0]);
 assert.equal(db.items.size,2);assert.equal(db.items.get('11:8')!.removed_by_user_id,'6');
 db.card.id='13';const restored=await persistSampleCardScan(db,actor,{cardToken,sessionId:'11'});
 assert.deepEqual(restored.addedProductIds,['8']);assert.equal(db.items.get('11:8')!.id,'81');
 assert.equal(db.items.get('11:8')!.removed_at,null);assert.equal(db.items.get('11:8')!.selected_by_user_id,'7');
 assert.equal(JSON.stringify(db.sources[0]),source);assert.equal(JSON.stringify(db.events[0]),firstScan);
 assert.equal(JSON.stringify(db.removals[0]),audit);assert.equal(db.sources.length,4);assert.equal(db.cards.size,2);
 assert.deepEqual(db.events[1].added,['8']);
 await removeSampleSessionItem(db,actor,'11','81');assert.equal(db.removals.length,2);
 assert.equal(JSON.stringify(db.removals[0]),audit);assert.equal(db.events.length,2);assert.equal(db.items.size,2);
});
test('B3 rescan restores the original removed row, reports added ID and preserves first source event',async()=>{
 const db=new Fixture();await persistSampleCardScan(db,actor,{cardToken,sessionId:'11'});
 db.items.set('11:8',{...db.items.get('11:8'),id:'81',selected_by_user_id:'7',selected_at:'2026-10-01',removed_at:'2026-10-15',removed_by_user_id:'6'});
 const sources=JSON.stringify(db.sources),cards=[...db.cards];
 const result=await persistSampleCardScan(db,actor,{cardToken,sessionId:'11'});
 assert.deepEqual(result.addedProductIds,['8']);assert.deepEqual(result.alreadySelectedProductIds,['9']);
 assert.deepEqual(db.events[1].added,['8']);assert.equal(db.items.size,2);
 assert.deepEqual(db.items.get('11:8'),{product_id:'8',id:'81',selected_by_user_id:'7',selected_at:'2026-10-01',removed_at:null,removed_by_user_id:null});
 assert.equal(JSON.stringify(db.sources),sources);assert.deepEqual([...db.cards],cards);
 const third=await persistSampleCardScan(db,actor,{cardToken,sessionId:'11'});
 assert.deepEqual(third.addedProductIds,[]);
});
test('B3 restore failure rolls back scan event and retains removal state and source history',async()=>{
 const db=new Fixture();await persistSampleCardScan(db,actor,{cardToken,sessionId:'11'});
 db.items.set('11:8',{product_id:'8',removed_at:'2026-10-15',removed_by_user_id:'6'});
 const before=JSON.stringify({items:[...db.items],events:db.events,sources:db.sources,cards:[...db.cards]});
 db.failOnRestore=true;
 await assert.rejects(persistSampleCardScan(db,actor,{cardToken,sessionId:'11'}),/restore failure/);
 assert.equal(JSON.stringify({items:[...db.items],events:db.events,sources:db.sources,cards:[...db.cards]}),before);
 assert.equal(db.rollbacks,1);
});
test('B3 removed product stays removed when current card excludes it',async()=>{
 const db=new Fixture();await persistSampleCardScan(db,actor,{cardToken,sessionId:'11'});
 db.items.set('11:8',{product_id:'8',removed_at:'2026-10-15',removed_by_user_id:'6'});
 db.products[0].sampling_available=0;
 const result=await persistSampleCardScan(db,actor,{cardToken,sessionId:'11'});
 assert.deepEqual(result.addedProductIds,[]);assert.equal(db.items.get('11:8')!.removed_at,'2026-10-15');
});
test('v1.50 scan stores selected product IDs without writing or parsing attribute snapshots',async()=>{
 const db=new Fixture();
 await persistSampleCardScan(db,actor,{cardToken,sessionId:'11'});
 assert.deepEqual([...db.items.values()],[{product_id:'8'},{product_id:'9'}]);
 assert(db.queries.some(q=>q.sql.startsWith('INSERT INTO customer_sample_items')&&!q.sql.includes('snapshot')));
 assert(!db.queries.some(q=>q.sql.includes('product_snapshot_json')));
});
test('B2-2 transaction stores current product IDs and one scan event; rescan adds delta only',async()=>{
 const db=new Fixture();
 const first=await persistSampleCardScan(db,actor,{cardToken,sessionId:'11'});
 assert.deepEqual(first.resolvedProductIds,['8','9']);
 assert.deepEqual(first.addedProductIds,['8','9']);
 assert.equal(first.selectedCardCount,1);
 assert.equal(db.items.size,2);assert.equal(db.events.length,1);assert.equal(db.sources.length,2);
 const before=JSON.stringify(db.items.get('11:8'));
 db.products[0].composition='UPDATED';
 const same=await persistSampleCardScan(db,actor,{cardToken,sessionId:'11'});
 assert.deepEqual(same.addedProductIds,[]);
 assert.equal(db.events.length,2);
 assert.equal(JSON.stringify(db.items.get('11:8')),before);
 db.products.push({...db.products[1],id:'10',product_no:'G041-3-S23',colorway_no:3});
 const added=await persistSampleCardScan(db,actor,{cardToken,sessionId:'11'});
 assert.deepEqual(added.addedProductIds,['10']);
 assert.equal(added.selectedCardCount,1);
 assert.equal(db.items.size,3);assert.equal(db.events.length,3);
});
test('v1.50 repeated scan keeps unique source association and its original first scan event',async()=>{
 const db=new Fixture();
 await persistSampleCardScan(db,actor,{cardToken,sessionId:'11'});
 const first=db.sources.map(x=>JSON.stringify(x));
 await persistSampleCardScan(db,actor,{cardToken,sessionId:'11'});
 assert.equal(db.events.length,2,'scan event log retains every actual rescan');
 assert.equal(db.sources.length,2,'one source per session/product/card, not one per scan');
 assert.deepEqual(db.sources.map(x=>JSON.stringify(x)),first,'first scan event identity is immutable');
});
test('AC-97 temporary no-sampling excludes one version, restore adds delta without rewriting selected IDs',async()=>{
 const db=new Fixture();db.products[0].sampling_available=0;
 const first=await persistSampleCardScan(db,actor,{cardToken,sessionId:'11'});
 assert.deepEqual(first.resolvedProductIds,['9']);assert.deepEqual(first.addedProductIds,['9']);
 const saved=JSON.stringify(db.items.get('11:9'));
 db.products[0].sampling_available=1;const second=await persistSampleCardScan(db,actor,{cardToken,sessionId:'11'});
 assert.deepEqual(second.resolvedProductIds,['8','9']);assert.deepEqual(second.addedProductIds,['8']);
 assert.equal(JSON.stringify(db.items.get('11:9')),saved);
 db.products[0].sampling_available=0;db.products[1].sampling_available=0;
 await assert.rejects(persistSampleCardScan(db,actor,{cardToken,sessionId:'11'}),
  (e:unknown)=>e instanceof SampleScanError&&e.status===409&&e.code==='NO_AVAILABLE_PRODUCTS');
 assert.equal(db.events.length,2);assert.equal(db.items.size,2);
 assert(db.queries.some(q=>q.sql.includes('is_available_for_sampling')));
});
test('AC-97 scan excludes inactive products and colorways; preserves earlier selected IDs',async()=>{
 const db=new Fixture();db.products[0].product_active=0;
 const first=await persistSampleCardScan(db,actor,{cardToken,sessionId:'11'});
 assert.deepEqual(first.resolvedProductIds,['9']);assert.deepEqual(first.addedProductIds,['9']);
 assert.equal(db.items.size,1);const old=JSON.stringify(db.items.get('11:9'));
 db.products[0].product_active=1;db.products[1].colorway_active=0;
 const second=await persistSampleCardScan(db,actor,{cardToken,sessionId:'11'});
 assert.deepEqual(second.resolvedProductIds,['8']);assert.deepEqual(second.addedProductIds,['8']);
 assert.equal(db.items.size,2);assert.equal(JSON.stringify(db.items.get('11:9')),old);
 assert.equal(db.events.length,2);
});
test('AC-97 B2-5 zero eligible products returns special conflict without writing empty successful selection',async()=>{
 const db=new Fixture();db.products.forEach(p=>{p.product_active=0;});
 await assert.rejects(persistSampleCardScan(db,actor,{cardToken,sessionId:'11'}),
  (e:unknown)=>e instanceof SampleScanError&&e.status===409&&e.code==='NO_AVAILABLE_PRODUCTS');
 assert.equal(db.items.size,0);assert.equal(db.events.length,0);assert.equal(db.cards.size,0);
 assert.equal(db.sources.length,0);assert.equal(db.rollbacks,1);
});
test('AC-96 B2-5 token lookup always excludes archived cards, independent of revoked token',async()=>{
 const db=new Fixture();await persistSampleCardScan(db,actor,{cardToken,sessionId:'11'});
 const lookups=db.queries.filter(q=>q.sql.includes('FROM sample_card_tokens'));
 assert.equal(lookups.length,2);
 assert(lookups[0].sql.includes('c.deleted_at IS NULL'));
 assert(lookups[1].sql.includes('revoked_at'));
 assert(db.queries.some(q=>q.sql.includes('FROM sample_cards c WHERE c.id=? FOR UPDATE')));
});
test('B2-5h scan locks current card before token separately, matching retire lock order',async()=>{
 const db=new Fixture();await persistSampleCardScan(db,actor,{cardToken,sessionId:'11'});
 const card=db.queries.findIndex(q=>q.sql.includes('FROM sample_cards c WHERE c.id=? FOR UPDATE'));
 const token=db.queries.findIndex(q=>q.sql.includes('FROM sample_card_tokens t WHERE t.card_id=? FOR SHARE'));
 assert(card>0&&token>card,'current card must be locked before its token');
 const fabric=db.queries.findIndex(q=>q.sql.includes('FROM v2_fabrics')&&!q.sql.includes('JOIN'));
 const product=db.queries.findIndex(q=>q.sql.includes('FROM v2_products p'));
 assert(fabric<card&&token<product,'parent -> card -> token -> products');
 assert.equal(db.queries[card].args[0],'12');
 assert.deepEqual(db.queries[token].args,['12']);
 assert.equal(db.queries.filter(q=>q.sql.includes('FROM sample_card_tokens')&&q.sql.includes('FOR UPDATE')).length,0,
  'do not let optimizer lock JOINed token/card in an undefined order');
});
test('B2-5h current card archival or QR revocation prevents scan even when initial locator saw active state',async()=>{
 for(const finalCard of [
  {card_id:'12',master_id:'41',fabric_id:'23',is_active:1,token_hash:tokenHash,deleted_at:'2026-10-14T00:00:00'},
  {card_id:'12',master_id:'41',fabric_id:'23',is_active:1,token_hash:tokenHash,revoked_at:'2026-10-14T00:00:00'}
 ]){
  const db=new Fixture();db.finalCard=finalCard;
  await assert.rejects(persistSampleCardScan(db,actor,{cardToken,sessionId:'11'}),
   (error:unknown)=>error instanceof SampleScanError&&error.status===404);
  assert(!db.queries.some(q=>q.sql.includes('FROM v2_products p')));
  assert.equal(db.items.size,0);assert.equal(db.cards.size,0);assert.equal(db.events.length,0);
  assert.equal(db.sources.length,0);assert.equal(db.rollbacks,1);assert.equal(db.releases,1);
 }
});
for(const role of ['admin','sales'] as const){
 test(`SCAN-01 active registered ${role} scans with a session grant without exposing QR secrets`,async()=>{
  const db=new Fixture();db.user={id:'6',role,is_active:1};
  const result=await persistSampleCardScan(db,{...actor,role},{cardToken,sessionId:'11'});
  assert.deepEqual(result,{cardId:'12',resolvedProductIds:['8','9'],addedProductIds:['8','9'],
   alreadySelectedProductIds:[],selectedCardCount:1});
  assert.equal(db.events.length,1);assert.equal(db.events[0].actor_id,'6');
  assert.equal(db.items.size,2);assert.equal(db.sources.length,2);
  const lookup=db.queries.find(q=>q.sql.includes('WHERE t.token_hash=?'));
  assert.deepEqual(lookup?.args,[tokenHash],'only the hash locates the QR');
  const writes=db.queries.filter(q=>/^(INSERT|UPDATE)/.test(q.sql));
  for(const data of [result,writes,db.events,db.sources,[...db.items.values()]]){
   const serialized=JSON.stringify(data);
   assert(!serialized.includes(cardToken));assert(!serialized.includes(tokenHash));
  }
  assert(!JSON.stringify(db.queries).includes(cardToken));
  assert.equal(db.rollbacks,0);assert.equal(db.releases,1);
 });
 test(`SCAN-01 ${role} cannot use a QR without a sample session grant`,async()=>{
  const db=new Fixture();db.user={id:'6',role,is_active:1};db.grants.clear();
  await assert.rejects(persistSampleCardScan(db,{...actor,role},{cardToken,sessionId:'11'}),
   (error:unknown)=>error instanceof SampleScanError&&error.status===403);
  assert(db.queries.some(q=>q.sql.includes('FROM customer_sample_session_access')));
  assert(!db.queries.some(q=>q.sql.includes('FROM sample_card_tokens')));
  assert.equal(db.items.size,0);assert.equal(db.events.length,0);
  assert.equal(db.rollbacks,1);assert.equal(db.releases,1);
 });
}
test('SCAN-01 unregistered roles cannot acquire a scan transaction',async()=>{
 for(const role of ['viewer','customer','',undefined]){
  const db=new Fixture();
  await assert.rejects(persistSampleCardScan(db,{...actor,role} as AppPrincipal,{cardToken,sessionId:'11'}),
   (error:unknown)=>error instanceof SampleScanError&&error.status===403);
  assert.equal(db.txCount,0);assert.equal(db.queries.length,0);
 }
});
test('B2-2 denies different salesperson, absent session grant and cross-material candidate',async()=>{
 const db=new Fixture();
 await assert.rejects(persistSampleCardScan(db,{...actor,userId:'7'},{cardToken,sessionId:'11'}),SampleScanError);
 db.grants.clear();
 await assert.rejects(persistSampleCardScan(db,actor,{cardToken,sessionId:'11'}),SampleScanError);
 db.grants.add('11:6');
 db.products.push({...db.products[0],id:'19',fabric_id:'35'});
 await assert.rejects(persistSampleCardScan(db,actor,{cardToken,sessionId:'11'}),SampleScanError);
 assert.equal(db.items.size,0);
});
test('B2-2 all-or-nothing rollback protects selected products, scan event, card count',async()=>{
 const db=new Fixture();
 db.failOnProduct='9';
 await assert.rejects(persistSampleCardScan(db,actor,{cardToken,sessionId:'11'}));
 assert.equal(db.items.size,0);assert.equal(db.events.length,0);
 assert.equal(db.cards.size,0);assert.equal(db.sources.length,0);
 assert.equal(db.rollbacks,1);
});

test('AC-80/82 stale HTTP principal cannot scan after account disable, deletion or role change',async()=>{
 for(const role of ['admin','sales'] as const){
 for(const user of [null,{id:'6',role,is_active:0},{id:'6',role:role==='admin'?'sales':'admin',is_active:1}]){
  const db=new Fixture();
  db.user=user;
  await assert.rejects(persistSampleCardScan(db,{...actor,role},{cardToken,sessionId:'11'}),
   (error:unknown)=>error instanceof SampleScanError&&error.status===403);
  assert.equal(db.items.size,0);assert.equal(db.events.length,0);
  assert.equal(db.cards.size,0);assert.equal(db.sources.length,0);
  assert.equal(db.rollbacks,1);assert.equal(db.releases,1);
  assert(!db.queries.some(x=>x.sql.includes('FROM customer_sample_sessions')),
   'reject stale identity before reading private sample data');
 }
 }
});

test('AC-80/82 scan rechecks revoked, expired, missing or another user login in its transaction',async()=>{
 for(const role of ['admin','sales'] as const){
 for(const login of [null,
  {id:'1',user_id:'6',revoked_at:new Date(),expires_at:new Date(Date.now()+3600000)},
  {id:'1',user_id:'6',revoked_at:null,expires_at:new Date(0)},
  {id:'1',user_id:'7',revoked_at:null,expires_at:new Date(Date.now()+3600000)}]){
  const db=new Fixture();db.user={id:'6',role,is_active:1};db.login=login;
  await assert.rejects(persistSampleCardScan(db,{...actor,role},{cardToken,sessionId:'11'}),
   (error:unknown)=>error instanceof SampleScanError&&error.status===403);
  assert.equal(db.items.size,0);assert.equal(db.events.length,0);
  assert.equal(db.cards.size,0);assert.equal(db.sources.length,0);
  assert.equal(db.rollbacks,1);assert.equal(db.releases,1);
  assert(!db.queries.some(x=>x.sql.includes('FROM customer_sample_sessions')));
 }
 }
});

test('AC-80/82 invalid login identity is rejected before acquiring a transaction',async()=>{
 for(const sessionId of ['', 'synthetic', '0', '18446744073709551616']){
  const db=new Fixture();
  await assert.rejects(persistSampleCardScan(db,{...actor,sessionId},{cardToken,sessionId:'11'}),
   (error:unknown)=>error instanceof SampleScanError&&error.status===403);
  assert.equal(db.txCount,0);assert.equal(db.queries.length,0);
 }
});

test('AC-80/82 fresh actor locks user then login before serializing the sample session',async()=>{
 const db=new Fixture();
 await persistSampleCardScan(db,actor,{cardToken,sessionId:'11'});
 assert.match(db.queries[0].sql,/FROM v2_access_users.*FOR SHARE/);
 assert.deepEqual(db.queries[0].args,['6']);
 assert.match(db.queries[1].sql,/FROM v2_access_sessions.*revoked_at IS NULL.*expires_at>UTC_TIMESTAMP\(\).*FOR SHARE/);
 assert.deepEqual(db.queries[1].args,['1','6']);
 assert.match(db.queries[2].sql,/FROM customer_sample_sessions.*FOR UPDATE/);
 assert.equal(db.releases,1);
});

test('AC-80 candidate availability read locks all four joined identities until sample commit',async()=>{
 const db=new Fixture();
 await persistSampleCardScan(db,actor,{cardToken,sessionId:'11'});
 const candidate=db.queries.find(x=>x.sql.includes('FROM v2_products p'))!;
 assert.match(candidate.sql,/JOIN pattern_colorways/);
 assert.match(candidate.sql,/JOIN pattern_masters/);
 assert.match(candidate.sql,/JOIN v2_fabrics/);
 assert.match(candidate.sql,/ORDER BY p\.id FOR SHARE\s*$/);
 assert(!candidate.sql.includes('FOR SHARE OF'),'all four levels must remain locked');
});

test('AC-80 database deadlock rolls back the complete scan without implicit retry',async()=>{
 const db=new Fixture();
 await persistSampleCardScan(db,actor,{cardToken,sessionId:'11'});
 const before=JSON.stringify({items:[...db.items],cards:[...db.cards],events:db.events,sources:db.sources});
 const failure=Object.assign(new Error('synthetic deadlock'),{code:'ER_LOCK_DEADLOCK'});
 db.candidateFailure=failure;
 await assert.rejects(persistSampleCardScan(db,actor,{cardToken,sessionId:'11'}),
  (error:unknown)=>error===failure);
 assert.equal(JSON.stringify({items:[...db.items],cards:[...db.cards],events:db.events,sources:db.sources}),before);
 assert.equal(db.rollbacks,1);assert.equal(db.releases,2);
 assert.equal(db.txCount,2,'database contention must not trigger a hidden retry');
});
test('B2-3 scan uses exactly stored card master and rejects legacy missing master before product access',async()=>{
 const db=new Fixture();await persistSampleCardScan(db,actor,{cardToken,sessionId:'11'});
 assert(!db.queries.some(q=>q.sql.includes('sample_card_pattern_scopes')));
 const product=db.queries.find(q=>q.sql.includes('FROM v2_products p'))!;
 assert.deepEqual(product.args,['23','41']);assert.match(product.sql,/c.master_id=\?/);
 const legacy=new Fixture();legacy.card.master_id='';
 await assert.rejects(persistSampleCardScan(legacy,actor,{cardToken,sessionId:'11'}),e=>e instanceof SampleScanError&&e.status===409);
 assert(!legacy.queries.some(q=>q.sql.includes('FROM v2_products p')));assert.equal(legacy.items.size,0);
});

test('B2-3 scan locates identity without locks then locks master, fabric and card in create-compatible order',async()=>{
 const db=new Fixture();await persistSampleCardScan(db,actor,{cardToken,sessionId:'11'});
 const tokenReads=db.queries.map((q,index)=>({...q,index})).filter(q=>q.sql.includes('FROM sample_card_tokens'));
 assert.equal(tokenReads.length,2);
 assert.doesNotMatch(tokenReads[0].sql,/FOR UPDATE|FOR SHARE/);
 const master=db.queries.findIndex(q=>q.sql.includes('FROM pattern_masters')&&!q.sql.includes('JOIN'));
 const fabric=db.queries.findIndex(q=>q.sql.includes('FROM v2_fabrics')&&!q.sql.includes('JOIN'));
 assert(master>tokenReads[0].index&&fabric>master&&tokenReads[1].index>fabric);
 assert.match(db.queries[master].sql,/FOR SHARE/);assert.deepEqual(db.queries[master].args,['41']);
 assert.match(db.queries[fabric].sql,/FOR SHARE/);assert.deepEqual(db.queries[fabric].args,['23']);
 assert.match(tokenReads[1].sql,/FOR SHARE/);
 const cardLock=db.queries.findIndex(q=>q.sql.includes('FROM sample_cards c WHERE c.id=? FOR UPDATE'));
 assert(cardLock>fabric&&cardLock<tokenReads[1].index,'lock card before token');
 assert(tokenReads[1].index<db.queries.findIndex(q=>q.sql.includes('FROM v2_products p')));
});
test('B2-3 locked card identity or hash drift rejects scan before products and rolls back',async()=>{
 for(const change of [{card_id:'13'},{master_id:'42'},{fabric_id:'35'},{token_hash:'a'.repeat(64)}]){
  const db=new Fixture();db.finalCard={card_id:'12',master_id:'41',fabric_id:'23',is_active:1,token_hash:tokenHash,...change};
  await assert.rejects(persistSampleCardScan(db,actor,{cardToken,sessionId:'11'}),e=>e instanceof SampleScanError&&e.status===409);
  assert(!db.queries.some(q=>q.sql.includes('FROM v2_products p')));
  assert.equal(db.items.size,0);assert.equal(db.events.length,0);assert.equal(db.rollbacks,1);assert.equal(db.txCount,1);
 }
});
test('B2-3 parent unavailability or revoked/inactive locked card cannot add sample items',async()=>{
 for(const key of ['master','fabric'] as const){
  for(const parent of [null,{id:key==='master'?'41':'23',is_active:0}]){
   const db=new Fixture();db[key]=parent;
   await assert.rejects(persistSampleCardScan(db,actor,{cardToken,sessionId:'11'}),e=>e instanceof SampleScanError&&e.status===409);
   assert(!db.queries.some(q=>q.sql.includes('FROM v2_products p')));assert.equal(db.items.size,0);
  }
 }
 for(const finalCard of [null,{card_id:'12',master_id:'41',fabric_id:'23',is_active:0,token_hash:tokenHash}]){
  const db=new Fixture();db.finalCard=finalCard;
  await assert.rejects(persistSampleCardScan(db,actor,{cardToken,sessionId:'11'}),e=>e instanceof SampleScanError&&e.status===404);
  assert(!db.queries.some(q=>q.sql.includes('FROM v2_products p')));assert.equal(db.items.size,0);
 }
});
