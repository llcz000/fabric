import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyV2SchemaContract, planV2SchemaUpgrade, V2_SCHEMA_VERSION } from './schemaContract';

type Row = Record<string, unknown>;
class Metadata {
  private tables = new Map<string, Row[]>();
  readonly calls: string[] = [];
  constructor() {
    const data: Record<string, {col: [string,string,string][]; idx: [string,number,string,number][]; fk: [string,string,string,string,string][]; check:string[]}> = {
      pattern_masters: {
        col:[['id','bigint unsigned','NO'],['master_no','varchar(64)','NO'],['next_colorway_no','bigint unsigned','NO'],['is_active','tinyint(1)','NO']],
        idx:[['PRIMARY',0,'id',1],['uq_v2_master_no',0,'master_no',1]],
        fk:[],check:['ck_v2_next_colorway_positive','ck_v2_master_no','ck_v2_master_active']
      },
      pattern_colorways: {
        col:[['id','bigint unsigned','NO'],['master_id','bigint unsigned','NO'],['colorway_no','int unsigned','NO'],['pattern_image_asset_id','varchar(36)','YES']],
        idx:[['PRIMARY',0,'id',1],['uq_v2_master_colorway',0,'master_id',1],['uq_v2_master_colorway',0,'colorway_no',2]],
        fk:[['fk_v2_colorway_master','master_id','pattern_masters','id','RESTRICT'],['fk_v2_colorway_image','pattern_image_asset_id','image_assets','id','RESTRICT']],
        check:['ck_v2_colorway_positive']
      },
      v2_fabrics: {
        col:[['id','bigint unsigned','NO'],['fabric_no','varchar(64)','NO'],['fabric_name','varchar(255)','NO'],['weight_value','decimal(12,3)','YES'],['weight_unit',"enum('gsm','mm')",'YES'],['width_value','decimal(12,2)','YES']],
        idx:[['PRIMARY',0,'id',1],['uq_v2_fabric_no',0,'fabric_no',1]],fk:[],check:['ck_v2_fabric_weight','ck_v2_fabric_width']
      },
      shared_tags: {col:[['id','bigint unsigned','NO'],['dimension',"enum('topic','color')",'NO'],['normalized_name','varchar(64)','NO']],
        idx:[['PRIMARY',0,'id',1],['uq_v2_dimension_normalized',0,'dimension',1],['uq_v2_dimension_normalized',0,'normalized_name',2]],fk:[],check:[]},
      pattern_master_tag_links: {col:[['master_id','bigint unsigned','NO'],['tag_id','bigint unsigned','NO']],
        idx:[['PRIMARY',0,'master_id',1],['PRIMARY',0,'tag_id',2]],
        fk:[['fk_v2_mtags_master','master_id','pattern_masters','id','CASCADE'],['fk_v2_mtags_tag','tag_id','shared_tags','id','RESTRICT']],check:[]},
      pattern_colorway_tag_links: {col:[['colorway_id','bigint unsigned','NO'],['tag_id','bigint unsigned','NO']],
        idx:[['PRIMARY',0,'colorway_id',1],['PRIMARY',0,'tag_id',2]],
        fk:[['fk_v2_ctags_colorway','colorway_id','pattern_colorways','id','CASCADE'],['fk_v2_ctags_tag','tag_id','shared_tags','id','RESTRICT']],check:[]},
      v2_products: {
        col:[['id','bigint unsigned','NO'],['pattern_colorway_id','bigint unsigned','NO'],['fabric_id','bigint unsigned','NO'],['product_no','varchar(160)','NO'],['row_version','bigint unsigned','NO'],['is_available_for_sampling','tinyint(1)','NO']],
        idx:[['PRIMARY',0,'id',1],['uq_v2_colorway_fabric',0,'pattern_colorway_id',1],['uq_v2_colorway_fabric',0,'fabric_id',2],['uq_v2_product_no',0,'product_no',1]],
        fk:[['fk_v2_products_colorway','pattern_colorway_id','pattern_colorways','id','RESTRICT'],['fk_v2_products_fabric','fabric_id','v2_fabrics','id','RESTRICT']],check:['ck_v2_product_sampling']},
      v2_product_image_assets: {
        col:[['id','bigint unsigned','NO'],['product_id','bigint unsigned','NO'],['asset_id','varchar(36)','NO'],['role',"enum('fabric_display','detail','ai_effect')",'NO'],['active_asset_id','varchar(36)','YES']],
        idx:[['PRIMARY',0,'id',1],['uq_v2_product_active_asset',0,'product_id',1],['uq_v2_product_active_asset',0,'active_asset_id',2]],
        fk:[['fk_v2_product_image_product','product_id','v2_products','id','RESTRICT'],['fk_v2_product_image_asset','asset_id','image_assets','id','RESTRICT']],check:[]
      }
    };
    for(const [table,value] of Object.entries(data)) {
      this.tables.set(table+':C',value.col.map(([COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE])=>({COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE})));
      this.tables.set(table+':S',value.idx.map(([INDEX_NAME,NON_UNIQUE,COLUMN_NAME,SEQ_IN_INDEX])=>({INDEX_NAME,NON_UNIQUE,COLUMN_NAME,SEQ_IN_INDEX})));
      this.tables.set(table+':F',value.fk.map(([CONSTRAINT_NAME,COLUMN_NAME,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME,DELETE_RULE])=>({CONSTRAINT_NAME,COLUMN_NAME,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME,DELETE_RULE})));
      this.tables.set(table+':K',value.check.map(CONSTRAINT_NAME=>({CONSTRAINT_NAME})));
    }
  }
  mutate(table:string,kind:'C'|'S'|'F'|'K',fn:(rows:Row[])=>Row[]) {
    this.tables.set(table+':'+kind,fn(this.tables.get(table+':'+kind)??[]));
  }
  async query(sql:string,params:unknown[]=[]):Promise<[unknown,unknown]> {
    this.calls.push(sql.trim());
    const table=String(params[0]??'');
    const suffix=/INFORMATION_SCHEMA\.COLUMNS/i.test(sql)?'C':/INFORMATION_SCHEMA\.STATISTICS/i.test(sql)?'S':/INFORMATION_SCHEMA\.KEY_COLUMN_USAGE/i.test(sql)?'F':'K';
    if (!/INFORMATION_SCHEMA\./i.test(sql)) throw Error('Unexpected query '+sql.slice(0,60));
    return [this.tables.get(table+':'+suffix)??[],[]];
  }
}
test('P1-C2 matching MySQL metadata fulfills V2 native contract and does not write',async()=>{
  const db=new Metadata();
  await verifyV2SchemaContract(db);
  assert.equal(V2_SCHEMA_VERSION,2);
  assert(db.calls.length>=8*4);
  assert(db.calls.every(x=>/^SELECT /i.test(x)));
});
test('P1-C2 refuses missing or wrong counter type or nullable master code',async()=>{
  const db=new Metadata();
  db.mutate('pattern_masters','C',rows=>rows.map(x=>x.COLUMN_NAME==='next_colorway_no'?{...x,COLUMN_TYPE:'int unsigned'}:x));
  await assert.rejects(verifyV2SchemaContract(db),/pattern_masters.*next_colorway_no.*type/i);
  const nullable=new Metadata();
  nullable.mutate('pattern_masters','C',rows=>rows.map(x=>x.COLUMN_NAME==='master_no'?{...x,IS_NULLABLE:'YES'}:x));
  await assert.rejects(verifyV2SchemaContract(nullable),/pattern_masters.*master_no.*null/i);
});
test('P1-C2 refuses non-unique or reordered composite indexes',async()=>{
  const db=new Metadata();
  db.mutate('v2_products','S',rows=>rows.map(x=>x.INDEX_NAME==='uq_v2_colorway_fabric'?{...x,NON_UNIQUE:1}:x));
  await assert.rejects(verifyV2SchemaContract(db),/v2_products.*uq_v2_colorway_fabric/i);
  const swap=new Metadata();
  swap.mutate('pattern_colorways','S',rows=>rows.map(x=>x.INDEX_NAME==='uq_v2_master_colorway'?{...x,SEQ_IN_INDEX:3-Number(x.SEQ_IN_INDEX)}:x));
  await assert.rejects(verifyV2SchemaContract(swap),/pattern_colorways.*uq_v2_master_colorway/i);
});
test('P1-C2 refuses broken product FK, missing CHECK or unsafe cascade',async()=>{
  const db=new Metadata();
  db.mutate('v2_products','F',rows=>rows.filter(x=>x.CONSTRAINT_NAME!=='fk_v2_products_colorway'));
  await assert.rejects(verifyV2SchemaContract(db),/v2_products.*fk_v2_products_colorway/i);
  const cascade=new Metadata();
  cascade.mutate('v2_product_image_assets','F',rows=>rows.map(x=>x.CONSTRAINT_NAME==='fk_v2_product_image_asset'?{...x,DELETE_RULE:'CASCADE'}:x));
  await assert.rejects(verifyV2SchemaContract(cascade),/v2_product_image_assets.*fk_v2_product_image_asset/i);
  const check=new Metadata();
  check.mutate('pattern_masters','K',rows=>rows.filter(x=>x.CONSTRAINT_NAME!=='ck_v2_next_colorway_positive'));
  await assert.rejects(verifyV2SchemaContract(check),/pattern_masters.*ck_v2_next_colorway_positive/i);
});
test('B2-5 schema attestation refuses missing or nullable independent sampling flag',async()=>{
 const missing=new Metadata();missing.mutate('v2_products','C',rows=>rows.filter(r=>r.COLUMN_NAME!=='is_available_for_sampling'));
 await assert.rejects(verifyV2SchemaContract(missing),/v2_products.*is_available_for_sampling/i);
 const nullable=new Metadata();nullable.mutate('v2_products','C',rows=>rows.map(r=>r.COLUMN_NAME==='is_available_for_sampling'?{...r,IS_NULLABLE:'YES'}:r));
 await assert.rejects(verifyV2SchemaContract(nullable),/v2_products.*is_available_for_sampling/i);
});
test('B2-5 schema attestation refuses missing enforced product sampling CHECK',async()=>{
 const db=new Metadata();db.mutate('v2_products','K',rows=>rows.filter(r=>r.CONSTRAINT_NAME!=='ck_v2_product_sampling'));
 await assert.rejects(verifyV2SchemaContract(db),/v2_products.*ck_v2_product_sampling/i);
});
test('P1-C2 version planner allows only empty v1 legacy V2 sandbox upgrades and never silent production DDL',()=>{
  assert.deepEqual(planV2SchemaUpgrade({currentVersion:2,existingRows:0}),[]);
  assert.deepEqual(planV2SchemaUpgrade({currentVersion:1,existingRows:0}),[{version:2,description:'add monotonic colorway counter',sql:'ALTER TABLE pattern_masters ADD COLUMN next_colorway_no BIGINT UNSIGNED NOT NULL DEFAULT 1, ADD CONSTRAINT ck_v2_next_colorway_positive CHECK (next_colorway_no > 0)'}]);
  assert.throws(()=>planV2SchemaUpgrade({currentVersion:1,existingRows:1}),/nonempty|data/i);
  assert.throws(()=>planV2SchemaUpgrade({currentVersion:0,existingRows:0}),/unknown|unsupported/i);
  assert.throws(()=>planV2SchemaUpgrade({currentVersion:3,existingRows:0}),/unknown|newer|unsupported/i);
});

test('active-number uniqueness allows deleted pattern numbers without weakening live uniqueness',async()=>{
 const db=new Metadata();
 db.mutate('pattern_masters','C',rows=>[...rows,{COLUMN_NAME:'deleted_at',COLUMN_TYPE:'datetime',IS_NULLABLE:'YES'},{COLUMN_NAME:'active_master_no',COLUMN_TYPE:'varchar(64)',IS_NULLABLE:'YES'}]);
 db.mutate('pattern_masters','S',rows=>rows.map(x=>x.INDEX_NAME==='uq_v2_master_no'?{...x,COLUMN_NAME:'active_master_no'}:x));
 await verifyV2SchemaContract(db);
 db.mutate('pattern_masters','S',rows=>rows.map(x=>x.INDEX_NAME==='uq_v2_master_no'?{...x,NON_UNIQUE:1}:x));
 await assert.rejects(verifyV2SchemaContract(db),/uq_v2_master_no/);
});
