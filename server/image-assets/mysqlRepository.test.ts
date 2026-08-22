import assert from 'node:assert/strict';
import test from 'node:test';

import { initializeImageAssetSchema } from './schema';
import { MySqlAssetRepository } from './mysqlRepository';
import { ImageAssetError } from './errors';
import type { NewUploadSession } from './repository';
import type { UploadSessionRecord } from './types';

type QueryResult = [unknown, unknown[]];

class RecordingConnection {
  readonly statements: Array<{ sql: string; params: unknown[] }> = [];
  readonly transactions: string[] = [];
  uploadSessionRow: Row | null = {
    id: 'session-1',
    purpose: 'product_image',
    quarantine_key: 'quarantine/session-1/file.png',
    declared_byte_size: 12,
    declared_mime: 'image/png',
    created_by: 'principal-1',
    expires_at: new Date('2099-08-22T00:00:00Z'),
    status: 'open',
    asset_id: null,
  };
  uploadSessionReadRows: Row[] = [];
  shaAssetRows: Row[] = [];
  variantRows: Row[] = [];
  purgeAssetRows: Row[] = [];
  purgeUpdateResult: Row = { affectedRows: 1 };
  lockedAssets: Row[] = [
    { id: 'new-asset', status: 'ready', ref_count: 0 },
    { id: 'old-asset', status: 'ready', ref_count: 1 },
  ];

  async query(sql: string, params: unknown[] = []): Promise<QueryResult> {
    this.statements.push({ sql, params });
    if (sql.includes('FROM image_upload_sessions WHERE id = ? FOR UPDATE')) {
      return [this.uploadSessionRow ? [this.uploadSessionRow] : [], []];
    }
    if (sql.includes('FROM image_assets WHERE sha256 = ? FOR UPDATE')) return [this.shaAssetRows, []];
    if (sql.includes('FROM product_image_assets')) return [[], []];
    if (sql.includes('FROM company_image_assets WHERE company_id = ? AND role = ? FOR UPDATE')) {
      return [[{ asset_id: 'old-asset' }], []];
    }
    if (sql.includes('FROM image_assets WHERE id IN') && sql.includes('FOR UPDATE')) {
      return [this.lockedAssets, []];
    }
    if (sql.includes('FROM image_upload_sessions WHERE id = ?')) return [this.uploadSessionReadRows, []];
    if (sql.includes('FROM image_assets WHERE id = ?')) return [this.purgeAssetRows, []];
    if (sql.includes("UPDATE image_assets SET status = 'purged'")) return [this.purgeUpdateResult, []];
    if (sql.includes('FROM image_asset_variants WHERE asset_id = ?')) return [this.variantRows, []];
    if (sql.includes('FROM image_processing_jobs')) return [[], []];
    return [{ affectedRows: 1, insertId: 1 }, []];
  }

  async getConnection(): Promise<this> {
    return this;
  }

  async beginTransaction(): Promise<void> {
    this.transactions.push('BEGIN');
  }

  async commit(): Promise<void> {
    this.transactions.push('COMMIT');
  }

  async rollback(): Promise<void> {
    this.transactions.push('ROLLBACK');
  }

  release(): void {
    this.transactions.push('RELEASE');
  }
}

type Row = Record<string, unknown>;

function sql(connection: RecordingConnection): string {
  return connection.statements.map((statement) => statement.sql).join('\n');
}

