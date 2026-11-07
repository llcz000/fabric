import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {createHash} from 'node:crypto';import ExcelJS from 'exceljs';
import {reviewSessionCards,confirmSessionCards,currentSampleCardCountSql} from './sessionCardReview';import {exportSessionCards} from './sessionCardExport';
const actor={userId:'1',sessionId:'1',role:'sales' as const,username:'test',displayName:'Test',canManageOwnOrders:true,canManageProducts:true};
function fixture(){
 const db=new DatabaseSync(':memory:');db.function('UNIX_TIMESTAMP',value=>Date.parse(String(value))/1000);
 db.exec(`CREATE TABLE customer_sample_sessions(id INTEGER PRIMARY KEY,card_review TEXT,deleted_at TEXT,customer_reference TEXT,created_at TEXT);
 CREATE TABLE customer_sample_items(id INTEGER PRIMARY KEY,session_id INTEGER,product_id INTEGER,removed_at TEXT);
 CREATE TABLE v2_products(id INTEGER PRIMARY KEY,product_no TEXT,row_version INTEGER,pattern_colorway_id INTEGER,fabric_id INTEGER);
 CREATE TABLE pattern_colorways(id INTEGER PRIMARY KEY,master_id INTEGER);
 CREATE TABLE pattern_masters(id INTEGER PRIMARY KEY,master_no TEXT);
 CREATE TABLE v2_fabrics(id INTEGER PRIMARY KEY,fabric_no TEXT,fabric_name TEXT,composition TEXT,weight_value REAL,weight_unit TEXT,width_value REAL);
 CREATE TABLE sample_cards(id INTEGER PRIMARY KEY,master_id INTEGER,fabric_id INTEGER,card_no TEXT,qr_payload TEXT,is_active INTEGER,deleted_at TEXT,reprint_revision INTEGER,printed_revision INTEGER);
 CREATE TABLE sample_card_tokens(card_id INTEGER,token_hash TEXT,revoked_at TEXT);
 CREATE TABLE customer_sample_item_sources(session_id INTEGER,product_id INTEGER,card_id INTEGER);
 CREATE TABLE customer_sample_manual_events(id INTEGER PRIMARY KEY,session_id INTEGER,product_id INTEGER,actor_user_id INTEGER,action TEXT,card_id INTEGER);
 CREATE TABLE customer_sample_selected_cards(id INTEGER PRIMARY KEY,session_id INTEGER,card_id INTEGER,UNIQUE(session_id,card_id));
 INSERT INTO customer_sample_sessions VALUES(1,NULL,NULL,'Test','2026-11-06T16:00:00Z');INSERT INTO pattern_masters VALUES(1,'G0234');INSERT INTO pattern_colorways VALUES(1,1);
 INSERT INTO v2_fabrics VALUES(1,'F002','真丝','100%S',10,'mm',137);
 INSERT INTO v2_products VALUES(1,'G0234-1-F002',1,1,1),(2,'G0234-2-F002',1,1,1),(3,'unselected',1,1,1);
 INSERT INTO customer_sample_items VALUES(11,1,1,NULL),(12,1,2,NULL);
 INSERT INTO sample_cards VALUES(20,1,2,'G0234-F001','old_token_12345678901234567',0,'2026-01-01',0,0),(21,1,1,'G0234-F002','new_token_12345678901234567',1,NULL,0,0);
 INSERT INTO customer_sample_item_sources VALUES(1,1,20),(1,2,20);INSERT INTO customer_sample_selected_cards(session_id,card_id) VALUES(1,20);`);
 db.prepare('INSERT INTO sample_card_tokens VALUES(21,?,NULL)').run(createHash('sha256').update('new_token_12345678901234567').digest('hex'));
 let deny=false,failWrite=false;
 const tx={beginTransaction:async()=>{db.exec('BEGIN');},commit:async()=>{db.exec('COMMIT');},rollback:async()=>{db.exec('ROLLBACK');},release(){},query:async(sql:string,args:unknown[]=[]):Promise<[unknown,unknown]>=>{
 if(sql.includes('FROM v2_access_users'))return [[{role:'sales',is_active:1}],[]];if(sql.includes('FROM v2_access_sessions'))return [[{id:'1'}],[]];
 if(sql.includes('FROM customer_sample_session_access'))return [deny?[]:[{can_manage:1}],[]];
 if(failWrite&&sql.startsWith('UPDATE customer_sample_sessions'))throw Error('write unavailable');
 const clean=sql.replace(/FOR (?:SHARE|UPDATE)/g,'').replace('ON DUPLICATE KEY UPDATE id=id','ON CONFLICT(session_id,card_id) DO NOTHING');
 if(/^SELECT/i.test(clean.trim()))return [db.prepare(clean).all(...args as any[]),[]];
 const result=db.prepare(clean).run(...args as any[]);return [{affectedRows:result.changes,insertId:result.lastInsertRowid},[]];
 }};
 return {db,pool:{getConnection:async()=>tx},deny:()=>{deny=true;},failWrite:(v:boolean)=>{failWrite=v;}};
}
test('confirmation and export preserve original provenance and selected subset, and use the selection template',async()=>{
 const f=fixture();try{const before=await reviewSessionCards(f.pool,actor,'1');assert.equal(before.issues.length,2);
 await assert.rejects(exportSessionCards(f.pool,actor,'1'),e=>(e as any).status===409);
 const partial=await confirmSessionCards(f.pool,actor,'1',{snapshot:before.snapshot,itemIds:['11']});assert.equal(partial.issues.length,1);
 const result=await confirmSessionCards(f.pool,actor,'1',{snapshot:partial.snapshot,itemIds:['12']});assert.equal(result.issues.length,0);
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM customer_sample_items WHERE removed_at IS NULL').get()!.n,2);
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM customer_sample_item_sources WHERE card_id=20').get()!.n,2);
 const bytes=await exportSessionCards(f.pool,actor,'1');const wb=new ExcelJS.Workbook();await wb.xlsx.load(bytes as any);assert.equal(wb.worksheets.length,1);assert.equal(wb.worksheets[0].rowCount,2);assert.equal(wb.worksheets[0].columnCount,10);assert.equal(wb.worksheets[0].getCell('A2').value,'G0234-F002');assert.equal(wb.worksheets[0].getCell('J2').value,'2026-11-07');
 }finally{f.db.close();}
});
test('stale review, foreign IDs, blocked card and revoked access cannot update or silently export',async()=>{
 const f=fixture();try{const first=await reviewSessionCards(f.pool,actor,'1');f.db.exec('UPDATE v2_products SET row_version=2 WHERE id=1');
 await assert.rejects(confirmSessionCards(f.pool,actor,'1',{snapshot:first.snapshot,itemIds:['11']}),e=>(e as any).status===409);
 const next=await reviewSessionCards(f.pool,actor,'1');await assert.rejects(confirmSessionCards(f.pool,actor,'1',{snapshot:next.snapshot,itemIds:['99']}),e=>(e as any).status===409);
 f.db.exec('UPDATE sample_cards SET is_active=0 WHERE id=21');const blocked=await reviewSessionCards(f.pool,actor,'1');assert(blocked.issues.every(i=>!i.canUpdate));
 await assert.rejects(confirmSessionCards(f.pool,actor,'1',{snapshot:blocked.snapshot,itemIds:['11']}),e=>(e as any).status===409);f.deny();await assert.rejects(reviewSessionCards(f.pool,actor,'1'),e=>(e as any).status===404);
 assert.equal(f.db.prepare('SELECT card_review FROM customer_sample_sessions').get()!.card_review,null);
 }finally{f.db.close();}
});
test('failed confirmation rolls back all new provenance and saved confirmations',async()=>{
 const f=fixture();try{const first=await reviewSessionCards(f.pool,actor,'1');f.failWrite(true);await assert.rejects(confirmSessionCards(f.pool,actor,'1',{snapshot:first.snapshot,itemIds:['11','12']}),/unavailable/);
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM customer_sample_manual_events').get()!.n,0);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM customer_sample_selected_cards').get()!.n,1);
 }finally{f.db.close();}
});

