import { types } from 'node:util';
import { validateColorwayMigrationPreflight } from './colorwayMigrationPreflight';
import { V2_SCHEMA_VERSION } from './schemaContract';

const INVALID_PLAN = 'Invalid migration review plan';

/**
 * All fields below are reviewer-supplied CLAIMS, not authenticated evidence.
 * Identifiers use 1–192 ASCII letters/digits and . _ : @ / - (no whitespace).
 * Target UUIDs are lowercase canonical UUID strings; MySQL versions are exact
 * numeric 8.minor.patch strings. Schema versions are numbers, never strings.
 */
export interface MigrationTargetClaim {
  readonly database: string;
  readonly serverUuid: string;
  readonly mysqlVersion: string;
  readonly environment: 'isolated-sandbox';
  readonly providedBy: string;
  readonly reference: string;
}

interface ReviewedEvidenceClaim {
  readonly reference: string;
  readonly performedBy: string;
  readonly reviewedBy: string;
  readonly verified: true;
  readonly database: string;
  readonly serverUuid: string;
  readonly schemaVersion: 1 | 2;
}

export interface MigrationLockRollbackPlanInput {
  readonly snapshot: {
    readonly masterId: string;
    readonly persistedNextColorwayNo: string;
    readonly savedNumbers: readonly string[];
  };
  readonly snapshotProof: {
    readonly reference: string;
    readonly providedBy: string;
    readonly reviewedBy: string;
    readonly consistentRead: true;
    readonly complete: true;
  };
  readonly expectedTarget: MigrationTargetClaim;
  readonly observedTarget: MigrationTargetClaim;
  readonly currentVersion: 1 | 2;
  readonly goalVersion: 2;
  readonly backup: ReviewedEvidenceClaim & { readonly snapshotReference: string };
  readonly restoreTest: ReviewedEvidenceClaim & {
    readonly backupReference: string;
    readonly restoredDatabase: string;
  };
  readonly rollbackOwner: string;
  readonly approval: {
    readonly reference: string;
    readonly approvedBy: string;
    readonly approved: true;
    readonly scope: 'isolated-sandbox-migration';
    readonly database: string;
    readonly serverUuid: string;
    readonly fromVersion: 1 | 2;
    readonly toVersion: 2;
    readonly snapshotReference: string;
    readonly backupReference: string;
    readonly restoreTestReference: string;
    readonly ddlImplicitCommitAcknowledged: true;
    readonly transactionalRollback: false;
  };
}

function requireClaim(condition: boolean): asserts condition {
  if (!condition) throw new Error(INVALID_PLAN);
}

// Read descriptors into a fresh plain record; never invoke caller getters,
// coercion hooks or Proxy traps. Unknown, inherited and symbolic keys fail closed.
function record<K extends string>(input: unknown, keys: readonly K[]): Record<K, unknown> {
  requireClaim(input !== null && typeof input === 'object' && !types.isProxy(input) && !Array.isArray(input));
  const prototype = Object.getPrototypeOf(input);
  requireClaim(prototype === Object.prototype || prototype === null);
  const actual = Reflect.ownKeys(input);
  requireClaim(actual.length === keys.length && actual.every(key => typeof key === 'string' && keys.includes(key as K)));
  const result = Object.create(null) as Record<K, unknown>;
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    requireClaim(!!descriptor && 'value' in descriptor && descriptor.enumerable === true);
    result[key] = descriptor.value;
  }
  return result;
}

function identifier(value: unknown): string {
  requireClaim(typeof value === 'string' && value.length <= 192 && value.trim() === value && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]*$/.test(value));
  return value;
}

