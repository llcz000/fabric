import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { generatePatternLinkToken } from './patternLinkToken';
import {
  resolvePatternLink,
  type PatternLinkDecisionVerifier,
  type PatternLinkReadPool,
} from './patternLinkStore';

// Synthetic fixtures only; never issued or persisted.
const TOKEN = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const DIGEST = '021d65009eb1fa6f2ffb1e15bd5bb032b2d5baae716bdc2c3a6e18505d00bca5';
const ALLOW: PatternLinkDecisionVerifier = async () => ({
  authorizationVerified: true, publicationVerified: true,
});

function activeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    token_hash: DIGEST,
    pattern_master_id: '42',
    link_status: 'active',
    revoked_at: null,
    parent_is_active: 1,
    ...overrides,
  };
}

function database(rows: unknown = [activeRow()]) {
  const calls: { sql: string; params: unknown[] | undefined }[] = [];
  const pool: PatternLinkReadPool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return [rows, []];
    },
  };
  return { pool, calls };
}

test('authorized active lookup returns only an internal pattern reference', async () => {
  const db = database();
  assert.deepEqual(await resolvePatternLink(db.pool, TOKEN, ALLOW), { patternMasterId: '42' });
  assert.equal(db.calls.length, 1);
});

test('missing server decision denies token possession before querying', async () => {
  const db = database();
  assert.equal(await resolvePatternLink(db.pool, TOKEN), null);
  assert.deepEqual(db.calls, []);
});

test('client-style truthy decision values cannot substitute for a server verifier', async () => {
  for (const decision of [true, {}, { authorizationVerified: true, publicationVerified: true }, 'allow']) {
    const db = database();
    assert.equal(await resolvePatternLink(db.pool, TOKEN,
      decision as unknown as PatternLinkDecisionVerifier), null);
    assert.deepEqual(db.calls, []);
  }
});

test('lookup emits one fixed read with a digest placeholder and current parent join', async () => {
  const db = database();
  await resolvePatternLink(db.pool, TOKEN, ALLOW);
  assert.equal(db.calls.length, 1);
  const { sql, params } = db.calls[0];
  assert.match(sql, /^SELECT\s/);
  assert.match(sql, /FROM pattern_share_links AS link\s+LEFT JOIN pattern_masters AS parent ON parent.id = link.master_id/);
  assert.match(sql, /WHERE link.token_hash = \?\s+LIMIT 2$/);
  assert.equal((sql.match(/\?/g) ?? []).length, 1);
  assert.doesNotMatch(sql, /\*|\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|product|customer)\b/i);
  assert.deepEqual(params, [DIGEST]);
  assert.ok(!JSON.stringify(db.calls).includes(TOKEN));

  const otherToken = generatePatternLinkToken(() => new Uint8Array(32).fill(255));
  await resolvePatternLink(db.pool, otherToken, ALLOW);
  assert.equal(db.calls[1].sql, sql);
  assert.deepEqual(db.calls[1].params, [
    createHash('sha256').update('fabric:pattern-share:v1\0' + otherToken, 'ascii').digest('hex'),
  ]);
});

test('malformed opaque tokens return null without touching the database or verifier', async () => {
  let decisions = 0;
  for (const token of [null, undefined, 42, {}, Buffer.from(TOKEN), new String(TOKEN), '',
    'private-marker', TOKEN + "' OR 1=1--", TOKEN + '\n', ' ' + TOKEN,
    TOKEN.slice(0, 42) + '9', `sample-card:${TOKEN}`, `https://example.invalid/p/${TOKEN}`,
    { toString() { throw new Error('private-marker'); } }]) {
    const db = database();
    assert.equal(await resolvePatternLink(db.pool, token, async () => {
      decisions += 1;
      return { authorizationVerified: true, publicationVerified: true };
    }), null);
    assert.deepEqual(db.calls, []);
  }
  assert.equal(decisions, 0);
});

test('unknown token returns the same null as invalid and revoked records', async () => {
  const db = database([]);
  let decisions = 0;
  assert.equal(await resolvePatternLink(db.pool, TOKEN, async () => {
    decisions += 1;
    return { authorizationVerified: true, publicationVerified: true };
  }), null);
  assert.equal(db.calls.length, 1);
  assert.equal(decisions, 0);
});

test('duplicate digest rows fail closed even when one is inactive', async () => {
  for (const rows of [[activeRow(), activeRow()],
    [activeRow(), activeRow({ link_status: 'inactive' })]]) {
    const db = database(rows);
    assert.equal(await resolvePatternLink(db.pool, TOKEN, ALLOW), null);
  }
});

for (const status of ['revoked', 'inactive', 'ACTIVE', '', null, undefined, true, 1]) {
  test(`non-active link status ${String(status)} returns null before authorization`, async () => {
    const db = database([activeRow({ link_status: status })]);
    let decisions = 0;
    assert.equal(await resolvePatternLink(db.pool, TOKEN, async () => {
      decisions += 1;
      return { authorizationVerified: true, publicationVerified: true };
    }), null);
    assert.equal(decisions, 0);
  });
}

test('revocation evidence overrides active status including malformed values', async () => {
  for (const revokedAt of ['2026-10-15 00:00:00', new Date(0), '', 0, false, undefined]) {
    const db = database([activeRow({ revoked_at: revokedAt })]);
    assert.equal(await resolvePatternLink(db.pool, TOKEN, ALLOW), null);
  }
});

