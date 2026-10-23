import assert from 'node:assert/strict';
import test from 'node:test';
import {initializePatternNumberReuseSchema,verifyPatternNumberReuseSchema,migratePatternNumberReuse} from './patternNumberReuseSchema';
test('reuse migration atomically changes live uniqueness; rerun is read-only and drift fails closed',async()=>{
 let exists=false,ddl=0,expression='case when (`deleted_at` is null) then `master_no` else NULL end',unique=0;
 const db={async query(sql:string):Promise<[unknown,unknown]>{
  if(sql.startsWith('ALTER TABLE')){assert.match(sql,/DROP INDEX uq_v2_master_no, ADD UNIQUE KEY uq_v2_master_no \(active_master_no\)/);exists=true;ddl++;return [{},[]];}
  if(sql.includes('INFORMATION_SCHEMA.STATISTICS'))return [[{COLUMN_NAME:'active_master_no',NON_UNIQUE:unique,SEQ_IN_INDEX:1}],[]];
  return [exists?[{COLUMN_TYPE:'varchar(64)',IS_NULLABLE:'YES',EXTRA:'STORED GENERATED',GENERATION_EXPRESSION:expression}]:[],[]];
 }};
 await initializePatternNumberReuseSchema(db);await initializePatternNumberReuseSchema(db);assert.equal(ddl,1);
 unique=1;await assert.rejects(verifyPatternNumberReuseSchema(db),/uniqueness drift/);
 unique=0;expression='master_no';await assert.rejects(verifyPatternNumberReuseSchema(db),/column drift/);
});
test('reuse migration requires backup and exact physical target before DDL',async()=>{
 const queries:string[]=[];const db={async query(sql:string):Promise<[unknown,unknown]>{queries.push(sql);return [[{database_name:'wrong',server_uuid:'wrong'}],[]];}};
 const target={database:'fabric',serverUuid:'uuid'} as any;
 await assert.rejects(migratePatternNumberReuse(db,target,''),/backup/);assert.equal(queries.length,0);
 await assert.rejects(migratePatternNumberReuse(db,target,'a'.repeat(64)),/target mismatch/);assert.equal(queries.length,1);
});

test('compatibility startup accepts legacy index before migration; explicit migration verification still requires it',async()=>{
 const db={async query():Promise<[unknown,unknown]>{return [[],[]];}};
 await verifyPatternNumberReuseSchema(db,true);
 await assert.rejects(verifyPatternNumberReuseSchema(db),/column drift/);
});
