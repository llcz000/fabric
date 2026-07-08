import express from 'express';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import mysql, { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import COS from 'cos-nodejs-sdk-v5';
import ExcelJS from 'exceljs';
import multer from 'multer';
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

// Image proxy endpoint to solve CORS issues for html-to-image on COS/remote images
app.get('/api/proxy-image', async (req, res) => {
  try {
    const url = req.query.url as string;
    if (!url) return res.status(400).send('Missing url parameter');
    // Only allow http/https URLs to prevent SSRF
    if (!/^https?:\/\//i.test(url)) return res.status(400).send('Invalid url');

    const imageRes = await fetch(url);
    if (!imageRes.ok) return res.status(404).send('Image not found');

    const contentType = imageRes.headers.get('content-type') || 'image/png';
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'no-cache');

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
const upload = multer({ storage });

// ==================== MySQL Database Config & Lazy Pool Initialization ====================
let mysqlPool: mysql.Pool | null = null;
let useMySQLFallback = true;

async function getMySQLPool(): Promise<mysql.Pool> {
  if (mysqlPool) return mysqlPool;

  const host = process.env.DB_HOST || 'localhost';
  const user = process.env.DB_USER || 'fabric_user';
  const password = process.env.DB_PASSWORD || 'REDACTED_DB_PASSWORD';
  const database = process.env.DB_DATABASE || 'fabric_db';

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

    // Add default_terms column for existing databases (safe to run even if column exists)
    try {
      await conn.query(`ALTER TABLE company_config ADD COLUMN default_terms TEXT`);
    } catch (_) {
      // Column already exists, ignore
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

// Automatically try initializing MySQL at boot
getMySQLPool().catch(() => {
  console.log('[Database] Running in JSON local file fallback mode.');
});

// ==================== Tencent Cloud COS Config ====================
let cosClient: COS | null = null;
const COS_CONFIG = {
  secretId: process.env.COS_SECRET_ID || 'REDACTED_COS_SECRET_ID',
  secretKey: process.env.COS_SECRET_KEY || 'REDACTED_COS_SECRET_KEY',
  region: process.env.COS_REGION || 'ap-shanghai',
  bucket: process.env.COS_BUCKET || 'fabric-images-1448065940'
};

function getCOSClient(): COS | null {
  if (cosClient) return cosClient;
  if (!COS_CONFIG.secretId || !COS_CONFIG.secretKey) {
    return null;
  }
  cosClient = new COS({
    SecretId: COS_CONFIG.secretId,
    SecretKey: COS_CONFIG.secretKey
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
            company_name=?, brand_name=?, brand_logo=?, address=?, phone=?, wechat_qr=?, alipay_qr=?, default_terms=?
           WHERE id=1`,
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
      return res.json({ message: '更新成功' });
    }
  } catch (e) {
    console.warn('[Database] MySQL company update failed. Saving to fallback database.json...');
  }

  // Fallback save
  const local = loadLocalDB();
  local.company_config = {
    id: 1,
    company_name: data.company_name || '',
    brand_name: data.brand_name || '',
    brand_logo: data.brand_logo || '',
    address: data.address || '',
    phone: data.phone || '',
    wechat_qr: data.wechat_qr || '',
    alipay_qr: data.alipay_qr || '',
    default_terms: data.default_terms || ''
  };
  saveLocalDB(local);
  res.json({ message: '更新成功' });
});

// ==================== API Route: Image Upload ====================
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '没有上传文件' });
  }

  const cos = getCOSClient();
  if (cos) {
    // Upload to Tencent Cloud COS
    const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, '');
    const rand = Math.random().toString(36).substring(2, 6);
    const ext = path.extname(req.file.originalname) || '.jpg';
    const key = `fabric_images/${timestamp}_${rand}${ext}`;

    const filePath = req.file.path;

    cos.putObject({
      Bucket: COS_CONFIG.bucket,
      Region: COS_CONFIG.region,
      Key: key,
      Body: fs.createReadStream(filePath)
    }, (err, data) => {
      // Clean up local temp file
      try { fs.unlinkSync(filePath); } catch (e) {}

      if (err) {
        console.error('[COS Upload Error]', err);
        return res.status(500).json({ error: 'COS上传失败：' + err.message });
      }

      const url = `https://${COS_CONFIG.bucket}.cos.${COS_CONFIG.region}.myqcloud.com/${key}`;
      return res.json({ url, key });
    });
  } else {
    // Local File Server fallback (very useful for local development and direct running!)
    const fileUrl = `/uploads/${req.file.filename}`;
    return res.json({ url: fileUrl, key: req.file.filename });
  }
});

// ==================== API Route: Orders Management ====================
app.get('/api/orders', async (req, res) => {
  const receiving_unit = (req.query.receiving_unit as string || '').trim();
  const product_no = (req.query.product_no as string || '').trim();
  const color_no = (req.query.color_no as string || '').trim();
  const product_name = (req.query.product_name as string || '').trim();
  const date_from = (req.query.date_from as string || '').trim();
  const date_to = (req.query.date_to as string || '').trim();
  const page = Math.max(1, parseInt(req.query.page as string || '1'));
  const per_page = Math.min(100, Math.max(1, parseInt(req.query.per_page as string || '20')));

  try {
    if (!useMySQLFallback) {
      const pool = await getMySQLPool();
      
      // We first check item filters
      let orderIds: number[] | null = null;
      if (product_no || color_no || product_name) {
        let itemSql = 'SELECT DISTINCT order_id FROM order_items WHERE 1=1';
        const itemParams: any[] = [];
        if (product_no) {
          itemSql += ' AND product_no LIKE ?';
          itemParams.push(`%${product_no}%`);
        }
        if (color_no) {
          itemSql += ' AND color_no LIKE ?';
          itemParams.push(`%${color_no}%`);
        }
        if (product_name) {
          itemSql += ' AND product_name LIKE ?';
          itemParams.push(`%${product_name}%`);
        }
        const [rows] = await pool.query<RowDataPacket[]>(itemSql, itemParams);
        orderIds = rows.map(r => r.order_id);
        if (orderIds.length === 0) {
          return res.json({ total: 0, page, per_page, data: [], total_meters: 0, total_amount: 0, total_pieces: 0 });
        }
      }

      // Build main orders query
      let whereSql = '';
      const params: any[] = [];

      if (receiving_unit) {
        whereSql += ' AND receiving_unit LIKE ?';
        params.push(`%${receiving_unit}%`);
      }
      if (date_from) {
        whereSql += ' AND order_date >= ?';
        params.push(date_from);
      }
      if (date_to) {
        whereSql += ' AND order_date <= ?';
        params.push(date_to);
      }
      if (orderIds !== null) {
        whereSql += ` AND id IN (${orderIds.join(',')})`;
      }

      // Query Total Count
      const countSql = 'SELECT COUNT(*) as total FROM orders WHERE 1=1' + whereSql;
      const [countRows] = await pool.query<RowDataPacket[]>(countSql, params);
      const total = countRows[0].total;

      // Aggregate Stats
      let agg_meters = 0;
      let agg_amount = 0;
      let agg_pieces = 0;
      
      if (product_no || color_no || product_name) {
        // Query item-level stats for filtered items
        let itemAggSql = `
          SELECT 
            COALESCE(SUM(meters), 0) as total_meters, 
            COALESCE(SUM(amount), 0) as total_amount,
            COUNT(*) as total_pieces 
          FROM order_items 
          WHERE 1=1`;
        const itemAggParams: any[] = [];
        if (product_no) {
          itemAggSql += ' AND product_no LIKE ?';
          itemAggParams.push(`%${product_no}%`);
        }
        if (color_no) {
          itemAggSql += ' AND color_no LIKE ?';
          itemAggParams.push(`%${color_no}%`);
        }
        if (product_name) {
          itemAggSql += ' AND product_name LIKE ?';
          itemAggParams.push(`%${product_name}%`);
        }
        if (orderIds !== null) {
          itemAggSql += ` AND order_id IN (${orderIds.join(',')})`;
        }
        const [aggRows] = await pool.query<RowDataPacket[]>(itemAggSql, itemAggParams);
        agg_meters = parseFloat(aggRows[0].total_meters);
        agg_amount = parseFloat(aggRows[0].total_amount);
        agg_pieces = parseInt(aggRows[0].total_pieces);
      } else {
        const aggSql = 'SELECT COALESCE(SUM(total_meters),0) as total_meters, COALESCE(SUM(total_amount),0) as total_amount, COALESCE(SUM(total_pieces),0) as total_pieces FROM orders WHERE 1=1' + whereSql;
        const [aggRows] = await pool.query<RowDataPacket[]>(aggSql, params);
        agg_meters = parseFloat(aggRows[0].total_meters);
        agg_amount = parseFloat(aggRows[0].total_amount);
        agg_pieces = parseInt(aggRows[0].total_pieces);
      }

      // Query actual orders list
      const offset = (page - 1) * per_page;
      const listSql = `SELECT * FROM orders WHERE 1=1 ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`;
      const [orders] = await pool.query<RowDataPacket[]>(listSql, [...params, per_page, offset]);

      // Fill in details/items for each order
      for (const order of orders) {
        if (product_no || color_no || product_name) {
          let filterItemSql = 'SELECT * FROM order_items WHERE order_id = ?';
          const filterItemParams: any[] = [order.id];
          if (product_no) {
            filterItemSql += ' AND product_no LIKE ?';
            filterItemParams.push(`%${product_no}%`);
          }
          if (color_no) {
            filterItemSql += ' AND color_no LIKE ?';
            filterItemParams.push(`%${color_no}%`);
          }
          if (product_name) {
            filterItemSql += ' AND product_name LIKE ?';
            filterItemParams.push(`%${product_name}%`);
          }
          const [items] = await pool.query<RowDataPacket[]>(filterItemSql, filterItemParams);
          order.items = items;
          order.total_meters = items.reduce((sum, it) => sum + parseFloat(it.meters || 0), 0);
          order.total_amount = items.reduce((sum, it) => sum + parseFloat(it.amount || 0), 0);
          order.total_pieces = items.reduce((sum, it) => {
            const pm = typeof it.piece_meters === 'string' ? JSON.parse(it.piece_meters) : it.piece_meters;
            if (Array.isArray(pm)) return sum + pm.filter(v => v > 0).length;
            return sum + 1;
          }, 0);
        } else {
          const [items] = await pool.query<RowDataPacket[]>('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
          order.items = items;
        }
      }

      return res.json({
        total,
        page,
        per_page,
        data: orders,
        total_meters: agg_meters,
        total_amount: agg_amount,
        total_pieces: agg_pieces
      });
    }
  } catch (error: any) {
    console.warn('[Database] MySQL GET orders query failed, using local database fallback...', error.message);
  }

  // Local JSON Database Fallback
  const local = loadLocalDB();
  let filteredOrders = [...local.orders];

  // Apply filters
  if (receiving_unit) {
    filteredOrders = filteredOrders.filter(o => o.receiving_unit && o.receiving_unit.toLowerCase().includes(receiving_unit.toLowerCase()));
  }
  if (date_from) {
    filteredOrders = filteredOrders.filter(o => o.order_date >= date_from);
  }
  if (date_to) {
    filteredOrders = filteredOrders.filter(o => o.order_date <= date_to);
  }

  // Filter by items inside orders
  if (product_no || color_no || product_name) {
    filteredOrders = filteredOrders.filter(o => {
      const orderItems = local.order_items.filter(item => item.order_id === o.id);
      return orderItems.some(item => {
        let match = true;
        if (product_no && (!item.product_no || !item.product_no.toLowerCase().includes(product_no.toLowerCase()))) match = false;
        if (color_no && (!item.color_no || !item.color_no.toLowerCase().includes(color_no.toLowerCase()))) match = false;
        if (product_name && (!item.product_name || !item.product_name.toLowerCase().includes(product_name.toLowerCase()))) match = false;
        return match;
      });
    });
  }

  // Paginate and aggregate stats
  let total_meters = 0;
  let total_amount = 0;
  let total_pieces = 0;

  filteredOrders.forEach(o => {
    const orderItems = local.order_items.filter(item => item.order_id === o.id);
    o.items = orderItems;

    let orderMeters = 0;
    let orderAmount = 0;
    let orderPieces = 0;

    orderItems.forEach(it => {
      let isItemMatch = true;
      if (product_no && (!it.product_no || !it.product_no.toLowerCase().includes(product_no.toLowerCase()))) isItemMatch = false;
      if (color_no && (!it.color_no || !it.color_no.toLowerCase().includes(color_no.toLowerCase()))) isItemMatch = false;
      if (product_name && (!it.product_name || !it.product_name.toLowerCase().includes(product_name.toLowerCase()))) isItemMatch = false;

      if (isItemMatch || (!product_no && !color_no && !product_name)) {
        orderMeters += parseFloat(it.meters || 0);
        orderAmount += parseFloat(it.amount || 0);

        let pm = it.piece_meters;
        if (typeof pm === 'string') {
          try { pm = JSON.parse(pm); } catch (e) { pm = null; }
        }
        if (Array.isArray(pm)) {
          orderPieces += pm.filter(v => typeof v === 'number' && v > 0).length;
        } else {
          orderPieces += 1;
        }
      }
    });

    if (product_no || color_no || product_name) {
      o.total_meters = orderMeters;
      o.total_amount = orderAmount;
      o.total_pieces = orderPieces;
    }

    total_meters += orderMeters;
    total_amount += orderAmount;
    total_pieces += orderPieces;
  });

  const total = filteredOrders.length;
  const offset = (page - 1) * per_page;
  const pageData = filteredOrders.slice(offset, offset + per_page);

  res.json({
    total,
    page,
    per_page,
    data: pageData,
    total_meters,
    total_amount,
    total_pieces
  });
});

app.get('/api/orders/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    if (!useMySQLFallback) {
      const pool = await getMySQLPool();
      const [orders] = await pool.query<RowDataPacket[]>('SELECT * FROM orders WHERE id = ?', [id]);
      if (orders.length > 0) {
        const order = orders[0];
        const [items] = await pool.query<RowDataPacket[]>('SELECT * FROM order_items WHERE order_id = ?', [id]);
        order.items = items;
        return res.json(order);
      } else {
        return res.status(404).json({ error: '订单不存在' });
      }
    }
  } catch (e) {}

  const local = loadLocalDB();
  const order = local.orders.find(o => o.id === id);
  if (order) {
    order.items = local.order_items.filter(it => it.order_id === id);
    res.json(order);
  } else {
    res.status(404).json({ error: '订单不存在' });
  }
});

app.post('/api/orders', async (req, res) => {
  const data = req.body;
  const items = data.items || [];

  const total_meters = items.reduce((sum: number, it: any) => sum + parseFloat(it.meters || 0), 0);
  const total_amount = items.reduce((sum: number, it: any) => sum + parseFloat(it.amount || 0), 0);
  
  // Calculate total pieces count
  let total_pieces = 0;
  items.forEach((it: any) => {
    const pm = it.piece_meters;
    if (Array.isArray(pm)) {
      total_pieces += pm.filter((v: any) => typeof v === 'number' && v > 0).length;
    } else {
      total_pieces += 1;
    }
  });

  const deposit = parseFloat(data.deposit || 0);

  try {
    if (!useMySQLFallback) {
      const pool = await getMySQLPool();
      const [orderResult] = await pool.query<ResultSetHeader>(
        `INSERT INTO orders (
          order_no, order_date, style_no, receiving_unit,
          total_meters, total_pieces, total_amount,
          sign_person, receiver, receiver_phone, template_type, deposit
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          data.order_no || '',
          data.order_date || new Date().toISOString().split('T')[0],
          data.style_no || '',
          data.receiving_unit || '',
          total_meters,
          total_pieces,
          total_amount,
          data.sign_person || '',
          data.receiver || '',
          data.receiver_phone || '',
          data.template_type || 'sample',
          deposit
        ]
      );

      const orderId = orderResult.insertId;

      for (const item of items) {
        const pieceMetersJson = Array.isArray(item.piece_meters) ? JSON.stringify(item.piece_meters) : null;
        await pool.query(
          `INSERT INTO order_items (
            order_id, product_no, color_no, product_name, composition,
            weight, width, meters, unit_price, amount, remark, piece_meters
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            orderId,
            item.product_no || '',
            item.color_no || '',
            item.product_name || '',
            item.composition || '',
            parseFloat(item.weight || 0),
            parseFloat(item.width || 0),
            parseFloat(item.meters || 0),
            parseFloat(item.unit_price || 0),
            parseFloat(item.amount || 0),
            item.remark || '',
            pieceMetersJson
          ]
        );
      }

      return res.status(201).json({ id: orderId, message: '创建成功' });
    }
  } catch (error: any) {
    console.warn('[Database] MySQL Order insert failed. Saving to fallback database.json...', error.message);
  }

  // Local JSON Database fallback save
  const local = loadLocalDB();
  const orderId = Date.now();
  const newOrder = {
    id: orderId,
    order_no: data.order_no || '',
    order_date: data.order_date || new Date().toISOString().split('T')[0],
    style_no: data.style_no || '',
    receiving_unit: data.receiving_unit || '',
    total_meters,
    total_pieces,
    total_amount,
    sign_person: data.sign_person || '',
    receiver: data.receiver || '',
    receiver_phone: data.receiver_phone || '',
    template_type: data.template_type || 'sample',
    deposit
  };

  local.orders.unshift(newOrder);

  const newItems = items.map((it: any, index: number) => ({
    id: orderId * 100 + index,
    order_id: orderId,
    product_no: it.product_no || '',
    color_no: it.color_no || '',
    product_name: it.product_name || '',
    composition: it.composition || '',
    weight: it.weight || '',
    width: it.width || '',
    meters: parseFloat(it.meters || 0),
    unit_price: parseFloat(it.unit_price || 0),
    amount: parseFloat(it.amount || 0),
    remark: it.remark || '',
    piece_meters: Array.isArray(it.piece_meters) ? JSON.stringify(it.piece_meters) : null
  }));

  local.order_items.push(...newItems);
  saveLocalDB(local);

  res.status(201).json({ id: orderId, message: '创建成功' });
});

app.put('/api/orders/:id', async (req, res) => {
  const orderId = parseInt(req.params.id);
  const data = req.body;
  const items = data.items || [];

  const total_meters = items.reduce((sum: number, it: any) => sum + parseFloat(it.meters || 0), 0);
  const total_amount = items.reduce((sum: number, it: any) => sum + parseFloat(it.amount || 0), 0);
  
  let total_pieces = 0;
  items.forEach((it: any) => {
    const pm = it.piece_meters;
    if (Array.isArray(pm)) {
      total_pieces += pm.filter((v: any) => typeof v === 'number' && v > 0).length;
    } else {
      total_pieces += 1;
    }
  });

  const deposit = parseFloat(data.deposit || 0);

  try {
    if (!useMySQLFallback) {
      const pool = await getMySQLPool();
      await pool.query(
        `UPDATE orders SET
          order_no=?, order_date=?, style_no=?, receiving_unit=?,
          total_meters=?, total_pieces=?, total_amount=?,
          sign_person=?, receiver=?, receiver_phone=?, template_type=?, deposit=?
        WHERE id=?`,
        [
          data.order_no || '',
          data.order_date || '',
          data.style_no || '',
          data.receiving_unit || '',
          total_meters,
          total_pieces,
          total_amount,
          data.sign_person || '',
          data.receiver || '',
          data.receiver_phone || '',
          data.template_type || 'sample',
          deposit,
          orderId
        ]
      );

      // Clean old items and insert new ones
      await pool.query('DELETE FROM order_items WHERE order_id = ?', [orderId]);

      for (const item of items) {
        const pieceMetersJson = Array.isArray(item.piece_meters) ? JSON.stringify(item.piece_meters) : null;
        await pool.query(
          `INSERT INTO order_items (
            order_id, product_no, color_no, product_name, composition,
            weight, width, meters, unit_price, amount, remark, piece_meters
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            orderId,
            item.product_no || '',
            item.color_no || '',
            item.product_name || '',
            item.composition || '',
            parseFloat(item.weight || 0),
            parseFloat(item.width || 0),
            parseFloat(item.meters || 0),
            parseFloat(item.unit_price || 0),
            parseFloat(item.amount || 0),
            item.remark || '',
            pieceMetersJson
          ]
        );
      }

      return res.json({ message: '更新成功' });
    }
  } catch (error: any) {
    console.warn('[Database] MySQL update order failed, falling back to JSON...', error.message);
  }

  // Fallback update
  const local = loadLocalDB();
  const orderIdx = local.orders.findIndex(o => o.id === orderId);
  if (orderIdx !== -1) {
    local.orders[orderIdx] = {
      ...local.orders[orderIdx],
      order_no: data.order_no || '',
      order_date: data.order_date || '',
      style_no: data.style_no || '',
      receiving_unit: data.receiving_unit || '',
      total_meters,
      total_pieces,
      total_amount,
      sign_person: data.sign_person || '',
      receiver: data.receiver || '',
      receiver_phone: data.receiver_phone || '',
      template_type: data.template_type || 'sample',
      deposit
    };

    // Remove old items and insert new ones
    local.order_items = local.order_items.filter(it => it.order_id !== orderId);

    const newItems = items.map((it: any, index: number) => ({
      id: orderId * 100 + index,
      order_id: orderId,
      product_no: it.product_no || '',
      color_no: it.color_no || '',
      product_name: it.product_name || '',
      composition: it.composition || '',
      weight: it.weight || '',
      width: it.width || '',
      meters: parseFloat(it.meters || 0),
      unit_price: parseFloat(it.unit_price || 0),
      amount: parseFloat(it.amount || 0),
      remark: it.remark || '',
      piece_meters: Array.isArray(it.piece_meters) ? JSON.stringify(it.piece_meters) : null
    }));

    local.order_items.push(...newItems);
    saveLocalDB(local);

    res.json({ message: '更新成功' });
  } else {
    res.status(404).json({ error: '订单不存在' });
  }
});

app.delete('/api/orders/:id', async (req, res) => {
  const orderId = parseInt(req.params.id);
  try {
    if (!useMySQLFallback) {
      const pool = await getMySQLPool();
      await pool.query('DELETE FROM order_items WHERE order_id = ?', [orderId]);
      await pool.query('DELETE FROM orders WHERE id = ?', [orderId]);
      return res.json({ message: '删除成功' });
    }
  } catch (error: any) {
    console.warn('[Database] MySQL delete order failed, falling back to JSON...', error.message);
  }

  const local = loadLocalDB();
  local.orders = local.orders.filter(o => o.id !== orderId);
  local.order_items = local.order_items.filter(it => it.order_id !== orderId);
  saveLocalDB(local);
  res.json({ message: '删除成功' });
});

// ==================== API Route: Templates Management ====================
app.get('/api/templates', (req, res) => {
  const config = loadTemplateConfig();
  const templatesList: any[] = [];

  if (fs.existsSync(TEMPLATE_DIR)) {
    const files = fs.readdirSync(TEMPLATE_DIR);
    files.forEach(filename => {
      if (filename.endsWith('.xlsx') && !filename.startsWith('~$') && !filename.endsWith('_new.xlsx')) {
        const info = config.templates[filename] || {};
        const filePath = path.join(TEMPLATE_DIR, filename);
        templatesList.push({
          filename,
          name: info.name || filename.replace('.xlsx', ''),
          description: info.description || '',
          is_default: info.is_default || false,
          type: info.type || 'sample',
          placeholders: info.placeholders || {},
          detail: info.detail || { start_row: 8, columns: {} },
          images: info.images || {},
          size: fs.statSync(filePath).size
        });
      }
    });
  }

  res.json(templatesList);
});

app.post('/api/templates/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '没有上传文件' });
  }

  const filename = req.file.originalname;
  const config = loadTemplateConfig();

  if (!config.templates[filename]) {
    config.templates[filename] = {
      name: filename.replace('.xlsx', ''),
      description: '',
      is_default: Object.keys(config.templates).length === 0,
      type: req.body.type || 'sample'
    };
  }

  saveTemplateConfig(config);
  res.json({ message: '上传成功', filename });
});

app.post('/api/templates/:filename/default', (req, res) => {
  const filename = req.params.filename;
  const config = loadTemplateConfig();

  if (!config.templates[filename]) {
    return res.status(404).json({ error: '模板不存在' });
  }

  Object.keys(config.templates).forEach(key => {
    config.templates[key].is_default = false;
  });
  config.templates[filename].is_default = true;

  saveTemplateConfig(config);
  res.json({ message: '设置成功' });
});

app.delete('/api/templates/:filename', (req, res) => {
  const filename = req.params.filename;
  const config = loadTemplateConfig();

  if (config.templates[filename]?.is_default) {
    return res.status(400).json({ error: '不能删除默认模板' });
  }

  const filePath = path.join(TEMPLATE_DIR, filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  if (config.templates[filename]) {
    delete config.templates[filename];
  }

  saveTemplateConfig(config);
  res.json({ message: '删除成功' });
});

app.put('/api/templates/:filename', (req, res) => {
  const filename = req.params.filename;
  const data = req.body;
  const config = loadTemplateConfig();

  if (!config.templates[filename]) {
    return res.status(404).json({ error: '模板不存在' });
  }

  config.templates[filename].name = data.name || config.templates[filename].name || filename;
  config.templates[filename].description = data.description || config.templates[filename].description || '';
  config.templates[filename].type = data.type || config.templates[filename].type || 'sample';

  saveTemplateConfig(config);
  res.json({ message: '更新成功' });
});

app.put('/api/templates/:filename/config', (req, res) => {
  const filename = req.params.filename;
  const data = req.body;
  const config = loadTemplateConfig();

  if (!config.templates[filename]) {
    return res.status(404).json({ error: '模板不存在' });
  }

  if (data.placeholders) config.templates[filename].placeholders = data.placeholders;
  if (data.detail) config.templates[filename].detail = data.detail;
  if (data.images) config.templates[filename].images = data.images;

  saveTemplateConfig(config);
  res.json({ message: '配置更新成功' });
});

// ==================== Chinese Financial Numeric Captializer ====================
function digit_upper(n: number): string {
  if (n <= 0) return '零元整';
  const digit = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];
  const radix = ['', '拾', '佰', '仟'];
  const big = ['', '万', '亿', '兆'];
  
  const num = Math.floor(n);
  const dec = Math.round((n - num) * 100);
  
  function _int_to_cn(val: number): string {
    if (val === 0) return '零';
    const parts: string[] = [];
    let i = 0;
    while (val > 0) {
      const r = val % 10000;
      if (r > 0) {
        let s = '';
        for (let j = 0; j < 4; j++) {
          const d = Math.floor(r / Math.pow(10, j)) % 10;
          if (d > 0) {
            s = digit[d] + radix[j] + s;
          } else if (s && s[0] !== '零') {
            s = '零' + s;
          }
        }
        s = s.replace(/零+$/, '');
        parts.push(s + big[i]);
      } else {
        parts.push('');
      }
      val = Math.floor(val / 10000);
      i++;
    }
    parts.reverse();
    let result = parts.join('');
    result = result.replace(/零+/g, '零');
    return result.replace(/零+$/, '');
  }

  const yuan = _int_to_cn(num);
  const prefix = yuan === '' || yuan === '零' ? '零' : yuan;

  if (dec === 0) {
    return prefix + '元整';
  }

  const jiao = Math.floor(dec / 10);
  const fen = dec % 10;
  let result = prefix + '元';
  if (jiao > 0) result += digit[jiao] + '角';
  if (fen > 0) result += digit[fen] + '分';
  return result;
}

// ==================== Based Template Excel Export Route ====================
app.get('/api/export_template/:order_id', async (req, res) => {
  const orderId = parseInt(req.params.order_id);
  let templateName = (req.query.template as string || '').trim();

  try {
    let order: any = null;
    let items: any[] = [];
    let company: any = null;

    // Load Data
    if (!useMySQLFallback) {
      const pool = await getMySQLPool();
      const [ordersList] = await pool.query<RowDataPacket[]>('SELECT * FROM orders WHERE id = ?', [orderId]);
      if (ordersList.length > 0) {
        order = ordersList[0];
        const [itemsList] = await pool.query<RowDataPacket[]>('SELECT * FROM order_items WHERE order_id = ?', [orderId]);
        items = itemsList;
      }
      const [companyList] = await pool.query<RowDataPacket[]>('SELECT * FROM company_config WHERE id = 1');
      if (companyList.length > 0) {
        company = companyList[0];
      }
    } else {
      const local = loadLocalDB();
      order = local.orders.find(o => o.id === orderId);
      if (order) {
        items = local.order_items.filter(it => it.order_id === orderId);
      }
      company = local.company_config;
    }

    if (!order) {
      return res.status(404).json({ error: '订单不存在' });
    }

    const config = loadTemplateConfig();

    // Select suitable template file
    if (!templateName) {
      const orderType = order.template_type || 'sample';
      for (const [fn, info] of Object.entries<any>(config.templates)) {
        if (info.type === orderType) {
          templateName = fn;
          break;
        }
      }
      if (!templateName) {
        for (const [fn, info] of Object.entries<any>(config.templates)) {
          if (info.is_default) {
            templateName = fn;
            break;
          }
        }
      }
      if (!templateName && fs.existsSync(TEMPLATE_DIR)) {
        const files = fs.readdirSync(TEMPLATE_DIR);
        const validTemplates = files.filter(f => f.endsWith('.xlsx') && !f.startsWith('~$') && !f.endsWith('_new.xlsx'));
        if (validTemplates.length > 0) {
          templateName = validTemplates[0];
        } else {
          return res.status(404).json({ error: '没有可用的Excel模板文件，请在排版配置中上传模版。' });
        }
      }
    }

    const templatePath = path.join(TEMPLATE_DIR, templateName);
    if (!fs.existsSync(templatePath)) {
      return res.status(404).json({ error: `模板 ${templateName} 不存在` });
    }

    const templateConfig = config.templates[templateName] || {};
    const placeholders = templateConfig.placeholders || {};
    const detailConfig = templateConfig.detail || { start_row: 8 };
    const isBulk = templateConfig.type === 'bulk' || order.template_type === 'bulk';

    // Read the Excel Template
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(templatePath);
    const ws = workbook.worksheets[0];

    // Build replacement values
    const depositVal = parseFloat(order.deposit || 0);
    const totalAmt = parseFloat(order.total_amount || 0);
    const payable = totalAmt - depositVal;

    const specialValues: any = {
      total_amount_cn: digit_upper(totalAmt),
      deposit_cn: digit_upper(depositVal),
      payable_cn: digit_upper(payable > 0 ? payable : 0),
      deposit: depositVal,
      payable: payable > 0 ? payable : 0
    };

    // Replace general placeholders in cell values
    ws.eachRow(row => {
      row.eachCell(cell => {
        let val = cell.value;
        if (val && typeof val === 'string') {
          let updated = val;
          // Match all placeholders like 【单号】 etc
          const regex = /【([^【】]+)】/g;
          let match;
          while ((match = regex.exec(val)) !== null) {
            const phKey = match[0]; // e.g. "【单号】"
            const field = placeholders[phKey];
            if (field) {
              let replacement = '';
              if (field in specialValues) {
                replacement = String(specialValues[field]);
              } else if (field in order) {
                replacement = String(order[field] ?? '');
              } else if (company && field in company) {
                replacement = String(company[field] ?? '');
              }
              updated = updated.replace(phKey, replacement);
            }
          }
          if (updated !== val) {
            cell.value = updated;
          }
        }
      });
    });

    // Write Detail Rows
    const startRow = detailConfig.start_row || 8;
    let excelRow = startRow;

    if (isBulk) {
      // Bulk order Excel export structure:
      // Group items' piece_meters into batches of 10, write them out side-by-side
      for (const item of items) {
        let pm: number[] = [];
        if (item.piece_meters) {
          try {
            pm = typeof item.piece_meters === 'string' ? JSON.parse(item.piece_meters) : item.piece_meters;
          } catch (e) {
            pm = [];
          }
        }
        if (!Array.isArray(pm)) pm = [];
        const validPm = pm.filter(v => typeof v === 'number' && v > 0);
        const price = parseFloat(item.unit_price || 0);

        // Slice into batches of 10
        const batches: number[][] = [];
        for (let i = 0; i < validPm.length; i += 10) {
          batches.push(validPm.slice(i, i + 10));
        }
        if (batches.length === 0) batches.push([]);

        const firstRow = excelRow;
        for (let bi = 0; bi < batches.length; bi++) {
          const batch = batches[bi];
          const currentRow = excelRow;
          excelRow++;

          // Column 1: Product No
          ws.getCell(currentRow, 1).value = bi === 0 ? (item.product_no || '') : '';
          // Column 2: Color No
          ws.getCell(currentRow, 2).value = bi === 0 ? (item.color_no || '') : '';
          // Column 3: Product Name
          ws.getCell(currentRow, 3).value = bi === 0 ? (item.product_name || '') : '';

          // Columns 4 to 13: Piece meters
          for (let pi = 0; pi < 10; pi++) {
            ws.getCell(currentRow, 4 + pi).value = pi < batch.length ? batch[pi] : '';
          }

          // Column 14: total pieces
          ws.getCell(currentRow, 14).value = bi === 0 ? validPm.length : '';
          // Column 15: total meters
          ws.getCell(currentRow, 15).value = bi === 0 ? validPm.reduce((a, b) => a + b, 0) : '';
          // Column 16: price
          ws.getCell(currentRow, 16).value = bi === 0 ? price : '';
          // Column 17: total amount
          ws.getCell(currentRow, 17).value = bi === 0 ? (validPm.reduce((a, b) => a + b, 0) * price) : '';

          // Add cell styles to the detail row
          for (let c = 1; c <= 17; c++) {
            const cell = ws.getCell(currentRow, c);
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };
          }
        }

        // Merge vertically if we had multiple batches
        if (batches.length > 1) {
          const lastRow = excelRow - 1;
          const colsToMerge = [1, 2, 3, 14, 15, 16, 17];
          colsToMerge.forEach(col => {
            ws.mergeCells(firstRow, col, lastRow, col);
          });
        }
      }
    } else {
      // Sample items: standard column-to-field mapping (e.g., Column A maps to product_no)
      const colMapping = detailConfig.columns || {
        'A': 'product_no', 'B': 'product_name', 'C': 'composition',
        'D': 'weight', 'E': 'width', 'F': 'meters',
        'G': 'unit_price', 'H': 'amount', 'I': 'remark'
      };

      for (const item of items) {
        const currentRow = excelRow;
        excelRow++;

        Object.entries(colMapping).forEach(([colChar, field]) => {
          let val = '';
          if (field === 'product_no') val = item.product_no;
          else if (field === 'product_name') val = item.product_name;
          else if (field === 'composition') val = item.composition;
          else if (field === 'weight') val = item.weight;
          else if (field === 'width') val = item.width;
          else if (field === 'meters') val = parseFloat(item.meters || 0) as any;
          else if (field === 'unit_price') val = parseFloat(item.unit_price || 0) as any;
          else if (field === 'amount') val = parseFloat(item.amount || 0) as any;
          else if (field === 'remark') val = item.remark;

          const cell = ws.getCell(`${colChar}${currentRow}`);
          cell.value = val;
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
          cell.border = {
            top: { style: 'thin' },
            bottom: { style: 'thin' },
            left: { style: 'thin' },
            right: { style: 'thin' }
          };
        });
      }
    }

    // Output Base64-encoded Excel file
    const buffer = await workbook.xlsx.writeBuffer();
    const b64 = (buffer as Buffer).toString('base64');
    
    res.json({
      excel: b64,
      filename: `${templateName.replace('.xlsx', '')}_${order.order_date}_${order.id}.xlsx`
    });

  } catch (error: any) {
    console.error('[Excel Export Error]', error);
    res.status(500).json({ error: '生成Excel单据出错：' + error.message });
  }
});

// ==================== Production Frontend Static Files & SPA Routing ====================
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Start Server
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Full-stack application running on http://localhost:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('[Server Start Error]', err);
});
