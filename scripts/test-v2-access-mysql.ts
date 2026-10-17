/**
 * P2-1 ONLY: remote MySQL 8.0 isolated users/sessions schema + transaction test.
 * Run through SSH on authorized test host with:
 *   FABRIC_V2_ISOLATED_TEST=I_ACKNOWLEDGE_SANDBOX node -
 * Fixed DB only, never access fabric_db, never change server.ts/current login.
 */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {hashPassword,createSessionToken,hashSessionToken} from '../server/access/password';
import {getAccessSchemaCreateStatements} from '../server/access/schema';

const DATABASE='fabric_v2_test_20261012_p2';
if(process.env.FABRIC_V2_ISOLATED_TEST!=='I_ACKNOWLEDGE_SANDBOX')
  throw Error('Explicit P2 isolated test acknowledgement required');

function execute(query:string,db:string|null=DATABASE,expectFailure=false):string{
  if(db!==null && db!==DATABASE || /\bfabric_db\b/i.test(query))throw Error('Production database SQL denied');
  if(/^\s*(DROP|TRUNCATE|DELETE|ALTER)\s+/im.test(query))throw Error('Destructive SQL denied');
  if(db===null && !/^\s*(?:SELECT\s+SCHEMA_NAME|CREATE\s+DATABASE\s+IF\s+NOT\s+EXISTS)/i.test(query))
    throw Error('Unscoped SQL denied');
  const args=['--batch','--skip-column-names','--raw','--default-character-set=utf8mb4'];
  if(db)args.push('--database='+db);
  args.push('-e',query);
  const response=spawnSync('mysql',args,{encoding:'utf8',timeout:20000});
  if(expectFailure){assert.notEqual(response.status,0,'Expected CHECK/UNIQUE to reject invalid fixture');return '';}
  if(response.status!==0)throw Error('Isolated P2 MySQL query failed: '+(response.stderr??response.error?.message??'').slice(0,380));
  return (response.stdout??'').trim();
}
const statements=getAccessSchemaCreateStatements();
const names=['v2_access_users','v2_access_sessions'];
async function main(){
 const existing=execute(`SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME='${DATABASE}'`,null);
 if(existing){
   const tables=execute(`SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA='${DATABASE}'`,DATABASE)
    .split(/\r?\n/).filter(Boolean);
   for(const name of tables)assert(names.includes(name),'Unexpected table in P2 sandbox: '+name);
 }
 execute(`CREATE DATABASE IF NOT EXISTS ${DATABASE} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,null);
 for(const ddl of statements)execute(ddl);
 for(const ddl of statements)execute(ddl);
 const tables=execute('SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE()')
  .split(/\r?\n/).filter(Boolean);
 assert.deepEqual(tables.sort(),[...names].sort());
 for(const table of names)assert.equal(execute('SELECT COUNT(*) FROM '+table),'0');
 const checks=execute("SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='v2_access_users' AND CONSTRAINT_TYPE='CHECK'");
 for(const constraint of ['ck_v2_user_active','ck_v2_user_order_grant','ck_v2_user_product_grant'])
   assert(checks.includes(constraint),constraint);
 const fk=execute("SELECT REFERENCED_TABLE_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='v2_access_sessions' AND REFERENCED_TABLE_NAME IS NOT NULL");
 assert.equal(fk,'v2_access_users');
 const passwordHash=await hashPassword('p2-fixture-not-real-2026');
 const tokenHash=hashSessionToken(createSessionToken());
 // A single InnoDB transaction, all fixture users/sessions always ROLLBACK.
 const output=execute(`START TRANSACTION;
   INSERT INTO v2_access_users(username,username_normalized,display_name,password_hash,role,can_manage_own_orders,can_manage_products)
      VALUES ('test-sales','test-sales','test only','${passwordHash}','sales',1,0);
   SET @uid=LAST_INSERT_ID();
   INSERT INTO v2_access_sessions(user_id,token_hash,expires_at)
      VALUES (@uid,'${tokenHash}',DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR));
   SELECT 'before',u.can_manage_own_orders,u.can_manage_products,
      COUNT(*) FROM v2_access_sessions s JOIN v2_access_users u ON u.id=s.user_id
      WHERE s.token_hash='${tokenHash}' AND u.is_active=1 AND s.revoked_at IS NULL AND s.expires_at > UTC_TIMESTAMP();
   UPDATE v2_access_users SET can_manage_own_orders=0, can_manage_products=1 WHERE id=@uid;
   SELECT 'revoked_order_grant',u.can_manage_own_orders,u.can_manage_products FROM v2_access_users u WHERE id=@uid;
   UPDATE v2_access_users SET is_active=0 WHERE id=@uid;
   SELECT 'disabled_sessions',COUNT(*) FROM v2_access_sessions s JOIN v2_access_users u ON u.id=s.user_id
      WHERE s.token_hash='${tokenHash}' AND u.is_active=1;
   ROLLBACK;
   SELECT 'after_rollback',COUNT(*) FROM v2_access_users;`);
 assert.match(output,/before\s+1\s+0\s+1/);
 assert.match(output,/revoked_order_grant\s+0\s+1/);
 assert.match(output,/disabled_sessions\s+0/);
 assert.match(output,/after_rollback\s+0/);
 for(const table of names)assert.equal(execute('SELECT COUNT(*) FROM '+table),'0',table);
 execute(`START TRANSACTION;
   INSERT INTO v2_access_users(username,username_normalized,display_name,password_hash,role)
    VALUES ('TEST','test','test','${passwordHash}','admin');
   INSERT INTO v2_access_users(username,username_normalized,display_name,password_hash,role)
    VALUES ('Test','test','duplicate','${passwordHash}','sales');
   ROLLBACK;`,DATABASE,true);
 for(const table of names)assert.equal(execute('SELECT COUNT(*) FROM '+table),'0',table);
 console.log('PASS P2 MySQL 8.0.46 isolated 2-table schema, repeated init, FK/CHECK/UNIQUE, live grant revoke, account disable, rollback; no user rows');
 console.log('P2_ACCESS_SCHEMA_ISOLATED_PASS database='+DATABASE);
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
