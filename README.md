# PIZZAKY.AJA — Pizza Online Store + Admin Dashboard

Website pemesanan pizza bertema **Sausage Day** dengan brand **PIZZAKY.AJA**, lengkap dengan
dashboard administrator: produk, kategori, pesanan, stok, laporan penjualan, pengaturan toko,
dan akun admin.

Aplikasi ini benar-benar berjalan: website pelanggan dan dashboard admin memakai satu backend
REST + database yang sama, jadi produk yang diubah admin langsung tampil di halaman pelanggan
dan pesanan dari pelanggan langsung masuk ke dashboard.

---

## 1. Menjalankan proyek

```bash
npm install       # sekali saja
npm start         # http://localhost:3000
```

- Website pelanggan: <http://localhost:3000>
- Dashboard admin: <http://localhost:3000/admin>

Mode pengembangan (auto restart): `npm run dev`.
Butuh Node.js 22.5+ (memakai modul bawaan `node:sqlite`, tanpa build native).

### Login admin (kredensial awal)

| Username | Password |
|----------|----------|
| `admin`  | `admin`  |

> Segera ganti username/password lewat menu **Akun Admin** setelah login pertama.
> Password disimpan sebagai hash **scrypt** (bukan plaintext) dan sesi disimpan di server
> (cookie `HttpOnly`, `SameSite=Lax`, 8 jam).

### Reset data

```bash
npm run reset     # hapus database lokal, lalu `npm start` untuk seed ulang
```

---

## 2. Struktur proyek

```
.
├── server/
│   ├── index.js        # Express app + seluruh REST API (publik & admin)
│   ├── db.js           # koneksi SQLite, skema, seed data, hash password
│   └── auth.js         # sesi, cookie, middleware requireAdmin
├── public/
│   ├── index.html      # halaman pelanggan
│   ├── admin.html      # login + shell dashboard admin
│   ├── css/style.css   # desain storefront
│   ├── css/admin.css   # desain dashboard
│   ├── js/app.js       # keranjang, filter, checkout WhatsApp
│   ├── js/admin.js     # CRUD, pesanan, stok, laporan, grafik, pengaturan
│   ├── images/         # artwork pizza (SVG, dibuat oleh tools/make-images.js)
│   └── uploads/        # hasil unggah gambar (dibuat otomatis, tidak di-commit)
├── db/schema.sql       # skema database + catatan migrasi PostgreSQL/MySQL
├── tools/
│   ├── make-images.js  # generator artwork produk
│   └── reset.js        # reset database
├── data/               # database SQLite (dibuat otomatis, tidak di-commit)
└── package.json
```

---

## 3. Fitur

### Halaman pelanggan
- Hero banner bertema Sausage Day, navigasi Beranda / Menu / Lokasi / Tentang / Kontak.
- Pencarian produk, filter kategori (Pedas, Manis, Sayur, Mayo, Bundling), level pedas 1–7,
  ukuran, dan urutan harga termurah/termahal.
- Kartu produk dengan foto, deskripsi, harga, stok real-time; tombol tambah/kurang jumlah.
- Keranjang interaktif (tersimpan di `localStorage`), subtotal & total otomatis.
- Checkout: pesanan **dicatat ke database** lalu diteruskan ke WhatsApp admin.
- Lokasi outlet + peta Google Maps, jam operasional, kontak, Instagram.
- Responsif: desktop, tablet, dan smartphone.

### Dashboard admin
- **Dashboard**: 6 kartu statistik (total produk, pesanan, pendapatan, pesanan baru,
  stok menipis, stok habis) + grafik penjualan harian, bulanan, produk terlaris,
  distribusi kategori, pesanan terbaru, dan daftar restock.
- **Produk**: CRUD penuh, unggah foto, kategori, level pedas, ukuran, harga, stok,
  aktif/nonaktif.
- **Kategori**: CRUD; kategori yang masih dipakai produk tidak bisa dihapus.
- **Pesanan**: tabel pesanan, detail, ubah status (7 status), hapus dengan konfirmasi,
  cari, filter tanggal & status, chat pelanggan.
- **Stok**: lihat stok, tambah/kurangi cepat, atur nilai pasti, peringatan stok menipis/habis.
- **Laporan Penjualan**: total pendapatan, produk terjual, transaksi, rata-rata,
  produk terlaris, penjualan per kategori/harian/bulanan, filter periode, ekspor CSV, cetak.
- **Pengaturan Website**: nama toko, tagline, WhatsApp, alamat, Google Maps, jam buka,
  email, Instagram, unggah logo & banner.
- **Akun Admin**: ganti username, ganti password, lihat sesi login, logout semua perangkat lain.

---

## 4. Alur integrasi pelanggan ⇄ admin

1. Admin login → tambah/ubah produk → tersimpan di database.
2. Halaman pelanggan memuat produk aktif dari `GET /api/store`.
3. Pelanggan menambah ke keranjang dan checkout.
4. `POST /api/orders` memvalidasi stok & harga **di server**, menyimpan pesanan + detail,
   lalu mengurangi stok dalam satu transaksi database.
5. Pesanan muncul di Dashboard/Pesanan admin dengan status **Pesanan Baru**.
6. Admin mengubah status; pesanan **Dibatalkan** mengembalikan stok.
7. Laporan penjualan dihitung dari pesanan yang tidak dibatalkan.

