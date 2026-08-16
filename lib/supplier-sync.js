// lib/supplier-sync.js — menarik katalog supplier ke dalam katalog kita.
//
// Dijalankan berkala oleh bot (cron) dan bisa dipicu manual dari dashboard
// (tombol "Sync sekarang"). Semua tulisan bersifat upsert dan idempoten, jadi
// dua pemicu yang tumpang tindih tidak merusak apa pun.
//
// YANG DILAKUKAN SATU PUTARAN:
//   1. ambil katalog supplier
//   2. upsert ke "SupplierProduct" (kunci: supplier_id + external_id)
//   3. baris yang tidak terlihat putaran ini -> is_available = false
//      (TIDAK dihapus: riwayat dan pemetaan manual harus selamat)
//   4. petakan ke Varian kita; kalau tidak ada padanan, buat Produk + Varian
//      baru supaya barangnya tetap tayang tanpa perlu tindakan admin
//   5. segarkan harga cadangan untuk varian yang DIBUAT sync
//
// YANG TIDAK PERNAH DILAKUKAN:
//   * menyentuh tabel "Stok" (stok supplier tidak pernah dititipkan ke sana)
//   * mengubah harga varian sumber='sendiri' (itu milik admin)
//   * menimpa baris yang mapping_mode = 'manual' (admin sudah memutuskan)
const supabase = require('./supabase')
const catalog = require('./catalog')
const fx = require('./fx')
const match = require('./supplier-match')
const runtimeSettings = require('./runtime-settings')
const { getAdapter } = require('./suppliers')

const BATCH = 200

function slugSupplier(nama, fallback) {
  return catalog.slugify(nama) || catalog.slugify(fallback) || 'supplier'
}

function laporanKosong() {
  return { fetched: 0, upserted: 0, matched: 0, created: 0, unmapped: 0, skipped: 0, repriced: 0, errors: [] }
}

// Semua varian kita + nama produknya, dalam bentuk yang dibutuhkan matcher.
async function muatVarianUntukPencocokan() {
  const { data, error } = await supabase
    .from('Varian')
    .select('id, label, kode, harga, sumber, produk_id, produk:Produk(nama)')
  if (error) throw error
  return (data || []).map((v) => ({
    id: v.id,
    label: v.label,
    kode: v.kode,
    harga: v.harga,
    sumber: v.sumber,
    produk_id: v.produk_id,
    produk_nama: v.produk?.nama || '',
  }))
}

