// Keranjang (cart) user Telegram — disimpan di tabel "BotSession".
//
// Menggantikan file ./Database/Trx/<userId>.json yang dulu ditulis/dibaca di 92
// tempat di index.js. Filesystem Railway bersifat ephemeral, jadi setiap deploy
// menghapus semua keranjang yang sedang berjalan.
//
// KONTRAK BENTUK DATA:
// get() mengembalikan objek dengan bentuk yang SAMA PERSIS seperti isi file JSON
// sebelumnya, dan save() menerima bentuk yang sama:
//
//   { kode, jumlah, trxid, voucher, voucher_status, selectedStokIds }
//
// Sengaja tidak dinormalisasi. Dua tempat pembuatan keranjang menulis field
// tambahan yang berbeda (`id` di jalur `item:`, `variasi_nama`/`grup_nama` di
// jalur `pilih_variasi:`), tapi tidak ada satu pun kode yang MEMBACA field-field
// itu. Menyimpannya apa adanya membuat migrasi ini murni pemindahan tempat
// penyimpanan, bukan perubahan perilaku.
//
// PADANAN OPERASI LAMA:
//   fs.existsSync(path)                     -> await cart.exists(userId)
//   JSON.parse(fs.readFileSync(path))       -> await cart.get(userId)
//   fs.writeFileSync(path, JSON.stringify)  -> await cart.save(userId, data)
//   fs.unlinkSync(path)                     -> await cart.clear(userId)
const supabase = require('./supabase')

const TABLE = 'BotSession'

// Ambil keranjang aktif. Mengembalikan null kalau tidak ada — sama seperti dulu
// ketika file-nya tidak ada.
//
// Kegagalan query juga menghasilkan null (bukan throw), meniru perilaku lama:
// fs.existsSync() mengembalikan false ketika file tidak terbaca, dan pemanggil
// di index.js tidak punya penanganan error untuk operasi keranjang.
async function get(userId) {
  if (!userId) return null
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select('cart')
      .eq('user_id', userId)
      .maybeSingle()

    if (error) {
      console.error('Error cart.get:', error)
      return null
    }
    return data?.cart ?? null
  } catch (error) {
    console.error('Error cart.get:', error)
    return null
  }
}

// Apakah user punya keranjang aktif.
async function exists(userId) {
  if (!userId) return false
  try {
    const { count, error } = await supabase
      .from(TABLE)
      .select('user_id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .not('cart', 'is', null)

    if (error) {
      console.error('Error cart.exists:', error)
      return false
    }
    return (count || 0) > 0
  } catch (error) {
    console.error('Error cart.exists:', error)
    return false
  }
}

// Simpan/ganti keranjang. Upsert supaya user baru otomatis dapat baris sendiri,
// persis seperti writeFileSync yang membuat file kalau belum ada.
//
// Mengembalikan true kalau berhasil. Pemanggil lama tidak memeriksa hasil
// writeFileSync, jadi kegagalan hanya dicatat di log — tapi nilai baliknya
// tersedia untuk kode baru yang mau memeriksanya.
async function save(userId, data) {
  if (!userId) return false
  try {
    const { error } = await supabase
      .from(TABLE)
      .upsert({
        user_id: userId,
        cart: data,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' })

    if (error) {
      console.error('Error cart.save:', error)
      return false
    }
    return true
  } catch (error) {
    console.error('Error cart.save:', error)
    return false
  }
}

// Kosongkan keranjang.
//
// Barisnya TIDAK dihapus, hanya cart di-set NULL — karena kolom lain di baris
// yang sama (screen_key, nav_stack, banner_msg_id) akan dipakai flow engine dan
// tidak boleh hilang hanya karena keranjang dibatalkan.
//
// Kalau barisnya belum ada, tidak melakukan apa-apa dan tidak error — meniru
// pola lama `if (fs.existsSync(p)) fs.unlinkSync(p)`.
async function clear(userId) {
  if (!userId) return false
  try {
    const { error } = await supabase
      .from(TABLE)
      .update({ cart: null, updated_at: new Date().toISOString() })
      .eq('user_id', userId)

    if (error) {
      console.error('Error cart.clear:', error)
      return false
    }
    return true
  } catch (error) {
    console.error('Error cart.clear:', error)
    return false
  }
}

module.exports = { get, exists, save, clear }
