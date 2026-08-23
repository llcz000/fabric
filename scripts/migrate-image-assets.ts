import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { CosStorageAdapter, type CosSdkBoundary } from '../server/image-assets/cosStorage';
import { ImageAssetError } from '../server/image-assets/errors';
import { readLegacyImage } from '../server/image-assets/legacySource';
import { LocalStorageAdapter } from '../server/image-assets/localStorage';
import { MySqlAssetRepository } from '../server/image-assets/mysqlRepository';
import { getAssetPolicy } from '../server/image-assets/policy';
import { generateImageVariants, type ProcessedVariant } from '../server/image-assets/processor';
import { assetObjectKey, type StorageAdapter } from '../server/image-assets/storage';
import type { AssetPurpose, CompanyImageRole } from '../server/image-assets/types';
import { validateImageBuffer, type ValidatedImage } from '../server/image-assets/validator';

const DOTENV_MODULE = 'dotenv';
const MYSQL_MODULE = 'mysql2/promise';
const COS_MODULE = 'cos-nodejs-sdk-v5';
const SHARP_MODULE = 'sharp';
const MIGRATION_PRINCIPAL = 'legacy-migration';

export type MigrationDomain = 'company' | 'product' | 'all';

export interface CompanyConfigRow {
  id?: number;
  brand_logo?: unknown;
  wechat_qr?: unknown;
  alipay_qr?: unknown;
  [key: string]: unknown;
}

export interface ProductImageRow {
  id: number;
  product_id: number;
  sort_order: number;
  cos_key?: unknown;
  local_path?: unknown;
  [key: string]: unknown;
}

export interface CompanyMigrationSource {
  kind: 'company';
  sourceId: string;
  legacyId: number;
  companyId: number;
  role: CompanyImageRole;
  purpose: AssetPurpose;
  rawSource: unknown;
}

export interface ProductMigrationSource {
  kind: 'product';
  sourceId: string;
  legacyId: number;
  productId: number;
  sortOrder: number;
  isPrimary: boolean;
  role: 'pattern_original' | 'gallery';
  purpose: AssetPurpose;
  rawSource: unknown;
}

export type MigrationSource = CompanyMigrationSource | ProductMigrationSource;

export type MigrationResultStatus = 'migrated' | 'skipped' | 'failed' | 'dry-run';

export interface MigrationResult {
  sourceId: string;
  legacyId: number;
  domain: 'company' | 'product';
  status: MigrationResultStatus;
  assetId?: string;
  deduplicated?: boolean;
  errorCode?: string;
  message?: string;
}

export interface MigrationSummary {
  total: number;
  migrated: number;
  skipped: number;
  failed: number;
  deduplicated: number;
  dryRun: number;
}

export interface MigrationReport {
  generatedAt: string;
  domain: MigrationDomain;
  dryRun: boolean;
  afterId?: number;
  nextAfterId?: number;
  results: MigrationResult[];
  summary: MigrationSummary;
}

export interface MigrationOptions {
  dryRun: boolean;
  batchSize: number;
  afterId?: number;
  completedSourceIds?: ReadonlySet<string>;
}

export interface MigrationCliArgs {
  dryRun: boolean;
  apply: boolean;
  domain: MigrationDomain;
  batchSize: number;
  afterId?: number;
  report?: string;
}

