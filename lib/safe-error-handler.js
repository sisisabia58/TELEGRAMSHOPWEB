// Final Express error handler. Hide exception details unless NODE_ENV is
// explicitly development or test. Unset NODE_ENV (common in production) is
// treated as unsafe-to-expose, not as "dev".
'use strict'

const GENERIC_MESSAGE = 'Terjadi kesalahan. Silakan coba lagi.'

function exposeErrorDetails(nodeEnv = process.env.NODE_ENV) {
  return nodeEnv === 'development' || nodeEnv === 'test'
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function statusCode(err) {
  const code = Number(err && (err.status || err.statusCode))
  if (Number.isInteger(code) && code >= 400 && code < 600) return code
  return 500
}

function isApiRequest(req) {
  const url = req.originalUrl || req.url || ''
  return url.startsWith('/api')
}

function safeErrorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err)
  }

  console.error(err)

  const status = statusCode(err)
  const expose = exposeErrorDetails()

  if (isApiRequest(req)) {
    if (expose) {
      return res.status(status).json({
        error: err && err.message ? err.message : GENERIC_MESSAGE,
        stack: err && err.stack,
      })
    }
    return res.status(status).json({ error: GENERIC_MESSAGE })
  }

  if (expose) {
    const message = err && err.message ? err.message : String(err)
    const stack = err && err.stack ? err.stack : ''
    return res.status(status).type('html').send(
      `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Error</title></head><body><h1>Error</h1><pre>${escapeHtml(message)}\n${escapeHtml(stack)}</pre></body></html>`
    )
  }

  return res.status(status).type('html').send(
    `<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><title>Error</title></head><body><h1>Terjadi kesalahan</h1><p>Silakan coba lagi.</p></body></html>`
  )
}

module.exports = {
  GENERIC_MESSAGE,
  exposeErrorDetails,
  safeErrorHandler,
}
