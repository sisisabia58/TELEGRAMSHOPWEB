const test = require('node:test')
const assert = require('node:assert/strict')

const jalurClient = require.resolve('../lib/supabase.js')
const jalurRuntime = require.resolve('../lib/runtime-settings.js')

function muatRuntime({ version = 3, upsertErrors = [], readErrors = [] } = {}) {
  delete require.cache[jalurRuntime]
  let upsertCalls = 0
  let readCalls = 0
  require.cache[jalurClient] = {
    id: jalurClient,
    filename: jalurClient,
    loaded: true,
    exports: {
      from(tabel) {
        assert.equal(tabel, 'NotificationSettings')
        const b = {
          select() { return b },
          eq() { return b },
          maybeSingle: async () => {
            const err = readErrors[readCalls] || null
            readCalls++
            if (err) return { data: null, error: err }
            return {
              data: { setting_value: { value: version } },
              error: null,
            }
          },
          upsert: async () => {
            const err = upsertErrors[upsertCalls] || null
            upsertCalls++
            return { error: err }
          },
        }
        return b
      },
    },
  }
  const mod = require(jalurRuntime)
  return { mod, upsertCalls: () => upsertCalls, readCalls: () => readCalls }
}

test.after(() => {
  delete require.cache[jalurClient]
  delete require.cache[jalurRuntime]
})

test('bump returns the new version when upsert succeeds', async () => {
  const { mod, upsertCalls } = muatRuntime({ version: 4, upsertErrors: [] })
  assert.equal(await mod.bump(), 5)
  assert.equal(upsertCalls(), 1)
})

test('bump retries once after a failure then returns the new version', async () => {
  const { mod, upsertCalls } = muatRuntime({
    version: 2,
    upsertErrors: [{ message: 'write failed' }, null],
  })
  assert.equal(await mod.bump(), 3)
  assert.equal(upsertCalls(), 2)
})

test('bump returns false after the retry also fails', async () => {
  const { mod, upsertCalls } = muatRuntime({
    version: 9,
    upsertErrors: [{ message: 'fail 1' }, { message: 'fail 2' }],
  })
  assert.equal(await mod.bump(), false)
  assert.equal(upsertCalls(), 2)
})

test('bump does not upsert version 1 when both version reads fail', async () => {
  const { mod, upsertCalls, readCalls } = muatRuntime({
    version: 5,
    readErrors: [{ message: 'read fail 1' }, { message: 'read fail 2' }],
  })
  assert.equal(await mod.bump(), false)
  assert.equal(readCalls(), 2)
  assert.equal(upsertCalls(), 0)
})

test('bump retries after a version read failure then returns the new version', async () => {
  const { mod, upsertCalls, readCalls } = muatRuntime({
    version: 5,
    readErrors: [{ message: 'read fail once' }],
  })
  assert.equal(await mod.bump(), 6)
  assert.equal(readCalls(), 2)
  assert.equal(upsertCalls(), 1)
})

test('describeBump surfaces a reload warning without leaking internals', () => {
  delete require.cache[jalurRuntime]
  require.cache[jalurClient] = {
    id: jalurClient,
    filename: jalurClient,
    loaded: true,
    exports: { from() { throw new Error('unused') } },
  }
  const { describeBump } = require(jalurRuntime)
  assert.deepEqual(describeBump(12), { reloadPending: false })
  const failed = describeBump(false)
  assert.equal(failed.reloadPending, true)
  assert.match(failed.warning, /may not reload/i)
  assert.match(failed.warning, /next publish or a restart/i)
  assert.deepEqual(describeBump(null).reloadPending, true)
})
