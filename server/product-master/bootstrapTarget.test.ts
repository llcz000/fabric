import assert from 'node:assert/strict';
import test from 'node:test';

import { requireIsolatedV2SchemaTarget } from './bootstrapTarget';
import { bootstrapIsolatedV2Schema } from './bootstrap';

test('P1-C isolated V2 bootstrap refuses production target before issuing any SQL', async () => {
  const emitted: string[] = [];
  await assert.rejects(
    bootstrapIsolatedV2Schema({
      database: 'fabric_db',
      confirmation: 'I_ACKNOWLEDGE_SANDBOX',
      connection: {async query(sql: string): Promise<[unknown,unknown]> {emitted.push(sql); return [[],[]];}},
    }),
    /sandbox|isolated/i
  );
  assert.deepEqual(emitted, []);
});

test('P1-C isolated bootstrap checks required core company table before any CREATE', async () => {
  const emitted: string[] = [];
  await assert.rejects(
    bootstrapIsolatedV2Schema({
      database: 'fabric_v2_test_20261012_p1c',
      confirmation: 'I_ACKNOWLEDGE_SANDBOX',
      connection: {async query(sql: string): Promise<[unknown,unknown]> {emitted.push(sql); return [[],[]];}},
    }), /company_config/i
  );
  assert.equal(emitted.length,1);
  assert.match(emitted[0], /^SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS/i);
});

test('P1-C2 existing V1 master table missing next counter refuses upgrade before CREATE',async()=>{
  const statements:string[]=[];
  await assert.rejects(bootstrapIsolatedV2Schema({
    database:'fabric_v2_test_20261012_p1c',confirmation:'I_ACKNOWLEDGE_SANDBOX',
    connection:{async query(sql:string,params?:unknown[]):Promise<[unknown,unknown]>{
      statements.push(sql.trim());
      return [String(params?.[0])==='pattern_masters'?[{COLUMN_NAME:'id'},{COLUMN_NAME:'master_no'}]:[{COLUMN_NAME:'id'}],[]];
    }}
  }),/schema version 1|next_colorway_no|migration/i);
  assert(statements.every(x=>x.startsWith('SELECT')));
});

test('P1-C V2 explicit schema bootstrap requires fixed isolated database and opt-in', () => {
  assert.equal(
    requireIsolatedV2SchemaTarget({
      database: 'fabric_v2_test_20261012_p1c',
      confirmation: 'I_ACKNOWLEDGE_SANDBOX',
    }),
    'fabric_v2_test_20261012_p1c'
  );
  for (const [database,confirmation] of [
    ['fabric_db','I_ACKNOWLEDGE_SANDBOX'],
    ['fabric_v2_test_20261012_p1c',''],
    ['fabric_v2_test_20261012_p1c','yes'],
    ['fabric_v2_test_20261012','I_ACKNOWLEDGE_SANDBOX'],
    ['mysql','I_ACKNOWLEDGE_SANDBOX'],
    ['fabric_v2_test_20261012_p1c;DROP DATABASE fabric_db','I_ACKNOWLEDGE_SANDBOX'],
  ]) {
    assert.throws(
      () => requireIsolatedV2SchemaTarget({database, confirmation}),
      /isolated|sandbox/i, database
    );
  }
});
