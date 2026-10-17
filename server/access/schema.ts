/**
 * Product Master V2 P2: independent/additive identity tables.
 * This initializer MUST NOT be invoked on current production startup.
 * The existing ADMIN_PASSWORD login and legacy order tables remain untouched.
 * No production migration runner or bootstrap account creation is included.
 */
export interface AccessSchemaConnection {
  query(sql:string,params?:unknown[]):Promise<[unknown,unknown]>;
}
const DDL=[
 `CREATE TABLE IF NOT EXISTS v2_access_users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(64) NOT NULL,
    username_normalized VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('admin', 'sales') NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    can_manage_own_orders TINYINT(1) NOT NULL DEFAULT 0,
    can_manage_products TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_v2_username_normalized (username_normalized),
    CONSTRAINT ck_v2_user_active CHECK (is_active IN (0,1)),
    CONSTRAINT ck_v2_user_order_grant CHECK (can_manage_own_orders IN (0,1)),
    CONSTRAINT ck_v2_user_product_grant CHECK (can_manage_products IN (0,1)),
    CONSTRAINT ck_v2_username_normalized CHECK (CHAR_LENGTH(TRIM(username_normalized)) > 0)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
 `CREATE TABLE IF NOT EXISTS v2_access_sessions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    expires_at DATETIME NOT NULL,
    revoked_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_v2_session_token_hash (token_hash),
    KEY idx_v2_session_user (user_id),
    KEY idx_v2_session_expiry (expires_at),
    CONSTRAINT fk_v2_session_user FOREIGN KEY (user_id) REFERENCES v2_access_users(id) ON DELETE RESTRICT,
    CONSTRAINT ck_v2_token_hash CHECK (token_hash REGEXP '^[0-9a-f]{64}$')
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
] as const;
export function getAccessSchemaCreateStatements():readonly string[] {return DDL.slice();}
export async function initializeAccessSchema(connection:AccessSchemaConnection):Promise<void>{
 for(const sql of DDL) await connection.query(sql);
}
