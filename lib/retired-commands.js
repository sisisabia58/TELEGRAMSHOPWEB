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

const copy = require('./copy')

function retiredOwnerHelpText(dashboardUrl) {
  const url = dashboardUrl || process.env.DASHBOARD_URL || ''
  return copy.get('err.retired_command', {
    dashboard_line: url ? `\n\n🔗 ${url}` : '',
  })
}

module.exports = {
  RETIRED_OWNER_COMMANDS,
  KEPT_OWNER_COMMANDS,
  isRetiredOwnerCommand,
  retiredOwnerHelpText,
  normalizeCommand,
}
