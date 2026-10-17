import type {AppPrincipal} from '../access/types';
import {scopeOrdersQuery} from '../access/sessions';
import type {Pool} from './lines';
import {readV2Document} from './documents';
/** Business snapshot only; never an import/restore API or a database backup. */
export async function* exportV2DocumentSnapshot(pool:Pool,actor:AppPrincipal){
 const scope=scopeOrdersQuery(actor),connection=await pool.getConnection();let active=false;
 try{
  await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');active=true;
  let after='0';
  while(true){
   const [raw]=await connection.query("SELECT o.id FROM orders o WHERE "+scope.predicate+" AND o.template_type IN ('sample','bulk','deposit') AND o.id>? ORDER BY o.id LIMIT 100",[...scope.parameters,after]);
   if(!Array.isArray(raw))throw Error('Document export unavailable');if(!raw.length)break;
   for(const row of raw){
    const id=String(row.id);if(!/^[1-9]\d*$/.test(id)||BigInt(id)<=BigInt(after))throw Error('Document export pagination invalid');
    yield await readV2Document(connection,actor,id);after=id;
   }
  }
  await connection.commit();active=false;
 }finally{try{if(active)await connection.rollback();}finally{connection.release();}}
}
