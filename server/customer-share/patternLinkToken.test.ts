import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  generatePatternLinkToken,
  hashPatternLinkToken,
  isPatternLinkToken,
  matchesPatternLinkTokenHash,
  type PatternLinkEntropySource,
} from './patternLinkToken';

// Synthetic public fixtures, never issued credentials.
const TOKEN = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const HASH = '021d65009eb1fa6f2ffb1e15bd5bb032b2d5baae716bdc2c3a6e18505d00bca5';
const BYTES = Uint8Array.from({ length: 32 }, (_, index) => index);

function assertSanitizedFailure(action: () => unknown, message: string): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, message);
    assert.equal(error.cause, undefined);
    assert.deepEqual(Object.keys(error), []);
    assert.ok(!String(error.stack).includes('PRIVATE-ENTROPY-MARKER'));
    return true;
  });
}

test('generation encodes exactly the requested 32 bytes without embedded metadata', () => {
  const calls: number[] = [];
  const token = generatePatternLinkToken(size => { calls.push(size); return BYTES; });
  assert.equal(token, TOKEN);
  assert.deepEqual(calls, [32]);
  assert.deepEqual(Buffer.from(token, 'base64url'), Buffer.from(BYTES));
  assert.deepEqual(BYTES, Uint8Array.from({ length: 32 }, (_, index) => index));
});

test('default cryptographic source produces a canonical 43-character 32-byte token', () => {
  const token = generatePatternLinkToken();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(token, 'base64url').length, 32);
  assert.equal(Buffer.from(token, 'base64url').toString('base64url'), token);
});

test('generation preserves byte view offsets and supports Buffer entropy', () => {
  const backing = new Uint8Array(40).fill(255);
  backing.set(BYTES, 4);
  assert.equal(generatePatternLinkToken(() => backing.subarray(4, 36)), TOKEN);
  assert.equal(generatePatternLinkToken(() => Buffer.from(BYTES)), TOKEN);
});

test('short, long and empty entropy fail closed without fallback', () => {
  for (const length of [0, 1, 16, 31, 33, 64]) {
    let calls = 0;
    assertSanitizedFailure(() => generatePatternLinkToken(() => {
      calls += 1;
      return new Uint8Array(length);
    }), 'Pattern link token generation failed');
    assert.equal(calls, 1);
  }
});

test('non-byte entropy cannot be silently coerced or accepted by length alone', () => {
  for (const value of [null, undefined, Array(32).fill(1), 'a'.repeat(32),
    new ArrayBuffer(32), new Uint16Array(32), { length: 32, byteLength: 32 }]) {
    assertSanitizedFailure(() => generatePatternLinkToken(
      (() => value) as unknown as PatternLinkEntropySource,
    ), 'Pattern link token generation failed');
  }
});

test('entropy exceptions discard upstream messages, causes and thrown values', () => {
  for (const failure of [new Error('PRIVATE-ENTROPY-MARKER'), 'PRIVATE-ENTROPY-MARKER', null]) {
    assertSanitizedFailure(() => generatePatternLinkToken(() => { throw failure; }),
      'Pattern link token generation failed');
  }
});

test('validator accepts canonical URL-safe alphabet including dash and underscore', () => {
  for (const token of [TOKEN, 'A'.repeat(43), '_'.repeat(42) + '8', '-'.repeat(42) + '8']) {
    assert.equal(isPatternLinkToken(token), true);
  }
});

test('validator rejects every noncanonical final sextet instead of normalizing it', () => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  for (let index = 0; index < alphabet.length; index += 1) {
    const candidate = 'A'.repeat(42) + alphabet[index];
    assert.equal(isPatternLinkToken(candidate), index % 4 === 0, `sextet ${index}`);
  }
});

