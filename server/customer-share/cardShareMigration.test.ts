import test from 'node:test';import assert from 'node:assert/strict';
import {migrateCardShareLinks,CARD_SHARE_PLAN_SHA256} from './cardShareMigration';
import {verifyCardLinkRuntimeSchema} from './cardLinkSchemaContract';
test('B1 operator migration requires separate explicit acknowledgement, verified digest and matching physical target before DDL',async()=>{
 const calls:string[]=[];const db={getConnection:async()=>({async query(sql:string):Promise<[unknown,unknown]>{calls.push(sql);return [[{database_name:'other',server_uuid:'a937ff09-72b6-11f1-b04e-52540034488b'}],[]];},release(){},destroy(){}})};
 const target={database:'fabric_db',serverUuid:'a937ff09-72b6-11f1-b04e-52540034488b'};
 for(const [confirmation,sha] of [['APPLY_ADDITIVE_V2','a'.repeat(64)],['APPLY_CARD_SHARE','bad']])await assert.rejects(migrateCardShareLinks(db,target,sha,confirmation));
 assert.equal(calls.length,0);await assert.rejects(migrateCardShareLinks(db,target,'a'.repeat(64),'APPLY_CARD_SHARE'));assert.equal(calls.length,1);assert(!calls.some(x=>/CREATE|ALTER|INSERT/.test(x)));assert.match(CARD_SHARE_PLAN_SHA256,/^[a-f0-9]{64}$/);
});
test('B1 runtime schema gate rejects unconfigured identity without borrowing the sandbox exemption',async()=>{
 let opened=0;const pool={async getConnection(){opened++;throw Error('must not open');}};
 await assert.rejects(verifyCardLinkRuntimeSchema(pool,{database:'fabric_db; DROP',serverUuid:'a937ff09-72b6-11f1-b04e-52540034488b'}));assert.equal(opened,0);
});
test('card migration acquires one physical connection for identity, advisory lock and DDL, releasing it on failure',async()=>{
 const calls:string[]=[],target={database:'fabric_db',serverUuid:'a937ff09-72b6-11f1-b04e-52540034488b'};let opened=0,released=0;
 const pool={getConnection:async()=>{opened++;return {query:async(sql:string):Promise<[unknown,unknown]>=>{calls.push(sql);if(sql.includes('@@server_uuid'))return [[{database_name:target.database,server_uuid:target.serverUuid}],[]];if(sql.includes('GET_LOCK'))return [[{acquired:1}],[]];if(sql.includes('RELEASE_LOCK'))return [[{released:1}],[]];throw Error('fixture-stop');},release(){released++;},destroy(){assert.fail('lock was released normally');}};}};
 await assert.rejects(()=>migrateCardShareLinks(pool,target,'a'.repeat(64),'APPLY_CARD_SHARE'),/fixture-stop/);
 assert.equal(opened,1);assert.equal(released,1);assert(calls.some(s=>s.includes('RELEASE_LOCK')));assert(!calls.some(s=>/CREATE|ALTER/.test(s)));
});
test('failed advisory unlock discards the physical connection and never reports migration success',async()=>{
 const target={database:'fabric_db',serverUuid:'a937ff09-72b6-11f1-b04e-52540034488b'};let released=0,destroyed=0;
 const pool={getConnection:async()=>({query:async(sql:string):Promise<[unknown,unknown]>=>{
  if(sql.includes('@@server_uuid'))return [[{database_name:target.database,server_uuid:target.serverUuid}],[]];
  if(sql.includes('GET_LOCK'))return [[{acquired:1}],[]];if(sql.includes('RELEASE_LOCK'))return [[{released:0}],[]];throw Error('fixture-stop');
 },release(){released++;},destroy(){destroyed++;}})};
 await assert.rejects(migrateCardShareLinks(pool,target,'a'.repeat(64),'APPLY_CARD_SHARE'),/lock release unverified/);assert.equal(released,0);assert.equal(destroyed,1);
});
test('uncertain advisory lock acquisition discards the connection rather than returning a potentially locked session',async()=>{
 const target={database:'fabric_db',serverUuid:'a937ff09-72b6-11f1-b04e-52540034488b'};let destroyed=0;
 const pool={getConnection:async()=>({query:async(sql:string):Promise<[unknown,unknown]>=>{if(sql.includes('@@server_uuid'))return [[{database_name:target.database,server_uuid:target.serverUuid}],[]];throw Error('lost response');},release(){assert.fail('uncertain lock session returned to pool');},destroy(){destroyed++;}})};
 await assert.rejects(migrateCardShareLinks(pool,target,'a'.repeat(64),'APPLY_CARD_SHARE'),/lost response/);assert.equal(destroyed,1);
});
test('malformed advisory lock replies discard uncertain sessions without executing DDL',async()=>{
 const target={database:'fabric_db',serverUuid:'a937ff09-72b6-11f1-b04e-52540034488b'};
 for(const reply of [[],[{acquired:'unknown'}],[{acquired:1},{acquired:1}],[{}],[{acquired:true}],[{acquired:'01'}]]){
  let released=0,destroyed=0;const calls:string[]=[];
  const pool={getConnection:async()=>({query:async(sql:string):Promise<[unknown,unknown]>=>{calls.push(sql);if(sql.includes('@@server_uuid'))return [[{database_name:target.database,server_uuid:target.serverUuid}],[]];if(sql.includes('GET_LOCK'))return [reply,[]];throw Error('unexpected SQL');},release(){released++;},destroy(){destroyed++;}})};
  await assert.rejects(migrateCardShareLinks(pool,target,'a'.repeat(64),'APPLY_CARD_SHARE'));
  assert.equal(destroyed,1,JSON.stringify(reply));assert.equal(released,0);assert(!calls.some(sql=>/CREATE|ALTER|INSERT/.test(sql)));
 }
});
test('known unavailable advisory lock replies return unlocked sessions normally',async()=>{
 const target={database:'fabric_db',serverUuid:'a937ff09-72b6-11f1-b04e-52540034488b'};
 for(const acquired of [0,'0',null]){
  let released=0,destroyed=0;
  const pool={getConnection:async()=>({query:async(sql:string):Promise<[unknown,unknown]>=>sql.includes('@@server_uuid')?[[{database_name:target.database,server_uuid:target.serverUuid}],[]]:[[{acquired}],[]],release(){released++;},destroy(){destroyed++;}})};
  await assert.rejects(migrateCardShareLinks(pool,target,'a'.repeat(64),'APPLY_CARD_SHARE'),/lock unavailable/);assert.equal(released,1);assert.equal(destroyed,0);
 }
});
test('operator migration validates schema before marking applied; retry and repeat are safe on one owned connection',async()=>{
 const target={database:'fabric_db',serverUuid:'a937ff09-72b6-11f1-b04e-52540034488b'},calls:string[]=[];
 let applied=false,ledger=false,badSchema=true,opened=0,released=0;
 const cols=[['id','bigint unsigned','NO','auto_increment'],['card_id','bigint unsigned','NO',''],['token_hash','char(64)','NO',''],['status',"enum('active','inactive','revoked')",'NO',''],['revoked_at','datetime','YES',''],['created_at','datetime','NO','']].map(([COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,EXTRA])=>({COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,EXTRA,COLUMN_DEFAULT:COLUMN_NAME==='status'?'active':COLUMN_NAME==='created_at'?'CURRENT_TIMESTAMP':null,CHARACTER_SET_NAME:COLUMN_NAME==='token_hash'?'ascii':null,COLLATION_NAME:COLUMN_NAME==='token_hash'?'ascii_bin':null}));
 const index=(INDEX_NAME:string,COLUMN_NAME:string)=>({INDEX_NAME,COLUMN_NAME,NON_UNIQUE:0,SEQ_IN_INDEX:1,SUB_PART:null,INDEX_TYPE:'BTREE'});
 const pool={getConnection:async()=>{opened++;return {async query(sql:string,args:unknown[]=[]):Promise<[unknown,unknown]>{
  calls.push(sql);
  if(sql.includes('@@server_uuid'))return [[{database_name:target.database,selected_database:target.database,server_uuid:target.serverUuid}],[]];
  if(sql.includes('GET_LOCK'))return [[{acquired:1}],[]];if(sql.includes('RELEASE_LOCK'))return [[{released:1}],[]];
  if(sql.startsWith('SELECT plan_sha256'))return [ledger?[{plan_sha256:CARD_SHARE_PLAN_SHA256,applied_at:applied?'done':null}]:[],[]];
  if(sql.startsWith('INSERT IGNORE')){ledger=true;return [{affectedRows:1},[]];}
  if(sql.startsWith('CREATE TABLE')){assert(sql.startsWith('CREATE TABLE IF NOT EXISTS card_share_links'));return [[],[]];}
  if(sql.startsWith('UPDATE fabric_v2_migration_ledger')){applied=true;return [{affectedRows:1},[]];}
  if(sql.includes('INFORMATION_SCHEMA.TABLES'))return [badSchema?[]:[{TABLE_NAME:'card_share_links',ENGINE:'InnoDB'},{TABLE_NAME:'sample_cards',ENGINE:'InnoDB'}],[]];
  if(sql.includes('INFORMATION_SCHEMA.COLUMNS'))return [args[0]==='sample_cards'?[cols[0]]:cols,[]];
  if(sql.includes('INFORMATION_SCHEMA.STATISTICS'))return [args[0]==='sample_cards'?[index('PRIMARY','id')]:[index('PRIMARY','id'),index('uq_card_share_token','token_hash'),index('uq_card_share_card','card_id')],[]];
  if(sql.includes('INFORMATION_SCHEMA.KEY_COLUMN_USAGE'))return [[{CONSTRAINT_NAME:'fk_card_share_card',COLUMN_NAME:'card_id',REFERENCED_TABLE_SCHEMA:target.database,REFERENCED_TABLE_NAME:'sample_cards',REFERENCED_COLUMN_NAME:'id',ORDINAL_POSITION:1,DELETE_RULE:'CASCADE',UPDATE_RULE:'NO ACTION'}],[]];
  throw Error('Unexpected SQL');
 },release(){released++;},destroy(){assert.fail('normal migration cleanup must unlock and release');}};}};
 await assert.rejects(migrateCardShareLinks(pool,target,'a'.repeat(64),'APPLY_CARD_SHARE'),/metadata mismatch/);assert.equal(applied,false);assert.equal(released,1);
 badSchema=false;assert.equal((await migrateCardShareLinks(pool,target,'a'.repeat(64),'APPLY_CARD_SHARE')).alreadyApplied,false);
 const creates=calls.filter(s=>s.startsWith('CREATE TABLE')).length;
 assert.equal((await migrateCardShareLinks(pool,target,'a'.repeat(64),'APPLY_CARD_SHARE')).alreadyApplied,true);
 assert.equal(calls.filter(s=>s.startsWith('CREATE TABLE')).length,creates);assert.equal(opened,3);assert.equal(released,3);
});
