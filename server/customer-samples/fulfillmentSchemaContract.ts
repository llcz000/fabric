/** B3 read-only schema attestation. Never creates, alters or repairs tables. */
export interface FulfillmentMetadataPool {
 getConnection():Promise<{query(sql:string,params?:unknown[]):Promise<[unknown,unknown]>;release():void}>;
}
type Row=Record<string,unknown>;
type Relation={name:string;target:string;pairs:[string,string][]};
const config=[
 {table:'sample_shipments',columns:{id:'bigint unsigned',session_id:'bigint unsigned',actor_user_id:'bigint unsigned',shipped_at:'datetime(3)',carrier:'varchar(160)?',tracking_no:'varchar(160)?'},
  keys:{uq_sample_shipments_session:['id','session_id']},checks:[],
  fks:[{name:'fk_shipment_session',target:'customer_sample_sessions',pairs:[['session_id','id']]},{name:'fk_shipment_actor',target:'v2_access_users',pairs:[['actor_user_id','id']]}]},
 {table:'sample_shipment_items',columns:{id:'bigint unsigned',shipment_id:'bigint unsigned',session_id:'bigint unsigned',product_id:'bigint unsigned',quantity:'bigint unsigned'},
  keys:{uq_sample_shipment_product:['shipment_id','product_id']},checks:['ck_shipment_quantity'],
  fks:[{name:'fk_shipment_line_batch',target:'sample_shipments',pairs:[['shipment_id','id'],['session_id','session_id']]},
   {name:'fk_shipment_line_selected',target:'customer_sample_items',pairs:[['session_id','session_id'],['product_id','product_id']]}]},
 {table:'sample_followups',columns:{id:'bigint unsigned',session_id:'bigint unsigned',actor_user_id:'bigint unsigned',contacted_on:'date',customer_confirmed:'tinyint(1)?',feedback:'text?',outcome:'varchar(400)',next_action:'varchar(400)?',next_followup_on:'date?'},
  keys:{uq_sample_followups_session:['id','session_id']},checks:['ck_followup_confirmed','ck_followup_next'],
  fks:[{name:'fk_followup_session',target:'customer_sample_sessions',pairs:[['session_id','id']]},{name:'fk_followup_actor',target:'v2_access_users',pairs:[['actor_user_id','id']]}]},
 {table:'sample_followup_products',columns:{id:'bigint unsigned',followup_id:'bigint unsigned',session_id:'bigint unsigned',product_id:'bigint unsigned'},
  keys:{uq_followup_product:['followup_id','product_id']},checks:[],
  fks:[{name:'fk_followup_line_header',target:'sample_followups',pairs:[['followup_id','id'],['session_id','session_id']]},
   {name:'fk_followup_line_selected',target:'customer_sample_items',pairs:[['session_id','session_id'],['product_id','product_id']]}]}
] as const;
// Compare the strict MySQL-8 canonical expression, not just a named CHECK.
// Parentheses/quotes/whitespace may differ in INFORMATION_SCHEMA output;
// any other semantic or syntactic change fails closed and needs review.
const requiredCheckClauses:Readonly<Record<string,string>>={
 ck_shipment_quantity:'quantity>0',
 ck_followup_confirmed:'customer_confirmedin0,1orcustomer_confirmedisnull',
 ck_followup_next:'next_followup_onisnullornext_followup_on>=contacted_on'
};
function rows(value:unknown):Row[]{
 if(!Array.isArray(value)||value.some(x=>!x||typeof x!=='object'||Array.isArray(x)))
  throw Error('B3 fulfillment metadata unavailable');
 return value as Row[];
}
const norm=(v:unknown)=>typeof v==='string'?v.toLowerCase().replace(/[\s`]/g,''):'';
const normCheck=(v:unknown)=>norm(v).replace(/[()]/g,'');
export async function verifyFulfillmentSchemaContract(pool:FulfillmentMetadataPool,expectedDatabase:string):Promise<void>{
 if(typeof expectedDatabase!=='string'||!(/^[A-Za-z0-9_]{5,64}$/).test(expectedDatabase))
  throw Error('B3 fulfillment expected database identity required');
 const connection=await pool.getConnection();
 try{
  const load=async(sql:string,args:unknown[]=[]):Promise<Row[]>=>{
   if(!/^SELECT\s/i.test(sql))throw Error('B3 fulfillment read-only preflight required');
   const [value]=await connection.query(sql,args);
   return rows(value);
  };
  const identity=await load('SELECT DATABASE() AS selected_database');
  if(identity.length!==1||identity[0].selected_database!==expectedDatabase)
   throw Error('B3 fulfillment database identity mismatch');
  const found=await load('SELECT TABLE_NAME,ENGINE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE()');
  for(const item of config){
   const table=item.table;
   const meta=found.filter(x=>x.TABLE_NAME===table);
   if(meta.length!==1)throw Error('B3 fulfillment missing table '+table);
   if(norm(meta[0].ENGINE)!=='innodb')throw Error('B3 fulfillment requires InnoDB '+table);
   const columns=await load('SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',[table]);
   for(const [name,raw] of Object.entries(item.columns)){
    const nullable=raw.endsWith('?'),type=nullable?raw.slice(0,-1):raw;
    const matches=columns.filter(c=>c.COLUMN_NAME===name&&norm(c.COLUMN_TYPE)===norm(type)&&c.IS_NULLABLE===(nullable?'YES':'NO'));
    if(matches.length!==1)throw Error('B3 fulfillment column mismatch '+table+'.'+name);
   }
   const indexes=await load('SELECT INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',[table]);
   for(const [name,want] of Object.entries(item.keys)){
    const parts=indexes.filter(x=>x.INDEX_NAME===name).sort((a,b)=>Number(a.SEQ_IN_INDEX)-Number(b.SEQ_IN_INDEX));
    if(parts.length!==want.length||parts.some((x,i)=>x.COLUMN_NAME!==want[i]||Number(x.NON_UNIQUE)!==0||Number(x.SEQ_IN_INDEX)!==i+1))
     throw Error('B3 fulfillment unique index mismatch '+table+'.'+name);
   }
   const references=await load('SELECT k.CONSTRAINT_NAME,k.COLUMN_NAME,k.REFERENCED_TABLE_NAME,k.REFERENCED_COLUMN_NAME,r.DELETE_RULE FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE k JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.TABLE_NAME=k.TABLE_NAME AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME WHERE k.TABLE_SCHEMA=DATABASE() AND k.TABLE_NAME=? AND k.REFERENCED_TABLE_NAME IS NOT NULL',[table]);
   for(const relation of item.fks){
    const {name,target}=relation,parts=references.filter(x=>x.CONSTRAINT_NAME===name);
    if(parts.length!==relation.pairs.length||relation.pairs.some(([local,remote])=>
     parts.filter(x=>x.COLUMN_NAME===local&&x.REFERENCED_TABLE_NAME===target&&x.REFERENCED_COLUMN_NAME===remote&&x.DELETE_RULE==='RESTRICT').length!==1))
     throw Error('B3 fulfillment foreign key mismatch '+table+'.'+name);
   }
   const checks=await load("SELECT CONSTRAINT_NAME,ENFORCED FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND CONSTRAINT_TYPE='CHECK'",[table]);
   for(const name of item.checks){
    if(checks.filter(x=>x.CONSTRAINT_NAME===name&&x.ENFORCED==='YES').length!==1)
     throw Error('B3 fulfillment enforced check mismatch '+table+'.'+name);
    const verified=await load('SELECT CONSTRAINT_NAME,CHECK_CLAUSE FROM INFORMATION_SCHEMA.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME=?',[name]);
    if(verified.length!==1||verified[0].CONSTRAINT_NAME!==name||
     normCheck(verified[0].CHECK_CLAUSE)!==requiredCheckClauses[name])
     throw Error('B3 fulfillment CHECK expression mismatch '+table+'.'+name);
   }
  }
 }finally{connection.release();}
}
