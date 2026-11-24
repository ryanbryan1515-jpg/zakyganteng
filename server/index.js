'use strict';

const express = require('express');
const multer = require('multer');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');

const { db, hashPassword, verifyPassword, nowIso } = require('./db');
const {
  createSession, getSession, destroySession, cookieHeader, requireAdmin, SESSION_HOURS,
} = require('./auth');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const STATUSES = [
  { key: 'new', label: 'Pesanan Baru' },
  { key: 'processing', label: 'Diproses' },
  { key: 'making', label: 'Sedang Dibuat' },
  { key: 'ready', label: 'Siap Diambil' },
  { key: 'shipping', label: 'Dalam Pengiriman' },
  { key: 'done', label: 'Selesai' },
  { key: 'cancelled', label: 'Dibatalkan' },
];
const STATUS_KEYS = STATUSES.map((s) => s.key);
const LOW_STOCK = 5;

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

/* ------------------------------------------------------------- utilities */

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const int = (v, fallback = 0) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
};
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const localDate = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const rupiah = (n) => 'Rp' + Number(n || 0).toLocaleString('id-ID');
const normalizeWa = (v) => {
  let digits = String(v || '').replace(/[^\d]/g, '');
  if (digits.startsWith('0')) digits = '62' + digits.slice(1);
  if (digits.startsWith('620')) digits = '62' + digits.slice(3);
  return digits;
};

/** Reads one settings row as a plain object. */
function getSettings() {
  return db.prepare('SELECT * FROM settings WHERE id = 1').get();
}

function getCategories() {
  return db.prepare('SELECT id, name, description, sort_order FROM categories ORDER BY sort_order, name').all();
}

/** Public product list: only active items, with category name joined. */
function listPublicProducts() {
  return db.prepare(`SELECT p.id, p.name, p.description, p.category_id, c.name AS category,
      p.spice_level, p.size, p.price, p.stock, p.image
    FROM products p LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.active = 1 ORDER BY p.id`).all();
}

function setCookie(res, token) {
  res.setHeader('Set-Cookie', cookieHeader(token, SESSION_HOURS * 3600));
}

function clearCookie(res) {
  res.setHeader('Set-Cookie', cookieHeader('', 0));
}

function api(fn) {
  return (req, res, next) => {
    try {
      fn(req, res, next);
    } catch (err) {
      next(err);
    }
  };
}

/* ---------------------------------------------------------------- upload */

