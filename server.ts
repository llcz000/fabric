import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import dns from 'dns';
import type { Server } from 'http';
import { BlockList, isIP } from 'net';
import dotenv from 'dotenv';
import mysql, { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import COS from 'cos-nodejs-sdk-v5';
import ExcelJS from 'exceljs';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import sharp from 'sharp';
import { z } from 'zod';
import { createServer as createViteServer } from 'vite';
import { parseExternalImageUrl } from './src/lib/externalImageUrl';

// Load environment variables
dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';

// Trust forwarded client IPs only when the immediate proxy is on this host.
app.set('trust proxy', 'loopback');

// Ensure local storage directories exist
const TEMPLATE_DIR = path.join(process.cwd(), 'template');
const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
const TEMPLATE_CONFIG_FILE = path.join(process.cwd(), 'template_config.json');
const DATABASE_FALLBACK_FILE = path.join(process.cwd(), 'database_fallback.json');

fs.mkdirSync(TEMPLATE_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(path.join(UPLOADS_DIR, 'products'), { recursive: true });

// Setup middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', assetAuthMiddleware, express.static(UPLOADS_DIR, {
  setHeaders: (res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; sandbox");
  },
}));

// ==================== Simple Token Authentication ====================
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD?.trim();
if (!ADMIN_PASSWORD) {
  throw new Error('ADMIN_PASSWORD is required. Refusing to start with an insecure default password.');
}

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const authTokens = new Map<string, number>();

function positiveIntegerFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

const RATE_LIMIT_WINDOW_MS = positiveIntegerFromEnv('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000);
const API_RATE_LIMIT_MAX = positiveIntegerFromEnv('API_RATE_LIMIT_MAX', 1000);
const LOGIN_RATE_LIMIT_MAX = positiveIntegerFromEnv('LOGIN_RATE_LIMIT_MAX', 10);

const apiLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  limit: API_RATE_LIMIT_MAX,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: '请求过于频繁，请稍后再试。' },
});

const loginLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  limit: LOGIN_RATE_LIMIT_MAX,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: '登录尝试过于频繁，请稍后再试。' },
});

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function passwordsMatch(candidate: unknown): boolean {
  const candidateHash = crypto.createHash('sha256').update(String(candidate ?? '')).digest();
  const expectedHash = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  return crypto.timingSafeEqual(candidateHash, expectedHash);
}

function getValidToken(token: string | undefined): string | null {
  const expiresAt = token ? authTokens.get(token) : undefined;
  if (!token || !expiresAt || expiresAt <= Date.now()) {
    if (token) authTokens.delete(token);
    return null;
  }
  return token;
}

function assetAuthMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const cookieHeader = req.headers.cookie || '';
  const assetToken = cookieHeader
    .split(';')
    .map(part => part.trim().split('='))
    .find(([name]) => name === 'fabric_asset_token')?.[1];
  if (!getValidToken(assetToken)) return res.status(401).send('Unauthorized');
  next();
}

function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!getValidToken(token)) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

app.get('/api/health', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    status: 'ok',
    storage: useMySQLFallback ? 'json' : 'mysql',
    uptimeSeconds: Math.floor(process.uptime()),
  });
});

app.use('/api', apiLimiter);

app.post('/api/login', loginLimiter, (req, res) => {
  const { password } = req.body;
  if (!passwordsMatch(password)) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  const token = generateToken();
  authTokens.set(token, Date.now() + TOKEN_TTL_MS);
  res.cookie('fabric_asset_token', token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: TOKEN_TTL_MS,
    path: '/uploads',
  });
  res.json({ token, expiresIn: TOKEN_TTL_MS / 1000 });
});

app.use('/api', authMiddleware);

app.post('/api/logout', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) authTokens.delete(token);
  res.clearCookie('fabric_asset_token', { path: '/uploads' });
  res.json({ success: true });
});

const blockedAddresses = new BlockList();
blockedAddresses.addSubnet('0.0.0.0', 8, 'ipv4');
blockedAddresses.addSubnet('10.0.0.0', 8, 'ipv4');
blockedAddresses.addSubnet('100.64.0.0', 10, 'ipv4');
blockedAddresses.addSubnet('127.0.0.0', 8, 'ipv4');
blockedAddresses.addSubnet('169.254.0.0', 16, 'ipv4');
blockedAddresses.addSubnet('172.16.0.0', 12, 'ipv4');
blockedAddresses.addSubnet('192.168.0.0', 16, 'ipv4');
blockedAddresses.addSubnet('224.0.0.0', 4, 'ipv4');
blockedAddresses.addSubnet('240.0.0.0', 4, 'ipv4');
blockedAddresses.addAddress('::', 'ipv6');
blockedAddresses.addAddress('::1', 'ipv6');
blockedAddresses.addSubnet('fc00::', 7, 'ipv6');
blockedAddresses.addSubnet('fe80::', 10, 'ipv6');
blockedAddresses.addSubnet('ff00::', 8, 'ipv6');

function isBlockedAddress(address: string): boolean {
  const mappedIPv4 = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
  if (mappedIPv4) return blockedAddresses.check(mappedIPv4, 'ipv4');
  const family = isIP(address);
  return family === 4
    ? blockedAddresses.check(address, 'ipv4')
    : family === 6
      ? blockedAddresses.check(address, 'ipv6')
      : true;
}

async function validateExternalImageUrl(rawUrl: string): Promise<URL> {
  const url = parseExternalImageUrl(rawUrl);

  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await dns.promises.lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isBlockedAddress(address))) {
    throw new Error('Internal or reserved IPs are not allowed');
  }
  return url;
}

async function fetchExternalImage(rawUrl: string): Promise<Response> {
  let currentUrl = rawUrl;
  for (let redirectCount = 0; redirectCount <= 3; redirectCount++) {
    const validatedUrl = await validateExternalImageUrl(currentUrl);
    const response = await fetch(validatedUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status < 300 || response.status >= 400) return response;

    const location = response.headers.get('location');
    if (!location || redirectCount === 3) throw new Error('Too many or invalid redirects');
    currentUrl = new URL(location, validatedUrl).toString();
  }
  throw new Error('Unable to fetch image');
}

async function readBodyWithLimit(response: Response, maxBytes: number): Promise<Buffer> {
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > maxBytes) throw new Error('Image is too large');
  if (!response.body) throw new Error('Image response has no body');

  const chunks: Uint8Array[] = [];
  let received = 0;
  for await (const chunk of response.body as any) {
    const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    received += bytes.byteLength;
    if (received > maxBytes) throw new Error('Image is too large');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

// Authenticated image proxy for raster images used by document export.
app.get('/api/proxy-image', async (req, res) => {
  try {
    const url = req.query.url as string;
    if (!url) return res.status(400).send('Missing url parameter');
    const imageRes = await fetchExternalImage(url);
    if (!imageRes.ok) return res.status(404).send('Image not found');

    const contentType = (imageRes.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
    if (!allowedTypes.has(contentType)) return res.status(415).send('Unsupported image type');

    const buffer = await readBodyWithLimit(imageRes, 10 * 1024 * 1024);
    res.set('Content-Type', contentType);
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(buffer);
  } catch (e: any) {
    const message = e?.message || 'Proxy error';
    const isRejectedUrl = /HTTPS|credentials|Internal|reserved|redirect/i.test(message);
    res.status(isRejectedUrl ? 403 : 502).send('Proxy error');
  }
});

// Setup multer for local file uploads (as fallback or template uploads)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === 'template_file' || file.originalname.endsWith('.xlsx')) {
      cb(null, TEMPLATE_DIR);
    } else {
      cb(null, UPLOADS_DIR);
    }
  },
  filename: (req, file, cb) => {
    // Always generate server-side names; never persist user-controlled file names.
    if (file.fieldname === 'template_file' || file.originalname.endsWith('.xlsx')) {
      cb(null, `template-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.xlsx`);
    } else {
      const ext = path.extname(file.originalname);
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, 'upload-' + uniqueSuffix + ext);
    }
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const requestPath = req.originalUrl.split('?')[0];
    const isExcelRoute = requestPath === '/api/template/upload' || requestPath === '/api/products/import';
    const isXlsx = extension === '.xlsx'
      && file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const rasterMimes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
    const rasterExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

    if (isExcelRoute) {
      return isXlsx ? cb(null, true) : cb(new Error('Only .xlsx files are allowed'));
    }
    if (rasterMimes.has(file.mimetype) && rasterExtensions.has(extension)) return cb(null, true);
    cb(new Error('Only JPEG, PNG, WebP, and GIF images are allowed'));
  },
});

class UploadValidationError extends Error {}

function getRequestFiles(req: express.Request): Express.Multer.File[] {
  if (req.file) return [req.file];
  if (Array.isArray(req.files)) return req.files;
  if (req.files) return Object.values(req.files).flat();
  return [];
}

async function cleanupUploadedFiles(files: Express.Multer.File[], retainedPaths = new Set<string>()) {
  await Promise.allSettled(files.map(async (file) => {
    if (!file?.path || retainedPaths.has(file.path)) return;
    await fs.promises.rm(file.path, { force: true });
  }));
}

async function validateRasterFiles(files: Express.Multer.File[]) {
  const allowedFormats = new Set(['jpeg', 'png', 'webp', 'gif']);
  const expectedMimeByFormat: Record<string, string> = {
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
  };
  const expectedExtensionsByFormat: Record<string, Set<string>> = {
    jpeg: new Set(['.jpg', '.jpeg']),
    png: new Set(['.png']),
    webp: new Set(['.webp']),
    gif: new Set(['.gif']),
  };
  const maxPixels = 40_000_000;

  for (const file of files) {
    try {
      const image = sharp(file.path, { limitInputPixels: maxPixels });
      const metadata = await image.metadata();
      if (!metadata.format || !allowedFormats.has(metadata.format)) {
        throw new Error('Unsupported image format');
      }
      if (file.mimetype !== expectedMimeByFormat[metadata.format]
        || !expectedExtensionsByFormat[metadata.format].has(path.extname(file.originalname).toLowerCase())) {
        throw new Error('Image format does not match its declared type');
      }
      if (!metadata.width || !metadata.height || metadata.width * metadata.height > maxPixels) {
        throw new Error('Image dimensions are too large');
      }
      await image.clone().resize(1, 1, { fit: 'inside' }).toBuffer();
    } catch {
      throw new UploadValidationError('Uploaded file is not a valid JPEG, PNG, WebP, or GIF image');
    }
  }
}

async function readUploadedWorkbook(file: Express.Multer.File): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.readFile(file.path);
    if (workbook.worksheets.length === 0) throw new Error('Workbook has no worksheets');
    return workbook;
  } catch {
    throw new UploadValidationError('Uploaded file is not a valid .xlsx workbook');
  }
}

async function validateRasterUploads(req: express.Request, _res: express.Response, next: express.NextFunction) {
  const files = getRequestFiles(req);
  try {
    await validateRasterFiles(files);
    next();
  } catch (error) {
    await cleanupUploadedFiles(files);
    next(error);
  }
}

// ==================== MySQL Database Config & Lazy Pool Initialization ====================
let mysqlPool: mysql.Pool | null = null;
let useMySQLFallback = true;

