import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateMigrationLockRollbackPlan } from './migrationLockRollbackPlan';

const database = 'fabric_v2_test_ac71';
const serverUuid = '12345678-1234-1234-1234-123456789abc';
function fixture() {
  return {
    snapshot: { masterId: '7', persistedNextColorwayNo: '4', savedNumbers: ['1', '3'] },
    snapshotProof: { reference: 'snapshot-1', providedBy: 'reader', reviewedBy: 'auditor', consistentRead: true, complete: true },
    expectedTarget: { database, serverUuid, mysqlVersion: '8.0.46', environment: 'isolated-sandbox', providedBy: 'target-owner', reference: 'expected-1' },
    observedTarget: { database, serverUuid, mysqlVersion: '8.0.46', environment: 'isolated-sandbox', providedBy: 'independent-observer', reference: 'observed-1' },
    currentVersion: 1,
    goalVersion: 2,
    backup: { reference: 'backup-1', performedBy: 'backup-operator', reviewedBy: 'backup-reviewer', verified: true, database, serverUuid, schemaVersion: 1, snapshotReference: 'snapshot-1' },
    restoreTest: { reference: 'restore-1', performedBy: 'restore-operator', reviewedBy: 'restore-reviewer', verified: true, database, serverUuid, schemaVersion: 1, backupReference: 'backup-1', restoredDatabase: 'fabric_v2_test_restore_ac71' },
    rollbackOwner: 'rollback-owner',
    approval: { reference: 'approval-1', approvedBy: 'migration-approver', approved: true, scope: 'isolated-sandbox-migration', database, serverUuid, fromVersion: 1, toVersion: 2, snapshotReference: 'snapshot-1', backupReference: 'backup-1', restoreTestReference: 'restore-1', ddlImplicitCommitAcknowledged: true, transactionalRollback: false },
  };
}
function rejects(input: unknown) {
  assert.throws(() => validateMigrationLockRollbackPlan(input), { name: 'Error', message: 'Invalid migration review plan' });
}

test('valid V1 snapshot yields an ordered nonexecutable review plan without recovering deleted number 2', () => {
  const plan = validateMigrationLockRollbackPlan(fixture());
  assert.equal(plan.kind, 'REVIEW_PLAN');
  assert.equal(plan.executable, false);
  assert.equal(plan.releaseAuthorized, false);
  assert.equal(plan.claimsIndependentlyAudited, false);
  assert.deepEqual(plan.preflight, { masterId: '7', persistedNextColorwayNo: '4', highestSavedNumber: '3', savedCount: 2 });
  assert.deepEqual(plan.steps.map((step: { id: string }) => step.id), ['connection-lock', 'locked-recheck', 'backup-restore-evidence', 'approved-migration', 'verify-schema-counters', 'safe-release']);
  for (const step of plan.steps) {
    assert.equal(step.executable, false);
    assert.equal(typeof step.instruction, 'string');
    assert.equal('sql' in step, false);
  }
  assert.equal(plan.rollback.transactional, false);
});

test('already V2 still requires all safety evidence and never plans a downgrade', () => {
  const input = fixture();
  input.currentVersion = input.backup.schemaVersion = input.restoreTest.schemaVersion = input.approval.fromVersion = 2;
  const plan = validateMigrationLockRollbackPlan(input);
  assert.equal(plan.currentVersion, 2);
  assert.equal(plan.migrationRequired, false);
  assert.equal(plan.goalVersion, 2);
});

test('missing or malformed root fails closed', () => {
  for (const value of [undefined, null, [], '', 1, {}, { ...fixture(), snapshot: null }]) rejects(value);
});

test('every required root field must be supplied', () => {
  for (const key of Object.keys(fixture())) {
    const input: any = fixture();
    delete input[key];
    rejects(input);
  }
});

test('unknown versions, string versions and downgrade requests fail closed', () => {
  for (const currentVersion of [0, 3, -1, 1.5, '1', NaN, Infinity]) rejects({ ...fixture(), currentVersion });
  for (const goalVersion of [1, 3, '2', null]) rejects({ ...fixture(), goalVersion });
});

