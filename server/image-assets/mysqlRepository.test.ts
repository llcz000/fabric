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
  expiredSessionRows: Row[] = [];
  assetSessionRows: Row[] = [];
  cleanupUploadResult: Row = { affectedRows: 1 };
  failJobResult: Row = { affectedRows: 1 };
  markDegradedResult: Row = { affectedRows: 1 };
  quarantineSessionReadRows: Row[] = [];
  insertUploadError: (Error & { code?: string }) | null = null;
  shaAssetRows: Row[] = [];
  variantRows: Row[] = [];
  purgeAssetRows: Row[] = [];
  purgeClaimRows: Row[] = [];
  purgeClaimUpdateResult: Row = { affectedRows: 1 };
  purgeUpdateResult: Row = { affectedRows: 1 };
  productLinkRows: Row[] = [];
  productRows: Row[] = [{ id: 9 }];
  deleteVariantError: Error | null = null;
  lockedAssets: Row[] = [
    { id: 'new-asset', status: 'ready', ref_count: 0 },
    { id: 'old-asset', status: 'ready', ref_count: 1 },
  ];

  async query(sql: string, params: unknown[] = []): Promise<QueryResult> {
    this.statements.push({ sql, params });
    if (sql.includes('INSERT INTO image_upload_sessions') && this.insertUploadError) throw this.insertUploadError;
    if (sql.includes('FROM image_upload_sessions WHERE id = ? FOR UPDATE')) {
      return [this.uploadSessionRow ? [this.uploadSessionRow] : [], []];
    }
    if (sql.includes('FROM image_assets WHERE sha256 = ? FOR UPDATE')) return [this.shaAssetRows, []];
    if (sql.includes("WHERE status = 'recycled'") && sql.includes('FOR UPDATE SKIP LOCKED')) return [this.purgeClaimRows, []];
    if (sql.includes("UPDATE image_assets SET status = 'purging'")) return [this.purgeClaimUpdateResult, []];
    if (sql.includes('SELECT id FROM products WHERE id = ? FOR UPDATE')) return [this.productRows, []];
    if (sql.includes('FROM product_image_assets')) return [this.productLinkRows, []];
    if (sql.includes('FROM company_image_assets WHERE company_id = ? AND role = ? FOR UPDATE')) {
      return [[{ asset_id: 'old-asset' }], []];
    }
    if (sql.includes('FROM image_assets WHERE id IN') && sql.includes('FOR UPDATE')) {
      return [this.lockedAssets, []];
    }
    if (sql.includes('FROM image_upload_sessions WHERE id = ?')) return [this.uploadSessionReadRows, []];
    if (sql.includes('FROM image_upload_sessions WHERE quarantine_key = ?')) return [this.quarantineSessionReadRows, []];
    if (sql.includes('FROM image_upload_sessions') && sql.includes('asset_id = ?')) return [this.assetSessionRows, []];
    if (sql.includes('FROM image_upload_sessions') && sql.includes('expires_at <= ?')) return [this.expiredSessionRows, []];
    if (sql.includes('quarantine_cleaned_at = ?')) return [this.cleanupUploadResult, []];
    if (sql.includes('UPDATE image_processing_jobs') && sql.includes("status = 'processing'")) return [this.failJobResult, []];
    if (sql.includes("SET status = 'degraded'")) return [this.markDegradedResult, []];
    if (sql.includes('FROM image_assets WHERE id = ?')) return [this.purgeAssetRows, []];
    if (sql.includes('DELETE FROM image_asset_variants') && this.deleteVariantError) throw this.deleteVariantError;
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

type PurgeRepository = MySqlAssetRepository & {
  claimNextPurgeCandidate(now: Date): Promise<{ assetId: string; variants: Array<{ variant: string; objectKey: string }> } | null>;
  releasePurgeClaim(assetId: string): Promise<boolean>;
};

type CleanupRepository = MySqlAssetRepository & {
  completeExpiredUploadCleanup(sessionId: string, cleanedAt: Date): Promise<boolean>;
};

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
  assert.match(recordedSql, /quarantine_cleaned_at DATETIME NULL/);
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
  const insert = connection.statements.find((statement) => statement.sql.includes('INSERT INTO image_upload_sessions'));

  assert.equal(creatorId, input.createdBy);
  assert.deepEqual(insert?.params.slice(0, 6), [
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
  assert.match(sql(connection), /SELECT \* FROM image_upload_sessions WHERE id = \?/);
  assert.doesNotMatch(sql(connection), /INSERT INTO image_upload_sessions/);
  assert.doesNotMatch(sql(connection), /UPDATE image_upload_sessions/);
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

  assert.doesNotMatch(sql(connection), /INSERT INTO image_upload_sessions/);
  assert.doesNotMatch(sql(connection), /UPDATE image_upload_sessions SET/);
});

test('create upload session rejects a same-ID retry from a different principal before inserting', async () => {
  const connection = new RecordingConnection();
  const expiresAt = new Date('2026-08-23T00:00:00Z');
  connection.uploadSessionReadRows = [{
    id: 'session-retry',
    purpose: 'company_logo',
    quarantine_key: 'quarantine/session-retry/logo.png',
    declared_byte_size: 42,
    declared_mime: 'image/png',
    created_by: 'principal-owner',
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
      declaredByteSize: 42,
      declaredMime: 'image/png',
      createdBy: 'principal-other',
      expiresAt,
    }),
    (error: unknown) => error instanceof ImageAssetError && error.code === 'IMAGE_CONTENT_INVALID',
  );

  assert.match(sql(connection), /SELECT \* FROM image_upload_sessions WHERE id = \?/);
  assert.doesNotMatch(sql(connection), /INSERT INTO image_upload_sessions/);
  assert.doesNotMatch(sql(connection), /UPDATE image_upload_sessions/);
});