> Membuka WhatsApp bukan bukti pesanan diterima. Pesanan sudah tersimpan di database sebelum
> WhatsApp dibuka, dan konfirmasi final tetap dilakukan admin.

---

## 5. API

Publik:

| Method | Endpoint | Fungsi |
|--------|----------|--------|
| GET | `/api/store` | Pengaturan toko, kategori, produk aktif, daftar status |
| GET | `/api/products` | Produk aktif (mendukung `q`, `category`, `size`, `spice`) |
| POST | `/api/orders` | Buat pesanan (`{name, whatsapp, address, notes, items:[{productId, qty}]}`) |

Admin (cookie sesi wajib):

| Method | Endpoint | Fungsi |
|--------|----------|--------|
| POST | `/api/admin/login` / `logout` | Login / logout |
| GET | `/api/admin/session` | Cek sesi aktif |
| GET | `/api/admin/dashboard` | Statistik + grafik |
| GET/POST | `/api/admin/products` | Daftar / tambah produk |
| PUT/DELETE | `/api/admin/products/:id` | Ubah / hapus produk |
| POST | `/api/admin/products/:id/stock` | `{mode: set\|add\|remove, value}` |
| GET/POST | `/api/admin/categories` | Daftar / tambah kategori |
| PUT/DELETE | `/api/admin/categories/:id` | Ubah / hapus kategori |
| GET | `/api/admin/orders` | Daftar pesanan (`q`, `status`, `from`, `to`) |
| GET | `/api/admin/orders/:id` | Detail pesanan |
| PATCH | `/api/admin/orders/:id/status` | Ubah status |
| DELETE | `/api/admin/orders/:id` | Hapus pesanan + kembalikan stok |
| GET | `/api/admin/reports` | Laporan (`from`, `to`) |
| GET | `/api/admin/reports/export.csv` | Ekspor CSV |
| GET/PUT | `/api/admin/settings` | Baca / simpan pengaturan |
| POST | `/api/admin/upload` | Unggah gambar (multipart field `image`) |
| PUT | `/api/admin/account/username` / `password` | Ganti kredensial |
| GET/DELETE | `/api/admin/account/sessions` | Kelola sesi login |

---

## 6. Keamanan yang sudah diterapkan

- Password admin di-hash dengan **scrypt + salt acak**; verifikasi memakai `timingSafeEqual`.
- Sesi disimpan di database; browser hanya memegang token acak di cookie `HttpOnly`.
- Semua endpoint admin dilindungi middleware `requireAdmin`.
- Harga dan stok pesanan **selalu dihitung ulang di server** dari database, bukan dari browser.
- Pembuatan pesanan, perubahan status, dan penghapusan memakai transaksi database.
- Validasi input di server (nama, WhatsApp, alamat, harga, stok, level pedas, kategori, file).
- Upload gambar dibatasi JPG/PNG/WEBP/GIF maks 3 MB; SVG tidak diterima untuk mencegah XSS.
- Login dibatasi 10 percobaan per IP per 10 menit.
- Cookie `Secure` otomatis aktif saat `NODE_ENV=production` (wajib di balik HTTPS).

---

## 7. Data contoh (demo)

Saat database pertama kali dibuat, aplikasi menambahkan 10 produk contoh dan beberapa
**pesanan demo** (catatan pesanan: `Data contoh (demo)`) agar grafik dan laporan tidak kosong.

- Data ini **bukan** data produksi. Hapus lewat menu **Pesanan → Hapus**, atau jalankan
  `npm run reset` untuk memulai dari nol.
- Ganti nomor WhatsApp, alamat outlet, dan logo di menu **Pengaturan Website** sebelum dipakai.

---

## 8. Deployment produksi

1. **Server**: VPS/VM dengan Node.js 22.5+, lalu `npm ci --omit=dev`.
2. **Environment**:
   - `PORT` (default 3000)
   - `NODE_ENV=production` (mengaktifkan cookie Secure)
   - `DATA_DIR` (lokasi penyimpanan database, default `./data`)
3. **Process manager**: jalankan `node server/index.js` dengan PM2/systemd agar restart otomatis.
4. **Reverse proxy + HTTPS**: Nginx/Cloudflare di depan aplikasi, teruskan header
   `X-Forwarded-*`, dan set `app.set('trust proxy', 1)` bila memakai proxy.
5. **Backup**: salin folder `data/` (SQLite) dan `public/uploads/` secara berkala.
6. **Database produksi**: untuk multi-user berskala besar, migrasikan ke PostgreSQL/MySQL
   menggunakan `db/schema.sql` sebagai acuan. Semua query terpusat di `server/index.js`
   dan `server/db.js` sehingga mudah diganti driver.
7. **Ganti kredensial admin** dan batasi akses `/admin` bila perlu (mis. IP allowlist di Nginx).

---

## 9. Catatan pengembangan

- Artwork pizza adalah SVG yang dibuat oleh `node tools/make-images.js` (tanpa aset eksternal).
- Semua uang disimpan sebagai integer rupiah.
- Untuk mengubah status, label, atau aturan stok: lihat konstanta `STATUSES` di `server/index.js`.
