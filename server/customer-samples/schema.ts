/**
 * B2-3 single-master sample-domain schema. Fresh target only; legacy migration is a separate gate. Not wired to app startup. Only an
 * explicitly acknowledged isolated test database may initialize this schema.
 * Table names intentionally avoid orders and the old product catalog.
 */
export interface SampleSchemaDb {
 getConnection():Promise<{
  query(sql:string,params?:unknown[]):Promise<[unknown,unknown]>;
  release():void;
 }>;
}
export interface SampleTable {name:string;sql:string}
const list:readonly SampleTable[]=[
 {name:'sample_cards',sql:`CREATE TABLE sample_cards (
   id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
   master_id BIGINT UNSIGNED NOT NULL,
   fabric_id BIGINT UNSIGNED NOT NULL,
   card_no VARCHAR(129) NOT NULL,
   qr_payload VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
   is_active TINYINT(1) NOT NULL DEFAULT 1,
   deleted_at DATETIME NULL,
   reprint_revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
   printed_revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
   active_master_id BIGINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN deleted_at IS NULL THEN master_id ELSE NULL END) STORED,
   active_fabric_id BIGINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN deleted_at IS NULL THEN fabric_id ELSE NULL END) STORED,
   active_card_no VARCHAR(129) GENERATED ALWAYS AS (CASE WHEN deleted_at IS NULL THEN card_no ELSE NULL END) STORED,
   created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
   UNIQUE KEY uq_sample_card_combo (active_master_id,active_fabric_id),
   UNIQUE KEY uq_sample_card_no (active_card_no),
   UNIQUE KEY uq_sample_card_payload (qr_payload),
   KEY idx_sample_card_fabric (fabric_id),
   CONSTRAINT fk_sample_card_master FOREIGN KEY (master_id) REFERENCES pattern_masters(id) ON DELETE RESTRICT,
   CONSTRAINT fk_sample_card_fabric FOREIGN KEY (fabric_id) REFERENCES v2_fabrics(id) ON DELETE RESTRICT,
   CONSTRAINT ck_sample_card_reprint_revision CHECK (printed_revision <= reprint_revision),
   CONSTRAINT ck_sample_card_active CHECK (is_active IN (0,1)),
   CONSTRAINT ck_sample_card_payload CHECK (qr_payload REGEXP '^[A-Za-z0-9_-]{22,128}$')
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`},
 {name:'sample_card_tokens',sql:`CREATE TABLE sample_card_tokens (
   id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
   card_id BIGINT UNSIGNED NOT NULL,
   token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
   revoked_at DATETIME NULL,
   created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
   UNIQUE KEY uq_sample_token_hash (token_hash),
   UNIQUE KEY uq_sample_token_card(card_id),
   CONSTRAINT fk_sample_token_card FOREIGN KEY (card_id) REFERENCES sample_cards(id) ON DELETE RESTRICT,
   CONSTRAINT ck_sample_token_hash CHECK (token_hash REGEXP '^[0-9a-f]{64}$')
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`},
 {name:'customer_sample_sessions',sql:`CREATE TABLE customer_sample_sessions (
   id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
   customer_reference VARCHAR(160) NOT NULL,
   created_by_user_id BIGINT UNSIGNED NOT NULL,
   status ENUM('open','closed') NOT NULL DEFAULT 'open',
   created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
   KEY idx_sample_session_recent(created_at,id),
   CONSTRAINT fk_sample_session_creator FOREIGN KEY (created_by_user_id) REFERENCES v2_access_users(id) ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`},
 {name:'customer_sample_session_access',sql:`CREATE TABLE customer_sample_session_access (
   id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
   session_id BIGINT UNSIGNED NOT NULL,
   user_id BIGINT UNSIGNED NOT NULL,
   can_manage TINYINT(1) NOT NULL DEFAULT 0,
   granted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
   UNIQUE KEY uq_sample_session_access(session_id,user_id),
   KEY idx_sample_access_user(user_id),
   KEY idx_sample_access_directory(user_id,can_manage,session_id),
   CONSTRAINT fk_sample_access_session FOREIGN KEY (session_id) REFERENCES customer_sample_sessions(id) ON DELETE RESTRICT,
   CONSTRAINT fk_sample_access_user FOREIGN KEY (user_id) REFERENCES v2_access_users(id) ON DELETE RESTRICT,
   CONSTRAINT ck_sample_access_manage CHECK (can_manage IN (0,1))
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`},
 {name:'customer_sample_selected_cards',sql:`CREATE TABLE customer_sample_selected_cards (
   id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
   session_id BIGINT UNSIGNED NOT NULL,
   card_id BIGINT UNSIGNED NOT NULL,
   first_scanned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
   UNIQUE KEY uq_sample_selected_card(session_id,card_id),
   CONSTRAINT fk_sample_selected_session FOREIGN KEY (session_id) REFERENCES customer_sample_sessions(id) ON DELETE RESTRICT,
   CONSTRAINT fk_sample_selected_card FOREIGN KEY (card_id) REFERENCES sample_cards(id) ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`},
 {name:'customer_sample_scan_events',sql:`CREATE TABLE customer_sample_scan_events (
   id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
   session_id BIGINT UNSIGNED NOT NULL,
   card_id BIGINT UNSIGNED NOT NULL,
   actor_user_id BIGINT UNSIGNED NOT NULL,
   resolved_products_json JSON NOT NULL,
   added_products_json JSON NOT NULL,
   scanned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
   KEY idx_sample_event_session(session_id,scanned_at),
   CONSTRAINT fk_sample_event_session FOREIGN KEY (session_id) REFERENCES customer_sample_sessions(id) ON DELETE RESTRICT,
   CONSTRAINT fk_sample_event_card FOREIGN KEY (card_id) REFERENCES sample_cards(id) ON DELETE RESTRICT,
   CONSTRAINT fk_sample_event_actor FOREIGN KEY (actor_user_id) REFERENCES v2_access_users(id) ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`},
 {name:'customer_sample_items',sql:`CREATE TABLE customer_sample_items (
   id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
   session_id BIGINT UNSIGNED NOT NULL,
   product_id BIGINT UNSIGNED NOT NULL,
   selected_by_user_id BIGINT UNSIGNED NOT NULL,
   selected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
   removed_at DATETIME NULL,
   removed_by_user_id BIGINT UNSIGNED NULL,
   UNIQUE KEY uq_sample_session_product(session_id,product_id),
   KEY idx_sample_item_product(product_id),
   CONSTRAINT fk_sample_item_session FOREIGN KEY (session_id) REFERENCES customer_sample_sessions(id) ON DELETE RESTRICT,
   CONSTRAINT fk_sample_item_product FOREIGN KEY (product_id) REFERENCES v2_products(id) ON DELETE RESTRICT,
   CONSTRAINT fk_sample_item_actor FOREIGN KEY (selected_by_user_id) REFERENCES v2_access_users(id) ON DELETE RESTRICT,
   CONSTRAINT fk_sample_item_removed_actor FOREIGN KEY (removed_by_user_id) REFERENCES v2_access_users(id) ON DELETE RESTRICT,
   CONSTRAINT ck_sample_item_removal CHECK ((removed_at IS NULL) = (removed_by_user_id IS NULL))
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`},
 {name:'customer_sample_item_sources',sql:`CREATE TABLE customer_sample_item_sources (
   id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
   session_id BIGINT UNSIGNED NOT NULL,
   product_id BIGINT UNSIGNED NOT NULL,
   card_id BIGINT UNSIGNED NOT NULL,
   first_scan_event_id BIGINT UNSIGNED NOT NULL,
   UNIQUE KEY uq_sample_item_card_source(session_id,product_id,card_id),
   KEY idx_sample_source_event(first_scan_event_id),
   CONSTRAINT fk_sample_source_item FOREIGN KEY (session_id,product_id) REFERENCES customer_sample_items(session_id,product_id) ON DELETE RESTRICT,
   CONSTRAINT fk_sample_source_card FOREIGN KEY (card_id) REFERENCES sample_cards(id) ON DELETE RESTRICT,
   CONSTRAINT fk_sample_source_event FOREIGN KEY (first_scan_event_id) REFERENCES customer_sample_scan_events(id) ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`},
 // Append-only audit; no removal or restoration path mutates these events.
 {name:'customer_sample_item_removal_events',sql:`CREATE TABLE customer_sample_item_removal_events (
   id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
   session_id BIGINT UNSIGNED NOT NULL,
   product_id BIGINT UNSIGNED NOT NULL,
   actor_user_id BIGINT UNSIGNED NOT NULL,
   removed_at DATETIME NOT NULL,
   KEY idx_sample_removal_item(session_id,product_id,id),
   CONSTRAINT fk_sample_removal_item FOREIGN KEY (session_id,product_id) REFERENCES customer_sample_items(session_id,product_id) ON DELETE RESTRICT,
   CONSTRAINT fk_sample_removal_actor FOREIGN KEY (actor_user_id) REFERENCES v2_access_users(id) ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`},
 // Card-based manual provenance; NULL only preserves legacy no-card event history.
 {name:'customer_sample_manual_events',sql:`CREATE TABLE customer_sample_manual_events (
   id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
   session_id BIGINT UNSIGNED NOT NULL,
   product_id BIGINT UNSIGNED NOT NULL,
   actor_user_id BIGINT UNSIGNED NOT NULL,
   action ENUM('added','restored','already_selected') NOT NULL,
   card_id BIGINT UNSIGNED NULL,
   selected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
   KEY idx_sample_manual_item(session_id,product_id,id),
   CONSTRAINT fk_sample_manual_item FOREIGN KEY (session_id,product_id) REFERENCES customer_sample_items(session_id,product_id) ON DELETE RESTRICT,
   CONSTRAINT fk_sample_manual_actor FOREIGN KEY (actor_user_id) REFERENCES v2_access_users(id) ON DELETE RESTRICT,
   CONSTRAINT fk_sample_manual_card FOREIGN KEY (card_id) REFERENCES sample_cards(id) ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`}
];
export function getSampleSchemaStatements():readonly SampleTable[]{return list.slice();}
const SANDBOX='fabric_v2_test_20261012_b2samples';
export function requireIsolatedSampleSchemaTarget(name:string,ack:string):string {
 if(name!==SANDBOX||ack!=='I_ACKNOWLEDGE_SANDBOX')
  throw Error('Sample schema bootstrapping requires explicit isolated test database and confirmation');
 return name;
}
/** Never call on production: validate actual connected DB before issuing ANY DDL. */
export async function initializeSampleSchema(
 db:SampleSchemaDb,target:string,confirmation:string
):Promise<void>{
 requireIsolatedSampleSchemaTarget(target,confirmation);
 // Always use ONE connection: a pool.query check could verify one connection
 // then issue DDL on another, especially when connections were USE-mutated.
 const connection=await db.getConnection();
 try {
  const [raw]=await connection.query('SELECT DATABASE() AS selected_database');
  if(!Array.isArray(raw)||raw.length!==1||
   (raw[0] as {selected_database?:unknown}).selected_database!==target)
   throw Error('Sample schema initialization refused: connected database is not the isolated target');
  // Refuse both legacy multi-master tables and previously initialized domains.
  // No implicit ALTER or CREATE IF NOT EXISTS may conceal a schema mismatch.
  const names=[...list.map(table=>table.name),'sample_card_pattern_scopes'];
  const [existing]=await connection.query(
   'SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME IN ('+names.map(()=>'?').join(',')+')',
   [target,...names]);
  if(!Array.isArray(existing)||existing.length!==0)
   throw Error('Sample schema initialization refused: existing or legacy schema requires an explicit drift/migration gate');
  for(const {sql} of list)await connection.query(sql);
 }finally{connection.release();}
}
