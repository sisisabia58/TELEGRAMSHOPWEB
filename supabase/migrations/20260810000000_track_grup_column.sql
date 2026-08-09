-- ============================================
-- TRACK KOLOM "grup" PADA TABEL Produk
-- ============================================
-- Kolom `grup` sudah ditambahkan langsung ke database live pada commit d56cdb9
-- (feat(phase2): add product grouping (grup) support) tanpa file migrasi.
-- Migrasi ini hanya mencatat perubahan tersebut supaya isi folder
-- supabase/migrations/ cocok dengan skema database yang sebenarnya.
--
-- Idempotent: aman dijalankan pada database yang sudah punya kolom ini.
--
-- CATATAN: kolom ini akan dihapus lagi pada migrasi restrukturisasi
-- Produk -> Varian, karena digantikan oleh tabel "Varian".
-- ============================================

ALTER TABLE "Produk" ADD COLUMN IF NOT EXISTS grup TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_produk_grup ON "Produk"(grup);
