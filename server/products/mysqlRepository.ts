import { ImageAssetError } from '../image-assets/errors';
import type { AssetTransaction } from '../image-assets/repository';
import type { ProductRecord, ProductRepository } from './repository';
import type {
  PatternTag,
  PatternTagBatchInput,
  PatternTagStatus,
  PatternTagUpdate,
  ProductImageLayoutItem,
  ProductWriteInput,
} from './types';
import { MAX_PRODUCT_PATTERN_TAGS, validateImageLayout } from './validation';

interface ProductPool {
  getConnection(): Promise<AssetTransaction>;
  query(sql: string, params?: unknown[]): Promise<[unknown, unknown]>;
}

type Row = Record<string, unknown>;

interface LockedImageState {
  existing: Row[];
  layout: ProductImageLayoutItem[];
}

interface LockedTagState {
  existingIds: Set<number>;
  requestedIds: number[];
}

export class MySqlProductRepository implements ProductRepository {
  constructor(private readonly pool: ProductPool) {}

  createProduct(input: ProductWriteInput, principalId: string): Promise<ProductRecord> {
    const layout = validateImageLayout(input.images);
    const tagIds = normalizeTagIds(input.patternTagIds);
    return this.inTransaction(async (connection) => {
      const now = new Date();
      const inserted = result(await connection.query(
        'INSERT INTO products (item_no, product_name, composition, weight, width, image_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)',
        [input.itemNo, input.productName, input.composition, input.weight, input.width, now, now],
      ));
      const productId = Number(inserted.insertId);
      if (!Number.isSafeInteger(productId) || productId <= 0) throw new Error('Product insert did not return an ID');

      const imageState = await this.lockImageState(connection, productId, layout);
      const tagState = await this.lockTagState(connection, productId, tagIds);
      await this.applyImageLayout(connection, productId, imageState);
      await this.applyTagSet(connection, productId, tagState, principalId);

      return {
        id: productId,
        itemNo: input.itemNo,
        productName: input.productName,
        composition: input.composition,
        weight: input.weight,
        width: input.width,
        imageCount: layout.length,
        createdAt: now,
        updatedAt: now,
      };
    });
  }

  updateProduct(productId: number, input: ProductWriteInput, principalId: string): Promise<ProductRecord | null> {
    const layout = validateImageLayout(input.images);
    const tagIds = normalizeTagIds(input.patternTagIds);
    return this.inTransaction(async (connection) => {
      const product = await this.lockProduct(connection, productId);
      if (!product) return null;
      const imageState = await this.lockImageState(connection, productId, layout);
      const tagState = await this.lockTagState(connection, productId, tagIds);
      await this.applyImageLayout(connection, productId, imageState);
      await this.applyTagSet(connection, productId, tagState, principalId);
      const updatedAt = new Date();
      await connection.query(
        'UPDATE products SET item_no = ?, product_name = ?, composition = ?, weight = ?, width = ?, image_count = ?, updated_at = ? WHERE id = ?',
        [input.itemNo, input.productName, input.composition, input.weight, input.width, layout.length, updatedAt, productId],
      );
      return {
        id: productId,
        itemNo: input.itemNo,
        productName: input.productName,
        composition: input.composition,
        weight: input.weight,
        width: input.width,
        imageCount: layout.length,
        createdAt: date(product.created_at),
        updatedAt,
      };
    });
  }

  async replaceImageLayout(productId: number, layoutInput: ProductImageLayoutItem[]): Promise<void> {
    const layout = validateImageLayout(layoutInput);
    await this.inTransaction(async (connection) => {
      if (!await this.lockProduct(connection, productId)) throw new Error('Product not found');
      const imageState = await this.lockImageState(connection, productId, layout);
      await this.applyImageLayout(connection, productId, imageState);
    });
  }

  async deleteProductImage(productId: number, assetId: string): Promise<void> {
    await this.inTransaction(async (connection) => {
      if (!await this.lockProduct(connection, productId)) throw new Error('Product not found');
      const existing = await this.lockCurrentImages(connection, productId);
      const target = existing.find((row) => String(row.asset_id) === assetId);
      if (!target) return;
      await this.lockAssets(connection, [assetId], new Set());
      await connection.query('UPDATE product_image_assets SET deleted_at = NOW(), is_primary = 0 WHERE id = ?', [target.id]);
      await this.decrementReference(connection, assetId);
      const remaining = existing.filter((row) => row.id !== target.id);
      await this.resequenceExisting(connection, remaining);
      await connection.query('UPDATE products SET image_count = ?, updated_at = NOW() WHERE id = ?', [remaining.length, productId]);
    });
  }

