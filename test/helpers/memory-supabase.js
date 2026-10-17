'use strict'

function clone(v) {
  if (v == null || typeof v !== 'object') return v
  return JSON.parse(JSON.stringify(v))
}

function compare(rowVal, op, val) {
  if (op === 'eq') return rowVal === val || String(rowVal) === String(val)
  if (op === 'lt') return rowVal < val
  if (op === 'gt') return rowVal > val
  if (op === 'neq') return rowVal !== val
  return false
}

function matches(row, state) {
  for (const f of state.filters) {
    if (!compare(row[f.col], f.op, f.val)) return false
  }
  for (const f of state.inFilters) {
    const vals = f.vals || []
    if (!vals.some((v) => v === row[f.col] || String(v) === String(row[f.col]))) return false
  }
  for (const f of state.notFilters) {
    if (f.op === 'is' && f.val == null) {
      if (row[f.col] == null) return false
    } else if (compare(row[f.col], f.op === 'is' ? 'eq' : f.op, f.val)) {
      return false
    }
  }
  return true
}

function upsertKey(row, onConflict) {
  if (!onConflict) return row.id != null ? 'id' : null
  return onConflict.split(',')[0].trim()
}

function createMemorySupabase(seed = {}) {
  const db = {
    User: [],
    Trx: [],
    Stok: [],
    Produk: [],
    Varian: [],
    BotCopy: [],
    BotFlow: [],
    BotFlowNode: [],
    BotSession: [],
    NotificationSettings: [],
    Deposit: [],
    Payment: [],
    Voucher: [],
    Supplier: [],
    SupplierProduct: [],
    SupplierOrder: [],
    HargaTier: [],
    ...clone(seed),
  }

  function rowsOf(table) {
    if (!Object.prototype.hasOwnProperty.call(db, table)) db[table] = []
    return db[table]
  }

  function executeSelect(state) {
    let rows = rowsOf(state.table).filter((r) => matches(r, state)).map(clone)
    if (state.order) {
      const col = state.order.col
      const dir = state.order.ascending === false ? -1 : 1
      rows.sort((a, b) => {
        if (a[col] < b[col]) return -1 * dir
        if (a[col] > b[col]) return 1 * dir
        return 0
      })
    }
    if (state.range) {
      rows = rows.slice(state.range.from, state.range.to + 1)
    }
    if (state.limit != null) rows = rows.slice(0, state.limit)
    const count = rows.length
    if (state.head) {
      return { data: null, error: null, count }
    }
    if (state.single || state.maybeSingle) {
      if (rows.length === 0) {
        return {
          data: null,
          error: state.single ? { code: 'PGRST116', message: 'not found' } : null,
          count: 0,
        }
      }
      return { data: rows[0], error: null, count: 1 }
    }
    return { data: rows, error: null, count }
  }

  function from(table) {
    const state = {
      table,
      filters: [],
      inFilters: [],
      notFilters: [],
      order: null,
      limit: null,
      range: null,
      head: false,
      countExact: false,
      maybeSingle: false,
      single: false,
      updatePatch: null,
    }

    const run = () => {
      if (state.updatePatch) {
        const hits = rowsOf(state.table).filter((r) => matches(r, state))
        for (const row of hits) Object.assign(row, clone(state.updatePatch))
        return { data: hits.map(clone), error: null, count: hits.length }
      }
      return executeSelect(state)
    }

    const b = {
      select(_cols, opts) {
        if (opts && opts.head) state.head = true
        if (opts && opts.count) state.countExact = true
        return b
      },
      eq(col, val) { state.filters.push({ col, op: 'eq', val }); return b },
      lt(col, val) { state.filters.push({ col, op: 'lt', val }); return b },
      gt(col, val) { state.filters.push({ col, op: 'gt', val }); return b },
      in(col, vals) { state.inFilters.push({ col, vals }); return b },
      not(col, op, val) { state.notFilters.push({ col, op, val }); return b },
      order(col, opts = {}) { state.order = { col, ...opts }; return b },
      limit(n) { state.limit = n; return b },
      range(fromIdx, toIdx) { state.range = { from: fromIdx, to: toIdx }; return b },
      maybeSingle() {
        state.maybeSingle = true
        return Promise.resolve(run())
      },
      single() {
        state.single = true
        return Promise.resolve(run())
      },
      insert(rows) {
        const list = Array.isArray(rows) ? rows : [rows]
        for (const row of list) rowsOf(table).push(clone(row))
        return Promise.resolve({ data: list.map(clone), error: null, count: list.length })
      },
      upsert(row, opts = {}) {
        const list = Array.isArray(row) ? row : [row]
        const key = upsertKey(list[0] || {}, opts.onConflict)
        for (const item of list) {
          const copy = clone(item)
          if (key && copy[key] != null) {
            const idx = rowsOf(table).findIndex((r) => String(r[key]) === String(copy[key]))
            if (idx >= 0) rowsOf(table)[idx] = { ...rowsOf(table)[idx], ...copy }
            else rowsOf(table).push(copy)
          } else {
            rowsOf(table).push(copy)
          }
        }
        return Promise.resolve({ data: list.map(clone), error: null })
      },
      update(patch) {
        state.updatePatch = patch
        return b
      },
      then(res, rej) {
        return Promise.resolve(run()).then(res, rej)
      },
    }
    return b
  }

  return { from, _db: db }
}

