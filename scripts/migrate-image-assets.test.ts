import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { ImageAssetError } from '../server/image-assets/errors';
import {
  buildMigrationSources,
  buildReport,
  buildSummary,
  completedSourceIdsFromResults,
  parseMigrationArgs,
  redactSecrets,
  resolveReportPath,
  runMigration,
  type MigrationBackend,
  type MigrationResult,
  type MigrationSource,
} from './migrate-image-assets';

interface FakeState {
  reads: number;
  inspects: number;
  ingests: number;
  attaches: Array<{ kind: string; id: number; target: string }>;
  completions: Array<{ sourceId: string; assetId: string }>;
  cleanedUp: boolean;
  assetIdsByHash: Map<string, string>;
  completed: Set<string>;
  failReadSourceIds: Set<string>;
  readResult: (source: MigrationSource) => Buffer;
}

function fakeState(): FakeState {
  return {
    reads: 0,
    inspects: 0,
    ingests: 0,
    attaches: [],
    completions: [],
    cleanedUp: false,
    assetIdsByHash: new Map(),
    completed: new Set(),
    failReadSourceIds: new Set(),
    readResult: (source) => Buffer.from(source.sourceId),
  };
}

function fakeBackend(state: FakeState): MigrationBackend {
  const backend: MigrationBackend = {
    async loadLegacyRows() {
      return { companyRows: [], productRows: [] };
    },
    async readSource(source) {
      state.reads += 1;
      if (state.failReadSourceIds.has(source.sourceId)) {
        throw new ImageAssetError('STORAGE_UNAVAILABLE', 503, true, 'Legacy source is unavailable');
      }
      return state.readResult(source);
    },
    async inspect(buffer) {
      state.inspects += 1;
      const sha256 = createHash('sha256').update(buffer).digest('hex');
      return { sha256, existingAssetId: state.assetIdsByHash.get(sha256) ?? null };
    },
    async ingest(buffer) {
      state.ingests += 1;
      const sha256 = createHash('sha256').update(buffer).digest('hex');
      const existing = state.assetIdsByHash.get(sha256);
      if (existing) return { assetId: existing, deduplicated: true };
      const assetId = 'asset-' + (state.assetIdsByHash.size + 1);
      state.assetIdsByHash.set(sha256, assetId);
      return { assetId, deduplicated: false };
    },
    async attachCompany(companyId, role, assetId) {
      state.attaches.push({ kind: 'company', id: companyId, target: role + ':' + assetId });
    },
    async attachProduct(productId, assetId) {
      state.attaches.push({ kind: 'product', id: productId, target: assetId });
    },
    async markCompleted(source, assetId) {
      state.completions.push({ sourceId: source.sourceId, assetId });
      state.completed.add(source.sourceId);
    },
    async isCompleted(source) {
      return state.completed.has(source.sourceId);
    },
    async cleanup() {
      state.cleanedUp = true;
    },
  };
  return backend;
}

test('buildMigrationSources maps company fields and product rows with role/primary/order', () => {
  const company = [
    { id: 1, brand_logo: 'https://bucket.cos.ap-shanghai.myqcloud.com/logo.png', wechat_qr: 'wx-qr', alipay_qr: '' },
  ];
  const products = [
    { id: 10, product_id: 1, sort_order: 0, cos_key: 'k0', local_path: '' },
    { id: 11, product_id: 1, sort_order: 1, cos_key: 'k1', local_path: '' },
    { id: 12, product_id: 2, sort_order: 0, cos_key: '', local_path: '/uploads/p2.png' },
    { id: 13, product_id: 3, sort_order: 0, cos_key: '', local_path: '' },
  ];
  const sources = buildMigrationSources(company, products, 'all');

  const companySources = sources.filter((s) => s.kind === 'company');
  assert.deepEqual(companySources.map((s) => s.role), ['brand_logo', 'wechat_qr']);
  assert.deepEqual(companySources.map((s) => s.purpose), ['company_logo', 'company_qr']);

  const productSources = sources.filter((s) => s.kind === 'product');
  assert.deepEqual(
    productSources.map((s) => s.sourceId),
    ['product:1:image:10', 'product:1:image:11', 'product:2:image:12'],
  );
  assert.equal(productSources[0].role, 'pattern_original');
  assert.equal(productSources[0].isPrimary, true);
  assert.equal(productSources[1].role, 'gallery');
  assert.equal(productSources[1].isPrimary, false);
  assert.equal(productSources[2].role, 'pattern_original');
  assert.equal(productSources[2].isPrimary, true);
  assert.equal(productSources[2].rawSource, '/uploads/p2.png');
});

