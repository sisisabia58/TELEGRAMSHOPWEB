function flowEngineEnvOverride(raw) {
  if (raw === 'true') return 'forced on'
  if (raw === 'false') return 'forced off'
  return false
}

function effectiveFlowEngineEnabled(dbEnabled, rawEnv) {
  const override = flowEngineEnvOverride(rawEnv)
  if (override === 'forced on') return true
  if (override === 'forced off') return false
  return dbEnabled === true
}

function flowEngineFlagState(dbEnabled, rawEnv) {
  return {
    enabled: effectiveFlowEngineEnabled(dbEnabled, rawEnv),
    envOverride: flowEngineEnvOverride(rawEnv),
  }
}

module.exports = {
  flowEngineEnvOverride,
  effectiveFlowEngineEnabled,
  flowEngineFlagState,
}
