SET search_path TO public, extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS "HargaTier" (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    varian_id UUID NOT NULL REFERENCES "Varian"(id) ON DELETE CASCADE,
    min_qty INTEGER NOT NULL CHECK (min_qty >= 2),
    harga INTEGER NOT NULL CHECK (harga >= 0),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    UNIQUE (varian_id, min_qty)
);
CREATE INDEX idx_hargatier_varian ON "HargaTier"(varian_id, min_qty);

DROP TRIGGER IF EXISTS update_hargatier_updated_at ON "HargaTier";
CREATE TRIGGER update_hargatier_updated_at
    BEFORE UPDATE ON "HargaTier"
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE "HargaTier" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for service role" ON "HargaTier";
CREATE POLICY "Allow all for service role" ON "HargaTier"
    FOR ALL USING (true) WITH CHECK (true);
