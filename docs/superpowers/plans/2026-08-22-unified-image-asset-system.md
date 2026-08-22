# Unified Image Asset System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one private-COS-backed image asset lifecycle for company Logo/QR images and product images, and make sample-slip PNG export reliable without anonymous remote-image proxying.

**Architecture:** Add a focused `server/image-assets/` module inside the existing Express application. Browsers upload directly to a quarantine key, the server validates and content-addresses the image, background jobs generate variants, and business tables link to ready assets. Normal display uses short-lived signed URLs; export uses authenticated same-origin content endpoints and Blob URLs.

**Tech Stack:** TypeScript 5.8, Express 4, MySQL 8/InnoDB, `mysql2/promise`, Tencent COS SDK v5, Sharp 0.35, React 19, Vite 6, Node 22 test runner, esbuild.

**Spec:** `docs/superpowers/specs/2026-08-22-unified-image-asset-system-design.md`

## Global Constraints

- Production file storage is private Tencent COS; local storage is selected explicitly for development or single-node emergency use and is never an automatic per-request fallback.
- Production image-asset metadata writes require MySQL. Existing JSON fallback data remains readable only through legacy paths.
- The browser uploads to a quarantine key and cannot choose a permanent object key.
- The server computes SHA-256 and validates actual image bytes with Sharp; client MIME, extension, dimensions, and hash are advisory only.
- Keep `original` for the lifetime of an active reference; generate `display` and, for product images, `thumbnail`.
- New database records, business JSON responses, and IndexedDB records must not contain full-image Base64 data.
- Business links are explicit tables. Do not add a generic `owner_type + owner_id` association.
- Unreferenced assets remain recoverable for exactly 30 days before physical deletion.
- Do not proxy arbitrary URLs. Legacy COS reads must validate the configured Bucket, Region, host, and object key, then use the COS SDK.
- All state-changing asset operations are idempotent. Mark an asset `purged` only after every stored variant has been deleted.
- Preserve old company image columns, `product_images`, and historical files throughout this plan.
- Do not implement the model library, try-on jobs, or detailed print metadata in this plan.
- Use `npm.cmd` commands on Windows. Each task must pass its focused tests before commit.
- Keep existing personal, IDE, Obsidian workspace, launcher, `.npmrc`, and unrelated script changes out of every commit.

## File Map

New backend units:

- `server/image-assets/types.ts` — stable domain types and public interfaces.
- `server/image-assets/errors.ts` — stable error codes and response conversion.
- `server/image-assets/policy.ts` — purpose-specific limits and variant rules.
- `server/image-assets/schema.ts` — additive MySQL DDL only.
- `server/image-assets/repository.ts` — repository and transaction interfaces.
- `server/image-assets/mysqlRepository.ts` — MySQL locking, state changes, links, and jobs.
- `server/image-assets/storage.ts` — storage interface and key helpers.
- `server/image-assets/cosStorage.ts` — private COS implementation and signed URLs.
- `server/image-assets/localStorage.ts` — explicit local development implementation.
- `server/image-assets/legacySource.ts` — managed legacy COS/local/data-URL reader.
- `server/image-assets/validator.ts` — Sharp validation and server-side SHA-256.
- `server/image-assets/processor.ts` — content-addressed original/display/thumbnail output.
- `server/image-assets/service.ts` — upload, finalize, access, association, and lifecycle orchestration.
- `server/image-assets/worker.ts` — database-backed processing, recycle, purge, and reconciliation runner.
- `server/image-assets/routes.ts` — `/api/image-assets` router and unified error responses.
- `server/image-assets/runtime.ts` — dependency construction and feature configuration.

New frontend units:

- `src/lib/imageAssets.ts` — direct-upload, finalize, polling, descriptor, and authenticated Blob client.
- `src/lib/imageAssets.test.ts` — client protocol tests with injected fetch.

New operational units:

- `scripts/run-ts-tests.mjs` — discover and bundle TypeScript tests consistently on Windows.
- `scripts/migrate-image-assets.ts` — dry-run, batched, resumable legacy migration.
- `scripts/smoke-image-assets.mjs` — authenticated HTTP smoke coverage against a built server.

Existing files modified in focused places:

- `server.ts:1-15, 398-560, 726-799, 1127-1160, 1735-2175, 2452-2585` — mount the module, initialize schema/worker, and adapt company/product routes.
- `src/types.ts:53-121` — asset descriptors and company/product image IDs.
- `src/App.tsx:203-327` — map company image descriptors and save role mutations.
- `src/components/CompanyProfileEditor.tsx:15-105,168-280` — upload assets rather than create Base64 data URLs.
- `src/lib/imageCapture.ts` and `src/lib/imageCapture.test.ts` — authenticated Blob preparation and deterministic cleanup.
- `src/components/DocumentPreview.tsx:165-270` — export from a cloned DOM with Blob URLs.
- `src/lib/db.ts:1-180` — IndexedDB v3 metadata-only migration.
- `src/components/ProductLibrary.tsx:35-120,195-380,490-530,650-680` — server descriptors instead of Base64 caching.
- `scripts/upload-product-images.mjs` — use the authenticated asset API instead of direct COS/DB writes.
- `scripts/smoke-security.mjs`, `.env.example`, `package.json` — regression coverage, explicit configuration, and test scripts.

---

### Task 1: Test Runner, Domain Contracts, Policies, and Errors