async function getMySQLPool(): Promise<mysql.Pool> {
  if (mysqlPool) return mysqlPool;

  // 从环境变量读取数据库配置，无默认值（强制要求配置）
  const host = process.env.DB_HOST;
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;
  const database = process.env.DB_DATABASE;

  if (!host || !user || !password || !database) {
    console.warn('[Database] MySQL environment variables not fully configured. Required: DB_HOST, DB_USER, DB_PASSWORD, DB_DATABASE');
    throw new Error('MySQL configuration missing');
  }

  console.log(`[Database] Attempting to connect to MySQL database '${database}' on host '${host}'...`);
  mysqlPool = mysql.createPool({
    host,
    user,
    password,
    database,
    dateStrings: true,
    connectionLimit: 10,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
  });

  // Test connection and auto-initialize tables
  try {
    const conn = await mysqlPool.getConnection();
    console.log('[Database] MySQL connection established successfully! Running migrations/initializations...');

    // Create tables if they do not exist
    await conn.query(`
      CREATE TABLE IF NOT EXISTS company_config (
        id INT PRIMARY KEY,
        company_name VARCHAR(255) NOT NULL,
        brand_name VARCHAR(255) DEFAULT '',
        brand_logo VARCHAR(500) DEFAULT '',
        address VARCHAR(500) DEFAULT '',
        phone VARCHAR(100) DEFAULT '',
        wechat_qr VARCHAR(500) DEFAULT '',
        alipay_qr VARCHAR(500) DEFAULT '',
        default_terms TEXT,
        deposit_terms TEXT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        order_no VARCHAR(100) NOT NULL,
        order_date VARCHAR(50) NOT NULL,
        style_no VARCHAR(100) DEFAULT '',
        receiving_unit VARCHAR(255) DEFAULT '',
        total_meters DECIMAL(12,2) DEFAULT 0,
        total_pieces INT DEFAULT 0,
        total_amount DECIMAL(12,2) DEFAULT 0,
        sign_person VARCHAR(100) DEFAULT '',
        receiver VARCHAR(100) DEFAULT '',
        receiver_phone VARCHAR(100) DEFAULT '',
        receiver_address VARCHAR(500) DEFAULT '',
        template_type VARCHAR(20) DEFAULT 'sample',
        deposit DECIMAL(12,2) DEFAULT 0,
        deduction_meters DECIMAL(12,2) DEFAULT 0,
        settled TINYINT(1) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        order_id INT NOT NULL,
        product_no VARCHAR(100) DEFAULT '',
        color_no VARCHAR(100) DEFAULT '',
        product_name VARCHAR(255) DEFAULT '',
        composition VARCHAR(255) DEFAULT '',
        weight DECIMAL(10,2) DEFAULT 0,
        width DECIMAL(10,2) DEFAULT 0,
        meters DECIMAL(12,2) DEFAULT 0,
        unit_price DECIMAL(12,2) DEFAULT 0,
        amount DECIMAL(12,2) DEFAULT 0,
        remark VARCHAR(500) DEFAULT '',
        piece_meters JSON NULL,
        deduction_meters DECIMAL(12,2) DEFAULT 0,
        KEY fk_order_items_order_id (order_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Product Library tables
    await conn.query(`
      CREATE TABLE IF NOT EXISTS products (
        id INT AUTO_INCREMENT PRIMARY KEY,
        item_no VARCHAR(100) NOT NULL,
        product_name VARCHAR(255) DEFAULT '',
        composition VARCHAR(255) DEFAULT '',
        weight VARCHAR(100) DEFAULT '',
        width VARCHAR(100) DEFAULT '',
        image_count INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_item_no (item_no)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS product_images (
        id INT AUTO_INCREMENT PRIMARY KEY,
        product_id INT NOT NULL,
        sort_order INT DEFAULT 0,
        cos_key VARCHAR(500) DEFAULT '',
        thumbnail_cos_key VARCHAR(500) DEFAULT '',
        local_path VARCHAR(500) DEFAULT '',
        thumbnail_local_path VARCHAR(500) DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
        INDEX idx_product_id (product_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Inventory entries table
    await conn.query(`
      CREATE TABLE IF NOT EXISTS inventory_entries (
        id INT AUTO_INCREMENT PRIMARY KEY,
        entry_date VARCHAR(50) NOT NULL,
        product_name VARCHAR(255) DEFAULT '',
        rolls INT DEFAULT 0,
        meters DECIMAL(12,2) DEFAULT 0,
        remark VARCHAR(500) DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_product_name (product_name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Add missing columns for existing databases (safe to run even if column exists)
    const addColumnIfNotExists = async (table: string, column: string, definition: string) => {
      try {
        await conn.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
        console.log(`[Database] Added column ${column} to ${table}`);
      } catch (_: any) {
        if (_.message && _.message.includes('Duplicate column name')) {
          // Column already exists, ignore
        } else {
          console.warn(`[Database] Error adding column ${column}:`, _.message);
        }
      }
    };

    await addColumnIfNotExists('company_config', 'default_terms', 'TEXT');
    await addColumnIfNotExists('company_config', 'deposit_terms', 'TEXT');
    await addColumnIfNotExists('orders', 'receiver_address', 'VARCHAR(500) DEFAULT \'\'');
    await addColumnIfNotExists('orders', 'deduction_meters', 'DECIMAL(12,2) DEFAULT 0');
    await addColumnIfNotExists('order_items', 'deduction_meters', 'DECIMAL(12,2) DEFAULT 0');
    await addColumnIfNotExists('orders', 'settled', 'TINYINT(1) DEFAULT 0');
    await addColumnIfNotExists('inventory_entries', 'remark', 'VARCHAR(500) DEFAULT \'\'');

    // Repair: recalculate order totals from order_items (fixes any zero-total records)
    try {
      const [repairResult] = await conn.query<ResultSetHeader>(`
        UPDATE orders o
        SET
          total_meters = (SELECT COALESCE(SUM(meters), 0) FROM order_items WHERE order_id = o.id),
          total_pieces = (SELECT COUNT(*) FROM order_items WHERE order_id = o.id),
          total_amount = (SELECT COALESCE(SUM(amount), 0) FROM order_items WHERE order_id = o.id),
          deduction_meters = (SELECT COALESCE(SUM(COALESCE(deduction_meters, 0)), 0) FROM order_items WHERE order_id = o.id)
      `);
      if (repairResult.affectedRows > 0) {
        console.log(`[Database] Repaired totals for ${repairResult.affectedRows} orders from order_items`);
      }
    } catch (_: any) {
      // order_items table may not exist yet on first run
    }

    // Insert initial company config row if not exists
    await conn.query(`
      INSERT IGNORE INTO company_config (id, company_name, brand_name, brand_logo, address, phone, wechat_qr, alipay_qr, default_terms)
      VALUES (1, '织梦盛世面料品贸易有限公司', '织梦面料 · DREAM WEAVE', '', '浙江省绍兴市柯桥区中国轻纺城创意路88号3层', '0575-81234567', '', '', '')
    `);

    console.log('[Database] MySQL tables auto-initialized / verified successfully!');
    conn.release();
    useMySQLFallback = false;
  } catch (error: any) {
    console.warn(`[Database] MySQL connection or initialization failed: ${error.message}. Falling back to JSON local file storage!`);
    mysqlPool = null;
    useMySQLFallback = true;
    throw error;
  }

  return mysqlPool;
}

// Fallback JSON File Database structure
interface LocalDB {
  company_config: any;
  orders: any[];
  order_items: any[];
  products: any[];
  product_images: any[];
  inventory_entries: any[];
}

function loadLocalDB(): LocalDB {
  if (fs.existsSync(DATABASE_FALLBACK_FILE)) {
    try {
      const data = fs.readFileSync(DATABASE_FALLBACK_FILE, 'utf8');
      return JSON.parse(data);
    } catch (e) {
      console.error('[Fallback DB] Failed to parse JSON database:', e);
    }
  }

  // Default values
  const defaultDB: LocalDB = {
    company_config: {
      id: 1,
      company_name: '织梦盛世面料品贸易有限公司',
      brand_name: '织梦面料 · DREAM WEAVE',
      brand_logo: '',
      address: '浙江省绍兴市柯桥区中国轻纺城创意路88号3层',
      phone: '0575-81234567',
      wechat_qr: '',
      alipay_qr: '',
      default_terms: ''
    },
    orders: [],
    order_items: [],
    products: [],
    product_images: [],
    inventory_entries: []
  };
  saveLocalDB(defaultDB);
  return defaultDB;
}

function saveLocalDB(data: LocalDB) {
  fs.writeFileSync(DATABASE_FALLBACK_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function resolveUploadFile(localPath: unknown): string | null {
  if (typeof localPath !== 'string' || !localPath.trim()) return null;
  try {
    const resolvedPath = path.resolve(localPath);
    const uploadsRoot = fs.realpathSync(UPLOADS_DIR);
    const realPath = fs.realpathSync(resolvedPath);
    const relativePath = path.relative(uploadsRoot, realPath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) return null;
    return realPath;
  } catch {
    return null;
  }
}

// MySQL initialization moved into startServer() to avoid race condition

// ==================== Tencent Cloud COS Config ====================
let cosClient: COS | null = null;

// 从环境变量读取 COS 配置，无默认值（强制要求配置）
function getCOSConfig() {
  const secretId = process.env.COS_SECRET_ID;
  const secretKey = process.env.COS_SECRET_KEY;
  const region = process.env.COS_REGION;
  const bucket = process.env.COS_BUCKET;

  if (!secretId || !secretKey || !region || !bucket) {
    console.warn('[COS] COS environment variables not fully configured. Required: COS_SECRET_ID, COS_SECRET_KEY, COS_REGION, COS_BUCKET');
    return null;
  }

  return { secretId, secretKey, region, bucket };
}

function getCOSClient(): COS | null {
  if (cosClient) return cosClient;

  const config = getCOSConfig();
  if (!config) return null;

  cosClient = new COS({
    SecretId: config.secretId,
    SecretKey: config.secretKey
  });
  return cosClient;
}

// ==================== Template Configurations = "template_config.json" ====================
function loadTemplateConfig() {
  if (fs.existsSync(TEMPLATE_CONFIG_FILE)) {
    try {
      const content = fs.readFileSync(TEMPLATE_CONFIG_FILE, 'utf8');
      return JSON.parse(content);
    } catch (e) {
      console.error('[Templates] Error reading template_config.json:', e);
    }
  }
  const defaultConf = { templates: {} };
  saveTemplateConfig(defaultConf);
  return defaultConf;
}

function saveTemplateConfig(config: any) {
  fs.writeFileSync(TEMPLATE_CONFIG_FILE, JSON.stringify(config, null, 4), 'utf8');
}

// ==================== Input Validation Schemas ====================
const OrderItemSchema = z.object({
  product_no: z.string().max(100).optional().default(''),
  color_no: z.string().max(100).optional().default(''),
  product_name: z.string().max(255).optional().default(''),
  composition: z.string().max(255).optional().default(''),
  weight: z.union([z.number(), z.string()]).transform(v => parseFloat(String(v)) || 0).pipe(z.number().min(0)).optional().default(0),
  width: z.union([z.number(), z.string()]).transform(v => parseFloat(String(v)) || 0).pipe(z.number().min(0)).optional().default(0),
  meters: z.number().min(0).optional().default(0),
  unit_price: z.number().min(0).optional().default(0),
  amount: z.number().min(0).optional().default(0),
  remark: z.string().max(500).optional().default(''),
  piece_meters: z.array(z.number()).nullable().optional(),
  deduction_meters: z.number().min(0).optional().default(0),
});

const CreateOrderSchema = z.object({
  order_no: z.string().max(100),
  order_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  style_no: z.string().max(100).optional().default(''),
  receiving_unit: z.string().max(255).optional().default(''),
  total_meters: z.number().optional().default(0),
  total_pieces: z.number().int().optional().default(0),
  total_amount: z.number().optional().default(0),
  sign_person: z.string().max(100).optional().default(''),
  receiver: z.string().max(100).optional().default(''),
  receiver_phone: z.string().max(100).optional().default(''),
  receiver_address: z.string().max(500).optional().default(''),
  template_type: z.enum(['sample', 'bulk', 'deposit']).optional().default('sample'),
  deposit: z.number().min(0).optional().default(0),
  deduction_meters: z.number().min(0).optional().default(0),
  settled: z.boolean().optional().default(false),
  items: z.array(OrderItemSchema),
});

const CompanyConfigSchema = z.object({
  company_name: z.string().max(255).optional().default(''),
  brand_name: z.string().max(255).optional().default(''),
  brand_logo: z.string().max(3_000_000).optional().default(''),
  address: z.string().max(500).optional().default(''),
  phone: z.string().max(100).optional().default(''),
  wechat_qr: z.string().max(3_000_000).optional().default(''),
  alipay_qr: z.string().max(3_000_000).optional().default(''),
  default_terms: z.string().max(10_000).optional().default(''),
  deposit_terms: z.string().max(10_000).optional().default(''),
});

// ==================== API Route: Company Config ====================
app.get('/api/company', async (req, res) => {
  try {
    if (!useMySQLFallback) {
      const pool = await getMySQLPool();
      const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM company_config WHERE id = 1');
      if (rows.length > 0) {
        return res.json(rows[0]);
      }
    }
    // Fallback
    const local = loadLocalDB();
    res.json(local.company_config);
  } catch (error: any) {
    // Graceful error fallback
    const local = loadLocalDB();
    res.json(local.company_config);
  }
});

app.post('/api/company', async (req, res) => {
  try {
    const parsed = CompanyConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid company configuration', details: parsed.error.issues });
    }
    const data = parsed.data;
    if (!useMySQLFallback) {
      const pool = await getMySQLPool();
      // Ensure row with id=1 exists, update if yes, insert if no
      const [rows] = await pool.query<RowDataPacket[]>('SELECT id FROM company_config WHERE id = 1');
      if (rows.length > 0) {
        await pool.query(
          `UPDATE company_config SET
            company_name = ?, brand_name = ?, brand_logo = ?, address = ?, phone = ?,
            wechat_qr = ?, alipay_qr = ?, default_terms = ?, deposit_terms = ?
          WHERE id = 1`,
          [
            data.company_name || '',
            data.brand_name || '',
            data.brand_logo || '',
            data.address || '',
            data.phone || '',
            data.wechat_qr || '',
            data.alipay_qr || '',
            data.default_terms || '',
            data.deposit_terms || ''
          ]
        );
      } else {
        await pool.query(
          `INSERT INTO company_config (id, company_name, brand_name, brand_logo, address, phone, wechat_qr, alipay_qr, default_terms, deposit_terms)
           VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            data.company_name || '',
            data.brand_name || '',
            data.brand_logo || '',
            data.address || '',
            data.phone || '',
            data.wechat_qr || '',
            data.alipay_qr || '',
            data.default_terms || '',
            data.deposit_terms || ''
          ]
        );
      }
      return res.json({ success: true });
    }
    // Fallback
    const local = loadLocalDB();
    local.company_config = { ...local.company_config, ...data, id: 1 };
    saveLocalDB(local);
    res.json({ success: true });
  } catch (error: any) {
    console.error('[API /api/company POST] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ==================== API Route: Orders ====================
app.get('/api/orders', async (req, res) => {
  try {
    if (!useMySQLFallback) {
      const pool = await getMySQLPool();
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT o.*, oi.id as item_id, oi.product_no, oi.color_no, oi.product_name,
                oi.composition, oi.weight, oi.width, oi.meters as item_meters,
                oi.unit_price, oi.amount as item_amount, oi.remark, oi.piece_meters, oi.deduction_meters as item_deduction_meters
         FROM orders o
         LEFT JOIN order_items oi ON oi.order_id = o.id
         ORDER BY o.created_at DESC`
      );
      // Group flat rows into orders with nested items
      const orderMap = new Map<number, any>();
      for (const row of rows) {
        if (!orderMap.has(row.id)) {
          orderMap.set(row.id, {
            ...row,
            items: [],
          });
          // Clean up item columns from order level
          delete (orderMap.get(row.id) as any).item_id;
          delete (orderMap.get(row.id) as any).product_no;
          delete (orderMap.get(row.id) as any).color_no;
          delete (orderMap.get(row.id) as any).product_name;
          delete (orderMap.get(row.id) as any).composition;
          delete (orderMap.get(row.id) as any).weight;
          delete (orderMap.get(row.id) as any).width;
          delete (orderMap.get(row.id) as any).item_meters;
          delete (orderMap.get(row.id) as any).unit_price;
          delete (orderMap.get(row.id) as any).item_amount;
          delete (orderMap.get(row.id) as any).remark;
          delete (orderMap.get(row.id) as any).piece_meters;
          delete (orderMap.get(row.id) as any).item_deduction_meters;
        }
        if (row.item_id) {
          orderMap.get(row.id).items.push({
            id: row.item_id,
            product_no: row.product_no,
            color_no: row.color_no,
            product_name: row.product_name,
            composition: row.composition,
            weight: row.weight,
            width: row.width,
            meters: row.item_meters,
            unit_price: row.unit_price,
            amount: row.item_amount,
            remark: row.remark,
            piece_meters: row.piece_meters,
            deduction_meters: row.item_deduction_meters,
          });
        }
      }
      return res.json(Array.from(orderMap.values()));
    }
    // JSON fallback: group items from local.order_items (consistent with MySQL LEFT JOIN)
    const local = loadLocalDB();
    const fbOrderMap = new Map<number, any>();
    for (const order of local.orders) {
      const { items: _embedded, ...orderBase } = order;
      fbOrderMap.set(order.id, { ...orderBase, items: [] });
    }
    for (const item of local.order_items) {
      const order = fbOrderMap.get(item.order_id);
      if (order) {
        order.items.push(item);
      }
    }
    res.json(Array.from(fbOrderMap.values()));
  } catch (error: any) {
    const local = loadLocalDB();
    const fbOrderMap = new Map<number, any>();
    for (const order of local.orders) {
      const { items: _embedded, ...orderBase } = order;
      fbOrderMap.set(order.id, { ...orderBase, items: [] });
    }
    for (const item of local.order_items) {
      const order = fbOrderMap.get(item.order_id);
      if (order) {
        order.items.push(item);
      }
    }
    res.json(Array.from(fbOrderMap.values()));
  }
});

app.get('/api/orders/:id', async (req, res) => {
  const orderId = req.params.id;
  try {
    if (!useMySQLFallback) {
      const pool = await getMySQLPool();
      const [orderRows] = await pool.query<RowDataPacket[]>('SELECT * FROM orders WHERE id = ?', [orderId]);
      if (orderRows.length === 0) return res.status(404).json({ error: 'Order not found' });

      const [itemRows] = await pool.query<RowDataPacket[]>('SELECT * FROM order_items WHERE order_id = ?', [orderId]);
      return res.json({ ...orderRows[0], items: itemRows });
    }
    const local = loadLocalDB();
    const order = local.orders.find((o: any) => o.id == orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    const items = local.order_items.filter((i: any) => i.order_id == orderId);
    res.json({ ...order, items });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    const parsed = CreateOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid order data', details: parsed.error.issues });
    }
    const data = parsed.data;
    if (!useMySQLFallback) {
      const pool = await getMySQLPool();
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const [result] = await conn.query<ResultSetHeader>(
          `INSERT INTO orders (order_no, order_date, style_no, receiving_unit, total_meters, total_pieces, total_amount, sign_person, receiver, receiver_phone, receiver_address, template_type, deposit, deduction_meters, settled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          data.order_no,
          data.order_date,
          data.style_no || '',
          data.receiving_unit || '',
          data.total_meters || 0,
          data.total_pieces || 0,
          data.total_amount || 0,
          data.sign_person || '',
          data.receiver || '',
          data.receiver_phone || '',
          data.receiver_address || '',
          data.template_type || 'sample',
          data.deposit || 0,
          data.deduction_meters || 0,
          data.settled ? 1 : 0
        ]
      );
      const orderId = result.insertId;

      // Insert items
      if (data.items && data.items.length > 0) {
        for (const item of data.items) {
          await conn.query(
            `INSERT INTO order_items (order_id, product_no, color_no, product_name, composition, weight, width, meters, unit_price, amount, remark, piece_meters, deduction_meters)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              orderId,
              item.product_no || '',
              item.color_no || '',
              item.product_name || '',
              item.composition || '',
              String(item.weight ?? 0),
              String(item.width ?? 0),
              item.meters || 0,
              item.unit_price || 0,
              item.amount || 0,
              item.remark || '',
              item.piece_meters ? JSON.stringify(item.piece_meters) : null,
              item.deduction_meters || 0
            ]
          );
        }
      }
      await conn.commit();
      return res.json({ success: true, id: orderId });
      } catch (txErr: any) {
        await conn.rollback();
        throw txErr;
      } finally {
        conn.release();
      }
    }
    // Fallback
    const local = loadLocalDB();
    const newId = local.orders.length > 0 ? Math.max(...local.orders.map((o: any) => o.id)) + 1 : 1;
    const newOrder = { ...data, id: newId, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    local.orders.push(newOrder);

    if (data.items && data.items.length > 0) {
      for (const item of data.items) {
        const itemId = local.order_items.length > 0 ? Math.max(...local.order_items.map((i: any) => i.id)) + 1 : 1;
        local.order_items.push({ ...item, id: itemId, order_id: newId });
      }
    }
    saveLocalDB(local);
    res.json({ success: true, id: newId });
  } catch (error: any) {
    console.error('[API /api/orders POST] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/orders/:id', async (req, res) => {
  const orderId = req.params.id;
  try {
    const parsed = CreateOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid order data', details: parsed.error.issues });
    }
    const data = parsed.data;
    if (!useMySQLFallback) {
      const pool = await getMySQLPool();
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        await conn.query(
          `UPDATE orders SET
            order_no = ?, order_date = ?, style_no = ?, receiving_unit = ?,
            total_meters = ?, total_pieces = ?, total_amount = ?,
            sign_person = ?, receiver = ?, receiver_phone = ?, receiver_address = ?, template_type = ?, deposit = ?, deduction_meters = ?, settled = ?
          WHERE id = ?`,
          [
            data.order_no,
            data.order_date,
            data.style_no || '',
            data.receiving_unit || '',
            data.total_meters || 0,
            data.total_pieces || 0,
            data.total_amount || 0,
            data.sign_person || '',
            data.receiver || '',
            data.receiver_phone || '',
            data.receiver_address || '',
            data.template_type || 'sample',
            data.deposit || 0,
            data.deduction_meters || 0,
            data.settled ? 1 : 0,
            orderId
          ]
        );

        // Delete old items and re-insert
        await conn.query('DELETE FROM order_items WHERE order_id = ?', [orderId]);
        if (data.items && data.items.length > 0) {
          for (const item of data.items) {
            await conn.query(
              `INSERT INTO order_items (order_id, product_no, color_no, product_name, composition, weight, width, meters, unit_price, amount, remark, piece_meters, deduction_meters)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                orderId,
                item.product_no || '',
                item.color_no || '',
                item.product_name || '',
                item.composition || '',
                String(item.weight ?? 0),
                String(item.width ?? 0),
                item.meters || 0,
                item.unit_price || 0,
                item.amount || 0,
                item.remark || '',
                item.piece_meters ? JSON.stringify(item.piece_meters) : null,
              item.deduction_meters || 0
              ]
          );
        }
        }
        await conn.commit();
        return res.json({ success: true });
        } catch (txErr: any) {
          await conn.rollback();
          throw txErr;
        } finally {
          conn.release();
        }
      }
      // Fallback
    const local = loadLocalDB();
    const idx = local.orders.findIndex((o: any) => o.id == orderId);
    if (idx === -1) return res.status(404).json({ error: 'Order not found' });
    local.orders[idx] = { ...local.orders[idx], ...data, updated_at: new Date().toISOString() };

    // Update items
    local.order_items = local.order_items.filter((i: any) => i.order_id != orderId);
    if (data.items && data.items.length > 0) {
      for (const item of data.items) {
        const itemId = local.order_items.length > 0 ? Math.max(...local.order_items.map((i: any) => i.id)) + 1 : 1;
        local.order_items.push({ ...item, id: itemId, order_id: orderId });
      }
    }
    saveLocalDB(local);
    res.json({ success: true });
  } catch (error: any) {
    console.error('[API /api/orders PUT] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/orders/:id', async (req, res) => {
  const orderId = req.params.id;
  try {
    if (!useMySQLFallback) {
      const pool = await getMySQLPool();
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        await conn.query('DELETE FROM order_items WHERE order_id = ?', [orderId]);
        await conn.query('DELETE FROM orders WHERE id = ?', [orderId]);
        await conn.commit();
        return res.json({ success: true });
      } catch (txErr: any) {
        await conn.rollback();
        throw txErr;
      } finally {
        conn.release();
      }
    }
    // Fallback
    const local = loadLocalDB();
    local.orders = local.orders.filter((o: any) => o.id != orderId);
    local.order_items = local.order_items.filter((i: any) => i.order_id != orderId);
    saveLocalDB(local);
    res.json({ success: true });
  } catch (error: any) {
    console.error('[API /api/orders DELETE] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ==================== API Route: COS Upload ====================
app.post('/api/upload', upload.single('file'), validateRasterUploads, async (req, res) => {
  const files = getRequestFiles(req);
  const retainedPaths = new Set<string>();
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const cos = getCOSClient();
    const cosConfig = getCOSConfig();

    if (!cos || !cosConfig) {
      // Fallback: return local file path
      retainedPaths.add(req.file.path);
      const localUrl = `/uploads/${req.file.filename}`;
      return res.json({ url: localUrl, source: 'local' });
    }

    const key = `uploads/${Date.now()}-${req.file.filename}`;

    await cos.putObject({
      Bucket: cosConfig.bucket,
      Region: cosConfig.region,
      Key: key,
      Body: fs.createReadStream(req.file.path),
      ContentLength: req.file.size
    });

    const url = `https://${cosConfig.bucket}.cos.${cosConfig.region}.myqcloud.com/${key}`;
    res.json({ url, source: 'cos' });
  } catch (error: any) {
    console.error('[API /api/upload] Error:', error.message);
    res.status(500).json({ error: error.message });
  } finally {
    await cleanupUploadedFiles(files, retainedPaths);
  }
});

// ==================== API Route: Template Upload & Parse ====================
app.post('/api/template/upload', upload.single('template_file'), async (req, res, next) => {
  const files = getRequestFiles(req);
  try {
    if (!req.file) return res.status(400).json({ error: 'No template file uploaded' });

    const workbook = await readUploadedWorkbook(req.file);

    const worksheet = workbook.worksheets[0];
    const rows: any[] = [];

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // Skip header
      const rowData: any = {};
      row.eachCell((cell, colNumber) => {
        rowData[`col${colNumber}`] = cell.value;
      });
      rows.push(rowData);
    });

    // Save template config
    const config = loadTemplateConfig();
    config.templates[req.file.filename] = {
      path: req.file.path,
      uploadedAt: new Date().toISOString(),
      rowCount: rows.length
    };
    saveTemplateConfig(config);

    res.json({ success: true, filename: req.file.filename, rows: rows.slice(0, 10) });
  } catch (error: any) {
    console.error('[API /api/template/upload] Error:', error.message);
    await cleanupUploadedFiles(files);
    next(error);
  }
});

// ==================== API Route: Template Config ====================
app.get('/api/template/config', (req, res) => {
  const config = loadTemplateConfig();
  res.json(config);
});

// ==================== API Route: Export Order as Excel ====================
app.get('/api/export_template/:id', async (req, res) => {
  const orderId = req.params.id;
  try {
    let order: any;
    let items: any[];

    if (!useMySQLFallback) {
      const pool = await getMySQLPool();
      const [orderRows] = await pool.query<RowDataPacket[]>('SELECT * FROM orders WHERE id = ?', [orderId]);
      if (orderRows.length === 0) return res.status(404).json({ error: '订单不存在' });
      order = orderRows[0];
      const [itemRows] = await pool.query<RowDataPacket[]>('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', [orderId]);
      items = itemRows;
    } else {
      const local = loadLocalDB();
      order = local.orders.find((o: any) => o.id == orderId);
      if (!order) return res.status(404).json({ error: '订单不存在' });
      items = local.order_items.filter((i: any) => i.order_id == orderId);
    }

    // Get company config for header info
    let company: any = {};
    try {
      if (!useMySQLFallback) {
        const pool = await getMySQLPool();
        const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM company_config WHERE id = 1');
        if (rows.length > 0) company = rows[0];
      } else {
        const local = loadLocalDB();
        company = local.company_config;
      }
    } catch { /* use empty company info */ }

    const templateType = order.template_type || 'sample';
    const isSample = templateType === 'sample';
    const isDeposit = templateType === 'deposit';

    // Try to find a template file
    const config = loadTemplateConfig();
    let templatePath: string | null = null;
    for (const [, info] of Object.entries(config.templates as Record<string, any>)) {
      if (info.path && fs.existsSync(info.path)) {
        templatePath = info.path;
        break;
      }
    }

    const workbook = new ExcelJS.Workbook();
    let worksheet: ExcelJS.Worksheet;

    if (templatePath) {
      // Load template and fill data into named ranges or specific cells
      await workbook.xlsx.readFile(templatePath);
      worksheet = workbook.worksheets[0];

      // Attempt to fill template placeholders
      const replaceInSheet = (sheet: ExcelJS.Worksheet) => {
        sheet.eachRow((row) => {
          row.eachCell((cell) => {
            if (typeof cell.value === 'string') {
              let v = cell.value;
              v = v.replace(/\{\{docNo\}\}/g, order.order_no || '');
              v = v.replace(/\{\{date\}\}/g, (order.order_date || '').substring(0, 10));
              v = v.replace(/\{\{customerName\}\}/g, order.receiving_unit || '');
              v = v.replace(/\{\{styleNo\}\}/g, order.style_no || '');
              v = v.replace(/\{\{totalMeters\}\}/g, String(order.total_meters || 0));
              v = v.replace(/\{\{totalPieces\}\}/g, String(order.total_pieces || 0));
              v = v.replace(/\{\{totalAmount\}\}/g, String(order.total_amount || 0));
              v = v.replace(/\{\{deposit\}\}/g, String(order.deposit || 0));
              v = v.replace(/\{\{signPerson\}\}/g, order.sign_person || '');
              v = v.replace(/\{\{receiver\}\}/g, order.receiver || '');
              v = v.replace(/\{\{companyName\}\}/g, company.company_name || '');
              v = v.replace(/\{\{companyAddress\}\}/g, company.address || '');
              v = v.replace(/\{\{companyPhone\}\}/g, company.phone || '');
              v = v.replace(/\{\{terms\}\}/g, company.default_terms || '');
              cell.value = v;
            }
          });
        });
      };
      replaceInSheet(worksheet);
    } else {
      // Generate Excel from scratch
      worksheet = workbook.addWorksheet('单据');

      // Column definitions
      const title = isSample ? '样布码单' : (isDeposit ? '定金单' : '销售发货码单');
      const cols = isSample
        ? ['序号', '货号', '色号', '品名', '成分', '克重', '门幅(cm)', '米数(m)', '单价(元)', '金额(元)', '备注']
        : isDeposit
          ? ['序号', '货号', '色号', '品名', '米数(m)', '单价(元)', '金额(元)']
          : ['序号', '货号', '色号', '品名', '匹号/箱号', '门幅(cm)', '米数(m)', '单价(元)', '金额(元)', '备注'];

      // -- Row 1: Company name
      worksheet.mergeCells(1, 1, 1, cols.length);
      const titleCell = worksheet.getCell(1, 1);
      titleCell.value = company.company_name || '';
      titleCell.font = { name: '宋体', size: 16, bold: true };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      worksheet.getRow(1).height = 32;

      // -- Row 2: Document title
      worksheet.mergeCells(2, 1, 2, cols.length);
      const subTitleCell = worksheet.getCell(2, 1);
      subTitleCell.value = title;
      subTitleCell.font = { name: '宋体', size: 14, bold: true };
      subTitleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      worksheet.getRow(2).height = 28;

      // -- Row 3: Order info
      const halfCols = Math.floor(cols.length / 2);
      worksheet.mergeCells(3, 1, 3, halfCols);
      const cell3_1 = worksheet.getCell(3, 1);
      cell3_1.value = `单据编号：${order.order_no || ''}`;
      cell3_1.font = { name: '宋体', size: 11 };
      worksheet.mergeCells(3, halfCols + 1, 3, cols.length);
      const cell3_2 = worksheet.getCell(3, halfCols + 1);
      cell3_2.value = `日期：${(order.order_date || '').substring(0, 10)}`;
      cell3_2.font = { name: '宋体', size: 11 };
      cell3_2.alignment = { horizontal: 'right' };
      worksheet.getRow(3).height = 22;

      // -- Row 4: Customer info
      worksheet.mergeCells(4, 1, 4, cols.length);
      const cell4 = worksheet.getCell(4, 1);
      cell4.value = `客户：${order.receiving_unit || ''}    款号：${order.style_no || ''}`;
      cell4.font = { name: '宋体', size: 11 };
      worksheet.getRow(4).height = 22;

      // -- Row 5: Header row
      const headerRow = worksheet.getRow(5);
      for (let c = 0; c < cols.length; c++) {
        const cell = headerRow.getCell(c + 1);
        cell.value = cols[c];
        cell.font = { name: '宋体', size: 10, bold: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E8E8' } };
        cell.border = {
          top: { style: 'thin' }, bottom: { style: 'thin' },
          left: { style: 'thin' }, right: { style: 'thin' },
        };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      }
      headerRow.height = 24;

      // Column widths
      const colWidths = isSample
        ? [6, 14, 12, 16, 18, 8, 10, 10, 10, 12, 16]
        : isDeposit
          ? [6, 14, 14, 14, 14, 14, 16]
          : [6, 14, 12, 16, 14, 10, 10, 10, 12, 16];
      for (let c = 0; c < colWidths.length; c++) {
        worksheet.getColumn(c + 1).width = colWidths[c];
      }

      // -- Data rows
      const thinBorder: Partial<ExcelJS.Borders> = {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' },
      };

      for (let r = 0; r < items.length; r++) {
        const item = items[r];
        const rowNum = 6 + r;
        const row = worksheet.getRow(rowNum);
        row.height = 22;

        const cells = isSample
          ? [
              r + 1,
              item.product_no || '', item.color_no || '', item.product_name || '',
              item.composition || '', item.weight || '', item.width || '',
              item.meters || 0, item.unit_price || 0, item.amount || 0, item.remark || '',
            ]
          : isDeposit
            ? [
                r + 1,
                item.product_no || '', item.color_no || '', item.product_name || '',
                item.meters || 0, item.unit_price || 0, item.amount || 0,
              ]
            : [
                r + 1,
                item.product_no || '', item.color_no || '', item.product_name || '',
                item.piece_meters ? (() => { try { const arr = typeof item.piece_meters === 'string' ? JSON.parse(item.piece_meters) : item.piece_meters; return Array.isArray(arr) ? arr.join(', ') : item.piece_meters; } catch { return item.piece_meters; } })() : '', item.width || '',
                item.meters || 0, item.unit_price || 0, item.amount || 0, item.remark || '',
              ];

        for (let c = 0; c < cells.length; c++) {
          const cell = row.getCell(c + 1);
          cell.value = cells[c];
          cell.font = { name: '宋体', size: 10 };
          cell.border = thinBorder;
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        }
      }

      const dataEndRow = 6 + items.length;

      // -- Totals row
      const totalRow = worksheet.getRow(dataEndRow);
      totalRow.height = 24;
      // For sample: cols 1-7 are labels (through 门幅), for sales: cols 1-6, for deposit: cols 1-4
      const totalMergeEnd = isSample ? 7 : (isDeposit ? 4 : 6);
      worksheet.mergeCells(dataEndRow, 1, dataEndRow, totalMergeEnd);
      const totalLabelCell = worksheet.getCell(dataEndRow, 1);
      totalLabelCell.value = '合计';
      totalLabelCell.font = { name: '宋体', size: 10, bold: true };
      totalLabelCell.alignment = { horizontal: 'center', vertical: 'middle' };
      totalLabelCell.border = thinBorder;

      for (let c = 2; c <= totalMergeEnd; c++) {
        const cell = worksheet.getCell(dataEndRow, c);
        cell.border = thinBorder;
      }

      const metersCol = totalMergeEnd + 1;
      const priceCol = totalMergeEnd + 2;
      const amountCol = totalMergeEnd + 3;
      const remarkCol = totalMergeEnd + 4;

      const metersCell = worksheet.getCell(dataEndRow, metersCol);
      metersCell.value = order.total_meters || 0;
      metersCell.font = { name: '宋体', size: 10, bold: true };
      metersCell.alignment = { horizontal: 'center', vertical: 'middle' };
      metersCell.border = thinBorder;

      const priceCell = worksheet.getCell(dataEndRow, priceCol);
      priceCell.border = thinBorder;

      const amountCell = worksheet.getCell(dataEndRow, amountCol);
      amountCell.value = order.total_amount || 0;
      amountCell.font = { name: '宋体', size: 10, bold: true };
      amountCell.alignment = { horizontal: 'center', vertical: 'middle' };
      amountCell.border = thinBorder;

      if (!isDeposit) {
        const remarkCell = worksheet.getCell(dataEndRow, remarkCol);
        remarkCell.border = thinBorder;
      }

      // -- Deposit amount row (deposit orders only)
      let footerOffset = 0;
      if (isDeposit) {
        footerOffset = 1;
        const depositRowNum = dataEndRow + 1;
        const depositRow = worksheet.getRow(depositRowNum);
        depositRow.height = 24;
        worksheet.mergeCells(depositRowNum, 1, depositRowNum, totalMergeEnd);
        const depositLabelCell = worksheet.getCell(depositRowNum, 1);
        const depositPct = parseFloat(order.deposit || 0);
        const depositAmount = (parseFloat(order.total_amount || 0) * depositPct) / 100;
        depositLabelCell.value = `定金比例：${depositPct}%  定金金额：¥${depositAmount.toFixed(2)}`;
        depositLabelCell.font = { name: '宋体', size: 10, bold: true };
        depositLabelCell.alignment = { horizontal: 'center', vertical: 'middle' };
        depositLabelCell.border = thinBorder;
        for (let c = 2; c <= totalMergeEnd; c++) {
          const cell = worksheet.getCell(depositRowNum, c);
          cell.border = thinBorder;
        }
        for (let c = totalMergeEnd + 1; c <= cols.length; c++) {
          const cell = worksheet.getCell(depositRowNum, c);
          cell.border = thinBorder;
        }
      }

      // -- Signature & footer section
      const footerStart = dataEndRow + 2 + footerOffset;
      worksheet.mergeCells(footerStart, 1, footerStart, halfCols);
      worksheet.getCell(footerStart, 1).value = `开单人：${order.sign_person || ''}`;
      worksheet.getCell(footerStart, 1).font = { name: '宋体', size: 11 };
      worksheet.getRow(footerStart).height = 22;

      worksheet.mergeCells(footerStart, halfCols + 1, footerStart, cols.length);
      const receiverCell = worksheet.getCell(footerStart, halfCols + 1);
      receiverCell.value = `收货人：${order.receiver || ''}`;
      receiverCell.font = { name: '宋体', size: 11 };
      receiverCell.alignment = { horizontal: 'right' };

      let termsRowOffset = 0;
      // -- Receiver address (deposit only)
      if (isDeposit) {
        termsRowOffset = 1;
        const addrRow = footerStart + 1;
        worksheet.mergeCells(addrRow, 1, addrRow, cols.length);
        worksheet.getCell(addrRow, 1).value = `收货地址：${order.receiver_address || ''}`;
        worksheet.getCell(addrRow, 1).font = { name: '宋体', size: 11 };
        worksheet.getRow(addrRow).height = 22;
      }

      // -- Terms
      const termsContent = isDeposit
        ? (company.deposit_terms || company.default_terms || '')
        : (company.default_terms || '');
      if (termsContent) {
        const termsRow = footerStart + 1 + termsRowOffset;
        worksheet.mergeCells(termsRow, 1, termsRow, cols.length);
        worksheet.getCell(termsRow, 1).value = `备注：${termsContent}`;
        worksheet.getCell(termsRow, 1).font = { name: '宋体', size: 9, color: { argb: 'FF666666' } };
        worksheet.getRow(termsRow).height = 20;
      }

      // -- Print settings
      worksheet.pageSetup.orientation = 'landscape';
      worksheet.pageSetup.fitToPage = true;
      worksheet.pageSetup.fitToWidth = 1;
      worksheet.pageSetup.paperSize = 9; // A4
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const base64 = Buffer.from(buffer).toString('base64');

    res.json({
      excel: base64,
      filename: `${order.order_no || '单据'}.xlsx`,
    });
  } catch (e: any) {
    console.error('[GET /api/export_template/:id]', e.message, e.stack);
    res.status(500).json({ error: e.message || '导出失败' });
  }
});

// ==================== Inventory API ====================

const InventoryEntrySchema = z.object({
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  product_name: z.string().max(255).optional().default(''),
  rolls: z.number().int().min(0).optional().default(0),
  meters: z.number().min(0).optional().default(0),
  remark: z.string().max(500).optional().default(''),
});

// GET /api/inventory/entries
app.get('/api/inventory/entries', async (req, res) => {
  try {
    if (!useMySQLFallback) {
      const pool = await getMySQLPool();
      const [rows] = await pool.query<RowDataPacket[]>(
        'SELECT * FROM inventory_entries ORDER BY entry_date DESC, created_at DESC'
      );
      return res.json(rows);
    }
    const local = loadLocalDB();
    res.json(local.inventory_entries || []);
  } catch (error: any) {
    const local = loadLocalDB();
    res.json(local.inventory_entries || []);
  }
});

// POST /api/inventory/entries (batch insert)
app.post('/api/inventory/entries', async (req, res) => {
  try {
    const parsed = z.array(InventoryEntrySchema).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid inventory entries', details: parsed.error.issues });
    }
    const entries = parsed.data;
    if (!useMySQLFallback) {
      const pool = await getMySQLPool();
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        for (const entry of entries) {
          await conn.query(
            `INSERT INTO inventory_entries (entry_date, product_name, rolls, meters, remark)
             VALUES (?, ?, ?, ?, ?)`,
            [entry.entry_date, entry.product_name, entry.rolls, entry.meters, entry.remark || '']
          );
        }
        await conn.commit();
        return res.json({ success: true, count: entries.length });
      } catch (txErr: any) {
        await conn.rollback();
        throw txErr;
      } finally {
        conn.release();
      }
    }
    const local = loadLocalDB();
    if (!local.inventory_entries) local.inventory_entries = [];
    let maxId = local.inventory_entries.length > 0
      ? Math.max(...local.inventory_entries.map((e: any) => e.id)) : 0;
    for (const entry of entries) {
      local.inventory_entries.push({
        id: ++maxId,
        entry_date: entry.entry_date,
        product_name: entry.product_name,
        rolls: entry.rolls,
        meters: entry.meters,
        remark: entry.remark || '',
        created_at: new Date().toISOString()
      });
    }
    saveLocalDB(local);
    res.json({ success: true, count: entries.length });
  } catch (error: any) {
    console.error('[POST /api/inventory/entries]', error.message);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/inventory/entries/:id
app.delete('/api/inventory/entries/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!useMySQLFallback) {
      const pool = await getMySQLPool();
      await pool.query('DELETE FROM inventory_entries WHERE id = ?', [id]);
      return res.json({ success: true });
    }
    const local = loadLocalDB();
    if (local.inventory_entries) {
      local.inventory_entries = local.inventory_entries.filter((e: any) => e.id !== id);
    }
    saveLocalDB(local);
    res.json({ success: true });
  } catch (error: any) {
    console.error('[DELETE /api/inventory/entries/:id]', error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/inventory/ledger — aggregated inventory report
app.get('/api/inventory/ledger', async (req, res) => {
  try {
    if (!useMySQLFallback) {
      const pool = await getMySQLPool();
      // Stock in: aggregate all inventory entries
      const [inRows] = await pool.query<RowDataPacket[]>(
        `SELECT ie.product_name, SUM(ie.rolls) as in_rolls, SUM(ie.meters) as in_meters,
                (SELECT ie2.remark FROM inventory_entries ie2
                 WHERE ie2.product_name = ie.product_name
                 ORDER BY ie2.created_at DESC LIMIT 1) as remark
         FROM inventory_entries ie GROUP BY ie.product_name`
      );
      // Stock out: aggregate sample + sales (gross meters for sales)
      const [outRows] = await pool.query<RowDataPacket[]>(
        `SELECT oi.product_name,
                SUM(CASE WHEN o.template_type = 'sample' THEN 1 ELSE 0 END) as out_rolls_sample,
                SUM(CASE WHEN o.template_type = 'bulk' THEN 1 ELSE 0 END) as out_rolls_sales,
                SUM(CASE WHEN o.template_type = 'sample' THEN oi.meters ELSE 0 END) as out_meters_sample,
                SUM(CASE WHEN o.template_type = 'bulk' THEN oi.meters ELSE 0 END) as out_meters_sales
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         WHERE o.template_type IN ('sample', 'bulk')
         GROUP BY oi.product_name`
      );
      // Merge in + out
      const inMap = new Map<string, { in_rolls: number; in_meters: number; remark: string }>();
      for (const r of inRows) {
        inMap.set(r.product_name, { in_rolls: Number(r.in_rolls), in_meters: Number(r.in_meters), remark: r.remark || '' });
      }
      const outMap = new Map<string, { out_rolls: number; out_meters: number }>();
      for (const r of outRows) {
        outMap.set(r.product_name, {
          out_rolls: Number(r.out_rolls_sample) + Number(r.out_rolls_sales),
          out_meters: Number(r.out_meters_sample) + Number(r.out_meters_sales),
        });
      }
      const allNames = new Set([...inMap.keys(), ...outMap.keys()]);
      const result: any[] = [];
      for (const name of allNames) {
        const inv = inMap.get(name) || { in_rolls: 0, in_meters: 0, remark: '' };
        const outv = outMap.get(name) || { out_rolls: 0, out_meters: 0 };
        result.push({
          product_name: name,
          total_in_rolls: inv.in_rolls,
          total_in_meters: inv.in_meters,
          total_out_rolls: outv.out_rolls,
          total_out_meters: outv.out_meters,
          remaining_rolls: inv.in_rolls - outv.out_rolls,
          remaining_meters: inv.in_meters - outv.out_meters,
          remark: inv.remark || '',
        });
      }
      result.sort((a, b) => b.total_in_meters - a.total_in_meters);
      return res.json(result);
    }
    // Fallback: compute from local JSON
    const local = loadLocalDB();
    const inMap = new Map<string, { rolls: number; meters: number; remark: string }>();
    for (const e of (local.inventory_entries || [])) {
      const cur = inMap.get(e.product_name) || { rolls: 0, meters: 0, remark: '' };
      cur.rolls += e.rolls || 0;
      cur.meters += Number(e.meters || 0);
      if (e.remark) cur.remark = e.remark; // latest remark wins
      inMap.set(e.product_name, cur);
    }
    const outMap = new Map<string, { rolls: number; meters: number }>();
    for (const o of (local.orders || [])) {
      if (o.template_type !== 'sample' && o.template_type !== 'bulk') continue;
      for (const item of (local.order_items || []).filter((i: any) => i.order_id === o.id)) {
        const cur = outMap.get(item.product_name) || { rolls: 0, meters: 0 };
        cur.rolls += 1;
        cur.meters += Number(item.meters || 0);
        outMap.set(item.product_name, cur);
      }
    }
    const allNames = new Set([...inMap.keys(), ...outMap.keys()]);
    const result: any[] = [];
    for (const name of allNames) {
      const inv = inMap.get(name) || { rolls: 0, meters: 0, remark: '' };
      const outv = outMap.get(name) || { rolls: 0, meters: 0 };
      result.push({
        product_name: name,
        total_in_rolls: inv.rolls,
        total_in_meters: inv.meters,
        total_out_rolls: outv.rolls,
        total_out_meters: outv.meters,
        remaining_rolls: inv.rolls - outv.rolls,
        remaining_meters: inv.meters - outv.meters,
      });
    }
    result.sort((a, b) => b.total_in_meters - a.total_in_meters);
    res.json(result);
  } catch (error: any) {
    console.error('[GET /api/inventory/ledger]', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ==================== Product Library API ====================

function toMySQLDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function generateThumbnail(buffer: Buffer): Promise<Buffer | null> {
  try {
    return await sharp(buffer)
      .resize(300, 300, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 60 })
      .toBuffer();
  } catch { return null; }
}

// ── List Products ──────────────────────────────────────
app.get('/api/products', async (req, res) => {
  try {
    if (!useMySQLFallback) {
      const pool = await getMySQLPool();
      const [productRows] = await pool.query<RowDataPacket[]>('SELECT * FROM products ORDER BY updated_at DESC');
      const [imageRows] = await pool.query<RowDataPacket[]>('SELECT id, product_id, sort_order FROM product_images ORDER BY sort_order');
      const imageMap = new Map<number, any[]>();
      for (const row of imageRows) {
        if (!imageMap.has(row.product_id)) imageMap.set(row.product_id, []);
        imageMap.get(row.product_id)!.push({ id: row.id, sort_order: row.sort_order });
      }
      const products = productRows.map((p: any) => ({
        ...p,
        images: imageMap.get(p.id) || [],
        image_count: (imageMap.get(p.id) || []).length,
      }));
      return res.json(products);
    }
    const local = loadLocalDB();
    const imageMap = new Map<number, any[]>();
    for (const img of local.product_images) {
      if (!imageMap.has(img.product_id)) imageMap.set(img.product_id, []);
      imageMap.get(img.product_id)!.push({ id: img.id, sort_order: img.sort_order });
    }
    const products = local.products.map((p: any) => ({
      ...p,
      images: imageMap.get(p.id) || [],
      image_count: (imageMap.get(p.id) || []).length,
    }));
    products.sort((a: any, b: any) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime());
    res.json(products);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── Get Single Product ─────────────────────────────────
app.get('/api/products/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    if (!useMySQLFallback) {
      const pool = await getMySQLPool();
      const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM products WHERE id = ?', [id]);
      if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
      const [imgs] = await pool.query<RowDataPacket[]>('SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order', [id]);
      return res.json({ ...rows[0], images: imgs });
    }
    const local = loadLocalDB();
    const product = local.products.find((p: any) => p.id == id);
    if (!product) return res.status(404).json({ error: 'Not found' });
    const images = local.product_images.filter((i: any) => i.product_id == id).sort((a: any, b: any) => a.sort_order - b.sort_order);
    res.json({ ...product, images });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── Get Product Image ──────────────────────────────────
app.get('/api/products/:productId/images/:imageId', async (req, res) => {
  const productId = parseInt(req.params.productId);
  const imageId = parseInt(req.params.imageId);
  if (!Number.isInteger(productId) || productId <= 0 || !Number.isInteger(imageId) || imageId <= 0) {
    return res.status(400).json({ error: 'Invalid product or image id' });
  }
  try {
    if (!useMySQLFallback) {
      const pool = await getMySQLPool();
      const [rows] = await pool.query<RowDataPacket[]>(
        'SELECT * FROM product_images WHERE id = ? AND product_id = ?',
        [imageId, productId]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
      const img = rows[0];
      // Read image file from cos_key or local_path
      if (img.cos_key) {
        const cos = getCOSClient();
        const cfg = getCOSConfig();
        if (cos && cfg) {
          const data = await cos.getObject({ Bucket: cfg.bucket, Region: cfg.region, Key: img.cos_key });
          res.set('Content-Type', 'image/jpeg');
          return res.send(data.Body);
        }
      }
      const localImagePath = resolveUploadFile(img.local_path);
      if (localImagePath) {
        return res.sendFile(localImagePath);
      }
      return res.status(404).json({ error: 'Image file not found' });
    }
    const local = loadLocalDB();
    const img = local.product_images.find((i: any) => i.id == imageId && i.product_id == productId);
    if (!img) return res.status(404).json({ error: 'Not found' });
    const localImagePath = resolveUploadFile(img.local_path);
    if (localImagePath) {
      return res.sendFile(localImagePath);
    }
    res.status(404).json({ error: 'Image file not found' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── Create Product ─────────────────────────────────────
app.post('/api/products', upload.any(), validateRasterUploads, async (req, res) => {
  const files = getRequestFiles(req);
  const retainedPaths = new Set<string>();
  try {
    const { itemNo, productName, composition, weight, width } = req.body;
    console.log('[POST /api/products] itemNo:', itemNo, 'productName:', productName);
    if (!itemNo || !productName) return res.status(400).json({ error: 'itemNo and productName are required' });

    const now = toMySQLDateTime(new Date().toISOString());
    if (!useMySQLFallback) {
      const pool = await getMySQLPool();
      const [result] = await pool.query<ResultSetHeader>(
        'INSERT INTO products (item_no, product_name, composition, weight, width, image_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [itemNo, productName, composition || '', weight || '', width || '', files.length, now, now]
      );
      const productId = result.insertId;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const cosKey = await uploadToCOS(file);
        // Generate and upload thumbnail
        const imgBuf = fs.readFileSync(file.path);
        const thumbBuf = await generateThumbnail(imgBuf);
        const thumbKey = (cosKey && thumbBuf) ? await uploadBufferToCOS(thumbBuf, `product_thumb_${Date.now()}_${i}.jpg`) : '';
        // Also save locally for fallback
        let localPath = '';
        let thumbLocalPath = '';
        if (!cosKey) {
          const fname = `product_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.jpg`;
          localPath = path.join(UPLOADS_DIR, 'products', fname);
          fs.mkdirSync(path.dirname(localPath), { recursive: true });
          fs.writeFileSync(localPath, imgBuf);
          if (thumbBuf) {
            thumbLocalPath = path.join(UPLOADS_DIR, 'products', `thumb_${fname}`);
            fs.writeFileSync(thumbLocalPath, thumbBuf);
          }
        }
        await pool.query(
          'INSERT INTO product_images (product_id, sort_order, cos_key, thumbnail_cos_key, local_path, thumbnail_local_path) VALUES (?, ?, ?, ?, ?, ?)',
          [productId, i, cosKey || '', thumbKey || '', localPath, thumbLocalPath]
        );
      }
      return res.json({ id: productId, success: true });
    }

    const local = loadLocalDB();
    const newId = local.products.length > 0 ? Math.max(...local.products.map((p: any) => p.id)) + 1 : 1;
    local.products.push({
      id: newId, item_no: itemNo, product_name: productName,
      composition: composition || '', weight: weight || '', width: width || '',
      image_count: files.length, created_at: now, updated_at: now
    });

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const cosKey = await uploadToCOS(file);
      const imgId = local.product_images.length > 0 ? Math.max(...local.product_images.map((x: any) => x.id)) + 1 : 1;
      local.product_images.push({
        id: imgId, product_id: newId, sort_order: i,
        cos_key: cosKey || '', local_path: cosKey ? '' : file.path,
        thumbnail_cos_key: '', thumbnail_local_path: ''
      });
    }
    saveLocalDB(local);
    for (const file of files) {
      const image = local.product_images.find((item: any) => item.product_id == newId && item.local_path === file.path);
      if (image) retainedPaths.add(file.path);
    }
    res.json({ id: newId, success: true });
  } catch (e: any) {
    console.error('[POST /api/products]', e.message);
    res.status(500).json({ error: e.message });
  } finally {
    await cleanupUploadedFiles(files, retainedPaths);
  }
});

// ── Update Product ─────────────────────────────────────
app.put('/api/products/:id', upload.any(), validateRasterUploads, async (req, res) => {
  const productId = parseInt(req.params.id);
  const files = getRequestFiles(req);
  const retainedPaths = new Set<string>();
  try {
    const { itemNo, productName, composition, weight, width } = req.body;

    if (!useMySQLFallback) {
      const pool = await getMySQLPool();
      await pool.query(
        'UPDATE products SET item_no=?, product_name=?, composition=?, weight=?, width=?, updated_at=? WHERE id=?',
        [itemNo, productName, composition || '', weight || '', width || '', toMySQLDateTime(new Date().toISOString()), productId]
      );

      // Get current max sort_order
      const [orderRows] = await pool.query<RowDataPacket[]>('SELECT COALESCE(MAX(sort_order), -1) as maxOrd FROM product_images WHERE product_id = ?', [productId]);
      let order = (orderRows[0].maxOrd || 0) + 1;

      for (const file of files) {
        const cosKey = await uploadToCOS(file);
        const imgBuf = fs.readFileSync(file.path);
        await pool.query(
          'INSERT INTO product_images (product_id, sort_order, cos_key, local_path) VALUES (?, ?, ?, ?)',
          [productId, order++, cosKey || '', cosKey ? '' : file.path]
        );
        if (!cosKey) retainedPaths.add(file.path);
      }

      // Update image_count
      const [countRows] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) as cnt FROM product_images WHERE product_id = ?', [productId]);
      await pool.query('UPDATE products SET image_count = ? WHERE id = ?', [countRows[0].cnt, productId]);
      return res.json({ success: true });
    }

    const local = loadLocalDB();
    const idx = local.products.findIndex((p: any) => p.id == productId);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });

    local.products[idx] = {
      ...local.products[idx], item_no: itemNo, product_name: productName,
      composition: composition || '', weight: weight || '', width: width || '',
      updated_at: new Date().toISOString()
    };

    const existingImages = local.product_images.filter((i: any) => i.product_id == productId);
    let order = existingImages.length > 0 ? Math.max(...existingImages.map((i: any) => i.sort_order)) + 1 : 0;

    for (const file of files) {
      const cosKey = await uploadToCOS(file);
      const imgId = local.product_images.length > 0 ? Math.max(...local.product_images.map((x: any) => x.id)) + 1 : 1;
      local.product_images.push({
        id: imgId, product_id: productId, sort_order: order++,
        cos_key: cosKey || '', local_path: cosKey ? '' : file.path,
        thumbnail_cos_key: '', thumbnail_local_path: ''
      });
    }
    local.products[idx].image_count = local.product_images.filter((i: any) => i.product_id == productId).length;
    saveLocalDB(local);
    for (const file of files) {
      const image = local.product_images.find((item: any) => item.product_id == productId && item.local_path === file.path);
      if (image) retainedPaths.add(file.path);
    }
    res.json({ success: true });
  } catch (e: any) {
    console.error('[PUT /api/products]', e.message);
    res.status(500).json({ error: e.message });
  } finally {
    await cleanupUploadedFiles(files, retainedPaths);
  }
});

// ── Get Product Thumbnails (batch) ─────────────────────
app.get('/api/products/:id/thumbnails', async (req, res) => {
  const productId = parseInt(req.params.id);
  const useFull = req.query.full === '1';
  try {
    let images: any[] = [];
    if (!useMySQLFallback) {
      const pool = await getMySQLPool();
      const [rows] = await pool.query<RowDataPacket[]>(
        'SELECT id, sort_order, cos_key, thumbnail_cos_key, local_path, thumbnail_local_path FROM product_images WHERE product_id = ? ORDER BY sort_order', [productId]
      );
      images = rows;
    } else {
      const local = loadLocalDB();
      images = local.product_images.filter((i: any) => i.product_id == productId).sort((a: any, b: any) => a.sort_order - b.sort_order);
    }
    const result: { id: number; sort_order: number; base64: string }[] = [];
    for (const img of images) {
      let buffer: Buffer | null = null;
      if (useFull) {
        // Requesting full image: skip thumbnails
        if (img.cos_key) {
          try { const cos = getCOSClient(); const cfg = getCOSConfig(); if (cos && cfg) { const data = await cos.getObject({ Bucket: cfg.bucket, Region: cfg.region, Key: img.cos_key }); buffer = Buffer.isBuffer(data.Body) ? data.Body : Buffer.from(data.Body as any); } } catch { }
        }
        if (!buffer && img.local_path && fs.existsSync(img.local_path)) {
          try { buffer = fs.readFileSync(img.local_path); } catch { }
        }
      } else {
        // Prefer thumbnail (smaller), fall back to full image
      if (img.thumbnail_cos_key) {
        try {
          const cos = getCOSClient(); const cfg = getCOSConfig();
          if (cos && cfg) { const data = await cos.getObject({ Bucket: cfg.bucket, Region: cfg.region, Key: img.thumbnail_cos_key }); buffer = Buffer.isBuffer(data.Body) ? data.Body : Buffer.from(data.Body as any); }
        } catch { }
      }
      if (!buffer && img.thumbnail_local_path && fs.existsSync(img.thumbnail_local_path)) {
        try { buffer = fs.readFileSync(img.thumbnail_local_path); } catch { }
      }
      if (!buffer && img.cos_key) {
        try {
          const cos = getCOSClient(); const cfg = getCOSConfig();
          if (cos && cfg) { const data = await cos.getObject({ Bucket: cfg.bucket, Region: cfg.region, Key: img.cos_key }); buffer = Buffer.isBuffer(data.Body) ? data.Body : Buffer.from(data.Body as any); }
        } catch { }
      }
      if (!buffer && img.local_path && fs.existsSync(img.local_path)) {
        try { buffer = fs.readFileSync(img.local_path); } catch { }
      }
    }
    if (buffer) result.push({ id: img.id, sort_order: img.sort_order, base64: buffer.toString('base64') });
    }
    res.json({ images: result });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Batch Delete Products ───────────────────────────────
app.post('/api/products/batch-delete', async (req, res) => {
  const { ids, itemNos } = req.body;
  let deleted = 0;
  try {
    if (!useMySQLFallback) {
      const pool = await getMySQLPool();
      if (ids && ids.length > 0) {
        const numIds = ids.map((id: string) => parseInt(id)).filter((n: number) => !isNaN(n));
        if (numIds.length > 0) {
          const placeholders = numIds.map(() => '?').join(',');
          const [imgs] = await pool.query<RowDataPacket[]>(
            `SELECT cos_key, thumbnail_cos_key, local_path, thumbnail_local_path FROM product_images WHERE product_id IN (${placeholders})`, numIds);
          for (const img of imgs) {
            try { if (img.cos_key) await deleteFromCOS(img.cos_key); } catch { }
            try { if (img.thumbnail_cos_key) await deleteFromCOS(img.thumbnail_cos_key); } catch { }
            try { if (img.local_path && fs.existsSync(img.local_path)) fs.unlinkSync(img.local_path); } catch { }
            try { if (img.thumbnail_local_path && fs.existsSync(img.thumbnail_local_path)) fs.unlinkSync(img.thumbnail_local_path); } catch { }
          }
          await pool.query(`DELETE FROM product_images WHERE product_id IN (${placeholders})`, numIds);
          const [result] = await pool.query<ResultSetHeader>(
            `DELETE FROM products WHERE id IN (${placeholders})`, numIds);
          deleted = result.affectedRows;
        }
      } else if (itemNos && itemNos.length > 0) {
        const placeholders = itemNos.map(() => '?').join(',');
        // Clean up COS/local image files
        const [imgs] = await pool.query<RowDataPacket[]>(
          `SELECT pi.cos_key, pi.thumbnail_cos_key, pi.local_path, pi.thumbnail_local_path
           FROM product_images pi JOIN products p ON pi.product_id = p.id
           WHERE p.item_no IN (${placeholders})`, itemNos);
        for (const img of imgs) {
          try { if (img.cos_key) await deleteFromCOS(img.cos_key); } catch { }
          try { if (img.local_path && fs.existsSync(img.local_path)) fs.unlinkSync(img.local_path); } catch { }
        }
        // Explicitly delete images first (in case CASCADE didn't exist at table creation)
        await pool.query(
          `DELETE pi FROM product_images pi JOIN products p ON pi.product_id = p.id WHERE p.item_no IN (${placeholders})`, itemNos);
        const [result] = await pool.query<ResultSetHeader>(
          `DELETE FROM products WHERE item_no IN (${placeholders})`, itemNos);
        deleted = result.affectedRows;
      }
      return res.json({ success: true, deleted });
    }
    const local = loadLocalDB();
    const toDelete = new Set<string>();
    if (ids && ids.length > 0) {
      for (const id of ids) toDelete.add(String(id));
    } else if (itemNos && itemNos.length > 0) {
      for (const p of local.products) {
        if (itemNos.includes(p.item_no)) toDelete.add(String(p.id));
      }
    }
    for (const pid of toDelete) {
      const imgs = local.product_images.filter((i: any) => i.product_id == pid);
      for (const img of imgs) {
        if (img.local_path && fs.existsSync(img.local_path)) fs.unlinkSync(img.local_path);
      }
    }
    local.products = local.products.filter((p: any) => !toDelete.has(String(p.id)));
    local.product_images = local.product_images.filter((i: any) => !toDelete.has(String(i.product_id)));
    deleted = toDelete.size;
    saveLocalDB(local);
    res.json({ success: true, deleted });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
app.delete('/api/products/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    if (!useMySQLFallback) {
      const pool = await getMySQLPool();
      // Get image keys for cleanup
      const [imgs] = await pool.query<RowDataPacket[]>('SELECT cos_key, thumbnail_cos_key, local_path, thumbnail_local_path FROM product_images WHERE product_id = ?', [id]);
      for (const img of imgs) {
        if (img.cos_key) await deleteFromCOS(img.cos_key);
        if (img.thumbnail_cos_key) await deleteFromCOS(img.thumbnail_cos_key);
        if (img.local_path && fs.existsSync(img.local_path)) fs.unlinkSync(img.local_path);
        if (img.thumbnail_local_path && fs.existsSync(img.thumbnail_local_path)) fs.unlinkSync(img.thumbnail_local_path);
      }
      // Explicitly delete images first
      await pool.query('DELETE FROM product_images WHERE product_id = ?', [id]);
      await pool.query('DELETE FROM products WHERE id = ?', [id]);
      return res.json({ success: true });
    }
    const local = loadLocalDB();
    const imgs = local.product_images.filter((i: any) => i.product_id == id);
    for (const img of imgs) {
      if (img.local_path && fs.existsSync(img.local_path)) fs.unlinkSync(img.local_path);
    }
    local.products = local.products.filter((p: any) => p.id != id);
    local.product_images = local.product_images.filter((i: any) => i.product_id != id);
    saveLocalDB(local);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── Delete Single Image ────────────────────────────────
app.delete('/api/products/:productId/images/:imageId', async (req, res) => {
  const imageId = parseInt(req.params.imageId);
  try {
    if (!useMySQLFallback) {
      const pool = await getMySQLPool();
      const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM product_images WHERE id = ?', [imageId]);
      if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
      const img = rows[0];
      if (img.cos_key) await deleteFromCOS(img.cos_key);
      if (img.thumbnail_cos_key) await deleteFromCOS(img.thumbnail_cos_key);
      if (img.local_path && fs.existsSync(img.local_path)) fs.unlinkSync(img.local_path);
      await pool.query('DELETE FROM product_images WHERE id = ?', [imageId]);
      const [cnt] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) as c FROM product_images WHERE product_id = ?', [img.product_id]);
      await pool.query('UPDATE products SET image_count = ? WHERE id = ?', [cnt[0].c, img.product_id]);
      return res.json({ success: true });
    }
    const local = loadLocalDB();
    const img = local.product_images.find((i: any) => i.id == imageId);
    if (!img) return res.status(404).json({ error: 'Not found' });
    if (img.local_path && fs.existsSync(img.local_path)) fs.unlinkSync(img.local_path);
    local.product_images = local.product_images.filter((i: any) => i.id != imageId);
    const p = local.products.find((p: any) => p.id == img.product_id);
    if (p) p.image_count = local.product_images.filter((i: any) => i.product_id == p.id).length;
    saveLocalDB(local);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── Excel Export (with images) ─────────────────────────
app.post('/api/products/export', async (req, res) => {
  const { ids, itemNos } = req.body;
  try {
    let products: any[] = [];
    if (!useMySQLFallback) {
      const pool = await getMySQLPool();
      if (itemNos && itemNos.length > 0) {
        const placeholders = itemNos.map(() => '?').join(',');
        const [rows] = await pool.query<RowDataPacket[]>(
          `SELECT * FROM products WHERE item_no IN (${placeholders}) ORDER BY updated_at DESC`, itemNos);
        products = rows;
      } else if (ids && ids.length > 0) {
        // Try numeric IDs first, then string IDs
        const numIds = ids.map((id: string) => parseInt(id)).filter((n: number) => !isNaN(n));
        if (numIds.length > 0) {
          const placeholders = numIds.map(() => '?').join(',');
          const [rows] = await pool.query<RowDataPacket[]>(
            `SELECT * FROM products WHERE id IN (${placeholders})`, numIds);
          products = rows;
        }
      } else {
        const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM products ORDER BY updated_at DESC');
        products = rows;
      }
    } else {
      const local = loadLocalDB();
      if (itemNos && itemNos.length > 0) {
        products = local.products.filter((p: any) => itemNos.includes(p.item_no));
      } else if (ids && ids.length > 0) {
        products = local.products.filter((p: any) => ids.includes(String(p.id)));
      } else {
        products = local.products;
      }
      products.sort((a: any, b: any) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime());
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('产品库');
    worksheet.columns = [
      { header: '货号', key: 'itemNo', width: 16 },
      { header: '品名', key: 'productName', width: 24 },
      { header: '成分', key: 'composition', width: 20 },
      { header: '克重', key: 'weight', width: 12 },
      { header: '门幅', key: 'width', width: 10 },
      { header: '花型', key: 'pattern', width: 30 },
    ];

    // Style header row
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };

    // Get images for each product
    for (let r = 0; r < products.length; r++) {
      const p = products[r];
      const rowNum = r + 2;
      const row = worksheet.getRow(rowNum);
      row.getCell(1).value = p.item_no || p.itemNo || '';
      row.getCell(2).value = p.product_name || p.productName || '';
      row.getCell(3).value = p.composition || '';
      row.getCell(4).value = p.weight || '';
      row.getCell(5).value = p.width || '';

      let images: any[] = [];
      try {
        if (!useMySQLFallback) {
          const pool = await getMySQLPool();
          const [imgs] = await pool.query<RowDataPacket[]>('SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order', [p.id]);
          images = imgs;
        } else {
          const local = loadLocalDB();
          images = local.product_images.filter((i: any) => i.product_id == p.id).sort((a: any, b: any) => a.sort_order - b.sort_order);
        }
      } catch { /* skip images on error */ }

      const rowHeight = 80;
      row.height = rowHeight;
      let xOffset = 0;
      const imgGap = 8;

      for (const img of images) {
        let buffer: Buffer | null = null;
        try {
          if (img.cos_key) {
            const cos = getCOSClient();
            const cfg = getCOSConfig();
            if (cos && cfg) {
              const data = await cos.getObject({ Bucket: cfg.bucket, Region: cfg.region, Key: img.cos_key });
              buffer = Buffer.isBuffer(data.Body) ? data.Body : Buffer.from(data.Body as any);
            }
          } else if (img.local_path && fs.existsSync(img.local_path)) {
            buffer = fs.readFileSync(img.local_path);
          }
        } catch { buffer = null; }

        if (buffer && buffer.length > 0) {
          try {
            const imageId = workbook.addImage({ buffer, extension: 'jpeg' });
            // Use nativeCol/nativeColOff directly (colOff is silently ignored by Anchor)
            worksheet.addImage(imageId, {
              tl: { col: 5, nativeRow: rowNum - 1, nativeColOff: Math.round(xOffset * 9525), nativeRowOff: 0 } as any,
              ext: { width: 72, height: 72 },
            });
            xOffset += 72 + imgGap;
          } catch { /* skip broken images */ }
        }
      }
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${encodeURIComponent('产品库_' + new Date().toISOString().slice(0, 10))}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (e: any) {
    console.error('[POST /api/products/export]', e.message, e.stack);
    res.status(500).json({ error: e.message || 'Export error' });
  }
});

// ── Excel Import (with images) ─────────────────────────
app.post('/api/products/import', upload.single('file'), async (req, res, next) => {
  const files = getRequestFiles(req);
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const workbook = await readUploadedWorkbook(req.file);
    const worksheet = workbook.worksheets[0];

    // Extract images from worksheet
    const imageMap = new Map<number, { buffer: Buffer; col: number }[]>();
    if ((worksheet as any).getImages) {
      const wsImages = (worksheet as any).getImages();
      for (const img of wsImages) {
        const nativeRow = img.range?.tl?.nativeRow;
        const row = img.range?.tl?.row;
        const rowIdx = nativeRow ?? row ?? 0;
        const colIdx = img.range?.tl?.nativeCol ?? img.range?.tl?.col ?? 0;
        const mediaIdx = img.imageId;
        if (workbook.model.media && workbook.model.media[mediaIdx]) {
          const media = workbook.model.media[mediaIdx];
          const buf = Buffer.isBuffer(media.buffer) ? media.buffer : Buffer.from((media.buffer || '') as string);
          if (!imageMap.has(rowIdx)) imageMap.set(rowIdx, []);
          imageMap.get(rowIdx)!.push({ buffer: buf, col: colIdx });
        }
      }
    }

    const now = toMySQLDateTime(new Date().toISOString());
    let importedCount = 0;
    const warnings: string[] = [];

    if (!useMySQLFallback) {
      const pool = await getMySQLPool();
      // Collect rows first, then process sequentially to preserve image-to-product mapping
      const rows: { itemNo: string; productName: string; composition: string; weight: string; width: string; rowImgs: any[] }[] = [];
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const itemNo = String(row.getCell(1).value || '').trim();
        const productName = String(row.getCell(2).value || '').trim();
        const composition = String(row.getCell(3).value || '').trim();
        const weight = String(row.getCell(4).value || '').trim();
        const width = String(row.getCell(5).value || '').trim();
        const rowImgs = imageMap.get(rowNumber - 1) || [];

        const hasData = itemNo || productName || rowImgs.length > 0;
        if (!hasData) return;

        if (!itemNo) {
          warnings.push(`第${rowNumber}行缺少货号，已导入但请补充`);
        }
        rows.push({ itemNo: itemNo || '(缺货号)', productName: productName || '', composition, weight, width, rowImgs });
      });

      // Process rows sequentially to ensure correct image-to-product association
      for (const row of rows) {
        try {
          const [result] = await pool.query<ResultSetHeader>(
            'INSERT INTO products (item_no, product_name, composition, weight, width, image_count, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
            [row.itemNo, row.productName, row.composition, row.weight, row.width, row.rowImgs.length, now, now]
          );
          const productId = result.insertId;

          // Upload images to COS in parallel within the same row
          const uploadResults = await Promise.all(
            row.rowImgs.map(async (img: any, i: number) => {
              const cosKey = await uploadBufferToCOS(img.buffer, `product_import_${Date.now()}_${i}.jpg`);
              // Generate and upload thumbnail
              const thumbBuf = await generateThumbnail(img.buffer);
              const thumbKey = thumbBuf ? await uploadBufferToCOS(thumbBuf, `product_import_thumb_${Date.now()}_${i}.jpg`) : '';
              let localPath = '';
              let thumbLocalPath = '';
              if (!cosKey) {
                const fname = `import_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.jpg`;
                localPath = path.join(UPLOADS_DIR, 'products', fname);
                fs.mkdirSync(path.dirname(localPath), { recursive: true });
                fs.writeFileSync(localPath, img.buffer);
                if (thumbBuf) {
                  thumbLocalPath = path.join(UPLOADS_DIR, 'products', `thumb_${fname}`);
                  fs.writeFileSync(thumbLocalPath, thumbBuf);
                }
              }
              return { i, cosKey: cosKey || '', localPath, thumbKey: thumbKey || '', thumbLocalPath };
            })
          );
          // Insert image records sequentially (correct sort_order)
          for (const r of uploadResults) {
            await pool.query(
              'INSERT INTO product_images (product_id, sort_order, cos_key, thumbnail_cos_key, local_path, thumbnail_local_path) VALUES (?,?,?,?,?,?)',
              [productId, r.i, r.cosKey, r.thumbKey, r.localPath, r.thumbLocalPath]
            );
          }
          importedCount++;
        } catch (e: any) {
          console.error('[Import row error]', e.message);
        }
      }
    } else {
      const local = loadLocalDB();
      let maxProdId = local.products.length > 0 ? Math.max(...local.products.map((p: any) => p.id)) : 0;
      let maxImgId = local.product_images.length > 0 ? Math.max(...local.product_images.map((i: any) => i.id)) : 0;

      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const itemNo = String(row.getCell(1).value || '').trim();
        const productName = String(row.getCell(2).value || '').trim();
        const rowImgs = imageMap.get(rowNumber - 1) || [];
        const hasData = itemNo || productName || rowImgs.length > 0;
        if (!hasData) return;

        if (!itemNo) {
          warnings.push(`第${rowNumber}行缺少货号，已导入但请补充`);
        }

        maxProdId++;
        local.products.push({
          id: maxProdId, item_no: itemNo || '(缺货号)', product_name: productName,
          composition: String(row.getCell(3).value || '').trim(),
          weight: String(row.getCell(4).value || '').trim(),
          width: String(row.getCell(5).value || '').trim(),
          image_count: rowImgs.length, created_at: now, updated_at: now
        });

        for (let i = 0; i < rowImgs.length; i++) {
          maxImgId++;
          const localPath = path.join(UPLOADS_DIR, 'products', `${maxImgId}.jpg`);
          fs.mkdirSync(path.dirname(localPath), { recursive: true });
          fs.writeFileSync(localPath, rowImgs[i].buffer);
          local.product_images.push({
            id: maxImgId, product_id: maxProdId, sort_order: i,
            cos_key: '', local_path: localPath,
            thumbnail_cos_key: '', thumbnail_local_path: ''
          });
        }
        importedCount++;
      });
      saveLocalDB(local);
    }

    await cleanupUploadedFiles(files);
    res.json({ success: true, count: importedCount, warnings });
  } catch (e: any) {
    console.error('[POST /api/products/import]', e.message);
    await cleanupUploadedFiles(files);
    next(e);
  }
});


// ── COS Upload Helpers ─────────────────────────────────
async function uploadToCOS(file: Express.Multer.File): Promise<string | null> {
  const cos = getCOSClient();
  const cfg = getCOSConfig();
  if (!cos || !cfg) return null;

  const key = `products/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${file.originalname}`;
  try {
    await cos.putObject({
      Bucket: cfg.bucket,
      Region: cfg.region,
      Key: key,
      Body: fs.createReadStream(file.path),
      ContentLength: file.size,
    });
    return key;
  } catch (e: any) {
    console.error('[COS Upload]', e.message);
    return null;
  }
}

async function uploadBufferToCOS(buffer: Buffer, filename: string): Promise<string | null> {
  const cos = getCOSClient();
  const cfg = getCOSConfig();
  if (!cos || !cfg) return null;

  const key = `products/${Date.now()}_${filename}`;
  try {
    await cos.putObject({
      Bucket: cfg.bucket,
      Region: cfg.region,
      Key: key,
      Body: buffer,
    });
    return key;
  } catch (e: any) {
    console.error('[COS Upload]', e.message);
    return null;
  }
}

async function deleteFromCOS(key: string): Promise<void> {
  if (!key) return;
  const cos = getCOSClient();
  const cfg = getCOSConfig();
  if (!cos || !cfg) return;
  try {
    await cos.deleteObject({ Bucket: cfg.bucket, Region: cfg.region, Key: key });
  } catch (e: any) {
    console.error('[COS Delete]', e.message);
  }
}

app.use(async (error: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) return next(error);
  await cleanupUploadedFiles(getRequestFiles(req));
  if (error instanceof multer.MulterError) {
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({ error: error.message });
  }
  if (error instanceof z.ZodError) {
    return res.status(400).json({ error: 'Invalid request data', details: error.issues });
  }
  if (error instanceof UploadValidationError) {
    return res.status(415).json({ error: error.message });
  }
  if (error instanceof Error && /Only .* allowed/.test(error.message)) {
    return res.status(415).json({ error: error.message });
  }
  console.error('[Unhandled API Error]', error);
  res.status(500).json({ error: 'Internal server error' });
});

// ==================== Vite Dev Server (for development) ====================
async function startServer() {
  // Initialize MySQL before accepting connections (avoid race condition)
  try {
    await getMySQLPool();
    console.log('[Database] MySQL initialized successfully.');
  } catch {
    console.log('[Database] Running in JSON local file fallback mode.');
  }

  const isDev = process.env.NODE_ENV !== 'production';

  if (isDev) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    // Production: serve static files from dist, prevent HTML caching
    app.use(express.static(path.join(process.cwd(), 'dist'), {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
      }
    }));
  }

  const server = app.listen(PORT, HOST, () => {
    console.log(`[Server] Running on http://${HOST}:${PORT}`);
    console.log(`[Mode] ${isDev ? 'Development' : 'Production'}`);
    console.log(`[Database] ${useMySQLFallback ? 'JSON Fallback' : 'MySQL'}`);
    console.log(`[COS] ${getCOSConfig() ? 'Enabled' : 'Disabled (local storage)'}`);
  });

  registerShutdownHandlers(server);
}

function registerShutdownHandlers(server: Server) {
  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[Server] ${signal} received, shutting down gracefully...`);

    const forceExitTimer = setTimeout(() => {
      console.error('[Server] Graceful shutdown timed out.');
      process.exit(1);
    }, 10_000);
    forceExitTimer.unref();

    server.close(async (error) => {
      try {
        if (mysqlPool) await mysqlPool.end();
      } catch (dbError) {
        console.error('[Database] Failed to close MySQL pool:', dbError);
      }
      clearTimeout(forceExitTimer);
      process.exit(error ? 1 : 0);
    });
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

startServer().catch((error) => {
  console.error('[Server] Startup failed:', error);
  process.exitCode = 1;
});
