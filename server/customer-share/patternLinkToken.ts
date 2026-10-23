import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

declare const tokenBrand: unique symbol;
declare const hashBrand: unique symbol;
export type PatternLinkToken = string & { readonly [tokenBrand]: true };
export type PatternLinkTokenHash = string & { readonly [hashBrand]: true };
export type PatternLinkEntropySource = (size: number) => Uint8Array;

// This namespace is exclusively for pattern links, never physical sample cards.
const HASH_DOMAIN = 'fabric:pattern-share:v1\0';
const ENTROPY_BYTES = 32;

/**
 * The optional source is a trusted test seam only; production callers omit it.
 * No identifiers, URLs, business data or approval state enter token generation.
 */
export function generatePatternLinkToken(
  source: PatternLinkEntropySource = randomBytes,
): PatternLinkToken {
  try {
    const bytes = source(ENTROPY_BYTES);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== ENTROPY_BYTES) {
      throw new Error();
    }
    return Buffer.from(bytes).toString('base64url') as PatternLinkToken;
  } catch {
    // Never propagate upstream entropy failures or attach potentially secret causes.
    throw new Error('Pattern link token generation failed');
  }
}

/** Validate the raw token only: no trimming, URL parsing, coercion or decoding wrappers. */
export function isPatternLinkToken(token: unknown): token is PatternLinkToken {
  if (typeof token !== 'string' || token.length !== 43 || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return false;
  }
  // Node's decoder is permissive; round-trip equality also rejects unused tail bits.
  const bytes = Buffer.from(token, 'base64url');
  return bytes.length === ENTROPY_BYTES && bytes.toString('base64url') === token;
}

/** Stable lookup identity, encoded as 64 lowercase hex characters. Not an access grant. */
export function hashPatternLinkToken(token: unknown): PatternLinkTokenHash {
  if (!isPatternLinkToken(token)) {
    throw new Error('Invalid pattern link token');
  }
  return createHash('sha256').update(HASH_DOMAIN, 'ascii').update(token, 'ascii')
    .digest('hex') as PatternLinkTokenHash;
}

/** Only the final comparison of well-formed 32-byte digests is timing safe. */
export function matchesPatternLinkTokenHash(token: unknown, digest: unknown): boolean {
  if (!isPatternLinkToken(token) || typeof digest !== 'string' || digest.length !== 64
    || !/^[0-9a-f]{64}$/.test(digest)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(hashPatternLinkToken(token), 'hex'), Buffer.from(digest, 'hex'));
}
