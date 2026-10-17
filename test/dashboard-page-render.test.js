const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const test = require('node:test')

// Expose EJS ReferenceError text. dotenv will not override a value already set.
process.env.NODE_ENV = 'test'
process.env.ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'env-operator'
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'env-password-for-page-render-test'
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'page-render-test-session-secret'

const ISO = '2026-10-17T02:30:00.000Z'
const IDS = {
  produk: '11111111-1111-4111-8111-111111111111',
  varian: '22222222-2222-4222-8222-222222222222',
  stok: '33333333-3333-4333-8333-333333333333',
  trx: '44444444-4444-4444-8444-444444444444',
  user: 88001,
  deposit: '55555555-5555-4555-8555-555555555555',
  voucher: '66666666-6666-4666-8666-666666666666',
  admin: '77777777-7777-4777-8777-777777777777',
  template: '88888888-8888-4888-8888-888888888888',
  history: '99999999-9999-4999-8999-999999999999',
  supplier: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  supplierProduct: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  supplierOrder: 'abababab-abab-4aba-8aba-abababababab',
  tier: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  flow: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  flowNode: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
}

const FIXTURES = {
  Admin: [{
    id: IDS.admin,
    username: 'seed-admin',
    password_hash: '$2b$04$not-used-env-login-is-the-session',
    role: 'admin',
    is_active: true,
    last_login: ISO,
    last_login_ip: '127.0.0.1',
    created_at: ISO,
    updated_at: ISO,
  }],
  LoginHistory: [{
    id: 'login-history-1',
    admin_id: IDS.admin,
    username: 'seed-admin',
    ip_address: '127.0.0.1',
    user_agent: 'node-test',
    status: 'success',
    login_time: ISO,
  }],
  AuditLog: [{
    id: 'audit-1',
    admin_id: IDS.admin,
    username: 'seed-admin',
    action: 'update_product',
    entity_type: 'Produk',
    entity_id: IDS.produk,
    details: { nama: 'Netflix' },
    ip_address: '127.0.0.1',
    created_at: ISO,
  }],
  User: [{
    id: IDS.user,
    jumlahtransaksi: 1,
    pengeluaran: 25000,
    saldo: 75000,
    created_at: ISO,
    updated_at: ISO,
  }],
  Produk: [{
    id: IDS.produk,
    nama: 'Netflix',
    slug: 'netflix',
    // Voucher form still selects Produk.kode for its checkbox list.
    kode: 'netflix',
    kategori: 'streaming',
    deskripsi: 'Akun streaming uji',
    snk: 'Jangan dibagikan',
    banner_url: null,
    is_active: true,
    urutan: 1,
    created_at: ISO,
    updated_at: ISO,
  }],
  Varian: [{
    id: IDS.varian,
    produk_id: IDS.produk,
    label: '1 Bulan',
    kode: 'netflix-1b',
    harga: 25000,
    format: 'Email:Password',
    urutan: 0,
    is_active: true,
    terjual: 3,
    sumber: 'sendiri',
    created_at: ISO,
    updated_at: ISO,
    produk: { nama: 'Netflix', slug: 'netflix' },
  }],
  Stok: [{
    id: IDS.stok,
    varian_id: IDS.varian,
    varian_kode: 'netflix-1b',
    data: 'user@contoh.test:sandi-contoh',
    status: 'tersedia',
    terjual_at: null,
    trx_id: null,
    created_at: ISO,
    updated_at: ISO,
  }],
  Trx: [{
    trx_uuid: IDS.trx,
    id: IDS.user,
    varian_id: IDS.varian,
    produk_id: IDS.produk,
    kode: 'netflix-1b',
    nama: 'Netflix',
    jumlah: 1,
    harga: 25000,
    harga_satuan: 25000,
    tanggal: ISO,
    trxid: 'TRX-SMOKE-1',
    created_at: ISO,
  }],
  Deposit: [{
    id: IDS.deposit,
    user_id: IDS.user,
    jumlah: 100000,
    fee: 0,
    total: 100000,
    status: 'pending',
    kode_deposit: 'DEP-SMOKE-1',
    metode: 'qris',
    tanggal: ISO,
    created_at: ISO,
    updated_at: ISO,
  }],
  Voucher: [{
    id: IDS.voucher,
    kode: 'HEMAT10',
    produk: ['netflix'],
    potongan: 5000,
    limit: 10,
    user: [],
    created_at: ISO,
    updated_at: ISO,
  }],
  HargaTier: [{
    id: IDS.tier,
    varian_id: IDS.varian,
    min_qty: 3,
    harga: 20000,
  }],
  ProductStockThreshold: [{
    id: 'threshold-1',
    varian_id: IDS.varian,
    threshold: 2,
    is_active: true,
    created_at: ISO,
    updated_at: ISO,
  }],
  MessageTemplate: [{
    id: IDS.template,
    name: 'Promo Netflix',
    category: 'promo',
    subject: 'Diskon',
    message_text: 'Halo {nama}, ada diskon Netflix.',
    variables: ['nama'],
    is_active: true,
    created_at: ISO,
    updated_at: ISO,
  }],
  MessageHistory: [{
    id: IDS.history,
    admin_id: IDS.admin,
    username: 'seed-admin',
    message_type: 'broadcast',
    recipient_type: 'all',
    recipient_id: null,
    recipient_count: 12,
    message_text: 'Promo Netflix minggu ini untuk pelanggan setia',
    template_id: IDS.template,
    status: 'completed',
    success_count: 12,
    failed_count: 0,
    created_at: ISO,
    sent_at: ISO,
  }],
  BotCopy: [{
    key: 'screen.welcome',
    body: 'Selamat datang {{nama}}',
    kind: 'screen',
    description: 'Layar awal',
    variables: ['nama'],
  }],
  BotFlow: [{
    id: IDS.flow,
    name: 'Flow Utama',
    entry_key: 'welcome',
    is_active: true,
    draft: null,
    draft_updated_at: ISO,
  }],
  BotFlowNode: [{
    id: IDS.flowNode,
    flow_id: IDS.flow,
    key: 'welcome',
    body: 'Halo',
  }],
  Supplier: [{
    id: IDS.supplier,
    nama: 'Bite Uji',
    slug: 'bite-uji',
    adapter: 'bitestore',
    base_url: 'https://bite-store.example.test',
    api_key: 'supplier-test-key',
    is_active: true,
    prioritas: 1,
    last_sync_at: ISO,
    last_sync_status: 'ok',
    last_sync_error: null,
    created_at: ISO,
    updated_at: ISO,
  }],
  SupplierProduct: [{
    id: IDS.supplierProduct,
    supplier_id: IDS.supplier,
    varian_id: IDS.varian,
    external_id: 'ext-netflix-1',
    nama: 'Netflix 1 Bulan',
    harga_asal: 1.5,
    currency: 'USD',
    stok: 4,
    in_stock: true,
    is_available: true,
    mapping_mode: 'manual',
    supplier: { id: IDS.supplier, nama: 'Bite Uji', prioritas: 1, is_active: true },
    varian: {
      id: IDS.varian,
      label: '1 Bulan',
      kode: 'netflix-1b',
      sumber: 'sendiri',
      produk: { nama: 'Netflix' },
    },
  }],
  SupplierOrder: [{
    id: IDS.supplierOrder,
    trx_id: 'TRX-REKON-1',
    user_id: IDS.user,
    quantity: 1,
    jual_idr: 50000,
    error: 'perlu rekonsiliasi manual: HTTP 502',
    created_at: ISO,
    status: 'failed',
  }],
  NotificationSettings: [
    { setting_key: 'cache_version', setting_value: { value: 3 } },
    { setting_key: 'low_stock_threshold', setting_value: { default: 5, enabled: true } },
    { setting_key: 'reseller_margin_persen', setting_value: { value: 12 } },
    { setting_key: 'reseller_rounding', setting_value: { value: 500 } },
    { setting_key: 'fx_mode', setting_value: { value: 'manual' } },
    { setting_key: 'fx_usd_idr', setting_value: { value: 16500 } },
    { setting_key: 'fx_buffer_persen', setting_value: { value: 2 } },
    { setting_key: 'fx_updated_at', setting_value: { value: ISO } },
    { setting_key: 'supplier_sync_interval_menit', setting_value: { value: 5 } },
    { setting_key: 'supplier_kategori_default', setting_value: { value: 'reseller' } },
    { setting_key: 'supplier_wallet_min_usd', setting_value: { value: 5 } },
    { setting_key: 'channel_store', setting_value: { value: '@toko_uji' } },
    { setting_key: 'channel_log', setting_value: { value: '@log_uji' } },
    { setting_key: 'cs', setting_value: { value: '@cs_uji' } },
    { setting_key: 'feed_channel', setting_value: { value: '@feed_uji' } },
    { setting_key: 'feed_stock_enabled', setting_value: { value: true } },
    { setting_key: 'feed_purchase_enabled', setting_value: { value: true } },
    { setting_key: 'bot_logo', setting_value: { value: '' } },
    { setting_key: 'currency', setting_value: { symbol: 'Rp', code: 'IDR', position: 'before' } },
    { setting_key: 'timezone', setting_value: { value: 'Asia/Jakarta' } },
    { setting_key: 'date_format', setting_value: { value: 'DD/MM/YYYY' } },
    { setting_key: 'time_format', setting_value: { value: '24h' } },
    { setting_key: 'language', setting_value: { value: 'id' } },
    { setting_key: 'items_per_page', setting_value: { value: 20 } },
    { setting_key: 'auto_refresh', setting_value: { enabled: true, interval: 30 } },
    { setting_key: 'dashboard_theme', setting_value: { value: 'light' } },
    { setting_key: 'flow_engine_enabled', setting_value: { value: false } },
  ],
}

