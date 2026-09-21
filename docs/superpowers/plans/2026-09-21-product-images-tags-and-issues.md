# Product Images, Pattern Tags, and Issues Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a production-ready product library with four editable image categories, persistent pattern tags, server-side search/filtering, and structured product issues.

**Architecture:** Extend the existing `server/image-assets/` product aggregate rather than create a second product backend. MySQL remains authoritative for products, image associations, tags, and issues; the React client consumes one stable product contract and keeps only metadata in IndexedDB. Product fields, the complete tag set, and the complete image layout are validated and saved atomically.

**Tech Stack:** TypeScript 5.8, Express 4, Zod 4, MySQL 8/InnoDB, React 19, Vite 6, Sharp 0.35, Node 22 test runner, existing private-COS/local image asset adapters.

**Spec:** `docs/superpowers/specs/2026-09-20-product-image-categories-and-wps-import-design.md`

## Global Constraints

- Product image roles are exactly `pattern_original`, `fabric_display`, `detail`, `ai_effect`, and migration-only `unclassified`.
- A product has at most one active `pattern_original`, exactly that image is primary, and at most 20 active image associations total.
- A product has at most 12 pattern tags; normalized names use Unicode NFKC, lower-case conversion, and outer-whitespace trimming.
- Product list filtering happens in MySQL before pagination; do not filter only the 50 rows already loaded in the browser.
- Products with open issues remain searchable and usable; `reviewStatus` is derived from open issue count.
- Keep private storage, validation, signed URL, reference-count, 30-day recovery, and authorization rules unchanged.
- Database changes are additive. Do not delete legacy `product_images`, legacy files, or source workbooks.
- Never persist Base64 images, raw COS keys, local file paths, credentials, or complete signed URLs in IndexedDB.
- Use `npm.cmd` commands on Windows. Each task passes its focused tests before commit.
- Do not stage `.firecrawl/`, personal configuration, or unrelated workspace changes.

## Review Focus

- Two concurrent saves that both try to create a primary image must leave one primary image and a continuous layout; Task 2 locks the product and tests the invariant.
- A tag that differs only by case, full-width characters, or outer whitespace must reuse the existing tag; Task 3 tests normalization and the unique-key recovery path.
- Multiple selected tags must match products containing every selected tag, then apply the requested page; Task 4 tests grouping, count, and pagination order.
- An archived tag already attached to a product must remain visible but cannot be newly attached; Task 3 and Task 5 test both sides.
- A failed atomic save after uploading new assets must preserve the previous product state and leave the unlinked new assets recoverable; Task 2 and Task 7 test rollback and UI retry behavior.

## File Map

Backend domain units:

- `server/products/types.ts` — product roles, layouts, tags, issues, filters, and response contracts.
- `server/products/validation.ts` — Zod schemas and pure layout/tag normalization.
- `server/products/repository.ts` — product aggregate repository interface.
- `server/products/mysqlRepository.ts` — product/tag/issue queries and locked aggregate writes.
- `server/products/service.ts` — business invariants, issue reconciliation, and aggregate orchestration.
- `server/products/routes.ts` — product, image-layout, tag, issue, and batch-tag endpoints.
- `server/products/schema.ts` — additive product-domain DDL and legacy-role backfill.
- `server/products/legacyCompatibility.ts` — role-aware mapping for `product_images` and local JSON fallback records.

Existing backend adapters:

- `server/image-assets/repository.ts` and `mysqlRepository.ts` — retain asset lifecycle methods; delegate product aggregate methods to `server/products/`.
- `server/image-assets/service.ts` — expose asset authorization/readiness checks used by the product service.
- `server/image-assets/productImages.ts` — become a compatibility re-export during route migration.
- `server/image-assets/productRouteScope.ts`, `productServer.ts`, `server/appAssembly.ts`, `server.ts` — mount the new router before legacy handlers.

Frontend units:

- `src/lib/products.ts` — list/detail/save/layout/tag/issue HTTP client.
- `src/components/product-library/ProductFilters.tsx` — keyword, tag, review, issue, and image filters.
- `src/components/product-library/ProductTable.tsx` — dense paged rows and selection.
- `src/components/product-library/ProductImageViewer.tsx` — four-category read-only viewer.
- `src/components/product-library/ProductEditor.tsx` — fields, tag selector, issues, and category editors.
- `src/components/product-library/ProductImageCategory.tsx` — upload, replace, delete, reorder, and move controls.
- `src/components/ProductLibrary.tsx` — data orchestration only.

