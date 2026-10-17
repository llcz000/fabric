import assert from 'node:assert/strict';
import test from 'node:test';
import {deriveStablePatternLinkToken,formatPatternShareUrl,issuePatternShareLink} from './patternLinkIssuer';
import {hashPatternLinkToken,isPatternLinkToken} from './patternLinkToken';
import type {AppPrincipal} from '../access/types';

const SECRET=Uint8Array.from(Array.from({length:32},(_,i)=>i+1)); // deterministic dummy, NOT production key
const principal:AppPrincipal={userId:'9',sessionId:'12',username:'sales',displayName:'Sales',
 role:'sales',canManageProducts:true,canManageOwnOrders:true};
const user={id:'9',role:'sales',is_active:1};
const session={id:'12',user_id:'9'};
const master={id:'42',is_active:1};
type Row=Record<string,unknown>;
function database(){
 const state={user:{...user} as Row,session:{...session} as Row,master:{...master} as Row,
  links:[] as Row[],failInsert:false,sql:[] as {sql:string;params:unknown[]}[],
  events:[] as string[],rollback:0,commit:0};
 const tx={
  async beginTransaction(){state.events.push('BEGIN');},
  async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>{
   state.sql.push({sql,params});
   assert.doesNotMatch(sql,/(?:RAW_TOKEN|secret_key|PRIVATE_KEY)/i);
   if(sql.includes('FROM v2_access_users'))return [[state.user],[]];
   if(sql.includes('FROM v2_access_sessions'))return [[state.session],[]];
   if(sql.includes('FROM pattern_masters'))return [[state.master],[]];
   if(sql.includes('FROM pattern_share_links'))return [state.links.map(x=>({...x})),[]];
   if(sql.startsWith('INSERT INTO pattern_share_links')){
    if(state.failInsert)throw Error('PRIVATE_SQL_INSERT_FAILURE');
    state.links.push({token_hash:params[0],master_id:params[1],status:'active',revoked_at:null});
    return [{affectedRows:1},[]];
   }
   throw Error('unexpected SQL '+sql);
  },
  async commit(){state.events.push('COMMIT');state.commit++;},
  async rollback(){state.events.push('ROLLBACK');state.rollback++;},
  release(){state.events.push('RELEASE');}
 };
 return {state,pool:{async getConnection(){state.events.push('GET_CONNECTION');return tx;}}};
}
test('stable 256-bit unguessable link matches token lookup hash without storing raw token',async()=>{
 const a=deriveStablePatternLinkToken('42',SECRET);
 assert(isPatternLinkToken(a));
 assert.equal(a,deriveStablePatternLinkToken('42',Uint8Array.from(SECRET)));
 assert.notEqual(a,deriveStablePatternLinkToken('43',SECRET));
 assert.notEqual(a,deriveStablePatternLinkToken('42',new Uint8Array(32).fill(8)));
 assert.notEqual(hashPatternLinkToken(a),hashPatternLinkToken(deriveStablePatternLinkToken('43',SECRET)));
 assert.equal(Buffer.from(a,'base64url').length,32);
});
test('must reject unsafe identity and weak/malformed key without leaking inputs',()=>{
 for(const id of ['0','01','-1','42?x=1','18446744073709551616','','42 ',42]){
  assert.throws(()=>deriveStablePatternLinkToken(id as string,SECRET),/Pattern link/);
 }
 for(const key of [null,undefined,'a'.repeat(32),Buffer.alloc(0),new Uint8Array(31),
  new Uint8Array(33),new Uint8Array(32),new Uint16Array(32)]){
  assert.throws(()=>deriveStablePatternLinkToken('42',key as Uint8Array),/Pattern link/);
 }
});
test('issuance persists only HMAC-domain separated digest once, locks live account session and parent',async()=>{
 const {state,pool}=database();
 const result=await issuePatternShareLink(pool,principal,'42',SECRET,'https://share.example.test');
 assert(isPatternLinkToken(result.token));
 assert.equal(result.url,'https://share.example.test/p/'+result.token);
 assert.equal(result.created,true);
 assert.equal(state.links.length,1);
 assert.deepEqual(state.links[0],{token_hash:hashPatternLinkToken(result.token),master_id:'42',status:'active',revoked_at:null});
 assert.equal(state.commit,1);assert.equal(state.rollback,0);
 assert.deepEqual(state.events,['GET_CONNECTION','BEGIN','COMMIT','RELEASE']);
 assert.deepEqual(state.sql.map(x=>x.sql.includes('FROM v2_access_users')?'USER':
  x.sql.includes('FROM v2_access_sessions')?'SESSION':
  x.sql.includes('FROM pattern_masters')?'MASTER':
  x.sql.includes('FROM pattern_share_links')?'LINK':
  x.sql.startsWith('INSERT INTO')?'INSERT':'UNKNOWN'),
  ['USER','SESSION','MASTER','LINK','INSERT']);
 assert(state.sql.every(x=>!JSON.stringify(x).includes(result.token)));
});
test('same link survives master disable/re-enable without reissuing or mutating old link',async()=>{
 const {state,pool}=database();
 const a=await issuePatternShareLink(pool,principal,'42',SECRET,'https://share.example.test');
 state.master.is_active=0;
 const disabled=await issuePatternShareLink(pool,principal,'42',SECRET,'https://share.example.test');
 state.master.is_active=1;
 const enabled=await issuePatternShareLink(pool,principal,'42',SECRET,'https://share.example.test');
 assert.equal(a.token,disabled.token);assert.equal(a.url,enabled.url);
 assert.equal(disabled.created,false);assert.equal(enabled.created,false);
 assert.equal(state.links.length,1);
 assert.equal(state.sql.filter(x=>x.sql.startsWith('INSERT INTO')).length,1);
 assert.equal(state.commit,3);
});
test('revoked or foreign-key mismatched rows and secret rotation must fail closed',async()=>{
 for(const change of [
  (row:Row)=>{row.status='revoked';},(row:Row)=>{row.revoked_at='2026-10-15';},
  (row:Row)=>{row.master_id='43';},(row:Row)=>{row.token_hash='0'.repeat(64);}
 ]){
  const {state,pool}=database();
  const a=await issuePatternShareLink(pool,principal,'42',SECRET,'https://share.example.test');
  change(state.links[0]);
  await assert.rejects(()=>issuePatternShareLink(pool,principal,'42',SECRET,'https://share.example.test'),/Pattern link/);
  assert.equal(state.links.length,1);assert.equal(state.rollback,1);assert.equal(state.commit,1);
 }
 const {state,pool}=database();
 await issuePatternShareLink(pool,principal,'42',SECRET,'https://share.example.test');
 await assert.rejects(()=>issuePatternShareLink(pool,principal,'42',new Uint8Array(32).fill(3),'https://share.example.test'),/Pattern link/);
 assert.equal(state.commit,1);
});
test('authentication and malformed input never insert and rollback atomically',async()=>{
 for(const mutate of [
  (x:ReturnType<typeof database>['state'])=>{x.user.is_active=0;},
  (x:ReturnType<typeof database>['state'])=>{x.user.role='unknown';},
  (x:ReturnType<typeof database>['state'])=>{x.session.id='999';},
  (x:ReturnType<typeof database>['state'])=>{x.master.id='999';},
  (x:ReturnType<typeof database>['state'])=>{x.master.is_active=null;},
  (x:ReturnType<typeof database>['state'])=>{x.failInsert=true;}
 ]){
  const {state,pool}=database();mutate(state);
  await assert.rejects(()=>issuePatternShareLink(pool,principal,'42',SECRET,'https://share.example.test'),/Pattern link/);
  assert.equal(state.commit,0);assert.equal(state.rollback,1);
  assert.equal(state.links.length,0);
 }
 const {state,pool}=database();
 await assert.rejects(()=>issuePatternShareLink(pool,{...principal,userId:'0'},'42',SECRET,'https://share.example.test'));
 assert.equal(state.sql.length,0);assert.equal(state.commit,0);
});
test('only HTTPS canonical public origin is accepted for shareable URL; no attacker URL fields',()=>{
 const token=deriveStablePatternLinkToken('42',SECRET);
 assert.equal(formatPatternShareUrl('https://share.example.test',token),'https://share.example.test/p/'+token);
 for(const base of ['http://share.example.test','https://share.example.test/','https://share.example.test/path',
  'https://share.example.test?x=1','https://user:pass@share.example.test',
  'https://share.example.test@evil.example/path','file:///etc/passwd',
  'https://share.example.test#fragment','https://127.0.0.1','https://localhost',
  'https://share.example.test:443','HTTPS://share.example.test']){
  assert.throws(()=>formatPatternShareUrl(base,token),/Pattern link/);
 }
});