function sandboxDatabase(value: unknown): string {
  requireClaim(typeof value === 'string' && value.length <= 64 && value.trim() === value &&
    /^fabric_v2_test_[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(value) && !/prod/i.test(value));
  return value;
}

function targetClaim(input: unknown) {
  const claim = record(input, ['database', 'serverUuid', 'mysqlVersion', 'environment', 'providedBy', 'reference']);
  const database = sandboxDatabase(claim.database);
  const serverUuid = identifier(claim.serverUuid);
  requireClaim(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(serverUuid) &&
    serverUuid !== '00000000-0000-0000-0000-000000000000');
  const mysqlVersion = identifier(claim.mysqlVersion);
  requireClaim(/^8\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/.test(mysqlVersion));
  requireClaim(claim.environment === 'isolated-sandbox');
  return Object.freeze({ database, serverUuid, mysqlVersion, environment: 'isolated-sandbox' as const,
    providedBy: identifier(claim.providedBy), reference: identifier(claim.reference) });
}

/**
 * AC-71 OFFLINE REVIEW ONLY. Composes the durable-counter preflight unchanged;
 * never recovers counters from surviving/deleted rows, repairs or allocates IDs.
 *
 * Caller must independently audit snapshot completeness/consistency, independent
 * target observations, sandbox isolation, real backups and successful restores,
 * reviewer identities and approval authenticity. Matching strings/boolean proof
 * labels cannot prove these facts, actual locks or a working rollback. Even a
 * fabric_v2_test_* name can be mislabeled production: naming is not attestation.
 * No production acceptance/approval is manufactured by this plan.
 *
 * This function accepts data only. No SQL/query, connection, lock acquisition,
 * transaction or database write occurs. V1 -> V2 DDL implicitly commits in
 * MySQL; a transaction rollback cannot undo it. Future execution and recovery
 * require separate audited approvals. Every returned step is NONEXECUTABLE
 * prose; releaseAuthorized remains false even when all claims are consistent.
 */
export function validateMigrationLockRollbackPlan(input: unknown) {
  try {
    const root = record(input, ['snapshot', 'snapshotProof', 'expectedTarget', 'observedTarget',
      'currentVersion', 'goalVersion', 'backup', 'restoreTest', 'rollbackOwner', 'approval']);
    requireClaim(root.currentVersion === 1 || root.currentVersion === V2_SCHEMA_VERSION);
    requireClaim(root.goalVersion === V2_SCHEMA_VERSION);
    const currentVersion = root.currentVersion;
    const expected = targetClaim(root.expectedTarget);
    const observed = targetClaim(root.observedTarget);
    requireClaim(expected.database === observed.database && expected.serverUuid === observed.serverUuid &&
      expected.mysqlVersion === observed.mysqlVersion && expected.providedBy !== observed.providedBy);

    const snapshot = record(root.snapshot, ['masterId', 'persistedNextColorwayNo', 'savedNumbers']);
    requireClaim(Array.isArray(snapshot.savedNumbers) && !types.isProxy(snapshot.savedNumbers));
    // Reject hidden hooks/extra fields. Numeric range, density, duplicates and
    // the durable counter relation remain the existing preflight's responsibility.
    const savedKeys = Reflect.ownKeys(snapshot.savedNumbers);
    requireClaim(savedKeys.every(key => typeof key === 'string' && (key === 'length' || /^(?:0|[1-9][0-9]*)$/.test(key))));
    const preflight = validateColorwayMigrationPreflight(snapshot);
    const snapshotProof = record(root.snapshotProof, ['reference', 'providedBy', 'reviewedBy', 'consistentRead', 'complete']);
    const snapshotReference = identifier(snapshotProof.reference);
    requireClaim(identifier(snapshotProof.providedBy) !== identifier(snapshotProof.reviewedBy) &&
      snapshotProof.consistentRead === true && snapshotProof.complete === true);

    const backup = record(root.backup, ['reference', 'performedBy', 'reviewedBy', 'verified',
      'database', 'serverUuid', 'schemaVersion', 'snapshotReference']);
    const restore = record(root.restoreTest, ['reference', 'performedBy', 'reviewedBy', 'verified',
      'database', 'serverUuid', 'schemaVersion', 'backupReference', 'restoredDatabase']);
    const backupReference = identifier(backup.reference);
    const restoreTestReference = identifier(restore.reference);
    for (const proof of [backup, restore]) {
      requireClaim(identifier(proof.performedBy) !== identifier(proof.reviewedBy) && proof.verified === true &&
        proof.database === expected.database && proof.serverUuid === expected.serverUuid && proof.schemaVersion === currentVersion);
    }
    requireClaim(backup.snapshotReference === snapshotReference && restore.backupReference === backupReference);
    requireClaim(sandboxDatabase(restore.restoredDatabase) !== expected.database);
    const rollbackOwner = identifier(root.rollbackOwner);

    const approval = record(root.approval, ['reference', 'approvedBy', 'approved', 'scope', 'database',
      'serverUuid', 'fromVersion', 'toVersion', 'snapshotReference', 'backupReference',
      'restoreTestReference', 'ddlImplicitCommitAcknowledged', 'transactionalRollback']);
    const approvalReference = identifier(approval.reference);
    const approvedBy = identifier(approval.approvedBy);
    requireClaim(approval.approved === true && approval.scope === 'isolated-sandbox-migration' &&
      approval.database === expected.database && approval.serverUuid === expected.serverUuid &&
      approval.fromVersion === currentVersion && approval.toVersion === V2_SCHEMA_VERSION &&
      approval.snapshotReference === snapshotReference && approval.backupReference === backupReference &&
      approval.restoreTestReference === restoreTestReference && approval.ddlImplicitCommitAcknowledged === true &&
      approval.transactionalRollback === false);
    const references = [snapshotReference, expected.reference, observed.reference, backupReference, restoreTestReference, approvalReference];
    requireClaim(new Set(references).size === references.length);

    const step = (id: string, instruction: string) => Object.freeze({ id, executable: false as const, instruction });
    const migrationRequired = currentVersion !== V2_SCHEMA_VERSION;
    return Object.freeze({
      kind: 'REVIEW_PLAN' as const,
      executable: false as const,
      releaseAuthorized: false as const,
      claimsIndependentlyAudited: false as const,
      currentVersion,
      goalVersion: V2_SCHEMA_VERSION,
      migrationRequired,
      target: Object.freeze({ database: expected.database, serverUuid: expected.serverUuid, mysqlVersion: expected.mysqlVersion }),
      preflight,
      evidence: Object.freeze({ snapshotReference, expectedTargetReference: expected.reference,
        observedTargetReference: observed.reference, backupReference, restoreTestReference, approvalReference, approvedBy }),
      rollback: Object.freeze({ owner: rollbackOwner, transactional: false as const,
        strategy: 'Separately approved restoration of the independently audited backup; MySQL DDL implicit commits cannot be undone by transaction rollback.',
        backupReference, restoreTestReference }),
      limitations: Object.freeze([
        'Snapshots, independent-provider labels, proof references and approvals are unauthenticated claims until independently audited.',
        'This review cannot prove sandbox isolation, a real backup, successful restoration, actual lock ownership or permission to execute.',
        'No production acceptance, release authorization, SQL execution, database writes or lock acquisition is provided.',
      ]),
      steps: Object.freeze([
        step('connection-lock', 'NONEXECUTABLE: After separate execution approval and isolation audit, use a dedicated connection and a per-connection migration lock; on contention or uncertain ownership stop. Keep that connection for all gated work, including implicit DDL commits.'),
        step('locked-recheck', 'NONEXECUTABLE: Under that lock recheck the expected and observed database, server UUID, MySQL version, schema version and complete consistent master snapshot. Stop on drift, missing proof, lock loss or connection loss; never reconstruct the durable counter.'),
        step('backup-restore-evidence', 'NONEXECUTABLE: Independently audit the target-bound backup, successful restore test on a separate isolated sandbox, distinct evidence references, rollback owner and recovery approval. Ensure evidence still covers the locked snapshot before any migration.'),
        step('approved-migration', migrationRequired
          ? 'NONEXECUTABLE: Only a separately approved executor may perform reviewed V1 to V2 migration steps. MySQL DDL implicitly commits; transaction rollback is not recovery. Any failure stops further changes and requires the named owner and separately approved restoration.'
          : 'NONEXECUTABLE: Schema version is already V2; perform no upgrade or downgrade. Still require the lock, evidence, approval and schema/counter verification; never silently repair drift.'),
        step('verify-schema-counters', 'NONEXECUTABLE: While retaining lock ownership, independently verify the V2 schema contract and durable monotonic counters against the reviewed snapshot. Saved numbers remain unchanged, including deleted or inactive history. On failure stop and invoke the separately approved recovery process; this plan proves no verification occurred.'),
        step('safe-release', 'NONEXECUTABLE: Record verification or failure and hand off unresolved recovery before release. Release only the lock owned by the same dedicated connection; never release another owner’s lock. On connection loss stop, establish ownership and identity anew before any separately approved retry. Record safe closure even on failure.'),
      ]),
    });
  } catch {
    // Do not expose caller data, getter/proxy exceptions or dependency details.
    throw new Error(INVALID_PLAN);
  }
}

export type MigrationLockRollbackReviewPlan = ReturnType<typeof validateMigrationLockRollbackPlan>;
