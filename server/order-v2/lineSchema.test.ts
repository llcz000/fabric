import assert from 'node:assert/strict';
import test from 'node:test';
import {inspectP1D2Lines} from './lineSchema';
type Col={COLUMN_NAME:string;COLUMN_TYPE:string;IS_NULLABLE:string};
class Meta {
 sql:string[]=[];
 cols:Col[]=[{COLUMN_NAME:'id',COLUMN_TYPE:'int',IS_NULLABLE:'NO'},
  {COLUMN_NAME:'order_id',COLUMN_TYPE:'int',IS_NULLABLE:'NO'}];
 index=true;fk=true;check=true;
 expanded(){
  this.cols.push(
   {COLUMN_NAME:'v2_product_id',COLUMN_TYPE:'bigint unsigned',IS_NULLABLE:'YES'},
   {COLUMN_NAME:'v2_source_kind',COLUMN_TYPE:"enum('catalog','manual')",IS_NULLABLE:'YES'},
   {COLUMN_NAME:'v2_product_snapshot',COLUMN_TYPE:'json',IS_NULLABLE:'YES'});
 }
 async query(sql:string):Promise<[unknown,unknown]>{
  this.sql.push(sql);
  if(sql.includes('INFORMATION_SCHEMA.COLUMNS'))return [this.cols,[]];
  if(sql.includes('INFORMATION_SCHEMA.STATISTICS'))return [this.index?[{COLUMN_NAME:'v2_product_id',NON_UNIQUE:1}]:[],[]];
  if(sql.includes('INFORMATION_SCHEMA.KEY_COLUMN_USAGE'))return [this.fk?[{COLUMN_NAME:'v2_product_id',REFERENCED_TABLE_NAME:'v2_products',REFERENCED_COLUMN_NAME:'id',DELETE_RULE:'RESTRICT'}]:[],[]];
  if(sql.includes('INFORMATION_SCHEMA.TABLE_CONSTRAINTS'))return [this.check?[{CONSTRAINT_NAME:'ck_v2_order_line_provenance'}]:[],[]];
  throw Error(sql);
 }
}
test('P1-D2 read-only inspect distinguishes legacy versus expanded',async()=>{
 const d=new Meta();assert.equal(await inspectP1D2Lines(d),'legacy');
 d.expanded();assert.equal(await inspectP1D2Lines(d),'expanded');
 assert(d.sql.every(q=>q.trim().startsWith('SELECT ')));
});
test('P1-D2 rejects partial, wrong types, missing FK/index/check, unsafe cascade',async()=>{
 const d=new Meta();d.cols.push({COLUMN_NAME:'v2_product_id',COLUMN_TYPE:'bigint unsigned',IS_NULLABLE:'YES'});
 await assert.rejects(inspectP1D2Lines(d),/partial/i);
 for(const scenario of ['type','nullable','index','fk','check'] as const){
  const m=new Meta();m.expanded();
  if(scenario==='type')m.cols[2].COLUMN_TYPE='int';
  if(scenario==='nullable')m.cols[4].IS_NULLABLE='NO';
  if(scenario==='index')m.index=false;
  if(scenario==='fk')m.fk=false;
  if(scenario==='check')m.check=false;
  await assert.rejects(inspectP1D2Lines(m),/drift|missing|incorrect|absent/i,scenario);
 }
});
