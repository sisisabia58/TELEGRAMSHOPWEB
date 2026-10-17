'use strict'

const http = require('node:http')
const { URL } = require('node:url')

const POLL_METHODS = new Set(['getUpdates', 'getMe'])

function parseMultipart(buffer, boundary) {
  const raw = buffer.toString('latin1')
  const parts = raw.split('--' + boundary)
  const out = {}
  for (const part of parts) {
    const trimmed = part.replace(/^\r\n/, '')
    if (!trimmed || trimmed === '--' || trimmed.startsWith('--')) continue
    const headerEnd = trimmed.indexOf('\r\n\r\n')
    if (headerEnd < 0) continue
    const headers = trimmed.slice(0, headerEnd)
    let body = trimmed.slice(headerEnd + 4)
    if (body.endsWith('\r\n')) body = body.slice(0, -2)
    const nameMatch = headers.match(/name="([^"]+)"/)
    if (!nameMatch) continue
    const filenameMatch = headers.match(/filename="([^"]*)"/)
    if (filenameMatch) {
      out[nameMatch[1]] = {
        filename: filenameMatch[1] || 'file',
        bytes: Buffer.byteLength(body, 'latin1'),
      }
    } else {
      out[nameMatch[1]] = Buffer.from(body, 'latin1').toString('utf8')
    }
  }
  return out
}

function parseBody(req, raw) {
  const ct = String(req.headers['content-type'] || '')
  if (ct.includes('application/json')) {
    if (!raw.length) return {}
    try { return JSON.parse(raw.toString('utf8')) } catch { return {} }
  }
  if (ct.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(raw.toString('utf8')))
  }
  const boundaryMatch = ct.match(/boundary=(?:"([^"]+)"|([^;]+))/i)
  if (ct.includes('multipart/form-data') && boundaryMatch) {
    return parseMultipart(raw, (boundaryMatch[1] || boundaryMatch[2]).trim())
  }
  if (!raw.length) return {}
  const text = raw.toString('utf8')
  try { return JSON.parse(text) } catch { /* fall through */ }
  try { return Object.fromEntries(new URLSearchParams(text)) } catch { return {} }
}

function coerceParams(params) {
  const out = { ...params }
  for (const key of ['reply_markup', 'commands', 'media']) {
    if (typeof out[key] === 'string') {
      try { out[key] = JSON.parse(out[key]) } catch { /* leave as string */ }
    }
  }
  for (const key of ['chat_id', 'message_id']) {
    if (out[key] != null && /^-?\d+$/.test(String(out[key]))) {
      out[key] = Number(out[key])
    }
  }
  return out
}

function textOf(params) {
  return params.caption || params.text || ''
}

