import {createHash} from 'node:crypto';
import type {Pool} from '../order-v2/lines';
import type {V2ProductionTarget} from '../product-master/v2ProductionTarget';
import {ensureProductSampleCard} from './cardLibrary';
type Db={query(sql:string,args?:unknown[]):Promise<[unknown,unknown]>};
const groupsSql='SELECT c.master_id,p.fabric_id,COUNT(*) AS product_count,MAX(sc.id) AS card_id FROM v2_products p '+
 'JOIN pattern_colorways c ON c.id=p.pattern_colorway_id JOIN pattern_masters m ON m.id=c.master_id '+
 'JOIN v2_fabrics f ON f.id=p.fabric_id LEFT JOIN sample_cards sc ON sc.master_id=c.master_id AND sc.fabric_id=p.fabric_id AND sc.deleted_at IS NULL '+
 'WHERE m.deleted_at IS NULL AND f.deleted_at IS NULL GROUP BY c.master_id,p.fabric_id ORDER BY c.master_id,p.fabric_id';
export const PRODUCT_CARDS_PLAN_SHA256=createHash('sha256').update(groupsSql+'\nv1: lock masters then fabrics; ensure missing cards and random QR tokens; preserve existing cards and products').digest('hex');
const rows=(raw:unknown):Record<string,unknown>[]=>{if(!Array.isArray(raw))throw Error('Product card inventory unavailable');return raw;};
export async function inventoryProductCards(db:Db){
 const [raw]=await db.query(groupsSql);
 const groups=rows(raw).map(row=>({masterId:String(row.master_id),fabricId:String(row.fabric_id),products:Number(row.product_count),cardId:row.card_id==null?null:String(row.card_id)}));
 return {groups,products:groups.reduce((n,g)=>n+g.products,0),missing:groups.filter(g=>g.cardId===null).length};
}
/** Explicit registered data migration; runtime startup must never call it. */
export async function migrateProductCards(pool:Pool,target:V2ProductionTarget,backupSha256:string){
 if(!/^[a-f0-9]{64}$/.test(backupSha256))throw Error('Verified backup required');
 const db=await pool.getConnection(),lock='fabric-v2:'+target.database;
 let held=false,began=false;
 try{
  const [raw]=await db.query('SELECT DATABASE() AS database_name,@@server_uuid AS server_uuid');const identity=rows(raw);
  if(identity.length!==1||identity[0].database_name!==target.database||identity[0].server_uuid!==target.serverUuid)throw Error('Product card migration target mismatch');
  const [got]=await db.query('SELECT GET_LOCK(?,0) AS acquired',[lock]);
  if(Number(rows(got)[0]?.acquired)!==1)throw Error('Product card migration lock unavailable');held=true;
  await db.beginTransaction();began=true;
  const migrationId='20261025-product-auto-cards',planSha256=PRODUCT_CARDS_PLAN_SHA256;
  const [previous]=await db.query('SELECT plan_sha256,applied_at FROM fabric_v2_migration_ledger WHERE migration_id=? FOR UPDATE',[migrationId]);
  const prior=rows(previous)[0];
  if(prior&&prior.plan_sha256!==planSha256)throw Error('Product card migration plan drift');
  const {groups}=await inventoryProductCards(db);
  const sorted=(ids:string[])=>[...new Set(ids)].sort((a,b)=>BigInt(a)<BigInt(b)?-1:BigInt(a)>BigInt(b)?1:0);
  for(const id of sorted(groups.map(g=>g.masterId)))await db.query('SELECT id,master_no,is_active FROM pattern_masters WHERE id=? FOR UPDATE',[id]);
  for(const id of sorted(groups.map(g=>g.fabricId)))await db.query('SELECT id,fabric_no,is_active FROM v2_fabrics WHERE id=? FOR UPDATE',[id]);
  let created=0;
  for(const group of groups){const result=await ensureProductSampleCard(db,group.masterId,group.fabricId);if(result.created)created++;}
  if((await inventoryProductCards(db)).missing)throw Error('Product card supplement incomplete');
  if(!prior?.applied_at)await db.query('INSERT INTO fabric_v2_migration_ledger(migration_id,plan_sha256,backup_sha256,applied_at) VALUES(?,?,?,UTC_TIMESTAMP())',[migrationId,planSha256,backupSha256]);
  await db.commit();began=false;return {alreadyApplied:Boolean(prior?.applied_at),planSha256,created};
 }catch(error){if(began)await db.rollback();throw error;}
 finally{try{if(held)await db.query('SELECT RELEASE_LOCK(?) AS released',[lock]);}finally{db.release();}}
}
