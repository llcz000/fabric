import assert from 'node:assert/strict';
import test from 'node:test';
import {getPatternLinkSchemaStatements} from './patternLinkSchema';

test('B1 schema proposal creates one additive InnoDB mapping with strong exact token/master uniqueness',()=>{
 const list=getPatternLinkSchemaStatements();
 assert.equal(list.length,1);
 const [{name,sql}]=list;
 assert.equal(name,'pattern_share_links');
 assert.match(sql,/^CREATE TABLE pattern_share_links \(/);
 assert.match(sql,/ENGINE=InnoDB\s+DEFAULT CHARSET=utf8mb4$/);
 assert.match(sql,/id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY/);
 assert.match(sql,/token_hash CHAR\(64\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL/);
 assert.match(sql,/master_id BIGINT UNSIGNED NOT NULL/);
 assert.match(sql,/UNIQUE KEY uq_pattern_share_token \(token_hash\)/);
 assert.match(sql,/UNIQUE KEY uq_pattern_share_master \(master_id\)/);
 assert.match(sql,/CONSTRAINT fk_pattern_share_master FOREIGN KEY \(master_id\) REFERENCES pattern_masters\(id\) ON DELETE RESTRICT/);
 assert.match(sql,/status ENUM\('active','inactive','revoked'\) NOT NULL DEFAULT 'active'/);
 assert.match(sql,/revoked_at DATETIME NULL/);
 assert.match(sql,/created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP/);
 assert.doesNotMatch(sql, /(?:^|\\n)\\s*(?:DROP|TRUNCATE|ALTER|INSERT|UPDATE|REPLACE|CREATE DATABASE|GRANT|TRIGGER|FOREIGN_KEY_CHECKS)\\b/i);
});
test('B1 proposed DDL is a frozen plan only, never executed or attached to production migration',()=>{
 const plan=getPatternLinkSchemaStatements();
 assert.notStrictEqual(plan,getPatternLinkSchemaStatements());
 assert(Object.isFrozen(plan[0]));
 assert.deepEqual(plan,getPatternLinkSchemaStatements());
});
