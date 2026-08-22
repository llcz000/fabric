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
  lockedAssets: Row[] = [
    { id: 'new-asset', status: 'ready', ref_count: 0 },
    { id: 'old-asset', status: 'ready', ref_count: 1 },
  ];

  async query(sql: string, params: unknown[] = []): Promise<QueryResult> {
    this.statements.push({ sql, params });
    if (sql.includes('FROM image_upload_sessions WHERE id = ? FOR UPDATE')) {
      return [[{
        id: 'session-1',
        purpose: 'product_image',
        quarantine_key: 'quarantine/session-1/file.png',
        declared_byte_size: 12,
        declared_mime: 'image/png',
        created_by: 'principal-1',
        expires_at: new Date('2026-08-22T00:00:00Z'),
        status: 'open',
        asset_id: null,
      }], []];
    }
    if (sql.includes('FROM image_assets WHERE sha256 = ? FOR UPDATE')) return [[], []];
    if (sql.includes('FROM product_image_assets')) return [[], []];
    if (sql.includes('FROM company_image_assets WHERE company_id = ? AND role = ? FOR UPDATE')) {
      return [[{ asset_id: 'old-asset' }], []];
    }
    if (sql.includes('FROM image_assets WHERE id IN') && sql.includes('FOR UPDATE')) {
      return [this.lockedAssets, []];
    }
    if (sql.includes('FROM image_upload_sessions WHERE id = ?')) return [[], []];
    if (sql.includes('FROM image_assets WHERE id = ?')) return [[], []];
    if (sql.includes('FROM image_asset_variants WHERE asset_id = ?')) return [[], []];
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
