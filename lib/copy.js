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