export interface MigrationBackend {
  loadLegacyRows(domain: MigrationDomain): Promise<{ companyRows: CompanyConfigRow[]; productRows: ProductImageRow[] }>;
  readSource(source: MigrationSource): Promise<Buffer | null>;
  inspect(buffer: Buffer, purpose: AssetPurpose): Promise<{ sha256: string; existingAssetId: string | null }>;
  ingest(buffer: Buffer, purpose: AssetPurpose): Promise<{ assetId: string; deduplicated: boolean }>;
  attachCompany(companyId: number, role: CompanyImageRole, assetId: string): Promise<void>;
  attachProduct(productId: number, assetId: string): Promise<void>;
  markCompleted(source: MigrationSource, assetId: string): Promise<void>;
  isCompleted(source: MigrationSource): Promise<boolean>;
  cleanup(): Promise<void>;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function nonEmptyFirst(...values: unknown[]): string | null {
  for (const value of values) {
    if (isNonEmptyString(value)) return value.trim();
  }
  return null;
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

interface CompanyRoleDefinition {
  role: CompanyImageRole;
  field: 'brand_logo' | 'wechat_qr' | 'alipay_qr';
  legacyId: number;
  purpose: AssetPurpose;
}

const COMPANY_ROLE_DEFINITIONS: CompanyRoleDefinition[] = [
  { role: 'brand_logo', field: 'brand_logo', legacyId: 1, purpose: 'company_logo' },
  { role: 'wechat_qr', field: 'wechat_qr', legacyId: 2, purpose: 'company_qr' },
  { role: 'alipay_qr', field: 'alipay_qr', legacyId: 3, purpose: 'company_qr' },
];

export function buildMigrationSources(
  companyRows: CompanyConfigRow[],
  productRows: ProductImageRow[],
  domain: MigrationDomain,
): MigrationSource[] {
  const sources: MigrationSource[] = [];

  if (domain === 'company' || domain === 'all') {
    for (const row of companyRows) {
      const companyId = Number(row.id ?? 1);
      for (const definition of COMPANY_ROLE_DEFINITIONS) {
        const rawSource = row[definition.field];
        if (!isNonEmptyString(rawSource)) continue;
        sources.push({
          kind: 'company',
          sourceId: 'company:' + companyId + ':' + definition.role,
          legacyId: definition.legacyId,
          companyId,
          role: definition.role,
          purpose: definition.purpose,
          rawSource,
        });
      }
    }
  }

  if (domain === 'product' || domain === 'all') {
    const sorted = [...productRows].sort(
      (left, right) => left.product_id - right.product_id
        || left.sort_order - right.sort_order
        || left.id - right.id,
    );
    const seenProducts = new Set<number>();
    for (const row of sorted) {
      const rawSource = nonEmptyFirst(row.cos_key, row.local_path);
      if (rawSource === null) continue;
      const isPrimary = !seenProducts.has(row.product_id);
      seenProducts.add(row.product_id);
      sources.push({
        kind: 'product',
        sourceId: 'product:' + row.product_id + ':image:' + row.id,
        legacyId: row.id,
        productId: row.product_id,
        sortOrder: row.sort_order,
        isPrimary,
        role: isPrimary ? 'pattern_original' : 'gallery',
        purpose: 'product_image',
        rawSource,
      });
    }
  }

  return sources;
}

const SECRET_PATTERNS: RegExp[] = [
  /((?:secret[_-]?(?:key|id)?|password|token)\s*[:=]\s*)[^\s,;]+/gi,
  /(bearer\s+)[^\s,;]+/gi,
  /(authorization\s*:\s*)[^\s,;]+/gi,
  /(sign(?:ature)?\s*=\s*)[^\s&,;]+/gi,
];

export function redactSecrets(text: string): string {
  let redacted = text;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, '$1[redacted]');
  }
  return redacted;
}

export function resolveReportPath(projectDir: string, reportArg?: string): string {
  const root = path.resolve(projectDir);
  const candidate = reportArg?.trim()
    ? path.resolve(projectDir, reportArg)
    : path.join(projectDir, 'migration-report.json');
  const relative = path.relative(root, candidate);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new Error('Migration report path must stay inside the project directory');
  }
  return candidate;
}

export function parseMigrationArgs(argv: string[]): MigrationCliArgs {
  const args: MigrationCliArgs = {
    dryRun: true,
    apply: false,
    domain: 'all',
    batchSize: 100,
    afterId: undefined,
    report: undefined,
  };
  for (const token of argv) {
    if (token === '--dry-run') {
      args.dryRun = true;
    } else if (token === '--apply') {
      args.apply = true;
      args.dryRun = false;
    } else if (token.startsWith('--domain=')) {
      const value = token.slice('--domain='.length);
      if (value !== 'company' && value !== 'product' && value !== 'all') {
        throw new Error('--domain must be company, product, or all');
      }
      args.domain = value;
    } else if (token.startsWith('--batch-size=')) {
      const value = Number(token.slice('--batch-size='.length));
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error('--batch-size must be a positive integer');
      }
      args.batchSize = value;
    } else if (token.startsWith('--after-id=')) {
      const value = Number(token.slice('--after-id='.length));
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error('--after-id must be a non-negative integer');
      }
      args.afterId = value;
    } else if (token.startsWith('--report=')) {
      args.report = token.slice('--report='.length);
    } else {
      throw new Error('Unknown migration argument: ' + token);
    }
  }
  return args;
}

