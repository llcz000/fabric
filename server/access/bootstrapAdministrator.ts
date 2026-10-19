import {hashPassword} from './password';
/** Operator-only initial account creation. Never called by login or server startup. */
export async function bootstrapV2Administrator(db:{query(sql:string,args?:unknown[]):Promise<[unknown,unknown]>},password:string){
 const hashed=await hashPassword(password);
 const [lock]=await db.query("SELECT GET_LOCK(CONCAT(DATABASE(),':v2-admin-bootstrap'),0) AS acquired");
 if(!Array.isArray(lock)||Number(lock[0]?.acquired)!==1)throw Error('Administrator bootstrap locked');
 try{
  const [data]=await db.query('SELECT COUNT(*) AS total FROM v2_access_users');
  if(!Array.isArray(data)||data.length!==1||Number(data[0].total)!==0)throw Error('V2 accounts already initialized; bootstrap refused');
  await db.query("INSERT INTO v2_access_users(username,username_normalized,display_name,password_hash,role,is_active,can_manage_own_orders,can_manage_products) VALUES ('admin','admin','管理员',?,'admin',1,1,1)",[hashed]);
 }finally{await db.query("SELECT RELEASE_LOCK(CONCAT(DATABASE(),':v2-admin-bootstrap'))");}
}
