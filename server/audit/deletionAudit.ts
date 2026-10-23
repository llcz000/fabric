/** Minimal append-only identity trail; caller owns authorization and transaction. No content snapshots. */
export type DeletedEntity='pattern'|'colorway'|'fabric'|'product'|'card'|'customer'|'selection'|'document';
interface Db{query(sql:string,args?:unknown[]):Promise<[unknown,unknown]>}
export async function recordDeletion(db:Db,actor:{userId:string},item:{type:DeletedEntity;id:string;label:string}):Promise<void>{
 if(!/^[1-9][0-9]{0,19}$/.test(actor.userId)||!/^[1-9][0-9]{0,19}$/.test(item.id)||!['pattern','colorway','fabric','product','card','customer','selection','document'].includes(item.type)||typeof item.label!=='string'||!item.label.trim()||item.label.length>255)throw Error('Invalid deletion identity');
 const [result]=await db.query('INSERT INTO business_delete_events(entity_type,entity_id,entity_label,actor_user_id) VALUES (?,?,?,?)',[item.type,item.id,item.label,actor.userId]);
 if((result as {affectedRows?:unknown})?.affectedRows!==1)throw Error('Deletion audit persistence unavailable');
}
