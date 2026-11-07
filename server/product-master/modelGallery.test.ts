import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {listModels,createModel,ModelGalleryError,editModel,deleteModel} from './modelGallery';
import {MODEL_GALLERY_PLAN_SHA256,verifyModelGallerySchema} from './modelGallerySchema';
const assetId='11111111-1111-4111-8111-111111111111';
const replacementId='22222222-2222-4222-8222-222222222222';

test('replacing a model image preserves its number and metadata and moves the image reference',async()=>{
 const f=galleryFixture();try{
  const before=await createModel(f.pool,f.actor,{assetId,category:'skirt',angle:'back',note:'衣长估算',referenceCm:75});
  f.db.prepare('INSERT INTO image_assets VALUES(?,?,?,?,?,?,NULL,NULL)').run(replacementId,'ready','product_image',0,800,1200);
  const after=await editModel(f.pool,f.actor,before.id,{assetId:replacementId,expectedAssetId:assetId});
  assert.deepEqual(after,{...before,assetId:replacementId,width:800,height:1200});
  const assets=()=>f.db.prepare('SELECT status,ref_count FROM image_assets ORDER BY id').all().map(row=>({...row}));
  assert.deepEqual(assets(),[{status:'recycled',ref_count:0},{status:'ready',ref_count:1}]);
  await assert.rejects(editModel(f.pool,f.actor,before.id,{assetId,expectedAssetId:assetId}),
   (e:unknown)=>e instanceof ModelGalleryError&&e.status===409);
  await editModel(f.pool,f.actor,before.id,{assetId:replacementId,expectedAssetId:replacementId});
  assert.deepEqual(assets(),[{status:'recycled',ref_count:0},{status:'ready',ref_count:1}]);
 }finally{f.db.close();}
});

test('rejects assigned and unready replacements and rolls back on reference failure',async()=>{
 const f=galleryFixture();try{
  const before=await createModel(f.pool,f.actor,{assetId,category:'dress'});
  f.db.prepare('INSERT INTO image_assets VALUES(?,?,?,?,?,?,NULL,NULL)').run(replacementId,'pending','product_image',0,800,1200);
  const patch={assetId:replacementId,expectedAssetId:assetId};
  const conflict=(e:unknown)=>e instanceof ModelGalleryError&&e.status===409;
  await assert.rejects(editModel(f.pool,f.actor,before.id,patch),conflict);
  f.db.prepare("UPDATE image_assets SET status='ready' WHERE id=?").run(replacementId);
  await createModel(f.pool,f.actor,{assetId:replacementId,category:'top'});
  await assert.rejects(editModel(f.pool,f.actor,before.id,patch),conflict);
  f.db.exec("DELETE FROM v2_model_assets WHERE id=2; UPDATE image_assets SET ref_count=0 WHERE id='"+replacementId+"';");
  f.db.exec("CREATE TRIGGER deny_release BEFORE UPDATE OF ref_count ON image_assets WHEN NEW.ref_count<OLD.ref_count BEGIN SELECT RAISE(FAIL,'release denied'); END;");
  await assert.rejects(editModel(f.pool,f.actor,before.id,patch),/release denied/);
  assert.deepEqual((await listModels({query:f.query},{limit:50,offset:0})).items,[before]);
  assert.deepEqual(f.db.prepare('SELECT ref_count FROM image_assets ORDER BY id').all().map(r=>r.ref_count),[1,0]);
 }finally{f.db.close();}
});

