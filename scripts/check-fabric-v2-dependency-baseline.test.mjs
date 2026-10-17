import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
const lock = JSON.parse(readFileSync(new URL('package-lock.json', root), 'utf8'));

test('proxy-addr critical trust-proxy advisory has a pinned patched transitive version', () => {
  assert.equal(manifest.overrides?.['proxy-addr'], '2.0.8');
  assert.equal(lock.packages?.['node_modules/proxy-addr']?.version, '2.0.8');
  assert.equal(lock.packages?.['']?.dependencies?.['proxy-addr'], undefined);
});

test('no nested unpatched proxy-addr survives in resolved lockfile', () => {
  for (const [name, entry] of Object.entries(lock.packages ?? {})) {
    if (name === 'node_modules/proxy-addr' || name.endsWith('/node_modules/proxy-addr')) {
      assert.equal(entry.version, '2.0.8', 'unpatched '+name);
    }
  }
});
