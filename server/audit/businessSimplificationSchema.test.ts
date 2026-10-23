import test from 'node:test';import assert from 'node:assert/strict';
import {BUSINESS_SIMPLIFICATION_SQL,migrateBusinessSimplification,verifyDeletionAuditSchema} from './businessSimplificationSchema';
test('migration never revives deleted catalog rows, old QR tokens or account states',()=>{const sql=BUSINESS_SIMPLIFICATION_SQL.join('\n');assert.match(sql,/deleted_at IS NULL/);assert.match(sql,/UPDATE pattern_colorways c JOIN pattern_masters m/);assert.match(sql,/UPDATE v2_products p JOIN/);assert(!/UPDATE v2_access|UPDATE sample_card_tokens|revoked_at\s*=/i.test(sql));assert(!/snapshot|payload|detail_json/i.test(sql));});
test('migration rejects unverified backup before acquiring connection or changing data',async()=>{let used=false;await assert.rejects(migrateBusinessSimplification({query:async()=>{used=true;return [[],[]];}},{database:'fabric_db',serverUuid:'a'.repeat(36)},'bad'));assert.equal(used,false);});
test('audit schema refuses missing columns instead of accepting an existing wrong table',async()=>{await assert.rejects(verifyDeletionAuditSchema({query:async()=>[[],[]]}),/schema/);});

const target={database:'fabric_db',serverUuid:'a937ff09-72b6-11f1-b04e-52540034488b'},backup='a'.repeat(64);
function fixture(){let applied=false,plan='',fail=false;const calls:string[]=[];const db={query:async(sql:string,args:unknown[]=[]):Promise<[unknown,unknown]>=>{calls.push(sql);
 if(sql.startsWith('SELECT DATABASE'))return [[{database_name:target.database,server_uuid:target.serverUuid}],[]];
 if(sql.includes('GET_LOCK'))return [[{acquired:1}],[]];
 if(sql.startsWith('SELECT plan_sha256'))return [plan?[{plan_sha256:plan,applied_at:applied?'now':null}]:[],[]];
 if(sql.startsWith('INSERT IGNORE INTO fabric'))plan=String(args[1]);
 if(sql.includes('INFORMATION_SCHEMA.COLUMNS'))return [[['id','bigint unsigned'],['entity_type','varchar(20)'],['entity_id','varchar(20)'],['entity_label','varchar(255)'],['actor_user_id','bigint unsigned'],['deleted_at','datetime']].map(([COLUMN_NAME,COLUMN_TYPE])=>({COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE:'NO',EXTRA:COLUMN_NAME==='id'?'auto_increment':'',COLUMN_DEFAULT:COLUMN_NAME==='deleted_at'?'CURRENT_TIMESTAMP':null})),[]];
 if(sql.includes('INFORMATION_SCHEMA.TABLES'))return [[{ENGINE:'InnoDB'}],[]];
 if(sql.includes('INFORMATION_SCHEMA.STATISTICS'))return [[{INDEX_NAME:'PRIMARY',COLUMN_NAME:'id',NON_UNIQUE:0},...['entity_type','entity_id','id'].map(COLUMN_NAME=>({INDEX_NAME:'ix_business_delete_identity',COLUMN_NAME,NON_UNIQUE:1}))],[]];
 if(fail&&sql.startsWith('UPDATE v2_fabrics'))throw Error('normalize failed');
 if(sql.startsWith('UPDATE fabric_v2_migration_ledger'))applied=true;
 return [{affectedRows:1},[]];}};return {db,calls,setFail(){fail=true;},drift(){plan='b'.repeat(64);}};}
test('migration normalizes existing flags once with a persistent plan and transactional inventory',async()=>{const x=fixture();const first=await migrateBusinessSimplification(x.db,target,backup);assert.equal(first.alreadyApplied,false);assert.deepEqual(first.inventory,{patterns:1,colorways:1,fabrics:1,products:1,cards:1});assert(x.calls.includes('START TRANSACTION'));assert(x.calls.includes('COMMIT'));const before=x.calls.filter(x=>x.startsWith('UPDATE pattern_')).length;assert.equal((await migrateBusinessSimplification(x.db,target,backup)).alreadyApplied,true);assert.equal(x.calls.filter(x=>x.startsWith('UPDATE pattern_')).length,before);x.drift();await assert.rejects(migrateBusinessSimplification(x.db,target,backup),/plan drift/);});
test('migration rejects target mismatch and rolls back failed normalization',async()=>{const x=fixture();await assert.rejects(migrateBusinessSimplification(x.db,{...target,database:'wrong'},backup),/target/);assert(!x.calls.some(x=>x.startsWith('CREATE')));x.setFail();await assert.rejects(migrateBusinessSimplification(x.db,target,backup),/normalize failed/);assert(x.calls.includes('ROLLBACK'));assert(!x.calls.includes('COMMIT'));assert(x.calls.some(x=>x.includes('RELEASE_LOCK')));});