**Files:**
- Create: `scripts/run-ts-tests.mjs`
- Create: `server/image-assets/types.ts`
- Create: `server/image-assets/errors.ts`
- Create: `server/image-assets/policy.ts`
- Create: `server/image-assets/policy.test.ts`
- Modify: `package.json:6-14`

**Interfaces:**
- Produces: `AssetPurpose`, `AssetStatus`, `AssetVariantName`, `ImageAssetRecord`, `AssetDescriptor`, `UploadSessionRecord`, `AssetPolicy`, `ImageAssetError`, `getAssetPolicy()`.
- Consumes: no new project interfaces.

- [ ] **Step 1: Add a Windows-safe TypeScript test runner**

Create `scripts/run-ts-tests.mjs` to recursively find `*.test.ts` under `server/`, `src/`, and `scripts/`, or under optional paths supplied on the command line. Bundle each file with esbuild into `tmp/tests`, and invoke `node --test` with the generated `.cjs` paths. Delete only `tmp/tests` before each run; never delete the whole `tmp` directory.

Add these scripts:

```json
"test:unit": "node scripts/run-ts-tests.mjs",
"test:image-export": "node scripts/run-ts-tests.mjs src/lib/imageCapture.test.ts",
"test:image-assets": "node scripts/run-ts-tests.mjs server/image-assets"
```

- [ ] **Step 2: Write failing policy and error tests**

```ts
test('company QR policy keeps original and display only', () => {
  assert.deepEqual(getAssetPolicy('company_qr').variants, ['original', 'display']);
  assert.equal(getAssetPolicy('company_qr').maxBytes, 2 * 1024 * 1024);
});

test('product policy includes a thumbnail and rejects SVG', () => {
  const policy = getAssetPolicy('product_image');
  assert.deepEqual(policy.variants, ['original', 'display', 'thumbnail']);
  assert.equal(policy.allowedMimes.has('image/svg+xml'), false);
});

test('asset errors expose stable safe fields', () => {
  const body = new ImageAssetError('ASSET_NOT_READY', 409, false, 'processing').toResponse('req-1');
  assert.deepEqual(body, { error: { code: 'ASSET_NOT_READY', message: 'processing', requestId: 'req-1', retryable: false } });
});
```

- [ ] **Step 3: Run the test and verify failure**

Run: `npm.cmd run test:image-assets`

Expected: FAIL because `getAssetPolicy` and `ImageAssetError` do not exist.

- [ ] **Step 4: Implement the contracts and minimum policy registry**

Use these exact unions:

```ts
export type AssetPurpose = 'company_logo' | 'company_qr' | 'product_image';
export type AssetStatus = 'quarantine' | 'processing' | 'ready' | 'recycled' | 'degraded' | 'purged';
export type AssetVariantName = 'original' | 'display' | 'thumbnail';
export type CompanyImageRole = 'brand_logo' | 'wechat_qr' | 'alipay_qr';
```

Use this descriptor contract across server routes and frontend mapping:

```ts
export interface AssetDescriptor {
  id: string;
  status: AssetStatus;
  purpose: AssetPurpose;
  detectedMime: string;
  byteSize: number;
  width: number;
  height: number;
  variants: Partial<Record<AssetVariantName, { width: number; height: number; byteSize: number }>>;
  errorCode?: ImageAssetErrorCode;
}
```

Define `AssetPolicy` with `maxBytes`, `maxPixels`, `allowedMimes`, and ordered `variants`. Set company image size to 2 MiB, product image size to 10 MiB, maximum pixels to 40,000,000, and allowed MIME values to JPEG, PNG, WebP, and GIF. Define the eight spec error codes as a string union and make `ImageAssetError.toResponse(requestId)` return only `code`, `message`, `requestId`, and `retryable`.

- [ ] **Step 5: Run tests and commit**

Run: `npm.cmd run test:image-assets`

Expected: PASS.

```powershell
git add package.json scripts/run-ts-tests.mjs server/image-assets/types.ts server/image-assets/errors.ts server/image-assets/policy.ts server/image-assets/policy.test.ts
git commit -m "test: establish image asset contracts"
```

### Task 2: Additive Schema and Transactional MySQL Repository

**Files:**
- Create: `server/image-assets/schema.ts`
- Create: `server/image-assets/repository.ts`
- Create: `server/image-assets/mysqlRepository.ts`
- Create: `server/image-assets/mysqlRepository.test.ts`
- Modify: `server.ts:398-560`

**Interfaces:**
- Consumes: Task 1 domain types.
- Produces: `initializeImageAssetSchema(connection)`, `AssetRepository`, `AssetTransaction`, `MySqlAssetRepository`.

- [ ] **Step 1: Write failing repository contract tests with a recording connection**

Test that schema initialization emits additive `CREATE TABLE IF NOT EXISTS` statements for exactly these tables: `image_assets`, `image_asset_variants`, `image_upload_sessions`, `image_processing_jobs`, `company_image_assets`, `product_image_assets`. Exercise `finalizeUploadSession()` and assert its SHA lookup contains `FOR UPDATE`; exercise `replaceCompanyImage()` and assert it updates both links and reference counts in one transaction.

```ts
assert.match(recordedSql.join('\n'), /CREATE TABLE IF NOT EXISTS image_assets/);
assert.match(recordedSql.join('\n'), /UNIQUE KEY uq_image_assets_sha256 \(sha256\)/);
assert.match(recordedSql.join('\n'), /FOR UPDATE/);
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm.cmd run test:image-assets`

Expected: FAIL because schema and repository modules are absent.

- [ ] **Step 3: Implement all additive tables**