test('create upload session rejects a duplicate quarantine key owned by another session ID', async () => {
  const connection = new RecordingConnection();
  const expiresAt = new Date('2026-08-23T00:00:00Z');
  connection.insertUploadError = Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' });
  connection.quarantineSessionReadRows = [{
    id: 'session-owner',
    purpose: 'company_logo',
    quarantine_key: 'quarantine/shared/logo.png',
    declared_byte_size: 42,
    declared_mime: 'image/png',
    created_by: 'principal-owner',
    expires_at: expiresAt,
    status: 'open',
    asset_id: null,
  }];
  const repository = new MySqlAssetRepository(connection);

  await assert.rejects(
    repository.createUploadSession({
      id: 'session-request',
      purpose: 'company_logo',
      quarantineKey: 'quarantine/shared/logo.png',
      declaredByteSize: 42,
      declaredMime: 'image/png',
      createdBy: 'principal-request',
      expiresAt,
    }),
    (error: unknown) => error instanceof ImageAssetError && error.code === 'IMAGE_CONTENT_INVALID',
  );

  assert.match(sql(connection), /SELECT \* FROM image_upload_sessions WHERE quarantine_key = \?/);
  assert.doesNotMatch(sql(connection), /ON DUPLICATE KEY UPDATE/);
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

  assert.deepEqual(result, { assetId: 'session-1', jobCreated: true, processingRequired: true });
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

test('expired upload discovery includes open and expired sessions until quarantine cleanup is recorded', async () => {
  const connection = new RecordingConnection();
  connection.expiredSessionRows = [{
    id: 'expired-session',
    purpose: 'company_logo',
    quarantine_key: 'quarantine/expired/file.png',
    declared_byte_size: 12,
    declared_mime: 'image/png',
    created_by: 'principal-1',
    expires_at: new Date('2026-08-21T00:00:00Z'),
    status: 'expired',
    asset_id: null,
    quarantine_cleaned_at: null,
  }];
  const repository = new MySqlAssetRepository(connection);

  const sessions = await repository.listExpiredUploadSessions(new Date('2026-08-22T00:00:00Z'), 10);

  assert.equal(sessions[0]?.id, 'expired-session');
  const query = connection.statements.find((statement) => statement.sql.includes('expires_at <= ?'));
  assert.ok(query);
  assert.match(query.sql, /status IN \('open', 'expired'\)/);
  assert.match(query.sql, /quarantine_cleaned_at IS NULL/);
});

test('completed expired upload cleanup atomically expires and marks the quarantine key cleaned', async () => {
  const connection = new RecordingConnection();
  const repository = new MySqlAssetRepository(connection) as CleanupRepository;
  const cleanedAt = new Date('2026-08-22T00:00:00Z');

  assert.equal(await repository.completeExpiredUploadCleanup('expired-session', cleanedAt), true);

  const update = connection.statements.find((statement) => statement.sql.includes('quarantine_cleaned_at = ?'));
  assert.ok(update);
  assert.match(update.sql, /SET status = 'expired', quarantine_cleaned_at = \?/);
  assert.match(update.sql, /WHERE id = \? AND status IN \('open', 'expired'\) AND quarantine_cleaned_at IS NULL/);
  assert.deepEqual(update.params, [cleanedAt, 'expired-session']);
});

test('finalized asset cleanup lists only uncleaned quarantines and marks one cleaned', async () => {
  const connection = new RecordingConnection();
  connection.assetSessionRows = [{
    id: 'finalized-session',
    purpose: 'product_image',
    quarantine_key: 'quarantine/finalized/file.png',
    declared_byte_size: 12,
    declared_mime: 'image/png',
    created_by: 'principal-1',
    expires_at: new Date('2026-08-23T00:00:00Z'),
    status: 'finalized',
    asset_id: 'asset-1',
    quarantine_cleaned_at: null,
  }];
  const repository = new MySqlAssetRepository(connection);
  const cleanedAt = new Date('2026-08-22T00:00:00Z');

  const sessions = await repository.listPendingAssetUploadSessions('asset-1');
  assert.equal(sessions[0]?.id, 'finalized-session');
  assert.equal(await repository.markUploadSessionQuarantineCleaned('finalized-session', cleanedAt), true);

  const query = connection.statements.find((statement) => statement.sql.includes('asset_id = ?'));
  assert.ok(query);
  assert.match(query.sql, /status = 'finalized' AND quarantine_cleaned_at IS NULL/);
  const update = connection.statements.find((statement) => statement.sql.includes('quarantine_cleaned_at = ?')
    && statement.sql.includes("status = 'finalized'"));
  assert.ok(update);
  assert.deepEqual(update.params, [cleanedAt, 'finalized-session']);
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

  assert.deepEqual(result, { assetId: 'recycled-asset', jobCreated: false, processingRequired: false });
  assert.match(sql(connection), /SELECT variant FROM image_asset_variants WHERE asset_id = \?/);
  assert.match(sql(connection), /UPDATE image_assets SET purpose = \?, created_by = \?, created_at = NOW\(\), status = \?,\s+recycled_at = NULL, purge_after = NULL, purged_at = NULL/s);
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

  assert.deepEqual(result, { assetId: 'recycled-without-original', jobCreated: true, processingRequired: true });
  assert.match(sql(connection), /UPDATE image_assets SET purpose = \?, created_by = \?, created_at = NOW\(\), status = \?,\s+recycled_at = NULL, purge_after = NULL, purged_at = NULL/s);
  assert.ok(connection.statements.some((statement) => statement.params.includes('principal-reupload') && statement.params.includes('processing')));
  assert.match(sql(connection), /INSERT(?: IGNORE)? INTO image_processing_jobs/);
});

test('verified company duplicate escalates stored purpose and queues missing product variants', async () => {
  const connection = new RecordingConnection();
  connection.uploadSessionRow = { ...connection.uploadSessionRow!, purpose: 'product_image', created_by: 'product-principal' };
  connection.shaAssetRows = [{
    id: 'company-asset',
    sha256: 'f'.repeat(64),
    original_filename: 'company.png',
    detected_mime: 'image/png',
    detected_extension: 'png',
    purpose: 'company_logo',
    storage_provider: 'local',
    byte_size: 12,
    width: 2,
    height: 3,
    status: 'ready',
    ref_count: 0,
    created_by: 'company-principal',
    created_at: new Date('2026-08-20T00:00:00Z'),
    updated_at: new Date('2026-08-20T00:00:00Z'),
    recycled_at: null,
    purge_after: null,
    purged_at: null,
    error_code: null,
    metadata_json: null,
  }];
  connection.variantRows = [{ variant: 'original' }, { variant: 'display' }];
  const repository = new MySqlAssetRepository(connection);

  const finalized = await repository.finalizeUploadSession({
    sessionId: 'session-1',
    principalId: 'product-principal',
    sha256: 'f'.repeat(64),
    originalFilename: 'product.png',
    detectedMime: 'image/png',
    detectedExtension: 'png',
    storageProvider: 'local',
    byteSize: 12,
    width: 2,
    height: 3,
  });

  assert.deepEqual(finalized, { assetId: 'company-asset', jobCreated: true, processingRequired: true });
  const assetUpdate = connection.statements.find((statement) => statement.sql.includes('UPDATE image_assets SET purpose = ?'));
  assert.ok(assetUpdate);
  assert.deepEqual(assetUpdate.params.slice(0, 3), ['product_image', 'product-principal', 'processing']);
  assert.match(sql(connection), /ON DUPLICATE KEY UPDATE/);
});

test('verified company reuse of a complete product keeps product purpose and refreshes creator window', async () => {
  const connection = new RecordingConnection();
  connection.uploadSessionRow = { ...connection.uploadSessionRow!, purpose: 'company_logo', created_by: 'company-principal' };
  connection.shaAssetRows = [{
    id: 'product-asset',
    sha256: '1'.repeat(64),
    original_filename: 'product.png',
    detected_mime: 'image/png',
    detected_extension: 'png',
    purpose: 'product_image',
    storage_provider: 'local',
    byte_size: 12,
    width: 2,
    height: 3,
    status: 'ready',
    ref_count: 0,
    created_by: 'product-principal',
    created_at: new Date('2026-08-20T00:00:00Z'),
    updated_at: new Date('2026-08-20T00:00:00Z'),
    recycled_at: null,
    purge_after: null,
    purged_at: null,
    error_code: null,
    metadata_json: null,
  }];
  connection.variantRows = [{ variant: 'original' }, { variant: 'display' }, { variant: 'thumbnail' }];
  const repository = new MySqlAssetRepository(connection);

  const finalized = await repository.finalizeUploadSession({
    sessionId: 'session-1',
    principalId: 'company-principal',
    sha256: '1'.repeat(64),
    originalFilename: 'company.png',
    detectedMime: 'image/png',
    detectedExtension: 'png',
    storageProvider: 'local',
    byteSize: 12,
    width: 2,
    height: 3,
  });

  assert.deepEqual(finalized, { assetId: 'product-asset', jobCreated: false, processingRequired: false });
  const assetUpdate = connection.statements.find((statement) => statement.sql.includes('UPDATE image_assets SET purpose = ?'));
  assert.ok(assetUpdate);
  assert.deepEqual(assetUpdate.params.slice(0, 3), ['product_image', 'company-principal', 'ready']);
  assert.doesNotMatch(sql(connection), /INSERT INTO image_processing_jobs/);
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

test('claim purge candidate locks eligibility, changes status, then returns retained variants', async () => {
  const connection = new RecordingConnection();
  const now = new Date('2026-08-22T00:00:00Z');
  connection.purgeClaimRows = [{ id: 'purge-asset' }];
  connection.variantRows = [{
    asset_id: 'purge-asset',
    variant: 'original',
    object_key: 'assets/purge/original.png',
    mime: 'image/png',
    byte_size: 12,
    width: 2,
    height: 3,
    created_at: new Date('2026-08-01T00:00:00Z'),
  }];
  const repository = new MySqlAssetRepository(connection) as PurgeRepository;

  const claim = await repository.claimNextPurgeCandidate(now);

  assert.equal(claim?.assetId, 'purge-asset');
  assert.deepEqual(claim?.variants.map((variant) => ({ variant: variant.variant, objectKey: variant.objectKey })), [
    { variant: 'original', objectKey: 'assets/purge/original.png' },
  ]);
  const lockIndex = connection.statements.findIndex((statement) => statement.sql.includes('FOR UPDATE SKIP LOCKED'));
  const claimIndex = connection.statements.findIndex((statement) => statement.sql.includes("SET status = 'purging'"));
  const variantsIndex = connection.statements.findIndex((statement) => statement.sql.includes('FROM image_asset_variants'));
  assert.ok(lockIndex >= 0 && lockIndex < claimIndex && claimIndex < variantsIndex);
  assert.match(connection.statements[lockIndex].sql, /status = 'recycled'.*ref_count = 0.*purge_after <= \?/s);
  assert.match(connection.statements[claimIndex].sql, /WHERE id = \? AND status = 'recycled' AND ref_count = 0 AND purge_after <= \?/);
  assert.deepEqual(connection.transactions, ['BEGIN', 'COMMIT', 'RELEASE']);
});

test('failed purge claim returns before reading variants', async () => {
  const connection = new RecordingConnection();
  connection.purgeClaimRows = [{ id: 'purge-asset' }];
  connection.purgeClaimUpdateResult = { affectedRows: 0 };
  const repository = new MySqlAssetRepository(connection) as PurgeRepository;

  assert.equal(await repository.claimNextPurgeCandidate(new Date('2026-08-22T00:00:00Z')), null);

  assert.doesNotMatch(sql(connection), /FROM image_asset_variants/);
  assert.deepEqual(connection.transactions, ['BEGIN', 'COMMIT', 'RELEASE']);
});

test('purge claim blocks both relink and verified duplicate recovery', async () => {
  const connection = new RecordingConnection();
  connection.purgeClaimRows = [{ id: 'purging-asset' }];
  connection.lockedAssets = [{ id: 'purging-asset', status: 'purging', ref_count: 0 }];
  const claimedAsset = {
    id: 'purging-asset',
    sha256: 'e'.repeat(64),
    original_filename: 'old.png',
    detected_mime: 'image/png',
    detected_extension: 'png',
    purpose: 'company_logo',
    storage_provider: 'local',
    byte_size: 12,
    width: 2,
    height: 3,
    status: 'purging',
    ref_count: 0,
    created_by: 'old-principal',
    created_at: new Date('2000-01-01T00:00:00Z'),
    updated_at: new Date('2000-01-01T00:00:00Z'),
    recycled_at: new Date('2000-01-02T00:00:00Z'),
    purge_after: new Date('2000-02-01T00:00:00Z'),
    purged_at: null,
    error_code: null,
    metadata_json: null,
  };
  const repository = new MySqlAssetRepository(connection) as PurgeRepository;

  assert.ok(await repository.claimNextPurgeCandidate(new Date('2026-08-22T00:00:00Z')));
  await assert.rejects(
    repository.attachProductImages(9, ['purging-asset']),
    (error: unknown) => error instanceof ImageAssetError && error.code === 'ASSET_NOT_READY',
  );

  connection.shaAssetRows = [claimedAsset];
  await assert.rejects(
    repository.finalizeUploadSession({
      sessionId: 'session-1',
      principalId: 'principal-1',
      sha256: 'e'.repeat(64),
      originalFilename: 'verified.png',
      detectedMime: 'image/png',
      detectedExtension: 'png',
      storageProvider: 'local',
      byteSize: 12,
      width: 2,
      height: 3,
    }),
    (error: unknown) => error instanceof ImageAssetError && error.code === 'ASSET_NOT_READY',
  );

  assert.doesNotMatch(sql(connection), /INSERT INTO product_image_assets/);
  assert.doesNotMatch(sql(connection), /SET status = 'finalized', asset_id/);
});

test('release purge claim returns only purging zero-reference assets to recycled', async () => {
  const connection = new RecordingConnection();
  const repository = new MySqlAssetRepository(connection) as PurgeRepository;

  assert.equal(await repository.releasePurgeClaim('purge-asset'), true);

  const release = connection.statements.find((statement) => statement.sql.includes("SET status = 'recycled'"));
  assert.ok(release);
  assert.match(release.sql, /WHERE id = \? AND status = 'purging' AND ref_count = 0/);
  assert.doesNotMatch(release.sql, /purge_after\s*=/);
});

test('mark purged checks eligibility before deleting metadata and updates status last', async () => {
  const connection = new RecordingConnection();
  connection.purgeAssetRows = [{ id: 'purge-asset', status: 'purging', ref_count: 0, purge_after: new Date('2026-08-21T00:00:00Z') }];
  const repository = new MySqlAssetRepository(connection);
  const at = new Date('2026-08-22T00:00:00Z');

  await repository.markPurged('purge-asset', at);

  const eligibilityIndex = connection.statements.findIndex((statement) => statement.sql.includes('FOR UPDATE'));
  const metadataDeleteIndex = connection.statements.findIndex((statement) => statement.sql.includes('DELETE FROM image_asset_variants'));
  const statusUpdateIndex = connection.statements.findIndex((statement) => statement.sql.includes("SET status = 'purged'"));
  assert.ok(eligibilityIndex >= 0 && eligibilityIndex < metadataDeleteIndex);
  assert.ok(metadataDeleteIndex < statusUpdateIndex);
  assert.deepEqual(connection.statements[metadataDeleteIndex].params, ['purge-asset']);
  assert.deepEqual(connection.statements[statusUpdateIndex].params, [at, 'purge-asset', at]);
  assert.match(connection.statements[statusUpdateIndex].sql, /WHERE id = \? AND status = 'purging' AND ref_count = 0 AND purge_after <= \?/);
  assert.deepEqual(connection.transactions, ['BEGIN', 'COMMIT', 'RELEASE']);
});

test('mark purged rejects an unclaimed recycled asset before deleting variant metadata', async () => {
  const connection = new RecordingConnection();
  connection.purgeAssetRows = [{ id: 'purge-asset', status: 'recycled', ref_count: 0, purge_after: new Date('2026-08-21T00:00:00Z') }];
  const repository = new MySqlAssetRepository(connection);

  await assert.rejects(
    repository.markPurged('purge-asset', new Date('2026-08-22T00:00:00Z')),
    (error: unknown) => error instanceof ImageAssetError && error.code === 'ASSET_NOT_READY',
  );

  assert.doesNotMatch(sql(connection), /DELETE FROM image_asset_variants/);
  assert.doesNotMatch(sql(connection), /UPDATE image_assets SET status = 'purged'/);
  assert.deepEqual(connection.transactions, ['BEGIN', 'ROLLBACK', 'RELEASE']);
});

test('mark purged rolls back metadata deletion when its guarded status update fails', async () => {
  const connection = new RecordingConnection();
  connection.purgeAssetRows = [{ id: 'purge-asset', status: 'purging', ref_count: 0, purge_after: new Date('2026-08-21T00:00:00Z') }];
  connection.purgeUpdateResult = { affectedRows: 0 };
  const repository = new MySqlAssetRepository(connection);

  await assert.rejects(
    repository.markPurged('purge-asset', new Date('2026-08-22T00:00:00Z')),
    (error: unknown) => error instanceof ImageAssetError && error.code === 'ASSET_NOT_READY',
  );

  assert.match(sql(connection), /DELETE FROM image_asset_variants/);
  assert.deepEqual(connection.transactions, ['BEGIN', 'ROLLBACK', 'RELEASE']);
});

test('mark purged rolls back when variant metadata deletion fails', async () => {
  const connection = new RecordingConnection();
  connection.purgeAssetRows = [{ id: 'purge-asset', status: 'purging', ref_count: 0, purge_after: new Date('2026-08-21T00:00:00Z') }];
  connection.deleteVariantError = new Error('metadata delete failed');
  const repository = new MySqlAssetRepository(connection);

  await assert.rejects(repository.markPurged('purge-asset', new Date('2026-08-22T00:00:00Z')), /metadata delete failed/);

  assert.doesNotMatch(sql(connection), /UPDATE image_assets SET status = 'purged'/);
  assert.deepEqual(connection.transactions, ['BEGIN', 'ROLLBACK', 'RELEASE']);
});

test('mark purged treats an already-purged retry as an idempotent no-op', async () => {
  const connection = new RecordingConnection();
  const repository = new MySqlAssetRepository(connection);
  const at = new Date('2026-08-22T00:00:00Z');
  connection.purgeAssetRows = [{ id: 'purge-asset', status: 'purged', ref_count: 0, purge_after: null }];

  await repository.markPurged('purge-asset', at);

  assert.doesNotMatch(sql(connection), /DELETE FROM image_asset_variants/);
  assert.doesNotMatch(sql(connection), /UPDATE image_assets SET status = 'purged'/);
  assert.deepEqual(connection.transactions, ['BEGIN', 'COMMIT', 'RELEASE']);
});

test('fail job cannot overwrite a completed job', async () => {
  const connection = new RecordingConnection();
  const repository = new MySqlAssetRepository(connection);
  const retryAt = new Date('2026-08-22T00:00:05Z');

  assert.equal(await repository.failJob(42, 'STORAGE_UNAVAILABLE', retryAt), true);

  const update = connection.statements.find((statement) => statement.sql.includes('UPDATE image_processing_jobs'));
  assert.ok(update);
  assert.match(update.sql, /WHERE id = \? AND status = 'processing'/);
  assert.deepEqual(update.params, ['queued', retryAt, 'STORAGE_UNAVAILABLE', 42]);
});

test('completed job race reports no failure transition and ready asset cannot be degraded', async () => {
  const connection = new RecordingConnection();
  connection.failJobResult = { affectedRows: 0 };
  connection.markDegradedResult = { affectedRows: 0 };
  const repository = new MySqlAssetRepository(connection);

  assert.equal(await repository.failJob(42, 'STORAGE_UNAVAILABLE', null), false);
  assert.equal(await repository.markAssetDegraded('ready-asset', 'STORAGE_UNAVAILABLE'), false);

  const degrade = connection.statements.find((statement) => statement.sql.includes("SET status = 'degraded'"));
  assert.ok(degrade);
  assert.match(degrade.sql, /WHERE id = \? AND status IN \('processing', 'degraded'\)/);
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

test('attaching product images persists the first link as the primary pattern and appends later links in supplied order', async () => {
  const connection = new RecordingConnection();
  connection.lockedAssets = [
    { id: 'asset-pattern', status: 'ready', ref_count: 0 },
    { id: 'asset-gallery', status: 'ready', ref_count: 0 },
  ];
  const repository = new MySqlAssetRepository(connection);

  await repository.attachProductImages(9, ['asset-pattern', 'asset-gallery']);

  const inserts = connection.statements.filter((statement) => statement.sql.includes('INSERT INTO product_image_assets'));
  assert.equal(inserts.length, 2);
  assert.match(inserts[0].sql, /role, sort_order, is_primary/);
  assert.deepEqual(inserts[0].params, [9, 'asset-pattern', 'pattern_original', 0, 1]);
  assert.deepEqual(inserts[1].params, [9, 'asset-gallery', 'gallery', 1, 0]);
  assert.match(sql(connection), /SELECT COUNT\(\*\) AS image_count FROM product_image_assets WHERE product_id = \? AND deleted_at IS NULL/);
  assert.match(sql(connection), /UPDATE products SET image_count = \? WHERE id = \?/);
});

test('detaching every product asset soft-deletes links and decrements references without deleting stored objects', async () => {
  const connection = new RecordingConnection();
  connection.productLinkRows = [{ asset_id: 'asset-shared' }, { asset_id: 'asset-single' }];
  connection.lockedAssets = [
    { id: 'asset-shared', status: 'ready', ref_count: 2 },
    { id: 'asset-single', status: 'ready', ref_count: 1 },
  ];
  const repository = new MySqlAssetRepository(connection);

  await repository.detachAllProductImages(9);

  const recordedSql = sql(connection);
  assert.match(recordedSql, /FROM product_image_assets WHERE product_id = \? AND deleted_at IS NULL FOR UPDATE/);
  assert.match(recordedSql, /UPDATE product_image_assets SET deleted_at = NOW\(\) WHERE product_id = \? AND deleted_at IS NULL/);
  assert.match(recordedSql, /UPDATE image_assets SET ref_count = ref_count - 1/);
  assert.match(recordedSql, /UPDATE products SET image_count = \? WHERE id = \?/);
  assert.doesNotMatch(recordedSql, /DELETE FROM image_asset_variants|deleteFromCOS|DELETE FROM product_images/);
});

test('deleting a product locks and removes active asset links with reference decrements in one MySQL transaction', async () => {
  const connection = new RecordingConnection();
  connection.productLinkRows = [{ asset_id: 'asset-shared' }, { asset_id: 'asset-single' }];
  connection.lockedAssets = [
    { id: 'asset-shared', status: 'ready', ref_count: 2 },
    { id: 'asset-single', status: 'ready', ref_count: 1 },
  ];
  const repository = new MySqlAssetRepository(connection);

  const deleted = await repository.deleteProductWithAssets(9);

  assert.equal(deleted, true);
  assert.deepEqual(connection.transactions, ['BEGIN', 'COMMIT', 'RELEASE']);
  const recordedSql = sql(connection);
  assert.match(recordedSql, /SELECT id FROM products WHERE id = \? FOR UPDATE/);
  assert.match(recordedSql, /FROM product_image_assets WHERE product_id = \? AND deleted_at IS NULL FOR UPDATE/);
  assert.match(recordedSql, /DELETE FROM product_images WHERE product_id = \?/);
  assert.match(recordedSql, /DELETE FROM products WHERE id = \?/);
  assert.match(recordedSql, /UPDATE image_assets SET ref_count = ref_count - 1/);
  assert.doesNotMatch(recordedSql, /DELETE FROM image_asset_variants|deleteFromCOS/);
});
