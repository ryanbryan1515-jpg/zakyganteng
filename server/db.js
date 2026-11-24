'use strict';

/**
 * SQLite storage for PIZZAKY.AJA.
 * Uses Node's built-in `node:sqlite` (no native build step required).
 * For production you can swap this module for PostgreSQL/MySQL — the schema below
 * mirrors prisma/db/schema.sql.
 */
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'pizzaky.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

const nowIso = () => new Date().toISOString();

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const [algo, salt, hash] = String(stored).split('$');
    if (algo !== 'scrypt' || !salt || !hash) return false;
    const candidate = crypto.scryptSync(String(password), salt, 64);
    const expected = Buffer.from(hash, 'hex');
    return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  admin_id   INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  spice_level INTEGER NOT NULL DEFAULT 0 CHECK (spice_level BETWEEN 0 AND 7),
  size        TEXT NOT NULL DEFAULT '30 cm',
  price       INTEGER NOT NULL CHECK (price >= 0),
  stock       INTEGER NOT NULL DEFAULT 0,
  image       TEXT NOT NULL DEFAULT '',
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  code           TEXT NOT NULL UNIQUE,
  customer_name  TEXT NOT NULL,
  whatsapp       TEXT NOT NULL,
  address        TEXT NOT NULL DEFAULT '',
  notes          TEXT NOT NULL DEFAULT '',
  total          INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'new',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS order_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id   INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  price        INTEGER NOT NULL,
  qty          INTEGER NOT NULL CHECK (qty > 0),
  subtotal     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  store_name    TEXT NOT NULL,
  tagline       TEXT NOT NULL DEFAULT '',
  whatsapp      TEXT NOT NULL,
  address       TEXT NOT NULL DEFAULT '',
  maps_url      TEXT NOT NULL DEFAULT '',
  hours         TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL DEFAULT '',
  instagram     TEXT NOT NULL DEFAULT '',
  logo          TEXT NOT NULL DEFAULT '',
  banner        TEXT NOT NULL DEFAULT '',
  updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);
`);

/* ------------------------------------------------------------------ seed */

const SEED_CATEGORIES = [
  ['Pedas', 'Pizza dengan level pedas 1–7 dari cabai asli.', 1],
  ['Manis', 'Pizza dessert dengan topping manis.', 2],
  ['Sayur', 'Pilihan vegetarian dengan sayuran segar.', 3],
  ['Mayo', 'Saus mayo creamy melimpah.', 4],
  ['Bundling', 'Paket hemat siap santap bareng.', 5],
];

const SEED_PRODUCTS = [
  ['Sosis Jumbo Sausage Day', 'Sosis sapi jumbo melingkar, mozzarella lumer, dan saus mustard khas Sausage Day.', 'Pedas', 1, '30 cm', 95000, 24, 'sosis-jumbo.svg'],
  ['Pepperoni Firestorm', 'Pepperoni sapi panggang dengan saus tomat pedas dan cabai kering.', 'Pedas', 3, '30 cm', 99000, 18, 'pepperoni-fire.svg'],
  ['Sosis Mayo Lava', 'Sosis ayam, mayo creamy, dan keju cheddar yang meleleh di setiap potongan.', 'Mayo', 1, '30 cm', 89000, 15, 'sosis-mayo.svg'],
  ['Garden Veggie Sausage', 'Paprika, jamur, zaitun, dan sosis nabati di atas saus tomat segar.', 'Sayur', 1, '30 cm', 79000, 12, 'garden-veggie.svg'],
  ['Choco Banana Sweet', 'Pizza dessert cokelat Belgia, pisang, dan taburan almond panggang.', 'Manis', 0, '25 cm', 75000, 9, 'choco-banana.svg'],
  ['Sausage Cheese Bomb', 'Empat lapis keju, sosis sapi, dan drizzle mayo pedas. Untuk pencinta keju.', 'Mayo', 2, '35 cm', 109000, 6, 'cheese-bomb.svg'],
  ['Trio Sausage Party', 'Tiga varian sosis dalam satu pizza besar, cocok untuk 4–5 orang.', 'Bundling', 2, '35 cm', 149000, 5, 'trio-party.svg'],
  ['Pedas Gila Level 7', 'Cabai rawit, pepperoni, dan saus api level maksimal. Tantang dirimu.', 'Pedas', 7, '35 cm', 119000, 4, 'pedas-gila.svg'],
  ['Sausage Day Combo', '2 pizza 30 cm + 2 minuman dingin + 1 saus mustard. Hemat untuk berdua.', 'Bundling', 1, '30 cm', 189000, 7, 'sausage-combo.svg'],
  ['Caramel Almond Sweet', 'Karamel asin, almond slice, dan keju mascarpone di atas crust renyah.', 'Manis', 0, '25 cm', 85000, 0, 'caramel-almond.svg'],
];

function seed() {
  const adminCount = db.prepare('SELECT COUNT(*) AS n FROM admins').get().n;
  if (adminCount === 0) {
    db.prepare('INSERT INTO admins (username, password_hash, created_at) VALUES (?, ?, ?)')
      .run('admin', hashPassword('admin'), nowIso());
  }

  const catCount = db.prepare('SELECT COUNT(*) AS n FROM categories').get().n;
  if (catCount === 0) {
    const insert = db.prepare('INSERT INTO categories (name, description, sort_order, created_at) VALUES (?, ?, ?, ?)');
    for (const c of SEED_CATEGORIES) insert.run(c[0], c[1], c[2], nowIso());
  }

  const prodCount = db.prepare('SELECT COUNT(*) AS n FROM products').get().n;
  if (prodCount === 0) {
    const catId = (name) => (db.prepare('SELECT id FROM categories WHERE name = ?').get(name) || {}).id || null;
    const insert = db.prepare(`INSERT INTO products
      (name, description, category_id, spice_level, size, price, stock, image, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`);
    for (const p of SEED_PRODUCTS) {
      insert.run(p[0], p[1], catId(p[2]), p[3], p[4], p[5], p[6], '/images/' + p[7], nowIso(), nowIso());
    }
  }

  const settingsCount = db.prepare('SELECT COUNT(*) AS n FROM settings').get().n;
  if (settingsCount === 0) {
    db.prepare(`INSERT INTO settings
      (id, store_name, tagline, whatsapp, address, maps_url, hours, contact_email, instagram, logo, banner, updated_at)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'PIZZAKY.AJA',
      'Taste The Happiness — Sausage Day Every Day!',
      '6281234567890',
      'Jl. Sosis Raya No. 17, Kebayoran Baru, Jakarta Selatan',
      'https://maps.google.com/?q=Jl.+Sosis+Raya+No.+17+Jakarta+Selatan',
      'Setiap hari 10.00 – 22.00 WIB',
      'halo@pizzaky.aja',
      '@pizzaky.aja',
      '/images/logo.svg',
      '',
      nowIso()
    );
  }

  seedDemoOrders();
}

