import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const gate = fs.readFileSync(path.join(root, 'scripts/check-product-master-v2-p0.mjs'), 'utf8')
  .replace(/^import .*;\r?\n/gm, '');
const requirements = 'docs/product-master/product-master-v2-requirements.md';
const register = 'docs/product-master/product-master-v2-stitch-design-review.md';
const progress = 'docs/product-master/product-master-v2-progress.md';
const current = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function run(overrides = {}) {
  const messages = [];
  const taskProcess = { cwd: () => root, exitCode: 0 };
  vm.runInNewContext(gate, {
    path,
    fs: {
      ...fs,
      readFileSync(file, encoding) {
        const relative = path.relative(root, file).split(path.sep).join('/');
        return Object.hasOwn(overrides, relative) ? overrides[relative] : fs.readFileSync(file, encoding);
      },
    },
    process: taskProcess,
    console: { log: (...args) => messages.push(args.join(' ')), error: (...args) => messages.push(args.join(' ')) },
  });
  return { status: taskProcess.exitCode, output: messages.join('\n') };
}

test('current specifications need no historical revision prose when linked approval evidence is intact', () => {
  const result = run({ [requirements]: current(requirements).replaceAll('v1.38', '') });
  assert.equal(result.status, 0, result.output);
});

test('a historical version string cannot replace the link to current UI evidence', () => {
  const withoutLink = current(requirements).replaceAll('product-master-v2-stitch-design-review.md', 'unrelated-ui.md');
  const result = run({ [requirements]: withoutLink + '\nv1.38\n' });
  assert.equal(result.status, 1, result.output);
});

test('pending or missing approved screen still rejects the gate', () => {
  const result = run({ [register]: current(register).replace(/UI已确认/, 'UI待确认') });
  assert.equal(result.status, 1, result.output);
});

test('approval does not imply completed legacy format support', () => {
  const result = run({ [progress]: current(progress).replaceAll('尚未实现.xls', '已实现.xls') });
  assert.equal(result.status, 1, result.output);
});
