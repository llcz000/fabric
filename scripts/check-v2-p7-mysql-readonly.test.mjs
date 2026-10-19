import assert from 'node:assert/strict';
import test from 'node:test';
import {auditP7ReadOnly,assertReadonlySql,P7_READONLY_DB,P7_TABLES} from './check-v2-p7-mysql-readonly.mjs';

const names=[...P7_TABLES].sort();
function fake(override={}){
 const calls=[];
 const response=async sql=>{
  calls.push(sql);
  if(sql.startsWith('SELECT DATABASE()'))return [`${override.database??P7_READONLY_DB}\t${override.version??'8.0.46'}\tserver-test-uuid`];
  if(sql.includes('INFORMATION_SCHEMA.TABLES'))return override.tables??names;
  if(sql.includes('INFORMATION_SCHEMA.COLUMNS'))return override.columns??['v2_product_id','v2_product_snapshot','v2_source_kind'];
  if(sql.includes('INFORMATION_SCHEMA.TABLE_CONSTRAINTS'))return override.checks??['ck_v2_order_line_provenance'];
  if(sql.includes('INFORMATION_SCHEMA.KEY_COLUMN_USAGE')&&sql.includes("TABLE_NAME='order_items'"))
   return override.productFk??['v2_product_id\tv2_products\tRESTRICT'];
  if(sql.includes('INFORMATION_SCHEMA.KEY_COLUMN_USAGE')&&sql.includes("TABLE_NAME='orders'"))
   return override.ownerFk??['created_by_user_id\tv2_access_users\tRESTRICT'];
  if(/^SELECT COUNT\(\*\) FROM (\w+)$/.test(sql))return [String(override.nonempty===sql.split(' ').at(-1)?2:0)];
  throw Error('unexpected SQL: '+sql);
 };
 return {calls,response};
}
test('P7 real sandbox audit only issues SELECT and validates 14 empty tables + both order FKs',async()=>{
 const f=fake();const result=await auditP7ReadOnly(f.response);
 assert.equal(result.database,P7_READONLY_DB);
 assert.equal(result.tableCount,14);
 assert.equal(result.emptyTableCount,14);
 assert.equal(result.fkOk,true);
 assert(f.calls.length>=20);
 assert(f.calls.every(q=>/^SELECT\s/i.test(q)&&!q.includes(';')));
});
test('P7 real sandbox audit refuses production db identity before inspecting any schema',async()=>{
 const f=fake({database:'fabric_db'});
 await assert.rejects(auditP7ReadOnly(f.response),/isolated|target|sandbox/i);
 assert.equal(f.calls.length,1);
});
test('P7 real sandbox audit rejects unknown foreign tables or missing provenance checks',async()=>{
 const extra=fake({tables:[...names,'customer_secrets']});
 await assert.rejects(auditP7ReadOnly(extra.response),/table|unexpected|sandbox/i);
 assert.equal(extra.calls.length,2);
 const noCheck=fake({checks:[]});
 await assert.rejects(auditP7ReadOnly(noCheck.response),/check|provenance/i);
 const noOwner=fake({ownerFk:[]});
 await assert.rejects(auditP7ReadOnly(noOwner.response),/owner|foreign key/i);
 const noProduct=fake({productFk:[]});
 await assert.rejects(auditP7ReadOnly(noProduct.response),/product|foreign key/i);
});
test('P7 real sandbox audit rejects nonempty table and non MySQL 8 before passing',async()=>{
 await assert.rejects(auditP7ReadOnly(fake({nonempty:'orders'}).response),/nonempty|occupied|nonzero/i);
 await assert.rejects(auditP7ReadOnly(fake({version:'5.7.40'}).response),/mysql 8|version/i);
});
test('P7 read-only SQL guard rejects writes, multi-statements and comments',()=>{
 for(const sql of ['DELETE FROM orders','UPDATE v2_products SET x=1','SELECT 1; DELETE FROM orders',
 'SELECT 1 -- comment','SELECT 1 /* injection */','SHOW TABLES']){
  assert.throws(()=>assertReadonlySql(sql),/select|read.only|unsafe/i,sql);
 }
 assert.doesNotThrow(()=>assertReadonlySql('SELECT DATABASE(), VERSION(), @@server_uuid'));
});
