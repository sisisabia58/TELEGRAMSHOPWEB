/**
 * In-dashboard E2E flow preview helpers (no Telegram).
 * Resolves BotCopy labels and simulates catalog/action screens.
 */
const copyLib = require('./copy')
const { formatrupiah } = require('./format')

const PRODUCTS_PER_PAGE = 10

const KATEGORI_LIST = ['game', 'streaming', 'software', 'social media', 'voucher', 'education', 'umum']

const KATEGORI_EMOJI = {
  game: '🎮',
  streaming: '📺',
  software: '💻',
  'social media': '📱',
  voucher: '🎟️',
  education: '📚',
  umum: '📦',
}

const KATEGORI_NAME = {
  game: 'Game',
  streaming: 'Streaming',
  software: 'Software',
  'social media': 'Social Media',
  voucher: 'Voucher',
  education: 'Education',
  umum: 'Umum',
}

function resolveCopy(key, copyByKey, vars) {
  const map = copyByKey || {}
  const body = (map[key] !== undefined && map[key] !== null && map[key] !== '')
    ? map[key]
    : copyLib.DEFAULTS[key]
  if (body === undefined) return String(key)
  return copyLib.render(body, vars)
}

function buttonText(btn, copyByKey, vars) {
  if (!btn || typeof btn !== 'object') return '•'
  if (btn.label_key) return resolveCopy(btn.label_key, copyByKey, vars)
  if (btn.label) return String(btn.label)
  return '•'
}

/**
 * Resolve draft/node buttons into preview keyboard rows with `text` + nav hints.
 */
function resolveButtons(buttons, copyByKey, vars) {
  const out = []
  for (const row of buttons || []) {
    if (!Array.isArray(row)) continue
    const built = []
    for (const btn of row) {
      if (!btn || typeof btn !== 'object') continue
      const text = buttonText(btn, copyByKey, vars)
      const item = { text }
      if (btn.go) {
        item.go = btn.go
      } else if (btn.callback) {
        item.callback = String(btn.callback)
        item.preview = mapCallbackPreview(btn.callback)
      } else if (btn.url_from) {
        item.url_from = btn.url_from
        item.kind = 'link'
      } else if (btn.url) {
        item.url = btn.url
        item.kind = 'link'
      }
      built.push(item)
    }
    if (built.length) out.push(built)
  }
  return out
}

function mapCallbackPreview(callback) {
  const cb = String(callback || '')
  if (cb === 'deposit_menu') return { type: 'deposit_menu' }
  if (cb === 'riwayatdeposit') return { type: 'stub', title: 'Riwayat deposit (live bot only)' }
  if (cb === 'daftarproduk') return { type: 'action', action: 'product_list' }
  if (cb === 'kembaliawal') return { type: 'go', key: 'welcome' }
  if (cb.startsWith('kategori_')) return { type: 'kategori', kategori: cb.slice('kategori_'.length) }
  if (cb.startsWith('p:')) return { type: 'product', slug: cb.slice(2) }
  if (cb.startsWith('produk_prev:') || cb.startsWith('produk_next:')) {
    const [, rest] = cb.split(':')
    const [pageStr, filterKey] = (rest || '0_all').split('_')
    const page = parseInt(pageStr, 10)
    const delta = cb.startsWith('produk_prev:') ? -1 : 1
    return {
      type: 'product_list',
      page: Number.isFinite(page) ? page + delta : 0,
      filterKey: filterKey || 'all',
    }
  }
  if (cb === 'produk_filter_bestseller') {
    return { type: 'product_list', page: 0, filterKey: 'bestseller' }
  }
  if (cb.startsWith('v:')) return { type: 'stub', title: `Pilih varian ${cb.slice(2)}` }
  return { type: 'stub', title: cb }
}

function productStock(p) {
  if (p.stok_count !== undefined) return p.stok_count
  return (p.variants || []).reduce((s, v) => s + (v.stok_count || 0), 0)
}

function productTerjual(p) {
  return (p.variants || []).reduce((s, v) => s + (v.terjual || 0), 0)
}

