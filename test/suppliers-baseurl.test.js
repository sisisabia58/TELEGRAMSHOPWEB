const test = require('node:test')
const assert = require('node:assert')

const registry = require('../lib/suppliers')

// base_url supplier bukan sekadar preferensi tampilan: sync dan fulfillment
// mengirim api_key supplier ke host tujuan. URL yang bisa diisi bebas berarti
// siapa pun yang bisa menyunting supplier di dashboard dapat memanen kredensial
// yang tersimpan, atau memaksa server menembak alamat internal (SSRF).

test('menerima host bawaan adapter', () => {
  const r = registry.validateBaseUrl('bitestore', 'https://bite-store-bot-production.up.railway.app')
  assert.equal(r.ok, true)
})

test('kosong berarti pakai bawaan adapter', () => {
  const r = registry.validateBaseUrl('bitestore', '')
  assert.equal(r.ok, true)
  assert.equal(r.value, registry.getAdapter('bitestore').defaultBaseUrl)
})

test('menerima subdomain dari host bawaan', () => {
  const host = new URL(registry.getAdapter('bitestore').defaultBaseUrl).hostname
  assert.equal(registry.validateBaseUrl('bitestore', `https://api.${host}`).ok, true)
})

test('MENOLAK host lain — inilah jalur pencurian api_key', () => {
  for (const url of [
    'https://penyerang.example.com',
    'https://bite-store-bot-production.up.railway.app.penyerang.com',
    'https://evil.io/v1',
  ]) {
    const r = registry.validateBaseUrl('bitestore', url)
    assert.equal(r.ok, false, `${url} harus ditolak`)
  }
})

test('MENOLAK alamat internal dan metadata (SSRF)', () => {
  for (const url of [
    'https://localhost',
    'https://127.0.0.1',
    'https://10.1.2.3',
    'https://192.168.1.1',
    'https://172.16.0.1',
    'https://169.254.169.254',
    'https://metadata.google.internal',
    'https://db.internal',
    'https://sesuatu.local',
  ]) {
    assert.equal(registry.validateBaseUrl('bitestore', url).ok, false, `${url} harus ditolak`)
  }
})

test('MENOLAK skema selain https', () => {
  assert.equal(registry.validateBaseUrl('bitestore', 'http://bite-store-bot-production.up.railway.app').ok, false)
  assert.equal(registry.validateBaseUrl('bitestore', 'file:///etc/passwd').ok, false)
  assert.equal(registry.validateBaseUrl('bitestore', 'gopher://x').ok, false)
})

test('MENOLAK URL yang tidak bisa diurai dan adapter tak dikenal', () => {
  assert.equal(registry.validateBaseUrl('bitestore', 'bukan url').ok, false)
  assert.equal(registry.validateBaseUrl('entah', 'https://bite-store-bot-production.up.railway.app').ok, false)
})

test('hostPrivat mengenali rentang privat IPv4', () => {
  for (const h of ['10.0.0.1', '127.0.0.1', '192.168.0.1', '172.31.255.255', '169.254.1.1', '0.0.0.0', '224.0.0.1']) {
    assert.equal(registry.hostPrivat(h), true, `${h} harus dianggap privat`)
  }
  for (const h of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '93.184.216.34']) {
    assert.equal(registry.hostPrivat(h), false, `${h} harus dianggap publik`)
  }
})

test('validateBaseUrl membuang garis miring di akhir', () => {
  const r = registry.validateBaseUrl('bitestore', 'https://bite-store-bot-production.up.railway.app/')
  assert.equal(r.ok, true)
  assert.ok(!r.value.endsWith('/'), 'tidak boleh diakhiri garis miring')
})
