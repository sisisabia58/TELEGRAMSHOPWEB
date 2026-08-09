// Satu-satunya Supabase client untuk seluruh aplikasi.
//
// Sebelumnya index.js dan dashboard.js masing-masing membuat client sendiri
// dengan createClient(). Keduanya sekarang memakai modul ini supaya konfigurasi
// koneksi hanya ada di satu tempat.
const { createClient } = require('@supabase/supabase-js')
const { SUPABASE_URL, SUPABASE_KEY } = require('../settings.js')

module.exports = createClient(SUPABASE_URL, SUPABASE_KEY)
