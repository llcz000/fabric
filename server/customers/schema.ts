import {createHash} from 'node:crypto';

export interface CustomerSchemaTarget {database:string;serverUuid:string}
export interface CustomerMetadataConnection {
 query(sql:string,args?:unknown[]):Promise<[unknown,unknown]>;
 release():void;
}
export interface CustomerMetadataPool {getConnection():Promise<CustomerMetadataConnection>}
export interface CustomerMigrationPool {
 getConnection():Promise<CustomerMetadataConnection&{destroy():void}>;
}
type Row=Record<string,unknown>;
type Column={type:string;nullable?:boolean;auto?:boolean;default?:string;ascii?:boolean};
type Table={columns:Record<string,Column>;keys:{columns:string[];primary?:boolean}[];references:Record<string,string>;indexes?:string[][]};
const bigint=():Column=>({type:'bigint unsigned'});
const auto=():Column=>({type:'bigint unsigned',auto:true});
const version=():Column=>({type:'bigint unsigned',default:'1'});
const created=():Column=>({type:'datetime',default:'CURRENT_TIMESTAMP'});
const config:Record<string,Table>={
 customers:{columns:{id:auto(),display_name:{type:'varchar(160)'},profile_json:{type:'json'},search_text:{type:'text'},owner_user_id:bigint(),created_by_user_id:bigint(),sales_channel:{type:"enum('online','offline','both','unknown')"},tier:{type:"enum('A','B','C','unrated')"},relationship_stage:{type:"enum('prospect','sampling','trading','repeat','unknown')"},archived_at:{type:'datetime',nullable:true},row_version:version(),created_at:created()},keys:[{columns:['id'],primary:true}],references:{owner_user_id:'v2_access_users',created_by_user_id:'v2_access_users'},indexes:[['owner_user_id','archived_at','id']]},
 customer_access:{columns:{customer_id:bigint(),user_id:bigint(),permission:{type:"enum('view','edit')"},granted_by:bigint()},keys:[{columns:['customer_id','user_id']}],references:{customer_id:'customers',user_id:'v2_access_users',granted_by:'v2_access_users'},indexes:[['user_id','customer_id']]},
 customer_profile_events:{columns:{id:auto(),customer_id:bigint(),actor_user_id:bigint(),event_type:{type:'varchar(60)'},detail_json:{type:'json'},created_at:created()},keys:[{columns:['id'],primary:true}],references:{customer_id:'customers',actor_user_id:'v2_access_users'},indexes:[['customer_id','created_at','id']]},
 // A null customer_id is an unlink tombstone. Retaining row_version prevents ABA relinking.
 customer_session_links:{columns:{session_id:bigint(),customer_id:{...bigint(),nullable:true},row_version:version(),linked_by_user_id:bigint()},keys:[{columns:['session_id'],primary:true}],references:{session_id:'customer_sample_sessions',customer_id:'customers',linked_by_user_id:'v2_access_users'},indexes:[['customer_id','session_id']]},
 customer_requests:{columns:{actor_user_id:bigint(),request_id:{type:'char(36)',ascii:true},payload_hash:{type:'char(64)',ascii:true},result_json:{type:'json',nullable:true}},keys:[{columns:['actor_user_id','request_id'],primary:true}],references:{actor_user_id:'v2_access_users'}},
 customer_followups:{columns:{id:auto(),customer_id:bigint(),actor_user_id:bigint(),session_id:{...bigint(),nullable:true},contacted_on:{type:'date'},feedback:{type:'varchar(2000)',nullable:true},outcome:{type:'varchar(400)'}},keys:[{columns:['id'],primary:true}],references:{customer_id:'customers',actor_user_id:'v2_access_users',session_id:'customer_sample_sessions'},indexes:[['customer_id','contacted_on','id']]},
 customer_followup_tasks:{columns:{id:auto(),customer_id:bigint(),assignee_user_id:bigint(),source_followup_id:bigint(),due_on:{type:'date',nullable:true},next_action:{type:'varchar(400)'},status:{type:"enum('open','done','cancelled')",default:'open'},row_version:version()},keys:[{columns:['id'],primary:true},{columns:['source_followup_id']}],references:{customer_id:'customers',assignee_user_id:'v2_access_users',source_followup_id:'customer_followups'},indexes:[['assignee_user_id','status','due_on','id'],['customer_id','status','due_on','id']]}
};

