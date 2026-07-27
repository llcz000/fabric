/**
 * Batch convert TIFF files to JPG
 * Usage: node scripts/convert-tiff.mjs
 *
 * Uses geotiff + sharp to handle large TIFFs that exceed libvips memory limits.
 */
import fs from 'fs';
import path from 'path';
import * as GeoTIFF from 'geotiff';

// Dynamic import so VIPS_MAX_MEM is set before sharp loads
process.env.VIPS_MAX_MEM = '2048';
const { default: sharp } = await import('sharp');

const INPUT_DIR = 'D:/tiff';
const OUTPUT_DIR = 'D:/jpg';
const MAX_WIDTH = 1200;
const JPEG_QUALITY = 70;

function extractItemNo(filename) {
  const name = path.basename(filename, path.extname(filename));
  const parts = name.split('-');
  if (parts.length >= 2) {
    return parts.slice(0, 2).join('-');
  }
  return name;
}

/** Interleave separate band arrays into interleaved RGB buffer for sharp */
function interleaveRGB(r, g, b) {
  const len = r.length;
  const out = Buffer.allocUnsafe(len * 3);
  for (let i = 0, j = 0; i < len; i++) {
    out[j++] = r[i];
    out[j++] = g[i];
    out[j++] = b[i];
  }
  return out;
}

async function convertOne(filePath, outputPath) {
  try {
    const tiff = await GeoTIFF.fromFile(filePath);
    const img = await tiff.getImage();
    const width = img.getWidth();
    const height = img.getHeight();

    const rasters = await img.readRasters();
    let rgb;
    if (rasters.length >= 3) {
      rgb = interleaveRGB(rasters[0], rasters[1], rasters[2]);
    } else if (rasters.length === 1) {
      const gray = rasters[0];
      rgb = Buffer.allocUnsafe(gray.length * 3);
      for (let i = 0, j = 0; i < gray.length; i++) {
        const v = gray[i];
        rgb[j++] = v; rgb[j++] = v; rgb[j++] = v;
      }
    } else {
      return { ok: false, error: `Unexpected band count: ${rasters.length}` };
    }

    await sharp(rgb, { raw: { width, height, channels: 3 }, limitInputPixels: false })
      .resize(MAX_WIDTH, undefined, { withoutEnlargement: true, fit: 'inside' })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toFile(outputPath);

    const stat = fs.statSync(outputPath);
    return { ok: true, sizeKB: (stat.size / 1024).toFixed(0) };
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

  console.log(`找到 ${files.length} 个 TIFF 文件\n`);

  let done = 0, skipped = 0, failed = 0;
  const errors = [];

  for (const filePath of files) {
    const itemNo = extractItemNo(path.basename(filePath));
    const outPath = path.join(OUTPUT_DIR, `${itemNo}.jpg`);

    if (fs.existsSync(outPath)) {
      skipped++; done++;
      process.stdout.write(`\r[${done}/${files.length}] ${itemNo}.jpg (跳过)                    `);
      continue;
    }

    const result = await convertOne(filePath, outPath);
    done++;
    if (result.ok) {
      process.stdout.write(`\r[${done}/${files.length}] ${itemNo}.jpg (${result.sizeKB}KB)                    `);
    } else {
      failed++;
      errors.push({ file: path.basename(filePath), error: result.error });
      process.stdout.write(`\r[${done}/${files.length}] ${itemNo} ❌ ${result.error.slice(0, 80)}                    `);
    }
  }

  console.log(`\n\n✅ 完成！成功: ${done - failed}，跳过: ${skipped}，失败: ${failed}`);
  if (errors.length > 0) {
    console.log('\n失败列表:');
    errors.forEach(e => console.log(`  - ${e.file}`));
  }
  console.log(`\n输出目录: ${OUTPUT_DIR}`);
}

main();
