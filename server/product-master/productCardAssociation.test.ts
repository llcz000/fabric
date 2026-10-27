import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import ExcelJS from 'exceljs';
import {parseProductSearchQuery,searchProductCatalog} from './productSearch';
import {exportCatalog} from './catalogExport';

/** Real local SQL evaluation of the emitted joins/filters; target MySQL is a separate gate. */
function fixture(t:{after(fn:()=>void):void}){
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 sql.exec(`
 CREATE TABLE pattern_masters(id TEXT,master_no TEXT,is_active INTEGER);
 CREATE TABLE pattern_colorways(id TEXT,master_id TEXT,colorway_no INTEGER,pattern_image_asset_id TEXT,is_active INTEGER);
 CREATE TABLE v2_fabrics(id TEXT,fabric_no TEXT,fabric_name TEXT,composition TEXT,weight_value TEXT,weight_unit TEXT,width_value TEXT,is_active INTEGER,remark TEXT);
 CREATE TABLE v2_products(id TEXT,pattern_colorway_id TEXT,fabric_id TEXT,product_no TEXT,remark TEXT,is_active INTEGER,is_available_for_sampling INTEGER,row_version TEXT);
 CREATE TABLE sample_cards(id TEXT,master_id TEXT,fabric_id TEXT,card_no TEXT,is_active INTEGER,deleted_at TEXT,reprint_revision TEXT,printed_revision TEXT);
 CREATE TABLE pattern_master_tag_links(master_id TEXT,tag_id TEXT);
 CREATE TABLE shared_tags(id TEXT,name TEXT,dimension TEXT,is_archived INTEGER);
 CREATE TABLE v2_product_image_assets(product_id TEXT,role TEXT,deleted_at TEXT);
 INSERT INTO pattern_masters VALUES ('7','G01',1),('9','G02',1);
 INSERT INTO pattern_colorways VALUES ('11','7',1,NULL,1),('12','7',2,NULL,1),('13','9',1,NULL,1);
 INSERT INTO v2_fabrics VALUES ('8','F01','Silk',NULL,'19.99','mm','145.01',1,'面料备注'),('10','F02','Cotton',NULL,NULL,NULL,NULL,1,NULL);
 INSERT INTO v2_products VALUES ('1','11','8','G01-1-F01','产品备注',1,1,'1'),('2','12','8','G01-2-F01','',1,0,'1'),('3','13','8','G02-1-F01','',1,1,'1'),('4','11','10','G01-1-F02','',0,1,'1');
 INSERT INTO sample_cards VALUES ('17','7','8','G01-F01',0,NULL,'2','1'),('18','9','8','G02-F01',1,'2026-10-19','0','0'),('19','7','10','G01-F02',1,NULL,'0','0'),('20','9','10','G02-F02',1,NULL,'0','0');
 `);
 const db={async query(query:string,params:unknown[]=[]):Promise<[unknown,unknown]>{return [sql.prepare(query).all(...params as (string|number|null)[]),[]];}};
 return {db,sql};
}
test('same master/fabric shares current card across colorways without leaking QR credentials',async t=>{
 const {db}=fixture(t),result=await searchProductCatalog(db,parseProductSearchQuery({status:'all'}));
 for(const id of ['1','2'])assert.deepEqual(result.items.find(p=>p.id===id)?.sampleCard,{id:'17',cardNo:'G01-F01',isActive:false,needsReprint:true});
 assert.equal(result.items.find(p=>p.id==='2')?.isAvailableForSampling,false);
 assert.equal(result.items.find(p=>p.id==='1')?.fabricRemark,'面料备注');assert.equal(result.items.find(p=>p.id==='1')?.remark,'产品备注');
 assert.equal(result.items.find(p=>p.id==='4')?.fabricRemark,null);
 assert.doesNotMatch(JSON.stringify(result),/qrPayload|tokenHash|qr_payload/);
});
test('deleted cards and wrong master/fabric never create a current association',async t=>{
 const {db,sql}=fixture(t);
 let result=await searchProductCatalog(db,parseProductSearchQuery({productNo:'G02-1-F01'}));
 assert.equal(result.items[0].sampleCard,null);
 sql.exec("INSERT INTO sample_cards VALUES ('21','9','8','G02-F01',1,NULL,'0','0')");
 result=await searchProductCatalog(db,parseProductSearchQuery({productNo:'G02-1-F01'}));
 assert.deepEqual(result.items[0].sampleCard,{id:'21',cardNo:'G02-F01',isActive:true,needsReprint:false});
});
test('association filtering precedes count/paging and composes with product, fabric and status',async t=>{
 const {db}=fixture(t);
 const linked=await searchProductCatalog(db,parseProductSearchQuery({status:'all',cardAssociation:'linked',limit:'1',offset:'1'}));
 assert.equal(linked.total,3);assert.equal(linked.items.length,1);assert.equal(linked.items[0].id,'4');
 const unlinked=await searchProductCatalog(db,parseProductSearchQuery({status:'all',cardAssociation:'unlinked'}));
 assert.deepEqual(unlinked.items.map(p=>p.id),['3']);
 const combined=await searchProductCatalog(db,parseProductSearchQuery({productNo:'G01',fabricName:'silk',cardAssociation:'linked'}));
 assert.deepEqual(combined.items.map(p=>p.id),['1','2']);assert.equal(combined.total,2);
});
test('invalid association values fail validation instead of silently expanding a query',()=>{
 for(const value of ['yes','none','linked OR 1=1',[],{},null])assert.throws(()=>parseProductSearchQuery({cardAssociation:value}));
 assert.equal(parseProductSearchQuery({cardAssociation:'all'}).cardAssociation,'all');
});
test('filtered product export uses the same association predicate and preserves workbook columns',async t=>{
 const {db}=fixture(t),bytes=await exportCatalog(db,'products',{cardAssociation:'unlinked',status:'all'});
 const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(bytes as never);
 const sheet=workbook.worksheets[0],values=JSON.stringify(sheet.getSheetValues());
 assert.equal(sheet.rowCount,2);assert.match(values,/G02-1-F01/);assert.doesNotMatch(values,/G01-1-F01|G01-2-F01|G01-1-F02/);
});
