# Migrasi Supabase - Teleshop

## Isi migrasi

File `migrations/20250207000000_complete_teleshop_schema.sql` berisi schema lengkap database Teleshop:

### Tabel inti
- **User** – Pengguna Telegram (id, saldo, jumlahtransaksi, pengeluaran)
- **Produk** – Produk (nama, kode, harga, format, kategori, data JSONB)
- **Trx** – Transaksi
- **Voucher** – Voucher/diskon
- **Premium** – Produk premium & whitelist
- **Deposit** – Riwayat deposit
- **Stok** – Stok per produk (FK ke Produk)

### Tabel admin & keamanan
- **Admin** – User dashboard (username, password_hash, role)
- **LoginHistory** – Riwayat login admin
- **AuditLog** – Log audit aksi admin

### Komunikasi
- **MessageHistory** – Riwayat broadcast/template
- **MessageTemplate** – Template pesan

### Notifikasi & pengaturan
- **NotificationSettings** – Semua konfigurasi (general, channel, payment, supabase, notifikasi)
- **ProductStockThreshold** – Threshold low stock per produk
- **NotificationLog** – Log notifikasi

Termasuk: extension UUID, index, FK, trigger `updated_at`, RLS + policy, dan seed data default.

## Cara menjalankan

### Opsi 1: Supabase Dashboard (SQL Editor)
1. Buka project di [Supabase Dashboard](https://app.supabase.com).
2. **SQL Editor** → New query.
3. Salin isi `migrations/20250207000000_complete_teleshop_schema.sql` dan jalankan.

### Opsi 2: Supabase CLI
```bash
# Dari root project
npx supabase db push
# atau
supabase migration up
```

Setelah migrasi, buat user admin pertama lewat dashboard atau dengan INSERT ke tabel `"Admin"` (password harus di-hash, misalnya bcrypt).
