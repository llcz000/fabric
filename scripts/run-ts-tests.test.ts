import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';

test('rejects optional test paths outside the project root', () => {
  const outsideDirectory = mkdtempSync(path.join(path.dirname(process.cwd()), 'run-ts-tests-outside-'));
  const outsideTest = path.join(outsideDirectory, 'outside.test.ts');
  writeFileSync(outsideTest, "test('must not run', () => {});\n");

  try {
    const result = spawnSync(process.execPath, ['scripts/run-ts-tests.mjs', outsideTest], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /outside the project root/);
  } finally {
    rmSync(outsideDirectory, { recursive: true, force: true });
  }
});
