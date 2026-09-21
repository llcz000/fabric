# WPS Product Workbook Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import the “新” worksheet from `D:\download\歌朗花型.xlsm` with WPS cell images, preserve every recoverable product, and expose every anomaly for manual correction.

**Architecture:** A local CLI streams the OOXML ZIP package, parses worksheet values and WPS `DISPIMG` relationships into a normalized import plan, and writes a human-reviewable dry-run report without business-data writes. Apply mode consumes that same plan through the product and image-asset services, using one transaction per normalized product plus durable batch/source checkpoints for idempotent resume.

**Tech Stack:** TypeScript 5.8, Node 22, `fflate` 0.8, `saxes` 6, Sharp 0.35, MySQL 8/InnoDB, existing product/image services and TypeScript test runner.

**Spec:** `docs/superpowers/specs/2026-09-20-product-image-categories-and-wps-import-design.md`

**Prerequisite:** `docs/superpowers/plans/2026-09-21-product-images-tags-and-issues.md` is implemented through Task 8 before apply-mode work starts. Dry-run parser Tasks 1-3 can be developed against its published interfaces.

## Global Constraints

- The source workbook is read-only. Never save, rename, rewrite, or delete `D:\download\歌朗花型.xlsm`.
- Default worksheet is explicitly `新`; never silently select `workbook.worksheets[0]`.
- Dry-run writes no database rows, assets, product records, or source workbook changes; it writes only a local report beneath an explicit output directory.
- Parse WPS `DISPIMG` IDs through `xl/cellimages.xml`, its relationship file, and `xl/media`; ExcelJS `getImages()` is not sufficient.
- Stream ZIP entries and process image bytes one at a time. Do not decode all workbook images into memory.
- A failed row/product does not abort later products. Apply uses one transaction per normalized product and reports `partial` if any fail.
- Exact duplicate rows merge after outer-whitespace trimming; conflicting same-item-number rows remain separate and receive issues.
- F's first valid image is `pattern_original`; G-I images are `unclassified`; no field is guessed into pattern tags.
- MPO is converted to standard JPEG and images above 40,000,000 pixels are resized proportionally; the source bytes remain untouched.
- Every apply is idempotent by file SHA-256, worksheet, and source row fingerprint.
- A batch rollback never deletes products that were edited after import or referenced by orders.
- Run the complete project acceptance exactly once after both implementation plans are finished. If code does not change afterward, commit/push without repeating it.
- Do not stage `.firecrawl/`, reports containing source payloads, extracted media, backups, credentials, or unrelated files.

## Review Focus

- A formula can reference a missing cell-image relationship or missing media entry; Task 2 must produce `IMAGE_REFERENCE_MISSING` while retaining product metadata.
- Shared strings, inline strings, formula cached values, blank cells, and numeric cells must normalize deterministically; Task 1 exercises each representation.
- Two source rows can be exact metadata duplicates but carry different valid images; Task 2 merges the product while retaining all source rows and images.
- A run can stop after asset ingestion but before the product transaction commits; Task 4 proves resume reuses the asset and does not duplicate product/source/image associations.
- A rollback request can contain one manually edited or order-referenced product; Task 5 refuses the whole automatic rollback and emits a blocking list.

## File Map

Parser and planner:

- `scripts/product-import/ooxmlArchive.ts` — bounded streaming access to OOXML ZIP entries.
- `scripts/product-import/xmlReaders.ts` — workbook, relationship, shared-string, worksheet, and cell-image XML readers.
- `scripts/product-import/wpsWorkbook.ts` — source row and WPS image-reference model.
- `scripts/product-import/normalize.ts` — duplicate/conflict rules, role mapping, issue planning, and fingerprints.
- `scripts/product-import/report.ts` — safe JSON/CSV dry-run report with no image bytes or internal paths.

Apply and operations:

- `server/products/importTypes.ts` — batch, source, checkpoint, result, and rollback contracts.
- `server/products/importRepository.ts` — import persistence interface.
- `server/products/mysqlImportRepository.ts` — batch/source/checkpoint and guarded rollback SQL.
- `server/products/importService.ts` — per-product apply orchestration using product/image services.
- `scripts/import-products.ts` — CLI argument parsing, runtime creation, dry-run/apply/resume/rollback modes.
- `scripts/product-import/assetIngest.ts` — upload-session/finalize/worker adapter for one extracted image.
- `scripts/product-import/localCompat.ts` — explicitly selected atomic local JSON/files adapter with the same product/image/source contract.

Fixtures and tests:

- `scripts/product-import/fixtures.ts` — creates small synthetic WPS-compatible `.xlsm` packages in the test temp directory.
- `scripts/product-import/*.test.ts` — parser, normalization, image, report, and CLI tests.
- `server/products/importService.test.ts` and `mysqlImportRepository.test.ts` — apply/idempotency/rollback tests.

---

### Task 1: Streaming OOXML Reader and Synthetic WPS Fixture

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `scripts/product-import/ooxmlArchive.ts`
- Create: `scripts/product-import/xmlReaders.ts`
- Create: `scripts/product-import/fixtures.ts`
- Create: `scripts/product-import/ooxmlArchive.test.ts`

**Interfaces:**
- Consumes: Node streams and buffers.
- Produces: `OoxmlArchive`, `readWorkbookMap()`, `readSharedStrings()`, `readWorksheetCells()`, and deterministic synthetic fixture creation.

- [ ] **Step 1: Add direct ZIP and XML dependencies**

Run: `npm.cmd install fflate@0.8.2 saxes@6.0.0`

Expected: `package.json` and `package-lock.json` record both direct runtime dependencies; no other package is upgraded intentionally.

- [ ] **Step 2: Write failing archive and cell representation tests**

```ts
test('reads only requested OOXML entries and enforces entry limits', async () => {
  const fixture = await createWpsFixture(tempDir, { includeMissingRelationship: false });
  const archive = await OoxmlArchive.open(fixture);
  assert.equal((await archive.readText('xl/workbook.xml', 1_000_000)).includes('sheet name="新"'), true);
  await assert.rejects(archive.readBuffer('xl/media/large.bin', 8), /entry byte limit/);
});

test('worksheet reader handles shared inline formula numeric and blank cells', async () => {
  const rows = await readWorksheetCells(sheetXml, ['共享值']);
  assert.deepEqual(rows.get(2), { A: '共享值', B: '内联', C: '=DISPIMG("img-1",1)', D: '120', E: '' });
});
```

- [ ] **Step 3: Run tests and verify failure**

Run: `node scripts/run-ts-tests.mjs scripts/product-import/ooxmlArchive.test.ts`

Expected: FAIL because the archive and XML readers do not exist.

- [ ] **Step 4: Implement bounded archive/XML interfaces**

```ts
export interface ArchiveEntryInfo { name: string; compressedSize: number; uncompressedSize: number; }

export class OoxmlArchive {
  static open(filePath: string): Promise<OoxmlArchive>;
  list(): readonly ArchiveEntryInfo[];
  readText(name: string, maxBytes: number): Promise<string>;
  readBuffer(name: string, maxBytes: number): Promise<Buffer>;
  stream(name: string): AsyncIterable<Buffer>;
}

export interface WorksheetCell { ref: string; value: string; formula?: string; }
export function readWorksheetCells(xml: string, sharedStrings: string[]): Promise<Map<number, Record<string, string>>>;
```

Use `fflate.Unzip` incrementally from `fs.createReadStream`; reject absolute names, `..` segments, duplicates, encrypted entries, and uncompressed sizes beyond the caller limit. Use `SaxesParser` with external entities disabled. `fixtures.ts` uses `zipSync()` only for tiny test packages and never touches the real workbook.

- [ ] **Step 5: Run tests and commit**

Run: `node scripts/run-ts-tests.mjs scripts/product-import/ooxmlArchive.test.ts`

Expected: PASS, including traversal, duplicate-entry, decompression-limit, invalid XML, and five cell representations.