Use `VARCHAR(36)` UUIDs and InnoDB foreign keys. Enforce these unique keys:

```sql
UNIQUE KEY uq_image_assets_sha256 (sha256)
UNIQUE KEY uq_asset_variant (asset_id, variant)
UNIQUE KEY uq_upload_quarantine_key (quarantine_key)
UNIQUE KEY uq_company_role (company_id, role)
UNIQUE KEY uq_product_asset (product_id, asset_id)
UNIQUE KEY uq_legacy_product_image (legacy_product_image_id)
```

Store `status`, `ref_count`, `recycled_at`, `purge_after`, and `purged_at` on `image_assets`; object metadata on `image_asset_variants`; expiry and final asset ID on `image_upload_sessions`; attempts, `available_at`, `locked_at`, and `last_error_code` on `image_processing_jobs`. Add indexes on status/expiry fields used by workers.

- [ ] **Step 4: Implement repository transactions and lock-based methods**

The repository must expose these exact methods:

```ts
interface AssetRepository {
  createUploadSession(input: NewUploadSession): Promise<UploadSessionRecord>;
  getUploadSession(id: string): Promise<UploadSessionRecord | null>;
  finalizeUploadSession(input: FinalizedUpload): Promise<{ assetId: string; jobCreated: boolean }>;
  getAsset(id: string): Promise<ImageAssetRecord | null>;
  getVariants(assetId: string): Promise<AssetVariantRecord[]>;
  claimNextJob(now: Date): Promise<ProcessingJob | null>;
  completeProcessing(assetId: string, variants: AssetVariantRecord[]): Promise<void>;
  failJob(jobId: number, code: string, retryAt: Date | null): Promise<void>;
  markAssetDegraded(assetId: string, code: string): Promise<void>;
  listExpiredUploadSessions(now: Date, limit: number): Promise<UploadSessionRecord[]>;
  expireUploadSession(sessionId: string): Promise<void>;
  replaceCompanyImage(companyId: number, role: CompanyImageRole, assetId: string | null): Promise<void>;
  attachProductImages(productId: number, assetIds: string[]): Promise<void>;
  detachProductImage(productId: number, assetId: string): Promise<void>;
  listPurgeCandidates(now: Date, limit: number): Promise<ImageAssetRecord[]>;
  markPurged(assetId: string, at: Date): Promise<void>;
  reconcileReferenceCounts(): Promise<number>;
}
```

All link methods lock the affected assets, reject non-`ready` targets, change links and reference counts in one MySQL transaction, and move a zero-reference asset to `recycled` with `purge_after = now + 30 days`.

- [ ] **Step 5: Wire schema initialization into the existing MySQL startup**

Call `await initializeImageAssetSchema(conn)` after the existing product tables are created. Do not initialize new asset tables in JSON fallback mode.

- [ ] **Step 6: Run tests, type-check, and commit**

Run: `npm.cmd run test:image-assets`

Run: `npm.cmd run lint`

Expected: both PASS.

```powershell
git add server.ts server/image-assets/schema.ts server/image-assets/repository.ts server/image-assets/mysqlRepository.ts server/image-assets/mysqlRepository.test.ts
git commit -m "feat: add image asset repository"
```

### Task 3: Storage Adapters and Strict Legacy Source Resolution

**Files:**
- Create: `server/image-assets/storage.ts`
- Create: `server/image-assets/cosStorage.ts`
- Create: `server/image-assets/localStorage.ts`
- Create: `server/image-assets/legacySource.ts`
- Create: `server/image-assets/storage.test.ts`

**Interfaces:**
- Consumes: Task 1 policies and errors.
- Produces: `StorageAdapter`, `CosStorageAdapter`, `LocalStorageAdapter`, `assetObjectKey()`, `parseManagedCosUrl()`, `readLegacyImage()`.

- [ ] **Step 1: Write failing storage and legacy-source tests**

Cover content-addressed key generation, signed PUT/GET requests, local root containment, configured COS host parsing, wrong Bucket/Region rejection, Base64 size enforcement, and rejection of unrelated HTTPS hosts.