test('validator rejects short, long, hex, padded and standard base64 inputs', () => {
  for (const token of ['', 'abc', TOKEN.slice(1), TOKEN + 'A', 'ab'.repeat(32),
    TOKEN + '=', '/'.repeat(42) + '8', '+'.repeat(42) + '8']) {
    assert.equal(isPatternLinkToken(token), false);
  }
});

test('validator rejects whitespace, URLs, encoded wrappers, card prefixes and delimiters', () => {
  for (const token of [' ' + TOKEN, TOKEN + ' ', TOKEN + '\n', TOKEN + '\r\n',
    '\t' + TOKEN, TOKEN.slice(0, 20) + ' ' + TOKEN.slice(21),
    `https://example.invalid/p/${TOKEN}`, `%41${TOKEN.slice(1)}`,
    Buffer.from(TOKEN).toString('base64url'), `"${TOKEN}"`,
    `sample-card:${TOKEN}`, TOKEN.slice(0, 42) + '\0']) {
    assert.equal(isPatternLinkToken(token), false);
  }
});

test('non-ASCII input and runtime non-string input fail without coercion', () => {
  const hostile = { toString() { throw new Error('PRIVATE-ENTROPY-MARKER'); } };
  for (const value of [null, undefined, 12, false, {}, [], Buffer.from(TOKEN),
    new String(TOKEN), hostile, 'Ａ' + TOKEN.slice(1), 'é' + TOKEN.slice(1),
    TOKEN.slice(0, 42) + '\u200b']) {
    assert.equal(isPatternLinkToken(value), false);
    assert.equal(matchesPatternLinkTokenHash(value, HASH), false);
  }
});

test('SHA256 lookup identity is stable with the exact versioned domain and NUL separator', () => {
  assert.equal(hashPatternLinkToken(TOKEN), HASH);
  assert.equal(hashPatternLinkToken(TOKEN), HASH);
  assert.match(hashPatternLinkToken('A'.repeat(43)), /^[0-9a-f]{64}$/);
  assert.notEqual(hashPatternLinkToken('A'.repeat(43)), HASH);
});

test('pattern lookup identity cannot match a sample-card or unscoped digest', () => {
  for (const prefix of ['', 'fabric:sample-card:v1\0', 'fabric:pattern-share:v1',
    'fabric:pattern-share:v1\\0', 'fabric:pattern-share:v2\0']) {
    const otherHash = createHash('sha256').update(prefix + TOKEN, 'ascii').digest('hex');
    assert.notEqual(hashPatternLinkToken(TOKEN), otherHash);
    assert.equal(matchesPatternLinkTokenHash(TOKEN, otherHash), false);
  }
});

test('hashing invalid tokens throws a fixed error without token or supplied data', () => {
  for (const value of ['PRIVATE-ENTROPY-MARKER', TOKEN + '\n', TOKEN.slice(0, 42) + '9',
    { toString() { throw new Error('PRIVATE-ENTROPY-MARKER'); } }, null]) {
    assertSanitizedFailure(() => hashPatternLinkToken(value), 'Invalid pattern link token');
  }
});

test('stored hash comparison accepts only the matching identity', () => {
  assert.equal(matchesPatternLinkTokenHash(TOKEN, HASH), true);
  assert.equal(matchesPatternLinkTokenHash('A'.repeat(43), HASH), false);
  assert.equal(matchesPatternLinkTokenHash(TOKEN, '0'.repeat(64)), false);
});

test('stored hash comparison rejects malformed, non-ASCII and non-string digests', () => {
  for (const digest of ['', HASH.slice(1), HASH + '0', HASH.toUpperCase(),
    'g'.repeat(64), ' ' + HASH, HASH + '\n', HASH.slice(0, 63) + 'é',
    HASH.slice(0, 63) + '\0', Buffer.from(HASH), new String(HASH), null, undefined,
    { toString() { throw new Error('PRIVATE-ENTROPY-MARKER'); } }]) {
    assert.equal(matchesPatternLinkTokenHash(TOKEN, digest), false);
  }
});
