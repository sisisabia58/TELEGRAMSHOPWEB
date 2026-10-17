# Telegram Shop Web (Teleshop)

Sistem toko digital berbasis **Telegram Bot** dengan **Dashboard Web** untuk mengelola produk, stok, transaksi, deposit, voucher, dan komunikasi. Database menggunakan **Supabase** (PostgreSQL).

---

## 📋 Daftar Isi

- [Fitur](#-fitur)
- [Persyaratan](#-persyaratan)
- [Instalasi](#-instalasi)
- [Konfigurasi](#-konfigurasi)
- [Menjalankan Aplikasi](#-menjalankan-aplikasi)
- [Struktur Proyek](#-struktur-proyek)
- [Penggunaan Dashboard](#-penggunaan-dashboard)
- [Penggunaan Bot Telegram](#-penggunaan-bot-telegram)
- [Database (Supabase)](#-database-supabase)
- [Troubleshooting](#-troubleshooting)

---

## ✨ Fitur

### Bot Telegram
- Pembelian produk via bot (saldo / deposit)
- Top-up saldo (QRIS / manual)
- Voucher & kode diskon
- Manajemen produk & stok otomatis
- Notifikasi ke channel (log, low stock)
- Integrasi opsional: AriePulsa API

### Dashboard Web
- **Dashboard** – Ringkasan statistik, notifikasi, quick actions
- **Produk** – CRUD produk, kelola stok (tambah/edit/hapus), export CSV
- **Voucher** – Buat/edit/hapus voucher, batasan produk & user
- **Transaksi** – Daftar transaksi, detail, export
- **Deposit** – Approve/reject deposit, export
- **User** – Daftar user, detail, top-up manual, kurangi saldo, reset
- **Bulk Operations** – Import produk (CSV), update harga massal, tambah stok massal, approve/reject deposit massal, export data
- **Communication** – Broadcast pesan, kirim ke user, template pesan, riwayat
- **Analytics** – Grafik penjualan, produk terlaris, statistik user
- **Laporan** – Generate & export laporan
- **Settings** – General, Channel & Contact, Payment Gateway, Supabase, Notifikasi
- **Admin** (role admin) – Kelola admin, riwayat login, audit log

### Keamanan
- Login dengan session, bcrypt password
- Role-based access (admin vs user dashboard)
- Rate limiting login keyed on `req.ip` (trust proxy = 1)
- CSRF token pada form session dan `fetch` POST
- Helmet headers + `X-Powered-By` dimatikan
- `/api/*` tanpa session → 401 JSON
- Audit log & login history
- Session secret konfigurasi via env

---

## 📌 Persyaratan

- **Node.js** 18+ (disarankan LTS)
- **Akun Telegram** & Bot Token dari [@BotFather](https://t.me/BotFather)
- **Supabase** – project untuk database (gratis tier tersedia)
- (Opsional) **AriePulsa** – jika memakai payment/API mereka

---

## 🚀 Instalasi

1. **Clone atau download proyek**
   ```bash
   cd TELEGRAMSHOPWEB
   ```

2. **Pasang dependensi**
   ```bash
   npm install
   ```

3. **Siapkan file environment**
   ```bash
   copy .env.example .env
   ```
   Lalu edit `.env` (lihat [Konfigurasi](#-konfigurasi)).

4. **Jalankan migrasi Supabase**  
   Lihat [Database (Supabase)](#-database-supabase).

---

## ⚙️ Konfigurasi

Salin `.env.example` ke `.env` dan isi nilai berikut:

| Variabel | Deskripsi | Contoh |
|----------|-----------|--------|
| `TOKEN_BOT` | Token bot dari BotFather | `123456:ABC-DEF...` |
| `NAMA_BOT` | Nama bot (tampil di UI) | `Knightz Store` |
| `OWNER_ID` | Telegram User ID pemilik (angka) | `123456789` |
| `IMAGE_PATH` | Path logo (untuk bot) | `./logo.jpg` |
| `CHANNEL_LOG` | Username channel log | `@your_channel_log` |
| `CHANNEL_STORE` | Link channel toko | `https://t.me/your_channel` |
| `CS` | Link/username Customer Service | `https://t.me/your_cs` |
| `SUPABASE_URL` | URL project Supabase | `https://xxx.supabase.co` |
| `SUPABASE_KEY` | Service-role key Supabase (bukan anon/public) | `eyJhbGc...` |
| `ARIEPULSA_APIKEY` | (Opsional) API key AriePulsa | - |
| `JAM_BACKUP` | Jam jadwal backup (0–23) | `5` |
| `ADMIN_USERNAME` | Username login dashboard (env fallback; wajib jika belum ada row Admin) | — |
| `ADMIN_PASSWORD` | Password login dashboard (env fallback; wajib jika belum ada row Admin) | — |
| `SESSION_SECRET` | Secret untuk session (wajib di production) | — |
| `PORT` | Port dashboard web | `3000` |
| `TELEGRAM_API_URL` | (Opsional) Override API Telegram | default: `https://api.telegram.org` |

**Penting:**
- Login dashboard memakai tabel `Admin` (Supabase) terlebih dahulu. Jika tidak ada row yang cocok, fallback ke `ADMIN_USERNAME` dan `ADMIN_PASSWORD`. Selalu set kedua variabel itu, atau buat row Admin; jangan biarkan keduanya kosong. Perilaku fail closed (env kosong menolak fallback) datang bersama hardening PR #47.
- Di production wajib set `SESSION_SECRET` yang kuat dan jangan commit `.env`.
- `SUPABASE_KEY` wajib **service-role** key. `POST /api/bot-flow/publish` memanggil RPC `publish_bot_flow_graph`, dan `EXECUTE` fungsi itu hanya di-GRANT ke `service_role`. Key anon/public membuat publish gagal. Ketentuan yang sama ada di `docs/runbooks/phase13-supplier-sourcing.md`.

---

## ▶️ Menjalankan Aplikasi

Menjalankan **bot Telegram** dan **dashboard web** sekaligus:

```bash
npm start
```

Atau:

```bash
npm run dev
```

- **Bot** berjalan di proses `index.js` (polling Telegram).
- **Dashboard** berjalan di `http://localhost:3000` (atau nilai `PORT` di `.env`).

Hanya jalankan dashboard:

```bash
npm run dashboard
```

### Menjalankan dengan variabel dari Railway

Production secrets untuk repo ini hidup di Railway project **teleshop-improvement-v2** (environment `production`, service `teleshop-improvement-v2`). Jangan commit file `.env` dan jangan menyalin nilai secret ke Cursor secrets kecuali Anda memang ingin duplikasi.

1. Pasang [Railway CLI](https://docs.railway.com/guides/cli) dan autentikasi (`railway login`, atau set `RAILWAY_API_TOKEN` untuk sesi headless).
2. Link project sekali di folder repo:
   ```bash
   railway link
   ```
   Pilih project **teleshop-improvement-v2**, environment **production**, service **teleshop-improvement-v2**.
3. Dashboard saja (disarankan untuk local / Cloud Agent — tidak mem-poll Telegram):
   ```bash
   npm run railway:dashboard
   ```
   Setara dengan `railway run npm run dashboard`. CLI menyuntikkan variabel Railway ke proses; tidak menulis `.env`.
4. Bot + dashboard:
   ```bash
   npm run railway:start
   ```
   Setara dengan `railway run npm start`.

**Konflik polling Telegram:** deployment Railway yang sedang jalan sudah menjalankan `index.js` (long poll). Jangan jalankan poller kedua dengan `TOKEN_BOT` yang sama — Telegram API mengembalikan **409 Conflict**. Untuk cek token, panggil `getMe` sekali (`https://api.telegram.org/bot<token>/getMe`) lalu berhenti; jangan biarkan `polling: true` di mesin kedua.

---

## 📁 Struktur Proyek

```
TELEGRAMSHOPWEB/
├── index.js              # Bot Telegram (logic bot, order, deposit, dll)
├── dashboard.js          # Server Express dashboard web
├── settings.js           # Load config dari .env
├── .env.example          # Contoh variabel environment
├── .env                  # Konfigurasi (jangan di-commit)
├── package.json
├── public/               # Asset web
│   ├── css/              # dashboard.css, login.css
│   └── js/               # notifications.js, ui-utils.js
├── views/                # Template EJS
│   ├── partials/        # head.ejs, topbar.ejs, sidebar.ejs, mobile-tabs.ejs
│   ├── dashboard.ejs, login.ejs, produk.ejs, transaksi.ejs, user.ejs, ...
│   └── ...
├── Database/             # (Opsional) File JSON lokal jika tidak pakai Supabase
│   └── Trx/
├── supabase/
│   ├── migrations/
│   │   └── 20250207000000_complete_teleshop_schema.sql   # Schema lengkap
│   └── README.md         # Cara jalankan migrasi
└── logo.jpg              # Logo bot
```

---

## 🖥️ Penggunaan Dashboard

1. Buka browser: `http://localhost:3000`
2. Login dengan:
   - **Admin dari database**: username & password yang sudah didaftarkan di tabel `Admin`.
   - **Fallback**: `ADMIN_USERNAME` dan `ADMIN_PASSWORD` dari environment (selalu set keduanya, atau buat row Admin). Fail closed tiba di PR #47.

### Menu utama

| Menu | Fungsi |
|------|--------|
| **Dashboard** | Statistik, notifikasi, akses cepat |
| **Produk** | Daftar produk, tambah/edit/hapus, kelola stok per produk, export stok CSV |
| **Voucher** | Buat/edit/hapus voucher, export |
| **Transaksi** | Lihat & export transaksi |
| **Deposit** | Daftar deposit, approve/reject, export |
| **User** | Daftar user, detail, top-up/kurangi saldo, reset |
| **Bulk Operations** | Import produk CSV, update harga massal, tambah stok massal, approve/reject deposit massal, export |
| **Communication** | Broadcast, kirim ke user, template pesan, riwayat |
| **Analytics** | Grafik & statistik penjualan/user/produk |
| **Reports** | Generate & export laporan |
| **Settings** | General, Channel & Contact, Payment Gateway, Supabase, Notifikasi |
| **Admin** (hanya role admin) | Kelola admin, login history, audit log |

---

## 🤖 Penggunaan Bot Telegram

- User memulai bot dengan `/start`.
- Pembelian: pilih kategori/produk, jumlah, bayar dengan saldo (atau deposit dulu).
- Perintah owner (sesuai `OWNER_ID`) bisa mencakup: tambah produk, stok, lihat laporan, export, dll (implementasi detail ada di `index.js`).
- Notifikasi (misal low stock, transaksi) bisa dikirim ke `CHANNEL_LOG` dan pengaturan di **Settings → Channel & Contact** (atau dari DB).

---

## 🗄️ Database (Supabase)

1. Buat project di [Supabase](https://supabase.com).
2. Di **Project Settings → API** ambil **Project URL** dan **service_role** key (bukan anon/public) → isi `SUPABASE_URL` dan `SUPABASE_KEY` di `.env`. Publish bot flow membutuhkan key ini karena RPC `publish_bot_flow_graph` tidak bisa dijalankan dengan key anon.
3. Jalankan schema database:
   - Buka **SQL Editor** di dashboard Supabase.
   - Salin isi `supabase/migrations/20250207000000_complete_teleshop_schema.sql`.
   - Jalankan query.

Detail tabel dan opsi CLI ada di `supabase/README.md`.

Setelah migrasi, buat admin pertama lewat **Dashboard** (jika ada fitur tambah admin) atau dengan `INSERT` ke tabel `"Admin"` (password harus di-hash bcrypt).

---

## 🔧 Troubleshooting

| Masalah | Solusi |
|--------|--------|
| Bot tidak merespons | Cek `TOKEN_BOT`, koneksi internet, dan log di konsol (`index.js`). |
| Dashboard tidak bisa login | Pastikan migrasi Supabase sudah dijalankan dan ada row di `Admin`, atau set `ADMIN_USERNAME` dan `ADMIN_PASSWORD`. Jangan biarkan env kosong. Fail closed tiba di PR #47. |
| Error Supabase / "relation does not exist" | Jalankan ulang file migrasi `20250207000000_complete_teleshop_schema.sql` di SQL Editor. |
| Port 3000 sudah dipakai | Set `PORT=3001` (atau lain) di `.env`. |
| Session hilang / logout terus | Set `SESSION_SECRET` di `.env`; di production pastikan nilainya unik dan rahasia. |

---

## 📜 Lisensi

ISC (lihat `package.json`).

---

**Telegram Shop Web** – Bot toko + Dashboard manajemen dengan Supabase.
