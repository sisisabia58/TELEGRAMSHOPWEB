// public/js/inline-edit.js
async function patchAndSwap(url, body, rowSelector) {
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'text/html' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || res.statusText)
  }
  const html = await res.text()
  const row = document.querySelector(rowSelector)
  if (row) row.outerHTML = html
  return html
}