---

### Task 1: Product Domain Contracts and Additive Schema

**Files:**
- Create: `server/products/types.ts`
- Create: `server/products/validation.ts`
- Create: `server/products/validation.test.ts`
- Create: `server/products/schema.ts`
- Create: `server/products/schema.test.ts`
- Modify: `server/image-assets/schema.ts`

**Interfaces:**
- Consumes: existing `AssetTransaction`, `ImageAssetError`, and product/image foreign keys.
- Produces: `ProductImageRole`, `ProductImageLayoutItem`, `ProductWriteInput`, `PatternTag`, `ProductIssue`, `ProductListFilter`, `validateImageLayout()`, `normalizePatternTagName()`, and `initializeProductDomainSchema()`.

- [ ] **Step 1: Write failing validation and DDL tests**

```ts
test('layout accepts four formal roles plus unclassified and enforces one primary', () => {
  const layout = validateImageLayout([
    { assetId: 'a', role: 'pattern_original', sortOrder: 0 },
    { assetId: 'b', role: 'fabric_display', sortOrder: 0 },
  ]);
  assert.deepEqual(layout.map((item) => item.isPrimary), [true, false]);
  assert.throws(() => validateImageLayout([
    { assetId: 'a', role: 'pattern_original', sortOrder: 0 },
    { assetId: 'b', role: 'pattern_original', sortOrder: 1 },
  ]), /one pattern_original/);
});

test('tag normalization collapses full-width case variants', () => {
  assert.equal(normalizePatternTagName('  Ｆｌｏｒａｌ  '), 'floral');
});

test('schema creates tag issue and import-support tables without dropping legacy data', async () => {
  await initializeProductDomainSchema(connection);
  assert.match(sql(connection), /CREATE TABLE IF NOT EXISTS pattern_tags/);
  assert.match(sql(connection), /CREATE TABLE IF NOT EXISTS product_pattern_tags/);
  assert.match(sql(connection), /CREATE TABLE IF NOT EXISTS product_issues/);
  assert.doesNotMatch(sql(connection), /DROP TABLE|DROP COLUMN/);
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node scripts/run-ts-tests.mjs server/products/validation.test.ts server/products/schema.test.ts`

Expected: FAIL because the product-domain modules do not exist.

- [ ] **Step 3: Implement exact contracts and pure validators**

```ts
export type ProductImageRole = 'pattern_original' | 'fabric_display' | 'detail' | 'ai_effect' | 'unclassified';
export type ProductReviewStatus = 'reviewed' | 'needs_attention';
export type ProductIssueStatus = 'open' | 'resolved' | 'ignored';

export interface ProductImageLayoutItem {
  assetId: string;
  role: ProductImageRole;
  sortOrder: number;
  isPrimary: boolean;
}

export interface ProductWriteInput {
  itemNo: string;
  productName: string;
  composition: string;
  weight: string;
  width: string;
  patternTagIds: number[];
  images: Array<Omit<ProductImageLayoutItem, 'isPrimary'>>;
}

export function normalizePatternTagName(name: string): string {
  return name.normalize('NFKC').trim().toLocaleLowerCase('zh-CN');
}
```

`validateImageLayout()` must reject duplicate asset IDs, more than 20 items, more than one `pattern_original`, and non-contiguous `sortOrder` values within each role. It derives `isPrimary` rather than trusting the client.

- [ ] **Step 4: Implement additive DDL**

