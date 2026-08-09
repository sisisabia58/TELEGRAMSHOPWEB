// Pengaturan runtime dari tabel "NotificationSettings" — dengan cache dalam
// proses dan invalidasi lintas proses.
//
// CATATAN NAMA: file ini SENGAJA tidak bernama settings.js. Di root repo sudah
// ada settings.js yang isinya loader environment variable (TOKEN_BOT, dll).
// Dua file bernama sama akan membingungkan; ini "runtime settings" karena
// nilainya bisa berubah saat aplikasi berjalan.
//
// MASALAH YANG DISELESAIKAN:
// Bot (index.js) dan dashboard (dashboard.js) adalah dua proses terpisah.
// Sebelumnya bot memanggil loadChannelContactFromDb() satu kali saat boot, jadi
// perubahan channel/CS dari dashboard tidak pernah sampai ke bot yang sedang
// berjalan sampai bot di-restart.
//
// CARA KERJA:
//   1. Dashboard menulis pengaturan, lalu memanggil bump() yang menaikkan
//      satu baris penanda: setting_key = 'cache_version'.
//   2. Bot memanggil startPolling(); tiap interval ia membaca SATU baris
//      penanda itu saja (murah). Kalau angkanya berubah, seluruh pengaturan
//      dimuat ulang dan cache ditukar sekaligus (atomic swap).
//
// Keterlambatan maksimal = interval polling (default 10 detik). Ini cukup untuk
// perubahan pengaturan, dan jauh lebih sederhana daripada saling ping HTTP
// antar proses (yang butuh port tambahan dan rusak kalau proses dipisah
// ke container berbeda).
const supabase = require('./supabase')

const TABLE = 'NotificationSettings'
const VERSION_KEY = 'cache_version'

let cache = Object.create(null)
let loadedVersion = null
let sudahDimuat = false
let pollTimer = null

// setting_value adalah JSONB. Konvensi yang sudah dipakai dashboard adalah
// membungkus nilai sebagai { value: X }, jadi buka bungkusnya di sini.
function unwrap(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'value' in raw) return raw.value
  return raw
}

async function readVersion() {
  const { data, error } = await supabase
    .from(TABLE)
    .select('setting_value')
    .eq('setting_key', VERSION_KEY)
    .maybeSingle()

  if (error) throw error
  const v = unwrap(data?.setting_value)
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

async function loadAll() {
  const { data, error } = await supabase
    .from(TABLE)
    .select('setting_key, setting_value')

  if (error) throw error

  const berikutnya = Object.create(null)
  for (const row of data || []) berikutnya[row.setting_key] = unwrap(row.setting_value)
  cache = berikutnya // tukar sekaligus; pembaca tidak pernah melihat cache separuh terisi
  sudahDimuat = true
}

// Muat ulang kalau versi berubah (atau kalau force / belum pernah dimuat).
// Mengembalikan true bila cache benar-benar dimuat ulang.
// Tidak pernah throw: kegagalan baca tidak boleh menjatuhkan bot, cukup pakai
// nilai cache lama.
async function refresh(force = false) {
  try {
    if (force || !sudahDimuat) {
      loadedVersion = await readVersion().catch(() => 0)
      await loadAll()
      return true
    }
    const versi = await readVersion()
    if (versi !== loadedVersion) {
      loadedVersion = versi
      await loadAll()
      return true
    }
    return false
  } catch (e) {
    console.error('[runtime-settings] gagal refresh:', e.message)
    return false
  }
}

// Baca sinkron dari cache hangat. Pemanggil TIDAK perlu await.
function get(key, fallback = undefined) {
  const v = cache[key]
  if (v === undefined || v === null || v === '') return fallback
  return v
}

function getAll() {
  return { ...cache }
}

function isReady() {
  return sudahDimuat
}

// Dipanggil bot setelah boot. Dashboard tidak perlu polling — ia membaca
// langsung saat menangani request.
function startPolling(intervalMs = 10000, onReload) {
  if (pollTimer) return pollTimer
  pollTimer = setInterval(() => {
    refresh().then((changed) => {
      if (changed && typeof onReload === 'function') onReload()
    }).catch(() => {})
  }, intervalMs)
  if (pollTimer.unref) pollTimer.unref() // jangan menahan proses tetap hidup
  return pollTimer
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

// Dipanggil dashboard SETIAP KALI selesai menulis pengaturan / copy / flow,
// supaya bot tahu harus memuat ulang.
//
// Satu penanda versi dipakai bersama oleh semua subsistem (pengaturan, copy,
// flow) — jangan dibuat penanda terpisah per subsistem, karena kalau ada yang
// terlewat dashboard akan menampilkan nilai yang tidak dipakai bot.
async function bump() {
  try {
    const sekarang = await readVersion().catch(() => 0)
    const { error } = await supabase
      .from(TABLE)
      .upsert({
        setting_key: VERSION_KEY,
        setting_value: { value: sekarang + 1 },
        updated_at: new Date().toISOString()
      }, { onConflict: 'setting_key' })

    if (error) throw error
    return sekarang + 1
  } catch (e) {
    console.error('[runtime-settings] gagal bump cache_version:', e.message)
    return null
  }
}

module.exports = {
  refresh,
  get,
  getAll,
  isReady,
  startPolling,
  stopPolling,
  bump,
  VERSION_KEY
}