function buildProductListView(products, { page = 0, filterKey = 'all', kategori = null, copyByKey } = {}) {
  let list = [...(products || [])].map((p) => ({
    ...p,
    stok_count: productStock(p),
  }))

  if (kategori) {
    list = list.filter((p) => (p.kategori || 'umum').toLowerCase() === String(kategori).toLowerCase())
  }

  if (filterKey === 'bestseller') {
    list.sort((a, b) => productTerjual(b) - productTerjual(a))
  } else {
    list.sort((a, b) => (a.urutan || 0) - (b.urutan || 0) || String(a.nama).localeCompare(String(b.nama)))
  }

  const totalPages = Math.max(1, Math.ceil(list.length / PRODUCTS_PER_PAGE))
  const safePage = Math.min(Math.max(0, page), totalPages - 1)
  const start = safePage * PRODUCTS_PER_PAGE
  const items = list.slice(start, start + PRODUCTS_PER_PAGE)

  let rows = ''
  if (!items.length) {
    rows = '📭 *Tidak ada produk*'
  } else {
    items.forEach((p, idx) => {
      rows += `[${start + idx + 1}]. ${String(p.nama).toUpperCase()} ( ${p.stok_count} )\n`
    })
    rows += `\n📄 Halaman ${safePage + 1} / ${totalPages}`
  }

  const caption = resolveCopy('screen.product_list', copyByKey, { rows })
  const buttons = []

  if (!items.length) {
    buttons.push([
      { text: '🔄 Reset Filter', preview: { type: 'product_list', page: 0, filterKey: 'all' } },
      { text: '🔙 Kembali', go: 'welcome' },
    ])
  } else {
    let entryRow = []
    items.forEach((p, idx) => {
      if (p.stok_count === 0) return
      const itemNum = start + idx + 1
      entryRow.push({
        text: `${itemNum}. ${p.nama}`,
        preview: { type: 'product', slug: p.slug },
      })
      if (entryRow.length === 2) {
        buttons.push(entryRow)
        entryRow = []
      }
    })
    if (entryRow.length) buttons.push(entryRow)

    const nav = []
    if (safePage > 0) {
      nav.push({
        text: '⬅️ Sebelumnya',
        preview: { type: 'product_list', page: safePage - 1, filterKey, kategori },
      })
    }
    if (safePage < totalPages - 1) {
      nav.push({
        text: '➡️ Selanjutnya',
        preview: { type: 'product_list', page: safePage + 1, filterKey, kategori },
      })
    }
    if (nav.length) buttons.push(nav)

    if (filterKey === 'bestseller') {
      buttons.push([{ text: '📦 Semua Produk', preview: { type: 'product_list', page: 0, filterKey: 'all' } }])
    } else {
      buttons.push([{ text: '🔥 PRODUK POPULER', preview: { type: 'product_list', page: 0, filterKey: 'bestseller' } }])
    }
    buttons.push([{ text: '🔙 Kembali', go: 'welcome' }])
  }

  return {
    type: 'action',
    action: 'product_list',
    key: 'product_list',
    caption,
    buttons,
    meta: { page: safePage, filterKey, kategori: kategori || null, total: list.length },
  }
}

function buildKategoriMenuView(products, copyByKey) {
  const list = products || []
  const counts = {}
  for (const p of list) {
    const kat = (p.kategori || 'umum').toLowerCase()
    counts[kat] = (counts[kat] || 0) + 1
  }

  let text = `📂 *PILIH KATEGORI*
━━━━━━━━━━━━━━━━━━━━
Pilih kategori produk yang ingin dilihat:

━━━━━━━━━━━━━━━━━━━━
`
  for (const kat of KATEGORI_LIST) {
    const count = counts[kat] || 0
    if (count > 0) {
      text += `${KATEGORI_EMOJI[kat] || '📦'} *${KATEGORI_NAME[kat] || kat}* (${count} produk)\n`
    }
  }
  text += `\n━━━━━━━━━━━━━━━━━━━━
💡 Pilih kategori untuk melihat produk`

  const buttons = []
  let row = []
  for (const kat of KATEGORI_LIST) {
    const count = counts[kat] || 0
    if (!count) continue
    row.push({
      text: `${KATEGORI_EMOJI[kat] || '📦'} ${KATEGORI_NAME[kat] || kat}`,
      preview: { type: 'product_list', page: 0, filterKey: 'all', kategori: kat },
    })
    if (row.length === 2) {
      buttons.push(row)
      row = []
    }
  }
  if (row.length) buttons.push(row)

  if (!list.length) {
    return {
      type: 'action',
      action: 'kategori_menu',
      key: 'kategori_menu',
      caption: '⚠️ Belum ada produk terdaftar.',
      buttons: [[{ text: '🔙 Kembali', go: 'welcome' }]],
    }
  }

  buttons.push([{ text: '📦 Semua Produk', preview: { type: 'product_list', page: 0, filterKey: 'all' } }])
  buttons.push([{ text: '🔙 Kembali', go: 'welcome' }])

  return {
    type: 'action',
    action: 'kategori_menu',
    key: 'kategori_menu',
    caption: text,
    buttons,
  }
}

