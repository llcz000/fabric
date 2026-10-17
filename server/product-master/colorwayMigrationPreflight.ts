export interface ColorwayMigrationPreflightReport {
  readonly masterId: string;
  readonly persistedNextColorwayNo: string;
  readonly highestSavedNumber: string | null;
  readonly savedCount: number;
}

// Matches schema.ts/schemaContract.ts: master ID/counter BIGINT UNSIGNED,
// saved colorway number INT UNSIGNED. Zero is invalid for all three.
const BIGINT_UNSIGNED_MAX = 18446744073709551615n;
const INT_UNSIGNED_MAX = 4294967295n;
const INVALID_SNAPSHOT = 'Invalid colorway migration snapshot';

function ownData(object: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

function positiveUnsignedString(input: unknown, max: bigint): string {
  if (typeof input !== 'string' || input.length > 20 || !/^[1-9][0-9]*$/.test(input)) {
    throw new Error(INVALID_SNAPSHOT);
  }
  const value = BigInt(input);
  // Round-trip also rejects a final newline (which JavaScript's $ may allow).
  if (value > max || value.toString() !== input) throw new Error(INVALID_SNAPSHOT);
  return input;
}

/**
 * Pure consistency preflight of ONE master's trusted durable snapshot.
 * Caller must establish provenance, completeness and a consistent read; this
 * function cannot prove that a supplied counter was durably persisted or that
 * historical rows were never renumbered. Missing/deleted rows prove nothing
 * about previously used identities. Never reconstruct or reset the counter.
 *
 * Accepts only canonical decimal strings (no driver Number rounding). Success
 * is a frozen summary, NOT migration/allocation authorization or capacity proof:
 * a valid BIGINT counter may exceed the saved INT range. No SQL, allocation,
 * writes, repair, draft consumption, lock or transaction occurs here. A future
 * approved migration still needs MySQL locking and backup/restore gates.
 */
export function validateColorwayMigrationPreflight(input: unknown): Readonly<ColorwayMigrationPreflightReport> {
  try {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      throw new Error(INVALID_SNAPSHOT);
    }
    const masterId = positiveUnsignedString(ownData(input, 'masterId'), BIGINT_UNSIGNED_MAX);
    const persistedNextColorwayNo = positiveUnsignedString(
      ownData(input, 'persistedNextColorwayNo'), BIGINT_UNSIGNED_MAX,
    );
    const savedNumbers = ownData(input, 'savedNumbers');
    if (!Array.isArray(savedNumbers)) throw new Error(INVALID_SNAPSHOT);
    const savedCount = ownData(savedNumbers, 'length');
    if (typeof savedCount !== 'number' || !Number.isSafeInteger(savedCount) || savedCount < 0) {
      throw new Error(INVALID_SNAPSHOT);
    }

    const seen = new Set<string>();
    let highest = 0n;
    for (let index = 0; index < savedCount; index++) {
      const number = positiveUnsignedString(ownData(savedNumbers, String(index)), INT_UNSIGNED_MAX);
      if (seen.has(number)) throw new Error(INVALID_SNAPSHOT);
      seen.add(number);
      const value = BigInt(number);
      if (value > highest) highest = value;
    }
    if (BigInt(persistedNextColorwayNo) <= highest) throw new Error(INVALID_SNAPSHOT);

    return Object.freeze({
      masterId,
      persistedNextColorwayNo,
      highestSavedNumber: highest === 0n ? null : highest.toString(),
      savedCount,
    });
  } catch {
    // Do not leak snapshot values or exceptions supplied by exotic objects.
    throw new Error(INVALID_SNAPSHOT);
  }
}