test('dry-run performs no writes and records deterministic results', async () => {
  const state = fakeState();
  const backend = fakeBackend(state);
  const sources = buildMigrationSources(
    [{ id: 1, brand_logo: 'logo' }],
    [{ id: 1, product_id: 1, sort_order: 0, cos_key: 'k' }],
    'all',
  );
  const results = await runMigration(sources, backend, { dryRun: true, batchSize: 100 });

  assert.equal(state.ingests, 0);
  assert.equal(state.attaches.length, 0);
  assert.equal(state.completions.length, 0);
  assert.equal(results.length, 2);
  assert.ok(results.every((r) => r.status === 'dry-run'));
  assert.equal(state.cleanedUp, true);
});

test('apply re-running skips already completed sources without duplication', async () => {
  const state = fakeState();
  state.readResult = () => Buffer.from('same-logo');
  const backend = fakeBackend(state);
  const sources = buildMigrationSources([{ id: 1, brand_logo: 'logo' }], [], 'all');

  const first = await runMigration(sources, backend, { dryRun: false, batchSize: 100 });
  assert.equal(first.filter((r) => r.status === 'migrated').length, 1);

  const second = await runMigration(sources, backend, { dryRun: false, batchSize: 100 });
  assert.equal(second.filter((r) => r.status === 'skipped').length, 1);
  assert.equal(state.attaches.length, 1);
  assert.equal(state.assetIdsByHash.size, 1);
});

test('--after-id resume cursor filters sources', async () => {
  const state = fakeState();
  state.readResult = () => Buffer.from('bytes');
  const backend = fakeBackend(state);
  const products = [
    { id: 1, product_id: 1, sort_order: 0, cos_key: 'a' },
    { id: 2, product_id: 1, sort_order: 1, cos_key: 'b' },
    { id: 3, product_id: 2, sort_order: 0, cos_key: 'c' },
  ];
  const sources = buildMigrationSources([], products, 'product');
  const results = await runMigration(sources, backend, { dryRun: false, batchSize: 100, afterId: 1 });

  const migrated = results.filter((r) => r.status === 'migrated');
  assert.deepEqual(migrated.map((r) => r.legacyId), [2, 3]);
  assert.equal(migrated.length, 2);
});

test('--after-id cursor scopes to product rows and never skips company sources', async () => {
  const state = fakeState();
  state.readResult = () => Buffer.from('bytes');
  const backend = fakeBackend(state);
  const company = [
    { id: 1, brand_logo: 'logo', wechat_qr: 'qr', alipay_qr: '' },
  ];
  const products = [
    { id: 1, product_id: 1, sort_order: 0, cos_key: 'a' },
    { id: 2, product_id: 1, sort_order: 1, cos_key: 'b' },
    { id: 3, product_id: 2, sort_order: 0, cos_key: 'c' },
    { id: 4, product_id: 3, sort_order: 0, cos_key: 'd' },
  ];
  const sources = buildMigrationSources(company, products, 'all');
  const results = await runMigration(sources, backend, { dryRun: false, batchSize: 100, afterId: 3 });

  const companyResults = results.filter((r) => r.domain === 'company');
  assert.equal(companyResults.length, 2);
  assert.ok(companyResults.every((r) => r.status === 'migrated'));

  const productResults = results.filter((r) => r.domain === 'product');
  assert.deepEqual(productResults.map((r) => r.legacyId), [4]);
  assert.equal(productResults[0].status, 'migrated');
});