const ALLOWED_IMAGES = new Map([
  ['image/jpeg', '.jpg'], ['image/png', '.png'], ['image/webp', '.webp'], ['image/gif', '.gif'],
]);
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ext = ALLOWED_IMAGES.get(file.mimetype) || '.jpg';
      cb(null, `img-${Date.now()}-${crypto.randomBytes(5).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 3 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_IMAGES.has(file.mimetype)) return cb(new Error('Format gambar harus JPG, PNG, WEBP, atau GIF.'));
    cb(null, true);
  },
});

/* --------------------------------------------------------- public routes */

app.get('/api/store', api((_req, res) => {
  res.json({
    settings: getSettings(),
    categories: getCategories(),
    products: listPublicProducts(),
    statuses: STATUSES,
    lowStock: LOW_STOCK,
  });
}));

app.get('/api/products', api((req, res) => {
  const q = str(req.query.q, 80).toLowerCase();
  const category = str(req.query.category, 40);
  const size = str(req.query.size, 20);
  const spice = req.query.spice === undefined || req.query.spice === '' ? null : int(req.query.spice, -1);
  let rows = listPublicProducts();
  if (q) {
    rows = rows.filter((p) => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q));
  }
  if (category && category !== 'Semua') rows = rows.filter((p) => p.category === category);
  if (size && size !== 'Semua') rows = rows.filter((p) => p.size === size);
  if (spice !== null) rows = rows.filter((p) => p.spice_level === spice);
  res.json({ products: rows });
}));

app.post('/api/orders', api((req, res) => {
  const body = req.body || {};
  const customerName = str(body.name, 80);
  const whatsapp = normalizeWa(body.whatsapp);
  const address = str(body.address, 300);
  const notes = str(body.notes, 300);
  const rawItems = Array.isArray(body.items) ? body.items : [];

  if (customerName.length < 2) return res.status(400).json({ error: 'Nama minimal 2 karakter.' });
  if (whatsapp.length < 9 || whatsapp.length > 15) return res.status(400).json({ error: 'Nomor WhatsApp tidak valid.' });
  if (address.length < 8) return res.status(400).json({ error: 'Alamat pengambilan/pengiriman minimal 8 karakter.' });
  if (!rawItems.length) return res.status(400).json({ error: 'Keranjang masih kosong.' });
  if (rawItems.length > 30) return res.status(400).json({ error: 'Terlalu banyak item dalam satu pesanan.' });

  const wanted = new Map();
  for (const item of rawItems) {
    const id = int(item && item.productId, 0);
    const qty = int(item && item.qty, 0);
    if (!id || qty < 1 || qty > 20) return res.status(400).json({ error: 'Jumlah produk tidak valid.' });
    wanted.set(id, (wanted.get(id) || 0) + qty);
  }

  // Prices and stock are always taken from the database, never from the browser.
  const lines = [];
  let total = 0;
  for (const [productId, qty] of wanted) {
    const product = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(productId);
    if (!product) return res.status(400).json({ error: `Produk #${productId} tidak tersedia.` });
    if (product.stock < qty) {
      return res.status(409).json({ error: `Stok ${product.name} tinggal ${product.stock}. Kurangi jumlahnya.` });
    }
    const subtotal = product.price * qty;
    total += subtotal;
    lines.push({ product, qty, subtotal });
  }

  let code;
  for (let attempt = 0; attempt < 6; attempt++) {
    const stamp = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    code = `PZ-${stamp}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    if (!db.prepare('SELECT 1 FROM orders WHERE code = ?').get(code)) break;
  }

  const createdAt = nowIso();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`INSERT INTO orders (code, customer_name, whatsapp, address, notes, total, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'new', ?, ?)`).run(code, customerName, whatsapp, address, notes, total, createdAt, createdAt);
    const orderId = db.prepare('SELECT id FROM orders WHERE code = ?').get(code).id;
    const insItem = db.prepare(`INSERT INTO order_items
      (order_id, product_id, product_name, price, qty, subtotal) VALUES (?, ?, ?, ?, ?, ?)`);
    const decStock = db.prepare('UPDATE products SET stock = stock - ?, updated_at = ? WHERE id = ?');
    for (const line of lines) {
      insItem.run(orderId, line.product.id, line.product.name, line.product.price, line.qty, line.subtotal);
      decStock.run(line.qty, createdAt, line.product.id);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  // The order is stored first; WhatsApp is only the notification channel.
  const settings = getSettings();
  const waNumber = normalizeWa(settings.whatsapp);
  const lineText = lines
    .map((l) => `• ${l.product.name} (${l.product.size}) x${l.qty} = ${rupiah(l.subtotal)}`)
    .join('\n');
  const message = [
    `Halo ${settings.store_name}, saya mau konfirmasi pesanan:`,
    '',
    `Kode: ${code}`,
    `Nama: ${customerName}`,
    `WhatsApp: ${whatsapp}`,
    `Alamat: ${address}`,
    notes ? `Catatan: ${notes}` : null,
    '',
    lineText,
    '',
    `Total: ${rupiah(total)}`,
    '',
    'Mohon konfirmasi ketersediaan dan waktu pengambilan. Terima kasih!',
  ].filter(Boolean).join('\n');

  res.status(201).json({
    order: {
      code,
      total,
      status: 'new',
      createdAt,
      items: lines.map((l) => ({
        product_id: l.product.id,
        product_name: l.product.name,
        price: l.product.price,
        qty: l.qty,
        subtotal: l.subtotal,
      })),
    },
    waLink: `https://wa.me/${waNumber}?text=${encodeURIComponent(message)}`,
  });
}));

app.get('/api/order-status', api((_req, res) => {
  res.json({ statuses: STATUSES });
}));

/* ---------------------------------------------------------------- login */

