SET search_path TO public, extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS "BotCopy" (
    key TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('screen', 'msg')),
    body TEXT NOT NULL,
    description TEXT,
    variables JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_botcopy_kind ON "BotCopy"(kind);

DROP TRIGGER IF EXISTS update_botcopy_updated_at ON "BotCopy";
CREATE TRIGGER update_botcopy_updated_at
    BEFORE UPDATE ON "BotCopy"
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE "BotCopy" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for service role" ON "BotCopy";
CREATE POLICY "Allow all for service role" ON "BotCopy"
    FOR ALL USING (true) WITH CHECK (true);

INSERT INTO "BotCopy" (key, kind, body, description, variables) VALUES
(
  'screen.welcome',
  'screen',
  E'Halo, *{{first_name}}* 👋\n\nSelamat datang di *{{nama_bot}}*\n\n👥 Total User: *{{user_count}}*\n🛍️ Total Terjual: *{{stok_terjual}}*\n📦 Stok Tersedia: *{{stok_tersedia}}*\n💰 Saldo Anda: *{{saldo}}*\n\nSilahkan pilih menu dibawah ini!',
  'Caption welcome /start dan kembaliawal',
  '["first_name","nama_bot","user_count","stok_terjual","stok_tersedia","saldo"]'::jsonb
),
(
  'screen.product_list',
  'screen',
  E'*LIST PRODUCT*\n=======================\n{{rows}}\n=======================',
  'Chrome daftar produk; {{rows}} diisi bot',
  '["rows"]'::jsonb
),
(
  'screen.product_card',
  'screen',
  E'*{{nama}}*\n=======================\n{{deskripsi}}\n\n*S&K:*\n{{snk}}\n=======================\n{{variants_block}}',
  'Chrome kartu produk; fields dari Produk/Varian',
  '["nama","deskripsi","snk","variants_block"]'::jsonb
),
(
  'screen.qty',
  'screen',
  E'tambahkan jumlah pembelian:\n\n┌──────────────────\n│ • Produk : {{produk_label}}\n│ • Stok Terjual : {{terjual}}\n│ • Desk : {{deskripsi}}\n└──────────────────\n\n┌──────────────────\n│ Harga: {{harga}} — (Stok {{stok}})\n└──────────────────\n\nCurrent Date: {{waktu}}',
  'Layar pilih qty setelah varian',
  '["produk_label","terjual","deskripsi","harga","stok","waktu"]'::jsonb
),
(
  'screen.saldo_menu',
  'screen',
  E'💰 *SALDO & DEPOSIT*\n=======================\nSaldo Anda: *{{saldo}}*\n\nPilih menu di bawah.',
  'Menu saldo & deposit',
  '["saldo"]'::jsonb
),
(
  'screen.cara_order',
  'screen',
  E'❓ *CARA ORDER*\n=======================\n1. Pilih *Daftar Produk* atau *Kategori*\n2. Pilih varian & jumlah\n3. Bayar via saldo atau QRIS\n4. Akun dikirim otomatis setelah pembayaran\n\nButuh bantuan? Hubungi Customer Service.',
  'Panduan cara order',
  '[]'::jsonb
),
(
  'msg.reply_nav_enabled',
  'msg',
  '⌨️ Menu navigasi cepat diaktifkan.',
  'Pesan setelah reply keyboard dikirim',
  '[]'::jsonb
),
(
  'msg.menu_daftar_produk',
  'msg',
  '‹📦› Daftar Produk',
  'Label tombol daftar produk (inline)',
  '[]'::jsonb
),
(
  'msg.menu_daftar_produk_reply',
  'msg',
  '📦 Daftar Produk',
  'Label reply keyboard daftar produk',
  '[]'::jsonb
),
(
  'msg.menu_riwayat',
  'msg',
  '‹📋› Riwayat Transaksi',
  'Label riwayat (inline)',
  '[]'::jsonb
),
(
  'msg.menu_riwayat_reply',
  'msg',
  '📋 Riwayat Transaksi',
  'Label reply keyboard riwayat',
  '[]'::jsonb
),
(
  'msg.menu_kategori',
  'msg',
  '‹📂› Kategori Produk',
  'Label kategori',
  '[]'::jsonb
),
(
  'msg.menu_cara_order',
  'msg',
  '‹❓› Cara Order',
  'Label cara order',
  '[]'::jsonb
),
(
  'msg.menu_saldo',
  'msg',
  '‹💰› Saldo & Deposit',
  'Label saldo menu',
  '[]'::jsonb
),
(
  'msg.menu_saldo_reply',
  'msg',
  '💰 Saldo: {{saldo}}',
  'Reply keyboard cell saldo',
  '["saldo"]'::jsonb
),
(
  'msg.menu_stok',
  'msg',
  '‹📊› Stok',
  'Label stok',
  '[]'::jsonb
),
(
  'msg.menu_channel',
  'msg',
  '‹📢› Channel',
  'Label channel',
  '[]'::jsonb
),
(
  'msg.menu_cs',
  'msg',
  '‹📞› Customer Service',
  'Label CS',
  '[]'::jsonb
),
(
  'msg.btn_perbarui',
  'msg',
  '⟳ Perbarui',
  'Tombol refresh kartu produk',
  '[]'::jsonb
),
(
  'msg.btn_kembali',
  'msg',
  '← Kembali',
  'Tombol kembali chrome produk',
  '[]'::jsonb
)
ON CONFLICT (key) DO NOTHING;