function galleryFixture(){
 const db=new DatabaseSync(':memory:');let now='2030-01-01 00:00:00';
 db.function('NOW',()=>now);db.function('UTC_TIMESTAMP',()=>now);db.function('IF',(condition,yes,no)=>condition?yes:no);
 db.exec(`CREATE TABLE v2_access_users(id TEXT PRIMARY KEY,role TEXT,is_active INTEGER,can_manage_products INTEGER);
 CREATE TABLE v2_access_sessions(id TEXT PRIMARY KEY,user_id TEXT,revoked_at TEXT,expires_at TEXT);
 INSERT INTO v2_access_users VALUES('1','admin',1,1);
 INSERT INTO v2_access_sessions VALUES('session','1',NULL,'2099-01-01');
 CREATE TABLE image_assets(id TEXT PRIMARY KEY,status TEXT,purpose TEXT,ref_count INTEGER,width INTEGER,height INTEGER,recycled_at TEXT,purge_after TEXT);
 CREATE TABLE v2_model_assets(id INTEGER PRIMARY KEY AUTOINCREMENT,asset_id TEXT UNIQUE,category TEXT,angle TEXT,note TEXT,reference_cm REAL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,deleted_at TEXT);`);
 db.prepare('INSERT INTO image_assets VALUES(?,?,?,?,?,?,NULL,NULL)').run(assetId,'ready','product_image',0,1200,1800);
 const connection:any={async beginTransaction(){db.exec('BEGIN');},async commit(){db.exec('COMMIT');},async rollback(){db.exec('ROLLBACK');},release(){},
  async query(sql:string,params:any[]=[]):Promise<[unknown,unknown]>{
   const text=sql.replace(/ FOR (?:UPDATE|SHARE)/g,'').replace(/DATE_ADD\(NOW\(\),INTERVAL 30 DAY\)/g,"datetime('now','+30 days')");
   if(/^SELECT/i.test(text))return [db.prepare(text).all(...params),{}];
   const result=db.prepare(text).run(...params);return [{insertId:Number(result.lastInsertRowid),affectedRows:Number(result.changes)},{}];
  }};
 return {db,pool:{getConnection:async()=>connection} as any,query:connection.query,actor:{userId:'1',sessionId:'session',role:'admin'} as any,
  clock(value:string){now=value;}};
}

