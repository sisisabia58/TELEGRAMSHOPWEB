const test = require('node:test')
const assert = require('node:assert')

const registry = require('../lib/suppliers')

const HOST_BAWAAN = new URL(registry.getAdapter('bitestore').defaultBaseUrl).hostname
const URL_BAWAAN = `https://${HOST_BAWAAN}`

test.before(() => {
  registry.__setLookup(async () => [{ address: '203.0.113.10', family: 4 }])
})

test.after(() => {
  registry.__setLookup(null)
})

// base_url supplier bukan sekadar preferensi tampilan: sync dan fulfillment
// mengirim api_key supplier ke host tujuan. URL yang bisa diisi bebas berarti
// siapa pun yang bisa menyunting supplier di dashboard dapat memanen kredensial
// yang tersimpan, atau memaksa server menembak alamat internal (SSRF).

test('menerima host bawaan adapter', () => {
  const r = registry.validateBaseUrl('bitestore', URL_BAWAAN)
  assert.equal(r.ok, true)
})

test('kosong berarti pakai bawaan adapter', () => {
  const r = registry.validateBaseUrl('bitestore', '')
  assert.equal(r.ok, true)
  assert.equal(r.value, registry.getAdapter('bitestore').defaultBaseUrl)
})

test('MENOLAK subdomain — allowlist host harus persis, bukan akhiran', () => {
  // Subdomain dari host bawaan bukan milik kita. Mengizinkannya membuka
  // jalur untuk mengirim api_key ke host yang dikendalikan penyerang.
  assert.equal(registry.validateBaseUrl('bitestore', `https://api.${HOST_BAWAAN}`).ok, false)
  assert.equal(registry.validateBaseUrl('bitestore', `https://evil.${HOST_BAWAAN}`).ok, false)
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
    'https://host.docker.internal',
    'https://[::1]',
    'https://[fe80::1]',
    'https://[fc00::1]',
    'https://[fd12:3456:789a::1]',
    'https://100.64.0.1',
  ]) {
    assert.equal(registry.validateBaseUrl('bitestore', url).ok, false, `${url} harus ditolak`)
  }
})

test('MENOLAK skema selain https', () => {
  assert.equal(registry.validateBaseUrl('bitestore', `http://${HOST_BAWAAN}`).ok, false)
  assert.equal(registry.validateBaseUrl('bitestore', 'file:///etc/passwd').ok, false)
  assert.equal(registry.validateBaseUrl('bitestore', 'gopher://x').ok, false)
})

test('MENOLAK userinfo di URL (redirect / parser tricks)', () => {
  assert.equal(registry.validateBaseUrl('bitestore', `https://user:pass@${HOST_BAWAAN}`).ok, false)
  assert.equal(registry.validateBaseUrl('bitestore', `https://${HOST_BAWAAN}@127.0.0.1/`).ok, false)
})

test('MENOLAK URL yang tidak bisa diurai dan adapter tak dikenal', () => {
  assert.equal(registry.validateBaseUrl('bitestore', 'bukan url').ok, false)
  assert.equal(registry.validateBaseUrl('entah', URL_BAWAAN).ok, false)
})

test('hostPrivat mengenali rentang privat IPv4', () => {
  for (const h of [
    '10.0.0.1', '127.0.0.1', '192.168.0.1', '172.31.255.255',
    '169.254.1.1', '0.0.0.0', '224.0.0.1', '100.64.0.1', '100.127.255.255',
  ]) {
    assert.equal(registry.hostPrivat(h), true, `${h} harus dianggap privat`)
  }
  for (const h of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '93.184.216.34']) {
    assert.equal(registry.hostPrivat(h), false, `${h} harus dianggap publik`)
  }
})