// Kode varian harus unik global, jadi diberi awalan slug supplier + id eksternal.
function kodeUntuk(supplierSlug, externalId) {
  return `${supplierSlug}-${String(externalId)}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 80)
}

// Buat Produk + Varian untuk penawaran yang tidak punya padanan di katalog kita.
// Dibuat langsung aktif: keputusan produknya adalah auto-publish, jadi barang
// baru dari supplier langsung bisa dibeli tanpa menunggu admin.
async function buatProdukDariPenawaran(row, { supplierSlug, kategori, pricing }) {
  const nama = row.nama || `Produk ${row.external_id}`
  let slug = catalog.slugify(nama) || kodeUntuk(supplierSlug, row.external_id)

  const { data: adaSlug } = await supabase.from('Produk').select('id').eq('slug', slug).maybeSingle()
  if (adaSlug) slug = `${slug}-${kodeUntuk(supplierSlug, row.external_id)}`.slice(0, 120)

  const { data: produk, error: errProduk } = await supabase
    .from('Produk')
    .insert({
      nama,
      slug,
      kategori,
      deskripsi: row.deskripsi || nama,
      snk: '',
      is_active: true,
    })
    .select()
    .single()
  if (errProduk) throw errProduk

  const harga = fx.computeIdrPrice(row.harga_asal, pricing)
  const { data: varian, error: errVarian } = await supabase
    .from('Varian')
    .insert({
      produk_id: produk.id,
      label: nama,
      kode: kodeUntuk(supplierSlug, row.external_id),
      // Harga di sini hanya CADANGAN tampilan. Harga yang benar-benar dipakai
      // dihitung ulang saat dibaca oleh lib/sourcing.js dari harga_asal + kurs
      // + margin yang berlaku saat itu.
      harga: harga === null ? 0 : harga,
      sumber: 'supplier',
      is_active: true,
    })
    .select()
    .single()
  if (errVarian) throw errVarian

  return varian
}

// Satu putaran sinkronisasi untuk satu supplier. Tidak pernah melempar: laporan
// dikembalikan apa adanya supaya satu supplier bermasalah tidak menghentikan
// yang lain.
async function syncSupplier(supplier) {
  const laporan = laporanKosong()
  const adapter = getAdapter(supplier?.adapter)
  if (!adapter) {
    laporan.errors.push(`adapter "${supplier?.adapter}" tidak dikenal`)
    await tulisStatus(supplier, 'error', laporan.errors[0])
    return laporan
  }

  const supplierSlug = supplier.slug || slugSupplier(supplier.nama, supplier.id)
  const kategori = runtimeSettings.get('supplier_kategori_default', 'reseller')
  const pricing = fx.getPricingConfig()

  let daftar
  try {
    daftar = await adapter.listProducts({ baseUrl: supplier.base_url, apiKey: supplier.api_key })
  } catch (e) {
    const pesan = e.response?.status ? `HTTP ${e.response.status}: ${e.message}` : e.message
    laporan.errors.push(pesan)
    await tulisStatus(supplier, 'error', pesan)
    return laporan
  }

  laporan.fetched = daftar.produk.length
  laporan.skipped = daftar.skipped

  // --- 2. upsert katalog -----------------------------------------------------
  const sekarang = new Date().toISOString()
  const baris = daftar.produk.map((p) => ({
    supplier_id: supplier.id,
    external_id: p.externalId,
    nama: p.nama,
    deskripsi: p.deskripsi || '',
    harga_asal: p.hargaAsal,
    currency: p.currency,
    stok: p.stok,
    in_stock: p.inStock,
    is_available: true,
    last_seen_at: sekarang,
    updated_at: sekarang,
  }))

  let semuaUpsertBerhasil = true
  for (let i = 0; i < baris.length; i += BATCH) {
    const potongan = baris.slice(i, i + BATCH)
    const { error } = await supabase
      .from('SupplierProduct')
      .upsert(potongan, { onConflict: 'supplier_id,external_id' })
    if (error) {
      semuaUpsertBerhasil = false
      laporan.errors.push(`upsert: ${error.message}`)
    } else {
      laporan.upserted += potongan.length
    }
  }

  // --- 3. tandai yang hilang dari katalog supplier ---------------------------
  // Tidak dihapus: pemetaan manual admin dan jejak SupplierOrder harus selamat.
  //
  // HANYA kalau seluruh batch upsert berhasil. Sapuan ini menandai tidak-tersedia
  // segala baris yang last_seen_at-nya bukan dari putaran ini — dan baris dari
  // batch yang GAGAL juga masuk kategori itu. Menjalankannya setelah kegagalan
  // akan menarik produk yang sebenarnya masih dijual supplier keluar dari
  // peredaran sampai ada putaran yang sukses penuh.
  if (semuaUpsertBerhasil) {
    const { error } = await supabase
      .from('SupplierProduct')
      .update({ is_available: false, updated_at: sekarang })
      .eq('supplier_id', supplier.id)
      .neq('last_seen_at', sekarang)
    if (error) laporan.errors.push(`tandai hilang: ${error.message}`)
  } else {
    laporan.errors.push('sapuan ketersediaan dilewati karena ada batch upsert yang gagal')
  }

  // --- 4. pemetaan ke Varian -------------------------------------------------
  // Hanya baris yang BELUM dipetakan manual. mapping_mode='manual' itu lengket.
  const { data: perluPetakan, error: errAmbil } = await supabase
    .from('SupplierProduct')
    .select('*')
    .eq('supplier_id', supplier.id)
    .eq('is_available', true)
    .neq('mapping_mode', 'manual')

  if (errAmbil) {
    laporan.errors.push(`ambil untuk pemetaan: ${errAmbil.message}`)
  } else {
    let variants
    try {
      variants = await muatVarianUntukPencocokan()
    } catch (e) {
      laporan.errors.push(`muat varian: ${e.message}`)
      variants = []
    }

    for (const row of perluPetakan || []) {
      try {
        // Pemetaan otomatis sebelumnya masih dipercaya selama varian tujuannya
        // masih ada — mencocokkan ulang tiap putaran tidak menambah apa pun.
        if (row.varian_id && variants.some((v) => v.id === row.varian_id)) {
          laporan.matched++
          continue
        }

        // Hanya boleh menempel ke varian milik kita. Varian bikinan sync lain
        // bukan tujuan pencocokan yang sah — itu akan menggabungkan dua katalog
        // supplier lewat pintu belakang.
        const kandidat = variants.filter((v) => v.sumber !== 'supplier')
        const cocok = match.matchOffer(row.nama, kandidat)

        if (cocok) {
          const { error } = await supabase
            .from('SupplierProduct')
            .update({ varian_id: cocok.id, mapping_mode: 'auto', updated_at: new Date().toISOString() })
            .eq('id', row.id)
          if (error) throw error
          laporan.matched++
          continue
        }

        const varianBaru = await buatProdukDariPenawaran(row, { supplierSlug, kategori, pricing })
        const { error } = await supabase
          .from('SupplierProduct')
          .update({ varian_id: varianBaru.id, mapping_mode: 'auto', updated_at: new Date().toISOString() })
          .eq('id', row.id)
        if (error) throw error

        variants.push({
          id: varianBaru.id,
          label: varianBaru.label,
          kode: varianBaru.kode,
          harga: varianBaru.harga,
          sumber: 'supplier',
          produk_id: varianBaru.produk_id,
          produk_nama: varianBaru.label,
        })
        laporan.created++
      } catch (e) {
        laporan.unmapped++
        laporan.errors.push(`pemetaan ${row.external_id}: ${e.message}`)
      }
    }
  }

  // --- 5. segarkan harga cadangan varian bikinan sync ------------------------
  laporan.repriced = await refreshHargaCadangan(supplier.id, pricing, laporan)

  await tulisStatus(supplier, laporan.errors.length ? 'partial' : 'ok', laporan.errors[0] || null)
  return laporan
}

// Varian sumber='supplier' menyimpan harga hasil hitung sebagai CADANGAN, supaya
// jalur tampilan mana pun yang belum lewat harga_efektif tetap menunjukkan angka
// masuk akal, bukan Rp 0. Varian 'sendiri' tidak pernah disentuh — harganya milik admin.
async function refreshHargaCadangan(supplierId, pricing, laporan) {
  const { data, error } = await supabase
    .from('SupplierProduct')
    .select('varian_id, harga_asal, varian:Varian(id, harga, sumber)')
    .eq('supplier_id', supplierId)
    .eq('is_available', true)
    .not('varian_id', 'is', null)

  if (error) {
    laporan.errors.push(`baca harga: ${error.message}`)
    return 0
  }

  let n = 0
  for (const row of data || []) {
    const varian = row.varian
    if (!varian || varian.sumber !== 'supplier') continue
    const harga = fx.computeIdrPrice(row.harga_asal, pricing)
    if (harga === null || harga === varian.harga) continue

    const { error: errUpd } = await supabase.from('Varian').update({ harga }).eq('id', varian.id)
    if (errUpd) laporan.errors.push(`harga ${varian.id}: ${errUpd.message}`)
    else n++
  }
  return n
}

async function tulisStatus(supplier, status, error) {
  if (!supplier?.id) return
  await supabase
    .from('Supplier')
    .update({
      last_sync_at: new Date().toISOString(),
      last_sync_status: status,
      last_sync_error: error ? String(error).slice(0, 500) : null,
    })
    .eq('id', supplier.id)
}

async function listSuppliers({ activeOnly = false } = {}) {
  let q = supabase.from('Supplier').select('*').order('prioritas', { ascending: true })
  if (activeOnly) q = q.eq('is_active', true)
  const { data, error } = await q
  if (error) {
    console.error('supplier-sync.listSuppliers:', error)
    return []
  }
  return data || []
}

// Sinkronkan semua supplier aktif. Kegagalan diisolasi per supplier.
async function syncAll() {
  const suppliers = await listSuppliers({ activeOnly: true })
  const hasil = []
  for (const s of suppliers) {
    try {
      hasil.push({ supplier: s.nama, ...(await syncSupplier(s)) })
    } catch (e) {
      hasil.push({ supplier: s.nama, ...laporanKosong(), errors: [e.message] })
    }
  }
  return hasil
}

module.exports = {
  syncSupplier,
  syncAll,
  listSuppliers,
  refreshHargaCadangan,
  muatVarianUntukPencocokan,
  kodeUntuk,
  slugSupplier,
}