/** Immutable additive operator plan. Loading this module executes no SQL. */
export const CUSTOMER_SCHEMA_SQL:string[]=Object.entries(config).map(([table,spec])=>{
 const definitions=Object.entries(spec.columns).map(([name,column])=>{
  const type=column.type.startsWith('enum(')?column.type:column.type.toUpperCase();
  const charset=column.ascii?' CHARACTER SET ascii COLLATE ascii_bin':'';
  const defaultSql=column.default===undefined?'':column.default==='CURRENT_TIMESTAMP'?' DEFAULT CURRENT_TIMESTAMP':column.default==='1'?' DEFAULT 1':" DEFAULT '"+column.default+"'";
  return name+' '+type+charset+(column.nullable?' NULL':' NOT NULL')+(column.auto?' AUTO_INCREMENT':'')+defaultSql;
 });
 spec.keys.forEach((key,i)=>definitions.push((key.primary||i===0?'PRIMARY KEY':'UNIQUE KEY uq_'+table+'_'+i)+' ('+key.columns.join(',')+')'));
 for(const [i,key] of (spec.indexes??[]).entries())definitions.push('KEY ix_'+table+'_'+i+' ('+key.join(',')+')');
 for(const [local,parent] of Object.entries(spec.references))definitions.push('CONSTRAINT fk_'+table+'_'+local+' FOREIGN KEY ('+local+') REFERENCES '+parent+'(id) ON DELETE RESTRICT ON UPDATE RESTRICT');
 return 'CREATE TABLE IF NOT EXISTS '+table+' (\n '+definitions.join(',\n ')+'\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci';
});
Object.freeze(CUSTOMER_SCHEMA_SQL);
export const CUSTOMER_PLAN_SHA256=createHash('sha256').update(CUSTOMER_SCHEMA_SQL.join('\n\n')).digest('hex');
const migrationId='20261020-light-customers';
const parents=['v2_access_users','customer_sample_sessions'];
const mismatch=(category:string)=>Error('Customer metadata mismatch: '+category);
function records(value:unknown):Row[]{
 if(!Array.isArray(value)||value.some(row=>!row||typeof row!=='object'||Array.isArray(row)))throw mismatch('query rows');
 return value as Row[];
}
function assertTarget(target:CustomerSchemaTarget):void {
 if(!target||typeof target.database!=='string'||!(/^[A-Za-z0-9_]{1,64}$/).test(target.database)||typeof target.serverUuid!=='string'||!(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/).test(target.serverUuid))throw Error('Customer explicit database identity and server UUID required');
}
async function load(db:CustomerMetadataConnection,sql:string,args:unknown[]=[]):Promise<Row[]>{
 const response=await db.query(sql,args);
 if(!Array.isArray(response)||response.length!==2)throw mismatch('query tuple');
 return records(response[0]);
}
async function identity(db:CustomerMetadataConnection,target:CustomerSchemaTarget){
 const found=await load(db,'SELECT DATABASE() AS selected_database, @@server_uuid AS server_uuid');
 if(found.length!==1||found[0].selected_database!==target.database||found[0].server_uuid!==target.serverUuid)throw mismatch('database identity / server UUID');
}
const columnsSql='SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,EXTRA,COLUMN_DEFAULT,CHARACTER_SET_NAME,COLLATION_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?';
const indexesSql='SELECT INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME,SUB_PART,INDEX_TYPE,IS_VISIBLE,EXPRESSION FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?';
function indexMatches(parts:Row[],columns:string[]){
 return parts.length===columns.length&&parts.slice().sort((a,b)=>Number(a.SEQ_IN_INDEX)-Number(b.SEQ_IN_INDEX)).every((part,i)=>part.COLUMN_NAME===columns[i]&&(part.NON_UNIQUE===0||part.NON_UNIQUE==='0')&&Number(part.SEQ_IN_INDEX)===i+1&&part.SUB_PART===null&&part.INDEX_TYPE==='BTREE'&&part.IS_VISIBLE==='YES'&&part.EXPRESSION===null);
}
function assertKeys(table:string,indexes:Row[],keys:Table['keys']){
 for(const key of keys){
  const names=[...new Set(indexes.map(row=>row.INDEX_NAME))];
  if(!names.some(name=>(!key.primary||name==='PRIMARY')&&indexMatches(indexes.filter(row=>row.INDEX_NAME===name),key.columns)))throw mismatch('index '+table+'('+key.columns.join(',')+')');
 }
}
async function inspectParents(db:CustomerMetadataConnection,tables:Row[]){
 for(const table of parents){
  assertTable(tables,table);
  const columns=await load(db,columnsSql,[table]),ids=columns.filter(col=>col.COLUMN_NAME==='id');
  if(ids.length!==1||ids[0].COLUMN_TYPE!=='bigint unsigned'||ids[0].IS_NULLABLE!=='NO'||!/^(?:auto_increment)?$/.test(String(ids[0].EXTRA)))throw mismatch('parent column '+table+'.id');
  assertKeys(table,await load(db,indexesSql,[table]),[{columns:['id'],primary:true}]);
 }
}
function assertTable(tables:Row[],table:string){
 const found=tables.filter(row=>row.TABLE_NAME===table);
 if(found.length!==1||found[0].ENGINE!=='InnoDB')throw mismatch('InnoDB table '+table);
}
async function inspect(db:CustomerMetadataConnection,target:CustomerSchemaTarget):Promise<void>{
 await identity(db,target);
 const tables=await load(db,'SELECT TABLE_NAME,ENGINE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE()');
 await inspectParents(db,tables);
 for(const [table,spec] of Object.entries(config)){
  assertTable(tables,table);
  const columns=await load(db,columnsSql,[table]);
  if(columns.length!==Object.keys(spec.columns).length)throw mismatch('column count '+table);
  for(const [name,want] of Object.entries(spec.columns)){
   const matches=columns.filter(col=>col.COLUMN_NAME===name),column=matches[0];
   if(matches.length!==1||column.COLUMN_TYPE!==want.type||column.IS_NULLABLE!==(want.nullable?'YES':'NO'))throw mismatch('column '+table+'.'+name);
   const extras=want.auto?['auto_increment']:want.default==='CURRENT_TIMESTAMP'?['','DEFAULT_GENERATED']:[''];
   if(!extras.includes(String(column.EXTRA)))throw mismatch('column extra '+table+'.'+name);
   if(want.default==='CURRENT_TIMESTAMP'){
    if(!['CURRENT_TIMESTAMP','current_timestamp()'].includes(String(column.COLUMN_DEFAULT)))throw mismatch('column default '+table+'.'+name);
   }else if(want.default!==undefined?String(column.COLUMN_DEFAULT)!==want.default:column.COLUMN_DEFAULT!==null)throw mismatch('column default '+table+'.'+name);
   if(want.ascii&&(column.CHARACTER_SET_NAME!=='ascii'||column.COLLATION_NAME!=='ascii_bin'))throw mismatch('column ASCII identity '+table+'.'+name);
  }
  assertKeys(table,await load(db,indexesSql,[table]),spec.keys);
  const references=await load(db,'SELECT k.CONSTRAINT_NAME,k.COLUMN_NAME,k.REFERENCED_TABLE_SCHEMA,k.REFERENCED_TABLE_NAME,k.REFERENCED_COLUMN_NAME,k.ORDINAL_POSITION,r.DELETE_RULE,r.UPDATE_RULE FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE k JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.TABLE_NAME=k.TABLE_NAME AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME WHERE k.TABLE_SCHEMA=DATABASE() AND k.TABLE_NAME=? AND k.REFERENCED_TABLE_NAME IS NOT NULL',[table]);
  if(references.length!==Object.keys(spec.references).length)throw mismatch('foreign key count '+table);
  const constraintNames=new Set<unknown>();
  for(const [local,parent] of Object.entries(spec.references)){
   const matches=references.filter(row=>row.COLUMN_NAME===local),fk=matches[0];
   if(matches.length!==1||typeof fk.CONSTRAINT_NAME!=='string'||constraintNames.has(fk.CONSTRAINT_NAME)||fk.REFERENCED_TABLE_SCHEMA!==target.database||fk.REFERENCED_TABLE_NAME!==parent||fk.REFERENCED_COLUMN_NAME!=='id'||Number(fk.ORDINAL_POSITION)!==1||fk.DELETE_RULE!=='RESTRICT'||fk.UPDATE_RULE!=='RESTRICT')throw mismatch('foreign key '+table+'.'+local);
   constraintNames.add(fk.CONSTRAINT_NAME);
  }
 }
}

