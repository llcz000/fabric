/** B1 stable pattern share mapping, SQL proposal ONLY. Never run or mount
 * against any database from this file. Requires DBA review + backup/rollback.
 * Token hashes are ASCII hex, not raw binary or legacy sample-card hashes.
 */
export interface PatternLinkTablePlan {readonly name:string;readonly sql:string}
const schema:PatternLinkTablePlan=Object.freeze({
 name:'pattern_share_links',
 sql:[
 'CREATE TABLE pattern_share_links (',
 ' id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,',
 ' master_id BIGINT UNSIGNED NOT NULL,',
 ' token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,',
 " status ENUM('active','inactive','revoked') NOT NULL DEFAULT 'active',",
 ' revoked_at DATETIME NULL,',
 ' created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,',
 ' UNIQUE KEY uq_pattern_share_token (token_hash),',
 ' UNIQUE KEY uq_pattern_share_master (master_id),',
 ' CONSTRAINT fk_pattern_share_master FOREIGN KEY (master_id) REFERENCES pattern_masters(id) ON DELETE RESTRICT',
 ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
 ].join('\n')
});
export const getPatternLinkSchemaStatements=():readonly PatternLinkTablePlan[]=>[schema];