```ts
assert.equal(assetObjectKey(hash, 'original', 'png'), `assets/sha256/aa/bb/${hash}/original.png`);
assert.deepEqual(parseManagedCosUrl(`https://${bucket}.cos.${region}.myqcloud.com/a%20b.png`, cfg), { key: 'a b.png' });
assert.equal(parseManagedCosUrl('https://images.example.com/a.png', cfg), null);
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm.cmd run test:image-assets`

Expected: FAIL because storage modules are absent.

- [ ] **Step 3: Implement the storage interface and adapters**

```ts
interface StorageAdapter {
  readonly provider: 'cos' | 'local';
  createUploadGrant(key: string, mime: string, maxBytes: number, expiresSeconds: number): Promise<UploadGrant>;
  stat(key: string): Promise<{ byteSize: number; contentType?: string }>;
  read(key: string, maxBytes: number): Promise<Buffer>;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  signGet(key: string, expiresSeconds: number): Promise<{ url: string; expiresAt: string }>;
}
```

Use COS `getObjectUrl({ Sign: true, Method: 'PUT' | 'GET', Expires, Protocol: 'https:' })` for grants and `getObject`, `putObject`, and `deleteObject` for server operations. The local adapter resolves every key under its configured root and throws when `path.relative(root, target)` escapes the root.

- [ ] **Step 4: Implement managed legacy reads without network proxying**

`parseManagedCosUrl()` accepts only the configured bucket host in the configured region. `readLegacyImage()` handles configured COS objects through `StorageAdapter.read`, contained local paths, and limited raster data URLs. It never calls global `fetch()`.

- [ ] **Step 5: Run tests and commit**

Run: `npm.cmd run test:image-assets`

Expected: PASS.

```powershell
git add server/image-assets/storage.ts server/image-assets/cosStorage.ts server/image-assets/localStorage.ts server/image-assets/legacySource.ts server/image-assets/storage.test.ts
git commit -m "feat: add private image storage adapters"
```

### Task 4: Server Validation, Variant Processing, and Lifecycle Worker

**Files:**
- Create: `server/image-assets/validator.ts`
- Create: `server/image-assets/processor.ts`
- Create: `server/image-assets/service.ts`
- Create: `server/image-assets/worker.ts`
- Create: `server/image-assets/service.test.ts`

**Interfaces:**
- Consumes: `AssetRepository`, `StorageAdapter`, `getAssetPolicy()`.
- Produces: `validateImageBuffer()`, `ImageAssetService`, `ImageAssetWorker`.

The public service surface used by later tasks is:

```ts
interface ImageAssetService {
  createUploadSession(input: CreateUploadSessionInput): Promise<UploadGrantResponse>;
  finalizeUploadSession(sessionId: string, principalId: string): Promise<AssetDescriptor>;
  getDescriptor(assetId: string, principalId: string): Promise<AssetDescriptor>;
  getAccessUrls(requests: AccessUrlRequest[], principalId: string): Promise<AccessUrlResult[]>;
  readContent(assetId: string, variant: AssetVariantName, principalId: string): Promise<AssetContent>;
  replaceCompanyImage(companyId: number, role: CompanyImageRole, assetId: string | null): Promise<void>;
  attachProductImages(productId: number, assetIds: string[]): Promise<void>;
  detachProductImage(productId: number, assetId: string): Promise<void>;
}
```

- [ ] **Step 1: Write failing service tests with in-memory fakes**

Cover these state transitions and compensation cases:

```ts
test('finalize hashes server bytes and queues one idempotent job', async () => { /* assert one asset and one job after two calls */ });
test('same verified bytes reuse one asset', async () => { /* assert one permanent key */ });
test('invalid raster deletes quarantine object', async () => { /* assert IMAGE_CONTENT_INVALID and delete called */ });
test('partial variant failure leaves processing job retryable', async () => { /* assert status processing */ });
test('purge waits for zero references and every variant deletion', async () => { /* assert no premature purged state */ });
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm.cmd run test:image-assets`

Expected: FAIL because service and worker do not exist.

- [ ] **Step 3: Implement validation and deterministic variants**

`validateImageBuffer(buffer, declared, policy)` returns actual MIME, extension, width, height, byte size, and SHA-256. Configure Sharp with `limitInputPixels: policy.maxPixels`. Decode metadata and one pixel pipeline so corrupt images fail before a database asset is created.

Generate variants as follows:

```ts
original: unchanged bytes and detected MIME
display: WebP, fit inside 1600x1600, withoutEnlargement: true, quality: 82
thumbnail: WebP, fit cover 320x320, position centre, quality: 72
```

- [ ] **Step 4: Implement service orchestration and the worker**

`ImageAssetService.createUploadSession()` creates `quarantine/<sessionId>/<randomName>` and a 15-minute upload grant. `finalizeUploadSession()` checks expiry and object size, reads at most policy max bytes plus one byte, validates, deletes invalid quarantine data, and calls the repository idempotently.

`ImageAssetWorker.runOnce()` claims one job, creates missing permanent variants, confirms each object exists, completes the asset, and removes quarantine. Retry storage errors at 5 seconds, 30 seconds, and 5 minutes; after three failed attempts keep the asset `degraded` and preserve the stable error code. `purgeOnce()` rechecks zero references before deleting variants and marking `purged`.

- [ ] **Step 5: Run tests and commit**

Run: `npm.cmd run test:image-assets`

Run: `npm.cmd run lint`

Expected: both PASS.

```powershell
git add server/image-assets/validator.ts server/image-assets/processor.ts server/image-assets/service.ts server/image-assets/worker.ts server/image-assets/service.test.ts
git commit -m "feat: process and recycle image assets"
```

### Task 5: Asset Runtime, HTTP Routes, and Explicit Feature Configuration

**Files:**
- Create: `server/image-assets/runtime.ts`
- Create: `server/image-assets/routes.ts`
- Create: `server/image-assets/routes.test.ts`
- Create: `scripts/smoke-image-assets.mjs`
- Modify: `server.ts:1-15,1127-1160,2526-2585`
- Modify: `.env.example`
- Modify: `package.json:6-14`
- Modify: `scripts/smoke-security.mjs`

**Interfaces:**
- Consumes: `ImageAssetService`, `ImageAssetWorker`, repository and storage adapters.
- Produces: `createImageAssetRuntime()`, `createImageAssetRouter()` and the five spec endpoints.

- [ ] **Step 1: Write failing route contract tests**

Use injected fake service methods and lightweight Express request/response doubles. Assert:

- upload-session response includes only `sessionId`, `uploadUrl`, `method`, `headers`, and `expiresAt`;
- repeated finalize returns the same `assetId`;
- processing status maps to HTTP 409 `ASSET_NOT_READY`;
- unauthorized access maps to HTTP 403 without object keys;
- content response sets actual MIME, `nosniff`, private cache control, and ETag.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm.cmd run test:image-assets`

Expected: FAIL because runtime and router are absent.

