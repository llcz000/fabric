/**
 * Upload JPG images to products by matching filename (货号) to product.item_no
 * Usage: node scripts/upload-product-images.mjs [--local]
 *
 * - Scans D:/jpg/ for .jpg files
 * - Matches filename (without ext) to products.item_no in database
 * - Generates thumbnails, uploads to COS (or local if --local)
 * - Creates product_images records
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import COS from 'cos-nodejs-sdk-v5';
import sharp from 'sharp';

dotenv.config();

const JPG_DIR = 'D:/jpg';
const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
const DATABASE_FALLBACK_FILE = path.join(process.cwd(), 'database_fallback.json');
const THUMB_WIDTH = 300;

// ── DB ──
let mysqlPool = null;
let useMySQLFallback = false;

async function initDB() {
  const host = process.env.DB_HOST;
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;
  const database = process.env.DB_DATABASE;

  if (host && user && password && database) {
    mysqlPool = mysql.createPool({ host, user, password, database, dateStrings: true, connectionLimit: 5 });
    await mysqlPool.getConnection().then(c => c.release());
    console.log('[DB] MySQL connected');
  } else {
    console.log('[DB] MySQL not configured, using JSON fallback');
    useMySQLFallback = true;
  }
}

function loadLocalDB() {
  if (fs.existsSync(DATABASE_FALLBACK_FILE)) {
    return JSON.parse(fs.readFileSync(DATABASE_FALLBACK_FILE, 'utf8'));
  }
  return { products: [], product_images: [] };
}

function saveLocalDB(data) {
  fs.writeFileSync(DATABASE_FALLBACK_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ── COS ──
function getCOSConfig() {
  const { COS_SECRET_ID, COS_SECRET_KEY, COS_REGION, COS_BUCKET } = process.env;
  if (!COS_SECRET_ID || !COS_SECRET_KEY || !COS_REGION || !COS_BUCKET) return null;
  return { secretId: COS_SECRET_ID, secretKey: COS_SECRET_KEY, region: COS_REGION, bucket: COS_BUCKET };
}

const cosClient = (() => {
  const cfg = getCOSConfig();
  if (!cfg) return null;
  return new COS({ SecretId: cfg.secretId, SecretKey: cfg.secretKey });
})();

async function uploadToCOS(buffer, key) {
  const cfg = getCOSConfig();
  if (!cfg || !cosClient) return '';
  try {
    await cosClient.putObject({ Bucket: cfg.bucket, Region: cfg.region, Key: key, Body: buffer });
    return key;
  } catch (e) {
    console.error(`  [COS upload error] ${e.message}`);
    return '';
  }
}

// ── Thumbnail ──
async function generateThumbnail(buffer) {
  try {
    return await sharp(buffer)
      .resize(THUMB_WIDTH, THUMB_WIDTH, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 60 })
      .toBuffer();
  } catch {
    return null;
  }
}

// ── Main ──
async function main() {
  const args = process.argv.slice(2);
  const forceLocal = args.includes('--local');

  if (!fs.existsSync(JPG_DIR)) {
    console.error(`❌ 目录不存在: ${JPG_DIR}`);
    process.exit(1);
  }

  await initDB();
  fs.mkdirSync(path.join(UPLOADS_DIR, 'products'), { recursive: true });

  const jpgFiles = fs.readdirSync(JPG_DIR).filter(f => /\.jpe?g$/i.test(f));

  if (jpgFiles.length === 0) {
    console.log('❌ 没有找到 JPG 文件');
    process.exit(1);
  }

  console.log(`找到 ${jpgFiles.length} 个 JPG 文件\n`);

  let matched = 0;
  let unmatched = 0;
  let uploaded = 0;
  const unmatchedList = [];
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

  for (let i = 0; i < jpgFiles.length; i++) {
    const fname = jpgFiles[i];
    const itemNo = path.basename(fname, path.extname(fname));
    const filePath = path.join(JPG_DIR, fname);
    const buffer = fs.readFileSync(filePath);
    const sizeKB = (buffer.length / 1024).toFixed(0);

    // Find product by item_no
    let product = null;
    if (!useMySQLFallback) {
      const [rows] = await mysqlPool.query('SELECT id, item_no FROM products WHERE item_no = ?', [itemNo]);
      if (rows.length > 0) product = rows[0];
    } else {
      const local = loadLocalDB();
      product = local.products.find(p => p.item_no === itemNo);
    }

    if (!product) {
      unmatched++;
      unmatchedList.push(itemNo);
      process.stdout.write(`\r[${i + 1}/${jpgFiles.length}] ${itemNo} ❌ 无匹配产品                      `);
      continue;
    }

    // Generate thumbnail
    const thumbBuf = await generateThumbnail(buffer);

    // Upload
    const ext = path.extname(fname);
    const ts = Date.now();
    let cosKey = '';
    let thumbKey = '';
    let localPath = '';
    let thumbLocalPath = '';

    if (!forceLocal) {
      cosKey = await uploadToCOS(buffer, `product_upload_${ts}_${itemNo}${ext}`);
      if (cosKey && thumbBuf) {
        thumbKey = await uploadToCOS(thumbBuf, `product_upload_thumb_${ts}_${itemNo}${ext}`);
      }
    }

    if (!cosKey) {
      const f = `upload_${ts}_${itemNo}${ext}`;
      localPath = path.join(UPLOADS_DIR, 'products', f);
      fs.writeFileSync(localPath, buffer);
      if (thumbBuf) {
        thumbLocalPath = path.join(UPLOADS_DIR, 'products', `thumb_${f}`);
        fs.writeFileSync(thumbLocalPath, thumbBuf);
      }
    }

    // Insert product_images record
    if (!useMySQLFallback) {
      // Get current sort_order for this product
      const [cntRows] = await mysqlPool.query('SELECT COALESCE(MAX(sort_order), -1) as maxOrd FROM product_images WHERE product_id = ?', [product.id]);
      const sortOrder = (cntRows[0]?.maxOrd ?? -1) + 1;
      await mysqlPool.query(
        'INSERT INTO product_images (product_id, sort_order, cos_key, thumbnail_cos_key, local_path, thumbnail_local_path) VALUES (?,?,?,?,?,?)',
        [product.id, sortOrder, cosKey, thumbKey, localPath, thumbLocalPath]
      );
      await mysqlPool.query('UPDATE products SET image_count = (SELECT COUNT(*) FROM product_images WHERE product_id = ?), updated_at = ? WHERE id = ?', [product.id, now, product.id]);
    } else {
      const local = loadLocalDB();
      const maxImgId = local.product_images.length > 0 ? Math.max(...local.product_images.map(x => x.id)) : 0;
      const sortOrder = local.product_images.filter(x => x.product_id == product.id).length;
      local.product_images.push({
        id: maxImgId + 1, product_id: product.id, sort_order: sortOrder,
        cos_key: cosKey, thumbnail_cos_key: thumbKey,
        local_path: localPath, thumbnail_local_path: thumbLocalPath
      });
      const pidx = local.products.findIndex(p => p.id == product.id);
      if (pidx >= 0) {
        local.products[pidx].image_count = local.product_images.filter(x => x.product_id == product.id).length;
        local.products[pidx].updated_at = now;
      }
      saveLocalDB(local);
    }

    uploaded++;
    matched++;
    process.stdout.write(`\r[${i + 1}/${jpgFiles.length}] ${itemNo} (${sizeKB}KB) ✅ 已上传                      `);
  }

  console.log(`\n\n✅ 完成！匹配: ${matched}，上传: ${uploaded}，无匹配: ${unmatched}`);
  if (unmatchedList.length > 0) {
    console.log(`\n以下 ${unmatchedList.length} 个文件无匹配产品:`);
    unmatchedList.forEach(n => console.log(`  - ${n}`));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
