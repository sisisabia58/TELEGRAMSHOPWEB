require('dotenv').config()
const express = require('express')
const { NamaBot } = require('./settings.js')
const path = require('path')
const moment = require('moment-timezone')
const fs = require('fs')
const pakasir = require('./pakasir.js')
const supabase = require('./lib/supabase')
const runtimeSettings = require('./lib/runtime-settings')
const stock = require('./lib/stock')
const catalog = require('./lib/catalog')
const pricing = require('./lib/pricing')
const bulk = require('./lib/bulk')
const flowDraft = require('./lib/flow-draft')
const flowPreview = require('./lib/flow-preview')
const copyLib = require('./lib/copy')
const ejs = require('ejs')
const { formatrupiah, formatTanggal } = require('./lib/format')
const { buildOverviewModel, summarizeStock } = require('./lib/dashboard-overview')

const app = express()

// Set view engine
app.set('view engine', 'ejs')
app.set('views', path.join(__dirname, 'views'))

// Static files
app.use(express.static(path.join(__dirname, 'public')))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// ============================================
// PAKASIR PAYMENT WEBHOOK (public, no auth)
// ============================================
// Pakasir POSTs here when a payment completes. Webhooks are unsigned, so we
// re-verify via the Transaction Detail API before marking the payment paid.
// Fulfillment (deliver product / credit saldo) is performed by the bot
// (index.js) polling/reconciliation, guarded by the Payment status transition.
app.post('/webhook/pakasir', async (req, res) => {
  try {
    const { order_id, amount } = req.body || {}
    if (!order_id) return res.sendStatus(400)
    const trx = await pakasir.getTransactionStatus({ orderId: order_id, amount })
    if (trx && trx.status === 'completed') {
      await supabase
        .from('Payment')
        .update({ status: 'paid', updated_at: new Date().toISOString() })
        .eq('order_id', order_id)
        .eq('status', 'pending')
      console.log(`[Pakasir Webhook] order ${order_id} marked paid`)
    }
    res.sendStatus(200)
  } catch (e) {
    console.error('[Pakasir Webhook] error:', e.message)
    res.sendStatus(200)
  }
})

// Session configuration
const session = require('express-session')

const sessionSecret = process.env.SESSION_SECRET
if (!sessionSecret && process.env.NODE_ENV === 'production') {
  console.error('FATAL: SESSION_SECRET is required in production')
  process.exit(1)
}
app.set('trust proxy', 1)
app.use(session({
  secret: sessionSecret || 'dev-only-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.SECURE_COOKIES === 'true' || process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000,
  },
}))

// Middleware untuk check authentication
const isAuthenticated = (req, res, next) => {
  if (req.session && req.session.isLoggedIn) {
    return next()
  }
  res.redirect('/login')
}

// Middleware untuk check jika sudah login (redirect ke dashboard)
const redirectIfAuthenticated = (req, res, next) => {
  if (req.session && req.session.isLoggedIn) {
    return res.redirect('/')
  }
  next()
}

// formatrupiah / formatTanggal -> lib/format.js (di-require di bagian atas file)

async function loadProdukVarian(produkId, varianId) {
  const produk = await catalog.getProductById(produkId)
  if (!produk) return null
  const varian = (produk.variants || []).find((v) => v.id === varianId)
  if (!varian) return null
  return { produk, varian }
}

async function sumTodayRevenue(todayStart, todayEnd) {
  const PAGE_SIZE = 1000
  let offset = 0
  let total = 0
  while (true) {
    const { data, error } = await supabase
      .from('Trx')
      .select('harga')
      .gte('tanggal', todayStart.toISOString())
      .lt('tanggal', todayEnd.toISOString())
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) throw error
    const rows = data || []
    total += rows.reduce((sum, t) => sum + (t.harga || 0), 0)
    if (rows.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }
  return total
}

async function renderVariantRow(produk, variant) {
  const stokCount = variant.stok_count ?? await stock.getStokCountByVarianId(variant.id)
  return ejs.renderFile(
    path.join(__dirname, 'views', 'partials', 'variant-row.ejs'),
    { produk, variant: { ...variant, stok_count: stokCount }, formatrupiah },
    { async: true }
  )
}

function buildQueryString(params, skipAllKeys = []) {
  const entries = Object.entries(params || {}).filter(([key, value]) => {
    if (!value) return false
    return !(skipAllKeys.includes(key) && value === 'all')
  })
  return entries.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&')
}

function productVariantTitle(prefix, locals) {
  const produkNama = locals.produk?.nama || 'Produk'
  const varianLabel = locals.varian?.label || 'Varian'
  return `${prefix} ${produkNama} / ${varianLabel}`
}

const iconPlus = '<svg class="icon icon-sm" aria-hidden="true"><use href="#i-plus"></use></svg>'
const iconDownload = '<svg class="icon icon-sm" aria-hidden="true"><use href="#i-download"></use></svg>'
const iconTrash = '<svg class="icon icon-sm" aria-hidden="true"><use href="#i-trash"></use></svg>'

const chromeLocalsByView = {
  dashboard: () => ({ currentPage: 'dashboard', pageTitle: `Dashboard ${NamaBot}` }),
  produk: () => ({ currentPage: 'produk', pageTitle: 'Daftar Produk', topbarExtra: `<a href="/produk/tambah" class="btn btn-success">${iconPlus} Tambah Produk</a>` }),
  'produk-form': () => ({ currentPage: 'produk', pageTitle: 'Tambah Produk', topbarExtra: '<a href="/produk" class="btn-top">← Kembali</a>' }),
  'produk-detail': (locals) => ({
    currentPage: 'produk',
    pageTitle: locals.produk?.nama || 'Produk',
    topbarExtra: `<a href="/produk" class="btn-top">← Daftar Produk</a> <a href="/produk/hapus/${locals.produk?.id || ''}" class="btn-top" style="color:#dc3545;">${iconTrash} Hapus</a>`
  }),
  'produk-hapus': () => ({ currentPage: 'produk', pageTitle: 'Hapus Produk', topbarExtra: '<a href="/produk" class="btn-top">← Produk</a>' }),
  'produk-stok': (locals) => ({ currentPage: 'produk', pageTitle: `Stok: ${locals.produk?.nama || 'Produk'} — ${locals.varian?.label || 'Varian'}` }),
  'produk-stok-tambah': (locals) => ({ currentPage: 'produk', pageTitle: productVariantTitle('Tambah Stok —', locals) }),
  'produk-stok-edit': (locals) => ({ currentPage: 'produk', pageTitle: productVariantTitle('Edit Stok —', locals) }),
  'produk-stok-hapus': (locals) => ({ currentPage: 'produk', pageTitle: productVariantTitle('Hapus Stok —', locals) }),
  transaksi: (locals) => {
    const queryString = buildQueryString(locals.filters)
    const exportUrl = queryString ? `/transaksi/export?${queryString}` : '/transaksi/export'
    return { currentPage: 'transaksi', pageTitle: 'Daftar Transaksi', topbarExtra: `<a href="${exportUrl}" class="btn btn-success">${iconDownload} Export CSV</a>` }
  },
  'transaksi-detail': () => ({ currentPage: 'transaksi', pageTitle: 'Detail Transaksi', topbarExtra: '<a href="/transaksi" class="btn-top">← Transaksi</a>' }),
  user: () => ({ currentPage: 'user', pageTitle: 'Daftar User' }),
  'user-detail': () => ({ currentPage: 'user', pageTitle: 'Detail User', topbarExtra: '<a href="/user" class="btn-top">← User</a>' }),
  'user-topup': (locals) => ({ currentPage: 'user', pageTitle: 'Top Up Saldo', topbarExtra: `<a href="/user/${locals.user?.id || ''}" class="btn-top">← Detail User</a>` }),
  'user-kurangi': (locals) => ({ currentPage: 'user', pageTitle: 'Kurangi Saldo', topbarExtra: `<a href="/user/${locals.user?.id || ''}" class="btn-top">← Detail User</a>` }),
  'user-reset': (locals) => ({ currentPage: 'user', pageTitle: 'Reset Data User', topbarExtra: `<a href="/user/${locals.user?.id || ''}" class="btn-top">← Detail User</a>` }),
  deposit: (locals) => {
    const exportQuery = buildQueryString(locals.filters, ['status', 'metode'])
    return { currentPage: 'deposit', pageTitle: 'Manajemen Deposit', topbarExtra: `<a href="/deposit/export${exportQuery ? `?${exportQuery}` : ''}" class="btn btn-success">${iconDownload} Export CSV</a>` }
  },
  'deposit-detail': () => ({ currentPage: 'deposit', pageTitle: 'Detail Deposit', topbarExtra: '<a href="/deposit" class="btn-top">← Deposit</a>' }),
  analitik: () => ({ currentPage: 'analitik', pageTitle: 'Analitik' }),
  laporan: () => ({ currentPage: 'laporan', pageTitle: 'Laporan' }),
  voucher: () => ({ currentPage: 'voucher', pageTitle: 'Manajemen Voucher', topbarExtra: `<a href="/voucher/tambah" class="btn btn-success">${iconPlus} Tambah Voucher</a> <a href="/voucher/export" class="btn btn-primary">${iconDownload} Export CSV</a>` }),
  'voucher-form': (locals) => ({ currentPage: 'voucher', pageTitle: locals.action === 'edit' ? 'Edit Voucher' : 'Tambah Voucher', topbarExtra: '<a href="/voucher" class="btn-top">← Kembali</a>' }),
  'voucher-detail': () => ({ currentPage: 'voucher', pageTitle: 'Detail Voucher', topbarExtra: '<a href="/voucher" class="btn-top">← Voucher</a>' }),
  'voucher-hapus': () => ({ currentPage: 'voucher', pageTitle: 'Hapus Voucher', topbarExtra: '<a href="/voucher" class="btn-top">← Voucher</a>' }),
  'communication-broadcast': () => ({ currentPage: 'communication', pageTitle: 'Broadcast Message', topbarExtra: '<a href="/communication/history" class="btn-top">History</a> <a href="/communication/templates" class="btn-top">Templates</a>' }),
  'communication-send': () => ({ currentPage: 'communication', pageTitle: 'Send Message', topbarExtra: '<a href="/communication/broadcast" class="btn-top">Broadcast</a> <a href="/communication/templates" class="btn-top">Templates</a> <a href="/communication/history" class="btn-top">History</a>' }),
  'communication-templates': () => ({ currentPage: 'communication', pageTitle: 'Message Templates', topbarExtra: `<a href="/communication/templates/tambah" class="btn btn-success">${iconPlus} Tambah Template</a> <a href="/communication/broadcast" class="btn-top">Broadcast</a> <a href="/communication/send" class="btn-top">Send</a> <a href="/communication/history" class="btn-top">History</a>` }),
  'communication-template-form': (locals) => ({ currentPage: 'communication', pageTitle: locals.action === 'tambah' ? 'Tambah Template' : 'Edit Template', topbarExtra: '<a href="/communication/templates" class="btn-top">← Templates</a> <a href="/communication/broadcast" class="btn-top">Broadcast</a> <a href="/communication/send" class="btn-top">Send</a> <a href="/communication/history" class="btn-top">History</a>' }),
  'communication-history': () => ({ currentPage: 'communication', pageTitle: 'Message History', topbarExtra: '<a href="/communication/broadcast" class="btn-top">Broadcast</a> <a href="/communication/send" class="btn-top">Send</a> <a href="/communication/templates" class="btn-top">Templates</a>' }),
  'communication-history-detail': () => ({ currentPage: 'communication', pageTitle: 'Detail Message History', topbarExtra: '<a href="/communication/history" class="btn-top">History</a> <a href="/communication/broadcast" class="btn-top">Broadcast</a>' }),
  'settings-general': () => ({ currentPage: 'settings-general', pageTitle: 'General Settings' }),
  'settings-channel-contact': () => ({ currentPage: 'settings-channel-contact', pageTitle: 'Channel & Contact' }),
  'settings-payment-gateway': () => ({ currentPage: 'settings-payment-gateway', pageTitle: 'Payment Gateway Settings' }),
  'settings-supabase': () => ({ currentPage: 'settings-supabase', pageTitle: 'Supabase Database Settings' }),
  'settings-notifications': () => ({ currentPage: 'settings-notifications', pageTitle: 'Notification Settings' }),
  'settings-bot-copy': () => ({ currentPage: 'settings-bot-copy', pageTitle: 'Bot Copy' }),
  'settings-bot-flow': () => ({ currentPage: 'settings-bot-flow', pageTitle: 'Bot Flow' }),
  'bulk-operations': () => ({ currentPage: 'bulk', pageTitle: 'Bulk Operations' }),
  'admin-users': () => ({ currentPage: 'admin-users', pageTitle: 'Manajemen Admin', topbarExtra: `<a href="/admin/users/tambah" class="btn btn-success">${iconPlus} Tambah Admin</a>` }),
  'admin-user-form': (locals) => ({ currentPage: 'admin-users', pageTitle: locals.action === 'tambah' ? 'Tambah Admin' : 'Edit Admin', topbarExtra: '<a href="/admin/users" class="btn-top">← Admin Users</a>' }),
  'admin-change-password': () => ({ currentPage: 'admin-change-password', pageTitle: 'Ubah Password', topbarExtra: '<a href="/" class="btn-top">← Dashboard</a>' }),
  'admin-login-history': () => ({ currentPage: 'admin-login', pageTitle: 'Login History' }),
  'admin-audit-log': () => ({ currentPage: 'admin-audit', pageTitle: 'Audit Log' }),
}

function withChromeLocals(req, view, locals = {}) {
  const viewName = String(view).replace(/\.ejs$/, '')
  const resolver = chromeLocalsByView[viewName]
  if (!resolver) return locals

  const chrome = resolver(locals)
  return {
    req,
    topbarExtra: '',
    ...chrome,
    ...locals,
    currentPage: locals.currentPage || chrome.currentPage,
    pageTitle: locals.pageTitle || chrome.pageTitle,
    topbarExtra: locals.topbarExtra || chrome.topbarExtra || ''
  }
}

app.use((req, res, next) => {
  const render = res.render.bind(res)
  res.render = (view, locals, callback) => {
    if (typeof locals === 'function') {
      callback = locals
      locals = {}
    }
    return render(view, withChromeLocals(req, view, locals || {}), callback)
  }
  next()
})

// Helper: Send Telegram message to Feed Channel
async function sendFeedMessage(text, type = 'stock') {
  try {
    const { data } = await supabase
      .from('NotificationSettings')
      .select('setting_key, setting_value')
      .in('setting_key', ['feed_channel', 'feed_stock_enabled', 'feed_purchase_enabled'])
    
    let feedChannel = '';
    let feedStockEnabled = true;
    let feedPurchaseEnabled = true;
    
    if (data && data.length) {
      data.forEach((row) => {
        const v = row.setting_value?.value
        if (v !== undefined && v !== null) {
          if (row.setting_key === 'feed_channel') feedChannel = v
          else if (row.setting_key === 'feed_stock_enabled') feedStockEnabled = (v === true || v === 'true')
          else if (row.setting_key === 'feed_purchase_enabled') feedPurchaseEnabled = (v === true || v === 'true')
        }
      })
    }
    
    if (!feedChannel) return;
    if (type === 'stock' && !feedStockEnabled) return;
    if (type === 'purchase' && !feedPurchaseEnabled) return;
    
    let target = feedChannel;
    if (typeof target === 'string' && !target.startsWith('@') && !target.startsWith('-') && !target.startsWith('http')) {
      target = '@' + target;
    } else if (typeof target === 'string' && target.startsWith('https://t.me/')) {
      target = '@' + target.replace('https://t.me/', '');
    }
    
    const { TokenBot } = require('./settings.js');
    const axios = require('axios');
    await axios.post(`https://api.telegram.org/bot${TokenBot}/sendMessage`, {
      chat_id: target,
      text: text,
      parse_mode: 'Markdown'
    });
  } catch (error) {
    console.error('Error sending feed message from dashboard:', error.message);
  }
}


// ============================================
// SECURITY & ACCESS MANAGEMENT
// ============================================

const bcrypt = require('bcrypt')

// Helper: Hash password
async function hashPassword(password) {
  const saltRounds = 10
  return await bcrypt.hash(password, saltRounds)
}

// Helper: Compare password
async function comparePassword(password, hash) {
  return await bcrypt.compare(password, hash)
}

// Helper: Get client IP
function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0] || 
         req.connection.remoteAddress || 
         req.socket.remoteAddress ||
         'unknown'
}

// Helper: Log activity
async function logActivity(req, action, entityType = null, entityId = null, details = null) {
  try {
    await supabase
      .from('AuditLog')
      .insert([{
        admin_id: req.session.adminId || null,
        username: req.session.username || 'unknown',
        action: action,
        entity_type: entityType,
        entity_id: entityId,
        details: details,
        ip_address: getClientIP(req)
      }])
  } catch (error) {
    console.error('Error logging activity:', error)
  }
}

// Middleware: Role-based access control
const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.session || !req.session.isLoggedIn) {
      return res.redirect('/login')
    }
    
    if (!req.session.role || !roles.includes(req.session.role)) {
      return res.status(403).send('Akses ditolak. Anda tidak memiliki permission untuk halaman ini.')
    }
    
    next()
  }
}

// Middleware: Rate limiting sederhana
const rateLimitMap = new Map()
const rateLimit = (maxRequests = 5, windowMs = 15 * 60 * 1000) => {
  return (req, res, next) => {
    const ip = getClientIP(req)
    const key = `${ip}-${req.path}`
    const now = Date.now()
    
    if (!rateLimitMap.has(key)) {
      rateLimitMap.set(key, { count: 1, resetTime: now + windowMs })
      return next()
    }
    
    const record = rateLimitMap.get(key)
    
    if (now > record.resetTime) {
      record.count = 1
      record.resetTime = now + windowMs
      return next()
    }
    
    if (record.count >= maxRequests) {
      return res.status(429).send('Too many requests. Please try again later.')
    }
    
    record.count++
    next()
  }
}

// Route: Login Page
app.get('/login', redirectIfAuthenticated, (req, res) => {
  res.render('login', {
    title: 'Login - Dashboard',
    namaBot: NamaBot,
    error: req.query.error || null
  })
})

// Route: Login Process
app.post('/login', redirectIfAuthenticated, rateLimit(5, 15 * 60 * 1000), async (req, res) => {
  const { username, password } = req.body
  const ip = getClientIP(req)
  const userAgent = req.headers['user-agent'] || 'unknown'
  
  try {
    // Cek apakah ada admin di database
    const { data: admin, error } = await supabase
      .from('Admin')
      .select('*')
      .eq('username', username.toLowerCase().trim())
      .single()

    // Fallback ke .env jika tidak ada admin di database
    if (!admin || error) {
      const adminUsername = process.env.ADMIN_USERNAME || 'admin'
      const adminPassword = process.env.ADMIN_PASSWORD || 'admin123'
      
      if (username === adminUsername && password === adminPassword) {
        req.session.isLoggedIn = true
        req.session.username = username
        req.session.role = 'admin'
        req.session.loginTime = new Date()
        
        await logActivity(req, 'LOGIN', null, null, { method: 'env', status: 'success' })
        console.log(`[${new Date().toISOString()}] User ${username} logged in (env)`)
        return res.redirect('/')
      } else {
        try {
          await supabase.from('LoginHistory').insert([{
            username: username,
            ip_address: ip,
            user_agent: userAgent,
            status: 'failed'
          }])
        } catch (e) {
          // Ignore if table doesn't exist yet
        }
        return res.redirect('/login?error=invalid')
      }
    }

    // Cek apakah admin aktif
    if (!admin.is_active) {
      try {
        await supabase.from('LoginHistory').insert([{
          admin_id: admin.id,
          username: username,
          ip_address: ip,
          user_agent: userAgent,
          status: 'failed'
        }])
      } catch (e) {
        // Ignore if table doesn't exist yet
      }
      return res.redirect('/login?error=inactive')
    }

    // Verifikasi password
    const isValidPassword = await comparePassword(password, admin.password_hash)
    
    if (!isValidPassword) {
      try {
        await supabase.from('LoginHistory').insert([{
          admin_id: admin.id,
          username: username,
          ip_address: ip,
          user_agent: userAgent,
          status: 'failed'
        }])
      } catch (e) {
        // Ignore if table doesn't exist yet
      }
      return res.redirect('/login?error=invalid')
    }

    // Login berhasil
    req.session.isLoggedIn = true
    req.session.username = admin.username
    req.session.role = admin.role
    req.session.adminId = admin.id
    req.session.loginTime = new Date()

    // Update last login
    try {
      await supabase
        .from('Admin')
        .update({ 
          last_login: new Date().toISOString(),
          last_login_ip: ip
        })
        .eq('id', admin.id)
    } catch (e) {
      // Ignore if table doesn't exist yet
    }

    // Log login history
    try {
      await supabase.from('LoginHistory').insert([{
        admin_id: admin.id,
        username: admin.username,
        ip_address: ip,
        user_agent: userAgent,
        status: 'success'
      }])
    } catch (e) {
      // Ignore if table doesn't exist yet
    }

    await logActivity(req, 'LOGIN', null, null, { method: 'database', status: 'success' })
    console.log(`[${new Date().toISOString()}] User ${admin.username} logged in`)
    res.redirect('/')
  } catch (error) {
    console.error('Error during login:', error)
    res.redirect('/login?error=server')
  }
})

// Route: Logout
app.get('/logout', (req, res) => {
  const username = req.session.username
  logActivity(req, 'LOGOUT', null, null, { status: 'success' })
  req.session.destroy((err) => {
    if (err) {
      console.error('Error destroying session:', err)
    } else {
      console.log(`[${new Date().toISOString()}] User ${username} logged out`)
    }
    res.redirect('/login')
  })
})

// ============================================
// SECURITY & ACCESS MANAGEMENT ROUTES
// ============================================

// Route: Daftar Admin
app.get('/admin/users', isAuthenticated, requireRole('admin'), async (req, res) => {
  try {
    const { data: admins, error } = await supabase
      .from('Admin')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) throw error

    res.render('admin-users', {
      title: `Manajemen Admin - ${NamaBot}`,
      namaBot: NamaBot,
      username: req.session.username,
      admins: admins || [],
      formatTanggal,
      success: req.query.success || null,
      error: req.query.error || null,
      req: req
    })
  } catch (error) {
    console.error('Error loading admins:', error)
    res.status(500).send('Error loading admins: ' + error.message)
  }
})

// Route: Form Tambah Admin
app.get('/admin/users/tambah', isAuthenticated, requireRole('admin'), (req, res) => {
  res.render('admin-user-form', {
    title: `Tambah Admin - ${NamaBot}`,
    namaBot: NamaBot,
    username: req.session.username,
    req: req,
    admin: null,
    action: 'tambah',
    error: null
  })
})

// Route: Proses Tambah Admin
app.post('/admin/users/tambah', isAuthenticated, requireRole('admin'), async (req, res) => {
  try {
    const { username, password, role } = req.body
    
    if (!username || !password || !role) {
      return res.render('admin-user-form', {
        title: `Tambah Admin - ${NamaBot}`,
        namaBot: NamaBot,
        username: req.session.username,
        req: req,
        admin: req.body,
        action: 'tambah',
        error: 'Semua field wajib diisi!'
      })
    }

    // Hash password
    const passwordHash = await hashPassword(password)

    // Insert admin
    const { data, error } = await supabase
      .from('Admin')
      .insert([{
        username: username.toLowerCase().trim(),
        password_hash: passwordHash,
        role: role,
        is_active: true
      }])
      .select()
      .single()

    if (error) throw error

    await logActivity(req, 'CREATE_ADMIN', 'Admin', data.id, { username: data.username, role: data.role })
    console.log(`[${new Date().toISOString()}] Admin ditambahkan: ${data.username} oleh ${req.session.username}`)
    res.redirect('/admin/users?success=tambah')
  } catch (error) {
    console.error('Error adding admin:', error)
    res.render('admin-user-form', {
      title: `Tambah Admin - ${NamaBot}`,
      namaBot: NamaBot,
      username: req.session.username,
      req: req,
      admin: req.body,
      action: 'tambah',
      error: error.message || 'Gagal menambahkan admin!'
    })
  }
})

// Route: Form Edit Admin
app.get('/admin/users/edit/:id', isAuthenticated, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params
    
    const { data: admin, error } = await supabase
      .from('Admin')
      .select('*')
      .eq('id', id)
      .single()

    if (error || !admin) {
      return res.redirect('/admin/users?error=notfound')
    }

    res.render('admin-user-form', {
      title: `Edit Admin - ${NamaBot}`,
      namaBot: NamaBot,
      username: req.session.username,
      req: req,
      admin: admin,
      action: 'edit',
      error: null
    })
  } catch (error) {
    console.error('Error loading admin:', error)
    res.redirect('/admin/users?error=load')
  }
})

// Route: Proses Edit Admin
app.post('/admin/users/edit/:id', isAuthenticated, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params
    const { username, password, role, is_active } = req.body
    
    const updateData = {
      username: username.toLowerCase().trim(),
      role: role,
      is_active: is_active === 'on'
    }

    // Update password jika diisi
    if (password && password.trim() !== '') {
      updateData.password_hash = await hashPassword(password)
    }

    const { error } = await supabase
      .from('Admin')
      .update(updateData)
      .eq('id', id)

    if (error) throw error

    await logActivity(req, 'UPDATE_ADMIN', 'Admin', id, { username: updateData.username, role: updateData.role })
    console.log(`[${new Date().toISOString()}] Admin diedit: ID ${id} oleh ${req.session.username}`)
    res.redirect('/admin/users?success=edit')
  } catch (error) {
    console.error('Error updating admin:', error)
    res.redirect('/admin/users?error=edit')
  }
})

// Route: Hapus Admin
app.post('/admin/users/hapus/:id', isAuthenticated, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params
    
    // Jangan izinkan hapus diri sendiri
    if (req.session.adminId === id) {
      return res.redirect('/admin/users?error=cannotdelete')
    }

    const { error } = await supabase
      .from('Admin')
      .delete()
      .eq('id', id)

    if (error) throw error

    await logActivity(req, 'DELETE_ADMIN', 'Admin', id)
    console.log(`[${new Date().toISOString()}] Admin dihapus: ID ${id} oleh ${req.session.username}`)
    res.redirect('/admin/users?success=hapus')
  } catch (error) {
    console.error('Error deleting admin:', error)
    res.redirect('/admin/users?error=hapus')
  }
})

