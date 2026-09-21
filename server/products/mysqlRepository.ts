import { ImageAssetError } from '../image-assets/errors';
import type { AssetTransaction } from '../image-assets/repository';
import { reconcileProductIssues, type ReconciledProductIssue } from './issues';
import type { ProductRecord, ProductRepository } from './repository';
import type {
  PatternTag,
  PatternTagBatchInput,
  PatternTagStatus,
  PatternTagUpdate,
  ProductDetail,
  ProductImageLayoutItem,
  ProductImageOriginType,
  ProductIssue,
  ProductIssueCode,
  ProductListFilter,
  ProductPage,
  ProductSummary,
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
      await this.reconcileIssues(connection, productId, input, layout);

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
      await this.reconcileIssues(connection, productId, input, layout);
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
      const product = await this.lockProduct(connection, productId);
      if (!product) throw new Error('Product not found');
      const imageState = await this.lockImageState(connection, productId, layout);
      await this.applyImageLayout(connection, productId, imageState);
      await this.reconcileIssues(connection, productId, productInput(product), layout);
    });
  }

  async deleteProductImage(productId: number, assetId: string): Promise<void> {
    await this.inTransaction(async (connection) => {
      const product = await this.lockProduct(connection, productId);
      if (!product) throw new Error('Product not found');
      const existing = await this.lockCurrentImages(connection, productId);
      const target = existing.find((row) => String(row.asset_id) === assetId);
      if (!target) return;
      await this.lockAssets(connection, [assetId], new Set());
      await connection.query('UPDATE product_image_assets SET deleted_at = NOW(), is_primary = 0 WHERE id = ?', [target.id]);
      await this.decrementReference(connection, assetId);
      const remaining = existing.filter((row) => row.id !== target.id);
      await this.resequenceExisting(connection, remaining);
      await connection.query('UPDATE products SET image_count = ?, updated_at = NOW() WHERE id = ?', [remaining.length, productId]);
      await this.reconcileIssues(connection, productId, productInput(product), remaining.map(mapLockedLayout));
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

  async listProducts(filter: ProductListFilter): Promise<ProductPage> {
    const matched = buildMatchedProducts(filter);
    const totalRows = rows(await this.pool.query(
      `SELECT COUNT(*) AS total FROM (${matched.sql}) matched_products`,
      matched.params,
    ));
    const productRows = rows(await this.pool.query(
      `SELECT p.* FROM products p
       JOIN (${matched.sql}) matched_products ON matched_products.id = p.id
       ORDER BY p.updated_at DESC, p.id DESC LIMIT ? OFFSET ?`,
      [...matched.params, filter.limit, filter.offset],
    ));
    const items = await this.enrichProductSummaries(productRows);
    return {
      items,
      total: Number(totalRows[0]?.total ?? 0),
      limit: filter.limit,
      offset: filter.offset,
    };
  }

  async getProductDetail(productId: number): Promise<ProductDetail | null> {
    const productRows = rows(await this.pool.query('SELECT * FROM products WHERE id = ?', [productId]));
    if (!productRows[0]) return null;
    const summaries = await this.enrichProductSummaries(productRows);
    const imageRows = rows(await this.pool.query(
      `SELECT asset_id, role, sort_order, is_primary, origin_type, origin_metadata
       FROM product_image_assets WHERE product_id = ? AND deleted_at IS NULL ORDER BY role, sort_order, id`,
      [productId],
    ));
    const issueRows = rows(await this.pool.query(
      'SELECT * FROM product_issues WHERE product_id = ? ORDER BY status, severity, id',
      [productId],
    ));
    return {
      ...summaries[0],
      images: imageRows.map((row) => ({
        assetId: String(row.asset_id),
        role: row.role as ProductImageLayoutItem['role'],
        sortOrder: Number(row.sort_order),
        isPrimary: Boolean(row.is_primary),
        originType: row.origin_type as ProductImageOriginType,
        originMetadata: jsonObject(row.origin_metadata),
      })),
      issues: issueRows.map(mapProductIssue),
    };
  }

  ignoreIssue(productId: number, issueId: number, principalId: string, note?: string): Promise<boolean> {
    return this.setIssueStatus(productId, issueId, 'ignored', principalId, note);
  }

  reopenIssue(productId: number, issueId: number, principalId: string): Promise<boolean> {
    return this.setIssueStatus(productId, issueId, 'open', principalId);
  }

  private async enrichProductSummaries(productRows: Row[]): Promise<ProductSummary[]> {
    if (productRows.length === 0) return [];
    const productIds = productRows.map((row) => Number(row.id));
    const imageRows = rows(await this.pool.query(
      `SELECT product_id,
         SUM(role = 'pattern_original') AS pattern_count,
         SUM(role = 'fabric_display') AS fabric_display_count,
         SUM(role = 'detail') AS detail_count,
         SUM(role = 'ai_effect') AS ai_effect_count,
         SUM(role = 'unclassified') AS unclassified_count,
         MAX(CASE WHEN is_primary = 1 THEN asset_id END) AS primary_asset_id
       FROM product_image_assets
       WHERE product_id IN (${placeholders(productIds)}) AND deleted_at IS NULL GROUP BY product_id`,
      productIds,
    ));
    const tagRows = rows(await this.pool.query(
      `SELECT ppt.product_id, pt.id, pt.name, pt.status
       FROM product_pattern_tags ppt JOIN pattern_tags pt ON pt.id = ppt.tag_id
       WHERE ppt.product_id IN (${placeholders(productIds)}) ORDER BY ppt.product_id, pt.name, pt.id`,
      productIds,
    ));
    const issueRows = rows(await this.pool.query(
      `SELECT product_id, COUNT(*) AS open_issue_count FROM product_issues
       WHERE product_id IN (${placeholders(productIds)}) AND status = 'open' GROUP BY product_id`,
      productIds,
    ));
    const imagesByProduct = new Map(imageRows.map((row) => [Number(row.product_id), row]));
    const tagsByProduct = new Map<number, ProductSummary['patternTags']>();
    for (const row of tagRows) {
      const productId = Number(row.product_id);
      const list = tagsByProduct.get(productId) ?? [];
      list.push({ id: Number(row.id), name: String(row.name), status: row.status as PatternTagStatus });
      tagsByProduct.set(productId, list);
    }
    const issuesByProduct = new Map(issueRows.map((row) => [Number(row.product_id), Number(row.open_issue_count)]));
    return productRows.map((row) => {
      const id = Number(row.id);
      const image = imagesByProduct.get(id);
      const openIssueCount = issuesByProduct.get(id) ?? 0;
      return {
        ...mapProduct(row),
        categoryCounts: {
          patternOriginal: Number(image?.pattern_count ?? 0),
          fabricDisplay: Number(image?.fabric_display_count ?? 0),
          detail: Number(image?.detail_count ?? 0),
          aiEffect: Number(image?.ai_effect_count ?? 0),
          unclassified: Number(image?.unclassified_count ?? 0),
        },
        primaryAssetId: image?.primary_asset_id ? String(image.primary_asset_id) : undefined,
        patternTags: tagsByProduct.get(id) ?? [],
        reviewStatus: openIssueCount > 0 ? 'needs_attention' : 'reviewed',
        openIssueCount,
      };
    });
  }

  private setIssueStatus(
    productId: number,
    issueId: number,
    status: 'open' | 'ignored',
    principalId: string,
    note?: string,
  ): Promise<boolean> {
    return this.inTransaction(async (connection) => {
      const found = rows(await connection.query(
        'SELECT id, product_id FROM product_issues WHERE id = ? FOR UPDATE',
        [issueId],
      ));
      if (!found[0] || Number(found[0].product_id) !== productId) return false;
      if (status === 'ignored') {
        await connection.query(
          "UPDATE product_issues SET status = 'ignored', resolution_note = ?, resolved_by = ?, resolved_at = NOW() WHERE id = ?",
          [note ?? '', principalId, issueId],
        );
      } else {
        await connection.query(
          "UPDATE product_issues SET status = 'open', resolution_note = NULL, resolved_by = NULL, resolved_at = NULL WHERE id = ?",
          [issueId],
        );
      }
      return true;
    });
  }

  private async reconcileIssues(
    connection: AssetTransaction,
    productId: number,
    input: Pick<ProductWriteInput, 'productName' | 'composition' | 'weight' | 'width'>,
    layout: Array<Pick<ProductImageLayoutItem, 'role'>>,
  ): Promise<void> {
    const existingRows = rows(await connection.query(
      'SELECT * FROM product_issues WHERE product_id = ? ORDER BY id FOR UPDATE',
      [productId],
    ));
    const existing = existingRows.map(mapReconciledIssue);
    const reconciled = reconcileProductIssues({ ...input, images: layout }, existing);
    for (const issue of reconciled) {
      if (issue.id === undefined) {
        await connection.query(
          `INSERT INTO product_issues
           (product_id, product_image_asset_id, code, severity, field_name, message, source_ref, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [productId, issue.productImageAssetId ?? null, issue.code, issue.severity, issue.fieldName, issue.message, issue.sourceRef, issue.status],
        );
      } else {
        await connection.query(
          `UPDATE product_issues SET severity = ?, message = ?, status = ?, resolution_note = ?,
             resolved_by = ?, resolved_at = ? WHERE id = ?`,
          [issue.severity, issue.message, issue.status, issue.resolutionNote ?? null, issue.resolvedBy ?? null, issue.resolvedAt ?? null, issue.id],
        );
      }
    }
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

function buildMatchedProducts(filter: ProductListFilter): { sql: string; params: unknown[] } {
  const joins: string[] = [];
  const where: string[] = ['1 = 1'];
  const params: unknown[] = [];
  let having = '';
  if (filter.tagIds.length > 0) {
    joins.push(
      `JOIN product_pattern_tags filter_tags
       ON filter_tags.product_id = p.id AND filter_tags.tag_id IN (${placeholders(filter.tagIds)})`,
    );
    params.push(...filter.tagIds);
    having = ` HAVING COUNT(DISTINCT filter_tags.tag_id) = ${filter.tagIds.length}`;
  }
  if (filter.q) {
    const like = `%${escapeLike(filter.q)}%`;
    where.push(`(
      p.item_no LIKE ? ESCAPE '\\\\' OR p.product_name LIKE ? ESCAPE '\\\\'
      OR p.composition LIKE ? ESCAPE '\\\\'
      OR EXISTS (
        SELECT 1 FROM product_pattern_tags search_links
        JOIN pattern_tags search_tags ON search_tags.id = search_links.tag_id
        WHERE search_links.product_id = p.id AND search_tags.name LIKE ? ESCAPE '\\\\'
      )
    )`);
    params.push(like, like, like, like);
  }
  if (filter.reviewStatus === 'reviewed') {
    where.push("NOT EXISTS (SELECT 1 FROM product_issues review_issues WHERE review_issues.product_id = p.id AND review_issues.status = 'open')");
  } else if (filter.reviewStatus === 'needs_attention') {
    where.push("EXISTS (SELECT 1 FROM product_issues review_issues WHERE review_issues.product_id = p.id AND review_issues.status = 'open')");
  }
  if (filter.issueCodes.length > 0) {
    where.push(`EXISTS (
      SELECT 1 FROM product_issues code_issues
      WHERE code_issues.product_id = p.id AND code_issues.status = 'open'
        AND code_issues.code IN (${placeholders(filter.issueCodes)})
    )`);
    params.push(...filter.issueCodes);
  }
  if (filter.imageState === 'missing_pattern') {
    where.push("NOT EXISTS (SELECT 1 FROM product_image_assets state_images WHERE state_images.product_id = p.id AND state_images.deleted_at IS NULL AND state_images.role = 'pattern_original')");
  } else if (filter.imageState === 'has_unclassified') {
    where.push("EXISTS (SELECT 1 FROM product_image_assets state_images WHERE state_images.product_id = p.id AND state_images.deleted_at IS NULL AND state_images.role = 'unclassified')");
  } else if (filter.imageState === 'complete') {
    where.push("EXISTS (SELECT 1 FROM product_image_assets state_images WHERE state_images.product_id = p.id AND state_images.deleted_at IS NULL AND state_images.role = 'pattern_original')");
    where.push("NOT EXISTS (SELECT 1 FROM product_image_assets state_images WHERE state_images.product_id = p.id AND state_images.deleted_at IS NULL AND state_images.role = 'unclassified')");
  }
  if (filter.duplicateItemNo) {
    where.push('EXISTS (SELECT 1 FROM products duplicates WHERE duplicates.item_no = p.item_no AND duplicates.id <> p.id)');
  }
  return {
    sql: `SELECT p.id FROM products p ${joins.join('\n')} WHERE ${where.join(' AND ')} GROUP BY p.id${having}`,
    params,
  };
}

function mapProduct(row: Row): ProductRecord {
  return {
    id: Number(row.id),
    itemNo: String(row.item_no ?? ''),
    productName: String(row.product_name ?? ''),
    composition: String(row.composition ?? ''),
    weight: String(row.weight ?? ''),
    width: String(row.width ?? ''),
    imageCount: Number(row.image_count ?? 0),
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
  };
}

function productInput(row: Row): Pick<ProductWriteInput, 'productName' | 'composition' | 'weight' | 'width'> {
  return {
    productName: String(row.product_name ?? ''),
    composition: String(row.composition ?? ''),
    weight: String(row.weight ?? ''),
    width: String(row.width ?? ''),
  };
}

function mapLockedLayout(row: Row): ProductImageLayoutItem {
  const role = row.role as ProductImageLayoutItem['role'];
  return {
    assetId: String(row.asset_id),
    role,
    sortOrder: Number(row.sort_order),
    isPrimary: role === 'pattern_original',
  };
}

function mapReconciledIssue(row: Row): ReconciledProductIssue {
  return {
    id: Number(row.id),
    productImageAssetId: row.product_image_asset_id == null ? undefined : Number(row.product_image_asset_id),
    code: row.code as ProductIssueCode,
    severity: row.severity as ReconciledProductIssue['severity'],
    fieldName: String(row.field_name ?? ''),
    message: String(row.message ?? ''),
    sourceRef: String(row.source_ref ?? ''),
    status: row.status as ReconciledProductIssue['status'],
    resolutionNote: row.resolution_note == null ? undefined : String(row.resolution_note),
    resolvedBy: row.resolved_by == null ? undefined : String(row.resolved_by),
    resolvedAt: row.resolved_at == null ? undefined : date(row.resolved_at),
  };
}

function mapProductIssue(row: Row): ProductIssue {
  return {
    ...mapReconciledIssue(row),
    id: Number(row.id),
    productId: Number(row.product_id),
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
  };
}

function jsonObject(value: unknown): Record<string, unknown> | undefined {
  if (value == null) return undefined;
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string') return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}
