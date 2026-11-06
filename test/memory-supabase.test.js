'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createMemorySupabase } = require('./helpers/memory-supabase')

test('select count is the filtered total, not the paginated page size', async () => {
  const supabase = createMemorySupabase({
    Produk: [
      { id: 1, nama: 'A', is_active: true },
      { id: 2, nama: 'B', is_active: true },
      { id: 3, nama: 'C', is_active: true },
      { id: 4, nama: 'D', is_active: false },
    ],
  })

  const paged = await supabase
    .from('Produk')
    .select('*', { count: 'exact' })
    .eq('is_active', true)
    .range(0, 1)

  assert.equal(paged.error, null)
  assert.equal(paged.count, 3)
  assert.equal(paged.data.length, 2)
  assert.deepEqual(paged.data.map((r) => r.id), [1, 2])

  const limited = await supabase
    .from('Produk')
    .select('*', { count: 'exact' })
    .eq('is_active', true)
    .limit(1)

  assert.equal(limited.count, 3)
  assert.equal(limited.data.length, 1)

  const headed = await supabase
    .from('Produk')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)
    .range(0, 1)

  assert.equal(headed.data, null)
  assert.equal(headed.count, 3)
})
