const test = require('node:test')
const assert = require('node:assert')

const jalurClient = require.resolve('../lib/supabase.js')
const jalurCopy = require.resolve('../lib/copy.js')
const jalurRetired = require.resolve('../lib/retired-commands.js')

function muatRetiredCommands() {
  delete require.cache[jalurRetired]
  delete require.cache[jalurCopy]
  require.cache[jalurClient] = {
    id: jalurClient,
    filename: jalurClient,
    loaded: true,
    exports: {
      from() {
        const b = {
          select() { return b },
          then(res, rej) {
            return Promise.resolve({ data: [], error: null }).then(res, rej)
          },
        }
        return b
      },
    },
  }
  return require(jalurRetired)
}

const {
  RETIRED_OWNER_COMMANDS,
  KEPT_OWNER_COMMANDS,
  isRetiredOwnerCommand,
  retiredOwnerHelpText,
} = muatRetiredCommands()

test.after(() => {
  delete require.cache[jalurClient]
  delete require.cache[jalurCopy]
  delete require.cache[jalurRetired]
})

test('retired list includes addproduk and excludes stok', () => {
  assert.ok(RETIRED_OWNER_COMMANDS.includes('addproduk'))
  assert.ok(RETIRED_OWNER_COMMANDS.includes('bc'))
  assert.ok(RETIRED_OWNER_COMMANDS.includes('setpremium'))
  assert.ok(!RETIRED_OWNER_COMMANDS.includes('stok'))
  assert.ok(KEPT_OWNER_COMMANDS.includes('stok'))
  assert.ok(KEPT_OWNER_COMMANDS.includes('rekap'))
  assert.ok(KEPT_OWNER_COMMANDS.includes('listuser'))
})

test('isRetiredOwnerCommand normalizes slash and case', () => {
  assert.equal(isRetiredOwnerCommand('/AddProduk'), true)
  assert.equal(isRetiredOwnerCommand('addproduk foo'), true)
  assert.equal(isRetiredOwnerCommand('/stok'), false)
  assert.equal(isRetiredOwnerCommand('/start'), false)
})

test('retiredOwnerHelpText mentions Dashboard', () => {
  const t = retiredOwnerHelpText('https://example.com')
  assert.match(t, /Dashboard/i)
  assert.match(t, /example\.com/)
})
