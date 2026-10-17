/** B1 ONLY: immutable, same-connection, read-only MySQL8 metadata gate.
 * No table creation, ALTER, repair or production connection. This checks a
 * named local sandbox schema only, NOT backup/permission/key/public H5 gates.
 */
export interface PatternLinkMetadataConnection{
 query(sql:string,args?:unknown[]):Promise<[unknown,unknown]>;
 release():void;
}
export interface PatternLinkMetadataPool{
 getConnection():Promise<PatternLinkMetadataConnection>;
}
type Row=Record<string,unknown>;
const NAME=/^fabric_v2_test_[a-zA-Z0-9_]{1,48}$/;
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const fail=(category:string)=>new Error('B1 share metadata mismatch: '+category);
function records(raw:unknown,category:string):Row[]{
 if(!Array.isArray(raw)||raw.some(x=>!x||typeof x!=='object'||Array.isArray(x)))
  throw fail(category);
 return raw as Row[];
}
const expectedColumns:Readonly<Record<string,{type:string;nullable:'YES'|'NO';extra?:string}>>={
 id:{type:'bigint unsigned',nullable:'NO',extra:'auto_increment'},
 master_id:{type:'bigint unsigned',nullable:'NO'},
 token_hash:{type:'char(64)',nullable:'NO'},
 status:{type:"enum('active','inactive','revoked')",nullable:'NO'},
 revoked_at:{type:'datetime',nullable:'YES'},
 created_at:{type:'datetime',nullable:'NO'}
};
const uniqueIndexes:Readonly<Record<string,readonly string[]>>={
 PRIMARY:['id'],uq_pattern_share_token:['token_hash'],uq_pattern_share_master:['master_id']
};
/** Only approved, exact identity fabric_v2_test_* sandboxes may be inspected.
 * All queries run on a single acquired connection to prevent connection pool
 * cross-database races; query inputs never alter SQL identifiers. Success
 * attests only shape, not any real publication/secret/privilege policy.
 */
export async function verifyPatternLinkSchemaContract(pool:PatternLinkMetadataPool,
 expectedDatabase:string,expectedServerUuid:string):Promise<void>{
 if(typeof expectedDatabase!=='string'||!NAME.test(expectedDatabase))
  throw Error('B1 share sandbox database name required');
 if(typeof expectedServerUuid!=='string'||!UUID.test(expectedServerUuid))
  throw Error('B1 share expected server identity required');
 if(!pool||typeof pool.getConnection!=='function')throw fail('metadata pool');
 const connection=await pool.getConnection();
 try{
  const load=async(sql:string,args:unknown[]=[]):Promise<Row[]>=>{
   if(!/^SELECT\s/.test(sql))throw Error('B1 share read-only SELECT preflight required');
   let response:unknown;
   try{response=await connection.query(sql,args);}catch{throw fail('query unavailable');}
   if(!Array.isArray(response)||response.length!==2)throw fail('result tuple');
   return records(response[0],'query rows');
  };
  const identity=await load('SELECT DATABASE() AS selected_database, @@server_uuid AS server_uuid');
  if(identity.length!==1||identity[0].selected_database!==expectedDatabase||
    identity[0].server_uuid!==expectedServerUuid)throw fail('database identity / server UUID');
  const tables=await load("SELECT TABLE_NAME,ENGINE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('pattern_share_links','pattern_masters')");
  for(const name of ['pattern_share_links','pattern_masters']){
   const matches=tables.filter(x=>x.TABLE_NAME===name);
   if(matches.length!==1)throw fail('table '+name);
   if(matches[0].ENGINE!=='InnoDB')throw fail('InnoDB table '+name);
  }
  const colsSql='SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,EXTRA,COLUMN_DEFAULT,CHARACTER_SET_NAME,COLLATION_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?';
  const parent=await load(colsSql,['pattern_masters']);
  const parentIds=parent.filter(x=>x.COLUMN_NAME==='id');
  if(parentIds.length!==1||parentIds[0].COLUMN_TYPE!=='bigint unsigned'||
    parentIds[0].IS_NULLABLE!=='NO')throw fail('parent pattern_masters.id type');
  const parentIndex=await load('SELECT INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME,SUB_PART,INDEX_TYPE FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',['pattern_masters']);
  const parentPK=parentIndex.filter(x=>x.INDEX_NAME==='PRIMARY');
  if(parentPK.length!==1||parentPK[0].COLUMN_NAME!=='id'||
    Number(parentPK[0].NON_UNIQUE)!==0||Number(parentPK[0].SEQ_IN_INDEX)!==1||
    parentPK[0].SUB_PART!==null||parentPK[0].INDEX_TYPE!=='BTREE')
   throw fail('parent pattern_masters primary id');
  const columns=await load(colsSql,['pattern_share_links']);
  for(const [name,want] of Object.entries(expectedColumns)){
   const matches=columns.filter(x=>x.COLUMN_NAME===name);
   if(matches.length!==1)throw fail('column '+name);
   const col=matches[0];
   if(col.COLUMN_TYPE!==want.type||col.IS_NULLABLE!==want.nullable||
      (want.extra&&col.EXTRA!==want.extra))throw fail('column '+name);
   if(name==='token_hash'&&(col.CHARACTER_SET_NAME!=='ascii'||col.COLLATION_NAME!=='ascii_bin'))
    throw fail('column '+name+' exact case-sensitive ASCII digest');
   if(name==='status'&&col.COLUMN_DEFAULT!=='active')throw fail('column status default');
   if(name==='created_at'&&
     !['CURRENT_TIMESTAMP','current_timestamp()'].includes(String(col.COLUMN_DEFAULT)))
    throw fail('column created_at default');
  }
  const indexes=await load('SELECT INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME,SUB_PART,INDEX_TYPE FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',['pattern_share_links']);
  for(const [name,columns] of Object.entries(uniqueIndexes)){
   const parts=indexes.filter(x=>x.INDEX_NAME===name);
   if(parts.length!==columns.length||parts.some((x,i)=>x.COLUMN_NAME!==columns[i]||
     Number(x.NON_UNIQUE)!==0||Number(x.SEQ_IN_INDEX)!==i+1||
     x.SUB_PART!==null||x.INDEX_TYPE!=='BTREE'))throw fail('index '+name);
  }
  const fks=await load(
   'SELECT k.CONSTRAINT_NAME,k.COLUMN_NAME,k.REFERENCED_TABLE_NAME,k.REFERENCED_COLUMN_NAME,k.ORDINAL_POSITION,r.DELETE_RULE,r.UPDATE_RULE FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE k JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.TABLE_NAME=k.TABLE_NAME AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME WHERE k.TABLE_SCHEMA=DATABASE() AND k.TABLE_NAME=? AND k.REFERENCED_TABLE_NAME IS NOT NULL',
   ['pattern_share_links']);
  const fk=fks.filter(x=>x.CONSTRAINT_NAME==='fk_pattern_share_master');
  // Another differently-named FK on the same column can change deletion
  // behavior (e.g., CASCADE). Require exactly one reference constraint.
  if(fks.length!==1||fk.length!==1||fk[0].COLUMN_NAME!=='master_id'||
    fk[0].REFERENCED_TABLE_NAME!=='pattern_masters'||
    fk[0].REFERENCED_COLUMN_NAME!=='id'||Number(fk[0].ORDINAL_POSITION)!==1||
    fk[0].DELETE_RULE!=='RESTRICT'||fk[0].UPDATE_RULE!=='RESTRICT')
   throw fail('foreign key fk_pattern_share_master');
 }finally{
  connection.release();
 }
}