- [ ] **Step 3: Implement configuration and runtime construction**

Add and document:

```dotenv
IMAGE_ASSETS_ENABLED="false"
COMPANY_IMAGE_ASSETS_ENABLED="false"
PRODUCT_IMAGE_ASSETS_ENABLED="false"
ASSET_STORAGE_PROVIDER="cos"
ASSET_SIGNED_URL_TTL_SECONDS="300"
ASSET_UPLOAD_GRANT_TTL_SECONDS="900"
ASSET_UPLOAD_SESSION_TTL_SECONDS="86400"
ASSET_RECYCLE_DAYS="30"
```

Add `"test:image-assets:smoke": "node scripts/smoke-image-assets.mjs"` to `package.json`. The initial smoke script verifies authentication and the disabled-feature response; Task 8 and Task 12 extend the same script.

When image assets are enabled, fail startup if MySQL is unavailable. In production with `ASSET_STORAGE_PROVIDER=cos`, fail startup if COS configuration is incomplete. Do not silently select local storage.

- [ ] **Step 4: Implement and mount the router**

Mount after `app.use('/api', authMiddleware)`:

```ts
app.use('/api/image-assets', createImageAssetRouter(imageAssetRuntime));
```

Implement `POST /upload-sessions`, `POST /upload-sessions/:id/finalize`, `GET /:id`, `POST /access-urls`, and `GET /:id/content`. Bulk access accepts at most 100 requests. Authorization permits the creator only during the 24-hour unlinked window; linked assets require a company or product link.

For `ASSET_STORAGE_PROVIDER=local` only, expose `PUT /upload-sessions/:id/content` as the upload URL returned by `LocalStorageAdapter`. It validates the session ID, declared content length, and expiry before writing the quarantine object. The COS runtime never exposes this development upload endpoint. Generate or accept an `X-Request-Id` at the API boundary and include it in every asset error response.

Keep `/api/upload` available while feature flags are false. When all migrations are complete, it remains only for non-asset/template-compatible uses; do not remove it in this task.

- [ ] **Step 5: Add security smoke assertions**

With image assets disabled and JSON fallback active, assert upload-session creation returns 503 `STORAGE_UNAVAILABLE`. Assert arbitrary `url` is not accepted by any `/api/image-assets` route and unauthenticated requests return 401.

- [ ] **Step 6: Run focused and project tests, then commit**

Run: `npm.cmd run test:image-assets`

Run: `npm.cmd run build`

Run: `npm.cmd run test:security`

Expected: all PASS.

```powershell
git add package.json .env.example server.ts scripts/smoke-security.mjs scripts/smoke-image-assets.mjs server/image-assets/runtime.ts server/image-assets/routes.ts server/image-assets/routes.test.ts
git commit -m "feat: expose authenticated image asset API"
```

### Task 6: Company Image Associations and Legacy Compatibility Endpoint

**Files:**
- Create: `server/image-assets/companyImages.ts`
- Create: `server/image-assets/companyImages.test.ts`
- Modify: `server.ts:706-805`

**Interfaces:**
- Consumes: `ImageAssetService.replaceCompanyImage()`, `readLegacyImage()`.
- Produces: company image descriptors and `GET/PUT/DELETE /api/company/images/:role` behavior.

- [ ] **Step 1: Write failing company-image behavior tests**

Assert that GET prefers a ready asset link, falls back to a legacy field when no link exists, and returns no raw COS URL. Assert replacing a role is atomic and deleting a role does not clear unrelated company text fields. Assert an unknown role returns 400.

Expected descriptor:

```ts
{
  role: 'brand_logo',
  source: 'asset',
  assetId: 'asset-1',
  displayUrl: '/api/company/images/brand_logo/content',
}
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm.cmd run test:image-assets`

Expected: FAIL because company image adapter is absent.

- [ ] **Step 3: Implement company endpoints and compatibility reads**

Add:

```text
GET    /api/company/images/:role/content
PUT    /api/company/images/:role       body { assetId: string }
DELETE /api/company/images/:role
```

The content endpoint resolves new association first, then exactly one matching legacy column. Managed COS URLs use the SDK; local paths stay under the upload root; data URLs are decoded under the company policy limit. Never accept a URL from query or body.

Extend `GET /api/company` with an `images` object while retaining old fields. Change `POST /api/company` so text updates do not overwrite image columns when the new company feature flag is enabled.

- [ ] **Step 4: Run tests and commit**

Run: `npm.cmd run test:image-assets`

Run: `npm.cmd run lint`

Expected: both PASS.

```powershell
git add server.ts server/image-assets/companyImages.ts server/image-assets/companyImages.test.ts
git commit -m "feat: link company images to assets"
```

### Task 7: Frontend Asset Client and Company Editor

**Files:**
- Create: `src/lib/imageAssets.ts`
- Create: `src/lib/imageAssets.test.ts`
- Modify: `package.json:6-14`
- Modify: `src/types.ts:53-67`
- Modify: `src/App.tsx:203-327`
- Modify: `src/components/CompanyProfileEditor.tsx:15-105,168-280`

**Interfaces:**
- Consumes: Task 5 upload/status API and Task 6 company role API.
- Produces: `uploadImageAsset()`, `waitForReadyAsset()`, `fetchAssetBlob()`, asset-aware `CompanyProfile`.

- [ ] **Step 1: Write failing client protocol tests**

Inject `fetchFn` and assert the exact sequence `POST session -> PUT COS -> POST finalize -> GET status`. Assert the COS PUT does not include the bearer token, API calls do include it, non-retryable errors stop immediately, and Blob reads use the same-origin content URL.

