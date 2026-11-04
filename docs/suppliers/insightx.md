# InsightX Pro sebagai supplier

Adapter: `lib/suppliers/insightx.js` (`adapter = insightx`).

Base URL bawaan:

`https://insightxpro.com/api/v1`

Dokumentasi InsightX: https://insightxpro.com/api-docs

Tidak ada API key di repo. Jangan commit `isk_live_…`.

## Pasang supplier

1. Dashboard → **Catalog → Supplier → Tambah Supplier**.
2. Nama bebas (misalnya `InsightX`). Nama ini yang tampil di langkah penjual bot.
3. Adapter: **InsightX Pro**.
4. Base URL: kosongkan supaya terisi URL bawaan di atas (path `/api/v1` wajib ikut).
5. API Key: **kosongkan** sampai kunci siap. Boleh juga mengisi env server `INSIGHTX_API_KEY` (Railway variable, bukan file `.env` yang di-commit). Kalau keduanya kosong, baris supplier tetap tersimpan tetapi setiap panggilan gagal `HTTP 401` (“api_key kosong — terpasang, belum diautentikasi”) dan tidak mengirim header. Tempel rahasia `isk_live_…` saja (sandbox `isk_test_…`). Kalau yang tersalin masih berawalan `Bearer ` atau `Authorization:`, adapter membuang awalan itu sebelum request. Jangan tempel ulang kunci lama sesudah regenerate di InsightX: kunci sebelumnya langsung mati.
6. Prioritas dan Aktif seperti supplier lain. Simpan.
7. Setelah kunci ditempel (form, atau env lalu restart proses), **Test koneksi**. Saldo tampil sebagai USD. Kalau InsightX menolak kunci, Test menampilkan `HTTP 401: <code>: <message>` plus panjang dan bentuk awalan (`isk_live_` / `isk_test_` / `sk_live_` / `sk_test_` / tidak dikenal) — bukan rahasianya. `unauthorized: Invalid or missing API key` berarti host menerima request dan menolak nilai kunci itu. Kunci live InsightX berawalan `isk_live_`, bukan `sk_live_`.
8. **Sync sekarang**. Produk masuk ke `SupplierProduct` (`external_id` = id InsightX, `currency` = `USD`, `harga_asal` = `price` — harga yang kunci ini bayar, bukan `list_price`).
9. Cek pemetaan di katalog supplier. Sync yang tidak menemukan varian kita membuat Produk + Varian baru. Untuk menggabungkan ke varian yang sudah ada: petakan manual (hanya varian `sumber = sendiri`). Pemetaan manual tidak ditimpa sync berikutnya.

## Harga (USD → rupiah)

`price` **tidak** diubah menjadi rupiah di dalam adapter. Ia disimpan di `SupplierProduct.harga_asal` dengan `currency = USD`.

Harga jual di bot memakai rumus yang sama dengan Bite Store:

```
harga_jual = price × fx_usd_idr × (1 + buffer%) × (1 + margin%)
```

dibulatkan ke atas. Tidak ada peg mata uang baru. `list_price` hanya dicatat di deskripsi kalau bukan harga reseller. Mata uang selain USD dilewati saat sync.

Kurs, buffer, dan margin tetap pengaturan reseller yang sama.

## Stok dan pembelian bot

- Stok angka disimpan sebagai integer.
- `stock: null` dengan `in_stock: true` (tersedia tanpa hitungan) disimpan sebagai `999999`, sama seperti stok `unlimited` HubX.
- `in_stock: false` disimpan sebagai stok 0 dan tidak ditawarkan.
- Setelah sync, penawaran InsightX ikut `catalog.attachStock` / `sourcing.buildOffers`.
- Saat checkout, `lib/fulfillment.js` memanggil `createOrder`. Body yang dikirim: `{ product, quantity, max_price }`. `product` adalah id atau slug. `quantity` 1–50. `max_price` adalah `harga_asal` yang tersinkron: kalau harga naik, InsightX menjawab HTTP 409 `price_changed` dan tidak memotong dompet, lalu fulfillment boleh pindah ke penawaran lain.
- API tidak mendokumentasikan kunci idempoten. Teleshop tetap menolak `createOrder` tanpa `idempotencyKey`, tetapi nilai itu **tidak** dikirim ke InsightX. Timeout yang diulang bisa membuat pesanan kedua. Kalau itu terjadi, rekonsiliasi manual lewat Dashboard InsightX.
- Respons `completed` atau `partial` dengan `items[].delivered` dikirim ke pembeli sebagai baris stok.
- HTTP 402 `insufficient_balance`, 409 `out_of_stock` / `price_changed`, dan 404 `product_not_found` gagal di penjual itu (4xx) dan fulfillment boleh pindah ke penawaran lain.
- `completed` dengan `items` kosong ditandai pesanan sudah terbit (`placed`) supaya tidak dibeli dua kali. Pembeli di-refund dan `SupplierOrder.error` diawali `perlu rekonsiliasi manual`.

## Sebelum tempel kunci production

Jangan mengisi API key di PR, seed, atau log. Test koneksi yang gagal 401 sebelum kunci ditempel adalah keadaan yang diharapkan. Jangan uji pesanan live dari lingkungan ini.
