/**
 * Read-only, fail-closed Git baseline safety inspection before agent worktrees.
 * Intentionally prints counts, never names/contents of untracked private files.
 */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function countPorcelain(text) {
  const fields = text.split('\0').filter(Boolean);
  const counts = { total: 0, modified: 0, addedOrUntracked: 0, deleted: 0, renamed: 0, conflicted: 0 };
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i];
    if (entry.length < 4 || entry[2] !== ' ') {
      counts.conflicted++;
      counts.total++;
      continue;
    }
    const status = entry.slice(0, 2);
    counts.total++;
    if (status === '??' || status.includes('A')) counts.addedOrUntracked++;
    if (status.includes('M') || status.includes('T')) counts.modified++;
    if (status.includes('D')) counts.deleted++;
    if (status.includes('R') || status.includes('C')) {
      counts.renamed++;
      i++; // -z format includes a second original-path field for renamed/copied records
    }
    if (status.includes('U') || status === 'AA' || status === 'DD' || status === '!!') counts.conflicted++;
  }
  return counts;
}

export function assessReadiness(status, headHasCurrentV2) {
  const detachedHeadWorktreeSafe = status.total === 0 && headHasCurrentV2 === true;
  return {
    detachedHeadWorktreeSafe,
    reason: detachedHeadWorktreeSafe
      ? 'Clean checkout with current V2 present in HEAD; still verify workspace configuration.'
      : 'BLOCKED: a HEAD-only worktree would omit dirty/untracked V2 work or current V2 is absent from HEAD.',
    next: detachedHeadWorktreeSafe
      ? 'Verify file ownership, runner capacity and isolation before dispatch.'
      : 'First prepare and verify a trusted, recoverable baseline including relevant modified and untracked source; do not stash/reset/clean.',
  };
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 12 * 1024 * 1024 });
}

export function inspectRepository() {
  const counts = countPorcelain(git(['status', '--porcelain=v1', '-uall', '-z']));
  let headHasCurrentV2 = false;
  try {
    git(['cat-file', '-e', 'HEAD:server/customer-share/publicPatternProjection.ts']);
    headHasCurrentV2 = true;
  } catch {
    headHasCurrentV2 = false;
  }
  return { counts, headHasCurrentV2, ...assessReadiness(counts, headHasCurrentV2),
    note: 'Read-only: no backup or worktree created, no private path names printed.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = inspectRepository();
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    if (process.argv.includes('--require-safe') && !report.detachedHeadWorktreeSafe) process.exitCode = 2;
  } catch (error) {
    console.error('Baseline probe failed closed: ' + error.message);
    process.exitCode = 1;
  }
}
