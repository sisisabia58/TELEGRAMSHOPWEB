const test = require('node:test')
const assert = require('node:assert')

// Modul murni — tidak perlu stub apa pun.
const match = require('../lib/supplier-match')

test('normalizeName membuang emoji, tanda baca, dan spasi berlebih', () => {
  assert.equal(match.normalizeName('🔥 Netflix  Premium!! '), 'netflix premium')
  assert.equal(match.normalizeName('Spotify — 1 Bulan'), 'spotify 1 bulan')
  assert.equal(match.normalizeName('CANVA_PRO/1TAHUN'), 'canva pro 1tahun')
})

test('normalizeName aman untuk masukan kosong', () => {
  assert.equal(match.normalizeName(null), '')
  assert.equal(match.normalizeName(undefined), '')
  assert.equal(match.normalizeName(''), '')
  assert.equal(match.normalizeName('   '), '')
  assert.equal(match.normalizeName('🔥🔥🔥'), '')
})

test('normalizeDuration melipat satuan Indonesia dan Inggris ke hari', () => {
  const tigaPuluh = ['30 hari', '30 days', '1 bulan', '1 month', '30d', '1bln', '1mo']
  for (const teks of tigaPuluh) {
    assert.equal(match.normalizeDuration(teks), '30h', `${teks} harus 30h`)
  }
})

test('normalizeDuration melipat tahun dan minggu', () => {
  assert.equal(match.normalizeDuration('1 tahun'), '365h')
  assert.equal(match.normalizeDuration('1 year'), '365h')
  assert.equal(match.normalizeDuration('1 minggu'), '7h')
  assert.equal(match.normalizeDuration('2 weeks'), '14h')
})

test('normalizeDuration menyamakan penulisan durasi yang praktis identik', () => {
  // "12 bulan" (12x30 = 360) harus jatuh ke ember yang sama dengan "1 tahun",
  // kalau tidak barang identik jadi dua produk terpisah di bot.
  assert.equal(match.normalizeDuration('12 bulan'), match.normalizeDuration('1 tahun'))
  assert.equal(match.normalizeDuration('12 months'), match.normalizeDuration('1 year'))
  assert.equal(match.normalizeDuration('31 hari'), match.normalizeDuration('1 bulan'))
  assert.equal(match.normalizeDuration('6 bulan'), match.normalizeDuration('180 hari'))
})

test('snapping durasi tidak menggabungkan paket yang memang beda', () => {
  assert.notEqual(match.normalizeDuration('30 hari'), match.normalizeDuration('60 hari'))
  assert.notEqual(match.normalizeDuration('90 hari'), match.normalizeDuration('180 hari'))
  assert.notEqual(match.normalizeDuration('180 hari'), match.normalizeDuration('1 tahun'))
  assert.notEqual(match.normalizeDuration('45 hari'), match.normalizeDuration('30 hari'))
})

test('normalizeDuration mengembalikan null untuk yang bukan durasi', () => {
  assert.equal(match.normalizeDuration('netflix'), null)
  assert.equal(match.normalizeDuration('premium akun'), null)
  assert.equal(match.normalizeDuration(''), null)
  assert.equal(match.normalizeDuration('0 hari'), null)
})

test('buildKey menyamakan urutan kata dan satuan durasi', () => {
  const a = match.buildKey('Netflix Premium 1 Bulan')
  const b = match.buildKey('premium netflix 30 hari')
  const c = match.buildKey('NETFLIX  premium  30d')
  assert.equal(a, b)
  assert.equal(b, c)
})

test('buildKey membuang kata basa-basi penjual', () => {
  assert.equal(
    match.buildKey('Akun Netflix Premium 1 Bulan Garansi'),
    match.buildKey('Netflix Premium 30 Hari')
  )
  assert.equal(
    match.buildKey('🔥 PROMO Spotify Premium 1 Month READY'),
    match.buildKey('Spotify Premium 30 Hari')
  )
})

test('buildKey TIDAK menyamakan produk yang memang berbeda', () => {
  assert.notEqual(match.buildKey('Netflix Premium 30 Hari'), match.buildKey('Netflix Premium 60 Hari'))
  assert.notEqual(match.buildKey('Netflix Premium 30 Hari'), match.buildKey('Spotify Premium 30 Hari'))
  assert.notEqual(match.buildKey('Netflix Premium 30 Hari'), match.buildKey('Netflix Basic 30 Hari'))
  assert.notEqual(match.buildKey('Canva Pro 1 Bulan'), match.buildKey('Canva Pro 1 Tahun'))
})

const VARIANTS = [
  { id: 'v1', label: '30 Hari', produk_nama: 'Netflix Premium' },
  { id: 'v2', label: '60 Hari', produk_nama: 'Netflix Premium' },
  { id: 'v3', label: '1 Bulan', produk_nama: 'Spotify Premium' },
]

test('matchOffer mencocokkan nama supplier ke varian yang benar', () => {
  assert.equal(match.matchOffer('Netflix Premium 1 Month', VARIANTS).id, 'v1')
  assert.equal(match.matchOffer('🔥 Akun Netflix Premium 30 Hari Garansi', VARIANTS).id, 'v1')
  assert.equal(match.matchOffer('netflix premium 2 bulan', VARIANTS).id, 'v2')
  assert.equal(match.matchOffer('Spotify Premium 30 days', VARIANTS).id, 'v3')
})

test('matchOffer mengembalikan null kalau tidak ada yang persis', () => {
  assert.equal(match.matchOffer('Netflix Premium 90 Hari', VARIANTS), null)
  assert.equal(match.matchOffer('Disney Plus 30 Hari', VARIANTS), null)
  assert.equal(match.matchOffer('Netflix', VARIANTS), null)
  assert.equal(match.matchOffer('', VARIANTS), null)
  assert.equal(match.matchOffer(null, VARIANTS), null)
})

test('matchOffer menolak mencocokkan saat ambigu', () => {
  // Dua varian berbagi kunci yang sama — menebak salah satunya persis
  // kesalahan yang ingin dihindari, jadi harus null.
  const kembar = [
    { id: 'a', label: '30 Hari', produk_nama: 'Netflix' },
    { id: 'b', label: '1 Bulan', produk_nama: 'Netflix' },
  ]
  assert.equal(match.matchOffer('Netflix 30 hari', kembar), null)
})

test('matchOffer aman untuk daftar varian kosong atau rusak', () => {
  assert.equal(match.matchOffer('Netflix 30 Hari', []), null)
  assert.equal(match.matchOffer('Netflix 30 Hari', null), null)
  assert.equal(match.matchOffer('Netflix 30 Hari', [null, undefined]), null)
})

test('variantKey menggabungkan nama produk dan label varian', () => {
  assert.equal(
    match.variantKey('Netflix Premium', '30 Hari'),
    match.buildKey('Netflix Premium 30 Hari')
  )
})
