import assert from 'node:assert/strict';
import test from 'node:test';
import {initializePatternDeletionSchema,verifyPatternDeletionSchema,migratePatternDeletion} from './patternDeletionSchema';
test('pattern deletion column initialization is repeatable and rejects schema drift',async()=>{
 let exists=false,alterations=0,type='datetime';
 const db={async query(sql:string):Promise<[unknown,unknown]>{
  if(sql.startsWith('ALTER TABLE')){exists=true;alterations++;return [{},[]];}
  return [exists?[{COLUMN_TYPE:type,IS_NULLABLE:'YES'}]:[],[]];
 }};
 await initializePatternDeletionSchema(db);await initializePatternDeletionSchema(db);
 assert.equal(alterations,1);
 type='varchar(20)';await assert.rejects(verifyPatternDeletionSchema(db),/incomplete/);
});
test('pattern migration rejects absent backup and wrong physical target before DDL',async()=>{
 const queries:string[]=[];
 const db={async query(sql:string):Promise<[unknown,unknown]>{queries.push(sql);return [[{database_name:'wrong',server_uuid:'wrong'}],[]];}};
 const target={database:'fabric',serverUuid:'uuid'} as any;
 await assert.rejects(migratePatternDeletion(db,target,''),/backup/);
 assert.equal(queries.length,0);
 await assert.rejects(migratePatternDeletion(db,target,'a'.repeat(64)),/target mismatch/);
 assert.equal(queries.length,1);
});
