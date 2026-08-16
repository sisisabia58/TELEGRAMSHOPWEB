const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const ejs = require('ejs')

const viewRoot = path.join(__dirname, '..', 'views')
const marker = '<a href="/sentinel-action" class="btn-top">Sentinel Action</a>'

const baseLocals = {
  title: 'Chrome locals test',
  namaBot: 'Test Bot',
  username: 'tester',
  req: { session: { role: 'admin' } },
  topbarExtra: marker,
  formatrupiah: (value) => `Rp${value}`,
  formatTanggal: (value) => new Date(value).toISOString(),
}

const SETTINGS_RESELLER = {
  marginPersen: 10,
  rounding: 500,
  fxMode: 'auto',
  fxRate: 16500,
  fxBufferPersen: 2,
  fxUpdatedAt: null,
  syncIntervalMenit: 5,
  kategoriDefault: 'reseller',
  walletMinUsd: 5,
}

const cases = [
  {
    view: 'voucher.ejs',
    locals: {
      currentPage: 'voucher',
      pageTitle: 'Voucher Test',
      vouchers: [],
    },
  },
  {
    view: 'produk-form.ejs',
    locals: {
      currentPage: 'produk',
      pageTitle: 'Produk Test',
      produk: null,
      action: 'tambah',
      error: null,
    },
  },
  {
    view: 'user-detail.ejs',
    locals: {
      currentPage: 'user',
      pageTitle: 'User Test',
      user: {
        id: 1,
        saldo: 0,
        pengeluaran: 0,
        jumlahtransaksi: 0,
        created_at: '2026-01-01T00:00:00.000Z',
      },
      query: {},
      transactions: [],
      deposits: [],
      totalDeposit: 0,
      totalPengeluaran: 0,
    },
  },
  // Fase 13 — halaman sumber stok ketiga, di grup nav Catalog.
  {
    view: 'supplier.ejs',
    locals: {
      currentPage: 'supplier',
      pageTitle: 'Supplier Test',
      suppliers: [],
      statistik: {},
      settings: SETTINGS_RESELLER,
      adapters: [{ key: 'bitestore', label: 'Bite Store', defaultBaseUrl: 'https://contoh.test' }],
      success: null,
      error: null,
    },
  },
  {
    view: 'supplier-form.ejs',
    locals: {
      currentPage: 'supplier',
      pageTitle: 'Tambah Supplier',
      supplier: null,
      adapters: [{ key: 'bitestore', label: 'Bite Store', defaultBaseUrl: 'https://contoh.test' }],
      error: null,
    },
  },
  {
    view: 'supplier-produk.ejs',
    locals: {
      currentPage: 'supplier',
      pageTitle: 'Katalog Supplier',
      supplier: { id: 's1', nama: 'Seller A' },
      produk: [],
      varianList: [],
      filter: 'all',
      settings: SETTINGS_RESELLER,
      success: null,
      error: null,
    },
  },
  {
    view: 'supplier-pengaturan.ejs',
    locals: {
      currentPage: 'supplier',
      pageTitle: 'Pengaturan Reseller',
      settings: SETTINGS_RESELLER,
      contoh: [{ usd: 1, idr: 18150 }],
      success: null,
      error: null,
    },
  },
]

test('authenticated views render topbarExtra from EJS locals', async () => {
  for (const testCase of cases) {
    const html = await ejs.renderFile(
      path.join(viewRoot, testCase.view),
      { ...baseLocals, ...testCase.locals },
      { views: [viewRoot] }
    )

    assert.match(html, /href="\/sentinel-action"/, `${testCase.view} should render topbarExtra`)
  }
})