// Route: Change Password
app.get('/admin/change-password', isAuthenticated, (req, res) => {
  res.render('admin-change-password', {
    title: `Ubah Password - ${NamaBot}`,
    namaBot: NamaBot,
    username: req.session.username,
    req: req,
    error: null,
    success: req.query.success || null
  })
})

// Route: Proses Change Password
app.post('/admin/change-password', isAuthenticated, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body
    
    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.render('admin-change-password', {
        title: `Ubah Password - ${NamaBot}`,
        namaBot: NamaBot,
        username: req.session.username,
        req: req,
        error: 'Semua field wajib diisi!',
        success: null
      })
    }

    if (newPassword !== confirmPassword) {
      return res.render('admin-change-password', {
        title: `Ubah Password - ${NamaBot}`,
        namaBot: NamaBot,
        username: req.session.username,
        req: req,
        error: 'Password baru dan konfirmasi tidak cocok!',
        success: null
      })
    }

    if (newPassword.length < 6) {
      return res.render('admin-change-password', {
        title: `Ubah Password - ${NamaBot}`,
        namaBot: NamaBot,
        username: req.session.username,
        req: req,
        error: 'Password baru minimal 6 karakter!',
        success: null
      })
    }

    // Jika login dari .env, tidak bisa ubah password (harus buat admin di database dulu)
    if (!req.session.adminId) {
      return res.render('admin-change-password', {
        title: `Ubah Password - ${NamaBot}`,
        namaBot: NamaBot,
        username: req.session.username,
        req: req,
        error: 'Untuk mengubah password, silakan buat akun admin di database terlebih dahulu.',
        success: null
      })
    }

    // Ambil admin saat ini
    const { data: admin, error: adminError } = await supabase
      .from('Admin')
      .select('*')
      .eq('id', req.session.adminId)
      .single()

    if (adminError || !admin) {
      return res.render('admin-change-password', {
        title: `Ubah Password - ${NamaBot}`,
        namaBot: NamaBot,
        username: req.session.username,
        req: req,
        error: 'Admin tidak ditemukan!',
        success: null
      })
    }

    // Verifikasi password lama
    const isValidPassword = await comparePassword(currentPassword, admin.password_hash)
    if (!isValidPassword) {
      return res.render('admin-change-password', {
        title: `Ubah Password - ${NamaBot}`,
        namaBot: NamaBot,
        username: req.session.username,
        req: req,
        error: 'Password lama salah!',
        success: null
      })
    }

    // Update password
    const newPasswordHash = await hashPassword(newPassword)
    const { error: updateError } = await supabase
      .from('Admin')
      .update({ password_hash: newPasswordHash })
      .eq('id', req.session.adminId)

    if (updateError) throw updateError

    await logActivity(req, 'CHANGE_PASSWORD', 'Admin', req.session.adminId)
    console.log(`[${new Date().toISOString()}] Password diubah oleh ${req.session.username}`)
    res.redirect('/admin/change-password?success=changed')
  } catch (error) {
    console.error('Error changing password:', error)
    res.render('admin-change-password', {
      title: `Ubah Password - ${NamaBot}`,
      namaBot: NamaBot,
      username: req.session.username,
      req: req,
      error: error.message || 'Gagal mengubah password!',
      success: null
    })
  }
})

// Route: Login History
app.get('/admin/login-history', isAuthenticated, requireRole('admin'), async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = 50
    const offset = (page - 1) * limit

    const { data: loginHistory, error, count } = await supabase
      .from('LoginHistory')
      .select('*', { count: 'exact' })
      .order('login_time', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) throw error

    const totalPages = Math.ceil((count || 0) / limit)
    const totalCount = count != null ? count : 0

    res.render('admin-login-history', {
      title: `Login History - ${NamaBot}`,
      namaBot: NamaBot,
      username: req.session.username,
      req: req,
      loginHistory: loginHistory || [],
      currentPageNum: page,
      totalPages: totalPages,
      totalCount,
      limit,
      formatTanggal
    })
  } catch (error) {
    console.error('Error loading login history:', error)
    res.status(500).send('Error loading login history: ' + error.message)
  }
})

// Route: Audit Log
app.get('/admin/audit-log', isAuthenticated, requireRole('admin'), async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = 50
    const offset = (page - 1) * limit

    // Get filters from query params
    const filters = {
      search: req.query.search || '',
      username: req.query.username || '',
      action: req.query.action || '',
      entityType: req.query.entityType || '',
      startDate: req.query.startDate || '',
      endDate: req.query.endDate || ''
    }

    // Build query
    let query = supabase
      .from('AuditLog')
      .select('*', { count: 'exact' })

    // Apply filters
    if (filters.username) {
      query = query.ilike('username', `%${filters.username}%`)
    }

    if (filters.action) {
      query = query.ilike('action', `%${filters.action}%`)
    }

    if (filters.entityType) {
      query = query.ilike('entity_type', `%${filters.entityType}%`)
    }

    if (filters.startDate) {
      query = query.gte('created_at', `${filters.startDate}T00:00:00Z`)
    }

    if (filters.endDate) {
      query = query.lte('created_at', `${filters.endDate}T23:59:59Z`)
    }

    // Apply search (searches across multiple fields if no specific filters are set)
    if (filters.search) {
      const searchTerm = `%${filters.search}%`
      // If specific filters are set, search only in those fields
      // Otherwise search across all searchable fields
      if (filters.username || filters.action || filters.entityType) {
        // Search in fields that aren't already filtered
        const searchFields = []
        if (!filters.username) searchFields.push(`username.ilike.${searchTerm}`)
        if (!filters.action) searchFields.push(`action.ilike.${searchTerm}`)
        if (!filters.entityType) searchFields.push(`entity_type.ilike.${searchTerm}`)
        searchFields.push(`ip_address.ilike.${searchTerm}`)
        if (searchFields.length > 0) {
          query = query.or(searchFields.join(','))
        }
      } else {
        // Search across all fields
        query = query.or(`username.ilike.${searchTerm},action.ilike.${searchTerm},entity_type.ilike.${searchTerm},ip_address.ilike.${searchTerm}`)
      }
    }

    // Order and paginate
    const { data: auditLogs, error, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) throw error

    const totalPages = Math.ceil((count || 0) / limit)

    res.render('admin-audit-log', {
      title: `Audit Log - ${NamaBot}`,
      namaBot: NamaBot,
      username: req.session.username,
      req: req,
      auditLogs: auditLogs || [],
      currentPageNum: page,
      totalPages: totalPages,
      totalLogs: count || 0,
      filters: filters,
      formatTanggal
    })
  } catch (error) {
    console.error('Error loading audit log:', error)
    res.status(500).send('Error loading audit log: ' + error.message)
  }
})

// Route: Dashboard Home
app.get('/', isAuthenticated, async (req, res) => {
  try {
    const todayStart = moment.tz('Asia/Jakarta').startOf('day')
    const todayEnd = todayStart.clone().add(1, 'day')

    const [
      pendingDepositsResult,
      variantsResult,
      thresholdsResult,
      todayTxnCountResult,
      todayRevenue,
      recentTrxResult,
      activeFlowResult,
    ] = await Promise.all([
      supabase.from('Deposit').select('*').eq('status', 'pending').order('tanggal', { ascending: true }).limit(10),
      supabase.from('Varian').select('id, produk_id, label, kode, harga, is_active, produk:Produk(nama, slug)').eq('is_active', true).order('urutan', { ascending: true }),
      supabase.from('ProductStockThreshold').select('varian_id, threshold, is_active'),
      supabase
        .from('Trx')
        .select('*', { count: 'exact', head: true })
        .gte('tanggal', todayStart.toISOString())
        .lt('tanggal', todayEnd.toISOString()),
      sumTodayRevenue(todayStart, todayEnd),
      supabase.from('Trx').select('*').order('tanggal', { ascending: false }).limit(5),
      supabase.from('BotFlow').select('draft_updated_at').eq('is_active', true).maybeSingle(),
    ])

    const variants = variantsResult.data || []
    const stockCounts = await stock.getStokCountsByKode(variants.map((v) => v.kode))
    const thresholdsByVarianId = Object.create(null)
    for (const row of thresholdsResult.data || []) {
      if (row.is_active !== false) thresholdsByVarianId[row.varian_id] = row.threshold
    }

    const overview = buildOverviewModel({
      pendingDeposits: pendingDepositsResult.data || [],
      variants: variants.map((variant) => ({
        ...variant,
        produk_nama: variant.produk?.nama || '',
        produk_slug: variant.produk?.slug || '',
        stok_count: stockCounts[String(variant.kode).toLowerCase()] || 0,
        threshold: thresholdsByVarianId[variant.id],
      })),
      todayRevenue,
      todayTxnCount: todayTxnCountResult.count ?? 0,
      recentTxns: recentTrxResult.data || [],
      flowDraftUpdatedAt: activeFlowResult.data?.draft_updated_at || null,
    })

    res.render('dashboard', {
      title: `Dashboard - ${NamaBot}`,
      namaBot: NamaBot,
      username: req.session.username,
      overview,
      formatrupiah,
      formatTanggal
    })
  } catch (error) {
    console.error('Error loading dashboard:', error)
    res.status(500).send('Error loading dashboard: ' + error.message)
  }
})

// Route: Daftar Produk
app.get('/produk', isAuthenticated, async (req, res) => {
  try {
    const list = await catalog.listProducts({ activeOnly: false, withStock: true })
    const products = list.map((p) => ({
      ...p,
      variant_count: p.variants.length,
      total_stock: (p.variants || []).reduce((sum, v) => sum + (v.stok_count || 0), 0),
    }))

    res.render('produk', {
      title: `Produk - ${NamaBot}`,
      namaBot: NamaBot,
      username: req.session.username,
      currentPage: 'produk',
      pageTitle: 'Daftar Produk',
      products,
      formatrupiah,
      success: req.query.success || null,
      error: req.query.error || null,
      req: req,
    })
  } catch (error) {
    console.error('Error loading products:', error)
    res.status(500).send('Error loading products: ' + error.message)
  }
})

app.get('/stok', isAuthenticated, async (req, res) => {
  try {
    const [products, thresholdsResult] = await Promise.all([
      catalog.listProducts({ activeOnly: false, withStock: true }),
      supabase.from('ProductStockThreshold').select('varian_id, threshold, is_active'),
    ])
    const thresholdsByVarianId = Object.create(null)
    for (const row of thresholdsResult.data || []) {
      if (row.is_active !== false) thresholdsByVarianId[row.varian_id] = row.threshold
    }
    const rows = []
    for (const p of products) {
      for (const v of p.variants || []) {
        rows.push({
          produk_id: p.id,
          produk_nama: p.nama,
          varian_id: v.id,
          label: v.label,
          kode: v.kode,
          stok_count: v.stok_count || 0,
          threshold: thresholdsByVarianId[v.id],
          is_active: v.is_active !== false,
        })
      }
    }
    rows.sort((a, b) => a.stok_count - b.stok_count || a.produk_nama.localeCompare(b.produk_nama))
    const stockSummary = summarizeStock(rows)
    res.render('stok', {
      title: `Stock - ${NamaBot}`,
      namaBot: NamaBot,
      username: req.session.username,
      currentPage: 'stok',
      pageTitle: 'Stock',
      rows,
      stockSummary,
      req,
    })
  } catch (e) {
    console.error(e)
    res.status(500).send(e.message)
  }
})

app.get('/pricing', isAuthenticated, async (req, res) => {
  try {
    const products = await catalog.listProducts({ activeOnly: false, withStock: false })
    const rows = []
    const varianIds = []
    for (const p of products) {
      for (const v of p.variants || []) {
        rows.push({
          produk_id: p.id,
          produk_nama: p.nama,
          varian_id: v.id,
          label: v.label,
          kode: v.kode,
          harga: v.harga || 0,
          is_active: v.is_active !== false,
        })
        varianIds.push(v.id)
      }
    }

    const tierCounts = Object.create(null)
    if (varianIds.length) {
      const { data: tiers, error } = await supabase
        .from('HargaTier')
        .select('varian_id')
        .in('varian_id', varianIds)
      if (error) throw error
      for (const t of tiers || []) {
        tierCounts[t.varian_id] = (tierCounts[t.varian_id] || 0) + 1
      }
    }

    for (const row of rows) {
      row.tier_count = tierCounts[row.varian_id] || 0
    }

    rows.sort((a, b) => a.produk_nama.localeCompare(b.produk_nama) || a.label.localeCompare(b.label))

    res.render('pricing', {
      title: `Pricing - ${NamaBot}`,
      namaBot: NamaBot,
      username: req.session.username,
      currentPage: 'pricing',
      pageTitle: 'Pricing',
      rows,
      formatrupiah,
      req,
    })
  } catch (e) {
    console.error(e)
    res.status(500).send(e.message)
  }
})

// Route: Form Tambah Produk (+ varian awal)
app.get('/produk/tambah', isAuthenticated, (req, res) => {
  res.render('produk-form', {
    title: `Tambah Produk - ${NamaBot}`,
    namaBot: NamaBot,
    username: req.session.username,
    currentPage: 'produk',
    produk: null,
    action: 'tambah',
    error: null,
    req: req,
  })
})

// Route: Proses Tambah Produk + varian awal
app.post('/produk/tambah', isAuthenticated, async (req, res) => {
  const renderForm = (error) =>
    res.render('produk-form', {
      title: `Tambah Produk - ${NamaBot}`,
      namaBot: NamaBot,
      username: req.session.username,
      currentPage: 'produk',
      produk: req.body,
      action: 'tambah',
      error,
      req: req,
    })

  try {
    const {
      nama,
      kategori,
      deskripsi,
      snk,
      banner_url,
      varian_label,
      varian_kode,
      harga,
      format,
    } = req.body

    if (!nama || !deskripsi || !snk || !varian_kode || !harga) {
      return renderForm('Nama, deskripsi, SNK, kode varian, dan harga wajib diisi!')
    }

    const kodeLower = String(varian_kode).toLowerCase().trim()
    const hargaInt = parseInt(harga, 10)
    if (isNaN(hargaInt) || hargaInt < 0) {
      return renderForm('Harga harus berupa angka positif!')
    }

    const { data: existingVarian } = await supabase
      .from('Varian')
      .select('id')
      .eq('kode', kodeLower)
      .maybeSingle()

    if (existingVarian) {
      return renderForm('Kode varian sudah digunakan!')
    }

    const slug = catalog.slugify(nama)
    const { data: produk, error: produkError } = await supabase
      .from('Produk')
      .insert([
        {
          nama: nama.trim(),
          slug,
          kategori: kategori ? kategori.trim().toLowerCase() : 'umum',
          deskripsi: deskripsi.trim(),
          snk: snk.trim(),
          banner_url: banner_url ? banner_url.trim() : null,
          is_active: true,
          urutan: 0,
        },
      ])
      .select()
      .single()

    if (produkError) throw produkError

    const { error: varianError } = await supabase.from('Varian').insert([
      {
        produk_id: produk.id,
        label: (varian_label || 'Default').trim(),
        kode: kodeLower,
        harga: hargaInt,
        format: format ? format.trim() : null,
        urutan: 1,
        is_active: true,
        terjual: 0,
      },
    ])

    if (varianError) {
      await supabase.from('Produk').delete().eq('id', produk.id)
      throw varianError
    }

    console.log(
      `[${new Date().toISOString()}] Produk ditambahkan: ${nama} (${kodeLower}) oleh ${req.session.username}`
    )
    res.redirect(`/produk/${produk.id}?success=tambah`)
  } catch (error) {
    console.error('Error adding product:', error)
    renderForm(error.message || 'Gagal menambahkan produk!')
  }
})

// Route: Hapus Produk (dengan konfirmasi)
app.get('/produk/hapus/:id', isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params
    const produk = await catalog.getProductById(id)

    if (!produk) {
      return res.redirect('/produk?error=notfound')
    }

    res.render('produk-hapus', {
      title: `Hapus Produk - ${NamaBot}`,
      namaBot: NamaBot,
      username: req.session.username,
      produk,
      formatrupiah,
    })
  } catch (error) {
    console.error('Error loading product:', error)
    res.redirect('/produk?error=load')
  }
})

// Route: Proses Hapus Produk
app.post('/produk/hapus/:id', isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params
    const { error } = await supabase.from('Produk').delete().eq('id', id)
    if (error) throw error

    console.log(`[${new Date().toISOString()}] Produk dihapus: ID ${id} oleh ${req.session.username}`)
    res.redirect('/produk?success=hapus')
  } catch (error) {
    console.error('Error deleting product:', error)
    res.redirect('/produk?error=hapus')
  }
})

// Route: Detail Produk
app.get('/produk/:id', isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params
    if (id === 'tambah' || id === 'hapus' || id === 'edit') {
      return res.redirect('/produk')
    }

    const produk = await catalog.getProductById(id)
    if (!produk) {
      return res.redirect('/produk?error=notfound')
    }

    res.render('produk-detail', {
      title: `${produk.nama} - ${NamaBot}`,
      namaBot: NamaBot,
      username: req.session.username,
      currentPage: 'produk',
      produk,
      formatrupiah,
      success: req.query.success || null,
      error: req.query.error || null,
      req: req,
    })
  } catch (error) {
    console.error('Error loading product detail:', error)
    res.redirect('/produk?error=load')
  }
})

// Route: Update Produk
app.post('/produk/:id', isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params
    const { nama, kategori, deskripsi, snk, banner_url, is_active, urutan } = req.body

    if (!nama || !deskripsi || !snk) {
      return res.redirect(`/produk/${id}?error=validation`)
    }

    const slug = catalog.slugify(nama)
    const { error } = await supabase
      .from('Produk')
      .update({
        nama: nama.trim(),
        slug,
        kategori: kategori ? kategori.trim().toLowerCase() : 'umum',
        deskripsi: deskripsi.trim(),
        snk: snk.trim(),
        banner_url: banner_url ? banner_url.trim() : null,
        is_active: is_active === 'on' || is_active === 'true' || is_active === true,
        urutan: parseInt(urutan, 10) || 0,
      })
      .eq('id', id)

    if (error) throw error

    console.log(`[${new Date().toISOString()}] Produk diedit: ${nama} oleh ${req.session.username}`)
    res.redirect(`/produk/${id}?success=edit`)
  } catch (error) {
    console.error('Error updating product:', error)
    res.redirect(`/produk/${req.params.id}?error=update`)
  }
})

// API: Tambah Varian
app.post('/api/produk/:id/varian', isAuthenticated, async (req, res) => {
  try {
    const produkId = req.params.id
    const { label, kode, harga, format } = req.body

    if (!label || !kode || harga === undefined || harga === '') {
      return res.status(400).json({ error: 'Label, kode, dan harga wajib diisi' })
    }

    const kodeLower = String(kode).toLowerCase().trim()
    const hargaInt = parseInt(harga, 10)
    if (isNaN(hargaInt) || hargaInt < 0) {
      return res.status(400).json({ error: 'Harga tidak valid' })
    }

    const { data: existing } = await supabase
      .from('Varian')
      .select('id')
      .eq('kode', kodeLower)
      .maybeSingle()

    if (existing) {
      return res.status(400).json({ error: 'Kode varian sudah digunakan' })
    }

    const count = await catalog.variantCount(produkId)
    const { data: varian, error } = await supabase
      .from('Varian')
      .insert([
        {
          produk_id: produkId,
          label: label.trim(),
          kode: kodeLower,
          harga: hargaInt,
          format: format ? format.trim() : null,
          urutan: count + 1,
          is_active: true,
          terjual: 0,
        },
      ])
      .select()
      .single()

    if (error) throw error

    const produk = await catalog.getProductById(produkId)
    if (req.headers.accept && req.headers.accept.includes('text/html')) {
      const html = await renderVariantRow(produk, varian)
      return res.type('html').send(html)
    }

    res.json({ success: true, varian })
  } catch (error) {
    console.error('Error creating variant:', error)
    res.status(500).json({ error: error.message })
  }
})

// API: Update Varian (inline edit / reorder)
app.patch('/api/produk/:id/varian/:varianId', isAuthenticated, async (req, res) => {
  try {
    const { id: produkId, varianId } = req.params
    const body = req.body || {}

    const { data: current, error: fetchError } = await supabase
      .from('Varian')
      .select('*')
      .eq('id', varianId)
      .eq('produk_id', produkId)
      .single()

    if (fetchError || !current) {
      return res.status(404).json({ error: 'Varian tidak ditemukan' })
    }

    if (body.action === 'up' || body.action === 'down') {
      const { data: siblings } = await supabase
        .from('Varian')
        .select('id, urutan')
        .eq('produk_id', produkId)
        .order('urutan', { ascending: true })

      const list = siblings || []
      const idx = list.findIndex((v) => v.id === varianId)
      const swapIdx = body.action === 'up' ? idx - 1 : idx + 1
      if (idx >= 0 && swapIdx >= 0 && swapIdx < list.length) {
        const a = list[idx]
        const b = list[swapIdx]
        await supabase.from('Varian').update({ urutan: b.urutan }).eq('id', a.id)
        await supabase.from('Varian').update({ urutan: a.urutan }).eq('id', b.id)
      }
    } else {
      const update = {}
      if (body.label !== undefined) update.label = String(body.label).trim()
      if (body.kode !== undefined) {
        const kodeLower = String(body.kode).toLowerCase().trim()
        const { data: dup } = await supabase
          .from('Varian')
          .select('id')
          .eq('kode', kodeLower)
          .neq('id', varianId)
          .maybeSingle()
        if (dup) return res.status(400).json({ error: 'Kode varian sudah digunakan' })
        update.kode = kodeLower
      }
      if (body.harga !== undefined) {
        const hargaInt = parseInt(body.harga, 10)
        if (isNaN(hargaInt) || hargaInt < 0) {
          return res.status(400).json({ error: 'Harga tidak valid' })
        }
        update.harga = hargaInt
      }
      if (body.format !== undefined) update.format = body.format ? String(body.format).trim() : null
      if (body.is_active !== undefined) {
        update.is_active = body.is_active === true || body.is_active === 'true' || body.is_active === 'on'
      }
      if (body.urutan !== undefined) update.urutan = parseInt(body.urutan, 10) || 0

      if (Object.keys(update).length) {
        const { error: updateError } = await supabase.from('Varian').update(update).eq('id', varianId)
        if (updateError) throw updateError
      }
    }

    const produk = await catalog.getProductById(produkId)
    const variant = (produk?.variants || []).find((v) => v.id === varianId)
    if (!variant) {
      return res.status(404).json({ error: 'Varian tidak ditemukan' })
    }

    const html = await renderVariantRow(produk, variant)
    res.type('html').send(html)
  } catch (error) {
    console.error('Error updating variant:', error)
    res.status(500).json({ error: error.message })
  }
})

// API: Hapus Varian
app.delete('/api/produk/:id/varian/:varianId', isAuthenticated, async (req, res) => {
  try {
    const { id: produkId, varianId } = req.params
    const n = await catalog.variantCount(produkId)
    if (n <= 1) {
      return res.status(400).json({ error: 'Produk harus punya minimal 1 varian' })
    }

    const { error } = await supabase
      .from('Varian')
      .delete()
      .eq('id', varianId)
      .eq('produk_id', produkId)

    if (error) throw error
    res.json({ success: true })
  } catch (error) {
    console.error('Error deleting variant:', error)
    res.status(500).json({ error: error.message })
  }
})

async function loadVarianForProduk(produkId, varianId) {
  const { data, error } = await supabase
    .from('Varian')
    .select('*')
    .eq('id', varianId)
    .eq('produk_id', produkId)
    .maybeSingle()
  if (error || !data) return null
  return data
}

