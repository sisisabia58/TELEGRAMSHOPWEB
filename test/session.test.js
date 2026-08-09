const test = require('node:test')
const assert = require('node:assert')

const jalurClient = require.resolve('../lib/supabase.js')
const jalurSession = require.resolve('../lib/session.js')

function muatSession(store) {
  delete require.cache[jalurSession]
  require.cache[jalurClient] = {
    id: jalurClient,
    filename: jalurClient,
    loaded: true,
    exports: {
      from(tabel) {
        assert.equal(tabel, 'BotSession')
        return {
          select() {
            return {
              eq(_c, userId) {
                return {
                  maybeSingle: async () => ({
                    data: store.get(userId) || null,
                    error: null,
                  }),
                }
              },
            }
          },
          upsert: async (row) => {
            const prev = store.get(row.user_id) || {}
            store.set(row.user_id, { ...prev, ...row })
            return { error: null }
          },
          update: (patch) => ({
            eq: async (_c, userId) => {
              const prev = store.get(userId) || { user_id: userId }
              store.set(userId, { ...prev, ...patch })
              return { error: null }
            },
          }),
        }
      },
    },
  }
  return require(jalurSession)
}

test.after(() => {
  delete require.cache[jalurClient]
  delete require.cache[jalurSession]
})

test('getNav returns defaults when no row', async () => {
  const session = muatSession(new Map())
  const nav = await session.getNav(1)
  assert.deepEqual(nav, { screen_key: null, nav_stack: [], banner_msg_id: null })
})

test('setScreen without push replaces screen_key and clears stack when push false', async () => {
  const store = new Map()
  store.set(1, { user_id: 1, screen_key: 'saldo_menu', nav_stack: ['welcome'], banner_msg_id: 9 })
  const session = muatSession(store)
  await session.setScreen(1, 'welcome', { push: false })
  const row = store.get(1)
  assert.equal(row.screen_key, 'welcome')
  assert.deepEqual(row.nav_stack, [])
})

test('setScreen with push appends previous key', async () => {
  const store = new Map()
  store.set(1, { user_id: 1, screen_key: 'welcome', nav_stack: [], banner_msg_id: null })
  const session = muatSession(store)
  await session.setScreen(1, 'saldo_menu', { push: true })
  const row = store.get(1)
  assert.equal(row.screen_key, 'saldo_menu')
  assert.deepEqual(row.nav_stack, ['welcome'])
})

test('popScreen restores previous', async () => {
  const store = new Map()
  store.set(1, { user_id: 1, screen_key: 'saldo_menu', nav_stack: ['welcome'], banner_msg_id: null })
  const session = muatSession(store)
  const prev = await session.popScreen(1)
  assert.equal(prev, 'welcome')
  assert.equal(store.get(1).screen_key, 'welcome')
  assert.deepEqual(store.get(1).nav_stack, [])
})

test('setBanner writes banner_msg_id', async () => {
  const store = new Map()
  const session = muatSession(store)
  await session.setBanner(1, 42)
  assert.equal(store.get(1).banner_msg_id, 42)
})
