// FLOW_ENGINE_ENABLED is a process-local override. Production has no Procfile
// or split Railway services: Dockerfile CMD / `npm start` runs index.js and
// dashboard.js via concurrently in one container, so both inherit the same
// Railway service env. `npm run dashboard` is local-only (no bot poller).
// Dashboard GET /api/bot-flow and lib/flow.isEnabled() must both use this
// module so env-vs-DB precedence cannot drift.
function flowEngineEnvRaw() {
  return process.env.FLOW_ENGINE_ENABLED
}

function flowEngineEnvOverride(raw) {
  if (raw === 'true') return 'forced on'
  if (raw === 'false') return 'forced off'
  return false
}

function effectiveFlowEngineEnabled(dbEnabled, rawEnv) {
  if (arguments.length < 2) rawEnv = flowEngineEnvRaw()
  const override = flowEngineEnvOverride(rawEnv)
  if (override === 'forced on') return true
  if (override === 'forced off') return false
  return dbEnabled === true
}

function flowEngineFlagState(dbEnabled, rawEnv) {
  if (arguments.length < 2) rawEnv = flowEngineEnvRaw()
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
