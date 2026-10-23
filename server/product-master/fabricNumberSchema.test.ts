import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeFabricNumberSchema,verifyFabricNumberSchema,migrateFabricNumber} from './fabricNumberSchema';
import {getV2ProductMasterCreateStatements} from './schema';
test('newly created fabric table also permits nonempty supplier codes with hyphens',()=>{
 const ddl=getV2ProductMasterCreateStatements().find(t=>t.name==='v2_fabrics')?.sql??'';
 assert.match(ddl,/ck_v2_fabric_no CHECK \(CHAR_LENGTH\(TRIM\(fabric_no\)\)\s*>\s*0\)/);
 assert.doesNotMatch(ddl,/fabric_no REGEXP/);
});
test('nonempty fabric constraint migrates once, rejects drift and requires backed-up physical target',async()=>{
 let clause="regexp_like(`fabric_no`,_utf8mb4'^[A-Z0-9]+$')",alters=0;
 const db={async query(sql:string):Promise<[unknown,unknown]>{
  if(sql.startsWith('ALTER TABLE')){assert.match(sql,/DROP CHECK ck_v2_fabric_no/);clause='(char_length(trim(`fabric_no`)) > 0)';alters++;return [{},[]];}
  return [[{CHECK_CLAUSE:clause}],[]];
 }};
 await initializeFabricNumberSchema(db);await initializeFabricNumberSchema(db);assert.equal(alters,1);
 clause='TRUE';await assert.rejects(verifyFabricNumberSchema(db),/drift/);
 const target={database:'fabric',serverUuid:'uuid'} as any;
 await assert.rejects(migrateFabricNumber(db,target,''),/backup/);
 await assert.rejects(migrateFabricNumber(db,target,'a'.repeat(64)),/target mismatch/);
});

test('migration handles the actual MySQL CHECK_CLAUSE escaped-quote representation',async()=>{
 let clause="regexp_like(`fabric_no`,_utf8mb4"+String.fromCharCode(92,39)+"^[A-Z0-9]+$"+String.fromCharCode(92,39)+")";
 const db={async query(sql:string):Promise<[unknown,unknown]>{if(sql.startsWith('ALTER TABLE'))clause='char_length(trim(fabric_no))>0';return [[{CHECK_CLAUSE:clause}],[]];}};
 await initializeFabricNumberSchema(db);await verifyFabricNumberSchema(db);
});