const dbMode = { current: 'empty' }
const queriedTables = new Set()
const missingFixtures = new Set()
const renders = []

function same(a, b) {
  if (Object.is(a, b)) return true
  if (a == null || b == null) return false
  if (typeof a === 'number' || typeof b === 'number') return String(a) === String(b)
  return false
}

function likeToRegExp(pattern) {
  const src = String(pattern)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/%/g, '.*')
    .replace(/_/g, '.')
  return new RegExp(`^${src}$`, 'i')
}

function matchOrPart(row, part) {
  const match = String(part).match(/^([A-Za-z0-9_]+)\.(eq|neq|ilike|like|gt|gte|lt|lte)\.(.*)$/)
  if (!match) return false
  const [, col, op, raw] = match
  const value = row[col]
  if (op === 'eq') return same(value, raw) || String(value) === raw
  if (op === 'neq') return !(same(value, raw) || String(value) === raw)
  if (op === 'ilike' || op === 'like') return likeToRegExp(raw).test(String(value ?? ''))
  if (op === 'gt') return value > raw
  if (op === 'gte') return value >= raw
  if (op === 'lt') return value < raw
  if (op === 'lte') return value <= raw
  return false
}

function rowsFor(table) {
  queriedTables.add(table)
  if (dbMode.current === 'empty') return []
  const rows = FIXTURES[table]
  if (!rows) {
    missingFixtures.add(table)
    return []
  }
  return rows.map((row) => JSON.parse(JSON.stringify(row)))
}

