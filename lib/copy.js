const supabase = require('./supabase')

const DEFAULTS = {
  'screen.welcome':
    'Halo, *{{first_name}}* 👋\n\nSelamat datang di *{{nama_bot}}*\n\n👥 Total User: *{{user_count}}*\n🛍️ Total Terjual: *{{stok_terjual}}*\n📦 Stok Tersedia: *{{stok_tersedia}}*\n💰 Saldo Anda: *{{saldo}}*\n\nSilahkan pilih menu dibawah ini!',
  'screen.product_list': '*LIST PRODUCT*\n=======================\n{{rows}}\n=======================',
  'screen.product_card':
    '*{{nama}}*\n=======================\n{{deskripsi}}\n\n*S&K:*\n{{snk}}\n=======================\n{{variants_block}}',
  'screen.qty':
    'tambahkan jumlah pembelian:\n\n┌──────────────────\n│ • Produk : {{produk_label}}\n│ • Stok Terjual : {{terjual}}\n│ • Desk : {{deskripsi}}\n└──────────────────\n\n┌──────────────────\n│ Harga: {{harga}} — (Stok {{stok}})\n└──────────────────\n\nCurrent Date: {{waktu}}',
  'screen.saldo_menu':
    '💰 *SALDO & DEPOSIT*\n=======================\nSaldo Anda: *{{saldo}}*\n\nPilih menu di bawah.',
  'screen.cara_order':
    '❓ *CARA ORDER*\n=======================\n1. Pilih *Daftar Produk* atau *Kategori*\n2. Pilih varian & jumlah\n3. Bayar via saldo atau QRIS\n4. Akun dikirim otomatis setelah pembayaran\n\nButuh bantuan? Hubungi Customer Service.',
  'msg.reply_nav_enabled': '⌨️ Menu navigasi cepat diaktifkan.',
  'msg.menu_daftar_produk': '‹📦› Daftar Produk',
  'msg.menu_daftar_produk_reply': '📦 Daftar Produk',
  'msg.menu_riwayat': '‹📋› Riwayat Transaksi',
  'msg.menu_riwayat_reply': '📋 Riwayat Transaksi',
  'msg.menu_kategori': '‹📂› Kategori Produk',
  'msg.menu_cara_order': '‹❓› Cara Order',
  'msg.menu_saldo': '‹💰› Saldo & Deposit',
  'msg.menu_saldo_reply': '💰 Saldo: {{saldo}}',
  'msg.menu_stok': '‹📊› Stok',
  'msg.menu_channel': '‹📢› Channel',
  'msg.menu_cs': '‹📞› Customer Service',
  'msg.btn_perbarui': '⟳ Perbarui',
  'msg.btn_kembali': '← Kembali',
  // --- err.* ---
  'err.owner_only': '⚠️ Hanya bisa diakses oleh owner!',
  'err.retired_command':
    '🛠️ *Perintah admin bot sudah dipensiunkan.*\n\nKelola toko lewat *Dashboard* (produk, stok, voucher, broadcast, flow, copy).{{dashboard_line}}\n\nLaporan cepat di bot: `/stok` · `/rekap` · `/listuser`',
  'err.cart_session_lost': '⚠️ Harap ulangi pilih produk!',
  'err.product_not_found': '⚠️ Produk tidak ditemukan.',
  'err.load_failed': '⚠️ Terjadi kesalahan saat memuat data. Silakan coba lagi.',
  'err.load_product_failed': '⚠️ Terjadi kesalahan saat memuat produk.',
  'err.load_stok_failed': '⚠️ Terjadi kesalahan saat memuat data stok.',
  'err.deposit_qris_not_configured': 'Sistem QRIS belum dikonfigurasi. Hubungi admin.',
  'err.deposit_verify_not_configured': 'Sistem verifikasi pembayaran belum dikonfigurasi. Hubungi admin.',
  'err.deposit_create_failed': 'Terjadi kesalahan saat membuat deposit.\n\nError: `{{error}}`',
  'err.deposit_qris_create_failed': 'Terjadi kesalahan saat membuat QRIS pembayaran.\n\nError: `{{error}}`',
  'err.deposit_expired': '⏰ *DEPOSIT EXPIRED*\n\nDeposit Anda telah kedaluwarsa. Silakan buat deposit baru.',
  'err.deposit_cancelled': '❌ *DEPOSIT DIBATALKAN*\n\nDeposit berhasil dibatalkan.',
  'err.deposit_amount_invalid': '❌ *JUMLAH TIDAK VALID*\n\nMasukkan nominal yang valid.',
  'err.deposit_no_history': '📋 *RIWAYAT DEPOSIT*\n\nBelum ada riwayat deposit.',
  'err.toast_deposit_preparing': '💸 Menyiapkan deposit Rp {{amount}}',
  'err.saldo_insufficient':
    '❌ *SALDO TIDAK CUKUP*\n\nSaldo Anda tidak mencukupi untuk transaksi ini.\nSilakan top up terlebih dahulu.',
  'err.order_expired': 'Pesananmu telah expired, harap pesan kembali!',
  'err.order_cancelled': '✅ Pesananmu berhasil dibatalkan.',
  'err.stock_empty': '⚠️ *STOK KOSONG*\n\nStok *{{nama}}* sedang kosong. Silakan pilih produk lain.',
  'err.stock_insufficient': '⚠️ Stok produk tidak mencukupi! Stok tersedia: {{count}}',
  'err.stock_selection_unavailable': '⚠️ Beberapa stok yang dipilih sudah tidak tersedia! Silakan pilih ulang.',
  'err.stock_reservation_timeout': '⚠️ Beberapa stok sudah tidak tersedia atau timeout reservasi!',
  'err.voucher_text_required': '⚠️ Silakan kirim kode voucher dalam bentuk teks.',
  'err.voucher_not_found': '❌ *Kode Voucher Tidak Ditemukan!*\n\nKode: `{{kode}}`',
  'err.voucher_already_used': '❌ *Voucher Sudah Digunakan!*',
  'err.voucher_exhausted': '❌ *Voucher Habis!*',
  'err.voucher_wrong_product': '❌ *Voucher Tidak Berlaku!*\n\nVoucher ini tidak berlaku untuk produk yang dipilih.',
  'err.voucher_none_available': 'Tidak ada voucher yang tersedia!',
  'err.voucher_min_purchase': 'Minimal pembelian {{amount}}!',
  'err.no_products':
    '⚠️ *BELUM ADA PRODUK*\n\nBelum ada produk di katalog.\nKelola produk lewat *Dashboard*.',
  'err.no_transactions': '⚠️ Belum ada transaksi apapun!',
  'err.no_users': '⚠️ Tidak ada user!',
  'err.transaction_not_found': '❌ Transaksi tidak ditemukan!',
  'err.access_denied': '❌ Anda tidak memiliki akses!',
  'err.file_unavailable': '❌ File tidak tersedia lagi!',
  'err.data_unavailable': '❌ Data tidak tersedia lagi!',
  // --- btn.* ---
  'btn.kembali': '🔙 Kembali',
  'btn.kembali_menu': '🔙 Menu Utama',
  'btn.kembali_pilih_stok': '🔙 Kembali Pilih Stok',
  'btn.konfirmasi': '✅ Konfirmasi',
  'btn.reset': '🔄 Reset',
  'btn.batal': '❌ Batal',
  'btn.batal_pesanan': '❌ Batal Pesanan',
  'btn.batal_confirm_ya': '✅ Ya, Batalkan',
  'btn.batal_confirm_tidak': '❌ Tidak, Kembali',
  'btn.top_up': '💳 Top Up Saldo',
  'btn.riwayat_deposit': '📋 Riwayat Deposit',
  'btn.deposit_custom': '⌨️ Custom Nominal',
  'btn.bayar_saldo': '💰 Bayar Pakai Saldo',
  'btn.bayar_qris': '💳 Bayar QRIS',
  'btn.lanjut_bayar': '💳 Lanjut ke Pembayaran',
  'btn.edit_stok': '✏️ Edit Pilihan Stok',
  'btn.edit_qty': '✏️ Edit Jumlah',
  'btn.hubungi_cs': '💬 Hubungi CS',
  'btn.voucher_lihat': '🎟️ Lihat Voucher',
  'btn.voucher_input': '🎟️ Input Voucher',
  'btn.voucher_tidak': 'Tidak',
  'btn.voucher_punya': 'Punya',
  'btn.belanja_lagi': '🛍️ Belanja Lagi',
  'btn.filter': '🔍 Filter',
  'btn.statistik': '📊 Statistik',
  'btn.prev': '⏪ Prev',
  'btn.next': 'Next ⏩',
  'btn.semua_produk': '📦 Semua Produk',
  'btn.populer': '🔥 PRODUK POPULER',
  'btn.mulai_order': '📦 Mulai Order',
  'btn.faq': '❓ FAQ',
  'btn.metode_bayar': '💳 Metode Bayar',
}

let cache = Object.create(null)
let ready = false

function render(body, vars) {
  const text = String(body ?? '')
  const v = vars && typeof vars === 'object' ? vars : {}
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, name) => {
    const val = v[name]
    return val === undefined || val === null ? '' : String(val)
  })
}

function get(key, vars, fallback) {
  const body = (cache[key] !== undefined && cache[key] !== null && cache[key] !== '')
    ? cache[key]
    : (DEFAULTS[key] !== undefined ? DEFAULTS[key] : undefined)
  if (body === undefined) {
    return fallback !== undefined ? fallback : String(key)
  }
  return render(body, vars)
}

async function refresh() {
  try {
    const { data, error } = await supabase.from('BotCopy').select('key, body')
    if (error) {
      console.error('[copy] refresh:', error.message)
      return false
    }
    const next = Object.create(null)
    for (const row of data || []) {
      if (row && row.key) next[row.key] = row.body
    }
    cache = next
    ready = true
    return true
  } catch (e) {
    console.error('[copy] refresh:', e.message)
    return false
  }
}

function isReady() {
  return ready
}

module.exports = {
  DEFAULTS,
  render,
  get,
  refresh,
  isReady,
}