app.get('/api/produk/:id/varian/:varianId/tiers', isAuthenticated, async (req, res) => {
  try {
    const varian = await loadVarianForProduk(req.params.id, req.params.varianId)
    if (!varian) return res.status(404).json({ error: 'Varian tidak ditemukan' })
    const tiers = await pricing.getTiersForVarian(varian.id)
    res.json({ tiers })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/produk/:id/varian/:varianId/tiers', isAuthenticated, async (req, res) => {
  try {
    const varian = await loadVarianForProduk(req.params.id, req.params.varianId)
    if (!varian) return res.status(404).json({ error: 'Varian tidak ditemukan' })
    const min_qty = parseInt(req.body.min_qty, 10)
    const harga = parseInt(req.body.harga, 10)
    if (!Number.isFinite(min_qty) || min_qty < 2) {
      return res.status(400).json({ error: 'min_qty minimal 2' })
    }
    if (!Number.isFinite(harga) || harga < 0) {
      return res.status(400).json({ error: 'harga tidak valid' })
    }
    const { data, error } = await supabase
      .from('HargaTier')
      .insert([{ varian_id: varian.id, min_qty, harga }])
      .select()
      .single()
    if (error) {
      if (error.code === '23505') return res.status(400).json({ error: 'min_qty sudah ada untuk varian ini' })
      throw error
    }
    res.status(201).json({ tier: data })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.patch('/api/produk/:id/varian/:varianId/tiers/:tierId', isAuthenticated, async (req, res) => {
  try {
    const varian = await loadVarianForProduk(req.params.id, req.params.varianId)
    if (!varian) return res.status(404).json({ error: 'Varian tidak ditemukan' })
    const patch = {}
    if (req.body.min_qty !== undefined) {
      const min_qty = parseInt(req.body.min_qty, 10)
      if (!Number.isFinite(min_qty) || min_qty < 2) return res.status(400).json({ error: 'min_qty minimal 2' })
      patch.min_qty = min_qty
    }
    if (req.body.harga !== undefined) {
      const harga = parseInt(req.body.harga, 10)
      if (!Number.isFinite(harga) || harga < 0) return res.status(400).json({ error: 'harga tidak valid' })
      patch.harga = harga
    }
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'Tidak ada field diubah' })
    const { data, error } = await supabase
      .from('HargaTier')
      .update(patch)
      .eq('id', req.params.tierId)
      .eq('varian_id', varian.id)
      .select()
      .maybeSingle()
    if (error) {
      if (error.code === '23505') return res.status(400).json({ error: 'min_qty sudah ada untuk varian ini' })
      throw error
    }
    if (!data) return res.status(404).json({ error: 'Tier tidak ditemukan' })
    res.json({ tier: data })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.delete('/api/produk/:id/varian/:varianId/tiers/:tierId', isAuthenticated, async (req, res) => {
  try {
    const varian = await loadVarianForProduk(req.params.id, req.params.varianId)
    if (!varian) return res.status(404).json({ error: 'Varian tidak ditemukan' })
    const { error } = await supabase
      .from('HargaTier')
      .delete()
      .eq('id', req.params.tierId)
      .eq('varian_id', varian.id)
    if (error) throw error
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ============================================
// ROUTE: MANAJEMEN STOK (per varian)
// ============================================

app.get('/produk/:produkId/varian/:varianId/stok', isAuthenticated, async (req, res) => {
  try {
    const { produkId, varianId } = req.params
    const ctx = await loadProdukVarian(produkId, varianId)
    if (!ctx) return res.redirect('/produk?error=notfound')

    const { produk, varian } = ctx
    const { status, page } = req.query
    const currentPage = parseInt(page, 10) || 1
    const limit = 50
    const offset = (currentPage - 1) * limit

    let stokQuery = supabase
      .from('Stok')
      .select('*', { count: 'exact' })
      .eq('varian_id', varianId)

    if (status && status !== 'all') {
      stokQuery = stokQuery.eq('status', status)
    }

    const { data: stokItems, error: stokError, count } = await stokQuery
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (stokError) throw stokError

    const totalPages = Math.ceil((count || 0) / limit)

    const { data: allStok } = await supabase.from('Stok').select('status').eq('varian_id', varianId)

    const stats = {
      tersedia: allStok?.filter((s) => s.status === 'tersedia').length || 0,
      terjual: allStok?.filter((s) => s.status === 'terjual').length || 0,
      expired: allStok?.filter((s) => s.status === 'expired').length || 0,
      dihapus: allStok?.filter((s) => s.status === 'dihapus').length || 0,
      total: allStok?.length || 0,
    }

    res.render('produk-stok', {
      title: `Stok — ${produk.nama} / ${varian.label}`,
      namaBot: NamaBot,
      username: req.session.username,
      produk,
      varian,
      stokItems: stokItems || [],
      stats,
      currentPageNum: currentPage,
      totalPages,
      currentStatus: status || 'all',
      formatrupiah,
      formatTanggal,
      req: req,
    })
  } catch (error) {
    console.error('Error loading stock:', error)
    res.redirect('/produk?error=load')
  }
})

app.get('/produk/:produkId/varian/:varianId/stok/tambah', isAuthenticated, async (req, res) => {
  try {
    const ctx = await loadProdukVarian(req.params.produkId, req.params.varianId)
    if (!ctx) return res.redirect('/produk?error=notfound')

    res.render('produk-stok-tambah', {
      title: `Tambah Stok — ${ctx.produk.nama} / ${ctx.varian.label}`,
      namaBot: NamaBot,
      username: req.session.username,
      produk: ctx.produk,
      varian: ctx.varian,
      error: null,
      req: req,
    })
  } catch (error) {
    console.error('Error loading product:', error)
    res.redirect('/produk?error=load')
  }
})

app.post('/produk/:produkId/varian/:varianId/stok/tambah', isAuthenticated, async (req, res) => {
  const { produkId, varianId } = req.params

  const renderError = async (error) => {
    const ctx = await loadProdukVarian(produkId, varianId)
    if (!ctx) return res.redirect('/produk?error=notfound')
    return res.render('produk-stok-tambah', {
      title: `Tambah Stok — ${ctx.produk.nama} / ${ctx.varian.label}`,
      namaBot: NamaBot,
      username: req.session.username,
      produk: ctx.produk,
      varian: ctx.varian,
      error,
      req: req,
    })
  }

  try {
    const { data_stok } = req.body
    if (!data_stok || !data_stok.trim()) {
      return renderError('Data stok tidak boleh kosong!')
    }

    const ctx = await loadProdukVarian(produkId, varianId)
    if (!ctx) return res.redirect('/produk?error=notfound')

    const { produk, varian } = ctx
    const dataArray = data_stok
      .split(/[\n\r]+/)
      .map((item) => item.trim())
      .filter((item) => item !== '')

    if (dataArray.length === 0) {
      return renderError('Tidak ada data stok yang valid!')
    }

    const stokItems = dataArray.map((data) => ({
      varian_id: varian.id,
      varian_kode: String(varian.kode).toLowerCase(),
      data: data.trim(),
      status: 'tersedia',
    }))

    const { error: insertError } = await supabase.from('Stok').insert(stokItems)
    if (insertError) throw insertError

    const totalStok = await stock.getStokCountByVarianId(varian.id)
    const formattedPrice = formatrupiah(varian.harga)
    await sendFeedMessage(
      `📢 ${dataArray.length} new stock added for ${produk.nama} (${varian.label})!\n\n` +
        `✨ Available: ${totalStok} items\n` +
        `🪙 Price: ${formattedPrice}`,
      'stock'
    ).catch((err) => console.error('Error sending stock feed message:', err))

    console.log(
      `[${new Date().toISOString()}] Stok ditambahkan: ${dataArray.length} item untuk ${produk.nama} / ${varian.kode} oleh ${req.session.username}`
    )
    res.redirect(`/produk/${produkId}/varian/${varianId}/stok?success=tambah`)
  } catch (error) {
    console.error('Error adding stock:', error)
    renderError(error.message || 'Gagal menambahkan stok!')
  }
})

app.get('/produk/:produkId/varian/:varianId/stok/edit/:stokId', isAuthenticated, async (req, res) => {
  try {
    const { produkId, varianId, stokId } = req.params
    const ctx = await loadProdukVarian(produkId, varianId)
    if (!ctx) return res.redirect('/produk?error=notfound')

    const { data: stokItem, error: stokError } = await supabase
      .from('Stok')
      .select('*')
      .eq('id', stokId)
      .eq('varian_id', varianId)
      .single()

    if (stokError || !stokItem) {
      return res.redirect(`/produk/${produkId}/varian/${varianId}/stok?error=notfound`)
    }

    res.render('produk-stok-edit', {
      title: `Edit Stok — ${ctx.produk.nama} / ${ctx.varian.label}`,
      namaBot: NamaBot,
      username: req.session.username,
      produk: ctx.produk,
      varian: ctx.varian,
      stokItem,
      error: null,
      req: req,
    })
  } catch (error) {
    console.error('Error loading stock item:', error)
    res.redirect(`/produk/${req.params.produkId}/varian/${req.params.varianId}/stok?error=load`)
  }
})

app.post('/produk/:produkId/varian/:varianId/stok/edit/:stokId', isAuthenticated, async (req, res) => {
  try {
    const { produkId, varianId, stokId } = req.params
    const { data_stok, status } = req.body

    if (!data_stok || !data_stok.trim()) {
      const ctx = await loadProdukVarian(produkId, varianId)
      const { data: stokItem } = await supabase.from('Stok').select('*').eq('id', stokId).single()
      return res.render('produk-stok-edit', {
        title: `Edit Stok — ${ctx?.produk?.nama || 'Produk'}`,
        namaBot: NamaBot,
        username: req.session.username,
        produk: ctx?.produk,
        varian: ctx?.varian,
        stokItem,
        error: 'Data stok tidak boleh kosong!',
        req: req,
      })
    }

    const { data: stokItemLama } = await supabase.from('Stok').select('status').eq('id', stokId).single()

    const validStatus = ['tersedia', 'terjual', 'expired', 'dihapus']
    const newStatus = validStatus.includes(status) ? status : 'tersedia'

    const updateData = {
      data: data_stok.trim(),
      status: newStatus,
    }

    if (newStatus === 'terjual' && stokItemLama?.status !== 'terjual') {
      updateData.terjual_at = new Date().toISOString()
    } else if (newStatus !== 'terjual') {
      updateData.terjual_at = null
    }

    const { error } = await supabase
      .from('Stok')
      .update(updateData)
      .eq('id', stokId)
      .eq('varian_id', varianId)

    if (error) throw error

    console.log(`[${new Date().toISOString()}] Stok item diedit: ID ${stokId} oleh ${req.session.username}`)
    res.redirect(`/produk/${produkId}/varian/${varianId}/stok?success=edit`)
  } catch (error) {
    console.error('Error updating stock:', error)
    res.redirect(`/produk/${req.params.produkId}/varian/${req.params.varianId}/stok?error=edit`)
  }
})

app.get('/produk/:produkId/varian/:varianId/stok/hapus/:stokId', isAuthenticated, async (req, res) => {
  try {
    const { produkId, varianId, stokId } = req.params
    const ctx = await loadProdukVarian(produkId, varianId)
    if (!ctx) return res.redirect('/produk?error=notfound')

    const { data: stokItem, error: stokError } = await supabase
      .from('Stok')
      .select('*')
      .eq('id', stokId)
      .eq('varian_id', varianId)
      .single()

    if (stokError || !stokItem) {
      return res.redirect(`/produk/${produkId}/varian/${varianId}/stok?error=notfound`)
    }

    res.render('produk-stok-hapus', {
      title: `Hapus Stok — ${ctx.produk.nama} / ${ctx.varian.label}`,
      namaBot: NamaBot,
      username: req.session.username,
      produk: ctx.produk,
      varian: ctx.varian,
      stokItem,
      req: req,
    })
  } catch (error) {
    console.error('Error loading stock item:', error)
    res.redirect(`/produk/${req.params.produkId}/varian/${req.params.varianId}/stok?error=load`)
  }
})

app.post('/produk/:produkId/varian/:varianId/stok/hapus/:stokId', isAuthenticated, async (req, res) => {
  try {
    const { produkId, varianId, stokId } = req.params
    const { error } = await supabase.from('Stok').delete().eq('id', stokId).eq('varian_id', varianId)
    if (error) throw error

    console.log(`[${new Date().toISOString()}] Stok item dihapus: ID ${stokId} oleh ${req.session.username}`)
    res.redirect(`/produk/${produkId}/varian/${varianId}/stok?success=hapus`)
  } catch (error) {
    console.error('Error deleting stock:', error)
    res.redirect(`/produk/${req.params.produkId}/varian/${req.params.varianId}/stok?error=hapus`)
  }
})

app.get('/produk/:produkId/varian/:varianId/stok/export', isAuthenticated, async (req, res) => {
  try {
    const { produkId, varianId } = req.params
    const { status } = req.query
    const ctx = await loadProdukVarian(produkId, varianId)
    if (!ctx) return res.status(404).send('Produk/varian tidak ditemukan')

    const { produk, varian } = ctx
    let stokQuery = supabase.from('Stok').select('*').eq('varian_id', varianId)

    if (status && status !== 'all') {
      stokQuery = stokQuery.eq('status', status)
    }

    const { data: stokItems, error } = await stokQuery.order('created_at', { ascending: false })
    if (error) throw error

    const csvHeader = 'No,Data Stok,Status,Terjual At,Trx ID,Created At\n'
    const csvRows = (stokItems || [])
      .map((s, index) => {
        const data = (s.data || '').replace(/"/g, '""')
        const terjualAt = s.terjual_at
          ? moment.tz(s.terjual_at, 'Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss')
          : ''
        const createdAt = moment.tz(s.created_at, 'Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss')
        const trxId = (s.trx_id || '').replace(/"/g, '""')
        return `${index + 1},"${data}","${s.status}","${terjualAt}","${trxId}","${createdAt}"`
      })
      .join('\n')

    const csv = csvHeader + csvRows
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=stok-${varian.kode}-${moment.tz('Asia/Jakarta').format('YYYY-MM-DD')}.csv`
    )
    res.send('\ufeff' + csv)
  } catch (error) {
    console.error('Error exporting stock:', error)
    res.status(500).send('Error exporting stock: ' + error.message)
  }
})

// Route: Daftar Transaksi
app.get('/transaksi', isAuthenticated, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = 50
    const offset = (page - 1) * limit

    // Ambil filter dari query
    const { 
      startDate, 
      endDate, 
      produk, 
      user, 
      minHarga, 
      maxHarga,
      search 
    } = req.query

    // Build query
    let query = supabase
      .from('Trx')
      .select('*', { count: 'exact' })

    // Filter by tanggal
    if (startDate) {
      query = query.gte('tanggal', new Date(startDate).toISOString())
    }
    if (endDate) {
      const endDateTime = new Date(endDate)
      endDateTime.setHours(23, 59, 59, 999)
      query = query.lte('tanggal', endDateTime.toISOString())
    }

    // Filter by produk (kode)
    if (produk) {
      query = query.eq('kode', produk)
    }

    // Filter by user
    if (user) {
      const userId = parseInt(user)
      if (!isNaN(userId)) {
        query = query.eq('id', userId)
      }
    }

    // Filter by range harga
    if (minHarga) {
      const min = parseInt(minHarga)
      if (!isNaN(min)) {
        query = query.gte('harga', min)
      }
    }
    if (maxHarga) {
      const max = parseInt(maxHarga)
      if (!isNaN(max)) {
        query = query.lte('harga', max)
      }
    }

    // Search (trxid, nama produk, atau user ID)
    if (search) {
      const searchNum = parseInt(search)
      if (!isNaN(searchNum)) {
        // Search by user ID atau trxid (jika numeric)
        query = query.or(`id.eq.${searchNum},trxid.ilike.%${search}%`)
      } else {
        // Search by trxid atau nama produk
        query = query.or(`trxid.ilike.%${search}%,nama.ilike.%${search}%`)
      }
    }

    // Order dan pagination
    const { data: transactions, error, count } = await query
      .order('tanggal', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) throw error

    const totalPages = Math.ceil((count || 0) / limit)

    const varianIds = [...new Set((transactions || []).map((t) => t.varian_id).filter(Boolean))]
    const varianById = Object.create(null)
    if (varianIds.length > 0) {
      const { data: varianRows } = await supabase
        .from('Varian')
        .select('id, label, kode')
        .in('id', varianIds)
      for (const row of varianRows || []) {
        varianById[row.id] = row
      }
    }
    const enrichedTransactions = (transactions || []).map((t) => {
      const varian = t.varian_id ? varianById[t.varian_id] : null
      return {
        ...t,
        varian_label: varian ? varian.label : null,
      }
    })

    // Ambil daftar produk untuk filter dropdown
    const { data: products } = await supabase
      .from('Produk')
      .select('kode, nama')
      .order('nama', { ascending: true })

    const totalCount = count != null ? count : 0
    res.render('transaksi', {
      title: `Transaksi - ${NamaBot}`,
      namaBot: NamaBot,
      username: req.session.username,
      currentPage: 'transaksi',
      pageTitle: 'Daftar Transaksi',
      transactions: enrichedTransactions,
      products: products || [],
      currentPageNum: page,
      totalPages,
      totalCount,
      limit: 50,
      formatrupiah,
      formatTanggal,
      filters: {
        startDate: startDate || '',
        endDate: endDate || '',
        produk: produk || '',
        user: user || '',
        minHarga: minHarga || '',
        maxHarga: maxHarga || '',
        search: search || ''
      },
      req: req
    })
  } catch (error) {
    console.error('Error loading transactions:', error)
    res.status(500).send('Error loading transactions: ' + error.message)
  }
})

// Route: Detail Transaksi
app.get('/transaksi/:id', isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params
    
    const { data: transaction, error } = await supabase
      .from('Trx')
      .select('*')
      .eq('trx_uuid', id)
      .single()

    if (error || !transaction) {
      return res.redirect('/transaksi?error=notfound')
    }

    // Ambil info produk
    let produk = null
    if (transaction.produk_id) {
      const { data } = await supabase
        .from('Produk')
        .select('*')
        .eq('id', transaction.produk_id)
        .single()
      produk = data
    }
    if (!produk) {
      const { data } = await supabase
        .from('Produk')
        .select('*')
        .eq('kode', transaction.kode)
        .single()
      produk = data
    }

    let varian = null
    if (transaction.varian_id) {
      const { data } = await supabase
        .from('Varian')
        .select('id, label, kode')
        .eq('id', transaction.varian_id)
        .single()
      varian = data
    }

    // Ambil info user
    const { data: user } = await supabase
      .from('User')
      .select('*')
      .eq('id', transaction.id)
      .single()

    res.render('transaksi-detail', {
      title: `Detail Transaksi - ${NamaBot}`,
      namaBot: NamaBot,
      username: req.session.username,
      req: req,
      transaction: transaction,
      produk: produk || null,
      varian: varian || null,
      user: user || null,
      formatrupiah,
      formatTanggal
    })
  } catch (error) {
    console.error('Error loading transaction:', error)
    res.redirect('/transaksi?error=load')
  }
})

// Route: Export Transaksi ke CSV
app.get('/transaksi/export', isAuthenticated, async (req, res) => {
  try {
    const { 
      startDate, 
      endDate, 
      produk, 
      user, 
      minHarga, 
      maxHarga,
      search 
    } = req.query

    // Build query (sama seperti di route /transaksi)
    let query = supabase
      .from('Trx')
      .select('*')

    if (startDate) {
      query = query.gte('tanggal', new Date(startDate).toISOString())
    }
    if (endDate) {
      const endDateTime = new Date(endDate)
      endDateTime.setHours(23, 59, 59, 999)
      query = query.lte('tanggal', endDateTime.toISOString())
    }
    if (produk) {
      query = query.eq('kode', produk)
    }
    if (user) {
      const userId = parseInt(user)
      if (!isNaN(userId)) {
        query = query.eq('id', userId)
      }
    }
    if (minHarga) {
      const min = parseInt(minHarga)
      if (!isNaN(min)) {
        query = query.gte('harga', min)
      }
    }
    if (maxHarga) {
      const max = parseInt(maxHarga)
      if (!isNaN(max)) {
        query = query.lte('harga', max)
      }
    }
    if (search) {
      const searchNum = parseInt(search)
      if (!isNaN(searchNum)) {
        query = query.or(`id.eq.${searchNum},trxid.ilike.%${search}%`)
      } else {
        query = query.or(`trxid.ilike.%${search}%,nama.ilike.%${search}%`)
      }
    }

    const { data: transactions, error } = await query
      .order('tanggal', { ascending: false })

    if (error) throw error

    // Generate CSV
    const csvHeader = 'Tanggal,User ID,Produk,Kode,Jumlah,Harga,Trx ID\n'
    const csvRows = (transactions || []).map(t => {
      const tanggal = moment.tz(t.tanggal, 'Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss')
      const nama = (t.nama || '').replace(/"/g, '""')
      const kode = (t.kode || '').replace(/"/g, '""')
      const trxid = (t.trxid || '').replace(/"/g, '""')
      return `${tanggal},${t.id},"${nama}","${kode}",${t.jumlah},${t.harga},"${trxid}"`
    }).join('\n')

    const csv = csvHeader + csvRows

    // Set headers untuk download
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename=transaksi-${moment.tz('Asia/Jakarta').format('YYYY-MM-DD')}.csv`)
    res.send('\ufeff' + csv) // BOM untuk Excel
  } catch (error) {
    console.error('Error exporting transactions:', error)
    res.status(500).send('Error exporting transactions: ' + error.message)
  }
})

// Route: Daftar User
app.get('/user', isAuthenticated, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = 50
    const offset = (page - 1) * limit

    const { data: users, error, count } = await supabase
      .from('User')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) throw error

    const totalPages = Math.ceil((count || 0) / limit)

    res.render('user', {
      title: `User - ${NamaBot}`,
      namaBot: NamaBot,
      username: req.session.username,
      currentPage: 'user',
      pageTitle: 'Daftar User',
      users: users || [],
      currentPageNum: page,
      totalPages: totalPages,
      totalUsers: count || 0,
      formatrupiah,
      success: req.query.success || null,
      error: req.query.error || null,
      req: req
    })
  } catch (error) {
    console.error('Error loading users:', error)
    res.status(500).send('Error loading users: ' + error.message)
  }
})

// Route: Detail User
app.get('/user/:id', isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params
    const userId = parseInt(id)
    
    if (isNaN(userId)) {
      return res.redirect('/user?error=invalid')
    }

    // Ambil data user
    const { data: user, error: userError } = await supabase
      .from('User')
      .select('*')
      .eq('id', userId)
      .single()

    if (userError || !user) {
      return res.redirect('/user?error=notfound')
    }

    // Ambil riwayat transaksi user
    const { data: transactions } = await supabase
      .from('Trx')
      .select('*')
      .eq('id', userId)
      .order('tanggal', { ascending: false })
      .limit(20)

    // Ambil riwayat deposit user
    const { data: deposits } = await supabase
      .from('Deposit')
      .select('*')
      .eq('user_id', userId)
      .order('tanggal', { ascending: false })
      .limit(20)

    // Hitung statistik
    const totalTransaksi = transactions?.length || 0
    const totalDeposit = deposits?.filter(d => d.status === 'success').reduce((sum, d) => sum + (d.jumlah || 0), 0) || 0
    const totalPengeluaran = transactions?.reduce((sum, t) => sum + (t.harga || 0), 0) || 0

    res.render('user-detail', {
      title: `Detail User - ${NamaBot}`,
      namaBot: NamaBot,
      username: req.session.username,
      req: req,
      user: user,
      transactions: transactions || [],
      deposits: deposits || [],
      stats: {
        totalTransaksi,
        totalDeposit,
        totalPengeluaran
      },
      formatrupiah,
      formatTanggal,
      query: req.query
    })
  } catch (error) {
    console.error('Error loading user detail:', error)
    res.redirect('/user?error=load')
  }
})

// Route: Form Top Up Saldo
app.get('/user/:id/topup', isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params
    const userId = parseInt(id)
    
    if (isNaN(userId)) {
      return res.redirect('/user?error=invalid')
    }

    const { data: user, error } = await supabase
      .from('User')
      .select('*')
      .eq('id', userId)
      .single()

    if (error || !user) {
      return res.redirect('/user?error=notfound')
    }

    res.render('user-topup', {
      title: `Top Up Saldo - ${NamaBot}`,
      namaBot: NamaBot,
      username: req.session.username,
      req: req,
      user: user,
      formatrupiah,
      error: null
    })
  } catch (error) {
    console.error('Error loading user:', error)
    res.redirect('/user?error=load')
  }
})

// Route: Proses Top Up Saldo
app.post('/user/:id/topup', isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params
    const userId = parseInt(id)
    const { jumlah } = req.body
    
    if (isNaN(userId)) {
      return res.redirect('/user?error=invalid')
    }

    const jumlahInt = parseInt(jumlah)
    if (isNaN(jumlahInt) || jumlahInt <= 0) {
      const { data: user } = await supabase
        .from('User')
        .select('*')
        .eq('id', userId)
        .single()
      
      return res.render('user-topup', {
        title: `Top Up Saldo - ${NamaBot}`,
        namaBot: NamaBot,
        username: req.session.username,
        req: req,
        user: user,
        formatrupiah,
        error: 'Jumlah harus berupa angka positif!'
      })
    }

    // Ambil saldo saat ini
    const { data: user, error: userError } = await supabase
      .from('User')
      .select('saldo')
      .eq('id', userId)
      .single()

    if (userError || !user) {
      return res.redirect('/user?error=notfound')
    }

    // Update saldo
    const saldoBaru = (user.saldo || 0) + jumlahInt
    
    const { error: updateError } = await supabase
      .from('User')
      .update({ saldo: saldoBaru })
      .eq('id', userId)

    if (updateError) throw updateError

    console.log(`[${new Date().toISOString()}] Top up saldo user ${userId}: +${formatrupiah(jumlahInt)} oleh ${req.session.username}`)
    res.redirect(`/user/${userId}?success=topup`)
  } catch (error) {
    console.error('Error top up saldo:', error)
    res.redirect(`/user/${req.params.id}?error=topup`)
  }
})

// Route: Form Kurangi Saldo
app.get('/user/:id/kurangi', isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params
    const userId = parseInt(id)
    
    if (isNaN(userId)) {
      return res.redirect('/user?error=invalid')
    }

    const { data: user, error } = await supabase
      .from('User')
      .select('*')
      .eq('id', userId)
      .single()

    if (error || !user) {
      return res.redirect('/user?error=notfound')
    }

    res.render('user-kurangi', {
      title: `Kurangi Saldo - ${NamaBot}`,
      namaBot: NamaBot,
      username: req.session.username,
      req: req,
      user: user,
      formatrupiah,
      error: null
    })
  } catch (error) {
    console.error('Error loading user:', error)
    res.redirect('/user?error=load')
  }
})

// Route: Proses Kurangi Saldo
app.post('/user/:id/kurangi', isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params
    const userId = parseInt(id)
    const { jumlah } = req.body
    
    if (isNaN(userId)) {
      return res.redirect('/user?error=invalid')
    }

    const jumlahInt = parseInt(jumlah)
    if (isNaN(jumlahInt) || jumlahInt <= 0) {
      const { data: user } = await supabase
        .from('User')
        .select('*')
        .eq('id', userId)
        .single()
      
      return res.render('user-kurangi', {
        title: `Kurangi Saldo - ${NamaBot}`,
        namaBot: NamaBot,
        username: req.session.username,
        req: req,
        user: user,
        formatrupiah,
        error: 'Jumlah harus berupa angka positif!'
      })
    }

    // Ambil saldo saat ini
    const { data: user, error: userError } = await supabase
      .from('User')
      .select('saldo')
      .eq('id', userId)
      .single()

    if (userError || !user) {
      return res.redirect('/user?error=notfound')
    }

    const saldoSaatIni = user.saldo || 0
    if (jumlahInt > saldoSaatIni) {
      return res.render('user-kurangi', {
        title: `Kurangi Saldo - ${NamaBot}`,
        namaBot: NamaBot,
        username: req.session.username,
        req: req,
        user: { id: userId, saldo: saldoSaatIni },
        formatrupiah,
        error: `Saldo tidak cukup! Saldo saat ini: ${formatrupiah(saldoSaatIni)}`
      })
    }

    // Update saldo
    const saldoBaru = saldoSaatIni - jumlahInt
    
    const { error: updateError } = await supabase
      .from('User')
      .update({ saldo: saldoBaru })
      .eq('id', userId)

    if (updateError) throw updateError

    console.log(`[${new Date().toISOString()}] Kurangi saldo user ${userId}: -${formatrupiah(jumlahInt)} oleh ${req.session.username}`)
    res.redirect(`/user/${userId}?success=kurangi`)
  } catch (error) {
    console.error('Error kurangi saldo:', error)
    res.redirect(`/user/${req.params.id}?error=kurangi`)
  }
})