```powershell
git add package.json package-lock.json scripts/product-import/ooxmlArchive.ts scripts/product-import/xmlReaders.ts scripts/product-import/fixtures.ts scripts/product-import/ooxmlArchive.test.ts
git commit -m "feat: read WPS workbook packages safely"
```

### Task 2: WPS Cell Images and Product Normalization

**Files:**
- Create: `scripts/product-import/wpsWorkbook.ts`
- Create: `scripts/product-import/wpsWorkbook.test.ts`
- Create: `scripts/product-import/normalize.ts`
- Create: `scripts/product-import/normalize.test.ts`
- Modify: `scripts/product-import/xmlReaders.ts`
- Modify: `scripts/product-import/fixtures.ts`

**Interfaces:**
- Consumes: Task 1 archive/XML readers.
- Produces: `readWpsProductWorkbook()`, `normalizeImportPlan()`, `ImportSourceRow`, `PlannedProduct`, `PlannedImage`, and `PlannedIssue`.

- [ ] **Step 1: Write failing WPS mapping and duplicate tests**

```ts
test('maps DISPIMG through cellimages relationships to media entries', async () => {
  const workbook = await readWpsProductWorkbook(fixturePath, '新');
  assert.deepEqual(workbook.rows[0].imageRefs, [
    { cell: 'F2', dispImgId: 'img-pattern', mediaEntry: 'xl/media/image1.png' },
    { cell: 'G2', dispImgId: 'img-extra', mediaEntry: 'xl/media/image2.jpg' },
  ]);
});

test('missing WPS media retains the row and plans an issue', async () => {
  const plan = normalizeImportPlan(workbookWithMissingMedia);
  assert.equal(plan.products.length, 1);
  assert.equal(plan.products[0].issues.some((x) => x.code === 'IMAGE_REFERENCE_MISSING'), true);
});

test('exact duplicate rows merge metadata while retaining sources and images', () => {
  const plan = normalizeImportPlan(twoEqualRowsWithDifferentImages);
  assert.equal(plan.products.length, 1);
  assert.deepEqual(plan.products[0].sources.map((x) => x.rowNumber), [2, 3]);
  assert.equal(plan.products[0].images.length, 2);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `node scripts/run-ts-tests.mjs scripts/product-import/wpsWorkbook.test.ts scripts/product-import/normalize.test.ts`

Expected: FAIL because WPS reader and normalizer are absent.

- [ ] **Step 3: Implement source contracts and relationship resolution**

```ts
export interface ImportSourceRow {
  sheet: string;
  rowNumber: number;
  cells: Record<'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J', string>;
  imageRefs: Array<{ cell: string; dispImgId: string; mediaEntry?: string }>;
}

