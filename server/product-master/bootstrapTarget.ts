/**
 * P1-C development-only V2 schema bootstrap gate.
 * Never permit a production or unknown database for schema creation.
 * The confirmation flag is intentionally explicit, and guard runs BEFORE
 * connecting to MySQL. No production migration runner exists yet.
 */
export function requireIsolatedV2SchemaTarget(input: {
  database?: string;
  confirmation?: string;
}): string {
  if (
    input.confirmation !== 'I_ACKNOWLEDGE_SANDBOX'
    || input.database !== 'fabric_v2_test_20261012_p1c'
  ) {
    throw new Error('V2 schema bootstrap requires explicit isolated sandbox target and confirmation');
  }
  return input.database;
}
