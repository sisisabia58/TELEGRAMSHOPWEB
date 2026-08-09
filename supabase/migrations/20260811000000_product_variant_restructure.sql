-- Destructive by design: pre-launch, test data only.
-- Leaves User, Deposit, Payment, Voucher, Premium, Admin/*, BotSession, Notification* alone.

-- Supabase hosts uuid-ossp in the extensions schema; ensure defaults resolve.
SET search_path TO public, extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

DROP TABLE IF EXISTS "ProductStockThreshold" CASCADE;
DROP TABLE IF EXISTS "Stok" CASCADE;
DROP TABLE IF EXISTS "Trx" CASCADE;
DROP TABLE IF EXISTS "Varian" CASCADE;
DROP TABLE IF EXISTS "Produk" CASCADE;

CREATE TABLE "Produk" (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nama TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    kategori TEXT NOT NULL DEFAULT 'umum',
    deskripsi TEXT NOT NULL DEFAULT '',
    snk TEXT NOT NULL DEFAULT '',
    banner_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    urutan INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX idx_produk_slug ON "Produk"(slug);
CREATE INDEX idx_produk_kategori ON "Produk"(kategori);
CREATE INDEX idx_produk_urutan ON "Produk"(urutan);

CREATE TABLE "Varian" (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    produk_id UUID NOT NULL REFERENCES "Produk"(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    kode TEXT UNIQUE NOT NULL,
    harga INTEGER NOT NULL CHECK (harga >= 0),
    format TEXT,
    urutan INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    terjual INTEGER NOT NULL DEFAULT 0 CHECK (terjual >= 0),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX idx_varian_produk_id ON "Varian"(produk_id, urutan);
CREATE INDEX idx_varian_kode ON "Varian"(LOWER(kode));

CREATE TABLE "Stok" (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    varian_id UUID NOT NULL REFERENCES "Varian"(id) ON DELETE CASCADE,
    varian_kode TEXT NOT NULL,
    data TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'tersedia'
        CHECK (status IN ('tersedia','terjual','expired','dihapus')),
    terjual_at TIMESTAMPTZ,
    trx_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX idx_stok_varian_id ON "Stok"(varian_id);
CREATE INDEX idx_stok_available ON "Stok"(varian_kode, status) WHERE status = 'tersedia';

CREATE TABLE "Trx" (
    trx_uuid UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    id BIGINT NOT NULL,
    varian_id UUID REFERENCES "Varian"(id) ON DELETE SET NULL,
    produk_id UUID REFERENCES "Produk"(id) ON DELETE SET NULL,
    kode TEXT NOT NULL,
    nama TEXT NOT NULL,
    jumlah INTEGER NOT NULL CHECK (jumlah > 0),
    harga INTEGER NOT NULL CHECK (harga >= 0),
    harga_satuan INTEGER,
    tanggal TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    trxid TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX idx_trx_user_id ON "Trx"(id);
CREATE INDEX idx_trx_varian_id ON "Trx"(varian_id);
CREATE INDEX idx_trx_kode ON "Trx"(kode);
CREATE INDEX idx_trx_tanggal ON "Trx"(tanggal);

CREATE TABLE "ProductStockThreshold" (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    varian_id UUID NOT NULL REFERENCES "Varian"(id) ON DELETE CASCADE UNIQUE,
    threshold INTEGER NOT NULL DEFAULT 10 CHECK (threshold >= 0),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

DROP TRIGGER IF EXISTS update_produk_updated_at ON "Produk";
CREATE TRIGGER update_produk_updated_at
    BEFORE UPDATE ON "Produk"
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_varian_updated_at ON "Varian";
CREATE TRIGGER update_varian_updated_at
    BEFORE UPDATE ON "Varian"
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_stok_updated_at ON "Stok";
CREATE TRIGGER update_stok_updated_at
    BEFORE UPDATE ON "Stok"
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_productstockthreshold_updated_at ON "ProductStockThreshold";
CREATE TRIGGER update_productstockthreshold_updated_at
    BEFORE UPDATE ON "ProductStockThreshold"
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE "Produk" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Varian" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Stok" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Trx" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductStockThreshold" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for service role" ON "Produk";
CREATE POLICY "Allow all for service role" ON "Produk" FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow all for service role" ON "Varian";
CREATE POLICY "Allow all for service role" ON "Varian" FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow all for service role" ON "Stok";
CREATE POLICY "Allow all for service role" ON "Stok" FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow all for service role" ON "Trx";
CREATE POLICY "Allow all for service role" ON "Trx" FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow all for service role" ON "ProductStockThreshold";
CREATE POLICY "Allow all for service role" ON "ProductStockThreshold" FOR ALL USING (true) WITH CHECK (true);

-- Pending QRIS rows reference old Produk.kode values that no longer exist.
DELETE FROM "Payment" WHERE status IN ('pending', 'paid');