export interface PlannedProduct {
  planKey: string;
  fields: { itemNo: string; productName: string; composition: string; weight: string; width: string };
  patternTagIds: [];
  sources: ImportSourceRow[];
  images: PlannedImage[];
  issues: PlannedIssue[];
}
```

Resolve the requested sheet through `xl/workbook.xml` plus `xl/_rels/workbook.xml.rels`; resolve `DISPIMG` through cellimages and its `.rels`. A missing sheet, malformed relationship target, or unsafe media path is a fatal plan error; a missing individual image relationship/media is a row issue.

- [ ] **Step 4: Implement deterministic normalization**

Trim A-E outer whitespace without rewriting values. Exact duplicate key is JSON over the five trimmed fields. Same item number with a different key remains a separate planned product and gains `DUPLICATE_ITEM_NO` plus `CONFLICTING_PRODUCT_DATA`. Assign first valid F image as `pattern_original`; G-I as `unclassified`; preserve F text and G-J extras in restricted source payload and issue `UNMAPPED_SOURCE_DATA`. Cap planned associations at 20 while recording every omitted source ref in `IMAGE_LIMIT_EXCEEDED`.

```ts
export function sourceFingerprint(fileSha256: string, sheet: string, row: ImportSourceRow): string {
  return createHash('sha256').update(JSON.stringify([fileSha256, sheet, row.rowNumber, row.cells])).digest('hex');
}
```

- [ ] **Step 5: Run tests and commit**

Run: `node scripts/run-ts-tests.mjs scripts/product-import/wpsWorkbook.test.ts scripts/product-import/normalize.test.ts`

Expected: PASS for exact merge, conflict split, missing fields, text-only F, one image outside F, >20 images, unsafe relationships, and missing media.

```powershell
git add scripts/product-import/wpsWorkbook.ts scripts/product-import/wpsWorkbook.test.ts scripts/product-import/normalize.ts scripts/product-import/normalize.test.ts scripts/product-import/xmlReaders.ts scripts/product-import/fixtures.ts
git commit -m "feat: normalize WPS product rows and cell images"
```

### Task 3: Image Inspection, Conversion, and Dry-Run Report

**Files:**
- Create: `scripts/product-import/imagePlan.ts`
- Create: `scripts/product-import/imagePlan.test.ts`
- Create: `scripts/product-import/report.ts`
- Create: `scripts/product-import/report.test.ts`
- Modify: `scripts/product-import/normalize.ts`

**Interfaces:**
- Consumes: Task 2 planned media refs and `OoxmlArchive.readBuffer()`.
- Produces: `inspectPlannedImage()`, `materializeImportImage()`, `writeDryRunReport()`, and aggregate report counts.

- [ ] **Step 1: Write failing image and report tests**

```ts
test('MPO becomes JPEG and records conversion metadata', async () => {
  const result = await materializeImportImage(mpoBytes, sourceRef);
  assert.equal(result.mime, 'image/jpeg');
  assert.equal(result.originMetadata.convertedFrom, 'image/mpo');
  assert.equal(result.issues.some((x) => x.code === 'IMAGE_FORMAT_CONVERTED'), true);
});

test('over-forty-million-pixel image is resized without changing source bytes', async () => {
  const before = createHash('sha256').update(hugeImage).digest('hex');
  const result = await materializeImportImage(hugeImage, sourceRef);
  assert.equal(result.width * result.height <= 40_000_000, true);
  assert.equal(createHash('sha256').update(hugeImage).digest('hex'), before);
});