```sql
ALTER TABLE product_image_assets
  ADD COLUMN IF NOT EXISTS origin_type VARCHAR(32) NOT NULL DEFAULT 'upload',
  ADD COLUMN IF NOT EXISTS origin_metadata JSON NULL;

CREATE TABLE IF NOT EXISTS pattern_tags (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(32) NOT NULL,
  normalized_name VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  created_by VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pattern_tags_normalized_name (normalized_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

Add `product_pattern_tags` and `product_issues` exactly as specified, including product/tag foreign keys, `product_id + tag_id` primary key, tag reverse index, issue lookup index, and an issue dedupe key over product/code/field/source. Make `initializeImageAssetSchema()` call `initializeProductDomainSchema()` after its existing six tables exist.

Also add `role`, `is_primary`, `origin_type`, and `origin_metadata` columns to legacy `product_images` with compatibility defaults. Existing `sort_order` remains the ordering column. These additions let feature-off reads expose the same role contract without creating asset rows.

- [ ] **Step 5: Run tests and commit**

Run: `node scripts/run-ts-tests.mjs server/products/validation.test.ts server/products/schema.test.ts server/image-assets/mysqlRepository.test.ts`

Expected: PASS, including existing additive image schema assertions updated for the delegated product schema.

```powershell
git add server/products server/image-assets/schema.ts server/image-assets/mysqlRepository.test.ts
git commit -m "feat: add product image tag and issue schema"
```

### Task 2: Atomic Product Aggregate and Image Layout

**Files:**
- Create: `server/products/repository.ts`
- Create: `server/products/mysqlRepository.ts`
- Create: `server/products/mysqlRepository.test.ts`
- Create: `server/products/service.ts`
- Create: `server/products/service.test.ts`
- Modify: `server/image-assets/repository.ts`
- Modify: `server/image-assets/mysqlRepository.ts`
- Modify: `server/image-assets/service.ts`

**Interfaces:**
- Consumes: Task 1 contracts and existing ready-asset/ref-count lifecycle.
- Produces: `ProductRepository`, `MySqlProductRepository`, `ProductService.saveProduct()`, `replaceImageLayout()`, `deleteProductImage()`, and `deleteProduct()`.

- [ ] **Step 1: Write failing aggregate tests**

```ts
test('save locks product and atomically replaces fields tags and layout', async () => {
  await service.saveProduct(7, inputWithTagsAndFourRoles, 'admin-1');
  assert.deepEqual(repository.transactions, ['BEGIN', 'COMMIT']);
  assert.deepEqual(repository.layout(7).map((x) => [x.role, x.sortOrder, x.isPrimary]), [
    ['pattern_original', 0, true],
    ['fabric_display', 0, false],
    ['detail', 0, false],
    ['ai_effect', 0, false],
  ]);
});