test('current card count ignores old source cards without changing the selected product count',()=>{const f=fixture();try{const row=f.db.prepare('SELECT '+currentSampleCardCountSql('s.id')+' AS count FROM customer_sample_sessions s WHERE s.id=1').get()!;assert.equal(row.count,1);}finally{f.db.close();}});

test('private review HTTP routes enforce authentication, snapshot checks and structured conflict responses',async()=>{
 const f=fixture(),express=(await import('express')).default,{createSampleSessionDirectoryRouter}=await import('./sessionDirectoryRoutes'),app=express();
 app.use('/api/v2/customer-samples',createSampleSessionDirectoryRouter((req,res,next)=>{if(req.headers.authorization!=='test'){res.sendStatus(401);return;}res.locals.principal=actor;next();},f.pool,''));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const address=server.address() as {port:number},url='http://127.0.0.1:'+address.port+'/api/v2/customer-samples/sessions/1/cards/review';
 try{assert.equal((await fetch(url)).status,401);const response=await fetch(url,{headers:{authorization:'test'}});assert.equal(response.status,200);const plan=await response.json();assert.equal(plan.canUpdate,true);
 const stale=await fetch(url,{method:'POST',headers:{authorization:'test','content-type':'application/json'},body:JSON.stringify({snapshot:'0'.repeat(64),itemIds:['11']})});assert.equal(stale.status,409);assert.equal((await stale.json()).error,'CARD_REVIEW_REQUIRED');
 const updated=await fetch(url,{method:'POST',headers:{authorization:'test','content-type':'application/json'},body:JSON.stringify({snapshot:plan.snapshot,itemIds:['11','12']})});assert.equal(updated.status,200);assert.equal((await updated.json()).issues.length,0);
 f.deny();assert.equal((await fetch(url,{headers:{authorization:'test'}})).status,404);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));f.db.close();}
});
