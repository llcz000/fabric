import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import dns from 'dns';
import { isIP } from 'net';
import dotenv from 'dotenv';
import mysql, { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import COS from 'cos-nodejs-sdk-v5';
import ExcelJS from 'exceljs';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { createServer as createViteServer } from 'vite';

// Load environment variables
dotenv.config();

const app = express();
const PORT = 3000;

// Ensure local storage directories exist
const TEMPLATE_DIR = path.join(process.cwd(), 'template');
const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
const TEMPLATE_CONFIG_FILE = path.join(process.cwd(), 'template_config.json');
const DATABASE_FALLBACK_FILE = path.join(process.cwd(), 'database_fallback.json');

fs.mkdirSync(TEMPLATE_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Setup middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(UPLOADS_DIR));

// Rate limiting: 100 requests per 15 minutes per IP
// Trust proxy for rate limiting behind nginx/reverse proxy
app.set('trust proxy', 1);

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/api/', apiLimiter);

// ==================== Simple Token Authentication ====================
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const authTokens = new Set<string>();

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  // Whitelist: login and proxy-image don't require auth
  if (req.path === '/login' || req.path === '/proxy-image') return next();
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || !authTokens.has(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

app.use('/api', authMiddleware);

app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  const token = generateToken();
  authTokens.add(token);
  res.json({ token });
});

app.post('/api/logout', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) authTokens.delete(token);
  res.json({ success: true });
});

