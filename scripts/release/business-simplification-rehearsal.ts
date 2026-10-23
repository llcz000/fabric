import assert from 'node:assert/strict';
import {verifyDeletionAuditSchema} from '../../server/audit/businessSimplificationSchema';
import {recordDeletion} from '../../server/audit/deletionAudit';
export async function rehearseBusinessSimplification(pool:any):Promise<string[]>{
 await verifyDeletionAuditSchema(pool);
 const queries=["SELECT COUNT(*) AS total FROM pattern_masters WHERE deleted_at IS NULL AND is_active<>1","SELECT COUNT(*) AS total FROM pattern_colorways c JOIN pattern_masters m ON m.id=c.master_id WHERE m.deleted_at IS NULL AND c.is_active<>1","SELECT COUNT(*) AS total FROM v2_fabrics WHERE deleted_at IS NULL AND is_active<>1","SELECT COUNT(*) AS total FROM v2_products p JOIN pattern_colorways c ON c.id=p.pattern_colorway_id JOIN pattern_masters m ON m.id=c.master_id JOIN v2_fabrics f ON f.id=p.fabric_id WHERE m.deleted_at IS NULL AND f.deleted_at IS NULL AND (p.is_active<>1 OR p.is_available_for_sampling<>1)","SELECT COUNT(*) AS total FROM sample_cards c JOIN pattern_masters m ON m.id=c.master_id JOIN v2_fabrics f ON f.id=c.fabric_id WHERE c.deleted_at IS NULL AND m.deleted_at IS NULL AND f.deleted_at IS NULL AND c.is_active<>1"];
 for(const sql of queries){const [rows]=await pool.query(sql);assert.equal(Number(rows[0]?.total),0);}
 const tx=await pool.getConnection();try{await tx.beginTransaction();await recordDeletion(tx,{userId:'1'},{type:'document',id:'18446744073709551615',label:'isolated restore rehearsal'});const [rows]=await tx.query("SELECT entity_type,entity_label FROM business_delete_events WHERE entity_id='18446744073709551615'");assert(rows.some((r:any)=>r.entity_type==='document'&&r.entity_label==='isolated restore rehearsal'));}finally{try{await tx.rollback();}finally{tx.release();}}
 return ['undeleted catalog/sampling flags normalized','minimal deletion audit transactional insert and rollback'];
}
