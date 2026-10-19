import assert from 'node:assert/strict';
import test from 'node:test';
import { getAccessSchemaCreateStatements,initializeAccessSchema } from './schema';
class Recorder {
  statements:string[]=[];
  async query(sql:string):Promise<[unknown,unknown]> {
    this.statements.push(sql.trim());
    return [{affectedRows:0},[]];
  }
  get text(){return this.statements.join('\n');}
}
test('P2 persistent users and sessions isolate from legacy tables/old orders',async()=>{
 const c=new Recorder();
 await initializeAccessSchema(c);
 assert.equal(getAccessSchemaCreateStatements().length,2);
 assert.match(c.text,/CREATE TABLE IF NOT EXISTS v2_access_users\s*\(/i);
 assert.match(c.text,/CREATE TABLE IF NOT EXISTS v2_access_sessions\s*\(/i);
 assert.match(c.text,/UNIQUE KEY uq_v2_username_normalized\s*\(username_normalized\)/i);
 assert.match(c.text,/UNIQUE KEY uq_v2_session_token_hash\s*\(token_hash\)/i);
 assert.match(c.text,/FOREIGN KEY \(user_id\) REFERENCES v2_access_users\(id\) ON DELETE RESTRICT/i);
 assert.match(c.text,/role ENUM\('admin', 'sales'\) NOT NULL/i);
 assert.match(c.text,/can_manage_own_orders TINYINT\(1\) NOT NULL DEFAULT 0/i);
 assert.match(c.text,/can_manage_products TINYINT\(1\) NOT NULL DEFAULT 0/i);
 assert.match(c.text,/password_hash VARCHAR\(255\) NOT NULL/i);
 assert.match(c.text,/token_hash CHAR\(64\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL/i);
 assert.doesNotMatch(c.text,/^\s*(?:ALTER|DELETE|UPDATE|DROP|TRUNCATE)\s+|CREATE TABLE IF NOT EXISTS orders\b/im);
});
test('P2 repeat bootstrap only replays additive create statements',async()=>{
 const c=new Recorder();
 await initializeAccessSchema(c); await initializeAccessSchema(c);
 assert.equal((c.text.match(/CREATE TABLE IF NOT EXISTS/g)||[]).length,4);
 assert.doesNotMatch(c.text,/password='|ADMIN_PASSWORD|INSERT INTO|UPDATE orders/i);
});
