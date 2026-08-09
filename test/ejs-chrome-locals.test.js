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
