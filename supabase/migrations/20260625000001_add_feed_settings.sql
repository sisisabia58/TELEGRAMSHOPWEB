-- Migration: Add Telegram Feed Channel Settings
INSERT INTO "NotificationSettings" (setting_key, setting_value, description) VALUES
('feed_channel', '{"value": ""}', 'Username atau link channel Telegram untuk update feed publik'),
('feed_stock_enabled', '{"value": true}', 'Kirim notifikasi ke channel feed saat stok baru ditambahkan'),
('feed_purchase_enabled', '{"value": true}', 'Kirim notifikasi ke channel feed saat ada pembelian produk')
ON CONFLICT (setting_key) DO NOTHING;
