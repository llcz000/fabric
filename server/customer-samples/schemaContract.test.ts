import assert from 'node:assert/strict';
import test from 'node:test';
import {verifyB25SampleSchemaContract} from './schemaContract';

type Row=Record<string,unknown>;
const sampleTables=['sample_cards','sample_card_tokens','customer_sample_sessions',
 'customer_sample_session_access','customer_sample_selected_cards','customer_sample_scan_events',
 'customer_sample_items','customer_sample_item_sources','customer_sample_item_removal_events',
 'customer_sample_manual_events'];
const col=(name:string,type:string,nullable='NO',extra='',expression=''):Row=>({
 COLUMN_NAME:name,COLUMN_TYPE:type,IS_NULLABLE:nullable,EXTRA:extra,GENERATION_EXPRESSION:expression
});
const ix=(name:string,sequence:number,column:string,nonUnique=0):Row=>({
 INDEX_NAME:name,SEQ_IN_INDEX:sequence,COLUMN_NAME:column,NON_UNIQUE:nonUnique
});
const fk=(name:string,source:string,target:string):Row=>({
 CONSTRAINT_NAME:name,COLUMN_NAME:source,REFERENCED_TABLE_NAME:target,
 REFERENCED_COLUMN_NAME:'id',DELETE_RULE:'RESTRICT'
});
function fixture(){
 const columns:Record<string,Row[]>={
  sample_cards:[
   col('id','bigint unsigned'),col('master_id','bigint unsigned'),col('fabric_id','bigint unsigned'),
   col('card_no','varchar(129)'),col('qr_payload','varchar(128)'),col('is_active','tinyint(1)'),
   col('deleted_at','datetime','YES'),col('reprint_revision','bigint unsigned'),
   col('printed_revision','bigint unsigned'),
   col('active_master_id','bigint unsigned','YES','STORED GENERATED','case when (`deleted_at` is null) then `master_id` else NULL end'),
   col('active_fabric_id','bigint unsigned','YES','STORED GENERATED','case when (`deleted_at` is null) then `fabric_id` else NULL end'),
   col('active_card_no','varchar(129)','YES','STORED GENERATED','case when (`deleted_at` is null) then `card_no` else NULL end')
  ],
  sample_card_tokens:[col('id','bigint unsigned'),col('card_id','bigint unsigned'),
   col('token_hash','char(64)'),col('revoked_at','datetime','YES')],
  customer_sample_items:[col('id','bigint unsigned'),col('session_id','bigint unsigned'),
   col('product_id','bigint unsigned'),col('selected_by_user_id','bigint unsigned'),
   col('removed_at','datetime','YES'),col('removed_by_user_id','bigint unsigned','YES')],
  customer_sample_item_removal_events:[col('id','bigint unsigned'),col('session_id','bigint unsigned'),col('product_id','bigint unsigned'),col('actor_user_id','bigint unsigned'),col('removed_at','datetime')],
  customer_sample_manual_events:[col('id','bigint unsigned'),col('session_id','bigint unsigned'),col('product_id','bigint unsigned'),col('actor_user_id','bigint unsigned'),col('card_id','bigint unsigned','YES'),col('action',"enum('added','restored','already_selected')"),col('selected_at','datetime')],
 };
 const indexes:Record<string,Row[]>={
  sample_cards:[ix('PRIMARY',1,'id'),ix('uq_sample_card_combo',1,'active_master_id'),
   ix('uq_sample_card_combo',2,'active_fabric_id'),ix('uq_sample_card_no',1,'active_card_no'),
   ix('uq_sample_card_payload',1,'qr_payload')],
  sample_card_tokens:[ix('PRIMARY',1,'id'),ix('uq_sample_token_hash',1,'token_hash'),
   ix('uq_sample_token_card',1,'card_id')],
  customer_sample_items:[ix('PRIMARY',1,'id'),ix('uq_sample_session_product',1,'session_id'),ix('uq_sample_session_product',2,'product_id')],
  customer_sample_selected_cards:[ix('PRIMARY',1,'id'),ix('uq_sample_selected_card',1,'session_id'),ix('uq_sample_selected_card',2,'card_id')],
  customer_sample_item_sources:[ix('PRIMARY',1,'id'),ix('uq_sample_item_card_source',1,'session_id'),ix('uq_sample_item_card_source',2,'product_id'),ix('uq_sample_item_card_source',3,'card_id')],
 };
 const checks:Record<string,Row[]>={
  sample_cards:[{CONSTRAINT_NAME:'ck_sample_card_reprint_revision',ENFORCED:'YES'}],
  customer_sample_items:[{CONSTRAINT_NAME:'ck_sample_item_removal',ENFORCED:'YES'}],
 };
 const refs:Record<string,Row[]>={
  sample_card_tokens:[fk('fk_sample_token_card','card_id','sample_cards')],
  customer_sample_selected_cards:[fk('fk_sample_selected_card','card_id','sample_cards')],
  customer_sample_scan_events:[fk('fk_sample_event_card','card_id','sample_cards')],
  customer_sample_items:[fk('fk_sample_item_product','product_id','v2_products'),fk('fk_sample_item_removed_actor','removed_by_user_id','v2_access_users')],
  customer_sample_item_removal_events:[fk('fk_sample_removal_actor','actor_user_id','v2_access_users'),
   {CONSTRAINT_NAME:'fk_sample_removal_item',COLUMN_NAME:'session_id',REFERENCED_TABLE_NAME:'customer_sample_items',REFERENCED_COLUMN_NAME:'session_id',DELETE_RULE:'RESTRICT'},
   {CONSTRAINT_NAME:'fk_sample_removal_item',COLUMN_NAME:'product_id',REFERENCED_TABLE_NAME:'customer_sample_items',REFERENCED_COLUMN_NAME:'product_id',DELETE_RULE:'RESTRICT'}],
  customer_sample_manual_events:[fk('fk_sample_manual_actor','actor_user_id','v2_access_users'),fk('fk_sample_manual_card','card_id','sample_cards'),
   {CONSTRAINT_NAME:'fk_sample_manual_item',COLUMN_NAME:'session_id',REFERENCED_TABLE_NAME:'customer_sample_items',REFERENCED_COLUMN_NAME:'session_id',DELETE_RULE:'RESTRICT'},
   {CONSTRAINT_NAME:'fk_sample_manual_item',COLUMN_NAME:'product_id',REFERENCED_TABLE_NAME:'customer_sample_items',REFERENCED_COLUMN_NAME:'product_id',DELETE_RULE:'RESTRICT'}],
  customer_sample_item_sources:[fk('fk_sample_source_card','card_id','sample_cards'),
   fk('fk_sample_source_event','first_scan_event_id','customer_sample_scan_events'),
   {CONSTRAINT_NAME:'fk_sample_source_item',COLUMN_NAME:'session_id',REFERENCED_TABLE_NAME:'customer_sample_items',REFERENCED_COLUMN_NAME:'session_id',DELETE_RULE:'RESTRICT'},
   {CONSTRAINT_NAME:'fk_sample_source_item',COLUMN_NAME:'product_id',REFERENCED_TABLE_NAME:'customer_sample_items',REFERENCED_COLUMN_NAME:'product_id',DELETE_RULE:'RESTRICT'}]
 };
 let tables=sampleTables.slice();
 const engines=new Map(sampleTables.map(name=>[name,'InnoDB']));
 const calls:string[]=[];
 return {columns,indexes,checks,refs,calls,
  setTables(value:string[]){tables=value;},
  setEngine(name:string,value:string){engines.set(name,value);},
  async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]>{
   calls.push(sql);assert.match(sql,/^SELECT\s/i);
   const name=String(params[0]??'');
   if(sql.includes('INFORMATION_SCHEMA.TABLES'))return [tables.map(TABLE_NAME=>({TABLE_NAME,ENGINE:engines.get(TABLE_NAME)})),[]];
   if(sql.includes('INFORMATION_SCHEMA.COLUMNS'))return [columns[name]??[],[]];
   if(sql.includes('INFORMATION_SCHEMA.STATISTICS'))return [indexes[name]??[],[]];
   if(sql.includes('INFORMATION_SCHEMA.TABLE_CONSTRAINTS'))return [checks[name]??[],[]];
   if(sql.includes('INFORMATION_SCHEMA.KEY_COLUMN_USAGE'))return [refs[name]??[],[]];
   throw Error('Unexpected metadata query');
  }
 };
}
test('B3 metadata gate refuses missing removal schema/audit and broken retained history FKs without repairs',async()=>{
 for(const name of ['removed_at','removed_by_user_id']){
  const db=fixture();db.columns.customer_sample_items=db.columns.customer_sample_items.filter(c=>c.COLUMN_NAME!==name);
  await assert.rejects(verifyB25SampleSchemaContract(db),new RegExp(name));
 }
 const missing=fixture();missing.setTables(sampleTables.filter(t=>t!=='customer_sample_item_removal_events'));
 await assert.rejects(verifyB25SampleSchemaContract(missing),/customer_sample_item_removal_events/);
 for(const name of ['actor_user_id','removed_at']){
  const db=fixture();db.columns.customer_sample_item_removal_events=db.columns.customer_sample_item_removal_events.filter(c=>c.COLUMN_NAME!==name);
  await assert.rejects(verifyB25SampleSchemaContract(db),new RegExp(name));
 }
 const cascade=fixture();cascade.refs.customer_sample_item_removal_events[1].DELETE_RULE='CASCADE';
 await assert.rejects(verifyB25SampleSchemaContract(cascade),/fk_sample_removal_item/);
 const actor=fixture();actor.refs.customer_sample_items=actor.refs.customer_sample_items.filter(f=>f.CONSTRAINT_NAME!=='fk_sample_item_removed_actor');
 await assert.rejects(verifyB25SampleSchemaContract(actor),/fk_sample_item_removed_actor/);
 const check=fixture();check.checks.customer_sample_items=[];
 await assert.rejects(verifyB25SampleSchemaContract(check),/ck_sample_item_removal/);
});
test('B2-5 schema preflight accepts lifecycle/reprint/token/history contract using only read-only SQL',async()=>{
 const db=fixture();await verifyB25SampleSchemaContract(db);
 assert(db.calls.length>=9);
 assert(db.calls.every(s=>/^SELECT\s/i.test(s)));
});

