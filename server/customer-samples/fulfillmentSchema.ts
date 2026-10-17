/** B3 additive fresh-only schema contract. This module NEVER executes DDL.
 * Real migration, backup and MySQL metadata checks remain release gates.
 */
export interface FulfillmentTable {readonly name:string;readonly sql:string}
const make=(name:string,clauses:string[]):FulfillmentTable=>({
 name,sql:'CREATE TABLE '+name+' (\n '+clauses.join(',\n ')+'\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
});
const tables:readonly FulfillmentTable[]=[
 make('sample_shipments',[
  'id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY',
  'session_id BIGINT UNSIGNED NOT NULL',
  'actor_user_id BIGINT UNSIGNED NOT NULL',
  'shipped_at DATETIME(3) NOT NULL',
  'carrier VARCHAR(160) NULL','tracking_no VARCHAR(160) NULL',
  'created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP',
  'UNIQUE KEY uq_sample_shipments_session (id,session_id)',
  'KEY idx_sample_shipments_session (session_id,shipped_at,id)',
  'CONSTRAINT fk_shipment_session FOREIGN KEY (session_id) REFERENCES customer_sample_sessions(id) ON DELETE RESTRICT',
  'CONSTRAINT fk_shipment_actor FOREIGN KEY (actor_user_id) REFERENCES v2_access_users(id) ON DELETE RESTRICT'
 ]),
 make('sample_shipment_items',[
  'id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY',
  'shipment_id BIGINT UNSIGNED NOT NULL','session_id BIGINT UNSIGNED NOT NULL',
  'product_id BIGINT UNSIGNED NOT NULL','quantity BIGINT UNSIGNED NOT NULL',
  'UNIQUE KEY uq_sample_shipment_product (shipment_id,product_id)',
  'KEY idx_shipment_selected (session_id,product_id)',
  'CONSTRAINT fk_shipment_line_batch FOREIGN KEY (shipment_id,session_id) REFERENCES sample_shipments(id,session_id) ON DELETE RESTRICT',
  'CONSTRAINT fk_shipment_line_selected FOREIGN KEY (session_id,product_id) REFERENCES customer_sample_items(session_id,product_id) ON DELETE RESTRICT',
  'CONSTRAINT ck_shipment_quantity CHECK (quantity > 0)'
 ]),
 make('sample_followups',[
  'id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY',
  'session_id BIGINT UNSIGNED NOT NULL','actor_user_id BIGINT UNSIGNED NOT NULL',
  'contacted_on DATE NOT NULL','customer_confirmed TINYINT(1) NULL',
  'feedback TEXT NULL','outcome VARCHAR(400) NOT NULL','next_action VARCHAR(400) NULL',
  'next_followup_on DATE NULL','created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP',
  'UNIQUE KEY uq_sample_followups_session (id,session_id)',
  'KEY idx_sample_followup_session (session_id,contacted_on,id)',
  'KEY idx_sample_followup_next (next_followup_on)',
  'CONSTRAINT fk_followup_session FOREIGN KEY (session_id) REFERENCES customer_sample_sessions(id) ON DELETE RESTRICT',
  'CONSTRAINT fk_followup_actor FOREIGN KEY (actor_user_id) REFERENCES v2_access_users(id) ON DELETE RESTRICT',
  'CONSTRAINT ck_followup_confirmed CHECK (customer_confirmed IN (0,1) OR customer_confirmed IS NULL)',
  'CONSTRAINT ck_followup_next CHECK (next_followup_on IS NULL OR next_followup_on >= contacted_on)'
 ]),
 make('sample_followup_products',[
  'id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY','followup_id BIGINT UNSIGNED NOT NULL',
  'session_id BIGINT UNSIGNED NOT NULL','product_id BIGINT UNSIGNED NOT NULL',
  'UNIQUE KEY uq_followup_product (followup_id,product_id)',
  'KEY idx_followup_selected (session_id,product_id)',
  'CONSTRAINT fk_followup_line_header FOREIGN KEY (followup_id,session_id) REFERENCES sample_followups(id,session_id) ON DELETE RESTRICT',
  'CONSTRAINT fk_followup_line_selected FOREIGN KEY (session_id,product_id) REFERENCES customer_sample_items(session_id,product_id) ON DELETE RESTRICT'
 ])
];
export const getFulfillmentSchemaStatements=():readonly FulfillmentTable[]=>tables.slice();
