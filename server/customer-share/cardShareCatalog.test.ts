import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {loadCardShareCatalog} from './cardShareCatalog';
import {loadPatternShareCatalog} from './patternShareCatalog';
const key=Buffer.alloc(32,7);
const share={cardId:'18',masterId:'4',fabricId:'5',cardNo:'G001-F005',available:true};
function fixture(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(`CREATE TABLE pattern_masters(id INTEGER,master_no TEXT,is_active INTEGER);
 CREATE TABLE pattern_colorways(id INTEGER,master_id INTEGER,colorway_no INTEGER,pattern_image_asset_id TEXT,is_active INTEGER);
 CREATE TABLE v2_fabrics(id INTEGER,fabric_no TEXT,fabric_name TEXT,composition TEXT,weight_value TEXT,weight_unit TEXT,width_value TEXT,is_active INTEGER);
 CREATE TABLE v2_products(id INTEGER,product_no TEXT,pattern_colorway_id INTEGER,fabric_id INTEGER,is_active INTEGER,is_available_for_sampling INTEGER);
 CREATE TABLE image_assets(id TEXT,status TEXT);
 CREATE TABLE image_asset_variants(asset_id TEXT,variant TEXT,byte_size INTEGER,mime TEXT);
 CREATE TABLE v2_product_image_assets(product_id INTEGER,asset_id TEXT,role TEXT,deleted_at TEXT);
 INSERT INTO pattern_masters VALUES(4,'G001',1),(7,'OTHER',1);
 INSERT INTO pattern_colorways VALUES(8,4,1,NULL,1),(9,4,2,NULL,1),(10,7,1,NULL,1),(11,4,3,NULL,1);
 INSERT INTO v2_fabrics VALUES(5,'F005','真丝','100% 真丝','18','mm','145',1),(6,'OTHER','另一面料',NULL,NULL,NULL,NULL,1);
 INSERT INTO v2_products VALUES(18,'G001-1-F005',8,5,1,0),(19,'G001-2-F005',9,5,1,1),(20,'G001-1-OTHER',8,6,1,1),(21,'OTHER-1-F005',10,5,1,1);`);
 let n=1;const asset=(product:number,role:string)=>{const id='11111111-1111-4111-8111-'+String(n++).padStart(12,'0');sqlite.prepare("INSERT INTO image_assets VALUES (?,'ready')").run(id);sqlite.prepare("INSERT INTO image_asset_variants VALUES (?,'display',10,'image/webp')").run(id);sqlite.prepare('INSERT INTO v2_product_image_assets VALUES (?,?,?,NULL)').run(product,id,role);return id;};
 const expected=[asset(18,'fabric_display'),asset(18,'detail'),asset(18,'ai_effect'),asset(19,'fabric_display')];
 const outside=[asset(20,'fabric_display'),asset(21,'detail')];
 const db={async query(sql:string,args:unknown[]=[]):Promise<[unknown,unknown]>{return [sqlite.prepare(sql).all(...args as any[]),[]];}};
 return {sqlite,db,expected,outside};
}
test('card public SQL scope contains both colorways of exactly one master and fabric with separate three image groups',async()=>{
 const {sqlite,db,expected,outside}=fixture();try{
  const loaded=await loadCardShareCatalog(db,share,key);assert(loaded);
  assert.equal(loaded.card.cardNo,'G001-F005');assert.equal(loaded.card.fabricNo,'F005');
  assert.deepEqual(loaded.card.colorways.map(c=>c.productNo),['G001-1-F005','G001-2-F005']);
  assert.deepEqual(loaded.card.colorways.map(c=>[c.displayImages.length,c.detailImages.length,c.effectImages.length]),[[1,1,1],[1,0,0]]);
  assert.deepEqual([...loaded.previews.values()].sort(),expected.sort());for(const id of outside)assert(![...loaded.previews.values()].includes(id));
  const json=JSON.stringify(loaded.card);for(const word of ['asset_id','product_id','masterId','fabricId','price','qrPayload',...expected,...outside])assert(!json.includes(word));
  // Existing single-product scope and the whole-master scope keep their meanings.
  assert.equal((await loadPatternShareCatalog(db,'4',key,'18'))!.candidate.colorways.length,1);
  assert.equal((await loadPatternShareCatalog(db,'4',key))!.candidate.colorways[0].products.length,2);
 }finally{sqlite.close();}
});
test('card scope dynamically adds products, hides disabled colorways and never interprets sampling-off as public-off',async()=>{
 const {sqlite,db}=fixture();try{
  assert.equal((await loadCardShareCatalog(db,share,key))!.card.colorways.length,2);
  sqlite.exec("INSERT INTO v2_products VALUES(22,'G001-3-F005',11,5,1,1)");
  assert.equal((await loadCardShareCatalog(db,share,key))!.card.colorways.length,3);
  sqlite.exec('UPDATE pattern_colorways SET is_active=0 WHERE id=9');
  assert.deepEqual((await loadCardShareCatalog(db,share,key))!.card.colorways.map(c=>c.colorwayNo),[1,3]);
  sqlite.exec('UPDATE v2_products SET is_active=0');assert.equal(await loadCardShareCatalog(db,share,key),null);
 }finally{sqlite.close();}
});
