import assert from 'node:assert/strict';
import test from 'node:test';
import {initializePatternDimensionsSchema,verifyPatternDimensionsSchema} from './patternDimensionsSchema';
import {mergePatternDimensionRows,applyPatternDimensionImport,validateDimensionImportTarget} from './patternDimensionImport';

test('rehearsal can only target isolated clones; production apply/inspect reject every other DB',()=>{
 const uuid='a937ff09-72b6-11f1-b04e-52540034488b';
 assert.throws(()=>validateDimensionImportTarget('rehearse','fabric_db',uuid));
 assert.throws(()=>validateDimensionImportTarget('apply','fabric_release_check_54bbe764d102c166',uuid));
 assert.doesNotThrow(()=>validateDimensionImportTarget('rehearse','fabric_release_check_54bbe764d102c166',uuid));
 assert.doesNotThrow(()=>validateDimensionImportTarget('apply','fabric_db',uuid));
});

test('dimension schema adds nullable DECIMAL columns once; rejects partial or wrong schema',async()=>{
 let columns:any[]=[],writes=0;
 const db={async query(sql:string):Promise<[unknown,unknown]>{
  if(sql.includes('INFORMATION_SCHEMA'))return [columns,[]];
  assert(sql.startsWith('ALTER TABLE pattern_masters ADD COLUMN width_cm'));
  writes++;columns=['width_cm','height_cm'].map(COLUMN_NAME=>({COLUMN_NAME,COLUMN_TYPE:'decimal(12,4)',IS_NULLABLE:'YES'}));return [{},[]];
 }};
 await initializePatternDimensionsSchema(db);await initializePatternDimensionsSchema(db);assert.equal(writes,1);
 columns[1].COLUMN_TYPE='varchar(50)';await assert.rejects(verifyPatternDimensionsSchema(db),/drift/);
 columns=columns.slice(0,1);await assert.rejects(initializePatternDimensionsSchema(db),/partial/);assert.equal(writes,1);
});
test('merge uses named width/height columns, demands exact conflict corrections and never infers from filenames',()=>{
 const source=[['old','new','w_px','h_px','w_cm','h_cm','status'],
 ['G0001-1.webp','G0001-1_32x48cm.webp',1,1,48,32,'ok'],
 ['G0002-1.webp','unused',1,1,20,30,'ok'],['G0002-2.webp','unused',1,1,40,60,'ok']];
 assert.throws(()=>mergePatternDimensionRows(source,[]),/G0002/);
 const fixed=[['花型号','配色数','原表行号','各配色：宽 × 高（cm）','确认宽（cm）','确认高（cm）'],['G0002',2,'3、4','',47.5,31.25]];
 assert.deepEqual(mergePatternDimensionRows(source,fixed),[{masterNo:'G0001',widthCm:48,heightCm:32},{masterNo:'G0002',widthCm:47.5,heightCm:31.25}]);
 for(const rows of [[...source,source[1]],source.map((r,i)=>i===1?[...r.slice(0,4),0,32,'ok']:r)])assert.throws(()=>mergePatternDimensionRows(rows,fixed));
 assert.throws(()=>mergePatternDimensionRows(source,[...fixed,fixed[1]]),/Duplicate/);
 assert.throws(()=>mergePatternDimensionRows(source,[...fixed,['G0999',0,'','',1,2]]),/Unexpected/);
});
test('import locks exact current masters, rejects missing IDs or existing different dimensions and rolls back failures',async()=>{
 const items:any[]=[{id:'1',master_no:'G0001',width_cm:null,height_cm:null},{id:'2',master_no:'G0002',width_cm:null,height_cm:null}];
 let commits=0,rollbacks=0,writes=0,fail=false;
 const conn={async query(sql:string,p:unknown[]=[]):Promise<[unknown,unknown]>{
  if(sql.startsWith('SELECT'))return [structuredClone(items),[]];
  writes++;if(fail&&p[2]==='2')throw Error('write failed');const m=items.find(x=>x.id===p[2]);m.width_cm=p[0];m.height_cm=p[1];return [{affectedRows:1},[]];
 },async beginTransaction(){},async commit(){commits++;},async rollback(){rollbacks++;},release(){}};
 const pool={async getConnection(){return conn;}};
 const plan=[{masterNo:'G0001',widthCm:48,heightCm:32},{masterNo:'G0002',widthCm:21,heightCm:24.7}];
 await assert.rejects(applyPatternDimensionImport(pool,[...plan,{masterNo:'G0999',widthCm:1,heightCm:2}]),/not found/);assert.equal(writes,0);
 const result=await applyPatternDimensionImport(pool,plan);assert.equal(result.updated,2);assert.equal(commits,1);
 assert.equal((await applyPatternDimensionImport(pool,plan)).unchanged,2);assert.equal(writes,2);
 await assert.rejects(applyPatternDimensionImport(pool,[{masterNo:'G0001',widthCm:1,heightCm:2}]),/different/);assert.equal(writes,2);
 items.forEach(x=>{x.width_cm=null;x.height_cm=null;});fail=true;
 await assert.rejects(applyPatternDimensionImport(pool,plan),/write failed/);assert.equal(rollbacks,3);
});