test('noncanonical, out of range and rounded numeric snapshot values are rejected', () => {
  for (const value of ['01', '1\n', '0', '-1', '1e2', '18446744073709551616', 1, null]) {
    rejects({ ...fixture(), snapshot: { ...fixture().snapshot, masterId: value } });
    rejects({ ...fixture(), snapshot: { ...fixture().snapshot, persistedNextColorwayNo: value } });
  }
  rejects({ ...fixture(), snapshot: { ...fixture().snapshot, savedNumbers: ['4294967296'] } });
});

test('missing or stale durable counters are rejected rather than reconstructed', () => {
  for (const persistedNextColorwayNo of [undefined, '1', '3']) {
    rejects({ ...fixture(), snapshot: { ...fixture().snapshot, persistedNextColorwayNo } });
  }
});

test('preflight rejects duplicates and sparse snapshots', () => {
  for (const savedNumbers of [['1', '1'], new Array(1)]) rejects({ ...fixture(), snapshot: { ...fixture().snapshot, savedNumbers } });
});

test('deleted highest rows and empty snapshots retain their durable high counters', () => {
  for (const savedNumbers of [[], ['1']]) {
    const input = fixture();
    input.snapshot = { masterId: '7', persistedNextColorwayNo: '18446744073709551615', savedNumbers };
    assert.equal(validateMigrationLockRollbackPlan(input).preflight.persistedNextColorwayNo, '18446744073709551615');
  }
});

test('target database and UUID and exact MySQL version must match independently supplied identity', () => {
  for (const change of [{ database: 'fabric_v2_test_other' }, { serverUuid: '22345678-1234-1234-1234-123456789abc' }, { mysqlVersion: '8.4.1' }]) {
    const input = fixture();
    Object.assign(input.observedTarget, change);
    rejects(input);
  }
});

test('production, ambiguous and noncanonical database targets are never accepted', () => {
  for (const name of ['fabric', 'fabric_v2', 'fabric_v2_test_', 'fabric_v2_test_prod', 'fabric_v2_test_production_copy', 'fabric_v2_test_ac71\n', 'Fabric_v2_test_ac71']) {
    const input = fixture();
    input.expectedTarget.database = input.observedTarget.database = name;
    rejects(input);
  }
});

test('UUID and MySQL version syntax is strict', () => {
  for (const serverUuid of ['', '1234', '12345678-1234-1234-1234-123456789abc\n', '00000000-0000-0000-0000-000000000000']) {
    const input = fixture();
    input.expectedTarget.serverUuid = input.observedTarget.serverUuid = serverUuid;
    rejects(input);
  }
  for (const mysqlVersion of ['5.7.44', '9.0.1', '8.00.46', '8.0.46-commercial', '8.0.46\n', '8.0']) {
    const input = fixture();
    input.expectedTarget.mysqlVersion = input.observedTarget.mysqlVersion = mysqlVersion;
    rejects(input);
  }
});

test('target independence and explicit sandbox claims are mandatory', () => {
  const input = fixture();
  input.observedTarget.providedBy = input.expectedTarget.providedBy;
  rejects(input);
  rejects({ ...fixture(), observedTarget: { ...fixture().observedTarget, environment: 'production' } });
});

test('every required proof field is mandatory', () => {
  for (const section of ['snapshotProof', 'expectedTarget', 'observedTarget', 'backup', 'restoreTest', 'approval']) {
    for (const key of Object.keys((fixture() as any)[section])) {
      const input: any = fixture();
      delete input[section][key];
      rejects(input);
    }
  }
});

test('backup and restore require independent reviewers and explicit verification', () => {
  for (const section of ['backup', 'restoreTest'] as const) {
    const input = fixture();
    input[section].reviewedBy = input[section].performedBy;
    rejects(input);
    rejects({ ...fixture(), [section]: { ...fixture()[section], verified: 'true' } });
    rejects({ ...fixture(), [section]: { ...fixture()[section], verified: false } });
  }
  rejects({ ...fixture(), snapshotProof: { ...fixture().snapshotProof, reviewedBy: 'reader' } });
  rejects({ ...fixture(), snapshotProof: { ...fixture().snapshotProof, consistentRead: false } });
  rejects({ ...fixture(), snapshotProof: { ...fixture().snapshotProof, complete: false } });
});

