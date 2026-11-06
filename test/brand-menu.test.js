const test = require('node:test')
const assert = require('node:assert')
const brand = require('../lib/brand-menu')

const rupiah = (n) => `Rp${n}`

function product(nama, kategori, variants) {
  return { nama, kategori, is_active: true, variants }
}

test('brand diurutkan A–Z, dua per baris, jumlah varian termasuk yang habis', () => {
  const products = [
    product('Canva Edu', 'Canva', [{ label: '1 Bulan', kode: 'c1', is_active: true, stok_count: 0, harga: 1 }]),
    product('Canva Pro Personal', 'Canva', [{ label: '1 Bulan', kode: 'c2', is_active: true, stok_count: 3, harga: 2 }]),
    product('Adobe Express', 'Adobe', [{ label: '1 Tahun (NW)', kode: 'a1', is_active: true, stok_count: 4, harga: 3 }]),
    product('Mati', 'Zed', [{ label: '1 Bulan', kode: 'z1', is_active: false, stok_count: 9, harga: 1 }]),
    product('n8n Starter', 'n8n', [{ label: '1 Tahun (NW)', kode: 'n1', is_active: true, stok_count: 1, harga: 1 }]),
  ]
  const menu = brand.buildBrandMenu({ products, page: 0, perPage: 20 })
  assert.deepEqual(menu.brands.map((b) => `${b.name} (${b.count})`), ['Adobe (1)', 'Canva (2)', 'n8n (1)'])
  assert.equal(menu.buttons[0][0].text, 'Adobe (1)')
  assert.equal(menu.buttons[0][1].text, 'Canva (2)')
  assert.equal(menu.buttons[0][0].callback_data, 'kategori_Adobe')
  assert.equal(menu.buttons[1][0].text, 'n8n (1)')
  assert.ok(menu.buttons.every((row) => row.length <= 2))
})

test('menu brand terpaginasi 20 per halaman', () => {
  const products = []
  for (let i = 0; i < 25; i++) {
    const name = `Brand ${String(i).padStart(2, '0')}`
    products.push(product(name, name, [{ label: '1 Bulan', kode: `k${i}`, is_active: true, stok_count: 1, harga: 1 }]))
  }
  const page0 = brand.buildBrandMenu({ products, page: 0 })
  const page1 = brand.buildBrandMenu({ products, page: 1 })
  assert.equal(page0.totalPages, 2)
  assert.equal(page0.brands.length, 25)
  assert.equal(page0.buttons.flat().filter((b) => b.callback_data.startsWith('kategori_')).length, 20)
  assert.ok(page0.buttons.flat().some((b) => b.callback_data === 'brandpg:1'))
  assert.equal(page1.buttons.flat().filter((b) => b.callback_data.startsWith('kategori_')).length, 5)
  assert.equal(brand.parseBrandPage('brandpg:1'), 1)
})

test('baris item: harga terendah, from kalau 2 penjual, stok gabungan, habis tetap tampil', () => {
  const products = [product('Google AI Plus', 'Google AI', [
    {
      label: '1 Tahun (NW)',
      kode: 'ed-gap',
      is_active: true,
      harga: 31000,
      offers: [
        { sumber: 'supplier', supplier_product_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', supplier_nama: 'InsightX', harga_satuan: 12500, stok: 90 },
        { sumber: 'supplier', supplier_product_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', supplier_nama: 'HubX', harga_satuan: 31000, stok: 4 },
      ],
    },
    {
      label: '3 Bulan (FW)',
      kode: 'ed-gap-3',
      is_active: true,
      harga: 20500,
      offers: [
        { sumber: 'supplier', supplier_product_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', supplier_nama: 'HubX', harga_satuan: 20500, stok: 0 },
      ],
    },
  ])]
  const view = brand.buildBrandItems({ products, brand: 'Google AI', formatPrice: rupiah })
  assert.equal(view.items.length, 2)
  assert.equal(view.items[0].text, '❌ Google AI Plus 3 Bulan (FW) | Rp20500 | (0)')
  assert.equal(view.items[1].text, 'Google AI Plus 1 Tahun (NW) | from Rp12500 | (94)')
  assert.equal(view.buttons.length, 3)
  assert.equal(view.buttons[0][0].callback_data, 'v:ed-gap-3')
  assert.equal(view.buttons[0][0].preview.title, 'Stok habis')
  assert.equal(view.buttons[2][0].callback_data, 'daftarproduk')
  assert.equal(view.buttons[2][1].callback_data, 'kembaliawal')
})

test('garansi dari tag dan pengiriman bawaan chat', () => {
  assert.equal(brand.warrantyFromLabel('1 Tahun (FW)'), 'Full warranty — klaim lewat admin')
  assert.equal(brand.warrantyFromLabel('1 Tahun (PW)'), 'Partial warranty — klaim lewat admin')
  assert.equal(brand.warrantyFromLabel('1 Tahun (NW)'), 'No warranty')
  assert.equal(brand.warrantyFromLabel('1 Bulan'), 'Klaim garansi lewat admin')
  assert.equal(brand.DELIVERY_DEFAULT, 'Langsung di chat')
  const lines = brand.detailLines({
    garansi: brand.warrantyFromLabel('1 Tahun (NW)'),
    stok: 12,
    harga: 'Rp12.500',
    pengiriman: brand.DELIVERY_DEFAULT,
  })
  assert.match(lines, /Warranty: No warranty/)
  assert.match(lines, /Stock: 12/)
  assert.match(lines, /Price: Rp12\.500/)
  assert.match(lines, /Delivery: Langsung di chat/)
  const once = brand.appendDetailLines(`Desk\n\n${lines}`, lines)
  assert.equal(once.split('Warranty:').length, 2)
  const added = brand.appendDetailLines('Desk lama tanpa detail', lines)
  assert.match(added, /Desk lama tanpa detail\n\nWarranty:/)
})

test('tombol kepanjangan tetap muat 64 karakter dan harga tidak terpotong', () => {
  const text = brand.itemButtonText({
    title: 'LinkedIn Sales Navigator Core 2 Bulan (NW)',
    priceText: 'Rp20.500',
    fromPrice: true,
    stock: 12,
    soldOut: false,
  })
  assert.ok(text.length <= 64)
  assert.match(text, /from Rp20\.500 \| \(12\)$/)
})

test('parse halaman item brand', () => {
  assert.deepEqual(brand.parseBrandItemPage('bip:2:Google AI'), { page: 2, brand: 'Google AI' })
  assert.equal(brand.parseBrandItemPage('kategori_Google AI'), null)
})