// Route: Reset Saldo & Pengeluaran
app.get('/user/:id/reset', isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params
    const userId = parseInt(id)
    
    if (isNaN(userId)) {
      return res.redirect('/user?error=invalid')
    }

    const { data: user, error } = await supabase
      .from('User')
      .select('*')
      .eq('id', userId)
      .single()

    if (error || !user) {
      return res.redirect('/user?error=notfound')
    }

    res.render('user-reset', {
      title: `Reset Data User - ${NamaBot}`,
      namaBot: NamaBot,
      username: req.session.username,
      user: user,
      formatrupiah
    })
  } catch (error) {
    console.error('Error loading user:', error)
    res.redirect('/user?error=load')
  }
})

// Route: Proses Reset Saldo & Pengeluaran
app.post('/user/:id/reset', isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params
    const userId = parseInt(id)
    const { reset_saldo, reset_pengeluaran } = req.body
    
    if (isNaN(userId)) {
      return res.redirect('/user?error=invalid')
    }

    const updateData = {}
    if (reset_saldo === 'on') {
      updateData.saldo = 0
    }
    if (reset_pengeluaran === 'on') {
      updateData.pengeluaran = 0
    }

    if (Object.keys(updateData).length === 0) {
      return res.redirect(`/user/${userId}?error=noselection`)
    }

    const { error } = await supabase
      .from('User')
      .update(updateData)
      .eq('id', userId)

    if (error) throw error

    const resetItems = []
    if (reset_saldo === 'on') resetItems.push('Saldo')
    if (reset_pengeluaran === 'on') resetItems.push('Pengeluaran')

    console.log(`[${new Date().toISOString()}] Reset ${resetItems.join(' & ')} user ${userId} oleh ${req.session.username}`)
    res.redirect(`/user/${userId}?success=reset`)
  } catch (error) {
    console.error('Error reset user:', error)
    res.redirect(`/user/${req.params.id}?error=reset`)
  }
})

// ============================================
// ROUTE: MANAJEMEN DEPOSIT
// ============================================

// Route: Daftar Deposit
app.get('/deposit', isAuthenticated, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = 50
    const offset = (page - 1) * limit

    // Ambil filter dari query
    const { 
      status, 
      startDate, 
      endDate, 
      user, 
      metode,
      search 
    } = req.query

    // Build query
    let query = supabase
      .from('Deposit')
      .select('*', { count: 'exact' })

    // Filter by status
    if (status && status !== 'all') {
      query = query.eq('status', status)
    }

    // Filter by tanggal
    if (startDate) {
      query = query.gte('tanggal', new Date(startDate).toISOString())
    }
    if (endDate) {
      const endDateTime = new Date(endDate)
      endDateTime.setHours(23, 59, 59, 999)
      query = query.lte('tanggal', endDateTime.toISOString())
    }

    // Filter by user
    if (user) {
      const userId = parseInt(user)
      if (!isNaN(userId)) {
        query = query.eq('user_id', userId)
      }
    }

    // Filter by metode
    if (metode && metode !== 'all') {
      query = query.eq('metode', metode)
    }

    // Search (kode_deposit atau user_id)
    if (search) {
      const searchNum = parseInt(search)
      if (!isNaN(searchNum)) {
        query = query.or(`user_id.eq.${searchNum},kode_deposit.ilike.%${search}%`)
      } else {
        query = query.ilike('kode_deposit', `%${search}%`)
      }
    }

    // Order dan pagination
    const { data: deposits, error, count } = await query
      .order('tanggal', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) throw error

    const totalPages = Math.ceil((count || 0) / limit)

    // Hitung statistik deposit
    const { data: allDeposits } = await supabase
      .from('Deposit')
      .select('status, jumlah, total')

    const stats = {
      pending: allDeposits?.filter(d => d.status === 'pending').length || 0,
      success: allDeposits?.filter(d => d.status === 'success').length || 0,
      failed: allDeposits?.filter(d => d.status === 'failed').length || 0,
      expired: allDeposits?.filter(d => d.status === 'expired').length || 0,
      total: allDeposits?.length || 0,
      totalPending: allDeposits?.filter(d => d.status === 'pending').reduce((sum, d) => sum + (d.jumlah || 0), 0) || 0,
      totalSuccess: allDeposits?.filter(d => d.status === 'success').reduce((sum, d) => sum + (d.jumlah || 0), 0) || 0
    }

    res.render('deposit', {
      title: `Deposit - ${NamaBot}`,
      namaBot: NamaBot,
      username: req.session.username,
      currentPage: 'deposit',
      pageTitle: 'Manajemen Deposit',
      deposits: deposits || [],
      stats: stats,
      currentPageNum: page,
      totalPages: totalPages,
      formatrupiah,
      formatTanggal,
      filters: {
        status: status || 'all',
        startDate: startDate || '',
        endDate: endDate || '',
        user: user || '',
        metode: metode || 'all',
        search: search || ''
      },
      req: req
    })
  } catch (error) {
    console.error('Error loading deposits:', error)
    res.status(500).send('Error loading deposits: ' + error.message)
  }
})

// Route: Detail Deposit
app.get('/deposit/:id', isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params
    
    const { data: deposit, error } = await supabase
      .from('Deposit')
      .select('*')
      .eq('id', id)
      .single()

    if (error || !deposit) {
      return res.redirect('/deposit?error=notfound')
    }

    // Ambil info user
    const { data: user } = await supabase
      .from('User')
      .select('*')
      .eq('id', deposit.user_id)
      .single()

    res.render('deposit-detail', {
      title: `Detail Deposit - ${NamaBot}`,
      namaBot: NamaBot,
      username: req.session.username,
      deposit: deposit,
      user: user || null,
      formatrupiah,
      formatTanggal,
      req: req
    })
  } catch (error) {
    console.error('Error loading deposit:', error)
    res.redirect('/deposit?error=load')
  }
})

// Route: Approve Deposit
app.post('/deposit/:id/approve', isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params
    
    // Ambil deposit
    const { data: deposit, error: depositError } = await supabase
      .from('Deposit')
      .select('*')
      .eq('id', id)
      .single()

    if (depositError || !deposit) {
      return res.redirect('/deposit?error=notfound')
    }

    // Cek apakah sudah di-approve atau bukan pending
    if (deposit.status !== 'pending') {
      return res.redirect(`/deposit/${id}?error=alreadyprocessed`)
    }

    // Update status deposit ke success
    const { error: updateError } = await supabase
      .from('Deposit')
      .update({ 
        status: 'success',
        updated_at: new Date().toISOString()
      })
      .eq('id', id)

    if (updateError) throw updateError

    // Update saldo user
    const { data: user, error: userError } = await supabase
      .from('User')
      .select('saldo')
      .eq('id', deposit.user_id)
      .single()

    if (userError || !user) {
      // Rollback deposit status
      await supabase
        .from('Deposit')
        .update({ status: 'pending' })
        .eq('id', id)
      
      return res.redirect(`/deposit/${id}?error=usernotfound`)
    }

    const saldoBaru = (user.saldo || 0) + deposit.jumlah
    
    const { error: saldoError } = await supabase
      .from('User')
      .update({ saldo: saldoBaru })
      .eq('id', deposit.user_id)

    if (saldoError) {
      // Rollback deposit status
      await supabase
        .from('Deposit')
        .update({ status: 'pending' })
        .eq('id', id)
      
      throw saldoError
    }

    console.log(`[${new Date().toISOString()}] Deposit approved: ${deposit.kode_deposit} (${formatrupiah(deposit.jumlah)}) untuk user ${deposit.user_id} oleh ${req.session.username}`)
    
    // Trigger notification check
    await checkDepositPending()
    
    res.redirect(`/deposit/${id}?success=approve`)
  } catch (error) {
    console.error('Error approving deposit:', error)
    res.redirect(`/deposit/${req.params.id}?error=approve`)
  }
})

// Route: Reject Deposit
app.post('/deposit/:id/reject', isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params
    const { alasan } = req.body
    
    // Ambil deposit
    const { data: deposit, error: depositError } = await supabase
      .from('Deposit')
      .select('*')
      .eq('id', id)
      .single()

    if (depositError || !deposit) {
      return res.redirect('/deposit?error=notfound')
    }

    // Cek apakah sudah diproses
    if (deposit.status !== 'pending') {
      return res.redirect(`/deposit/${id}?error=alreadyprocessed`)
    }

    // Update status deposit ke failed
    const { error: updateError } = await supabase
      .from('Deposit')
      .update({ 
        status: 'failed',
        updated_at: new Date().toISOString()
      })
      .eq('id', id)

    if (updateError) throw updateError

    console.log(`[${new Date().toISOString()}] Deposit rejected: ${deposit.kode_deposit} untuk user ${deposit.user_id} oleh ${req.session.username}${alasan ? ` (Alasan: ${alasan})` : ''}`)
    
    // Trigger notification check
    await checkDepositPending()
    
    res.redirect(`/deposit/${id}?success=reject`)
  } catch (error) {
    console.error('Error rejecting deposit:', error)
    res.redirect(`/deposit/${req.params.id}?error=reject`)
  }
})

// Route: Export Deposit ke CSV
app.get('/deposit/export', isAuthenticated, async (req, res) => {
  try {
    const { 
      status, 
      startDate, 
      endDate, 
      user, 
      metode,
      search 
    } = req.query

    // Build query (sama seperti di route /deposit)
    let query = supabase
      .from('Deposit')
      .select('*')

    if (status && status !== 'all') {
      query = query.eq('status', status)
    }
    if (startDate) {
      query = query.gte('tanggal', new Date(startDate).toISOString())
    }
    if (endDate) {
      const endDateTime = new Date(endDate)
      endDateTime.setHours(23, 59, 59, 999)
      query = query.lte('tanggal', endDateTime.toISOString())
    }
    if (user) {
      const userId = parseInt(user)
      if (!isNaN(userId)) {
        query = query.eq('user_id', userId)
      }
    }
    if (metode && metode !== 'all') {
      query = query.eq('metode', metode)
    }
    if (search) {
      const searchNum = parseInt(search)
      if (!isNaN(searchNum)) {
        query = query.or(`user_id.eq.${searchNum},kode_deposit.ilike.%${search}%`)
      } else {
        query = query.ilike('kode_deposit', `%${search}%`)
      }
    }

    const { data: deposits, error } = await query
      .order('tanggal', { ascending: false })

    if (error) throw error

    // Generate CSV
    const csvHeader = 'Tanggal,User ID,Kode Deposit,Jumlah,Fee,Total,Status,Metode\n'
    const csvRows = (deposits || []).map(d => {
      const tanggal = moment.tz(d.tanggal, 'Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss')
      const kodeDeposit = (d.kode_deposit || '').replace(/"/g, '""')
      return `${tanggal},${d.user_id},"${kodeDeposit}",${d.jumlah},${d.fee},${d.total},"${d.status}","${d.metode}"`
    }).join('\n')

    const csv = csvHeader + csvRows

    // Set headers untuk download
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename=deposit-${moment.tz('Asia/Jakarta').format('YYYY-MM-DD')}.csv`)
    res.send('\ufeff' + csv) // BOM untuk Excel
  } catch (error) {
    console.error('Error exporting deposits:', error)
    res.status(500).send('Error exporting deposits: ' + error.message)
  }
})

// ============================================
// ROUTE: ANALITIK & LAPORAN
// ============================================

// Route: Halaman Analitik
app.get('/analitik', isAuthenticated, async (req, res) => {
  try {
    const { period } = req.query // daily, weekly, monthly, yearly
    
    res.render('analitik', {
      title: `Analitik - ${NamaBot}`,
      namaBot: NamaBot,
      username: req.session.username,
      currentPage: 'analitik',
      pageTitle: 'Analitik',
      currentPeriod: period || 'daily',
      formatrupiah,
      req: req
    })
  } catch (error) {
    console.error('Error loading analytics:', error)
    res.status(500).send('Error loading analytics: ' + error.message)
  }
})

// Route: Halaman Laporan
app.get('/laporan', isAuthenticated, async (req, res) => {
  try {
    const { type, startDate, endDate, compare } = req.query
    
    res.render('laporan', {
      title: `Laporan - ${NamaBot}`,
      namaBot: NamaBot,
      username: req.session.username,
      currentPage: 'laporan',
      pageTitle: 'Laporan',
      currentType: type || 'pendapatan',
      startDate: startDate || '',
      endDate: endDate || '',
      compare: compare || 'false',
      formatrupiah,
      formatTanggal,
      req: req
    })
  } catch (error) {
    console.error('Error loading reports:', error)
    res.status(500).send('Error loading reports: ' + error.message)
  }
})

// API: Data Penjualan per Periode
app.get('/api/analitik/sales', isAuthenticated, async (req, res) => {
  try {
    const { period } = req.query // daily, weekly, monthly, yearly
    
    const { data: transactions } = await supabase
      .from('Trx')
      .select('tanggal, harga')
      .order('tanggal', { ascending: true })

    if (!transactions) {
      return res.json({ success: true, data: [] })
    }

    const stats = {}
    const now = moment.tz('Asia/Jakarta')
    let startDate

    // Tentukan periode
    switch (period) {
      case 'weekly':
        startDate = moment.tz('Asia/Jakarta').subtract(12, 'weeks').startOf('week').toISOString()
        transactions.forEach(t => {
          const date = moment.tz(t.tanggal, 'Asia/Jakarta')
          if (date.isAfter(moment.tz(startDate, 'Asia/Jakarta'))) {
            const weekKey = date.format('YYYY-[W]WW')
            if (!stats[weekKey]) {
              stats[weekKey] = { period: weekKey, revenue: 0, count: 0 }
            }
            stats[weekKey].revenue += t.harga || 0
            stats[weekKey].count += 1
          }
        })
        break
      case 'monthly':
        startDate = moment.tz('Asia/Jakarta').subtract(12, 'months').startOf('month').toISOString()
        transactions.forEach(t => {
          const date = moment.tz(t.tanggal, 'Asia/Jakarta')
          if (date.isAfter(moment.tz(startDate, 'Asia/Jakarta'))) {
            const monthKey = date.format('YYYY-MM')
            if (!stats[monthKey]) {
              stats[monthKey] = { period: monthKey, revenue: 0, count: 0 }
            }
            stats[monthKey].revenue += t.harga || 0
            stats[monthKey].count += 1
          }
        })
        break
      case 'yearly':
        startDate = moment.tz('Asia/Jakarta').subtract(5, 'years').startOf('year').toISOString()
        transactions.forEach(t => {
          const date = moment.tz(t.tanggal, 'Asia/Jakarta')
          if (date.isAfter(moment.tz(startDate, 'Asia/Jakarta'))) {
            const yearKey = date.format('YYYY')
            if (!stats[yearKey]) {
              stats[yearKey] = { period: yearKey, revenue: 0, count: 0 }
            }
            stats[yearKey].revenue += t.harga || 0
            stats[yearKey].count += 1
          }
        })
        break
      default: // daily
        startDate = moment.tz('Asia/Jakarta').subtract(30, 'days').startOf('day').toISOString()
        transactions.forEach(t => {
          const date = moment.tz(t.tanggal, 'Asia/Jakarta')
          if (date.isAfter(moment.tz(startDate, 'Asia/Jakarta'))) {
            const dayKey = date.format('YYYY-MM-DD')
            if (!stats[dayKey]) {
              stats[dayKey] = { period: dayKey, revenue: 0, count: 0 }
            }
            stats[dayKey].revenue += t.harga || 0
            stats[dayKey].count += 1
          }
        })
    }

    const chartData = Object.values(stats).sort((a, b) => a.period.localeCompare(b.period))

    res.json({
      success: true,
      data: chartData
    })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// API: Produk Terlaris (variant-level + product rollup)
app.get('/api/analitik/products', isAuthenticated, async (req, res) => {
  try {
    const { limit = 10 } = req.query
    const limitNum = parseInt(limit, 10) || 10
    
    const { data: transactions } = await supabase
      .from('Trx')
      .select('kode, nama, jumlah, harga, produk_id, varian_id')

    if (!transactions) {
      return res.json({ success: true, data: { byVariant: [], byProduct: [] } })
    }

    const variantStats = Object.create(null)
    const productStats = Object.create(null)

    transactions.forEach((t) => {
      const variantKey = t.kode || t.varian_id || 'unknown'
      if (!variantStats[variantKey]) {
        variantStats[variantKey] = {
          kode: t.kode,
          nama: t.nama,
          produk_id: t.produk_id,
          varian_id: t.varian_id,
          level: 'variant',
          totalTerjual: 0,
          totalRevenue: 0,
          jumlahTransaksi: 0,
        }
      }
      variantStats[variantKey].totalTerjual += t.jumlah || 0
      variantStats[variantKey].totalRevenue += t.harga || 0
      variantStats[variantKey].jumlahTransaksi += 1

      const productKey = t.produk_id || `nama:${t.nama}`
      if (!productStats[productKey]) {
        productStats[productKey] = {
          produk_id: t.produk_id || null,
          nama: t.nama,
          level: 'product',
          totalTerjual: 0,
          totalRevenue: 0,
          jumlahTransaksi: 0,
          variantCount: 0,
          _variantKeys: new Set(),
        }
      }
      productStats[productKey].totalTerjual += t.jumlah || 0
      productStats[productKey].totalRevenue += t.harga || 0
      productStats[productKey].jumlahTransaksi += 1
      productStats[productKey]._variantKeys.add(t.kode || t.varian_id || variantKey)
    })

    const byVariant = Object.values(variantStats)
      .sort((a, b) => b.totalTerjual - a.totalTerjual)
      .slice(0, limitNum)

    const produkIds = [...new Set(Object.values(productStats).map((row) => row.produk_id).filter(Boolean))]
    const produkById = Object.create(null)
    if (produkIds.length > 0) {
      const { data: produkRows } = await supabase
        .from('Produk')
        .select('id, nama')
        .in('id', produkIds)
      for (const row of produkRows || []) {
        produkById[row.id] = row.nama
      }
    }

    const byProduct = Object.values(productStats)
      .map((row) => ({
        produk_id: row.produk_id,
        nama: (row.produk_id && produkById[row.produk_id]) ? produkById[row.produk_id] : row.nama,
        level: row.level,
        totalTerjual: row.totalTerjual,
        totalRevenue: row.totalRevenue,
        jumlahTransaksi: row.jumlahTransaksi,
        variantCount: row._variantKeys.size,
      }))
      .sort((a, b) => b.totalTerjual - a.totalTerjual)
      .slice(0, limitNum)

    res.json({
      success: true,
      data: {
        byVariant,
        byProduct,
      },
    })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// API: User Teraktif
app.get('/api/analitik/users', isAuthenticated, async (req, res) => {
  try {
    const { limit = 10 } = req.query
    
    const { data: transactions } = await supabase
      .from('Trx')
      .select('id, harga')

    if (!transactions) {
      return res.json({ success: true, data: [] })
    }

    // Group by user
    const userStats = {}
    transactions.forEach(t => {
      const userId = t.id
      if (!userStats[userId]) {
        userStats[userId] = {
          user_id: userId,
          jumlahTransaksi: 0,
          totalPengeluaran: 0
        }
      }
      userStats[userId].jumlahTransaksi += 1
      userStats[userId].totalPengeluaran += t.harga || 0
    })

    // Sort by jumlah transaksi dan ambil top N
    const topUsers = Object.values(userStats)
      .sort((a, b) => b.jumlahTransaksi - a.jumlahTransaksi)
      .slice(0, parseInt(limit))

    res.json({
      success: true,
      data: topUsers
    })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// API: Statistik Detail
app.get('/api/analitik/stats', isAuthenticated, async (req, res) => {
  try {
    const { data: transactions } = await supabase
      .from('Trx')
      .select('tanggal, harga')

    if (!transactions || transactions.length === 0) {
      return res.json({
        success: true,
        data: {
          totalTransaksi: 0,
          totalRevenue: 0,
          rataRataTransaksi: 0,
          peakHour: null,
          peakDay: null
        }
      })
    }

    // Hitung statistik dasar
    const totalTransaksi = transactions.length
    const totalRevenue = transactions.reduce((sum, t) => sum + (t.harga || 0), 0)
    const rataRataTransaksi = totalRevenue / totalTransaksi

    // Hitung peak hour
    const hourStats = {}
    transactions.forEach(t => {
      const hour = moment.tz(t.tanggal, 'Asia/Jakarta').hour()
      if (!hourStats[hour]) {
        hourStats[hour] = 0
      }
      hourStats[hour] += 1
    })
    const peakHour = Object.keys(hourStats).reduce((a, b) => 
      hourStats[a] > hourStats[b] ? a : b
    )

    // Hitung peak day
    const dayStats = {}
    transactions.forEach(t => {
      const day = moment.tz(t.tanggal, 'Asia/Jakarta').format('dddd')
      if (!dayStats[day]) {
        dayStats[day] = 0
      }
      dayStats[day] += 1
    })
    const peakDay = Object.keys(dayStats).reduce((a, b) => 
      dayStats[a] > dayStats[b] ? a : b
    )

    res.json({
      success: true,
      data: {
        totalTransaksi,
        totalRevenue,
        rataRataTransaksi,
        peakHour: parseInt(peakHour),
        peakDay
      }
    })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// Route: Generate Laporan
app.get('/laporan/generate', isAuthenticated, async (req, res) => {
  try {
    const { type, startDate, endDate } = req.query
    
    let start, end
    if (startDate && endDate) {
      start = moment.tz(startDate, 'Asia/Jakarta').startOf('day').toISOString()
      end = moment.tz(endDate, 'Asia/Jakarta').endOf('day').toISOString()
    } else {
      // Default: bulan ini
      start = moment.tz('Asia/Jakarta').startOf('month').toISOString()
      end = moment.tz('Asia/Jakarta').endOf('month').toISOString()
    }

    // Ambil data transaksi
    const { data: transactions } = await supabase
      .from('Trx')
      .select('*')
      .gte('tanggal', start)
      .lte('tanggal', end)
      .order('tanggal', { ascending: false })

    // Ambil data deposit
    const { data: deposits } = await supabase
      .from('Deposit')
      .select('*')
      .eq('status', 'success')
      .gte('tanggal', start)
      .lte('tanggal', end)

    // Hitung laporan
    const totalPendapatan = transactions?.reduce((sum, t) => sum + (t.harga || 0), 0) || 0
    const totalDeposit = deposits?.reduce((sum, d) => sum + (d.jumlah || 0), 0) || 0
    const totalPengeluaran = 0 // Belum ada data pengeluaran
    const profit = totalPendapatan - totalPengeluaran

    const report = {
      periode: {
        start: moment.tz(start, 'Asia/Jakarta').format('DD MMMM YYYY'),
        end: moment.tz(end, 'Asia/Jakarta').format('DD MMMM YYYY')
      },
      pendapatan: {
        dariTransaksi: totalPendapatan,
        dariDeposit: totalDeposit,
        total: totalPendapatan + totalDeposit
      },
      pengeluaran: totalPengeluaran,
      profit: profit,
      jumlahTransaksi: transactions?.length || 0,
      jumlahDeposit: deposits?.length || 0
    }

    res.json({
      success: true,
      data: report
    })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// Route: Export Laporan ke CSV
app.get('/laporan/export', isAuthenticated, async (req, res) => {
  try {
    const { type, startDate, endDate } = req.query
    
    let start, end
    if (startDate && endDate) {
      start = moment.tz(startDate, 'Asia/Jakarta').startOf('day').toISOString()
      end = moment.tz(endDate, 'Asia/Jakarta').endOf('day').toISOString()
    } else {
      start = moment.tz('Asia/Jakarta').startOf('month').toISOString()
      end = moment.tz('Asia/Jakarta').endOf('month').toISOString()
    }

    const { data: transactions } = await supabase
      .from('Trx')
      .select('*')
      .gte('tanggal', start)
      .lte('tanggal', end)
      .order('tanggal', { ascending: false })

    // Generate CSV
    const csvHeader = 'Tanggal,User ID,Produk,Kode,Jumlah,Harga,Trx ID\n'
    const csvRows = (transactions || []).map(t => {
      const tanggal = moment.tz(t.tanggal, 'Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss')
      const nama = (t.nama || '').replace(/"/g, '""')
      const kode = (t.kode || '').replace(/"/g, '""')
      const trxid = (t.trxid || '').replace(/"/g, '""')
      return `${tanggal},${t.id},"${nama}","${kode}",${t.jumlah},${t.harga},"${trxid}"`
    }).join('\n')

    const csv = csvHeader + csvRows

    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename=laporan-${moment.tz('Asia/Jakarta').format('YYYY-MM-DD')}.csv`)
    res.send('\ufeff' + csv)
  } catch (error) {
    console.error('Error exporting report:', error)
    res.status(500).send('Error exporting report: ' + error.message)
  }
})

// ============================================
// ROUTE: MANAJEMEN VOUCHER
// ============================================

// Route: Daftar Voucher
app.get('/voucher', isAuthenticated, async (req, res) => {
  try {
    const { data: vouchers, error } = await supabase
      .from('Voucher')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) throw error

    // Hitung statistik untuk setiap voucher
    const vouchersWithStats = await Promise.all((vouchers || []).map(async (v) => {
      const jumlahPenggunaan = Array.isArray(v.user) ? v.user.length : 0
      const sisaLimit = v.limit - jumlahPenggunaan
      const status = sisaLimit <= 0 ? 'habis' : (jumlahPenggunaan > 0 ? 'aktif' : 'baru')
      
      return {
        ...v,
        jumlahPenggunaan,
        sisaLimit,
        status
      }
    }))

    res.render('voucher', {
      title: `Voucher - ${NamaBot}`,
      namaBot: NamaBot,
      username: req.session.username,
      currentPage: 'voucher',
      pageTitle: 'Manajemen Voucher',
      vouchers: vouchersWithStats,
      formatrupiah,
      success: req.query.success || null,
      error: req.query.error || null,
      req: req
    })
  } catch (error) {
    console.error('Error loading vouchers:', error)
    res.status(500).send('Error loading vouchers: ' + error.message)
  }
})

// Route: Form Tambah Voucher
app.get('/voucher/tambah', isAuthenticated, async (req, res) => {
  try {
    // Ambil daftar produk untuk dropdown
    const { data: products } = await supabase
      .from('Produk')
      .select('kode, nama')
      .order('nama', { ascending: true })

    res.render('voucher-form', {
      title: `Tambah Voucher - ${NamaBot}`,
      namaBot: NamaBot,
      username: req.session.username,
      req: req,
      voucher: null,
      products: products || [],
      action: 'tambah',
      error: null
    })
  } catch (error) {
    console.error('Error loading products:', error)
    res.redirect('/voucher?error=load')
  }
})

