import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {CUSTOMER_SCHEMA_SQL,CUSTOMER_PLAN_SHA256,migrateCustomers,verifyCustomerSchema} from './schema';

type Row=Record<string,any>;
const target={database:'fabric_customer_test',serverUuid:'a937ff09-72b6-11f1-b04e-52540034488b'};
const big='bigint unsigned';
const columns:Record<string,Record<string,string>>={
 v2_access_users:{id:big},customer_sample_sessions:{id:big},
 customers:{id:big,display_name:'varchar(160)',profile_json:'json',search_text:'text',owner_user_id:big,created_by_user_id:big,sales_channel:"enum('online','offline','both','unknown')",tier:"enum('A','B','C','unrated')",relationship_stage:"enum('prospect','sampling','trading','repeat','unknown')",archived_at:'datetime?',row_version:big,created_at:'datetime'},
 customer_access:{customer_id:big,user_id:big,permission:"enum('view','edit')",granted_by:big},
 customer_profile_events:{id:big,customer_id:big,actor_user_id:big,event_type:'varchar(60)',detail_json:'json',created_at:'datetime'},
 customer_session_links:{session_id:big,customer_id:big+'?',row_version:big,linked_by_user_id:big},
 customer_requests:{actor_user_id:big,request_id:'char(36)',payload_hash:'char(64)',result_json:'json?'},
 customer_followups:{id:big,customer_id:big,actor_user_id:big,session_id:big+'?',contacted_on:'date',feedback:'varchar(2000)?',outcome:'varchar(400)'},
 customer_followup_tasks:{id:big,customer_id:big,assignee_user_id:big,source_followup_id:big,due_on:'date?',next_action:'varchar(400)',status:"enum('open','done','cancelled')",row_version:big}
};
const keys:Record<string,string[][]>={v2_access_users:[['id']],customer_sample_sessions:[['id']],customers:[['id']],customer_access:[['customer_id','user_id']],customer_profile_events:[['id']],customer_session_links:[['session_id']],customer_requests:[['actor_user_id','request_id']],customer_followups:[['id']],customer_followup_tasks:[['id'],['source_followup_id']]};
const fks:Record<string,Record<string,string>>={customers:{owner_user_id:'v2_access_users',created_by_user_id:'v2_access_users'},customer_access:{customer_id:'customers',user_id:'v2_access_users',granted_by:'v2_access_users'},customer_profile_events:{customer_id:'customers',actor_user_id:'v2_access_users'},customer_session_links:{session_id:'customer_sample_sessions',customer_id:'customers',linked_by_user_id:'v2_access_users'},customer_requests:{actor_user_id:'v2_access_users'},customer_followups:{customer_id:'customers',actor_user_id:'v2_access_users',session_id:'customer_sample_sessions'},customer_followup_tasks:{customer_id:'customers',assignee_user_id:'v2_access_users',source_followup_id:'customer_followups'}};
function fixture(){
 const meta={tables:Object.keys(columns).map(TABLE_NAME=>({TABLE_NAME,ENGINE:'InnoDB'})) as Row[],columns:{} as Record<string,Row[]>,indexes:{} as Record<string,Row[]>,fks:{} as Record<string,Row[]>};
 for(const [table,cols] of Object.entries(columns)){
  meta.columns[table]=Object.entries(cols).map(([COLUMN_NAME,t])=>({COLUMN_NAME,COLUMN_TYPE:t.replace(/\?$/,''),IS_NULLABLE:t.endsWith('?')?'YES':'NO',EXTRA:COLUMN_NAME==='id'?'auto_increment':'',COLUMN_DEFAULT:COLUMN_NAME==='row_version'?'1':COLUMN_NAME==='created_at'?'CURRENT_TIMESTAMP':COLUMN_NAME==='status'?'open':null,CHARACTER_SET_NAME:['request_id','payload_hash'].includes(COLUMN_NAME)?'ascii':null,COLLATION_NAME:['request_id','payload_hash'].includes(COLUMN_NAME)?'ascii_bin':null}));
  meta.indexes[table]=keys[table].flatMap((cols,k)=>cols.map((COLUMN_NAME,i)=>({INDEX_NAME:k?'unique_'+k:'PRIMARY',COLUMN_NAME,NON_UNIQUE:0,SEQ_IN_INDEX:i+1,SUB_PART:null,INDEX_TYPE:'BTREE',IS_VISIBLE:'YES',EXPRESSION:null})));
  meta.fks[table]=Object.entries(fks[table]??{}).map(([COLUMN_NAME,REFERENCED_TABLE_NAME])=>({CONSTRAINT_NAME:'fk_'+COLUMN_NAME,COLUMN_NAME,REFERENCED_TABLE_SCHEMA:target.database,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME:'id',ORDINAL_POSITION:1,DELETE_RULE:'RESTRICT',UPDATE_RULE:'RESTRICT'}));
 }
 const state={calls:[] as string[],opened:0,released:0,destroyed:0,ledger:false,applied:false,plan:CUSTOMER_PLAN_SHA256,identity:target.database,uuid:target.serverUuid,acquired:[{acquired:1}] as unknown,releasedReply:[{released:1}] as unknown,badSchema:false,throwAcquire:false,throwRelease:false,ledgerRows:null as Row[]|null};
 const pool={async getConnection(){state.opened++;return {async query(sql:string,args:unknown[]=[]):Promise<[unknown,unknown]>{
  state.calls.push(sql);
  if(sql.includes('@@server_uuid'))return [[{selected_database:state.identity,database_name:state.identity,server_uuid:state.uuid}],[]];
  if(sql.includes('GET_LOCK')){if(state.throwAcquire)throw Error('lost acquisition');return [state.acquired,[]];}
  if(sql.includes('RELEASE_LOCK')){if(state.throwRelease)throw Error('lost release');return [state.releasedReply,[]];}
  if(sql.startsWith('SELECT plan_sha256'))return [state.ledgerRows??(state.ledger?[{plan_sha256:state.plan,applied_at:state.applied?'done':null}]:[]),[]];
  if(sql.startsWith('INSERT IGNORE')){state.ledger=true;return [{affectedRows:1},[]];}
  if(sql.startsWith('UPDATE fabric_v2_migration_ledger')){state.applied=true;return [{affectedRows:1},[]];}
  if(sql.startsWith('CREATE TABLE'))return [[],[]];
  const name=String(args[0]);
  if(sql.includes('INFORMATION_SCHEMA.TABLES'))return [state.badSchema?[]:meta.tables,[]];
  if(sql.includes('INFORMATION_SCHEMA.COLUMNS'))return [meta.columns[name],[]];
  if(sql.includes('INFORMATION_SCHEMA.STATISTICS'))return [meta.indexes[name],[]];
  if(sql.includes('INFORMATION_SCHEMA.KEY_COLUMN_USAGE'))return [meta.fks[name],[]];
  throw Error('Unexpected SQL '+sql);
 },release(){state.released++;},destroy(){state.destroyed++;}};}};
 return {meta,state,pool};
}
test('customer runtime metadata uses one pinned physical connection and SELECT only',async()=>{
 const f=fixture();await verifyCustomerSchema(f.pool,target);assert.equal(f.state.opened,1);assert.equal(f.state.released,1);assert(f.state.calls.every(s=>s.startsWith('SELECT ')));
});
test('customer schema requires an explicit exact database and server UUID before reading metadata',async()=>{
 const f=fixture();for(const t of [{...target,database:'bad;sql'},{...target,serverUuid:''}])await assert.rejects(verifyCustomerSchema(f.pool,t));assert.equal(f.state.opened,0);
 for(const key of ['identity','uuid'] as const){const x=fixture();x.state[key]='other';await assert.rejects(verifyCustomerSchema(x.pool,target),/identity/);assert.equal(x.state.calls.length,1);assert.equal(x.state.released,1);}
});
test('customer schema fails closed for every required column and table engine',async()=>{
 for(const table of Object.keys(columns)){
  const f=fixture();f.meta.tables.find(r=>r.TABLE_NAME===table)!.ENGINE='MyISAM';await assert.rejects(verifyCustomerSchema(f.pool,target),/InnoDB/);
  for(const col of Object.keys(columns[table])){const f=fixture();f.meta.columns[table]=f.meta.columns[table].filter(r=>r.COLUMN_NAME!==col);await assert.rejects(verifyCustomerSchema(f.pool,target),/column/);}
 }
});
test('customer metadata rejects wrong nullability, defaults, generated columns and nonbinary request identity',async()=>{
 for(const [table,column,patch] of [
  ['customer_session_links','customer_id',{IS_NULLABLE:'NO'}],['customers','row_version',{COLUMN_DEFAULT:'0'}],['customers','created_at',{COLUMN_DEFAULT:null}],['customers','id',{EXTRA:''}],['customers','display_name',{EXTRA:'STORED GENERATED'}],['customer_followup_tasks','status',{COLUMN_DEFAULT:'done'}],['customer_requests','request_id',{COLLATION_NAME:'ascii_general_ci'}],['customer_requests','payload_hash',{CHARACTER_SET_NAME:'utf8mb4'}]
 ] as [string,string,Row][]){const f=fixture();Object.assign(f.meta.columns[table].find(r=>r.COLUMN_NAME===column)!,patch);await assert.rejects(verifyCustomerSchema(f.pool,target),/column/);}
});
test('all keys must be complete unique BTREE keys, without prefixes, extra parts or invisible indexes',async()=>{
 for(const [table,list] of Object.entries(keys))for(let k=0;k<list.length;k++)for(const patch of [{NON_UNIQUE:1},{SUB_PART:4},{INDEX_TYPE:'HASH'},{SEQ_IN_INDEX:9},{IS_VISIBLE:'NO'},{EXPRESSION:'id + 1'}]){const f=fixture();Object.assign(f.meta.indexes[table].find(r=>r.INDEX_NAME===(k?'unique_'+k:'PRIMARY'))!,patch);await assert.rejects(verifyCustomerSchema(f.pool,target),/index/);}
 const f=fixture();f.meta.indexes.customer_access.push({...f.meta.indexes.customer_access[0],COLUMN_NAME:'permission',SEQ_IN_INDEX:3});await assert.rejects(verifyCustomerSchema(f.pool,target),/index/);
});
test('every foreign key must be singular, same-schema, RESTRICT and point to the exact parent id',async()=>{
 for(const [table,list] of Object.entries(fks))for(const col of Object.keys(list))for(const patch of [{REFERENCED_TABLE_SCHEMA:'other'},{REFERENCED_TABLE_NAME:'wrong'},{REFERENCED_COLUMN_NAME:'wrong'},{DELETE_RULE:'CASCADE'},{UPDATE_RULE:'CASCADE'},{ORDINAL_POSITION:2}]){const f=fixture();Object.assign(f.meta.fks[table].find(r=>r.COLUMN_NAME===col)!,patch);await assert.rejects(verifyCustomerSchema(f.pool,target),/foreign key/);}
 const f=fixture();f.meta.fks.customers.push({...f.meta.fks.customers[0],CONSTRAINT_NAME:'extra'});await assert.rejects(verifyCustomerSchema(f.pool,target),/foreign key/);
});
test('customer SQL is additive and preserves nullable unlink tombstones; digest pins the full ordered plan',()=>{
 assert.equal(CUSTOMER_SCHEMA_SQL.length,7);for(const sql of CUSTOMER_SCHEMA_SQL){assert.match(sql,/^CREATE TABLE IF NOT EXISTS /);assert.match(sql,/ENGINE=InnoDB/);assert.doesNotMatch(sql,/ALTER TABLE|DROP TABLE|CASCADE/);}
 assert.match(CUSTOMER_SCHEMA_SQL.find(s=>s.includes('customer_session_links'))!,/customer_id BIGINT UNSIGNED NULL/);
 assert.equal(CUSTOMER_PLAN_SHA256,createHash('sha256').update(CUSTOMER_SCHEMA_SQL.join('\n\n')).digest('hex'));
});
test('operator migration validates confirmation, backup and target before touching a connection',async()=>{
 const f=fixture();for(const [sha,confirmation] of [['bad','APPLY_CUSTOMERS'],['a'.repeat(64),'APPLY_ADDITIVE_V2']])await assert.rejects(migrateCustomers(f.pool,target,sha,confirmation));assert.equal(f.state.opened,0);
 f.state.uuid='other';await assert.rejects(migrateCustomers(f.pool,target,'a'.repeat(64),'APPLY_CUSTOMERS'),/identity/);assert.equal(f.state.calls.length,1);
});
test('uncertain advisory lock replies and thrown acquisitions destroy physical connections without writes',async()=>{
 for(const reply of [[],[{}],[{acquired:true}],[{acquired:'01'}],[{acquired:1},{acquired:1}],null]){const f=fixture();f.state.acquired=reply;await assert.rejects(migrateCustomers(f.pool,target,'a'.repeat(64),'APPLY_CUSTOMERS'));assert.equal(f.state.destroyed,1);assert.equal(f.state.released,0);assert(!f.state.calls.some(s=>/^(CREATE|INSERT|UPDATE)/.test(s)));}
 const f=fixture();f.state.throwAcquire=true;await assert.rejects(migrateCustomers(f.pool,target,'a'.repeat(64),'APPLY_CUSTOMERS'),/lost acquisition/);assert.equal(f.state.destroyed,1);
});
test('recognized unavailable locks release safe connections',async()=>{
 for(const acquired of [0,'0',null]){const f=fixture();f.state.acquired=[{acquired}];await assert.rejects(migrateCustomers(f.pool,target,'a'.repeat(64),'APPLY_CUSTOMERS'),/lock unavailable/);assert.equal(f.state.destroyed,0);assert.equal(f.state.released,1);}
});
test('migration checks ledger drift, validates schema before applied, and retries idempotently on one physical connection',async()=>{
 const f=fixture();f.state.badSchema=true;await assert.rejects(migrateCustomers(f.pool,target,'a'.repeat(64),'APPLY_CUSTOMERS'),/metadata/);assert.equal(f.state.applied,false);
 f.state.badSchema=false;assert.equal((await migrateCustomers(f.pool,target,'a'.repeat(64),'APPLY_CUSTOMERS')).alreadyApplied,false);const creates=f.state.calls.filter(s=>s.startsWith('CREATE')).length;
 assert.equal((await migrateCustomers(f.pool,target,'a'.repeat(64),'APPLY_CUSTOMERS')).alreadyApplied,true);assert.equal(f.state.calls.filter(s=>s.startsWith('CREATE')).length,creates);assert.equal(f.state.opened,3);assert.equal(f.state.released,3);
 f.state.badSchema=true;await assert.rejects(migrateCustomers(f.pool,target,'a'.repeat(64),'APPLY_CUSTOMERS'),/metadata/);
 for(const ledgerRows of [[{plan_sha256:'wrong',applied_at:null}],[{plan_sha256:CUSTOMER_PLAN_SHA256},{plan_sha256:CUSTOMER_PLAN_SHA256}]]){const x=fixture();x.state.ledgerRows=ledgerRows;await assert.rejects(migrateCustomers(x.pool,target,'a'.repeat(64),'APPLY_CUSTOMERS'),/plan drift/);assert(!x.state.calls.some(s=>s.startsWith('CREATE')));}
});
test('unverified advisory release destroys the connection and rejects apparent migration success',async()=>{
 for(const reply of [[],[{released:0}],[{released:'01'}],[{released:true}],[{released:1},{released:1}],null]){const f=fixture();f.state.releasedReply=reply;await assert.rejects(migrateCustomers(f.pool,target,'a'.repeat(64),'APPLY_CUSTOMERS'),/release unverified/);assert.equal(f.state.destroyed,1);assert.equal(f.state.released,0);}
 const f=fixture();f.state.throwRelease=true;await assert.rejects(migrateCustomers(f.pool,target,'a'.repeat(64),'APPLY_CUSTOMERS'),/release unverified/);assert.equal(f.state.destroyed,1);
});
