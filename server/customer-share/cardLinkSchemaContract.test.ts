import assert from 'node:assert/strict';
import test from 'node:test';
import {verifyCardLinkSchemaContract} from './cardLinkSchemaContract';

type Row=Record<string,unknown>;
const c=(name:string,type:string,nullability:'YES'|'NO'='NO',extra='',charset:unknown=null,collation:unknown=null):Row=>({
 COLUMN_NAME:name,COLUMN_TYPE:type,IS_NULLABLE:nullability,EXTRA:extra,
 COLUMN_DEFAULT:name==='status'?'active':name==='created_at'?'CURRENT_TIMESTAMP':null,
 CHARACTER_SET_NAME:charset,COLLATION_NAME:collation,
});
const i=(name:string,seq:number,column:string,nonUnique=0):Row=>({
 INDEX_NAME:name,SEQ_IN_INDEX:seq,COLUMN_NAME:column,NON_UNIQUE:nonUnique,
 SUB_PART:null,INDEX_TYPE:'BTREE',
});
function fixture(){
 const metadata={
  columns:[
   c('id','bigint unsigned','NO','auto_increment'),
   c('card_id','bigint unsigned'),
   c('token_hash','char(64)','NO','','ascii','ascii_bin'),
   c('status',"enum('active','inactive','revoked')"),
   c('revoked_at','datetime','YES'),
   c('created_at','datetime'),
  ],
  indexes:[i('PRIMARY',1,'id'),i('uq_card_share_token',1,'token_hash'),i('uq_card_share_card',1,'card_id')],
  parentIndexes:[i('PRIMARY',1,'id')],
  fks:[{CONSTRAINT_NAME:'fk_card_share_card',COLUMN_NAME:'card_id',REFERENCED_TABLE_SCHEMA:'fabric_v2_test_b1_links',REFERENCED_TABLE_NAME:'sample_cards',
   REFERENCED_COLUMN_NAME:'id',DELETE_RULE:'CASCADE',UPDATE_RULE:'RESTRICT',ORDINAL_POSITION:1}],
  tables:[{TABLE_NAME:'card_share_links',ENGINE:'InnoDB'},{TABLE_NAME:'sample_cards',ENGINE:'InnoDB'}],
  masterColumns:[c('id','bigint unsigned','NO','auto_increment')],
  identity:{selected_database:'fabric_v2_test_b1_links',server_uuid:'11111111-1111-4111-8111-111111111111'},
  released:0,
  calls:[] as {sql:string;params:unknown[]}[]
 };
 const pool={async getConnection(){return {
  async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>{
   metadata.calls.push({sql,params});
   assert.match(sql,/^SELECT\s/i,'B1 preflight must be SELECT-only');
   if(sql.includes('@@server_uuid'))return [[metadata.identity],[]];
   if(sql.includes('INFORMATION_SCHEMA.TABLES'))return [metadata.tables,[]];
   if(sql.includes('INFORMATION_SCHEMA.COLUMNS')){
    return [params[0]==='sample_cards'?metadata.masterColumns:metadata.columns,[]];
   }
   if(sql.includes('INFORMATION_SCHEMA.STATISTICS'))return [params[0]==='sample_cards'?metadata.parentIndexes:metadata.indexes,[]];
   if(sql.includes('INFORMATION_SCHEMA.KEY_COLUMN_USAGE'))return [metadata.fks,[]];
   throw Error('Unrecognized information_schema query');
  },
  release(){metadata.released++;}
 }}};
 return {metadata,pool,expectedDatabase:'fabric_v2_test_b1_links',expectedUUID:'11111111-1111-4111-8111-111111111111'};
}
async function rejected(db:ReturnType<typeof fixture>,why:RegExp){
 await assert.rejects(()=>verifyCardLinkSchemaContract(db.pool,db.expectedDatabase,db.expectedUUID),why);
 assert.equal(db.metadata.released,1);
}
test('B1 schema gate checks exact physical server UUID, db, parent, data types, uniqueness, FK with SELECT-only single connection',async()=>{
 const db=fixture();
 await verifyCardLinkSchemaContract(db.pool,db.expectedDatabase,db.expectedUUID);
 assert.equal(db.metadata.released,1);
 assert(db.metadata.calls.length>=6);
 assert(db.metadata.calls.every(x=>x.sql.startsWith('SELECT')));
 assert.deepEqual(db.metadata.calls[0].params,[]);
 assert.equal(db.metadata.calls.filter(x=>x.sql.includes('INFORMATION_SCHEMA.COLUMNS')).length,2);
});
test('B1 never accepts wrong physical database or MySQL server UUID, even with identical tables',async()=>{
 for(const [field,value] of [['selected_database','fabric_cardion'],['server_uuid','22222222-2222-4222-8222-222222222222']] as const){
  const db=fixture();db.metadata.identity[field]=value;
  await rejected(db,/identity/i);
  assert.equal(db.metadata.calls.length,1);
 }
 const db=fixture();
 await assert.rejects(()=>verifyCardLinkSchemaContract(db.pool,'fabric_cardion',db.expectedUUID),/sandbox/i);
 assert.equal(db.metadata.calls.length,0);
 const noKey=fixture();
 await assert.rejects(()=>verifyCardLinkSchemaContract(noKey.pool,noKey.expectedDatabase,'not-a-uuid'),/identity/i);
 assert.equal(noKey.metadata.calls.length,0);
});
test('B1 rejects missing table, wrong engine, wrong parent engine or parent ID type',async()=>{
 for(const target of ['card_share_links','sample_cards']){
  const db=fixture();db.metadata.tables=db.metadata.tables.filter(x=>x.TABLE_NAME!==target);
  await rejected(db,/table/i);
  const engine=fixture();engine.metadata.tables.find(x=>x.TABLE_NAME===target)!.ENGINE='MyISAM';
  await rejected(engine,/InnoDB/i);
 }
 const bad=fixture();bad.metadata.masterColumns[0].COLUMN_TYPE='int unsigned';
 await rejected(bad,/parent.*id/i);
});
test('B1 requires the referenced parent master ID to be a complete unique primary key',async()=>{
 for(const change of [
  (rows:Row[])=>rows.splice(0),
  (rows:Row[])=>{rows[0].COLUMN_NAME='master_no'},
  (rows:Row[])=>{rows[0].NON_UNIQUE=1},
  (rows:Row[])=>{rows[0].SUB_PART=10},
  (rows:Row[])=>rows.push({...rows[0]})
 ]){
  const db=fixture();change(db.metadata.parentIndexes);
  await rejected(db,/parent.*primary/i);
 }
});
test('B1 fails closed for missing, relaxed, wrong-charset or changed-column metadata',async()=>{
 for(const [colName,field,value] of [
  ['token_hash','COLUMN_TYPE','varchar(64)'],['token_hash','IS_NULLABLE','YES'],
  ['token_hash','CHARACTER_SET_NAME','utf8mb4'],['token_hash','COLLATION_NAME','ascii_general_ci'],
  ['card_id','COLUMN_TYPE','bigint'],['status','COLUMN_TYPE','varchar(32)'],
  ['revoked_at','IS_NULLABLE','NO'],['id','EXTRA',''],
 ] as const){
  const db=fixture();
  db.metadata.columns.find(x=>x.COLUMN_NAME===colName)![field]=value;
  await rejected(db,new RegExp(colName));
 }
 for(const name of ['token_hash','status','card_id']){
  const db=fixture();db.metadata.columns=db.metadata.columns.filter(x=>x.COLUMN_NAME!==name);
  await rejected(db,new RegExp(name));
 }
});
test('B1 requires configured active-by-default status and current created timestamp without rewrites',async()=>{
 for(const [name,bad] of [['status','revoked'],['status',null],['created_at',null]] as const){
  const db=fixture();db.metadata.columns.find(x=>x.COLUMN_NAME===name)!.COLUMN_DEFAULT=bad;
  await rejected(db,new RegExp(name));
 }
});
test('B1 rejects dropped, prefix, non-unique, wrongly ordered or duplicate token/master index',async()=>{
 for(const indexName of ['PRIMARY','uq_card_share_card','uq_card_share_token']){
  const db=fixture();db.metadata.indexes=db.metadata.indexes.filter(x=>x.INDEX_NAME!==indexName);
  await rejected(db,/index/i);
  const notUnique=fixture();notUnique.metadata.indexes.find(x=>x.INDEX_NAME===indexName)!.NON_UNIQUE=1;
  await rejected(notUnique,/index/i);
  const prefix=fixture();prefix.metadata.indexes.find(x=>x.INDEX_NAME===indexName)!.SUB_PART=16;
  await rejected(prefix,/index/i);
  const duplicate=fixture();duplicate.metadata.indexes.push({...duplicate.metadata.indexes.find(x=>x.INDEX_NAME===indexName)!});
  await rejected(duplicate,/index/i);
 }
 const reordered=fixture();reordered.metadata.indexes.find(x=>x.INDEX_NAME==='uq_card_share_card')!.COLUMN_NAME='token_hash';
 await rejected(reordered,/index/i);
});
test('B1 accepts the MySQL InnoDB default NO ACTION update rule from its own approved DDL',async()=>{
 const db=fixture();db.metadata.fks[0].UPDATE_RULE='NO ACTION';await verifyCardLinkSchemaContract(db.pool,db.expectedDatabase,db.expectedUUID);
});
test('card link deletion follows the deleted card and requires exactly one CASCADE FK',async()=>{
 for(const [field,value] of [
  ['DELETE_RULE','RESTRICT'],['DELETE_RULE','NO ACTION'],['UPDATE_RULE','CASCADE'],
  ['COLUMN_NAME','token_hash'],['REFERENCED_TABLE_NAME','other_masters'],
  ['REFERENCED_COLUMN_NAME','master_no']
 ] as const){
  const db=fixture();db.metadata.fks[0][field]=value;
  await rejected(db,/foreign key/i);
 }
 const missing=fixture();missing.metadata.fks=[];
 await rejected(missing,/foreign key/i);
 const rogue=fixture();rogue.metadata.fks.push({
  ...rogue.metadata.fks[0],CONSTRAINT_NAME:'fk_rogue_cascade',DELETE_RULE:'CASCADE'
 });
 await rejected(rogue,/foreign key/i);
});
test('card link FK must point to the pinned database, never a same-named card table in another schema',async()=>{
 const db=fixture();db.metadata.fks[0].REFERENCED_TABLE_SCHEMA='other_database';await rejected(db,/foreign key/i);
});
test('B1 refuses driver errors, malformed row arrays and releases connection on all failures',async()=>{
 const db=fixture();
 db.metadata.indexes=[];await rejected(db,/index/i);
 const malformed={getConnection:async()=>({query:async()=>[{hello:'bad'},[]] as [unknown,unknown],release:()=>{}})};
 await assert.rejects(()=>verifyCardLinkSchemaContract(malformed,db.expectedDatabase,db.expectedUUID),/metadata/i);
 let released=0;
 const fails={getConnection:async()=>({
  query:async()=>{throw Error('PRIVATE_DRIVER_DETAILS_password=not_for_logs')},
  release:()=>{released++}
 })};
 await assert.rejects(()=>verifyCardLinkSchemaContract(fails,db.expectedDatabase,db.expectedUUID),
  (err:unknown)=>err instanceof Error&&!err.message.includes('PRIVATE_DRIVER_DETAILS')&&/metadata/.test(err.message));
 assert.equal(released,1);
});
