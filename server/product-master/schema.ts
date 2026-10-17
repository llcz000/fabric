/**
 * Fabric Product Master V2: additive, isolated domain bootstrap.
 *
 * Only creates V2-owned tables; requires an existing image_assets contract.
 * NEVER calls old server.ts initialization or operates on old products,
 * fabrics, orders, order_items, or image_assets records.
 * MySQL 8.0.46 target; D-01 approved monotonically increasing colorway
 * identity requires a persistent master counter. Allocation/API comes later.
 */
export interface V2SchemaConnection {
  query(sql: string, params?: unknown[]): Promise<[unknown, unknown]>;
}

interface SchemaTable {
  name: string;
  ddl: string;
  columns: readonly string[];
  indexes: readonly string[];
}

const tables: readonly SchemaTable[] = [
  {
    name: 'pattern_masters',
    columns: ['id', 'master_no', 'next_colorway_no', 'is_active'],
    indexes: ['PRIMARY', 'uq_v2_master_no'],
    ddl: `CREATE TABLE IF NOT EXISTS pattern_masters (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      master_no VARCHAR(64) NOT NULL,
      next_colorway_no BIGINT UNSIGNED NOT NULL DEFAULT 1,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_v2_master_no (master_no),
      CONSTRAINT ck_v2_master_no CHECK (master_no REGEXP '^[A-Z0-9]+$'),
      CONSTRAINT ck_v2_master_active CHECK (is_active IN (0,1)),
      CONSTRAINT ck_v2_next_colorway_positive CHECK (next_colorway_no > 0)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    name: 'pattern_colorways',
    columns: ['id', 'master_id', 'colorway_no', 'pattern_image_asset_id', 'remark', 'is_active'],
    indexes: ['PRIMARY', 'uq_v2_master_colorway'],
    ddl: `CREATE TABLE IF NOT EXISTS pattern_colorways (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      master_id BIGINT UNSIGNED NOT NULL,
      colorway_no INT UNSIGNED NOT NULL,
      pattern_image_asset_id VARCHAR(36) NULL,
      remark VARCHAR(500) NOT NULL DEFAULT '',
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_v2_master_colorway (master_id, colorway_no),
      KEY idx_v2_colorway_image_asset (pattern_image_asset_id),
      CONSTRAINT fk_v2_colorway_master FOREIGN KEY (master_id) REFERENCES pattern_masters(id) ON DELETE RESTRICT,
      CONSTRAINT fk_v2_colorway_image FOREIGN KEY (pattern_image_asset_id) REFERENCES image_assets(id) ON DELETE RESTRICT,
      CONSTRAINT ck_v2_colorway_positive CHECK (colorway_no > 0),
      CONSTRAINT ck_v2_colorway_active CHECK (is_active IN (0,1))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    name: 'v2_fabrics',
    columns: ['id', 'fabric_no', 'fabric_name', 'weight_value', 'weight_unit', 'width_value', 'is_active'],
    indexes: ['PRIMARY', 'uq_v2_fabric_no'],
    ddl: `CREATE TABLE IF NOT EXISTS v2_fabrics (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      fabric_no VARCHAR(64) NOT NULL,
      fabric_name VARCHAR(255) NOT NULL,
      composition VARCHAR(500) NULL,
      weight_value DECIMAL(12,3) NULL,
      weight_unit ENUM('gsm', 'mm') NULL,
      width_value DECIMAL(12,2) NULL,
      remark TEXT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_v2_fabric_no (fabric_no),
      KEY idx_v2_fabric_name (fabric_name),
      CONSTRAINT ck_v2_fabric_no CHECK (fabric_no REGEXP '^[A-Z0-9]+$'),
      CONSTRAINT ck_v2_fabric_name CHECK (CHAR_LENGTH(TRIM(fabric_name)) > 0),
      CONSTRAINT ck_v2_fabric_weight CHECK (
        (weight_value IS NULL AND weight_unit IS NULL)
        OR (weight_value > 0 AND weight_unit IS NOT NULL)
      ),
      CONSTRAINT ck_v2_fabric_width CHECK (width_value IS NULL OR width_value > 0),
      CONSTRAINT ck_v2_fabric_active CHECK (is_active IN (0,1))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    name: 'shared_tags',
    columns: ['id', 'dimension', 'name', 'normalized_name', 'is_archived'],
    indexes: ['PRIMARY', 'uq_v2_dimension_normalized'],
    ddl: `CREATE TABLE IF NOT EXISTS shared_tags (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      dimension ENUM('topic', 'color') NOT NULL,
      name VARCHAR(32) NOT NULL,
      normalized_name VARCHAR(64) NOT NULL,
      is_archived TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_v2_dimension_normalized (dimension, normalized_name),
      CONSTRAINT ck_v2_tag_name CHECK (CHAR_LENGTH(TRIM(name)) BETWEEN 1 AND 32),
      CONSTRAINT ck_v2_tag_normalized CHECK (CHAR_LENGTH(normalized_name) > 0)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    name: 'pattern_master_tag_links',
    columns: ['master_id', 'tag_id'],
    indexes: ['PRIMARY'],
    ddl: `CREATE TABLE IF NOT EXISTS pattern_master_tag_links (
      master_id BIGINT UNSIGNED NOT NULL,
      tag_id BIGINT UNSIGNED NOT NULL,
      PRIMARY KEY (master_id, tag_id),
      KEY idx_v2_master_tags_tag (tag_id),
      CONSTRAINT fk_v2_mtags_master FOREIGN KEY (master_id) REFERENCES pattern_masters(id) ON DELETE CASCADE,
      CONSTRAINT fk_v2_mtags_tag FOREIGN KEY (tag_id) REFERENCES shared_tags(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    name: 'pattern_colorway_tag_links',
    columns: ['colorway_id', 'tag_id'],
    indexes: ['PRIMARY'],
    ddl: `CREATE TABLE IF NOT EXISTS pattern_colorway_tag_links (
      colorway_id BIGINT UNSIGNED NOT NULL,
      tag_id BIGINT UNSIGNED NOT NULL,
      PRIMARY KEY (colorway_id, tag_id),
      KEY idx_v2_colorway_tags_tag (tag_id),
      CONSTRAINT fk_v2_ctags_colorway FOREIGN KEY (colorway_id) REFERENCES pattern_colorways(id) ON DELETE CASCADE,
      CONSTRAINT fk_v2_ctags_tag FOREIGN KEY (tag_id) REFERENCES shared_tags(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    name: 'v2_products',
    columns: ['id', 'pattern_colorway_id', 'fabric_id', 'product_no', 'remark', 'is_active', 'is_available_for_sampling', 'row_version'],
    indexes: ['PRIMARY', 'uq_v2_colorway_fabric', 'uq_v2_product_no'],
    ddl: `CREATE TABLE IF NOT EXISTS v2_products (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      pattern_colorway_id BIGINT UNSIGNED NOT NULL,
      fabric_id BIGINT UNSIGNED NOT NULL,
      product_no VARCHAR(160) NOT NULL,
      remark TEXT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      is_available_for_sampling TINYINT(1) NOT NULL DEFAULT 1,
      row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_v2_colorway_fabric (pattern_colorway_id, fabric_id),
      UNIQUE KEY uq_v2_product_no (product_no),
      KEY idx_v2_products_fabric (fabric_id, is_active),
      CONSTRAINT fk_v2_products_colorway FOREIGN KEY (pattern_colorway_id) REFERENCES pattern_colorways(id) ON DELETE RESTRICT,
      CONSTRAINT fk_v2_products_fabric FOREIGN KEY (fabric_id) REFERENCES v2_fabrics(id) ON DELETE RESTRICT,
      CONSTRAINT ck_v2_product_active CHECK (is_active IN (0,1)),
      CONSTRAINT ck_v2_product_sampling CHECK (is_available_for_sampling IN (0,1))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    name: 'v2_product_image_assets',
    columns: ['id', 'product_id', 'asset_id', 'role', 'sort_order', 'deleted_at'],
    indexes: ['PRIMARY', 'uq_v2_product_active_asset'],
    ddl: `CREATE TABLE IF NOT EXISTS v2_product_image_assets (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      product_id BIGINT UNSIGNED NOT NULL,
      asset_id VARCHAR(36) NOT NULL,
      role ENUM('fabric_display', 'detail', 'ai_effect') NOT NULL,
      sort_order INT UNSIGNED NOT NULL,
      deleted_at DATETIME NULL,
      active_asset_id VARCHAR(36) GENERATED ALWAYS AS (
        CASE WHEN deleted_at IS NULL THEN asset_id ELSE NULL END
      ) STORED,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_v2_product_active_asset (product_id, active_asset_id),
      KEY idx_v2_product_images_order (product_id, role, deleted_at, sort_order),
      KEY idx_v2_product_images_asset (asset_id),
      CONSTRAINT fk_v2_product_image_product FOREIGN KEY (product_id) REFERENCES v2_products(id) ON DELETE RESTRICT,
      CONSTRAINT fk_v2_product_image_asset FOREIGN KEY (asset_id) REFERENCES image_assets(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    name:'v2_company_print_labels',
    columns:['company_id','issuer_label','receiver_label'],
    indexes:['PRIMARY'],
    ddl: `CREATE TABLE IF NOT EXISTS v2_company_print_labels (
      company_id INT NOT NULL PRIMARY KEY,
      issuer_label VARCHAR(100) NOT NULL DEFAULT '开单人签字',
      receiver_label VARCHAR(100) NOT NULL DEFAULT '收货人签字',
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_v2_company_print_owner FOREIGN KEY (company_id) REFERENCES company_config(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
];

/** Read-only DDL manifest for isolated MySQL 8 integration tests and migration review. */
export function getV2ProductMasterCreateStatements(): ReadonlyArray<Readonly<{ name: string; sql: string }>> {
  return tables.map(table => Object.freeze({ name: table.name, sql: table.ddl }));
}

function strings(rows: unknown, name: 'COLUMN_NAME' | 'INDEX_NAME'): Set<string> {
  if (!Array.isArray(rows)) throw new Error('Expected INFORMATION_SCHEMA rows');
  return new Set(rows.map(row => String((row as Record<string, unknown>)[name] ?? '')));
}

/**
 * This function deliberately does not use a transaction: MySQL DDL implicitly
 * commits. It validates each table before proceeding so an interrupted first
 * run can be safely re-run, while divergent existing schemas fail closed.
 * Production preconditions, privileges and rollback are a separate P1 gate.
 */
export async function initializeV2ProductMasterSchema(connection: V2SchemaConnection): Promise<void> {
  const [assetRows] = await connection.query(
    'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
    ['image_assets'],
  );
  for (const name of ['id', 'ref_count']) {
    if (!strings(assetRows, 'COLUMN_NAME').has(name)) {
      throw new Error(`Shared image_assets contract missing column ${name}`);
    }
  }

  for (const table of tables) {
    await connection.query(table.ddl);
    const [columnRows] = await connection.query(
      'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
      [table.name],
    );
    const actualColumns = strings(columnRows, 'COLUMN_NAME');
    for (const column of table.columns) {
      if (!actualColumns.has(column)) {
        throw new Error(`V2 schema drift in ${table.name}: missing column ${column}`);
      }
    }
    const [indexRows] = await connection.query(
      'SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
      [table.name],
    );
    const actualIndexes = strings(indexRows, 'INDEX_NAME');
    for (const index of table.indexes) {
      if (!actualIndexes.has(index)) {
        throw new Error(`V2 schema drift in ${table.name}: missing index ${index}`);
      }
    }
  }
}
