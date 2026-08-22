import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const projectRoot = process.cwd();
const outputRoot = path.join(projectRoot, 'tmp', 'tests');
const defaultRoots = ['server', 'src', 'scripts'];
const requestedPaths = process.argv.slice(2);

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

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

if (bundledFiles.length === 0) {
  throw new Error('No *.test.ts files found');
}

const testProcess = await import('node:child_process').then(({ spawn }) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['--test', ...bundledFiles], { stdio: 'inherit' });
  child.once('error', reject);
  child.once('exit', (code, signal) => resolve({ code, signal }));
}));

process.exitCode = testProcess.code ?? 1;
