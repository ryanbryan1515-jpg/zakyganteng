-- =============================================================================
-- PIZZAKY.AJA — skema database (SQLite)
-- Aplikasi membuat file ini otomatis di data/pizzaky.db saat server pertama kali
-- dijalankan. File ini adalah referensi skema untuk migrasi ke PostgreSQL/MySQL.
-- =============================================================================

CREATE TABLE admins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,          -- scrypt: scrypt$<salt>$<hash>
  created_at    TEXT NOT NULL
);

CREATE TABLE sessions (
  token      TEXT PRIMARY KEY,          -- 32 byte hex, dikirim via cookie httpOnly
  admin_id   INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT NOT NULL DEFAULT ''
);

CREATE TABLE categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE TABLE products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  spice_level INTEGER NOT NULL DEFAULT 0 CHECK (spice_level BETWEEN 0 AND 7),
  size        TEXT NOT NULL DEFAULT '30 cm',
  price       INTEGER NOT NULL CHECK (price >= 0),   -- rupiah, integer
  stock       INTEGER NOT NULL DEFAULT 0,
  image       TEXT NOT NULL DEFAULT '',
  active      INTEGER NOT NULL DEFAULT 1,            -- 1 tampil, 0 disembunyikan
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE orders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT NOT NULL UNIQUE,   -- contoh: PZ-261124-A1B2C3
  customer_name TEXT NOT NULL,
  whatsapp      TEXT NOT NULL,
  address       TEXT NOT NULL DEFAULT '',
  notes         TEXT NOT NULL DEFAULT '',
  total         INTEGER NOT NULL,       -- dihitung server, bukan dari browser
  status        TEXT NOT NULL DEFAULT 'new',
                -- new | processing | making | ready | shipping | done | cancelled
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE order_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id   INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,           -- snapshot nama saat dipesan
  price        INTEGER NOT NULL,        -- snapshot harga saat dipesan
  qty          INTEGER NOT NULL CHECK (qty > 0),
  subtotal     INTEGER NOT NULL
);

CREATE TABLE settings (
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

CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_orders_created ON orders(created_at);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_items_order ON order_items(order_id);

-- =============================================================================
-- Catatan produksi (PostgreSQL / MySQL)
-- -----------------------------------------------------------------------------
-- 1. Ganti AUTOINCREMENT dengan SERIAL / AUTO_INCREMENT.
-- 2. Ganti TEXT tanggal dengan TIMESTAMPTZ (PostgreSQL) atau DATETIME (MySQL).
-- 3. Ganti INTEGER harga/stok dengan BIGINT / INT bila perlu.
-- 4. Semua operasi multi-tabel (buat pesanan, ubah status, hapus pesanan) harus
--    dibungkus transaksi — implementasi saat ini memakai BEGIN IMMEDIATE.
-- 5. Password disimpan sebagai hash scrypt (crypto.scryptSync) dengan salt acak.
-- =============================================================================
