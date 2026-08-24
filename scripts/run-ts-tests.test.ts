import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';

function findRunnerOutputRoot(compiledDirectory: string): string {
  const temporaryRoot = path.join(process.cwd(), 'tmp');
  let candidate = compiledDirectory;
  while (path.dirname(candidate) !== candidate) {
    if (path.dirname(candidate) === temporaryRoot && path.basename(candidate).startsWith('tests-')) {
      return candidate;
    }
    candidate = path.dirname(candidate);
  }
  throw new Error(`Compiled test directory is not inside a runner output: ${compiledDirectory}`);
}

function independentRunnerEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  return environment;
}

test('rejects optional test paths outside the project root', () => {
  const outsideDirectory = mkdtempSync(path.join(path.dirname(process.cwd()), 'run-ts-tests-outside-'));
  const outsideTest = path.join(outsideDirectory, 'outside.test.ts');
  const parentSentinel = path.join(__dirname, 'parent-output-sentinel');
  writeFileSync(outsideTest, "test('must not run', () => {});\n");
  writeFileSync(parentSentinel, 'parent output must survive');

  try {
    const result = spawnSync(process.execPath, ['scripts/run-ts-tests.mjs', outsideTest], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /outside the project root/);
    assert.equal(existsSync(parentSentinel), true, 'nested runner deleted its parent output directory');
  } finally {
    rmSync(outsideDirectory, { recursive: true, force: true });
    rmSync(parentSentinel, { force: true });
  }
});

test('successful nested runner cleans its isolated output directory', () => {
  const fixtureDirectory = mkdtempSync(path.join(process.cwd(), 'tmp', 'nested-runner-fixture-'));
  const fixtureTest = path.join(fixtureDirectory, 'fixture.test.ts');
  const outputMarker = path.join(fixtureDirectory, 'compiled-output.txt');
  writeFileSync(fixtureTest, [
    "import { writeFileSync } from 'node:fs';",
    "import test from 'node:test';",
    `writeFileSync(${JSON.stringify(outputMarker)}, __dirname);`,
    "test('nested fixture', () => {});",
    '',
  ].join('\n'));

  try {
    const result = spawnSync(process.execPath, ['scripts/run-ts-tests.mjs', fixtureTest], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: independentRunnerEnvironment(),
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(existsSync(outputMarker), true, `${result.stdout}\n${result.stderr}`);
    const outputRoot = findRunnerOutputRoot(readFileSync(outputMarker, 'utf8'));
    assert.equal(existsSync(outputRoot), false, `nested runner left output behind: ${outputRoot}`);
  } finally {
    rmSync(fixtureDirectory, { recursive: true, force: true });
  }
});

test('failing nested runner cleans its isolated output directory', () => {
  const fixtureDirectory = mkdtempSync(path.join(process.cwd(), 'tmp', 'failing-runner-fixture-'));
  const fixtureTest = path.join(fixtureDirectory, 'fixture.test.ts');
  const outputMarker = path.join(fixtureDirectory, 'compiled-output.txt');
  writeFileSync(fixtureTest, [
    "import { writeFileSync } from 'node:fs';",
    "import test from 'node:test';",
    `writeFileSync(${JSON.stringify(outputMarker)}, __dirname);`,
    "test('nested failure', () => { throw new Error('expected nested failure'); });",
    '',
  ].join('\n'));

  try {
    const result = spawnSync(process.execPath, ['scripts/run-ts-tests.mjs', fixtureTest], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: independentRunnerEnvironment(),
    });

    assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(existsSync(outputMarker), true, `${result.stdout}\n${result.stderr}`);
    const outputRoot = findRunnerOutputRoot(readFileSync(outputMarker, 'utf8'));
    assert.equal(existsSync(outputRoot), false, `failing runner left output behind: ${outputRoot}`);
  } finally {
    rmSync(fixtureDirectory, { recursive: true, force: true });
  }
});
