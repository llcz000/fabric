import { mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { build } from 'esbuild';

const projectRoot = process.cwd();
const outputParent = path.join(projectRoot, 'tmp');
const defaultRoots = ['server', 'src', 'scripts'];
const requestedPaths = process.argv.slice(2);

async function findTestFiles(entry) {
  const absoluteEntry = path.resolve(projectRoot, entry);
  const relativeEntry = path.relative(projectRoot, absoluteEntry);
  if (
    relativeEntry === '..' ||
    relativeEntry.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeEntry)
  ) {
    throw new Error(`Test path is outside the project root: ${entry}`);
  }
  if (!existsSync(absoluteEntry)) {
    throw new Error(`Test path does not exist: ${entry}`);
  }

  const stats = await stat(absoluteEntry);
  if (stats.isFile()) {
    return absoluteEntry.endsWith('.test.ts') ? [absoluteEntry] : [];
  }

  const files = [];
  async function visit(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const itemPath = path.join(directory, item.name);
      if (item.isDirectory()) {
        await visit(itemPath);
      } else if (item.isFile() && item.name.endsWith('.test.ts')) {
        files.push(itemPath);
      }
    }
  }
  await visit(absoluteEntry);
  return files;
}

const roots = requestedPaths.length > 0 ? requestedPaths : defaultRoots;
const testFiles = (await Promise.all(roots.map(findTestFiles))).flat().sort();

if (testFiles.length === 0) {
  throw new Error('No *.test.ts files found');
}

await mkdir(outputParent, { recursive: true });
const outputRoot = await mkdtemp(path.join(outputParent, 'tests-'));
let runError;

try {
  const bundledFiles = [];
  for (const testFile of testFiles) {
    const relativePath = path.relative(projectRoot, testFile);
    const outputPath = path.join(outputRoot, relativePath).replace(/\.ts$/, '.cjs');
    await mkdir(path.dirname(outputPath), { recursive: true });
    await build({
      entryPoints: [testFile],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile: outputPath,
      sourcemap: false,
    });
    bundledFiles.push(outputPath);
  }

  const testExitCode = await new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(process.execPath, ['--test', ...bundledFiles], { stdio: 'inherit' });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      resolve(code);
    });
  });

  process.exitCode = testExitCode ?? 1;
} catch (error) {
  runError = error;
} finally {
  try {
    await rm(outputRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch (cleanupError) {
    runError = runError
      ? new AggregateError([runError, cleanupError], 'Test run and output cleanup both failed')
      : cleanupError;
  }
}

if (runError) throw runError;
