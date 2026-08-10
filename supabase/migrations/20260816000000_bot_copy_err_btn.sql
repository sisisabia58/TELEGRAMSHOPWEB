SET search_path TO public, extensions;

ALTER TABLE "BotCopy" DROP CONSTRAINT IF EXISTS "BotCopy_kind_check";
ALTER TABLE "BotCopy" ADD CONSTRAINT "BotCopy_kind_check"
  CHECK (kind IN ('screen', 'msg', 'err', 'btn'));

INSERT INTO "BotCopy" (key, kind, body, description, variables) VALUES
(
  'err.owner_only',
  'err',
  '⚠️ Hanya bisa diakses oleh owner!',
  'Owner-only command guard',
  '[]'::jsonb
),
(
  'err.retired_command',
  'err',
  E'🛠️ *Perintah admin bot sudah dipensiunkan.*\n\nKelola toko lewat *Dashboard* (produk, stok, voucher, broadcast, flow, copy).{{dashboard_line}}\n\nLaporan cepat di bot: `/stok` · `/rekap` · `/listuser`',
  'Retired admin command help with optional dashboard link',
  '["dashboard_line"]'::jsonb
),
(
  'err.cart_session_lost',
  'err',
  '⚠️ Harap ulangi pilih produk!',
  'Cart session missing or expired',
  '[]'::jsonb
),
(
  'err.product_not_found',
  'err',
  '⚠️ Produk tidak ditemukan.',
  'Product lookup failed',
  '[]'::jsonb
),
(
  'err.load_failed',
  'err',
  '⚠️ Terjadi kesalahan saat memuat data. Silakan coba lagi.',
  'Generic data load failure',
  '[]'::jsonb
),
(
  'err.load_product_failed',
  'err',
  '⚠️ Terjadi kesalahan saat memuat produk.',
  'Product list load failure',
  '[]'::jsonb
),
(
  'err.load_stok_failed',
  'err',
  '⚠️ Terjadi kesalahan saat memuat data stok.',
  'Stock data load failure',
  '[]'::jsonb
),
(
  'err.deposit_qris_not_configured',
  'err',
  E'❌ *ERROR*\n=======================\nSistem QRIS belum dikonfigurasi dengan benar oleh pemilik toko. Silakan hubungi admin.',
  'QRIS payment not configured',
  '[]'::jsonb
),
(
  'err.deposit_verify_not_configured',
  'err',
  E'❌ *ERROR*\n=======================\nSistem verifikasi pembayaran belum dikonfigurasi dengan benar oleh pemilik toko. Silakan hubungi admin.',
  'Payment verification not configured',
  '[]'::jsonb
),
(
  'err.deposit_create_failed',
  'err',
  E'❌ *ERROR*\n=======================\nTerjadi kesalahan saat membuat deposit.\n\nError: `{{error}}`\n\n=======================\n💡 Silakan coba lagi atau hubungi admin.',
  'Deposit creation failed',
  '["error"]'::jsonb
),
(
  'err.deposit_qris_create_failed',
  'err',
  E'❌ *ERROR*\n=======================\nTerjadi kesalahan saat membuat QRIS pembayaran.\n\nError: `{{error}}`\n\nSilakan coba lagi atau hubungi admin.',
  'QRIS deposit creation failed',
  '["error"]'::jsonb
),
(
  'err.deposit_expired',
  'err',
  E'⏰ *DEPOSIT EXPIRED*\n=======================\nPembayaran deposit telah expired.\n\nKode Deposit: `{{kode}}`\n\n=======================\n💡 Gunakan `/deposit` untuk membuat deposit baru.',
  'Deposit session expired',
  '["kode"]'::jsonb
),
(
  'err.deposit_cancelled',
  'err',
  E'❌ *DEPOSIT DIBATALKAN*\n=======================\nKode Deposit: `{{kode}}`\n\n=======================\n💡 Gunakan `/deposit` untuk membuat deposit baru.',
  'Deposit cancelled confirmation',
  '["kode"]'::jsonb
),
(
  'err.deposit_amount_invalid',
  'err',
  E'❌ *JUMLAH TIDAK VALID*\n=======================\nMinimum deposit: *Rp 1.000*\n\nJumlah yang Anda masukkan: `{{text}}`\n\n=======================\n💡 Silakan masukkan jumlah minimal Rp 1.000',
  'Invalid deposit amount',
  '["text"]'::jsonb
),
(
  'err.deposit_no_history',
  'err',
  E'📋 *RIWAYAT DEPOSIT*\n=======================\nBelum ada riwayat deposit.\n\n=======================\n💡 Gunakan `/deposit` untuk top up saldo.',
  'Empty deposit history',
  '[]'::jsonb
),
(
  'err.toast_deposit_preparing',
  'err',
  '💸 Menyiapkan deposit Rp {{amount}}',
  'Toast while preparing deposit',
  '["amount"]'::jsonb
),
(
  'err.saldo_insufficient',
  'err',
  E'❌ *SALDO TIDAK CUKUP*\n\nSaldo Anda tidak mencukupi untuk transaksi ini.\nSilakan top up terlebih dahulu.',
  'Insufficient balance for checkout',
  '[]'::jsonb
),
(
  'err.saldo_insufficient_checkout',
  'err',
  E'❌ *SALDO TIDAK CUKUP*\n=======================\n💰 *Saldo Anda:* {{saldo}}\n💵 *Total Bayar:* {{total}}\n⚠️ *Kurang:* {{kurang}}\n=======================\n💡 Top up saldo dengan `/deposit` atau gunakan metode pembayaran lain.',
  'Insufficient balance at checkout with amounts',
  '["saldo","total","kurang"]'::jsonb
),
(
  'err.order_expired',
  'err',
  'Pesananmu telah expired, harap pesan kembali!',
  'Order session expired',
  '[]'::jsonb
),
(
  'err.order_cancelled',
  'err',
  '✅ Pesananmu berhasil dibatalkan.',
  'Order cancelled confirmation',
  '[]'::jsonb
),
(
  'err.stock_empty',
  'err',
  E'⚠️ *STOK KOSONG*\n\nProduk *{{nama}}* tidak memiliki stok tersedia.\n\n━━━━━━━━━━━━━━━━━━━━\n💡 Silakan pilih produk lain.',
  'Selected product out of stock',
  '["nama"]'::jsonb
),
(
  'err.stock_insufficient',
  'err',
  '⚠️ Stok produk tidak mencukupi! Stok tersedia: {{count}}',
  'Checkout when available stock < requested qty',
  '["count"]'::jsonb
),
(
  'err.stock_selection_unavailable',
  'err',
  '⚠️ Beberapa stok yang dipilih sudah tidak tersedia! Silakan pilih ulang.',
  'Selected stock rows no longer available',
  '[]'::jsonb
),
(
  'err.stock_reservation_timeout',
  'err',
  '⚠️ Beberapa stok sudah tidak tersedia atau timeout reservasi!',
  'Stock reservation timed out',
  '[]'::jsonb
),
(
  'err.voucher_text_required',
  'err',
  '⚠️ Silakan kirim kode voucher dalam bentuk teks.',
  'Voucher input must be text',
  '[]'::jsonb
),
(
  'err.voucher_not_found',
  'err',
  E'❌ *Kode Voucher Tidak Ditemukan!*\n=======================\nKode voucher `{{kode}}` tidak terdaftar di database.\n\n=======================\n💡 Pastikan kode voucher sudah benar atau hubungi admin.',
  'Voucher code not found',
  '["kode"]'::jsonb
),
(
  'err.voucher_already_used',
  'err',
  E'❌ *Voucher Sudah Digunakan!*\n=======================\nKode voucher `{{kode}}` sudah pernah Anda gunakan sebelumnya.\n\n=======================\n💡 Setiap voucher hanya bisa digunakan sekali per user.',
  'Voucher already redeemed',
  '["kode"]'::jsonb
),
(
  'err.voucher_exhausted',
  'err',
  E'❌ *Voucher Habis!*\n=======================\nKode voucher `{{kode}}` sudah mencapai batas penggunaan.\n\n=======================\n💡 Limit voucher: {{limit}}',
  'Voucher quota exhausted',
  '["kode","limit"]'::jsonb
),
(
  'err.voucher_wrong_product',
  'err',
  E'❌ *Voucher Tidak Berlaku!*\n=======================\nKode voucher `{{kode}}` tidak berlaku untuk produk ini.\n\n*Produk yang berlaku:*\n{{produk_berlaku}}\n\n*Produk Anda:*\n{{produk_anda}}\n\n=======================\n💡 Gunakan voucher yang sesuai dengan produk.',
  'Voucher not valid for product',
  '["kode","produk_berlaku","produk_anda"]'::jsonb
),
(
  'err.voucher_none_available',
  'err',
  'Tidak ada voucher yang tersedia!',
  'No vouchers available for user',
  '[]'::jsonb
),
(
  'err.voucher_min_purchase',
  'err',
  'Minimal pembelian {{amount}}!',
  'Voucher minimum purchase not met',
  '["amount"]'::jsonb
),
(
  'err.no_products',
  'err',
  E'⚠️ *BELUM ADA PRODUK*\n\nBelum ada produk di katalog.\nKelola produk lewat *Dashboard*.',
  'Empty product catalog',
  '[]'::jsonb
),
(
  'err.no_transactions',
  'err',
  '⚠️ Belum ada transaksi apapun!',
  'Empty transaction history',
  '[]'::jsonb
),
(
  'err.no_users',
  'err',
  E'📭 *TIDAK ADA USER*\n━━━━━━━━━━━━━━━━━━━━\nBelum ada user yang terdaftar di database.\n\n━━━━━━━━━━━━━━━━━━━━\n💡 User akan otomatis terdaftar saat menggunakan /start.',
  'Empty user list',
  '[]'::jsonb
),
(
  'err.no_users_toast',
  'err',
  '⚠️ Tidak ada user!',
  'Empty user list toast for callback alerts',
  '[]'::jsonb
),
(
  'err.transaction_not_found',
  'err',
  '❌ Transaksi tidak ditemukan!',
  'Transaction lookup failed',
  '[]'::jsonb
),
(
  'err.access_denied',
  'err',
  '❌ Anda tidak memiliki akses!',
  'Access denied',
  '[]'::jsonb
),
(
  'err.file_unavailable',
  'err',
  '❌ File tidak tersedia lagi!',
  'Delivered file no longer available',
  '[]'::jsonb
),
(
  'err.data_unavailable',
  'err',
  '❌ Data tidak tersedia lagi!',
  'Requested data no longer available',
  '[]'::jsonb
),
(
  'btn.kembali',
  'btn',
  '🔙 Kembali',
  'Generic back button',
  '[]'::jsonb
),
(
  'btn.kembali_menu',
  'btn',
  '🔙 Menu Utama',
  'Back to main menu',
  '[]'::jsonb
),
(
  'btn.kembali_pilih_stok',
  'btn',
  '🔙 Kembali Pilih Stok',
  'Back to stock selection',
  '[]'::jsonb
),
(
  'btn.konfirmasi',
  'btn',
  '✅ Konfirmasi',
  'Order confirm keyboard',
  '[]'::jsonb
),
(
  'btn.reset',
  'btn',
  '🔄 Reset',
  'Reset selection',
  '[]'::jsonb
),
(
  'btn.batal',
  'btn',
  '❌ Batal',
  'Generic cancel',
  '[]'::jsonb
),
(
  'btn.batal_pesanan',
  'btn',
  '❌ Batal Pesanan',
  'Cancel order button',
  '[]'::jsonb
),
(
  'btn.batal_confirm_ya',
  'btn',
  '✅ Ya, Batalkan',
  'Confirm order cancellation',
  '[]'::jsonb
),
(
  'btn.batal_confirm_tidak',
  'btn',
  '❌ Tidak, Kembali',
  'Decline order cancellation',
  '[]'::jsonb
),
(
  'btn.top_up',
  'btn',
  '💳 Top Up Saldo',
  'Top up balance',
  '[]'::jsonb
),
(
  'btn.riwayat_deposit',
  'btn',
  '📋 Riwayat Deposit',
  'Deposit history',
  '[]'::jsonb
),
(
  'btn.deposit_custom',
  'btn',
  '⌨️ Custom Nominal',
  'Custom deposit amount',
  '[]'::jsonb
),
(
  'btn.bayar_saldo',
  'btn',
  '💰 Bayar Pakai Saldo',
  'Pay with balance',
  '[]'::jsonb
),
(
  'btn.bayar_qris',
  'btn',
  '💳 Bayar QRIS',
  'Pay with QRIS',
  '[]'::jsonb
),
(
  'btn.lanjut_bayar',
  'btn',
  '💳 Lanjut ke Pembayaran',
  'Proceed to payment',
  '[]'::jsonb
),
(
  'btn.edit_stok',
  'btn',
  '✏️ Edit Pilihan Stok',
  'Edit stock selection',
  '[]'::jsonb
),
(
  'btn.edit_qty',
  'btn',
  '✏️ Edit Jumlah',
  'Edit quantity',
  '[]'::jsonb
),
(
  'btn.hubungi_cs',
  'btn',
  '💬 Hubungi CS',
  'Contact customer service',
  '[]'::jsonb
),
(
  'btn.voucher_lihat',
  'btn',
  '🎟️ Lihat Voucher',
  'View available vouchers',
  '[]'::jsonb
),
(
  'btn.voucher_input',
  'btn',
  '🎟️ Input Voucher',
  'Enter voucher code',
  '[]'::jsonb
),
(
  'btn.voucher_tidak',
  'btn',
  'Tidak',
  'Decline voucher prompt',
  '[]'::jsonb
),
(
  'btn.voucher_punya',
  'btn',
  'Punya',
  'Has voucher prompt',
  '[]'::jsonb
),
(
  'btn.belanja_lagi',
  'btn',
  '🛍️ Belanja Lagi',
  'Shop again after order',
  '[]'::jsonb
),
(
  'btn.filter',
  'btn',
  '🔍 Filter',
  'Filter products',
  '[]'::jsonb
),
(
  'btn.statistik',
  'btn',
  '📊 Statistik',
  'View statistics',
  '[]'::jsonb
),
(
  'btn.prev',
  'btn',
  '⏪ Prev',
  'Pagination previous',
  '[]'::jsonb
),
(
  'btn.next',
  'btn',
  'Next ⏩',
  'Pagination next',
  '[]'::jsonb
),
(
  'btn.semua_produk',
  'btn',
  '📦 Semua Produk',
  'All products category',
  '[]'::jsonb
),
(
  'btn.populer',
  'btn',
  '🔥 PRODUK POPULER',
  'Popular products category',
  '[]'::jsonb
),
(
  'btn.mulai_order',
  'btn',
  '📦 Mulai Order',
  'Start ordering',
  '[]'::jsonb
),
(
  'btn.faq',
  'btn',
  '❓ FAQ',
  'FAQ button',
  '[]'::jsonb
),
(
  'btn.metode_bayar',
  'btn',
  '💳 Metode Bayar',
  'Payment method selection',
  '[]'::jsonb
)
ON CONFLICT (key) DO UPDATE SET
  kind = EXCLUDED.kind,
  body = EXCLUDED.body,
  description = EXCLUDED.description,
  variables = EXCLUDED.variables,
  updated_at = NOW();