/** Optional runtime startup gate: pinned physical identity and SELECT metadata only. */
export async function verifyCustomerSchema(pool:CustomerMetadataPool,target:CustomerSchemaTarget):Promise<void>{
 assertTarget(target);
 if(typeof pool?.getConnection!=='function')throw mismatch('physical pool');
 const db=await pool.getConnection();
 try{await inspect(db,target);}finally{db.release();}
}

/** Operator only. Never invoked by startup; no ALTER or repair of old contracts. */
export async function migrateCustomers(pool:CustomerMigrationPool,target:CustomerSchemaTarget,backupSha256:string,confirmation:string):Promise<{alreadyApplied:boolean;planSha256:string}>{
 assertTarget(target);
 if(confirmation!=='APPLY_CUSTOMERS'||typeof backupSha256!=='string'||!(/^[a-f0-9]{64}$/).test(backupSha256)||typeof pool?.getConnection!=='function')throw Error('Customer verified backup, physical connection and separate confirmation required');
 const db=await pool.getConnection(),lock='fabric-v2:'+target.database;
 let lockState:'none'|'uncertain'|'held'='none';
 try{
  if(typeof db.destroy!=='function')throw Error('Customer migration requires a disposable physical connection');
  await identity(db,target);
  lockState='uncertain';
  const got=await load(db,'SELECT GET_LOCK(?,0) AS acquired',[lock]);
  if(got.length!==1)throw Error('Customer migration lock response unverified');
  const acquired=got[0].acquired;
  if(acquired===0||acquired==='0'||acquired===null){lockState='none';throw Error('Customer migration lock unavailable');}
  if(acquired!==1&&acquired!=='1')throw Error('Customer migration lock response unverified');
  lockState='held';
  const ledger=async()=>{
   const found=await load(db,'SELECT plan_sha256,applied_at FROM fabric_v2_migration_ledger WHERE migration_id=?',[migrationId]);
   if(found.length>1||found[0]&&found[0].plan_sha256!==CUSTOMER_PLAN_SHA256)throw Error('Customer migration plan drift');
   return found;
  };
  const found=await ledger();
  if(found[0]?.applied_at){await inspect(db,target);return {alreadyApplied:true,planSha256:CUSTOMER_PLAN_SHA256};}
  // Check old parents before any additive DDL can partially apply.
  await inspectParents(db,await load(db,'SELECT TABLE_NAME,ENGINE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE()'));
  await db.query('INSERT IGNORE INTO fabric_v2_migration_ledger(migration_id,plan_sha256,backup_sha256) VALUES (?,?,?)',[migrationId,CUSTOMER_PLAN_SHA256,backupSha256]);
  const recorded=await ledger();
  if(recorded.length!==1)throw Error('Customer migration ledger entry unverified');
  for(const sql of CUSTOMER_SCHEMA_SQL)await db.query(sql);
  await inspect(db,target);
  const [updated]=await db.query('UPDATE fabric_v2_migration_ledger SET applied_at=UTC_TIMESTAMP() WHERE migration_id=? AND plan_sha256=? AND applied_at IS NULL',[migrationId,CUSTOMER_PLAN_SHA256]);
  if(!updated||typeof updated!=='object'||Array.isArray(updated)||(updated as {affectedRows?:unknown}).affectedRows!==1)throw Error('Customer migration applied ledger write unverified');
  return {alreadyApplied:false,planSha256:CUSTOMER_PLAN_SHA256};
 }finally{
  if(lockState==='held'){
   lockState='uncertain';
   try{
    const reply=await load(db,'SELECT RELEASE_LOCK(?) AS released',[lock]);
    if(reply.length!==1||(reply[0].released!==1&&reply[0].released!=='1'))throw Error('unverified');
    lockState='none';
   }catch{db.destroy();throw Error('Customer migration lock release unverified; connection discarded');}
  }
  if(lockState==='uncertain')db.destroy();else db.release();
 }
}