  async deleteProduct(productId: number): Promise<boolean> {
    return this.inTransaction(async (connection) => {
      if (!await this.lockProduct(connection, productId)) return false;
      const existing = await this.lockCurrentImages(connection, productId);
      const assetIds = existing.map((row) => String(row.asset_id));
      await this.lockAssets(connection, assetIds, new Set());
      await connection.query('DELETE FROM product_images WHERE product_id = ?', [productId]);
      await connection.query('DELETE FROM products WHERE id = ?', [productId]);
      for (const assetId of assetIds) await this.decrementReference(connection, assetId);
      return true;
    });
  }

  async searchPatternTags(query: string, status: PatternTagStatus): Promise<PatternTag[]> {
    const escaped = escapeLike(query);
    const found = rows(await this.pool.query(
      `SELECT * FROM pattern_tags
       WHERE status = ? AND (? = '' OR name LIKE ? ESCAPE '\\\\')
       ORDER BY name, id LIMIT 100`,
      [status, query, `%${escaped}%`],
    ));
    return found.map(mapPatternTag);
  }

  createPatternTag(name: string, normalizedName: string, principalId: string): Promise<PatternTag> {
    return this.inTransaction(async (connection) => {
      const now = new Date();
      try {
        const inserted = result(await connection.query(
          'INSERT INTO pattern_tags (name, normalized_name, status, created_by, created_at, updated_at) VALUES (?, ?, \'active\', ?, ?, ?)',
          [name, normalizedName, principalId, now, now],
        ));
        const id = Number(inserted.insertId);
        if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Pattern tag insert did not return an ID');
        return { id, name, normalizedName, status: 'active', createdBy: principalId, createdAt: now, updatedAt: now };
      } catch (error) {
        if (!isDuplicateEntry(error)) throw error;
        const found = rows(await connection.query(
          'SELECT * FROM pattern_tags WHERE normalized_name = ? LIMIT 1',
          [normalizedName],
        ));
        if (!found[0]) throw error;
        return mapPatternTag(found[0]);
      }
    });
  }

  updatePatternTag(tagId: number, update: PatternTagUpdate, _principalId: string): Promise<PatternTag | null> {
    return this.inTransaction(async (connection) => {
      const found = rows(await connection.query('SELECT * FROM pattern_tags WHERE id = ? FOR UPDATE', [tagId]));
      if (!found[0]) return null;
      const current = mapPatternTag(found[0]);
      const name = update.name ?? current.name;
      const normalizedName = update.normalizedName ?? current.normalizedName;
      const status = update.status ?? current.status;
      const updatedAt = new Date();
      try {
        await connection.query(
          'UPDATE pattern_tags SET name = ?, normalized_name = ?, status = ?, updated_at = ? WHERE id = ?',
          [name, normalizedName, status, updatedAt, tagId],
        );
      } catch (error) {
        if (isDuplicateEntry(error)) throw new Error('Pattern tag name already exists');
        throw error;
      }
      return { ...current, name, normalizedName, status, updatedAt };
    });
  }

  async applyPatternTagBatch(input: PatternTagBatchInput, principalId: string): Promise<void> {
    const productIds = [...input.productIds].sort((left, right) => left - right);
    const tagIds = [...input.tagIds].sort((left, right) => left - right);
    await this.inTransaction(async (connection) => {
      const products = rows(await connection.query(
        `SELECT id FROM products WHERE id IN (${placeholders(productIds)}) ORDER BY id FOR UPDATE`,
        productIds,
      ));
      if (products.length !== productIds.length) throw new Error('Product selection contains a missing product');
      const tags = rows(await connection.query(
        `SELECT id, status FROM pattern_tags WHERE id IN (${placeholders(tagIds)}) ORDER BY id FOR UPDATE`,
        tagIds,
      ));
      if (tags.length !== tagIds.length) throw new Error('Pattern tag selection contains a missing tag');
      if (input.operation === 'add' && tags.some((tag) => tag.status !== 'active')) {
        throw new Error('Archived pattern tag cannot be attached');
      }
      const current = rows(await connection.query(
        `SELECT product_id, tag_id FROM product_pattern_tags
         WHERE product_id IN (${placeholders(productIds)}) ORDER BY product_id, tag_id FOR UPDATE`,
        productIds,
      ));
      const byProduct = new Map<number, Set<number>>(productIds.map((productId) => [productId, new Set()]));
      for (const row of current) byProduct.get(Number(row.product_id))?.add(Number(row.tag_id));
      for (const productId of productIds) {
        const resulting = new Set(byProduct.get(productId));
        for (const tagId of tagIds) {
          if (input.operation === 'add') resulting.add(tagId);
          else resulting.delete(tagId);
        }
        if (resulting.size > MAX_PRODUCT_PATTERN_TAGS) {
          throw new Error(`A product may have at most ${MAX_PRODUCT_PATTERN_TAGS} pattern tags`);
        }
      }
      for (const productId of productIds) {
        for (const tagId of tagIds) {
          if (input.operation === 'add') {
            await connection.query(
              'INSERT IGNORE INTO product_pattern_tags (product_id, tag_id, created_by) VALUES (?, ?, ?)',
              [productId, tagId, principalId],
            );
          } else {
            await connection.query('DELETE FROM product_pattern_tags WHERE product_id = ? AND tag_id = ?', [productId, tagId]);
          }
        }
      }
    });
  }