function supabaseBuilder(table) {
  const state = {
    filters: [],
    orExpr: null,
    limit: null,
    range: null,
    head: false,
    op: 'select',
    single: false,
    maybe: false,
  }

  const builder = {
    select(_cols, opts) {
      if (opts && opts.head) state.head = true
      return builder
    },
    insert() { state.op = 'write'; return builder },
    update() { state.op = 'write'; return builder },
    upsert() { state.op = 'write'; return builder },
    delete() { state.op = 'write'; return builder },
    eq(col, val) { state.filters.push((row) => same(row[col], val)); return builder },
    neq(col, val) { state.filters.push((row) => !same(row[col], val)); return builder },
    in(col, vals) {
      const list = vals || []
      state.filters.push((row) => list.some((val) => same(row[col], val)))
      return builder
    },
    is(col, val) {
      state.filters.push((row) => (val === null ? row[col] == null : same(row[col], val)))
      return builder
    },
    not(col, op, val) {
      if (op === 'is' && val === null) state.filters.push((row) => row[col] != null)
      return builder
    },
    gte(col, val) { state.filters.push((row) => row[col] >= val); return builder },
    gt(col, val) { state.filters.push((row) => row[col] > val); return builder },
    lte(col, val) { state.filters.push((row) => row[col] <= val); return builder },
    lt(col, val) { state.filters.push((row) => row[col] < val); return builder },
    like(col, pattern) {
      const re = likeToRegExp(pattern)
      state.filters.push((row) => re.test(String(row[col] ?? '')))
      return builder
    },
    ilike(col, pattern) { return builder.like(col, pattern) },
    or(expr) { state.orExpr = expr; return builder },
    order() { return builder },
    limit(n) { state.limit = n; return builder },
    range(from, to) { state.range = [from, to]; return builder },
    match() { return builder },
    filter() { return builder },
    contains() { return builder },
    textSearch() { return builder },
    single() { state.single = true; return exec() },
    maybeSingle() { state.maybe = true; return exec() },
    then(ok, bad) { return exec().then(ok, bad) },
  }

  function exec() {
    if (state.op === 'write') {
      const data = state.single || state.maybe ? { id: 'write-1' } : []
      return Promise.resolve({ data, error: null, count: 0 })
    }
    let rows = rowsFor(table).filter((row) => state.filters.every((fn) => fn(row)))
    if (state.orExpr) {
      const parts = String(state.orExpr).split(',')
      rows = rows.filter((row) => parts.some((part) => matchOrPart(row, part)))
    }
    const count = rows.length
    if (state.range) rows = rows.slice(state.range[0], state.range[1] + 1)
    else if (state.limit != null) rows = rows.slice(0, state.limit)

    if (state.head) return Promise.resolve({ data: null, error: null, count })
    if (state.single) {
      if (rows.length !== 1) {
        return Promise.resolve({ data: null, error: { message: 'not found', code: 'PGRST116' }, count })
      }
      return Promise.resolve({ data: rows[0], error: null, count })
    }
    if (state.maybe) return Promise.resolve({ data: rows[0] || null, error: rows.length > 1 ? { message: 'multiple' } : null, count })
    return Promise.resolve({ data: rows, error: null, count })
  }

  return builder
}

