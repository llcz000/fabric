import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createFabric} from '../../server/product-master/fabrics';
import {createPatternMaster,deletePatternMaster,listPatternMasters,updatePatternMaster} from '../../server/product-master/patternMasters';
import {createSampleCard,retireSampleCard} from '../../server/customer-samples/cardLibrary';
/** Mutates only the isolated release-check database restored from the current backup. */
export async function rehearsePatternDeletion(pool:any):Promise<string[]>{
 const [identity]:any=await pool.query('SELECT DATABASE() AS name');
 assert.match(identity[0].name,/^fabric_release_check_[a-f0-9]{16}$/);
 const suffix=randomBytes(7).toString('hex').toUpperCase(),name='PATDEL'+suffix;
 const [u]:any=await pool.query('INSERT INTO v2_access_users(username,username_normalized,display_name,password_hash,role) VALUES (?,?,?,?,?)',[name,name.toLowerCase(),name,'isolated-fixture-unusable','admin']);
 const [s]:any=await pool.query('INSERT INTO v2_access_sessions(user_id,token_hash,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))',[u.insertId,randomBytes(32).toString('hex')]);
 const actor:any={userId:String(u.insertId),sessionId:String(s.insertId),username:name,displayName:name,role:'admin',canManageProducts:true,canManageOwnOrders:true};
 const m=await createPatternMaster(pool,actor,{masterNo:'G'+suffix});
 const fabric=await createFabric(pool,actor,{fabricNo:'F'+suffix,fabricName:'花型删除演练'});
 const card=(await createSampleCard(pool,actor,{masterId:m.id,fabricId:fabric.id},()=>true)).card;
 await assert.rejects(deletePatternMaster(pool,actor,m.id),(e:any)=>e.status===409);
 await retireSampleCard(pool,actor,card.id,()=>true);
 const [c]:any=await pool.query('INSERT INTO pattern_colorways(master_id,colorway_no) VALUES (?,1)',[m.id]);
 await pool.query('INSERT INTO pattern_colorways(master_id,colorway_no) VALUES (?,2)',[m.id]);
 await pool.query('UPDATE pattern_masters SET next_colorway_no=3 WHERE id=?',[m.id]);
 const [p]:any=await pool.query('INSERT INTO v2_products(pattern_colorway_id,fabric_id,product_no) VALUES (?,?,?)',[c.insertId,fabric.id,'G'+suffix+'-1-F'+suffix]);
 await assert.rejects(deletePatternMaster(pool,actor,m.id),(e:any)=>e.status===409);
 await pool.query('DELETE FROM v2_products WHERE id=?',[p.insertId]);
 assert.deepEqual(await deletePatternMaster(pool,actor,m.id),{id:m.id,deleted:true});
 const [kept]:any=await pool.query('SELECT m.deleted_at,m.next_colorway_no,c.deleted_at AS card_deleted,t.revoked_at FROM pattern_masters m JOIN sample_cards c ON c.master_id=m.id JOIN sample_card_tokens t ON t.card_id=c.id WHERE m.id=?',[m.id]);
 assert.equal(kept.length,1);assert(kept[0].deleted_at);assert(kept[0].card_deleted);assert(kept[0].revoked_at);assert.equal(String(kept[0].next_colorway_no),'3');
 const [versions]:any=await pool.query('SELECT id FROM pattern_colorways WHERE master_id=?',[m.id]);assert.equal(versions.length,0);
 assert(!(await listPatternMasters(pool,{includeInactive:true})).some(x=>x.id===m.id));
 await assert.rejects(updatePatternMaster(pool,actor,m.id,{isActive:true}),(e:any)=>e.status===404);
 const checks=['current card and product references prevent pattern deletion','retired cards no longer block two-colorway deletion','historical master/card/QR identities and sequence retained','deleted patterns absent from inactive lists and cannot reactivate'];
 const [original]:any=await pool.query("SELECT m.id,(SELECT COUNT(*) FROM v2_products p JOIN pattern_colorways v ON v.id=p.pattern_colorway_id WHERE v.master_id=m.id) products,(SELECT COUNT(*) FROM sample_cards c WHERE c.master_id=m.id AND c.deleted_at IS NULL) current_cards,(SELECT COUNT(*) FROM sample_cards c WHERE c.master_id=m.id) history_cards FROM pattern_masters m WHERE m.master_no='G0008' AND m.deleted_at IS NULL");
 if(original.length===1&&Number(original[0].products)===0&&Number(original[0].current_cards)===0){
  const row=original[0];await deletePatternMaster(pool,actor,String(row.id));
  const [history]:any=await pool.query('SELECT COUNT(*) AS total FROM sample_cards WHERE master_id=?',[row.id]);assert.equal(Number(history[0].total),Number(row.history_cards));
  checks.push('restored actual G0008 deletion succeeds, retains '+row.history_cards+' historical cards');
 }
 return checks;
}