  private async lockProduct(connection: AssetTransaction, productId: number): Promise<Row | null> {
    const found = rows(await connection.query('SELECT * FROM products WHERE id = ? FOR UPDATE', [productId]));
    return found[0] ?? null;
  }

  private async lockImageState(
    connection: AssetTransaction,
    productId: number,
    layout: ProductImageLayoutItem[],
  ): Promise<LockedImageState> {
    const existing = await this.lockCurrentImages(connection, productId);
    const requestedIds = new Set(layout.map((item) => item.assetId));
    const allIds = [...new Set([...existing.map((row) => String(row.asset_id)), ...requestedIds])].sort();
    await this.lockAssets(connection, allIds, requestedIds);
    return { existing, layout };
  }

  private lockCurrentImages(connection: AssetTransaction, productId: number): Promise<Row[]> {
    return connection.query(
      `SELECT id, asset_id, role, sort_order, is_primary FROM product_image_assets
       WHERE product_id = ? AND deleted_at IS NULL ORDER BY id FOR UPDATE`,
      [productId],
    ).then(rows);
  }

  private async lockAssets(connection: AssetTransaction, assetIds: string[], requiredReady: Set<string>): Promise<void> {
    if (assetIds.length === 0) return;
    const locked = rows(await connection.query(
      `SELECT id, status, ref_count FROM image_assets WHERE id IN (${placeholders(assetIds)}) ORDER BY id FOR UPDATE`,
      assetIds,
    ));
    const byId = new Map(locked.map((row) => [String(row.id), row]));
    if (locked.length !== assetIds.length) throw new ImageAssetError('ASSET_NOT_FOUND', 404, false, 'Product image asset not found');
    for (const assetId of requiredReady) {
      if (byId.get(assetId)?.status !== 'ready') {
        throw new ImageAssetError('ASSET_NOT_READY', 409, false, 'Product image asset must be ready');
      }
    }
  }

  private async lockTagState(connection: AssetTransaction, productId: number, requestedIds: number[]): Promise<LockedTagState> {
    const existing = rows(await connection.query(
      'SELECT tag_id FROM product_pattern_tags WHERE product_id = ? ORDER BY tag_id FOR UPDATE',
      [productId],
    ));
    const existingIds = new Set(existing.map((row) => Number(row.tag_id)));
    if (requestedIds.length > 0) {
      const locked = rows(await connection.query(
        `SELECT id, status FROM pattern_tags WHERE id IN (${placeholders(requestedIds)}) ORDER BY id FOR UPDATE`,
        requestedIds,
      ));
      if (locked.length !== requestedIds.length) throw new Error('Pattern tag not found');
      for (const tag of locked) {
        const tagId = Number(tag.id);
        if (tag.status !== 'active' && !existingIds.has(tagId)) throw new Error('Archived pattern tag cannot be attached');
      }
    }
    return { existingIds, requestedIds };
  }

