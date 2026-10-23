import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {deriveCardShareToken,resolveCardShare,createCardShareIssueRouter,CARD_SHARE_SQL} from './cardSharing';
import {deriveProductShareToken} from './productSharing';
import {hashPatternLinkToken} from './patternLinkToken';
const key=Buffer.alloc(32,7),token=()=>deriveCardShareToken('18',key);
function fixture(){
 const state={card:'18',master:'4',fabric:'5',deleted:null as string|null,active:1,publication:'active',masterActive:1,fabricActive:1};
 const db={query:async(_sql:string,args:unknown[]=[]):Promise<[unknown,unknown]>=>{
  assert.deepEqual(args,[hashPatternLinkToken(token())]);
  return [[{token_hash:hashPatternLinkToken(token()),link_status:state.publication,revoked_at:null,card_id:state.card,master_id:state.master,fabric_id:state.fabric,card_no:'G001-F018',deleted_at:state.deleted,card_active:state.active,master_active:state.masterActive,fabric_active:state.fabricActive}],[]];
 }};return {state,db};
}
test('card token is stable and isolated from product tokens and internal scan payloads',()=>{
 assert.match(token(),/^[A-Za-z0-9_-]{43}$/);assert.equal(token(),deriveCardShareToken('18',key));
 assert.notEqual(token(),deriveCardShareToken('19',key));assert.notEqual(token(),deriveProductShareToken('18',key));
 for(const id of ['0','01','18446744073709551616'])assert.throws(()=>deriveCardShareToken(id,key));
 assert.match(CARD_SHARE_SQL,/UNIQUE KEY uq_card_share_card \(card_id\)/);assert.match(CARD_SHARE_SQL,/REFERENCES sample_cards\(id\) ON DELETE CASCADE/);
});
test('only issued, active publications resolve; deleted card cannot revive through a replacement ID',async()=>{
 const {state,db}=fixture();assert.deepEqual(await resolveCardShare(db,token()),{cardId:'18',masterId:'4',fabricId:'5',cardNo:'G001-F018',available:true});
 state.active=0;assert.equal((await resolveCardShare(db,token()))?.available,false);state.active=1;
 state.masterActive=0;assert.equal((await resolveCardShare(db,token()))?.available,false);state.masterActive=1;
 state.fabricActive=0;assert.equal((await resolveCardShare(db,token()))?.available,false);state.fabricActive=1;
 state.deleted='deleted';assert.equal(await resolveCardShare(db,token()),null);state.deleted=null;
 state.publication='revoked';assert.equal(await resolveCardShare(db,token()),null);
 assert.equal(await resolveCardShare({query:async()=>[[],[]]},token()),null);
 assert.equal(await resolveCardShare(db,token()+'x'),null);
});
test('private card signing validates live parents/card and reuses one publication after concurrent requests',async()=>{
 const links:Record<string,unknown>[]=[],events:string[]=[];const state={authenticated:true,user:true,session:true,card:true,active:1};
 let queue=Promise.resolve();
 const pool={async getConnection(){let unlock!:()=>void;return {
  async beginTransaction(){const prev=queue;queue=new Promise<void>(r=>{unlock=r;});await prev;events.push('begin');},
  async commit(){events.push('commit');},async rollback(){events.push('rollback');},release(){unlock?.();},
  async query(sql:string,args:unknown[]=[]):Promise<[unknown,unknown]>{
   if(sql.includes('FROM v2_access_users'))return [state.user?[{id:'9',role:'sales',is_active:1}]:[],[]];
   if(sql.includes('FROM v2_access_sessions'))return [state.session?[{id:'12',user_id:'9'}]:[],[]];
   if(sql.includes('FROM pattern_masters'))return [[{id:'4',is_active:1}],[]];
   if(sql.includes('FROM v2_fabrics'))return [[{id:'5',is_active:1}],[]];
   if(sql.includes('FROM sample_cards'))return [state.card?[{id:'18',master_id:'4',fabric_id:'5',is_active:state.active,deleted_at:null}]:[],[]];
   if(sql.startsWith('SELECT')&&sql.includes('card_share_links'))return [links,[]];
   if(sql.startsWith('INSERT INTO card_share_links')){links.push({card_id:'18',token_hash:args[0],status:'active',revoked_at:null});return [{affectedRows:1},[]];}
   throw Error('Unexpected SQL '+sql);
  }
 };}};
 const authDb={query:async():Promise<[unknown,unknown]>=>[state.authenticated?[{user_id:'9',username:'sales',display_name:'Sales',role:'sales',can_manage_own_orders:1,can_manage_products:1,session_id:'12'}]:[],[]]};
 const app=express();app.use('/api/v2',createCardShareIssueRouter({authDb,pool,secret:key,publicBase:'https://share.example.test'}));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const a=server.address();assert(a&&typeof a!=='string');const url='http://127.0.0.1:'+a.port+'/api/v2/sample-cards/18/share';
 const post=(body='{}',auth=true,suffix='')=>fetch(url+suffix,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{authorization:'Bearer '+'a'.repeat(64)}:{})},body});
 try{
  assert.equal((await post('{}',false)).status,401);assert.equal(events.length,0);
  assert.equal((await post('{"masterId":"other"}')).status,400);assert.equal((await post('{}',true,'?fabricId=6')).status,400);
  const first=await post();assert.equal(first.status,201);assert.equal((await first.json()).url,'https://share.example.test/c/'+token());
  assert.deepEqual((await Promise.all([post(),post()])).map(r=>r.status),[200,200]);assert.equal(links.length,1);
  state.card=false;assert.notEqual((await post()).status,200);state.card=true;
  state.active=0;assert.notEqual((await post()).status,200);state.active=1;
  state.user=false;assert.notEqual((await post()).status,200);state.user=true;
  state.session=false;assert.notEqual((await post()).status,200);state.session=true;
  state.authenticated=false;assert.equal((await post()).status,401);assert.equal(links.length,1);
 }finally{await new Promise<void>(r=>server.close(()=>r()));}
});