test('deleted model image can be explicitly re-imported with current metadata and one reference, then cannot be duplicated',async()=>{
 const f=galleryFixture();try{
  const first=await createModel(f.pool,f.actor,{assetId,category:'dress',note:'old',referenceCm:100});
  await deleteModel(f.pool,f.actor,first.id);
  assert.equal((f.db.prepare('SELECT ref_count FROM image_assets').get() as any).ref_count,0);
  // A verified identical upload revives the reusable asset before gallery attachment.
  f.db.exec("UPDATE image_assets SET status='ready',recycled_at=NULL,purge_after=NULL");
  f.clock('2032-01-01 00:00:00');
  const made=await createModel(f.pool,f.actor,{assetId,category:'top',angle:'back',note:'new',referenceCm:null});
  assert.equal(made.id,first.id);assert.equal(made.category,'top');assert.equal(made.angle,'back');
  assert.equal(made.note,'new');assert.equal(made.referenceCm,null);
  assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM v2_model_assets').get() as any).n,1);
  assert.equal((f.db.prepare('SELECT ref_count FROM image_assets').get() as any).ref_count,1);
  assert.equal((f.db.prepare('SELECT deleted_at,created_at FROM v2_model_assets').get() as any).deleted_at,null);
  await assert.rejects(createModel(f.pool,f.actor,{assetId,category:'dress'}),(e:unknown)=>e instanceof ModelGalleryError&&e.status===409&&e.message.includes(first.modelNo));
  assert.equal((f.db.prepare('SELECT ref_count FROM image_assets').get() as any).ref_count,1);
 }finally{f.db.close();}
});
test('re-import appears first even if its preserved model number is older',async()=>{
 const f=galleryFixture();try{
  const first=await createModel(f.pool,f.actor,{assetId,category:'dress'});await deleteModel(f.pool,f.actor,first.id);
  const secondAsset='22222222-2222-4222-8222-222222222222';
  f.db.prepare('INSERT INTO image_assets VALUES(?,?,?,?,?,?,NULL,NULL)').run(secondAsset,'ready','product_image',0,500,700);
  f.clock('2031-01-01 00:00:00');await createModel(f.pool,f.actor,{assetId:secondAsset,category:'dress'});
  f.db.prepare("UPDATE image_assets SET status='ready' WHERE id=?").run(assetId);
  f.clock('2032-01-01 00:00:00');await createModel(f.pool,f.actor,{assetId,category:'top'});
  assert.equal((await listModels({query:f.query},{limit:50,offset:0})).items[0].id,first.id);
 }finally{f.db.close();}
});
test('re-import rollback protects deletion and asset references when attachment fails',async()=>{
 const f=galleryFixture();try{
  const made=await createModel(f.pool,f.actor,{assetId,category:'dress'});await deleteModel(f.pool,f.actor,made.id);
  f.db.exec("UPDATE image_assets SET status='ready'; CREATE TRIGGER deny_reference BEFORE UPDATE OF ref_count ON image_assets BEGIN SELECT RAISE(FAIL,'reference denied'); END;");
  await assert.rejects(createModel(f.pool,f.actor,{assetId,category:'top'}),/reference denied/);
  const row=f.db.prepare('SELECT category,deleted_at FROM v2_model_assets').get() as any;
  assert.equal(row.category,'dress');assert.notEqual(row.deleted_at,null);
  assert.equal((f.db.prepare('SELECT ref_count FROM image_assets').get() as any).ref_count,0);
 }finally{f.db.close();}
});
test('unready assets and revoked sessions cannot reactivate a deleted model',async()=>{
 const f=galleryFixture();try{
  const made=await createModel(f.pool,f.actor,{assetId,category:'dress'});await deleteModel(f.pool,f.actor,made.id);
  await assert.rejects(createModel(f.pool,f.actor,{assetId,category:'top'}),(e:unknown)=>e instanceof ModelGalleryError&&e.status===409);
  f.db.exec("UPDATE image_assets SET status='ready'; UPDATE v2_access_sessions SET revoked_at='2030-01-01'");
  await assert.rejects(createModel(f.pool,f.actor,{assetId,category:'top'}),(e:unknown)=>e instanceof ModelGalleryError&&e.status===401);
  assert.notEqual((f.db.prepare('SELECT deleted_at FROM v2_model_assets').get() as any).deleted_at,null);
  assert.equal((f.db.prepare('SELECT ref_count FROM image_assets').get() as any).ref_count,0);
 }finally{f.db.close();}
});
test('model gallery schema refuses missing or partial structure without running DDL',async()=>{
 await assert.rejects(verifyModelGallerySchema({async query(){return [[],{}]}}),/schema drift/);
});
test('model gallery migration validates backup and target before touching schema',async()=>{
 const {migrateModelGallery}=await import('./modelGallerySchema');
 const db:any={async query(sql:string){
  if(sql.includes('SELECT DATABASE()'))return [[{database_name:'fabric_db',server_uuid:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}],{}];
  throw Error('must not migrate incorrect target');
 }};
 const target={database:'fabric_db',serverUuid:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'};
 await assert.rejects(migrateModelGallery(db,target,'wrong'),/Verified backup/);
 await assert.rejects(migrateModelGallery(db,target,'a'.repeat(64)),/target mismatch/);
 assert.match(MODEL_GALLERY_PLAN_SHA256,/^[a-f0-9]{64}$/);
});

test('model list supports paging and optional categories while preserving pixel size',async()=>{
 const calls:{sql:string;params?:unknown[]}[]=[];
 const db={async query(sql:string,params?:unknown[]):Promise<[unknown,unknown]>{
  calls.push({sql,params});
  if(sql.includes('COUNT(*)'))return [[{total:1}],{}];
  return [[{id:'42',asset_id:assetId,category:'dress',angle:'front',note:'sample',reference_cm:null,width:1200,height:1800}],{}];
 }};
 const result=await listModels(db,{limit:20,offset:5,category:'dress'});
 assert.equal(result.total,1);assert.equal(result.items[0].modelNo,'M00042');
 assert.equal(result.items[0].width,1200);
 assert.deepEqual(calls[1].params,['dress',20,5]);
 await assert.rejects(listModels(db,{limit:999,offset:0}),ModelGalleryError);
 await assert.rejects(listModels(db,{limit:20,offset:0,category:'fake'}),ModelGalleryError);
});
test('create rejects invalid identity before opening transaction',async()=>{
 const pool:any={getConnection:async()=>{throw Error('should not be called');}};
 await assert.rejects(createModel(pool,{} as any,{assetId:'../../',category:'dress'}),ModelGalleryError);
 await assert.rejects(editModel(pool,{} as any,'42',{assetId}),ModelGalleryError);
});
test('delete also refuses invalid id before transaction (authorization transaction is required for valid ids)',async()=>{
 const pool:any={async getConnection(){throw Error('authorization needed');}};
 await assert.rejects(deleteModel(pool,{} as any,'not-an-id'),ModelGalleryError);
});
