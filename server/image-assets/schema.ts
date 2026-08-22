export interface SqlConnection {
  query(sql: string, params?: unknown[]): Promise<[unknown, unknown]>;
}

export async function initializeImageAssetSchema(connection: SqlConnection): Promise<void> {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS image_assets (
      id VARCHAR(36) PRIMARY KEY,
      sha256 CHAR(64) NOT NULL,
      original_filename VARCHAR(255) NOT NULL,
      detected_mime VARCHAR(100) NOT NULL,
      detected_extension VARCHAR(20) NOT NULL,
      purpose VARCHAR(32) NOT NULL,
      storage_provider VARCHAR(16) NOT NULL,
      byte_size BIGINT UNSIGNED NOT NULL,
      width INT UNSIGNED NOT NULL,
      height INT UNSIGNED NOT NULL,
      status VARCHAR(16) NOT NULL,
      ref_count INT UNSIGNED NOT NULL DEFAULT 0,
      created_by VARCHAR(255) NOT NULL,
      recycled_at DATETIME NULL,
      purge_after DATETIME NULL,
      purged_at DATETIME NULL,
      error_code VARCHAR(64) NULL,
      metadata_json JSON NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_image_assets_sha256 (sha256),
      KEY idx_image_assets_status_purge_after (status, purge_after),
      KEY idx_image_assets_status_updated_at (status, updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS image_asset_variants (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      asset_id VARCHAR(36) NOT NULL,
      variant VARCHAR(16) NOT NULL,
      object_key VARCHAR(512) NOT NULL,
      mime VARCHAR(100) NOT NULL,
      byte_size BIGINT UNSIGNED NOT NULL,
      width INT UNSIGNED NOT NULL,
      height INT UNSIGNED NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_asset_variant (asset_id, variant),
      CONSTRAINT fk_image_asset_variants_asset FOREIGN KEY (asset_id) REFERENCES image_assets(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS image_upload_sessions (
      id VARCHAR(36) PRIMARY KEY,
      purpose VARCHAR(32) NOT NULL,
      quarantine_key VARCHAR(512) NOT NULL,
      declared_byte_size BIGINT UNSIGNED NOT NULL,
      declared_mime VARCHAR(100) NOT NULL,
      created_by VARCHAR(255) NOT NULL,
      expires_at DATETIME NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'open',
      asset_id VARCHAR(36) NULL,
      quarantine_cleaned_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_upload_quarantine_key (quarantine_key),
      KEY idx_image_upload_sessions_status_expires_at (status, expires_at),
      CONSTRAINT fk_image_upload_sessions_asset FOREIGN KEY (asset_id) REFERENCES image_assets(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await connection.query(`
    ALTER TABLE image_upload_sessions
    ADD COLUMN IF NOT EXISTS quarantine_cleaned_at DATETIME NULL;
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS image_processing_jobs (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      asset_id VARCHAR(36) NOT NULL,
      job_type VARCHAR(32) NOT NULL DEFAULT 'process_asset',
      status VARCHAR(16) NOT NULL DEFAULT 'queued',
      attempts INT UNSIGNED NOT NULL DEFAULT 0,
      available_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      locked_at DATETIME NULL,
      locked_by VARCHAR(255) NULL,
      last_error_code VARCHAR(64) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_processing_job_asset (asset_id),
      KEY idx_image_processing_jobs_status_available_at (status, available_at),
      CONSTRAINT fk_image_processing_jobs_asset FOREIGN KEY (asset_id) REFERENCES image_assets(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS company_image_assets (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      company_id INT NOT NULL,
      role VARCHAR(32) NOT NULL,
      asset_id VARCHAR(36) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_company_role (company_id, role),
      KEY idx_company_image_assets_asset_id (asset_id),
      CONSTRAINT fk_company_image_assets_company FOREIGN KEY (company_id) REFERENCES company_config(id) ON DELETE CASCADE,
      CONSTRAINT fk_company_image_assets_asset FOREIGN KEY (asset_id) REFERENCES image_assets(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS product_image_assets (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      product_id INT NOT NULL,
      asset_id VARCHAR(36) NOT NULL,
      role VARCHAR(32) NOT NULL DEFAULT 'gallery',
      sort_order INT NOT NULL DEFAULT 0,
      is_primary TINYINT(1) NOT NULL DEFAULT 0,
      legacy_product_image_id INT NULL,
      deleted_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_product_asset (product_id, asset_id),
      UNIQUE KEY uq_legacy_product_image (legacy_product_image_id),
      KEY idx_product_image_assets_product_deleted (product_id, deleted_at),
      CONSTRAINT fk_product_image_assets_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      CONSTRAINT fk_product_image_assets_asset FOREIGN KEY (asset_id) REFERENCES image_assets(id) ON DELETE RESTRICT,
      CONSTRAINT fk_product_image_assets_legacy FOREIGN KEY (legacy_product_image_id) REFERENCES product_images(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}