// Image proxy endpoint to solve CORS issues for html-to-image on COS/remote images
app.get('/api/proxy-image', async (req, res) => {
  try {
    const url = req.query.url as string;
    if (!url) return res.status(400).send('Missing url parameter');
    if (!/^https?:\/\//i.test(url)) return res.status(400).send('Invalid url');

    // SSRF protection: reject internal/private IPs
    try {
      const urlObj = new URL(url);
      const addresses = await dns.promises.resolve4(urlObj.hostname);
      for (const addr of addresses) {
        if (addr.startsWith('127.') || addr.startsWith('10.')
            || addr.startsWith('172.16.') || addr.startsWith('192.168.')
            || addr === '169.254.169.254' || addr === '0.0.0.0') {
          return res.status(403).send('Internal IPs not allowed');
        }
      }
    } catch {
      // DNS resolution failed, allow the external fetch to handle the error
    }

    const imageRes = await fetch(url);
    if (!imageRes.ok) return res.status(404).send('Image not found');

    const contentType = imageRes.headers.get('content-type') || 'image/png';
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=3600');

    const buffer = await imageRes.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (e) {
    res.status(500).send('Proxy error');
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
    // Preserve original name for templates, or use timestamp for uploads
    if (file.fieldname === 'template_file' || file.originalname.endsWith('.xlsx')) {
      cb(null, file.originalname);
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
    const allowedMimes = [
      'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
      'application/json',
    ];
    // Always allow template files
    if (file.fieldname === 'template_file' || file.originalname.endsWith('.xlsx')) {
      return cb(null, true);
    }
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('File type not allowed'));
    }
  },
});

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
        default_terms TEXT
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
        template_type VARCHAR(20) DEFAULT 'sample',
        deposit DECIMAL(12,2) DEFAULT 0,
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
        weight VARCHAR(100) DEFAULT '',
        width VARCHAR(100) DEFAULT '',
        meters DECIMAL(12,2) DEFAULT 0,
        unit_price DECIMAL(12,2) DEFAULT 0,
        amount DECIMAL(12,2) DEFAULT 0,
        remark VARCHAR(500) DEFAULT '',
        piece_meters JSON NULL,
        KEY fk_order_items_order_id (order_id)
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

    // Repair: recalculate order totals from order_items (fixes any zero-total records)
    try {
      const [repairResult] = await conn.query<ResultSetHeader>(`
        UPDATE orders o
        SET
          total_meters = (SELECT COALESCE(SUM(meters), 0) FROM order_items WHERE order_id = o.id),
          total_pieces = (SELECT COUNT(*) FROM order_items WHERE order_id = o.id),
          total_amount = (SELECT COALESCE(SUM(amount), 0) FROM order_items WHERE order_id = o.id)
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
    order_items: []
  };
  saveLocalDB(defaultDB);
  return defaultDB;
}

function saveLocalDB(data: LocalDB) {
  fs.writeFileSync(DATABASE_FALLBACK_FILE, JSON.stringify(data, null, 2), 'utf8');
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
  template_type: z.enum(['sample', 'bulk']).optional().default('sample'),
  deposit: z.number().min(0).optional().default(0),
  items: z.array(OrderItemSchema),
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
  const data = req.body;
  try {
    if (!useMySQLFallback) {
      const pool = await getMySQLPool();
      // Ensure row with id=1 exists, update if yes, insert if no
      const [rows] = await pool.query<RowDataPacket[]>('SELECT id FROM company_config WHERE id = 1');
      if (rows.length > 0) {
        await pool.query(
          `UPDATE company_config SET 
            company_name = ?, brand_name = ?, brand_logo = ?, address = ?, phone = ?,
            wechat_qr = ?, alipay_qr = ?, default_terms = ?
          WHERE id = 1`,
          [
            data.company_name || '',
            data.brand_name || '',
            data.brand_logo || '',
            data.address || '',
            data.phone || '',
            data.wechat_qr || '',
            data.alipay_qr || '',
            data.default_terms || ''
          ]
        );
      } else {
        await pool.query(
          `INSERT INTO company_config (id, company_name, brand_name, brand_logo, address, phone, wechat_qr, alipay_qr, default_terms)
           VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            data.company_name || '',
            data.brand_name || '',
            data.brand_logo || '',
            data.address || '',
            data.phone || '',
            data.wechat_qr || '',
            data.alipay_qr || '',
            data.default_terms || ''
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
                oi.unit_price, oi.amount as item_amount, oi.remark, oi.piece_meters
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
  const data = CreateOrderSchema.parse(req.body);
  try {
    if (!useMySQLFallback) {
      const pool = await getMySQLPool();
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const [result] = await conn.query<ResultSetHeader>(
          `INSERT INTO orders (order_no, order_date, style_no, receiving_unit, total_meters, total_pieces, total_amount, sign_person, receiver, receiver_phone, template_type, deposit)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          data.template_type || 'sample',
          data.deposit || 0
        ]
      );
      const orderId = result.insertId;

      // Insert items
      if (data.items && data.items.length > 0) {
        for (const item of data.items) {
          await conn.query(
            `INSERT INTO order_items (order_id, product_no, color_no, product_name, composition, weight, width, meters, unit_price, amount, remark, piece_meters)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              orderId,
              item.product_no || '',
              item.color_no || '',
              item.product_name || '',
              item.composition || '',
              parseFloat(item.weight) || 0,
              parseFloat(item.width) || 0,
              item.meters || 0,
              item.unit_price || 0,
              item.amount || 0,
              item.remark || '',
              item.piece_meters ? JSON.stringify(item.piece_meters) : null
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
  const data = CreateOrderSchema.parse(req.body);
  try {
    if (!useMySQLFallback) {
      const pool = await getMySQLPool();
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        await conn.query(
          `UPDATE orders SET
            order_no = ?, order_date = ?, style_no = ?, receiving_unit = ?,
            total_meters = ?, total_pieces = ?, total_amount = ?,
            sign_person = ?, receiver = ?, receiver_phone = ?, template_type = ?, deposit = ?
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
            data.template_type || 'sample',
            data.deposit || 0,
            orderId
          ]
        );

        // Delete old items and re-insert
        await conn.query('DELETE FROM order_items WHERE order_id = ?', [orderId]);
        if (data.items && data.items.length > 0) {
          for (const item of data.items) {
            await conn.query(
              `INSERT INTO order_items (order_id, product_no, color_no, product_name, composition, weight, width, meters, unit_price, amount, remark, piece_meters)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                orderId,
                item.product_no || '',
                item.color_no || '',
                item.product_name || '',
                item.composition || '',
                item.weight || '',
                item.width || '',
                item.meters || 0,
                item.unit_price || 0,
                item.amount || 0,
                item.remark || '',
                item.piece_meters ? JSON.stringify(item.piece_meters) : null
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
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const cos = getCOSClient();
    const cosConfig = getCOSConfig();

    if (!cos || !cosConfig) {
      // Fallback: return local file path
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
  }
});

// ==================== API Route: Template Upload & Parse ====================
app.post('/api/template/upload', upload.single('template_file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No template file uploaded' });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(req.file.path);

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
    res.status(500).json({ error: error.message });
  }
});

// ==================== API Route: Template Config ====================
app.get('/api/template/config', (req, res) => {
  const config = loadTemplateConfig();
  res.json(config);
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
    // Production: serve static files from dist
    app.use(express.static(path.join(process.cwd(), 'dist')));
  }

  app.listen(PORT, () => {
    console.log(`[Server] Running on http://localhost:${PORT}`);
    console.log(`[Mode] ${isDev ? 'Development' : 'Production'}`);
    console.log(`[Database] ${useMySQLFallback ? 'JSON Fallback' : 'MySQL'}`);
    console.log(`[COS] ${getCOSConfig() ? 'Enabled' : 'Disabled (local storage)'}`);
  });
}

startServer().catch(console.error);
