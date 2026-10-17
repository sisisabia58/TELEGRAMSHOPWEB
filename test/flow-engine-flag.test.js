const test = require('node:test')
const assert = require('node:assert/strict')
const {
  flowEngineEnvOverride,
  effectiveFlowEngineEnabled,
  flowEngineFlagState,
} = require('../lib/flow-engine-flag')

test('flowEngineEnvOverride only reports forced on/off or false', () => {
  assert.equal(flowEngineEnvOverride('true'), 'forced on')
  assert.equal(flowEngineEnvOverride('false'), 'forced off')
  assert.equal(flowEngineEnvOverride(undefined), false)
  assert.equal(flowEngineEnvOverride(''), false)
  assert.equal(flowEngineEnvOverride('TRUE'), false)
  assert.equal(flowEngineEnvOverride('1'), false)
  assert.equal(flowEngineEnvOverride('yes'), false)
  assert.equal(flowEngineEnvOverride('production'), false)
})

test('effectiveFlowEngineEnabled prefers a true/false env override over the DB flag', () => {
  assert.equal(effectiveFlowEngineEnabled(false, 'true'), true)
  assert.equal(effectiveFlowEngineEnabled(true, 'false'), false)
  assert.equal(effectiveFlowEngineEnabled(true, undefined), true)
  assert.equal(effectiveFlowEngineEnabled(false, undefined), false)
  assert.equal(effectiveFlowEngineEnabled(true, 'maybe'), true)
  assert.equal(effectiveFlowEngineEnabled(false, 'maybe'), false)
})

test('flowEngineFlagState returns effective enabled plus a safe override flag', () => {
  assert.deepEqual(flowEngineFlagState(true, 'true'), {
    enabled: true,
    envOverride: 'forced on',
  })
  assert.deepEqual(flowEngineFlagState(true, 'false'), {
    enabled: false,
    envOverride: 'forced off',
  })
  assert.deepEqual(flowEngineFlagState(false, ''), {
    enabled: false,
    envOverride: false,
  })
  const leaked = JSON.stringify(flowEngineFlagState(true, 'secret-value'))
  assert.equal(leaked.includes('secret-value'), false)
})

test('flowEngineFlagState without rawEnv reads process.env.FLOW_ENGINE_ENABLED', () => {
  const prev = process.env.FLOW_ENGINE_ENABLED
  try {
    process.env.FLOW_ENGINE_ENABLED = 'false'
    assert.deepEqual(flowEngineFlagState(true), {
      enabled: false,
      envOverride: 'forced off',
    })
    process.env.FLOW_ENGINE_ENABLED = 'true'
    assert.deepEqual(flowEngineFlagState(false), {
      enabled: true,
      envOverride: 'forced on',
    })
    delete process.env.FLOW_ENGINE_ENABLED
    assert.deepEqual(flowEngineFlagState(true), {
      enabled: true,
      envOverride: false,
    })
  } finally {
    if (prev === undefined) delete process.env.FLOW_ENGINE_ENABLED
    else process.env.FLOW_ENGINE_ENABLED = prev
  }
})
