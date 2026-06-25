-- ============================================
-- PAYMENT COORDINATION TABLE (Pakasir)
-- ============================================
-- Tracks a single QRIS payment (deposit or purchase) so that the webhook
-- (dashboard.js process) and the polling fallback (index.js bot process)
-- can coordinate. Fulfillment is guarded by the status transition
-- pending/paid -> fulfilled so a payment is only ever fulfilled once.
-- ============================================

CREATE TABLE IF NOT EXISTS "Payment" (
    order_id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('deposit', 'purchase')),
    user_id BIGINT NOT NULL,
    amount INTEGER NOT NULL CHECK (amount > 0),          -- base amount sent to Pakasir
    fee INTEGER DEFAULT 0 NOT NULL CHECK (fee >= 0),     -- Pakasir fee
    total INTEGER NOT NULL CHECK (total > 0),            -- total_payment (amount + fee)
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'paid', 'fulfilled', 'expired', 'cancelled')),
    payment_method TEXT DEFAULT 'qris',
    qr_string TEXT,                                      -- payment_number from Pakasir
    meta JSONB DEFAULT '{}'::jsonb NOT NULL,             -- purchase: kode/jumlah/voucher/selectedStokIds; deposit: jumlah
    expired_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_status ON "Payment"(status);
CREATE INDEX IF NOT EXISTS idx_payment_user_id ON "Payment"(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_created_at ON "Payment"(created_at);

-- Keep updated_at fresh (reuses the function from the base schema migration).
DROP TRIGGER IF EXISTS update_payment_updated_at ON "Payment";
CREATE TRIGGER update_payment_updated_at BEFORE UPDATE ON "Payment"
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS (matches the project's existing service-role policy pattern).
ALTER TABLE "Payment" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for service role" ON "Payment";
CREATE POLICY "Allow all for service role" ON "Payment" FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE "Payment" IS 'Pakasir payment coordination between webhook and bot polling';
