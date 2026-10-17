/** Read-only B2-5 MySQL 8 schema attestation before any isolated migration/HTTP rollout.
 * Never ALTER or repair on mismatch. This checks the destructive-risk invariants
 * (retired card history, versioned print, permanently revoked QR and immutable FK).
 * Main product-domain checks are performed by verifyV2SchemaContract separately.
 */
import type {SampleCardDb} from './cardLibrary';

type Row=Record<string,unknown>;
const TABLES=['sample_cards','sample_card_tokens','customer_sample_sessions',
 'customer_sample_session_access','customer_sample_selected_cards','customer_sample_scan_events',
 'customer_sample_items','customer_sample_item_sources','customer_sample_item_removal_events',
 'customer_sample_manual_events'] as const;
function rowset(value:unknown,label:string):Row[]{
 if(!Array.isArray(value)||value.some(r=>r===null||typeof r!=='object'||Array.isArray(r)))
  throw Error('B2-5 metadata unavailable: '+label);
 return value as Row[];
}
const normalized=(x:unknown)=>String(x??'').toLowerCase().replace(/[\s`]/g,'');
function checkColumn(data:Row[],table:string,name:string,type:string,nullable:'YES'|'NO'){
 const x=data.find(r=>r.COLUMN_NAME===name);
 if(!x||normalized(x.COLUMN_TYPE)!==normalized(type)||x.IS_NULLABLE!==nullable)
  throw Error('B2-5 schema mismatch '+table+'.'+name);
 return x;
}
function checkIndex(data:Row[],table:string,name:string,columns:readonly string[]){
 const matches=data.filter(r=>r.INDEX_NAME===name)
  .sort((a,b)=>Number(a.SEQ_IN_INDEX)-Number(b.SEQ_IN_INDEX));
 if(matches.length!==columns.length||matches.some((r,i)=>
  Number(r.NON_UNIQUE)!==0||Number(r.SEQ_IN_INDEX)!==i+1||r.COLUMN_NAME!==columns[i]))
  throw Error('B2-5 schema mismatch '+table+'.'+name+' unique');
}
function checkFk(data:Row[],table:string,name:string,column:string){
 const f=data.filter(r=>r.CONSTRAINT_NAME===name);
 if(f.length!==1||f[0].COLUMN_NAME!==column||
  f[0].REFERENCED_TABLE_NAME!=='sample_cards'||f[0].REFERENCED_COLUMN_NAME!=='id'||
  f[0].DELETE_RULE!=='RESTRICT')
  throw Error('B2-5 history FK mismatch '+table+'.'+name);
}
function checkReference(data:Row[],table:string,name:string,target:string,pairs:readonly (readonly [string,string])[]){
 const refs=data.filter(x=>x.CONSTRAINT_NAME===name);
 if(refs.length!==pairs.length||pairs.some(([column,referenced])=>
  refs.filter(x=>x.COLUMN_NAME===column&&x.REFERENCED_TABLE_NAME===target&&
   x.REFERENCED_COLUMN_NAME===referenced&&x.DELETE_RULE==='RESTRICT').length!==1))
  throw Error('B2-5 history FK mismatch '+table+'.'+name);
}
export async function verifyB25SampleSchemaContract(db:SampleCardDb):Promise<void>{
 const load=async(sql:string,table?:string):Promise<Row[]>=>{
  if(!/^SELECT\s/i.test(sql))throw Error('B2-5 read-only metadata required');
  const [found]=await db.query(sql,table?[table]:[]);
  return rowset(found,table??'tables');
 };
 const tables=await load('SELECT TABLE_NAME,ENGINE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE()');
 for(const name of TABLES){
  const row=tables.find(x=>x.TABLE_NAME===name);
  if(!row)throw Error('B2-5 missing '+name);
  if(normalized(row.ENGINE)!=='innodb')throw Error('B2-5 '+name+' requires InnoDB');
 }
 const columns=async(name:string)=>load(
  'SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,EXTRA,GENERATION_EXPRESSION FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',name);
 const indexes=async(name:string)=>load(
  'SELECT INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',name);
 const checks=async(name:string)=>load(
  'SELECT CONSTRAINT_NAME,ENFORCED FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND CONSTRAINT_TYPE=\'CHECK\'',name);
 const fks=async(name:string)=>load(
  'SELECT k.CONSTRAINT_NAME,k.COLUMN_NAME,k.REFERENCED_TABLE_NAME,k.REFERENCED_COLUMN_NAME,r.DELETE_RULE FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE k JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.TABLE_NAME=k.TABLE_NAME AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME WHERE k.TABLE_SCHEMA=DATABASE() AND k.TABLE_NAME=? AND k.REFERENCED_TABLE_NAME IS NOT NULL',name);
 const cardCols=await columns('sample_cards');
 for(const [name,type,nullable] of [
  ['id','bigint unsigned','NO'],['master_id','bigint unsigned','NO'],
  ['fabric_id','bigint unsigned','NO'],['card_no','varchar(129)','NO'],
  ['qr_payload','varchar(128)','NO'],['is_active','tinyint(1)','NO'],
  ['deleted_at','datetime','YES'],['reprint_revision','bigint unsigned','NO'],
  ['printed_revision','bigint unsigned','NO']
 ] as const)checkColumn(cardCols,'sample_cards',name,type,nullable);
 for(const [name,type,source] of [
  ['active_master_id','bigint unsigned','master_id'],
  ['active_fabric_id','bigint unsigned','fabric_id'],
  ['active_card_no','varchar(129)','card_no']
 ] as const){
  const value=checkColumn(cardCols,'sample_cards',name,type,'YES');
  const expr=normalized(value.GENERATION_EXPRESSION).replace(/[()]/g,'');
  if(!normalized(value.EXTRA).includes('storedgenerated')||
   expr!==`casewhendeleted_atisnullthen${source}elsenullend`)
   throw Error('B2-5 unsafe generated column sample_cards.'+name);
 }
 const cardIndexes=await indexes('sample_cards');
 checkIndex(cardIndexes,'sample_cards','PRIMARY',['id']);
 checkIndex(cardIndexes,'sample_cards','uq_sample_card_combo',['active_master_id','active_fabric_id']);
 checkIndex(cardIndexes,'sample_cards','uq_sample_card_no',['active_card_no']);
 checkIndex(cardIndexes,'sample_cards','uq_sample_card_payload',['qr_payload']);
 // An old UNIQUE(card_no) or UNIQUE(master_id,fabric_id) silently breaks recreation.
 const approved=new Set(['PRIMARY','uq_sample_card_combo','uq_sample_card_no','uq_sample_card_payload']);
 if(cardIndexes.some(index=>Number(index.NON_UNIQUE)===0&&!approved.has(String(index.INDEX_NAME))))
  throw Error('B2-5 unexpected sample_cards unique index blocks retired-card recreation');
 const printChecks=await checks('sample_cards');
 if(!printChecks.some(x=>x.CONSTRAINT_NAME==='ck_sample_card_reprint_revision'&&x.ENFORCED==='YES'))
  throw Error('B2-5 missing enforced ck_sample_card_reprint_revision');
 const tokenCols=await columns('sample_card_tokens');
 checkColumn(tokenCols,'sample_card_tokens','card_id','bigint unsigned','NO');
 checkColumn(tokenCols,'sample_card_tokens','token_hash','char(64)','NO');
 checkColumn(tokenCols,'sample_card_tokens','revoked_at','datetime','YES');
 const tokenIndexes=await indexes('sample_card_tokens');
 checkIndex(tokenIndexes,'sample_card_tokens','uq_sample_token_hash',['token_hash']);
 checkIndex(tokenIndexes,'sample_card_tokens','uq_sample_token_card',['card_id']);
 // Fresh v1.50 selection rows store identity/provenance only. Refuse v1.49
 // schema drift before business writes; database migrations require a separate gate.
 const itemCols=await columns('customer_sample_items');
 for(const name of ['id','session_id','product_id','selected_by_user_id'] as const)
  checkColumn(itemCols,'customer_sample_items',name,'bigint unsigned','NO');
 checkColumn(itemCols,'customer_sample_items','removed_at','datetime','YES');
 checkColumn(itemCols,'customer_sample_items','removed_by_user_id','bigint unsigned','YES');
 if(!(await checks('customer_sample_items')).some(x=>x.CONSTRAINT_NAME==='ck_sample_item_removal'&&x.ENFORCED==='YES'))
  throw Error('B3 missing enforced ck_sample_item_removal');
 const removalCols=await columns('customer_sample_item_removal_events');
 for(const name of ['id','session_id','product_id','actor_user_id'])
  checkColumn(removalCols,'customer_sample_item_removal_events',name,'bigint unsigned','NO');
 checkColumn(removalCols,'customer_sample_item_removal_events','removed_at','datetime','NO');
 const removals=await fks('customer_sample_item_removal_events');
 checkReference(removals,'customer_sample_item_removal_events','fk_sample_removal_item','customer_sample_items',
  [['session_id','session_id'],['product_id','product_id']]);
 checkReference(removals,'customer_sample_item_removal_events','fk_sample_removal_actor','v2_access_users',[['actor_user_id','id']]);
 // Manual audit retains a card reference. NULL is only for historical no-card events.
 const manualCols=await columns('customer_sample_manual_events');
 for(const name of ['id','session_id','product_id','actor_user_id'] as const)
  checkColumn(manualCols,'customer_sample_manual_events',name,'bigint unsigned','NO');
 checkColumn(manualCols,'customer_sample_manual_events','action',"enum('added','restored','already_selected')",'NO');
 checkColumn(manualCols,'customer_sample_manual_events','selected_at','datetime','NO');
 checkColumn(manualCols,'customer_sample_manual_events','card_id','bigint unsigned','YES');
 const manualRefs=await fks('customer_sample_manual_events');
 checkReference(manualRefs,'customer_sample_manual_events','fk_sample_manual_item','customer_sample_items',
  [['session_id','session_id'],['product_id','product_id']]);
 checkReference(manualRefs,'customer_sample_manual_events','fk_sample_manual_actor','v2_access_users',[['actor_user_id','id']]);
 checkReference(manualRefs,'customer_sample_manual_events','fk_sample_manual_card','sample_cards',[['card_id','id']]);
 if(itemCols.some(x=>String(x.COLUMN_NAME).toLowerCase()==='product_snapshot_json'))
  throw Error('B2-5 schema mismatch customer_sample_items legacy snapshot');
 checkIndex(await indexes('customer_sample_items'),'customer_sample_items','uq_sample_session_product',['session_id','product_id']);
 checkIndex(await indexes('customer_sample_selected_cards'),'customer_sample_selected_cards','uq_sample_selected_card',['session_id','card_id']);
 const sourceIndexes=await indexes('customer_sample_item_sources');
 checkIndex(sourceIndexes,'customer_sample_item_sources','uq_sample_item_card_source',['session_id','product_id','card_id']);
 // A second UNIQUE(session_id,product_id) would silently discard provenance from
 // a different card when scans use ON DUPLICATE KEY UPDATE id=id.
 const sourceApprovedUnique=new Set(['PRIMARY','uq_sample_item_card_source']);
 if(sourceIndexes.some(x=>Number(x.NON_UNIQUE)===0&&!sourceApprovedUnique.has(String(x.INDEX_NAME))))
  throw Error('B2-5 unexpected source unique index blocks multiple card provenance');
 checkReference(await fks('customer_sample_items'),'customer_sample_items','fk_sample_item_product','v2_products',[['product_id','id']]);
 checkReference(await fks('customer_sample_items'),'customer_sample_items','fk_sample_item_removed_actor','v2_access_users',[['removed_by_user_id','id']]);
 const sources=await fks('customer_sample_item_sources');
 checkReference(sources,'customer_sample_item_sources','fk_sample_source_item','customer_sample_items',
  [['session_id','session_id'],['product_id','product_id']]);
 checkReference(sources,'customer_sample_item_sources','fk_sample_source_event','customer_sample_scan_events',
  [['first_scan_event_id','id']]);
 for(const [table,name] of [
  ['sample_card_tokens','fk_sample_token_card'],
  ['customer_sample_selected_cards','fk_sample_selected_card'],
  ['customer_sample_scan_events','fk_sample_event_card'],
  ['customer_sample_item_sources','fk_sample_source_card']
 ] as const)checkFk(await fks(table),table,name,'card_id');
}
