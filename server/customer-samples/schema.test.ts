import assert from 'node:assert/strict';
import test from 'node:test';
import {getSampleSchemaStatements,requireIsolatedSampleSchemaTarget} from './schema';
test('B2-2 SQL schema is additive, safe and enforces session/product/card deduplication',()=>{
 const definitions=getSampleSchemaStatements(), sql=definitions.map(d=>d.sql).join('\n');
 const tables=definitions.map(d=>d.name);
 assert.deepEqual(tables,['sample_cards','sample_card_tokens',
  'customer_sample_sessions','customer_sample_session_access','customer_sample_selected_cards',
  'customer_sample_scan_events','customer_sample_items','customer_sample_item_sources','customer_sample_item_removal_events','customer_sample_manual_events']);
 for(const n of tables)assert.match(sql,new RegExp('CREATE TABLE '+n+' \\('));
 for(const k of ['UNIQUE KEY uq_sample_session_product','UNIQUE KEY uq_sample_selected_card',
   'UNIQUE KEY uq_sample_token_hash','UNIQUE KEY uq_sample_session_access',
   'FOREIGN KEY','ON DELETE RESTRICT','JSON'])assert(sql.includes(k),k);
 assert.doesNotMatch(sql,/(DROP TABLE|TRUNCATE TABLE|DELETE FROM|UPDATE products|ON DELETE CASCADE)/i);
});
test('v1.50 sample item fresh DDL persists identity and provenance but no frozen attributes',()=>{
 const items=getSampleSchemaStatements().find(t=>t.name==='customer_sample_items')!.sql;
 assert.match(items,/product_id BIGINT UNSIGNED NOT NULL/);
 assert.match(items,/selected_by_user_id BIGINT UNSIGNED NOT NULL/);
 assert.doesNotMatch(items,/product_snapshot_json/);
});
test('AC-96 B2-5 active card uniqueness keeps historical card+token forever without blocking same-combination recreation',()=>{
 const defs=getSampleSchemaStatements();const cards=defs.find(x=>x.name==='sample_cards')!.sql;
 const tokens=defs.find(x=>x.name==='sample_card_tokens')!.sql;
 assert.match(cards,/deleted_at DATETIME NULL/);
 assert.match(cards,/active_master_id BIGINT UNSIGNED GENERATED ALWAYS AS/);
 assert.match(cards,/active_fabric_id BIGINT UNSIGNED GENERATED ALWAYS AS/);
 assert.match(cards,/active_card_no VARCHAR\(129\) GENERATED ALWAYS AS/);
 assert.match(cards,/UNIQUE KEY uq_sample_card_combo\s*\(active_master_id,active_fabric_id\)/);
 assert.match(cards,/UNIQUE KEY uq_sample_card_no\s*\(active_card_no\)/);
 assert.doesNotMatch(cards,/UNIQUE KEY uq_sample_card_no\s*\(card_no\)/);
 assert.match(tokens,/UNIQUE KEY uq_sample_token_hash\s*\(token_hash\)/);
 assert.match(tokens,/revoked_at DATETIME NULL/);
});
test('AC-98/99 reprint revisions persist across saves and support comparing the last printed revision',()=>{
 const ddl=getSampleSchemaStatements().find(x=>x.name==='sample_cards')!.sql;
 assert.match(ddl,/reprint_revision BIGINT UNSIGNED NOT NULL DEFAULT 0/);
 assert.match(ddl,/printed_revision BIGINT UNSIGNED NOT NULL DEFAULT 0/);
 assert.match(ddl,/ck_sample_card_reprint_revision CHECK \(printed_revision <= reprint_revision\)/);
});
test('B2-2 only exact purpose-built isolated sandbox can run sample schema',()=>{
 assert.equal(requireIsolatedSampleSchemaTarget('fabric_v2_test_20261012_b2samples','I_ACKNOWLEDGE_SANDBOX'),'fabric_v2_test_20261012_b2samples');
 for(const db of ['', 'fabric_db','fabric_v2_test_20261012','fabric_v2_test_20261012_p1c','fabric_v2_test_20261012_b2samples_backup'])
  assert.throws(()=>requireIsolatedSampleSchemaTarget(db,'I_ACKNOWLEDGE_SANDBOX'));
 assert.throws(()=>requireIsolatedSampleSchemaTarget('fabric_v2_test_20261012_b2samples',''));
});
test('B2-2 schema initializer rejects false database binding before any DDL',async()=>{
 const {initializeSampleSchema}=await import('./schema');
 const calls:string[]=[];
 const db={async getConnection(){return {
  async query(sql:string):Promise<[unknown,unknown]>{
   calls.push(sql);return [[{selected_database:'fabric_db'}],[]];
  },
  release(){}
 }}};
 await assert.rejects(initializeSampleSchema(db,'fabric_v2_test_20261012_b2samples','I_ACKNOWLEDGE_SANDBOX'),/refused/);
 assert.deepEqual(calls,['SELECT DATABASE() AS selected_database']);
 const none:string[]=[];
 await assert.rejects(initializeSampleSchema({async getConnection(){
  none.push('ACQUIRED');return {async query():Promise<[unknown,unknown]>{return [[],[]];},release(){}};
 }},'fabric_db','I_ACKNOWLEDGE_SANDBOX'));
 assert.equal(none.length,0);
});
test('B2-2 schema validates and creates tables on the SAME acquired connection, not rotating pool connections',async()=>{
 const {initializeSampleSchema}=await import('./schema');
 const calls:string[]=[];
 let released=false;
 const db={
  async query(_sql:string):Promise<[unknown,unknown]>{throw Error('pool.query must never run DDL');},
  async getConnection(){return {
   async query(sql:string):Promise<[unknown,unknown]>{
    calls.push(sql);
    if(sql.startsWith('SELECT DATABASE()'))return [[{selected_database:'fabric_v2_test_20261012_b2samples'}],[]];
    return [[],[]];
   },
   release(){released=true;}
  }}
 };
 await initializeSampleSchema(db,'fabric_v2_test_20261012_b2samples','I_ACKNOWLEDGE_SANDBOX');
 assert.equal(calls.length,2+getSampleSchemaStatements().length);
 assert(calls[0].startsWith('SELECT DATABASE()'));
 assert(calls.slice(2).every(q=>q.startsWith('CREATE TABLE ')));
 assert.equal(released,true);
});
test('B2-3 single master/material uniqueness and persistent QR schema rejects existing legacy tables without DDL',async()=>{
 const definitions=getSampleSchemaStatements();const card=definitions.find(t=>t.name==='sample_cards')!.sql;
 assert.match(card,/master_id BIGINT UNSIGNED NOT NULL/);assert.match(card,/UNIQUE KEY uq_sample_card_combo\s*\(active_master_id,active_fabric_id\)/);
 assert.match(card,/qr_payload VARCHAR\(128\).*ascii_bin NOT NULL/);
 assert(!definitions.some(t=>t.name==='sample_card_pattern_scopes'));
 const {initializeSampleSchema}=await import('./schema');
 for(const name of ['sample_cards','sample_card_pattern_scopes']){
  const calls:string[]=[];let released=false;
  await assert.rejects(initializeSampleSchema({async getConnection(){return {
   async query(sql:string):Promise<[unknown,unknown]>{calls.push(sql);return sql.startsWith('SELECT DATABASE()')?[[{selected_database:'fabric_v2_test_20261012_b2samples'}],[]]:[[{TABLE_NAME:name}],[]];},
   release(){released=true;}
  };}},'fabric_v2_test_20261012_b2samples','I_ACKNOWLEDGE_SANDBOX'),/existing|legacy|drift/i);
  assert(!calls.some(sql=>sql.startsWith('CREATE')));assert(released);
 }
});