  private async applyImageLayout(connection: AssetTransaction, productId: number, state: LockedImageState): Promise<void> {
    const existingByAsset = new Map(state.existing.map((row) => [String(row.asset_id), row]));
    const requestedIds = new Set(state.layout.map((item) => item.assetId));
    if (state.existing.length > 0) {
      await connection.query(
        'UPDATE product_image_assets SET sort_order = sort_order + 1000 WHERE product_id = ? AND deleted_at IS NULL',
        [productId],
      );
    }
    for (const row of state.existing) {
      const assetId = String(row.asset_id);
      if (requestedIds.has(assetId)) continue;
      await connection.query('UPDATE product_image_assets SET deleted_at = NOW(), is_primary = 0 WHERE id = ?', [row.id]);
      await this.decrementReference(connection, assetId);
    }
    for (const item of state.layout) {
      const existing = existingByAsset.get(item.assetId);
      if (existing) {
        await connection.query(
          'UPDATE product_image_assets SET role = ?, sort_order = ?, is_primary = ?, deleted_at = NULL WHERE id = ?',
          [item.role, item.sortOrder, item.isPrimary ? 1 : 0, existing.id],
        );
        continue;
      }
      await connection.query(
        `INSERT INTO product_image_assets (product_id, asset_id, role, sort_order, is_primary, origin_type, deleted_at)
         VALUES (?, ?, ?, ?, ?, 'upload', NULL)
         ON DUPLICATE KEY UPDATE role = VALUES(role), sort_order = VALUES(sort_order),
           is_primary = VALUES(is_primary), origin_type = VALUES(origin_type), deleted_at = NULL`,
        [productId, item.assetId, item.role, item.sortOrder, item.isPrimary ? 1 : 0],
      );
      await connection.query(
        "UPDATE image_assets SET ref_count = ref_count + 1, status = 'ready', recycled_at = NULL, purge_after = NULL WHERE id = ?",
        [item.assetId],
      );
    }
    await connection.query('UPDATE products SET image_count = ? WHERE id = ?', [state.layout.length, productId]);
  }

  private async applyTagSet(
    connection: AssetTransaction,
    productId: number,
    state: LockedTagState,
    principalId: string,
  ): Promise<void> {
    const requested = new Set(state.requestedIds);
    for (const existingId of state.existingIds) {
      if (!requested.has(existingId)) {
        await connection.query('DELETE FROM product_pattern_tags WHERE product_id = ? AND tag_id = ?', [productId, existingId]);
      }
    }
    for (const tagId of state.requestedIds) {
      if (!state.existingIds.has(tagId)) {
        await connection.query(
          'INSERT INTO product_pattern_tags (product_id, tag_id, created_by) VALUES (?, ?, ?)',
          [productId, tagId, principalId],
        );
      }
    }
  }

  private async resequenceExisting(connection: AssetTransaction, rowsToOrder: Row[]): Promise<void> {
    const roleOffsets = new Map<string, number>();
    for (const row of rowsToOrder.sort((left, right) => Number(left.sort_order) - Number(right.sort_order) || Number(left.id) - Number(right.id))) {
      const role = String(row.role);
      const sortOrder = roleOffsets.get(role) ?? 0;
      roleOffsets.set(role, sortOrder + 1);
      await connection.query(
        'UPDATE product_image_assets SET sort_order = ?, is_primary = ? WHERE id = ?',
        [sortOrder, role === 'pattern_original' ? 1 : 0, row.id],
      );
    }
  }

  private async decrementReference(connection: AssetTransaction, assetId: string): Promise<void> {
    await connection.query('UPDATE image_assets SET ref_count = ref_count - 1 WHERE id = ? AND ref_count > 1', [assetId]);
    await connection.query(
      "UPDATE image_assets SET ref_count = 0, status = 'recycled', recycled_at = NOW(), purge_after = DATE_ADD(NOW(), INTERVAL 30 DAY) WHERE id = ? AND ref_count = 1",
      [assetId],
    );
  }

  private async inTransaction<T>(work: (connection: AssetTransaction) => Promise<T>): Promise<T> {
    const connection = await this.pool.getConnection();
    await connection.beginTransaction();
    try {
      const value = await work(connection);
      await connection.commit();
      return value;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}

function normalizeTagIds(tagIds: number[]): number[] {
  return [...new Set(tagIds)].sort((left, right) => left - right);
}

function placeholders(values: unknown[]): string {
  return values.map(() => '?').join(', ');
}

function rows(value: [unknown, unknown]): Row[] {
  return Array.isArray(value[0]) ? value[0] as Row[] : [];
}

function result(value: [unknown, unknown]): Row {
  return value[0] as Row;
}

function date(value: unknown): Date {
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

function mapPatternTag(row: Row): PatternTag {
  return {
    id: Number(row.id),
    name: String(row.name),
    normalizedName: String(row.normalized_name),
    status: row.status as PatternTagStatus,
    createdBy: String(row.created_by),
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
  };
}

function isDuplicateEntry(error: unknown): boolean {
  return error instanceof Error && (error as Error & { code?: string }).code === 'ER_DUP_ENTRY';
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