```ts
const result = await uploadImageAsset(file, 'company_logo', { apiFetch, directFetch, pollIntervalMs: 0 });
assert.equal(result.status, 'ready');
assert.deepEqual(requests.map(r => r.method), ['POST', 'PUT', 'POST', 'GET']);
```

- [ ] **Step 2: Run tests and verify failure**

Run: `node scripts/run-ts-tests.mjs src/lib/imageAssets.test.ts`

Expected: FAIL because the client module is absent.

- [ ] **Step 3: Implement the client and types**

Add:

```ts
export interface CompanyImageValue {
  role: CompanyImageRole;
  source: 'asset' | 'legacy' | 'none';
  assetId?: string;
  displayUrl?: string;
}
```

`uploadImageAsset()` validates only for early UX, obtains the grant, performs direct PUT with returned headers, finalizes, and polls until `ready`, `degraded`, or a 60-second deadline. Always surface the stable server error message and code.

Extend `test:image-assets` to `node scripts/run-ts-tests.mjs server/image-assets src/lib/imageAssets.test.ts` once this frontend test exists.

- [ ] **Step 4: Replace FileReader uploads in the company editor**

Track one pending value per role: `{ assetId, previewUrl, dirty, uploading, error }`. Use `URL.createObjectURL(file)` only as a temporary local preview, revoke it when replaced/unmounted, upload in the background, and disable Save while a selected image is not ready.

Change the editor callback to this exact shape:

```ts
type CompanyImageMutation =
  | { role: CompanyImageRole; action: 'replace'; assetId: string }
  | { role: CompanyImageRole; action: 'remove' };

onSave(updatedProfile: CompanyProfile, imageMutations: CompanyImageMutation[]): Promise<void>;
```

`App.tsx` updates text through `/api/company`, then calls PUT or DELETE only for supplied mutations. If any role mutation fails, it reloads `/api/company` so the UI reflects the server's atomic state.

- [ ] **Step 5: Run tests, type-check, and commit**

Run: `npm.cmd run test:image-assets`

Run: `npm.cmd run lint`

Expected: both PASS; searching new company code for `readAsDataURL` returns no matches.

```powershell
git add package.json src/lib/imageAssets.ts src/lib/imageAssets.test.ts src/types.ts src/App.tsx src/components/CompanyProfileEditor.tsx
git commit -m "feat: upload company images as assets"
```

### Task 8: Deterministic Sample-Slip Export Through Authenticated Blobs

**Files:**
- Modify: `src/lib/imageCapture.ts`
- Modify: `src/lib/imageCapture.test.ts`
- Modify: `src/components/DocumentPreview.tsx:165-270`
- Modify: `scripts/smoke-image-assets.mjs`

**Interfaces:**
- Consumes: company `displayUrl` values and `fetchAssetBlob()`.
- Produces: `prepareCaptureClone()` and `releaseCaptureResources()`.

- [ ] **Step 1: Replace proxy-fallback tests with clone preparation tests**

Test that three protected images are fetched with authorization, replaced only in a cloned DOM, decoded before capture, and all Blob URLs are revoked on success and failure. Retain tests for same-origin/data URLs, but remove expectations that arbitrary remote images use `/api/proxy-image`.

```ts
assert.deepEqual(fetches, [
  '/api/company/images/brand_logo/content',
  '/api/company/images/wechat_qr/content',
  '/api/company/images/alipay_qr/content',
]);
assert.deepEqual(revoked.sort(), created.sort());
```

- [ ] **Step 2: Run the export test and verify failure**

Run: `npm.cmd run test:image-export`

Expected: FAIL because clone preparation does not exist.

- [ ] **Step 3: Implement clone-based capture**

`prepareCaptureClone(source, apiFetch)` deep-clones the preview, pairs source and clone `<img>` nodes by index, fetches protected/legacy managed images as Blob, assigns Blob URLs only to clone nodes, waits for `decode()`, and returns `{ clone, objectUrls }`. Data URLs and already loaded same-origin static assets can remain unchanged.

Update `handleExportImage()` to capture the prepared clone inside an off-screen fixed container. In `finally`, remove the container and revoke every object URL. Remove the arbitrary `/api/proxy-image?url=` path from this flow.

- [ ] **Step 4: Add an export smoke assertion**

The smoke script should use three distinct 8x8 PNG fixtures, request each company role content endpoint, and assert successful raster responses. Keep a browser/manual verification checkpoint for the final generated PNG because the existing repository has no browser E2E dependency.

- [ ] **Step 5: Run tests and commit**

Run: `npm.cmd run test:image-export`

Run: `npm.cmd run build`

Expected: both PASS.

```powershell
git add src/lib/imageCapture.ts src/lib/imageCapture.test.ts src/components/DocumentPreview.tsx scripts/smoke-image-assets.mjs
git commit -m "fix: export documents with authenticated image blobs"
```

### Task 9: Product Backend Associations, Descriptors, and Safe Deletion

**Files:**
- Create: `server/image-assets/productImages.ts`
- Create: `server/image-assets/productImages.test.ts`
- Modify: `server.ts:1735-2175,2303-2445`

**Interfaces:**
- Consumes: asset service association, signed access, and lifecycle methods.
- Produces: asset-aware product create/update/read/delete responses while preserving legacy reads.

- [ ] **Step 1: Write failing product-image tests**