// Route: Proses Tambah Voucher
app.post('/voucher/tambah', isAuthenticated, async (req, res) => {
  try {
    const { kode, potongan, limit, produk, produk_all } = req.body
    
    // Validasi
    if (!kode || !potongan || limit === undefined) {
      const { data: products } = await supabase
        .from('Produk')
        .select('kode, nama')
        .order('nama', { ascending: true })
      
      return res.render('voucher-form', {
        title: `Tambah Voucher - ${NamaBot}`,
        namaBot: NamaBot,
        username: req.session.username,
        req: req,
        voucher: req.body,
        products: products || [],
        action: 'tambah',
        error: 'Kode, potongan, dan limit wajib diisi!'
      })
    }

    const kodeLower = kode.toLowerCase().trim()
    const potonganInt = parseInt(potongan)
    const limitInt = parseInt(limit)

    if (isNaN(potonganInt) || potonganInt < 0) {
      const { data: products } = await supabase
        .from('Produk')
        .select('kode, nama')
        .order('nama', { ascending: true })
      
      return res.render('voucher-form', {
        title: `Tambah Voucher - ${NamaBot}`,
        namaBot: NamaBot,
        username: req.session.username,
        req: req,
        voucher: req.body,
        products: products || [],
        action: 'tambah',
        error: 'Potongan harus berupa angka positif!'
      })
    }

    if (isNaN(limitInt) || limitInt < 0) {
      const { data: products } = await supabase
        .from('Produk')
        .select('kode, nama')
        .order('nama', { ascending: true })
      
      return res.render('voucher-form', {
        title: `Tambah Voucher - ${NamaBot}`,
        namaBot: NamaBot,
        username: req.session.username,
        req: req,
        voucher: req.body,
        products: products || [],
        action: 'tambah',
        error: 'Limit harus berupa angka positif!'
      })
    }

    // Cek apakah kode sudah ada
    const { data: existing } = await supabase
      .from('Voucher')
      .select('kode')
      .eq('kode', kodeLower)
      .single()

    if (existing) {
      const { data: products } = await supabase
        .from('Produk')
        .select('kode, nama')
        .order('nama', { ascending: true })
      
      return res.render('voucher-form', {
        title: `Tambah Voucher - ${NamaBot}`,
        namaBot: NamaBot,
        username: req.session.username,
        req: req,
        voucher: req.body,
        products: products || [],
        action: 'tambah',
        error: 'Kode voucher sudah digunakan!'
      })
    }

    // Tentukan produk yang berlaku
    let produkArray = []
    if (produk_all === 'on') {
      produkArray = ['all']
    } else if (produk && Array.isArray(produk)) {
      produkArray = produk.map(p => p.toLowerCase())
    } else if (produk) {
      produkArray = [produk.toLowerCase()]
    } else {
      produkArray = ['all']
    }

    // Insert voucher
    const { data, error } = await supabase
      .from('Voucher')
      .insert([{
        kode: kodeLower,
        potongan: potonganInt,
        limit: limitInt,
        produk: produkArray,
        user: []
      }])
      .select()
      .single()

    if (error) throw error

    console.log(`[${new Date().toISOString()}] Voucher ditambahkan: ${kodeLower} oleh ${req.session.username}`)
    res.redirect('/voucher?success=tambah')
  } catch (error) {
    console.error('Error adding voucher:', error)
    const { data: products } = await supabase
      .from('Produk')
      .select('kode, nama')
      .order('nama', { ascending: true })
    
    res.render('voucher-form', {
      title: `Tambah Voucher - ${NamaBot}`,
      namaBot: NamaBot,
      username: req.session.username,
      req: req,
      voucher: req.body,
      products: products || [],
      action: 'tambah',
      error: error.message || 'Gagal menambahkan voucher!'
    })
  }
})

// Route: Form Edit Voucher
app.get('/voucher/edit/:id', isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params
    
    const { data: voucher, error } = await supabase
      .from('Voucher')
      .select('*')
      .eq('id', id)
      .single()

    if (error || !voucher) {
      return res.redirect('/voucher?error=notfound')
    }

    // Ambil daftar produk
    const { data: products } = await supabase
      .from('Produk')
      .select('kode, nama')
      .order('nama', { ascending: true })

    res.render('voucher-form', {
      title: `Edit Voucher - ${NamaBot}`,
      namaBot: NamaBot,
      username: req.session.username,
      req: req,
      voucher: voucher,
      products: products || [],
      action: 'edit',
      error: null
    })
  } catch (error) {
    console.error('Error loading voucher:', error)
    res.redirect('/voucher?error=load')
  }
})

// Route: Proses Edit Voucher
app.post('/voucher/edit/:id', isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params
    const { kode, potongan, limit, produk, produk_all } = req.body
    
    // Validasi
    if (!kode || !potongan || limit === undefined) {
      const { data: voucher } = await supabase
        .from('Voucher')
        .select('*')
        .eq('id', id)
        .single()
      
      const { data: products } = await supabase
        .from('Produk')
        .select('kode, nama')
        .order('nama', { ascending: true })
      
      return res.render('voucher-form', {
        title: `Edit Voucher - ${NamaBot}`,
        namaBot: NamaBot,
        username: req.session.username,
        req: req,
        voucher: { ...voucher, ...req.body },
        products: products || [],
        action: 'edit',
        error: 'Kode, potongan, dan limit wajib diisi!'
      })
    }

    const kodeLower = kode.toLowerCase().trim()
    const potonganInt = parseInt(potongan)
    const limitInt = parseInt(limit)

    if (isNaN(potonganInt) || potonganInt < 0) {
      const { data: voucher } = await supabase
        .from('Voucher')
        .select('*')
        .eq('id', id)
        .single()
      
      const { data: products } = await supabase
        .from('Produk')
        .select('kode, nama')
        .order('nama', { ascending: true })
      
      return res.render('voucher-form', {
        title: `Edit Voucher - ${NamaBot}`,
        namaBot: NamaBot,
        username: req.session.username,
        req: req,
        voucher: { ...voucher, ...req.body },
        products: products || [],
        action: 'edit',
        error: 'Potongan harus berupa angka positif!'
      })
    }

    if (isNaN(limitInt) || limitInt < 0) {
      const { data: voucher } = await supabase
        .from('Voucher')
        .select('*')
        .eq('id', id)
        .single()
      
      const { data: products } = await supabase
        .from('Produk')
        .select('kode, nama')
        .order('nama', { ascending: true })
      
      return res.render('voucher-form', {
        title: `Edit Voucher - ${NamaBot}`,
        namaBot: NamaBot,
        username: req.session.username,
        req: req,
        voucher: { ...voucher, ...req.body },
        products: products || [],
        action: 'edit',
        error: 'Limit harus berupa angka positif!'
      })
    }

    // Cek apakah kode sudah ada (kecuali voucher yang sedang diedit)
    const { data: existing } = await supabase
      .from('Voucher')
      .select('id, kode')
      .eq('kode', kodeLower)
      .single()

    if (existing && existing.id !== id) {
      const { data: voucher } = await supabase
        .from('Voucher')
        .select('*')
        .eq('id', id)
        .single()
      
      const { data: products } = await supabase
        .from('Produk')
        .select('kode, nama')
        .order('nama', { ascending: true })
      
      return res.render('voucher-form', {
        title: `Edit Voucher - ${NamaBot}`,
        namaBot: NamaBot,
        username: req.session.username,
        req: req,
        voucher: { ...voucher, ...req.body },
        products: products || [],
        action: 'edit',
        error: 'Kode voucher sudah digunakan!'
      })
    }

    // Tentukan produk yang berlaku
    let produkArray = []
    if (produk_all === 'on') {
      produkArray = ['all']
    } else if (produk && Array.isArray(produk)) {
      produkArray = produk.map(p => p.toLowerCase())
    } else if (produk) {
      produkArray = [produk.toLowerCase()]
    } else {
      produkArray = ['all']
    }

    // Update voucher
    const { error: updateError } = await supabase
      .from('Voucher')
      .update({
        kode: kodeLower,
        potongan: potonganInt,
        limit: limitInt,
        produk: produkArray
      })
      .eq('id', id)

    if (updateError) throw updateError

    console.log(`[${new Date().toISOString()}] Voucher diedit: ${kodeLower} oleh ${req.session.username}`)
    res.redirect('/voucher?success=edit')
  } catch (error) {
    console.error('Error updating voucher:', error)
    res.redirect('/voucher?error=edit')
  }
})

// Route: Hapus Voucher
app.get('/voucher/hapus/:id', isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params
    
    const { data: voucher, error } = await supabase
      .from('Voucher')
      .select('*')
      .eq('id', id)
      .single()

    if (error || !voucher) {
      return res.redirect('/voucher?error=notfound')
    }

    res.render('voucher-hapus', {
      title: `Hapus Voucher - ${NamaBot}`,
      namaBot: NamaBot,
      username: req.session.username,
      voucher: voucher,
      formatrupiah
    })
  } catch (error) {
    console.error('Error loading voucher:', error)
    res.redirect('/voucher?error=load')
  }
})

// Route: Proses Hapus Voucher
app.post('/voucher/hapus/:id', isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params
    
    // Hapus voucher
    const { error } = await supabase
      .from('Voucher')
      .delete()
      .eq('id', id)

    if (error) throw error

    console.log(`[${new Date().toISOString()}] Voucher dihapus: ID ${id} oleh ${req.session.username}`)
    res.redirect('/voucher?success=hapus')
  } catch (error) {
    console.error('Error deleting voucher:', error)
    res.redirect('/voucher?error=hapus')
  }
})

// Route: Detail Voucher
app.get('/voucher/:id', isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params
    
    const { data: voucher, error } = await supabase
      .from('Voucher')
      .select('*')
      .eq('id', id)
      .single()

    if (error || !voucher) {
      return res.redirect('/voucher?error=notfound')
    }

    // Hitung statistik
    const jumlahPenggunaan = Array.isArray(voucher.user) ? voucher.user.length : 0
    const sisaLimit = voucher.limit - jumlahPenggunaan
    const status = sisaLimit <= 0 ? 'habis' : (jumlahPenggunaan > 0 ? 'aktif' : 'baru')

    // Ambil info produk yang berlaku
    const produkKodes = Array.isArray(voucher.produk) ? voucher.produk : []
    let produkInfo = []
    
    if (produkKodes.includes('all')) {
      produkInfo = [{ kode: 'all', nama: 'Semua Produk' }]
    } else {
      const { data: products } = await supabase
        .from('Produk')
        .select('kode, nama')
        .in('kode', produkKodes)
      
      produkInfo = products || []
    }

    res.render('voucher-detail', {
      title: `Detail Voucher - ${NamaBot}`,
      namaBot: NamaBot,
      username: req.session.username,
      voucher: voucher,
      produkInfo: produkInfo,
      stats: {
        jumlahPenggunaan,
        sisaLimit,
        status
      },
      formatrupiah
    })
  } catch (error) {
    console.error('Error loading voucher:', error)
    res.redirect('/voucher?error=load')
  }
})

