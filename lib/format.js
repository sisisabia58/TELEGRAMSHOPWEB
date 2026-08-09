// Helper format angka & tanggal yang dipakai bot maupun dashboard.
//
// formatrupiah sebelumnya didefinisikan dua kali (index.js dan dashboard.js)
// dengan isi yang identik. Sekarang satu sumber.
const moment = require('moment-timezone')
require('moment/locale/id') // data locale Indonesia untuk nama bulan/hari

const namaBulan = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
]

function formatrupiah(nominal) {
  return new Intl.NumberFormat('id', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(nominal)
}

// "Senin, 09 Agustus 2026 14:30" — dipakai bot
function formatWIB(isoString) {
  const date = new Date(isoString)
  const formattedDate = new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  }).format(date)
  const formattedTime = new Intl.DateTimeFormat('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date)
  return `${formattedDate} ${formattedTime}`
}

// Sama seperti formatWIB tapi dengan detik.
function formatWIBDetail(isoString) {
  const date = new Date(isoString)
  const formattedDate = new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  }).format(date)
  const formattedTime = new Intl.DateTimeFormat('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(date)
  return `${formattedDate} ${formattedTime}`
}

// "09 Agustus 2026, 14:30" — dipakai dashboard.
//
// .locale('id') dipasang per pemanggilan, bukan lewat moment.locale() global,
// supaya modul ini tidak mengubah perilaku moment di modul lain.
//
// CATATAN: sebelum helper ini dipindah ke sini, dashboard menampilkan nama
// bulan dalam bahasa Inggris ("10 August 2026") karena locale 'id' hanya
// dimuat di index.js dan tidak pernah di dashboard.js.
function formatTanggal(date) {
  return moment.tz(date, 'Asia/Jakarta').locale('id').format('DD MMMM YYYY, HH:mm')
}

module.exports = {
  namaBulan,
  formatrupiah,
  formatWIB,
  formatWIBDetail,
  formatTanggal
}