function buildProductCardView(produk, copyByKey) {
  if (!produk) {
    return {
      type: 'action',
      action: 'product_card',
      caption: '⚠️ Produk tidak ditemukan.',
      buttons: [[{ text: '🔙 Kembali', preview: { type: 'product_list', page: 0, filterKey: 'all' } }]],
    }
  }

  const active = (produk.variants || []).filter((v) => v && v.is_active !== false)
  if (active.length === 1 && (active[0].stok_count || 0) > 0) {
    const v = active[0]
    return buildQtyView({
      kode: v.kode,
      label: v.label,
      harga: v.harga,
      stok: v.stok_count,
      terjual: v.terjual || 0,
      produk_label: `${produk.nama} — ${v.label}`,
      slug: produk.slug,
      deskripsi: produk.deskripsi || '—',
    }, copyByKey)
  }

  const totalTerjual = active.reduce((sum, v) => sum + (v.terjual || 0), 0)
  const snkRaw = produk.snk || ''
  const snkDisplay = snkRaw.startsWith('http')
    ? snkRaw
    : snkRaw

  let variasiLines = ''
  active.forEach((v) => {
    if ((v.stok_count || 0) > 0) {
      variasiLines += `*${v.label}* - ${formatrupiah(v.harga)} (Stok ${v.stok_count})\n`
    } else {
      variasiLines += `~${v.label}~ - ${formatrupiah(v.harga)} _(Habis)_\n`
    }
  })

  const caption = resolveCopy('screen.product_card', copyByKey, {
    nama: produk.nama,
    deskripsi: `${totalTerjual.toLocaleString('id-ID')} Terjual`,
    snk: snkDisplay,
    variants_block: `${variasiLines}\n🕒 Preview (live stock)`,
  })

  const buttons = []
  const available = active.filter((v) => (v.stok_count || 0) > 0)
  for (let i = 0; i < available.length; i += 2) {
    const row = [{
      text: available[i].label,
      preview: {
        type: 'qty',
        kode: available[i].kode,
        label: available[i].label,
        harga: available[i].harga,
        stok: available[i].stok_count,
        terjual: available[i].terjual || 0,
        produk_label: `${produk.nama} — ${available[i].label}`,
        slug: produk.slug,
      },
    }]
    if (available[i + 1]) {
      row.push({
        text: available[i + 1].label,
        preview: {
          type: 'qty',
          kode: available[i + 1].kode,
          label: available[i + 1].label,
          harga: available[i + 1].harga,
          stok: available[i + 1].stok_count,
          terjual: available[i + 1].terjual || 0,
          produk_label: `${produk.nama} — ${available[i + 1].label}`,
          slug: produk.slug,
        },
      })
    }
    buttons.push(row)
  }

  if (!available.length) {
    buttons.push([{ text: '(Semua varian habis)', stub: true }])
  }

  buttons.push([{
    text: resolveCopy('msg.btn_perbarui', copyByKey),
    preview: { type: 'product', slug: produk.slug },
  }])
  buttons.push([{
    text: resolveCopy('msg.btn_kembali', copyByKey),
    preview: { type: 'product_list', page: 0, filterKey: 'all' },
  }])

  return {
    type: 'action',
    action: 'product_card',
    key: 'product_card',
    caption,
    buttons,
    meta: { slug: produk.slug },
  }
}