test('missing or inactive current parent cannot resolve', async () => {
  for (const active of [0, null, undefined, '1', true, 2]) {
    const db = database([activeRow({ parent_is_active: active })]);
    assert.equal(await resolvePatternLink(db.pool, TOKEN, ALLOW), null);
  }
});

test('digest equality is exact even if database collation would match differently', async () => {
  const unscoped = createHash('sha256').update(TOKEN, 'ascii').digest('hex');
  const cardDigest = createHash('sha256').update('fabric:sample-card:v1\0' + TOKEN, 'ascii').digest('hex');
  for (const digest of [DIGEST.toUpperCase(), '0'.repeat(64), unscoped, cardDigest,
    DIGEST + '\n', null, Buffer.from(DIGEST)]) {
    const db = database([activeRow({ token_hash: digest })]);
    assert.equal(await resolvePatternLink(db.pool, TOKEN, ALLOW), null);
  }
});

test('malformed identifiers fail without coercion or bigint precision loss', async () => {
  for (const id of [42, 42n, 0, '0', '-1', '01', ' 42', '42\n', '4.2', '1e2', '',
    '18446744073709551616', null, undefined, { toString() { throw new Error('private-marker'); } }]) {
    const db = database([activeRow({ pattern_master_id: id })]);
    assert.equal(await resolvePatternLink(db.pool, TOKEN, ALLOW), null);
  }
});

test('unsigned BIGINT parent identity remains exact as an internal string', async () => {
  const db = database([activeRow({ pattern_master_id: '18446744073709551615' })]);
  assert.deepEqual(await resolvePatternLink(db.pool, TOKEN, ALLOW), {
    patternMasterId: '18446744073709551615',
  });
});

test('malformed database row containers and missing fields fail closed', async () => {
  for (const rows of [null, [undefined], {}, { 0: activeRow(), length: 1 }, [null], [false],
    [[]], [DIGEST], [Object.create(activeRow())]]) {
    assert.equal(await resolvePatternLink(database(rows).pool, TOKEN, ALLOW), null);
  }
  for (const key of Object.keys(activeRow())) {
    const row = activeRow();
    delete row[key];
    assert.equal(await resolvePatternLink(database([row]).pool, TOKEN, ALLOW), null);
  }
});

test('each authorization and publication check must return literal true', async () => {
  for (const decision of [null, undefined, false, true, {}, [],
    { authorizationVerified: true }, { publicationVerified: true },
    { authorizationVerified: false, publicationVerified: true },
    { authorizationVerified: true, publicationVerified: false },
    { authorizationVerified: 'true', publicationVerified: true },
    { authorizationVerified: true, publicationVerified: 1 }]) {
    const db = database();
    assert.equal(await resolvePatternLink(db.pool, TOKEN, async () => decision), null);
  }
});

test('server verifier receives only a frozen validated identity without token or row extras', async () => {
  const db = database([activeRow({ customer: 'private-marker', product: 'private-marker' })]);
  const received: unknown[] = [];
  assert.deepEqual(await resolvePatternLink(db.pool, TOKEN, async reference => {
    received.push(reference);
    assert.equal(Object.isFrozen(reference), true);
    assert.deepEqual(reference, { patternMasterId: '42' });
    return { authorizationVerified: true, publicationVerified: true };
  }), { patternMasterId: '42' });
  assert.deepEqual(received, [{ patternMasterId: '42' }]);
});

test('current row and fresh server decision are checked on every lookup without caching', async () => {
  const row = activeRow();
  const db = database([row]);
  let allowed = true;
  let decisions = 0;
  const verify: PatternLinkDecisionVerifier = async () => {
    decisions += 1;
    return { authorizationVerified: allowed, publicationVerified: allowed };
  };
  assert.deepEqual(await resolvePatternLink(db.pool, TOKEN, verify), { patternMasterId: '42' });
  allowed = false;
  assert.equal(await resolvePatternLink(db.pool, TOKEN, verify), null);
  allowed = true;
  row.parent_is_active = 0;
  assert.equal(await resolvePatternLink(db.pool, TOKEN, verify), null);
  row.parent_is_active = 1;
  row.revoked_at = '2026-10-15 00:00:00';
  assert.equal(await resolvePatternLink(db.pool, TOKEN, verify), null);
  assert.equal(db.calls.length, 4);
  assert.equal(decisions, 2);
});

test('database failures discard upstream details and always resolve null', async () => {
  for (const failure of [new Error('private-marker ' + TOKEN), TOKEN, null]) {
    const pool: PatternLinkReadPool = { async query() { throw failure; } };
    assert.equal(await resolvePatternLink(pool, TOKEN, ALLOW), null);
  }
});

test('authorization failures discard upstream details and always resolve null', async () => {
  for (const failure of [new Error('private-marker ' + TOKEN), TOKEN, null]) {
    assert.equal(await resolvePatternLink(database().pool, TOKEN, async () => { throw failure; }), null);
  }
});

test('hostile row or decision getters do not escape the resolver', async () => {
  const row = activeRow();
  Object.defineProperty(row, 'link_status', { get() { throw new Error('private-marker'); } });
  assert.equal(await resolvePatternLink(database([row]).pool, TOKEN, ALLOW), null);
  assert.equal(await resolvePatternLink(database().pool, TOKEN, async () => ({
    get authorizationVerified() { throw new Error('private-marker'); }, publicationVerified: true,
  })), null);
});
