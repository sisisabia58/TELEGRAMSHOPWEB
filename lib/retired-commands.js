const RETIRED_OWNER_COMMANDS = [
  'ownermenu',
  'addproduk',
  'delproduk',
  'addstok',
  'editstok',
  'setpremium',
  'addpremiumuser',
  'removepremiumuser',
  'editnama',
  'editkode',
  'editharga',
  'editdeskripsi',
  'editsnk',
  'editformat',
  'editkategori',
  'deluser',
  'bc',
  'addvoucher',
  'delvoucher',
  'listvoucher',
]

const KEPT_OWNER_COMMANDS = ['stok', 'rekap', 'listuser']

function normalizeCommand(cmd) {
  if (!cmd || typeof cmd !== 'string') return ''
  const raw = cmd.trim().split(/\s+/)[0].toLowerCase()
  return raw.startsWith('/') ? raw.slice(1) : raw
}

function isRetiredOwnerCommand(cmd) {
  return RETIRED_OWNER_COMMANDS.includes(normalizeCommand(cmd))
}

function retiredOwnerHelpText(dashboardUrl) {
  const url = dashboardUrl || process.env.DASHBOARD_URL || ''
  let msg = '🛠️ *Perintah admin bot sudah dipensiunkan.*\n\n'
  msg += 'Kelola toko lewat *Dashboard* (produk, stok, voucher, broadcast, flow, copy).\n'
  if (url) msg += `\n🔗 ${url}\n`
  msg += '\nLaporan cepat di bot: `/stok` · `/rekap` · `/listuser`'
  return msg
}

module.exports = {
  RETIRED_OWNER_COMMANDS,
  KEPT_OWNER_COMMANDS,
  isRetiredOwnerCommand,
  retiredOwnerHelpText,
  normalizeCommand,
}