test('hostPrivat mengenali loopback, link-local, dan ULA IPv6', () => {
  for (const h of [
    '::1', '[::1]', 'fe80::1', 'fe80::abcd:1',
    'fc00::1', 'fd00::1', '::', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:169.254.169.254',
  ]) {
    assert.equal(registry.hostPrivat(h), true, `${h} harus dianggap privat`)
  }
  for (const h of ['2001:4860:4860::8888', '2606:4700:4700::1111']) {
    assert.equal(registry.hostPrivat(h), false, `${h} harus dianggap publik`)
  }
})

test('validateBaseUrl membuang garis miring di akhir', () => {
  const r = registry.validateBaseUrl('bitestore', `${URL_BAWAAN}/`)
  assert.equal(r.ok, true)
  assert.ok(!r.value.endsWith('/'), 'tidak boleh diakhiri garis miring')
})

test('assertSafeOutbound menerima host allowlist yang resolve ke IP publik', async () => {
  const nilai = await registry.assertSafeOutbound('bitestore', URL_BAWAAN)
  assert.equal(nilai, registry.getAdapter('bitestore').defaultBaseUrl.replace(/\/$/, ''))
})

test('assertSafeOutbound MENOLAK DNS rebinding ke IP privat', async () => {
  registry.__setLookup(async () => [{ address: '127.0.0.1', family: 4 }])
  await assert.rejects(
    () => registry.assertSafeOutbound('bitestore', URL_BAWAAN),
    /internal|privat|rebind/i
  )

  registry.__setLookup(async () => [
    { address: '203.0.113.10', family: 4 },
    { address: '169.254.169.254', family: 4 },
  ])
  await assert.rejects(
    () => registry.assertSafeOutbound('bitestore', URL_BAWAAN),
    /internal|privat|rebind/i
  )

  registry.__setLookup(async () => [{ address: '::1', family: 6 }])
  await assert.rejects(
    () => registry.assertSafeOutbound('bitestore', URL_BAWAAN),
    /internal|privat|rebind/i
  )

  registry.__setLookup(async () => [{ address: '203.0.113.10', family: 4 }])
})

test('assertSafeOutbound MENOLAK host di luar allowlist sebelum DNS', async () => {
  let lookupDipanggil = false
  registry.__setLookup(async () => {
    lookupDipanggil = true
    return [{ address: '203.0.113.10', family: 4 }]
  })
  await assert.rejects(
    () => registry.assertSafeOutbound('bitestore', 'https://penyerang.example.com'),
    /host/i
  )
  assert.equal(lookupDipanggil, false, 'jangan resolve host yang sudah ditolak allowlist')
  registry.__setLookup(async () => [{ address: '203.0.113.10', family: 4 }])
})

test('assertSafeOutbound MENOLAK kalau DNS gagal', async () => {
  registry.__setLookup(async () => {
    const e = new Error('ENOTFOUND')
    e.code = 'ENOTFOUND'
    throw e
  })
  await assert.rejects(() => registry.assertSafeOutbound('bitestore', URL_BAWAAN))
  registry.__setLookup(async () => [{ address: '203.0.113.10', family: 4 }])
})

test('edit supplier dengan id yang tidak ketemu dianggap tidak ditemukan', () => {
  assert.equal(registry.updateTidakMenemukanBaris(null), true)
  assert.equal(registry.updateTidakMenemukanBaris([]), true)
  assert.equal(registry.updateTidakMenemukanBaris([{ id: 'ada' }]), false)
})

test('tanpaApiKey menghapus api_key dari objek yang dikirim ke frontend', () => {
  const bersih = registry.tanpaApiKey({
    id: 's1',
    nama: 'Bite',
    api_key: 'bsk_rahasia_jangan_bocor',
    base_url: URL_BAWAAN,
  })
  assert.equal('api_key' in bersih, false)
  assert.equal(bersih.nama, 'Bite')
  assert.equal(bersih.id, 's1')
  assert.ok(!registry.SUPPLIER_PUBLIC_COLUMNS.split(',').map((s) => s.trim()).includes('api_key'))
})
