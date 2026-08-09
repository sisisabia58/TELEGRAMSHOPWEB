const test = require('node:test')
const assert = require('node:assert')

const { formatrupiah, formatWIB, formatWIBDetail, formatTanggal, namaBulan } = require('../lib/format')

// Helper ini dipakai bot DAN dashboard. Dulu formatrupiah didefinisikan dua kali
// dengan isi identik; test ini menjaga perilakunya tetap sama setelah disatukan.

// Intl menyisipkan non-breaking space (U+00A0) setelah "Rp". Karakter itu tidak
// terlihat di editor, jadi normalkan dulu daripada menaruhnya di source.
const spasiNormal = (s) => s.replace(/ /g, ' ')

test('formatrupiah memakai format Rupiah tanpa desimal', () => {
  assert.strictEqual(spasiNormal(formatrupiah(25000)), 'Rp 25.000')
  assert.strictEqual(spasiNormal(formatrupiah(0)), 'Rp 0')
  assert.strictEqual(spasiNormal(formatrupiah(1500500)), 'Rp 1.500.500')
})

test('formatrupiah membulatkan desimal', () => {
  // maximumFractionDigits: 0 — penting supaya harga tidak pernah tampil "Rp 1.000,5"
  assert.ok(!formatrupiah(1000.5).includes(','))
})

test('namaBulan punya 12 bulan berurutan', () => {
  assert.strictEqual(namaBulan.length, 12)
  assert.strictEqual(namaBulan[0], 'Januari')
  assert.strictEqual(namaBulan[11], 'Desember')
})

test('formatWIBDetail menyertakan detik, formatWIB tidak', () => {
  const iso = '2026-08-09T07:30:45.000Z'

  // Locale id-ID memakai TITIK sebagai pemisah jam, bukan titik dua:
  // "Minggu, 09 Agustus 2026 14.30" dan "... 14.30.45".
  assert.match(formatWIB(iso), /\d{2}\.\d{2}$/)
  assert.match(formatWIBDetail(iso), /\d{2}\.\d{2}\.\d{2}$/)
})

test('formatWIB memakai nama hari & bulan bahasa Indonesia', () => {
  const hasil = formatWIB('2026-08-09T07:30:45.000Z')
  assert.ok(hasil.startsWith('Minggu'), `dapat: ${hasil}`)
  assert.ok(hasil.includes('Agustus'), `dapat: ${hasil}`)
})

test('formatWIB memakai jam 24 (tanpa AM/PM)', () => {
  const hasil = formatWIB('2026-08-09T15:00:00.000Z')
  assert.ok(!/AM|PM/i.test(hasil), `dapat: ${hasil}`)
})

test('formatTanggal memakai zona Asia/Jakarta', () => {
  // 2026-08-09T17:00:00Z = 10 Agustus 2026 00:00 WIB (UTC+7).
  // Kalau zona waktu salah, tanggalnya akan tertulis 09 Agustus.
  assert.strictEqual(formatTanggal('2026-08-09T17:00:00.000Z'), '10 Agustus 2026, 00:00')
})