test('dry-run report excludes bytes paths and credentials', async () => {
  const report = await writeDryRunReport(plan, outputDir);
  const json = await readFile(report.jsonPath, 'utf8');
  assert.doesNotMatch(json, /cos_key|secret|base64|D:\\\\download/i);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `node scripts/run-ts-tests.mjs scripts/product-import/imagePlan.test.ts scripts/product-import/report.test.ts`

Expected: FAIL because image planning and report writers do not exist.

- [ ] **Step 3: Implement one-image-at-a-time inspection/materialization**

```ts
export interface MaterializedImportImage {
  body: Buffer;
  mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  extension: string;
  width: number;
  height: number;
  sha256: string;
  originMetadata: Record<string, string | number>;
  issues: PlannedIssue[];
}
```

Use Sharp metadata and decode probes. Detect actual format, not extension. Convert MPO to JPEG with autorotation. For over-limit pixels, use `fit: 'inside'` and a scale computed from `sqrt(40_000_000 / pixels)`. Release each image buffer before reading the next entry. Do not retain materialized bodies in the normalized plan or dry-run report.

- [ ] **Step 4: Implement safe JSON and CSV reports**

Report file SHA-256, basename, sheet, row/product/image/issue counts, per-source decision, planned product key, image role/source cell, and stable issue codes. Replace the source path with basename and never serialize `Buffer`, media bytes, storage keys, database connection data, or full raw source payload. Write through a temporary file followed by rename inside the selected report directory.

- [ ] **Step 5: Run tests and commit**

Run: `node scripts/run-ts-tests.mjs scripts/product-import/imagePlan.test.ts scripts/product-import/report.test.ts scripts/product-import/normalize.test.ts`

Expected: PASS for PNG/JPEG/WebP/GIF, MPO, decode failure, >40M resize, atomic report write, and redaction.

```powershell
git add scripts/product-import/imagePlan.ts scripts/product-import/imagePlan.test.ts scripts/product-import/report.ts scripts/product-import/report.test.ts scripts/product-import/normalize.ts
git commit -m "feat: inspect import images and generate dry-run reports"
```

### Task 4: Import Persistence, Asset Ingestion, and Idempotent Apply

**Files:**
- Create: `server/products/importTypes.ts`
- Create: `server/products/importRepository.ts`
- Create: `server/products/mysqlImportRepository.ts`
- Create: `server/products/mysqlImportRepository.test.ts`
- Create: `server/products/importService.ts`
- Create: `server/products/importService.test.ts`
- Modify: `server/products/schema.ts`
- Modify: `server/products/schema.test.ts`
- Create: `scripts/product-import/assetIngest.ts`
- Create: `scripts/product-import/assetIngest.test.ts`

**Interfaces:**
- Consumes: product/image services from the first plan and materialized images from Task 3.
- Produces: `ProductImportRepository`, `MySqlProductImportRepository`, `ProductImportService.applyProduct()`, and `AssetIngestor.ingest()`.

- [ ] **Step 1: Write failing schema, resume, and partial-failure tests**

```ts
test('schema creates batch and source tables with idempotency keys', async () => {
  await initializeProductDomainSchema(connection);
  assert.match(sql(connection), /CREATE TABLE IF NOT EXISTS product_import_batches/);
  assert.match(sql(connection), /UNIQUE KEY uq_import_source_row \(batch_id, source_sheet, source_row\)/);
});

test('resume after asset ingestion reuses asset and creates one product', async () => {
  assetIngestor.existingBySha.set(image.sha256, 'asset-1');
  await importer.applyProduct(batch, plannedProduct);
  await importer.applyProduct(batch, plannedProduct);
  assert.equal(productRepository.createdProducts.length, 1);
  assert.equal(productRepository.sources.length, plannedProduct.sources.length);
});

test('one product failure marks partial and later products continue', async () => {
  const result = await importer.applyPlan(batch, [good1, failing, good2]);
  assert.deepEqual(result, { succeeded: 2, failed: 1, skipped: 0, status: 'partial' });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `node scripts/run-ts-tests.mjs server/products/importService.test.ts server/products/mysqlImportRepository.test.ts scripts/product-import/assetIngest.test.ts server/products/schema.test.ts`

Expected: FAIL because import persistence and service are absent.

- [ ] **Step 3: Add import tables and repository operations**

Implement `product_import_batches` and `product_import_sources` from the spec, including `file_sha256 + sheet_name`, source-row uniqueness, source fingerprint, status/checkpoint/statistics, timestamps, and creator. Store only A-J text values in `source_payload`; reject additional keys and cap serialized payload at 16 KiB.

```ts
export interface ProductImportRepository {
  beginOrResumeBatch(input: BeginImportBatch): Promise<ProductImportBatch>;
  getSourceResult(batchId: number, sheet: string, row: number): Promise<ImportSourceResult | null>;
  recordAppliedProduct(input: AppliedProductRecord): Promise<void>;
  recordProductFailure(batchId: number, planKey: string, code: string): Promise<void>;
  finishBatch(batchId: number, summary: ImportBatchSummary): Promise<void>;
}
```

- [ ] **Step 4: Implement asset and per-product orchestration**

`AssetIngestor.ingest()` uses the existing upload-session grant, writes one body, finalizes, runs the worker until that asset is ready, and returns its asset ID. For an HTTPS COS grant it performs the signed `PUT`; for local storage it calls the runtime's authenticated `uploadLocalContent()` boundary instead of fetching a relative URL. It reuses SHA-deduplicated assets through the existing finalization path. `applyProduct()` first checks every source checkpoint, materializes/ingests its images sequentially, then invokes one product transaction that creates product, layout, sources, and issues. A transaction failure does not delete ingested zero-reference assets; the existing recovery window owns them.

```ts
export interface ApplyProductResult {
  planKey: string;
  productId?: number;
  status: 'applied' | 'skipped' | 'failed';
  errorCode?: string;
}
```

- [ ] **Step 5: Run tests and commit**

Run: `node scripts/run-ts-tests.mjs server/products/importService.test.ts server/products/mysqlImportRepository.test.ts scripts/product-import/assetIngest.test.ts server/products/schema.test.ts server/products/service.test.ts server/image-assets/service.test.ts`

Expected: PASS for new apply, exact merge, conflict split, resume at every checkpoint, asset dedupe, product rollback, partial batch, and safe payload limits.

```powershell
git add server/products scripts/product-import/assetIngest.ts scripts/product-import/assetIngest.test.ts
git commit -m "feat: apply WPS product imports idempotently"
```

### Task 5: CLI Modes, Guarded Rollback, and Operational Output

**Files:**
- Create: `scripts/import-products.ts`
- Create: `scripts/import-products.test.ts`
- Create: `scripts/product-import/localCompat.ts`
- Create: `scripts/product-import/localCompat.test.ts`
- Modify: `server/products/importRepository.ts`
- Modify: `server/products/mysqlImportRepository.ts`
- Modify: `server/products/mysqlImportRepository.test.ts`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: `npm run import:products -- ...`, resume, report, apply, and guarded rollback commands.

- [ ] **Step 1: Write failing CLI and rollback tests**

```ts
test('requires exactly one execution mode and explicit file/sheet', () => {
  assert.throws(() => parseImportArgs(['--file', 'book.xlsm', '--sheet', '新']), /one mode/);
  assert.throws(() => parseImportArgs(['--file', 'book.xlsm', '--sheet', '新', '--dry-run', '--apply']), /one mode/);
});

test('rollback refuses the whole batch when one product changed or has order references', async () => {
  repository.rollbackBlockers = [{ productId: 8, reason: 'modified' }, { productId: 9, reason: 'order_reference' }];
  await assert.rejects(importer.rollbackBatch(12), /ROLLBACK_BLOCKED/);
  assert.equal(repository.deletedProducts.length, 0);
});

test('local compatibility mode writes roles sources and issues atomically', async () => {
  const adapter = new LocalCompatImportAdapter(tempRoot);
  await adapter.applyProduct(batch, plannedProduct, [materializedPattern]);
  const saved = await adapter.readProductByPlanKey(plannedProduct.planKey);
  assert.equal(saved.images[0].role, 'pattern_original');
  assert.equal(saved.sources[0].sourceRow, 2);
  assert.equal(saved.issues.some((x) => x.code === 'MISSING_WIDTH'), true);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `node scripts/run-ts-tests.mjs scripts/import-products.test.ts scripts/product-import/localCompat.test.ts server/products/mysqlImportRepository.test.ts`

Expected: FAIL because CLI, local compatibility adapter, and rollback methods are absent.

- [ ] **Step 3: Implement exact command modes**

```text
npm run import:products -- --file "D:\download\歌朗花型.xlsm" --sheet "新" --dry-run --report-dir ".local/import-reports"
npm run import:products -- --file "D:\download\歌朗花型.xlsm" --sheet "新" --apply --report-dir ".local/import-reports"
npm run import:products -- --file "D:\download\歌朗花型.xlsm" --sheet "新" --apply --resume-batch 12 --report-dir ".local/import-reports"
npm run import:products -- --rollback-batch 12 --report-dir ".local/import-reports"
```

```json
"import:products": "tsx scripts/import-products.ts"
```

Dry-run never initializes write repositories. Apply uses MySQL and the configured asset storage by default; it refuses local JSON fallback unless `--allow-local-compat` is explicitly supplied. `LocalCompatImportAdapter` writes product metadata, role-aware legacy image records, source checkpoints, batch state, and issues through temporary files plus atomic rename beneath the configured local data root; image derivatives live beneath its controlled product-image directory. The backend selection is fixed before the batch starts and cannot switch after a row failure. Print progress as safe one-line JSON with batch, row/plan key, product ID, asset ID, stage, and stable code only.

- [ ] **Step 4: Implement guarded rollback and report retention**

Before deletion, lock all batch-created products and check: current `updated_at` equals imported checkpoint, no order line/document reference exists, and no source from another batch owns the product. If any blocker exists, rollback writes a blocker report and deletes nothing. Otherwise delete product aggregates through `ProductService.deleteProduct()` so references recycle correctly, then set batch `rolled_back`. Add `.local/import-reports/` and `.local/import-backups/` to `.gitignore`.

- [ ] **Step 5: Run tests and commit**

Run: `node scripts/run-ts-tests.mjs scripts/import-products.test.ts scripts/product-import server/products/importService.test.ts server/products/mysqlImportRepository.test.ts`

Expected: PASS for dry-run zero writes, apply, resume, duplicate apply, invalid modes, unsafe file path handling, partial status, allowed rollback, blocked rollback, and redacted logs.

```powershell
git add scripts/import-products.ts scripts/import-products.test.ts scripts/product-import/localCompat.ts scripts/product-import/localCompat.test.ts server/products/importRepository.ts server/products/mysqlImportRepository.ts server/products/mysqlImportRepository.test.ts package.json package-lock.json .gitignore
git commit -m "feat: add resumable WPS product import CLI"
```

### Task 6: Real Workbook Rehearsal, Formal Import, and Single Final Acceptance

**Files:**
- Modify only if rehearsal exposes a reproducible defect: the owning parser/importer file and its focused regression test.
- Create outside Git: `.local/import-reports/` dry-run/apply summaries and `.local/import-backups/` database snapshot metadata.

**Interfaces:**
- Consumes: both implementation plans.
- Produces: verified import of the real “新” worksheet, acceptance evidence, and release-ready commits.

- [ ] **Step 1: Run real dry-run against the read-only workbook**

Run:

```powershell
npm.cmd run import:products -- --file "D:\download\歌朗花型.xlsm" --sheet "新" --dry-run --report-dir ".local/import-reports"
```

Expected report facts: 1,218 effective source rows; 1,151 unique item numbers; 57 duplicate item groups/124 rows; 53 conflicting groups; 1,046 `DISPIMG` references in F-J; two missing media references at `新!F104` and `新!F359`; additional images and unmapped G-J values represented explicitly. Differences stop apply until explained by a parser regression test or a documented correction to the audited baseline.

- [ ] **Step 2: Create a recoverable pre-import backup and run apply**

Create a database snapshot using the project's approved MySQL backup procedure and store only snapshot metadata under `.local/import-backups/`. Then run:

```powershell
npm.cmd run import:products -- --file "D:\download\歌朗花型.xlsm" --sheet "新" --apply --report-dir ".local/import-reports"
```

Expected: batch is `completed` or explicitly `partial`; every failed product has a stable error entry; imported products are visible even with issues.

- [ ] **Step 3: Prove idempotency and sample business behavior**

Run the identical apply command a second time. Expected: no increase in product, source, or image-association counts; rows report skipped/already processed. In the app, sample at least 20 products spanning exact duplicates, conflicting item numbers, missing fields, multiple images, missing media, MPO, resized images, and unmapped source data. Confirm search, tag assignment, issue correction, original-image viewer, order selection, and four image-category editing.

- [ ] **Step 4: Run the one complete acceptance suite**

Run serially after all development and real-data corrections are finished:

```powershell
npm.cmd run lint
npm.cmd run test:unit
npm.cmd run build
npm.cmd run test:security
npm.cmd run test:image-assets:smoke
git diff --check
```

Expected: every command exits 0. Also confirm the source workbook SHA-256 is unchanged from dry-run, batch totals match the final report, no report/backup/media file is staged, and `.firecrawl/` remains untracked.

- [ ] **Step 5: Commit remaining intended changes if any, then push without repeating the completed acceptance**

If all intended code was already committed task-by-task, inspect the clean project diff and push those commits directly. If intended files remain staged, commit only those files first. If any code changes after Step 4, run only the focused affected tests plus the changed build/type check, update the acceptance note, then commit/push.

```powershell
git status --short
git diff --cached --check
git push origin master
git rev-parse HEAD
git rev-parse origin/master
```