test('card-only selection schema refuses a missing manual card reference and unsafe card deletion',async()=>{
 const missing=fixture();missing.columns.customer_sample_manual_events=missing.columns.customer_sample_manual_events.filter(c=>c.COLUMN_NAME!=='card_id');
 await assert.rejects(verifyB25SampleSchemaContract(missing),/card_id/);
 const unsafe=fixture();unsafe.refs.customer_sample_manual_events.find(x=>x.CONSTRAINT_NAME==='fk_sample_manual_card')!.DELETE_RULE='CASCADE';
 await assert.rejects(verifyB25SampleSchemaContract(unsafe),/fk_sample_manual_card/);
});
test('v1.50 schema preflight rejects legacy frozen attributes and incomplete selection identity columns',async()=>{
 const legacy=fixture();legacy.columns.customer_sample_items.push(col('product_snapshot_json','json'));
 await assert.rejects(verifyB25SampleSchemaContract(legacy),/customer_sample_items.*snapshot/i);
 const missing=fixture();missing.columns.customer_sample_items=missing.columns.customer_sample_items.filter(x=>x.COLUMN_NAME!=='selected_by_user_id');
 await assert.rejects(verifyB25SampleSchemaContract(missing),/selected_by_user_id/i);
});
test('v1.50 preflight rejects nontransactional selection tables even when columns match',async()=>{
 const db=fixture();db.setEngine('customer_sample_items','MyISAM');
 await assert.rejects(verifyB25SampleSchemaContract(db),/customer_sample_items.*InnoDB/i);
});
test('v1.50 preflight rejects missing compound uniqueness for selection and source de-duplication',async()=>{
 for(const [table,index] of [['customer_sample_items','uq_sample_session_product'],['customer_sample_selected_cards','uq_sample_selected_card'],['customer_sample_item_sources','uq_sample_item_card_source']] as const){
  const db=fixture();db.indexes[table]=db.indexes[table].filter(x=>x.INDEX_NAME!==index);
  await assert.rejects(verifyB25SampleSchemaContract(db),new RegExp(index));
 }
});
test('v1.50 preflight rejects extra source uniqueness that silently drops another retired/recreated card provenance',async()=>{
 const db=fixture();
 db.indexes.customer_sample_item_sources.push(ix('uq_wrong_one_card',1,'session_id'),ix('uq_wrong_one_card',2,'product_id'));
 await assert.rejects(verifyB25SampleSchemaContract(db),/unexpected.*source.*unique/i);
});
test('v1.50 preflight rejects broken selected product and first-source foreign keys',async()=>{
 const product=fixture();product.refs.customer_sample_items=[];
 await assert.rejects(verifyB25SampleSchemaContract(product),/fk_sample_item_product/);
 const source=fixture();source.refs.customer_sample_item_sources=source.refs.customer_sample_item_sources.filter(x=>x.CONSTRAINT_NAME!=='fk_sample_source_item');
 await assert.rejects(verifyB25SampleSchemaContract(source),/fk_sample_source_item/);
 const event=fixture();event.refs.customer_sample_item_sources=event.refs.customer_sample_item_sources.filter(x=>x.CONSTRAINT_NAME!=='fk_sample_source_event');
 await assert.rejects(verifyB25SampleSchemaContract(event),/fk_sample_source_event/);
});
test('AC-84 metadata gate requires manual audit columns, actor FK and stable item FK without writes',async()=>{
 const missing=fixture();missing.setTables(sampleTables.filter(t=>t!=='customer_sample_manual_events'));
 await assert.rejects(verifyB25SampleSchemaContract(missing),/customer_sample_manual_events/);
 const column=fixture();column.columns.customer_sample_manual_events=column.columns.customer_sample_manual_events.filter(x=>x.COLUMN_NAME!=='action');
 await assert.rejects(verifyB25SampleSchemaContract(column),/manual_events.action/);
 const wrong=fixture();wrong.columns.customer_sample_manual_events=wrong.columns.customer_sample_manual_events.map(x=>x.COLUMN_NAME==='action'?{...x,COLUMN_TYPE:'varchar(20)'}:x);
 await assert.rejects(verifyB25SampleSchemaContract(wrong),/manual_events.action/);
 for(const f of ['fk_sample_manual_item','fk_sample_manual_actor']){
  const db=fixture();db.refs.customer_sample_manual_events=db.refs.customer_sample_manual_events.filter(x=>x.CONSTRAINT_NAME!==f);
  await assert.rejects(verifyB25SampleSchemaContract(db),new RegExp(f));
 }
});
test('B2-5 preflight rejects missing token/history table before any other metadata query',async()=>{
 const db=fixture();db.setTables(sampleTables.filter(t=>t!=='customer_sample_scan_events'));
 await assert.rejects(verifyB25SampleSchemaContract(db),/customer_sample_scan_events/);
 assert.equal(db.calls.length,1);
});
test('B2-5 preflight rejects legacy active-card unique indexes preventing delete/recreate',async()=>{
 const db=fixture();
 db.indexes.sample_cards.push(ix('uq_old_card_no',1,'card_no'));
 await assert.rejects(verifyB25SampleSchemaContract(db),/unique|card_no/i);
 const old=fixture();old.indexes.sample_cards[1]={...old.indexes.sample_cards[1],COLUMN_NAME:'master_id'};
 await assert.rejects(verifyB25SampleSchemaContract(old),/uq_sample_card_combo/i);
});
test('B2-5 preflight rejects generated active keys with inverted delete predicate',async()=>{
 const db=fixture();
 db.columns.sample_cards=db.columns.sample_cards.map(r=>r.COLUMN_NAME==='active_master_id'?
  {...r,GENERATION_EXPRESSION:'case when (deleted_at is not null) then master_id else NULL end'}:r);
 await assert.rejects(verifyB25SampleSchemaContract(db),/active_master_id/i);
});
test('B2-5 preflight rejects missing print version, broken check or non-revocable token',async()=>{
 const db=fixture();db.columns.sample_cards=db.columns.sample_cards.filter(r=>r.COLUMN_NAME!=='printed_revision');
 await assert.rejects(verifyB25SampleSchemaContract(db),/printed_revision/);
 const noCheck=fixture();noCheck.checks.sample_cards[0].ENFORCED='NO';
 await assert.rejects(verifyB25SampleSchemaContract(noCheck),/ck_sample_card_reprint_revision/i);
 const immutable=fixture();immutable.columns.sample_card_tokens=immutable.columns.sample_card_tokens.filter(r=>r.COLUMN_NAME!=='revoked_at');
 await assert.rejects(verifyB25SampleSchemaContract(immutable),/revoked_at/);
});
test('B2-5 preflight rejects a CASCADE historical card FK',async()=>{
 const db=fixture();
 db.refs.customer_sample_scan_events[0].DELETE_RULE='CASCADE';
 await assert.rejects(verifyB25SampleSchemaContract(db),/fk_sample_event_card/i);
});
