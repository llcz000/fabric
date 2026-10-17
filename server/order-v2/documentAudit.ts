import type {AppPrincipal} from '../access/types';
interface Db{query(sql:string,args?:unknown[]):Promise<[unknown,unknown]>}
/** AUTH-05: called on the already locked order, before edit/delete commits. */
export async function recordAdminDocumentAction(db:Db,actor:AppPrincipal,id:string,owner:string|null,action:'edit'|'delete'){
 if(actor.role!=='admin'||owner===actor.userId)return;
 const [result]=await db.query('INSERT INTO v2_document_audit_events (subject_order_id,original_owner_user_id,actor_user_id,actor_session_id,action,document_no) SELECT id,?,?,?, ?,order_no FROM orders WHERE id=?',[owner,actor.userId,actor.sessionId,action,id]);
 if(Number((result as {affectedRows?:unknown}).affectedRows)!==1)throw Error('Document audit persistence unavailable');
}
