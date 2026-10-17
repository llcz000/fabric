import assert from 'node:assert/strict';
import test from 'node:test';
import { validateColorwayMigrationPreflight } from './colorwayMigrationPreflight';

const snapshot = (overrides: Record<string, unknown> = {}) => ({
  masterId: '1', persistedNextColorwayNo: '4', savedNumbers: ['1', '2', '3'], ...overrides,
});
const invalid = (input: unknown) => assert.throws(
  () => validateColorwayMigrationPreflight(input),
  { name: 'Error', message: 'Invalid colorway migration snapshot' },
);

// Removing the counter check, coercing through Number, or inferring MAX+1
// would break these behavioral assertions; no database or mocked allocator.
test('validates saved 1/2/3 with durable next 4 and returns a frozen report', () => {
  const report = validateColorwayMigrationPreflight(snapshot());
  assert.deepEqual(report, {
    masterId: '1', persistedNextColorwayNo: '4', highestSavedNumber: '3', savedCount: 3,
  });
  assert.ok(Object.isFrozen(report));
});

test('accepts deleted gaps without reassigning, sorting or incrementing saved numbers', () => {
  const numbers = Object.freeze(['3', '1']);
  const input = Object.freeze(snapshot({ savedNumbers: numbers }));
  assert.equal(validateColorwayMigrationPreflight(input).persistedNextColorwayNo, '4');
  assert.deepEqual(numbers, ['3', '1']);
  assert.equal(input.persistedNextColorwayNo, '4');
});

test('rejects a counter equal to or below the highest saved number', () => {
  invalid(snapshot({ persistedNextColorwayNo: '3' }));
  invalid(snapshot({ persistedNextColorwayNo: '2' }));
});

test('rejects duplicate saved identities even in unsorted data', () => {
  invalid(snapshot({ savedNumbers: ['3', '1', '3'] }));
});

test('retains a trusted counter after all saved rows were deleted', () => {
  assert.deepEqual(validateColorwayMigrationPreflight(snapshot({
    savedNumbers: [], persistedNextColorwayNo: '17',
  })), { masterId: '1', persistedNextColorwayNo: '17', highestSavedNumber: null, savedCount: 0 });
});

test('accepts next 1 for an empty master and does not consume draft numbers', () => {
  const input = Object.freeze(snapshot({ savedNumbers: Object.freeze([]), persistedNextColorwayNo: '1' }));
  assert.deepEqual(validateColorwayMigrationPreflight(input), validateColorwayMigrationPreflight(input));
  assert.equal(input.persistedNextColorwayNo, '1');
});

test('never infers a missing counter from empty or populated saved rows', () => {
  invalid({ masterId: '1', savedNumbers: [] });
  invalid({ masterId: '1', savedNumbers: ['1', '3'] });
});

for (const [label, input] of [
  ['null', null], ['undefined', undefined], ['array', []], ['string', '1'],
  ['number', 1], ['boolean', true], ['empty object', {}],
  ['missing master', { persistedNextColorwayNo: '4', savedNumbers: [] }],
  ['missing saved metadata', { masterId: '1', persistedNextColorwayNo: '4' }],
  ['nonarray saved metadata', snapshot({ savedNumbers: '1,2,3' })],
  ['null saved metadata', snapshot({ savedNumbers: null })],
  ['sparse saved array', snapshot({ savedNumbers: new Array(1) })],
] as const) {
  test(`fails closed for malformed snapshot: ${label}`, () => invalid(input));
}

const badNumericValues: readonly unknown[] = [
  '0', '-1', '+1', '01', ' 1', '1 ', '1\n', '1.0', '1e0', '0x1', '',
  'NaN', 'Infinity', '١', 1, 0, 9007199254740993, 1n, null, undefined, {},
];
for (const field of ['masterId', 'persistedNextColorwayNo', 'savedNumbers'] as const) {
  test(`rejects noncanonical or nonstring numeric values in ${field}`, () => {
    for (const value of badNumericValues) {
      invalid(snapshot({ [field]: field === 'savedNumbers' ? [value] : value }));
    }
  });
}

test('compares saved values numerically rather than lexicographically', () => {
  const report = validateColorwayMigrationPreflight(snapshot({
    savedNumbers: ['9', '10'], persistedNextColorwayNo: '11',
  }));
  assert.equal(report.highestSavedNumber, '10');
  invalid(snapshot({ savedNumbers: ['9'], persistedNextColorwayNo: '8' }));
});

test('preserves BIGINT precision above Number.MAX_SAFE_INTEGER', () => {
  const input = snapshot({ masterId: '9007199254740993', persistedNextColorwayNo: '9007199254740995' });
  const report = validateColorwayMigrationPreflight(input);
  assert.equal(report.masterId, '9007199254740993');
  assert.equal(report.persistedNextColorwayNo, '9007199254740995');
});

test('accepts exact unsigned schema maxima without allocating a colorway', () => {
  const report = validateColorwayMigrationPreflight(snapshot({
    masterId: '18446744073709551615', persistedNextColorwayNo: '18446744073709551615',
    savedNumbers: ['4294967295'],
  }));
  assert.equal(report.highestSavedNumber, '4294967295');
  assert.equal(report.persistedNextColorwayNo, '18446744073709551615');
});

test('rejects unsigned BIGINT and INT overflow independently', () => {
  invalid(snapshot({ masterId: '18446744073709551616' }));
  invalid(snapshot({ persistedNextColorwayNo: '18446744073709551616' }));
  invalid(snapshot({ savedNumbers: ['4294967296'], persistedNextColorwayNo: '4294967297' }));
  invalid(snapshot({ persistedNextColorwayNo: '9'.repeat(1000) }));
});

test('does not infer reuse when next exceeds the saved INT range', () => {
  assert.equal(validateColorwayMigrationPreflight(snapshot({
    savedNumbers: ['4294967295'], persistedNextColorwayNo: '4294967296',
  })).persistedNextColorwayNo, '4294967296');
});

test('rejects inherited metadata rather than treating it as a persisted snapshot', () => {
  invalid(Object.create(snapshot()));
});

test('rejects accessors without invoking caller code or exposing input in errors', () => {
  let reads = 0;
  const input = snapshot();
  Object.defineProperty(input, 'masterId', { get() { reads++; throw Error('secret'); } });
  invalid(input);
  const numbers = ['1'];
  Object.defineProperty(numbers, '0', { get() { reads++; throw Error('secret'); } });
  invalid(snapshot({ savedNumbers: numbers }));
  assert.equal(reads, 0);
});

test('report stays independent of later snapshot edits', () => {
  const input = snapshot();
  const report = validateColorwayMigrationPreflight(input);
  input.savedNumbers.push('4');
  input.persistedNextColorwayNo = '5';
  assert.equal(report.persistedNextColorwayNo, '4');
  assert.equal(report.savedCount, 3);
});
