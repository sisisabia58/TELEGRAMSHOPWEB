-- ============================================
-- MIGRASI SUPABASE LENGKAP - TELESHOP
-- ============================================
-- Seluruh schema database dalam satu migrasi.
-- Jalankan via Supabase SQL Editor atau: supabase db push
-- ============================================

-- Extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- 1. TABEL UTAMA (CORE)
-- ============================================

CREATE TABLE IF NOT EXISTS "User" (
    id BIGINT PRIMARY KEY,
    jumlahtransaksi INTEGER DEFAULT 0 NOT NULL,
    pengeluaran INTEGER DEFAULT 0 NOT NULL,
    saldo INTEGER DEFAULT 0 NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_id ON "User"(id);

CREATE TABLE IF NOT EXISTS "Produk" (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nama TEXT NOT NULL,
    kode TEXT UNIQUE NOT NULL,
    harga INTEGER NOT NULL CHECK (harga >= 0),
    deskripsi TEXT NOT NULL,
    snk TEXT NOT NULL,
    format TEXT,
    kategori TEXT DEFAULT 'umum',
    data JSONB DEFAULT '[]'::jsonb NOT NULL,
    terjual INTEGER DEFAULT 0 NOT NULL CHECK (terjual >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_produk_kode ON "Produk"(LOWER(kode));
CREATE INDEX IF NOT EXISTS idx_produk_nama ON "Produk"(nama);
CREATE INDEX IF NOT EXISTS idx_produk_kategori ON "Produk"(LOWER(kategori));

CREATE TABLE IF NOT EXISTS "Trx" (
    trx_uuid UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    id BIGINT NOT NULL,
    nama TEXT NOT NULL,
    kode TEXT NOT NULL,
    jumlah INTEGER NOT NULL CHECK (jumlah > 0),
    harga INTEGER NOT NULL CHECK (harga >= 0),
    tanggal TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    trxid TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_trx_id ON "Trx"(id);
CREATE INDEX IF NOT EXISTS idx_trx_kode ON "Trx"(kode);
CREATE INDEX IF NOT EXISTS idx_trx_tanggal ON "Trx"(tanggal);
CREATE INDEX IF NOT EXISTS idx_trx_trxid ON "Trx"(trxid);

CREATE TABLE IF NOT EXISTS "Voucher" (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    kode TEXT UNIQUE NOT NULL,
    produk JSONB DEFAULT '[]'::jsonb NOT NULL,
    potongan INTEGER NOT NULL CHECK (potongan >= 0),
    "limit" INTEGER NOT NULL CHECK ("limit" >= 0),
    "user" JSONB DEFAULT '[]'::jsonb NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_voucher_kode ON "Voucher"(LOWER(kode));

CREATE TABLE IF NOT EXISTS "Premium" (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    kode TEXT UNIQUE NOT NULL,
    "user" JSONB DEFAULT '[]'::jsonb NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_premium_kode ON "Premium"(LOWER(kode));

CREATE TABLE IF NOT EXISTS "Deposit" (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id BIGINT NOT NULL,
    jumlah INTEGER NOT NULL CHECK (jumlah > 0),
    fee INTEGER DEFAULT 0 NOT NULL CHECK (fee >= 0),
    total INTEGER NOT NULL CHECK (total > 0),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed', 'expired')),
    kode_deposit TEXT UNIQUE NOT NULL,
    metode TEXT NOT NULL DEFAULT 'qris' CHECK (metode IN ('qris', 'manual')),
    tanggal TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_deposit_user_id ON "Deposit"(user_id);
CREATE INDEX IF NOT EXISTS idx_deposit_kode_deposit ON "Deposit"(kode_deposit);
CREATE INDEX IF NOT EXISTS idx_deposit_status ON "Deposit"(status);
CREATE INDEX IF NOT EXISTS idx_deposit_tanggal ON "Deposit"(tanggal);

CREATE TABLE IF NOT EXISTS "Stok" (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    produk_id UUID NOT NULL,
    produk_kode TEXT NOT NULL,
    data TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'tersedia' CHECK (status IN ('tersedia', 'terjual', 'expired', 'dihapus')),
    terjual_at TIMESTAMP WITH TIME ZONE,
    trx_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stok_produk_id ON "Stok"(produk_id);
CREATE INDEX IF NOT EXISTS idx_stok_produk_kode ON "Stok"(produk_kode);
CREATE INDEX IF NOT EXISTS idx_stok_status ON "Stok"(status);
CREATE INDEX IF NOT EXISTS idx_stok_trx_id ON "Stok"(trx_id);
CREATE INDEX IF NOT EXISTS idx_stok_created_at ON "Stok"(created_at);
ALTER TABLE "Stok"
    ADD CONSTRAINT fk_stok_produk
    FOREIGN KEY (produk_id) REFERENCES "Produk"(id) ON DELETE CASCADE;

-- ============================================
-- 2. FUNGSI & TRIGGER updated_at
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_user_updated_at ON "User";
CREATE TRIGGER update_user_updated_at BEFORE UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_produk_updated_at ON "Produk";
CREATE TRIGGER update_produk_updated_at BEFORE UPDATE ON "Produk" FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_voucher_updated_at ON "Voucher";
CREATE TRIGGER update_voucher_updated_at BEFORE UPDATE ON "Voucher" FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_premium_updated_at ON "Premium";
CREATE TRIGGER update_premium_updated_at BEFORE UPDATE ON "Premium" FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_deposit_updated_at ON "Deposit";
CREATE TRIGGER update_deposit_updated_at BEFORE UPDATE ON "Deposit" FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_stok_updated_at ON "Stok";
CREATE TRIGGER update_stok_updated_at BEFORE UPDATE ON "Stok" FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 3. TABEL KEAMANAN & ADMIN
-- ============================================

CREATE TABLE IF NOT EXISTS "Admin" (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff', 'viewer')),
    is_active BOOLEAN DEFAULT true NOT NULL,
    last_login TIMESTAMP WITH TIME ZONE,
    last_login_ip TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_username ON "Admin"(LOWER(username));
CREATE INDEX IF NOT EXISTS idx_admin_role ON "Admin"(role);

CREATE TABLE IF NOT EXISTS "LoginHistory" (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    admin_id UUID,
    username TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
    login_time TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_history_admin_id ON "LoginHistory"(admin_id);
CREATE INDEX IF NOT EXISTS idx_login_history_login_time ON "LoginHistory"(login_time);
CREATE INDEX IF NOT EXISTS idx_login_history_status ON "LoginHistory"(status);

CREATE TABLE IF NOT EXISTS "AuditLog" (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    admin_id UUID,
    username TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    details JSONB,
    ip_address TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_log_admin_id ON "AuditLog"(admin_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON "AuditLog"(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON "AuditLog"(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity_type ON "AuditLog"(entity_type);

DROP TRIGGER IF EXISTS update_admin_updated_at ON "Admin";
CREATE TRIGGER update_admin_updated_at BEFORE UPDATE ON "Admin" FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 4. TABEL KOMUNIKASI
-- ============================================

CREATE TABLE IF NOT EXISTS "MessageHistory" (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    admin_id UUID REFERENCES "Admin"(id),
    username TEXT NOT NULL,
    message_type TEXT NOT NULL CHECK (message_type IN ('broadcast', 'single', 'template')),
    recipient_type TEXT NOT NULL CHECK (recipient_type IN ('all', 'user', 'group')),
    recipient_id BIGINT,
    recipient_count INTEGER DEFAULT 0,
    message_text TEXT NOT NULL,
    template_id UUID,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'completed', 'failed', 'partial')),
    success_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    error_details JSONB,
    sent_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_message_history_admin_id ON "MessageHistory"(admin_id);
CREATE INDEX IF NOT EXISTS idx_message_history_type ON "MessageHistory"(message_type);
CREATE INDEX IF NOT EXISTS idx_message_history_status ON "MessageHistory"(status);
CREATE INDEX IF NOT EXISTS idx_message_history_created_at ON "MessageHistory"(created_at DESC);

CREATE TABLE IF NOT EXISTS "MessageTemplate" (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'general' CHECK (category IN ('general', 'promo', 'notification', 'announcement', 'custom')),
    subject TEXT,
    message_text TEXT NOT NULL,
    variables JSONB DEFAULT '[]'::jsonb,
    is_active BOOLEAN DEFAULT true NOT NULL,
    created_by UUID REFERENCES "Admin"(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_message_template_category ON "MessageTemplate"(category);
CREATE INDEX IF NOT EXISTS idx_message_template_active ON "MessageTemplate"(is_active);

DROP TRIGGER IF EXISTS update_message_template_updated_at ON "MessageTemplate";
CREATE TRIGGER update_message_template_updated_at BEFORE UPDATE ON "MessageTemplate" FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 5. TABEL NOTIFIKASI & PENGATURAN
-- ============================================

CREATE TABLE IF NOT EXISTS "NotificationSettings" (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    setting_key TEXT UNIQUE NOT NULL,
    setting_value JSONB NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS "ProductStockThreshold" (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    produk_id UUID NOT NULL REFERENCES "Produk"(id) ON DELETE CASCADE,
    threshold INTEGER NOT NULL DEFAULT 10 CHECK (threshold >= 0),
    is_active BOOLEAN DEFAULT true NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    UNIQUE(produk_id)
);
CREATE INDEX IF NOT EXISTS idx_product_stock_threshold_produk_id ON "ProductStockThreshold"(produk_id);

CREATE TABLE IF NOT EXISTS "NotificationLog" (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    notification_type TEXT NOT NULL CHECK (notification_type IN ('deposit_pending', 'low_stock', 'large_transaction', 'system')),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    data JSONB,
    is_read BOOLEAN DEFAULT false NOT NULL,
    admin_id UUID REFERENCES "Admin"(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notification_log_type ON "NotificationLog"(notification_type);
CREATE INDEX IF NOT EXISTS idx_notification_log_read ON "NotificationLog"(is_read);
CREATE INDEX IF NOT EXISTS idx_notification_log_created_at ON "NotificationLog"(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_log_admin_id ON "NotificationLog"(admin_id);

DROP TRIGGER IF EXISTS update_notification_settings_updated_at ON "NotificationSettings";
CREATE TRIGGER update_notification_settings_updated_at BEFORE UPDATE ON "NotificationSettings" FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_product_stock_threshold_updated_at ON "ProductStockThreshold";
CREATE TRIGGER update_product_stock_threshold_updated_at BEFORE UPDATE ON "ProductStockThreshold" FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 6. KOLOM TAMBAHAN PRODUK (jika belum ada)
-- ============================================

ALTER TABLE "Produk" ADD COLUMN IF NOT EXISTS format TEXT;
ALTER TABLE "Produk" ADD COLUMN IF NOT EXISTS kategori TEXT DEFAULT 'umum';
UPDATE "Produk" SET kategori = 'umum' WHERE kategori IS NULL;

-- ============================================
-- 7. ROW LEVEL SECURITY (RLS) & POLICIES
-- ============================================

ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Produk" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Trx" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Voucher" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Premium" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Deposit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Stok" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Admin" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LoginHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MessageHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MessageTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationSettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductStockThreshold" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationLog" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for service role" ON "User";
CREATE POLICY "Allow all for service role" ON "User" FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow all for service role" ON "Produk";
CREATE POLICY "Allow all for service role" ON "Produk" FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow all for service role" ON "Trx";
CREATE POLICY "Allow all for service role" ON "Trx" FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow all for service role" ON "Voucher";
CREATE POLICY "Allow all for service role" ON "Voucher" FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow all for service role" ON "Premium";
CREATE POLICY "Allow all for service role" ON "Premium" FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow all for service role" ON "Deposit";
CREATE POLICY "Allow all for service role" ON "Deposit" FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow all for service role" ON "Stok";
CREATE POLICY "Allow all for service role" ON "Stok" FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow all for service role" ON "Admin";
CREATE POLICY "Allow all for service role" ON "Admin" FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow all for service role" ON "LoginHistory";
CREATE POLICY "Allow all for service role" ON "LoginHistory" FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow all for service role" ON "AuditLog";
CREATE POLICY "Allow all for service role" ON "AuditLog" FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow all for service role" ON "MessageHistory";
CREATE POLICY "Allow all for service role" ON "MessageHistory" FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow all for service role" ON "MessageTemplate";
CREATE POLICY "Allow all for service role" ON "MessageTemplate" FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow all for service role" ON "NotificationSettings";
CREATE POLICY "Allow all for service role" ON "NotificationSettings" FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow all for service role" ON "ProductStockThreshold";
CREATE POLICY "Allow all for service role" ON "ProductStockThreshold" FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow all for service role" ON "NotificationLog";
CREATE POLICY "Allow all for service role" ON "NotificationLog" FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- 8. SEED DATA (Pengaturan default)
-- ============================================

-- Notification & alert defaults
INSERT INTO "NotificationSettings" (setting_key, setting_value, description) VALUES
('low_stock_threshold', '{"default": 10, "enabled": true}', 'Default threshold untuk low stock alert'),
('large_transaction_threshold', '{"amount": 1000000, "enabled": true}', 'Threshold untuk notifikasi transaksi besar (dalam rupiah)'),
('deposit_notification_enabled', '{"enabled": true}', 'Enable/disable notifikasi deposit pending'),
('stock_notification_enabled', '{"enabled": true}', 'Enable/disable notifikasi low stock'),
('transaction_notification_enabled', '{"enabled": true}', 'Enable/disable notifikasi transaksi besar')
ON CONFLICT (setting_key) DO NOTHING;

-- General settings
INSERT INTO "NotificationSettings" (setting_key, setting_value, description) VALUES
('bot_name', '{"value": "Teleshop Bot"}', 'Nama bot yang ditampilkan di dashboard'),
('bot_logo', '{"value": ""}', 'URL logo bot (opsional)'),
('currency', '{"symbol": "Rp", "code": "IDR", "position": "before"}', 'Pengaturan mata uang'),
('timezone', '{"value": "Asia/Jakarta"}', 'Timezone untuk dashboard'),
('date_format', '{"value": "DD/MM/YYYY"}', 'Format tanggal'),
('time_format', '{"value": "24h"}', 'Format waktu (12h atau 24h)'),
('language', '{"value": "id"}', 'Bahasa default'),
('items_per_page', '{"value": 20}', 'Jumlah item per halaman'),
('auto_refresh', '{"enabled": true, "interval": 30}', 'Auto refresh dashboard (detik)'),
('dashboard_theme', '{"value": "light"}', 'Theme dashboard (light atau dark)')
ON CONFLICT (setting_key) DO NOTHING;

-- Channel & contact
INSERT INTO "NotificationSettings" (setting_key, setting_value, description) VALUES
('channel_log', '{"value": ""}', 'Username atau link channel Telegram untuk log'),
('channel_store', '{"value": ""}', 'Link channel/store Telegram'),
('cs', '{"value": ""}', 'Link Customer Service')
ON CONFLICT (setting_key) DO NOTHING;

-- Payment gateway
INSERT INTO "NotificationSettings" (setting_key, setting_value, description) VALUES
('payment_gateway_enabled', '{"value": true}', 'Status aktif/nonaktif payment gateway'),
('payment_gateway_api_key', '{"value": ""}', 'API Key dari payment gateway provider'),
('payment_gateway_qris_channel', '{"value": "QRISREALTIME"}', 'Kode channel untuk QRIS payment'),
('payment_gateway_api_endpoint', '{"value": "https://ariepulsa.my.id/api/qrisrealtime"}', 'URL endpoint API payment gateway'),
('payment_gateway_timeout', '{"value": 10}', 'Waktu expired untuk payment (menit)'),
('payment_gateway_qris_enabled', '{"value": true}', 'Status pembayaran QRIS'),
('payment_gateway_saldo_enabled', '{"value": true}', 'Status pembayaran menggunakan saldo')
ON CONFLICT (setting_key) DO NOTHING;

-- Supabase settings
INSERT INTO "NotificationSettings" (setting_key, setting_value, description) VALUES
('supabase_url', '{"value": ""}', 'URL Supabase project'),
('supabase_key', '{"value": ""}', 'Supabase API Key (anon/public key)'),
('supabase_service_key', '{"value": ""}', 'Supabase Service Role Key (opsional)'),
('supabase_enabled', '{"value": true}', 'Status koneksi ke Supabase'),
('supabase_connection_timeout', '{"value": 30}', 'Timeout koneksi (detik)'),
('supabase_retry_attempts', '{"value": 3}', 'Jumlah percobaan retry'),
('supabase_retry_delay', '{"value": 1000}', 'Delay antar retry (ms)')
ON CONFLICT (setting_key) DO NOTHING;

-- Template pesan default (skip jika sudah ada data)
INSERT INTO "MessageTemplate" (name, category, subject, message_text, variables) 
SELECT 'Deposit Berhasil', 'notification', 'Deposit Diterima', '✅ *DEPOSIT BERHASIL*\n\nSaldo Anda telah ditambahkan sebesar *{amount}*\n\nSaldo saat ini: *{saldo}*', '["amount", "saldo"]'
WHERE NOT EXISTS (SELECT 1 FROM "MessageTemplate" WHERE name = 'Deposit Berhasil' AND category = 'notification');
INSERT INTO "MessageTemplate" (name, category, subject, message_text, variables) 
SELECT 'Transaksi Berhasil', 'notification', 'Pembelian Berhasil', '✅ *TRANSAKSI BERHASIL*\n\nProduk: *{produk}*\nJumlah: *{jumlah}*\nTotal: *{total}*', '["produk", "jumlah", "total"]'
WHERE NOT EXISTS (SELECT 1 FROM "MessageTemplate" WHERE name = 'Transaksi Berhasil' AND category = 'notification');
INSERT INTO "MessageTemplate" (name, category, subject, message_text, variables) 
SELECT 'Promo Spesial', 'promo', 'Promo Menarik', '🎉 *PROMO SPESIAL*\n\n{message}\n\nJangan lewatkan kesempatan ini!', '["message"]'
WHERE NOT EXISTS (SELECT 1 FROM "MessageTemplate" WHERE name = 'Promo Spesial' AND category = 'promo');
INSERT INTO "MessageTemplate" (name, category, subject, message_text, variables) 
SELECT 'Maintenance', 'announcement', 'Maintenance', '⚠️ *MAINTENANCE*\n\n{message}\n\nTerima kasih atas pengertiannya.', '["message"]'
WHERE NOT EXISTS (SELECT 1 FROM "MessageTemplate" WHERE name = 'Maintenance' AND category = 'announcement');

-- ============================================
-- 9. KOMENTAR (Dokumentasi)
-- ============================================

COMMENT ON TABLE "User" IS 'Data pengguna Telegram bot';
COMMENT ON TABLE "Produk" IS 'Data produk yang dijual';
COMMENT ON TABLE "Trx" IS 'Riwayat transaksi';
COMMENT ON TABLE "Voucher" IS 'Kode voucher/diskon';
COMMENT ON TABLE "Premium" IS 'Produk premium dan whitelist user';
COMMENT ON TABLE "Deposit" IS 'Riwayat deposit saldo user';
COMMENT ON TABLE "Stok" IS 'Item stok per produk';
COMMENT ON TABLE "Admin" IS 'User dashboard admin';
COMMENT ON TABLE "LoginHistory" IS 'Riwayat login admin';
COMMENT ON TABLE "AuditLog" IS 'Log audit aksi admin';
COMMENT ON TABLE "MessageHistory" IS 'Riwayat pesan broadcast/template';
COMMENT ON TABLE "MessageTemplate" IS 'Template pesan';
COMMENT ON TABLE "NotificationSettings" IS 'Pengaturan notifikasi dan konfigurasi umum';
COMMENT ON TABLE "ProductStockThreshold" IS 'Threshold low stock per produk';
COMMENT ON COLUMN "Produk".format IS 'Format produk. Jika NULL, auto-detect dari data stok.';
COMMENT ON COLUMN "Produk".kategori IS 'Kategori produk (Game, Streaming, Software, dll).';