Cover create with ordered `imageAssetIds`, append on update, thumbnail descriptors, full display descriptors, single detach, product deletion with shared assets, legacy fallback, and image-count recomputation from active links.

```ts
assert.deepEqual(list.images[0], {
  assetId: 'asset-1', sortOrder: 0, role: 'pattern_original',
  thumbnailUrl: signedThumb.url, displayUrl: signedDisplay.url,
});
assert.equal(sharedAsset.refCount, 1);
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm.cmd run test:unit`

Expected: FAIL because product asset adapter is absent.

- [ ] **Step 3: Implement product association behavior**

When `PRODUCT_IMAGE_ASSETS_ENABLED=true`, accept `imageAssetIds: string[]` in product create/update payloads, preserve order, assign the first image `pattern_original` and later images `gallery`, and attach only `ready` assets. Return descriptors with real asset IDs and URLs; never return Base64.

Single-image and product deletion must remove business links in MySQL transactions. The lifecycle service handles recycle state after commit; route code must not call COS delete directly for new assets. Continue reading old `product_images` rows when no new links exist.

- [ ] **Step 4: Keep import compatibility explicit**

Excel product metadata import remains unchanged. Any image files supplied through legacy multipart product routes are accepted only while the product feature flag is false. When true, return 400 with a message instructing clients to create image assets first.

- [ ] **Step 5: Run tests and commit**

Run: `npm.cmd run test:unit`

Run: `npm.cmd run lint`

Expected: both PASS.

```powershell
git add server.ts server/image-assets/productImages.ts server/image-assets/productImages.test.ts
git commit -m "feat: link product images to assets"
```

### Task 10: Product Frontend Without Base64 or Image-ID Mismatch

**Files:**
- Modify: `src/types.ts:101-121`
- Modify: `src/lib/db.ts:1-180`
- Modify: `src/components/ProductLibrary.tsx:35-120,195-380,490-530,650-680`
- Modify: `src/lib/imageAssets.test.ts`

**Interfaces:**
- Consumes: product descriptors and `uploadImageAsset()`.
- Produces: metadata-only IndexedDB v3 and asset-ID-based product UI.

- [ ] **Step 1: Add failing metadata-only tests**

Test response mapping with server asset IDs, signed thumbnail/display URLs, and expiry refresh. Add a source assertion that new IndexedDB image records have no `thumbnail`, `full`, or `base64` properties.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm.cmd run test:image-assets`

Expected: FAIL because product helpers still create Base64 and generated local IDs.

- [ ] **Step 3: Upgrade IndexedDB and remove image payload storage**

Set `DB_VERSION = 3`. During upgrade, delete `product_images`; keep product metadata storage. Remove `compressImage`, `processImageUpload`, `blobToDataUrl`, `addProductImage`, and `getFullImageUrl`. Browser HTTP cache handles signed image responses; do not recreate an application image cache.

- [ ] **Step 4: Update ProductLibrary flows**

Upload each selected file with purpose `product_image`, wait for ready IDs, then send `imageAssetIds` with product create/update. Render list thumbnails and lightbox display URLs from server descriptors. On a 401/403 caused by an expired signed URL, refresh the product descriptors once. Delete using the server `assetId`, then refresh the product image list.

Remove all construction of `data:image/jpeg;base64,${...}` and all client-generated `img_<timestamp>` IDs.

- [ ] **Step 5: Run tests, search for Base64 regressions, and commit**

Run: `npm.cmd run test:image-assets`

Run: `npm.cmd run lint`

Run: `rg -n "data:image/jpeg;base64|processImageUpload|addProductImage|getFullImageUrl" src/components/ProductLibrary.tsx src/lib/db.ts`

Expected: tests and lint PASS; `rg` returns no matches.

```powershell
git add src/types.ts src/lib/db.ts src/components/ProductLibrary.tsx src/lib/imageAssets.test.ts
git commit -m "feat: load product image assets by server id"
```

### Task 11: Resumable Migration and Unified Bulk Upload Script

**Files:**
- Create: `scripts/migrate-image-assets.ts`
- Create: `scripts/migrate-image-assets.test.ts`
- Modify: `scripts/upload-product-images.mjs`
- Modify: `package.json:6-14`
- Modify: `.env.example`

**Interfaces:**
- Consumes: repository, storage, legacy resolver, and authenticated HTTP asset API.
- Produces: `npm.cmd run migrate:image-assets -- --dry-run` and API-based bulk upload.

- [ ] **Step 1: Write failing migration-planner tests**

Use fixture rows for company COS URLs, company Base64, product COS keys, local paths, duplicate content, missing objects, and an already migrated `legacy_product_image_id`. Assert deterministic operations and summary counts without writes in dry-run mode.

- [ ] **Step 2: Run tests and verify failure**

Run: `node scripts/run-ts-tests.mjs scripts/migrate-image-assets.test.ts`

Expected: FAIL because migration planner is absent.

- [ ] **Step 3: Implement dry-run and batched migration**

Support these exact CLI flags:

```text
--dry-run
--apply
--domain=company|product|all
--batch-size=100
--after-id=<numeric checkpoint>
--report=<path under project directory>
```

Default to `--dry-run`; require `--apply` for writes. Resolve `--report` and reject any path outside the project directory. For every source, read through the controlled legacy resolver, validate/hash through the service, attach the new asset, and record source ID, asset ID, result, and stable error code. Re-running skips completed legacy IDs and deduplicates by hash.

- [ ] **Step 4: Convert the bulk uploader to the HTTP API**

Keep filename-to-`item_no` matching, but remove direct COS SDK calls, Sharp thumbnail code, local file writes, and direct `product_images` inserts. Log in to the configured local server, create an asset session, PUT the file, finalize/poll, and call the product update API with the returned asset ID. Never print the admin password or bearer token.

- [ ] **Step 5: Run tests and commit**

Run: `npm.cmd run test:unit`

Run: `npm.cmd run lint`

Expected: both PASS.

```powershell
git add package.json .env.example scripts/migrate-image-assets.ts scripts/migrate-image-assets.test.ts scripts/upload-product-images.mjs
git commit -m "feat: migrate legacy images into asset storage"
```

### Task 12: Reconciliation, Observability, Full Verification, and Rollout Checkpoints

**Files:**
- Modify: `server/image-assets/worker.ts`
- Modify: `server/image-assets/runtime.ts`
- Modify: `server/image-assets/service.test.ts`
- Modify: `scripts/smoke-image-assets.mjs`
- Modify: `scripts/smoke-security.mjs`
- Modify: `package.json:6-14`
- Modify: `Fabric-DMS-Knowledge-Base/05-数据模型.md`
- Modify: `Fabric-DMS-Knowledge-Base/06-API清单.md`
- Modify: `Fabric-DMS-Knowledge-Base/07-运行与部署.md`
- Modify: `Fabric-DMS-Knowledge-Base/10-安全基线.md`
- Modify: `Fabric-DMS-Knowledge-Base/11-测试与质量.md`
- Create: `docs/solutions/architecture-patterns/image-asset-operations.md`

**Interfaces:**
- Consumes: every earlier task.
- Produces: reconciliation summaries, structured logs, complete test command, rollout evidence.

- [ ] **Step 1: Add failing reconciliation and fault-injection tests**

Cover reference-count drift, missing permanent objects, orphan permanent keys, processing timeout, COS 403/404/timeout, worker restart, and one-variant deletion failure. Assert logs contain request/asset/job IDs and stable codes but not `Authorization`, `SecretKey`, `sign=`, or Cookie values.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm.cmd run test:image-assets`