// Route: Export Voucher ke CSV
app.get('/voucher/export', isAuthenticated, async (req, res) => {
  try {
    const { data: vouchers, error } = await supabase
      .from('Voucher')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) throw error

    // Generate CSV
    const csvHeader = 'Kode,Potongan,Limit,Penggunaan,Sisa Limit,Produk Berlaku,Created At\n'
    const csvRows = (vouchers || []).map(v => {
      const jumlahPenggunaan = Array.isArray(v.user) ? v.user.length : 0
      const sisaLimit = v.limit - jumlahPenggunaan
      const produk = Array.isArray(v.produk) ? (v.produk.includes('all') ? 'Semua Produk' : v.produk.join('; ')) : ''
      const createdAt = moment.tz(v.created_at, 'Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss')
      return `"${v.kode}",${v.potongan},${v.limit},${jumlahPenggunaan},${sisaLimit},"${produk}","${createdAt}"`
    }).join('\n')

    const csv = csvHeader + csvRows

    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename=voucher-${moment.tz('Asia/Jakarta').format('YYYY-MM-DD')}.csv`)
    res.send('\ufeff' + csv)
  } catch (error) {
    console.error('Error exporting vouchers:', error)
    res.status(500).send('Error exporting vouchers: ' + error.message)
  }
})

// Route: API untuk statistik (untuk chart)
app.get('/api/stats', isAuthenticated, async (req, res) => {
  try {
    const { data: transactions } = await supabase
      .from('Trx')
      .select('tanggal, harga')
      .order('tanggal', { ascending: true })

    // Group by date
    const dailyStats = {}
    transactions?.forEach(t => {
      const date = moment.tz(t.tanggal, 'Asia/Jakarta').format('YYYY-MM-DD')
      if (!dailyStats[date]) {
        dailyStats[date] = { date, revenue: 0, count: 0 }
      }
      dailyStats[date].revenue += t.harga || 0
      dailyStats[date].count += 1
    })

    const chartData = Object.values(dailyStats).slice(-30) // 30 hari terakhir

    res.json({
      success: true,
      data: chartData
    })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// ============================================
// COMMUNICATION FEATURES - TELEGRAM INTEGRATION
// ============================================

const TelegramBot = require('node-telegram-bot-api')
const { TokenBot } = require('./settings.js')

// Initialize bot instance untuk dashboard (read-only, hanya untuk send message)
let dashboardBot = null
try {
  if (TokenBot) {
    dashboardBot = new TelegramBot(TokenBot, { polling: false })
    console.log('✅ Telegram bot initialized for dashboard communication features')
  }
} catch (error) {
  console.error('⚠️ Error initializing Telegram bot for dashboard:', error.message)
}

// Helper: Send message via Telegram
async function sendTelegramMessage(userId, message, options = {}) {
  if (!dashboardBot) {
    throw new Error('Telegram bot not initialized')
  }
  
  try {
    await dashboardBot.sendMessage(userId, message, {
      parse_mode: 'Markdown',
      ...options
    })
    return { success: true }
  } catch (error) {
    return { 
      success: false, 
      error: error.message,
      code: error.response?.statusCode || error.code
    }
  }
}

// Helper: Broadcast message ke semua user
async function broadcastMessage(message, adminId, username) {
  try {
    // Ambil semua user
    const { data: users, error: userError } = await supabase
      .from('User')
      .select('id')
    
    if (userError) throw userError
    
    if (!users || users.length === 0) {
      return {
        success: false,
        message: 'Tidak ada user yang terdaftar'
      }
    }
    
    // Buat record di MessageHistory
    const { data: historyRecord, error: historyError } = await supabase
      .from('MessageHistory')
      .insert([{
        admin_id: adminId,
        username: username,
        message_type: 'broadcast',
        recipient_type: 'all',
        recipient_count: users.length,
        message_text: message,
        status: 'sending'
      }])
      .select()
      .single()
    
    if (historyError) throw historyError
    
    let successCount = 0
    let failedCount = 0
    const errors = []
    
    // Kirim ke semua user
    for (const user of users) {
      const result = await sendTelegramMessage(user.id, message)
      if (result.success) {
        successCount++
      } else {
        failedCount++
        errors.push({
          userId: user.id,
          error: result.error
        })
      }
      
      // Delay untuk menghindari rate limit
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    
    // Update history record
    const finalStatus = failedCount === 0 ? 'completed' : (successCount > 0 ? 'partial' : 'failed')
    
    await supabase
      .from('MessageHistory')
      .update({
        status: finalStatus,
        success_count: successCount,
        failed_count: failedCount,
        error_details: errors.length > 0 ? errors : null,
        sent_at: new Date().toISOString()
      })
      .eq('id', historyRecord.id)
    
    return {
      success: true,
      total: users.length,
      successCount,
      failedCount,
      historyId: historyRecord.id
    }
  } catch (error) {
    console.error('Error broadcasting message:', error)
    return {
      success: false,
      error: error.message
    }
  }
}

// Helper: Send message ke user tertentu
async function sendSingleMessage(userId, message, adminId, username) {
  try {
    // Verifikasi user exists
    const { data: user, error: userError } = await supabase
      .from('User')
      .select('id')
      .eq('id', userId)
      .single()
    
    if (userError || !user) {
      return {
        success: false,
        error: 'User tidak ditemukan'
      }
    }
    
    // Buat record di MessageHistory
    const { data: historyRecord, error: historyError } = await supabase
      .from('MessageHistory')
      .insert([{
        admin_id: adminId,
        username: username,
        message_type: 'single',
        recipient_type: 'user',
        recipient_id: userId,
        recipient_count: 1,
        message_text: message,
        status: 'sending'
      }])
      .select()
      .single()
    
    if (historyError) throw historyError
    
    // Kirim pesan
    const result = await sendTelegramMessage(userId, message)
    
    // Update history record
    const finalStatus = result.success ? 'completed' : 'failed'
    
    await supabase
      .from('MessageHistory')
      .update({
        status: finalStatus,
        success_count: result.success ? 1 : 0,
        failed_count: result.success ? 0 : 1,
        error_details: result.success ? null : [{ userId, error: result.error }],
        sent_at: new Date().toISOString()
      })
      .eq('id', historyRecord.id)
    
    return {
      success: result.success,
      historyId: historyRecord.id,
      error: result.error
    }
  } catch (error) {
    console.error('Error sending single message:', error)
    return {
      success: false,
      error: error.message
    }
  }
}

// Helper: Process template dengan variabel
function processTemplate(templateText, variables = {}) {
  let processed = templateText
  Object.keys(variables).forEach(key => {
    const regex = new RegExp(`\\{${key}\\}`, 'g')
    processed = processed.replace(regex, variables[key] || '')
  })
  return processed
}

// ============================================
// ROUTE: COMMUNICATION FEATURES
// ============================================

// Route: Halaman Broadcast Message
app.get('/communication/broadcast', isAuthenticated, async (req, res) => {
  try {
    // Ambil templates
    const { data: templates } = await supabase
      .from('MessageTemplate')
      .select('*')
      .eq('is_active', true)
      .order('category', { ascending: true })
    
    res.render('communication-broadcast', {
      title: `Broadcast Message - ${NamaBot}`,
      namaBot: NamaBot,
      username: req.session.username,
      templates: templates || [],
      error: req.query.error || null,
      success: req.query.success || null,
      req: req
    })
  } catch (error) {
    console.error('Error loading broadcast page:', error)
    res.status(500).send('Error loading broadcast page: ' + error.message)
  }
})

// Route: Proses Broadcast Message
app.post('/communication/broadcast', isAuthenticated, async (req, res) => {
  try {
    const { message, template_id, template_variables } = req.body
    
    let finalMessage = message
    
    // Jika menggunakan template
    if (template_id && template_id !== 'none') {
      const { data: template, error: templateError } = await supabase
        .from('MessageTemplate')
        .select('*')
        .eq('id', template_id)
        .single()
      
      if (!templateError && template) {
        // Process template dengan variabel
        let variables = {}
        if (template_variables) {
          try {
            variables = typeof template_variables === 'string' 
              ? JSON.parse(template_variables) 
              : template_variables
          } catch (e) {
            variables = {}
          }
        }
        finalMessage = processTemplate(template.message_text, variables)
      }
    }
    
    if (!finalMessage || !finalMessage.trim()) {
      return res.redirect('/communication/broadcast?error=empty')
    }
    
    // Broadcast message
    const result = await broadcastMessage(
      finalMessage.trim(),
      req.session.adminId,
      req.session.username
    )
    
    if (result.success) {
      await logActivity(req, 'BROADCAST_MESSAGE', 'MessageHistory', result.historyId, {
        total: result.total,
        success: result.successCount,
        failed: result.failedCount
      })
      res.redirect(`/communication/history/${result.historyId}?success=broadcast`)
    } else {
      res.redirect(`/communication/broadcast?error=${encodeURIComponent(result.error || 'unknown')}`)
    }
  } catch (error) {
    console.error('Error broadcasting message:', error)
    res.redirect(`/communication/broadcast?error=${encodeURIComponent(error.message)}`)
  }
})

// Route: Halaman Send Message ke User Tertentu
app.get('/communication/send', isAuthenticated, async (req, res) => {
  try {
    const { user_id } = req.query
    
    // Ambil templates
    const { data: templates } = await supabase
      .from('MessageTemplate')
      .select('*')
      .eq('is_active', true)
      .order('category', { ascending: true })
    
    // Jika ada user_id, ambil info user
    let user = null
    if (user_id) {
      const { data: userData } = await supabase
        .from('User')
        .select('*')
        .eq('id', parseInt(user_id))
        .single()
      user = userData
    }
    
    res.render('communication-send', {
      title: `Send Message - ${NamaBot}`,
      namaBot: NamaBot,
      username: req.session.username,
      templates: templates || [],
      user: user,
      error: req.query.error || null,
      success: req.query.success || null,
      req: req
    })
  } catch (error) {
    console.error('Error loading send message page:', error)
    res.status(500).send('Error loading send message page: ' + error.message)
  }
})

// Route: Proses Send Message ke User Tertentu
app.post('/communication/send', isAuthenticated, async (req, res) => {
  try {
    const { user_id, message, template_id, template_variables } = req.body
    
    if (!user_id) {
      return res.redirect('/communication/send?error=nouser')
    }
    
    const userId = parseInt(user_id)
    if (isNaN(userId)) {
      return res.redirect('/communication/send?error=invaliduser')
    }
    
    let finalMessage = message
    
    // Jika menggunakan template
    if (template_id && template_id !== 'none') {
      const { data: template, error: templateError } = await supabase
        .from('MessageTemplate')
        .select('*')
        .eq('id', template_id)
        .single()
      
      if (!templateError && template) {
        let variables = {}
        if (template_variables) {
          try {
            variables = typeof template_variables === 'string' 
              ? JSON.parse(template_variables) 
              : template_variables
          } catch (e) {
            variables = {}
          }
        }
        finalMessage = processTemplate(template.message_text, variables)
      }
    }
    
    if (!finalMessage || !finalMessage.trim()) {
      return res.redirect('/communication/send?error=empty')
    }
    
    // Send message
    const result = await sendSingleMessage(
      userId,
      finalMessage.trim(),
      req.session.adminId,
      req.session.username
    )
    
    if (result.success) {
      await logActivity(req, 'SEND_MESSAGE', 'MessageHistory', result.historyId, {
        userId: userId
      })
      res.redirect(`/communication/history/${result.historyId}?success=send`)
    } else {
      res.redirect(`/communication/send?user_id=${userId}&error=${encodeURIComponent(result.error || 'unknown')}`)
    }
  } catch (error) {
    console.error('Error sending message:', error)
    res.redirect(`/communication/send?error=${encodeURIComponent(error.message)}`)
  }
})

// Route: Daftar Message Templates
app.get('/communication/templates', isAuthenticated, async (req, res) => {
  try {
    const { data: templates, error } = await supabase
      .from('MessageTemplate')
      .select('*')
      .order('category', { ascending: true })
      .order('name', { ascending: true })
    
    if (error) throw error
    
    res.render('communication-templates', {
      title: `Message Templates - ${NamaBot}`,
      namaBot: NamaBot,
      username: req.session.username,
      templates: templates || [],
      success: req.query.success || null,
      error: req.query.error || null,
      req: req
    })
  } catch (error) {
    console.error('Error loading templates:', error)
    res.status(500).send('Error loading templates: ' + error.message)
  }
})

// Route: Form Tambah Template
app.get('/communication/templates/tambah', isAuthenticated, (req, res) => {
  res.render('communication-template-form', {
    title: `Tambah Template - ${NamaBot}`,
    namaBot: NamaBot,
    username: req.session.username,
    template: null,
    action: 'tambah',
    error: null,
    req: req
  })
})

// Route: Proses Tambah Template
app.post('/communication/templates/tambah', isAuthenticated, async (req, res) => {
  try {
    const { name, category, subject, message_text, variables } = req.body
    
    if (!name || !message_text) {
      return res.render('communication-template-form', {
        title: `Tambah Template - ${NamaBot}`,
        namaBot: NamaBot,
        username: req.session.username,
        template: req.body,
        action: 'tambah',
        error: 'Nama dan pesan template wajib diisi!',
        req: req
      })
    }
    
    // Parse variables jika ada
    let variablesArray = []
    if (variables) {
      try {
        variablesArray = typeof variables === 'string' ? JSON.parse(variables) : variables
      } catch (e) {
        variablesArray = []
      }
    }
    
    const { data, error } = await supabase
      .from('MessageTemplate')
      .insert([{
        name: name.trim(),
        category: category || 'general',
        subject: subject ? subject.trim() : null,
        message_text: message_text.trim(),
        variables: variablesArray,
        created_by: req.session.adminId
      }])
      .select()
      .single()
    
    if (error) throw error
    
    await logActivity(req, 'CREATE_TEMPLATE', 'MessageTemplate', data.id, { name: data.name })
    res.redirect('/communication/templates?success=tambah')
  } catch (error) {
    console.error('Error adding template:', error)
    res.render('communication-template-form', {
      title: `Tambah Template - ${NamaBot}`,
      namaBot: NamaBot,
      username: req.session.username,
      template: req.body,
      action: 'tambah',
      error: error.message || 'Gagal menambahkan template!',
      req: req
    })
  }
})

// Route: Form Edit Template
app.get('/communication/templates/edit/:id', isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params
    
    const { data: template, error } = await supabase
      .from('MessageTemplate')
      .select('*')
      .eq('id', id)
      .single()
    
    if (error || !template) {
      return res.redirect('/communication/templates?error=notfound')
    }
    
    res.render('communication-template-form', {
      title: `Edit Template - ${NamaBot}`,
      namaBot: NamaBot,
      username: req.session.username,
      template: template,
      action: 'edit',
      error: null,
      req: req
    })
  } catch (error) {
    console.error('Error loading template:', error)
    res.redirect('/communication/templates?error=load')
  }
})

// Route: Proses Edit Template
app.post('/communication/templates/edit/:id', isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params
    const { name, category, subject, message_text, variables, is_active } = req.body
    
    if (!name || !message_text) {
      const { data: template } = await supabase
        .from('MessageTemplate')
        .select('*')
        .eq('id', id)
        .single()
      
      return res.render('communication-template-form', {
        title: `Edit Template - ${NamaBot}`,
        namaBot: NamaBot,
        username: req.session.username,
        template: { ...template, ...req.body },
        action: 'edit',
        error: 'Nama dan pesan template wajib diisi!',
        req: req
      })
    }
    
    let variablesArray = []
    if (variables) {
      try {
        variablesArray = typeof variables === 'string' ? JSON.parse(variables) : variables
      } catch (e) {
        variablesArray = []
      }
    }
    
    const { error } = await supabase
      .from('MessageTemplate')
      .update({
        name: name.trim(),
        category: category || 'general',
        subject: subject ? subject.trim() : null,
        message_text: message_text.trim(),
        variables: variablesArray,
        is_active: is_active === 'on',
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
    
    if (error) throw error
    
    await logActivity(req, 'UPDATE_TEMPLATE', 'MessageTemplate', id, { name: name.trim() })
    res.redirect('/communication/templates?success=edit')
  } catch (error) {
    console.error('Error updating template:', error)
    res.redirect('/communication/templates?error=edit')
  }
})

// Route: Hapus Template
app.post('/communication/templates/hapus/:id', isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params
    
    const { error } = await supabase
      .from('MessageTemplate')
      .delete()
      .eq('id', id)
    
    if (error) throw error
    
    await logActivity(req, 'DELETE_TEMPLATE', 'MessageTemplate', id)
    res.redirect('/communication/templates?success=hapus')
  } catch (error) {
    console.error('Error deleting template:', error)
    res.redirect('/communication/templates?error=hapus')
  }
})

// Route: API - Get Template Details (JSON)
app.get('/api/communication/template/:id', isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params
    
    const { data: template, error } = await supabase
      .from('MessageTemplate')
      .select('*')
      .eq('id', id)
      .eq('is_active', true)
      .single()
    
    if (error || !template) {
      return res.status(404).json({ error: 'Template tidak ditemukan' })
    }
    
    res.json({ success: true, template })
  } catch (error) {
    console.error('Error fetching template:', error)
    res.status(500).json({ error: 'Error fetching template: ' + error.message })
  }
})

// Route: Message History
app.get('/communication/history', isAuthenticated, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = 50
    const offset = (page - 1) * limit
    
    const { type, status } = req.query
    
    let query = supabase
      .from('MessageHistory')
      .select('*', { count: 'exact' })
    
    if (type && type !== 'all') {
      query = query.eq('message_type', type)
    }
    if (status && status !== 'all') {
      query = query.eq('status', status)
    }
    
    const { data: messages, error, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)
    
    if (error) throw error
    
    const totalPages = Math.ceil((count || 0) / limit)
    
    res.render('communication-history', {
      title: `Message History - ${NamaBot}`,
      namaBot: NamaBot,
      username: req.session.username,
      messages: messages || [],
      currentPageNum: page,
      totalPages: totalPages,
      formatTanggal,
      filters: {
        type: type || 'all',
        status: status || 'all'
      },
      req: req
    })
  } catch (error) {
    console.error('Error loading message history:', error)
    res.status(500).send('Error loading message history: ' + error.message)
  }
})

// Route: Detail Message History
app.get('/communication/history/:id', isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params
    
    const { data: message, error } = await supabase
      .from('MessageHistory')
      .select('*')
      .eq('id', id)
      .single()
    
    if (error || !message) {
      return res.redirect('/communication/history?error=notfound')
    }
    
    // Ambil info user jika single message
    let user = null
    if (message.recipient_id) {
      const { data: userData } = await supabase
        .from('User')
        .select('*')
        .eq('id', message.recipient_id)
        .single()
      user = userData
    }
    
    res.render('communication-history-detail', {
      title: `Message Detail - ${NamaBot}`,
      namaBot: NamaBot,
      username: req.session.username,
      message: message,
      user: user,
      formatTanggal,
      success: req.query.success || null,
      req: req
    })
  } catch (error) {
    console.error('Error loading message detail:', error)
    res.redirect('/communication/history?error=load')
  }
})

// ============================================
// REAL-TIME NOTIFICATIONS & ALERTS
// ============================================

// Store untuk SSE connections
const sseClients = new Map()
const inbox = require('./lib/notification-inbox')

// Helper: Get notification settings
async function getNotificationSettings() {
  try {
    const { data: settings } = await supabase
      .from('NotificationSettings')
      .select('*')
    
    const settingsMap = {}
    settings?.forEach(s => {
      settingsMap[s.setting_key] = s.setting_value
    })
    
    const result = {
      lowStockThreshold: settingsMap.low_stock_threshold?.default || 10,
      lowStockEnabled: settingsMap.low_stock_threshold?.enabled !== false,
      largeTransactionThreshold: settingsMap.large_transaction_threshold?.amount || 1000000,
      largeTransactionEnabled: settingsMap.large_transaction_threshold?.enabled !== false,
      depositNotificationEnabled: settingsMap.deposit_notification_enabled?.enabled !== false,
      stockNotificationEnabled: settingsMap.stock_notification_enabled?.enabled !== false,
      transactionNotificationEnabled: settingsMap.transaction_notification_enabled?.enabled !== false,
      soundEnabled: settingsMap.sound_enabled?.enabled !== false,
      browserNotificationsEnabled: settingsMap.browser_notifications_enabled?.enabled !== false,
      quietHoursEnabled: settingsMap.quiet_hours?.enabled === true,
      quietHoursStart: settingsMap.quiet_hours?.start || '22:00',
      quietHoursEnd: settingsMap.quiet_hours?.end || '08:00',
      autoMarkReadEnabled: settingsMap.auto_mark_read?.enabled === true,
      autoMarkReadSeconds: settingsMap.auto_mark_read?.seconds || 30,
      notificationFrequency: settingsMap.notification_frequency?.mode || 'realtime'
    }
    
    // Debug logging (bisa di-comment jika tidak perlu)
    // console.log('Current notification settings:', {
    //   depositNotificationEnabled: result.depositNotificationEnabled,
    //   stockNotificationEnabled: result.stockNotificationEnabled,
    //   transactionNotificationEnabled: result.transactionNotificationEnabled,
    //   lowStockEnabled: result.lowStockEnabled,
    //   largeTransactionEnabled: result.largeTransactionEnabled
    // })
    
    return result
  } catch (error) {
    console.error('Error getting notification settings:', error)
    return {
      lowStockThreshold: 10,
      lowStockEnabled: true,
      largeTransactionThreshold: 1000000,
      largeTransactionEnabled: true,
      depositNotificationEnabled: true,
      stockNotificationEnabled: true,
      transactionNotificationEnabled: true,
      soundEnabled: true,
      browserNotificationsEnabled: true,
      quietHoursEnabled: false,
      quietHoursStart: '22:00',
      quietHoursEnd: '08:00',
      autoMarkReadEnabled: false,
      autoMarkReadSeconds: 30,
      notificationFrequency: 'realtime'
    }
  }
}

// Helper: Get general settings
async function getGeneralSettings() {
  try {
    const { data: settings } = await supabase
      .from('NotificationSettings')
      .select('*')
      .in('setting_key', [
        'bot_name',
        'bot_logo',
        'currency',
        'timezone',
        'date_format',
        'time_format',
        'language',
        'items_per_page',
        'auto_refresh',
        'dashboard_theme'
      ])
    
    const settingsMap = {}
    settings?.forEach(s => {
      settingsMap[s.setting_key] = s.setting_value
    })
    
    return {
      botName: NamaBot, // Sinkron dengan nama bot Telegram (NAMA_BOT), tidak disimpan di DB
      botLogo: settingsMap.bot_logo?.value || '',
      currency: {
        symbol: settingsMap.currency?.symbol || 'Rp',
        code: settingsMap.currency?.code || 'IDR',
        position: settingsMap.currency?.position || 'before'
      },
      timezone: settingsMap.timezone?.value || 'Asia/Jakarta',
      dateFormat: settingsMap.date_format?.value || 'DD/MM/YYYY',
      timeFormat: settingsMap.time_format?.value || '24h',
      language: settingsMap.language?.value || 'id',
      itemsPerPage: parseInt(settingsMap.items_per_page?.value) || 20,
      autoRefresh: {
        enabled: settingsMap.auto_refresh?.enabled !== false,
        interval: parseInt(settingsMap.auto_refresh?.interval) || 30
      },
      dashboardTheme: settingsMap.dashboard_theme?.value || 'light'
    }
  } catch (error) {
    console.error('Error getting general settings:', error)
    // Return defaults
    return {
      botName: NamaBot,
      botLogo: '',
      currency: { symbol: 'Rp', code: 'IDR', position: 'before' },
      timezone: 'Asia/Jakarta',
      dateFormat: 'DD/MM/YYYY',
      timeFormat: '24h',
      language: 'id',
      itemsPerPage: 20,
      autoRefresh: { enabled: true, interval: 30 },
      dashboardTheme: 'light'
    }
  }
}

// Helper: Get channel & contact settings (CHANNEL_LOG, CHANNEL_STORE, CS, FEED_CHANNEL, FEED_STOCK_ENABLED, FEED_PURCHASE_ENABLED)
async function getChannelContactSettings() {
  try {
    const { data: settings } = await supabase
      .from('NotificationSettings')
      .select('*')
      .in('setting_key', ['channel_log', 'channel_store', 'cs', 'feed_channel', 'feed_stock_enabled', 'feed_purchase_enabled'])
    
    const settingsMap = {}
    settings?.forEach(s => {
      settingsMap[s.setting_key] = s.setting_value
    })
    
    const { ChannelLog, ChannelStore, CS, FeedChannel, FeedStockEnabled, FeedPurchaseEnabled } = require('./settings.js')
    
    return {
      channelLog: settingsMap.channel_log?.value ?? ChannelLog ?? '',
      channelStore: settingsMap.channel_store?.value ?? ChannelStore ?? '',
      cs: settingsMap.cs?.value ?? CS ?? '',
      feedChannel: settingsMap.feed_channel?.value ?? FeedChannel ?? '',
      feedStockEnabled: settingsMap.feed_stock_enabled?.value ?? FeedStockEnabled ?? true,
      feedPurchaseEnabled: settingsMap.feed_purchase_enabled?.value ?? FeedPurchaseEnabled ?? true
    }
  } catch (error) {
    console.error('Error getting channel/contact settings:', error)
    const { ChannelLog, ChannelStore, CS, FeedChannel, FeedStockEnabled, FeedPurchaseEnabled } = require('./settings.js')
    return {
      channelLog: ChannelLog || '',
      channelStore: ChannelStore || '',
      cs: CS || '',
      feedChannel: FeedChannel || '',
      feedStockEnabled: FeedStockEnabled ?? true,
      feedPurchaseEnabled: FeedPurchaseEnabled ?? true
    }
  }
}

// Helper: Get payment gateway settings
async function getPaymentGatewaySettings() {
  try {
    const { data: settings } = await supabase
      .from('NotificationSettings')
      .select('*')
      .in('setting_key', [
        'payment_gateway_enabled',
        'payment_gateway_project',
        'payment_gateway_api_key',
        'payment_gateway_base_url',
        'payment_gateway_timeout',
        'payment_gateway_qris_enabled',
        'payment_gateway_saldo_enabled'
      ])
    
    const settingsMap = {}
    settings?.forEach(s => {
      settingsMap[s.setting_key] = s.setting_value
    })
    
    // Fallback ke .env jika tidak ada di database
    const { Pakasir } = require('./settings.js')
    
    return {
      enabled: settingsMap.payment_gateway_enabled?.value !== false,
      project: settingsMap.payment_gateway_project?.value || Pakasir.project || '',
      apiKey: settingsMap.payment_gateway_api_key?.value || Pakasir.apiKey || '',
      baseUrl: settingsMap.payment_gateway_base_url?.value || Pakasir.baseUrl || 'https://app.pakasir.com',
      paymentTimeout: parseInt(settingsMap.payment_gateway_timeout?.value) || 10,
      qrisEnabled: settingsMap.payment_gateway_qris_enabled?.value !== false,
      saldoEnabled: settingsMap.payment_gateway_saldo_enabled?.value !== false
    }
  } catch (error) {
    console.error('Error getting payment gateway settings:', error)
    // Return defaults
    const { Pakasir } = require('./settings.js')
    return {
      enabled: true,
      project: Pakasir.project || '',
      apiKey: Pakasir.apiKey || '',
      baseUrl: Pakasir.baseUrl || 'https://app.pakasir.com',
      paymentTimeout: 10,
      qrisEnabled: true,
      saldoEnabled: true
    }
  }
}

// Helper: Get Supabase database settings
async function getSupabaseSettings() {
  try {
    const { data: settings } = await supabase
      .from('NotificationSettings')
      .select('*')
      .in('setting_key', [
        'supabase_url',
        'supabase_key',
        'supabase_service_key',
        'supabase_enabled',
        'supabase_connection_timeout',
        'supabase_retry_attempts',
        'supabase_retry_delay'
      ])
    
    const settingsMap = {}
    settings?.forEach(s => {
      settingsMap[s.setting_key] = s.setting_value
    })
    
    // Fallback ke .env jika tidak ada di database
    const { SUPABASE_URL, SUPABASE_KEY } = require('./settings.js')
    
    return {
      url: settingsMap.supabase_url?.value || SUPABASE_URL || '',
      key: settingsMap.supabase_key?.value || SUPABASE_KEY || '',
      serviceKey: settingsMap.supabase_service_key?.value || '',
      enabled: settingsMap.supabase_enabled?.value !== false,
      connectionTimeout: parseInt(settingsMap.supabase_connection_timeout?.value) || 30,
      retryAttempts: parseInt(settingsMap.supabase_retry_attempts?.value) || 3,
      retryDelay: parseInt(settingsMap.supabase_retry_delay?.value) || 1000
    }
  } catch (error) {
    console.error('Error getting Supabase settings:', error)
    // Return defaults
    const { SUPABASE_URL, SUPABASE_KEY } = require('./settings.js')
    return {
      url: SUPABASE_URL || '',
      key: SUPABASE_KEY || '',
      serviceKey: '',
      enabled: true,
      connectionTimeout: 30,
      retryAttempts: 3,
      retryDelay: 1000
    }
  }
}

// Helper: Get variant stock threshold
async function getProductStockThreshold(varianId) {
  try {
    const { data } = await supabase
      .from('ProductStockThreshold')
      .select('threshold, is_active')
      .eq('varian_id', varianId)
      .maybeSingle()
    
    if (data && data.is_active) {
      return data.threshold
    }
    
    const settings = await getNotificationSettings()
    return settings.lowStockThreshold
  } catch (error) {
    const settings = await getNotificationSettings()
    return settings.lowStockThreshold
  }
}

async function getProductStockThresholdMap(varianIds, defaultThreshold) {
  const map = Object.create(null)
  if (!varianIds.length) return map

  const { data } = await supabase
    .from('ProductStockThreshold')
    .select('varian_id, threshold, is_active')
    .in('varian_id', varianIds)

  for (const row of data || []) {
    if (row.is_active) map[row.varian_id] = row.threshold
  }
  for (const id of varianIds) {
    if (map[id] === undefined) map[id] = defaultThreshold
  }
  return map
}

// Helper: Check if current time is in quiet hours
async function isQuietHours() {
  try {
    const settings = await getNotificationSettings()
    if (!settings.quietHoursEnabled) return false
    
    const now = new Date()
    const currentTime = now.getHours() * 60 + now.getMinutes() // minutes since midnight
    
    const [startHour, startMin] = settings.quietHoursStart.split(':').map(Number)
    const [endHour, endMin] = settings.quietHoursEnd.split(':').map(Number)
    
    const startTime = startHour * 60 + startMin
    const endTime = endHour * 60 + endMin
    
    // Handle case where quiet hours span midnight
    if (startTime > endTime) {
      return currentTime >= startTime || currentTime <= endTime
    } else {
      return currentTime >= startTime && currentTime <= endTime
    }
  } catch (error) {
    console.error('Error checking quiet hours:', error)
    return false
  }
}

async function buildNotificationInbox() {
  const settings = await getNotificationSettings()
  const items = []
  let pendingCount = 0
  let lowStockCount = 0
  let largeTransactionCount = 0

  if (settings.depositNotificationEnabled) {
    const { data: deposits, count } = await supabase
      .from('Deposit')
      .select('tanggal', { count: 'exact' })
      .eq('status', 'pending')
      .order('tanggal', { ascending: false })
      .limit(1)

    pendingCount = count || 0
    const summary = inbox.buildDepositSummaryItem({
      count: pendingCount,
      latestAt: deposits?.[0]?.tanggal || new Date().toISOString(),
    })
    if (summary) items.push(summary)
  }

  if (settings.stockNotificationEnabled && settings.lowStockEnabled) {
    const { data: variants } = await supabase
      .from('Varian')
      .select('id, label, kode, produk_id, produk:Produk(id, nama)')
      .eq('is_active', true)

    const variantList = variants || []
    const varianIds = variantList.map((v) => v.id)
    const thresholdMap = await getProductStockThresholdMap(varianIds, settings.lowStockThreshold)
    const stockCounts = await stock.getStokCountsByKode(variantList.map((v) => v.kode))

    for (const variant of variantList) {
      const threshold = thresholdMap[variant.id] ?? settings.lowStockThreshold
      const stokCount = stockCounts[String(variant.kode).toLowerCase()] ?? 0
      if (stokCount <= threshold) {
        lowStockCount++
        items.push(inbox.buildLowStockItem({
          variant,
          produkId: variant.produk_id || variant.produk?.id,
          stokCount,
          threshold,
        }))
      }
    }
  }

  if (settings.transactionNotificationEnabled && settings.largeTransactionEnabled) {
    const { data: logs } = await supabase
      .from('NotificationLog')
      .select('*')
      .eq('notification_type', 'large_transaction')
      .eq('is_read', false)
      .order('created_at', { ascending: false })
      .limit(5)

    largeTransactionCount = (logs || []).length
    for (const log of logs || []) {
      items.push({
        id: log.id,
        type: 'large_transaction',
        title: (log.title || 'Transaksi besar').replace(/^[^\w]+/, '').trim() || 'Transaksi besar',
        message: log.message,
        href: inbox.getNotificationHref('large_transaction', log.data || {}),
        priority: 'medium',
        created_at: log.created_at,
        is_read: false,
        data: log.data,
      })
    }
  }

  const sorted = inbox.sortInboxItems(items)
  return {
    counts: {
      deposit_pending: pendingCount,
      low_stock: lowStockCount,
      large_transaction: largeTransactionCount,
      total: inbox.computeInboxTotal({ pendingCount, lowStockCount, largeTransactionCount }),
    },
    items: sorted,
  }
}

// Helper: Broadcast notification ke semua connected clients
async function broadcastNotification(notification) {
  // Check quiet hours before sending
  const inQuietHours = await isQuietHours()
  if (inQuietHours) {
    console.log('Quiet hours: Notification suppressed', notification.type)
    return // Don't send notification during quiet hours
  }
  
  const message = `data: ${JSON.stringify(notification)}\n\n`
  
  sseClients.forEach((res, adminId) => {
    try {
      res.write(message)
    } catch (error) {
      console.error(`Error sending notification to admin ${adminId}:`, error)
      sseClients.delete(adminId)
    }
  })
}

// Helper: Create notification log
async function createNotificationLog(type, title, message, data = null, adminId = null) {
  try {
    await supabase
      .from('NotificationLog')
      .insert([{
        notification_type: type,
        title: title,
        message: message,
        data: data,
        admin_id: adminId
      }])
  } catch (error) {
    console.error('Error creating notification log:', error)
  }
}

// Helper: Check low stock state (inbox API serves UI; no broadcast on periodic checks)
async function checkLowStockAlerts() {
  try {
    const settings = await getNotificationSettings()
    if (!settings.stockNotificationEnabled) return
  } catch (error) {
    console.error('Error checking low stock alerts:', error)
  }
}

// Helper: Check deposit pending state (inbox API serves UI; no broadcast on periodic checks)
async function checkDepositPending() {
  try {
    const settings = await getNotificationSettings()
    if (!settings.depositNotificationEnabled) return
  } catch (error) {
    console.error('Error checking deposit pending:', error)
  }
}

// Hook: Check for large transactions (dipanggil setelah transaksi)
async function checkLargeTransaction(transaction) {
  try {
    const settings = await getNotificationSettings()
    if (!settings.transactionNotificationEnabled) return
    
    if (transaction.harga >= settings.largeTransactionThreshold) {
      const notification = {
        type: 'large_transaction',
        title: 'Transaksi besar',
        message: `Transaksi besar: ${formatrupiah(transaction.harga)} untuk produk "${transaction.nama}"`,
        data: {
          trx_uuid: transaction.trx_uuid,
          user_id: transaction.id,
          produk_nama: transaction.nama,
          produk_kode: transaction.kode,
          harga: transaction.harga
        },
        timestamp: new Date().toISOString(),
        priority: 'medium'
      }
      
      await createNotificationLog('large_transaction', notification.title, notification.message, notification.data)
      await broadcastNotification(notification)
    }
  } catch (error) {
    console.error('Error checking large transaction:', error)
  }
}

// Hook: Check for new deposit (dipanggil setelah deposit dibuat)
async function checkNewDeposit(deposit) {
  try {
    const settings = await getNotificationSettings()
    if (!settings.depositNotificationEnabled) return
    
    if (deposit.status === 'pending') {
      const notification = {
        type: 'deposit_pending',
        title: 'Deposit Baru',
        message: `Deposit baru: ${formatrupiah(deposit.jumlah)} dari User ID ${deposit.user_id}`,
        data: {
          deposit_id: deposit.id,
          user_id: deposit.user_id,
          jumlah: deposit.jumlah,
          metode: deposit.metode
        },
        timestamp: new Date().toISOString(),
        priority: 'high'
      }
      
      await createNotificationLog('deposit_pending', notification.title, notification.message, notification.data)
      await broadcastNotification(notification)
    }
  } catch (error) {
    console.error('Error checking new deposit:', error)
  }
}

// Route: SSE endpoint untuk real-time notifications
app.get('/api/notifications/stream', isAuthenticated, (req, res) => {
  const adminId = req.session.adminId || req.session.username
  
  // Set headers untuk SSE
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no') // Disable nginx buffering
  
  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', message: 'Connected to notification stream' })}\n\n`)
  
  // Store connection
  sseClients.set(adminId, res)

  // Inbox state is fetched via REST on client load; SSE is for live events only.

  // Handle client disconnect
  req.on('close', () => {
    sseClients.delete(adminId)
    res.end()
  })
})