test('identical content deduplicates to one asset with both products linked', async () => {
  const state = fakeState();
  state.readResult = () => Buffer.from('same-content');
  const backend = fakeBackend(state);
  const products = [
    { id: 1, product_id: 1, sort_order: 0, cos_key: 'a' },
    { id: 2, product_id: 2, sort_order: 0, cos_key: 'a' },
  ];
  const sources = buildMigrationSources([], products, 'product');
  const results = await runMigration(sources, backend, { dryRun: false, batchSize: 100 });

  const migrated = results.filter((r) => r.status === 'migrated');
  assert.equal(migrated.length, 2);
  assert.equal(migrated[0].assetId, migrated[1].assetId);
  assert.equal(migrated.filter((r) => r.deduplicated).length, 1);
  assert.equal(state.assetIdsByHash.size, 1);
  assert.equal(state.attaches.length, 2);
});

test('deduplicated legacy ids in one product are both skipped on rerun via the completion ledger', async () => {
  const products = [
    { id: 1, product_id: 1, sort_order: 0, cos_key: 'a' },
    { id: 2, product_id: 1, sort_order: 1, cos_key: 'a' },
  ];
  const sources = buildMigrationSources([], products, 'product');

  const firstState = fakeState();
  firstState.readResult = () => Buffer.from('same-content');
  const firstBackend = fakeBackend(firstState);
  const first = await runMigration(sources, firstBackend, { dryRun: false, batchSize: 100 });
  assert.equal(first.filter((r) => r.status === 'migrated').length, 2);
  assert.equal(firstState.assetIdsByHash.size, 1);

  const completedSourceIds = completedSourceIdsFromResults(first);

  const secondState = fakeState();
  const secondBackend = fakeBackend(secondState);
  const second = await runMigration(sources, secondBackend, {
    dryRun: false,
    batchSize: 100,
    completedSourceIds,
  });
  assert.equal(second.filter((r) => r.status === 'skipped').length, 2);
  assert.equal(secondState.ingests, 0);
  assert.equal(secondState.attaches.length, 0);
});

test('each migrated source attaches exactly once (refCount correctness at orchestration level)', async () => {
  const state = fakeState();
  state.readResult = () => Buffer.from('shared');
  const backend = fakeBackend(state);
  const products = [
    { id: 1, product_id: 1, sort_order: 0, cos_key: 'a' },
    { id: 2, product_id: 2, sort_order: 0, cos_key: 'a' },
  ];
  const sources = buildMigrationSources([], products, 'product');
  await runMigration(sources, backend, { dryRun: false, batchSize: 100 });

  assert.equal(state.attaches.length, 2);
  assert.equal(state.completions.length, 2);
  assert.equal(new Set(state.attaches.map((a) => a.target)).size, 1);
});

test('partial failure records a stable error, continues, and is retryable on resume', async () => {
  const state = fakeState();
  state.readResult = (source) => Buffer.from(source.sourceId);
  const backend = fakeBackend(state);
  state.failReadSourceIds.add('product:1:image:2');
  const products = [
    { id: 1, product_id: 1, sort_order: 0, cos_key: 'a' },
    { id: 2, product_id: 1, sort_order: 1, cos_key: 'b' },
    { id: 3, product_id: 2, sort_order: 0, cos_key: 'c' },
  ];
  const sources = buildMigrationSources([], products, 'product');

  const first = await runMigration(sources, backend, { dryRun: false, batchSize: 100 });
  const failed = first.filter((r) => r.status === 'failed');
  assert.equal(failed.length, 1);
  assert.equal(failed[0].errorCode, 'STORAGE_UNAVAILABLE');
  assert.equal(first.filter((r) => r.status === 'migrated').length, 2);
  assert.ok(!state.completed.has('product:1:image:2'));

  state.failReadSourceIds.clear();
  const resume = await runMigration(sources, backend, { dryRun: false, batchSize: 100, afterId: 1 });
  const retried = resume.filter((r) => r.status === 'migrated');
  assert.equal(retried.length, 1);
  assert.equal(retried[0].sourceId, 'product:1:image:2');
});

