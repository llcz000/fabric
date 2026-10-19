import assert from 'node:assert/strict';
import test from 'node:test';
import {verifyFulfillmentSchemaContract} from './fulfillmentSchemaContract';

type Row=Record<string,unknown>;
const col=(name:string,type:string,nullable='NO'):Row=>({COLUMN_NAME:name,COLUMN_TYPE:type,IS_NULLABLE:nullable});
const idx=(name:string,seq:number,column:string):Row=>({INDEX_NAME:name,SEQ_IN_INDEX:seq,COLUMN_NAME:column,NON_UNIQUE:0});
const fk=(name:string,column:string,target:string,ref:string):Row=>({CONSTRAINT_NAME:name,COLUMN_NAME:column,REFERENCED_TABLE_NAME:target,REFERENCED_COLUMN_NAME:ref,DELETE_RULE:'RESTRICT'});
const pair=(name:string,a:string,b:string,target:string,ra:string,rb:string):Row[]=>[fk(name,a,target,ra),fk(name,b,target,rb)];
const names=['sample_shipments','sample_shipment_items','sample_followups','sample_followup_products'];
function fixture(){
 const columns:Record<string,Row[]>={
  sample_shipments:[col('id','bigint unsigned'),col('session_id','bigint unsigned'),col('actor_user_id','bigint unsigned'),col('shipped_at','datetime(3)'),col('carrier','varchar(160)','YES'),col('tracking_no','varchar(160)','YES')],
  sample_shipment_items:[col('id','bigint unsigned'),col('shipment_id','bigint unsigned'),col('session_id','bigint unsigned'),col('product_id','bigint unsigned'),col('quantity','bigint unsigned')],
  sample_followups:[col('id','bigint unsigned'),col('session_id','bigint unsigned'),col('actor_user_id','bigint unsigned'),col('contacted_on','date'),col('customer_confirmed','tinyint(1)','YES'),col('feedback','text','YES'),col('outcome','varchar(400)'),col('next_action','varchar(400)','YES'),col('next_followup_on','date','YES')],
  sample_followup_products:[col('id','bigint unsigned'),col('followup_id','bigint unsigned'),col('session_id','bigint unsigned'),col('product_id','bigint unsigned')]
 };
 const indexes:Record<string,Row[]>={
  sample_shipments:[idx('uq_sample_shipments_session',1,'id'),idx('uq_sample_shipments_session',2,'session_id')],
  sample_shipment_items:[idx('uq_sample_shipment_product',1,'shipment_id'),idx('uq_sample_shipment_product',2,'product_id')],
  sample_followups:[idx('uq_sample_followups_session',1,'id'),idx('uq_sample_followups_session',2,'session_id')],
  sample_followup_products:[idx('uq_followup_product',1,'followup_id'),idx('uq_followup_product',2,'product_id')]
 };
 const fks:Record<string,Row[]>={
  sample_shipments:[fk('fk_shipment_session','session_id','customer_sample_sessions','id'),fk('fk_shipment_actor','actor_user_id','v2_access_users','id')],
  sample_shipment_items:[
   ...pair('fk_shipment_line_batch','shipment_id','session_id','sample_shipments','id','session_id'),
   ...pair('fk_shipment_line_selected','session_id','product_id','customer_sample_items','session_id','product_id')],
  sample_followups:[fk('fk_followup_session','session_id','customer_sample_sessions','id'),fk('fk_followup_actor','actor_user_id','v2_access_users','id')],
  sample_followup_products:[
   ...pair('fk_followup_line_header','followup_id','session_id','sample_followups','id','session_id'),
   ...pair('fk_followup_line_selected','session_id','product_id','customer_sample_items','session_id','product_id')]
 };
 const checks:Record<string,Row[]>={
  sample_shipments:[],
  sample_shipment_items:[{CONSTRAINT_NAME:'ck_shipment_quantity',ENFORCED:'YES',CHECK_CLAUSE:'(`quantity` > 0)'}],
  sample_followups:[{CONSTRAINT_NAME:'ck_followup_confirmed',ENFORCED:'YES',CHECK_CLAUSE:'(`customer_confirmed` IN (0,1) OR `customer_confirmed` IS NULL)'},{CONSTRAINT_NAME:'ck_followup_next',ENFORCED:'YES',CHECK_CLAUSE:'(`next_followup_on` IS NULL OR `next_followup_on` >= `contacted_on`)'}],
  sample_followup_products:[]
 };
 const dbName='fabric_v2_test_20261017_fulfillment';
 let connected=dbName;
 let tableRows=names.map(TABLE_NAME=>({TABLE_NAME,ENGINE:'InnoDB'}));
 const calls:{sql:string;args:unknown[]}[]=[];
 let releases=0;
 const pool={async getConnection(){return {
  async query(sql:string,args:unknown[]=[]):Promise<[unknown,unknown]>{
   calls.push({sql,args});assert.match(sql,/^SELECT\s/,'metadata gate must be read only');
   if(sql.includes('SELECT DATABASE()'))return [[{selected_database:connected}],[]];
   if(sql.includes('INFORMATION_SCHEMA.TABLES'))return [tableRows,[]];
   const key=String(args[0]??'');
   if(sql.includes('INFORMATION_SCHEMA.COLUMNS'))return [columns[key]??[],[]];
   if(sql.includes('INFORMATION_SCHEMA.STATISTICS'))return [indexes[key]??[],[]];
   if(sql.includes('INFORMATION_SCHEMA.KEY_COLUMN_USAGE'))return [fks[key]??[],[]];
   if(sql.includes('INFORMATION_SCHEMA.CHECK_CONSTRAINTS'))return [Object.values(checks).flat().filter(c=>c.CONSTRAINT_NAME===key),[]];
   if(sql.includes('INFORMATION_SCHEMA.TABLE_CONSTRAINTS'))return [checks[key]??[],[]];
   throw Error('Unexpected SQL');
  },
  release(){releases++;}
 }}};
 return {pool,columns,indexes,fks,checks,calls,
  setDatabase(v:string){connected=v;},
  setTableEngine(name:string,engine:string){tableRows=tableRows.map(x=>x.TABLE_NAME===name?{...x,ENGINE:engine}:x);},
  removeTable(name:string){tableRows=tableRows.filter(x=>x.TABLE_NAME!==name);},
  get releases(){return releases;},expected:dbName};
}
test('B3 fulfillment metadata gate attests four tables via one connection, SELECT only and release',async()=>{
 const db=fixture();
 await verifyFulfillmentSchemaContract(db.pool,db.expected);
 assert.equal(db.releases,1);
 assert(db.calls.length>10);
 assert(db.calls.every(x=>x.sql.startsWith('SELECT')));
 assert.deepEqual(db.calls[0].args,[]);
 assert.equal(db.calls.filter(c=>c.sql.includes('INFORMATION_SCHEMA.CHECK_CONSTRAINTS')).length,3);
});
test('B3 refuses wrong database before metadata checks and always releases',async()=>{
 const db=fixture();db.setDatabase('fabric_production');
 await assert.rejects(verifyFulfillmentSchemaContract(db.pool,db.expected),/database identity/i);
 assert.equal(db.releases,1);assert.equal(db.calls.length,1);
});
test('B3 refuses missing or non-InnoDB fulfillment tables',async()=>{
 for(const table of names){
  const absent=fixture();absent.removeTable(table);
  await assert.rejects(verifyFulfillmentSchemaContract(absent.pool,absent.expected),new RegExp(table));
  const wrong=fixture();wrong.setTableEngine(table,'MyISAM');
  await assert.rejects(verifyFulfillmentSchemaContract(wrong.pool,wrong.expected),/InnoDB/);
 }
});
test('B3 rejects missing composite header-to-detail keys or changed FK delete rule',async()=>{
 for(const key of ['uq_sample_shipments_session','uq_sample_followups_session']){
  const db=fixture(),table=key.includes('shipments')?'sample_shipments':'sample_followups';
  db.indexes[table]=db.indexes[table].filter(x=>x.INDEX_NAME!==key);
  await assert.rejects(verifyFulfillmentSchemaContract(db.pool,db.expected),new RegExp(key));
 }
 for(const name of ['fk_shipment_line_batch','fk_shipment_line_selected','fk_followup_line_header','fk_followup_line_selected']){
  const db=fixture(),table=name.startsWith('fk_shipment')?'sample_shipment_items':'sample_followup_products';
  const row=db.fks[table].find(x=>x.CONSTRAINT_NAME===name)!;row.DELETE_RULE='CASCADE';
  await assert.rejects(verifyFulfillmentSchemaContract(db.pool,db.expected),new RegExp(name));
 }
});
test('B3 rejects named/enforced but semantically wrong or tautological CHECK expressions',async()=>{
 for(const [table,name,clause] of [
  ['sample_shipment_items','ck_shipment_quantity','quantity >= 0'],
  ['sample_followups','ck_followup_confirmed','customer_confirmed IN (0,1,2) OR customer_confirmed IS NULL'],
  ['sample_followups','ck_followup_next','1=1']
 ] as const){
  const db=fixture(),record=db.checks[table].find(x=>x.CONSTRAINT_NAME===name)!;
  record.CHECK_CLAUSE=clause;
  await assert.rejects(verifyFulfillmentSchemaContract(db.pool,db.expected),new RegExp(name));
  assert.equal(db.releases,1);
 }
});
test('B3 rejects missing role/session FK, unsigned quantity, inactive CHECK and wrong numeric column',async()=>{
 for(const [table,name] of [['sample_followups','fk_followup_actor'],['sample_shipments','fk_shipment_session']] as const){
  const db=fixture();db.fks[table]=db.fks[table].filter(x=>x.CONSTRAINT_NAME!==name);
  await assert.rejects(verifyFulfillmentSchemaContract(db.pool,db.expected),new RegExp(name));
 }
 const amount=fixture();amount.columns.sample_shipment_items.find(x=>x.COLUMN_NAME==='quantity')!.COLUMN_TYPE='int';
 await assert.rejects(verifyFulfillmentSchemaContract(amount.pool,amount.expected),/quantity/);
 const check=fixture();check.checks.sample_followups.find(x=>x.CONSTRAINT_NAME==='ck_followup_next')!.ENFORCED='NO';
 await assert.rejects(verifyFulfillmentSchemaContract(check.pool,check.expected),/ck_followup_next/);
});
