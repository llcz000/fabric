export interface ProductSchemaConnection {
  query(sql: string, params?: unknown[]): Promise<[unknown, unknown]>;
}
export async function initializeProductDomainSchema(connection: ProductSchemaConnection): Promise<void> {
  await addColumnIfMissing(connection, 'product_image_assets', 'origin_type', "VARCHAR(32) NOT NULL DEFAULT 'upload'");
  await addColumnIfMissing(connection, 'product_image_assets', 'origin_metadata', 'JSON NULL');
  await addIndexIfMissing(connection, 'product_image_assets', 'idx_product_image_assets_role_order', '(product_id, role, sort_order, deleted_at)');

  await addColumnIfMissing(connection, 'product_images', 'role', "VARCHAR(32) NOT NULL DEFAULT 'unclassified'");
  await addColumnIfMissing(connection, 'product_images', 'is_primary', 'TINYINT(1) NOT NULL DEFAULT 0');
  await addColumnIfMissing(connection, 'product_images', 'origin_type', "VARCHAR(32) NOT NULL DEFAULT 'legacy'");
  await addColumnIfMissing(connection, 'product_images', 'origin_metadata', 'JSON NULL');

  await addColumnIfMissing(connection, 'products', 'review_status', "VARCHAR(32) NOT NULL DEFAULT 'pending_manual_confirmation'");
  await addColumnIfMissing(connection, 'products', 'reviewed_by', 'VARCHAR(255) NULL');
  await addColumnIfMissing(connection, 'products', 'reviewed_at', 'DATETIME NULL');
  await addIndexIfMissing(connection, 'products', 'idx_products_review_status_updated', '(review_status, updated_at, id)');

  await connection.query(`
    CREATE TABLE IF NOT EXISTS pattern_tags (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(32) NOT NULL,
      normalized_name VARCHAR(64) NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'active',
      created_by VARCHAR(255) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_pattern_tags_normalized_name (normalized_name),
      KEY idx_pattern_tags_status_name (status, name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS product_pattern_tags (
      product_id INT NOT NULL,
      tag_id BIGINT UNSIGNED NOT NULL,
      created_by VARCHAR(255) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (product_id, tag_id),
      KEY idx_product_pattern_tags_tag_product (tag_id, product_id),
      CONSTRAINT fk_product_pattern_tags_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      CONSTRAINT fk_product_pattern_tags_tag FOREIGN KEY (tag_id) REFERENCES pattern_tags(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS product_issues (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      product_id INT NOT NULL,
      product_image_asset_id BIGINT UNSIGNED NULL,
      code VARCHAR(64) NOT NULL,
      severity VARCHAR(16) NOT NULL DEFAULT 'warning',
      field_name VARCHAR(64) NOT NULL DEFAULT '',
      message VARCHAR(1000) NOT NULL,
      source_ref VARCHAR(255) NOT NULL DEFAULT '',
      status VARCHAR(16) NOT NULL DEFAULT 'open',
      resolution_note VARCHAR(1000) NULL,
      resolved_by VARCHAR(255) NULL,
      resolved_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_product_issue_fact (product_id, code, field_name, source_ref),
      KEY idx_product_issues_product_status (product_id, status),
      KEY idx_product_issues_code_status (code, status),
      CONSTRAINT fk_product_issues_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      CONSTRAINT fk_product_issues_image FOREIGN KEY (product_image_asset_id) REFERENCES product_image_assets(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS product_import_batches (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      file_sha256 CHAR(64) NOT NULL,
      source_file VARCHAR(255) NOT NULL,
      sheet_name VARCHAR(128) NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'running',
      checkpoint_json JSON NULL,
      stats_json JSON NULL,
      last_error_code VARCHAR(64) NULL,
      created_by VARCHAR(255) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_import_batch_file_sheet (file_sha256, sheet_name),
      KEY idx_import_batches_status_updated (status, updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS product_import_sources (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      batch_id BIGINT UNSIGNED NOT NULL,
      product_id INT NULL,
      plan_key CHAR(64) NOT NULL,
      source_sheet VARCHAR(128) NOT NULL,
      source_row INT UNSIGNED NOT NULL,
      source_fingerprint CHAR(64) NOT NULL,
      source_payload JSON NOT NULL,
      status VARCHAR(16) NOT NULL,
      error_code VARCHAR(64) NULL,
      imported_product_updated_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_import_source_row (batch_id, source_sheet, source_row),
      KEY idx_import_sources_product (product_id),
      KEY idx_import_sources_fingerprint (source_fingerprint),
      CONSTRAINT fk_import_sources_batch FOREIGN KEY (batch_id) REFERENCES product_import_batches(id) ON DELETE RESTRICT,
      CONSTRAINT fk_import_sources_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

async function addColumnIfMissing(connection: ProductSchemaConnection, table: string, column: string, definition: string): Promise<void> {
  const [rows] = await connection.query(
    `SELECT 1 AS present FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column],
  );
  if (Array.isArray(rows) && rows.length > 0) return;
  await connection.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

async function addIndexIfMissing(connection: ProductSchemaConnection, table: string, index: string, columns: string): Promise<void> {
  const [rows] = await connection.query(
    `SELECT 1 AS present FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    [table, index],
  );
  if (Array.isArray(rows) && rows.length > 0) return;
  await connection.query(`ALTER TABLE ${table} ADD INDEX ${index} ${columns}`);
}
