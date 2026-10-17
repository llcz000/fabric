import { initializeImageAssetSchema, type SqlConnection } from '../image-assets/schema';
import { requireIsolatedV2SchemaTarget } from './bootstrapTarget';
import { verifyV2SchemaContract } from './schemaContract';

/**
 * P1-C opt-in/test-only V2 domain initialization entrypoint.
 *
 * V2 route, permissions and order integration are not live yet. Therefore this
 * is deliberately NOT invoked by the current production server.ts startup.
 * The database target gate is checked before any statement can execute.
 */
export async function bootstrapIsolatedV2Schema(input: {
  connection: SqlConnection;
  database?: string;
  confirmation?: string;
}): Promise<void> {
  requireIsolatedV2SchemaTarget(input);
  const [companyColumns] = await input.connection.query(
    'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
    ['company_config'],
  );
  if (!Array.isArray(companyColumns) || !companyColumns.some((row) => (
    row !== null && typeof row === 'object' && 'COLUMN_NAME' in row && row.COLUMN_NAME === 'id'
  ))) {
    throw new Error('Shared company_config(id) prerequisite missing for V2 image schema');
  }
  // MySQL CREATE IF NOT EXISTS never upgrades a pre-existing table. Detect
  // the known V1 (pre-D-01) shape BEFORE any DDL, and refuse auto-upgrade.
  const [masterColumns] = await input.connection.query(
    'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',
    ['pattern_masters'],
  );
  if (!Array.isArray(masterColumns)) throw new Error('Missing V2 schema metadata');
  const fields = new Set(masterColumns.map(row => String((row as { COLUMN_NAME?: unknown }).COLUMN_NAME ?? '')));
  if (fields.size > 0 && !fields.has('next_colorway_no')) {
    throw new Error('V2 schema version 1 detected: next_colorway_no migration must be explicitly planned and applied');
  }
  await initializeImageAssetSchema(input.connection, {productDomain:'v2'});
  // Read-only integrity check rejects a same-named but structurally wrong table.
  await verifyV2SchemaContract(input.connection);
}
