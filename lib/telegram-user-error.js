// Shared callback-query failure path: log the raw error server-side and send
// a generic user-facing copy string (never interpolate err.message).

async function reportCallbackFailure(err, { userId, copy, send, log = console.error }) {
  log('[callback]', err)
  await send(userId, copy.get('err.load_failed'))
}

module.exports = { reportCallbackFailure }
