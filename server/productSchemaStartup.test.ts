import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('MySQL startup initializes product and image schema even when asset features are disabled', () => {
  const source = readFileSync(path.join(process.cwd(), 'server.ts'), 'utf8');
  const schemaCall = 'await initializeImageAssetSchema(conn);';
  const callIndex = source.indexOf(schemaCall);

  assert.notEqual(callIndex, -1, 'server startup must initialize the shared image and product schema');
  const precedingBlock = source.slice(Math.max(0, callIndex - 120), callIndex);
  assert.doesNotMatch(precedingBlock, /if\s*\(imageAssetRuntime\.enabled\)\s*\{\s*$/);
});