test('proofs bind the same target schema snapshot and backup, with separate restore database', () => {
  for (const section of ['backup', 'restoreTest', 'approval']) {
    for (const [key, value] of [['database', 'fabric_v2_test_other'], ['serverUuid', '22345678-1234-1234-1234-123456789abc']]) {
      const input: any = fixture();
      input[section][key as string] = value;
      rejects(input);
    }
  }
  const inconsistentProofs: [string, string, unknown][] = [
    ['backup', 'schemaVersion', 2], ['restoreTest', 'schemaVersion', 2], ['approval', 'fromVersion', 2], ['approval', 'toVersion', 1],
    ['backup', 'snapshotReference', 'other'], ['approval', 'snapshotReference', 'other'],
    ['restoreTest', 'backupReference', 'other'], ['approval', 'backupReference', 'other'], ['approval', 'restoreTestReference', 'other'],
    ['restoreTest', 'restoredDatabase', database], ['restoreTest', 'restoredDatabase', 'fabric_production'],
  ];
  for (const [section, key, value] of inconsistentProofs) {
    const input: any = fixture();
    input[section][key] = value;
    rejects(input);
  }
});

test('all evidence reference identifiers must be distinct', () => {
  for (const section of ['backup', 'restoreTest', 'approval', 'expectedTarget', 'observedTarget']) {
    const input: any = fixture();
    input[section].reference = input.snapshotProof.reference;
    rejects(input);
  }
  const input = fixture();
  input.approval.reference = input.backup.reference;
  rejects(input);
});

test('approval and owner are explicit; implicit DDL commits cannot be transactional rollback', () => {
  for (const change of [{ approved: false }, { scope: 'production' }, { ddlImplicitCommitAcknowledged: false }, { transactionalRollback: true }]) {
    rejects({ ...fixture(), approval: { ...fixture().approval, ...change } });
  }
  for (const rollbackOwner of ['', ' ', ' owner', 'owner\n', null]) rejects({ ...fixture(), rollbackOwner });
});

test('proof identifiers reject non-string, whitespace and coercion objects', () => {
  let calls = 0;
  for (const reference of ['', ' a', 'a\n', 1, { toString() { calls++; return 'evidence'; } }]) {
    rejects({ ...fixture(), backup: { ...fixture().backup, reference } });
  }
  assert.equal(calls, 0);
});

test('injected getters at root, proof, snapshot and saved array are rejected without invocation', () => {
  let calls = 0;
  for (const location of ['root', 'proof', 'snapshot', 'array']) {
    const input = fixture();
    const [target, key] = location === 'root' ? [input, 'snapshot'] : location === 'proof' ? [input.backup, 'reference'] : location === 'snapshot' ? [input.snapshot, 'masterId'] : [input.snapshot.savedNumbers, '0'];
    Object.defineProperty(target, key, { enumerable: true, get() { calls++; throw Error('secret'); } });
    rejects(input);
  }
  assert.equal(calls, 0);
});

test('hostile proxy exceptions are replaced with the generic safe error', () => {
  rejects(new Proxy({}, { ownKeys() { throw Error('SECRET'); } }));
});

test('unknown fields, inherited fields and executable hooks fail closed without SQL or lock calls', () => {
  let calls = 0;
  for (const name of ['query', 'execute', 'acquireLock']) {
    rejects({ ...fixture(), [name]: () => { calls++; } });
  }
  rejects({ ...fixture(), backup: { ...fixture().backup, productionApproved: true } });
  rejects(Object.create(fixture()));
  const plan = validateMigrationLockRollbackPlan(fixture());
  assert.equal(plan.executable, false);
  assert.equal(calls, 0);
});

test('result is recursively frozen, detached from caller objects and does not mutate input', () => {
  const input = fixture();
  const before = JSON.stringify(input);
  const plan = validateMigrationLockRollbackPlan(input);
  assert.equal(JSON.stringify(input), before);
  function frozen(value: any) {
    if (value && typeof value === 'object') {
      assert.equal(Object.isFrozen(value), true);
      for (const child of Object.values(value)) frozen(child);
    }
  }
  frozen(plan);
  assert.equal(Reflect.set(plan, 'goalVersion', 1), false);
  assert.equal(plan.goalVersion, 2);
  input.snapshot.persistedNextColorwayNo = '9';
  input.backup.reference = 'changed';
  assert.equal(plan.preflight.persistedNextColorwayNo, '4');
  assert.equal(plan.evidence.backupReference, 'backup-1');
});