test('schema initialization creates only the six additive image asset tables with required unique keys', async () => {
  const connection = new RecordingConnection();

  await initializeImageAssetSchema(connection);

  const recordedSql = sql(connection);
  const createdTables = [...recordedSql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((match) => match[1]);
  assert.deepEqual(createdTables, [
    'image_assets',
    'image_asset_variants',
    'image_upload_sessions',
    'image_processing_jobs',
    'company_image_assets',
    'product_image_assets',
  ]);
  assert.match(recordedSql, /UNIQUE KEY uq_image_assets_sha256 \(sha256\)/);
  assert.match(recordedSql, /UNIQUE KEY uq_asset_variant \(asset_id, variant\)/);
  assert.match(recordedSql, /UNIQUE KEY uq_upload_quarantine_key \(quarantine_key\)/);
  assert.match(recordedSql, /UNIQUE KEY uq_company_role \(company_id, role\)/);
  assert.match(recordedSql, /UNIQUE KEY uq_product_asset \(product_id, asset_id\)/);
  assert.match(recordedSql, /UNIQUE KEY uq_legacy_product_image \(legacy_product_image_id\)/);
});

test('upload session record and repository creator inputs use the same string identity', async () => {
  const connection = new RecordingConnection();
  const repository = new MySqlAssetRepository(connection);
  const input: NewUploadSession = {
    id: 'session-creator',
    purpose: 'company_logo',
    quarantineKey: 'quarantine/session-creator/logo.png',
    declaredByteSize: 42,
    declaredMime: 'image/png',
    createdBy: 'principal-creator',
    expiresAt: new Date('2026-08-23T00:00:00Z'),
  };
  const typedRecord: UploadSessionRecord = await repository.createUploadSession(input);
  const creatorId: string = typedRecord.createdBy;

  assert.equal(creatorId, input.createdBy);
  assert.deepEqual(connection.statements[0].params?.slice(0, 6), [
    input.id,
    input.purpose,
    input.quarantineKey,
    input.declaredByteSize,
    input.declaredMime,
    input.createdBy,
  ]);
});

test('create upload session returns the stored record for a compatible ID retry', async () => {
  const connection = new RecordingConnection();
  const expiresAt = new Date('2026-08-23T00:00:00Z');
  connection.uploadSessionReadRows = [{
    id: 'session-retry',
    purpose: 'company_logo',
    quarantine_key: 'quarantine/session-retry/logo.png',
    declared_byte_size: 42,
    declared_mime: 'image/png',
    created_by: 'principal-retry',
    expires_at: expiresAt,
    status: 'open',
    asset_id: null,
  }];
  const repository = new MySqlAssetRepository(connection);
  const input: NewUploadSession = {
    id: 'session-retry',
    purpose: 'company_logo',
    quarantineKey: 'quarantine/session-retry/logo.png',
    declaredByteSize: 42,
    declaredMime: 'image/png',
    createdBy: 'principal-retry',
    expiresAt,
  };

  const session = await repository.createUploadSession(input);

  assert.equal(session.id, input.id);
  assert.equal(session.createdBy, input.createdBy);
  assert.match(sql(connection), /INSERT INTO image_upload_sessions[\s\S]*ON DUPLICATE KEY UPDATE id = id/);
  assert.match(sql(connection), /SELECT \* FROM image_upload_sessions WHERE id = \?/);
});

test('create upload session rejects a conflicting ID retry without overwriting the stored session', async () => {
  const connection = new RecordingConnection();
  const expiresAt = new Date('2026-08-23T00:00:00Z');
  connection.uploadSessionReadRows = [{
    id: 'session-retry',
    purpose: 'company_logo',
    quarantine_key: 'quarantine/session-retry/logo.png',
    declared_byte_size: 42,
    declared_mime: 'image/png',
    created_by: 'principal-retry',
    expires_at: expiresAt,
    status: 'open',
    asset_id: null,
  }];
  const repository = new MySqlAssetRepository(connection);

  await assert.rejects(
    repository.createUploadSession({
      id: 'session-retry',
      purpose: 'company_logo',
      quarantineKey: 'quarantine/session-retry/logo.png',
      declaredByteSize: 43,
      declaredMime: 'image/png',
      createdBy: 'principal-retry',
      expiresAt,
    }),
    (error: unknown) => error instanceof ImageAssetError && error.code === 'IMAGE_CONTENT_INVALID',
  );

  assert.match(sql(connection), /ON DUPLICATE KEY UPDATE id = id/);
  assert.doesNotMatch(sql(connection), /UPDATE image_upload_sessions SET/);
});

test('finalize upload locks the session and content hash while creating one asset job transactionally', async () => {
  const connection = new RecordingConnection();
  const repository = new MySqlAssetRepository(connection);

  const result = await repository.finalizeUploadSession({
    sessionId: 'session-1',
    principalId: 'principal-1',
    sha256: 'a'.repeat(64),
    originalFilename: 'fabric.png',
    detectedMime: 'image/png',
    detectedExtension: 'png',
    storageProvider: 'local',
    byteSize: 12,
    width: 2,
    height: 3,
  });

  assert.deepEqual(result, { assetId: 'session-1', jobCreated: true });
  assert.match(sql(connection), /FROM image_assets WHERE sha256 = \? FOR UPDATE/);
  assert.deepEqual(connection.transactions, ['BEGIN', 'COMMIT', 'RELEASE']);
  assert.match(sql(connection), /INSERT(?: IGNORE)? INTO image_processing_jobs/);
});

test('finalize upload atomically expires an already-expired open session before asset creation', async () => {
  const connection = new RecordingConnection();
  connection.uploadSessionRow = { ...connection.uploadSessionRow!, expires_at: new Date('2000-01-01T00:00:00Z') };
  const repository = new MySqlAssetRepository(connection);

  await assert.rejects(
    repository.finalizeUploadSession({
      sessionId: 'session-1',
      principalId: 'principal-1',
      sha256: 'b'.repeat(64),
      originalFilename: 'expired.png',
      detectedMime: 'image/png',
      detectedExtension: 'png',
      storageProvider: 'local',
      byteSize: 12,
      width: 2,
      height: 3,
    }),
    (error: unknown) => error instanceof ImageAssetError && error.code === 'UPLOAD_SESSION_EXPIRED',
  );

  assert.deepEqual(connection.transactions, ['BEGIN', 'COMMIT', 'RELEASE']);
  assert.match(sql(connection), /UPDATE image_upload_sessions SET status = 'expired' WHERE id = \? AND status = 'open'/);
  assert.doesNotMatch(sql(connection), /FROM image_assets WHERE sha256/);
});

test('verified re-upload restores a recycled asset with its new creator and attachment window when original exists', async () => {
  const connection = new RecordingConnection();
  connection.uploadSessionRow = { ...connection.uploadSessionRow!, created_by: 'principal-reupload' };
  connection.shaAssetRows = [{
    id: 'recycled-asset',
    sha256: 'c'.repeat(64),
    original_filename: 'old.png',
    detected_mime: 'image/png',
    detected_extension: 'png',
    purpose: 'product_image',
    storage_provider: 'local',
    byte_size: 12,
    width: 2,
    height: 3,
    status: 'recycled',
    ref_count: 0,
    created_by: 'old-principal',
    created_at: new Date('2000-01-01T00:00:00Z'),
    updated_at: new Date('2000-01-01T00:00:00Z'),
    recycled_at: new Date('2000-01-02T00:00:00Z'),
    purge_after: new Date('2000-02-01T00:00:00Z'),
    purged_at: null,
    error_code: null,
    metadata_json: null,
  }];
  connection.variantRows = [{ variant: 'original' }, { variant: 'display' }, { variant: 'thumbnail' }];
  const repository = new MySqlAssetRepository(connection);

  const result = await repository.finalizeUploadSession({
    sessionId: 'session-1',
    principalId: 'principal-reupload',
    sha256: 'c'.repeat(64),
    originalFilename: 'verified.png',
    detectedMime: 'image/png',
    detectedExtension: 'png',
    storageProvider: 'local',
    byteSize: 12,
    width: 2,
    height: 3,
  });

  assert.deepEqual(result, { assetId: 'recycled-asset', jobCreated: false });
  assert.match(sql(connection), /SELECT variant FROM image_asset_variants WHERE asset_id = \?/);
  assert.match(sql(connection), /created_by = \?, created_at = NOW\(\), status = \?, recycled_at = NULL, purge_after = NULL, purged_at = NULL/);
  assert.ok(connection.statements.some((statement) => statement.params.includes('principal-reupload') && statement.params.includes('ready')));
  assert.doesNotMatch(sql(connection), /INSERT(?: IGNORE)? INTO image_processing_jobs/);
});

test('verified re-upload returns a recycled asset missing required variants to processing and queues work', async () => {
  const connection = new RecordingConnection();
  connection.uploadSessionRow = { ...connection.uploadSessionRow!, created_by: 'principal-reupload' };
  connection.shaAssetRows = [{
    id: 'recycled-without-original',
    sha256: 'd'.repeat(64),
    original_filename: 'old.png',
    detected_mime: 'image/png',
    detected_extension: 'png',
    purpose: 'product_image',
    storage_provider: 'local',
    byte_size: 12,
    width: 2,
    height: 3,
    status: 'recycled',
    ref_count: 0,
    created_by: 'old-principal',
    created_at: new Date('2000-01-01T00:00:00Z'),
    updated_at: new Date('2000-01-01T00:00:00Z'),
    recycled_at: new Date('2000-01-02T00:00:00Z'),
    purge_after: new Date('2000-02-01T00:00:00Z'),
    purged_at: null,
    error_code: null,
    metadata_json: null,
  }];
  connection.variantRows = [{ variant: 'original' }];
  const repository = new MySqlAssetRepository(connection);

  const result = await repository.finalizeUploadSession({
    sessionId: 'session-1',
    principalId: 'principal-reupload',
    sha256: 'd'.repeat(64),
    originalFilename: 'verified.png',
    detectedMime: 'image/png',
    detectedExtension: 'png',
    storageProvider: 'local',
    byteSize: 12,
    width: 2,
    height: 3,
  });

  assert.deepEqual(result, { assetId: 'recycled-without-original', jobCreated: true });
  assert.match(sql(connection), /created_by = \?, created_at = NOW\(\), status = \?, recycled_at = NULL, purge_after = NULL, purged_at = NULL/);
  assert.ok(connection.statements.some((statement) => statement.params.includes('principal-reupload') && statement.params.includes('processing')));
  assert.match(sql(connection), /INSERT(?: IGNORE)? INTO image_processing_jobs/);
});

test('expired unlinked ready assets recycle only with an atomic status and reference-count guard', async () => {
  const connection = new RecordingConnection();
  const repository = new MySqlAssetRepository(connection);
  const now = new Date('2026-08-22T12:00:00Z');

  const recycled = await repository.recycleExpiredUnlinkedAssets(now, 25);

  assert.equal(recycled, 1);
  assert.match(sql(connection), /UPDATE image_assets SET status = 'recycled', recycled_at = \?, purge_after = DATE_ADD\(\?, INTERVAL 30 DAY\)/);
  assert.match(sql(connection), /WHERE status = 'ready' AND ref_count = 0 AND created_at <= DATE_SUB\(\?, INTERVAL 1 DAY\)/);
  assert.match(sql(connection), /ORDER BY created_at LIMIT \?/);
  assert.deepEqual(connection.statements[0].params, [now, now, now, 25]);
});

test('mark purged requires recycled zero-reference eligibility and a successful guarded update', async () => {
  const connection = new RecordingConnection();
  connection.purgeAssetRows = [{ id: 'purge-asset', status: 'recycled', ref_count: 0, purge_after: new Date('2026-08-21T00:00:00Z') }];
  const repository = new MySqlAssetRepository(connection);
  const at = new Date('2026-08-22T00:00:00Z');

  await repository.markPurged('purge-asset', at);

  assert.match(sql(connection), /SELECT status, ref_count, purge_after FROM image_assets WHERE id = \? FOR UPDATE/);
  assert.match(sql(connection), /WHERE id = \? AND status = 'recycled' AND ref_count = 0 AND purge_after <= \?/);
  assert.match(sql(connection), /NOT EXISTS \(SELECT 1 FROM image_asset_variants WHERE asset_id = \?\)/);
  assert.ok(connection.statements.some((statement) => statement.params.length === 4
    && statement.params[0] === at
    && statement.params[1] === 'purge-asset'
    && statement.params[2] === at
    && statement.params[3] === 'purge-asset'));
});

test('mark purged accepts an already-purged retry but rejects an unsuccessful eligible update', async () => {
  const connection = new RecordingConnection();
  const repository = new MySqlAssetRepository(connection);
  const at = new Date('2026-08-22T00:00:00Z');
  connection.purgeAssetRows = [{ id: 'purge-asset', status: 'purged', ref_count: 0, purge_after: null }];

  await repository.markPurged('purge-asset', at);
  assert.doesNotMatch(sql(connection), /UPDATE image_assets SET status = 'purged'/);

  connection.statements.length = 0;
  connection.transactions.length = 0;
  connection.purgeAssetRows = [{ id: 'purge-asset', status: 'recycled', ref_count: 0, purge_after: new Date('2026-08-21T00:00:00Z') }];
  connection.purgeUpdateResult = { affectedRows: 0 };

  await assert.rejects(
    repository.markPurged('purge-asset', at),
    (error: unknown) => error instanceof ImageAssetError && error.code === 'ASSET_NOT_READY',
  );
  assert.deepEqual(connection.transactions, ['BEGIN', 'ROLLBACK', 'RELEASE']);
});

test('complete processing rejects empty or original-less variants before any database write', async () => {
  const connection = new RecordingConnection();
  const repository = new MySqlAssetRepository(connection);

  await assert.rejects(
    repository.completeProcessing('asset-1', []),
    (error: unknown) => error instanceof ImageAssetError && error.code === 'IMAGE_CONTENT_INVALID',
  );
  await assert.rejects(
    repository.completeProcessing('asset-1', [{
      assetId: 'asset-1',
      variant: 'display',
      objectKey: 'assets/display.webp',
      mime: 'image/webp',
      byteSize: 12,
      width: 2,
      height: 3,
      createdAt: new Date('2026-08-22T00:00:00Z'),
    }]),
    (error: unknown) => error instanceof ImageAssetError && error.code === 'IMAGE_CONTENT_INVALID',
  );

  assert.deepEqual(connection.transactions, []);
  assert.equal(connection.statements.length, 0);
});

test('replacing a company image locks assets and changes links and counts in one transaction', async () => {
  const connection = new RecordingConnection();
  const repository = new MySqlAssetRepository(connection);

  await repository.replaceCompanyImage(7, 'brand_logo', 'new-asset');

  const recordedSql = sql(connection);
  assert.deepEqual(connection.transactions, ['BEGIN', 'COMMIT', 'RELEASE']);
  assert.match(recordedSql, /FROM company_image_assets WHERE company_id = \? AND role = \? FOR UPDATE/);
  assert.match(recordedSql, /FROM image_assets WHERE id IN \(\?, \?\) FOR UPDATE/);
  assert.match(recordedSql, /INSERT INTO company_image_assets/);
  assert.match(recordedSql, /UPDATE image_assets SET ref_count = ref_count \+ 1/);
  assert.match(recordedSql, /UPDATE image_assets SET ref_count = ref_count - 1/);
  assert.match(recordedSql, /status = 'recycled'/);
});

test('attaching product images rejects every non-ready target within the locking transaction', async () => {
  const connection = new RecordingConnection();
  connection.lockedAssets = [
    { id: 'ready-asset', status: 'ready', ref_count: 0 },
    { id: 'processing-asset', status: 'processing', ref_count: 0 },
  ];
  const repository = new MySqlAssetRepository(connection);

  await assert.rejects(
    repository.attachProductImages(9, ['ready-asset', 'processing-asset']),
    (error: unknown) => error instanceof ImageAssetError && error.code === 'ASSET_NOT_READY',
  );

  assert.deepEqual(connection.transactions, ['BEGIN', 'ROLLBACK', 'RELEASE']);
  assert.match(sql(connection), /FROM image_assets WHERE id IN \(\?, \?\) FOR UPDATE/);
  assert.doesNotMatch(sql(connection), /INSERT INTO product_image_assets/);
});
