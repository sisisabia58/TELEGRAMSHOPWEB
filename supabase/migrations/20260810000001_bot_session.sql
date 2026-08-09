-- ============================================
-- TABEL "BotSession" — STATE PER USER TELEGRAM
-- ============================================
-- Menggantikan file ./Database/Trx/<userId>.json.
--
-- KENAPA:
-- Keranjang (cart) user sebelumnya disimpan sebagai file JSON di disk lokal
-- proses bot. Di Railway filesystem-nya ephemeral, jadi SETIAP deploy
-- menghapus semua keranjang yang sedang berjalan tanpa jejak. Bukti bahwa ini
-- pernah jadi masalah: reconciliation cron untuk pembayaran QRIS punya jalur
-- khusus "bot restarted, deliver manually".
--
-- Selain itu state di disk lokal membuat bot tidak bisa dijalankan lebih dari
-- satu instance.
--
-- KOLOM screen_key / nav_stack / banner_msg_id belum dipakai di fase ini.
-- Kolomnya disiapkan sekarang supaya flow engine (fase berikutnya) tidak perlu
-- membuat tempat penyimpanan state kedua.
-- ============================================

CREATE TABLE IF NOT EXISTS "BotSession" (
    -- ID user Telegram. BIGINT supaya konsisten dengan "User".id dan
    -- "Deposit".user_id yang juga BIGINT.
    user_id       BIGINT PRIMARY KEY,

    -- Keranjang aktif. Bentuknya sama persis dengan isi file JSON sebelumnya:
    --   { kode, jumlah, trxid, voucher, voucher_status, selectedStokIds }
    -- NULL = tidak ada keranjang aktif (dulu: file tidak ada).
    cart          JSONB DEFAULT NULL,

    -- Disiapkan untuk flow engine (fase berikutnya).
    screen_key    TEXT DEFAULT NULL,
    nav_stack     JSONB NOT NULL DEFAULT '[]'::jsonb,
    banner_msg_id BIGINT DEFAULT NULL,

    created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Untuk membersihkan sesi lama / melihat keranjang yang menggantung.
CREATE INDEX IF NOT EXISTS idx_botsession_updated_at ON "BotSession"(updated_at);

-- Hanya baris yang punya keranjang aktif — dipakai saat mencari keranjang
-- terlantar. Partial index supaya tetap kecil.
CREATE INDEX IF NOT EXISTS idx_botsession_cart_aktif
    ON "BotSession"(updated_at)
    WHERE cart IS NOT NULL;

-- Trigger updated_at mengikuti pola tabel lain (lihat migrasi
-- 20250207000000_complete_teleshop_schema.sql bagian 2).
DROP TRIGGER IF EXISTS update_botsession_updated_at ON "BotSession";
CREATE TRIGGER update_botsession_updated_at
    BEFORE UPDATE ON "BotSession"
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS mengikuti pola tabel lain: akses lewat service role key.
ALTER TABLE "BotSession" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for service role" ON "BotSession";
CREATE POLICY "Allow all for service role" ON "BotSession" FOR ALL USING (true) WITH CHECK (true);