const jalurClient = require.resolve('../lib/supabase.js')
require.cache[jalurClient] = {
  id: jalurClient,
  filename: jalurClient,
  loaded: true,
  exports: {
    from(table) { return supabaseBuilder(table) },
    rpc() { return Promise.resolve({ data: null, error: null }) },
  },
}

const app = require('../dashboard')
const originalRender = app.render.bind(app)
app.render = function renderSpy(name, options, callback) {
  renders.push({
    view: String(name).replace(/\.ejs$/, ''),
    mode: dbMode.current,
  })
  return originalRender(name, options, callback)
}

const viewsDir = path.join(__dirname, '..', 'views')
const partialNames = new Set(
  fs.readdirSync(path.join(viewsDir, 'partials')).filter((name) => name.endsWith('.ejs'))
)
const pageViews = fs.readdirSync(viewsDir)
  .filter((name) => name.endsWith('.ejs'))
  .map((name) => name.replace(/\.ejs$/, ''))

const dashboardSrc = fs.readFileSync(path.join(__dirname, '..', 'dashboard.js'), 'utf8')
const renderedByRoutes = new Set()
for (const match of dashboardSrc.matchAll(/res\.render\(\s*'([^']+)'/g)) {
  renderedByRoutes.add(match[1])
}

// Partials are included by page templates (or returned as an HTML fragment from
// variant APIs). They are not dashboard pages a GET route renders on their own.
const skippedPartials = [...partialNames].map((name) => name.replace(/\.ejs$/, '')).sort()