export function buildSummary(results: MigrationResult[]): MigrationSummary {
  const summary: MigrationSummary = {
    total: results.length,
    migrated: 0,
    skipped: 0,
    failed: 0,
    deduplicated: 0,
    dryRun: 0,
  };
  for (const result of results) {
    if (result.status === 'migrated') {
      summary.migrated += 1;
      if (result.deduplicated) summary.deduplicated += 1;
    } else if (result.status === 'skipped') {
      summary.skipped += 1;
    } else if (result.status === 'failed') {
      summary.failed += 1;
    } else if (result.status === 'dry-run') {
      summary.dryRun += 1;
    }
  }
  return summary;
}

export function buildReport(
  results: MigrationResult[],
  domain: MigrationDomain,
  dryRun: boolean,
  afterId?: number,
): MigrationReport {
  const processed = results.filter((result) => result.status !== 'failed');
  const productProcessed = processed.filter((result) => result.domain === 'product');
  const nextAfterId = productProcessed.length === 0
    ? undefined
    : Math.max(...productProcessed.map((result) => result.legacyId));
  return {
    generatedAt: new Date().toISOString(),
    domain,
    dryRun,
    afterId,
    nextAfterId,
    results,
    summary: buildSummary(results),
  };
}

export function completedSourceIdsFromResults(results: MigrationResult[]): Set<string> {
  return new Set(
    results
      .filter((result) => result.status === 'migrated' || result.status === 'skipped')
      .map((result) => result.sourceId),
  );
}

function failure(source: MigrationSource, error: unknown): MigrationResult {
  const code = error instanceof ImageAssetError ? error.code : 'ASSET_PROCESSING_FAILED';
  const message = redactSecrets(error instanceof Error ? error.message : String(error));
  return {
    sourceId: source.sourceId,
    legacyId: source.legacyId,
    domain: source.kind,
    status: 'failed',
    errorCode: code,
    message,
  };
}

async function runSource(
  source: MigrationSource,
  backend: MigrationBackend,
  dryRun: boolean,
  completedSourceIds?: ReadonlySet<string>,
): Promise<MigrationResult> {
  const base = { sourceId: source.sourceId, legacyId: source.legacyId, domain: source.kind };

  if (!dryRun && (completedSourceIds?.has(source.sourceId) || await backend.isCompleted(source))) {
    return { ...base, status: 'skipped', message: 'Already migrated' };
  }

  let buffer: Buffer | null;
  try {
    buffer = await backend.readSource(source);
  } catch (error) {
    return failure(source, error);
  }
  if (!buffer) {
    return { ...base, status: 'skipped', message: 'No legacy source content' };
  }

  if (dryRun) {
    try {
      const inspected = await backend.inspect(buffer, source.purpose);
      return {
        ...base,
        status: 'dry-run',
        assetId: inspected.existingAssetId ?? undefined,
        deduplicated: inspected.existingAssetId != null,
        message: inspected.sha256,
      };
    } catch (error) {
      return { ...failure(source, error), status: 'dry-run' };
    }
  }

  try {
    const ingested = await backend.ingest(buffer, source.purpose);
    if (source.kind === 'company') {
      await backend.attachCompany(source.companyId, source.role, ingested.assetId);
    } else {
      await backend.attachProduct(source.productId, ingested.assetId);
    }
    await backend.markCompleted(source, ingested.assetId);
    return {
      ...base,
      status: 'migrated',
      assetId: ingested.assetId,
      deduplicated: ingested.deduplicated,
    };
  } catch (error) {
    return failure(source, error);
  }
}