function defaultBotFixtures() {
  return {
    User: [{ id: 4242, jumlahtransaksi: 0, pengeluaran: 0, saldo: 12500 }],
    Trx: [],
    Produk: [{
      id: 'prod-1',
      nama: 'Netflix',
      slug: 'netflix',
      kode: 'nflx',
      kategori: 'streaming',
      deskripsi: 'Akun Netflix',
      snk: 'S&K',
      urutan: 1,
      is_active: true,
      terjual: 3,
      harga: 50000,
    }],
    Varian: [{
      id: 'var-1',
      produk_id: 'prod-1',
      label: '1 bulan',
      kode: 'nflx',
      harga: 50000,
      urutan: 1,
      is_active: true,
      terjual: 3,
      sumber: 'sendiri',
    }],
    Stok: [
      { id: 'stok-1', varian_id: 'var-1', varian_kode: 'nflx', data: 'acc-1', status: 'tersedia' },
      { id: 'stok-2', varian_id: 'var-1', varian_kode: 'nflx', data: 'acc-2', status: 'tersedia' },
    ],
    BotCopy: [
      { key: 'screen.welcome', body: 'ENTRY {{first_name}} bot={{nama_bot}} users={{user_count}} sold={{stok_terjual}} stock={{stok_tersedia}} saldo={{saldo}}' },
      { key: 'screen.info', body: 'INFO {{first_name}}' },
      { key: 'screen.photo', body: 'PHOTO_SCREEN' },
      { key: 'screen.doc', body: 'DOC_SCREEN' },
    ],
    BotFlow: [{ id: 'flow-1', name: 'main', is_active: true, entry_key: 'welcome' }],
    BotFlowNode: [
      {
        flow_id: 'flow-1',
        key: 'welcome',
        kind: 'screen',
        screen_key: 'screen.welcome',
        action: null,
        media_url: null,
        media_type: null,
        buttons: [
          [{ label: 'Info', go: 'info' }],
          [{ label: 'Raw', callback: 'raw_ping' }],
          [{ label: 'Docs', url: 'https://example.com/docs' }],
          [{ label: 'Channel', url_from: 'channel_store' }],
          [{ label: 'Foto', go: 'photo_screen' }],
          [{ label: 'File', go: 'doc_screen' }],
          [{ label: 'Produk', go: 'product_list' }],
        ],
      },
      {
        flow_id: 'flow-1',
        key: 'info',
        kind: 'screen',
        screen_key: 'screen.info',
        action: null,
        media_url: null,
        media_type: null,
        buttons: [[{ label: 'Back', go: 'welcome' }]],
      },
      {
        flow_id: 'flow-1',
        key: 'photo_screen',
        kind: 'screen',
        screen_key: 'screen.photo',
        action: null,
        media_url: 'https://cdn.example/banner.jpg',
        media_type: 'photo',
        buttons: [[{ label: 'Back', go: 'welcome' }]],
      },
      {
        flow_id: 'flow-1',
        key: 'doc_screen',
        kind: 'screen',
        screen_key: 'screen.doc',
        action: null,
        media_url: 'https://cdn.example/file.pdf',
        media_type: 'document',
        buttons: [[{ label: 'Back', go: 'welcome' }]],
      },
      {
        flow_id: 'flow-1',
        key: 'product_list',
        kind: 'action',
        screen_key: null,
        action: 'product_list',
        media_url: null,
        media_type: null,
        buttons: [],
      },
    ],
    NotificationSettings: [
      { setting_key: 'cache_version', setting_value: { value: 1 } },
      { setting_key: 'channel_store', setting_value: { value: 'https://t.me/testchannel' } },
      { setting_key: 'cs', setting_value: { value: 'https://t.me/testcs' } },
      { setting_key: 'flow_engine_enabled', setting_value: { value: false } },
    ],
    BotSession: [],
    Supplier: [],
    SupplierProduct: [],
  }
}

module.exports = { createMemorySupabase, defaultBotFixtures }
