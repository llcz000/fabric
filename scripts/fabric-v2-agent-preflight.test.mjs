import test from 'node:test';
import assert from 'node:assert/strict';
import { countPorcelain, assessReadiness } from './fabric-v2-agent-preflight.mjs';

test('porcelain -z counts dirty/untracked without printing sensitive filenames', () => {
  const status = countPorcelain(' M server/a.ts\0?? .env.backup\0D  docs/old.md\0');
  assert.deepEqual(status, { total: 3, modified: 1, addedOrUntracked: 1, deleted: 1, renamed: 0, conflicted: 0 });
  assert.doesNotMatch(JSON.stringify(status), /env.backup|server\/a\.ts/);
});

test('renamed porcelain records include their extra path field but count as one', () => {
  const status = countPorcelain('R  renamed.ts\0old.ts\0 M other.ts\0');
  assert.equal(status.total, 2);
  assert.equal(status.renamed, 1);
});

test('dirty workspace or missing V2 files in HEAD blocks naive worktree', () => {
  const dirty = assessReadiness({ total: 5 }, true);
  assert.equal(dirty.detachedHeadWorktreeSafe, false);
  const missing = assessReadiness({ total: 0 }, false);
  assert.equal(missing.detachedHeadWorktreeSafe, false);
  assert.equal(assessReadiness({ total: 0 }, true).detachedHeadWorktreeSafe, true);
});

test('unknown and conflict statuses are fail closed', () => {
  const output = countPorcelain('UU conflicted.ts\0?? new.ts\0');
  assert.equal(output.conflicted, 1);
  assert.equal(assessReadiness(output, true).detachedHeadWorktreeSafe, false);
});