/**
 * Demo orders so the dashboard charts and reports are not empty on a fresh install.
 * They are clearly labelled in the admin UI and can be removed with `npm run reset`.
 */
function seedDemoOrders() {
  const orderCount = db.prepare('SELECT COUNT(*) AS n FROM orders').get().n;
  if (orderCount > 0) return;

  const products = db.prepare('SELECT id, name, price FROM products ORDER BY id').all();
  if (!products.length) return;

  const names = ['Budi Santoso', 'Sinta Dewi', 'Rangga Pratama', 'Maya Putri', 'Andi Wijaya', 'Nadia Sari'];
  const statuses = ['done', 'done', 'done', 'shipping', 'making', 'new', 'ready', 'cancelled', 'processing'];
  const picks = [
    [[0, 1], [4, 1]], [[1, 1], [8, 1]], [[2, 2]], [[5, 1], [3, 1]],
    [[6, 1]], [[7, 1], [9, 1]], [[0, 2]], [[3, 1], [2, 1]], [[8, 1]],
  ];

  let seq = 1;
  for (let day = 29; day >= 0; day -= 2) {
    const pick = picks[seq % picks.length];
    const items = pick.map(([idx, qty]) => {
      const p = products[idx % products.length];
      return { ...p, qty };
    });
    const total = items.reduce((s, it) => s + it.price * it.qty, 0);
    const created = new Date(Date.now() - day * 86400000 - (seq % 9) * 3600000).toISOString();
    const code = `PZ-DEMO${String(1000 + seq)}`;
    const status = statuses[seq % statuses.length];
    db.prepare(`INSERT INTO orders (code, customer_name, whatsapp, address, notes, total, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      code, names[seq % names.length], '62812345' + String(1000 + seq), 'Jl. Contoh Alamat No. ' + seq + ', Jakarta',
      'Data contoh (demo)', total, status, created, created
    );
    const orderId = db.prepare('SELECT id FROM orders WHERE code = ?').get(code).id;
    const insItem = db.prepare('INSERT INTO order_items (order_id, product_id, product_name, price, qty, subtotal) VALUES (?, ?, ?, ?, ?, ?)');
    for (const it of items) insItem.run(orderId, it.id, it.name, it.price, it.qty, it.price * it.qty);
    seq++;
  }
}

seed();

module.exports = { db, hashPassword, verifyPassword, nowIso };