app.get('/api/notifications/inbox', isAuthenticated, async (req, res) => {
  try {
    const { counts, items } = await buildNotificationInbox()
    res.json({ success: true, counts, items })
  } catch (error) {
    console.error('Error building notification inbox:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// Route: Get notification counts (untuk badge)
app.get('/api/notifications/counts', isAuthenticated, async (req, res) => {
  try {
    const settings = await getNotificationSettings()
    
    const counts = {
      deposit_pending: 0,
      low_stock: 0,
      unread_notifications: 0
    }
    
    // Count deposit pending
    if (settings.depositNotificationEnabled) {
      const { count } = await supabase
        .from('Deposit')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending')
      
      counts.deposit_pending = count || 0
    }
    
    // Count low stock products
    if (settings.stockNotificationEnabled) {
      const { data: variants } = await supabase
        .from('Varian')
        .select('id')
        .eq('is_active', true)
      
      if (variants) {
        let lowStockCount = 0
        for (const variant of variants) {
          const threshold = await getProductStockThreshold(variant.id)
          const stokCount = await stock.getStokCountByVarianId(variant.id)
          
          if (stokCount !== null && stokCount <= threshold) {
            lowStockCount++
          }
        }
        counts.low_stock = lowStockCount
      }
    }
    
    // Count unread notifications
    const { count: unreadCount } = await supabase
      .from('NotificationLog')
      .select('*', { count: 'exact', head: true })
      .eq('is_read', false)
    
    counts.unread_notifications = unreadCount || 0
    
    res.json({ success: true, counts })
  } catch (error) {
    console.error('Error getting notification counts:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// Route: Get recent notifications
app.get('/api/notifications/recent', isAuthenticated, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10
    
    const { data: notifications } = await supabase
      .from('NotificationLog')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)
    
    res.json({ success: true, notifications: notifications || [] })
  } catch (error) {
    console.error('Error getting recent notifications:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// Route: Mark notification as read
app.post('/api/notifications/:id/read', isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params
    
    await supabase
      .from('NotificationLog')
      .update({ is_read: true })
      .eq('id', id)
    
    res.json({ success: true })
  } catch (error) {
    console.error('Error marking notification as read:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// Route: Mark all notifications as read
app.post('/api/notifications/read-all', isAuthenticated, async (req, res) => {
  try {
    await supabase
      .from('NotificationLog')
      .update({ is_read: true })
      .eq('is_read', false)
    
    res.json({ success: true })
  } catch (error) {
    console.error('Error marking all notifications as read:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ============================================
// NOTIFICATION SETTINGS
// ============================================

// Route: Halaman Notification Settings
app.get('/settings/notifications', isAuthenticated, async (req, res) => {
  try {
    const settings = await getNotificationSettings()
    
    const { data: variants } = await supabase
      .from('Varian')
      .select('id, label, kode, produk:Produk(nama)')
      .eq('is_active', true)
      .order('kode', { ascending: true })
    
    const { data: productThresholds } = await supabase
      .from('ProductStockThreshold')
      .select('*')
    
    const thresholdMap = {}
    productThresholds?.forEach(pt => {
      thresholdMap[pt.varian_id] = pt
    })
    
    res.render('settings-notifications', {
      title: `Notification Settings - ${NamaBot}`,
      namaBot: NamaBot,
      username: req.session.username,
      currentPage: 'settings-notifications',
      pageTitle: 'Notification Settings',
      settings: settings,
      variants: variants || [],
      productThresholds: thresholdMap,
      req: req
    })
  } catch (error) {
    console.error('Error loading notification settings:', error)
    res.status(500).send('Error loading notification settings: ' + error.message)
  }
})

// Route: Update Notification Settings
app.post('/api/settings/notifications', isAuthenticated, async (req, res) => {
  try {
    const {
      lowStockEnabled,
      lowStockThreshold,
      largeTransactionEnabled,
      largeTransactionThreshold,
      depositNotificationEnabled,
      stockNotificationEnabled,
      transactionNotificationEnabled,
      soundEnabled,
      browserNotificationsEnabled,
      quietHoursEnabled,
      quietHoursStart,
      quietHoursEnd,
      autoMarkReadEnabled,
      autoMarkReadSeconds,
      notificationFrequency
    } = req.body
    
    console.log('Updating notification settings:', {
      depositNotificationEnabled,
      stockNotificationEnabled,
      transactionNotificationEnabled,
      lowStockEnabled,
      largeTransactionEnabled,
      soundEnabled,
      browserNotificationsEnabled,
      quietHoursEnabled
    })
    
    // Update settings - SELALU update semua, tidak hanya yang undefined
    const updates = []
    
    // Low stock threshold - SELALU update
    updates.push({
      setting_key: 'low_stock_threshold',
      setting_value: {
        default: parseInt(lowStockThreshold) || 10,
        enabled: lowStockEnabled === 'true' || lowStockEnabled === true
      }
    })
    
    // Large transaction threshold - SELALU update
    updates.push({
      setting_key: 'large_transaction_threshold',
      setting_value: {
        amount: parseInt(largeTransactionThreshold) || 1000000,
        enabled: largeTransactionEnabled === 'true' || largeTransactionEnabled === true
      }
    })
    
    // Deposit notification - SELALU update
    updates.push({
      setting_key: 'deposit_notification_enabled',
      setting_value: {
        enabled: depositNotificationEnabled === 'true' || depositNotificationEnabled === true
      }
    })
    
    // Stock notification - SELALU update
    updates.push({
      setting_key: 'stock_notification_enabled',
      setting_value: {
        enabled: stockNotificationEnabled === 'true' || stockNotificationEnabled === true
      }
    })
    
    // Transaction notification - SELALU update
    updates.push({
      setting_key: 'transaction_notification_enabled',
      setting_value: {
        enabled: transactionNotificationEnabled === 'true' || transactionNotificationEnabled === true
      }
    })
    
    // Sound enabled - SELALU update
    updates.push({
      setting_key: 'sound_enabled',
      setting_value: {
        enabled: soundEnabled === 'true' || soundEnabled === true
      }
    })
    
    // Browser notifications - SELALU update
    updates.push({
      setting_key: 'browser_notifications_enabled',
      setting_value: {
        enabled: browserNotificationsEnabled === 'true' || browserNotificationsEnabled === true
      }
    })
    
    // Quiet hours - SELALU update
    updates.push({
      setting_key: 'quiet_hours',
      setting_value: {
        enabled: quietHoursEnabled === 'true' || quietHoursEnabled === true,
        start: quietHoursStart || '22:00',
        end: quietHoursEnd || '08:00'
      }
    })
    
    // Auto mark read - SELALU update
    updates.push({
      setting_key: 'auto_mark_read',
      setting_value: {
        enabled: autoMarkReadEnabled === 'true' || autoMarkReadEnabled === true,
        seconds: parseInt(autoMarkReadSeconds) || 30
      }
    })
    
    // Notification frequency - hanya update jika ada
    if (notificationFrequency !== undefined) {
      updates.push({
        setting_key: 'notification_frequency',
        setting_value: {
          mode: notificationFrequency || 'realtime'
        }
      })
    }
    
    // Upsert settings dengan error handling
    for (const update of updates) {
      const { error } = await supabase
        .from('NotificationSettings')
        .upsert({
          setting_key: update.setting_key,
          setting_value: update.setting_value,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'setting_key'
        })
      
      if (error) {
        console.error(`Error updating ${update.setting_key}:`, error)
      } else {
        console.log(`Successfully updated ${update.setting_key}`)
      }
    }
    
    // Log activity
    // Beri tahu proses bot supaya memuat ulang cache pengaturannya.
    await runtimeSettings.bump()

    await logActivity(req, 'update_notification_settings', 'NotificationSettings', null, {
      updates: updates.map(u => u.setting_key)
    })
    
    res.json({ success: true, message: 'Settings berhasil diupdate!' })
  } catch (error) {
    console.error('Error updating notification settings:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// Route: Update Product Stock Threshold
app.post('/api/settings/notifications/product-threshold', isAuthenticated, async (req, res) => {
  try {
    const { varian_id, threshold, is_active } = req.body
    
    if (!varian_id || threshold === undefined) {
      return res.status(400).json({ success: false, error: 'varian_id dan threshold wajib diisi' })
    }
    
    const { error } = await supabase
      .from('ProductStockThreshold')
      .upsert({
        varian_id: varian_id,
        threshold: parseInt(threshold),
        is_active: is_active === 'true' || is_active === true,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'varian_id'
      })
    
    if (error) throw error
    
    await logActivity(req, 'update_product_threshold', 'ProductStockThreshold', varian_id, {
      threshold: threshold,
      is_active: is_active
    })
    
    res.json({ success: true, message: 'Product threshold berhasil diupdate!' })
  } catch (error) {
    console.error('Error updating product threshold:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// Route: Delete Product Stock Threshold
app.delete('/api/settings/notifications/product-threshold/:varian_id', isAuthenticated, async (req, res) => {
  try {
    const { varian_id } = req.params
    
    const { error } = await supabase
      .from('ProductStockThreshold')
      .delete()
      .eq('varian_id', varian_id)
    
    if (error) throw error
    
    await logActivity(req, 'delete_product_threshold', 'ProductStockThreshold', varian_id)
    
    res.json({ success: true, message: 'Product threshold berhasil dihapus!' })
  } catch (error) {
    console.error('Error deleting product threshold:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ============================================
// GENERAL SETTINGS
// ============================================

// Route: Halaman General Settings
app.get('/settings/general', isAuthenticated, async (req, res) => {
  try {
    const settings = await getGeneralSettings()
    
    // List timezones
    const timezones = [
      { value: 'Asia/Jakarta', label: 'Asia/Jakarta (WIB)' },
      { value: 'Asia/Makassar', label: 'Asia/Makassar (WITA)' },
      { value: 'Asia/Jayapura', label: 'Asia/Jayapura (WIT)' },
      { value: 'UTC', label: 'UTC' }
    ]
    
    // List date formats
    const dateFormats = [
      { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY (31/12/2024)' },
      { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY (12/31/2024)' },
      { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD (2024-12-31)' },
      { value: 'DD-MM-YYYY', label: 'DD-MM-YYYY (31-12-2024)' }
    ]
    
    // List languages
    const languages = [
      { value: 'id', label: 'Bahasa Indonesia' },
      { value: 'en', label: 'English' }
    ]
    
    res.render('settings-general', {
      title: `General Settings - ${NamaBot}`,
      namaBot: NamaBot,
      username: req.session.username,
      currentPage: 'settings-general',
      pageTitle: 'General Settings',
      settings: settings,
      timezones: timezones,
      dateFormats: dateFormats,
      languages: languages,
      req: req
    })
  } catch (error) {
    console.error('Error loading general settings:', error)
    res.status(500).send('Error loading general settings: ' + error.message)
  }
})

// Route: Update General Settings
app.post('/api/settings/general', isAuthenticated, async (req, res) => {
  try {
    const {
      botName,
      botLogo,
      currencySymbol,
      currencyCode,
      currencyPosition,
      timezone,
      dateFormat,
      timeFormat,
      language,
      itemsPerPage,
      autoRefreshEnabled,
      autoRefreshInterval,
      dashboardTheme
    } = req.body
    
    const updates = []
    
    // Bot name tidak diubah dari web — mengikuti NAMA_BOT (nama bot Telegram)
    
    // Bot logo
    updates.push({
      setting_key: 'bot_logo',
      setting_value: { value: botLogo || '' }
    })
    
    // Currency
    updates.push({
      setting_key: 'currency',
      setting_value: {
        symbol: currencySymbol || 'Rp',
        code: currencyCode || 'IDR',
        position: currencyPosition || 'before'
      }
    })
    
    // Timezone
    updates.push({
      setting_key: 'timezone',
      setting_value: { value: timezone || 'Asia/Jakarta' }
    })
    
    // Date format
    updates.push({
      setting_key: 'date_format',
      setting_value: { value: dateFormat || 'DD/MM/YYYY' }
    })
    
    // Time format
    updates.push({
      setting_key: 'time_format',
      setting_value: { value: timeFormat || '24h' }
    })
    
    // Language
    updates.push({
      setting_key: 'language',
      setting_value: { value: language || 'id' }
    })
    
    // Items per page
    updates.push({
      setting_key: 'items_per_page',
      setting_value: { value: parseInt(itemsPerPage) || 20 }
    })
    
    // Auto refresh
    updates.push({
      setting_key: 'auto_refresh',
      setting_value: {
        enabled: autoRefreshEnabled === 'true' || autoRefreshEnabled === true,
        interval: parseInt(autoRefreshInterval) || 30
      }
    })
    
    // Dashboard theme
    updates.push({
      setting_key: 'dashboard_theme',
      setting_value: { value: dashboardTheme || 'light' }
    })
    
    // Upsert settings
    for (const update of updates) {
      const { error } = await supabase
        .from('NotificationSettings')
        .upsert({
          setting_key: update.setting_key,
          setting_value: update.setting_value,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'setting_key'
        })
      
      if (error) {
        console.error(`Error updating ${update.setting_key}:`, error)
      }
    }
    
    // Beri tahu proses bot supaya memuat ulang cache pengaturannya.
    await runtimeSettings.bump()

    await logActivity(req, 'update_general_settings', 'Settings', 'general')
    
    res.json({ success: true, message: 'General settings berhasil disimpan!' })
  } catch (error) {
    console.error('Error updating general settings:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ============================================
// CHANNEL & CONTACT SETTINGS
// ============================================

// Route: Halaman Channel & Contact Settings
app.get('/settings/channel-contact', isAuthenticated, async (req, res) => {
  try {
    const settings = await getChannelContactSettings()
    res.render('settings-channel-contact', {
      title: 'Channel & Contact',
      username: req.session?.username,
      req: req,
      settings,
      currentPage: 'settings-channel-contact',
      pageTitle: 'Channel & Contact'
    })
  } catch (error) {
    console.error('Error loading channel/contact settings:', error)
    res.status(500).send('Error loading channel/contact settings: ' + error.message)
  }
})

app.post('/api/settings/channel-contact', isAuthenticated, async (req, res) => {
  try {
    const { channelLog, channelStore, cs, feedChannel, feedStockEnabled, feedPurchaseEnabled } = req.body
    
    const updates = [
      { setting_key: 'channel_log', setting_value: { value: (channelLog || '').trim() } },
      { setting_key: 'channel_store', setting_value: { value: (channelStore || '').trim() } },
      { setting_key: 'cs', setting_value: { value: (cs || '').trim() } },
      { setting_key: 'feed_channel', setting_value: { value: (feedChannel || '').trim() } },
      { setting_key: 'feed_stock_enabled', setting_value: { value: feedStockEnabled === true || feedStockEnabled === 'true' } },
      { setting_key: 'feed_purchase_enabled', setting_value: { value: feedPurchaseEnabled === true || feedPurchaseEnabled === 'true' } }
    ]
    
    for (const update of updates) {
      const { error } = await supabase
        .from('NotificationSettings')
        .upsert({
          setting_key: update.setting_key,
          setting_value: update.setting_value,
          updated_at: new Date().toISOString()
        }, { onConflict: 'setting_key' })
      
      if (error) {
        console.error(`Error updating ${update.setting_key}:`, error)
        return res.status(500).json({ success: false, error: error.message })
      }
    }
    
    // Beri tahu proses bot supaya memuat ulang cache pengaturannya. Tanpa ini,
    // perubahan channel/CS tidak akan terpakai sampai bot di-restart.
    await runtimeSettings.bump()

    await logActivity(req, 'update_channel_contact_settings', 'Settings', 'channel-contact')
    res.json({ success: true, message: 'Channel & Contact berhasil disimpan!' })
  } catch (error) {
    console.error('Error updating channel/contact settings:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ============================================
// BOT COPY SETTINGS
// ============================================

app.get('/settings/bot-copy', isAuthenticated, async (req, res) => {
  try {
    const kind = String(req.query.kind || '').trim()
    let q = supabase.from('BotCopy').select('*').order('kind').order('key')
    if (['screen', 'msg', 'err', 'btn'].includes(kind)) {
      q = q.eq('kind', kind)
    }
    const { data: rows, error } = await q
    if (error) throw error
    res.render('settings-bot-copy', {
      title: `Bot Copy - ${NamaBot}`,
      namaBot: NamaBot,
      username: req.session.username,
      currentPage: 'settings-bot-copy',
      pageTitle: 'Bot Copy',
      rows: rows || [],
      filterKind: kind || 'all',
      req,
      success: req.query.success || null,
    })
  } catch (e) {
    console.error(e)
    res.status(500).send(e.message)
  }
})

app.post('/settings/bot-copy/:key', isAuthenticated, async (req, res) => {
  try {
    const key = req.params.key
    const body = String(req.body.body ?? '')
    if (!body.trim()) {
      return res.redirect('/settings/bot-copy?error=empty')
    }
    const { error } = await supabase
      .from('BotCopy')
      .update({ body, updated_at: new Date().toISOString() })
      .eq('key', key)
    if (error) throw error
    await runtimeSettings.bump()
    res.redirect('/settings/bot-copy?success=1')
  } catch (e) {
    console.error(e)
    res.status(500).send(e.message)
  }
})

// ============================================
// BOT FLOW SETTINGS
// ============================================

const FLOW_ACTIONS = [
  'product_list', 'product_card', 'kategori_menu', 'stok', 'riwayat', 'deposit_menu', 'noop',
]

async function loadAllCopyByKey() {
  const copyByKey = {}
  const { data: copies } = await supabase.from('BotCopy').select('key, body')
  for (const row of copies || []) copyByKey[row.key] = row.body
  return copyByKey
}

async function loadActiveFlowBundle() {
  const { data: flow, error } = await supabase
    .from('BotFlow')
    .select('*')
    .eq('is_active', true)
    .maybeSingle()
  if (error) throw error
  if (!flow) return { flow: null, nodes: [], copyByKey: {} }
  const { data: nodes, error: nErr } = await supabase
    .from('BotFlowNode')
    .select('*')
    .eq('flow_id', flow.id)
    .order('key')
  if (nErr) throw nErr
  const copyByKey = await loadAllCopyByKey()
  return { flow, nodes: nodes || [], copyByKey }
}

app.get('/settings/bot-flow', isAuthenticated, async (req, res) => {
  try {
    res.render('settings-bot-flow', {
      title: `Bot Flow - ${NamaBot}`,
      namaBot: NamaBot,
      username: req.session.username,
      currentPage: 'settings-bot-flow',
      pageTitle: 'Bot Flow',
      req,
    })
  } catch (e) {
    console.error(e)
    res.status(500).send(e.message)
  }
})

app.get('/api/bot-flow', isAuthenticated, async (req, res) => {
  try {
    const { flow, nodes, copyByKey } = await loadActiveFlowBundle()
    const publishedKeys = nodes.map((n) => n.key)
    const draft = flow?.draft || flowDraft.draftFromPublished(nodes, copyByKey, flow?.entry_key)
    if (flow && !draft.entry_key) draft.entry_key = flow.entry_key || 'welcome'
    const { data: flag } = await supabase
      .from('NotificationSettings')
      .select('setting_value')
      .eq('setting_key', 'flow_engine_enabled')
      .maybeSingle()
    const enabled = !!(flag?.setting_value && flag.setting_value.value === true)
    res.json({
      success: true,
      flow: flow ? {
        id: flow.id,
        name: flow.name,
        entry_key: flow.entry_key,
        draft_updated_at: flow.draft_updated_at,
      } : null,
      publishedKeys,
      draft,
      enabled,
      actions: FLOW_ACTIONS,
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ success: false, error: e.message })
  }
})

app.post('/api/bot-flow/draft', isAuthenticated, async (req, res) => {
  try {
    const { flow, nodes } = await loadActiveFlowBundle()
    if (!flow) throw new Error('No active flow')
    const publishedKeys = nodes.map((n) => n.key)
    const draft = req.body.draft
    const v = flowDraft.validateDraft(draft, publishedKeys)
    if (!v.ok) return res.status(400).json({ success: false, errors: v.errors })
    const { error } = await supabase
      .from('BotFlow')
      .update({ draft, draft_updated_at: new Date().toISOString() })
      .eq('id', flow.id)
    if (error) throw error
    res.json({ success: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ success: false, error: e.message })
  }
})

app.post('/api/bot-flow/preview-step', isAuthenticated, async (req, res) => {
  try {
    const { flow, nodes, copyByKey } = await loadActiveFlowBundle()
    if (!flow) throw new Error('No active flow')
    const draft = req.body.draft || flow.draft || flowDraft.draftFromPublished(nodes, copyByKey, flow.entry_key)
    const vars = req.body.vars || {
      first_name: 'Preview',
      nama_bot: NamaBot,
      user_count: 1,
      stok_terjual: 0,
      stok_tersedia: 0,
      saldo: 'Rp0',
    }

    // Direct preview targets (product card / list filters / qty) — no draft node required
    const preview = req.body.preview
    if (preview && typeof preview === 'object') {
      if (preview.type === 'product' && preview.slug) {
        const produk = await catalog.getProductBySlug(preview.slug)
        return res.json({ success: true, ...flowPreview.buildProductCardView(produk, copyByKey) })
      }
      if (preview.type === 'product_list') {
        const products = await catalog.listProducts({ activeOnly: true, withStock: true })
        return res.json({
          success: true,
          ...flowPreview.buildProductListView(products, {
            page: Number(preview.page) || 0,
            filterKey: preview.filterKey || 'all',
            kategori: preview.kategori || null,
            copyByKey,
          }),
        })
      }
      if (preview.type === 'qty') {
        return res.json({ success: true, ...flowPreview.buildQtyView(preview, copyByKey) })
      }
      if (preview.type === 'deposit_menu') {
        return res.json({ success: true, ...flowPreview.buildDepositMenuView() })
      }
      if (preview.type === 'kategori') {
        const products = await catalog.listProducts({ activeOnly: true, withStock: true })
        return res.json({
          success: true,
          ...flowPreview.buildProductListView(products, {
            page: 0,
            filterKey: 'all',
            kategori: preview.kategori,
            copyByKey,
          }),
        })
      }
      if (preview.type === 'go' && preview.key) {
        // fall through to nodeKey handling below
        req.body.nodeKey = preview.key
      } else if (preview.type === 'stub') {
        return res.json({
          success: true,
          type: 'action',
          action: 'stub',
          caption: `_(Preview)_\n\n${preview.title || 'This step runs in the live bot only.'}`,
          buttons: [[{ text: '🔙 Kembali', go: draft.entry_key || 'welcome' }]],
        })
      }
    }

    const nodeKey = String(req.body.nodeKey || draft.entry_key || 'welcome')
    const node = (draft.nodes || []).find((n) => n.key === nodeKey)
    if (!node) return res.status(404).json({ success: false, error: 'node not found' })

    if (node.kind === 'screen') {
      return res.json({ success: true, ...flowPreview.buildScreenView(node, copyByKey, vars) })
    }

    if (node.kind === 'action') {
      const action = node.action
      if (action === 'product_list') {
        const products = await catalog.listProducts({ activeOnly: true, withStock: true })
        return res.json({
          success: true,
          ...flowPreview.buildProductListView(products, {
            page: Number(req.body.page) || 0,
            filterKey: req.body.filterKey || 'all',
            kategori: req.body.kategori || null,
            copyByKey,
          }),
        })
      }
      if (action === 'kategori_menu') {
        const products = await catalog.listProducts({ activeOnly: true, withStock: true })
        return res.json({ success: true, ...flowPreview.buildKategoriMenuView(products, copyByKey) })
      }
      if (action === 'stok') {
        const products = await catalog.listProducts({ activeOnly: true, withStock: true })
        return res.json({ success: true, ...flowPreview.buildStokView(products) })
      }
      if (action === 'riwayat') {
        return res.json({ success: true, ...flowPreview.buildRiwayatView() })
      }
      if (action === 'deposit_menu') {
        return res.json({ success: true, ...flowPreview.buildDepositMenuView() })
      }
      return res.json({
        success: true,
        type: 'action',
        action,
        key: node.key,
        caption: `Action: ${action}\n\nThis step is not simulated in preview yet.`,
        buttons: [[{ text: '🔙 Kembali', go: draft.entry_key || 'welcome' }]],
      })
    }

    res.status(400).json({ success: false, error: 'unsupported node' })
  } catch (e) {
    console.error(e)
    res.status(500).json({ success: false, error: e.message })
  }
})

app.post('/api/bot-flow/publish', isAuthenticated, async (req, res) => {
  try {
    const { flow, nodes } = await loadActiveFlowBundle()
    if (!flow) throw new Error('No active flow')
    const publishedKeys = nodes.map((n) => n.key)
    const draft = req.body.draft || flow.draft
    if (!draft) throw new Error('No draft to publish')
    const v = flowDraft.validateDraft(draft, publishedKeys)
    if (!v.ok) return res.status(400).json({ success: false, errors: v.errors })
    const plan = flowDraft.publishPlan(draft)
    for (const patch of plan.nodes) {
      const { error } = await supabase
        .from('BotFlowNode')
        .update({
          kind: patch.kind,
          screen_key: patch.screen_key,
          action: patch.action,
          description: patch.description,
          buttons: patch.buttons,
          pos_x: patch.pos_x,
          pos_y: patch.pos_y,
          updated_at: new Date().toISOString(),
        })
        .eq('flow_id', flow.id)
        .eq('key', patch.key)
      if (error) throw error
    }
    for (const c of plan.copies) {
      const { error } = await supabase
        .from('BotCopy')
        .update({ body: c.body, updated_at: new Date().toISOString() })
        .eq('key', c.key)
      if (error) throw error
    }
    await supabase
      .from('BotFlow')
      .update({ draft, draft_updated_at: new Date().toISOString() })
      .eq('id', flow.id)
    await runtimeSettings.bump()
    res.json({ success: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ success: false, error: e.message })
  }
})

app.post('/settings/bot-flow/toggle', isAuthenticated, async (req, res) => {
  try {
    const enabled = req.body.enabled === 'true' || req.body.enabled === true || req.body.enabled === 'on'
    const { error } = await supabase.from('NotificationSettings').upsert({
      setting_key: 'flow_engine_enabled',
      setting_value: { value: !!enabled },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'setting_key' })
    if (error) throw error
    await runtimeSettings.bump()
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.json({ success: true })
    }
    res.redirect('/settings/bot-flow?success=toggle')
  } catch (e) {
    console.error(e)
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(500).json({ success: false, error: e.message })
    }
    res.redirect('/settings/bot-flow?error=' + encodeURIComponent(e.message))
  }
})

// ============================================
// PAYMENT GATEWAY SETTINGS
// ============================================

// Route: Halaman Payment Gateway Settings
app.get('/settings/payment-gateway', isAuthenticated, async (req, res) => {
  try {
    const settings = await getPaymentGatewaySettings()
    
    res.render('settings-payment-gateway', {
      title: `Payment Gateway Settings - ${NamaBot}`,
      namaBot: NamaBot,
      username: req.session.username,
      currentPage: 'settings-payment-gateway',
      pageTitle: 'Payment Gateway Settings',
      settings: settings,
      req: req
    })
  } catch (error) {
    console.error('Error loading payment gateway settings:', error)
    res.status(500).send('Error loading payment gateway settings: ' + error.message)
  }
})

// Route: Update Payment Gateway Settings
app.post('/api/settings/payment-gateway', isAuthenticated, async (req, res) => {
  try {
    const {
      enabled,
      project,
      apiKey,
      baseUrl,
      paymentTimeout,
      qrisEnabled,
      saldoEnabled
    } = req.body
    
    const updates = []
    
    // Payment gateway enabled
    updates.push({
      setting_key: 'payment_gateway_enabled',
      setting_value: { value: enabled === 'true' || enabled === true }
    })
    
    // API Key
    updates.push({
      setting_key: 'payment_gateway_api_key',
      setting_value: { value: apiKey || '' }
    })
    
    // Project Slug
    updates.push({
      setting_key: 'payment_gateway_project',
      setting_value: { value: project || '' }
    })
    
    // Base URL
    updates.push({
      setting_key: 'payment_gateway_base_url',
      setting_value: { value: baseUrl || 'https://app.pakasir.com' }
    })
    
    // Payment Timeout
    updates.push({
      setting_key: 'payment_gateway_timeout',
      setting_value: { value: parseInt(paymentTimeout) || 10 }
    })
    
    // QRIS Enabled
    updates.push({
      setting_key: 'payment_gateway_qris_enabled',
      setting_value: { value: qrisEnabled === 'true' || qrisEnabled === true }
    })
    
    // Saldo Enabled
    updates.push({
      setting_key: 'payment_gateway_saldo_enabled',
      setting_value: { value: saldoEnabled === 'true' || saldoEnabled === true }
    })
    
    // Upsert settings
    for (const update of updates) {
      const { error } = await supabase
        .from('NotificationSettings')
        .upsert({
          setting_key: update.setting_key,
          setting_value: update.setting_value,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'setting_key'
        })
      
      if (error) {
        console.error(`Error updating ${update.setting_key}:`, error)
      }
    }
    
    // Beri tahu proses bot supaya memuat ulang cache pengaturannya.
    await runtimeSettings.bump()

    await logActivity(req, 'update_payment_gateway_settings', 'Settings', 'payment-gateway')
    
    res.json({ success: true, message: 'Payment gateway settings berhasil disimpan!' })
  } catch (error) {
    console.error('Error updating payment gateway settings:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ============================================
// SUPABASE DATABASE SETTINGS
// ============================================

// Route: Halaman Supabase Database Settings
app.get('/settings/supabase', isAuthenticated, async (req, res) => {
  try {
    const settings = await getSupabaseSettings()
    
    res.render('settings-supabase', {
      title: `Supabase Database Settings - ${NamaBot}`,
      namaBot: NamaBot,
      username: req.session.username,
      currentPage: 'settings-supabase',
      pageTitle: 'Supabase Database Settings',
      settings: settings,
      req: req
    })
  } catch (error) {
    console.error('Error loading Supabase settings:', error)
    res.status(500).send('Error loading Supabase settings: ' + error.message)
  }
})

// Route: Update Supabase Database Settings
app.post('/api/settings/supabase', isAuthenticated, async (req, res) => {
  try {
    const {
      url,
      key,
      serviceKey,
      enabled,
      connectionTimeout,
      retryAttempts,
      retryDelay
    } = req.body
    
    const updates = []
    
    // Supabase URL
    updates.push({
      setting_key: 'supabase_url',
      setting_value: { value: url || '' }
    })
    
    // Supabase Key
    updates.push({
      setting_key: 'supabase_key',
      setting_value: { value: key || '' }
    })
    
    // Supabase Service Key (opsional)
    updates.push({
      setting_key: 'supabase_service_key',
      setting_value: { value: serviceKey || '' }
    })
    
    // Supabase Enabled
    updates.push({
      setting_key: 'supabase_enabled',
      setting_value: { value: enabled === 'true' || enabled === true }
    })
    
    // Connection Timeout
    updates.push({
      setting_key: 'supabase_connection_timeout',
      setting_value: { value: parseInt(connectionTimeout) || 30 }
    })
    
    // Retry Attempts
    updates.push({
      setting_key: 'supabase_retry_attempts',
      setting_value: { value: parseInt(retryAttempts) || 3 }
    })
    
    // Retry Delay
    updates.push({
      setting_key: 'supabase_retry_delay',
      setting_value: { value: parseInt(retryDelay) || 1000 }
    })
    
    // Upsert settings
    for (const update of updates) {
      const { error } = await supabase
        .from('NotificationSettings')
        .upsert({
          setting_key: update.setting_key,
          setting_value: update.setting_value,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'setting_key'
        })
      
      if (error) {
        console.error(`Error updating ${update.setting_key}:`, error)
      }
    }
    
    // Beri tahu proses bot supaya memuat ulang cache pengaturannya.
    await runtimeSettings.bump()

    await logActivity(req, 'update_supabase_settings', 'Settings', 'supabase-database')
    
    res.json({ success: true, message: 'Supabase database settings berhasil disimpan!' })
  } catch (error) {
    console.error('Error updating Supabase settings:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// Route: Test Supabase Connection
app.post('/api/settings/supabase/test', isAuthenticated, async (req, res) => {
  try {
    const { url, key } = req.body
    
    if (!url || !key) {
      return res.status(400).json({ 
        success: false, 
        error: 'URL dan API Key harus diisi' 
      })
    }
    
    // Create temporary Supabase client untuk test
    const { createClient } = require('@supabase/supabase-js')
    const testClient = createClient(url, key)
    
    // Test connection dengan query sederhana
    const { data, error } = await testClient
      .from('NotificationSettings')
      .select('setting_key')
      .limit(1)
    
    if (error) {
      console.error('Supabase connection test error:', error)
      return res.json({ 
        success: false, 
        error: `Koneksi gagal: ${error.message}` 
      })
    }
    
    res.json({ 
      success: true, 
      message: 'Koneksi ke Supabase berhasil!' 
    })
  } catch (error) {
    console.error('Error testing Supabase connection:', error)
    res.status(500).json({ 
      success: false, 
      error: `Terjadi kesalahan: ${error.message}` 
    })
  }
})

// Scheduled task: Check alerts setiap 5 menit
const cron = require('node-cron')
cron.schedule('*/5 * * * *', async () => {
  await Promise.all([
    checkDepositPending(),
    checkLowStockAlerts()
  ])
})

// ============================================
// BULK OPERATIONS - FILE UPLOAD
// ============================================

const multer = require('multer')
const XLSX = require('xlsx')
const csv = require('csv-parser')

// Configure multer untuk file upload
const uploadDir = path.join(__dirname, 'uploads')
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true })
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir)
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    cb(null, 'bulk-' + uniqueSuffix + path.extname(file.originalname))
  }
})

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.csv', '.xlsx', '.xls']
    const ext = path.extname(file.originalname).toLowerCase()
    if (allowedTypes.includes(ext)) {
      cb(null, true)
    } else {
      cb(new Error('File type tidak didukung. Gunakan CSV atau Excel (.xlsx, .xls)'))
    }
  }
})

// Helper: Parse CSV file
function parseCSV(filePath) {
  return new Promise((resolve, reject) => {
    const results = []
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', () => resolve(results))
      .on('error', reject)
  })
}

// Helper: Parse Excel file
function parseExcel(filePath) {
  const workbook = XLSX.readFile(filePath)
  const sheetName = workbook.SheetNames[0]
  const worksheet = workbook.Sheets[sheetName]
  return XLSX.utils.sheet_to_json(worksheet)
}

// Helper: Clean up uploaded file
function cleanupFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
  } catch (error) {
    console.error('Error cleaning up file:', error)
  }
}

// ============================================
// ROUTE: BULK OPERATIONS
// ============================================

// Route: Halaman Bulk Operations
app.get('/bulk', isAuthenticated, (req, res) => {
  res.render('bulk-operations', {
    title: `Bulk Operations - ${NamaBot}`,
    namaBot: NamaBot,
    username: req.session.username,
    currentPage: 'bulk',
    pageTitle: 'Bulk Operations',
    req: req
  })
})

// Route: API - Get Produk List (untuk bulk operations)
app.get('/api/produk/list', isAuthenticated, async (req, res) => {
  try {
    const list = await catalog.listProducts({ activeOnly: false, withStock: false })
    const products = list.map((p) => ({
      id: p.id,
      nama: p.nama,
      slug: p.slug,
      variants: (p.variants || []).map((v) => ({
        id: v.id,
        label: v.label,
        kode: v.kode,
        harga: v.harga,
      })),
    }))

    res.json({ success: true, products })
  } catch (error) {
    console.error('Error getting produk list:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// Route: API - Get Pending Deposits (untuk bulk operations)
app.get('/api/deposit/pending', isAuthenticated, async (req, res) => {
  try {
    const { data: deposits, error } = await supabase
      .from('Deposit')
      .select('*')
      .eq('status', 'pending')
      .order('tanggal', { ascending: false })
    
    if (error) throw error
    
    res.json({ success: true, deposits: deposits || [] })
  } catch (error) {
    console.error('Error getting pending deposits:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// Route: Bulk Import Produk
app.post('/bulk/produk/import', isAuthenticated, upload.single('file'), async (req, res) => {
  let filePath = null
  try {
    if (!req.file) {
      return res.json({ success: false, error: 'File tidak ditemukan' })
    }

    filePath = req.file.path
    const fileExt = path.extname(req.file.originalname).toLowerCase()
    
    // Parse file
    let data = []
    if (fileExt === '.csv') {
      data = await parseCSV(filePath)
    } else if (fileExt === '.xlsx' || fileExt === '.xls') {
      data = await parseExcel(filePath)
    } else {
      cleanupFile(filePath)
      return res.json({ success: false, error: 'Format file tidak didukung' })
    }

    if (!data || data.length === 0) {
      cleanupFile(filePath)
      return res.json({ success: false, error: 'File kosong atau tidak valid' })
    }

    const { products, failures } = bulk.groupCatalogRows(data)
    const results = {
      success: [],
      failed: failures.map((f) => ({ row: f.row, error: f.error })),
      skipped: [],
    }

    for (const product of products) {
      try {
        const { data: existingProduk } = await supabase
          .from('Produk')
          .select('id, slug')
          .eq('slug', product.slug)
          .maybeSingle()

        let produkId = existingProduk?.id || null

        if (!produkId) {
          const { data: created, error: createErr } = await supabase
            .from('Produk')
            .insert([{
              nama: product.nama,
              slug: product.slug,
              kategori: product.kategori,
              deskripsi: product.deskripsi,
              snk: product.snk,
              is_active: true,
              urutan: 0,
            }])
            .select('id')
            .single()
          if (createErr) {
            results.failed.push({ row: null, error: `Produk ${product.slug}: ${createErr.message}` })
            continue
          }
          produkId = created.id
          await logActivity(req, 'BULK_IMPORT_PRODUK', 'Produk', produkId, { slug: product.slug, nama: product.nama })
        }

        for (const varian of product.variants) {
          const { data: existingVar } = await supabase
            .from('Varian')
            .select('id, kode')
            .eq('kode', varian.kode)
            .maybeSingle()

          if (existingVar) {
            results.skipped.push({ kode: varian.kode, reason: 'varian_kode sudah ada' })
            continue
          }

          const { count } = await supabase
            .from('Varian')
            .select('*', { count: 'exact', head: true })
            .eq('produk_id', produkId)

          const { data: newVar, error: varErr } = await supabase
            .from('Varian')
            .insert([{
              produk_id: produkId,
              label: varian.label,
              kode: varian.kode,
              harga: varian.harga,
              format: varian.format,
              is_active: true,
              urutan: count || 0,
              terjual: 0,
            }])
            .select('id, kode')
            .single()

          if (varErr) {
            results.failed.push({ kode: varian.kode, error: varErr.message })
          } else {
            results.success.push({ produk_id: produkId, varian_id: newVar.id, kode: newVar.kode })
            await logActivity(req, 'BULK_IMPORT_VARIAN', 'Varian', newVar.id, { kode: newVar.kode })
          }
        }
      } catch (error) {
        results.failed.push({ slug: product.slug, error: error.message })
      }
    }

    cleanupFile(filePath)

    res.json({
      success: true,
      results: {
        total: data.length,
        success: results.success.length,
        failed: results.failed.length,
        skipped: results.skipped.length,
        details: results,
      },
    })
  } catch (error) {
    if (filePath) cleanupFile(filePath)
    console.error('Error bulk importing products:', error)
    res.json({ success: false, error: error.message })
  }
})

// Route: Download Template Import Produk
app.get('/bulk/produk/template', isAuthenticated, (req, res) => {
  const csvContent = `produk_nama,produk_slug,kategori,deskripsi,snk,varian_label,varian_kode,harga,format
Netflix,netflix,streaming,Akun Netflix,S&K berlaku,7 Hari,netflix-7d,15000,Email:Password
Netflix,netflix,streaming,Akun Netflix,S&K berlaku,1 Bulan,netflix-1b,45000,Email:Password
Spotify Solo,spotify-solo,streaming,Akun Spotify,S&K berlaku,Default,spotify-solo,25000,Email:Password
`

  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', 'attachment; filename=template-import-katalog.csv')
  res.send('\ufeff' + csvContent)
})

app.get('/bulk/tiers/template', isAuthenticated, (req, res) => {
  const csvContent = `varian_kode,min_qty,harga
netflix-7d,5,12000
netflix-7d,10,10000
`

  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', 'attachment; filename=template-import-tiers.csv')
  res.send('\ufeff' + csvContent)
})

// Route: Bulk Update Harga Varian
app.post('/bulk/produk/update-harga', isAuthenticated, async (req, res) => {
  try {
    const { varian_ids, update_type, value } = req.body

    if (!varian_ids || !Array.isArray(varian_ids) || varian_ids.length === 0) {
      return res.json({ success: false, error: 'Pilih minimal 1 varian' })
    }

    if (!update_type || value === undefined || value === null || value === '') {
      return res.json({ success: false, error: 'Tipe update dan nilai wajib diisi' })
    }

    const valueNum = parseFloat(value)
    if (isNaN(valueNum)) {
      return res.json({ success: false, error: 'Nilai tidak valid' })
    }

    const { data: variants, error: fetchError } = await supabase
      .from('Varian')
      .select('id, label, kode, harga, produk_id')
      .in('id', varian_ids)

    if (fetchError) throw fetchError

    const results = {
      success: [],
      failed: [],
    }

    for (const variant of variants || []) {
      const computed = bulk.computeNewHarga(variant.harga, update_type, valueNum)
      if (!computed.ok) {
        results.failed.push({ varian_id: variant.id, error: computed.error })
        continue
      }

      const { error: updateError } = await supabase
        .from('Varian')
        .update({ harga: computed.harga })
        .eq('id', variant.id)

      if (updateError) {
        results.failed.push({ varian_id: variant.id, error: updateError.message })
      } else {
        results.success.push({
          varian_id: variant.id,
          kode: variant.kode,
          label: variant.label,
          harga_lama: variant.harga,
          harga_baru: computed.harga,
        })
        await logActivity(req, 'BULK_UPDATE_HARGA', 'Varian', variant.id, {
          kode: variant.kode,
          harga_lama: variant.harga,
          harga_baru: computed.harga,
          update_type,
        })
      }
    }

    res.json({
      success: true,
      results: {
        total: (variants || []).length,
        success: results.success.length,
        failed: results.failed.length,
        details: results,
      },
    })
  } catch (error) {
    console.error('Error bulk updating prices:', error)
    res.json({ success: false, error: error.message })
  }
})

app.post('/bulk/tiers/import', isAuthenticated, upload.single('file'), async (req, res) => {
  let filePath = null
  try {
    if (!req.file) return res.json({ success: false, error: 'File tidak ditemukan' })

    filePath = req.file.path
    const fileExt = path.extname(req.file.originalname).toLowerCase()
    let data = []
    if (fileExt === '.csv') data = await parseCSV(filePath)
    else if (fileExt === '.xlsx' || fileExt === '.xls') data = await parseExcel(filePath)
    else {
      cleanupFile(filePath)
      return res.json({ success: false, error: 'Format file tidak didukung' })
    }

    const results = { success: [], failed: [] }
    for (let i = 0; i < data.length; i++) {
      const rowNum = i + 2
      const norm = bulk.normalizeTierRow(data[i])
      if (!norm.ok) {
        results.failed.push({ row: rowNum, error: norm.error })
        continue
      }
      const { varian_kode, min_qty, harga } = norm.value
      const { data: varian } = await supabase
        .from('Varian')
        .select('id, kode')
        .eq('kode', varian_kode)
        .maybeSingle()
      if (!varian) {
        results.failed.push({ row: rowNum, error: `varian tidak ditemukan: ${varian_kode}` })
        continue
      }

      const { data: existing } = await supabase
        .from('HargaTier')
        .select('id')
        .eq('varian_id', varian.id)
        .eq('min_qty', min_qty)
        .maybeSingle()

      if (existing) {
        const { error } = await supabase
          .from('HargaTier')
          .update({ harga })
          .eq('id', existing.id)
        if (error) results.failed.push({ row: rowNum, error: error.message })
        else results.success.push({ row: rowNum, action: 'update', varian_kode, min_qty, harga })
      } else {
        const { error } = await supabase
          .from('HargaTier')
          .insert([{ varian_id: varian.id, min_qty, harga }])
        if (error) results.failed.push({ row: rowNum, error: error.message })
        else results.success.push({ row: rowNum, action: 'insert', varian_kode, min_qty, harga })
      }
    }

    cleanupFile(filePath)
    res.json({
      success: true,
      results: {
        total: data.length,
        success: results.success.length,
        failed: results.failed.length,
        details: results,
      },
    })
  } catch (error) {
    if (filePath) cleanupFile(filePath)
    console.error('Error bulk importing tiers:', error)
    res.json({ success: false, error: error.message })
  }
})

// Route: Bulk Tambah Stok
app.post('/bulk/stok/tambah', isAuthenticated, async (req, res) => {
  try {
    const { varian_id, data_stok } = req.body

    if (!varian_id || !data_stok) {
      return res.json({ success: false, error: 'Varian ID dan data stok wajib diisi' })
    }

    const { data: varian, error: varianError } = await supabase
      .from('Varian')
      .select('*, produk:Produk(*)')
      .eq('id', varian_id)
      .single()

    if (varianError || !varian) {
      return res.json({ success: false, error: 'Varian tidak ditemukan' })
    }

    const produk = varian.produk || { nama: 'Produk' }

    const dataArray = bulk.parseStockLines(data_stok)

    if (dataArray.length === 0) {
      return res.json({ success: false, error: 'Tidak ada data stok yang valid' })
    }

    const stokItems = dataArray.map((data) => ({
      varian_id: varian.id,
      varian_kode: String(varian.kode).toLowerCase(),
      data: data.trim(),
      status: 'tersedia',
    }))

    const batchSize = 500
    let successCount = 0
    let failedCount = 0
    const errors = []

    for (let i = 0; i < stokItems.length; i += batchSize) {
      const batch = stokItems.slice(i, i + batchSize)
      const { error: insertError } = await supabase.from('Stok').insert(batch)

      if (insertError) {
        failedCount += batch.length
        errors.push({
          batch: Math.floor(i / batchSize) + 1,
          error: insertError.message,
        })
      } else {
        successCount += batch.length
      }
    }

    await logActivity(req, 'BULK_ADD_STOK', 'Stok', varian_id, {
      produk_nama: produk.nama,
      varian_kode: varian.kode,
      jumlah: successCount,
    })

    if (successCount > 0) {
      const totalStok = await stock.getStokCountByVarianId(varian.id)
      const formattedPrice = formatrupiah(varian.harga)
      await sendFeedMessage(
        `📢 ${successCount} new stock added for ${produk.nama} (${varian.label})!\n\n` +
          `✨ Available: ${totalStok} items\n` +
          `🪙 Price: ${formattedPrice}`,
        'stock'
      ).catch((err) => console.error('Error sending stock feed message:', err))
    }

    res.json({
      success: true,
      results: {
        total: dataArray.length,
        success: successCount,
        failed: failedCount,
        errors: errors,
      },
    })
  } catch (error) {
    console.error('Error bulk adding stock:', error)
    res.json({ success: false, error: error.message })
  }
})

// Route: Bulk Approve Deposit
app.post('/bulk/deposit/approve', isAuthenticated, async (req, res) => {
  try {
    const { deposit_ids } = req.body

    if (!deposit_ids || !Array.isArray(deposit_ids) || deposit_ids.length === 0) {
      return res.json({ success: false, error: 'Pilih minimal 1 deposit' })
    }

    // Ambil deposits
    const { data: deposits, error: fetchError } = await supabase
      .from('Deposit')
      .select('*')
      .in('id', deposit_ids)
      .eq('status', 'pending')

    if (fetchError) throw fetchError

    const results = {
      success: [],
      failed: []
    }

    for (const deposit of deposits) {
      try {
        // Update status deposit
        const { error: updateError } = await supabase
          .from('Deposit')
          .update({
            status: 'success',
            updated_at: new Date().toISOString()
          })
          .eq('id', deposit.id)

        if (updateError) {
          results.failed.push({
            deposit_id: deposit.id,
            error: updateError.message
          })
          continue
        }

        // Update saldo user
        const { data: user, error: userError } = await supabase
          .from('User')
          .select('saldo')
          .eq('id', deposit.user_id)
          .single()

        if (userError || !user) {
          // Rollback deposit status
          await supabase
            .from('Deposit')
            .update({ status: 'pending' })
            .eq('id', deposit.id)
          
          results.failed.push({
            deposit_id: deposit.id,
            error: 'User tidak ditemukan'
          })
          continue
        }

        const saldoBaru = (user.saldo || 0) + deposit.jumlah
        
        const { error: saldoError } = await supabase
          .from('User')
          .update({ saldo: saldoBaru })
          .eq('id', deposit.user_id)

        if (saldoError) {
          // Rollback deposit status
          await supabase
            .from('Deposit')
            .update({ status: 'pending' })
            .eq('id', deposit.id)
          
          results.failed.push({
            deposit_id: deposit.id,
            error: saldoError.message
          })
        } else {
          results.success.push({
            deposit_id: deposit.id,
            user_id: deposit.user_id,
            jumlah: deposit.jumlah
          })
          await logActivity(req, 'BULK_APPROVE_DEPOSIT', 'Deposit', deposit.id, {
            user_id: deposit.user_id,
            jumlah: deposit.jumlah
          })
        }
      } catch (error) {
        results.failed.push({
          deposit_id: deposit.id,
          error: error.message
        })
      }
    }

    // Trigger notification check
    await checkDepositPending()

    res.json({
      success: true,
      results: {
        total: deposits.length,
        success: results.success.length,
        failed: results.failed.length,
        details: {
          success: results.success,
          failed: results.failed
        }
      }
    })
  } catch (error) {
    console.error('Error bulk approving deposits:', error)
    res.json({ success: false, error: error.message })
  }
})

// Route: Bulk Reject Deposit
app.post('/bulk/deposit/reject', isAuthenticated, async (req, res) => {
  try {
    const { deposit_ids, alasan } = req.body

    if (!deposit_ids || !Array.isArray(deposit_ids) || deposit_ids.length === 0) {
      return res.json({ success: false, error: 'Pilih minimal 1 deposit' })
    }

    const { data: deposits, error: fetchError } = await supabase
      .from('Deposit')
      .select('*')
      .in('id', deposit_ids)
      .eq('status', 'pending')

    if (fetchError) throw fetchError

    const results = {
      success: [],
      failed: []
    }

    for (const deposit of deposits) {
      try {
        const { error: updateError } = await supabase
          .from('Deposit')
          .update({
            status: 'failed',
            updated_at: new Date().toISOString()
          })
          .eq('id', deposit.id)

        if (updateError) {
          results.failed.push({
            deposit_id: deposit.id,
            error: updateError.message
          })
        } else {
          results.success.push({
            deposit_id: deposit.id,
            user_id: deposit.user_id
          })
          await logActivity(req, 'BULK_REJECT_DEPOSIT', 'Deposit', deposit.id, {
            user_id: deposit.user_id,
            alasan: alasan || 'Bulk reject'
          })
        }
      } catch (error) {
        results.failed.push({
          deposit_id: deposit.id,
          error: error.message
        })
      }
    }

    // Trigger notification check
    await checkDepositPending()

    res.json({
      success: true,
      results: {
        total: deposits.length,
        success: results.success.length,
        failed: results.failed.length,
        details: {
          success: results.success,
          failed: results.failed
        }
      }
    })
  } catch (error) {
    console.error('Error bulk rejecting deposits:', error)
    res.json({ success: false, error: error.message })
  }
})

// Route: Bulk Export Data
app.get('/bulk/export', isAuthenticated, async (req, res) => {
  try {
    const { export_type, format } = req.query // format: 'csv', 'excel', 'json'

    let data = []
    let filename = ''
    let headers = []

    switch (export_type) {
      case 'produk': {
        const list = await catalog.listProducts({ activeOnly: false, withStock: false })
        data = []
        for (const p of list) {
          for (const v of p.variants || []) {
            data.push({
              produk_nama: p.nama,
              produk_slug: p.slug,
              kategori: p.kategori,
              deskripsi: p.deskripsi,
              snk: p.snk,
              varian_label: v.label,
              varian_kode: v.kode,
              harga: v.harga,
              format: v.format || '',
            })
          }
        }
        filename = 'katalog'
        headers = [
          'produk_nama', 'produk_slug', 'kategori', 'deskripsi', 'snk',
          'varian_label', 'varian_kode', 'harga', 'format',
        ]
        break
      }

      case 'user':
        const { data: users } = await supabase
          .from('User')
          .select('*')
          .order('created_at', { ascending: false })
        
        data = users || []
        filename = 'user'
        headers = ['ID', 'Jumlah Transaksi', 'Pengeluaran', 'Saldo', 'Created At']
        break

      case 'transaksi':
        const { data: transactions } = await supabase
          .from('Trx')
          .select('*')
          .order('tanggal', { ascending: false })
        
        data = transactions || []
        filename = 'transaksi'
        headers = ['Tanggal', 'User ID', 'Produk', 'Kode', 'Jumlah', 'Harga', 'Trx ID']
        break

      case 'deposit':
        const { data: deposits } = await supabase
          .from('Deposit')
          .select('*')
          .order('tanggal', { ascending: false })
        
        data = deposits || []
        filename = 'deposit'
        headers = ['Tanggal', 'User ID', 'Kode Deposit', 'Jumlah', 'Fee', 'Total', 'Status', 'Metode']
        break

      default:
        return res.status(400).send('Export type tidak valid')
    }

    if (format === 'csv') {
      // Generate CSV
      let csvContent = headers.join(',') + '\n'
      
      data.forEach(item => {
        const row = []
        switch (export_type) {
          case 'produk':
            row.push(
              `"${(item.produk_nama || '').replace(/"/g, '""')}"`,
              `"${(item.produk_slug || '').replace(/"/g, '""')}"`,
              `"${(item.kategori || '').replace(/"/g, '""')}"`,
              `"${(item.deskripsi || '').replace(/"/g, '""')}"`,
              `"${(item.snk || '').replace(/"/g, '""')}"`,
              `"${(item.varian_label || '').replace(/"/g, '""')}"`,
              `"${(item.varian_kode || '').replace(/"/g, '""')}"`,
              item.harga || 0,
              `"${(item.format || '').replace(/"/g, '""')}"`
            )
            break
          case 'user':
            row.push(
              item.id,
              item.jumlahtransaksi || 0,
              item.pengeluaran || 0,
              item.saldo || 0,
              moment.tz(item.created_at, 'Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss')
            )
            break
          case 'transaksi':
            row.push(
              moment.tz(item.tanggal, 'Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss'),
              item.id,
              `"${(item.nama || '').replace(/"/g, '""')}"`,
              `"${(item.kode || '').replace(/"/g, '""')}"`,
              item.jumlah || 0,
              item.harga || 0,
              `"${(item.trxid || '').replace(/"/g, '""')}"`
            )
            break
          case 'deposit':
            row.push(
              moment.tz(item.tanggal, 'Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss'),
              item.user_id,
              `"${(item.kode_deposit || '').replace(/"/g, '""')}"`,
              item.jumlah || 0,
              item.fee || 0,
              item.total || 0,
              `"${item.status}"`,
              `"${item.metode}"`
            )
            break
        }
        csvContent += row.join(',') + '\n'
      })

      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename=${filename}-${moment.tz('Asia/Jakarta').format('YYYY-MM-DD')}.csv`)
      res.send('\ufeff' + csvContent)
    } else if (format === 'excel') {
      // Generate Excel
      const worksheet = XLSX.utils.json_to_sheet(data)
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Data')
      
      const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      res.setHeader('Content-Disposition', `attachment; filename=${filename}-${moment.tz('Asia/Jakarta').format('YYYY-MM-DD')}.xlsx`)
      res.send(excelBuffer)
    } else if (format === 'json') {
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Content-Disposition', `attachment; filename=${filename}-${moment.tz('Asia/Jakarta').format('YYYY-MM-DD')}.json`)
      res.json(data)
    } else {
      res.status(400).send('Format tidak didukung')
    }
  } catch (error) {
    console.error('Error bulk exporting:', error)
    res.status(500).send('Error bulk exporting: ' + error.message)
  }
})

// Start server
const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`📊 Dashboard berjalan di http://localhost:${PORT}`)
  console.log(`🔔 Real-time notifications enabled`)
  console.log(`⚡ Bulk operations enabled`)
})