export async function runMigration(
  sources: MigrationSource[],
  backend: MigrationBackend,
  options: MigrationOptions,
  onProgress?: (results: MigrationResult[], batchIndex: number) => void,
): Promise<MigrationResult[]> {
  const results: MigrationResult[] = [];
  const afterId = options.afterId ?? -1;
  const pending = sources.filter((source) => source.kind === 'company' || source.legacyId > afterId);
  const batches = chunk(pending, Math.max(1, options.batchSize));
  let batchIndex = 0;
  try {
    for (const batch of batches) {
      const batchResults: MigrationResult[] = [];
      for (const source of batch) {
        batchResults.push(await runSource(source, backend, options.dryRun, options.completedSourceIds));
      }
      results.push(...batchResults);
      onProgress?.(batchResults, batchIndex);
      batchIndex += 1;
    }
  } finally {
    await backend.cleanup();
  }
  return results;
}

// ── Real backend wiring (CLI only; not exercised by unit tests) ─────────────────────────────

interface MigrationConnection {
  query(sql: string, params?: unknown[]): Promise<[unknown, unknown]>;
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void;
}

interface MigrationPool {
  query(sql: string, params?: unknown[]): Promise<[unknown, unknown]>;
  getConnection(): Promise<MigrationConnection>;
}

function rowsOf(result: [unknown, unknown]): Record<string, unknown>[] {
  return result[0] as Record<string, unknown>[];
}

function isDuplicateKey(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && ((error as { code?: unknown }).code === 'ER_DUP_ENTRY'
      || String((error as { message?: unknown }).message).includes('Duplicate entry')),
  );
}

async function detectImageDeclared(buffer: Buffer): Promise<{ mime: string; extension: string } | null> {
  const sharp = (await import(SHARP_MODULE)).default;
  const metadata = await sharp(buffer, { animated: false }).metadata();
  const mapping: Record<string, { mime: string; extension: string }> = {
    jpeg: { mime: 'image/jpeg', extension: 'jpg' },
    png: { mime: 'image/png', extension: 'png' },
    webp: { mime: 'image/webp', extension: 'webp' },
    gif: { mime: 'image/gif', extension: 'gif' },
  };
  return mapping[metadata.format ?? ''] ?? null;
}

function isBareCosKey(value: string): boolean {
  if (value.startsWith('data:')) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return false;
  if (/^([a-zA-Z]:[\\/]|[\\/])/.test(value)) return false;
  if (value.includes('..')) return false;
  return true;
}