const PAGES = [
  { view: 'login', path: '/login', auth: false },
  { view: 'dashboard', path: '/', marker: { seeded: ['DEP-SMOKE-1', 'TRX-REKON-1'] } },
  { view: 'produk', path: '/produk', marker: { seeded: 'Netflix' } },
  { view: 'stok', path: '/stok', marker: { seeded: 'Netflix' } },
  { view: 'pricing', path: '/pricing', marker: { seeded: 'netflix-1b' } },
  { view: 'produk-form', path: '/produk/tambah' },
  { view: 'produk-hapus', path: `/produk/hapus/${IDS.produk}`, needsRow: true, marker: { seeded: 'Netflix' } },
  { view: 'produk-detail', path: `/produk/${IDS.produk}`, needsRow: true, marker: { seeded: 'Netflix' } },
  { view: 'produk-stok', path: `/produk/${IDS.produk}/varian/${IDS.varian}/stok`, needsRow: true, marker: { seeded: 'user@contoh.test' } },
  { view: 'produk-stok-tambah', path: `/produk/${IDS.produk}/varian/${IDS.varian}/stok/tambah`, needsRow: true },
  { view: 'produk-stok-edit', path: `/produk/${IDS.produk}/varian/${IDS.varian}/stok/edit/${IDS.stok}`, needsRow: true, marker: { seeded: 'user@contoh.test' } },
  { view: 'produk-stok-hapus', path: `/produk/${IDS.produk}/varian/${IDS.varian}/stok/hapus/${IDS.stok}`, needsRow: true },
  { view: 'transaksi', path: '/transaksi', marker: { empty: 'Belum ada transaksi', seeded: 'TRX-SMOKE-1' } },
  { view: 'transaksi', path: '/transaksi?search=netflix', marker: 'Filter aktif' },
  { view: 'transaksi-detail', path: `/transaksi/${IDS.trx}`, needsRow: true, marker: { seeded: 'TRX-SMOKE-1' } },
  { view: 'user', path: '/user', marker: { seeded: String(IDS.user) } },
  { view: 'user-detail', path: `/user/${IDS.user}`, needsRow: true, marker: { seeded: 'TRX-SMOKE-1' } },
  { view: 'user-topup', path: `/user/${IDS.user}/topup`, needsRow: true },
  { view: 'user-kurangi', path: `/user/${IDS.user}/kurangi`, needsRow: true },
  { view: 'user-reset', path: `/user/${IDS.user}/reset`, needsRow: true },
  { view: 'deposit', path: '/deposit', marker: { seeded: 'DEP-SMOKE-1' } },
  { view: 'deposit-detail', path: `/deposit/${IDS.deposit}`, needsRow: true, marker: { seeded: 'DEP-SMOKE-1' } },
  { view: 'analitik', path: '/analitik' },
  { view: 'laporan', path: '/laporan' },
  { view: 'voucher', path: '/voucher', marker: { seeded: 'HEMAT10' } },
  { view: 'voucher-form', path: '/voucher/tambah' },
  { view: 'voucher-form', path: `/voucher/edit/${IDS.voucher}`, needsRow: true, marker: { seeded: 'HEMAT10' } },
  { view: 'voucher-hapus', path: `/voucher/hapus/${IDS.voucher}`, needsRow: true, marker: { seeded: 'HEMAT10' } },
  { view: 'voucher-detail', path: `/voucher/${IDS.voucher}`, needsRow: true, marker: { seeded: 'HEMAT10' } },
  { view: 'communication-broadcast', path: '/communication/broadcast', marker: { seeded: 'Promo Netflix' } },
  { view: 'communication-send', path: '/communication/send' },
  { view: 'communication-templates', path: '/communication/templates', marker: { seeded: 'Promo Netflix' } },
  { view: 'communication-template-form', path: '/communication/templates/tambah' },
  { view: 'communication-template-form', path: `/communication/templates/edit/${IDS.template}`, needsRow: true, marker: { seeded: 'Promo Netflix' } },
  { view: 'communication-history', path: '/communication/history', marker: { seeded: 'Promo Netflix minggu ini' } },
  { view: 'communication-history-detail', path: `/communication/history/${IDS.history}`, needsRow: true, marker: { seeded: 'Promo Netflix minggu ini' } },
  { view: 'settings-notifications', path: '/settings/notifications', marker: { seeded: 'Netflix' } },
  { view: 'settings-general', path: '/settings/general' },
  { view: 'settings-channel-contact', path: '/settings/channel-contact', marker: { seeded: '@toko_uji' } },
  { view: 'settings-bot-copy', path: '/settings/bot-copy', marker: { seeded: 'screen.welcome' } },
  { view: 'settings-bot-flow', path: '/settings/bot-flow' },
  { view: 'settings-payment-gateway', path: '/settings/payment-gateway' },
  { view: 'settings-supabase', path: '/settings/supabase' },
  { view: 'bulk-operations', path: '/bulk' },
  { view: 'supplier', path: '/supplier', marker: { seeded: 'Bite Uji' } },
  { view: 'supplier-form', path: '/supplier/tambah' },
  { view: 'supplier-form', path: `/supplier/${IDS.supplier}/edit`, needsRow: true, marker: { seeded: 'Bite Uji' } },
  { view: 'supplier-pengaturan', path: '/supplier/pengaturan' },
  { view: 'supplier-produk', path: `/supplier/${IDS.supplier}/produk`, needsRow: true, marker: { seeded: 'Netflix 1 Bulan' } },
  { view: 'admin-users', path: '/admin/users', marker: { seeded: 'seed-admin' } },
  { view: 'admin-user-form', path: '/admin/users/tambah' },
  { view: 'admin-user-form', path: `/admin/users/edit/${IDS.admin}`, needsRow: true, marker: { seeded: 'seed-admin' } },
  { view: 'admin-change-password', path: '/admin/change-password' },
  { view: 'admin-login-history', path: '/admin/login-history', marker: { seeded: 'seed-admin' } },
  { view: 'admin-audit-log', path: '/admin/audit-log', marker: { seeded: 'update_product' } },
]

