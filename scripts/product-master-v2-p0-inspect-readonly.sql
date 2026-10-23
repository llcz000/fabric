-- Fabric Product Master V2 / P0: READ-ONLY schema reconnaissance
-- No application startup; execute using a MySQL user with SELECT on
-- information_schema and, if needed, SELECT on application tables.
-- NEVER use mysql scripts that implicitly call server.ts initialization.
-- Does not export customer/product rows: metadata only.
-- Date 2026-10-12. Intended for P0-2, NOT yet executed on any database.
-- Expected MySQL 8: output captures actual version, tables, indices, FKs.

SELECT VERSION() AS mysql_version, DATABASE() AS selected_database;

SELECT TABLE_NAME, ENGINE, TABLE_ROWS AS approximate_innodb_rows, CREATE_TIME
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
    'orders','order_items','products','product_images','product_image_assets',
    'image_assets','image_asset_variants','pattern_tags','product_pattern_tags',
    'product_issues','product_import_batches','product_import_sources',
    'pattern_masters','pattern_colorways','fabrics','shared_tags',
    'pattern_master_tag_links','pattern_colorway_tag_links',
    'access_users','access_sessions'
  )
ORDER BY TABLE_NAME;
-- INFORMATION_SCHEMA.TABLES.TABLE_ROWS for InnoDB is an APPROXIMATION, not an exact count.

SELECT TABLE_NAME, ORDINAL_POSITION, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE,
       COLUMN_DEFAULT, EXTRA
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
    'orders','order_items','products','product_images','product_image_assets',
    'image_assets','pattern_tags','product_pattern_tags','product_issues',
    'product_import_batches','product_import_sources','pattern_masters',
    'pattern_colorways','fabrics','shared_tags','access_users','access_sessions'
  )
ORDER BY TABLE_NAME, ORDINAL_POSITION;

SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME,
       SUB_PART, INDEX_TYPE
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
    'orders','order_items','products','product_images','product_image_assets',
    'image_assets','pattern_tags','product_pattern_tags','product_issues',
    'product_import_batches','product_import_sources','pattern_masters',
    'pattern_colorways','fabrics','shared_tags'
  )
ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX;

SELECT TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME,
       REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = DATABASE()
  AND REFERENCED_TABLE_NAME IS NOT NULL
  AND (TABLE_NAME IN (
    'orders','order_items','products','product_images','product_image_assets',
    'image_assets','pattern_tags','product_pattern_tags','product_issues',
    'product_import_sources','pattern_masters','pattern_colorways','fabrics'
  ) OR REFERENCED_TABLE_NAME IN ('products','orders','order_items','image_assets'))
ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION;

-- IMPORTANT: if exact table row counts are required, first verify table
-- existence above and execute only the relevant read-only COUNT(*) statements
-- in a separate explicit read-only session. Do not select business columns,
-- identifiers, records, password hashes or customer data for this P0 check.