export async function buildMigrationBackend(env: NodeJS.ProcessEnv): Promise<MigrationBackend> {
  const mysqlModule = await import(MYSQL_MODULE);
  const createPool = mysqlModule.createPool as (config: Record<string, unknown>) => MigrationPool;

  const host = env.DB_HOST?.trim();
  const user = env.DB_USER?.trim();
  const password = env.DB_PASSWORD?.trim();
  const database = env.DB_DATABASE?.trim();
  if (!host || !user || !password || !database) {
    throw new Error('MySQL configuration (DB_HOST, DB_USER, DB_PASSWORD, DB_DATABASE) is required for migration');
  }

  const pool = createPool({ host, user, password, database, dateStrings: true, connectionLimit: 5 });
  const repository = new MySqlAssetRepository(pool as unknown as ConstructorParameters<typeof MySqlAssetRepository>[0]);

  const provider = (env.ASSET_STORAGE_PROVIDER?.trim().toLowerCase() || 'cos');
  let storage: StorageAdapter;
  let cosForLegacy: { config: { bucket: string; region: string }; storage: StorageAdapter } | undefined;
  if (provider === 'local') {
    storage = new LocalStorageAdapter(path.join(process.cwd(), 'image-assets'));
  } else {
    const secretId = env.COS_SECRET_ID?.trim();
    const secretKey = env.COS_SECRET_KEY?.trim();
    const region = env.COS_REGION?.trim();
    const bucket = env.COS_BUCKET?.trim();
    if (!secretId || !secretKey || !region || !bucket) {
      throw new Error('COS configuration is incomplete for image asset storage');
    }
    const cosModule = await import(COS_MODULE);
    const CosConstructor = (cosModule.default ?? cosModule) as new (config: Record<string, unknown>) => CosSdkBoundary;
    const sdk = new CosConstructor({ SecretId: secretId, SecretKey: secretKey });
    storage = new CosStorageAdapter({ bucket, region }, sdk);
    cosForLegacy = { config: { bucket, region }, storage };
  }
  const legacyLocalRoot = path.join(process.cwd(), 'uploads');

  async function findByHash(sha256: string): Promise<{ id: string } | null> {
    const found = rowsOf(await pool.query('SELECT id FROM image_assets WHERE sha256 = ?', [sha256]));
    return found[0] ? { id: String(found[0].id) } : null;
  }

  async function withTransaction<T>(work: (connection: MigrationConnection) => Promise<T>): Promise<T> {
    const connection = await pool.getConnection();
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

  async function insertAssetWithVariants(
    assetId: string,
    validated: ValidatedImage,
    variants: ProcessedVariant[],
    purpose: AssetPurpose,
    providerName: string,
  ): Promise<void> {
    await withTransaction(async (connection) => {
      await connection.query(
        `INSERT INTO image_assets
          (id, sha256, original_filename, detected_mime, detected_extension, purpose, storage_provider,
           byte_size, width, height, status, ref_count, created_by, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', 0, ?, '{}')`,
        [assetId, validated.sha256, 'legacy-migration', validated.mime, validated.extension, purpose,
          providerName, validated.byteSize, validated.width, validated.height, MIGRATION_PRINCIPAL],
      );
      for (const variant of variants) {
        const objectKey = assetObjectKey(validated.sha256, variant.variant, variant.extension);
        await connection.query(
          `INSERT INTO image_asset_variants (asset_id, variant, object_key, mime, byte_size, width, height)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [assetId, variant.variant, objectKey, variant.mime, variant.byteSize, variant.width, variant.height],
        );
      }
    });
  }

  const backend: MigrationBackend = {
    async loadLegacyRows(domain) {
      const companyRows = (domain === 'company' || domain === 'all')
        ? rowsOf(await pool.query('SELECT id, brand_logo, wechat_qr, alipay_qr FROM company_config')) as CompanyConfigRow[]
        : [];
      const productRows = (domain === 'product' || domain === 'all')
        ? rowsOf(await pool.query(
          'SELECT id, product_id, sort_order, cos_key, local_path, thumbnail_cos_key, thumbnail_local_path FROM product_images ORDER BY product_id, sort_order, id',
        )) as ProductImageRow[]
        : [];
      return { companyRows, productRows };
    },

    async readSource(source) {
      if (!isNonEmptyString(source.rawSource)) return null;
      const policy = getAssetPolicy(source.purpose);
      const resolved = await readLegacyImage(source.rawSource, {
        ...(cosForLegacy ? { cos: cosForLegacy } : {}),
        localRoot: legacyLocalRoot,
        maxBytes: policy.maxBytes,
      });
      if (resolved) return resolved;
      if (cosForLegacy && isBareCosKey(source.rawSource)) {
        try {
          return await cosForLegacy.storage.read(source.rawSource, policy.maxBytes);
        } catch (error) {
          if (error instanceof ImageAssetError && error.code === 'ASSET_NOT_FOUND') return null;
          throw error;
        }
      }
      return null;
    },

    async inspect(buffer, purpose) {
      const policy = getAssetPolicy(purpose);
      const declared = await detectImageDeclared(buffer);
      if (!declared) throw new ImageAssetError('IMAGE_CONTENT_INVALID', 422, false, 'Legacy image content is invalid');
      const validated = await validateImageBuffer(buffer, {
        mime: declared.mime,
        extension: declared.extension,
        byteSize: buffer.length,
      }, policy);
      return { sha256: validated.sha256, existingAssetId: (await findByHash(validated.sha256))?.id ?? null };
    },

    async ingest(buffer, purpose) {
      const policy = getAssetPolicy(purpose);
      const declared = await detectImageDeclared(buffer);
      if (!declared) throw new ImageAssetError('IMAGE_CONTENT_INVALID', 422, false, 'Legacy image content is invalid');
      const validated = await validateImageBuffer(buffer, {
        mime: declared.mime,
        extension: declared.extension,
        byteSize: buffer.length,
      }, policy);

      const existing = await findByHash(validated.sha256);
      if (existing) return { assetId: existing.id, deduplicated: true };

      const assetId = randomUUID();
      const variants = await generateImageVariants(buffer, validated, policy);
      for (const variant of variants) {
        const objectKey = assetObjectKey(validated.sha256, variant.variant, variant.extension);
        if (!await storage.exists(objectKey)) await storage.put(objectKey, variant.body, variant.mime);
      }

      try {
        await insertAssetWithVariants(assetId, validated, variants, purpose, provider);
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
        const dedup = await findByHash(validated.sha256);
        if (dedup) return { assetId: dedup.id, deduplicated: true };
        throw error;
      }
      return { assetId, deduplicated: false };
    },

    async attachCompany(companyId, role, assetId) {
      await repository.replaceCompanyImage(companyId, role, assetId);
    },

    async attachProduct(productId, assetId) {
      await repository.attachProductImages(productId, [assetId]);
    },

    async markCompleted(source, assetId) {
      if (source.kind === 'company') return;
      await pool.query(
        'UPDATE product_image_assets SET legacy_product_image_id = ? WHERE product_id = ? AND asset_id = ? AND deleted_at IS NULL',
        [source.legacyId, source.productId, assetId],
      );
    },

    async isCompleted(source) {
      if (source.kind === 'company') {
        const found = rowsOf(await pool.query(
          'SELECT id FROM company_image_assets WHERE company_id = ? AND role = ?',
          [source.companyId, source.role],
        ));
        return found.length > 0;
      }
      const found = rowsOf(await pool.query(
        'SELECT id FROM product_image_assets WHERE legacy_product_image_id = ? AND deleted_at IS NULL',
        [source.legacyId],
      ));
      return found.length > 0;
    },

    async cleanup() {
      try {
        await (pool as unknown as { end(): Promise<void> }).end();
      } catch {
        // Ignore cleanup failures; the process is exiting.
      }
    },
  };

  return backend;
}

function logResult(result: MigrationResult): void {
  const fields = [
    result.status,
    result.domain,
    result.sourceId,
    result.assetId ? 'asset=' + result.assetId : '',
    result.errorCode ? 'error=' + result.errorCode : '',
  ].filter(Boolean);
  console.log(fields.join(' '));
}

function logSummary(summary: MigrationSummary): void {
  console.log(
    'summary total=' + summary.total
    + ' migrated=' + summary.migrated
    + ' skipped=' + summary.skipped
    + ' failed=' + summary.failed
    + ' deduplicated=' + summary.deduplicated
    + ' dryRun=' + summary.dryRun,
  );
}

async function main(): Promise<void> {
  const dotenvModule = await import(DOTENV_MODULE);
  (dotenvModule.default ?? dotenvModule).config();

  const args = parseMigrationArgs(process.argv.slice(2));
  const projectDir = process.cwd();
  const reportPath = resolveReportPath(projectDir, args.report);

  const backend = await buildMigrationBackend(process.env);
  const legacy = await backend.loadLegacyRows(args.domain);
  const sources = buildMigrationSources(legacy.companyRows, legacy.productRows, args.domain);

  const completedSourceIds = completedSourceIdsFromResults(await loadPreviousReport(reportPath));

  const results = await runMigration(
    sources,
    backend,
    { dryRun: args.dryRun, batchSize: args.batchSize, afterId: args.afterId, completedSourceIds },
    (batch) => batch.forEach(logResult),
  );

  const report = buildReport(results, args.domain, args.dryRun, args.afterId);
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');

  logSummary(report.summary);
  console.log('report=' + reportPath);
  if (args.dryRun) {
    console.log('Dry-run complete. Re-run with --apply to write.');
  }
}

async function loadPreviousReport(reportPath: string): Promise<MigrationResult[]> {
  try {
    const raw = await readFile(reportPath, 'utf8');
    const parsed = JSON.parse(raw) as MigrationReport;
    return Array.isArray(parsed.results) ? parsed.results : [];
  } catch {
    return [];
  }
}

const isMain = process.argv[1] != null
  && (process.argv[1].endsWith('migrate-image-assets.ts') || process.argv[1].endsWith('migrate-image-assets.js'));

if (isMain) {
  main().catch((error: unknown) => {
    console.error(redactSecrets(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  });
}