const loginAttempts = new Map();
function rateLimited(ip) {
  const entry = loginAttempts.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.first > 10 * 60 * 1000) {
    loginAttempts.delete(ip);
    return false;
  }
  return entry.count >= 10;
}
function noteAttempt(ip, success) {
  if (success) return loginAttempts.delete(ip);
  const entry = loginAttempts.get(ip) || { count: 0, first: Date.now() };
  entry.count += 1;
  loginAttempts.set(ip, entry);
}

app.post('/api/admin/login', api((req, res) => {
  const ip = req.ip || 'unknown';
  if (rateLimited(ip)) {
    return res.status(429).json({ error: 'Terlalu banyak percobaan login. Coba lagi dalam 10 menit.' });
  }
  const username = str(req.body && req.body.username, 60);
  const password = typeof (req.body && req.body.password) === 'string' ? req.body.password : '';
  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
  if (!admin || !verifyPassword(password, admin.password_hash)) {
    noteAttempt(ip, false);
    return res.status(401).json({ error: 'Username atau password salah.' });
  }
  noteAttempt(ip, true);
  const { token } = createSession(admin.id, req.headers['user-agent'] || '');
  setCookie(res, token);
  res.json({ admin: { id: admin.id, username: admin.username } });
}));

app.post('/api/admin/logout', api((req, res) => {
  destroySession(req);
  clearCookie(res);
  res.json({ ok: true });
}));

app.get('/api/admin/session', api((req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Belum login.' });
  res.json({ admin: { id: session.admin_id, username: session.username } });
}));

/* ------------------------------------------------------------ dashboard */

function revenueRange(from, to) {
  return db.prepare(`SELECT COALESCE(SUM(total), 0) AS revenue, COUNT(*) AS orders
    FROM orders WHERE status <> 'cancelled' AND date(created_at, 'localtime') BETWEEN ? AND ?`)
    .get(from, to);
}