function createFakeTelegram(options = {}) {
  const calls = []
  const pending = []
  let nextUpdateId = 1
  let nextMessageId = 1
  let failCaptionEdits = false
  let lastGetUpdatesAt = 0
  let lastPushAt = 0

  function record(method, params, result) {
    const entry = { method, params, result, at: Date.now() }
    calls.push(entry)
    return entry
  }

  function buildMessage(params) {
    const messageId = nextMessageId++
    return {
      message_id: messageId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: params.chat_id, type: 'private' },
      text: params.text,
      caption: params.caption,
      reply_markup: params.reply_markup,
    }
  }

  function handleMethod(method, params) {
    if (method === 'getUpdates') {
      lastGetUpdatesAt = Date.now()
      const batch = pending.splice(0, pending.length)
      record(method, params, batch)
      return { ok: true, result: batch }
    }

    if (method === 'editMessageCaption' && failCaptionEdits) {
      record(method, params, null)
      return { ok: false, error_code: 400, description: "Bad Request: message can't be edited" }
    }

    if (method === 'setMyCommands' || method === 'answerCallbackQuery' || method === 'deleteMessage' || method === 'getMe') {
      record(method, params, true)
      return { ok: true, result: true }
    }

    const result = buildMessage(params)
    record(method, params, result)
    return { ok: true, result }
  }

  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks)
      const url = new URL(req.url, 'http://127.0.0.1')
      const match = url.pathname.match(/^\/bot([^/]+)\/([A-Za-z]+)$/)
      const queryParams = Object.fromEntries(url.searchParams.entries())
      const bodyParams = parseBody(req, raw)
      const params = coerceParams({ ...queryParams, ...bodyParams })
      const method = match ? match[2] : 'unknown'

      let payload
      try {
        payload = handleMethod(method, params)
      } catch (err) {
        payload = { ok: false, error_code: 500, description: err.message }
      }

      const body = JSON.stringify(payload)
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Connection: 'close',
      })
      res.end(body)
    })
  })

  function listen() {
    return new Promise((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address()
        resolve(`http://127.0.0.1:${port}`)
      })
      server.on('error', reject)
    })
  }

  function close() {
    return new Promise((resolve) => {
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections()
      }
      server.close(() => resolve())
    })
  }

  function pushUpdate(update) {
    const full = { update_id: nextUpdateId++, ...update }
    pending.push(full)
    lastPushAt = Date.now()
    return full
  }

  function userShape(extra = {}) {
    return {
      id: extra.id || options.userId || 4242,
      is_bot: false,
      first_name: extra.first_name || options.firstName || 'Ada',
      username: extra.username || 'ada',
    }
  }

  function chatShape(user) {
    return { id: user.id, first_name: user.first_name, username: user.username, type: 'private' }
  }

  return {
    calls,
    pending,
    server,
    listen,
    close,
    setFailCaptionEdits(v) { failCaptionEdits = !!v },
    pushUpdate,
    pushMessage(text, extra = {}) {
      const from = userShape(extra)
      return pushUpdate({
        message: {
          message_id: extra.message_id || (1000 + nextUpdateId),
          from,
          chat: chatShape(from),
          date: Math.floor(Date.now() / 1000),
          text: String(text),
        },
      })
    },
    pushCallback(data, extra = {}) {
      const from = userShape(extra)
      const messageId = extra.message_id || extra.messageId || 1
      return pushUpdate({
        callback_query: {
          id: extra.id || `cb-${nextUpdateId}`,
          from,
          chat_instance: '1',
          data: String(data),
          message: {
            message_id: messageId,
            from: { id: 1, is_bot: true, first_name: 'Bot' },
            chat: chatShape(from),
            date: Math.floor(Date.now() / 1000),
            caption: extra.caption || '',
            text: extra.text || '',
          },
        },
      })
    },
    outgoing() {
      return calls.filter((c) => !POLL_METHODS.has(c.method))
    },
    clearOutgoing() {
      for (let i = calls.length - 1; i >= 0; i--) {
        if (!POLL_METHODS.has(calls[i].method)) calls.splice(i, 1)
      }
    },
    textOf,
    async waitForOutgoing(predicate, timeoutMs = 8000) {
      const start = Date.now()
      while (Date.now() - start < timeoutMs) {
        const hit = this.outgoing().find(predicate)
        if (hit) return hit
        await new Promise((r) => setTimeout(r, 20))
      }
      const summary = this.outgoing().map((c) => `${c.method}:${textOf(c.params).slice(0, 40)}`).join(' | ')
      throw new Error(`timeout waiting for Telegram call. seen: ${summary || '(none)'}`)
    },
    async waitIdle(quietMs = 250, timeoutMs = 5000) {
      const start = Date.now()
      let lastCount = calls.length
      let lastChange = Date.now()
      while (Date.now() - start < timeoutMs) {
        if (pending.length || calls.length !== lastCount) {
          lastCount = calls.length
          lastChange = Date.now()
        }
        if (!pending.length && Date.now() - lastChange >= quietMs && lastGetUpdatesAt >= lastPushAt) {
          return
        }
        await new Promise((r) => setTimeout(r, 20))
      }
    },
  }
}

module.exports = { createFakeTelegram, POLL_METHODS }
