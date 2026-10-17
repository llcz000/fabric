import { hashPatternLinkToken, isPatternLinkToken } from './patternLinkToken';

/** A trusted MySQL-style read adapter, never a client-supplied connection. */
export interface PatternLinkReadPool {
  query(sql: string, params?: unknown[]): Promise<[unknown, unknown]>;
}

export interface PatternLinkReference {
  readonly patternMasterId: string;
}

/**
 * Trusted server-only seam, closed over the current request's verified context.
 * Recheck authorization AND publication for this exact pattern on every call.
 * Return { authorizationVerified: true, publicationVerified: true } only after
 * both checks succeed. Client flags or possession of a token are not evidence.
 */
export type PatternLinkDecisionVerifier = (reference: Readonly<PatternLinkReference>) => Promise<unknown>;

/**
 * Standalone repository CONTRACT, not a deployed schema or public service.
 * Proposed mapping: pattern_share_links(token_hash, master_id, status,
 * revoked_at) -> pattern_masters(id, is_active). Only 'active', NULL revocation
 * and numeric parent activity 1 are accepted. Unknown states deny access.
 *
 * External integration gates: approve/verify this schema, a unique binary
 * token_hash key, FK/parent identity, MySQL driver row types, privileges and
 * exact database target/current server identity before injecting a real pool.
 * This module neither verifies those gates nor creates/changes any tables.
 * Do not enable a public route from this contract or pass client decisions.
 * Public switch, issuance, validity/expiry, revocation UX, authorization rules
 * and safe image preview still require their own approval/integration gates.
 */
const LOOKUP_SQL = `SELECT link.token_hash AS token_hash,
  CAST(link.master_id AS CHAR) AS pattern_master_id,
  link.status AS link_status, link.revoked_at AS revoked_at,
  parent.is_active AS parent_is_active
FROM pattern_share_links AS link
LEFT JOIN pattern_masters AS parent ON parent.id = link.master_id
WHERE link.token_hash = ?
LIMIT 2`;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Returns only an internal reference, NEVER public content or an access grant.
 * All denials/errors return null without logging or propagating upstream data.
 * One current read snapshot; downstream use must recheck permission/activity at
 * use time (including preview). No promise of atomic revocation across services
 * or timing indistinguishability. No cache, raw-token storage, writes or policy.
 */
export async function resolvePatternLink(
  pool: PatternLinkReadPool,
  token: unknown,
  verifyServerDecision?: PatternLinkDecisionVerifier,
): Promise<PatternLinkReference | null> {
  try {
    if (typeof verifyServerDecision !== 'function' || !isPatternLinkToken(token)) return null;
    const digest = hashPatternLinkToken(token);
    const result = await pool.query(LOOKUP_SQL, [digest]);
    if (!Array.isArray(result) || result.length !== 2) return null;
    const [rows] = result;
    // Do not filter status in SQL or LIMIT 1: duplicates must deny even when
    // one row is inactive or its parent is missing. LEFT JOIN retains them.
    if (!Array.isArray(rows) || rows.length !== 1) return null;
    const row: unknown = rows[0];
    if (!record(row) || !['token_hash', 'pattern_master_id', 'link_status',
      'revoked_at', 'parent_is_active'].every(key => Object.hasOwn(row, key))) return null;
    if (row.token_hash !== digest || row.link_status !== 'active'
      || row.revoked_at !== null || row.parent_is_active !== 1) return null;
    const id = row.pattern_master_id;
    // CAST returns canonical unsigned BIGINT text, never a lossy JS number.
    if (typeof id !== 'string' || id.length > 20 || !/^[1-9][0-9]*$/.test(id)
      || BigInt(id) > 18446744073709551615n) return null;
    const reference: PatternLinkReference = Object.freeze({ patternMasterId: id });
    const decision = await verifyServerDecision(reference);
    if (!record(decision) || !Object.hasOwn(decision, 'authorizationVerified')
      || !Object.hasOwn(decision, 'publicationVerified')
      || decision.authorizationVerified !== true || decision.publicationVerified !== true) return null;
    return reference;
  } catch {
    return null;
  }
}