test('results and logs never contain credentials or signed URLs', async () => {
  const state = fakeState();
  const backend: MigrationBackend = {
    ...fakeBackend(state),
    async readSource() {
      throw new Error('cos SecretKey=SUPER_SECRET_VALUE failed while reading');
    },
  };
  const sources = buildMigrationSources(
    [{ id: 1, brand_logo: 'https://bucket.cos.ap-shanghai.myqcloud.com/logo.png?sign=TOKEN123' }],
    [],
    'company',
  );
  const results = await runMigration(sources, backend, { dryRun: false, batchSize: 100 });
  const serialized = JSON.stringify(buildReport(results, 'company', false));

  assert.ok(!serialized.includes('SUPER_SECRET_VALUE'));
  assert.ok(!serialized.includes('TOKEN123'));
  assert.ok(!serialized.includes('sign='));
  assert.match(redactSecrets('SecretKey=abc, sign=xyz, Bearer tok'), /redacted/);
  assert.ok(!redactSecrets('SecretKey=abc, sign=xyz').includes('abc'));
});

test('redactSecrets redacts the full token after Bearer', () => {
  const redacted = redactSecrets('Authorization: Bearer abc.def.ghi');
  assert.ok(!redacted.includes('abc.def.ghi'));
  assert.match(redacted, /\[redacted\]/);
});

test('resolveReportPath rejects paths escaping the project directory', () => {
  const project = process.platform === 'win32' ? 'D:\fabric\app' : '/home/fabric/app';
  assert.throws(() => resolveReportPath(project, '../outside.json'), /inside the project/);
  assert.throws(() => resolveReportPath(project, 'sub/../../outside.json'), /inside the project/);

  const ok = resolveReportPath(project, 'reports/migration.json');
  assert.equal(path.relative(project, ok), path.join('reports', 'migration.json'));
  assert.equal(path.basename(resolveReportPath(project)), 'migration-report.json');
});

test('cleanup runs even when a source fails', async () => {
  const state = fakeState();
  const backend = fakeBackend(state);
  state.failReadSourceIds.add('company:1:brand_logo');
  const sources = buildMigrationSources([{ id: 1, brand_logo: 'logo' }], [], 'company');
  await runMigration(sources, backend, { dryRun: false, batchSize: 100 });
  assert.equal(state.cleanedUp, true);
});

test('parseMigrationArgs defaults to dry-run and validates flags', () => {
  assert.deepEqual(parseMigrationArgs([]), {
    dryRun: true,
    apply: false,
    domain: 'all',
    batchSize: 100,
    afterId: undefined,
    report: undefined,
  });

  const apply = parseMigrationArgs(['--apply', '--domain=product', '--batch-size=50', '--after-id=9', '--report=reports/m.json']);
  assert.equal(apply.apply, true);
  assert.equal(apply.dryRun, false);
  assert.equal(apply.domain, 'product');
  assert.equal(apply.batchSize, 50);
  assert.equal(apply.afterId, 9);
  assert.equal(apply.report, 'reports/m.json');

  assert.throws(() => parseMigrationArgs(['--domain=nope']));
  assert.throws(() => parseMigrationArgs(['--batch-size=0']));
  assert.throws(() => parseMigrationArgs(['--after-id=-1']));
  assert.throws(() => parseMigrationArgs(['--unknown']));
});

test('buildSummary aggregates statuses', () => {
  const results: MigrationResult[] = [
    { sourceId: 'a', legacyId: 1, domain: 'product', status: 'migrated', assetId: 'x', deduplicated: false },
    { sourceId: 'b', legacyId: 2, domain: 'product', status: 'migrated', assetId: 'x', deduplicated: true },
    { sourceId: 'c', legacyId: 3, domain: 'product', status: 'skipped' },
    { sourceId: 'd', legacyId: 4, domain: 'product', status: 'failed', errorCode: 'X' },
    { sourceId: 'e', legacyId: 5, domain: 'company', status: 'dry-run' },
  ];
  const summary = buildSummary(results);
  assert.equal(summary.total, 5);
  assert.equal(summary.migrated, 2);
  assert.equal(summary.deduplicated, 1);
  assert.equal(summary.skipped, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.dryRun, 1);
});
