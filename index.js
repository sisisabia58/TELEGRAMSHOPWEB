// Suppress punycode deprecation warning from dependencies
const originalEmitWarning = process.emitWarning;
process.emitWarning = function(warning, ...args) {
  if (typeof warning === 'string' && warning.includes('punycode')) {
    return; // Suppress punycode deprecation warning
  }
  if (warning && typeof warning === 'object' && warning.name === 'DeprecationWarning' && warning.message && warning.message.includes('punycode')) {
    return; // Suppress punycode deprecation warning
  }
  return originalEmitWarning.apply(process, [warning, ...args]);
};

// Disable deprecation warning for Buffer filename
process.env.NTBA_FIX_350 = '1'

const { TokenBot, NamaBot, OwnerID, ImagePath, Pakasir, ChannelLog, ChannelStore, CS } = require("./settings.js")
const supabase = require('./lib/supabase')
const runtimeSettings = require('./lib/runtime-settings')
const copy = require('./lib/copy')
const flow = require('./lib/flow')
const retiredCommands = require('./lib/retired-commands')
const session = require('./lib/session')
const pakasir = require('./pakasir.js')

// Helper bersama dengan dashboard. Di-require di paling atas — dulu ini adalah
// `function` declaration yang ter-hoist, sekarang binding `const`, jadi harus
// terdefinisi sebelum ada kode lain yang memanggilnya.
const { formatrupiah, formatWIB, formatWIBDetail, namaBulan } = require('./lib/format')

// Query tabel Stok. Di bot, "hitung stok" selalu berdasarkan kode produk —
// karena itu getStokCount dialiaskan ke getStokCountByKode. Nama-nama lokal
// dipertahankan supaya seluruh pemanggil di file ini tidak perlu diubah.
// Keranjang user. Dulu file ./Database/Trx/<userId>.json di disk lokal, yang
// terhapus setiap deploy karena filesystem Railway ephemeral.
const cart = require('./lib/cart')
const catalog = require('./lib/catalog')
const pricing = require('./lib/pricing')

const stock = require('./lib/stock')
const getStokCount = stock.getStokCountByKode
const getStokForTransaction = stock.getStokForTransaction
const getStokItems = stock.getStokItems
const markStokTerjual = stock.markStokTerjual

// Channel & Contact: nilai dari .env dipakai sebagai default, bisa di-override
// dari DB via dashboard.
//
// Ini getter, bukan nilai tetap. Sebelumnya nilainya dibaca sekali saat boot
// (loadChannelContactFromDb) sehingga perubahan dari dashboard tidak pernah
// sampai ke bot yang sedang berjalan sampai bot di-restart. Dengan getter,
// setiap pembacaan mengambil nilai terbaru dari cache runtime-settings, yang
// di-refresh oleh poller di bawah.
const channelContact = {
  get channelLog() { return runtimeSettings.get('channel_log', ChannelLog || '') },
  get channelStore() { return runtimeSettings.get('channel_store', ChannelStore || '') },
  get cs() { return runtimeSettings.get('cs', CS || '') }
}

// Muat pengaturan sekali di awal, lalu pantau perubahan dari dashboard.
runtimeSettings.refresh(true)
  .then(async () => {
    await copy.refresh()
    await flow.refresh()
    runtimeSettings.startPolling(10000, () => {
      copy.refresh().catch(() => {})
      flow.refresh().catch(() => {})
    })
  })
  .catch((e) => console.error('[runtime-settings] gagal muat awal:', e.message))
const TelegramBot = require("node-telegram-bot-api")
const bot = new TelegramBot(TokenBot, { 
  polling: true,
  request: {
    agentOptions: {
      keepAlive: true,
      keepAliveMsecs: 10000
    },
    timeout: 60000, // 60 detik timeout untuk semua request ke Telegram API
    // Retry configuration untuk DNS errors
    retry: true,
    maxRetries: 3,
    retryDelay: 1000
  },
  // Base URL dengan fallback
  baseApiUrl: process.env.TELEGRAM_API_URL || 'https://api.telegram.org'
})

// Configure Telegram chat column commands menu (autocomplete)
bot.setMyCommands([
  { command: 'start', description: 'mulai bot' },
  { command: 'stok', description: 'laporan stok produk' }
]).then(() => {
  console.log('✅ Telegram bot commands set successfully')
}).catch((err) => {
  console.error('❌ Failed to set Telegram bot commands:', err)
})
// Enhanced error handling for polling errors
bot.on("polling_error", (error) => {
  console.error("Polling error:", error.message);
  
  // Handle DNS errors specifically
  if (error.code === 'EAI_AGAIN' || error.message.includes('getaddrinfo')) {
    console.error("DNS resolution error - Telegram API tidak bisa diakses. Akan retry otomatis...");
    // Bot akan otomatis retry, tidak perlu action tambahan
  } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET') {
    console.error("Connection timeout/reset - Akan retry otomatis...");
  } else {
    console.error("Unknown polling error:", error);
  }
});

const cron = require('node-cron');
const moments = require('moment');
require('moment/locale/id');
moments.locale('id');
const toMs = require("ms")
let QRCode = require("qrcode")
const moment = require("moment-timezone").tz("Asia/Jakarta")
const hariArray = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"]
const bulanArray = ["", "Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"]
const fs = require("fs")
const fetch = require("node-fetch")
const md5 = require("md5")
const axios = require("axios")
let editstok = {}
let depositState = {}
let msgg = {}
let addProdukState = {}
let addStokState = {}
let editNamaState = {}
let editKodeState = {}
let editHargaState = {}
let editDeskripsiState = {}
let editSnkState = {}
let editFormatState = {}
let editKategoriState = {}

// Tracking reserved stocks untuk mencegah concurrent purchase
let reservedStocks = {} // Format: { stokId: { userId, reservedAt, trxid } }
const RESERVATION_TIMEOUT = 5 * 60 * 1000 // 5 menit dalam milliseconds

// Helper function to detect product format
function detectProductFormat(productData, manualFormat = null) {
  // Jika ada format manual dari database, gunakan itu
  if (manualFormat && manualFormat.trim() !== '') {
    // Format manual bisa berupa:
    // - "Email:Password" (tanpa contoh)
    // - "Email:Password|email@example.com:*****" (dengan contoh, dipisah |)
    const parts = manualFormat.split('|')
    if (parts.length === 2) {
      return {
        info: `📄 Format: ${parts[0].trim()}`,
        example: `Contoh: \`${parts[1].trim()}\``
      }
    } else {
      return {
        info: `📄 Format: ${manualFormat.trim()}`,
        example: ""
      }
    }
  }
  
  // Jika tidak ada format manual, auto-detect dari data
  if (!productData || productData.length === 0) {
    return { info: "📄 Format: Teks/Plain", example: "Contoh: Data produk" }
  }
  
  const sampleData = productData[0]
  if (typeof sampleData !== 'string') {
    return { info: "📄 Format: Teks/Plain", example: "Contoh: Data produk" }
  }
  
  // Check for Email:Password format
  if (sampleData.includes('@') && sampleData.includes(':')) {
    const parts = sampleData.split(':')
    if (parts.length >= 2 && parts[0].includes('@')) {
      const email = parts[0].substring(0, 20)
      return { 
        info: "📄 Format: Email:Password", 
        example: `Contoh: \`${email}...:*****\``
      }
    }
  }
  
  // Check for pipe-separated format
  if (sampleData.includes('|')) {
    const preview = sampleData.substring(0, 30)
    return { 
      info: "📄 Format: Data1|Data2", 
      example: `Contoh: \`${preview}${sampleData.length > 30 ? '...' : ''}\``
    }
  }
  
  // Check if it's just an email
  if (sampleData.match(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/)) {
    return { 
      info: "📄 Format: Email", 
      example: `Contoh: \`${sampleData}\``
    }
  }
  
  // Check if it's numeric/code
  if (sampleData.match(/^[0-9]+$/)) {
    return { 
      info: "📄 Format: Nomor/Code", 
      example: `Contoh: \`${sampleData}\``
    }
  }
  
  // Default: Plain text
  const preview = sampleData.substring(0, 40)
  return { 
    info: "📄 Format: Teks/Plain", 
    example: `Contoh: \`${preview}${sampleData.length > 40 ? '...' : ''}\``
  }
}

// Fungsi untuk memformat data produk sesuai format yang ditentukan
function formatProductDataForFile(dataLines, formatString) {
  if (!formatString || !formatString.trim()) {
    // Jika tidak ada format, kembalikan data asli
    return dataLines
  }
  
  // Ambil format tanpa contoh (jika ada |, ambil bagian pertama)
  const formatParts = formatString.split('|')
  const format = formatParts[0].trim()
  
  // Jika format tidak mengandung ":", kembalikan data asli
  if (!format.includes(':')) {
    return dataLines
  }
  
  // Parse format untuk mendapatkan nama field
  const fieldNames = format.split(':').map(f => f.trim())
  
  // Jika hanya 1 field, kembalikan data asli
  if (fieldNames.length < 2) {
    return dataLines
  }
  
  // Format setiap baris data
  const formattedLines = dataLines.split('\n').map(line => {
    if (!line || !line.trim()) {
      return line
    }
    
    // Split data berdasarkan ":" dengan memperhatikan jumlah field yang diharapkan
    const dataParts = []
    let currentPart = ''
    let colonCount = 0
    const expectedColons = fieldNames.length - 1
    
    for (let i = 0; i < line.length; i++) {
      if (line[i] === ':' && colonCount < expectedColons) {
        dataParts.push(currentPart.trim())
        currentPart = ''
        colonCount++
      } else {
        currentPart += line[i]
      }
    }
    // Tambahkan bagian terakhir
    if (currentPart) {
      dataParts.push(currentPart.trim())
    }
    
    // Jika jumlah bagian data tidak sesuai dengan format, kembalikan asli
    if (dataParts.length < fieldNames.length) {
      return line
    }
    
    // Format setiap field dengan label
    const formattedFields = []
    for (let i = 0; i < fieldNames.length; i++) {
      const fieldName = fieldNames[i]
      // Untuk field terakhir, ambil semua sisa data (jika ada lebih dari yang diharapkan)
      const fieldValue = i === fieldNames.length - 1 
        ? dataParts.slice(i).join(':') 
        : dataParts[i]
      formattedFields.push(`${fieldName} : ${fieldValue}`)
    }
    
    // Gabungkan dengan newline di antara setiap item
    return formattedFields.join('\n')
  })
  
  // Gabungkan semua baris dengan double newline untuk memisahkan setiap item
  return formattedLines.join('\n\n')
}

// formatWIB / formatWIBDetail / formatrupiah / namaBulan -> lib/format.js
// (di-require di bagian atas file)

function welcomeCaption(ctx) {
  return copy.get('screen.welcome', {
    first_name: ctx.first_name || 'User',
    nama_bot: NamaBot,
    user_count: ctx.user_count ?? 0,
    stok_terjual: ctx.stok_terjual ?? 0,
    stok_tersedia: ctx.stok_tersedia ?? 0,
    saldo: ctx.saldo_fmt || formatrupiah(ctx.saldo || 0),
  })
}

function welcomeInlineKeyboard() {
  return {
    inline_keyboard: [
      [{ text: copy.get('msg.menu_daftar_produk'), callback_data: 'daftarproduk' }],
      [{ text: copy.get('msg.menu_kategori'), callback_data: 'kategori_menu' }],
      [
        { text: copy.get('msg.menu_riwayat'), callback_data: 'riwayattransaksi' },
        { text: copy.get('msg.menu_cara_order'), callback_data: 'caraorder' },
      ],
      [
        { text: copy.get('msg.menu_saldo'), callback_data: 'saldomenu' },
        { text: copy.get('msg.menu_stok'), callback_data: 'stok' },
      ],
      [{ text: copy.get('msg.menu_channel'), url: channelContact.channelStore }],
      [{ text: copy.get('msg.menu_cs'), url: channelContact.cs }],
    ],
  }
}

async function generateReplyKeyboard(userId) {
  try {
    const saldo = await cekSaldo(userId)
    const saldoFmt = formatrupiah(saldo)

    return {
      keyboard: [
        [
          copy.get('msg.menu_daftar_produk_reply'),
          copy.get('msg.menu_saldo_reply', { saldo: saldoFmt }),
        ],
        [copy.get('msg.menu_riwayat_reply')],
      ],
      resize_keyboard: true
    }
  } catch (error) {
    console.error('Error generating reply keyboard:', error)
    return {
      keyboard: [
        [copy.get('msg.menu_daftar_produk_reply')],
        [copy.get('msg.menu_riwayat_reply')],
      ],
      resize_keyboard: true
    }
  }
}

// Resolve varian by kode for cart/checkout flows.
async function getVarianForCart(kode) {
  const v = await catalog.getVariantByKode(kode)
  if (!v) return null
  const stokCount = await getStokCount(v.kode)
  return {
    ...v,
    nama: `${v.produk?.nama || 'Produk'} — ${v.label}`,
    namaProduk: v.produk?.nama || 'Produk',
    namaLabel: v.label,
    deskripsi: v.produk?.deskripsi || '',
    snk: v.produk?.snk || '',
    slug: v.produk?.slug || '',
    produk_id: v.produk_id,
    stok_count: stokCount,
  }
}

async function hargaUntukQty(item, qty) {
  return pricing.resolveForVarian(item, qty)
}

function applyVoucherPotongan(subtotal, userId, voucherKode, voucherList) {
  const vcr = (voucherList || []).find((v) => v.kode === voucherKode)
  if (vcr && !vcr.user.some((a) => a === userId) && vcr.limit > 0) {
    return Math.max(0, subtotal - vcr.potongan)
  }
  return subtotal
}

async function showVariantQtyScreen(userId, msgId, varian) {
  const stokCount = await getStokCount(varian.kode)
  if (stokCount === 0) {
    return bot.sendMessage(userId, `⚠️ Stok ${varian.label} habis!`)
  }
  const data = {
    kode: varian.kode,
    jumlah: 1,
    trxid: `TRX-${Date.now()}`,
    voucher: '',
    voucher_status: '',
    selectedStokIds: [],
  }
  await cart.save(userId, data)
  const stokItems = await getStokItems(varian.kode, 1)
  const sampleData = stokItems.length > 0 ? [stokItems[0].data] : []
  const formatDetected = detectProductFormat(sampleData, varian.format)
  const momentTz = require('moment-timezone')
  const formattedTime = momentTz().tz('Asia/Jakarta').format('hh:mm:ss A')
  const item = await getVarianForCart(varian.kode)
  const caption = copy.get('screen.qty', {
    produk_label: `${item.namaProduk.toUpperCase()} — ${item.namaLabel.toUpperCase()}`,
    terjual: varian.terjual || 0,
    deskripsi: item.deskripsi,
    harga: formatrupiah(varian.harga),
    stok: stokCount,
    waktu: formattedTime,
  })
  await editOrSendBannerMessage(userId, msgId, caption, {
    reply_markup: {
      inline_keyboard: [
        [{ text: `${item.namaLabel} (${stokCount})`, callback_data: 'lanjut' }],
        [{ text: '🔙 Kembali', callback_data: 'daftarproduk' }],
      ],
    },
  })
  return formatDetected
}

function blurStokData(data) {
  if (!data || data.length === 0) return '****'
  if (data.length <= 4) return '****'
  
  const visiblePart = data.substring(0, 4)
  const hiddenPart = '*'.repeat(Math.min(data.length - 4, 20)) // Maksimal 20 asterisk
  return `${visiblePart}${hiddenPart}${data.length > 24 ? '...' : ''}`
}

function chunkArray(array, size) {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

// Helper function untuk mendapatkan emoji kategori
function getKategoriEmoji(kategori) {
  const kategoriLower = (kategori || 'umum').toLowerCase()
  const kategoriMap = {
    'game': '🎮',
    'streaming': '📺',
    'software': '💻',
    'social media': '📱',
    'voucher': '🎟️',
    'education': '📚',
    'umum': '📦'
  }
  return kategoriMap[kategoriLower] || '📦'
}

// Helper function untuk cek apakah produk baru (dibuat < 7 hari)
function isNewProduct(createdAt) {
  if (!createdAt) return false
  const daysSinceCreated = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24)
  return daysSinceCreated <= 7
}

// Helper function untuk mendapatkan nama kategori yang lebih user-friendly
function getKategoriName(kategori) {
  const kategoriLower = (kategori || 'umum').toLowerCase()
  const nameMap = {
    'game': 'Game',
    'streaming': 'Streaming',
    'software': 'Software',
    'social media': 'Social Media',
    'voucher': 'Voucher',
    'education': 'Education',
    'umum': 'Umum'
  }
  return nameMap[kategoriLower] || 'Umum'
}

let ITEMS_PER_PAGE = 4
let USERS_PER_PAGE = 5
let PRODUCTS_PER_PAGE = 10

async function sendPage(data, chatId, page, msgId = null, callbackId = null, filterOptions = {}) {
  const sortedData = [...data].sort((a, b) => new Date(b.tanggal) - new Date(a.tanggal))
  let userData = []
  
  // Filter by user and additional filters
  Object.keys(sortedData).forEach((f) => {
    if (sortedData[f].id === chatId) {
      // Apply date filters if provided
      if (filterOptions.startDate) {
        const itemDate = new Date(sortedData[f].tanggal)
        if (itemDate < filterOptions.startDate) return
      }
      if (filterOptions.endDate) {
        const itemDate = new Date(sortedData[f].tanggal)
        if (itemDate > filterOptions.endDate) return
      }
      if (filterOptions.produk && sortedData[f].kode !== filterOptions.produk) return
      userData.push(sortedData[f])
    }
  })
  
  // Calculate statistics
  const totalHarga = userData.reduce((sum, item) => sum + (item.harga || 0), 0)
  const totalTransaksi = userData.length
  
  const totalPages = Math.ceil(userData.length / ITEMS_PER_PAGE);
  const start = page * ITEMS_PER_PAGE;
  const end = start + ITEMS_PER_PAGE;
  const items = userData.slice(start, end);

  if (callbackId) bot.answerCallbackQuery(callbackId);
  
  // Header dengan statistik
  let text = `📋 *RIWAYAT TRANSAKSI*
━━━━━━━━━━━━━━━━━━━━
📊 *Total:* ${totalTransaksi} transaksi
💰 *Total Pengeluaran:* ${formatrupiah(totalHarga)}
📄 *Halaman:* ${page+1}/${totalPages}
${filterOptions.periodLabel ? `📅 *Periode:* ${filterOptions.periodLabel}` : ''}
━━━━━━━━━━━━━━━━━━━━

`;
  
  if (items.length === 0) {
    text += `📭 Tidak ada transaksi pada halaman ini.`
  } else {
    text += items.map((item, idx) => {
      const itemNum = start + idx + 1
      return `┌─────────────
│ *${itemNum}. ${item.nama}*
│─────────────
│📊 Jumlah: *${item.jumlah}*
│💰 Harga: *${formatrupiah(resolvedSaldo.harga_satuan)}*
│🕒 ${formatWIB(item.tanggal)}
│🆔 Trx ID: \`${item.trxid || 'N/A'}\`
└─────────────`
    }).join("\n\n")
  }

  const buttons = [];
  
  // Quick actions buttons for each item (max 4 items per page)
  if (items.length > 0) {
    items.forEach((item, idx) => {
      if (item.trxid) {
        // Create compact buttons: 2 items per row
        if (idx % 2 === 0) {
          const row = []
          row.push({ text: `${idx + 1}️⃣ Detail`, callback_data: `detail_trx_${item.trxid}` })
          if (idx + 1 < items.length && items[idx + 1] && items[idx + 1].trxid) {
            row.push({ text: `${idx + 2}️⃣ Detail`, callback_data: `detail_trx_${items[idx + 1].trxid}` })
          }
          buttons.push(row)
        }
      }
    })
    
    // Tombol "Unduh Item" dan "Beli Lagi" tidak ditampilkan di sini — produk
    // dibeli lagi lewat tombol di daftar produk.
  }
  
  // Navigation buttons
  const navButtons = []
  if (page > 0) navButtons.push({ text: '⏪ Prev', callback_data: `prev:${page}_${filterOptions.filterKey || 'all'}` });
  if (page < totalPages - 1) navButtons.push({ text: 'Next ⏩', callback_data: `next:${page}_${filterOptions.filterKey || 'all'}` })
  if (navButtons.length > 0) buttons.push(navButtons)
  
  // Filter & Statistik buttons
  buttons.push([
    { text: "🔍 Filter", callback_data: "riwayat_filter" },
    { text: "📊 Statistik", callback_data: "riwayat_statistik" }
  ])
  
  buttons.push([{text: "🔙 Kembali", callback_data: "kembaliawal"}])

  const reply_markup = { inline_keyboard: buttons };

  if (msgId) {
    await bot.editMessageText(text, {
      parse_mode: "Markdown",
      chat_id: chatId,
      message_id: msgId,
      reply_markup
    }).catch(async (e) => {
      await bot.sendMessage(chatId, text, {
        parse_mode: "Markdown", reply_markup });
    });
  } else {
    await bot.sendMessage(chatId, text, {
      parse_mode: "Markdown", reply_markup })
  }
}

async function rekapBulanTahun(trx, bulan, tahun) {
  const filtered = trx.filter(t => {
    const d = new Date(t.tanggal)
    return d.getMonth() === bulan && d.getFullYear() === tahun;
  })
  if (filtered.length === 0) return { text: `📭 Tidak ada transaksi pada ${namaBulan[bulan]} ${tahun}.` }
  let total = 0
  let teks = `📅 *REKAP ${namaBulan[bulan].toUpperCase()} ${tahun}*
=======================
`

/*for (let i = 0; i < filtered.length; i++) {
const t = filtered[i]
const m = moments(t.tanggal).locale('id')
let usn = await bot.getChat(t.id)
total += t.harga
teks += `*${i + 1}. ${t.nama.toUpperCase()}*\n`
teks += `⟩ Buyer: @${usn.username}\n`
teks += `⟩ Jumlah: ${t.jumlah}\n`
teks += `⟩ Harga: ${formatrupiah(t.harga)}\n`
teks += `⟩ Tanggal: ${m.format('DD-MM-YYYY HH.mm')}\n\n`
}*/
const hasil = await Promise.all(filtered.map(async (t, i) => {
 const m = moments(t.tanggal).locale('id')
 let usn = await bot.getChat(t.id)
 total += t.harga
 return `*${i + 1}. ${t.nama.toUpperCase()}*\n` +
`⟩ Buyer: @${usn.username}\n` +
`⟩ Jumlah: ${t.jumlah}\n` +
`⟩ Harga: ${formatrupiah(t.harga)}\n` +
`⟩ Tanggal: ${m.format('DD-MM-YYYY HH.mm')}\n\n`
}))
teks += hasil.join('')
  teks += `=======================\n💰 *Total: ${formatrupiah(total)}*`
  return { text: teks }
}

function generateTahunKeyboard(tahun) {
  const bulanButtons = namaBulan.map((bulan, index) => ({
    text: bulan, callback_data: `bulan_${index}_${tahun}`
  }))
  const rows = []
  for (let i = 0; i < bulanButtons.length; i += 3) {
    rows.push(bulanButtons.slice(i, i + 3));
  }

  rows.push([
    { text: '⏪ Prev Tahun', callback_data: `tahun_${tahun - 1}` },
    { text: '⏩ Next Tahun', callback_data: `tahun_${tahun + 1}` }
  ])
  return { inline_keyboard: rows }
}


const sleep = async (ms) => {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function toCRC16(str) {
  function charCodeAt(str, i) {
    let get = str.substr(i, 1)
    return get.charCodeAt()
  }

  let crc = 0xFFFF;
  let strlen = str.length;
  for (let c = 0; c < strlen; c++) {
    crc ^= charCodeAt(str, c) << 8;
    for (let i = 0; i < 8; i++) {
      if (crc & 0x8000) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc = crc << 1;
      }
    }
  }
  hex = crc & 0xFFFF;
  hex = hex.toString(16);
  hex = hex.toUpperCase();
  if (hex.length == 3) {
    hex = "0" + hex;
  }
  return hex;
}



function digit() {
  return Math.floor(Math.random() * 30)
}

const generateQR = async (text, path) => {
      try {
        converBase64ToImage(await QRCode.toDataURL(text), path)
      } catch (err) {
        console.error(err)
      }
    }



const addSaldo = async (userId, amount) => {
try {
const { data } = await supabase
  .from('User')
  .select('saldo')
  .eq('id', userId)
  .single()
await supabase
  .from('User')
  .update({ saldo: data.saldo + Number(amount) })
  .eq('id', userId)
} catch (err) {
  console.log(err)
}
}

const minSaldo = async (userId, amount) => {
try {
const { data } = await supabase
  .from('User')
  .select('saldo')
  .eq('id', userId)
  .single()
await supabase
  .from('User')
  .update({ saldo: data.saldo - Number(amount) })
  .eq('id', userId)
} catch (err) {
  console.log(err)
}
}

const cekSaldo = async (userId) => {
try {
const { data } = await supabase
  .from('User')
  .select('saldo')
  .eq('id', userId)
  .single()
return data ? data.saldo : 0
} catch (err) {
  console.log(err)
  return 0
}
}
function isOwner(id) {
  let isown = false
  if (id.from.id === OwnerID) isown = true
  return isown
}

async function sendMessage(id, msg, options = {}) {
  return await retryBotOperation(async () => {
    return await bot.sendMessage(id, msg, {
      parse_mode: "Markdown",
      ...options
    });
  }).catch(err => {
    // Log error tapi jangan crash aplikasi
    console.error('Failed to send message after retries:', err.message);
    // Return null untuk indikasi bahwa message tidak terkirim
    return null;
  });
}

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
    
    await retryBotOperation(async () => {
      return await bot.sendMessage(target, text, {
        parse_mode: 'Markdown'
      });
    }).catch(err => {
      console.error('Failed to send feed message after retries:', err.message);
    });
  } catch (error) {
    console.error('Error in sendFeedMessage:', error);
  }
}


async function isRegistered(id) {
      let regist = false
      const { data, error } = await supabase
  .from('User')
  .select('*')
  .eq("id", id)
  .single()
  if (data !== null) regist = true
      return regist
}

// ============================================
// HELPER FUNCTIONS UNTUK STOK (Tabel Terpisah)
// ============================================

// getStokCount / getStokForTransaction / getStokItems / markStokTerjual
// -> lib/stock.js (di-require di bagian atas file)

// ============ FUNGSI RESERVASI STOK ============
// Fungsi untuk reserve stok agar tidak bisa dipilih user lain
async function reserveStok(stokIds, userId, trxid) {
  const now = Date.now()
  const reserved = []
  
  for (const stokId of stokIds) {
    // Cek apakah stok sudah direserve orang lain
    if (reservedStocks[stokId]) {
      const reservation = reservedStocks[stokId]
      const elapsed = now - reservation.reservedAt
      
      // Jika masih dalam timeout dan bukan user yang sama
      if (elapsed < RESERVATION_TIMEOUT && reservation.userId !== userId) {
        // Stok masih di-reserve user lain
        console.log(`⏳ Stok ${stokId} masih direserve oleh user ${reservation.userId}`)
        continue
      }
    }
    
    // Reserve stok untuk user ini
    reservedStocks[stokId] = {
      userId: userId,
      trxid: trxid,
      reservedAt: now
    }
    reserved.push(stokId)
    console.log(`🔒 Stok ${stokId} direserve untuk user ${userId}`)
  }
  
  return reserved
}

// Fungsi untuk release reservation
function releaseReservation(stokIds) {
  if (!Array.isArray(stokIds)) {
    stokIds = [stokIds]
  }
  
  for (const stokId of stokIds) {
    if (reservedStocks[stokId]) {
      console.log(`🔓 Release reservation stok ${stokId} dari user ${reservedStocks[stokId].userId}`)
      delete reservedStocks[stokId]
    }
  }
}

// Fungsi untuk cek apakah stok available (tidak reserved)
function isStokAvailable(stokId, userId = null) {
  if (!reservedStocks[stokId]) {
    return true // Tidak ada yang reserve
  }
  
  const reservation = reservedStocks[stokId]
  const elapsed = Date.now() - reservation.reservedAt
  
  // Timeout sudah lewat
  if (elapsed >= RESERVATION_TIMEOUT) {
    console.log(`⏰ Timeout reservation untuk stok ${stokId}`)
    delete reservedStocks[stokId]
    return true
  }
  
  // Reserved oleh user yang sama
  if (userId && reservation.userId === userId) {
    return true
  }
  
  return false // Masih di-reserve user lain
}

// Fungsi untuk cleanup expired reservations
function cleanupExpiredReservations() {
  const now = Date.now()
  let cleanedCount = 0
  
  for (const [stokId, reservation] of Object.entries(reservedStocks)) {
    const elapsed = now - reservation.reservedAt
    if (elapsed >= RESERVATION_TIMEOUT) {
      delete reservedStocks[stokId]
      cleanedCount++
      console.log(`🔓 Auto-release reservation untuk stok ${stokId} (timeout)`)
    }
  }
  
  if (cleanedCount > 0) {
    console.log(`✅ Cleanup ${cleanedCount} expired reservations`)
  }
}

// Jalankan cleanup setiap 1 menit
setInterval(cleanupExpiredReservations, 60 * 1000)

// Tambah stok baru ke tabel Stok
async function addStokItems(varianId, varianKode, dataArray) {
  try {
    const stokItems = dataArray
      .filter(item => item.trim() !== '')
      .map(data => ({
        varian_id: varianId,
        varian_kode: String(varianKode).toLowerCase(),
        data: data.trim(),
        status: 'tersedia'
      }))
    
    if (stokItems.length === 0) {
      return { data: [], error: null }
    }
    
    const { data, error } = await supabase
      .from('Stok')
      .insert(stokItems)
      .select()
    
    return { data, error }
  } catch (error) {
    console.error('Error addStokItems:', error)
    return { data: [], error }
  }
}

async function buildAddStokVariantEntries() {
  const list = await catalog.listProducts({ activeOnly: true, withStock: true })
  const entries = []
  for (const p of list) {
    for (const v of p.variants || []) {
      if (v.is_active === false) continue
      entries.push({
        id: v.id,
        kode: v.kode,
        label: v.label,
        nama: p.nama,
        harga: v.harga,
        stok_count: v.stok_count ?? 0,
      })
    }
  }
  return entries
}

async function resolveVarianForAddStok(kode) {
  const item = await catalog.getVariantByKode(kode)
  if (!item) return null
  return {
    id: item.id,
    kode: item.kode,
    label: item.label,
    harga: item.harga,
    nama: item.produk?.nama || item.label,
  }
}

// getStokItems -> lib/stock.js (di-require di bagian atas file)

// Update stok item (untuk edit)
async function updateStokItem(stokId, newData) {
  try {
    const { data, error } = await supabase
      .from('Stok')
      .update({ data: newData.trim() })
      .eq('id', stokId)
      .select()
      .single()
    
    return { data, error }
  } catch (error) {
    console.error('Error updateStokItem:', error)
    return { data: null, error }
  }
}

// Hapus stok item
async function deleteStokItem(stokId) {
  try {
    const { error } = await supabase
      .from('Stok')
      .update({ status: 'dihapus' })
      .eq('id', stokId)
    
    return { error }
  } catch (error) {
    console.error('Error deleteStokItem:', error)
    return error
  }
}

// Ambil produk dengan varian + stok (catalog)
async function getProdukWithStok() {
  try {
    return await catalog.listProducts({ activeOnly: true, withStock: true })
  } catch (error) {
    console.error('Error getProdukWithStok:', error)
    return []
  }
}

// ============================================
// OPTIMIZED HELPER FUNCTIONS untuk /start
// ============================================

// Ambil total stok tersedia (lebih cepat - 1 query langsung)
async function getTotalStokTersedia() {
  try {
    const { count, error } = await supabase
      .from('Stok')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'tersedia')
    
    if (error) {
      console.error('Error getTotalStokTersedia:', error)
      return 0
    }
    return count || 0
  } catch (error) {
    console.error('Error getTotalStokTersedia:', error)
    return 0
  }
}

// Ambil total stok terjual (lebih cepat - 1 query dengan SUM)
async function getTotalStokTerjual() {
  try {
    const { data, error } = await supabase
      .from("Trx")
      .select("jumlah")
    
    if (error) {
      console.error('Error getTotalStokTerjual:', error)
      return 0
    }
    
    if (!data || data.length === 0) return 0
    
    return data.reduce((sum, t) => sum + (t.jumlah || 0), 0)
  } catch (error) {
    console.error('Error getTotalStokTerjual:', error)
    return 0
  }
}

// ============================================
// SEND BANNER MESSAGE HELPER
// Sends photo + caption as a single merged bubble
// ============================================
async function sendBannerMessage(chatId, captionText, options = {}) {
  return await bot.sendPhoto(chatId, ImagePath, {
    caption: captionText,
    parse_mode: "Markdown",
    ...options
  })
}

// ============================================
// EDIT OR SEND BANNER MESSAGE HELPER
// Tries to edit existing photo caption in-place,
// falls back to sending a new banner if message
// doesn't exist or edit fails.
// ============================================
async function editOrSendBannerMessage(chatId, messageId, captionText, options = {}) {
  if (messageId) {
    try {
      return await bot.editMessageCaption(captionText, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: "Markdown",
        ...options
      })
    } catch (error) {
      console.log(`[editOrSendBannerMessage] Edit failed, sending new banner: ${error.message}`)
    }
  }
  return await sendBannerMessage(chatId, captionText, options)
}

// ============================================
// GENERATE QR BUFFER HELPER
// Generates a PNG buffer from a QRIS payload string
// ============================================
async function generateQRBuffer(qrisString) {
  const QRCode = require('qrcode');
  return await QRCode.toBuffer(qrisString, { type: 'png', margin: 2, scale: 8 });
}

async function createDepositTransaction(userId, username, firstName, jumlah, chatId) {
  const ms = require('ms')
  // Generate kode deposit unik
  const uniq = require("crypto").randomBytes(5).toString("hex").toUpperCase()
  const time = Date.now() + ms("10m")
  
  if (!Pakasir.project) {
    console.error("Pakasir project slug is not configured in .env");
    return await sendMessage(chatId, `❌ *ERROR*\n=======================\nSistem QRIS belum dikonfigurasi dengan benar oleh pemilik toko. Silakan hubungi admin.`)
  }

  if (!Pakasir.apiKey) {
    console.error("Pakasir API key is not configured in .env");
    return await sendMessage(chatId, `❌ *ERROR*\n=======================\nSistem verifikasi pembayaran belum dikonfigurasi dengan benar oleh pemilik toko. Silakan hubungi admin.`)
  }

  try {
    // Create a Pakasir QRIS transaction (order_id = kode deposit)
    const pay = await pakasir.createTransaction({ orderId: uniq, amount: jumlah });
    const totalAmount = pay.total_payment; // amount + Pakasir fee (paid by the customer)
    const imageBuffer = await generateQRBuffer(pay.payment_number);

    // Simpan ke database (fee: Pakasir fee, total: total_payment)
    await supabase
      .from("Deposit")
      .insert([{
        user_id: userId,
        jumlah: jumlah,
        fee: pay.fee || 0,
        total: totalAmount,
        status: 'pending',
        kode_deposit: uniq,
        metode: 'qris'
      }])

    // Payment coordination row (webhook + polling fallback)
    await supabase
      .from("Payment")
      .insert([{
        order_id: uniq,
        type: 'deposit',
        user_id: userId,
        amount: jumlah,
        fee: pay.fee || 0,
        total: totalAmount,
        status: 'pending',
        payment_method: 'qris',
        qr_string: pay.payment_number,
        expired_at: pay.expired_at || null,
        meta: { jumlah: jumlah }
      }])
    
    let txx = `💳 *TOP UP SALDO*
=======================
💰 *Jumlah:* ${formatrupiah(jumlah)}
💸 *Fee:* ${formatrupiah(pay.fee || 0)}
💵 *Total Bayar:* ${formatrupiah(totalAmount)}
🆔 *Kode Deposit:* \`${uniq}\`
⏰ *Expired:* 10 menit
=======================
⚠️ *PENTING:* Transfer harus sama persis sejumlah *${formatrupiah(totalAmount)}* agar pembayaran dapat terdeteksi otomatis!
Scan QRIS diatas untuk melakukan pembayaran.`
    
    let ff = await retryBotOperation(async () => {
      return await bot.sendPhoto(chatId, imageBuffer, {
        parse_mode: "Markdown",
        caption: txx,
        filename: 'qris-deposit.png',
        contentType: 'image/png',
        reply_markup: {
          inline_keyboard: [
            [{text: "❌ Batal", callback_data: `bataldeposit_${uniq}`}]
          ]
        }
      });
    });
    
    // Detect payment: webhook flips Payment.status to 'paid'; poll Pakasir as fallback.
    let statusP = false
    console.log(`[Deposit Polling] Memantau pembayaran Pakasir untuk deposit ${uniq}. Nominal: Rp ${totalAmount}`);
    
    while (!statusP) {
      await sleep(10000)
      if (Date.now() >= time) {
        statusP = true
        console.log(`[Deposit Polling] Deposit ${uniq} expired setelah 10 menit.`);
        await supabase
          .from("Deposit")
          .update({ status: 'expired' })
          .eq('kode_deposit', uniq)
        await supabase
          .from("Payment")
          .update({ status: 'expired' })
          .eq('order_id', uniq)
          .eq('status', 'pending')
        pakasir.cancelTransaction({ orderId: uniq, amount: jumlah }).catch(() => {})
        await retryBotOperation(async () => {
          return await bot.deleteMessage(ff.chat.id, ff.message_id);
        }).catch(err => {
          if (err.response?.body?.error_code !== 400) {
            console.warn('Error deleting message:', err.message);
          }
        });
        await sendMessage(chatId, `⏰ *DEPOSIT EXPIRED*
=======================
Pembayaran deposit telah expired.

Kode Deposit: \`${uniq}\`

=======================
💡 Gunakan \`/deposit\` untuk membuat deposit baru.`)
        break;
      }
      
      try {
        // Webhook may have already marked it paid; otherwise ask Pakasir directly.
        let isPaid = false
        const { data: payRow } = await supabase
          .from("Payment").select("status").eq("order_id", uniq).single()
        if (payRow && (payRow.status === 'paid' || payRow.status === 'fulfilled')) {
          isPaid = true
        } else {
          const trxDetail = await pakasir.getTransactionStatus({ orderId: uniq, amount: jumlah })
          if (trxDetail && trxDetail.status === 'completed') isPaid = true
        }

        if (isPaid) {
          // Atomically claim fulfillment so the webhook/cron cannot double-credit.
          const { data: claimed } = await supabase
            .from("Payment")
            .update({ status: 'fulfilled' })
            .eq('order_id', uniq)
            .in('status', ['pending', 'paid'])
            .select()

          statusP = true
          if (!claimed || claimed.length === 0) break;

          await supabase
            .from("Deposit")
            .update({ status: 'success' })
            .eq('kode_deposit', uniq)

          // Credit the base amount requested (Pakasir fee is payed on top by the customer).
          await addSaldo(userId, jumlah)

          await retryBotOperation(async () => {
            return await bot.deleteMessage(ff.chat.id, ff.message_id);
          }).catch(err => {
            if (err.response?.body?.error_code !== 400) {
              console.warn('Error deleting message:', err.message);
            }
          });
          const saldoBaru = await cekSaldo(userId)
          const replyKb = await generateReplyKeyboard(userId)

          await sendMessage(chatId, `✅ *DEPOSIT BERHASIL*
=======================
💰 *Jumlah:* ${formatrupiah(jumlah)}
💸 *Fee:* ${formatrupiah(pay.fee || 0)}
💵 *Total Bayar:* ${formatrupiah(totalAmount)}
🆔 *Kode Deposit:* \`${uniq}\`
💵 *Saldo Sekarang:* ${formatrupiah(saldoBaru)}
=======================
💡 Saldo telah ditambahkan ke akun Anda!`, { reply_markup: replyKb })

          await bot.sendMessage(channelContact.channelLog, `💰 *DEPOSIT BARU*
=======================
User: @${username || firstName}
Jumlah: ${formatrupiah(jumlah)}
Fee: ${formatrupiah(pay.fee || 0)}
Total: ${formatrupiah(totalAmount)}
Kode: \`${uniq}\`
Saldo Baru: ${formatrupiah(saldoBaru)}
=======================`, {
            parse_mode: "Markdown"
          })
        }
      } catch (err) {
        if (err.response) {
          console.error(`[Deposit Polling] Error API Pakasir (HTTP ${err.response.status}):`, JSON.stringify(err.response.data));
        } else {
          console.error(`[Deposit Polling] Gagal menghubungi API Pakasir:`, err.message);
        }
      }
    }
  } catch (err) {
    console.error(err)
    await sendMessage(chatId, `❌ *ERROR*
=======================
Terjadi kesalahan saat membuat deposit.

Error: \`${err.message}\`

=======================
💡 Silakan coba lagi atau hubungi admin.`)
  }
}

bot.onText(/\/setpremium/, async(msg) => {
  if (!isOwner(msg)) return await sendMessage(msg.from.id, `⚠️ Hanya bisa diakses oleh owner!`)
  let kode = msg.text.slice(12).trim()
  if (!kode) {
    return await bot.sendMessage(msg.from.id, `⭐ *CARA SET PRODUK PREMIUM*
=======================
*Format:*
\`/setpremium Kode\`

*Contoh:*
\`/setpremium spo3b\`

=======================
💡 Produk premium memerlukan persetujuan admin atau deposit untuk akses.`, { parse_mode: "Markdown" })
  }
  let { data: Premium } = await supabase
  .from("Premium")
  .select("*")
  .eq("kode", kode.toLowerCase())
  .single()
  if (Premium === null) {
    await supabase
    .from("Premium")
    .insert([{
      kode: kode.toLowerCase()
    }])
    await sendMessage(msg.from.id, `✅ *PRODUK PREMIUM BERHASIL DITAMBAHKAN*
=======================
🔖 *Kode:* \`${kode.toLowerCase()}\`
⭐ *Status:* Premium
=======================
💡 Produk ini sekarang memerlukan persetujuan admin atau deposit untuk akses.`, { parse_mode: "Markdown" })
  } else {
    await sendMessage(msg.from.id, `⚠️ *PRODUK SUDAH PREMIUM*
=======================
Kode \`${kode.toLowerCase()}\` sudah terdaftar sebagai produk premium.

=======================
💡 Produk ini sudah memiliki status premium.`, { parse_mode: "Markdown" })
  }
})

bot.onText(/\/addpremiumuser/, async (msg) => {
  if (!isOwner(msg)) return await sendMessage(msg.from.id, `⚠️ Hanya bisa diakses oleh owner!`)
  
  let text = msg.text.slice(16).trim()
  if (!text) {
    return await bot.sendMessage(msg.from.id, `⭐ *TAMBAHKAN USER KE PREMIUM*
=======================
*Format:*
\`/addpremiumuser Kode|UserID\`

*Contoh:*
\`/addpremiumuser spo3b|123456789\`
\`/addpremiumuser spo3b|@username\`

=======================
💡 Command ini memberikan akses premium tanpa deposit.`, { parse_mode: "Markdown" })
  }
  
  let parts = text.split("|")
  let kode = parts[0]?.trim().toLowerCase()
  let userIdInput = parts[1]?.trim()
  
  if (!kode || !userIdInput) {
    return await bot.sendMessage(msg.from.id, `❌ *FORMAT SALAH!*
=======================
Format yang benar:
\`/addpremiumuser Kode|UserID\`

*Contoh:*
\`/addpremiumuser spo3b|123456789\`

=======================
💡 Pisahkan kode dan UserID dengan tanda |`, { parse_mode: "Markdown" })
  }
  
  // Parse user ID (bisa berupa angka atau username)
  let userId
  if (userIdInput.startsWith("@")) {
    // Jika username, perlu dicari user ID-nya
    // Untuk sekarang, asumsikan input langsung user ID
    return await bot.sendMessage(msg.from.id, `❌ *Gunakan User ID, bukan username*
=======================
Silakan gunakan User ID numerik.
Contoh: \`/addpremiumuser spo3b|123456789\``, { parse_mode: "Markdown" })
  } else {
    userId = parseInt(userIdInput)
    if (isNaN(userId)) {
      return await bot.sendMessage(msg.from.id, `❌ *USER ID TIDAK VALID!*
=======================
User ID harus berupa angka.
Contoh: \`123456789\``, { parse_mode: "Markdown" })
    }
  }
  
  try {
    // Cek apakah produk premium ada
    let { data: Premium, error } = await supabase
      .from("Premium")
      .select("*")
      .eq("kode", kode)
      .single()
    
    if (error || Premium === null) {
      return await bot.sendMessage(msg.from.id, `❌ *PRODUK PREMIUM TIDAK DITEMUKAN*
=======================
Kode \`${kode}\` tidak terdaftar sebagai produk premium.

Gunakan \`/setpremium ${kode}\` untuk membuat produk premium terlebih dahulu.`, { parse_mode: "Markdown" })
    }
    
    // Cek apakah user sudah ada di whitelist
    if (Premium.user && Array.isArray(Premium.user) && Premium.user.includes(userId)) {
      return await bot.sendMessage(msg.from.id, `⚠️ *USER SUDAH MEMILIKI AKSES*
=======================
User ID \`${userId}\` sudah terdaftar dalam whitelist produk \`${kode.toUpperCase()}\`.

=======================
💡 User ini sudah memiliki akses premium.`, { parse_mode: "Markdown" })
    }
    
    // Tambahkan user ke array
    let userArray = Premium.user || []
    if (!Array.isArray(userArray)) {
      userArray = []
    }
    userArray.push(userId)
    
    // Update ke database
    let { error: updateError } = await supabase
      .from("Premium")
      .update({ user: userArray })
      .eq("kode", kode)
    
    if (updateError) {
      console.error("Error updating premium:", updateError)
      return await bot.sendMessage(msg.from.id, `❌ *ERROR*
=======================
Gagal menambahkan user ke premium.
Error: \`${updateError.message}\``, { parse_mode: "Markdown" })
    }
    
    // Notifikasi ke owner
    await bot.sendMessage(msg.from.id, `✅ *USER BERHASIL DITAMBAHKAN KE PREMIUM*
=======================
🔖 *Kode Produk:* \`${kode.toUpperCase()}\`
👤 *User ID:* \`${userId}\`
⭐ *Status:* Akses Premium Diberikan

=======================
💡 User sekarang memiliki akses premium tanpa deposit.`, { parse_mode: "Markdown" })
    
    // Notifikasi ke user yang diberikan akses
    try {
      await bot.sendMessage(userId, `🎉 *SELAMAT! ANDA MENDAPAT AKSES PREMIUM*
=======================
🔖 *Produk:* \`${kode.toUpperCase()}\`
⭐ *Status:* Premium Access Granted

=======================
💡 Anda sekarang dapat mengakses produk premium ini tanpa perlu deposit!`, { parse_mode: "Markdown" })
    } catch (err) {
      // Jika user belum pernah chat bot, akan error - abaikan saja
      console.log("User belum pernah chat bot:", err.message)
    }
    
    // Log ke channel log jika ada
    if (channelContact.channelLog) {
      await bot.sendMessage(channelContact.channelLog, `⭐ *PREMIUM ACCESS GRANTED*
=======================
Admin: @${msg.from.username || msg.from.first_name}
Kode: \`${kode.toUpperCase()}\`
User ID: \`${userId}\`
Waktu: ${new Date().toLocaleString('id-ID')}
=======================`, { parse_mode: "Markdown" })
    }
    
  } catch (err) {
    console.error("Error in addpremiumuser:", err)
    await bot.sendMessage(msg.from.id, `❌ *ERROR*
=======================
Terjadi kesalahan saat menambahkan user.
Error: \`${err.message}\``, { parse_mode: "Markdown" })
  }
})

bot.onText(/\/removepremiumuser/, async (msg) => {
  if (!isOwner(msg)) return await sendMessage(msg.from.id, `⚠️ Hanya bisa diakses oleh owner!`)
  
  let text = msg.text.slice(19).trim()
  if (!text) {
    return await bot.sendMessage(msg.from.id, `🗑️ *HAPUS USER DARI PREMIUM*
=======================
*Format:*
\`/removepremiumuser Kode|UserID\`

*Contoh:*
\`/removepremiumuser spo3b|123456789\`

=======================
💡 Command ini menghapus akses premium user.`, { parse_mode: "Markdown" })
  }
  
  let parts = text.split("|")
  let kode = parts[0]?.trim().toLowerCase()
  let userIdInput = parts[1]?.trim()
  
  if (!kode || !userIdInput) {
    return await bot.sendMessage(msg.from.id, `❌ *FORMAT SALAH!*
=======================
Format yang benar:
\`/removepremiumuser Kode|UserID\`

*Contoh:*
\`/removepremiumuser spo3b|123456789\`

=======================
💡 Pisahkan kode dan UserID dengan tanda |`, { parse_mode: "Markdown" })
  }
  
  let userId = parseInt(userIdInput)
  if (isNaN(userId)) {
    return await bot.sendMessage(msg.from.id, `❌ *USER ID TIDAK VALID!*
=======================
User ID harus berupa angka.
Contoh: \`123456789\``, { parse_mode: "Markdown" })
  }
  
  try {
    let { data: Premium, error } = await supabase
      .from("Premium")
      .select("*")
      .eq("kode", kode)
      .single()
    
    if (error || !Premium) {
      return await bot.sendMessage(msg.from.id, `❌ *PRODUK PREMIUM TIDAK DITEMUKAN*
=======================
Kode \`${kode}\` tidak terdaftar sebagai produk premium.`, { parse_mode: "Markdown" })
    }
    
    let userArray = Premium.user || []
    if (!Array.isArray(userArray)) {
      userArray = []
    }
    
    if (!userArray.includes(userId)) {
      return await bot.sendMessage(msg.from.id, `⚠️ *USER TIDAK MEMILIKI AKSES*
=======================
User ID \`${userId}\` tidak terdaftar dalam whitelist produk \`${kode.toUpperCase()}\`.

=======================
💡 User ini tidak memiliki akses premium.`, { parse_mode: "Markdown" })
    }
    
    userArray = userArray.filter(id => id !== userId)
    
    let { error: updateError } = await supabase
      .from("Premium")
      .update({ user: userArray })
      .eq("kode", kode)
    
    if (updateError) {
      console.error("Error updating premium:", updateError)
      return await bot.sendMessage(msg.from.id, `❌ *ERROR*
=======================
Gagal menghapus user dari premium.
Error: \`${updateError.message}\``, { parse_mode: "Markdown" })
    }
    
    await bot.sendMessage(msg.from.id, `✅ *USER BERHASIL DIHAPUS DARI PREMIUM*
=======================
🔖 *Kode Produk:* \`${kode.toUpperCase()}\`
👤 *User ID:* \`${userId}\`
🗑️ *Status:* Akses Premium Dihapus

=======================
💡 User tidak lagi memiliki akses premium.`, { parse_mode: "Markdown" })
    
    // Log ke channel log jika ada
    if (channelContact.channelLog) {
      await bot.sendMessage(channelContact.channelLog, `🗑️ *PREMIUM ACCESS REMOVED*
=======================
Admin: @${msg.from.username || msg.from.first_name}
Kode: \`${kode.toUpperCase()}\`
User ID: \`${userId}\`
Waktu: ${new Date().toLocaleString('id-ID')}
=======================`, { parse_mode: "Markdown" })
    }
    
  } catch (err) {
    console.error("Error in removepremiumuser:", err)
    await bot.sendMessage(msg.from.id, `❌ *ERROR*
=======================
Terjadi kesalahan saat menghapus user.
Error: \`${err.message}\``, { parse_mode: "Markdown" })
  }
})

// Function untuk menampilkan halaman list user dengan pagination
async function sendUserPage(users, chatId, page, msgId = null, callbackId = null, filterOptions = {}) {
  // Sort users
  let sortedUsers = [...users]
  
  switch(filterOptions.sortBy) {
    case 'spending':
      sortedUsers.sort((a, b) => (b.pengeluaran || 0) - (a.pengeluaran || 0))
      break
    case 'transactions':
      sortedUsers.sort((a, b) => (b.jumlahtransaksi || 0) - (a.jumlahtransaksi || 0))
      break
    case 'newest':
      sortedUsers.sort((a, b) => {
        const dateA = a.created_at ? new Date(a.created_at).getTime() : 0
        const dateB = b.created_at ? new Date(b.created_at).getTime() : 0
        return dateB - dateA
      })
      break
    default:
      // Default: by spending
      sortedUsers.sort((a, b) => (b.pengeluaran || 0) - (a.pengeluaran || 0))
  }
  
  // Filter users
  if (filterOptions.status === 'active') {
    sortedUsers = sortedUsers.filter(u => (u.jumlahtransaksi || 0) > 0)
  } else if (filterOptions.status === 'inactive') {
    sortedUsers = sortedUsers.filter(u => (u.jumlahtransaksi || 0) === 0)
  }
  
  // Calculate statistics
  const totalUsers = sortedUsers.length
  const activeUsers = sortedUsers.filter(u => (u.jumlahtransaksi || 0) > 0).length
  const totalPengeluaran = sortedUsers.reduce((sum, u) => sum + (u.pengeluaran || 0), 0)
  
  const totalPages = Math.ceil(sortedUsers.length / USERS_PER_PAGE)
  const start = page * USERS_PER_PAGE
  const end = start + USERS_PER_PAGE
  const items = sortedUsers.slice(start, end)

  if (callbackId) await bot.answerCallbackQuery(callbackId)
  
  // Header dengan statistik
  let text = `👥 *DAFTAR USER*
━━━━━━━━━━━━━━━━━━━━
📊 *STATISTIK*
━━━━━━━━━━━━━━━━━━━━
👤 Total User: *${totalUsers}*
✅ User Aktif: *${activeUsers}*
❌ User Tidak Aktif: *${totalUsers - activeUsers}*
💰 Total Pengeluaran: *${formatrupiah(totalPengeluaran)}*
📄 Halaman: *${page+1}/${totalPages}*
${filterOptions.statusLabel ? `📌 Filter: *${filterOptions.statusLabel}*` : ''}
━━━━━━━━━━━━━━━━━━━━

*DAFTAR:*
`
  
  if (items.length === 0) {
    text += `📭 Tidak ada user pada halaman ini.`
  } else {
    // Get user info from Telegram
    const userDetails = await Promise.all(items.map(async (user, idx) => {
      let usn = "Anonim"
      try {
        const chat = await bot.getChat(user.id)
        usn = chat.username ? `@${chat.username}` : `${chat.first_name || "Anonim"}`
      } catch (err) {
        usn = "❌ Tidak Dikenal"
      }
      
      const itemNum = start + idx + 1
      const badge = (user.jumlahtransaksi || 0) === 0 ? "❌" 
        : (user.pengeluaran || 0) > 100000 ? "🌟" 
        : (user.jumlahtransaksi || 0) >= 5 ? "⭐" 
        : "✅"
      
      return `${badge} *${itemNum}. ${usn}*
   🆔 ID: \`${user.id}\`
   📊 Transaksi: ${user.jumlahtransaksi || 0}x
   💰 Pengeluaran: ${formatrupiah(user.pengeluaran || 0)}
   💵 Saldo: ${formatrupiah(user.saldo || 0)}
━━━━━━━━━━━━━━━━━━━━`
    }))
    
    text += userDetails.join('\n')
  }

  const buttons = []
  
  // Quick actions untuk first 2 users
  if (items.length > 0) {
    const actionRow = []
    if (items[0]) actionRow.push({ text: `1️⃣ Detail`, callback_data: `user_detail_${items[0].id}` })
    if (items[1]) actionRow.push({ text: `2️⃣ Detail`, callback_data: `user_detail_${items[1].id}` })
    if (actionRow.length > 0) buttons.push(actionRow)
  }
  
  // Navigation buttons
  const navButtons = []
  if (page > 0) navButtons.push({ text: '⏪ Prev', callback_data: `user_prev:${page}_${filterOptions.filterKey || 'all'}` })
  if (page < totalPages - 1) navButtons.push({ text: 'Next ⏩', callback_data: `user_next:${page}_${filterOptions.filterKey || 'all'}` })
  if (navButtons.length > 0) buttons.push(navButtons)
  
  // Filter & Sort buttons
  buttons.push([
    { text: "🔍 Filter", callback_data: "user_filter" },
    { text: "📊 Statistik", callback_data: "user_statistik" }
  ])
  
  buttons.push([{ text: "🔙 Kembali", callback_data: "kembaliawal" }])

  const reply_markup = { inline_keyboard: buttons }

  if (msgId) {
    await bot.editMessageText(text, {
      parse_mode: "Markdown",
      chat_id: chatId,
      message_id: msgId,
      reply_markup
    }).catch(async (e) => {
      await bot.sendMessage(chatId, text, {
        parse_mode: "Markdown", reply_markup })
    })
  } else {
    await bot.sendMessage(chatId, text, {
      parse_mode: "Markdown", reply_markup })
  }
}


const retiredCmdPattern = new RegExp(
  '^\\/(' + retiredCommands.RETIRED_OWNER_COMMANDS.join('|') + ')(?:\\s|$)',
  'i'
)
bot.onText(retiredCmdPattern, async (msg) => {
  if (!isOwner(msg)) return
  const url = process.env.DASHBOARD_URL || ''
  return bot.sendMessage(msg.from.id, retiredCommands.retiredOwnerHelpText(url), {
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
  })
})

bot.onText(/\/listuser/, async (msg) => {
  if (!isOwner(msg)) return await sendMessage(msg.from.id, `⚠️ Hanya bisa diakses oleh owner!`)
  
  await bot.sendMessage(msg.from.id, `⏳ Sedang mengambil data user...`)
  
  let { data: User } = await supabase
    .from("User")
    .select("*")
  
  if (!User || User.length === 0) {
    return await bot.sendMessage(msg.from.id, `📭 *TIDAK ADA USER*
━━━━━━━━━━━━━━━━━━━━
Belum ada user yang terdaftar di database.

━━━━━━━━━━━━━━━━━━━━
💡 User akan otomatis terdaftar saat menggunakan /start.`, { parse_mode: "Markdown" })
  }
  
  await sendUserPage(User, msg.from.id, 0, null, null, {})
})

// Function untuk menampilkan halaman list produk dengan pagination
async function sendProductPage(products, chatId, page, msgId = null, callbackId = null, filterOptions = {}, isOwner = false) {
  const productStok = (p) => {
    if (p.stok_count !== undefined) return p.stok_count
    return (p.variants || []).reduce((s, v) => s + (v.stok_count || 0), 0)
  }
  const productTerjual = (p) => (p.variants || []).reduce((s, v) => s + (v.terjual || 0), 0)
  const minHarga = (p) => {
    const prices = (p.variants || []).filter((v) => v.is_active !== false).map((v) => v.harga || 0)
    return prices.length ? Math.min(...prices) : 0
  }

  let sortedProducts = [...(products || [])]

  switch (filterOptions.sortBy) {
    case 'price_high':
      sortedProducts.sort((a, b) => minHarga(b) - minHarga(a))
      break
    case 'price_low':
      sortedProducts.sort((a, b) => minHarga(a) - minHarga(b))
      break
    case 'stock_high':
      sortedProducts.sort((a, b) => productStok(b) - productStok(a))
      break
    case 'stock_low':
      sortedProducts.sort((a, b) => productStok(a) - productStok(b))
      break
    case 'sold_high':
      sortedProducts.sort((a, b) => productTerjual(b) - productTerjual(a))
      break
    case 'name':
      sortedProducts.sort((a, b) => a.nama.localeCompare(b.nama))
      break
    default:
      sortedProducts.sort((a, b) => (a.urutan || 0) - (b.urutan || 0) || a.nama.localeCompare(b.nama))
  }

  if (filterOptions.kategori) {
    sortedProducts = sortedProducts.filter((p) =>
      (p.kategori || 'umum').toLowerCase() === filterOptions.kategori.toLowerCase()
    )
  }

  if (filterOptions.status === 'habis') {
    sortedProducts = sortedProducts.filter((p) => productStok(p) === 0)
  } else if (filterOptions.status === 'rendah') {
    sortedProducts = sortedProducts.filter((p) => productStok(p) > 0 && productStok(p) <= 5)
  } else if (filterOptions.status === 'normal') {
    sortedProducts = sortedProducts.filter((p) => productStok(p) > 5 && productStok(p) <= 20)
  } else if (filterOptions.status === 'banyak') {
    sortedProducts = sortedProducts.filter((p) => productStok(p) > 20)
  } else if (filterOptions.status === 'tersedia') {
    sortedProducts = sortedProducts.filter((p) => productStok(p) > 0)
  }

  for (const p of sortedProducts) {
    if (p.stok_count === undefined) p.stok_count = productStok(p)
  }

  const totalPages = Math.max(1, Math.ceil(sortedProducts.length / PRODUCTS_PER_PAGE))
  const start = page * PRODUCTS_PER_PAGE
  const items = sortedProducts.slice(start, start + PRODUCTS_PER_PAGE)

  if (callbackId) await bot.answerCallbackQuery(callbackId)

  let rows = ''
  if (items.length === 0) {
    rows = `📭 *Tidak ada produk*`
  } else {
    items.forEach((p, idx) => {
      const itemNum = start + idx + 1
      rows += `[${itemNum}]. ${p.nama.toUpperCase()} ( ${p.stok_count} )\n`
    })
    const momentTz = require('moment-timezone')
    const formattedTime = momentTz().tz('Asia/Jakarta').format('hh:mm:ss A')
    rows += `\n📄 Halaman ${page + 1} / ${totalPages}\n`
    rows += `📅 ${formattedTime}`
  }

  const text = copy.get('screen.product_list', { rows })

  const buttons = []
  if (items.length === 0) {
    buttons.push([
      { text: '🔄 Reset Filter', callback_data: 'daftarproduk' },
      { text: '🔙 Kembali', callback_data: 'kembaliawal' },
    ])
  } else {
    let entryRow = []
    items.forEach((p, idx) => {
      if (p.stok_count === 0) return
      const itemNum = start + idx + 1
      const callback_data = `p:${p.slug}`
      if (Buffer.byteLength(callback_data, 'utf8') > 64) {
        console.error(`sendProductPage: callback_data too long, skipping: ${callback_data}`)
        return
      }
      entryRow.push({ text: `${itemNum}. ${p.nama}`, callback_data })
      if (entryRow.length === 2) {
        buttons.push(entryRow)
        entryRow = []
      }
    })
    if (entryRow.length > 0) buttons.push(entryRow)

    const navButtons = []
    if (page > 0) {
      navButtons.push({ text: '⬅️ Sebelumnya', callback_data: `produk_prev:${page}_${filterOptions.filterKey || 'all'}` })
    }
    if (page < totalPages - 1) {
      navButtons.push({ text: '➡️ Selanjutnya', callback_data: `produk_next:${page}_${filterOptions.filterKey || 'all'}` })
    }
    if (navButtons.length > 0) buttons.push(navButtons)

    if (filterOptions.filterKey === 'bestseller') {
      buttons.push([{ text: '📦 Semua Produk', callback_data: 'daftarproduk' }])
    } else {
      buttons.push([{ text: '🔥 PRODUK POPULER', callback_data: 'produk_filter_bestseller' }])
    }
    buttons.push([{ text: '🔙 Kembali', callback_data: 'kembaliawal' }])
  }

  const reply_markup = { inline_keyboard: buttons }
  if (msgId) {
    await bot.editMessageCaption(text, {
      chat_id: chatId,
      message_id: msgId,
      parse_mode: 'Markdown',
      reply_markup,
    }).catch(async () => {
      await sendBannerMessage(chatId, text, { reply_markup })
    })
  } else {
    await sendBannerMessage(chatId, text, { reply_markup })
  }
}

async function sendProductCard(chatId, slug, msgId = null) {
  try {
    const produk = await catalog.getProductBySlug(slug)
    if (!produk) {
      return bot.sendMessage(chatId, `⚠️ Produk tidak ditemukan.`)
    }
    const active = (produk.variants || []).filter((v) => v.is_active !== false)
    if (catalog.shouldSkipVariantPicker(active)) {
      return showVariantQtyScreen(chatId, msgId, active[0])
    }

    const momentTz = require('moment-timezone')
    const formattedTime = momentTz().tz('Asia/Jakarta').format('HH:mm:ss')
    const totalTerjual = active.reduce((sum, v) => sum + (v.terjual || 0), 0)
    const snkRaw = produk.snk || ''
    const snkDisplay = snkRaw.startsWith('http')
      ? `[${snkRaw.replace(/https?:\/\//, '')}](${snkRaw})`
      : snkRaw

    let variasiLines = ''
    active.forEach((v) => {
      if (v.stok_count > 0) {
        variasiLines += `*${v.label}* - ${formatrupiah(v.harga)} (Stok ${v.stok_count})\n`
      } else {
        variasiLines += `~${v.label}~ - ${formatrupiah(v.harga)} _(Habis)_\n`
      }
    })

    const text = copy.get('screen.product_card', {
      nama: produk.nama,
      deskripsi: `${totalTerjual.toLocaleString('id-ID')} Terjual`,
      snk: snkDisplay,
      variants_block: `${variasiLines}\n🕒 Diperbarui pada ${formattedTime} WIB`,
    })

    const varButtons = []
    const available = active.filter((v) => v.stok_count > 0)
    for (let i = 0; i < available.length; i += 2) {
      const row = [{ text: available[i].label, callback_data: `v:${available[i].kode}` }]
      if (available[i + 1]) {
        row.push({ text: available[i + 1].label, callback_data: `v:${available[i + 1].kode}` })
      }
      varButtons.push(row)
    }
    varButtons.push([{ text: copy.get('msg.btn_perbarui'), callback_data: `p_refresh:${slug}` }])
    varButtons.push([{ text: copy.get('msg.btn_kembali'), callback_data: 'daftarproduk' }])

    const reply_markup = { inline_keyboard: varButtons }
    if (msgId) {
      await bot.editMessageCaption(text, {
        chat_id: chatId,
        message_id: msgId,
        parse_mode: 'Markdown',
        reply_markup,
      }).catch(async () => {
        await sendBannerMessage(chatId, text, { reply_markup })
      })
    } else {
      await sendBannerMessage(chatId, text, { reply_markup })
    }
  } catch (error) {
    console.error('Error sendProductCard:', error)
    await bot.sendMessage(chatId, `⚠️ Terjadi kesalahan saat memuat produk.`)
  }
}

// Legacy alias — old callback_data may still reference grup_refresh
async function sendGroupCard(chatId, slugOrGrup, msgId = null) {
  return sendProductCard(chatId, slugOrGrup, msgId)
}

bot.onText(/\/deluser/, async (msg) => {
  if (!isOwner(msg)) return await sendMessage(msg.from.id, `⚠️ Hanya bisa diakses oleh owner!`)
  let text = msg.text.slice(9).trim()
  if (!text) {
    return await bot.sendMessage(msg.from.id, `🗑️ *CARA MENGHAPUS USER*
=======================
*Format:*
\`/deluser ID\`

*Contoh:*
\`/deluser 123456789\`

=======================
💡 Gunakan \`/listuser\` untuk melihat daftar user dan ID mereka.

⚠️ *Peringatan:* Tindakan ini tidak dapat dibatalkan!`, { parse_mode: "Markdown" })
  }
if (isNaN(text)) return await bot.sendMessage(msg.from.id, `❌ *ID TIDAK VALID*
=======================
ID harus berupa angka.
ID yang Anda masukkan: \`${text}\`

=======================
💡 Gunakan \`/listuser\` untuk melihat ID user yang valid.`, { parse_mode: "Markdown" })
text = Number(text)
let { data: User } = await supabase
.from("User")
.select("*")
let s = null
let userInfo = null
Object.keys(User).forEach((x) => {
  if (User[x].id === text) {
    s = x
    userInfo = User[x]
  }
})
if (s !== null) {
  let usn = "Anonim"
  try {
    const chat = await bot.getChat(text)
    usn = chat.username ? `@${chat.username}` : `${chat.first_name || "Anonim"}`
  } catch (err) {
    usn = "❌ Tidak Dikenal"
  }
  await supabase
  .from("User")
  .delete()
  .eq('id', text.toString())
  await sendMessage(msg.from.id, `✅ *USER BERHASIL DIHAPUS*
=======================
👤 *User:* ${usn}
🆔 *ID:* \`${text}\`
📊 *Jumlah Transaksi:* ${userInfo.jumlahtransaksi || 0}
💰 *Pengeluaran:* ${formatrupiah(userInfo.pengeluaran || 0)}
=======================
⚠️ User telah dihapus dari database.`, { parse_mode: "Markdown" })
} else {
  await bot.sendMessage(msg.from.id, `❌ *USER TIDAK DITEMUKAN*
=======================
User dengan ID \`${text}\` tidak ditemukan di database.

=======================
💡 Gunakan \`/listuser\` untuk melihat daftar user yang tersedia.`, { parse_mode: "Markdown" })
}
})

bot.onText(/\/bc/, async (msg) => {
  if (!isOwner(msg)) return await sendMessage(msg.from.id, `⚠️ Hanya bisa diakses oleh owner!`)
  let text = msg.text.slice(4).trim()
  if (!text) {
    return await bot.sendMessage(msg.from.id, `📢 *CARA BROADCAST PESAN*
=======================
*Format:*
\`/bc Pesan Anda\`

*Contoh:*
\`/bc Halo semua! Ada promo spesial hari ini 🎉\`

=======================
💡 Pesan akan dikirim ke semua user yang terdaftar di bot.`, { parse_mode: "Markdown" })
  }
let { data: User } = await supabase
.from("User")
.select("*")
if (User.length === 0) {
  return await bot.sendMessage(msg.from.id, `⚠️ *TIDAK ADA USER*
=======================
Tidak ada user yang terdaftar untuk menerima broadcast.

=======================
💡 User akan otomatis terdaftar saat menggunakan /start.`, { parse_mode: "Markdown" })
}
let i = 0
let berhasil = 0
let gagal = 0
let g = await bot.sendMessage(msg.from.id, `⏳ *MENGIRIM BROADCAST*
=======================
📊 Progress: ${i}/${User.length}
=======================`, { parse_mode: "Markdown" })
while (i < User.length) {
  try {
    await sendMessage(User[i].id, `📢 *BROADCAST*
=======================

${text}`)
    berhasil++
  } catch (err) {
    gagal++
  }
  i++
  let ed = await bot.editMessageText(`⏳ *MENGIRIM BROADCAST*
=======================
📊 Progress: ${i}/${User.length}
✅ Berhasil: ${berhasil}
❌ Gagal: ${gagal}`, {
    chat_id: g.chat.id,
    message_id: g.message_id,
    parse_mode: "Markdown"
  })
  if (i === User.length) {
    await bot.editMessageText(`✅ *BROADCAST SELESAI*
=======================
📊 *Total User:* ${User.length}
✅ *Berhasil:* ${berhasil}
❌ *Gagal:* ${gagal}
=======================
💡 Broadcast telah dikirim ke semua user.`, {
      chat_id: ed.chat.id,
      message_id: ed.message_id,
      parse_mode: "Markdown"
    })
  }
}
})

// Helper function untuk retry bot operations dengan error handling
async function retryBotOperation(operation, retries = 3, delay = 1000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const isNetworkError = 
        error.code === 'EAI_AGAIN' || 
        error.code === 'ETIMEDOUT' || 
        error.code === 'ECONNRESET' ||
        error.message?.includes('getaddrinfo') ||
        error.message?.includes('ENOTFOUND') ||
        error.message?.includes('timeout');
      
      if (isNetworkError) {
        if (attempt === retries) {
          console.error(`Bot operation failed after ${retries} attempts:`, error.message);
          throw error;
        }
        // Exponential backoff dengan jitter
        const backoffDelay = delay * Math.pow(2, attempt - 1) + Math.random() * 1000;
        console.warn(`Bot operation failed (attempt ${attempt}/${retries}), retrying in ${Math.round(backoffDelay)}ms...`, error.message);
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
      } else {
        // Non-network errors, throw immediately
        throw error;
      }
    }
  }
}

async function imageUrlToBuffer(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // Validasi URL
      if (!url) {
        throw new Error("URL tidak valid atau kosong");
      }
      
      // Pastikan URL absolut dengan protokol
      let validUrl = url.trim();
      if (!validUrl.startsWith('http://') && !validUrl.startsWith('https://')) {
        throw new Error(`URL harus dimulai dengan http:// atau https://. URL yang diterima: ${validUrl}`);
      }
      
      // Gunakan axios yang sudah ada di project (lebih stabil)
      const response = await axios.get(validUrl, { 
        responseType: 'arraybuffer',
        timeout: 30000, // 30 detik timeout
        maxRedirects: 5,
        validateStatus: function (status) {
          return status >= 200 && status < 300; // Hanya terima status 2xx
        }
      });
      
      // Convert ArrayBuffer to Buffer
      const buffer = Buffer.from(response.data);
      
      return buffer;

    } catch (error) {
      console.error(`Error fetching image (attempt ${attempt}/${retries}):`, error.message);
      
      // Jika ini attempt terakhir, throw error
      if (attempt === retries) {
        throw new Error(`Gagal mengambil gambar setelah ${retries} percobaan: ${error.message}`);
      }
      
      // Tunggu sebelum retry (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
}


bot.onText(/\/getid/, async (msg) => {
  await sendMessage(msg.from.id, "ID Kamu: `" + msg.from.id + "`")
})

bot.onText(/\/saldo/, async (msg) => {
  const saldo = await cekSaldo(msg.from.id)
  await bot.sendMessage(msg.from.id, `💰 *SALDO ANDA*
=======================
💵 *Saldo Tersedia:* ${formatrupiah(saldo)}
=======================
💡 Gunakan \`/deposit\` untuk top up saldo
💡 Gunakan \`/riwayatdeposit\` untuk melihat riwayat deposit`, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{text: "💳 Top Up Saldo", callback_data: "deposit_menu"}],
        [{text: "📋 Riwayat Deposit", callback_data: "riwayatdeposit"}],
        [{text: "🔙 Menu Utama", callback_data: "kembaliawal"}]
      ]
    }
  })
})

bot.onText(/\/deposit/, async (msg) => {
  let text = msg.text.slice(9).trim()
  if (!text) {
    return await bot.sendMessage(msg.from.id, `💳 *TOP UP SALDO*
=======================
*Format:*
\`/deposit Jumlah\`

*Contoh:*
\`/deposit 50000\`
\`/deposit 100000\`

=======================
💡 *Minimum deposit:* Rp 1.000
💡 Saldo akan ditambahkan setelah pembayaran berhasil`, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Rp 5.000", callback_data: "deposit_preset:5000" },
            { text: "Rp 10.000", callback_data: "deposit_preset:10000" }
          ],
          [
            { text: "Rp 25.000", callback_data: "deposit_preset:25000" },
            { text: "Rp 50.000", callback_data: "deposit_preset:50000" }
          ],
          [
            { text: "Rp 100.000", callback_data: "deposit_preset:100000" }
          ],
          [
            { text: "⌨️ Custom Nominal", callback_data: "deposit_custom" }
          ]
        ]
      }
    })
  }
  
  const jumlah = parseInt(text)
  if (isNaN(jumlah) || jumlah < 1000) {
    return await bot.sendMessage(msg.from.id, `❌ *JUMLAH TIDAK VALID*
=======================
Minimum deposit: *Rp 1.000*

Jumlah yang Anda masukkan: \`${text}\`

=======================
💡 Silakan masukkan jumlah minimal Rp 1.000`, {
      parse_mode: "Markdown"
    })
  }

  createDepositTransaction(msg.from.id, msg.from.username, msg.from.first_name, jumlah, msg.from.id)
})

bot.onText(/\/riwayatdeposit/, async (msg) => {
  const { data: Deposits } = await supabase
    .from("Deposit")
    .select("*")
    .eq('user_id', msg.from.id)
    .order('tanggal', { ascending: false })
    .limit(10)
  
  if (!Deposits || Deposits.length === 0) {
    return await bot.sendMessage(msg.from.id, `📋 *RIWAYAT DEPOSIT*
=======================
Belum ada riwayat deposit.

=======================
💡 Gunakan \`/deposit\` untuk top up saldo.`, {
      parse_mode: "Markdown"
    })
  }
  
  let tx = `📋 *RIWAYAT DEPOSIT*
=======================
📊 *Total:* ${Deposits.length} deposit
=======================
\n`
  
  Deposits.forEach((dep, idx) => {
    const statusEmoji = dep.status === 'success' ? '✅' : dep.status === 'pending' ? '⏳' : dep.status === 'expired' ? '⏰' : '❌'
    tx += `${statusEmoji} *${idx + 1}. ${formatrupiah(dep.jumlah)}*
🆔 Kode: \`${dep.kode_deposit}\`
💵 Total: ${formatrupiah(dep.total)}
📅 ${formatWIB(dep.tanggal)}
Status: *${dep.status.toUpperCase()}*
\n`
  })
  
  tx += `=======================`
  
  await bot.sendMessage(msg.from.id, tx, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{text: "💳 Top Up Lagi", callback_data: "deposit_menu"}],
        [{text: "🔙 Menu Utama", callback_data: "kembaliawal"}]
      ]
    }
  })
})

bot.onText(/\/delvoucher/, async (msg) => {
  if (!isOwner(msg)) return await sendMessage(msg.from.id, `⚠️ Hanya bisa diakses oleh owner!`)
  let text = msg.text.slice(12).trim()
  if (!text) {
    return await bot.sendMessage(msg.from.id, `🗑️ *CARA MENGHAPUS VOUCHER*
=======================
*Format:*
\`/delvoucher Kode\`

*Contoh:*
\`/delvoucher DISKON10K\`

=======================
⚠️ *Peringatan:* Tindakan ini tidak dapat dibatalkan!`, { parse_mode: "Markdown" })
  }
let pos = null
let voucherInfo = null
let { data: Voucher } = await supabase
.from("Voucher")
.select("*")
    Object.keys(Voucher).forEach((h) => {
      if (Voucher[h].kode.toLowerCase() === text.toLowerCase()) {
        pos = h
        voucherInfo = Voucher[h]
      }
    })
    if (pos === null) return await bot.sendMessage(msg.from.id, `❌ *VOUCHER TIDAK DITEMUKAN*
=======================
Kode voucher \`${text}\` tidak ditemukan di database.

=======================
💡 Pastikan kode voucher sudah benar.`, { parse_mode: "Markdown" })
    await supabase
      .from("Voucher")
      .delete()
      .eq('kode', text)
    await sendMessage(msg.from.id, `✅ *VOUCHER BERHASIL DIHAPUS*
=======================
🎟️ *Kode:* \`${voucherInfo.kode}\`
📦 *Produk:* ${voucherInfo.produk.join(", ")}
💰 *Potongan:* ${formatrupiah(voucherInfo.potongan)}
🔢 *Limit:* ${voucherInfo.limit}
=======================
⚠️ Voucher telah dihapus dari database.`, { parse_mode: "Markdown" })
})

bot.onText(/\/listvoucher/, async (msg) => {
  await bot.sendMessage(msg.from.id, `⏳ Sedang mengambil data voucher...`)
  
  let { data: Voucher } = await supabase
    .from("Voucher")
    .select("*")
    .order('created_at', { ascending: false })
  
  if (!Voucher || Voucher.length === 0) {
    return await sendMessage(msg.from.id, `📭 *TIDAK ADA VOUCHER*
=======================
Belum ada voucher yang tersedia di database.

=======================
💡 Hubungi admin untuk informasi lebih lanjut.`)
  }
  
  // Hitung jumlah penggunaan per voucher
  let voucherList = Voucher.map(v => {
    const usedCount = v.user ? v.user.length : 0
    const remaining = v.limit - usedCount
    const status = remaining > 0 ? '✅ Aktif' : '❌ Habis'
    
    // Format produk yang berlaku
    let produkText = 'Semua Produk'
    if (v.produk && v.produk.length > 0 && !v.produk.includes('all')) {
      produkText = v.produk.join(', ')
    }
    
    return {
      ...v,
      usedCount,
      remaining,
      status,
      produkText
    }
  })
  
  // Format pesan
  let message = `🎟️ *DAFTAR VOUCHER TERSEDIA*
=======================
*Total Voucher:* ${voucherList.length}

`
  
  voucherList.forEach((v, index) => {
    message += `━━━━━━━━━━━━━━━━━━━━
*${index + 1}. ${v.kode}*
━━━━━━━━━━━━━━━━━━━━
💰 *Potongan:* ${formatrupiah(v.potongan)}
📦 *Produk:* ${v.produkText}
🔢 *Limit:* ${v.limit} kali
👥 *Digunakan:* ${v.usedCount} kali
📊 *Sisa:* ${v.remaining} kali
${v.minimal_pembelian ? `💵 *Min. Pembelian:* ${formatrupiah(v.minimal_pembelian)}\n` : ''}${v.status}

`
  })
  
  message += `=======================
💡 *Cara Menggunakan:*
Gunakan kode voucher saat checkout untuk mendapatkan potongan harga.

=======================
📝 Ketik kode voucher saat diminta untuk menggunakan voucher.`
  
  // Split message jika terlalu panjang (Telegram limit 4096 chars)
  const MAX_MESSAGE_LENGTH = 4000
  if (message.length > MAX_MESSAGE_LENGTH) {
    // Kirim dalam beberapa bagian
    let currentMessage = `🎟️ *DAFTAR VOUCHER TERSEDIA*
=======================
*Total Voucher:* ${voucherList.length}

`
    
    for (let i = 0; i < voucherList.length; i++) {
      const v = voucherList[i]
      const voucherEntry = `━━━━━━━━━━━━━━━━━━━━
*${i + 1}. ${v.kode}*
━━━━━━━━━━━━━━━━━━━━
💰 *Potongan:* ${formatrupiah(v.potongan)}
📦 *Produk:* ${v.produkText}
🔢 *Limit:* ${v.limit} kali
👥 *Digunakan:* ${v.usedCount} kali
📊 *Sisa:* ${v.remaining} kali
${v.minimal_pembelian ? `💵 *Min. Pembelian:* ${formatrupiah(v.minimal_pembelian)}\n` : ''}${v.status}

`
      
      if (currentMessage.length + voucherEntry.length > MAX_MESSAGE_LENGTH) {
        // Kirim message saat ini
        await sendMessage(msg.from.id, currentMessage)
        // Reset untuk message berikutnya
        currentMessage = `🎟️ *DAFTAR VOUCHER (Lanjutan)*
=======================

`
      }
      
      currentMessage += voucherEntry
    }
    
    // Kirim message terakhir
    if (currentMessage.length > 50) {
      currentMessage += `=======================
💡 *Cara Menggunakan:*
Gunakan kode voucher saat checkout untuk mendapatkan potongan harga.`
      await sendMessage(msg.from.id, currentMessage)
    }
  } else {
    await sendMessage(msg.from.id, message)
  }
})

bot.onText(/\/addvoucher/, async (msg) => {
  if (!isOwner(msg)) return await sendMessage(msg.from.id, `⚠️ Hanya bisa diakses oleh owner!`)
  let text = msg.text.slice(12).trim()
  let parts = text.split("|")
  let kode = parts[0]?.trim()
  let produk = parts[1]?.trim()
  let potongan = parts[2]?.trim()
  let limit = parts[3]?.trim()
  if (!kode || !produk || !potongan || !limit) {
    return await bot.sendMessage(msg.from.id, `🎟️ *CARA MENAMBAH VOUCHER*
=======================
*Format:*
\`/addvoucher Kode|Produk|Potongan|Limit\`

*Contoh:*
\`/addvoucher DISKON10K|spo3b|10000|5\`

*Untuk multiple produk:*
\`/addvoucher DISKON10K|spo3b,spotify,netflix|10000|5\`

*Untuk semua produk:*
\`/addvoucher DISKON10K|all|10000|5\`

=======================
*Penjelasan:*
• Kode - Kode voucher (contoh: DISKON10K)
• Produk - Kode produk (pisahkan dengan koma) atau \`all\` untuk semua produk
• Potongan - Jumlah potongan harga (angka saja)
• Limit - Maksimal penggunaan voucher

=======================
💡 *Tips:* Pisahkan produk dengan koma jika lebih dari 1.`, { parse_mode: "Markdown" })
  }
if (isNaN(potongan)) return await bot.sendMessage(msg.from.id, `❌ *POTONGAN HARGA TIDAK VALID*
=======================
Potongan harga harus berupa angka.
Potongan yang Anda masukkan: \`${potongan}\``, { parse_mode: "Markdown" })
if (Number(potongan) <= 0) return await bot.sendMessage(msg.from.id, `❌ *POTONGAN HARGA TIDAK VALID*
=======================
Potongan harga harus lebih besar dari 0.
Potongan yang Anda masukkan: \`${potongan}\``, { parse_mode: "Markdown" })
if (isNaN(limit)) return await bot.sendMessage(msg.from.id, `❌ *LIMIT TIDAK VALID*
=======================
Limit harus berupa angka.
Limit yang Anda masukkan: \`${limit}\``, { parse_mode: "Markdown" })
if (Number(limit) <= 0) return await bot.sendMessage(msg.from.id, `❌ *LIMIT TIDAK VALID*
=======================
Limit harus lebih besar dari 0.
Limit yang Anda masukkan: \`${limit}\``, { parse_mode: "Markdown" })
let pos = null
let { data: Voucher } = await supabase
.from("Voucher")
.select("*")
    Object.keys(Voucher).forEach((h) => {
      if (Voucher[h].kode.toLowerCase() === kode.toLowerCase()) pos = h
    })
    if (pos !== null) return await bot.sendMessage(msg.from.id, `❌ *VOUCHER SUDAH ADA*
=======================
Kode voucher \`${kode}\` sudah terdaftar di database.

=======================
💡 Gunakan kode voucher yang berbeda.`, { parse_mode: "Markdown" })
    await supabase
    .from("Voucher")
    .insert([{
      kode: kode,
      produk: produk.split(",").map(p => p.trim()),
      potongan: Number(potongan),
      limit: Number(limit),
      user: []
    }])
    await sendMessage(msg.from.id, `✅ *VOUCHER BERHASIL DITAMBAHKAN*
=======================
🎟️ *Kode:* \`${kode}\`
📦 *Produk:* ${produk === "all" ? "Semua Produk" : produk}
💰 *Potongan:* ${formatrupiah(Number(potongan))}
🔢 *Limit:* ${limit} penggunaan
=======================
💡 Voucher siap digunakan!`, { parse_mode: "Markdown" })
})

bot.onText(/\/start/, async (msg) => {
  try {
    // Cek registrasi user dulu (bisa parallel dengan query lain)
    const isReg = await isRegistered(msg.from.id)
    
    // Parallel queries untuk semua data yang dibutuhkan (LEBIH CEPAT!)
    const [
      trxCountResult,
      userCountResult,
      stoktersedia,
      stokterjual,
      userSaldo
    ] = await Promise.all([
      // Count transaksi (lebih cepat dari select *)
      supabase.from("Trx").select("*", { count: 'exact', head: true }),
      // Count user (lebih cepat dari select *)
      supabase.from("User").select("*", { count: 'exact', head: true }),
      // Total stok tersedia (1 query langsung)
      getTotalStokTersedia(),
      // Total stok terjual (1 query dengan SUM)
      getTotalStokTerjual(),
      // Saldo user
      cekSaldo(msg.from.id)
    ])
    
    // Insert user jika belum terdaftar
    if (!isReg) {
      await supabase.from('User').insert([{
        id: msg.from.id,
        jumlahtransaksi: 0,
        pengeluaran: 0
      }])
      // Update count jika user baru ditambahkan
      if (userCountResult.count !== undefined) {
        userCountResult.count += 1
      }
    }
    
    // Extract counts
    const trxCount = trxCountResult.count || 0
    const userCount = userCountResult.count || 0
    
    // Kirim foto + teks dalam satu bubble (banner merged)
    if (flow.isEnabled()) {
      await dispatchFlow(msg.from.id, flow.getEntryKey(), {
        firstName: msg.from.first_name,
        push: false,
      })
    } else {
      await sendBannerMessage(msg.from.id, welcomeCaption({
        first_name: msg.from.first_name,
        user_count: userCount,
        stok_terjual: stokterjual,
        stok_tersedia: stoktersedia,
        saldo: userSaldo,
      }), {
        reply_markup: welcomeInlineKeyboard()
      })
    }

    const replyKb = await generateReplyKeyboard(msg.from.id)
    await bot.sendMessage(msg.from.id, copy.get('msg.reply_nav_enabled'), {
      reply_markup: replyKb
    })
  } catch (error) {
    console.error('Error in /start:', error)
    await bot.sendMessage(msg.from.id, `⚠️ Terjadi kesalahan saat memuat data. Silakan coba lagi.`)
  }
})


bot.onText(/\/rekap/, async (msg) => {
  if (!isOwner(msg)) return await sendMessage(msg.from.id, `⚠️ Hanya bisa diakses oleh owner!`)
  const tahun = new Date().getFullYear()
  const keyboard = generateTahunKeyboard(tahun)
  await bot.sendMessage(msg.from.id, `📅 *REKAP TRANSAKSI*
=======================
Pilih bulan untuk melihat rekap transaksi tahun *${tahun}*:`, {
    reply_markup: keyboard,
    parse_mode: "Markdown"
  })
})

bot.onText(/\/stok/, async (msg) => {

  try {
    let { data: Produk } = await supabase
      .from("Produk")
      .select("*")
    
    if (!Produk || Produk.length === 0) {
      await bot.sendMessage(msg.from.id, `⚠️ *TIDAK ADA PRODUK*
━━━━━━━━━━━━━━━━━━━━
Belum ada produk yang terdaftar.

━━━━━━━━━━━━━━━━━━━━
💡 Gunakan \`/addproduk\` untuk menambah produk.`, { parse_mode: "Markdown" })
      return
    }
    
    // Hitung stok untuk setiap produk
    const ProdukWithStok = await Promise.all(Produk.map(async (p) => {
      const stokCount = await getStokCount(p.kode)
      return { ...p, stok_count: stokCount }
    }))
    
    // Calculate statistics
    let totalStok = 0
    let totalTerjual = 0
    let produkHabis = 0
    let produkRendah = 0
    
    ProdukWithStok.forEach(p => {
      totalStok += p.stok_count || 0
      totalTerjual += p.terjual || 0
      if (p.stok_count === 0) produkHabis++
      else if (p.stok_count <= 5) produkRendah++
    })
    
    let tx = `📦 *STOK PRODUK*
━━━━━━━━━━━━━━━━━━━━
📊 *STATISTIK*
━━━━━━━━━━━━━━━━━━━━
📦 Total Stok: *${totalStok}*
💰 Total Terjual: *${totalTerjual}*
❌ Produk Habis: *${produkHabis}*
⚠️ Stok Rendah (≤5): *${produkRendah}*
━━━━━━━━━━━━━━━━━━━━

*DAFTAR PRODUK:*
`
    
    // Sort by stock (lowest first, then by name)
    const sortedProduk = [...ProdukWithStok].sort((a, b) => {
      if (a.stok_count === 0 && b.stok_count > 0) return -1
      if (a.stok_count > 0 && b.stok_count === 0) return 1
      if (a.stok_count !== b.stok_count) return a.stok_count - b.stok_count
      return a.nama.localeCompare(b.nama)
    })
    
    sortedProduk.forEach((p) => {
      let emoji = ""
      let status = ""
      if (p.stok_count === 0) {
        emoji = "❌"
        status = "HABIS"
      } else if (p.stok_count <= 5) {
        emoji = "⚠️"
        status = "RENDAH"
      } else if (p.stok_count <= 20) {
        emoji = "✅"
        status = "NORMAL"
      } else {
        emoji = "🟢"
        status = "BANYAK"
      }
      
      const persentase = p.terjual > 0 ? Math.round((p.terjual / (p.terjual + p.stok_count)) * 100) : 0
      
      tx += `${emoji} *${p.nama.toUpperCase()}*
📊 Stok: *${p.stok_count}* | Terjual: *${p.terjual}* | ${persentase}% terjual
🔖 Kode: \`${p.kode}\` | 💰 ${formatrupiah(p.harga)}
━━━━━━━━━━━━━━━━━━━━\n`
    })
    
    // Create inline keyboard with actions
    const buttons = []
    
    // Filter buttons
    buttons.push([
      { text: "🔍 Filter", callback_data: "stok_filter" },
      { text: "📊 Statistik", callback_data: "stok_statistik" }
    ])
    
    // Product buttons (first 6 products, 2 per row)
    const productRows = []
    for (let i = 0; i < Math.min(6, sortedProduk.length); i += 2) {
      const row = []
      row.push({ 
        text: `${i + 1}️⃣ ${sortedProduk[i].nama.substring(0, 15)}${sortedProduk[i].nama.length > 15 ? '...' : ''}`, 
        callback_data: `stok_detail_${sortedProduk[i].kode}` 
      })
      if (sortedProduk[i + 1]) {
        row.push({ 
          text: `${i + 2}️⃣ ${sortedProduk[i + 1].nama.substring(0, 15)}${sortedProduk[i + 1].nama.length > 15 ? '...' : ''}`, 
          callback_data: `stok_detail_${sortedProduk[i + 1].kode}` 
        })
      }
      productRows.push(row)
    }
    buttons.push(...productRows)
    
    // Action buttons (only for owner)
    if (msg.from.id === OwnerID) {
      buttons.push([
        { text: "➕ Tambah Stok", callback_data: "addstok" },
      ])
    }
    
    buttons.push([{ text: "🔙 Kembali", callback_data: "kembaliawal" }])
    
    await bot.sendMessage(msg.from.id, tx, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: buttons
      }
    })
  } catch (error) {
    console.error('Error in /stok:', error)
    await bot.sendMessage(msg.from.id, `⚠️ Terjadi kesalahan saat memuat data stok.`)
  }
})

function flowUrlResolver(name) {
  if (name === 'channel_store') return channelContact.channelStore
  if (name === 'cs') return channelContact.cs
  return ''
}

async function collectWelcomeVars(userId, firstName) {
  const [trxCountResult, userCountResult, stoktersedia, stokterjual, userSaldo] = await Promise.all([
    supabase.from('Trx').select('*', { count: 'exact', head: true }),
    supabase.from('User').select('*', { count: 'exact', head: true }),
    getTotalStokTersedia(),
    getTotalStokTerjual(),
    cekSaldo(userId),
  ])
  return {
    first_name: firstName || 'User',
    nama_bot: NamaBot,
    user_count: userCountResult.count || 0,
    stok_terjual: stokterjual,
    stok_tersedia: stoktersedia,
    saldo: formatrupiah(userSaldo),
  }
}

async function openProductList(query) {
  const { data: Produk } = await supabase.from('Produk').select('*')

  try {
    await bot.deleteMessage(query.message.chat.id, query.message.message_id)
  } catch (e) {
    // Ignore if message already deleted
  }

  if (!Produk || Produk.length === 0) {
    return bot.sendMessage(query.from.id, `⚠️ *BELUM ADA PRODUK*
━━━━━━━━━━━━━━━━━━━━
Belum ada produk yang terdaftar.

━━━━━━━━━━━━━━━━━━━━
💡 Hubungi admin untuk informasi lebih lanjut.`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔙 Kembali', callback_data: 'kembaliawal' }],
        ],
      },
    })
  }

  const ProdukWithStok = await Promise.all(Produk.map(async (p) => {
    const stokCount = await getStokCount(p.kode)
    return { ...p, stok_count: stokCount }
  }))

  const isOwnerUser = isOwner(query)
  await sendProductPage(ProdukWithStok, query.from.id, 0, query.message.message_id, query.id, {}, isOwnerUser)
}

async function openKategoriMenu(query) {
  const { data: Produk } = await supabase.from('Produk').select('*')

  if (!Produk || Produk.length === 0) {
    await bot.answerCallbackQuery(query.id, { text: '⚠️ Belum ada produk!', show_alert: true })
    return
  }

  const kategoriCount = {}
  const kategoriList = ['game', 'streaming', 'software', 'social media', 'voucher', 'education', 'umum']

  Produk.forEach((p) => {
    const kat = (p.kategori || 'umum').toLowerCase()
    kategoriCount[kat] = (kategoriCount[kat] || 0) + 1
  })

  let text = `📂 *PILIH KATEGORI*
━━━━━━━━━━━━━━━━━━━━
Pilih kategori produk yang ingin dilihat:

━━━━━━━━━━━━━━━━━━━━
`

  kategoriList.forEach((kat) => {
    const count = kategoriCount[kat] || 0
    if (count > 0) {
      const emoji = getKategoriEmoji(kat)
      const name = getKategoriName(kat)
      text += `${emoji} *${name}* (${count} produk)\n`
    }
  })

  text += `\n━━━━━━━━━━━━━━━━━━━━
💡 Pilih kategori untuk melihat produk`

  const buttons = []
  const kategoriButtons = []

  kategoriList.forEach((kat) => {
    const count = kategoriCount[kat] || 0
    if (count > 0) {
      const emoji = getKategoriEmoji(kat)
      const name = getKategoriName(kat)

      if (kategoriButtons.length === 0 || kategoriButtons[kategoriButtons.length - 1].length === 2) {
        kategoriButtons.push([{
          text: `${emoji} ${name}`,
          callback_data: `kategori_${kat}`,
        }])
      } else {
        kategoriButtons[kategoriButtons.length - 1].push({
          text: `${emoji} ${name}`,
          callback_data: `kategori_${kat}`,
        })
      }
    }
  })

  buttons.push(...kategoriButtons)
  buttons.push([{ text: '📦 Semua Produk', callback_data: 'daftarproduk' }])
  buttons.push([{ text: '🔙 Kembali', callback_data: 'kembaliawal' }])

  await bot.answerCallbackQuery(query.id)
  await editOrSendBannerMessage(query.from.id, query.message.message_id, text, {
    reply_markup: { inline_keyboard: buttons },
  })
}

async function openStokBuyer(query) {
  const { data: Produk } = await supabase.from('Produk').select('*')

  if (!Produk || Produk.length === 0) {
    await bot.answerCallbackQuery(query.id)
    await sendMessage(query.from.id, `⚠️ *TIDAK ADA PRODUK*
━━━━━━━━━━━━━━━━━━━━
Belum ada produk yang terdaftar.

━━━━━━━━━━━━━━━━━━━━
💡 Gunakan \`/addproduk\` untuk menambah produk.`, { parse_mode: 'Markdown' })
    return
  }

  const ProdukWithStok = await Promise.all(Produk.map(async (p) => {
    const stokCount = await getStokCount(p.kode)
    return { ...p, stok_count: stokCount }
  }))

  let totalStok = 0
  let totalTerjual = 0
  let produkHabis = 0
  let produkRendah = 0

  ProdukWithStok.forEach((p) => {
    totalStok += p.stok_count || 0
    totalTerjual += p.terjual || 0
    if (p.stok_count === 0) produkHabis++
    else if (p.stok_count <= 5) produkRendah++
  })

  let tx = `📦 *STOK PRODUK*
━━━━━━━━━━━━━━━━━━━━
📊 *STATISTIK*
━━━━━━━━━━━━━━━━━━━━
📦 Total Stok: *${totalStok}*
💰 Total Terjual: *${totalTerjual}*
❌ Produk Habis: *${produkHabis}*
⚠️ Stok Rendah (≤5): *${produkRendah}*
━━━━━━━━━━━━━━━━━━━━

*DAFTAR PRODUK:*
`

  const sortedProduk = [...ProdukWithStok].sort((a, b) => {
    if (a.stok_count === 0 && b.stok_count > 0) return -1
    if (a.stok_count > 0 && b.stok_count === 0) return 1
    if (a.stok_count !== b.stok_count) return a.stok_count - b.stok_count
    return a.nama.localeCompare(b.nama)
  })

  sortedProduk.forEach((p) => {
    let emoji = ''
    if (p.stok_count === 0) emoji = '❌'
    else if (p.stok_count <= 5) emoji = '⚠️'
    else if (p.stok_count <= 20) emoji = '✅'
    else emoji = '🟢'

    const persentase = p.terjual > 0 ? Math.round((p.terjual / (p.terjual + p.stok_count)) * 100) : 0

    tx += `${emoji} *${p.nama.toUpperCase()}*
📊 Stok: *${p.stok_count}* | Terjual: *${p.terjual}* | ${persentase}% terjual
🔖 Kode: \`${p.kode}\` | 💰 ${formatrupiah(p.harga)}
━━━━━━━━━━━━━━━━━━━━\n`
  })

  const buttons = []
  buttons.push([
    { text: '🔍 Filter', callback_data: 'stok_filter' },
    { text: '📊 Statistik', callback_data: 'stok_statistik' },
  ])

  const productRows = []
  for (let i = 0; i < Math.min(6, sortedProduk.length); i += 2) {
    const row = []
    row.push({
      text: `${i + 1}️⃣ ${sortedProduk[i].nama.substring(0, 15)}${sortedProduk[i].nama.length > 15 ? '...' : ''}`,
      callback_data: `stok_detail_${sortedProduk[i].kode}`,
    })
    if (sortedProduk[i + 1]) {
      row.push({
        text: `${i + 2}️⃣ ${sortedProduk[i + 1].nama.substring(0, 15)}${sortedProduk[i + 1].nama.length > 15 ? '...' : ''}`,
        callback_data: `stok_detail_${sortedProduk[i + 1].kode}`,
      })
    }
    productRows.push(row)
  }
  buttons.push(...productRows)

  if (query.from.id === OwnerID) {
    buttons.push([
      { text: '➕ Tambah Stok', callback_data: 'addstok' },
    ])
  }

  buttons.push([{ text: '🔙 Kembali', callback_data: 'kembaliawal' }])

  await bot.answerCallbackQuery(query.id)
  await bot.sendMessage(query.from.id, tx, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons },
  })
}

async function openRiwayat(query) {
  const { data: Trx } = await supabase.from('Trx').select('*')
  if (!Trx || Trx.length === 0) {
    return sendMessage(query.from.id, '⚠️ Belum ada transaksi apapun!')
  }
  await bot.deleteMessage(query.message.chat.id, query.message.message_id)
  await sendPage(Trx, query.from.id, 0)
}

async function handleFlowResult(userId, result, { msgId = null, query = null } = {}) {
  if (!result || result.type === 'error') {
    console.error('[flow]', result && result.message)
    return false
  }
  if (result.type === 'screen') {
    if (msgId) {
      await editOrSendBannerMessage(userId, msgId, result.caption, { reply_markup: result.reply_markup })
    } else {
      await sendBannerMessage(userId, result.caption, { reply_markup: result.reply_markup })
    }
    return true
  }
  if (result.type === 'action') {
    if (!query) {
      console.error('[flow] action requires query context')
      return false
    }
    switch (result.action) {
      case 'product_list':
        await openProductList(query)
        break
      case 'kategori_menu':
        await openKategoriMenu(query)
        break
      case 'stok':
        await openStokBuyer(query)
        break
      case 'riwayat':
        await openRiwayat(query)
        break
      default:
        return false
    }
    return true
  }
  return false
}

async function dispatchFlow(userId, nodeKey, { msgId = null, push, firstName, query = null } = {}) {
  const entry = flow.getEntryKey()
  const vars = nodeKey === entry || nodeKey === 'welcome'
    ? await collectWelcomeVars(userId, firstName)
    : {
        first_name: firstName || 'User',
        nama_bot: NamaBot,
        saldo: formatrupiah(await cekSaldo(userId)),
      }
  const result = await flow.goto(userId, nodeKey, {
    vars,
    push: push !== undefined ? push : nodeKey !== entry,
    urlResolver: flowUrlResolver,
  })
  return handleFlowResult(userId, result, { msgId, query })
}

bot.on("callback_query", async (query) => {
  let cmd = query.data
 //await bot.answerCallbackQuery(query.id, { text: "⏳ Harap tunggu sebentar..." })
try {
  // Handler: user picks a variant from product card
  if (cmd.startsWith('v:') || cmd.startsWith('pilih_variasi:')) {
    const kode = cmd.includes(':') ? cmd.split(':').slice(1).join(':') : ''
    await bot.answerCallbackQuery(query.id)
    const varian = await catalog.getVariantByKode(kode)
    if (!varian) return bot.sendMessage(query.from.id, `⚠️ Produk tidak ditemukan!`)
    const stokCount = await getStokCount(varian.kode)
    if (stokCount === 0) {
      return bot.answerCallbackQuery(query.id, { text: `⚠️ Stok ${varian.label} habis!`, show_alert: true })
    }
    await showVariantQtyScreen(query.from.id, query.message.message_id, varian)
    return
  }

  if (cmd.startsWith('p:')) {
    const slug = cmd.slice(2)
    await bot.answerCallbackQuery(query.id)
    await sendProductCard(query.from.id, slug, query.message.message_id)
    return
  }

  if (cmd.startsWith('p_refresh:')) {
    const slug = cmd.slice('p_refresh:'.length)
    await bot.answerCallbackQuery(query.id, { text: '🔄 Memperbarui data...' })
    await sendProductCard(query.from.id, slug, query.message.message_id)
    return
  }

  // Legacy: grup_refresh / old slug buttons
  if (cmd.startsWith('grup_refresh:')) {
    const slug = cmd.slice('grup_refresh:'.length)
    await bot.answerCallbackQuery(query.id, { text: '🔄 Memperbarui data...' })
    await sendProductCard(query.from.id, slug, query.message.message_id)
    return
  }

  if (cmd.startsWith('deposit_preset:')) {
    const amount = parseInt(cmd.split(':')[1])
    await bot.answerCallbackQuery(query.id, { text: `💸 Menyiapkan deposit Rp ${formatrupiah(amount)}` })
    try {
      await bot.deleteMessage(query.message.chat.id, query.message.message_id)
    } catch (e) {}
    createDepositTransaction(query.from.id, query.from.username, query.from.first_name, amount, query.message.chat.id)
    return
  }
  
  if (cmd === 'deposit_custom') {
    await bot.answerCallbackQuery(query.id)
    await bot.sendMessage(query.message.chat.id, `⌨️ *CUSTOM DEPOSIT NOMINAL*
=======================
Silakan ketik \`/deposit <jumlah>\` untuk melakukan top up saldo dengan nominal kustom.

*Contoh:*
\`/deposit 15000\` (untuk deposit Rp 15.000)
=======================
💡 Batas minimal deposit adalah *Rp 1.000*`, {
      parse_mode: "Markdown"
    })
    return
  }

  if (flow.isEnabled()) {
    const flowKey = flow.parseFlowCallback(cmd) || flow.legacyToKey(cmd)
    if (flowKey) {
      await bot.answerCallbackQuery(query.id).catch(() => {})
      await dispatchFlow(query.from.id, flowKey, {
        msgId: query.message?.message_id,
        firstName: query.from.first_name,
        push: flowKey !== flow.getEntryKey(),
        query,
      })
      return
    }
  }

  if (cmd.startsWith('bulan_')) {
    const [_, bulan, tahun] = cmd.split('_')
    let { data: Trx } = await supabase
.from("Trx")
.select("*")
    const { text } = await rekapBulanTahun(Trx, parseInt(bulan), parseInt(tahun));

    await bot.editMessageText(text, {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔙 Kembali ke Tahun', callback_data: `tahun_${tahun}` }]
        ]
      }
    })
   await bot.answerCallbackQuery(query.id)
  }
  
  if (cmd.startsWith('tahun_')) {
    const tahun = parseInt(cmd.split('_')[1])
    const keyboard = generateTahunKeyboard(tahun)

    await bot.editMessageText(`📅 Pilih bulan untuk melihat rekap tahun ${tahun}:`, {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      reply_markup: keyboard
    })

   await bot.answerCallbackQuery(query.id)
  }
  
  if (cmd.startsWith("prev:") || cmd.startsWith("next:")) {
    let { data: Trx } = await supabase
.from("Trx")
.select("*")
    let parts = cmd.split("_")
    let [action, pageStr] = parts[0].split(":")
    let page = parseInt(pageStr)
    let filterKey = parts[1] || 'all'
    
    if (action === "next") page++
    if (action === "prev") page--
    
    // Apply filter based on filterKey
    let filterOptions = {}
    const now = new Date()
    
    switch(filterKey) {
      case 'today':
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        filterOptions = { startDate: todayStart, periodLabel: 'Hari Ini', filterKey: 'today' }
        break
      case 'week':
        const weekStart = new Date(now)
        weekStart.setDate(now.getDate() - 7)
        filterOptions = { startDate: weekStart, periodLabel: '7 Hari Terakhir', filterKey: 'week' }
        break
      case 'month':
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
        filterOptions = { startDate: monthStart, periodLabel: 'Bulan Ini', filterKey: 'month' }
        break
      case 'lastmonth':
        const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
        const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59)
        filterOptions = { startDate: lastMonthStart, endDate: lastMonthEnd, periodLabel: 'Bulan Lalu', filterKey: 'lastmonth' }
        break
      default:
        filterOptions = { filterKey: 'all' }
    }
    
    await sendPage(Trx, query.message.chat.id, page, query.message.message_id, query.id, filterOptions)
  }
  if (cmd.startsWith("buypremium:")) {
    const kode = cmd.split(":")[1]
    
    // Cek saldo user
    const userSaldo = await cekSaldo(query.from.id)
    const minimalSaldo = 40000
    
    if (userSaldo < minimalSaldo) {
      return await sendMessage(query.from.id, `❌ *SALDO TIDAK MENCUKUPI*
━━━━━━━━━━━━━━━━━━━━
Saldo Anda: *${formatrupiah(userSaldo)}*
Saldo Minimal: *${formatrupiah(minimalSaldo)}*

━━━━━━━━━━━━━━━━━━━━
💡 Anda perlu memiliki saldo mengendap minimal *${formatrupiah(minimalSaldo)}* untuk mengakses produk premium.

💡 Saldo ini akan tetap di akun Anda, hanya digunakan sebagai jaminan akses.`, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "💰 Deposit Saldo", callback_data: "saldomenu" }],
            [{ text: "🔙 Kembali", callback_data: "kembaliawal" }]
          ]
        }
      })
    }
    
    // Cek apakah produk premium ada
    let { data: Premium } = await supabase
      .from("Premium")
      .select("*")
      .eq("kode", kode)
      .single()
    
    if (!Premium) {
      return await sendMessage(query.from.id, `❌ *PRODUK PREMIUM TIDAK DITEMUKAN*
━━━━━━━━━━━━━━━━━━━━
Kode produk \`${kode.toUpperCase()}\` tidak terdaftar sebagai produk premium.

━━━━━━━━━━━━━━━━━━━━
💡 Hubungi admin untuk informasi lebih lanjut.`, {
        parse_mode: "Markdown"
      })
    }
    
    // Cek apakah user sudah ada di whitelist
    if (Premium.user && Array.isArray(Premium.user) && Premium.user.includes(query.from.id)) {
      return await sendMessage(query.from.id, `✅ *ANDA SUDAH MEMILIKI AKSES*
━━━━━━━━━━━━━━━━━━━━
Anda sudah terdaftar dalam whitelist produk *${kode.toUpperCase()}*.

━━━━━━━━━━━━━━━━━━━━
💡 Anda sudah bisa membeli produk ini.`, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "📦 Lihat Produk", callback_data: "daftarproduk" }]
          ]
        }
      })
    }
    
    // Tambahkan user ke whitelist premium
    let userArray = Premium.user || []
    if (!Array.isArray(userArray)) {
      userArray = []
    }
    userArray.push(query.from.id)
    
    // Update ke database
    let { error: updateError } = await supabase
      .from("Premium")
      .update({ user: userArray })
      .eq("kode", kode)
    
    if (updateError) {
      console.error("Error updating premium:", updateError)
      return await sendMessage(query.from.id, `❌ *ERROR*
━━━━━━━━━━━━━━━━━━━━
Gagal memberikan akses premium.
Error: \`${updateError.message}\`

━━━━━━━━━━━━━━━━━━━━
💡 Silakan coba lagi atau hubungi admin.`, {
        parse_mode: "Markdown"
      })
    }
    
    // Berhasil memberikan akses
    await sendMessage(query.from.id, `✅ *AKSES PREMIUM DIBERIKAN*
━━━━━━━━━━━━━━━━━━━━
Anda sekarang terdaftar dalam whitelist produk *${kode.toUpperCase()}*.

━━━━━━━━━━━━━━━━━━━━
💰 *Saldo Anda:* ${formatrupiah(userSaldo)}
💡 Saldo Anda tetap utuh, hanya digunakan sebagai jaminan akses.

━━━━━━━━━━━━━━━━━━━━
📦 Anda sekarang bisa membeli produk ini!`, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "📦 Beli Produk", callback_data: `item:${kode}` }],
          [{ text: "🔙 Kembali", callback_data: "kembaliawal" }]
        ]
      }
    })
  }
if (cmd.startsWith('item:')) {
  const itemName = cmd.split(':')[1];
  let { data: Premium } = await supabase
  .from("Premium")
  .select("*")
  .eq("kode", itemName.toLowerCase())
  .single()
  if (Premium !== null) {
    let user = Premium.user.find(x => x === query.from.id)
    if (!user) {
      // Cek saldo user
      const userSaldo = await cekSaldo(query.from.id)
      const minimalSaldo = 40000
      
      const buttons = []
      if (userSaldo >= minimalSaldo) {
        buttons.push([{text: "✅ Dapatkan Akses", callback_data: `buypremium:${itemName.toLowerCase()}`}])
      } else {
        buttons.push([{text: "💰 Deposit Saldo", callback_data: "saldomenu"}])
      }
      buttons.push([{text: "🔙 Kembali", callback_data: "kembaliawal"}])
      
      await bot.sendMessage(query.from.id, `🔒 Produk Eksklusif

Produk *${itemName.toUpperCase()}* memerlukan akses premium.

━━━━━━━━━━━━━━━━━━━━

💡 *Cara Mendapatkan Akses:*

Anda perlu memiliki saldo mengendap minimal *${formatrupiah(minimalSaldo)}* di akun Anda.

💰 *Saldo Anda Saat Ini:* ${formatrupiah(userSaldo)}
${userSaldo >= minimalSaldo ? '✅ Saldo Anda mencukupi!' : `❌ Saldo Anda belum mencukupi (kurang ${formatrupiah(minimalSaldo - userSaldo)})`}

ℹ️ *Catatan:* Saldo ini akan tetap di akun Anda, hanya digunakan sebagai jaminan akses. Saldo tidak akan dikurangi.

${userSaldo >= minimalSaldo ? 'Klik tombol di bawah untuk mendapatkan akses:' : 'Silakan deposit terlebih dahulu untuk mendapatkan akses:'}`, {
  parse_mode: "Markdown",
  reply_markup: {
    inline_keyboard: buttons
  }
})
      return
    }
  }
  const item = await getVarianForCart(itemName.toLowerCase())
    console.log(item)
    if (item) {
      const stokCount = item.stok_count
      
      let Unique = require("crypto").randomBytes(6).toString("hex").toUpperCase()
      let data = {
        id: query.from.id,
        kode: item.kode,
        jumlah: 1,
        trxid: Unique,
        voucher: "",
        voucher_status: "",
        selectedStokIds: []
      }
      await cart.save(query.from.id, data)
      
      const stokItems = await getStokItems(item.kode, 1)
      const sampleData = stokItems.length > 0 ? [stokItems[0].data] : []
      detectProductFormat(sampleData, item.format)
      
      const momentTz = require('moment-timezone')
      const formattedTime = momentTz().tz("Asia/Jakarta").format("hh:mm:ss A")

      await editOrSendBannerMessage(query.from.id, query.message.message_id, `tambahkan jumlah pembelian:

┌──────────────────
│ • Produk : ${item.namaProduk.toUpperCase()} — ${item.namaLabel.toUpperCase()}
│ • Stok Terjual : ${item.terjual || 0}
│ • Desk : ${item.deskripsi}
└──────────────────

┌──────────────────
│ Variasi, Harga - (Stok):
│ • ${item.namaLabel}: ${formatrupiah(item.harga)} - (${stokCount})
└──────────────────

Current Date: ${formattedTime}`, {
        reply_markup: {
          inline_keyboard: [
            [{text: `${item.namaLabel} (${stokCount})`, callback_data: "lanjut"}],
            [{text: "🔙 Kembali", callback_data: "daftarproduk"}]
          ]
        }
      })
    } else {
      await bot.sendMessage(query.from.id, `⚠️ Produk tidak ditemukan, mungkin sudah dihapus!`)
    }
}



if (cmd === "lanjut") {
  if (await cart.exists(query.from.id)) {
    await bot.deleteMessage(query.message.chat.id, query.message.message_id)
    let Data = await cart.get(query.from.id)
    const item = await getVarianForCart(Data.kode)
    if (!item) return await sendMessage(query.from.id, `⚠️ Produk tidak ditemukan, harap ulangi pilih produk!`)
    
    const stokCount = item.stok_count
    
    if (stokCount === 0) {
      return await sendMessage(query.from.id, `⚠️ *STOK KOSONG*

Produk *${item.nama}* tidak memiliki stok tersedia.

━━━━━━━━━━━━━━━━━━━━
💡 Silakan pilih produk lain.`, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{text: "🔙 Kembali", callback_data: "kembaliawal"}]
          ]
        }
      })
    }
    
    // Ambil semua stok tersedia dengan timestamp
    const allStokItems = await getStokItems(item.kode)
    const tersediaItems = allStokItems.filter(s => s.status === 'tersedia')
    
    // Inisialisasi selectedStokIds jika belum ada
    if (!Data.selectedStokIds) {
      Data.selectedStokIds = []
      await cart.save(query.from.id, Data)
    }
    
    // Tampilkan stok dengan timestamp dan tombol pilih
    const qtyPilih = Data.selectedStokIds.length
    const resolvedPick = await hargaUntukQty(item, qtyPilih || 1)
    const totalPembayaran = qtyPilih ? resolvedPick.subtotal : resolvedPick.harga_satuan
    let stokText = `📦 *PILIH STOK YANG INGIN DIBELI*
━━━━━━━━━━━━━━━━━━━━
🛍️ *Produk:* ${item.nama}
💰 *Harga Satuan:* ${formatrupiah(resolvedPick.harga_satuan)}
📊 *Stok Tersedia:* ${tersediaItems.length} item
✅ *Dipilih:* ${Data.selectedStokIds.length} item
💵 *Total Pembayaran:* ${formatrupiah(totalPembayaran)}

💡 *Cara:* Gunakan tombol increment di bawah untuk memilih jumlah stok`
    
    // Keyboard sesuai dengan screenshot
    const keyboard = [
      [
        { text: "-1", callback_data: "select_stok:-1" },
        { text: "+1", callback_data: "select_stok:1" },
        { text: "-5", callback_data: "select_stok:-5" },
        { text: "+5", callback_data: "select_stok:5" }
      ],
      [{ text: "Pembayaran Saldo", callback_data: "checkout_payment:saldo" }],
      [{ text: "Pembayaran QRIS", callback_data: "checkout_payment:qris" }],
      [{ text: "🔄 Perbarui", callback_data: "refresh_stok" }],
      [{ text: "← Sebelumnya", callback_data: `item:${item.kode}` }]
    ]
    
    await editOrSendBannerMessage(query.from.id, query.message.message_id, stokText, {
      reply_markup: {
        inline_keyboard: keyboard
      }
    })
  } else {
    await sendMessage(query.from.id, `⚠️ Harap ulangi pilih produk!`)
  }
}

// Helper function untuk refresh tampilan stok
async function refreshStokView(query, Data, msgId = null) {
  const item = await getVarianForCart(Data.kode)
  if (!item) return false
  
  const stokCount = item.stok_count
  const allStokItems = await getStokItems(item.kode)
  // Filter stok yang tersedia DAN tidak direserve oleh user lain
  const tersediaItems = allStokItems.filter(s => {
    if (s.status !== 'tersedia') return false
    // Cek apakah stok available untuk user ini
    return isStokAvailable(s.id, query.from.id)
  })
  
  if (!Data.selectedStokIds) {
    Data.selectedStokIds = []
    await cart.save(query.from.id, Data)
  }
  
  const qtyPilih = Data.selectedStokIds.length
  const resolvedPick = await hargaUntukQty(item, qtyPilih || 1)
  const totalPembayaran = qtyPilih ? resolvedPick.subtotal : resolvedPick.harga_satuan
  let stokText = `📦 *PILIH STOK YANG INGIN DIBELI*
━━━━━━━━━━━━━━━━━━━━
🛍️ *Produk:* ${item.nama}
💰 *Harga Satuan:* ${formatrupiah(resolvedPick.harga_satuan)}
📊 *Stok Tersedia:* ${tersediaItems.length} item
✅ *Dipilih:* ${Data.selectedStokIds.length} item
💵 *Total Pembayaran:* ${formatrupiah(totalPembayaran)}

💡 *Cara:* Gunakan tombol increment di bawah untuk memilih jumlah stok`
  
  const keyboard = [
    [
      { text: "-1", callback_data: "select_stok:-1" },
      { text: "+1", callback_data: "select_stok:1" },
      { text: "-5", callback_data: "select_stok:-5" },
      { text: "+5", callback_data: "select_stok:5" }
    ],
    [{ text: "Pembayaran Saldo", callback_data: "checkout_payment:saldo" }],
    [{ text: "Pembayaran QRIS", callback_data: "checkout_payment:qris" }],
    [{ text: "🔄 Perbarui", callback_data: "refresh_stok" }],
    [{ text: "← Sebelumnya", callback_data: `item:${item.kode}` }]
  ]
  
  await editOrSendBannerMessage(query.from.id, msgId || query.message?.message_id, stokText, {
    reply_markup: {
      inline_keyboard: keyboard
    }
  })
  
  return true
}

// Handler untuk toggle pilihan stok
if (cmd.startsWith('toggle_stok:')) {
  const stokId = cmd.split(':')[1]
  
  if (await cart.exists(query.from.id)) {
    let Data = await cart.get(query.from.id)
    
    if (!Data.selectedStokIds) {
      Data.selectedStokIds = []
    }
    
    const index = Data.selectedStokIds.indexOf(stokId)
    
    if (index > -1) {
      // Unselect: release reservation
      Data.selectedStokIds.splice(index, 1)
      releaseReservation([stokId])
      
      await cart.save(query.from.id, Data)
      
      await bot.answerCallbackQuery(query.id, { 
        text: '⬜ Stok dibatalkan', 
        show_alert: false 
      })
    } else {
      // Select: try to reserve
      const reserved = await reserveStok([stokId], query.from.id, Data.trxid)
      
      if (reserved.length === 0) {
        // Gagal reserve (sudah di-reserve user lain)
        await bot.answerCallbackQuery(query.id, { 
          text: '❌ Stok sedang dipilih user lain. Pilih stok lain.', 
          show_alert: true 
        })
        return
      }
      
      Data.selectedStokIds.push(stokId)
      await cart.save(query.from.id, Data)
      
      await bot.answerCallbackQuery(query.id, { 
        text: '✅ Stok dipilih & direserve', 
        show_alert: false 
      })
    }
    
    await refreshStokView(query, Data)
  }
}

// Handler untuk navigasi halaman stok
if (cmd.startsWith('stok_page:')) {
  const direction = cmd.split(':')[1]
  
  if (await cart.exists(query.from.id)) {
    let Data = await cart.get(query.from.id)
    
    if (!Data.stokPage) Data.stokPage = 0
    
    const item = await getVarianForCart(Data.kode)
    if (!item) return
    
    const allStokItems = await getStokItems(item.kode)
    const tersediaItems = allStokItems.filter(s => s.status === 'tersedia')
    const itemsPerPage = 20
    const maxPage = Math.ceil(tersediaItems.length / itemsPerPage) - 1
    
    if (direction === 'prev' && Data.stokPage > 0) {
      Data.stokPage--
    } else if (direction === 'next' && Data.stokPage < maxPage) {
      Data.stokPage++
    }
    
    await cart.save(query.from.id, Data)
    
    await refreshStokView(query, Data)
  }
}

// Handler untuk reset pilihan stok
if (cmd === "reset_stok") {
  if (await cart.exists(query.from.id)) {
    let Data = await cart.get(query.from.id)
    
    // Release semua reservation sebelum reset
    if (Data.selectedStokIds && Data.selectedStokIds.length > 0) {
      releaseReservation(Data.selectedStokIds)
    }
    
    Data.selectedStokIds = []
    await cart.save(query.from.id, Data)
    
    await bot.answerCallbackQuery(query.id, { text: '🔄 Pilihan direset', show_alert: false })
    
    await refreshStokView(query, Data)
  }
}

// Handler untuk pilih stok dalam jumlah tertentu
if (cmd.startsWith("select_stok:")) {
  const jumlah = parseInt(cmd.split(":")[1])
  
  if (await cart.exists(query.from.id)) {
    let Data = await cart.get(query.from.id)
    
    if (jumlah < 0) {
      if (!Data.selectedStokIds) Data.selectedStokIds = []
      const selectCount = Math.abs(jumlah)
      // Ambil N item terakhir untuk dihapus (LIFO)
      const toRemove = Data.selectedStokIds.slice(-selectCount)
      
      Data.selectedStokIds = Data.selectedStokIds.slice(0, -selectCount)
      
      if (toRemove.length > 0) {
        releaseReservation(toRemove)
      }
      
      await cart.save(query.from.id, Data)
      
      await bot.answerCallbackQuery(query.id, { 
        text: `⬜ Dibatalkan ${toRemove.length} stok`, 
        show_alert: false 
      })
      
      await refreshStokView(query, Data)
      return
    }
    
    const item = await getVarianForCart(Data.kode)
    if (!item) return
    
    // Ambil semua stok tersedia (urutkan berdasarkan created_at untuk FIFO)
    const allStokItems = await getStokItems(item.kode)
    const tersediaItems = allStokItems
      .filter(s => s.status === 'tersedia')
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    
    // Filter stok yang belum dipilih DAN available (tidak direserve user lain)
    const belumDipilih = tersediaItems.filter(s => 
      !Data.selectedStokIds.includes(s.id) && 
      isStokAvailable(s.id, query.from.id)
    )
    
    if (belumDipilih.length === 0) {
      return await bot.answerCallbackQuery(query.id, { 
        text: '❌ Tidak ada stok tersedia yang bisa dipilih!', 
        show_alert: true 
      })
    }
    
    // Pilih N stok pertama yang available
    const stokToSelect = belumDipilih.slice(0, jumlah)
    const stokIdsToAdd = stokToSelect.map(s => s.id)
    
    // Try to reserve stok yang dipilih
    const reserved = await reserveStok(stokIdsToAdd, query.from.id, Data.trxid)
    
    if (reserved.length === 0) {
      return await bot.answerCallbackQuery(query.id, { 
        text: '❌ Stok yang dipilih sedang direserve user lain', 
        show_alert: true 
      })
    }
    
    // Tambahkan stok yang berhasil direserve ke selectedStokIds
    if (!Data.selectedStokIds) Data.selectedStokIds = []
    reserved.forEach(id => {
      if (!Data.selectedStokIds.includes(id)) {
        Data.selectedStokIds.push(id)
      }
    })
    
    await cart.save(query.from.id, Data)
    
    const message = reserved.length < stokIdsToAdd.length 
      ? `⚠️ ${reserved.length} dari ${stokIdsToAdd.length} stok berhasil direserve (yang lain sudah dipilih user lain)`
      : `✅ ${reserved.length} stok berhasil direserve! (Total: ${Data.selectedStokIds.length})`
    
    await bot.answerCallbackQuery(query.id, { 
      text: message, 
      show_alert: reserved.length < stokIdsToAdd.length 
    })
    
    await refreshStokView(query, Data)
  }
}

// Handler untuk checkout langsung dari stok selection
if (cmd.startsWith("checkout_payment:")) {
  const method = cmd.split(":")[1]
  
  if (await cart.exists(query.from.id)) {
    let Data = await cart.get(query.from.id)
    
    if (!Data.selectedStokIds || Data.selectedStokIds.length === 0) {
      await bot.answerCallbackQuery(query.id, { 
        text: '⚠️ Pilih minimal 1 stok!', 
        show_alert: true 
      })
      return
    }
    
    // Validasi stok yang dipilih masih tersedia
    const selectedStok = await getStokItems(Data.kode.toLowerCase())
    const tersediaIds = selectedStok
      .filter(s => s.status === 'tersedia')
      .map(s => s.id)
    
    const validIds = Data.selectedStokIds.filter(id => tersediaIds.includes(id))
    
    if (validIds.length !== Data.selectedStokIds.length) {
      await bot.answerCallbackQuery(query.id, { 
        text: `⚠️ Beberapa stok yang dipilih sudah tidak tersedia!`, 
        show_alert: true 
      })
      Data.selectedStokIds = validIds
      Data.jumlah = validIds.length
      await cart.save(query.from.id, Data)
      await refreshStokView(query, Data)
      return
    }
    
    // Update jumlah sesuai dengan jumlah stok yang dipilih
    Data.jumlah = Data.selectedStokIds.length
    await cart.save(query.from.id, Data)
    
    await bot.answerCallbackQuery(query.id)
    

    
    // Redirect langsung ke metode pembayaran yang dipilih
    if (method === "qris") {
      query.data = "bayar"
      cmd = "bayar"
    } else {
      const item = await getVarianForCart(Data.kode)
      if (!item) {
        return await sendMessage(query.from.id, `⚠️ Produk tidak ditemukan, harap ulangi pilih produk!`)
      }
      
      const resolved = await hargaUntukQty(item, Data.jumlah)
      let { data: Voucher } = await supabase.from("Voucher").select("*")
      let harga = applyVoucherPotongan(resolved.subtotal, query.from.id, Data.voucher, Voucher)
      
      const userSaldo = await cekSaldo(query.from.id)
      if (userSaldo >= harga) {
        query.data = "bayarsaldo"
        cmd = "bayarsaldo"
      } else {
        query.data = "pilih_payment_method"
        cmd = "pilih_payment_method"
      }
    }
  }
}

// Handler untuk refresh stok
if (cmd === "refresh_stok") {
  if (await cart.exists(query.from.id)) {
    let Data = await cart.get(query.from.id)
    await bot.answerCallbackQuery(query.id, { text: '🔄 Stok diperbarui' })
    await refreshStokView(query, Data)
  }
}

// Handler untuk konfirmasi pilihan stok
if (cmd === "konfirmasi_stok") {
  if (await cart.exists(query.from.id)) {
    let Data = await cart.get(query.from.id)
    
    if (!Data.selectedStokIds || Data.selectedStokIds.length === 0) {
      await bot.answerCallbackQuery(query.id, { 
        text: '⚠️ Pilih minimal 1 stok!', 
        show_alert: true 
      })
      return
    }
    
    // Update jumlah sesuai dengan jumlah stok yang dipilih
    Data.jumlah = Data.selectedStokIds.length
    
    await cart.save(query.from.id, Data)
    
    await bot.answerCallbackQuery(query.id)
    
    try {
      await bot.deleteMessage(query.message.chat.id, query.message.message_id)
    } catch (e) {}
    
    // Langsung panggil logika konfirmasi dengan mengubah cmd dan memanggil handler konfirmasi
    // Simulasi callback query baru untuk memicu handler konfirmasi
    query.data = "konfirmasi"
    cmd = "konfirmasi"
    // Handler konfirmasi akan dipanggil setelah ini karena cmd diubah
  }
}

if (cmd === "reset") {
  if (await cart.exists(query.from.id)) {
    let Data = await cart.get(query.from.id)
    if (Data.jumlah === 1) {
      return
    } else {
      Data.jumlah = 1
    await cart.save(query.from.id, Data)
     const item = await getVarianForCart(Data.kode)
     if (!item) return await sendMessage(query.from.id, `⚠️ Produk tidak ditemukan, harap ulangi pilih produk!`)
     const stokCountReset = item.stok_count
     const resolvedReset = await hargaUntukQty(item, Data.jumlah)
    await bot.editMessageText(`*KONFIRMASI PESANAN*
=======================
Produk: *${item.nama}*
Harga: *${formatrupiah(resolvedReset.harga_satuan)}*
Stok Tersedia: *${stokCountReset}*
-----------------------
Jumlah Pesanan: *${Data.jumlah}*
Total Dibayar: *${formatrupiah(resolvedReset.subtotal)}*
=======================
Klik ✅ Konfirmasi untuk melakukan pembayaran`, {
  parse_mode: "Markdown",
  reply_markup: {
    inline_keyboard: [
      [{text: "-", callback_data: "min:1"}, {text: "+", callback_data: "plus:1"}],
      [
      {text: "+5", callback_data: "plus:5"},
      {text: "+10", callback_data: "plus:10"},
      {text: "+25", callback_data: "plus:25"},
      {text: "+50", callback_data: "plus:50"},
      ],
      [{text: "🔄 Reset", callback_data: "reset"}],
          [{text: "🔙 Kembali", callback_data: "kembaliawal"}, {text: "✅ Konfirmasi", callback_data: "konfirmasi"}]
      ]
  },
  chat_id: query.message.chat.id,
  message_id: query.message.message_id
})
    }
  } else {
    await sendMessage(query.from.id, `⚠️ Harap ulangi pilih produk!`)
  }
}

if (cmd === "konfirmasi") {
  if (await cart.exists(query.from.id)) {
    let Data = await cart.get(query.from.id)
    const item = await getVarianForCart(Data.kode)
    if (!item) {
      return await sendMessage(query.from.id, `⚠️ Produk tidak ditemukan, harap ulangi pilih produk!`)
    }
    {
      // Validasi stok yang dipilih masih tersedia
      if (Data.selectedStokIds && Data.selectedStokIds.length > 0) {
        const selectedStok = await getStokItems(Data.kode.toLowerCase())
        const tersediaIds = selectedStok
          .filter(s => s.status === 'tersedia')
          .map(s => s.id)
        
        const validIds = Data.selectedStokIds.filter(id => tersediaIds.includes(id))
        
        if (validIds.length !== Data.selectedStokIds.length) {
          await bot.answerCallbackQuery(query.id, { 
            text: `⚠️ Beberapa stok yang dipilih sudah tidak tersedia!`, 
            show_alert: true 
          })
          Data.selectedStokIds = validIds
          Data.jumlah = validIds.length
          await cart.save(query.from.id, Data)
        }
        
        if (validIds.length === 0) {
          return await sendMessage(query.from.id, `⚠️ Stok yang dipilih sudah tidak tersedia! Silakan pilih ulang.`, {
            reply_markup: {
              inline_keyboard: [
                [{text: "🔙 Kembali Pilih Stok", callback_data: "lanjut"}]
              ]
            }
          })
        }
      } else {
        // Fallback ke FIFO jika tidak ada pilihan
        const stokCount = await getStokCount(Data.kode.toLowerCase())
        if (stokCount < Data.jumlah) {
          await bot.answerCallbackQuery(query.id, { 
            text: `⚠️ Stok produk tidak mencukupi! Stok tersedia: ${stokCount}`, 
            show_alert: true 
          })
          return
        }
      }
      
      const userSaldo = await cekSaldo(query.from.id)
      const resolved = await hargaUntukQty(item, Data.jumlah)
      let hargaAwal = resolved.subtotal
      let { data: Voucher } = await supabase.from("Voucher").select("*")
      let vcr = Voucher.find(v => v.kode === Data.voucher)
      
      let potongan = 0
      if (vcr && !vcr.user.some(a => a === query.from.id) && vcr.limit > 0) {
        potongan = vcr.potongan
      }
      
      const totalBayar = Math.max(0, hargaAwal - potongan)
      const saldoSetelah = userSaldo - totalBayar
      
      // Ambil info stok yang dipilih untuk ditampilkan (COMPACTED FOR 1024 CAPTION LIMIT)
      let stokInfoText = ""
      if (Data.selectedStokIds && Data.selectedStokIds.length > 0) {
        stokInfoText = `\n📦 *Stok yang Dipilih:* ${Data.selectedStokIds.length} item\n━━━━━━━━━━━━━━━━━━━━\n`
      }
      
      // Detect format
      const stokItems = await getStokItems(item.kode, 1)
      const sampleData = stokItems.length > 0 ? [stokItems[0].data] : []
      const formatDetected = detectProductFormat(sampleData, item.format)
      
      // Build enhanced confirmation message
      let confirmText = `📋 *KONFIRMASI PESANAN*
━━━━━━━━━━━━━━━━━━━━
📦 *DETAIL PRODUK*
━━━━━━━━━━━━━━━━━━━━
🛍️ *Nama:* ${item.nama}
🔖 *Kode:* \`${item.kode}\`
💰 *Harga Satuan:* ${formatrupiah(resolved.harga_satuan)}
${formatDetected.info}
${formatDetected.example ? formatDetected.example + '\n' : ''}${stokInfoText}📊 *Jumlah Pesanan:* ${Data.jumlah} item
━━━━━━━━━━━━━━━━━━━━
📝 *RINGKASAN PESANAN*
━━━━━━━━━━━━━━━━━━━━
💰 *Subtotal:* ${formatrupiah(hargaAwal)}
${potongan > 0 ? `🎟️ *Voucher:* ${Data.voucher}\n💸 *Potongan:* ${formatrupiah(potongan)}\n` : ''}
━━━━━━━━━━━━━━━━━━━━
💎 *TOTAL BAYAR:* ${formatrupiah(totalBayar)}
━━━━━━━━━━━━━━━━━━━━
${potongan > 0 ? `✅ Hemat: ${formatrupiah(potongan)} dengan voucher!\n` : ''}━━━━━━━━━━━━━━━━━━━━
📌 *Progress:* [✅ Produk] → [✅ Stok] → [⏳ Konfirmasi] → [⏸ Bayar] → [⏸ Selesai]
━━━━━━━━━━━━━━━━━━━━`
      
      // Syarat & ketentuan preview
      if (item.snk) {
        confirmText += `\n📋 *Syarat & Ketentuan:*
${item.snk.length > 150 ? item.snk.substring(0, 150) + '...' : item.snk}
━━━━━━━━━━━━━━━━━━━━`
      }
      
      // Final check: jika pesan terlalu panjang, kurangi detail stok
      if (confirmText.length > 4096) {
        // Jika masih terlalu panjang, kurangi jumlah stok yang ditampilkan
        if (Data.selectedStokIds && Data.selectedStokIds.length > 0) {
          const allStok = await getStokItems(Data.kode.toLowerCase())
          const selectedStokDetails = allStok.filter(s => Data.selectedStokIds.includes(s.id))
          
          // Coba dengan 5 stok saja
          const maxDisplay = 5
          const stokToDisplay = selectedStokDetails.slice(0, maxDisplay)
          const remainingCount = selectedStokDetails.length - maxDisplay
          
          stokInfoText = `\n📦 *Stok yang Dipilih:* (${selectedStokDetails.length} item)
━━━━━━━━━━━━━━━━━━━━
`
          stokToDisplay.forEach((stok, idx) => {
            const timestamp = formatWIBDetail(stok.created_at)
            const dataPreview = blurStokData(stok.data)
            stokInfoText += `${idx + 1}. \`${dataPreview}\`
   📅 Upload: ${timestamp}
`
          })
          
          if (remainingCount > 0) {
            stokInfoText += `\n... dan ${remainingCount} stok lainnya
`
          }
          
          stokInfoText += `━━━━━━━━━━━━━━━━━━━━\n`
          
          // Rebuild confirmText dengan stokInfoText yang lebih pendek
          confirmText = `📋 *KONFIRMASI PESANAN*
━━━━━━━━━━━━━━━━━━━━
📦 *DETAIL PRODUK*
━━━━━━━━━━━━━━━━━━━━
🛍️ *Nama:* ${item.nama}
🔖 *Kode:* \`${item.kode}\`
💰 *Harga Satuan:* ${formatrupiah(resolved.harga_satuan)}
${formatDetected.info}
${formatDetected.example ? formatDetected.example + '\n' : ''}${stokInfoText}📊 *Jumlah Pesanan:* ${Data.jumlah} item
━━━━━━━━━━━━━━━━━━━━
📝 *RINGKASAN PESANAN*
━━━━━━━━━━━━━━━━━━━━
💰 *Subtotal:* ${formatrupiah(hargaAwal)}
${potongan > 0 ? `🎟️ *Voucher:* ${Data.voucher}\n💸 *Potongan:* ${formatrupiah(potongan)}\n` : ''}
━━━━━━━━━━━━━━━━━━━━
💎 *TOTAL BAYAR:* ${formatrupiah(totalBayar)}
━━━━━━━━━━━━━━━━━━━━
${potongan > 0 ? `✅ Hemat: ${formatrupiah(potongan)} dengan voucher!\n` : ''}━━━━━━━━━━━━━━━━━━━━
📌 *Progress:* [✅ Produk] → [✅ Stok] → [⏳ Konfirmasi] → [⏸ Bayar] → [⏸ Selesai]
━━━━━━━━━━━━━━━━━━━━`
          
          if (item.snk) {
            confirmText += `\n📋 *Syarat & Ketentuan:*
${item.snk.length > 100 ? item.snk.substring(0, 100) + '...' : item.snk}
━━━━━━━━━━━━━━━━━━━━`
          }
        }
        
        // Final safety check: potong jika masih terlalu panjang
        if (confirmText.length > 4096) {
          confirmText = confirmText.substring(0, 4000) + '\n\n⚠️ *Pesan dipotong karena terlalu panjang*'
        }
      }
      
      // Build keyboard
      const keyboard = []
      
      // Edit options
      keyboard.push([
        { text: "✏️ Edit Pilihan Stok", callback_data: "lanjut" },
        { text: "📦 Lihat Detail", callback_data: `produk_detail_${item.kode}` }
      ])
      
      // Payment method selection
      keyboard.push([{ text: "💳 Lanjut ke Pembayaran", callback_data: "pilih_payment_method" }])
      
      // Secondary actions
      keyboard.push([
        { text: "❌ Batal Pesanan", callback_data: "batal_pesanan" },
        { text: "💬 Hubungi CS", url: channelContact.cs }
      ])
      
      // Enforce photo caption limit (1024 chars)
      if (confirmText.length > 1000) {
        confirmText = confirmText.substring(0, 980) + '\n\n⚠️ _(Detail dipotong)_'
      }
      await editOrSendBannerMessage(query.from.id, query.message.message_id, confirmText, {
        reply_markup: {
          inline_keyboard: keyboard
        }
      })
    }
  } else {
    await sendMessage(query.from.id, `⚠️ Harap ulangi pilih produk!`)
  }
}

// Enhanced payment method selection
if (cmd === "pilih_payment_method") {
  if (await cart.exists(query.from.id)) {
    let Data = await cart.get(query.from.id)
    const item = await getVarianForCart(Data.kode)
    if (!item) {
      await sendMessage(query.from.id, `⚠️ Produk tidak ditemukan, harap ulangi pilih produk!`)
    } else {
    const resolved = await hargaUntukQty(item, Data.jumlah)
      const userSaldo = await cekSaldo(query.from.id)
      let hargaAwal = resolved.subtotal
      let { data: Voucher } = await supabase.from("Voucher").select("*")
      let vcr = Voucher.find(v => v.kode === Data.voucher)
      
      let potongan = 0
      if (vcr && !vcr.user.some(a => a === query.from.id) && vcr.limit > 0) {
        potongan = vcr.potongan
      }
      
      const totalBayar = hargaAwal - potongan
      const saldoSetelah = userSaldo - totalBayar
      
      // Check available vouchers
      const availableVouchers = Voucher.filter(v => 
        v.limit > 0 && 
        !v.user.some(a => a === query.from.id) &&
        (!v.minimal_pembelian || v.minimal_pembelian <= totalBayar)
      )
      
      let paymentText = `💳 *PILIH METODE PEMBAYARAN*
━━━━━━━━━━━━━━━━━━━━
💰 *DETAIL KEUANGAN*
━━━━━━━━━━━━━━━━━━━━
💵 *Total Bayar:* ${formatrupiah(totalBayar)}
💰 *Saldo Anda:* ${formatrupiah(userSaldo)}
${userSaldo >= totalBayar ? `✅ *Saldo Setelah:* ${formatrupiah(saldoSetelah)}` : `⚠️ *Kurang:* ${formatrupiah(totalBayar - userSaldo)}`}
━━━━━━━━━━━━━━━━━━━━

*METODE PEMBAYARAN:*
━━━━━━━━━━━━━━━━━━━━`
      
      const keyboard = []
      
      // Saldo option (enhanced)
      if (userSaldo >= totalBayar) {
        paymentText += `\n1️⃣ *💰 BAYAR PAKAI SALDO*
✅ Saldo mencukupi
💵 Sisa saldo: ${formatrupiah(saldoSetelah)}
⚡ Instant, tanpa fee`
        keyboard.push([{ text: "💰 Bayar Pakai Saldo", callback_data: "bayarsaldo" }])
      } else {
        paymentText += `\n1️⃣ *💰 BAYAR PAKAI SALDO*
⚠️ Saldo tidak mencukupi
💸 Kurang: ${formatrupiah(totalBayar - userSaldo)}
💡 Top up saldo terlebih dahulu`
        keyboard.push([
          { text: "💰 Top Up Saldo", callback_data: "deposit_menu" },
          { text: "💵 Saldo: " + formatrupiah(userSaldo), callback_data: "cek_saldo" }
        ])
      }
      
      // QRIS option (enhanced)
      paymentText += `\n\n2️⃣ *💳 BAYAR QRIS*
💸 Fee: Tergantung provider (~Rp 2.500-5.000)
⏰ Expired: 10 menit
📱 Scan QR untuk bayar`
      keyboard.push([{ text: "💳 Bayar QRIS", callback_data: "bayar" }])
      
      // Voucher options (if available)
      if (availableVouchers.length > 0) {
        paymentText += `\n\n3️⃣ *🎟️ GUNAKAN VOUCHER*
Tersedia ${availableVouchers.length} voucher:`
        availableVouchers.slice(0, 3).forEach((v, idx) => {
          paymentText += `\n• ${v.kode} - Potongan ${formatrupiah(v.potongan)}`
        })
        keyboard.push([
          { text: "🎟️ Lihat Voucher", callback_data: "lihat_voucher" },
          { text: "🎟️ Input Voucher", callback_data: "punya" }
        ])
      } else if (!vcr) {
        keyboard.push([{ text: "🎟️ Input Voucher", callback_data: "punya" }])
      }
      
      keyboard.push([{ text: "🔙 Kembali", callback_data: "konfirmasi_kembali" }])
      
      // Enforce caption limit
      if (paymentText.length > 1000) {
        paymentText = paymentText.substring(0, 980) + '\n\n⚠️ _(Dipotong)_'
      }
      await editOrSendBannerMessage(query.from.id, query.message.message_id, paymentText, {
        reply_markup: {
          inline_keyboard: keyboard
        }
      })
    }
  }
}

// Enhanced voucher list
if (cmd === "lihat_voucher") {
  if (await cart.exists(query.from.id)) {
    let Data = await cart.get(query.from.id)
    const item = await getVarianForCart(Data.kode)
    if (!item) {
      await sendMessage(query.from.id, `⚠️ Produk tidak ditemukan, harap ulangi pilih produk!`)
    } else {
    const resolved = await hargaUntukQty(item, Data.jumlah)
      let hargaAwal = resolved.subtotal
      let { data: Voucher } = await supabase.from("Voucher").select("*")
      
      const availableVouchers = Voucher.filter(v => 
        v.limit > 0 && 
        !v.user.some(a => a === query.from.id) &&
        (!v.minimal_pembelian || v.minimal_pembelian <= hargaAwal)
      )
      
      if (availableVouchers.length === 0) {
        await bot.answerCallbackQuery(query.id, { 
          text: "Tidak ada voucher yang tersedia!", 
          show_alert: true 
        })
        return
      }
      
      let voucherText = `🎟️ *VOUCHER TERSEDIA*
━━━━━━━━━━━━━━━━━━━━
💰 *Total Pesanan:* ${formatrupiah(hargaAwal)}
━━━━━━━━━━━━━━━━━━━━

*Voucher yang bisa digunakan:*
━━━━━━━━━━━━━━━━━━━━\n`
      
      const keyboard = []
      
      availableVouchers.forEach((v, idx) => {
        const hargaSetelah = hargaAwal - v.potongan
        voucherText += `\n🎟️ *${v.kode}*
💸 Potongan: ${formatrupiah(v.potongan)}
💰 Setelah diskon: ${formatrupiah(hargaSetelah)}
📊 Sisa limit: ${v.limit}x
${v.minimal_pembelian ? `💵 Min. pembelian: ${formatrupiah(v.minimal_pembelian)}\n` : ''}━━━━━━━━━━━━━━━━━━━━\n`
        
        if (idx < 3) {
          if (keyboard.length === 0 || keyboard[keyboard.length - 1].length >= 2) {
            keyboard.push([])
          }
          keyboard[keyboard.length - 1].push({
            text: `${v.kode} (${formatrupiah(v.potongan)})`,
            callback_data: `apply_voucher_${v.kode}`
          })
        }
      })
      
      keyboard.push([{ text: "🔙 Kembali", callback_data: "pilih_payment_method" }])
      
      // Enforce caption limit
      if (voucherText.length > 1000) {
        voucherText = voucherText.substring(0, 980) + '\n\n⚠️ _(Dipotong)_'
      }
      await editOrSendBannerMessage(query.from.id, query.message.message_id, voucherText, {
        reply_markup: {
          inline_keyboard: keyboard
        }
      })
    }
  }
}

// Apply voucher directly
if (cmd.startsWith("apply_voucher_")) {
  const voucherKode = cmd.replace("apply_voucher_", "")
  
  if (await cart.exists(query.from.id)) {
    let Data = await cart.get(query.from.id)
    const item = await getVarianForCart(Data.kode)
    if (!item) {
      await sendMessage(query.from.id, `⚠️ Produk tidak ditemukan, harap ulangi pilih produk!`)
    } else {
    const resolved = await hargaUntukQty(item, Data.jumlah)
      let { data: Voucher } = await supabase.from("Voucher").select("*")
      let vcr = Voucher.find(v => v.kode === voucherKode)
      
      if (!vcr) {
        await bot.answerCallbackQuery(query.id, { 
          text: "Voucher tidak ditemukan!", 
          show_alert: true 
        })
        return
      }
      
      if (vcr.user.some(a => a === query.from.id)) {
        await bot.answerCallbackQuery(query.id, { 
          text: "Anda sudah menggunakan voucher ini!", 
          show_alert: true 
        })
        return
      }
      
      if (vcr.limit <= 0) {
        await bot.answerCallbackQuery(query.id, { 
          text: "Voucher sudah habis!", 
          show_alert: true 
        })
        return
      }
      
      let hargaAwal = resolved.subtotal
      if (vcr.minimal_pembelian && hargaAwal < vcr.minimal_pembelian) {
        await bot.answerCallbackQuery(query.id, { 
          text: `Minimal pembelian ${formatrupiah(vcr.minimal_pembelian)}!`, 
          show_alert: true 
        })
        return
      }
      
      Data.voucher = voucherKode
      await cart.save(query.from.id, Data)
      
      await bot.answerCallbackQuery(query.id, { 
        text: `✅ Voucher ${voucherKode} berhasil digunakan!`, 
        show_alert: true 
      })
      
      // Return to payment method selection by re-triggering (in-place)
      
      // Re-trigger pilih_payment_method manually
      const userSaldo = await cekSaldo(query.from.id)
      hargaAwal = resolved.subtotal
      const potongan = vcr.potongan
      const totalBayar = hargaAwal - potongan
      const saldoSetelah = userSaldo - totalBayar
      
      // Check available vouchers
      const availableVouchers = Voucher.filter(v => 
        v.limit > 0 && 
        !v.user.some(a => a === query.from.id) &&
        (!v.minimal_pembelian || v.minimal_pembelian <= totalBayar)
      )
      
      let paymentText = `💳 *PILIH METODE PEMBAYARAN*
━━━━━━━━━━━━━━━━━━━━
💰 *DETAIL KEUANGAN*
━━━━━━━━━━━━━━━━━━━━
💵 *Total Bayar:* ${formatrupiah(totalBayar)}
💰 *Saldo Anda:* ${formatrupiah(userSaldo)}
${userSaldo >= totalBayar ? `✅ *Saldo Setelah:* ${formatrupiah(saldoSetelah)}` : `⚠️ *Kurang:* ${formatrupiah(totalBayar - userSaldo)}`}
${potongan > 0 ? `🎟️ *Voucher Aktif:* ${voucherKode} (${formatrupiah(potongan)})\n` : ''}━━━━━━━━━━━━━━━━━━━━

*METODE PEMBAYARAN:*
━━━━━━━━━━━━━━━━━━━━`
      
      const keyboard = []
      
      // Saldo option (enhanced)
      if (userSaldo >= totalBayar) {
        paymentText += `\n1️⃣ *💰 BAYAR PAKAI SALDO*
✅ Saldo mencukupi
💵 Sisa saldo: ${formatrupiah(saldoSetelah)}
⚡ Instant, tanpa fee`
        keyboard.push([{ text: "💰 Bayar Pakai Saldo", callback_data: "bayarsaldo" }])
      } else {
        paymentText += `\n1️⃣ *💰 BAYAR PAKAI SALDO*
⚠️ Saldo tidak mencukupi
💸 Kurang: ${formatrupiah(totalBayar - userSaldo)}
💡 Top up saldo terlebih dahulu`
        keyboard.push([
          { text: "💰 Top Up Saldo", callback_data: "deposit_menu" },
          { text: "💵 Saldo: " + formatrupiah(userSaldo), callback_data: "cek_saldo" }
        ])
      }
      
      // QRIS option (enhanced)
      paymentText += `\n\n2️⃣ *💳 BAYAR QRIS*
💸 Fee: Tergantung provider (~Rp 2.500-5.000)
⏰ Expired: 10 menit
📱 Scan QR untuk bayar`
      keyboard.push([{ text: "💳 Bayar QRIS", callback_data: "bayar" }])
      
      // Voucher options (if available)
      if (availableVouchers.length > 0) {
        paymentText += `\n\n3️⃣ *🎟️ GUNAKAN VOUCHER*
Tersedia ${availableVouchers.length} voucher:`
        availableVouchers.slice(0, 3).forEach((v, idx) => {
          paymentText += `\n• ${v.kode} - Potongan ${formatrupiah(v.potongan)}`
        })
        keyboard.push([
          { text: "🎟️ Lihat Voucher", callback_data: "lihat_voucher" },
          { text: "🎟️ Input Voucher", callback_data: "punya" }
        ])
      }
      
      keyboard.push([{ text: "🔙 Kembali", callback_data: "konfirmasi_kembali" }])
      
      await bot.sendMessage(query.from.id, paymentText, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: keyboard
        }
      })
    }
  }
}

if (cmd === "punya") {
  if (await cart.exists(query.from.id)) {
    let Data = await cart.get(query.from.id)
    Data.voucher_status = "waiting"
    await cart.save(query.from.id, Data)
    try {
      await bot.deleteMessage(query.message.chat.id, query.message.message_id)
    } catch (e) {
      // Ignore
    }
    let df = await bot.sendMessage(query.from.id, `Input kode voucher yang kamu punya!`, {
      reply_markup: {
        inline_keyboard: [
          [{text: "❌ Batal", callback_data: "batalvoucher"}]
        ]
      }
    })
    msgg[query.from.id] = df
  } else {
    await sendMessage(query.from.id, `⚠️ Harap ulangi pilih produk!`)
  }
}

// Cancel order with confirmation
if (cmd === "batal_pesanan") {
  if (await cart.exists(query.from.id)) {
    await bot.answerCallbackQuery(query.id)
    await editOrSendBannerMessage(query.from.id, query.message.message_id, `❌ *BATAL PESANAN*
━━━━━━━━━━━━━━━━━━━━
Apakah Anda yakin ingin membatalkan pesanan ini?

━━━━━━━━━━━━━━━━━━━━`, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Ya, Batalkan", callback_data: "batal_pesanan_confirm" },
            { text: "❌ Tidak, Kembali", callback_data: "konfirmasi_kembali" }
          ]
        ]
      }
    })
  }
}

// Confirm cancel
if (cmd === "batal_pesanan_confirm") {
  if (await cart.exists(query.from.id)) {
    let Data = await cart.get(query.from.id)
    
    // Release reservations sebelum cancel
    if (Data.selectedStokIds && Data.selectedStokIds.length > 0) {
      releaseReservation(Data.selectedStokIds)
      console.log(`🔓 Release ${Data.selectedStokIds.length} reserved stocks for user ${query.from.id} (batal_pesanan_confirm)`)
    }
    
    try {
      await bot.deleteMessage(query.message.chat.id, query.message.message_id)
    } catch (e) {
      // Ignore
    }
    await cart.clear(query.from.id)
    await editOrSendBannerMessage(query.from.id, query.message.message_id, `✅ *PESANAN DIBATALKAN*
 
 ━━━━━━━━━━━━━━━━━━━━
 Pesanan Anda telah dibatalkan.
 
 ━━━━━━━━━━━━━━━━━━━━
 💡 Klik tombol di bawah untuk melanjutkan.`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🛍️ Belanja Lagi", callback_data: "daftarproduk" }],
          [{ text: "🔙 Menu Utama", callback_data: "kembaliawal" }]
        ]
      }
    })
  }
}

// Handler untuk cek saldo dari payment method
if (cmd === "cek_saldo") {
  const saldo = await cekSaldo(query.from.id)
  await bot.answerCallbackQuery(query.id, { 
    text: `Saldo Anda: ${formatrupiah(saldo)}`, 
    show_alert: true 
  })
}

// Go back to confirmation
if (cmd === "konfirmasi_kembali") {
  if (await cart.exists(query.from.id)) {
    let Data = await cart.get(query.from.id)
    const item = await getVarianForCart(Data.kode)
    if (!item) {
      await sendMessage(query.from.id, `⚠️ Produk tidak ditemukan, harap ulangi pilih produk!`)
    } else {
    const resolved = await hargaUntukQty(item, Data.jumlah)
      // Re-check stok menggunakan tabel Stok
      const stokCount = await getStokCount(Data.kode.toLowerCase())
      if (stokCount < Data.jumlah) {
        await bot.answerCallbackQuery(query.id, { 
          text: `⚠️ Stok produk tidak mencukupi! Stok tersedia: ${stokCount}`, 
          show_alert: true 
        })
        return
      }
      
      try {
        await bot.deleteMessage(query.message.chat.id, query.message.message_id)
      } catch (e) {
        // Ignore
      }
      
      const userSaldo = await cekSaldo(query.from.id)
      let hargaAwal = resolved.subtotal
      let { data: Voucher } = await supabase.from("Voucher").select("*")
      let vcr = Voucher.find(v => v.kode === Data.voucher)
      
      let potongan = 0
      if (vcr && !vcr.user.some(a => a === query.from.id) && vcr.limit > 0) {
        potongan = vcr.potongan
      }
      
      const totalBayar = hargaAwal - potongan
      
      // Detect format - gunakan stok items untuk detect format
      const stokItems = await getStokItems(item.kode, 1)
      const sampleData = stokItems.length > 0 ? [stokItems[0].data] : []
      const formatDetected = detectProductFormat(sampleData, item.format)
      
      // Build enhanced confirmation message
      let confirmText = `📋 *KONFIRMASI PESANAN*
━━━━━━━━━━━━━━━━━━━━
📦 *DETAIL PRODUK*
━━━━━━━━━━━━━━━━━━━━
🛍️ *Nama:* ${item.nama}
🔖 *Kode:* \`${item.kode}\`
💰 *Harga Satuan:* ${formatrupiah(resolved.harga_satuan)}
${formatDetected.info}
${formatDetected.example ? formatDetected.example + '\n' : ''}📊 *Stok Tersedia:* ${stokCount} item
${stokCount <= 5 ? '⚠️ *Status:* Stok Terbatas\n' : ''}
━━━━━━━━━━━━━━━━━━━━
📝 *RINGKASAN PESANAN*
━━━━━━━━━━━━━━━━━━━━
📊 *Jumlah Pesanan:* ${Data.jumlah} item
💰 *Subtotal:* ${formatrupiah(hargaAwal)}
${potongan > 0 ? `🎟️ *Voucher:* ${Data.voucher}\n💸 *Potongan:* ${formatrupiah(potongan)}\n` : ''}
━━━━━━━━━━━━━━━━━━━━
💎 *TOTAL BAYAR:* ${formatrupiah(totalBayar)}
━━━━━━━━━━━━━━━━━━━━
${potongan > 0 ? `✅ Hemat: ${formatrupiah(potongan)} dengan voucher!\n` : ''}━━━━━━━━━━━━━━━━━━━━
📌 *Progress:* [✅ Produk] → [✅ Jumlah] → [⏳ Konfirmasi] → [⏸ Bayar] → [⏸ Selesai]
━━━━━━━━━━━━━━━━━━━━`
      
      // Syarat & ketentuan preview
      if (item.snk) {
        confirmText += `\n📋 *Syarat & Ketentuan:*
${item.snk.length > 150 ? item.snk.substring(0, 150) + '...' : item.snk}
━━━━━━━━━━━━━━━━━━━━`
      }
      
      // Build keyboard
      const keyboard = []
      
      // Edit options
      keyboard.push([
        { text: "✏️ Edit Jumlah", callback_data: `item:${item.kode}` },
        { text: "📦 Lihat Detail", callback_data: `produk_detail_${item.kode}` }
      ])
      
      // Payment method selection
      keyboard.push([{ text: "💳 Lanjut ke Pembayaran", callback_data: "pilih_payment_method" }])
      
      // Secondary actions
      keyboard.push([
        { text: "❌ Batal Pesanan", callback_data: "batal_pesanan" },
        { text: "💬 Hubungi CS", url: channelContact.cs }
      ])
      
      // Enforce caption limit
      if (confirmText.length > 1000) {
        confirmText = confirmText.substring(0, 980) + '\n\n⚠️ _(Dipotong)_'
      }
      await editOrSendBannerMessage(query.from.id, query.message.message_id, confirmText, {
        reply_markup: {
          inline_keyboard: keyboard
        }
      })
    }
  }
}

if (cmd === "stok") {
  await openStokBuyer(query)
}

// Handler untuk detail produk di stok
if (cmd.startsWith("stok_detail_")) {
  const kode = cmd.replace("stok_detail_", "")
  
  let { data: Produk } = await supabase
    .from("Produk")
    .select("*")
    .eq("kode", kode.toLowerCase())
    .single()
  
  if (!Produk) {
    await bot.answerCallbackQuery(query.id, { text: "❌ Produk tidak ditemukan!", show_alert: true })
    return
  }
  
  const stokCount = await getStokCount(Produk.kode)
  
  const persentase = Produk.terjual > 0 
    ? Math.round((Produk.terjual / (Produk.terjual + stokCount)) * 100) 
    : 0
  
  const statusEmoji = stokCount === 0 ? "❌" 
    : stokCount <= 5 ? "⚠️" 
    : stokCount <= 20 ? "✅" 
    : "🟢"
  
  const statusText = stokCount === 0 ? "HABIS" 
    : stokCount <= 5 ? "RENDAH" 
    : stokCount <= 20 ? "NORMAL" 
    : "BANYAK"
  
  // Get recent transactions for this product
  const { data: recentTrx } = await supabase
    .from("Trx")
    .select("*")
    .eq("kode", kode.toLowerCase())
    .order("tanggal", { ascending: false })
    .limit(5)
  
  let detailText = `📦 *DETAIL PRODUK*
━━━━━━━━━━━━━━━━━━━━
${statusEmoji} *${Produk.nama}* (${statusText})
━━━━━━━━━━━━━━━━━━━━
🔖 *Kode:* \`${Produk.kode}\`
💰 *Harga:* ${formatrupiah(Produk.harga)}
📊 *Stok Tersedia:* ${stokCount}
📈 *Terjual:* ${Produk.terjual}
📊 *Persentase:* ${persentase}% terjual

━━━━━━━━━━━━━━━━━━━━
📝 *Deskripsi:*
${Produk.deskripsi}

━━━━━━━━━━━━━━━━━━━━
📊 *Transaksi Terakhir:* ${recentTrx ? recentTrx.length : 0} transaksi
━━━━━━━━━━━━━━━━━━━━`
  
  const buttons = []
  
  // Quick actions (only for owner)
  if (query.from.id === OwnerID) {
    buttons.push([
      { text: "➕ Tambah Stok", callback_data: `addstok_select_${Produk.kode}` },
    ])
  }
  
  buttons.push([
    { text: "📋 Lihat Semua Stok", callback_data: `stok_viewall_${Produk.kode}` },
    { text: "📊 Riwayat Penjualan", callback_data: `stok_history_${Produk.kode}` }
  ])
  
  buttons.push([
    { text: "🔙 Kembali ke Stok", callback_data: "stok" }
  ])
  
  await bot.answerCallbackQuery(query.id)
  await bot.sendMessage(query.from.id, detailText, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: buttons
    }
  })
}

// Handler untuk filter stok
if (cmd === "stok_filter") {
  await bot.answerCallbackQuery(query.id)
  await bot.sendMessage(query.from.id, `🔍 *FILTER STOK PRODUK*
━━━━━━━━━━━━━━━━━━━━
Pilih filter yang ingin diterapkan:

━━━━━━━━━━━━━━━━━━━━`, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "❌ Habis", callback_data: "stok_filter_habis" },
          { text: "⚠️ Rendah", callback_data: "stok_filter_rendah" }
        ],
        [
          { text: "✅ Normal", callback_data: "stok_filter_normal" },
          { text: "🟢 Banyak", callback_data: "stok_filter_banyak" }
        ],
        [
          { text: "📊 Semua", callback_data: "stok" }
        ],
        [
          { text: "🔙 Kembali", callback_data: "stok" }
        ]
      ]
    }
  })
}

// Handler untuk setiap filter option
if (cmd.startsWith("stok_filter_")) {
  const filterType = cmd.replace("stok_filter_", "")
  
  let { data: Produk } = await supabase
    .from("Produk")
    .select("*")
  
  if (!Produk || Produk.length === 0) {
    await bot.answerCallbackQuery(query.id, { text: "⚠️ Tidak ada produk!", show_alert: true })
    return
  }
  
  // Hitung stok untuk setiap produk
  const ProdukWithStok = await Promise.all(Produk.map(async (p) => {
    const stokCount = await getStokCount(p.kode)
    return { ...p, stok_count: stokCount }
  }))
  
  // Filter products based on type
  let filteredProduk = []
  let filterLabel = ""
  
  switch(filterType) {
    case 'habis':
      filteredProduk = ProdukWithStok.filter(p => p.stok_count === 0)
      filterLabel = "HABIS"
      break
    case 'rendah':
      filteredProduk = ProdukWithStok.filter(p => p.stok_count > 0 && p.stok_count <= 5)
      filterLabel = "RENDAH (≤5)"
      break
    case 'normal':
      filteredProduk = ProdukWithStok.filter(p => p.stok_count > 5 && p.stok_count <= 20)
      filterLabel = "NORMAL (6-20)"
      break
    case 'banyak':
      filteredProduk = ProdukWithStok.filter(p => p.stok_count > 20)
      filterLabel = "BANYAK (>20)"
      break
    default:
      filteredProduk = ProdukWithStok
      filterLabel = "SEMUA"
  }
  
  if (filteredProduk.length === 0) {
    await bot.answerCallbackQuery(query.id, { text: `Tidak ada produk dengan status ${filterLabel}!`, show_alert: true })
    return
  }
  
  // Calculate statistics for filtered products
  let totalStok = 0
  let totalTerjual = 0
  
  filteredProduk.forEach(p => {
    totalStok += p.stok_count || 0
    totalTerjual += p.terjual || 0
  })
  
  let tx = `📦 *STOK PRODUK - ${filterLabel}*
━━━━━━━━━━━━━━━━━━━━
📊 *STATISTIK*
━━━━━━━━━━━━━━━━━━━━
📦 Total Produk: *${filteredProduk.length}*
📊 Total Stok: *${totalStok}*
💰 Total Terjual: *${totalTerjual}*
━━━━━━━━━━━━━━━━━━━━

*DAFTAR PRODUK:*
`
  
  // Sort by stock
  const sortedProduk = [...filteredProduk].sort((a, b) => {
    if (a.stok_count !== b.stok_count) return a.stok_count - b.stok_count
    return a.nama.localeCompare(b.nama)
  })
  
  sortedProduk.forEach((p) => {
    let emoji = ""
    if (p.stok_count === 0) {
      emoji = "❌"
    } else if (p.stok_count <= 5) {
      emoji = "⚠️"
    } else if (p.stok_count <= 20) {
      emoji = "✅"
    } else {
      emoji = "🟢"
    }
    
    const persentase = p.terjual > 0 ? Math.round((p.terjual / (p.terjual + p.stok_count)) * 100) : 0
    
    tx += `${emoji} *${p.nama.toUpperCase()}*
📊 Stok: *${p.stok_count}* | Terjual: *${p.terjual}* | ${persentase}% terjual
🔖 Kode: \`${p.kode}\` | 💰 ${formatrupiah(p.harga)}
━━━━━━━━━━━━━━━━━━━━\n`
  })
  
  // Create inline keyboard
  const buttons = []
  
  // Product buttons (first 6 products)
  const productRows = []
  for (let i = 0; i < Math.min(6, sortedProduk.length); i += 2) {
    const row = []
    row.push({ 
      text: `${i + 1}️⃣ ${sortedProduk[i].nama.substring(0, 15)}${sortedProduk[i].nama.length > 15 ? '...' : ''}`, 
      callback_data: `stok_detail_${sortedProduk[i].kode}` 
    })
    if (sortedProduk[i + 1]) {
      row.push({ 
        text: `${i + 2}️⃣ ${sortedProduk[i + 1].nama.substring(0, 15)}${sortedProduk[i + 1].nama.length > 15 ? '...' : ''}`, 
        callback_data: `stok_detail_${sortedProduk[i + 1].kode}` 
      })
    }
    productRows.push(row)
  }
  buttons.push(...productRows)
  
  buttons.push([
    { text: "🔍 Filter Lain", callback_data: "stok_filter" },
    { text: "📊 Statistik", callback_data: "stok_statistik" }
  ])
  
  buttons.push([{ text: "🔙 Kembali ke Stok", callback_data: "stok" }])
  
  await bot.answerCallbackQuery(query.id)
  await bot.sendMessage(query.from.id, tx, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: buttons
    }
  })
}

// Handler untuk statistik stok
if (cmd === "stok_statistik") {
  let { data: Produk } = await supabase
    .from("Produk")
    .select("*")
  
  if (!Produk || Produk.length === 0) {
    await bot.answerCallbackQuery(query.id, { text: "⚠️ Tidak ada produk!", show_alert: true })
    return
  }
  
  // Hitung stok untuk setiap produk
  const ProdukWithStok = await Promise.all(Produk.map(async (p) => {
    const stokCount = await getStokCount(p.kode)
    return { ...p, stok_count: stokCount }
  }))
  
  // Calculate statistics
  let totalStok = 0
  let totalTerjual = 0
  let produkHabis = 0
  let produkRendah = 0
  let produkNormal = 0
  let produkBanyak = 0
  
  const produkTerlaris = []
  
  ProdukWithStok.forEach(p => {
    const stok = p.stok_count || 0
    const terjual = p.terjual || 0
    totalStok += stok
    totalTerjual += terjual
    
    if (stok === 0) produkHabis++
    else if (stok <= 5) produkRendah++
    else if (stok <= 20) produkNormal++
    else produkBanyak++
    
    if (terjual > 0) {
      produkTerlaris.push({ nama: p.nama, terjual: terjual, kode: p.kode })
    }
  })
  
  produkTerlaris.sort((a, b) => b.terjual - a.terjual)
  
  const statText = `📊 *STATISTIK STOK PRODUK*
━━━━━━━━━━━━━━━━━━━━
📈 *Ringkasan Umum*
━━━━━━━━━━━━━━━━━━━━
📦 Total Produk: *${Produk.length}*
📊 Total Stok: *${totalStok}*
💰 Total Terjual: *${totalTerjual}*
📈 Rata-rata Stok/Produk: *${Math.round(totalStok / ProdukWithStok.length)}*

━━━━━━━━━━━━━━━━━━━━
📊 *Status Stok*
━━━━━━━━━━━━━━━━━━━━
❌ Habis: *${produkHabis}* produk
⚠️ Rendah (≤5): *${produkRendah}* produk
✅ Normal (6-20): *${produkNormal}* produk
🟢 Banyak (>20): *${produkBanyak}* produk

━━━━━━━━━━━━━━━━━━━━
🏆 *Produk Terlaris* (Top 5)
━━━━━━━━━━━━━━━━━━━━
${produkTerlaris.slice(0, 5).map((p, idx) => 
  `${idx + 1}. *${p.nama}* - ${p.terjual}x terjual`
).join('\n') || 'Belum ada data'}

━━━━━━━━━━━━━━━━━━━━`
  
  await bot.answerCallbackQuery(query.id)
  await bot.sendMessage(query.from.id, statText, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🔙 Kembali ke Stok", callback_data: "stok" }]
      ]
    }
  })
}

// Handler untuk melihat semua stok produk
if (cmd.startsWith("stok_viewall_")) {
  const kode = cmd.replace("stok_viewall_", "")
  
  let { data: Produk } = await supabase
    .from("Produk")
    .select("*")
    .eq("kode", kode.toLowerCase())
    .single()
  
  if (!Produk) {
    await bot.answerCallbackQuery(query.id, { text: "❌ Produk tidak ditemukan!", show_alert: true })
    return
  }
  
  // Ambil semua stok dari tabel Stok
  const stokItems = await getStokItems(kode.toLowerCase())
  const tersediaItems = stokItems.filter(s => s.status === 'tersedia')
  
  if (tersediaItems.length === 0) {
    await bot.answerCallbackQuery(query.id, { text: "Stok kosong!", show_alert: true })
    return
  }
  
  // Send as file if too many items
  if (tersediaItems.length > 50) {
    const fileContent = tersediaItems.map(s => s.data).join('\n')
    const filename = `stok_${Produk.kode}_${Date.now()}.txt`
    const filepath = `./${filename}`
    fs.writeFileSync(filepath, fileContent)
    
    await bot.answerCallbackQuery(query.id)
    await bot.sendDocument(query.from.id, filepath, {
      filename: filename,
      contentType: 'text/plain',
      caption: `📋 *SEMUA STOK PRODUK*
━━━━━━━━━━━━━━━━━━━━
📦 *Produk:* ${Produk.nama}
🔖 *Kode:* \`${Produk.kode}\`
📊 *Total Stok:* ${tersediaItems.length}
━━━━━━━━━━━━━━━━━━━━
File berisi semua data stok produk.`,
      parse_mode: "Markdown"
    })
    
    fs.unlinkSync(filepath)
  } else {
    let text = `📋 *SEMUA STOK PRODUK*
━━━━━━━━━━━━━━━━━━━━
📦 *Produk:* ${Produk.nama}
🔖 *Kode:* \`${Produk.kode}\`
📊 *Total Stok:* ${tersediaItems.length}
━━━━━━━━━━━━━━━━━━━━`
    
    await bot.answerCallbackQuery(query.id)
    await bot.sendMessage(query.from.id, text, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔙 Kembali ke Detail", callback_data: `stok_detail_${Produk.kode}` }]
        ]
      }
    })
  }
}

// Handler untuk riwayat penjualan produk
if (cmd.startsWith("stok_history_")) {
  const kode = cmd.replace("stok_history_", "")
  
  let { data: Produk } = await supabase
    .from("Produk")
    .select("*")
    .eq("kode", kode.toLowerCase())
    .single()
  
  if (!Produk) {
    await bot.answerCallbackQuery(query.id, { text: "❌ Produk tidak ditemukan!", show_alert: true })
    return
  }
  
  const { data: Trx } = await supabase
    .from("Trx")
    .select("*")
    .eq("kode", kode.toLowerCase())
    .order("tanggal", { ascending: false })
    .limit(10)
  
  if (!Trx || Trx.length === 0) {
    await bot.answerCallbackQuery(query.id)
    await bot.sendMessage(query.from.id, `📊 *RIWAYAT PENJUALAN*
━━━━━━━━━━━━━━━━━━━━
📦 *Produk:* ${Produk.nama}
🔖 *Kode:* \`${Produk.kode}\`

Belum ada transaksi untuk produk ini.

━━━━━━━━━━━━━━━━━━━━`, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔙 Kembali ke Detail", callback_data: `stok_detail_${Produk.kode}` }]
        ]
      }
    })
    return
  }
  
  let text = `📊 *RIWAYAT PENJUALAN*
━━━━━━━━━━━━━━━━━━━━
📦 *Produk:* ${Produk.nama}
🔖 *Kode:* \`${Produk.kode}\`
📊 *Total Transaksi:* ${Trx.length}
━━━━━━━━━━━━━━━━━━━━

*Transaksi Terakhir:*
`
  
  Trx.forEach((t, idx) => {
    text += `${idx + 1}. ${formatrupiah(t.harga)} (${t.jumlah}x)
   🕒 ${formatWIB(t.tanggal)}
   🆔 \`${t.trxid || 'N/A'}\`
━━━━━━━━━━━━━━━━━━━━\n`
  })
  
  await bot.answerCallbackQuery(query.id)
  await bot.sendMessage(query.from.id, text, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🔙 Kembali ke Detail", callback_data: `stok_detail_${Produk.kode}` }]
      ]
    }
  })
}

// Handler untuk menu edit stok (owner only)
// Handler untuk callback "addstok" dari tombol
if (cmd === "batalvoucher") {
  if (await cart.exists(query.from.id)) {
    let Data = await cart.get(query.from.id)
    Data.voucher_status = ""
    await cart.save(query.from.id, Data)
    await bot.deleteMessage(query.message.chat.id, query.message.message_id)
    const userSaldo = await cekSaldo(query.from.id)
    const item = await getVarianForCart(Data.kode)
    if (!item) return await sendMessage(query.from.id, `⚠️ Produk tidak ditemukan!`)
    const resolvedSaldo = await hargaUntukQty(item, Data.jumlah)
    let { data: Voucher } = await supabase.from("Voucher").select("*")
    let harga = applyVoucherPotongan(resolvedSaldo.subtotal, query.from.id, Data.voucher, Voucher)
    
    let keyboard = []
    if (userSaldo >= harga) {
      keyboard.push([{text: "💰 Bayar Pakai Saldo", callback_data: "bayarsaldo"}])
    }
    keyboard.push([
      {text: "Tidak", callback_data: "bayar"},
      {text: "Punya", callback_data: "punya"}
    ])
    
    await bot.sendMessage(query.from.id, `💳 *PILIH METODE PEMBAYARAN*
=======================
💰 *Saldo Anda:* ${formatrupiah(userSaldo)}
💵 *Total Bayar:* ${formatrupiah(harga)}
${userSaldo >= harga ? '✅ Saldo mencukupi\n' : '⚠️ Saldo tidak mencukupi\n'}=======================
🎟 Jika kamu mempunyai kode voucher yang berlaku, silahkan klik tombol Punya, jika tidak klik Tidak.`, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: keyboard
      }
    })
  } else {
    await sendMessage(query.from.id, `⚠️ Harap ulangi pilih produk!`)
  }
}

if (cmd.startsWith("min:")) {
  let jumlah = cmd.split("min:")[1]
  if (await cart.exists(query.from.id)) {
    let Data = await cart.get(query.from.id)
    let gs = Data.jumlah-Number(jumlah)
    if (gs < 1) {
     await bot.answerCallbackQuery(query.id, { text: "⚠️ Jumlah pesanan tidak boleh kurang dari 1", show_alert: true })
     return
   }
    Data.jumlah -= Number(jumlah)
    await cart.save(query.from.id, Data)
     const item = await getVarianForCart(Data.kode)
     if (!item) return await sendMessage(query.from.id, `⚠️ Produk tidak ditemukan, harap ulangi pilih produk!`)
     const stokCount = item.stok_count ?? await getStokCount(item.kode)
     const resolvedMin = await hargaUntukQty(item, Data.jumlah)
    await bot.editMessageText(`*KONFIRMASI PESANAN*
=======================
Produk: *${item.nama}*
Harga: *${formatrupiah(resolvedMin.harga_satuan)}*
Stok Tersedia: *${stokCount}*
-----------------------
Jumlah Pesanan: *${Data.jumlah}*
Total Dibayar: *${formatrupiah(resolvedMin.subtotal)}*
=======================
Klik ✅ Konfirmasi untuk melakukan pembayaran`, {
  parse_mode: "Markdown",
  reply_markup: {
    inline_keyboard: [
      [{text: "-", callback_data: "min:1"}, {text: "+", callback_data: "plus:1"}],
      [
      {text: "+5", callback_data: "plus:5"},
      {text: "+10", callback_data: "plus:10"},
      {text: "+25", callback_data: "plus:25"},
      {text: "+50", callback_data: "plus:50"},
      ],
      [{text: "🔄 Reset", callback_data: "reset"}],
          [{text: "🔙 Kembali", callback_data: "kembaliawal"}, {text: "✅ Konfirmasi", callback_data: "konfirmasi"}]
      ]
  },
  chat_id: query.message.chat.id,
  message_id: query.message.message_id
})
  } else {
    await sendMessage(query.from.id, `⚠️ Harap ulangi pilih produk!`)
  }
}
if (cmd.startsWith("plus:")) {
  let jumlah = cmd.split("plus:")[1]
  if (await cart.exists(query.from.id)) {
    let Data = await cart.get(query.from.id)
    const item = await getVarianForCart(Data.kode)
     if (!item) return await sendMessage(query.from.id, `⚠️ Produk tidak ditemukan, harap ulangi pilih produk!`)
     const stokCount = item.stok_count ?? await getStokCount(item.kode)
     if (stokCount < (Data.jumlah+Number(jumlah))) {
       await bot.answerCallbackQuery(query.id, { text: "⚠️ Stok produk tidak mencukupi", show_alert: true })
       return
     }
     Data.jumlah += Number(jumlah)
    await cart.save(query.from.id, Data)
     const itemUpdated = await getVarianForCart(Data.kode)
     if (!itemUpdated) return await sendMessage(query.from.id, `⚠️ Produk tidak ditemukan, harap ulangi pilih produk!`)
     const stokCountUpdated = itemUpdated.stok_count ?? await getStokCount(itemUpdated.kode)
     const resolvedPlus = await hargaUntukQty(itemUpdated, Data.jumlah)
     
     await bot.editMessageText(`*KONFIRMASI PESANAN*
=======================
Produk: *${itemUpdated.nama}*
Harga: *${formatrupiah(resolvedPlus.harga_satuan)}*
Stok Tersedia: *${stokCountUpdated}*
-----------------------
Jumlah Pesanan: *${Data.jumlah}*
Total Dibayar: *${formatrupiah(resolvedPlus.subtotal)}*
=======================
Klik ✅ Konfirmasi untuk melakukan pembayaran`, {
  parse_mode: "Markdown",
  reply_markup: {
    inline_keyboard: [
      [{text: "-", callback_data: "min:1"}, {text: "+", callback_data: "plus:1"}],
      [
      {text: "+5", callback_data: "plus:5"},
      {text: "+10", callback_data: "plus:10"},
      {text: "+25", callback_data: "plus:25"},
      {text: "+50", callback_data: "plus:50"},
      ],
      [{text: "🔄 Reset", callback_data: "reset"}],
          [{text: "🔙 Kembali", callback_data: "kembaliawal"}, {text: "✅ Konfirmasi", callback_data: "konfirmasi"}]
      ]
  },
  chat_id: query.message.chat.id,
  message_id: query.message.message_id
})
  } else {
    await sendMessage(query.from.id, `⚠️ Harap ulangi pilih produk!`)
  }
}

if (cmd === "batalbeli") {
  if (await cart.exists(query.from.id)) {
    let Data = await cart.get(query.from.id)
    
    // Release reservations sebelum cancel
    if (Data.selectedStokIds && Data.selectedStokIds.length > 0) {
      releaseReservation(Data.selectedStokIds)
      console.log(`🔓 Release ${Data.selectedStokIds.length} reserved stocks for user ${query.from.id} (cancel)`)
    }
    
    await bot.deleteMessage(query.message.chat.id, query.message.message_id)
    await cart.clear(query.from.id)
    await sendMessage(query.from.id,`✅ Pesananmu berhasil dibatalkan.`)
  }
}

if (cmd === "bayarsaldo") {
  if (await cart.exists(query.from.id)) {
    try {
      await bot.deleteMessage(query.message.chat.id, query.message.message_id)
    } catch (e) {}
    let Data = await cart.get(query.from.id)
    const item = await getVarianForCart(Data.kode)
    if (!item) return await sendMessage(query.from.id, `⚠️ Produk tidak ditemukan, harap ulangi pilih produk!`)
    
    const resolvedSaldo = await hargaUntukQty(item, Data.jumlah)
    let { data: Voucher } = await supabase.from("Voucher").select("*")
    let harga = applyVoucherPotongan(resolvedSaldo.subtotal, query.from.id, Data.voucher, Voucher)
    
    const userSaldo = await cekSaldo(query.from.id)
    if (userSaldo < harga) {
      return await bot.sendMessage(query.from.id, `❌ *SALDO TIDAK CUKUP*
=======================
💰 *Saldo Anda:* ${formatrupiah(userSaldo)}
💵 *Total Bayar:* ${formatrupiah(harga)}
⚠️ *Kurang:* ${formatrupiah(harga - userSaldo)}
=======================
💡 Top up saldo dengan \`/deposit\` atau gunakan metode pembayaran lain.`, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{text: "💳 Top Up Saldo", callback_data: "deposit_menu"}],
            [{text: "💸 Bayar QRIS", callback_data: "bayar"}]
          ]
        }
      })
    }
    
    // Ambil stok yang dipilih atau gunakan FIFO
    let stokItems = []
    if (Data.selectedStokIds && Data.selectedStokIds.length > 0) {
      // Ambil stok yang dipilih customer
      const allStok = await getStokItems(Data.kode.toLowerCase())
      stokItems = allStok.filter(s => Data.selectedStokIds.includes(s.id) && s.status === 'tersedia')
      
      // Validasi semua stok masih tersedia DAN masih reserved untuk user ini
      for (const stokId of Data.selectedStokIds) {
        if (!isStokAvailable(stokId, query.from.id)) {
          // Release semua reservation
          releaseReservation(Data.selectedStokIds)
          
          return await sendMessage(query.from.id, `⚠️ Beberapa stok sudah tidak tersedia atau timeout reservasi! Silakan pilih ulang.`, {
            reply_markup: {
              inline_keyboard: [
                [{text: "🔙 Kembali Pilih Stok", callback_data: "lanjut"}]
              ]
            }
          })
        }
      }
      
      if (stokItems.length !== Data.selectedStokIds.length) {
        // Release semua reservation
        releaseReservation(Data.selectedStokIds)
        
        return await sendMessage(query.from.id, `⚠️ Beberapa stok yang dipilih sudah tidak tersedia! Silakan pilih ulang.`, {
          reply_markup: {
            inline_keyboard: [
              [{text: "🔙 Kembali Pilih Stok", callback_data: "lanjut"}]
            ]
          }
        })
      }
    } else {
      // Fallback ke FIFO jika tidak ada pilihan
      const stokCount = await getStokCount(Data.kode.toLowerCase())
      if (Data.jumlah > stokCount) {
        return await sendMessage(query.from.id, `⚠️ Stok produk tidak mencukupi! Stok tersedia: ${stokCount}`)
      }
      
      stokItems = await getStokForTransaction(Data.kode.toLowerCase(), Data.jumlah)
      
      if (stokItems.length < Data.jumlah) {
        return await sendMessage(query.from.id, `⚠️ Stok tidak mencukupi! Stok tersedia: ${stokItems.length}`)
      }
    }
    
    // Kurangi saldo
    await minSaldo(query.from.id, harga)
    
    // Mark stok sebagai terjual
    const stokIds = stokItems.map(s => s.id)
    await markStokTerjual(stokIds, Data.trxid)
    
    // Release reservation setelah sukses bayar
    if (Data.selectedStokIds && Data.selectedStokIds.length > 0) {
      releaseReservation(stokIds)
      console.log(`✅ Release ${stokIds.length} reserved stocks after successful payment`)
    }
    
    // Ambil data produk untuk dikirim
    let DataProdukRaw = stokItems.map(s => s.data).join('\n')
    
    // Format data produk sesuai format
    const productFormat = item.format || null
    let DataProduk = formatProductDataForFile(DataProdukRaw, productFormat)
    
    // Update counter terjual di Produk
    const { data: dts } = await supabase
      .from('Varian')
      .select('terjual')
      .eq('kode', Data.kode.toLowerCase())
      .single()
    
    if (dts) {
      await supabase
        .from('Varian')
        .update({ terjual: dts.terjual + Data.jumlah })
        .eq('kode', Data.kode.toLowerCase())
    }
    
    let txfile = `<|==== SYARAT DAN KETENTUAN ====|>
${item.snk}

<|==== PRODUK ====|>
${DataProduk}

//Terimakasih telah percaya kepada ${NamaBot}. Kami harap layanan kami dapat membuat anda puas`
    
    let txxx = "```txt\n[GARANSI / S&K]\n" + item.snk + "\n\n[DATA PRODUK]\n" + DataProduk + "```"
    let pathtxt = `./${query.from.id}-${item.kode}-${Data.jumlah}.txt`
    fs.writeFileSync(pathtxt, txfile)
    let tggl = new Date().toISOString()
    const saldoBaru = await cekSaldo(query.from.id)
    
    // Calculate discount amount if voucher used
    const discountAmount = vcr && !vcr.user.some(a => a === query.from.id) && vcr.limit > 0 ? vcr.potongan : 0
    
    // Build completion message
    // Jika pembelian lebih dari 2, jangan tampilkan preview produk di caption
    const showPreview = Data.jumlah <= 2
    
    let completionMessage = `🎉 *PESANAN BERHASIL!*
━━━━━━━━━━━━━━━━━━━━
✅ *Status:* Selesai & Terkirim
💳 *Metode:* Saldo
📋 *Trx ID:* \`${Data.trxid}\`
🕒 *Waktu:* ${formatWIB(tggl)}

━━━━━━━━━━━━━━━━━━━━
📦 *DETAIL PESANAN*
━━━━━━━━━━━━━━━━━━━━
🛍️ *Produk:* ${item.nama}
📊 *Jumlah:* ${Data.jumlah} item
💰 *Harga Satuan:* ${formatrupiah(resolvedSaldo.harga_satuan)}
${discountAmount > 0 ? `🎟️ *Voucher:* ${Data.voucher}\n💸 *Potongan:* ${formatrupiah(discountAmount)}` : ''}
━━━━━━━━━━━━━━━━━━━━
💎 *TOTAL BAYAR:* ${formatrupiah(harga)}
💰 *Saldo Terpakai:* ${formatrupiah(harga)}
💵 *Saldo Sekarang:* ${formatrupiah(saldoBaru)}
━━━━━━━━━━━━━━━━━━━━
${showPreview ? `\n${txxx}\n\n━━━━━━━━━━━━━━━━━━━━\n` : ''}💡 *TIPS:* File produk sudah dikirim sebagai dokumen di atas!
━━━━━━━━━━━━━━━━━━━━
Terima kasih telah berbelanja di *${NamaBot}*! 🙏`

    // Batasi panjang caption maksimal 1024 karakter (batas Telegram)
    const MAX_CAPTION_LENGTH = 1024
    if (completionMessage.length > MAX_CAPTION_LENGTH) {
      // Jika masih terlalu panjang, buat versi super singkat
      completionMessage = `🎉 *PESANAN BERHASIL!*
━━━━━━━━━━━━━━━━━━━━
✅ *Status:* Selesai & Terkirim
💳 *Metode:* Saldo
📋 *Trx ID:* \`${Data.trxid}\`
🕒 *Waktu:* ${formatWIB(tggl)}

━━━━━━━━━━━━━━━━━━━━
🛍️ *Produk:* ${item.nama}
📊 *Jumlah:* ${Data.jumlah} item
💎 *Total:* ${formatrupiah(harga)}
💵 *Saldo:* ${formatrupiah(saldoBaru)}
━━━━━━━━━━━━━━━━━━━━
💡 File produk sudah dikirim sebagai dokumen!
Terima kasih! 🙏`
    }

    // Quick action keyboard
    const completionKeyboard = {
      inline_keyboard: [
        [
          { text: "📋 Detail Pesanan", callback_data: `detail_trx_${Data.trxid}` },
          { text: "📥 Unduh Ulang", callback_data: `redownload_${Data.trxid}` }
        ],
        [
          { text: "📋 Salin Data", callback_data: `copy_data_${Data.trxid}` },
          { text: "🔄 Pesan Lagi", callback_data: `order_again_${item.kode}` }
        ],
        [
          { text: "⭐ Beri Rating", callback_data: `rate_${Data.trxid}` },
          { text: "💬 Hubungi CS", url: channelContact.cs }
        ],
        [
          { text: "📊 Lihat Riwayat", callback_data: "riwayattransaksi" },
          { text: "🛍️ Belanja Lagi", callback_data: "daftarproduk" }
        ]
      ]
    }
    
    try {
      await bot.sendDocument(query.from.id, pathtxt, {
        filename: `${query.from.id}-${item.kode}-${Data.jumlah}.txt`,
        contentType: 'text/plain',
        parse_mode: "Markdown",
        caption: completionMessage,
        reply_markup: completionKeyboard
      })
    } catch (sendError) {
      console.error('Error mengirim produk:', sendError)
      
      // Jika error, kirim file tanpa caption, lalu kirim pesan terpisah
      await bot.sendDocument(query.from.id, pathtxt, {
        filename: `${query.from.id}-${item.kode}-${Data.jumlah}.txt`,
        contentType: 'text/plain'
      })
      
      // Kirim pesan terpisah
      await bot.sendMessage(query.from.id, `🎉 *PESANAN BERHASIL!*
━━━━━━━━━━━━━━━━━━━━
✅ *Status:* Selesai & Terkirim
📋 *Trx ID:* \`${Data.trxid}\`
🛍️ *Produk:* ${item.nama}
📊 *Jumlah:* ${Data.jumlah} item
💎 *Total:* ${formatrupiah(harga)}
💵 *Saldo:* ${formatrupiah(saldoBaru)}
━━━━━━━━━━━━━━━━━━━━
Terima kasih! 🙏`, {
        parse_mode: "Markdown",
        reply_markup: completionKeyboard
      })
    }

    try {
      const replyKb = await generateReplyKeyboard(query.from.id)
      await bot.sendMessage(query.from.id, `🛒 *Pesanan Selesai.* Saldo Anda telah diperbarui.`, {
        reply_markup: replyKb
      })
    } catch (replyKbError) {
      console.error('Error updating reply keyboard after purchase:', replyKbError)
    }
    
    // Store product data temporarily for redownload/copy (save to a temp file)
    const tempDataPath = `./Database/Trx/temp_${Data.trxid}.json`
    fs.writeFileSync(tempDataPath, JSON.stringify({
      trxid: Data.trxid,
      userId: query.from.id,
      produkData: DataProduk,
      produkInfo: {
        nama: item.nama,
        kode: item.kode,
        snk: item.snk
      },
      jumlah: Data.jumlah,
      harga: harga,
      fee: 0,
      total: harga,
      tanggal: tggl,
      voucher: Data.voucher || null,
      metode: 'saldo'
    }, null, 2))
    
    // Kirim notifikasi pembelian ke feed channel
    await sendFeedMessage(
      `🛍️ *Someone just bought ${Data.jumlah}x ${item.nama}!*`,
      'purchase'
    ).catch(err => console.error('Error sending purchase feed message:', err))

    await bot.sendMessage(channelContact.channelLog, `✅ *PESANAN SELESAI (SALDO)*
=======================
User: @${query.from.username || query.from.first_name}
Trx ID: *${Data.trxid}*
Produk: *${item.nama}*
Harga: *${formatrupiah(resolvedSaldo.harga_satuan)}*
Jumlah Beli: *${Data.jumlah}*
Total Harga: *${formatrupiah(harga)}*
Metode: *Saldo*
Tanggal: *${formatWIB(tggl)}*
=======================`, {
      parse_mode: "Markdown"
    })
    
    await supabase.from("Trx").insert([{
      id: query.from.id,
      varian_id: item.id,
      produk_id: item.produk_id,
      nama: item.nama,
      kode: item.kode,
      jumlah: Data.jumlah,
      harga: harga,
      harga_satuan: resolvedSaldo.harga_satuan,
      tanggal: tggl,
      trxid: Data.trxid
    }])
    
    fs.unlinkSync(pathtxt)
    
    // Update voucher jika ada
    let ds = null
    Object.keys(Voucher).forEach((fd) => {
      if (Voucher[fd].kode === Data.voucher) ds = fd
    })
    if (ds !== null) {
      const { data: dtss } = await supabase
        .from('Voucher')
        .select('*')
        .eq('kode', Data.voucher)
        .single()
      if (dtss) {
        dtss.user.push(query.from.id)
        await supabase
          .from("Voucher")
          .update({ limit: dtss.limit - 1, user: dtss.user })
          .eq('kode', Data.voucher)
      }
    }
    
    // Update user stats
    const { data: userData } = await supabase
      .from('User')
      .select('jumlahtransaksi, pengeluaran')
      .eq('id', query.from.id)
      .single()
    
    if (userData) {
      const newJumlahtransaksi = userData.jumlahtransaksi + 1
      await supabase
        .from('User')
        .update({
          jumlahtransaksi: newJumlahtransaksi,
          pengeluaran: userData.pengeluaran + harga
        })
        .eq('id', query.from.id)
      
      // Achievement messages
      if (newJumlahtransaksi === 1) {
        await bot.sendMessage(query.from.id, `🎊 *SELAMAT!*
━━━━━━━━━━━━━━━━━━━━
🏆 *Pencapaian Baru*
━━━━━━━━━━━━━━━━━━━━
🎯 Ini adalah transaksi pertama Anda!
Terima kasih sudah mempercayai *${NamaBot}*

🎁 *Bonus:* Salin data produk lebih mudah
dengan tombol "📋 Salin Data" di atas!`, {
          parse_mode: "Markdown"
        })
      } else if (newJumlahtransaksi % 5 === 0) {
        await bot.sendMessage(query.from.id, `🎉 *MILESTONE!*
━━━━━━━━━━━━━━━━━━━━
🏆 Ini adalah transaksi ke-${newJumlahtransaksi} Anda!
━━━━━━━━━━━━━━━━━━━━
Terima kasih sudah setia berbelanja
di *${NamaBot}*! 🙏`, {
          parse_mode: "Markdown"
        })
      }
    }
    
    // Kosongkan keranjang (stok sudah ditandai terjual, jadi tidak ada
    // reservasi yang perlu dilepas di sini)
    await cart.clear(query.from.id)
    
    // Kembali ke menu utama
    let { data: Trx } = await supabase.from("Trx").select("*")
    let { data: User } = await supabase.from("User").select("*")
    let { data: Produk2 } = await supabase.from("Produk").select("*")
    let stokterjual = 0
    let stoktersedia = 0
    if (Trx && Trx.length !== 0) {
      Object.keys(Trx).forEach((g) => {
        stokterjual += Trx[g].jumlah
      })
    }
    if (Produk2 && Produk2.length !== 0) {
      for (let g = 0; g < Produk2.length; g++) {
        const stokCount = await getStokCount(Produk2[g].kode)
        stoktersedia += stokCount
      }
    }
    
    await sendBannerMessage(query.from.id, welcomeCaption({
      first_name: query.from.first_name,
      user_count: User ? User.length : 0,
      stok_terjual: stokterjual,
      stok_tersedia: stoktersedia,
      saldo: saldoBaru,
    }), {
      reply_markup: welcomeInlineKeyboard()
    })
  } else {
    await sendMessage(query.from.id, `⚠️ Harap ulangi pilih produk!`)
  }
}

if (cmd === "bayar") {
  if (await cart.exists(query.from.id)) {
    try {
      await bot.deleteMessage(query.message.chat.id, query.message.message_id)
    } catch (e) {}
    let Data = await cart.get(query.from.id)
    const item = await getVarianForCart(Data.kode)
    if (!item) return await sendMessage(query.from.id, `⚠️ Produk tidak ditemukan, harap ulangi pilih produk!`)
    let DataProduk = ""
    const resolvedBayar = await hargaUntukQty(item, Data.jumlah)
    let { data: Voucher } = await supabase.from("Voucher").select("*")
    let harga = applyVoucherPotongan(resolvedBayar.subtotal, query.from.id, Data.voucher, Voucher)
    // Validasi stok yang dipilih atau cek stok tersedia
    if (Data.selectedStokIds && Data.selectedStokIds.length > 0) {
      const allStok = await getStokItems(Data.kode.toLowerCase())
      const tersediaIds = allStok.filter(s => s.status === 'tersedia').map(s => s.id)
      const validIds = Data.selectedStokIds.filter(id => tersediaIds.includes(id))
      
      if (validIds.length !== Data.selectedStokIds.length) {
        return await sendMessage(query.from.id, `⚠️ Beberapa stok yang dipilih sudah tidak tersedia! Silakan pilih ulang.`, {
          reply_markup: {
            inline_keyboard: [
              [{text: "🔙 Kembali Pilih Stok", callback_data: "lanjut"}]
            ]
          }
        })
      }
    } else {
      // Fallback ke cek stok count jika tidak ada pilihan
      const stokCount = await getStokCount(Data.kode.toLowerCase())
      if (Data.jumlah > stokCount) {
        return await sendMessage(query.from.id, `⚠️ Stok produk tidak mencukupi! Stok tersedia: ${stokCount}`)
      }
    }
    
    let uniq = require("crypto").randomBytes(5).toString("hex").toUpperCase()
    let time = Date.now() + toMs("10m")
    
    if (!Pakasir.project) {
      console.error("Pakasir project slug is not configured in .env");
      return await sendMessage(query.from.id, `❌ *ERROR*\n=======================\nSistem QRIS belum dikonfigurasi dengan benar oleh pemilik toko. Silakan hubungi admin.`)
    }

    if (!Pakasir.apiKey) {
      console.error("Pakasir API key is not configured in .env");
      return await sendMessage(query.from.id, `❌ *ERROR*\n=======================\nSistem verifikasi pembayaran belum dikonfigurasi dengan benar oleh pemilik toko. Silakan hubungi admin.`)
    }

    try {
      // Create a Pakasir QRIS transaction (order_id = trx id)
      const pay = await pakasir.createTransaction({ orderId: Data.trxid, amount: harga });
      const totalAmount = pay.total_payment; // amount + Pakasir fee (paid by the customer)
      const imageBuffer = await generateQRBuffer(pay.payment_number);

      // Payment coordination row (webhook + polling fallback)
      await supabase
        .from("Payment")
        .insert([{
          order_id: Data.trxid,
          type: 'purchase',
          user_id: query.from.id,
          amount: harga,
          fee: pay.fee || 0,
          total: totalAmount,
          status: 'pending',
          payment_method: 'qris',
          qr_string: pay.payment_number,
          expired_at: pay.expired_at || null,
          meta: { kode: Data.kode, jumlah: Data.jumlah, voucher: Data.voucher || null, selectedStokIds: Data.selectedStokIds || [] }
        }])

      let txx = `💸 *PEMBAYARAN OTOMATIS*
=======================
Trx ID: *${Data.trxid}*
Produk: *${item.nama}*
Harga: *${formatrupiah(resolvedBayar.harga_satuan)}*
Jumlah Beli: *${Data.jumlah}*
Fee: *${formatrupiah(pay.fee || 0)}*
Total Harga: *${formatrupiah(totalAmount)}*
=======================
⚠️ *PENTING:* Transfer harus sama persis sejumlah *${formatrupiah(totalAmount)}* agar pembayaran dapat terdeteksi otomatis!
Scan QRIS diatas sebelum expired. Produk akan terkirim otomatis beberapa detik setelah kamu bayar!`
      
      let ff = await retryBotOperation(async () => {
        return await bot.sendPhoto(query.from.id, imageBuffer, {
          parse_mode: "Markdown",
          caption: txx,
          filename: 'qris-payment.png',
          contentType: 'image/png',
          reply_markup: {
            inline_keyboard: [
              [{text: "❌ Batal", callback_data: "batalbeli"}]
            ]
          }
        });
      });
      
      let statusP = false
      let pollAttempts = 0
      const maxPollAttempts = 60 // Maksimal 60 kali polling (10 menit)
      
      // Keranjang dicek ulang setiap iterasi (sama seperti fs.existsSync dulu):
      // kalau user membatalkan pesanan, polling ikut berhenti. Sekarang ini satu
      // query indexed per 10 detik per pembayaran pending, bukan stat() disk.
      while (!statusP && pollAttempts < maxPollAttempts && await cart.exists(query.from.id)) {
        await sleep(10000)
        pollAttempts++
        
        if (Date.now() >= time) {
          statusP = true
          
          // Release reservations saat expired
          if (await cart.exists(query.from.id)) {
            let DataExpired = await cart.get(query.from.id)
            if (DataExpired.selectedStokIds && DataExpired.selectedStokIds.length > 0) {
              releaseReservation(DataExpired.selectedStokIds)
              console.log(`🔓 Release ${DataExpired.selectedStokIds.length} reserved stocks for user ${query.from.id} (expired)`)
            }
          }
          
          await retryBotOperation(async () => {
            return await bot.deleteMessage(ff.chat.id, ff.message_id);
          }).catch(err => {
            if (err.response?.body?.error_code !== 400) {
              console.warn('Error deleting message:', err.message);
            }
          });
          await sendMessage(query.from.id, `Pesananmu telah expired, harap pesan kembali!`)
          await supabase.from("Payment").update({ status: 'expired' }).eq('order_id', Data.trxid).eq('status', 'pending')
          pakasir.cancelTransaction({ orderId: Data.trxid, amount: harga }).catch(() => {})
          await cart.clear(query.from.id)
          break;
        }
        try {
          // Webhook may have already marked it paid; otherwise ask Pakasir directly.
          let match = false
          const { data: payRow } = await supabase
            .from("Payment").select("status").eq("order_id", Data.trxid).single()
          if (payRow && (payRow.status === 'paid' || payRow.status === 'fulfilled')) {
            match = true
          } else {
            const trxDetail = await pakasir.getTransactionStatus({ orderId: Data.trxid, amount: harga })
            if (trxDetail && trxDetail.status === 'completed') match = true
          }

          // Atomically claim fulfillment so the webhook/cron cannot double-deliver.
          if (match) {
            const { data: claimed } = await supabase
              .from("Payment")
              .update({ status: 'fulfilled' })
              .eq('order_id', Data.trxid)
              .in('status', ['pending', 'paid'])
              .select()
            if (!claimed || claimed.length === 0) { match = false; statusP = true }
          }
          
          if (match) {
            console.log(`[Checkout Polling] MATCH FOUND! Pembayaran terdeteksi:`, JSON.stringify(match));
            statusP = true
            
            // Validasi ulang stok sebelum mengambil produk
            let stokItems = []
            
            if (Data.selectedStokIds && Data.selectedStokIds.length > 0) {
              // Ambil stok yang dipilih customer
              const allStok = await getStokItems(Data.kode.toLowerCase())
              stokItems = allStok.filter(s => Data.selectedStokIds.includes(s.id) && s.status === 'tersedia')
              
              // Validasi semua stok masih tersedia
              if (stokItems.length !== Data.selectedStokIds.length) {
                // Release reservations
                if (Data.selectedStokIds && Data.selectedStokIds.length > 0) {
                  releaseReservation(Data.selectedStokIds)
                  console.log(`🔓 Release ${Data.selectedStokIds.length} reserved stocks (stok tidak cukup)`)
                }
                
                await retryBotOperation(async () => {
                  return await bot.deleteMessage(ff.chat.id, ff.message_id);
                }).catch(err => {
                  if (err.response?.body?.error_code !== 400) {
                    console.warn('Error deleting message:', err.message);
                  }
                });
                await sendMessage(query.from.id, `❌ *STOK TIDAK CUKUP*
=======================
Maaf, beberapa stok yang dipilih sudah tidak tersedia.

*Pesanan:* ${Data.jumlah} item
*Stok Valid:* ${stokItems.length} item

Silakan pesan ulang.`)
                await cart.clear(query.from.id)
                return
              }
            } else {
              // Fallback ke FIFO
              const stokCountCheck = await getStokCount(Data.kode.toLowerCase())
              
              if (stokCountCheck < Data.jumlah) {
                // Release reservations jika ada
                if (Data.selectedStokIds && Data.selectedStokIds.length > 0) {
                  releaseReservation(Data.selectedStokIds)
                  console.log(`🔓 Release ${Data.selectedStokIds.length} reserved stocks (stok tidak cukup FIFO)`)
                }
                
                await retryBotOperation(async () => {
                  return await bot.deleteMessage(ff.chat.id, ff.message_id);
                }).catch(err => {
                  if (err.response?.body?.error_code !== 400) {
                    console.warn('Error deleting message:', err.message);
                  }
                });
                await sendMessage(query.from.id, `❌ *STOK TIDAK CUKUP*
=======================
Maaf, stok produk tidak mencukupi untuk pesanan Anda.

*Pesanan:* ${Data.jumlah} item
*Stok Tersedia:* ${stokCountCheck} item

Silakan pesan ulang dengan jumlah yang sesuai.`)
                await cart.clear(query.from.id)
                return
              }
              
              // Ambil stok untuk transaksi
              stokItems = await getStokForTransaction(Data.kode.toLowerCase(), Data.jumlah)
              
              if (stokItems.length < Data.jumlah) {
                // Release reservations jika ada
                if (Data.selectedStokIds && Data.selectedStokIds.length > 0) {
                  releaseReservation(Data.selectedStokIds)
                  console.log(`🔓 Release ${Data.selectedStokIds.length} reserved stocks (FIFO stok tidak cukup)`)
                }
                
                await retryBotOperation(async () => {
                  return await bot.deleteMessage(ff.chat.id, ff.message_id);
                }).catch(err => {
                  // Ignore error jika message sudah dihapus atau tidak ditemukan
                  if (err.response?.body?.error_code !== 400) {
                    console.warn('Error deleting message:', err.message);
                  }
                });
                await sendMessage(query.from.id, `❌ *STOK TIDAK CUKUP*
=======================
Maaf, stok produk tidak mencukupi untuk pesanan Anda.

*Pesanan:* ${Data.jumlah} item
*Stok Tersedia:* ${stokItems.length} item

Silakan pesan ulang dengan jumlah yang sesuai.`)
                await cart.clear(query.from.id)
                return
              }
            }
            
            // Mark stok sebagai terjual
            const stokIds = stokItems.map(s => s.id)
            await markStokTerjual(stokIds, Data.trxid)
            
            // Ambil data produk untuk dikirim
            let DataProdukRaw = stokItems.map(s => s.data).join('\n')
            
            // Format data produk sesuai format
            const productFormat = item.format || null
            let DataProduk = formatProductDataForFile(DataProdukRaw, productFormat)
            
            // Update counter terjual di Varian
            try {
              const { data: dts } = await supabase
                .from('Varian')
                .select('terjual')
                .eq('kode', Data.kode.toLowerCase())
                .single()
              
              if (dts) {
                await supabase
                  .from('Varian')
                  .update({ terjual: dts.terjual + Data.jumlah })
                  .eq('kode', Data.kode.toLowerCase())
              }
            } catch (updateError) {
              console.error('Error update varian terjual:', updateError)
            }
            let txfile = `<|==== SYARAT DAN KETENTUAN ====|>
${item.snk}

<|==== PRODUK ====|>
${DataProduk}

//Terimakasih telah percaya kepada ${NamaBot}. Kami harap layanan kami dapat membuat anda puas`
let txxx = "```txt\n[GARANSI / S&K]\n" + item.snk + "\n\n[DATA PRODUK]\n" + DataProduk + "```"
let pathtxt = `./${query.from.id}-${item.kode}-${Data.jumlah}.txt`
fs.writeFileSync(pathtxt, txfile)
let tggl = new Date().toISOString()
      await retryBotOperation(async () => {
        return await bot.deleteMessage(ff.chat.id, ff.message_id);
      }).catch(err => {
        if (err.response?.body?.error_code !== 400) {
          console.warn('Error deleting message:', err.message);
        }
      });
      
      // Calculate discount amount if voucher used
      const discountAmount = vcr && !vcr.user.some(a => a === query.from.id) && vcr.limit > 0 ? vcr.potongan : 0
      const totalHarga = (pay.fee || 0) + harga
      
      // Build completion message
      // Jika pembelian lebih dari 2, tidak tampilkan preview produk di caption
      const showPreview = Data.jumlah <= 2
      let completionMessage = `🎉 *PESANAN BERHASIL!*
━━━━━━━━━━━━━━━━━━━━
✅ *Status:* Selesai & Terkirim
📋 *Trx ID:* \`${Data.trxid}\`
🕒 *Waktu:* ${formatWIB(tggl)}

━━━━━━━━━━━━━━━━━━━━
📦 *DETAIL PESANAN*
━━━━━━━━━━━━━━━━━━━━
🛍️ *Produk:* ${item.nama}
📊 *Jumlah:* ${Data.jumlah} item
💰 *Harga Satuan:* ${formatrupiah(resolvedBayar.harga_satuan)}
${discountAmount > 0 ? `🎟️ *Voucher:* ${Data.voucher}\n💸 *Potongan:* ${formatrupiah(discountAmount)}` : ''}
💵 *Fee Admin:* ${formatrupiah(pay.fee || 0)}
━━━━━━━━━━━━━━━━━━━━
💎 *TOTAL BAYAR:* ${formatrupiah(totalHarga)}
━━━━━━━━━━━━━━━━━━━━
${showPreview ? `\n${txxx}\n\n━━━━━━━━━━━━━━━━━━━━\n` : ''}💡 *TIPS:* File produk sudah dikirim sebagai dokumen di atas!
━━━━━━━━━━━━━━━━━━━━
Terima kasih telah berbelanja di *${NamaBot}*! 🙏`
      
      // Batasi panjang caption maksimal 1024 karakter (batas Telegram)
      const MAX_CAPTION_LENGTH = 1024
      if (completionMessage.length > MAX_CAPTION_LENGTH) {
        // Jika masih terlalu panjang, buat versi super singkat
        completionMessage = `🎉 *PESANAN BERHASIL!*
━━━━━━━━━━━━━━━━━━━━
✅ *Status:* Selesai & Terkirim
📋 *Trx ID:* \`${Data.trxid}\`
🕒 *Waktu:* ${formatWIB(tggl)}

━━━━━━━━━━━━━━━━━━━━
🛍️ *Produk:* ${item.nama}
📊 *Jumlah:* ${Data.jumlah} item
💎 *Total:* ${formatrupiah(totalHarga)}
━━━━━━━━━━━━━━━━━━━━
💡 File produk sudah dikirim sebagai dokumen!
Terima kasih! 🙏`
      }

      // Quick action keyboard
      const completionKeyboard = {
        inline_keyboard: [
          [
            { text: "📋 Detail Pesanan", callback_data: `detail_trx_${Data.trxid}` },
            { text: "📥 Unduh Ulang", callback_data: `redownload_${Data.trxid}` }
          ],
          [
            { text: "📋 Salin Data", callback_data: `copy_data_${Data.trxid}` },
            { text: "🔄 Pesan Lagi", callback_data: `order_again_${item.kode}` }
          ],
          [
            { text: "⭐ Beri Rating", callback_data: `rate_${Data.trxid}` },
            { text: "💬 Hubungi CS", url: channelContact.cs }
          ],
          [
            { text: "📊 Lihat Riwayat", callback_data: "riwayattransaksi" },
            { text: "🛍️ Belanja Lagi", callback_data: "daftarproduk" }
          ]
        ]
      }
      
            try {
              await bot.sendDocument(query.from.id, pathtxt, {
                filename: `${query.from.id}-${item.kode}-${Data.jumlah}.txt`,
                contentType: 'text/plain',
                parse_mode: "Markdown",
                caption: completionMessage,
                reply_markup: completionKeyboard
              })
            } catch (sendError) {
              console.error('Error mengirim produk:', sendError)
              
              // Jika error karena caption terlalu panjang, coba dengan caption lebih pendek
              if (sendError.message && (sendError.message.includes('caption is too long') || sendError.message.includes('Bad Request'))) {
                try {
                  const shortCaption = `🎉 *PESANAN BERHASIL!*
━━━━━━━━━━━━━━━━━━━━
✅ *Status:* Selesai & Terkirim
📋 *Trx ID:* \`${Data.trxid}\`
📊 *Jumlah:* ${Data.jumlah} item
💎 *Total:* ${formatrupiah(totalHarga)}
━━━━━━━━━━━━━━━━━━━━
💡 File produk sudah dikirim sebagai dokumen di atas!
Terima kasih telah berbelanja di *${NamaBot}*! 🙏`
                  
                  await bot.sendDocument(query.from.id, pathtxt, {
                    filename: `${query.from.id}-${item.kode}-${Data.jumlah}.txt`,
                    contentType: 'text/plain',
                    parse_mode: "Markdown",
                    caption: shortCaption,
                    reply_markup: completionKeyboard
                  })
                } catch (retryError) {
                  console.error('Error retry mengirim produk:', retryError)
                  // Jika masih gagal, kirim tanpa caption
                  try {
                    await bot.sendDocument(query.from.id, pathtxt, {
                      filename: `${query.from.id}-${item.kode}-${Data.jumlah}.txt`,
                      contentType: 'text/plain'
                    })
                    // Kirim pesan terpisah
                    await sendMessage(query.from.id, `🎉 *PESANAN BERHASIL!*
━━━━━━━━━━━━━━━━━━━━
✅ *Status:* Selesai & Terkirim
📋 *Trx ID:* \`${Data.trxid}\`
🛍️ *Produk:* ${item.nama}
📊 *Jumlah:* ${Data.jumlah} item
💎 *Total:* ${formatrupiah(totalHarga)}
━━━━━━━━━━━━━━━━━━━━
💡 File produk sudah dikirim sebagai dokumen di atas!`, {
                      reply_markup: completionKeyboard
                    })
                  } catch (finalError) {
                    console.error('Error final mengirim produk:', finalError)
                    await sendMessage(query.from.id, `⚠️ *PESANAN BERHASIL TAPI GAGAL KIRIM*
=======================
Pembayaran Anda berhasil, tapi terjadi error saat mengirim produk.

*Trx ID:* \`${Data.trxid}\`

Silakan hubungi CS untuk mendapatkan produk Anda.`)
                  }
                }
              } else {
                // Error lainnya, tetap simpan transaksi dan kirim notifikasi
                await sendMessage(query.from.id, `⚠️ *PESANAN BERHASIL TAPI GAGAL KIRIM*
=======================
Pembayaran Anda berhasil, tapi terjadi error saat mengirim produk.

*Trx ID:* \`${Data.trxid}\`

Silakan hubungi CS untuk mendapatkan produk Anda.`)
              }
            }
            
            // Store product data temporarily for redownload/copy
            const tempDataPath = `./Database/Trx/temp_${Data.trxid}.json`
            try {
              fs.writeFileSync(tempDataPath, JSON.stringify({
                trxid: Data.trxid,
                userId: query.from.id,
                produkData: DataProduk,
                produkInfo: {
                  nama: item.nama,
                  kode: item.kode,
                  snk: item.snk
                },
                jumlah: Data.jumlah,
                harga: harga,
                fee: pay.fee || 0,
                total: totalHarga,
                tanggal: tggl,
                voucher: Data.voucher || null
              }, null, 2))
            } catch (fileError) {
              console.error('Error menyimpan temp file:', fileError)
            }
            
            // Kirim notifikasi pembelian ke feed channel
            await sendFeedMessage(
              `🛍️ *Someone just bought ${Data.jumlah}x ${item.nama}!*`,
              'purchase'
            ).catch(err => console.error('Error sending purchase feed message:', err))

            try {
              await bot.sendMessage(channelContact.channelLog, `✅ *PESANAN SELESAI*
=======================
User: @${query.from.username || query.from.first_name}
Trx ID: *${Data.trxid}*
Produk: *${item.nama}*
Harga: *${formatrupiah(resolvedSaldo.harga_satuan)}*
Jumlah Beli: *${Data.jumlah}*
Fee: *${formatrupiah(pay.fee || 0)}*
Total Harga: *${formatrupiah(totalHarga)}*
${discountAmount > 0 ? `Voucher: ${Data.voucher} (Potongan: ${formatrupiah(discountAmount)})` : ''}
Tanggal: *${formatWIB(tggl)}*
=======================`, {
                parse_mode: "Markdown"
              })
            } catch (logError) {
              console.error('Error mengirim log:', logError)
            }
            
            // Simpan transaksi ke database - PENTING: harus setelah produk berhasil diambil
            try {
              const { error: trxError } = await supabase
                .from("Trx")
                .insert([
                  {
                    id: query.from.id,
                    varian_id: item.id,
                    produk_id: item.produk_id,
                    nama: item.nama,
                    kode: item.kode,
                    jumlah: Data.jumlah,
                    harga: harga,
                    harga_satuan: resolvedBayar.harga_satuan,
                    tanggal: tggl,
                    trxid: Data.trxid
                  }
                ])
              
              if (trxError) {
                console.error('Error insert transaksi:', trxError)
                // Log error tapi jangan block proses karena produk sudah dikirim
                await bot.sendMessage(channelContact.channelLog, `⚠️ *ERROR INSERT TRANSAKSI*
=======================
Trx ID: *${Data.trxid}*
User: @${query.from.username || query.from.first_name}
Error: ${trxError.message}
=======================`, {
                  parse_mode: "Markdown"
                })
              }
            } catch (trxInsertError) {
              console.error('Error insert transaksi (catch):', trxInsertError)
            }
            
            // Hapus file temp setelah semua berhasil
            try {
              if (fs.existsSync(pathtxt)) {
                fs.unlinkSync(pathtxt)
              }
            } catch (unlinkError) {
              console.error('Error hapus file temp:', unlinkError)
            }
      
            // Update user stats
            try {
              const { data: userData } = await supabase
                .from('User')
                .select('jumlahtransaksi, pengeluaran')
                .eq('id', query.from.id)
                .single()
              
              if (userData) {
                const newJumlahtransaksi = userData.jumlahtransaksi + 1
                await supabase
                  .from('User')
                  .update({
                    jumlahtransaksi: newJumlahtransaksi,
                    pengeluaran: userData.pengeluaran + harga
                  })
                  .eq('id', query.from.id)
                
                // Achievement messages
                if (newJumlahtransaksi === 1) {
                  await bot.sendMessage(query.from.id, `🎊 *SELAMAT!*
━━━━━━━━━━━━━━━━━━━━
🏆 *Pencapaian Baru*
━━━━━━━━━━━━━━━━━━━━
🎯 Ini adalah transaksi pertama Anda!
Terima kasih sudah mempercayai *${NamaBot}*

🎁 *Bonus:* Salin data produk lebih mudah
dengan tombol "📋 Salin Data" di atas!`, {
                    parse_mode: "Markdown"
                  })
                } else if (newJumlahtransaksi % 5 === 0) {
                  await bot.sendMessage(query.from.id, `🎉 *MILESTONE!*
━━━━━━━━━━━━━━━━━━━━
🏆 Ini adalah transaksi ke-${newJumlahtransaksi} Anda!
━━━━━━━━━━━━━━━━━━━━
Terima kasih sudah setia berbelanja
di *${NamaBot}*! 🙏`, {
                    parse_mode: "Markdown"
                  })
                }
              }
            } catch (userUpdateError) {
              console.error('Error update user stats:', userUpdateError)
            }
            
            // Update voucher jika digunakan
            try {
              let ds = null
              Object.keys(Voucher).forEach((fd) => {
                if (Voucher[fd].kode === Data.voucher) ds = fd
              })
              if (ds !== null) {
                const { data: dtss } = await supabase
                  .from('Voucher')
                  .select('*')
                  .eq('kode', Data.voucher)
                  .single()
                if (dtss) {
                  dtss.user.push(query.from.id)
                  await supabase
                    .from("Voucher")
                    .update({ limit: dtss.limit-1, user: dtss.user })
                    .eq('kode', Data.voucher)
                }
              }
            } catch (voucherError) {
              console.error('Error update voucher:', voucherError)
            }
            // Refresh data untuk menu utama
            try {
              let { data: Trx2 } = await supabase
                .from("Trx")
                .select("*")
              let { data: Produk2 } = await supabase
                .from("Produk")
                .select("*")
              let { data: User } = await supabase
                .from("User")
                .select("*")
              let stokterjual = 0
              let stoktersedia = 0
              if (Trx2 && Trx2.length !== 0) {
                Object.keys(Trx2).forEach((g) => {
                  stokterjual += Trx2[g].jumlah
                })
              }
              if (Produk2 && Produk2.length !== 0) {
                for (let g = 0; g < Produk2.length; g++) {
                  const stokCount = await getStokCount(Produk2[g].kode)
                  stoktersedia += stokCount
                }
              }
              const userSaldo2 = await cekSaldo(query.from.id)
              await sendBannerMessage(query.from.id, welcomeCaption({
                first_name: query.from.first_name,
                user_count: User ? User.length : 0,
                stok_terjual: stokterjual,
                stok_tersedia: stoktersedia,
                saldo: userSaldo2,
              }), {
                reply_markup: welcomeInlineKeyboard()
              })
            } catch (menuError) {
              console.error('Error refresh menu:', menuError)
            }
            
            // Kosongkan keranjang
            try {
              if (await cart.exists(query.from.id)) {
                let DataCleanup = await cart.get(query.from.id)
                // Release reservations jika ada
                if (DataCleanup.selectedStokIds && DataCleanup.selectedStokIds.length > 0) {
                  releaseReservation(DataCleanup.selectedStokIds)
                  console.log(`🔓 Release ${DataCleanup.selectedStokIds.length} reserved stocks (cleanup)`)
                }
                await cart.clear(query.from.id)
              }
            } catch (cleanupError) {
              console.error('Error cleanup:', cleanupError)
            }
          }
        } catch (err) {
          if (err.response) {
            console.error(`[Checkout Polling] Error API Pakasir (HTTP ${err.response.status}):`, JSON.stringify(err.response.data));
          } else if (err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET') {
            console.log(`[Checkout Polling] Connection timeout/reset: ${err.message}. Continue polling...`);
          } else {
            console.error(`[Checkout Polling] Gagal menghubungi API Pakasir:`, err.message);
          }
        }
      }
    } catch (err) {
      console.error('Error creating QRIS payment:', err)
      await sendMessage(query.from.id, `❌ *ERROR*\n=======================\nTerjadi kesalahan saat membuat QRIS pembayaran.\n\nError: \`${err.message}\`\n\nSilakan coba lagi atau hubungi admin.`)
    }
  } else {
    await sendMessage(query.from.id, `⚠️ Harap ulangi pilih produk!`)
  }
}

  
// Handler untuk quick actions setelah pesanan selesai
if (cmd.startsWith("detail_trx_")) {
  const trxId = cmd.replace("detail_trx_", "")
  
  // Ambil detail transaksi dari database
  const { data: trxDetail } = await supabase
    .from("Trx")
    .select("*")
    .eq("trxid", trxId)
    .eq("id", query.from.id)
    .single()
  
  if (trxDetail) {
    await bot.answerCallbackQuery(query.id)
    await bot.sendMessage(query.from.id, `📋 *DETAIL TRANSAKSI*
━━━━━━━━━━━━━━━━━━━━
🆔 *Trx ID:* \`${trxDetail.trxid}\`
📦 *Produk:* ${trxDetail.nama}
🔖 *Kode Produk:* ${trxDetail.kode}
📊 *Jumlah:* ${trxDetail.jumlah}
💰 *Total:* ${formatrupiah(trxDetail.harga)}
🕒 *Tanggal:* ${formatWIB(trxDetail.tanggal)}
━━━━━━━━━━━━━━━━━━━━`, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "🔄 Beli Lagi", callback_data: `order_again_${trxDetail.kode}` },
            { text: "📥 Unduh Ulang", callback_data: `redownload_${trxId}` }
          ],
          [
            { text: "🔙 Kembali", callback_data: "riwayattransaksi" }
          ]
        ]
      }
    })
  } else {
    await bot.answerCallbackQuery(query.id, { text: "❌ Transaksi tidak ditemukan!", show_alert: true })
  }
}

if (cmd.startsWith("redownload_")) {
  const trxId = cmd.replace("redownload_", "")
  const tempDataPath = `./Database/Trx/temp_${trxId}.json`
  
  if (fs.existsSync(tempDataPath)) {
    const tempData = JSON.parse(fs.readFileSync(tempDataPath, 'utf8'))
    
    // Verify ownership
    if (tempData.userId !== query.from.id) {
      await bot.answerCallbackQuery(query.id, { text: "❌ Anda tidak memiliki akses!", show_alert: true })
      return
    }
    
    // Ambil format dari varian (perlu query dari database)
    const { data: varianInfo } = await supabase
      .from('Varian')
      .select('format')
      .eq('kode', tempData.produkInfo.kode)
      .maybeSingle()
    
    // Format data produk sesuai format
    const productFormat = varianInfo?.format || null
    const DataProduk = formatProductDataForFile(tempData.produkData, productFormat)
    
    // Generate file again
    const txfile = `<|==== SYARAT DAN KETENTUAN ====|>
${tempData.produkInfo.snk}

<|==== PRODUK ====|>
${DataProduk}

//Terimakasih telah percaya kepada ${NamaBot}. Kami harap layanan kami dapat membuat anda puas`
    
    const pathtxt = `./${query.from.id}-${tempData.produkInfo.kode}-${tempData.jumlah}.txt`
    fs.writeFileSync(pathtxt, txfile)
    
    await bot.answerCallbackQuery(query.id)
    await bot.sendDocument(query.from.id, pathtxt, {
      filename: `${query.from.id}-${tempData.produkInfo.kode}-${tempData.jumlah}.txt`,
      contentType: 'text/plain',
      parse_mode: "Markdown",
      caption: `📥 *UNDUH ULANG PRODUK*
━━━━━━━━━━━━━━━━━━━━
📋 *Trx ID:* \`${trxId}\`
📦 *Produk:* ${tempData.produkInfo.nama}
━━━━━━━━━━━━━━━━━━━━
File produk berhasil diunduh ulang!`
    })
    
    fs.unlinkSync(pathtxt)
  } else {
    await bot.answerCallbackQuery(query.id, { text: "❌ File tidak tersedia lagi!", show_alert: true })
  }
}

if (cmd.startsWith("copy_data_")) {
  const trxId = cmd.replace("copy_data_", "")
  const tempDataPath = `./Database/Trx/temp_${trxId}.json`
  
  if (fs.existsSync(tempDataPath)) {
    const tempData = JSON.parse(fs.readFileSync(tempDataPath, 'utf8'))
    
    // Verify ownership
    if (tempData.userId !== query.from.id) {
      await bot.answerCallbackQuery(query.id, { text: "❌ Anda tidak memiliki akses!", show_alert: true })
      return
    }
    
    // Send data as code block for easy copying
    await bot.answerCallbackQuery(query.id, { text: "Data berhasil dikirim!", show_alert: false })
    await bot.sendMessage(query.from.id, `📋 *SALIN DATA PRODUK*
━━━━━━━━━━━━━━━━━━━━
📋 *Trx ID:* \`${trxId}\`
📦 *Produk:* ${tempData.produkInfo.nama}

*Data Produk:*
\`\`\`
${tempData.produkData.trim()}
\`\`\`

━━━━━━━━━━━━━━━━━━━━
💡 *TIPS:* Tap dan tahan pada data di atas untuk memilih semua, lalu salin!`, {
      parse_mode: "Markdown"
    })
  } else {
    await bot.answerCallbackQuery(query.id, { text: "❌ Data tidak tersedia lagi!", show_alert: true })
  }
}

if (cmd.startsWith("order_again_")) {
  const kodeProduk = cmd.replace("order_again_", "")
  
  // Redirect ke daftar produk dan filter ke produk tersebut
  await bot.answerCallbackQuery(query.id)
  
  let { data: Produk } = await supabase
    .from("Produk")
    .select("*")
    .eq("kode", kodeProduk.toLowerCase())
    .single()
  
  if (Produk) {
    // Trigger callback untuk memilih produk
    // Simulasi klik produk dengan callback daftarproduk_select
    await bot.sendMessage(query.from.id, `🔄 *PESAN LAGI*
━━━━━━━━━━━━━━━━━━━━
📦 *Produk:* ${Produk.nama}
🔖 *Kode:* \`${Produk.kode}\`
💰 *Harga:* ${formatrupiah(Produk.harga)}

Silakan pilih jumlah pembelian:`, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "1", callback_data: `min:1_${Produk.kode}` },
            { text: "2", callback_data: `min:2_${Produk.kode}` },
            { text: "3", callback_data: `min:3_${Produk.kode}` },
            { text: "4", callback_data: `min:4_${Produk.kode}` },
            { text: "5", callback_data: `min:5_${Produk.kode}` }
          ],
          [
            { text: "🔙 Kembali", callback_data: "daftarproduk" }
          ]
        ]
      }
    })
  } else {
    await bot.sendMessage(query.from.id, `❌ *Produk Tidak Ditemukan*
━━━━━━━━━━━━━━━━━━━━
Produk dengan kode \`${kodeProduk}\` tidak ditemukan.

Silakan coba lagi atau pilih produk lain.`, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [[
          { text: "📦 Lihat Produk", callback_data: "daftarproduk" }
        ]]
      }
    })
  }
}

if (cmd.startsWith("rate_")) {
  const trxId = cmd.replace("rate_", "")
  
  // Cek apakah sudah rating sebelumnya (optional, bisa ditambahkan database untuk rating)
  await bot.answerCallbackQuery(query.id)
  await bot.sendMessage(query.from.id, `⭐ *BERI RATING*
━━━━━━━━━━━━━━━━━━━━
Bagaimana pengalaman Anda berbelanja
di *${NamaBot}*?

Silakan pilih rating:`, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "⭐ 1", callback_data: `rate_submit_1_${trxId}` },
          { text: "⭐ 2", callback_data: `rate_submit_2_${trxId}` },
          { text: "⭐ 3", callback_data: `rate_submit_3_${trxId}` },
          { text: "⭐ 4", callback_data: `rate_submit_4_${trxId}` },
          { text: "⭐ 5", callback_data: `rate_submit_5_${trxId}` }
        ],
        [
          { text: "❌ Batal", callback_data: "rate_cancel" }
        ]
      ]
    }
  })
}

if (cmd.startsWith("rate_submit_")) {
  const parts = cmd.replace("rate_submit_", "").split("_")
  const rating = parts[0]
  const trxId = parts.slice(1).join("_")
  
  await bot.answerCallbackQuery(query.id, { text: `Terima kasih! Rating ${rating} bintang Anda telah direkam.`, show_alert: true })
  
  // Hapus pesan rating
  try {
    await bot.deleteMessage(query.message.chat.id, query.message.message_id)
  } catch (err) {
    // Ignore if message already deleted
  }
  
  // Send thank you message
  await bot.sendMessage(query.from.id, `🙏 *TERIMA KASIH!*
━━━━━━━━━━━━━━━━━━━━
Rating ${rating} ⭐ Anda sangat berarti bagi kami!

Terima kasih atas feedback Anda. Kami akan terus
berusaha memberikan pelayanan terbaik.`, {
    parse_mode: "Markdown"
  })
  
  // Optional: Log rating to admin channel
  await bot.sendMessage(channelContact.channelLog, `⭐ *RATING BARU*
━━━━━━━━━━━━━━━━━━━━
User: @${query.from.username || query.from.first_name}
Trx ID: \`${trxId}\`
Rating: ${rating} ⭐
━━━━━━━━━━━━━━━━━━━━`, {
    parse_mode: "Markdown"
  })
}

if (cmd === "rate_cancel") {
  await bot.answerCallbackQuery(query.id)
  try {
    await bot.deleteMessage(query.message.chat.id, query.message.message_id)
  } catch (err) {
    // Ignore if message already deleted
  }
}

// Handler callback untuk delproduk_select_
// Handler konfirmasi hapus produk
// Handler cancel delproduk
// ========== HANDLER CALLBACK EDIT COMMANDS ==========

// Handler editnama_select_
// Handler editkode_select_
// Handler editharga_select_
// Handler editdeskripsi_select_
// Handler editsnk_select_
// Handler untuk select produk di editformat
// Handler cancel editformat
// Handler editkategori_select_
// ========== HANDLER CALLBACK LIST USER ==========

// Handler untuk detail user
if (cmd.startsWith("user_detail_")) {
  const userId = Number(cmd.replace("user_detail_", ""))
  
  const { data: User } = await supabase
    .from("User")
    .select("*")
    .eq("id", userId)
    .single()
  
  if (!User) {
    await bot.answerCallbackQuery(query.id, { text: "❌ User tidak ditemukan!", show_alert: true })
    return
  }
  
  // Get user info from Telegram
  let usn = "Anonim"
  let fullName = "Tidak Diketahui"
  try {
    const chat = await bot.getChat(userId)
    usn = chat.username ? `@${chat.username}` : `${chat.first_name || "Anonim"}`
    fullName = chat.first_name || "Tidak Diketahui"
  } catch (err) {
    usn = "❌ Tidak Dikenal"
  }
  
  // Get recent transactions
  const { data: Trx } = await supabase
    .from("Trx")
    .select("*")
    .eq("id", userId)
    .order("tanggal", { ascending: false })
    .limit(5)
  
  const avgPerTrx = User.jumlahtransaksi > 0 
    ? Math.round(User.pengeluaran / User.jumlahtransaksi) 
    : 0
  
  const badge = User.jumlahtransaksi === 0 ? "❌ Tidak Aktif" 
    : User.pengeluaran > 100000 ? "🌟 VIP" 
    : User.jumlahtransaksi >= 5 ? "⭐ Loyal" 
    : "✅ Aktif"
  
  let text = `👤 *DETAIL USER*
━━━━━━━━━━━━━━━━━━━━
${badge}
━━━━━━━━━━━━━━━━━━━━
👤 *Nama:* ${fullName}
🔗 *Username:* ${usn}
🆔 *User ID:* \`${userId}\`

━━━━━━━━━━━━━━━━━━━━
📊 *STATISTIK*
━━━━━━━━━━━━━━━━━━━━
📦 Total Transaksi: *${User.jumlahtransaksi || 0}*
💰 Total Pengeluaran: *${formatrupiah(User.pengeluaran || 0)}*
💵 Saldo: *${formatrupiah(User.saldo || 0)}*
📊 Rata-rata/Transaksi: *${formatrupiah(avgPerTrx)}*
${User.created_at ? `📅 Bergabung: ${formatWIB(User.created_at)}` : ''}

━━━━━━━━━━━━━━━━━━━━
📊 *Transaksi Terakhir:* ${Trx ? Trx.length : 0}/5
━━━━━━━━━━━━━━━━━━━━`
  
  const buttons = []
  
  buttons.push([
    { text: "📋 Riwayat Transaksi", callback_data: `user_trx_${userId}` },
    { text: "🗑️ Hapus User", callback_data: `user_delete_${userId}` }
  ])
  
  buttons.push([{ text: "🔙 Kembali ke List", callback_data: "listuser" }])
  
  await bot.answerCallbackQuery(query.id)
  await bot.sendMessage(query.from.id, text, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: buttons
    }
  })
}

// Handler untuk riwayat transaksi user
if (cmd.startsWith("user_trx_")) {
  const userId = Number(cmd.replace("user_trx_", ""))
  
  const { data: Trx } = await supabase
    .from("Trx")
    .select("*")
    .eq("id", userId)
    .order("tanggal", { ascending: false })
    .limit(10)
  
  const { data: User } = await supabase
    .from("User")
    .select("*")
    .eq("id", userId)
    .single()
  
  if (!Trx || Trx.length === 0) {
    await bot.answerCallbackQuery(query.id)
    await bot.sendMessage(query.from.id, `📋 *RIWAYAT TRANSAKSI USER*
━━━━━━━━━━━━━━━━━━━━
🆔 User ID: \`${userId}\`

Belum ada transaksi.

━━━━━━━━━━━━━━━━━━━━`, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔙 Kembali", callback_data: `user_detail_${userId}` }]
        ]
      }
    })
    return
  }
  
  let text = `📋 *RIWAYAT TRANSAKSI USER*
━━━━━━━━━━━━━━━━━━━━
🆔 User ID: \`${userId}\`
📊 Total Transaksi: ${User.jumlahtransaksi || 0}
💰 Total Pengeluaran: ${formatrupiah(User.pengeluaran || 0)}
━━━━━━━━━━━━━━━━━━━━

*10 Transaksi Terakhir:*
`
  
  Trx.forEach((t, idx) => {
    text += `${idx + 1}. *${t.nama}*
   💰 ${formatrupiah(t.harga)} (${t.jumlah}x)
   🕒 ${formatWIB(t.tanggal)}
   🆔 \`${t.trxid || 'N/A'}\`
━━━━━━━━━━━━━━━━━━━━\n`
  })
  
  await bot.answerCallbackQuery(query.id)
  await bot.sendMessage(query.from.id, text, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🔙 Kembali", callback_data: `user_detail_${userId}` }]
      ]
    }
  })
}

// Handler untuk hapus user dengan konfirmasi
if (cmd.startsWith("user_delete_")) {
  const userId = Number(cmd.replace("user_delete_", ""))
  
  const { data: User } = await supabase
    .from("User")
    .select("*")
    .eq("id", userId)
    .single()
  
  if (!User) {
    await bot.answerCallbackQuery(query.id, { text: "❌ User tidak ditemukan!", show_alert: true })
    return
  }
  
  let usn = "Anonim"
  try {
    const chat = await bot.getChat(userId)
    usn = chat.username ? `@${chat.username}` : `${chat.first_name || "Anonim"}`
  } catch (err) {
    usn = "❌ Tidak Dikenal"
  }
  
  await bot.answerCallbackQuery(query.id)
  await bot.sendMessage(query.from.id, `⚠️ *KONFIRMASI HAPUS USER*
━━━━━━━━━━━━━━━━━━━━
👤 *User:* ${usn}
🆔 *ID:* \`${userId}\`
📊 *Transaksi:* ${User.jumlahtransaksi || 0}
💰 *Pengeluaran:* ${formatrupiah(User.pengeluaran || 0)}

━━━━━━━━━━━━━━━━━━━━
⚠️ *PERINGATAN:*
Tindakan ini tidak dapat dibatalkan!
Semua data user akan terhapus permanen.

━━━━━━━━━━━━━━━━━━━━
Apakah Anda yakin ingin menghapus user ini?`, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Ya, Hapus", callback_data: `user_delete_confirm_${userId}` },
          { text: "❌ Batal", callback_data: `user_detail_${userId}` }
        ]
      ]
    }
  })
}

// Handler konfirmasi hapus user
if (cmd.startsWith("user_delete_confirm_")) {
  const userId = Number(cmd.replace("user_delete_confirm_", ""))
  
  const { data: User } = await supabase
    .from("User")
    .select("*")
    .eq("id", userId)
    .single()
  
  if (!User) {
    await bot.answerCallbackQuery(query.id, { text: "❌ User tidak ditemukan!", show_alert: true })
    return
  }
  
  let usn = "Anonim"
  try {
    const chat = await bot.getChat(userId)
    usn = chat.username ? `@${chat.username}` : `${chat.first_name || "Anonim"}`
  } catch (err) {
    usn = "❌ Tidak Dikenal"
  }
  
  await supabase
    .from("User")
    .delete()
    .eq('id', userId.toString())
  
  await bot.answerCallbackQuery(query.id)
  await bot.sendMessage(query.from.id, `✅ *USER BERHASIL DIHAPUS*
━━━━━━━━━━━━━━━━━━━━
👤 *User:* ${usn}
🆔 *ID:* \`${userId}\`
📊 *Transaksi:* ${User.jumlahtransaksi || 0}
💰 *Pengeluaran:* ${formatrupiah(User.pengeluaran || 0)}
━━━━━━━━━━━━━━━━━━━━
⚠️ User telah dihapus dari database.`, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🔙 Kembali ke List", callback_data: "listuser" }]
      ]
    }
  })
}

// Handler untuk filter user
if (cmd === "user_filter") {
  await bot.answerCallbackQuery(query.id)
  await bot.sendMessage(query.from.id, `🔍 *FILTER USER*
━━━━━━━━━━━━━━━━━━━━
Pilih filter yang ingin diterapkan:

━━━━━━━━━━━━━━━━━━━━`, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ User Aktif", callback_data: "user_filter_active" },
          { text: "❌ User Tidak Aktif", callback_data: "user_filter_inactive" }
        ],
        [
          { text: "🌟 Top Spenders", callback_data: "user_filter_vip" },
          { text: "📊 Semua", callback_data: "listuser" }
        ],
        [
          { text: "🔙 Kembali", callback_data: "listuser" }
        ]
      ]
    }
  })
}

// Handler untuk filter active
if (cmd === "user_filter_active") {
  let { data: User } = await supabase
    .from("User")
    .select("*")
  
  if (!User || User.length === 0) {
    await bot.answerCallbackQuery(query.id, { text: "⚠️ Tidak ada user!", show_alert: true })
    return
  }
  
  await sendUserPage(User, query.from.id, 0, query.message.message_id, query.id, {
    status: 'active',
    statusLabel: 'User Aktif',
    filterKey: 'active'
  })
}

// Handler untuk filter inactive
if (cmd === "user_filter_inactive") {
  let { data: User } = await supabase
    .from("User")
    .select("*")
  
  if (!User || User.length === 0) {
    await bot.answerCallbackQuery(query.id, { text: "⚠️ Tidak ada user!", show_alert: true })
    return
  }
  
  await sendUserPage(User, query.from.id, 0, query.message.message_id, query.id, {
    status: 'inactive',
    statusLabel: 'User Tidak Aktif',
    filterKey: 'inactive'
  })
}

// Handler untuk filter VIP
if (cmd === "user_filter_vip") {
  let { data: User } = await supabase
    .from("User")
    .select("*")
  
  if (!User || User.length === 0) {
    await bot.answerCallbackQuery(query.id, { text: "⚠️ Tidak ada user!", show_alert: true })
    return
  }
  
  await sendUserPage(User, query.from.id, 0, query.message.message_id, query.id, {
    sortBy: 'spending',
    statusLabel: 'Top Spenders',
    filterKey: 'vip'
  })
}

// Handler untuk pagination user
if (cmd.startsWith("user_prev:") || cmd.startsWith("user_next:")) {
  const isNext = cmd.startsWith("user_next:")
  const parts = cmd.replace("user_prev:", "").replace("user_next:", "").split("_")
  const page = parseInt(parts[0])
  const filterKey = parts[1] || 'all'
  
  let { data: User } = await supabase
    .from("User")
    .select("*")
  
  if (!User || User.length === 0) {
    await bot.answerCallbackQuery(query.id, { text: "⚠️ Tidak ada user!", show_alert: true })
    return
  }
  
  const newPage = isNext ? page + 1 : page - 1
  const filterOptions = {
    filterKey: filterKey
  }
  
  if (filterKey === 'active') {
    filterOptions.status = 'active'
    filterOptions.statusLabel = 'User Aktif'
  } else if (filterKey === 'inactive') {
    filterOptions.status = 'inactive'
    filterOptions.statusLabel = 'User Tidak Aktif'
  } else if (filterKey === 'vip') {
    filterOptions.sortBy = 'spending'
    filterOptions.statusLabel = 'Top Spenders'
  }
  
  await sendUserPage(User, query.from.id, newPage, query.message.message_id, query.id, filterOptions)
}

// Handler untuk statistik user
if (cmd === "user_statistik") {
  let { data: User } = await supabase
    .from("User")
    .select("*")
  
  if (!User || User.length === 0) {
    await bot.answerCallbackQuery(query.id, { text: "⚠️ Tidak ada user!", show_alert: true })
    return
  }
  
  // Calculate statistics
  const totalUsers = User.length
  const activeUsers = User.filter(u => (u.jumlahtransaksi || 0) > 0).length
  const inactiveUsers = totalUsers - activeUsers
  const totalPengeluaran = User.reduce((sum, u) => sum + (u.pengeluaran || 0), 0)
  const totalSaldo = User.reduce((sum, u) => sum + (u.saldo || 0), 0)
  const totalTransaksi = User.reduce((sum, u) => sum + (u.jumlahtransaksi || 0), 0)
  
  // Top spenders
  const topSpenders = [...User]
    .sort((a, b) => (b.pengeluaran || 0) - (a.pengeluaran || 0))
    .slice(0, 5)
  
  const topSpendersText = await Promise.all(topSpenders.map(async (u, idx) => {
    let usn = "Anonim"
    try {
      const chat = await bot.getChat(u.id)
      usn = chat.username ? `@${chat.username}` : `${chat.first_name || "Anonim"}`
    } catch (err) {
      usn = "❌ Tidak Dikenal"
    }
    return `${idx + 1}. ${usn} - ${formatrupiah(u.pengeluaran || 0)}`
  }))
  
  // User baru (7 hari terakhir)
  const weekAgo = new Date()
  weekAgo.setDate(weekAgo.getDate() - 7)
  const newUsers = User.filter(u => {
    if (!u.created_at) return false
    return new Date(u.created_at) >= weekAgo
  }).length
  
  const statText = `📊 *STATISTIK USER*
━━━━━━━━━━━━━━━━━━━━
📈 *Ringkasan Umum*
━━━━━━━━━━━━━━━━━━━━
👥 Total User: *${totalUsers}*
✅ User Aktif: *${activeUsers}*
❌ User Tidak Aktif: *${inactiveUsers}*
👶 User Baru (7 hari): *${newUsers}*

━━━━━━━━━━━━━━━━━━━━
💰 *Keuangan*
━━━━━━━━━━━━━━━━━━━━
💰 Total Pengeluaran: *${formatrupiah(totalPengeluaran)}*
💵 Total Saldo: *${formatrupiah(totalSaldo)}*
📊 Rata-rata Pengeluaran: *${formatrupiah(Math.round(totalPengeluaran / (activeUsers || 1)))}*

━━━━━━━━━━━━━━━━━━━━
📦 *Transaksi*
━━━━━━━━━━━━━━━━━━━━
📊 Total Transaksi: *${totalTransaksi}*
📈 Rata-rata/User: *${Math.round(totalTransaksi / (activeUsers || 1))}*

━━━━━━━━━━━━━━━━━━━━
🏆 *Top 5 Spenders*
━━━━━━━━━━━━━━━━━━━━
${topSpendersText.join('\n')}

━━━━━━━━━━━━━━━━━━━━`
  
  await bot.answerCallbackQuery(query.id)
  await bot.sendMessage(query.from.id, statText, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🔙 Kembali ke List", callback_data: "listuser" }]
      ]
    }
  })
}

// Handler untuk export user
if (cmd === "user_export") {
  let { data: User } = await supabase
    .from("User")
    .select("*")
  
  if (!User || User.length === 0) {
    await bot.answerCallbackQuery(query.id, { text: "⚠️ Tidak ada user!", show_alert: true })
    return
  }
  
  // Create CSV content
  let csvContent = "No,User ID,Username,Nama,Jumlah Transaksi,Pengeluaran,Saldo,Tanggal Bergabung\n"
  
  const userDetails = await Promise.all(User.map(async (u, idx) => {
    let username = "Anonim"
    let firstName = "Tidak Diketahui"
    try {
      const chat = await bot.getChat(u.id)
      username = chat.username || "Tidak Ada"
      firstName = chat.first_name || "Tidak Diketahui"
    } catch (err) {
      username = "Error"
      firstName = "Error"
    }
    const joinDate = u.created_at ? formatWIB(u.created_at) : "Tidak Diketahui"
    return `${idx + 1},${u.id},${username},${firstName},${u.jumlahtransaksi || 0},${u.pengeluaran || 0},${u.saldo || 0},"${joinDate}"`
  }))
  
  csvContent += userDetails.join('\n')
  
  const filename = `users_export_${Date.now()}.csv`
  const filepath = `./${filename}`
  fs.writeFileSync(filepath, csvContent)
  
  await bot.answerCallbackQuery(query.id)
  await bot.sendDocument(query.from.id, filepath, {
    filename: filename,
    contentType: 'text/csv',
    caption: `📥 *EXPORT DATA USER*
━━━━━━━━━━━━━━━━━━━━
📊 Total User: ${User.length}
📅 Tanggal Export: ${formatWIB(new Date().toISOString())}
━━━━━━━━━━━━━━━━━━━━
File berisi semua data user dalam format CSV.`,
    parse_mode: "Markdown"
  })
  
  fs.unlinkSync(filepath)
}

// Handler untuk kembali ke list user
if (cmd === "listuser") {
  let { data: User } = await supabase
    .from("User")
    .select("*")
  
  if (!User || User.length === 0) {
    await bot.answerCallbackQuery(query.id, { text: "⚠️ Tidak ada user!", show_alert: true })
    return
  }
  
  await sendUserPage(User, query.from.id, 0, query.message.message_id, query.id, {})
}

// ========== HANDLER CALLBACK LIST PRODUK ==========

// Handler untuk detail produk
if (cmd.startsWith("produk_detail_")) {
  const kode = cmd.replace("produk_detail_", "")
  
  const { data: Produk } = await supabase
    .from("Produk")
    .select("*")
    .eq("kode", kode.toLowerCase())
    .single()
  
  if (!Produk) {
    await bot.answerCallbackQuery(query.id, { text: "❌ Produk tidak ditemukan!", show_alert: true })
    return
  }
  
  const stokCount = await getStokCount(Produk.kode)
  
  // Detect format - gunakan stok items untuk detect format
  const stokItems = await getStokItems(Produk.kode, 1)
  const sampleData = stokItems.length > 0 ? [stokItems[0].data] : (Produk.data || [])
  const formatDetected = detectProductFormat(sampleData, Produk.format)
  
  let emoji = ""
  let status = ""
  if (stokCount === 0) {
    emoji = "❌"
    status = "HABIS"
  } else if (stokCount <= 5) {
    emoji = "⚠️"
    status = "RENDAH"
  } else if (stokCount <= 20) {
    emoji = "✅"
    status = "NORMAL"
  } else {
    emoji = "🟢"
    status = "BANYAK"
  }
  
  let text = `📦 *DETAIL PRODUK*
━━━━━━━━━━━━━━━━━━━━
${emoji} *${status}*
━━━━━━━━━━━━━━━━━━━━
📦 *Nama:* ${Produk.nama}
🔖 *Kode:* \`${Produk.kode}\`
💰 *Harga:* ${formatrupiah(Produk.harga)}
${formatDetected.info}
${formatDetected.example ? formatDetected.example + '\n' : ''}━━━━━━━━━━━━━━━━━━━━
📊 *STATISTIK*
━━━━━━━━━━━━━━━━━━━━
📦 Stok Tersedia: *${stokCount}*
💰 Total Terjual: *${Produk.terjual || 0}*
💵 Total Revenue: *${formatrupiah((Produk.terjual || 0) * Produk.harga)}*

━━━━━━━━━━━━━━━━━━━━
📝 *DESKRIPSI*
━━━━━━━━━━━━━━━━━━━━
${Produk.deskripsi || 'Tidak ada deskripsi'}

━━━━━━━━━━━━━━━━━━━━
📋 *SYARAT & KETENTUAN*
━━━━━━━━━━━━━━━━━━━━
${Produk.snk || 'Tidak ada syarat & ketentuan'}

━━━━━━━━━━━━━━━━━━━━`
  
  const buttons = []
  
  if (stokCount > 0) {
    buttons.push([{ text: "🛒 Beli Sekarang", callback_data: `item:${Produk.kode}` }])
  }
  
  buttons.push([
    { text: "📊 Lihat Stok", callback_data: `stok_detail_${Produk.kode}` },
    { text: "📋 Riwayat Penjualan", callback_data: `produk_trx_${Produk.kode}` }
  ])
  
  buttons.push([{ text: "🔙 Kembali ke List", callback_data: "daftarproduk" }])
  
  await bot.answerCallbackQuery(query.id)
  await bot.sendMessage(query.from.id, text, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: buttons
    }
  })
}

// Handler untuk riwayat penjualan produk
if (cmd.startsWith("produk_trx_")) {
  const kode = cmd.replace("produk_trx_", "")
  
  const { data: Trx } = await supabase
    .from("Trx")
    .select("*")
    .eq("kode", kode.toLowerCase())
    .order("tanggal", { ascending: false })
    .limit(10)
  
  const { data: Produk } = await supabase
    .from("Produk")
    .select("*")
    .eq("kode", kode.toLowerCase())
    .single()
  
  if (!Produk) {
    await bot.answerCallbackQuery(query.id, { text: "❌ Produk tidak ditemukan!", show_alert: true })
    return
  }
  
  if (!Trx || Trx.length === 0) {
    await bot.answerCallbackQuery(query.id)
    await bot.sendMessage(query.from.id, `📋 *RIWAYAT PENJUALAN PRODUK*
━━━━━━━━━━━━━━━━━━━━
📦 Produk: *${Produk.nama}*
🔖 Kode: \`${Produk.kode}\`

Belum ada transaksi.

━━━━━━━━━━━━━━━━━━━━`, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔙 Kembali", callback_data: `produk_detail_${Produk.kode}` }]
        ]
      }
    })
    return
  }
  
  let text = `📋 *RIWAYAT PENJUALAN PRODUK*
━━━━━━━━━━━━━━━━━━━━
📦 Produk: *${Produk.nama}*
🔖 Kode: \`${Produk.kode}\`
📊 Total Terjual: ${Produk.terjual || 0}
━━━━━━━━━━━━━━━━━━━━

*10 Transaksi Terakhir:*
`
  
  Trx.forEach((t, idx) => {
    text += `${idx + 1}. *${t.jumlah}x* - ${formatrupiah(t.harga)}
   🕒 ${formatWIB(t.tanggal)}
   🆔 \`${t.trxid || 'N/A'}\`
━━━━━━━━━━━━━━━━━━━━\n`
  })
  
  await bot.answerCallbackQuery(query.id)
  await bot.sendMessage(query.from.id, text, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🔙 Kembali", callback_data: `produk_detail_${Produk.kode}` }]
      ]
    }
  })
}

// Handler untuk filter produk
if (cmd === "produk_filter") {
  await bot.answerCallbackQuery(query.id)
  await bot.sendMessage(query.from.id, `🔍 *FILTER PRODUK*
━━━━━━━━━━━━━━━━━━━━
Pilih filter yang ingin diterapkan:

━━━━━━━━━━━━━━━━━━━━`, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Tersedia", callback_data: "produk_filter_tersedia" },
          { text: "❌ Habis", callback_data: "produk_filter_habis" }
        ],
        [
          { text: "⚠️ Stok Rendah", callback_data: "produk_filter_rendah" },
          { text: "🟢 Stok Banyak", callback_data: "produk_filter_banyak" }
        ],
        [
          { text: "🔥 Best Seller", callback_data: "produk_filter_bestseller" },
          { text: "📊 Semua", callback_data: "daftarproduk" }
        ],
        [
          { text: "🔙 Kembali", callback_data: "daftarproduk" }
        ]
      ]
    }
  })
}

// Handler untuk filter tersedia
if (cmd === "produk_filter_tersedia") {
  let { data: Produk } = await supabase
    .from("Produk")
    .select("*")
  
  if (!Produk || Produk.length === 0) {
    await bot.answerCallbackQuery(query.id, { text: "⚠️ Tidak ada produk!", show_alert: true })
    return
  }
  
  // Hitung stok untuk setiap produk
  const ProdukWithStok = await Promise.all(Produk.map(async (p) => {
    const stokCount = await getStokCount(p.kode)
    return { ...p, stok_count: stokCount }
  }))
  
  const isOwnerUser = isOwner(query)
  await sendProductPage(ProdukWithStok, query.from.id, 0, query.message.message_id, query.id, {
    status: 'tersedia',
    statusLabel: 'Produk Tersedia',
    filterKey: 'tersedia'
  }, isOwnerUser)
}

// Handler untuk filter habis
if (cmd === "produk_filter_habis") {
  let { data: Produk } = await supabase
    .from("Produk")
    .select("*")
  
  if (!Produk || Produk.length === 0) {
    await bot.answerCallbackQuery(query.id, { text: "⚠️ Tidak ada produk!", show_alert: true })
    return
  }
  
  // Hitung stok untuk setiap produk
  const ProdukWithStok = await Promise.all(Produk.map(async (p) => {
    const stokCount = await getStokCount(p.kode)
    return { ...p, stok_count: stokCount }
  }))
  
  const isOwnerUser = isOwner(query)
  await sendProductPage(ProdukWithStok, query.from.id, 0, query.message.message_id, query.id, {
    status: 'habis',
    statusLabel: 'Produk Habis',
    filterKey: 'habis'
  }, isOwnerUser)
}

// Handler untuk filter rendah
if (cmd === "produk_filter_rendah") {
  let { data: Produk } = await supabase
    .from("Produk")
    .select("*")
  
  if (!Produk || Produk.length === 0) {
    await bot.answerCallbackQuery(query.id, { text: "⚠️ Tidak ada produk!", show_alert: true })
    return
  }
  
  // Hitung stok untuk setiap produk
  const ProdukWithStok = await Promise.all(Produk.map(async (p) => {
    const stokCount = await getStokCount(p.kode)
    return { ...p, stok_count: stokCount }
  }))
  
  const isOwnerUser = isOwner(query)
  await sendProductPage(ProdukWithStok, query.from.id, 0, query.message.message_id, query.id, {
    status: 'rendah',
    statusLabel: 'Stok Rendah',
    filterKey: 'rendah'
  }, isOwnerUser)
}

// Handler untuk filter banyak
if (cmd === "produk_filter_banyak") {
  let { data: Produk } = await supabase
    .from("Produk")
    .select("*")
  
  if (!Produk || Produk.length === 0) {
    await bot.answerCallbackQuery(query.id, { text: "⚠️ Tidak ada produk!", show_alert: true })
    return
  }
  
  // Hitung stok untuk setiap produk
  const ProdukWithStok = await Promise.all(Produk.map(async (p) => {
    const stokCount = await getStokCount(p.kode)
    return { ...p, stok_count: stokCount }
  }))
  
  const isOwnerUser = isOwner(query)
  await sendProductPage(ProdukWithStok, query.from.id, 0, query.message.message_id, query.id, {
    status: 'banyak',
    statusLabel: 'Stok Banyak',
    filterKey: 'banyak'
  }, isOwnerUser)
}

// Handler untuk filter bestseller
if (cmd === "produk_filter_bestseller") {
  let { data: Produk } = await supabase
    .from("Produk")
    .select("*")
  
  if (!Produk || Produk.length === 0) {
    await bot.answerCallbackQuery(query.id, { text: "⚠️ Tidak ada produk!", show_alert: true })
    return
  }
  
  // Hitung stok untuk setiap produk
  const ProdukWithStok = await Promise.all(Produk.map(async (p) => {
    const stokCount = await getStokCount(p.kode)
    return { ...p, stok_count: stokCount }
  }))
  
  const isOwnerUser = isOwner(query)
  await sendProductPage(ProdukWithStok, query.from.id, 0, query.message.message_id, query.id, {
    sortBy: 'sold_high',
    statusLabel: 'Best Seller',
    filterKey: 'bestseller'
  }, isOwnerUser)
}

// Handler untuk pagination produk
if (cmd.startsWith("produk_prev:") || cmd.startsWith("produk_next:")) {
  const isNext = cmd.startsWith("produk_next:")
  const parts = cmd.replace("produk_prev:", "").replace("produk_next:", "").split("_")
  const page = parseInt(parts[0])
  const filterKey = parts[1] || 'all'
  
  let { data: Produk } = await supabase
    .from("Produk")
    .select("*")
  
  if (!Produk || Produk.length === 0) {
    await bot.answerCallbackQuery(query.id, { text: "⚠️ Tidak ada produk!", show_alert: true })
    return
  }
  
  // Hitung stok untuk setiap produk
  const ProdukWithStok = await Promise.all(Produk.map(async (p) => {
    const stokCount = await getStokCount(p.kode)
    return { ...p, stok_count: stokCount }
  }))
  
  const newPage = isNext ? page + 1 : page - 1
  const filterOptions = {
    filterKey: filterKey
  }
  
  if (filterKey === 'tersedia') {
    filterOptions.status = 'tersedia'
    filterOptions.statusLabel = 'Produk Tersedia'
  } else if (filterKey === 'habis') {
    filterOptions.status = 'habis'
    filterOptions.statusLabel = 'Produk Habis'
  } else if (filterKey === 'rendah') {
    filterOptions.status = 'rendah'
    filterOptions.statusLabel = 'Stok Rendah'
  } else if (filterKey === 'banyak') {
    filterOptions.status = 'banyak'
    filterOptions.statusLabel = 'Stok Banyak'
  } else if (filterKey === 'bestseller') {
    filterOptions.sortBy = 'sold_high'
    filterOptions.statusLabel = 'Best Seller'
  }
  
  const isOwnerUser = isOwner(query)
  await sendProductPage(ProdukWithStok, query.from.id, newPage, query.message.message_id, query.id, filterOptions, isOwnerUser)
}

// Handler untuk statistik produk
if (cmd === "produk_statistik") {
  let { data: Produk } = await supabase
    .from("Produk")
    .select("*")
  
  if (!Produk || Produk.length === 0) {
    await bot.answerCallbackQuery(query.id, { text: "⚠️ Tidak ada produk!", show_alert: true })
    return
  }
  
  // Hitung stok untuk setiap produk
  const ProdukWithStok = await Promise.all(Produk.map(async (p) => {
    const stokCount = await getStokCount(p.kode)
    return { ...p, stok_count: stokCount }
  }))
  
  // Helper function untuk mendapatkan jumlah stok
  const getStokCountForStat = (p) => p.stok_count !== undefined ? p.stok_count : (p.data?.length || 0)
  
  // Calculate statistics
  const totalProducts = ProdukWithStok.length
  const produkTersedia = ProdukWithStok.filter(p => getStokCountForStat(p) > 0).length
  const produkHabis = ProdukWithStok.filter(p => getStokCountForStat(p) === 0).length
  const totalStok = ProdukWithStok.reduce((sum, p) => sum + getStokCountForStat(p), 0)
  const totalTerjual = ProdukWithStok.reduce((sum, p) => sum + (p.terjual || 0), 0)
  const totalNilaiStok = ProdukWithStok.reduce((sum, p) => sum + (getStokCountForStat(p) * (p.harga || 0)), 0)
  const totalRevenue = ProdukWithStok.reduce((sum, p) => sum + ((p.terjual || 0) * (p.harga || 0)), 0)
  
  // Top sellers
  const topSellers = [...ProdukWithStok]
    .sort((a, b) => (b.terjual || 0) - (a.terjual || 0))
    .slice(0, 5)
  
  const topSellersText = topSellers.map((p, idx) => {
    return `${idx + 1}. ${p.nama} - ${p.terjual || 0}x terjual`
  })
  
  // Produk dengan stok rendah
  const lowStock = ProdukWithStok.filter(p => getStokCountForStat(p) > 0 && getStokCountForStat(p) <= 5)
  
  const statText = `📊 *STATISTIK PRODUK*
━━━━━━━━━━━━━━━━━━━━
📈 *Ringkasan Umum*
━━━━━━━━━━━━━━━━━━━━
📦 Total Produk: *${totalProducts}*
✅ Produk Tersedia: *${produkTersedia}*
❌ Produk Habis: *${produkHabis}*
⚠️ Stok Rendah (≤5): *${lowStock.length}*

━━━━━━━━━━━━━━━━━━━━
📊 *Stok & Penjualan*
━━━━━━━━━━━━━━━━━━━━
📦 Total Stok: *${totalStok}*
💰 Total Terjual: *${totalTerjual}*
💵 Total Revenue: *${formatrupiah(totalRevenue)}*
💵 Nilai Stok: *${formatrupiah(totalNilaiStok)}*

━━━━━━━━━━━━━━━━━━━━
🏆 *Top 5 Best Seller*
━━━━━━━━━━━━━━━━━━━━
${topSellersText.join('\n')}

━━━━━━━━━━━━━━━━━━━━`
  
  await bot.answerCallbackQuery(query.id)
  await bot.sendMessage(query.from.id, statText, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🔙 Kembali ke List", callback_data: "daftarproduk" }]
      ]
    }
  })
}

// Handler untuk export produk
if (cmd === "produk_export") {
  if (!isOwner(query)) {
    await bot.answerCallbackQuery(query.id, { text: "⚠️ Hanya owner yang bisa export!", show_alert: true })
    return
  }
  
  let { data: Produk } = await supabase
    .from("Produk")
    .select("*")
  
  if (!Produk || Produk.length === 0) {
    await bot.answerCallbackQuery(query.id, { text: "⚠️ Tidak ada produk!", show_alert: true })
    return
  }
  
  // Create CSV content
  let csvContent = "No,Nama Produk,Kode,Harga,Stok Tersedia,Stok Terjual,Total Revenue,Status\n"
  
  const produkDetails = Produk.map((p, idx) => {
    let status = ""
    if (p.data.length === 0) {
      status = "HABIS"
    } else if (p.data.length <= 5) {
      status = "RENDAH"
    } else if (p.data.length <= 20) {
      status = "NORMAL"
    } else {
      status = "BANYAK"
    }
    
    const revenue = (p.terjual || 0) * (p.harga || 0)
    return `${idx + 1},"${p.nama}",${p.kode},${p.harga || 0},${p.data.length || 0},${p.terjual || 0},${revenue},"${status}"`
  })
  
  csvContent += produkDetails.join('\n')
  
  const filename = `produk_export_${Date.now()}.csv`
  const filepath = `./${filename}`
  fs.writeFileSync(filepath, csvContent)
  
  await bot.answerCallbackQuery(query.id)
  await bot.sendDocument(query.from.id, filepath, {
    filename: filename,
    contentType: 'text/csv',
    caption: `📥 *EXPORT DATA PRODUK*
━━━━━━━━━━━━━━━━━━━━
📊 Total Produk: ${Produk.length}
📅 Tanggal Export: ${formatWIB(new Date().toISOString())}
━━━━━━━━━━━━━━━━━━━━
File berisi semua data produk dalam format CSV.`,
    parse_mode: "Markdown"
  })
  
  fs.unlinkSync(filepath)
}

if (cmd === "saldomenu") {
  const saldo = await cekSaldo(query.from.id)
  await bot.answerCallbackQuery(query.id)

  const text = copy.get('screen.saldo_menu', { saldo: formatrupiah(saldo) })

  const reply_markup = {
    inline_keyboard: [
      [{text: "💳 Top Up Saldo", callback_data: "deposit_menu"}],
      [{text: "📋 Riwayat Deposit", callback_data: "riwayatdeposit"}],
      [{text: "🔙 Menu Utama", callback_data: "kembaliawal"}]
    ]
  }

  await bot.editMessageCaption(text, {
    chat_id: query.message.chat.id,
    message_id: query.message.message_id,
    parse_mode: "Markdown",
    reply_markup
  }).catch(async (e) => {
    try {
      await bot.deleteMessage(query.message.chat.id, query.message.message_id)
    } catch (err) {}
    await sendBannerMessage(query.from.id, text, { reply_markup })
  })
}

if (cmd === "deposit_menu") {
  await bot.answerCallbackQuery(query.id)
  const text = `💳 *TOP UP SALDO*
=======================
*Cara Top Up:*
1. Ketik \`/deposit Jumlah\`
2. Scan QRIS yang muncul
3. Saldo akan ditambahkan otomatis

*Contoh:*
\`/deposit 50000\`
\`/deposit 100000\`

=======================
💡 *Minimum deposit:* Rp 1.000
💡 Saldo akan ditambahkan setelah pembayaran berhasil`

  const reply_markup = {
    inline_keyboard: [
      [
        { text: "Rp 5.000", callback_data: "deposit_preset:5000" },
        { text: "Rp 10.000", callback_data: "deposit_preset:10000" }
      ],
      [
        { text: "Rp 25.000", callback_data: "deposit_preset:25000" },
        { text: "Rp 50.000", callback_data: "deposit_preset:50000" }
      ],
      [
        { text: "Rp 100.000", callback_data: "deposit_preset:100000" }
      ],
      [
        { text: "⌨️ Custom Nominal", callback_data: "deposit_custom" }
      ],
      [{text: "📋 Riwayat Deposit", callback_data: "riwayatdeposit"}],
      [{text: "🔙 Kembali", callback_data: "saldomenu"}]
    ]
  }

  await bot.editMessageCaption(text, {
    chat_id: query.message.chat.id,
    message_id: query.message.message_id,
    parse_mode: "Markdown",
    reply_markup
  }).catch(async (e) => {
    try {
      await bot.deleteMessage(query.message.chat.id, query.message.message_id)
    } catch (err) {}
    await sendBannerMessage(query.from.id, text, { reply_markup })
  })
}

if (cmd === "riwayatdeposit") {
  await bot.answerCallbackQuery(query.id)
  const { data: Deposits } = await supabase
    .from("Deposit")
    .select("*")
    .eq('user_id', query.from.id)
    .order('tanggal', { ascending: false })
    .limit(10)
  
  if (!Deposits || Deposits.length === 0) {
    const text = `📋 *RIWAYAT DEPOSIT*
=======================
Belum ada riwayat deposit.

=======================
💡 Gunakan \`/deposit\` untuk top up saldo.`

    const reply_markup = {
      inline_keyboard: [
        [{text: "💳 Top Up Saldo", callback_data: "deposit_menu"}],
        [{text: "🔙 Kembali", callback_data: "saldomenu"}]
      ]
    }

    await bot.editMessageCaption(text, {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      parse_mode: "Markdown",
      reply_markup
    }).catch(async (e) => {
      try {
        await bot.deleteMessage(query.message.chat.id, query.message.message_id)
      } catch (err) {}
      await sendBannerMessage(query.from.id, text, { reply_markup })
    })
    return
  }
  
  let tx = `📋 *RIWAYAT DEPOSIT*
=======================
📊 *Total:* ${Deposits.length} deposit
=======================
\n`
  
  Deposits.forEach((dep, idx) => {
    const statusEmoji = dep.status === 'success' ? '✅' : dep.status === 'pending' ? '⏳' : dep.status === 'expired' ? '⏰' : '❌'
    tx += `${statusEmoji} *${idx + 1}. ${formatrupiah(dep.jumlah)}*
🆔 Kode: \`${dep.kode_deposit}\`
💵 Total: ${formatrupiah(dep.total)}
📅 ${formatWIB(dep.tanggal)}
Status: *${dep.status.toUpperCase()}*
\n`
  })
  
  tx += `=======================`
  
  const reply_markup = {
    inline_keyboard: [
      [{text: "💳 Top Up Lagi", callback_data: "deposit_menu"}],
      [{text: "🔙 Kembali", callback_data: "saldomenu"}]
    ]
  }

  await bot.editMessageCaption(tx, {
    chat_id: query.message.chat.id,
    message_id: query.message.message_id,
    parse_mode: "Markdown",
    reply_markup
  }).catch(async (e) => {
    try {
      await bot.deleteMessage(query.message.chat.id, query.message.message_id)
    } catch (err) {}
    await sendBannerMessage(query.from.id, tx, { reply_markup })
  })
}

if (cmd.startsWith("bataldeposit_")) {
  const kodeDeposit = cmd.replace("bataldeposit_", "")
  
  // Ambil data deposit untuk mendapatkan nominal agar bisa dicancel di Pakasir
  const { data: dep } = await supabase
    .from("Deposit")
    .select("jumlah")
    .eq('kode_deposit', kodeDeposit)
    .single()
    
  if (dep) {
    await pakasir.cancelTransaction({ orderId: kodeDeposit, amount: dep.jumlah })
      .catch(err => console.error(`Error canceling transaction ${kodeDeposit} on Pakasir:`, err.message))
  }

  await supabase
    .from("Deposit")
    .update({ status: 'failed' })
    .eq('kode_deposit', kodeDeposit)
    .eq('user_id', query.from.id)

  await supabase
    .from("Payment")
    .update({ status: 'canceled', updated_at: new Date().toISOString() })
    .eq('order_id', kodeDeposit)
  
  await bot.answerCallbackQuery(query.id, { text: "✅ Deposit dibatalkan", show_alert: true })
  await bot.deleteMessage(query.message.chat.id, query.message.message_id)
  await sendMessage(query.from.id, `❌ *DEPOSIT DIBATALKAN*
=======================
Kode Deposit: \`${kodeDeposit}\`

=======================
💡 Gunakan \`/deposit\` untuk membuat deposit baru.`)
}

 if (cmd === "kembaliawal") {
    try {
      // Kosongkan keranjang jika ada
      if (await cart.exists(query.from.id)) {
        let Data = await cart.get(query.from.id)
        
        // Release reservations sebelum kembali ke menu awal
        if (Data.selectedStokIds && Data.selectedStokIds.length > 0) {
          releaseReservation(Data.selectedStokIds)
          console.log(`🔓 Release ${Data.selectedStokIds.length} reserved stocks for user ${query.from.id} (kembaliawal)`)
        }
        
        await cart.clear(query.from.id)
      }

      if (flow.isEnabled()) {
        await dispatchFlow(query.from.id, flow.getEntryKey(), {
          msgId: query.message.message_id,
          firstName: query.from.first_name,
          push: false,
          query,
        })
        return
      }
     
     // Parallel queries untuk semua data (LEBIH CEPAT!)
     const [
       trxCountResult,
       userCountResult,
       stoktersedia,
       stokterjual,
       userSaldo
     ] = await Promise.all([
       // Count transaksi (lebih cepat dari select *)
       supabase.from("Trx").select("*", { count: 'exact', head: true }),
       // Count user (lebih cepat dari select *)
       supabase.from("User").select("*", { count: 'exact', head: true }),
       // Total stok tersedia (1 query langsung)
       getTotalStokTersedia(),
       // Total stok terjual (1 query dengan SUM)
       getTotalStokTerjual(),
       // Saldo user
       cekSaldo(query.from.id)
     ])
     
     // Extract counts
     const trxCount = trxCountResult.count || 0
      const userCount = userCountResult.count || 0
      await editOrSendBannerMessage(query.from.id, query.message.message_id, welcomeCaption({
        first_name: query.from.first_name,
        user_count: userCount,
        stok_terjual: stokterjual,
        stok_tersedia: stoktersedia,
        saldo: userSaldo,
      }), {
       reply_markup: welcomeInlineKeyboard()
     })
   } catch (error) {
     console.error('Error in kembaliawal:', error)
     await bot.answerCallbackQuery(query.id, { text: "⚠️ Terjadi kesalahan. Silakan coba lagi.", show_alert: true })
   }
 }
  if (cmd === "daftarproduk") {
    await openProductList(query)
  }
  
  // Handler untuk menu kategori
  if (cmd === "kategori_menu") {
    await openKategoriMenu(query)
  }
  
  // Handler untuk filter produk berdasarkan kategori
  if (cmd.startsWith("kategori_")) {
    const kategori = cmd.replace("kategori_", "")
    let { data: Produk } = await supabase
      .from("Produk")
      .select("*")
    
    if (!Produk || Produk.length === 0) {
      await bot.answerCallbackQuery(query.id, { text: "⚠️ Belum ada produk!", show_alert: true })
      return
    }
    
    // Hitung stok untuk setiap produk
    const ProdukWithStok = await Promise.all(Produk.map(async (p) => {
      const stokCount = await getStokCount(p.kode)
      return { ...p, stok_count: stokCount }
    }))
    
    // Filter produk berdasarkan kategori
    const kategoriProduk = ProdukWithStok.filter(p => 
      (p.kategori || 'umum').toLowerCase() === kategori.toLowerCase()
    )
    
    if (kategoriProduk.length === 0) {
      await bot.answerCallbackQuery(query.id, { 
        text: `⚠️ Tidak ada produk di kategori ${getKategoriName(kategori)}!`, 
        show_alert: true 
      })
      return
    }
    
    try {
      await bot.deleteMessage(query.message.chat.id, query.message.message_id)
    } catch (e) {
      // Ignore if message already deleted
    }
    
    const isOwnerUser = isOwner(query)
    const kategoriLabel = `${getKategoriEmoji(kategori)} ${getKategoriName(kategori)}`
    await sendProductPage(kategoriProduk, query.from.id, 0, query.message.message_id, query.id, {
      kategori: kategori,
      kategoriLabel: kategoriLabel
    }, isOwnerUser)
  }
  
  if (cmd === "riwayattransaksi") {
    await openRiwayat(query)
  }
  
  // Handler untuk filter riwayat transaksi
  if (cmd === "riwayat_filter") {
    await bot.answerCallbackQuery(query.id)
    await bot.sendMessage(query.from.id, `🔍 *FILTER RIWAYAT TRANSAKSI*
━━━━━━━━━━━━━━━━━━━━
Pilih periode yang ingin Anda lihat:

━━━━━━━━━━━━━━━━━━━━`, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "📅 Hari Ini", callback_data: "filter_today" },
            { text: "📅 Minggu Ini", callback_data: "filter_week" }
          ],
          [
            { text: "📅 Bulan Ini", callback_data: "filter_month" },
            { text: "📅 Bulan Lalu", callback_data: "filter_lastmonth" }
          ],
          [
            { text: "📅 Semua", callback_data: "filter_all" }
          ],
          [
            { text: "🔙 Kembali", callback_data: "riwayattransaksi" }
          ]
        ]
      }
    })
  }
  
  // Handler untuk setiap filter option
  if (cmd.startsWith("filter_")) {
    const filterType = cmd.replace("filter_", "")
    let { data: Trx } = await supabase
      .from("Trx")
      .select("*")
    
    if (!Trx || Trx.length === 0) {
      await bot.answerCallbackQuery(query.id, { text: "⚠️ Belum ada transaksi!", show_alert: true })
      return
    }
    
    await bot.answerCallbackQuery(query.id)
    
    const now = new Date()
    let filterOptions = {}
    
    switch(filterType) {
      case 'today':
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        filterOptions = { startDate: todayStart, periodLabel: 'Hari Ini', filterKey: 'today' }
        break
      case 'week':
        const weekStart = new Date(now)
        weekStart.setDate(now.getDate() - 7)
        filterOptions = { startDate: weekStart, periodLabel: '7 Hari Terakhir', filterKey: 'week' }
        break
      case 'month':
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
        filterOptions = { startDate: monthStart, periodLabel: 'Bulan Ini', filterKey: 'month' }
        break
      case 'lastmonth':
        const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
        const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59)
        filterOptions = { startDate: lastMonthStart, endDate: lastMonthEnd, periodLabel: 'Bulan Lalu', filterKey: 'lastmonth' }
        break
      default:
        filterOptions = { filterKey: 'all' }
    }
    
    try {
      await bot.deleteMessage(query.message.chat.id, query.message.message_id)
    } catch (e) {
      // Ignore if message already deleted
    }
    await sendPage(Trx, query.from.id, 0, null, null, filterOptions)
  }
  
  // Handler untuk statistik riwayat
  if (cmd === "riwayat_statistik") {
    await bot.answerCallbackQuery(query.id)
    let { data: Trx } = await supabase
      .from("Trx")
      .select("*")
      .eq("id", query.from.id)
    
    if (!Trx || Trx.length === 0) {
      await bot.sendMessage(query.from.id, `⚠️ *Belum Ada Data*
━━━━━━━━━━━━━━━━━━━━
Belum ada transaksi untuk ditampilkan statistiknya.

━━━━━━━━━━━━━━━━━━━━`, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [[
            { text: "🔙 Kembali", callback_data: "riwayattransaksi" }
          ]]
        }
      })
      return
    }
    
    // Calculate statistics
    const totalAll = Trx.reduce((sum, t) => sum + (t.harga || 0), 0)
    const avgTransaksi = Math.round(totalAll / Trx.length)
    
    // This month statistics
    const thisMonth = new Date()
    thisMonth.setDate(1)
    thisMonth.setHours(0, 0, 0, 0)
    
    const thisMonthTrx = Trx.filter(t => new Date(t.tanggal) >= thisMonth)
    const totalBulan = thisMonthTrx.reduce((sum, t) => sum + (t.harga || 0), 0)
    
    // Last month statistics
    const lastMonthStart = new Date(thisMonth.getFullYear(), thisMonth.getMonth() - 1, 1)
    const lastMonthEnd = new Date(thisMonth.getFullYear(), thisMonth.getMonth(), 0, 23, 59, 59)
    const lastMonthTrx = Trx.filter(t => {
      const tDate = new Date(t.tanggal)
      return tDate >= lastMonthStart && tDate <= lastMonthEnd
    })
    const totalLastMonth = lastMonthTrx.reduce((sum, t) => sum + (t.harga || 0), 0)
    
    // Most purchased product
    const produkCount = {}
    Trx.forEach(t => {
      const key = t.kode || t.nama || 'Unknown'
      produkCount[key] = (produkCount[key] || 0) + 1
    })
    const topProduk = Object.entries(produkCount)
      .sort((a, b) => b[1] - a[1])[0]
    
    // Most expensive transaction
    const mostExpensive = Trx.reduce((max, t) => (t.harga || 0) > (max.harga || 0) ? t : max, Trx[0])
    
    await bot.sendMessage(query.from.id, `📊 *STATISTIK TRANSAKSI*
━━━━━━━━━━━━━━━━━━━━
📈 *Ringkasan Umum*
━━━━━━━━━━━━━━━━━━━━
📦 Total Transaksi: *${Trx.length}*
💰 Total Pengeluaran: *${formatrupiah(totalAll)}*
📊 Rata-rata/Transaksi: *${formatrupiah(avgTransaksi)}*

━━━━━━━━━━━━━━━━━━━━
📅 *Periode*
━━━━━━━━━━━━━━━━━━━━
📆 Bulan Ini: *${formatrupiah(totalBulan)}* (${thisMonthTrx.length} transaksi)
📆 Bulan Lalu: *${formatrupiah(totalLastMonth)}* (${lastMonthTrx.length} transaksi)

━━━━━━━━━━━━━━━━━━━━
🏆 *Produk Favorit*
━━━━━━━━━━━━━━━━━━━━
${topProduk ? `📦 *${topProduk[0]}*: ${topProduk[1]}x dibeli` : 'Belum ada data'}

━━━━━━━━━━━━━━━━━━━━
💎 *Transaksi Terbesar*
━━━━━━━━━━━━━━━━━━━━
${mostExpensive ? `💰 *${formatrupiah(mostExpensive.harga)}*\n📦 ${mostExpensive.nama}\n🕒 ${formatWIB(mostExpensive.tanggal)}` : 'Belum ada data'}

━━━━━━━━━━━━━━━━━━━━`, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "📋 Lihat Riwayat", callback_data: "riwayattransaksi" },
            { text: "🔍 Filter", callback_data: "riwayat_filter" }
          ],
          [
            { text: "🔙 Menu Utama", callback_data: "kembaliawal" }
          ]
        ]
      }
    })
  }
  
  if (cmd === "caraorder") {
    await bot.answerCallbackQuery(query.id)
    await bot.deleteMessage(query.message.chat.id, query.message.message_id)

    await bot.sendMessage(query.from.id, copy.get('screen.cara_order'), {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "📦 Mulai Order", callback_data: "daftarproduk" },
            { text: "💰 Top Up Saldo", callback_data: "saldomenu" }
          ],
          [
            { text: "❓ FAQ", callback_data: "caraorder_faq" },
            { text: "💳 Metode Bayar", callback_data: "caraorder_payment" }
          ],
          [
            { text: "📞 Hubungi CS", url: channelContact.cs },
            { text: "📢 Channel", url: channelContact.channelStore }
          ],
          [
            { text: "🔙 Kembali", callback_data: "kembaliawal" }
          ]
        ]
      }
    })
  }
  
  // Handler untuk FAQ
  if (cmd === "caraorder_faq") {
    await bot.answerCallbackQuery(query.id)
    await bot.sendMessage(query.from.id, `❓ *FAQ - PERTANYAAN UMUM*
━━━━━━━━━━━━━━━━━━━━

*Q1: Bagaimana cara menggunakan voucher?*
━━━━━━━━━━━━━━━━━━━━
A: Setelah memilih produk dan jumlah, klik "Punya" saat ditanya tentang voucher, lalu masukkan kode voucher Anda. Potongan akan otomatis diterapkan.

━━━━━━━━━━━━━━━━━━━━

*Q2: Berapa lama produk dikirim setelah pembayaran?*
━━━━━━━━━━━━━━━━━━━━
A: Produk akan terkirim otomatis dalam beberapa detik setelah pembayaran berhasil. Tidak perlu menunggu lama!

━━━━━━━━━━━━━━━━━━━━

*Q3: Bagaimana jika pembayaran QRIS gagal?*
━━━━━━━━━━━━━━━━━━━━
A: Pastikan scan QRIS sebelum expired (10 menit). Jika gagal atau expired, buat pesanan baru atau hubungi CS untuk bantuan.

━━━━━━━━━━━━━━━━━━━━

*Q4: Bisakah membatalkan pesanan?*
━━━━━━━━━━━━━━━━━━━━
A: Pesanan bisa dibatalkan sebelum melakukan pembayaran dengan klik tombol "❌ Batal". Setelah bayar, pesanan tidak bisa dibatalkan.

━━━━━━━━━━━━━━━━━━━━

*Q5: Bagaimana cara top up saldo?*
━━━━━━━━━━━━━━━━━━━━
A: Klik menu "💰 Saldo & Deposit" → "💳 Top Up Saldo" → Pilih jumlah → Scan QRIS → Saldo otomatis masuk dalam beberapa detik.

━━━━━━━━━━━━━━━━━━━━

*Q6: Apakah ada fee untuk pembayaran?*
━━━━━━━━━━━━━━━━━━━━
A: Pembayaran QRIS dikenakan fee admin (tergantung nominal). Pembayaran menggunakan saldo tidak ada fee admin.

━━━━━━━━━━━━━━━━━━━━

*Q7: Bagaimana jika produk tidak terkirim?*
━━━━━━━━━━━━━━━━━━━━
A: Hubungi Customer Service dengan menyertakan Trx ID. Tim CS akan membantu menyelesaikan masalah Anda.

━━━━━━━━━━━━━━━━━━━━

*Q8: Bisa pesan lebih dari 5 item?*
━━━━━━━━━━━━━━━━━━━━
A: Untuk saat ini maksimal 5 item per transaksi. Jika ingin lebih, buat pesanan terpisah.

━━━━━━━━━━━━━━━━━━━━`, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "📖 Panduan Order", callback_data: "caraorder" },
            { text: "💳 Metode Bayar", callback_data: "caraorder_payment" }
          ],
          [
            { text: "📞 Hubungi CS", url: channelContact.cs },
            { text: "📦 Mulai Order", callback_data: "daftarproduk" }
          ],
          [
            { text: "🔙 Kembali", callback_data: "kembaliawal" }
          ]
        ]
      }
    })
  }
  
  // Handler untuk informasi metode pembayaran
  if (cmd === "caraorder_payment") {
    await bot.answerCallbackQuery(query.id)
    await bot.sendMessage(query.from.id, `💳 *METODE PEMBAYARAN*
━━━━━━━━━━━━━━━━━━━━

*1️⃣ QRIS (QR Code)*
━━━━━━━━━━━━━━━━━━━━
✅ *Keuntungan:*
• Mudah dan cepat
• Langsung dari aplikasi e-wallet
• Otomatis terdeteksi setelah bayar

📋 *Cara Menggunakan:*
1. Klik "Bayar" setelah pilih produk
2. Scan QR Code yang muncul dengan aplikasi e-wallet Anda
3. Bayar sesuai nominal yang tertera
4. Produk otomatis terkirim setelah pembayaran berhasil

⏰ *Waktu Expired:* 10 menit
💵 *Fee Admin:* Ada (tergantung nominal)
⚠️ *Penting:* Pastikan scan sebelum expired!

━━━━━━━━━━━━━━━━━━━━

*2️⃣ Saldo (Balance)*
━━━━━━━━━━━━━━━━━━━━
✅ *Keuntungan:*
• Lebih cepat (tanpa scan QR)
• Tidak ada fee admin
• Transaksi instan
• Lebih hemat untuk transaksi rutin

📋 *Cara Menggunakan:*
1. Pastikan saldo Anda mencukupi
2. Pilih produk dan jumlah
3. Klik "Bayar Pakai Saldo"
4. Produk langsung terkirim tanpa menunggu

💰 *Cara Top Up Saldo:*
• Klik menu "💰 Saldo & Deposit"
• Pilih "💳 Top Up Saldo"
• Pilih jumlah yang ingin di-top up
• Scan QRIS untuk pembayaran
• Saldo otomatis masuk dalam beberapa detik

━━━━━━━━━━━━━━━━━━━━

*3️⃣ Voucher/Diskon*
━━━━━━━━━━━━━━━━━━━━
🎟️ *Cara Menggunakan:*
1. Setelah pilih produk dan jumlah
2. Klik "Punya" saat ditanya tentang voucher
3. Masukkan kode voucher Anda
4. Potongan otomatis diterapkan ke total harga

💡 *Tips:*
• Cek syarat voucher sebelum digunakan
• Beberapa voucher hanya untuk produk tertentu
• Voucher memiliki limit penggunaan
• Voucher tidak bisa digabung dengan voucher lain

━━━━━━━━━━━━━━━━━━━━

*📊 Perbandingan Metode*
━━━━━━━━━━━━━━━━━━━━
| Metode | Kecepatan | Fee | Kebutuhan |
|--------|-----------|-----|-----------|
| QRIS | ⚡ Cepat | 💵 Ada | E-wallet |
| Saldo | ⚡⚡ Sangat Cepat | ✅ Gratis | Top up dulu |

━━━━━━━━━━━━━━━━━━━━`, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "💰 Top Up Saldo", callback_data: "saldomenu" },
            { text: "📦 Mulai Order", callback_data: "daftarproduk" }
          ],
          [
            { text: "📖 Panduan Lengkap", callback_data: "caraorder" },
            { text: "❓ FAQ", callback_data: "caraorder_faq" }
          ],
          [
            { text: "🔙 Kembali", callback_data: "kembaliawal" }
          ]
        ]
      }
    })
  }
 } catch (err) {
   console.log(err)
  await sendMessage(query.from.id, `⚠️ ERROR: ${err}`)
}
})


bot.on('message',async (msg) => {
    // FIX: Cek apakah msg.text ada sebelum digunakan
    let text = msg.text || ''
    console.log(text)
  
  // FIX: Reset semua state mode interaktif jika user mengetik command (kecuali command yang sama)
  if (text && typeof text === 'string' && text.startsWith('/')) {
    const command = text.split(' ')[0].toLowerCase()
    
    // Reset state jika user mengetik command yang berbeda
    if (command !== '/addproduk' && command !== '/batal') {
      if (addProdukState[msg.from.id]) {
        delete addProdukState[msg.from.id]
      }
    }
    if (command !== '/editnama' && command !== '/batal') {
      if (editNamaState[msg.from.id]) {
        delete editNamaState[msg.from.id]
      }
    }
    if (command !== '/editkode' && command !== '/batal') {
      if (editKodeState[msg.from.id]) {
        delete editKodeState[msg.from.id]
      }
    }
    if (command !== '/editharga' && command !== '/batal') {
      if (editHargaState[msg.from.id]) {
        delete editHargaState[msg.from.id]
      }
    }
    if (command !== '/editdeskripsi' && command !== '/batal') {
      if (editDeskripsiState[msg.from.id]) {
        delete editDeskripsiState[msg.from.id]
      }
    }
    if (command !== '/editsnk' && command !== '/batal') {
      if (editSnkState[msg.from.id]) {
        delete editSnkState[msg.from.id]
      }
    }
    if (command !== '/editformat' && command !== '/batal') {
      if (editFormatState[msg.from.id]) {
        delete editFormatState[msg.from.id]
      }
    }
    if (command !== '/editkategori' && command !== '/batal') {
      if (editKategoriState[msg.from.id]) {
        delete editKategoriState[msg.from.id]
      }
    }
    if (command !== '/deposit' && command !== '/batal') {
      if (depositState[msg.from.id]) {
        delete depositState[msg.from.id]
      }
    }
  }
  
  // Handler untuk custom nominal deposit (tanpa prefix /deposit)
  if (depositState[msg.from.id] && depositState[msg.from.id].status === 'awaiting_custom_nominal' && text && !text.startsWith('/')) {
    const inputText = text.trim()
    
    // Parse nominal
    const jumlah = parseInt(inputText)
    if (isNaN(jumlah) || jumlah < 1000) {
      return await bot.sendMessage(msg.from.id, `❌ *NOMINAL TIDAK VALID*
=======================
Minimum deposit: *Rp 1.000*

Nominal yang Anda masukkan: \`${inputText}\`

=======================
💡 Silakan kirim angka nominal minimal 1000 (contoh: \`15000\`).
Ketik \`/batal\` untuk membatalkan.`, {
        parse_mode: "Markdown"
      })
    }
    
    // Clear state dan jalankan transaksi deposit
    delete depositState[msg.from.id]
    await createDepositTransaction(msg.from.id, msg.from.username, msg.from.first_name, jumlah, msg.chat.id)
    return
  }
  
  // PRIORITAS 1: Handler voucher (harus dijalankan pertama)
  if (await cart.exists(msg.from.id)) {
    let Data = await cart.get(msg.from.id)
    if (Data.voucher_status === "waiting") {
      // FIX: Cek apakah text ada sebelum digunakan
      if (!text || typeof text !== 'string' || text.trim() === '') {
        return await bot.sendMessage(msg.from.id, `⚠️ Silakan kirim kode voucher dalam bentuk teks.`, {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                {text: "Tidak", callback_data: "bayar"},
                {text: "Punya", callback_data: "punya"}
              ]
            ]
          }
        })
      }
      
      let voucher = text
      Data.voucher_status = ""
      await cart.save(msg.from.id, Data)
      let { data: VC } = await supabase
        .from("Voucher")
        .select("*")
      
      // Hapus pesan input voucher jika ada
      if (msgg[msg.from.id]) {
        try {
          await bot.deleteMessage(msgg[msg.from.id].chat.id, msgg[msg.from.id].message_id)
        } catch (err) {
          // Ignore error jika pesan sudah dihapus
        }
        delete msgg[msg.from.id]
      }
      
      // Normalisasi kode voucher (trim dan case-insensitive)
      const voucherNormalized = voucher.trim()
      let vv = VC.find(d => d.kode.toLowerCase() === voucherNormalized.toLowerCase())
      
      if (!vv) {
        // Voucher tidak ditemukan
        return await bot.sendMessage(msg.from.id, `❌ *Kode Voucher Tidak Ditemukan!*
=======================
Kode voucher \`${voucherNormalized}\` tidak terdaftar di database.

=======================
💡 Pastikan kode voucher sudah benar atau hubungi admin.`, {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                {text: "Tidak", callback_data: "bayar"},
                {text: "Punya", callback_data: "punya"}
              ]
            ]
          }
        })
      }
      
      // Cek apakah user sudah menggunakan voucher ini
      const sudahPakai = vv.user && vv.user.some(us => us === msg.from.id)
      if (sudahPakai) {
        return await bot.sendMessage(msg.from.id, `❌ *Voucher Sudah Digunakan!*
=======================
Kode voucher \`${vv.kode}\` sudah pernah Anda gunakan sebelumnya.

=======================
💡 Setiap voucher hanya bisa digunakan sekali per user.`, {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                {text: "Tidak", callback_data: "bayar"},
                {text: "Punya", callback_data: "punya"}
              ]
            ]
          }
        })
      }
      
      // Cek limit voucher
      if (vv.limit <= 0) {
        return await bot.sendMessage(msg.from.id, `❌ *Voucher Habis!*
=======================
Kode voucher \`${vv.kode}\` sudah mencapai batas penggunaan.

=======================
💡 Limit voucher: ${vv.limit}`, {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                {text: "Tidak", callback_data: "bayar"},
                {text: "Punya", callback_data: "punya"}
              ]
            ]
          }
        })
      }
      
      // Cek apakah voucher berlaku untuk produk ini
      const produkValid = vv.produk && (
        vv.produk[0] === "all" || 
        vv.produk.some(gd => gd.toLowerCase() === Data.kode.toLowerCase())
      )
      
      if (!produkValid) {
        return await bot.sendMessage(msg.from.id, `❌ *Voucher Tidak Berlaku!*
=======================
Kode voucher \`${vv.kode}\` tidak berlaku untuk produk ini.

*Produk yang berlaku:*
${vv.produk[0] === "all" ? "Semua Produk" : vv.produk.join(", ")}

*Produk Anda:*
${Data.kode}

=======================
💡 Gunakan voucher yang sesuai dengan produk.`, {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                {text: "Tidak", callback_data: "bayar"},
                {text: "Punya", callback_data: "punya"}
              ]
            ]
          }
        })
      }
      
      // Voucher valid, simpan ke data transaksi
      Data.voucher = vv.kode
      await cart.save(msg.from.id, Data)
      
      const itemVoucher = await getVarianForCart(Data.kode)
      const resolvedVoucher = itemVoucher
        ? await hargaUntukQty(itemVoucher, Data.jumlah)
        : { subtotal: 0, harga_satuan: 0 }
      let totalBayar = Math.max(0, resolvedVoucher.subtotal - vv.potongan)
      
      const userSaldo = await cekSaldo(msg.from.id)
      const keyboard = []
      let infoText = `Silahkan klik tombol di bawah untuk melakukan pembayaran.`
      
      if (userSaldo >= totalBayar) {
        keyboard.push([{ text: "💰 Bayar Pakai Saldo", callback_data: "bayarsaldo" }])
        keyboard.push([{ text: "💳 Bayar QRIS", callback_data: "bayar" }])
      } else {
        infoText = `Saldo Anda tidak mencukupi untuk membayar dengan saldo. Silakan top up atau bayar langsung via QRIS.`
        keyboard.push([{ text: "💳 Bayar QRIS", callback_data: "bayar" }])
        keyboard.push([{ text: "💰 Top Up Saldo", callback_data: "deposit_menu" }])
      }
      
      await bot.sendMessage(msg.from.id, `✅ *Kode Voucher Valid!*
=======================
🎟️ *Kode:* \`${vv.kode}\`
💰 *Potongan:* ${formatrupiah(vv.potongan)}
📦 *Produk Berlaku:* ${vv.produk[0] === "all" ? "Semua Produk" : vv.produk.join(", ")}
💵 *Total Setelah Diskon:* ${formatrupiah(totalBayar)}
=======================
${infoText}`, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: keyboard
        }
      })
      return // PENTING: return agar handler lain tidak dijalankan
    }
  }

  // Handler untuk text button dari Reply Keyboard
  if (text && typeof text === 'string' && !text.startsWith('/')) {
    const cleanText = text.trim()
    
    // 1. Daftar Produk
    if (cleanText === "Daftar Produk" || cleanText === "📦 Daftar Produk") {
      let { data: Produk } = await supabase
        .from("Produk")
        .select("*")
      
      if (!Produk || Produk.length === 0) {
        return await bot.sendMessage(msg.from.id, `⚠️ *BELUM ADA PRODUK*
━━━━━━━━━━━━━━━━━━━━
Belum ada produk yang terdaftar.

━━━━━━━━━━━━━━━━━━━━
💡 Hubungi admin untuk informasi lebih lanjut.`, {
          parse_mode: "Markdown"
        })
      }
      
      const ProdukWithStok = await Promise.all(Produk.map(async (p) => {
        const stokCount = await getStokCount(p.kode)
        return { ...p, stok_count: stokCount }
      }))
      
      const isOwnerUser = msg.from.id === OwnerID
      await sendProductPage(ProdukWithStok, msg.from.id, 0, null, null, {}, isOwnerUser)
      return
    }
    
    // 2. Riwayat Transaksi
    if (cleanText === "Riwayat Transaksi" || cleanText === "📋 Riwayat Transaksi") {
      let { data: Trx } = await supabase
        .from("Trx")
        .select("*")
      
      if (!Trx || Trx.length === 0) {
        return await bot.sendMessage(msg.from.id, `⚠️ Belum ada transaksi apapun!`)
      }
      await sendPage(Trx, msg.from.id, 0)
      return
    }
    
    // 3. Saldo Menu
    if (cleanText.startsWith("Saldo:") || cleanText.startsWith("💰 Saldo:") || cleanText === "Saldo & Deposit" || cleanText === "‹💰› Saldo & Deposit") {
      const saldo = await cekSaldo(msg.from.id)
      const textResponse = `💰 *SALDO & DEPOSIT*
=======================
💵 *Saldo Tersedia:* ${formatrupiah(saldo)}
=======================
*Fitur:*
• 💳 Top Up Saldo - Deposit saldo via QRIS
• 📋 Riwayat Deposit - Lihat riwayat deposit
• 💰 Cek Saldo - Lihat saldo saat ini
=======================
💡 Gunakan saldo untuk pembayaran yang lebih cepat!`

      const reply_markup = {
        inline_keyboard: [
          [{text: "💳 Top Up Saldo", callback_data: "deposit_menu"}],
          [{text: "📋 Riwayat Deposit", callback_data: "riwayatdeposit"}],
          [{text: "🔙 Menu Utama", callback_data: "kembaliawal"}]
        ]
      }

      await sendBannerMessage(msg.from.id, textResponse, { reply_markup })
      return
    }
  }
  
  // Handler untuk mode interaktif editnama
  if (editNamaState[msg.from.id] && text && typeof text === 'string' && !text.startsWith('/')) {
    const state = editNamaState[msg.from.id]
    const namaBaru = text.trim()
    
    if (!namaBaru) {
      return await bot.sendMessage(msg.from.id, `⚠️ Nama produk tidak boleh kosong!\n\nSilakan kirim nama baru.`, {
        reply_markup: {
          inline_keyboard: [[{ text: "❌ Batal", callback_data: "editnama_cancel" }]]
        }
      })
    }
    
    await supabase
      .from("Produk")
      .update({ nama: namaBaru })
      .eq('kode', state.kode)
    
    await bot.sendMessage(msg.from.id, `✅ *NAMA PRODUK BERHASIL DIUBAH*
━━━━━━━━━━━━━━━━━━━━
🔖 *Kode:* \`${state.kode}\`
📦 *Nama Lama:* ${state.namaLama}
📦 *Nama Baru:* ${namaBaru}
━━━━━━━━━━━━━━━━━━━━
💡 Perubahan telah disimpan.`, { parse_mode: "Markdown" })
    
    delete editNamaState[msg.from.id]
    return
  }
  
  // Handler untuk mode interaktif editkode
  if (editKodeState[msg.from.id] && text && typeof text === 'string' && !text.startsWith('/')) {
    const state = editKodeState[msg.from.id]
    const kodeBaru = text.trim().toLowerCase()
    
    if (!kodeBaru) {
      return await bot.sendMessage(msg.from.id, `⚠️ Kode produk tidak boleh kosong!\n\nSilakan kirim kode baru.`, {
        reply_markup: {
          inline_keyboard: [[{ text: "❌ Batal", callback_data: "editkode_cancel" }]]
        }
      })
    }
    
    // Cek apakah kode sudah digunakan
    let { data: Produk } = await supabase
      .from("Produk")
      .select("*")
    
    let existingProduct = Produk.find(p => p.kode.toLowerCase() === kodeBaru && p.kode.toLowerCase() !== state.kode)
    if (existingProduct) {
      return await bot.sendMessage(msg.from.id, `❌ *KODE SUDAH DIGUNAKAN*
━━━━━━━━━━━━━━━━━━━━
Kode \`${kodeBaru}\` sudah digunakan oleh produk:
• *Nama:* ${existingProduct.nama}

━━━━━━━━━━━━━━━━━━━━
💡 Gunakan kode yang berbeda.`, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [[{ text: "❌ Batal", callback_data: "editkode_cancel" }]]
        }
      })
    }
    
    await supabase
      .from("Produk")
      .update({ kode: kodeBaru })
      .eq('kode', state.kode)
    
    await bot.sendMessage(msg.from.id, `✅ *KODE PRODUK BERHASIL DIUBAH*
━━━━━━━━━━━━━━━━━━━━
📦 *Produk:* ${state.namaProduk}
🔖 *Kode Lama:* \`${state.kode}\`
🔖 *Kode Baru:* \`${kodeBaru}\`
━━━━━━━━━━━━━━━━━━━━
💡 Perubahan telah disimpan.`, { parse_mode: "Markdown" })
    
    delete editKodeState[msg.from.id]
    return
  }
  
  // Handler untuk mode interaktif editharga
  if (editHargaState[msg.from.id] && text && typeof text === 'string' && !text.startsWith('/')) {
    const state = editHargaState[msg.from.id]
    const hargaBaru = text.trim()
    
    if (isNaN(hargaBaru) || Number(hargaBaru) <= 0) {
      return await bot.sendMessage(msg.from.id, `❌ *HARGA TIDAK VALID*
━━━━━━━━━━━━━━━━━━━━
Harga harus berupa angka dan lebih besar dari 0.

*Contoh:* \`5000\`, \`10000\`, \`25000\`

Harga yang Anda masukkan: \`${hargaBaru}\`

━━━━━━━━━━━━━━━━━━━━
💡 Silakan kirim harga yang benar.`, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [[{ text: "❌ Batal", callback_data: "editharga_cancel" }]]
        }
      })
    }
    
    await supabase
      .from("Produk")
      .update({ harga: Number(hargaBaru) })
      .eq('kode', state.kode)
    
    await bot.sendMessage(msg.from.id, `✅ *HARGA PRODUK BERHASIL DIUBAH*
━━━━━━━━━━━━━━━━━━━━
📦 *Produk:* ${state.namaProduk}
🔖 *Kode:* \`${state.kode}\`
💰 *Harga Lama:* ${formatrupiah(state.hargaLama)}
💰 *Harga Baru:* ${formatrupiah(Number(hargaBaru))}
━━━━━━━━━━━━━━━━━━━━
💡 Perubahan telah disimpan.`, { parse_mode: "Markdown" })
    
    delete editHargaState[msg.from.id]
    return
  }
  
  // Handler untuk mode interaktif editdeskripsi
  if (editDeskripsiState[msg.from.id] && text && typeof text === 'string' && !text.startsWith('/')) {
    const state = editDeskripsiState[msg.from.id]
    const deskripsiBaru = text.trim()
    
    if (!deskripsiBaru) {
      return await bot.sendMessage(msg.from.id, `⚠️ Deskripsi tidak boleh kosong!\n\nSilakan kirim deskripsi baru.`, {
        reply_markup: {
          inline_keyboard: [[{ text: "❌ Batal", callback_data: "editdeskripsi_cancel" }]]
        }
      })
    }
    
    await supabase
      .from("Produk")
      .update({ deskripsi: deskripsiBaru })
      .eq('kode', state.kode)
    
    await bot.sendMessage(msg.from.id, `✅ *DESKRIPSI PRODUK BERHASIL DIUBAH*
━━━━━━━━━━━━━━━━━━━━
📦 *Produk:* ${state.namaProduk}
🔖 *Kode:* \`${state.kode}\`
📝 *Deskripsi Lama:* ${state.deskripsiLama}
📝 *Deskripsi Baru:* ${deskripsiBaru}
━━━━━━━━━━━━━━━━━━━━
💡 Perubahan telah disimpan.`, { parse_mode: "Markdown" })
    
    delete editDeskripsiState[msg.from.id]
    return
  }
  
  // Handler untuk mode interaktif editsnk
  if (editSnkState[msg.from.id] && text && typeof text === 'string' && !text.startsWith('/')) {
    const state = editSnkState[msg.from.id]
    const snkBaru = text.trim()
    
    if (!snkBaru) {
      return await bot.sendMessage(msg.from.id, `⚠️ Syarat & ketentuan tidak boleh kosong!\n\nSilakan kirim SnK baru.`, {
        reply_markup: {
          inline_keyboard: [[{ text: "❌ Batal", callback_data: "editsnk_cancel" }]]
        }
      })
    }
    
    await supabase
      .from("Produk")
      .update({ snk: snkBaru })
      .eq('kode', state.kode)
    
    await bot.sendMessage(msg.from.id, `✅ *SYARAT & KETENTUAN BERHASIL DIUBAH*
━━━━━━━━━━━━━━━━━━━━
📦 *Produk:* ${state.namaProduk}
🔖 *Kode:* \`${state.kode}\`
📋 *SnK Lama:* ${state.snkLama}
📋 *SnK Baru:* ${snkBaru}
━━━━━━━━━━━━━━━━━━━━
💡 Perubahan telah disimpan.`, { parse_mode: "Markdown" })
    
    delete editSnkState[msg.from.id]
    return
  }
  
  // Handler untuk mode interaktif editformat
  if (editFormatState[msg.from.id] && text && typeof text === 'string' && !text.startsWith('/')) {
    const state = editFormatState[msg.from.id]
    const formatInput = text.trim()
    
    // Jika input "auto", reset ke auto-detect
    if (formatInput.toLowerCase() === 'auto') {
      await supabase
        .from("Produk")
        .update({ format: null })
        .eq('kode', state.kode.toLowerCase())
      
      delete editFormatState[msg.from.id]
      
      await bot.sendMessage(msg.from.id, `✅ *FORMAT DIUBAH KE AUTO-DETECT*

━━━━━━━━━━━━━━━━━━━━
📦 *Produk:* ${state.nama}
🔖 *Kode:* \`${state.kode}\`

Format produk akan otomatis dideteksi dari data stok.

━━━━━━━━━━━━━━━━━━━━
💡 Perubahan telah disimpan.`, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔙 Menu Owner", callback_data: "ownermenu" }]
          ]
        }
      })
      return
    }
    
    // Simpan format baru
    const formatBaru = formatInput
    
    await supabase
      .from("Produk")
      .update({ format: formatBaru })
      .eq('kode', state.kode.toLowerCase())
    
    delete editFormatState[msg.from.id]
    
    await bot.sendMessage(msg.from.id, `✅ *FORMAT PRODUK BERHASIL DIUBAH*
━━━━━━━━━━━━━━━━━━━━
📦 *Produk:* ${state.nama}
🔖 *Kode:* \`${state.kode}\`
📄 *Format Lama:* ${state.formatLama}
📄 *Format Baru:* ${formatBaru}
━━━━━━━━━━━━━━━━━━━━
💡 Perubahan telah disimpan.`, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔙 Menu Owner", callback_data: "ownermenu" }]
        ]
      }
    })
    return
  }
  
  // Handler untuk mode interaktif editkategori
  if (editKategoriState[msg.from.id] && text && typeof text === 'string' && !text.startsWith('/')) {
    const state = editKategoriState[msg.from.id]
    const kategoriInput = text.trim().toLowerCase()
    
    // Validasi kategori
    const kategoriList = ['game', 'streaming', 'software', 'social media', 'voucher', 'education', 'umum']
    
    if (!kategoriList.includes(kategoriInput)) {
      return await bot.sendMessage(msg.from.id, `❌ *Kategori Tidak Valid!*
━━━━━━━━━━━━━━━━━━━━
Kategori yang Anda masukkan: \`${text.trim()}\`

*Kategori yang tersedia:*
• \`game\` 🎮
• \`streaming\` 📺
• \`software\` 💻
• \`social media\` 📱
• \`voucher\` 🎟️
• \`education\` 📚
• \`umum\` 📦

━━━━━━━━━━━━━━━━━━━━
💡 Silakan kirim salah satu kategori di atas.`, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "❌ Batal", callback_data: "editkategori_cancel" }]
          ]
        }
      })
    }
    
    // Update kategori
    await supabase
      .from("Produk")
      .update({ kategori: kategoriInput })
      .eq('kode', state.kode.toLowerCase())
    
    const kategoriEmojiLama = getKategoriEmoji(state.kategoriLama)
    const kategoriNameLama = getKategoriName(state.kategoriLama)
    const kategoriEmojiBaru = getKategoriEmoji(kategoriInput)
    const kategoriNameBaru = getKategoriName(kategoriInput)
    
    delete editKategoriState[msg.from.id]
    
    await bot.sendMessage(msg.from.id, `✅ *KATEGORI PRODUK BERHASIL DIUBAH*
━━━━━━━━━━━━━━━━━━━━
📦 *Produk:* ${state.namaProduk}
🔖 *Kode:* \`${state.kode}\`
🏷️ *Kategori Lama:* ${kategoriEmojiLama} ${kategoriNameLama}
🏷️ *Kategori Baru:* ${kategoriEmojiBaru} ${kategoriNameBaru}
━━━━━━━━━━━━━━━━━━━━
💡 Perubahan telah disimpan.`, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔙 Menu Owner", callback_data: "ownermenu" }]
        ]
      }
    })
    return
  }
  
  // Handler untuk mode interaktif addproduk
  if (addProdukState[msg.from.id] && text && typeof text === 'string' && !text.startsWith('/')) {
    const state = addProdukState[msg.from.id]
    const inputText = text.trim()
    
    if (inputText.toLowerCase() === '/batal' || inputText.toLowerCase() === 'batal') {
      delete addProdukState[msg.from.id]
      return await sendMessage(msg.from.id, `❌ Proses tambah produk dibatalkan.`)
    }
    
    switch(state.step) {
      case 1: // Nama
        if (!inputText) {
          return await bot.sendMessage(msg.from.id, `⚠️ Nama produk tidak boleh kosong!\n\nSilakan kirim nama produk.

Klik tombol BATAL di bawah untuk membatalkan.`, {
            reply_markup: {
              inline_keyboard: [
                [{ text: "❌ Batal", callback_data: "addproduk_cancel" }]
              ]
            }
          })
        }
        state.data.nama = inputText
        state.step = 2
        await bot.sendMessage(msg.from.id, `✅ *Nama produk:* ${inputText}

*Langkah 2/5: Kode Produk*
Silakan kirim kode unik produk.

*Contoh:* \`SPO3B\`

=======================
💡 Kode akan otomatis diubah ke huruf kecil.
Klik tombol BATAL di bawah untuk membatalkan.`, {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "❌ Batal", callback_data: "addproduk_cancel" }]
            ]
          }
        })
        return
        
      case 2: // Kode
        if (!inputText) {
          return await bot.sendMessage(msg.from.id, `⚠️ Kode produk tidak boleh kosong!\n\nSilakan kirim kode produk.

Klik tombol BATAL di bawah untuk membatalkan.`, {
            reply_markup: {
              inline_keyboard: [
                [{ text: "❌ Batal", callback_data: "addproduk_cancel" }]
              ]
            }
          })
        }
        state.data.kode = inputText.toLowerCase()
        state.step = 3
        await bot.sendMessage(msg.from.id, `✅ *Kode produk:* \`${inputText.toLowerCase()}\`

*Langkah 3/5: Harga Produk*
Silakan kirim harga produk (angka saja).

*Contoh:* \`5000\` atau \`10000\`

=======================
⚠️ Harga harus berupa angka dan lebih besar dari 0.
Klik tombol BATAL di bawah untuk membatalkan.`, {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "❌ Batal", callback_data: "addproduk_cancel" }]
            ]
          }
        })
        return
        
      case 3: // Harga
        if (isNaN(inputText) || Number(inputText) <= 0) {
          return await bot.sendMessage(msg.from.id, `❌ *Harga Tidak Valid!*
=======================
Harga harus berupa angka dan lebih besar dari 0.

*Contoh:* \`5000\`, \`10000\`, \`25000\`

Harga yang Anda masukkan: \`${inputText}\`

=======================
💡 Silakan kirim harga yang benar.
Klik tombol BATAL di bawah untuk membatalkan.`, {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [{ text: "❌ Batal", callback_data: "addproduk_cancel" }]
              ]
            }
          })
        }
        state.data.harga = Number(inputText)
        state.step = 4
        await bot.sendMessage(msg.from.id, `✅ *Harga produk:* ${formatrupiah(Number(inputText))}

*Langkah 4/6: Kategori Produk*
Silakan kirim kategori produk.

*Kategori yang tersedia:*
• \`game\` 🎮
• \`streaming\` 📺
• \`software\` 💻
• \`social media\` 📱
• \`voucher\` 🎟️
• \`education\` 📚
• \`umum\` 📦 (default)

*Contoh:* \`streaming\` atau \`game\`

=======================
💡 Jika dikosongkan, akan menggunakan kategori "umum".
Klik tombol BATAL di bawah untuk membatalkan.`, {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "❌ Batal", callback_data: "addproduk_cancel" }]
            ]
          }
        })
        return
        
      case 4: // Kategori
        const kategoriList = ['game', 'streaming', 'software', 'social media', 'voucher', 'education', 'umum']
        const kategoriInput = inputText.trim().toLowerCase() || 'umum'
        
        if (!kategoriList.includes(kategoriInput)) {
          return await bot.sendMessage(msg.from.id, `❌ *Kategori Tidak Valid!*
=======================
Kategori yang Anda masukkan: \`${inputText}\`

*Kategori yang tersedia:*
• \`game\` 🎮
• \`streaming\` 📺
• \`software\` 💻
• \`social media\` 📱
• \`voucher\` 🎟️
• \`education\` 📚
• \`umum\` 📦

=======================
💡 Silakan kirim salah satu kategori di atas.
Klik tombol BATAL di bawah untuk membatalkan.`, {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [{ text: "❌ Batal", callback_data: "addproduk_cancel" }]
              ]
            }
          })
        }
        
        state.data.kategori = kategoriInput
        const kategoriEmoji = getKategoriEmoji(kategoriInput)
        const kategoriName = getKategoriName(kategoriInput)
        state.step = 5
        await bot.sendMessage(msg.from.id, `✅ *Kategori produk:* ${kategoriEmoji} ${kategoriName}

*Langkah 5/6: Deskripsi Produk*
Silakan kirim deskripsi produk.

*Contoh:* \`Akun Spotify Premium dengan akses penuh fitur selama 1 bulan\`

=======================
💡 Anda bisa mengirim pesan panjang untuk deskripsi.
Klik tombol BATAL di bawah untuk membatalkan.`, {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "❌ Batal", callback_data: "addproduk_cancel" }]
            ]
          }
        })
        return
        
      case 5: // Deskripsi
        if (!inputText) {
          return await bot.sendMessage(msg.from.id, `⚠️ Deskripsi produk tidak boleh kosong!\n\nSilakan kirim deskripsi produk.

Klik tombol BATAL di bawah untuk membatalkan.`, {
            reply_markup: {
              inline_keyboard: [
                [{ text: "❌ Batal", callback_data: "addproduk_cancel" }]
              ]
            }
          })
        }
        state.data.deskripsi = inputText
        state.step = 6
        await bot.sendMessage(msg.from.id, `✅ *Deskripsi produk:* ${inputText}

*Langkah 6/6: Syarat & Ketentuan*
Silakan kirim syarat dan ketentuan produk.

*Contoh:* \`Tidak boleh diubah password, Tidak boleh di-share ke orang lain\`

=======================
💡 Anda bisa mengirim pesan panjang untuk SnK.
Klik tombol BATAL di bawah untuk membatalkan.`, {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "❌ Batal", callback_data: "addproduk_cancel" }]
            ]
          }
        })
        return
        
      case 6: // SnK
        if (!inputText) {
          return await bot.sendMessage(msg.from.id, `⚠️ Syarat & ketentuan tidak boleh kosong!\n\nSilakan kirim syarat dan ketentuan produk.

Klik tombol BATAL di bawah untuk membatalkan.`, {
            reply_markup: {
              inline_keyboard: [
                [{ text: "❌ Batal", callback_data: "addproduk_cancel" }]
              ]
            }
          })
        }
        state.data.snk = inputText
        
        // Validasi kode duplikat
        const { data } = await supabase.from('Produk').select('*')
        let tr = null
        if (data.length !== 0) {
          Object.keys(data).forEach((g) => {
            if (data[g].nama.toLowerCase() === state.data.nama.toLowerCase() || 
                data[g].kode.toLowerCase() === state.data.kode.toLowerCase()) tr = g
          })
        }
        
        if (tr !== null) {
          delete addProdukState[msg.from.id]
          return await bot.sendMessage(msg.from.id, `❌ *PRODUK SUDAH ADA!*
=======================
Nama atau kode produk sudah terdaftar di database.

Produk yang ditemukan:
• Nama: \`${data[tr].nama}\`
• Kode: \`${data[tr].kode}\`

=======================
💡 Gunakan nama atau kode yang berbeda.
Ketik \`/addproduk\` untuk mencoba lagi.`, { parse_mode: "Markdown" })
        }
        
        // Insert produk
        const kategoriFinal = state.data.kategori || 'umum'
        await supabase.from("Produk").insert([{
          nama: state.data.nama,
          kode: state.data.kode,
          harga: state.data.harga,
          kategori: kategoriFinal,
          deskripsi: state.data.deskripsi,
          snk: state.data.snk,
          data: [],
          terjual: 0
        }])
        
        const kategoriEmojiFinal = getKategoriEmoji(kategoriFinal)
        const kategoriNameFinal = getKategoriName(kategoriFinal)
        await bot.sendMessage(msg.from.id, `✅ *PRODUK BERHASIL DITAMBAHKAN*
=======================
📦 *Nama:* ${state.data.nama}
🔖 *Kode:* \`${state.data.kode}\`
💰 *Harga:* ${formatrupiah(state.data.harga)}
🏷️ *Kategori:* ${kategoriEmojiFinal} ${kategoriNameFinal}
📝 *Deskripsi:* ${state.data.deskripsi}
📋 *SnK:* ${state.data.snk}
=======================
💡 Gunakan \`/addstok ${state.data.kode}|DataProduk\` untuk menambah stok.`, { parse_mode: "Markdown" })
        
        delete addProdukState[msg.from.id]
        return
    }
  }
  
})

// Handler untuk upload file stok
bot.on('document', async (msg) => {
})

// Startup Diagnostics
console.log("==================================================");
console.log("🔒 [Pakasir Init] Memeriksa Konfigurasi Payment Gateway:");
console.log(`- Project Slug: ${Pakasir.project ? Pakasir.project : '⚠️ BELUM DIKONFIGURASI'}`);
console.log(`- API Key: ${Pakasir.apiKey ? 'Terpasang (Panjang: ' + Pakasir.apiKey.length + ')' : '⚠️ BELUM DIKONFIGURASI'}`);
console.log(`- Base URL: ${Pakasir.baseUrl}`);
console.log("==================================================");
console.log("Bot Elevate Digital siap dijalankan!");

// ============================================
// RECONCILIATION CRON (Pakasir durability)
// Catches payments the webhook marked 'paid' but the in-process polling
// loop never fulfilled (e.g. the bot restarted mid-payment). Runs every
// 2 minutes; fulfillment is idempotent via the guarded paid -> fulfilled
// status transition, so it can never double-credit or double-deliver.
// ============================================
cron.schedule('*/2 * * * *', async () => {
  try {
    const cutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString()
    const { data: rows } = await supabase
      .from('Payment')
      .select('*')
      .eq('status', 'paid')
      .lt('created_at', cutoff)
      .limit(20)

    if (!rows || rows.length === 0) return

    for (const p of rows) {
      // Claim atomically so we never double-fulfill.
      const { data: claimed } = await supabase
        .from('Payment')
        .update({ status: 'fulfilled' })
        .eq('order_id', p.order_id)
        .eq('status', 'paid')
        .select()
      if (!claimed || claimed.length === 0) continue

      if (p.type === 'deposit') {
        await supabase.from('Deposit').update({ status: 'success' }).eq('kode_deposit', p.order_id)
        await addSaldo(p.user_id, p.amount)
        const saldoBaru = await cekSaldo(p.user_id)
        const replyKb = await generateReplyKeyboard(p.user_id)
        await sendMessage(p.user_id, `✅ *DEPOSIT BERHASIL*
=======================
💰 *Jumlah:* ${formatrupiah(p.amount)}
🆔 *Kode Deposit:* \`${p.order_id}\`
💵 *Saldo Sekarang:* ${formatrupiah(saldoBaru)}
=======================
💡 Saldo telah ditambahkan ke akun Anda!`, { reply_markup: replyKb }).catch(() => {})
        if (channelContact.channelLog) {
          await bot.sendMessage(channelContact.channelLog, `💰 *DEPOSIT (REKONSILIASI)*
=======================
User ID: \`${p.user_id}\`
Jumlah: ${formatrupiah(p.amount)}
Kode: \`${p.order_id}\`
=======================`, { parse_mode: 'Markdown' }).catch(() => {})
        }
      } else if (p.type === 'purchase') {
        // Product delivery needs the bot purchase context, so alert the owner to deliver manually.
        if (channelContact.channelLog) {
          await bot.sendMessage(channelContact.channelLog, `⚠️ *PEMBAYARAN PERLU TINDAK LANJUT*
=======================
Pembelian QRIS sudah DIBAYAR tapi belum terkirim otomatis (kemungkinan bot restart).
Trx ID: \`${p.order_id}\`
User ID: \`${p.user_id}\`
Produk: \`${p.meta?.kode || '-'}\` x${p.meta?.jumlah || '-'}
Total: ${formatrupiah(p.total)}
=======================
Mohon kirim produk secara manual.`, { parse_mode: 'Markdown' }).catch(() => {})
        }
        await sendMessage(p.user_id, `✅ *PEMBAYARAN DITERIMA*
=======================
Trx ID: \`${p.order_id}\`
Pembayaran Anda sudah kami terima. Produk akan segera diproses. Jika belum diterima dalam beberapa menit, silakan hubungi CS.`).catch(() => {})
      }
    }
  } catch (e) {
    console.error('[Pakasir Reconcile] error:', e.message)
  }
})
console.log("⏱️  [Pakasir Reconcile] Cron rekonsiliasi pembayaran aktif (setiap 2 menit).");
