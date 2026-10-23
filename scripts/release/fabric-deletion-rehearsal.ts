import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createFabric,deleteFabric,getFabric,listFabrics,updateFabric} from '../../server/product-master/fabrics';
import {createSampleCard,resolveSampleCardToken} from '../../server/customer-samples/cardLibrary';
/** Only the release operator's freshly restored, isolated rehearsal database. */
export async function rehearseFabricDeletion(pool:any):Promise<string[]>{
 const [identity]:any=await pool.query('SELECT DATABASE() AS name');
 assert.match(identity[0].name,/^fabric_release_check_[a-f0-9]{16}$/);
 const suffix=randomBytes(7).toString('hex').toUpperCase(),name='DELETE'+suffix;
 const [u]:any=await pool.query('INSERT INTO v2_access_users(username,username_normalized,display_name,password_hash,role) VALUES (?,?,?,?,?)',[name,name.toLowerCase(),name,'isolated-fixture-unusable','admin']);
 const [s]:any=await pool.query('INSERT INTO v2_access_sessions(user_id,token_hash,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))',[u.insertId,randomBytes(32).toString('hex')]);
 const actor:any={userId:String(u.insertId),sessionId:String(s.insertId),username:name,displayName:name,role:'admin',canManageProducts:true,canManageOwnOrders:true};
 const f=await createFabric(pool,actor,{fabricNo:'F'+suffix,fabricName:'删除演练'});
 const [m]:any=await pool.query('INSERT INTO pattern_masters(master_no) VALUES (?)',['G'+suffix]);
 const card=(await createSampleCard(pool,actor,{masterId:String(m.insertId),fabricId:f.id},()=>true)).card;
 const [session]:any=await pool.query("INSERT INTO customer_sample_sessions(customer_reference,created_by_user_id,status) VALUES (?,?,'open')",['删除历史演练',actor.userId]);
 await pool.query('INSERT INTO customer_sample_selected_cards(session_id,card_id) VALUES (?,?)',[session.insertId,card.id]);
 const [c]:any=await pool.query('INSERT INTO pattern_colorways(master_id,colorway_no) VALUES (?,1)',[m.insertId]);
 const [p]:any=await pool.query('INSERT INTO v2_products(pattern_colorway_id,fabric_id,product_no) VALUES (?,?,?)',[c.insertId,f.id,'G'+suffix+'-1-F'+suffix]);
 await assert.rejects(deleteFabric(pool,actor,f.id),(e:any)=>e.status===409);
 assert.equal((await getFabric(pool,f.id)).isActive,true);
 await pool.query('DELETE FROM v2_products WHERE id=?',[p.insertId]);
 assert.deepEqual(await deleteFabric(pool,actor,f.id),{id:f.id,deleted:true});
 await assert.rejects(getFabric(pool,f.id),(e:any)=>e.status===404);
 await assert.rejects(updateFabric(pool,actor,f.id,{isActive:true}),(e:any)=>e.status===404);
 assert.deepEqual(await listFabrics(pool,{fabricNo:f.fabricNo,includeInactive:true}),[]);
 await assert.rejects(resolveSampleCardToken(pool,card.qrPayload),(e:any)=>e.status===404);
 const [kept]:any=await pool.query('SELECT f.deleted_at,c.deleted_at AS card_deleted,t.revoked_at,h.card_id FROM v2_fabrics f JOIN sample_cards c ON c.fabric_id=f.id JOIN sample_card_tokens t ON t.card_id=c.id JOIN customer_sample_selected_cards h ON h.card_id=c.id WHERE f.id=?',[f.id]);
 assert.equal(kept.length,1);assert(kept[0].deleted_at);assert(kept[0].card_deleted);assert(kept[0].revoked_at);assert.equal(String(kept[0].card_id),card.id);
 const plain=await createFabric(pool,actor,{fabricNo:'N'+suffix,fabricName:'无引用演练'});
 await deleteFabric(pool,actor,plain.id);
 const [gone]:any=await pool.query('SELECT id FROM v2_fabrics WHERE id=?',[plain.id]);assert.equal(gone.length,0);
 return ['real MySQL product reference prevents deletion','zero products delete with card/QR retirement','deleted fabric absent from inactive lists and cannot reactivate','selected-card history and all foreign keys retained','unreferenced fabric physically deleted'];
}
