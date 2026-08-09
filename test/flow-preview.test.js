const test = require('node:test')
const assert = require('node:assert')

const jalurClient = require.resolve('../lib/supabase.js')
const jalurPreview = require.resolve('../lib/flow-preview.js')
const jalurCopy = require.resolve('../lib/copy.js')

function muatPreview() {
  delete require.cache[jalurPreview]
  delete require.cache[jalurCopy]
  require.cache[jalurClient] = {
    id: jalurClient,
    filename: jalurClient,
    loaded: true,
    exports: {
      from() {
        const b = {
          select() { return b },
          then(res, rej) {
            return Promise.resolve({ data: [], error: null }).then(res, rej)
          },
        }
        return b
      },
    },
  }
  return require(jalurPreview)
}

test.after(() => {
  delete require.cache[jalurClient]
  delete require.cache[jalurPreview]
  delete require.cache[jalurCopy]
})

const {
  resolveButtons,
  buildProductListView,
  buildProductCardView,
  buildKategoriMenuView,
  buttonText,
} = muatPreview()

test('resolveButtons expands label_key via copy map / defaults', () => {
  const buttons = [[{ label_key: 'msg.menu_daftar_produk', go: 'product_list' }]]
  const resolved = resolveButtons(buttons, {})
  assert.equal(resolved[0][0].text, '‹📦› Daftar Produk')
  assert.equal(resolved[0][0].go, 'product_list')
})

test('resolveButtons prefers BotCopy override for label_key', () => {
  const buttons = [[{ label_key: 'msg.menu_kategori', go: 'kategori_menu' }]]
  const resolved = resolveButtons(buttons, { 'msg.menu_kategori': 'Kategori Custom' })
  assert.equal(resolved[0][0].text, 'Kategori Custom')
})

test('buttonText falls back to literal label', () => {
  assert.equal(buttonText({ label: 'Hello', go: 'welcome' }, {}), 'Hello')
})

test('buildProductListView lists products and product buttons', () => {
  const products = [
    { nama: 'Netflix', slug: 'netflix', urutan: 1, stok_count: 3, variants: [] },
    { nama: 'Spotify', slug: 'spotify', urutan: 2, stok_count: 0, variants: [] },
  ]
  const view = buildProductListView(products, { page: 0 })
  assert.equal(view.action, 'product_list')
  assert.match(view.caption, /NETFLIX/)
  assert.match(view.caption, /SPOTIFY/)
  const flat = view.buttons.flat()
  const netflix = flat.find((b) => b.preview && b.preview.slug === 'netflix')
  assert.ok(netflix)
  assert.ok(!flat.some((b) => b.preview && b.preview.slug === 'spotify'))
})

test('buildKategoriMenuView only shows non-empty categories', () => {
  const products = [
    { nama: 'A', slug: 'a', kategori: 'game', stok_count: 1 },
    { nama: 'B', slug: 'b', kategori: 'game', stok_count: 1 },
  ]
  const view = buildKategoriMenuView(products, {})
  assert.match(view.caption, /Game/)
  assert.ok(!view.caption.includes('Streaming'))
  const flat = view.buttons.flat()
  assert.ok(flat.some((b) => b.preview && b.preview.kategori === 'game'))
})

test('buildProductCardView shows variants and qty previews', () => {
  const produk = {
    nama: 'Netflix',
    slug: 'netflix',
    snk: 'No refund',
    variants: [
      { label: '1 Bulan', kode: 'nf1', harga: 25000, stok_count: 2, is_active: true, terjual: 5 },
      { label: 'Habis', kode: 'nf0', harga: 10000, stok_count: 0, is_active: true, terjual: 1 },
    ],
  }
  const view = buildProductCardView(produk, {})
  assert.match(view.caption, /Netflix/)
  assert.match(view.caption, /1 Bulan/)
  const flat = view.buttons.flat()
  const qty = flat.find((b) => b.preview && b.preview.type === 'qty')
  assert.equal(qty.preview.kode, 'nf1')
})