function seriesDaily(from, to) {
  const rows = db.prepare(`SELECT date(created_at, 'localtime') AS d, SUM(total) AS revenue, COUNT(*) AS orders
    FROM orders WHERE status <> 'cancelled' AND date(created_at, 'localtime') BETWEEN ? AND ?
    GROUP BY d ORDER BY d`).all(from, to);
  const map = new Map(rows.map((r) => [r.d, r]));
  const out = [];
  const cursor = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  while (cursor <= end) {
    const key = localDate(cursor);
    const row = map.get(key);
    out.push({ date: key, revenue: row ? row.revenue : 0, orders: row ? row.orders : 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

function seriesMonthly() {
  const rows = db.prepare(`SELECT strftime('%Y-%m', created_at, 'localtime') AS m, SUM(total) AS revenue, COUNT(*) AS orders
    FROM orders WHERE status <> 'cancelled' GROUP BY m ORDER BY m`).all();
  const map = new Map(rows.map((r) => [r.m, r]));
  const out = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = monthKey(d);
    const row = map.get(key);
    out.push({ month: key, revenue: row ? row.revenue : 0, orders: row ? row.orders : 0 });
  }
  return out;
}

function topProducts(from, to, limit = 6) {
  return db.prepare(`SELECT oi.product_name AS name, SUM(oi.qty) AS qty, SUM(oi.subtotal) AS revenue
    FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE o.status <> 'cancelled' AND date(o.created_at, 'localtime') BETWEEN ? AND ?
    GROUP BY oi.product_name ORDER BY qty DESC LIMIT ?`).all(from, to, limit);
}

function categorySales(from, to) {
  return db.prepare(`SELECT COALESCE(c.name, 'Tanpa kategori') AS category_name, SUM(oi.subtotal) AS revenue, SUM(oi.qty) AS qty
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    LEFT JOIN products p ON p.id = oi.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE o.status <> 'cancelled' AND date(o.created_at, 'localtime') BETWEEN ? AND ?
    GROUP BY category_name ORDER BY revenue DESC`).all(from, to);
}

app.get('/api/admin/dashboard', requireAdmin, api((_req, res) => {
  const today = localDate();
  const from14 = localDate(new Date(Date.now() - 13 * 86400000));
  const from30 = localDate(new Date(Date.now() - 29 * 86400000));

  const stats = {
    products: db.prepare('SELECT COUNT(*) AS n FROM products').get().n,
    activeProducts: db.prepare('SELECT COUNT(*) AS n FROM products WHERE active = 1').get().n,
    orders: db.prepare('SELECT COUNT(*) AS n FROM orders').get().n,
    revenue: db.prepare("SELECT COALESCE(SUM(total), 0) AS n FROM orders WHERE status <> 'cancelled'").get().n,
    newOrders: db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'new'").get().n,
    lowStock: db.prepare('SELECT COUNT(*) AS n FROM products WHERE stock > 0 AND stock <= ?').get(LOW_STOCK).n,
    outOfStock: db.prepare('SELECT COUNT(*) AS n FROM products WHERE stock <= 0').get().n,
    todayRevenue: revenueRange(today, today).revenue,
    todayOrders: revenueRange(today, today).orders,
    avgOrder: 0,
  };
  const paid = db.prepare("SELECT COUNT(*) AS c, COALESCE(SUM(total), 0) AS s FROM orders WHERE status <> 'cancelled'").get();
  stats.avgOrder = paid.c ? Math.round(paid.s / paid.c) : 0;

  res.json({
    stats,
    daily: seriesDaily(from14, today),
    monthly: seriesMonthly(),
    topProducts: topProducts(from30, today),
    categories: categorySales(from30, today),
    recentOrders: db.prepare(`SELECT o.id, o.code, o.customer_name, o.total, o.status, o.created_at,
        (SELECT COALESCE(SUM(qty), 0) FROM order_items WHERE order_id = o.id) AS items
      FROM orders o ORDER BY o.created_at DESC LIMIT 6`).all(),
    lowStockProducts: db.prepare(`SELECT id, name, stock FROM products WHERE stock <= ? ORDER BY stock LIMIT 6`)
      .all(LOW_STOCK),
    statuses: STATUSES,
  });
}));

/* -------------------------------------------------------------- products */

function productPayload(body) {
  const name = str(body && body.name, 80);
  const description = str(body && body.description, 400);
  const categoryId = body && body.category_id ? int(body.category_id, 0) : null;
  const spiceLevel = int(body && body.spice_level, 0);
  const size = str(body && body.size, 20) || '30 cm';
  const price = int(body && body.price, -1);
  const stock = int(body && body.stock, -1);
  const image = str(body && body.image, 300);
  const active = body && (body.active === false || body.active === 0 || body.active === '0') ? 0 : 1;

  const errors = [];
  if (name.length < 2) errors.push('Nama produk minimal 2 karakter.');
  if (price < 0) errors.push('Harga tidak boleh negatif.');
  if (price > 10000000) errors.push('Harga terlalu besar.');
  if (stock < 0) errors.push('Stok tidak boleh negatif.');
  if (spiceLevel < 0 || spiceLevel > 7) errors.push('Level pedas harus 0–7.');
  if (categoryId && !db.prepare('SELECT 1 FROM categories WHERE id = ?').get(categoryId)) {
    errors.push('Kategori tidak ditemukan.');
  }
  return { errors, values: { name, description, categoryId, spiceLevel, size, price, stock, image, active } };
}

app.get('/api/admin/products', requireAdmin, api((_req, res) => {
  const products = db.prepare(`SELECT p.*, c.name AS category,
      (SELECT COALESCE(SUM(oi.qty), 0) FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE oi.product_id = p.id AND o.status <> 'cancelled') AS sold
    FROM products p LEFT JOIN categories c ON c.id = p.category_id
    ORDER BY p.id DESC`).all();
  res.json({ products, categories: getCategories() });
}));

app.post('/api/admin/products', requireAdmin, api((req, res) => {
  const { errors, values } = productPayload(req.body);
  if (errors.length) return res.status(400).json({ error: errors[0], errors });
  const ts = nowIso();
  const info = db.prepare(`INSERT INTO products
    (name, description, category_id, spice_level, size, price, stock, image, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    values.name, values.description, values.categoryId, values.spiceLevel, values.size,
    values.price, values.stock, values.image, values.active, ts, ts
  );
  res.status(201).json({ id: Number(info.lastInsertRowid) });
}));

app.put('/api/admin/products/:id', requireAdmin, api((req, res) => {
  const id = int(req.params.id, 0);
  if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(id)) {
    return res.status(404).json({ error: 'Produk tidak ditemukan.' });
  }
  const { errors, values } = productPayload(req.body);
  if (errors.length) return res.status(400).json({ error: errors[0], errors });
  db.prepare(`UPDATE products SET name = ?, description = ?, category_id = ?, spice_level = ?, size = ?,
      price = ?, stock = ?, image = ?, active = ?, updated_at = ? WHERE id = ?`).run(
    values.name, values.description, values.categoryId, values.spiceLevel, values.size,
    values.price, values.stock, values.image, values.active, nowIso(), id
  );
  res.json({ ok: true });
}));

app.delete('/api/admin/products/:id', requireAdmin, api((req, res) => {
  const id = int(req.params.id, 0);
  const info = db.prepare('DELETE FROM products WHERE id = ?').run(id);
  if (!info.changes) return res.status(404).json({ error: 'Produk tidak ditemukan.' });
  res.json({ ok: true });
}));

app.post('/api/admin/products/:id/stock', requireAdmin, api((req, res) => {
  const id = int(req.params.id, 0);
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!product) return res.status(404).json({ error: 'Produk tidak ditemukan.' });
  const mode = str(req.body && req.body.mode, 10) || 'set';
  const value = int(req.body && req.body.value, 0);
  let next;
  if (mode === 'add') next = product.stock + value;
  else if (mode === 'remove') next = product.stock - value;
  else next = value;
  if (!Number.isFinite(next) || next < 0) {
    return res.status(400).json({ error: 'Stok akhir tidak boleh negatif.' });
  }
  if (next > 100000) return res.status(400).json({ error: 'Stok terlalu besar.' });
  db.prepare('UPDATE products SET stock = ?, updated_at = ? WHERE id = ?').run(next, nowIso(), id);
  res.json({ stock: next });
}));

/* ------------------------------------------------------------ categories */

app.get('/api/admin/categories', requireAdmin, api((_req, res) => {
  const categories = db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS products
    FROM categories c ORDER BY c.sort_order, c.name`).all();
  res.json({ categories });
}));

app.post('/api/admin/categories', requireAdmin, api((req, res) => {
  const name = str(req.body && req.body.name, 40);
  const description = str(req.body && req.body.description, 160);
  if (name.length < 2) return res.status(400).json({ error: 'Nama kategori minimal 2 karakter.' });
  if (db.prepare('SELECT 1 FROM categories WHERE lower(name) = lower(?)').get(name)) {
    return res.status(409).json({ error: 'Kategori sudah ada.' });
  }
  const sort = int(req.body && req.body.sort_order, 99);
  const info = db.prepare('INSERT INTO categories (name, description, sort_order, created_at) VALUES (?, ?, ?, ?)')
    .run(name, description, sort, nowIso());
  res.status(201).json({ id: Number(info.lastInsertRowid) });
}));

app.put('/api/admin/categories/:id', requireAdmin, api((req, res) => {
  const id = int(req.params.id, 0);
  const current = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  if (!current) return res.status(404).json({ error: 'Kategori tidak ditemukan.' });
  const name = str(req.body && req.body.name, 40) || current.name;
  const description = str(req.body && req.body.description, 160);
  const sort = int(req.body && req.body.sort_order, current.sort_order);
  const dup = db.prepare('SELECT 1 FROM categories WHERE lower(name) = lower(?) AND id <> ?').get(name, id);
  if (dup) return res.status(409).json({ error: 'Nama kategori sudah dipakai.' });
  db.prepare('UPDATE categories SET name = ?, description = ?, sort_order = ? WHERE id = ?')
    .run(name, description, sort, id);
  res.json({ ok: true });
}));

app.delete('/api/admin/categories/:id', requireAdmin, api((req, res) => {
  const id = int(req.params.id, 0);
  const used = db.prepare('SELECT COUNT(*) AS n FROM products WHERE category_id = ?').get(id).n;
  if (used) return res.status(409).json({ error: `Kategori masih dipakai oleh ${used} produk.` });
  const info = db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  if (!info.changes) return res.status(404).json({ error: 'Kategori tidak ditemukan.' });
  res.json({ ok: true });
}));

/* ---------------------------------------------------------------- orders */

function orderWithItems(row) {
  if (!row) return null;
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(row.id);
  return { ...row, items };
}

app.get('/api/admin/orders', requireAdmin, api((req, res) => {
  const q = str(req.query.q, 80);
  const status = str(req.query.status, 20);
  const from = isDate(req.query.from) ? req.query.from : null;
  const to = isDate(req.query.to) ? req.query.to : null;
  const limit = Math.min(Math.max(int(req.query.limit, 200), 1), 1000);

  const where = [];
  const params = [];
  if (q) {
    where.push('(o.code LIKE ? OR o.customer_name LIKE ? OR o.whatsapp LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (status && STATUS_KEYS.includes(status)) {
    where.push('o.status = ?');
    params.push(status);
  }
  if (from) { where.push("date(o.created_at, 'localtime') >= ?"); params.push(from); }
  if (to) { where.push("date(o.created_at, 'localtime') <= ?"); params.push(to); }

  const rows = db.prepare(`SELECT o.*, (SELECT COALESCE(SUM(qty), 0) FROM order_items WHERE order_id = o.id) AS items_count
    FROM orders o ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY o.created_at DESC LIMIT ?`).all(...params, limit);

  const stmt = db.prepare('SELECT * FROM order_items WHERE order_id = ?');
  const orders = rows.map((row) => ({ ...row, items: stmt.all(row.id) }));

  res.json({
    orders,
    statuses: STATUSES,
    summary: {
      count: orders.length,
      revenue: orders.reduce((s, o) => s + (o.status === 'cancelled' ? 0 : o.total), 0),
    },
  });
}));

app.get('/api/admin/orders/:id', requireAdmin, api((req, res) => {
  const order = orderWithItems(db.prepare('SELECT * FROM orders WHERE id = ?').get(int(req.params.id, 0)));
  if (!order) return res.status(404).json({ error: 'Pesanan tidak ditemukan.' });
  res.json({ order });
}));

app.patch('/api/admin/orders/:id/status', requireAdmin, api((req, res) => {
  const id = int(req.params.id, 0);
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!order) return res.status(404).json({ error: 'Pesanan tidak ditemukan.' });
  const status = str(req.body && req.body.status, 20);
  if (!STATUS_KEYS.includes(status)) return res.status(400).json({ error: 'Status tidak valid.' });
  if (order.status === status) return res.json({ ok: true, status });

  db.exec('BEGIN IMMEDIATE');
  try {
    // Cancelling returns reserved stock; un-cancelling reserves it again when possible.
    if (status === 'cancelled' && order.status !== 'cancelled') {
      const items = db.prepare('SELECT product_id, qty FROM order_items WHERE order_id = ?').all(id);
      const restock = db.prepare('UPDATE products SET stock = stock + ?, updated_at = ? WHERE id = ?');
      for (const it of items) if (it.product_id) restock.run(it.qty, nowIso(), it.product_id);
    } else if (order.status === 'cancelled' && status !== 'cancelled') {
      const items = db.prepare('SELECT product_id, qty FROM order_items WHERE order_id = ?').all(id);
      const take = db.prepare('UPDATE products SET stock = stock - ?, updated_at = ? WHERE id = ? AND stock >= ?');
      for (const it of items) {
        if (!it.product_id) continue;
        const info = take.run(it.qty, nowIso(), it.product_id, it.qty);
        if (!info.changes) {
          db.exec('ROLLBACK');
          return res.status(409).json({ error: 'Stok produk tidak cukup untuk mengaktifkan kembali pesanan ini.' });
        }
      }
    }
    db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').run(status, nowIso(), id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  res.json({ ok: true, status });
}));

app.delete('/api/admin/orders/:id', requireAdmin, api((req, res) => {
  const id = int(req.params.id, 0);
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!order) return res.status(404).json({ error: 'Pesanan tidak ditemukan.' });

  db.exec('BEGIN IMMEDIATE');
  try {
    if (order.status !== 'cancelled') {
      const items = db.prepare('SELECT product_id, qty FROM order_items WHERE order_id = ?').all(id);
      const restock = db.prepare('UPDATE products SET stock = stock + ?, updated_at = ? WHERE id = ?');
      for (const it of items) if (it.product_id) restock.run(it.qty, nowIso(), it.product_id);
    }
    db.prepare('DELETE FROM orders WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  res.json({ ok: true });
}));

/* --------------------------------------------------------------- reports */

function reportRange(req) {
  const to = isDate(req.query.to) ? req.query.to : localDate();
  const from = isDate(req.query.from) ? req.query.from : localDate(new Date(Date.now() - 29 * 86400000));
  return { from, to };
}

app.get('/api/admin/reports', requireAdmin, api((req, res) => {
  const { from, to } = reportRange(req);
  const totals = db.prepare(`SELECT COUNT(*) AS orders, COALESCE(SUM(total), 0) AS revenue
    FROM orders WHERE status <> 'cancelled' AND date(created_at, 'localtime') BETWEEN ? AND ?`).get(from, to);
  const sold = db.prepare(`SELECT COALESCE(SUM(oi.qty), 0) AS items FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.status <> 'cancelled' AND date(o.created_at, 'localtime') BETWEEN ? AND ?`).get(from, to);

  res.json({
    from, to,
    totals: {
      revenue: totals.revenue,
      orders: totals.orders,
      items: sold.items,
      avgOrder: totals.orders ? Math.round(totals.revenue / totals.orders) : 0,
    },
    topProducts: topProducts(from, to, 10),
    categories: categorySales(from, to),
    daily: seriesDaily(from, to),
    monthly: seriesMonthly(),
    statusCounts: db.prepare(`SELECT status, COUNT(*) AS count FROM orders
      WHERE date(created_at, 'localtime') BETWEEN ? AND ? GROUP BY status`).all(from, to),
    statuses: STATUSES,
  });
}));

app.get('/api/admin/reports/export.csv', requireAdmin, api((req, res) => {
  const { from, to } = reportRange(req);
  const rows = db.prepare(`SELECT o.code, o.created_at, o.customer_name, o.whatsapp, o.address,
      o.status, o.total, oi.product_name, oi.price, oi.qty, oi.subtotal
    FROM orders o JOIN order_items oi ON oi.order_id = o.id
    WHERE date(o.created_at, 'localtime') BETWEEN ? AND ?
    ORDER BY o.created_at DESC, oi.id`).all(from, to);
  const statusLabel = Object.fromEntries(STATUSES.map((s) => [s.key, s.label]));
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['Kode Pesanan', 'Tanggal', 'Pelanggan', 'WhatsApp', 'Alamat', 'Status', 'Produk', 'Harga', 'Jumlah', 'Subtotal', 'Total Pesanan'];
  const lines = [header.map(esc).join(',')];
  for (const r of rows) {
    lines.push([
      r.code, new Date(r.created_at).toLocaleString('id-ID'), r.customer_name, r.whatsapp, r.address,
      statusLabel[r.status] || r.status, r.product_name, r.price, r.qty, r.subtotal, r.total,
    ].map(esc).join(','));
  }
  const csv = '\uFEFF' + lines.join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="laporan-pizzaky-${from}-${to}.csv"`);
  res.send(csv);
}));

/* -------------------------------------------------------------- settings */

app.get('/api/admin/settings', requireAdmin, api((_req, res) => {
  res.json({ settings: getSettings() });
}));

app.put('/api/admin/settings', requireAdmin, api((req, res) => {
  const body = req.body || {};
  const storeName = str(body.store_name, 60);
  const whatsapp = normalizeWa(body.whatsapp);
  const address = str(body.address, 300);
  if (storeName.length < 2) return res.status(400).json({ error: 'Nama toko minimal 2 karakter.' });
  if (whatsapp.length < 9 || whatsapp.length > 15) return res.status(400).json({ error: 'Nomor WhatsApp tidak valid.' });
  const current = getSettings();
  db.prepare(`UPDATE settings SET store_name = ?, tagline = ?, whatsapp = ?, address = ?, maps_url = ?,
      hours = ?, contact_email = ?, instagram = ?, logo = ?, banner = ?, updated_at = ? WHERE id = 1`).run(
    storeName,
    str(body.tagline, 160),
    whatsapp,
    address,
    str(body.maps_url, 500),
    str(body.hours, 120),
    str(body.contact_email, 120),
    str(body.instagram, 80),
    str(body.logo, 300) || current.logo,
    str(body.banner, 300),
    nowIso()
  );
  res.json({ settings: getSettings() });
}));

app.post('/api/admin/upload', requireAdmin, (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload gagal.' });
    if (!req.file) return res.status(400).json({ error: 'Tidak ada file yang diunggah.' });
    res.json({ url: '/uploads/' + req.file.filename });
  });
}, (err, _req, res, _next) => res.status(400).json({ error: err.message }));

/* --------------------------------------------------------------- account */

app.put('/api/admin/account/username', requireAdmin, api((req, res) => {
  const username = str(req.body && req.body.username, 40);
  if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(username)) {
    return res.status(400).json({ error: 'Username 3–40 karakter (huruf, angka, titik, garis bawah, strip).' });
  }
  const exists = db.prepare('SELECT 1 FROM admins WHERE lower(username) = lower(?) AND id <> ?')
    .get(username, req.admin.admin_id);
  if (exists) return res.status(409).json({ error: 'Username sudah dipakai.' });
  db.prepare('UPDATE admins SET username = ? WHERE id = ?').run(username, req.admin.admin_id);
  res.json({ username });
}));

app.put('/api/admin/account/password', requireAdmin, api((req, res) => {
  const current = typeof (req.body && req.body.current) === 'string' ? req.body.current : '';
  const next = typeof (req.body && req.body.next) === 'string' ? req.body.next : '';
  if (next.length < 6) return res.status(400).json({ error: 'Password baru minimal 6 karakter.' });
  if (next.length > 128) return res.status(400).json({ error: 'Password terlalu panjang.' });
  const admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.admin.admin_id);
  if (!verifyPassword(current, admin.password_hash)) {
    return res.status(400).json({ error: 'Password saat ini salah.' });
  }
  db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hashPassword(next), admin.id);
  res.json({ ok: true });
}));

app.get('/api/admin/account/sessions', requireAdmin, api((req, res) => {
  const rows = db.prepare('SELECT token, created_at, expires_at, user_agent FROM sessions WHERE admin_id = ? ORDER BY created_at DESC')
    .all(req.admin.admin_id);
  res.json({
    current: req.admin.token,
    sessions: rows.map((r) => ({
      created_at: r.created_at,
      expires_at: r.expires_at,
      user_agent: r.user_agent,
      current: r.token === req.admin.token,
      id: crypto.createHash('sha256').update(r.token).digest('hex').slice(0, 12),
    })),
  });
}));

app.delete('/api/admin/account/sessions', requireAdmin, api((req, res) => {
  db.prepare('DELETE FROM sessions WHERE admin_id = ? AND token <> ?').run(req.admin.admin_id, req.admin.token);
  res.json({ ok: true });
}));

/* ---------------------------------------------------------------- static */

app.use(express.static(PUBLIC_DIR, { extensions: ['html'], maxAge: 0 }));

app.get('/admin', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan.' }));

app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  if (res.headersSent) return;
  const status = err.status || 500;
  res.status(status).json({ error: status === 500 ? 'Terjadi kesalahan pada server.' : err.message });
});

// Expired sessions are cleaned up periodically.
setInterval(() => {
  try {
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(nowIso());
  } catch { /* ignore */ }
}, 60 * 60 * 1000).unref();

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`PIZZAKY.AJA running on http://localhost:${PORT}`);
    console.log(`Admin dashboard: http://localhost:${PORT}/admin`);
  });
}

module.exports = app;
