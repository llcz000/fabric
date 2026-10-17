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


test('unused old transformer experiment is not installed in production dependencies', () => {
  assert.equal(manifest.dependencies?.['@xenova/transformers'], undefined);
  assert.equal(lock.packages?.['']?.dependencies?.['@xenova/transformers'], undefined);
  for (const name of ['@xenova/transformers','onnxruntime-web','onnxruntime-node','onnx-proto']) {
    assert.equal(lock.packages?.['node_modules/'+name], undefined, 'legacy production package '+name);
  }
});

test('COS SDK v3 eliminates deprecated request and XML chains without changing package identity', () => {
  assert.equal(manifest.dependencies?.['cos-nodejs-sdk-v5'], '^3.0.0');
  assert.equal(lock.packages?.['node_modules/cos-nodejs-sdk-v5']?.version, '3.0.0');
  for (const name of ['request','fast-xml-parser','har-validator','cos-nodejs-sdk-v5/node_modules/request']) {
    assert.equal(lock.packages?.['node_modules/'+name], undefined, 'deprecated COS chain '+name);
  }
  // form-data may remain in a patched version through independent packages.
  assert.equal(lock.packages?.['node_modules/form-data']?.version,'2.5.6');
  // Legacy SDK's vendored deprecated transport/parser dependencies are gone.
  assert.equal(lock.packages?.['node_modules/cos-nodejs-sdk-v5']?.dependencies?.request,undefined);
  assert.equal(lock.packages?.['node_modules/cos-nodejs-sdk-v5']?.dependencies?.['fast-xml-parser'],undefined);
});
