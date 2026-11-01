-- Local fixture: Netflix-style multi-seller stock.
--
-- Production currently has Netflix Family as SENDIRI only and zero suppliers.
-- This seed adds two demo API sellers (Seller A, Seller B) on the 30 Hari
-- variation so the bot can show combined stock, then a per-seller price step.
--
-- If varian kode netflix-30d already exists, the sellers are attached to it.
-- Otherwise a "Netflix Family Demo" product is created (7 / 30 / 90 Hari)
-- with own stock on 7 Hari (3) and 30 Hari (2).
--
-- Demo API keys are not live. Picking Seller A/B shows the right price and
-- stock; a real purchase to that seller fails closed and refunds until a
-- real supplier key is configured. Own-stock (Stok sendiri) fulfills from
-- the Stok table.
--
-- Apply to the local Supabase stack:
--   docker exec -i supabase_db_workspace psql -U postgres -d postgres < supabase/seed_multseller_demo.sql

INSERT INTO "Supplier" (nama, slug, adapter, base_url, api_key, is_active, prioritas)
VALUES
  ('Seller A', 'demo-seller-a', 'bitestore', 'https://example.com', 'demo-not-a-live-key', true, 1),
  ('Seller B', 'demo-seller-b', 'bitestore', 'https://example.com', 'demo-not-a-live-key', true, 2)
ON CONFLICT (slug) DO UPDATE
  SET nama = EXCLUDED.nama,
      is_active = true,
      prioritas = EXCLUDED.prioritas;

-- Produk demo hanya kalau katalog belum punya varian netflix-30d.
INSERT INTO "Produk" (nama, slug, kategori, deskripsi, snk, is_active, urutan)
SELECT
  'Netflix Family Demo',
  'netflix-family-demo',
  'streaming',
  'Fixture lokal: 30 Hari dipasok stok sendiri + Seller A + Seller B.',
  '',
  true,
  50
WHERE NOT EXISTS (SELECT 1 FROM "Varian" WHERE lower(kode) = 'netflix-30d')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO "Varian" (produk_id, label, kode, harga, urutan, is_active, sumber)
SELECT p.id, v.label, v.kode, v.harga, v.urutan, true, 'sendiri'
FROM "Produk" p
CROSS JOIN (VALUES
  ('7 Hari', 'netflix-demo-7d', 15000, 1),
  ('30 Hari', 'netflix-demo-30d', 45000, 2),
  ('90 Hari', 'netflix-demo-90d', 120000, 3)
) AS v(label, kode, harga, urutan)
WHERE p.slug = 'netflix-family-demo'
ON CONFLICT (kode) DO NOTHING;

INSERT INTO "Stok" (varian_id, varian_kode, data, status)
SELECT v.id, v.kode, v.kode || '-demo-' || g.n, 'tersedia'
FROM "Varian" v
JOIN (VALUES
  ('netflix-demo-7d', 3),
  ('netflix-demo-30d', 2)
) AS qty(kode, n) ON qty.kode = v.kode
JOIN generate_series(1, qty.n) AS g(n) ON true
WHERE NOT EXISTS (
  SELECT 1 FROM "Stok" s WHERE s.varian_kode = v.kode AND s.status = 'tersedia'
);

INSERT INTO "SupplierProduct" (
  supplier_id, external_id, nama, deskripsi, harga_asal, currency,
  stok, in_stock, varian_id, mapping_mode, is_available, last_seen_at
)
SELECT s.id, map.external_id, map.nama, '', map.harga_asal, 'USD',
       map.stok, true, v.id, 'manual', true, NOW()
FROM (VALUES
  ('demo-seller-a', 'netflix-30d-a', 'Netflix 30 Hari — Seller A', 1.5000, 4),
  ('demo-seller-b', 'netflix-30d-b', 'Netflix 30 Hari — Seller B', 4.0000, 6)
) AS map(supplier_slug, external_id, nama, harga_asal, stok)
JOIN "Supplier" s ON s.slug = map.supplier_slug
JOIN "Varian" v ON lower(v.kode) = CASE
  WHEN EXISTS (SELECT 1 FROM "Varian" WHERE lower(kode) = 'netflix-30d') THEN 'netflix-30d'
  ELSE 'netflix-demo-30d'
END
ON CONFLICT (supplier_id, external_id) DO UPDATE
  SET nama = EXCLUDED.nama,
      harga_asal = EXCLUDED.harga_asal,
      stok = EXCLUDED.stok,
      in_stock = true,
      varian_id = EXCLUDED.varian_id,
      mapping_mode = 'manual',
      is_available = true,
      last_seen_at = NOW();
