/**
 * Batch convert TIFF files to JPG
 * Usage: node scripts/convert-tiff.mjs
 *
 * - Scans D:/tiff/ for .tiff/.tif files
 * - Extracts 货号 from filename (chars before 2nd "-")
 * - Converts to ~200KB JPG, outputs to D:/jpg/
 * - Concurrent: 2 at a time (200MB TIFFs are memory-heavy)
 */

import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const INPUT_DIR = 'D:/tiff';
const OUTPUT_DIR = 'D:/jpg';
const CONCURRENCY = 2;
const MAX_WIDTH = 1200;
const JPEG_QUALITY = 70;

// Extract 货号: take chars before the 2nd "-" in filename
// "xx-1.tiff" → "xx-1", "xx-2-yy.tiff" → "xx-2", "xx.tiff" → "xx"
function extractItemNo(filename) {
  const name = path.basename(filename, path.extname(filename)); // remove ext
  const parts = name.split('-');
  if (parts.length >= 2) {
    return parts.slice(0, 2).join('-'); // "xx-2-yy" → "xx-2"
  }
  return name; // "xx" → "xx"
}

async function convertOne(filePath, outputPath) {
  try {
    await sharp(filePath, { limitInputPixels: false })
      .resize(MAX_WIDTH, undefined, { withoutEnlargement: true, fit: 'inside' })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toFile(outputPath);
    const stat = fs.statSync(outputPath);
    const sizeKB = (stat.size / 1024).toFixed(0);
    return { ok: true, sizeKB };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function main() {
  if (!fs.existsSync(INPUT_DIR)) {
    console.error(`❌ 输入目录不存在: ${INPUT_DIR}`);
    process.exit(1);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const files = fs.readdirSync(INPUT_DIR)
    .filter(f => /\.(tiff|tif)$/i.test(f))
    .map(f => path.join(INPUT_DIR, f));

  if (files.length === 0) {
    console.log('❌ 没有找到 TIFF 文件');
    process.exit(1);
  }

  console.log(`找到 ${files.length} 个 TIFF 文件，并发数: ${CONCURRENCY}\n`);

  let done = 0;
  let skipped = 0;
  let failed = 0;
  const errors = [];

  // Process with concurrency limit
  const queue = [...files];
  async function worker() {
    while (queue.length > 0) {
      const filePath = queue.shift();
      const itemNo = extractItemNo(path.basename(filePath));
      const outPath = path.join(OUTPUT_DIR, `${itemNo}.jpg`);

      // Skip if already exists
      if (fs.existsSync(outPath)) {
        skipped++;
        done++;
        process.stdout.write(`\r[${done}/${files.length}] ${itemNo}.jpg (已存在，跳过)                    `);
        continue;
      }

      const result = await convertOne(filePath, outPath);
      done++;
      if (result.ok) {
        process.stdout.write(`\r[${done}/${files.length}] ${itemNo}.jpg (${result.sizeKB}KB)                    `);
      } else {
        failed++;
        errors.push({ file: path.basename(filePath), error: result.error });
        process.stdout.write(`\r[${done}/${files.length}] ${path.basename(filePath)} ❌ ${result.error}                    `);
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

  console.log(`\n\n✅ 完成！成功: ${done - failed}，跳过: ${skipped}，失败: ${failed}`);
  if (errors.length > 0) {
    console.log('\n失败列表:');
    errors.forEach(e => console.log(`  - ${e.file}: ${e.error}`));
  }
  console.log(`\n输出目录: ${OUTPUT_DIR}`);
}

main();
