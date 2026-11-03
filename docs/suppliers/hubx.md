# HubX Store sebagai supplier

Adapter: `lib/suppliers/hubx.js` (`adapter = hubx`).

Base URL bawaan:

`https://open-greeting-glow-production.up.railway.app/api/public/reseller/v1`

Dokumentasi HubX: https://open-greeting-glow-production.up.railway.app/api-docs#authentication

Tidak ada API key di repo. Jangan commit `rsk_live_…` atau `rsk_test_…`.

## Pasang supplier

1. Dashboard → **Catalog → Supplier → Tambah Supplier**.
2. Nama bebas (misalnya `HubX`). Nama ini yang tampil di langkah penjual bot.
3. Adapter: **HubX Store**.
4. Base URL: kosongkan supaya terisi URL bawaan di atas (path `/api/public/reseller/v1` wajib ikut).
5. API Key: **kosongkan** sampai kunci siap. Boleh juga mengisi env server `HUBX_API_KEY` (Railway variable, bukan file `.env` yang di-commit). Kalau keduanya kosong, baris supplier tetap tersimpan tetapi setiap panggilan gagal `HTTP 401` (“terpasang, belum diautentikasi”) dan tidak mengirim header.
6. Prioritas dan Aktif seperti supplier lain. Simpan.
7. Setelah kunci ditempel (form, atau env lalu restart proses), **Test koneksi**. Saldo tampil sebagai USDT. Sandbox (`rsk_test_…`) hanya melihat produk `sandbox-test`.
8. **Sync sekarang**. Produk masuk ke `SupplierProduct` (`external_id` = id HubX, `currency` = `USDT`, `harga_asal` = `price_usdt`).
9. Cek pemetaan di katalog supplier. Sync yang tidak menemukan varian kita membuat Produk + Varian baru. Untuk menggabungkan ke varian yang sudah ada: petakan manual (hanya varian `sumber = sendiri`). Pemetaan manual tidak ditimpa sync berikutnya.

## Sandbox vs live

| Kunci | Yang terlihat | Dompet |
| --- | --- | --- |
| `rsk_test_…` | Hanya produk `sandbox-test`. Item dummy `SANDBOX-USER-N:SANDBOX-PASS-N`. | Tidak terpotong |
| `rsk_live_…` | Produk sungguhan | Terpotong USDT |

Kunci live yang memesan `sandbox-test`, atau kunci sandbox yang memesan produk live, ditolak HubX dengan HTTP 403. Jangan uji pesanan live dari lingkungan ini.

## Harga (USDT → rupiah)

`price_usdt` **tidak** diubah menjadi rupiah di dalam adapter. Ia disimpan di `SupplierProduct.harga_asal` dengan `currency = USDT`.

Harga jual di bot:

```
harga_jual = price_usdt × fx_usdt_per_usd × fx_usd_idr × (1 + buffer%) × (1 + margin%)
```

dibulatkan ke atas seperti supplier USD. Peg `fx_usdt_per_usd` ada di **Catalog → Supplier → Pengaturan** (bawaan **1**, yaitu 1 USDT = 1 USD). Ubah peg itu kalau asumsinya tidak cocok. Mata uang selain USD dan USDT tidak dikonversi.

Kurs, buffer, dan margin tetap pengaturan reseller yang sama dengan Bite Store.

## Stok dan pembelian bot

- Stok angka disimpan sebagai integer.
- Stok `unlimited` disimpan sebagai `999999` supaya muat di kolom integer dan langkah penjual bot tetap menampilkan stok.
- Setelah sync, penawaran HubX ikut `catalog.attachStock` / `sourcing.buildOffers`. Kalau satu varian punya lebih dari satu penjual (termasuk stok sendiri), bot menampilkan langkah pilih penjual (`seller_pin`). Harga tiap penjual adalah harga jual yang sudah dikonversi.
- Saat checkout, `lib/fulfillment.js` memanggil `createOrder`. `external_order_id` = kunci idempoten Teleshop (berisi trxid, user, supplier, produk, qty), jadi ulang permintaan tidak memotong dompet HubX dua kali.
- Respons `delivered` dengan `items[]` dikirim ke pembeli sebagai baris stok (`user:pass`), sama seperti stok sendiri.
- Respons `awaiting_manual_delivery` di-poll `GET /orders/:id` (bawaan 5 kali, jeda 1s, 2s, 4s, 8s, 8s). Atur `HUBX_POLL_ATTEMPTS` dan `HUBX_POLL_BASE_MS` kalau kirim manual butuh lebih lama. Kalau masih menunggu, pembelian **gagal tertutup**: pembeli di-refund, supplier lain tidak dibeli, dan `SupplierOrder.error` diawali `perlu rekonsiliasi manual` karena pesanan HubX mungkin tetap selesai.
- HTTP 402 (saldo kurang) dan 409 (stok habis, HubX mengembalikan dana) gagal di penjual itu dan fulfillment boleh pindah ke penawaran lain.

## Sebelum tempel kunci production

Migrasi `20261103160000_fx_usdt_per_usd.sql` hanya menambah setting peg (aman diulang). Tanpa migrasi, kode tetap memakai peg 1.

Jangan mengisi API key di PR, seed, atau log. Test koneksi yang gagal 401 sebelum kunci ditempel adalah keadaan yang diharapkan.
