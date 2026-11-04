# InsightX Pro sebagai supplier

Adapter: `lib/suppliers/insightx.js` (`adapter = insightx`).

Base URL bawaan:

`https://api.insightxpro.store/api/v1`

Dokumentasi Reseller API: https://api.insightxpro.store/docs

Curl resmi katalog:

```
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://api.insightxpro.store/api/v1/products
```

`https://insightxpro.com/api/v1` adalah storefront lain (contoh kunci di halaman itu `sk_live_…`). Host itu menjawab `unauthorized: Invalid or missing API key` untuk kunci reseller `isk_live_…`. Jangan dipakai.

Tidak ada API key di repo. Jangan commit `isk_live_…`.

## Pasang supplier

1. Dashboard → **Catalog → Supplier → Tambah Supplier**.
2. Nama bebas (misalnya `InsightX`). Nama ini yang tampil di langkah penjual bot.
3. Adapter: **InsightX Pro**.
4. Base URL: kosongkan supaya terisi URL bawaan di atas. Path `/api/v1` wajib ikut. Kalau baris lama masih menyimpan `https://insightxpro.com/api/v1`, Test dan Sync menulisnya ulang ke host Reseller API sebelum request. Simpan ulang supplier supaya kolom Base URL di form ikut berubah.
5. API Key: **kosongkan** sampai kunci siap. Boleh juga mengisi env server `INSIGHTX_API_KEY` (Railway variable, bukan file `.env` yang di-commit). Kalau keduanya kosong, baris supplier tetap tersimpan tetapi setiap panggilan gagal `HTTP 401` (“api_key kosong — terpasang, belum diautentikasi”) dan tidak mengirim header. Tempel rahasia `isk_live_…` saja (sandbox `isk_test_…`). Kalau yang tersalin masih berawalan `Bearer ` atau `Authorization:`, adapter membuang awalan itu sebelum request. Header yang dikirim: `Authorization: Bearer <rahasia>` sekali. Jangan tempel ulang kunci lama sesudah regenerate di bot InsightX: kunci sebelumnya langsung mati.
6. Prioritas dan Aktif seperti supplier lain. Simpan.
7. Setelah kunci ditempel (form, atau env lalu restart proses), **Test koneksi**. Saldo tampil sebagai USDT (`balance_usdt`). Kalau InsightX menolak kunci, Test menampilkan `HTTP 401: <pesan>` plus panjang dan bentuk awalan (`isk_live_` / `isk_test_` / `sk_live_` / `sk_test_` / tidak dikenal) — bukan rahasianya. Badan Reseller API berbentuk `{ "error": "…" }`. 401 berulang dari IP yang sama bisa dikunci sementara oleh mereka; perbaiki kunci, jangan ditest berkali-kali.
8. **Sync sekarang**. Produk masuk ke `SupplierProduct` (`external_id` = `id` angka, `currency` = `USDT`, `harga_asal` = `base_price_usdt` — yang terpotong dari dompet, bukan `price` / `price_usdt` yang merupakan harga jual yang di-pin reseller).
9. Cek pemetaan di katalog supplier. Sync yang tidak menemukan varian kita membuat Produk + Varian baru. Untuk menggabungkan ke varian yang sudah ada: petakan manual (hanya varian `sumber = sendiri`). Pemetaan manual tidak ditimpa sync berikutnya.

## Harga (USDT → rupiah)

`base_price_usdt` **tidak** diubah menjadi rupiah di dalam adapter. Ia disimpan di `SupplierProduct.harga_asal` dengan `currency = USDT`.

Harga jual di bot memakai rumus yang sama dengan HubX:

```
harga_jual = base_price_usdt × fx_usdt_per_usd × fx_usd_idr × (1 + buffer%) × (1 + margin%)
```

dibulatkan ke atas. Peg `fx_usdt_per_usd` ada di **Catalog → Supplier → Pengaturan** (bawaan **1**, yaitu 1 USDT = 1 USD). `price` dan `price_usdt` tidak dipakai sebagai modal.

## Stok dan pembelian bot

- Stok angka disimpan sebagai integer.
- `unlimited: true` (API mengirim `stock: 999999` sebagai placeholder) disimpan sebagai `999999`.
- `available: false` disimpan sebagai stok 0 dan tidak ditawarkan.
- Katalog bawaan tidak memuat produk habis. Sync menandai baris yang tidak muncul lagi sebagai `is_available = false`.
- Setelah sync, penawaran InsightX ikut `catalog.attachStock` / `sourcing.buildOffers`.
- Saat checkout, `lib/fulfillment.js` memanggil `createOrder`. Body yang dikirim: `{ product_id, quantity, idempotency_key }`. `product_id` adalah `id` angka. `quantity` bilangan bulat positif. `idempotency_key` adalah kunci idempoten Teleshop: pengulangan yang sama mengembalikan pesanan yang sama, bukan pembelian kedua.
- Reseller API tidak punya `max_price`. Kenaikan `base_price_usdt` sesudah sync tetap terpotong sebesar harga live. Jangan mengirim field itu.
- Respons `completed` dengan `order.codes` (sama dengan `delivered_codes`) dikirim ke pembeli sebagai baris stok.
- HTTP 400, 401, 403, 404, dan 429 gagal di penjual itu (4xx) dan fulfillment boleh pindah ke penawaran lain. 503 dan 500 tidak dianggap gagal pasti.
- `completed` dengan `codes` kosong ditandai pesanan sudah terbit (`placed`) supaya tidak dibeli dua kali. Pembeli di-refund dan `SupplierOrder.error` diawali `perlu rekonsiliasi manual`.
- Respons `test: true` tidak pernah dianggap stok sungguhan. Adapter tidak mengirim header `X-Test-Mode`.

## Sebelum tempel kunci production

Jangan mengisi API key di PR, seed, atau log. Test koneksi yang gagal 401 sebelum kunci ditempel adalah keadaan yang diharapkan. Jangan uji pesanan live dari lingkungan ini.