Expected: FAIL on reconciliation and sanitization assertions.

- [ ] **Step 3: Implement reconciliation and structured summaries**

At startup, recover jobs whose `locked_at` exceeds five minutes. On the configured worker interval, process due jobs and expired upload sessions. Once per day, recalculate reference counts, mark missing objects `degraded`, and list orphan candidates without deleting them. Emit one JSON summary per run with counts and elapsed milliseconds.

Do not add physical orphan deletion to this plan. Only zero-reference, database-known assets past `purge_after` are physically removed.

- [ ] **Step 4: Complete smoke coverage and package command**

Add:

```json
"test:all": "npm run lint && npm run test:unit && npm run build && npm run test:security && npm run test:image-assets:smoke"
```

`test:image-assets:smoke` starts the built server with a test MySQL schema and local storage adapter, logs in, uploads three company fixtures and two duplicate product fixtures, waits for ready, verifies descriptors/content headers, and detaches references. To verify purge without a production time override, the script updates only its known test asset rows in the `_test` database so `purge_after` is in the past, runs one worker maintenance command, and verifies idempotent cleanup. The script must refuse to run unless its database name ends with `_test`.

- [ ] **Step 5: Update durable project documentation**

Document the six new tables, five asset endpoints plus company compatibility endpoint, feature flags, private COS/CORS requirements, migration commands, 30-day recycle semantics, and troubleshooting by stable error code. Record that model/try-on and professional print metadata remain outside this implementation.

- [ ] **Step 6: Run automated verification**

Run: `npm.cmd run test:all`

Run: `git diff --check`

Expected: all tests PASS and diff check emits no output.

- [ ] **Step 7: Perform the browser acceptance check**

With `COMPANY_IMAGE_ASSETS_ENABLED=true`, upload a distinct Logo, WeChat QR, and Alipay QR; save and reload company settings; create a sample slip; export PNG; open the PNG and verify all three images are visibly present. Then open the product library, upload two identical images to two products, verify list thumbnails and detail display, delete one reference, and verify the other remains readable.

Record only asset IDs, response status, generated PNG filename, and pass/fail results. Do not record signed URLs, tokens, or credentials.

- [ ] **Step 8: Commit the verified rollout documentation**

```powershell
git add package.json server/image-assets/worker.ts server/image-assets/runtime.ts server/image-assets/service.test.ts scripts/smoke-image-assets.mjs scripts/smoke-security.mjs docs/solutions/architecture-patterns/image-asset-operations.md Fabric-DMS-Knowledge-Base/05-数据模型.md Fabric-DMS-Knowledge-Base/06-API清单.md Fabric-DMS-Knowledge-Base/07-运行与部署.md Fabric-DMS-Knowledge-Base/10-安全基线.md Fabric-DMS-Knowledge-Base/11-测试与质量.md
git commit -m "docs: verify unified image asset rollout"
```

## Rollout Order

1. Deploy Tasks 1-5 with all business feature flags false.
2. Enable the asset runtime and validate COS CORS, signed PUT, processing, signed GET, and same-origin content in the target environment.
3. Deploy Tasks 6-8, enable company assets, migrate company images, and complete the sample-slip PNG acceptance check.
4. Deploy Tasks 9-10, enable product assets for new writes, and validate shared-image deletion.
5. Run Task 11 first in dry-run mode, review its report, then apply company and product batches separately.
6. Keep legacy fields/files intact through the observation period. Their removal requires a new approved design and implementation plan.
