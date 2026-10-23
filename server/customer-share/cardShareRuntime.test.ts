import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createPatternShareRuntime} from './patternShareRuntime';
import type {ImageAssetService} from '../image-assets/service';
const target={database:'fabric_v2_test_card_runtime',serverUuid:'11111111-1111-4111-8111-111111111111'};
function fixture(){
 const state={missingCard:true,queries:[] as string[]};
 const profiles:Record<string,{kind:string;relation:string;parent:string}>={pattern_share_links:{kind:'pattern',relation:'master',parent:'pattern_masters'},product_share_links:{kind:'product',relation:'product',parent:'v2_products'},card_share_links:{kind:'card',relation:'card',parent:'sample_cards'}};
 const index=(INDEX_NAME:string,COLUMN_NAME:string)=>({INDEX_NAME,COLUMN_NAME,NON_UNIQUE:0,SEQ_IN_INDEX:1,SUB_PART:null,INDEX_TYPE:'BTREE'});
 const column=(COLUMN_NAME:string,COLUMN_TYPE:string,IS_NULLABLE='NO',EXTRA='')=>({COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,EXTRA,COLUMN_DEFAULT:COLUMN_NAME==='status'?'active':COLUMN_NAME==='created_at'?'CURRENT_TIMESTAMP':null,CHARACTER_SET_NAME:COLUMN_NAME==='token_hash'?'ascii':null,COLLATION_NAME:COLUMN_NAME==='token_hash'?'ascii_bin':null});
 const pool={async getConnection(){return {release(){},beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},async query(sql:string,args:unknown[]=[]):Promise<[unknown,unknown]>{
  state.queries.push(sql);assert.match(sql,/^SELECT /);
  if(sql.includes('@@server_uuid'))return [[{selected_database:target.database,server_uuid:target.serverUuid}],[]];
  if(sql.includes('INFORMATION_SCHEMA.TABLES')){const names=[...sql.matchAll(/'([a-z_0-9]+)'/g)].map(x=>x[1]);return [names.filter(n=>!(state.missingCard&&n==='card_share_links')).map(TABLE_NAME=>({TABLE_NAME,ENGINE:'InnoDB'})),[]];}
  const profile=profiles[String(args[0])];
  if(sql.includes('INFORMATION_SCHEMA.COLUMNS'))return [profile?[column('id','bigint unsigned','NO','auto_increment'),column(profile.relation+'_id','bigint unsigned'),column('token_hash','char(64)'),column('status',"enum('active','inactive','revoked')"),column('revoked_at','datetime','YES'),column('created_at','datetime')]:[column('id','bigint unsigned','NO','auto_increment')],[]];
  if(sql.includes('INFORMATION_SCHEMA.STATISTICS'))return [profile?[index('PRIMARY','id'),index('uq_'+profile.kind+'_share_token','token_hash'),index('uq_'+profile.kind+'_share_'+profile.relation,profile.relation+'_id')]:[index('PRIMARY','id')],[]];
  if(sql.includes('INFORMATION_SCHEMA.KEY_COLUMN_USAGE'))return [[{CONSTRAINT_NAME:'fk_'+profile.kind+'_share_'+profile.relation,COLUMN_NAME:profile.relation+'_id',REFERENCED_TABLE_SCHEMA:target.database,REFERENCED_TABLE_NAME:profile.parent,REFERENCED_COLUMN_NAME:'id',ORDINAL_POSITION:1,DELETE_RULE:profile.kind==='pattern'?'RESTRICT':'CASCADE',UPDATE_RULE:'NO ACTION'}],[]];
  throw Error('Unexpected metadata query');
 }};}};
 return {state,pool};
}
test('unprepared card schema disables only card shares; prepared schema adds routes without runtime DDL',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fabric-card-key-'));const keyFile=path.join(dir,'key.bin');await fs.writeFile(keyFile,Buffer.alloc(32,7),{mode:0o600});
 try{
  const {state,pool}=fixture();const db={query:async():Promise<[unknown,unknown]>=>{throw Error('No business query during startup');}};
  const env={FABRIC_V2_PATTERN_SHARING:'enabled',FABRIC_V2_PUBLIC_ORIGIN:'https://share.example.test',FABRIC_V2_PATTERN_SHARE_KEY_FILE:keyFile};
  const off=await createPatternShareRuntime(db,pool as any,target,{} as ImageAssetService,env);assert(off);assert.equal(off.productsEnabled,true);assert.equal(off.cardsEnabled,false);assert.equal(off.cardPublicRouter,null);assert(off.productPublicRouter);assert(off.publicRouter);
  state.missingCard=false;const on=await createPatternShareRuntime(db,pool as any,target,{} as ImageAssetService,env);assert(on?.cardsEnabled);assert(on.cardPublicRouter);assert.equal(on.productsEnabled,true);assert(state.queries.every(q=>q.startsWith('SELECT ')));
 }finally{await fs.unlink(keyFile);await fs.rmdir(dir);}
});
