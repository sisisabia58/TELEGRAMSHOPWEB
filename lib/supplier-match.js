// lib/supplier-match.js — mencocokkan nama produk supplier ke Varian kita.
//
// Supplier menamai barangnya sesuka mereka ("🔥 Netflix Premium 1 Month"),
// katalog kita menamainya "Netflix" + varian "30 Hari". Modul ini menjembatani
// keduanya supaya dua penjual yang sama-sama punya Netflix 30 hari menempel ke
// SATU varian, bukan jadi tiga produk berbeda di mata pembeli.
//
// KENAPA HANYA COCOK PERSIS (setelah normalisasi), BUKAN FUZZY:
// salah gabung berarti pembeli membayar barang A dan menerima barang B — rugi
// uang dan kepercayaan. Skor kemiripan pasti salah cepat atau lambat, dan
// diamnya tidak terlihat. Jadi: cocok persis kalau memang persis, kalau tidak
// buat produk baru (tetap tayang, tidak ada yang hilang), dan biarkan admin
// memetakan ulang lewat dashboard. Pemetaan manual itu lengket — sync tidak
// pernah menimpanya.
//
// Modul ini MURNI: tidak menyentuh database, tidak ada I/O.

// Kata yang tidak membedakan apa pun; ada di sebagian nama supplier saja dan
// membuat dua nama yang sebenarnya sama jadi tidak cocok.
const KATA_BUANG = new Set([
  'akun', 'account', 'acc',
  'garansi', 'warranty',
  'private', 'sharing',
  'legal', 'official', 'resmi',
  'murah', 'promo', 'termurah', 'best', 'terbaik',
  'ready', 'stok', 'stock',
  'new', 'baru',
  'via', 'by',
])

// Satuan durasi -> jumlah hari. Ditulis satu arah supaya "1 bulan",
// "30 hari", "1 month", "30 days", dan "30d" semua jadi token yang sama.
const SATUAN_HARI = {
  hari: 1, hr: 1, h: 1, day: 1, days: 1, d: 1,
  minggu: 7, mgg: 7, week: 7, weeks: 7, w: 7,
  bulan: 30, bln: 30, month: 30, months: 30, mo: 30, mth: 30, m: 30,
  tahun: 365, thn: 365, year: 365, years: 365, yr: 365, y: 365,
}

// Durasi yang secara praktis sama tapi ditulis dengan angka berbeda harus jatuh
// ke token yang sama, kalau tidak "12 Bulan" (12×30 = 360) dan "1 Tahun" (365)
// jadi dua produk terpisah di mata pembeli padahal barangnya identik. Sama
// untuk "30 Hari" vs "31 Hari". Jendelanya sengaja sempit — cukup untuk menyerap
// perbedaan penulisan, tidak cukup untuk menggabungkan paket yang beda.
const EMBER_HARI = [
  [6, 8, 7],
  [13, 16, 14],
  [28, 32, 30],
  [58, 63, 60],
  [88, 93, 90],
  [175, 186, 180],
  [355, 370, 365],
]

function snapHari(n) {
  for (const [min, max, kanonik] of EMBER_HARI) {
    if (n >= min && n <= max) return kanonik
  }
  return n
}

// Nama yang ditulis huruf ("one month", "setahun") — jarang, tapi murah didukung.
const ANGKA_KATA = {
  satu: 1, one: 1, se: 1,
  dua: 2, two: 2,
  tiga: 3, three: 3,
  enam: 6, six: 6,
  duabelas: 12, twelve: 12,
}

// Buang emoji, tanda baca, dan spasi berlebih. Menyisakan huruf/angka + spasi.
function normalizeName(teks) {
  return String(teks == null ? '' : teks)
    .toLowerCase()
    .normalize('NFKD')
    // Rentang emoji/simbol/varian-selector.
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}]/gu, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

// "1 bulan" / "30 hari" / "1month" -> "30h". Mengembalikan null kalau teksnya
// bukan durasi.
function normalizeDuration(teks) {
  const bersih = normalizeName(teks)
  if (!bersih) return null

  // Bentuk gabung tanpa spasi: "30d", "1bln", "12months".
  const gabung = bersih.match(/^(\d+)\s*([a-z]+)$/)
  if (gabung) {
    const n = Number(gabung[1])
    const faktor = SATUAN_HARI[gabung[2]]
    if (faktor && Number.isFinite(n) && n > 0) return `${snapHari(n * faktor)}h`
    return null
  }

  // Bentuk kata: "satu bulan", "setahun".
  const kata = bersih.match(/^([a-z]+)\s*([a-z]+)$/)
  if (kata) {
    const n = ANGKA_KATA[kata[1]]
    const faktor = SATUAN_HARI[kata[2]]
    if (n && faktor) return `${snapHari(n * faktor)}h`
  }

  return null
}

// Ubah nama bebas jadi kunci yang bisa dibandingkan. Setiap token durasi
// dilipat ke bentuk "<n>h", kata basa-basi dibuang, sisanya diurutkan supaya
// "netflix premium 1 bulan" dan "premium netflix 30 hari" jatuh ke kunci sama.
function buildKey(teks) {
  const bersih = normalizeName(teks)
  if (!bersih) return ''

  const token = bersih.split(' ')
  const hasil = []

  for (let i = 0; i < token.length; i++) {
    const t = token[i]

    // "30 hari" -> pasangan angka + satuan.
    const berikut = token[i + 1]
    if (/^\d+$/.test(t) && berikut && SATUAN_HARI[berikut]) {
      hasil.push(`${snapHari(Number(t) * SATUAN_HARI[berikut])}h`)
      i++
      continue
    }
    if (ANGKA_KATA[t] && berikut && SATUAN_HARI[berikut]) {
      hasil.push(`${snapHari(ANGKA_KATA[t] * SATUAN_HARI[berikut])}h`)
      i++
      continue
    }

    // "30d" / "1bln" sebagai satu token.
    const gabung = normalizeDuration(t)
    if (gabung) {
      hasil.push(gabung)
      continue
    }

    if (KATA_BUANG.has(t)) continue
    hasil.push(t)
  }

  // Diurutkan supaya urutan kata tidak berpengaruh; di-dedupe supaya
  // "netflix netflix premium" tidak berbeda dari "netflix premium".
  return [...new Set(hasil)].sort().join(' ')
}

// Kunci untuk satu varian kita: nama produk + label varian digabung, karena
// itulah yang setara dengan satu nama produk di sisi supplier.
function variantKey(produkNama, varianLabel) {
  return buildKey(`${produkNama || ''} ${varianLabel || ''}`)
}

// Cari varian yang kuncinya persis sama. `variants` berisi objek
// { id, label, produk_nama }. Ambigu (lebih dari satu varian berbagi kunci)
// diperlakukan sebagai TIDAK cocok — menebak salah satunya persis kesalahan
// yang ingin dihindari.
function matchOffer(supplierNama, variants) {
  const kunci = buildKey(supplierNama)
  if (!kunci) return null

  const cocok = (variants || []).filter(
    (v) => v && variantKey(v.produk_nama, v.label) === kunci
  )
  if (cocok.length !== 1) return null
  return cocok[0]
}

module.exports = {
  KATA_BUANG,
  SATUAN_HARI,
  normalizeName,
  normalizeDuration,
  buildKey,
  variantKey,
  matchOffer,
}
