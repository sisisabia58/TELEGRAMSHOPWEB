// lib/suppliers/url-safety.js — validasi base_url supplier.
//
// Sync dan fulfillment mengirim api_key ke host ini. URL yang bisa diisi
// bebas adalah jalan keluar kredensial dan pintu masuk SSRF (localhost,
// metadata cloud, rentang privat). Validasi sinkron dipakai saat simpan;
// assertSafeOutbound (+ DNS) dipakai sebelum setiap request keluar.
const dns = require('node:dns').promises
const { BlockList, isIP } = require('node:net')

const BLOKIR = new BlockList()
// IPv4 loopback, tidak terisi, privat, link-local, CGNAT, multicast, reserved.
BLOKIR.addSubnet('0.0.0.0', 8, 'ipv4')
BLOKIR.addSubnet('10.0.0.0', 8, 'ipv4')
BLOKIR.addSubnet('127.0.0.0', 8, 'ipv4')
BLOKIR.addSubnet('169.254.0.0', 16, 'ipv4')
BLOKIR.addSubnet('172.16.0.0', 12, 'ipv4')
BLOKIR.addSubnet('192.168.0.0', 16, 'ipv4')
BLOKIR.addSubnet('100.64.0.0', 10, 'ipv4')
BLOKIR.addSubnet('224.0.0.0', 4, 'ipv4')
BLOKIR.addSubnet('240.0.0.0', 4, 'ipv4')
// IPv6 loopback, unspecified, ULA, link-local, multicast.
BLOKIR.addAddress('::1', 'ipv6')
BLOKIR.addAddress('::', 'ipv6')
BLOKIR.addSubnet('fc00::', 7, 'ipv6')
BLOKIR.addSubnet('fe80::', 10, 'ipv6')
BLOKIR.addSubnet('ff00::', 8, 'ipv6')

function stripKurung(host) {
  return String(host || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '')
}

function dariIpv4Mapped(alamat) {
  const a = stripKurung(alamat)
  const titik = a.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i)
  if (titik) return titik[1]
  const hex = a.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i)
  if (hex) {
    const hi = parseInt(hex[1], 16)
    const lo = parseInt(hex[2], 16)
    return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`
  }
  return null
}

function ipPrivat(alamat) {
  const mapped = dariIpv4Mapped(alamat)
  if (mapped) return ipPrivat(mapped)
  const a = stripKurung(alamat)
  const family = isIP(a)
  if (family === 4) return BLOKIR.check(a, 'ipv4')
  if (family === 6) return BLOKIR.check(a, 'ipv6')
  return true
}

function hostPrivat(host) {
  const h = stripKurung(host)
  if (!h) return true
  if (h === 'localhost' || h.endsWith('.localhost')) return true
  if (h === 'ip6-localhost' || h === 'ip6-loopback') return true
  if (h === 'host.docker.internal' || h === 'gateway.docker.internal') return true
  if (
    h.endsWith('.internal') ||
    h.endsWith('.local') ||
    h.endsWith('.lan') ||
    h.endsWith('.home') ||
    h.endsWith('.corp')
  ) return true
  if (h === 'metadata.google.internal' || h === 'metadata') return true
  if (isIP(h) || dariIpv4Mapped(h)) return ipPrivat(h)
  return false
}

function allowedHostsFor(adapter) {
  if (Array.isArray(adapter?.allowedHosts) && adapter.allowedHosts.length) {
    return adapter.allowedHosts.map((h) => stripKurung(h))
  }
  try {
    return [stripKurung(new URL(adapter.defaultBaseUrl).hostname)]
  } catch {
    return []
  }
}

function validateBaseUrl(adapter, baseUrl) {
  if (!adapter || !adapter.defaultBaseUrl) {
    return { ok: false, error: 'Adapter tidak dikenal' }
  }

  const nilai = String(baseUrl || '').trim()
  if (!nilai) return { ok: true, value: adapter.defaultBaseUrl.replace(/\/$/, '') }

  let url
  try {
    url = new URL(nilai)
  } catch {
    return { ok: false, error: 'Base URL tidak valid' }
  }

  if (url.protocol !== 'https:') {
    return { ok: false, error: 'Base URL harus memakai https' }
  }
  if (url.username || url.password) {
    return { ok: false, error: 'Base URL tidak boleh memuat userinfo' }
  }
  if (hostPrivat(url.hostname)) {
    return { ok: false, error: 'Base URL tidak boleh mengarah ke alamat internal' }
  }

  const host = stripKurung(url.hostname)
  const izin = allowedHostsFor(adapter)
  if (!izin.includes(host)) {
    return {
      ok: false,
      error: `Base URL untuk adapter "${adapter.key}" harus di host ${izin.join(', ')}`,
    }
  }

  const path = url.pathname.replace(/\/$/, '')
  return { ok: true, value: `${url.protocol}//${url.host}${path}` }
}

let lookupImpl = null

function __setLookup(fn) {
  lookupImpl = fn
}

async function defaultLookup(hostname, opts = {}) {
  if (typeof lookupImpl === 'function') {
    return lookupImpl(hostname, opts)
  }
  return dns.lookup(hostname, { all: true, verbatim: true, ...opts })
}

function daftarAlamat(hasil) {
  if (!hasil) return []
  const arr = Array.isArray(hasil) ? hasil : [hasil]
  return arr.map((item) => {
    if (typeof item === 'string') return { address: item, family: isIP(item) || 4 }
    return { address: item.address, family: item.family || isIP(item.address) || 4 }
  }).filter((item) => item.address)
}

async function assertSafeOutbound(adapter, baseUrl) {
  const cek = validateBaseUrl(adapter, baseUrl)
  if (!cek.ok) throw new Error(cek.error)

  const hostname = new URL(cek.value).hostname
  if (isIP(hostname) || dariIpv4Mapped(hostname)) {
    if (ipPrivat(hostname)) {
      throw new Error('Base URL me-resolve ke alamat internal (DNS rebinding ditolak)')
    }
    return cek.value
  }

  let hasil
  try {
    hasil = await defaultLookup(hostname, { all: true })
  } catch (e) {
    throw new Error(`Base URL gagal di-resolve: ${e.message}`)
  }

  const alamat = daftarAlamat(hasil)
  if (!alamat.length) throw new Error('Base URL tidak resolve')
  for (const a of alamat) {
    if (ipPrivat(a.address)) {
      throw new Error('Base URL me-resolve ke alamat internal (DNS rebinding ditolak)')
    }
  }
  return cek.value
}

function safeLookup(hostname, options, callback) {
  const cb = typeof options === 'function' ? options : callback
  Promise.resolve()
    .then(() => defaultLookup(hostname, { all: true }))
    .then((hasil) => {
      const alamat = daftarAlamat(hasil)
      if (!alamat.length) throw new Error('Base URL tidak resolve')
      for (const a of alamat) {
        if (ipPrivat(a.address)) {
          throw new Error('Base URL me-resolve ke alamat internal (DNS rebinding ditolak)')
        }
      }
      cb(null, alamat[0].address, alamat[0].family)
    })
    .catch(cb)
}

module.exports = {
  hostPrivat,
  ipPrivat,
  validateBaseUrl,
  assertSafeOutbound,
  safeLookup,
  allowedHostsFor,
  __setLookup,
}
