-- Phase 13 — Multi-supplier reseller sourcing.
--
-- Sumber stok ketiga, MENAMBAH dua sumber yang sudah ada (tambah manual dan
-- bulk upload), bukan menggantinya. Migrasi ini murni aditif:
--   * tabel "Stok" TIDAK disentuh sama sekali — stok supplier tidak pernah
--     ditulis ke sana (fulfillment just-in-time, key langsung dikirim ke
--     pembeli dan dicatat di "SupplierOrder")
--   * "Produk", "Trx", "HargaTier", "User" tidak berubah
--   * "Varian" hanya kebagian satu kolom baru dengan DEFAULT, jadi semua baris
--     lama otomatis bernilai 'sendiri' dan perilakunya persis seperti sebelumnya
--
-- Tidak ada DROP dan tidak ada penulisan ulang data, jadi rollback = nonaktifkan
-- supplier; toko kembali berjalan dengan sumber 1 dan 2.

SET search_path TO public, extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- Varian.sumber — 'sendiri' = varian milik kita (harga diatur admin, stok dari
-- tabel "Stok"). 'supplier' = varian yang DIBUAT oleh sync karena tidak ada
-- padanannya di katalog kita; harganya dikelola sync dan read-only di dashboard.
-- Sync tidak pernah mengubah harga varian 'sendiri'.
-- ---------------------------------------------------------------------------
ALTER TABLE "Varian"
  ADD COLUMN IF NOT EXISTS sumber TEXT NOT NULL DEFAULT 'sendiri';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'varian_sumber_check'
  ) THEN
    ALTER TABLE "Varian"
      ADD CONSTRAINT varian_sumber_check CHECK (sumber IN ('sendiri', 'supplier'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Supplier — satu penjual yang tersambung.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "Supplier" (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nama TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    adapter TEXT NOT NULL DEFAULT 'bitestore',
    base_url TEXT NOT NULL,
    api_key TEXT NOT NULL DEFAULT '',
    is_active BOOLEAN NOT NULL DEFAULT true,
    -- Penentu urutan kalau dua penawaran harganya sama persis. Kecil = menang.
    prioritas INTEGER NOT NULL DEFAULT 0,
    last_sync_at TIMESTAMPTZ,
    last_sync_status TEXT,
    last_sync_error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_supplier_active ON "Supplier"(is_active) WHERE is_active;

-- ---------------------------------------------------------------------------
-- SupplierProduct — cermin katalog supplier; satu baris = satu PENAWARAN.
-- Harga IDR TIDAK disimpan: dihitung saat dibaca dari harga_asal + kurs + margin
-- yang berlaku, supaya mengubah margin/kurs langsung terasa dan tidak pernah
-- meninggalkan baris basi.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "SupplierProduct" (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    supplier_id UUID NOT NULL REFERENCES "Supplier"(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    nama TEXT NOT NULL,
    deskripsi TEXT NOT NULL DEFAULT '',
    harga_asal NUMERIC(12,4) NOT NULL DEFAULT 0 CHECK (harga_asal >= 0),
    currency TEXT NOT NULL DEFAULT 'USD',
    stok INTEGER NOT NULL DEFAULT 0 CHECK (stok >= 0),
    in_stock BOOLEAN NOT NULL DEFAULT false,
    -- ON DELETE SET NULL: menghapus produk tidak pernah ikut menghapus data
    -- supplier, penawarannya cuma jadi tidak terpetakan.
    varian_id UUID REFERENCES "Varian"(id) ON DELETE SET NULL,
    -- 'manual' = admin memetakan sendiri; auto-matcher DILARANG menimpanya.
    mapping_mode TEXT NOT NULL DEFAULT 'unmapped'
        CHECK (mapping_mode IN ('auto', 'manual', 'unmapped')),
    is_available BOOLEAN NOT NULL DEFAULT true,
    last_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    UNIQUE (supplier_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_supplierproduct_varian
    ON "SupplierProduct"(varian_id) WHERE is_available;
CREATE INDEX IF NOT EXISTS idx_supplierproduct_supplier
    ON "SupplierProduct"(supplier_id);

-- ---------------------------------------------------------------------------
-- SupplierOrder — jejak audit + modal/jual untuk tiap pembelian yang dipenuhi
-- supplier. idempotency_key UNIK supaya percobaan ulang tidak pernah membuat
-- pesanan ganda ke penjual.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "SupplierOrder" (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    supplier_id UUID REFERENCES "Supplier"(id) ON DELETE SET NULL,
    supplier_product_id UUID REFERENCES "SupplierProduct"(id) ON DELETE SET NULL,
    varian_id UUID REFERENCES "Varian"(id) ON DELETE SET NULL,
    trx_id TEXT NOT NULL,
    idempotency_key TEXT UNIQUE NOT NULL,
    external_order_id TEXT,
    user_id BIGINT,
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    modal_asal NUMERIC(12,4) NOT NULL DEFAULT 0,
    modal_currency TEXT NOT NULL DEFAULT 'USD',
    jual_idr INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ok'
        CHECK (status IN ('ok', 'failed', 'refunded')),
    error TEXT,
    delivered JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_supplierorder_trx ON "SupplierOrder"(trx_id);
CREATE INDEX IF NOT EXISTS idx_supplierorder_created ON "SupplierOrder"(created_at DESC);

-- ---------------------------------------------------------------------------
-- Trigger updated_at (fungsi bersama dari migrasi baseline).
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS update_supplier_updated_at ON "Supplier";
CREATE TRIGGER update_supplier_updated_at
    BEFORE UPDATE ON "Supplier"
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_supplierproduct_updated_at ON "SupplierProduct";
CREATE TRIGGER update_supplierproduct_updated_at
    BEFORE UPDATE ON "SupplierProduct"
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_supplierorder_updated_at ON "SupplierOrder";
CREATE TRIGGER update_supplierorder_updated_at
    BEFORE UPDATE ON "SupplierOrder"
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---------------------------------------------------------------------------
-- RLS (aplikasi memakai service key).
-- ---------------------------------------------------------------------------
ALTER TABLE "Supplier" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for service role" ON "Supplier";
CREATE POLICY "Allow all for service role" ON "Supplier"
    FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE "SupplierProduct" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for service role" ON "SupplierProduct";
CREATE POLICY "Allow all for service role" ON "SupplierProduct"
    FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE "SupplierOrder" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for service role" ON "SupplierOrder";
CREATE POLICY "Allow all for service role" ON "SupplierOrder"
    FOR ALL USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Pengaturan default reseller (tabel key-value "NotificationSettings").
-- Konvensi nilai skalar: { "value": X }.
-- ---------------------------------------------------------------------------
INSERT INTO "NotificationSettings" (setting_key, setting_value, description) VALUES
    ('reseller_margin_persen',       '{"value": 10}',          'Margin keuntungan global untuk produk supplier (persen)'),
    ('reseller_rounding',            '{"value": 500}',         'Pembulatan harga jual ke atas (rupiah). 0 = tanpa pembulatan'),
    ('fx_mode',                      '{"value": "auto"}',      'Sumber kurs USD-IDR: auto (ambil harian) atau manual'),
    ('fx_usd_idr',                   '{"value": 16500}',       'Kurs USD ke IDR terakhir yang diketahui baik'),
    ('fx_buffer_persen',             '{"value": 2}',           'Buffer pengaman di atas kurs pasar (persen)'),
    ('supplier_sync_interval_menit', '{"value": 5}',           'Interval sinkronisasi katalog supplier (menit)'),
    ('supplier_kategori_default',    '{"value": "reseller"}',  'Kategori untuk produk yang dibuat otomatis oleh sync'),
    ('supplier_wallet_min_usd',      '{"value": 5}',           'Ambang saldo dompet supplier untuk peringatan (USD)')
ON CONFLICT (setting_key) DO NOTHING;
