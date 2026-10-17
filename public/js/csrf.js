(function (global) {
  function getCsrfToken() {
    if (typeof document === 'undefined') return ''
    const meta = document.querySelector('meta[name="csrf-token"]')
    return (meta && meta.getAttribute('content')) || ''
  }

  function csrfHeaders(init) {
    const headers = new Headers(init || {})
    const token = getCsrfToken()
    if (token && !headers.has('X-CSRF-Token')) {
      headers.set('X-CSRF-Token', token)
    }
    return headers
  }

  const origFetch = global.fetch
  if (typeof origFetch === 'function') {
    global.fetch = function (input, init) {
      init = init ? Object.assign({}, init) : {}
      const method = String(
        init.method || (input && input.method) || 'GET'
      ).toUpperCase()
      if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
        const sourceHeaders = init.headers || (input && input.headers)
        init.headers = csrfHeaders(sourceHeaders)
      }
      return origFetch.call(this, input, init)
    }
  }

  function injectCsrfFields() {
    if (typeof document === 'undefined') return
    const token = getCsrfToken()
    if (!token) return
    document.querySelectorAll('form').forEach((form) => {
      const method = (form.getAttribute('method') || 'GET').toUpperCase()
      if (method !== 'POST' && method !== 'PUT' && method !== 'PATCH' && method !== 'DELETE') return
      const existing = form.querySelector('input[name="_csrf"]')
      if (existing) {
        existing.value = token
        return
      }
      const input = document.createElement('input')
      input.type = 'hidden'
      input.name = '_csrf'
      input.value = token
      form.insertBefore(input, form.firstChild)
    })
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', injectCsrfFields)
    } else {
      injectCsrfFields()
    }
  }

  global.getCsrfToken = getCsrfToken
  global.csrfHeaders = csrfHeaders
})(typeof window !== 'undefined' ? window : globalThis)
