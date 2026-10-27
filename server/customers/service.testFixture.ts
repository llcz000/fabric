import {DatabaseSync} from 'node:sqlite';import {CustomerService} from './service';import {profile} from './customer.testFixture';
const shared={username:'test',displayName:'测试账号',canManageOwnOrders:true,canManageProducts:true};
const admin={...shared,userId:'1',sessionId:'11',role:'admin'} as const,sales={...shared,userId:'2',sessionId:'12',role:'sales'} as const,outsider={...shared,userId:'3',sessionId:'13',role:'sales'} as const;
const key=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture(){
 const db=new DatabaseSync(':memory:');db.exec(`CREATE TABLE business_delete_events(id INTEGER PRIMARY KEY AUTOINCREMENT,entity_type TEXT,entity_id TEXT,entity_label TEXT,actor_user_id TEXT,deleted_at TEXT DEFAULT CURRENT_TIMESTAMP);CREATE TABLE v2_access_users(id INTEGER PRIMARY KEY,role TEXT,is_active INTEGER);INSERT INTO v2_access_users VALUES(1,'admin',1),(2,'sales',1),(3,'sales',1);
 CREATE TABLE v2_access_sessions(id INTEGER PRIMARY KEY,user_id INTEGER,revoked_at TEXT,expires_at TEXT);INSERT INTO v2_access_sessions VALUES(11,1,NULL,'2099'),(12,2,NULL,'2099'),(13,3,NULL,'2099');
 CREATE TABLE customers(id INTEGER PRIMARY KEY AUTOINCREMENT,display_name TEXT,profile_json TEXT,search_text TEXT,owner_user_id INTEGER,created_by_user_id INTEGER,sales_channel TEXT,tier TEXT,relationship_stage TEXT,archived_at TEXT,row_version INTEGER DEFAULT 1,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE customer_access(customer_id INTEGER,user_id INTEGER,permission TEXT,granted_by INTEGER,UNIQUE(customer_id,user_id));
 CREATE TABLE customer_profile_events(id INTEGER PRIMARY KEY AUTOINCREMENT,customer_id INTEGER,actor_user_id INTEGER,event_type TEXT,detail_json TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE customer_sample_sessions(id INTEGER PRIMARY KEY AUTOINCREMENT,customer_reference TEXT,created_by_user_id INTEGER,status TEXT DEFAULT 'open',deleted_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE customer_sample_session_access(id INTEGER PRIMARY KEY AUTOINCREMENT,session_id INTEGER,user_id INTEGER,can_manage INTEGER);
 CREATE TABLE customer_sample_selected_cards(session_id INTEGER,card_id INTEGER,PRIMARY KEY(session_id,card_id));
 CREATE TABLE customer_sample_items(session_id INTEGER,product_id INTEGER,removed_at TEXT);
 CREATE TABLE customer_sample_item_sources(session_id INTEGER,product_id INTEGER,card_id INTEGER);
 CREATE TABLE customer_sample_manual_events(session_id INTEGER,product_id INTEGER,card_id INTEGER);
 CREATE TABLE customer_session_links(session_id INTEGER PRIMARY KEY,customer_id INTEGER,row_version INTEGER DEFAULT 1,linked_by_user_id INTEGER);
 CREATE TABLE customer_requests(actor_user_id INTEGER,request_id TEXT,payload_hash TEXT,result_json TEXT,PRIMARY KEY(actor_user_id,request_id));
 CREATE TABLE customer_followups(id INTEGER PRIMARY KEY AUTOINCREMENT,customer_id INTEGER,actor_user_id INTEGER,session_id INTEGER,contacted_on TEXT,feedback TEXT,outcome TEXT);
 CREATE TABLE customer_followup_tasks(id INTEGER PRIMARY KEY AUTOINCREMENT,customer_id INTEGER,assignee_user_id INTEGER,source_followup_id INTEGER,due_on TEXT,next_action TEXT,status TEXT DEFAULT 'open',row_version INTEGER DEFAULT 1);
 CREATE TABLE orders(id INTEGER PRIMARY KEY,template_type TEXT,order_date TEXT,order_no TEXT,receiving_unit TEXT,total_amount DECIMAL,created_by_user_id INTEGER);CREATE TABLE customer_order_links(order_id INTEGER PRIMARY KEY,customer_id INTEGER,row_version INTEGER DEFAULT 1,linked_by_user_id INTEGER); CREATE TABLE sample_shipments(id INTEGER PRIMARY KEY,session_id INTEGER,shipped_at TEXT);CREATE TABLE sample_followups(id INTEGER PRIMARY KEY,session_id INTEGER,contacted_on TEXT,outcome TEXT);`);
 db.function('UNIX_TIMESTAMP',(value:any)=>Date.parse(String(value).replace(' ','T')+'Z')/1000);
 db.function('JSON_UNQUOTE',(v:any)=>v);db.function('CONVERT_TZ',(v:any,_from:any,_to:any)=>new Date(Date.parse(String(v).replace(' ','T')+'Z')+8*3600000).toISOString().slice(0,19).replace('T',' '));db.function('UTC_TIMESTAMP',()=> '2026-10-20 08:00:00');db.function('DATE_FORMAT',(value:any,_format:any)=>value===null?null:String(value).slice(0,10));
 const calls:string[]=[],locks:string[]=[];let failSession=false;
 const connection={customerProfilesEnabled:true,beginTransaction:async()=>{db.exec('BEGIN');},commit:async()=>{db.exec('COMMIT');},rollback:async()=>{db.exec('ROLLBACK');},release(){},query:async(sql:string,args:unknown[]=[]):Promise<[unknown,unknown]>=>{
  calls.push(sql);if(sql.startsWith('SELECT * FROM customers WHERE'))locks.push(String(args[0]));if(failSession&&sql.startsWith('INSERT INTO customer_sample_sessions'))throw Error('insert failed');
  const q=sql.replace(/ FOR (?:SHARE|UPDATE)/g,'').replace(/INSERT IGNORE INTO/g,'INSERT OR IGNORE INTO').replace(/ ON DUPLICATE KEY UPDATE .*$/s,' ON CONFLICT DO NOTHING');const stmt=db.prepare(q);
  if(/^SELECT/i.test(q.trim()))return [stmt.all(...args as any[]),[]];const r=stmt.run(...args as any[]);return [{affectedRows:Number(r.changes),insertId:String(r.lastInsertRowid)},[]];
 }};const pool={customerProfilesEnabled:true,getConnection:async()=>connection};return {db,pool,calls,locks,service:new CustomerService(pool,()=>new Date('2026-10-20T08:00:00Z')),failSession(){failSession=true;}};
}
export {fixture,sales,admin,outsider,key};