test('failed image association rolls back fields tags and references', async () => {
  repository.failOnAsset = 'asset-not-ready';
  await assert.rejects(service.saveProduct(7, inputWithBadAsset, 'admin-1'), /ready/);
  assert.deepEqual(repository.transactions, ['BEGIN', 'ROLLBACK']);
  assert.deepEqual(repository.snapshot(7), before);
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node scripts/run-ts-tests.mjs server/products/mysqlRepository.test.ts server/products/service.test.ts`

Expected: FAIL because aggregate repository and service are absent.

- [ ] **Step 3: Implement the repository transaction boundary**

```ts
export interface ProductRepository {
  createProduct(input: ProductWriteInput, principalId: string): Promise<ProductRecord>;
  updateProduct(productId: number, input: ProductWriteInput, principalId: string): Promise<ProductRecord | null>;
  replaceImageLayout(productId: number, layout: ProductImageLayoutItem[]): Promise<void>;
  deleteProductImage(productId: number, assetId: string): Promise<void>;
  deleteProduct(productId: number): Promise<boolean>;
}
```

Within one transaction: lock the product, current links, requested `image_assets`, and requested tags; validate ready assets and active/newly retained tags; diff old/new links; adjust reference counts once; upsert layout; soft-delete removed links; replace tag joins; update `image_count`; update fields; reconcile issues; commit. Use a temporary sort offset before assigning final per-role order so unique ordering constraints cannot collide.

- [ ] **Step 4: Route existing asset methods through the product service without duplicating lifecycle logic**

```ts
export class ProductService {
  constructor(private readonly products: ProductRepository) {}

  saveProduct(productId: number | null, input: ProductWriteInput, principalId: string) {
    const validated = validateProductWrite(input);
    return productId === null
      ? this.products.createProduct(validated, principalId)
      : this.products.updateProduct(productId, validated, principalId);
  }
}
```

Keep existing image-asset upload/finalize/read methods in `ImageAssetService`. Remove product aggregate SQL from `MySqlAssetRepository` only after equivalent `MySqlProductRepository` tests pass; leave compatibility delegation methods until Task 5 switches all callers.

- [ ] **Step 5: Run tests and commit**

Run: `node scripts/run-ts-tests.mjs server/products server/image-assets/service.test.ts server/image-assets/mysqlRepository.test.ts`

Expected: PASS with rollback, 20-image, single-primary, continuous-order, ready-asset, and reference-count tests.

```powershell
git add server/products server/image-assets/repository.ts server/image-assets/mysqlRepository.ts server/image-assets/service.ts server/image-assets/service.test.ts server/image-assets/mysqlRepository.test.ts
git commit -m "feat: save product fields tags and image layout atomically"
```

### Task 3: Pattern Tag Vocabulary and Batch Assignment

**Files:**
- Modify: `server/products/repository.ts`
- Modify: `server/products/mysqlRepository.ts`
- Modify: `server/products/service.ts`
- Modify: `server/products/mysqlRepository.test.ts`
- Modify: `server/products/service.test.ts`

**Interfaces:**
- Consumes: Task 2 product transactions and Task 1 normalization.
- Produces: `searchPatternTags()`, `createPatternTag()`, `updatePatternTag()`, and `applyPatternTagBatch()`.

- [ ] **Step 1: Write failing vocabulary and batch tests**

```ts
test('create reuses a normalized duplicate after unique-key race', async () => {
  repository.existingTag = { id: 3, name: 'Floral', normalizedName: 'floral', status: 'active' };
  assert.deepEqual(await service.createPatternTag(' ＦＬＯＲＡＬ ', 'admin-1'), repository.existingTag);
});

test('batch add rejects the entire batch when one product would exceed twelve tags', async () => {
  await assert.rejects(
    service.applyPatternTagBatch({ productIds: [1, 2], operation: 'add', tagIds: [9] }, 'admin-1'),
    /12 pattern tags/,
  );
  assert.deepEqual(repository.transactions, ['BEGIN', 'ROLLBACK']);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `node scripts/run-ts-tests.mjs server/products/service.test.ts server/products/mysqlRepository.test.ts`

Expected: FAIL because tag vocabulary methods are not implemented.

- [ ] **Step 3: Implement tag vocabulary operations**

```ts
export interface PatternTagUpdate {
  name?: string;
  status?: 'active' | 'archived';
}

export interface PatternTagBatchInput {
  productIds: number[];
  operation: 'add' | 'remove';
  tagIds: number[];
}
```

Creation validates display length before normalization, inserts `name + normalized_name`, and on `ER_DUP_ENTRY` reads and returns the existing row. Rename performs the same unique check. Archive preserves joins. Batch operations lock all selected products and tag rows in numeric order, reject archived tags for `add`, precompute every resulting count, then apply the whole batch or none.

- [ ] **Step 4: Add explicit archived-tag retention tests**

```ts
test('editing a product may retain its archived tag but cannot newly attach it', async () => {
  await service.saveProduct(1, inputKeepingArchivedTag, 'admin-1');
  await assert.rejects(service.saveProduct(2, inputAddingArchivedTag, 'admin-1'), /archived/);
});
```

Run: `node scripts/run-ts-tests.mjs server/products`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add server/products
git commit -m "feat: manage product pattern tags"
```

### Task 4: Issues, Review Status, and Server-Side Product Search

**Files:**
- Modify: `server/products/types.ts`
- Modify: `server/products/repository.ts`
- Modify: `server/products/mysqlRepository.ts`
- Modify: `server/products/service.ts`
- Create: `server/products/issues.ts`
- Create: `server/products/issues.test.ts`
- Modify: `server/products/mysqlRepository.test.ts`

**Interfaces:**
- Consumes: Tasks 1-3 product aggregate.
- Produces: `reconcileProductIssues()`, `ignoreIssue()`, `reopenIssue()`, `listProducts(filter)`, `getProductDetail()`, and `ProductPage`.

- [ ] **Step 1: Write failing issue and filter tests**

```ts
test('missing fields and image facts reconcile idempotently', async () => {
  const first = reconcileProductIssues(productWithoutPattern, []);
  const second = reconcileProductIssues(productWithoutPattern, first);
  assert.deepEqual(second, first);
  assert.deepEqual(first.map((x) => x.code).sort(), ['MISSING_COMPOSITION', 'MISSING_PATTERN_ORIGINAL']);
});

test('tag all-mode filters before stable pagination', async () => {
  const page = await repository.listProducts({ q: '棉', tagIds: [2, 5], tagMode: 'all', limit: 50, offset: 50 });
  assert.match(repository.lastSql, /HAVING COUNT\(DISTINCT filter_tags\.tag_id\) = 2/);
  assert.equal(page.offset, 50);
  assert.equal(typeof page.total, 'number');
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `node scripts/run-ts-tests.mjs server/products/issues.test.ts server/products/mysqlRepository.test.ts`

Expected: FAIL because issue reconciliation and filtered paging do not exist.

- [ ] **Step 3: Implement issue reconciliation and manual actions**

```ts
export const FACT_ISSUE_CODES = [
  'MISSING_PRODUCT_NAME', 'MISSING_COMPOSITION', 'MISSING_WEIGHT', 'MISSING_WIDTH',
  'MISSING_PATTERN_ORIGINAL', 'IMAGE_UNCLASSIFIED',
] as const;

export interface ProductPage {
  items: ProductSummary[];
  total: number;
  limit: number;
  offset: number;
}
```

Reconciliation upserts open factual issues using the dedupe key, resolves facts no longer true, and never reopens an ignored issue automatically. `reviewStatus` is `needs_attention` when the batch issue aggregate has `openIssueCount > 0`, otherwise `reviewed`. Ignore and reopen record actor/time and reject issue IDs belonging to another product.

- [ ] **Step 4: Implement one filtered ID query followed by batched enrichments**

The first query returns matching product IDs and total count with stable `updated_at DESC, id DESC` order. Separate bounded `IN (...)` queries load image counts/primary association, tag summaries, issue counts, and source summaries. Search `q` against item number, product name, composition, and active or attached archived tag names. Do not execute queries inside a per-product loop.

```ts
export interface ProductListFilter {
  q?: string;
  tagIds: number[];
  tagMode: 'all';
  reviewStatus?: ProductReviewStatus;
  issueCodes: string[];
  imageState?: 'missing_pattern' | 'has_unclassified' | 'complete';
  batchId?: number;
  duplicateItemNo?: boolean;
  limit: number;
  offset: number;
}
```

- [ ] **Step 5: Run tests and commit**

Run: `node scripts/run-ts-tests.mjs server/products`

Expected: PASS, including combined filters, escaped wildcard input, empty tag list, out-of-range offset, and no N+1 query test.

```powershell
git add server/products
git commit -m "feat: add product issues and server-side filtering"
```

### Task 5: Product, Tag, Layout, and Issue HTTP API

**Files:**
- Create: `server/products/routes.ts`
- Create: `server/products/routes.test.ts`
- Modify: `server/image-assets/productRouteScope.ts`
- Modify: `server/image-assets/productRouteScope.test.ts`
- Modify: `server/image-assets/productServer.ts`
- Modify: `server/image-assets/productImages.ts`
- Modify: `server/appAssembly.ts`
- Modify: `server/image-assets/appAssembly.test.ts`
- Modify: `server.ts`

**Interfaces:**
- Consumes: Tasks 2-4 services and existing product authentication/principal ID.
- Produces: mounted `/api/products` and `/api/product-pattern-tags` contracts from the spec.

- [ ] **Step 1: Write failing route contract tests**

```ts
test('list parses combined filters and returns a page envelope', async () => {
  const response = await fetch(`${base}/api/products?q=floral&tagIds=2,5&tagMode=all&limit=50&offset=0`, { headers: auth });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { items: expectedItems, total: 2, limit: 50, offset: 0 });
});

test('layout rejects a stale asset set without partial mutation', async () => {
  const response = await fetch(`${base}/api/products/7/image-layout`, json('PATCH', staleLayout));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, 'PRODUCT_LAYOUT_STALE');
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `node scripts/run-ts-tests.mjs server/products/routes.test.ts server/image-assets/productRouteScope.test.ts server/image-assets/appAssembly.test.ts`

Expected: FAIL because the new router and route ownership are absent.

- [ ] **Step 3: Implement strict schemas and endpoints**

```ts
router.get('/', listProductsHandler);
router.post('/', saveNewProductHandler);
router.get('/:id', getProductHandler);
router.put('/:id', updateProductHandler);
router.post('/:id/images', attachImagesHandler);
router.patch('/:id/image-layout', replaceLayoutHandler);
router.delete('/:id/images/:assetId', deleteImageHandler);
router.post('/:id/issues/:issueId/ignore', ignoreIssueHandler);
router.post('/:id/issues/:issueId/reopen', reopenIssueHandler);
router.post('/batch-pattern-tags', batchTagsHandler);
```

Mount the tag router at `/api/product-pattern-tags`. Limit JSON mutations to 64 KiB, reject unknown body/query fields, validate safe integer IDs, cap batch products at 100, return stable `{ error: { code, message, requestId, retryable } }`, and preserve authorization on every route.

- [ ] **Step 4: Switch route ownership without breaking legacy import/export**

Extend `isProductImageApiRequest()` for `image-layout`, tag batches, and issue actions. Keep `/api/products/import` and `/api/products/export` delegated to legacy handlers until the second implementation plan replaces import. Keep numeric legacy image deletion/read fallback available. `productImages.ts` re-exports descriptors/helpers needed by callers but no longer owns aggregate CRUD.

- [ ] **Step 5: Run tests and commit**

Run: `node scripts/run-ts-tests.mjs server/products server/image-assets/productRouteScope.test.ts server/image-assets/productServer.test.ts server/image-assets/appAssembly.test.ts`

Expected: PASS for feature-on ownership, feature-off delegation, auth denial, malformed inputs, and legacy import/export delegation.

```powershell
git add server/products server/image-assets/productRouteScope.ts server/image-assets/productRouteScope.test.ts server/image-assets/productServer.ts server/image-assets/productImages.ts server/appAssembly.ts server/image-assets/appAssembly.test.ts server.ts
git commit -m "feat: expose product categories tags and issues API"
```

### Task 6: Frontend Product Contracts, Client, and Metadata Cache

**Files:**
- Modify: `src/types.ts`
- Create: `src/lib/products.ts`
- Create: `src/lib/products.test.ts`
- Modify: `src/lib/productImages.ts`
- Modify: `src/lib/productImages.test.ts`
- Modify: `src/lib/db.ts`
- Modify: `src/lib/db.test.ts`

**Interfaces:**
- Consumes: Task 5 JSON API.
- Produces: typed `listProducts()`, `getProduct()`, `saveProduct()`, `patchImageLayout()`, tag and issue clients, and metadata-only cache records.

- [ ] **Step 1: Write failing mapping and request tests**

```ts
test('maps four roles tags issues and page metadata', async () => {
  const page = await listProducts(apiFetch, { q: 'floral', tagIds: [2, 5], limit: 50, offset: 0 });
  assert.equal(page.items[0].images?.[2].role, 'ai_effect');
  assert.deepEqual(page.items[0].patternTags, [{ id: 2, name: '碎花' }, { id: 5, name: '春夏' }]);
  assert.equal(page.items[0].reviewStatus, 'needs_attention');
});

test('cache keeps tag and review metadata but strips image URLs', async () => {
  await putProduct(productWithDescriptors, memoryIndexedDb);
  assert.deepEqual(stored.patternTags, productWithDescriptors.patternTags);
  assert.equal('images' in stored, false);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `node scripts/run-ts-tests.mjs src/lib/products.test.ts src/lib/productImages.test.ts src/lib/db.test.ts`

Expected: FAIL because page/tag/issue contracts are missing.

- [ ] **Step 3: Implement frontend types and client methods**

```ts
export type ProductImageRole = 'pattern_original' | 'fabric_display' | 'detail' | 'ai_effect' | 'unclassified' | 'legacy';
export interface PatternTagSummary { id: number; name: string; status?: 'active' | 'archived'; }
export interface ProductPage { items: ProductItem[]; total: number; limit: number; offset: number; }
export interface ProductListOptions {
  q?: string; tagIds?: number[]; reviewStatus?: 'reviewed' | 'needs_attention';
  issueCodes?: string[]; imageState?: string; batchId?: number; duplicateItemNo?: boolean;
  limit?: number; offset?: number;
}
```

Build query strings with `URLSearchParams`; send `patternTagIds` plus complete `images` on save; use dedicated layout, issue, and batch-tag methods. Map unknown roles to `unclassified`, never to a formal category.

- [ ] **Step 4: Preserve the compatibility facade and metadata-only cache**

Re-export current names from `src/lib/productImages.ts` to avoid a flag-day change. Bump IndexedDB to v4 only if an index is required; otherwise keep v3 and extend `toMetadata()` with `patternTags`, `reviewStatus`, and `openIssueCount`. Never cache descriptor URLs.

- [ ] **Step 5: Run tests and commit**

Run: `node scripts/run-ts-tests.mjs src/lib/products.test.ts src/lib/productImages.test.ts src/lib/db.test.ts`

Expected: PASS.

```powershell
git add src/types.ts src/lib/products.ts src/lib/products.test.ts src/lib/productImages.ts src/lib/productImages.test.ts src/lib/db.ts src/lib/db.test.ts
git commit -m "feat: add product tags issues and layout client"
```

### Task 7: Product Library UI, Four-Category Viewer, and Editor

**Files:**
- Create: `src/components/product-library/ProductFilters.tsx`
- Create: `src/components/product-library/ProductFilters.test.ts`
- Create: `src/components/product-library/ProductTable.tsx`
- Create: `src/components/product-library/ProductTable.test.ts`
- Create: `src/components/product-library/ProductImageViewer.tsx`
- Create: `src/components/product-library/ProductImageViewer.test.ts`
- Create: `src/components/product-library/ProductEditor.tsx`
- Create: `src/components/product-library/ProductEditor.test.ts`
- Create: `src/components/product-library/ProductImageCategory.tsx`
- Modify: `src/components/ProductLibrary.tsx`
- Modify: `src/components/ProductLibrary.test.ts`

**Interfaces:**
- Consumes: Task 6 client and types plus existing `DescriptorImage`/upload helpers.
- Produces: paged/filterable list, four-tab viewer, atomic editor, and batch tag controls.

- [ ] **Step 1: Write failing pure interaction and static-render tests**

```ts
test('selected tags use all-match semantics and reset to page zero', () => {
  const next = reduceProductQuery(current, { type: 'set-tags', tagIds: [2, 5] });
  assert.deepEqual(next.tagIds, [2, 5]);
  assert.equal(next.offset, 0);
});

test('viewer exposes only four formal tabs and opens the clicked role', () => {
  const markup = renderToStaticMarkup(<ProductImageViewer product={product} initialAssetId="detail-2" />);
  assert.match(markup, /花型原图/);
  assert.match(markup, /面料展示图/);
  assert.match(markup, /细节图/);
  assert.match(markup, /AI效果图/);
  assert.doesNotMatch(markup, /待分类.*role="tab"/);
});

test('editor blocks the thirteenth tag and twenty-first image', () => {
  assert.equal(canAddPatternTag(twelveTags), false);
  assert.equal(canAddProductImage(twentyImages), false);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `node scripts/run-ts-tests.mjs src/components/product-library src/components/ProductLibrary.test.ts`

Expected: FAIL because the extracted components do not exist.

- [ ] **Step 3: Implement filters and table**

`ProductFilters` owns debounced keyword input and controlled tag/review/issue/image selectors; it emits a full `ProductListOptions` value and resets the offset on every filter change. `ProductTable` renders the pattern original only as the lead thumbnail, up to three tags plus `+N`, category counts, review badge, source summary, selection, and explicit pager controls using server `total`.

```ts
export interface ProductFiltersProps {
  value: ProductListOptions;
  availableTags: PatternTagSummary[];
  onChange(value: ProductListOptions): void;
}
```

- [ ] **Step 4: Implement viewer and editor**

`ProductImageViewer` groups descriptors by formal role, supports arrow keys, Escape, touch swipes, and a missing-pattern placeholder. `ProductEditor` keeps a draft of fields, full tags, issues, existing layout, and uploaded assets. `ProductImageCategory` exposes upload/replace/delete/reorder/move controls; `unclassified` renders only in the editor with amber styling. On save, submit one aggregate request; on failure retain the draft and display stable error/request ID.

```ts
export interface ProductEditorDraft {
  fields: Pick<ProductItem, 'itemNo' | 'productName' | 'composition' | 'weight' | 'width'>;
  patternTagIds: number[];
  images: Array<{ assetId: string; role: Exclude<ProductImageRole, 'legacy'>; sortOrder: number }>;
}
```

Preserve the existing thumbnail event regression while changing its detail from a flat index to `{ productId, assetId }`, so reordered category layouts still open the intended image.

- [ ] **Step 5: Add batch-tag and retry-path tests, then commit**

```ts
test('batch tag removal sends only the tag difference', async () => {
  await applySelectedProductTags(apiFetch, ['7', '8'], 'remove', [3]);
  assert.deepEqual(JSON.parse(request.body), { productIds: [7, 8], operation: 'remove', tagIds: [3] });
});

test('failed save keeps editor open with uploaded assets in the draft', async () => {
  const next = reduceEditorState(stateWithUpload, { type: 'save-failed', error: clientError });
  assert.equal(next.open, true);
  assert.equal(next.draft.images.some((x) => x.assetId === 'new-asset'), true);
});
```

Run: `node scripts/run-ts-tests.mjs src/components/product-library src/components/ProductLibrary.test.ts src/lib/products.test.ts`

Expected: PASS.

```powershell
git add src/components/product-library src/components/ProductLibrary.tsx src/components/ProductLibrary.test.ts
git commit -m "feat: build categorized product image and tag UI"
```

### Task 8: Legacy Compatibility and Core Integration Gate

**Files:**
- Create: `scripts/migrate-product-image-roles.ts`
- Create: `scripts/migrate-product-image-roles.test.ts`
- Create: `server/products/legacyCompatibility.ts`
- Create: `server/products/legacyCompatibility.test.ts`
- Modify: `server.ts`
- Modify: `package.json`
- Modify: `scripts/smoke-image-assets.mjs`
- Modify: `scripts/smoke-security.mjs`
- Modify: `docs/solutions/architecture-patterns/image-asset-operations.md`

**Interfaces:**
- Consumes: Tasks 1-7.
- Produces: dry-run/apply legacy role migration and focused core integration evidence ready for the WPS import plan.

- [ ] **Step 1: Write failing migration tests**

```ts
test('legacy first image becomes pattern original and remaining images become unclassified', () => {
  assert.deepEqual(planLegacyRoles([{ id: 9, sortOrder: 2 }, { id: 4, sortOrder: 0 }]), [
    { legacyImageId: 4, role: 'pattern_original', sortOrder: 0, isPrimary: true },
    { legacyImageId: 9, role: 'unclassified', sortOrder: 0, isPrimary: false },
  ]);
});

test('dry-run produces actions without writes', async () => {
  const result = await migrateLegacyProductRoles({ mode: 'dry-run', repository });
  assert.equal(result.planned > 0, true);
  assert.equal(repository.writeCount, 0);
});

test('feature-off legacy rows expose the same role contract without raw paths', () => {
  assert.deepEqual(mapLegacyProductImages(7, legacyRows), [
    { source: 'legacy', legacyImageId: 4, role: 'pattern_original', sortOrder: 0, isPrimary: true, contentUrl: '/api/products/7/images/4' },
    { source: 'legacy', legacyImageId: 9, role: 'unclassified', sortOrder: 0, isPrimary: false, contentUrl: '/api/products/7/images/9' },
  ]);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `node scripts/run-ts-tests.mjs scripts/migrate-product-image-roles.test.ts server/products/legacyCompatibility.test.ts`

Expected: FAIL because the migration and compatibility mapper are absent.

- [ ] **Step 3: Implement idempotent migration and operational command**

```json
"migrate:product-image-roles": "tsx scripts/migrate-product-image-roles.ts"
```

The command requires exactly one of `--dry-run` or `--apply`, processes products in ID batches of 100, leaves existing `pattern_original` unchanged, maps old `gallery`/`swatch` to `unclassified`, maps the first legacy image to `pattern_original`, and writes a count-only JSON summary without raw paths. Update MySQL legacy reads and local JSON fallback reads/writes in `server.ts` to use `mapLegacyProductImages()` and persist the same role/origin fields.

- [ ] **Step 4: Extend smoke checks**

Add authenticated smoke actions for: create four-role product, attach two tags, list with both tags, move an image category, remove pattern original and observe issue, restore it and observe automatic resolution, ignore/reopen an issue, archive a retained tag, and reject an arbitrary remote URL. Add the operating guide commands and rollback boundaries.

- [ ] **Step 5: Run focused core integration checks and commit**

Run serially:

```powershell
node scripts/run-ts-tests.mjs server/products src/lib/products.test.ts src/components/product-library src/components/ProductLibrary.test.ts scripts/migrate-product-image-roles.test.ts
npm.cmd run test:image-assets:smoke
git diff --check
```

Expected: every command exits 0. This is a focused phase gate, not the one complete project acceptance; the WPS import plan runs the full suite once after all development is finished.

```powershell
git add package.json scripts/migrate-product-image-roles.ts scripts/migrate-product-image-roles.test.ts server/products/legacyCompatibility.ts server/products/legacyCompatibility.test.ts server.ts scripts/smoke-image-assets.mjs scripts/smoke-security.mjs docs/solutions/architecture-patterns/image-asset-operations.md
git commit -m "feat: complete product library image and tag foundation"
```