function buildQtyView(opts, copyByKey) {
  const caption = resolveCopy('screen.qty', copyByKey, {
    produk_label: opts.produk_label || opts.label || opts.kode,
    terjual: opts.terjual || 0,
    deskripsi: opts.deskripsi || '—',
    harga: formatrupiah(opts.harga || 0),
    stok: opts.stok || 0,
    waktu: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
  })
  return {
    type: 'action',
    action: 'qty',
    caption: caption + '\n\n_(Preview — checkout & payment stay in the live bot)_',
    buttons: [
      [
        { text: '1', stub: true },
        { text: '2', stub: true },
        { text: '3', stub: true },
      ],
      [
        { text: 'Bayar (live bot only)', stub: true },
      ],
      [{
        text: resolveCopy('msg.btn_kembali', copyByKey),
        preview: { type: 'product', slug: opts.slug },
      }],
    ],
  }
}

function buildStokView(products) {
  const list = products || []
  let text = `📊 *STOK PRODUK*\n━━━━━━━━━━━━━━━━━━━━\n`
  if (!list.length) {
    text += 'Belum ada produk.\n'
  } else {
    list.slice(0, 12).forEach((p, i) => {
      text += `${i + 1}. *${p.nama}* — ${productStock(p)} tersedia\n`
    })
    if (list.length > 12) text += `\n… +${list.length - 12} lainnya\n`
  }
  text += `\n_(Preview — detail filter di live bot)_`
  return {
    type: 'action',
    action: 'stok',
    key: 'stok',
    caption: text,
    buttons: [[{ text: '🔙 Kembali', go: 'welcome' }]],
  }
}

function buildRiwayatView() {
  return {
    type: 'action',
    action: 'riwayat',
    key: 'riwayat',
    caption: `📋 *RIWAYAT TRANSAKSI*\n━━━━━━━━━━━━━━━━━━━━\nPreview mode — riwayat user nyata hanya di live bot.\n\n_(Login as buyer in Telegram to see orders)_`,
    buttons: [[{ text: '🔙 Kembali', go: 'welcome' }]],
  }
}

function buildDepositMenuView() {
  return {
    type: 'action',
    action: 'deposit_menu',
    key: 'deposit_menu',
    caption: `💳 *TOP UP SALDO*\n━━━━━━━━━━━━━━━━━━━━\nPreview mode — pembayaran QRIS / transfer hanya di live bot.\n\nPreset contoh: Rp10.000 · Rp25.000 · Rp50.000`,
    buttons: [
      [
        { text: 'Rp10.000', stub: true },
        { text: 'Rp25.000', stub: true },
      ],
      [{ text: 'Rp50.000', stub: true }],
      [{ text: '🔙 Kembali', go: 'saldo_menu' }],
    ],
  }
}

function buildScreenView(node, copyByKey, vars) {
  const body = typeof node.body === 'string' && node.body
    ? node.body
    : (copyByKey[node.screen_key] || copyLib.DEFAULTS[node.screen_key] || '')
  const caption = copyLib.render(body, vars)
  return {
    type: 'screen',
    key: node.key,
    caption,
    buttons: resolveButtons(node.buttons, copyByKey, vars),
  }
}

function renderTelegramMarkdown(text) {
  if (!text) return ''
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*(.*?)\*/g, '<b>$1</b>')
    .replace(/_(.*?)_/g, '<i>$1</i>')
    .replace(/~(.*?)~/g, '<del>$1</del>')
    .replace(/`(.*?)`/g, '<code>$1</code>')
    .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank">$1</a>')
}

module.exports = {
  PRODUCTS_PER_PAGE,
  KATEGORI_LIST,
  resolveCopy,
  buttonText,
  resolveButtons,
  mapCallbackPreview,
  productStock,
  buildProductListView,
  buildKategoriMenuView,
  buildProductCardView,
  buildQtyView,
  buildStokView,
  buildRiwayatView,
  buildDepositMenuView,
  buildScreenView,
  renderTelegramMarkdown,
}

