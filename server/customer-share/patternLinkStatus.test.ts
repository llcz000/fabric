import assert from 'node:assert/strict';
import test from 'node:test';
import {resolvePatternLinkPresentation,type PatternLinkReadPool} from './patternLinkStore';
import {hashPatternLinkToken} from './patternLinkToken';

const TOKEN='AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const DIGEST=hashPatternLinkToken(TOKEN);
const inactiveRow={token_hash:DIGEST,pattern_master_id:'42',link_status:'active',revoked_at:null,parent_is_active:0};
const db=(rows:unknown)=>({
 calls:0,
 pool:{async query(_sql:string,params?:unknown[]){
  assert.deepEqual(params,[DIGEST]);return [rows,[]] as [unknown,unknown];
 }} as PatternLinkReadPool
});
const verify=async()=>({authorizationVerified:true,publicationVerified:false,unavailableVerified:true});
test('B1 disabled master valid link returns no content yet clearly an unavailable public page',async()=>{
 const x=db([{...inactiveRow}]);
 const resolved=await resolvePatternLinkPresentation(x.pool,TOKEN,verify);
 assert.deepEqual(resolved,{patternMasterId:'42',available:false});
});
test('B1 reenable old same link resolves normally with no new issuance or token change',async()=>{
 const entry={...inactiveRow};
 const x=db([entry]);
 assert.deepEqual(await resolvePatternLinkPresentation(x.pool,TOKEN,verify),
  {patternMasterId:'42',available:false});
 entry.parent_is_active=1;
 const live=await resolvePatternLinkPresentation(x.pool,TOKEN,async()=>({authorizationVerified:true,publicationVerified:true}));
 assert.deepEqual(live,{patternMasterId:'42',available:true});
});
test('disabled response strictly requires trusted server verification of explicit inactive publication',async()=>{
 for(const value of [undefined,true,false,null,{}, {authorizationVerified:true,publicationVerified:false},
  {authorizationVerified:true,publicationVerified:true,unavailableVerified:true},
  {authorizationVerified:false,publicationVerified:false,unavailableVerified:true},
  {authorizationVerified:1,publicationVerified:false,unavailableVerified:true},
  {authorizationVerified:true,publicationVerified:false,unavailableVerified:1}]){
  assert.equal(await resolvePatternLinkPresentation(db([{...inactiveRow}]).pool,TOKEN,
   async()=>value),null);
 }
});
test('malformed, duplicated, revoked or inactive link and missing master never returns unavailable',async()=>{
 for(const rows of [[],[inactiveRow,inactiveRow],
  [{...inactiveRow,link_status:'inactive'}],[{...inactiveRow,revoked_at:'2026-10-01'}],
  [{...inactiveRow,parent_is_active:null}],[{...inactiveRow,parent_is_active:'0'}],
  [{...inactiveRow,pattern_master_id:'not-id'}]]){
  assert.equal(await resolvePatternLinkPresentation(db(rows).pool,TOKEN,verify),null);
 }
 assert.equal(await resolvePatternLinkPresentation(db([inactiveRow]).pool,TOKEN+'bad',verify),null);
});
