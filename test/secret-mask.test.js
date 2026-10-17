const assert = require('node:assert/strict')
const test = require('node:test')
const { maskSecret, redactSecrets, isMaskedOrBlank, resolveSecretInput, secretUpdateRow } = require('../lib/secret-mask')

const PAKASIR = 'pakasir-live-SUPERSECRETVALUE-9xK2'
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.anon-SUPERSECRET-abcd'
const SERVICE_ROLE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.service-role-SUPERSECRET-wxyz'

test('maskSecret never returns the full secret, only last 4 as a hint', () => {
  const masked = maskSecret(PAKASIR)
  assert.equal(masked.configured, true)
  assert.equal(masked.masked.includes(PAKASIR), false)
  assert.equal(masked.masked.includes('SUPERSECRETVALUE'), false)
  assert.equal(masked.masked.slice(-4), '9xK2')
  assert.match(masked.masked, /^•+9xK2$/)
})

test('maskSecret empty value is a not-set flag', () => {
  const masked = maskSecret('')
  assert.equal(masked.configured, false)
  assert.equal(masked.masked, '')
})

test('redactSecrets replaces listed fields so a client payload cannot contain the raw keys', () => {
  const publicSettings = redactSecrets({
    enabled: true,
    apiKey: PAKASIR,
    key: SUPABASE_ANON,
    serviceKey: SERVICE_ROLE,
    project: 'depodomain',
    url: 'https://example.supabase.co',
  }, ['apiKey', 'key', 'serviceKey'])

  const dumped = JSON.stringify(publicSettings)
  assert.equal(dumped.includes(PAKASIR), false)
  assert.equal(dumped.includes(SUPABASE_ANON), false)
  assert.equal(dumped.includes(SERVICE_ROLE), false)
  assert.equal(dumped.includes('SUPERSECRET'), false)
  assert.equal(publicSettings.apiKeySet, true)
  assert.equal(publicSettings.keySet, true)
  assert.equal(publicSettings.serviceKeySet, true)
  assert.equal(publicSettings.project, 'depodomain')
  assert.equal(publicSettings.url, 'https://example.supabase.co')
  assert.equal(publicSettings.apiKey.slice(-4), '9xK2')
  assert.equal(publicSettings.key.slice(-4), 'abcd')
  assert.equal(publicSettings.serviceKey.slice(-4), 'wxyz')
})

test('blank or masked input keeps the stored secret instead of overwriting it', () => {
  assert.equal(isMaskedOrBlank(''), true)
  assert.equal(isMaskedOrBlank('   '), true)
  assert.equal(isMaskedOrBlank(null), true)
  assert.equal(isMaskedOrBlank(maskSecret(PAKASIR).masked), true)
  assert.equal(isMaskedOrBlank('brand-new-key'), false)

  assert.equal(resolveSecretInput('', PAKASIR), PAKASIR)
  assert.equal(resolveSecretInput(maskSecret(PAKASIR).masked, PAKASIR), PAKASIR)
  assert.equal(resolveSecretInput('brand-new-key', PAKASIR), 'brand-new-key')
})

test('blank or masked save submissions omit the database update row', () => {
  const ENV_FALLBACK = 'env-fallback-SUPERSECRET-should-never-be-written'
  const maskedPakasir = maskSecret(PAKASIR).masked
  const maskedAnon = maskSecret(SUPABASE_ANON).masked
  const maskedService = maskSecret(SERVICE_ROLE).masked

  for (const submitted of ['', '   ', null, undefined, maskedPakasir, maskedAnon, maskedService, '********abcd']) {
    assert.equal(secretUpdateRow('payment_gateway_api_key', submitted), null)
    assert.equal(secretUpdateRow('supabase_key', submitted), null)
    assert.equal(secretUpdateRow('supabase_service_key', submitted), null)
  }

  const paymentUpdates = []
  const apiKeyUpdate = secretUpdateRow('payment_gateway_api_key', '')
  if (apiKeyUpdate) paymentUpdates.push(apiKeyUpdate)
  assert.deepEqual(paymentUpdates, [])

  const supabaseUpdates = []
  const keyUpdate = secretUpdateRow('supabase_key', maskedAnon)
  const serviceKeyUpdate = secretUpdateRow('supabase_service_key', '')
  if (keyUpdate) supabaseUpdates.push(keyUpdate)
  if (serviceKeyUpdate) supabaseUpdates.push(serviceKeyUpdate)
  assert.deepEqual(supabaseUpdates, [])

  const dumped = JSON.stringify({ paymentUpdates, supabaseUpdates, fallback: ENV_FALLBACK })
  assert.equal(dumped.includes(PAKASIR), false)
  assert.equal(dumped.includes(SUPABASE_ANON), false)
  assert.equal(dumped.includes(SERVICE_ROLE), false)
  assert.equal(JSON.stringify(paymentUpdates).includes(ENV_FALLBACK), false)
})

test('a new secret is persisted as submitted, never a mask or env fallback', () => {
  const newPakasir = 'pakasir-new-rotation-key'
  const newAnon = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.new-anon'
  const newService = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.new-service'

  assert.deepEqual(secretUpdateRow('payment_gateway_api_key', newPakasir), {
    setting_key: 'payment_gateway_api_key',
    setting_value: { value: newPakasir },
  })
  assert.deepEqual(secretUpdateRow('supabase_key', newAnon), {
    setting_key: 'supabase_key',
    setting_value: { value: newAnon },
  })
  assert.deepEqual(secretUpdateRow('supabase_service_key', newService), {
    setting_key: 'supabase_service_key',
    setting_value: { value: newService },
  })

  const row = secretUpdateRow('payment_gateway_api_key', newPakasir)
  assert.equal(row.setting_value.value.includes('•'), false)
  assert.equal(row.setting_value.value.includes('*'), false)
  assert.equal(row.setting_value.value.includes('SUPERSECRET'), false)
})
