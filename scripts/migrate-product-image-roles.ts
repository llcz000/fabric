import dotenv from 'dotenv';
import mysql, { type Pool, type PoolConnection, type RowDataPacket } from 'mysql2/promise';

import { planLegacyRoles, type LegacyProductImageRow, type LegacyRoleAssignment } from '../server/products/legacyCompatibility';

export type LegacyRoleMigrationMode = 'dry-run' | 'apply';
export interface LegacyProductImageBatch { productId: number; images: LegacyProductImageRow[]; }
export interface LegacyRoleMigrationRepository {
  listProductImageBatches(afterProductId: number, limit: number): Promise<LegacyProductImageBatch[]>;
  applyRoles(productId: number, assignments: LegacyRoleAssignment[]): Promise<void>;
}
export interface LegacyRoleMigrationSummary { mode: LegacyRoleMigrationMode; products: number; planned: number; updated: number; }

export function parseLegacyRoleMigrationArgs(args: string[]): { mode: LegacyRoleMigrationMode } {
  const dryRun = args.includes('--dry-run');
  const apply = args.includes('--apply');
  if (dryRun === apply) throw new Error('Provide exactly one of --dry-run or --apply');
  if (args.some((arg) => arg !== '--dry-run' && arg !== '--apply')) throw new Error('Unknown migration argument');
  return { mode: apply ? 'apply' : 'dry-run' };
}

export async function migrateLegacyProductRoles(options: {
  mode: LegacyRoleMigrationMode;
  repository: LegacyRoleMigrationRepository;
}): Promise<LegacyRoleMigrationSummary> {
  const summary: LegacyRoleMigrationSummary = { mode: options.mode, products: 0, planned: 0, updated: 0 };
  let afterProductId = 0;
  while (true) {
    const batch = await options.repository.listProductImageBatches(afterProductId, 100);
    if (batch.length === 0) break;
    for (const product of batch) {
      const assignments = planLegacyRoles(product.images);
      summary.products += 1;
      summary.planned += assignments.length;
      if (options.mode === 'apply' && assignments.length > 0) {
        await options.repository.applyRoles(product.productId, assignments);
        summary.updated += assignments.length;
      }
      afterProductId = Math.max(afterProductId, product.productId);
    }
  }
  return summary;
}

class MySqlLegacyRoleRepository implements LegacyRoleMigrationRepository {
  constructor(private readonly pool: Pool) {}
  async listProductImageBatches(afterProductId: number, limit: number): Promise<LegacyProductImageBatch[]> {
    const [products] = await this.pool.query<RowDataPacket[]>(
      'SELECT DISTINCT product_id FROM product_images WHERE product_id > ? ORDER BY product_id LIMIT ?',
      [afterProductId, limit],
    );
    if (products.length === 0) return [];
    const ids = products.map((row) => Number(row.product_id));
    const [images] = await this.pool.query<RowDataPacket[]>(
      `SELECT id, product_id, sort_order, role, is_primary FROM product_images WHERE product_id IN (${ids.map(() => '?').join(',')}) ORDER BY product_id, sort_order, id`,
      ids,
    );
    return ids.map((productId) => ({
      productId,
      images: images.filter((row) => Number(row.product_id) === productId).map((row) => ({
        id: Number(row.id), sortOrder: Number(row.sort_order), role: String(row.role ?? ''), isPrimary: Boolean(row.is_primary),
      })),
    }));
  }
  async applyRoles(productId: number, assignments: LegacyRoleAssignment[]): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await lockProductImages(connection, productId);
      for (const assignment of assignments) {
        await connection.query(
          'UPDATE product_images SET role = ?, sort_order = ?, is_primary = ?, origin_type = ? WHERE id = ? AND product_id = ?',
          [assignment.role, assignment.sortOrder, assignment.isPrimary ? 1 : 0, 'legacy', assignment.legacyImageId, productId],
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally { connection.release(); }
  }
}

async function lockProductImages(connection: PoolConnection, productId: number): Promise<void> {
  await connection.query('SELECT id FROM product_images WHERE product_id = ? ORDER BY id FOR UPDATE', [productId]);
}

async function main(): Promise<void> {
  dotenv.config();
  const { mode } = parseLegacyRoleMigrationArgs(process.argv.slice(2));
  const pool = mysql.createPool({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE, connectionLimit: 2,
  });
  try {
    const summary = await migrateLegacyProductRoles({ mode, repository: new MySqlLegacyRoleRepository(pool) });
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } finally { await pool.end(); }
}

const invoked = process.argv[1] != null
  && (process.argv[1].endsWith('migrate-product-image-roles.ts') || process.argv[1].endsWith('migrate-product-image-roles.js'));
if (invoked) void main().catch((error) => { process.stderr.write(`Product image role migration failed: ${error instanceof Error ? error.message : 'unknown error'}\n`); process.exitCode = 1; });
