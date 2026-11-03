-- Peg eksplisit USDT → USD untuk supplier HubX.
-- Bawaan 1: 1 USDT dihitung 1 USD, lalu kurs fx_usd_idr yang sudah ada.
-- Bukan konversi tersembunyi: admin mengubah angka ini di Catalog → Supplier → Pengaturan.
-- Kode tetap memakai default 1 kalau baris ini belum ada.

INSERT INTO "NotificationSettings" (setting_key, setting_value, description) VALUES
    ('fx_usdt_per_usd', '{"value": 1}', 'Berapa USD per 1 USDT sebelum kurs USD→IDR. Dipakai hanya untuk SupplierProduct.currency = USDT (HubX).')
ON CONFLICT (setting_key) DO NOTHING;