function listen(handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({
        server,
        url: `http://127.0.0.1:${port}`,
      })
    })
    server.on('error', reject)
  })
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()))
  })
}

function setCookieLines(res) {
  if (typeof res.headers.getSetCookie === 'function') return res.headers.getSetCookie()
  const raw = res.headers.get('set-cookie')
  return raw ? [raw] : []
}

function cookiePair(res) {
  const line = setCookieLines(res).find((entry) => entry.toLowerCase().startsWith('connect.sid='))
  assert.ok(line, 'expected Set-Cookie connect.sid')
  return line.split(';')[0]
}

function csrfFromHtml(html) {
  const match = String(html).match(/name="_csrf" value="([^"]+)"/)
    || String(html).match(/name="csrf-token" content="([^"]+)"/)
  assert.ok(match, 'login page should render a CSRF token')
  return match[1]
}

function markerFor(page, mode) {
  if (!page.marker) return null
  const value = typeof page.marker === 'string' ? page.marker : (page.marker[mode] || null)
  if (!value) return null
  return Array.isArray(value) ? value : [value]
}

async function login(url) {
  const loginPage = await fetch(`${url}/login`, { redirect: 'manual' })
  assert.equal(loginPage.status, 200)
  const preCookie = cookiePair(loginPage)
  const token = csrfFromHtml(await loginPage.text())
  const loginOk = await fetch(`${url}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Cookie: preCookie,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      _csrf: token,
      username: process.env.ADMIN_USERNAME,
      password: process.env.ADMIN_PASSWORD,
    }).toString(),
  })
  assert.equal(loginOk.status, 302, await loginOk.text())
  assert.equal(loginOk.headers.get('location'), '/')
  return cookiePair(loginOk)
}

test('every dashboard page renders with the locals its route passes', { timeout: 120000 }, async () => {
  const { server, url } = await listen(app)
  const rendered = { empty: new Set(), seeded: new Set() }
  const emptySkips = []

  try {
    const cookie = await login(url)

    for (const mode of ['empty', 'seeded']) {
      dbMode.current = mode
      for (const page of PAGES) {
        const before = renders.length
        const res = await fetch(`${url}${page.path}`, {
          redirect: 'manual',
          headers: page.auth === false ? {} : { Cookie: cookie },
        })
        const body = await res.text()
        const seen = renders.slice(before).map((entry) => entry.view)
        const where = `${mode} ${page.path}`
        const snippet = body.replace(/\s+/g, ' ').slice(0, 500)

        assert.notEqual(res.status, 500, `${where} rendered 500: ${snippet}`)
        assert.equal(body.includes('is not defined'), false, `${where} missing local: ${snippet}`)

        if (page.needsRow && mode === 'empty' && res.status === 302) {
          const location = res.headers.get('location') || ''
          assert.equal(location.startsWith('/login'), false, `${where} lost the admin session`)
          if (!rendered.empty.has(page.view)) {
            emptySkips.push(`${page.view} via ${page.path} redirects (${location || 'no location'}) because the handler does not render when the primary row is null`)
          }
          continue
        }

        assert.equal(res.status, 200, `${where} status ${res.status} location=${res.headers.get('location')} body=${snippet}`)
        assert.match(body, /<html/i, `${where} should return HTML`)
        assert.ok(seen.includes(page.view), `${where} rendered [${seen.join(', ')}] instead of ${page.view}`)
        rendered[mode].add(page.view)
        const markers = markerFor(page, mode)
        if (markers) {
          for (const marker of markers) {
            assert.ok(body.includes(marker), `${where} should include ${marker}`)
          }
        }
      }
    }

    const uncovered = pageViews.filter((view) => !rendered.seeded.has(view))
    assert.deepEqual(uncovered, [], `seeded DB did not render: ${uncovered.join(', ')}`)

    const notRouted = pageViews.filter((view) => !renderedByRoutes.has(view))
    assert.deepEqual(notRouted, [], `page views with no res.render: ${notRouted.join(', ')}`)

    const emptyMissing = pageViews.filter((view) => !rendered.empty.has(view))
    for (const view of emptyMissing) {
      const cases = PAGES.filter((page) => page.view === view)
      assert.ok(cases.every((page) => page.needsRow), `${view} failed to render on an empty DB but is not a row-gated page`)
    }

    assert.equal(
      missingFixtures.size,
      0,
      `seeded queries hit tables with no fixture row: ${[...missingFixtures].join(', ')}`
    )

    // Partials are not route pages. Row-gated pages redirect on an empty DB,
    // so the template is only rendered in the seeded pass.
    console.log(`partials skipped: ${skippedPartials.join(', ')}`)
    console.log(`empty-db skips:\n${emptySkips.join('\n')}`)
    assert.ok(skippedPartials.includes('variant-row'))
    assert.ok(emptySkips.length > 0)
    assert.ok(queriedTables.has('Trx'))
  } finally {
    await close(server)
  }
})
