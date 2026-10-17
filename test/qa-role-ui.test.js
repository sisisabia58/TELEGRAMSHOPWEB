const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const ejs = require('ejs')

const viewRoot = path.join(__dirname, '..', 'views')

async function render(view, locals) {
  return ejs.renderFile(path.join(viewRoot, view), locals, { views: [viewRoot] })
}

test('admin user form includes a qa role option and short description', async () => {
  const html = await render('admin-user-form.ejs', {
    title: 'Tambah Admin',
    namaBot: 'Test Bot',
    username: 'tester',
    req: { session: { role: 'admin' } },
    admin: null,
    action: 'tambah',
    error: null,
    currentPage: 'admin-users',
    pageTitle: 'Tambah Admin',
    topbarExtra: '',
  })
  assert.match(html, /<option value="qa"/)
  assert.match(html, /QA/i)
  assert.match(html, /Flow Builder/i)
})

test('qa sidebar shows only Dashboard home and Flow Builder', async () => {
  const html = await render('partials/sidebar.ejs', {
    currentPage: 'dashboard',
    namaBot: 'Test Bot',
    req: { session: { role: 'qa' } },
  })
  assert.match(html, /href="\/"/)
  assert.match(html, /href="\/settings\/bot-flow"/)
  assert.equal(html.includes('href="/produk"'), false)
  assert.equal(html.includes('href="/stok"'), false)
  assert.equal(html.includes('href="/pricing"'), false)
  assert.equal(html.includes('href="/deposit"'), false)
  assert.equal(html.includes('href="/user"'), false)
  assert.equal(html.includes('href="/voucher"'), false)
  assert.equal(html.includes('href="/supplier"'), false)
  assert.equal(html.includes('href="/settings/general"'), false)
  assert.equal(html.includes('href="/settings/bot-copy"'), false)
  assert.equal(html.includes('href="/communication/broadcast"'), false)
  assert.equal(html.includes('href="/admin/users"'), false)
})

test('staff sidebar still shows operational nav (unchanged from other roles)', async () => {
  const html = await render('partials/sidebar.ejs', {
    currentPage: 'produk',
    namaBot: 'Test Bot',
    req: { session: { role: 'staff' } },
  })
  assert.match(html, /href="\/produk"/)
  assert.match(html, /href="\/settings\/bot-flow"/)
  assert.equal(html.includes('href="/admin/users"'), false)
})
