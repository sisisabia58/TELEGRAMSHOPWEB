/* Palette drag-to-create helpers for the flow builder (Phase 14 PR4 / M3). */
(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) {
    module.exports = api
  }
  if (root && typeof root === 'object') {
    root.FlowBuilderPalette = api
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const PALETTE_MIME = 'application/x-teleshop-flow-block'
  const PALETTE_TEXT_PREFIX = 'flow-palette:'

  let activePaletteKind = null

  function isPaletteKind(kind) {
    return kind === 'message' || kind === 'action'
  }

  function setActivePaletteKind(kind) {
    activePaletteKind = isPaletteKind(kind) ? kind : null
    return activePaletteKind
  }

  function getActivePaletteKind() {
    return activePaletteKind
  }

  function originX(rect) {
    if (!rect) return 0
    if (rect.left != null) return Number(rect.left) || 0
    return Number(rect.x) || 0
  }

  function originY(rect) {
    if (!rect) return 0
    if (rect.top != null) return Number(rect.top) || 0
    return Number(rect.y) || 0
  }

  function canvasPositionFromClient(clientX, clientY, precanvasRect, zoom) {
    const z = Number(zoom)
    const scale = Number.isFinite(z) && z !== 0 ? z : 1
    return {
      x: (Number(clientX) - originX(precanvasRect)) / scale,
      y: (Number(clientY) - originY(precanvasRect)) / scale,
    }
  }

  function viewportCenterPosition(containerRect, precanvasRect, zoom) {
    const left = originX(containerRect)
    const top = originY(containerRect)
    const width = containerRect && containerRect.width != null ? Number(containerRect.width) : 0
    const height = containerRect && containerRect.height != null ? Number(containerRect.height) : 0
    return canvasPositionFromClient(left + width / 2, top + height / 2, precanvasRect, zoom)
  }

  function typeList(dataTransfer) {
    const types = dataTransfer && dataTransfer.types
    if (!types) return []
    if (typeof types.contains === 'function' || typeof types.item === 'function') {
      const out = []
      for (let i = 0; i < types.length; i++) out.push(types[i])
      return out
    }
    return Array.from(types)
  }

  function readTransfer(dataTransfer, type) {
    if (!dataTransfer || typeof dataTransfer.getData !== 'function') return ''
    try {
      return dataTransfer.getData(type) || ''
    } catch (err) {
      return ''
    }
  }

  function setPaletteDragData(dataTransfer, kind) {
    const normalized = setActivePaletteKind(kind)
    if (!normalized || !dataTransfer) return normalized
    try {
      dataTransfer.setData(PALETTE_MIME, normalized)
    } catch (err) { /* custom MIME unsupported */ }
    try {
      dataTransfer.setData('text/plain', PALETTE_TEXT_PREFIX + normalized)
    } catch (err) { /* required in some browsers to start a drag */ }
    dataTransfer.effectAllowed = 'copy'
    return normalized
  }

  function parsePaletteDragData(dataTransfer) {
    const custom = readTransfer(dataTransfer, PALETTE_MIME)
    if (isPaletteKind(custom)) return custom
    const plain = readTransfer(dataTransfer, 'text/plain')
    if (plain.indexOf(PALETTE_TEXT_PREFIX) === 0) {
      const kind = plain.slice(PALETTE_TEXT_PREFIX.length)
      if (isPaletteKind(kind)) return kind
    }
    return null
  }

  function allowsPaletteDrop(dataTransfer) {
    const types = typeList(dataTransfer)
    if (types.indexOf(PALETTE_MIME) !== -1) return true
    if (types.indexOf('text/plain') !== -1) return true
    return false
  }

  function resolvePaletteDrop(event, geometry) {
    if (!event) return null
    let kind = parsePaletteDragData(event.dataTransfer)
    if (!kind) {
      const custom = readTransfer(event.dataTransfer, PALETTE_MIME)
      const plain = readTransfer(event.dataTransfer, 'text/plain')
      if (!custom && !plain) kind = getActivePaletteKind()
    }
    if (!isPaletteKind(kind)) return null
    if (!geometry || !geometry.precanvasRect) return null
    const pos = canvasPositionFromClient(event.clientX, event.clientY, geometry.precanvasRect, geometry.zoom)
    return { kind: kind, pos_x: pos.x, pos_y: pos.y }
  }

  return {
    PALETTE_MIME: PALETTE_MIME,
    PALETTE_TEXT_PREFIX: PALETTE_TEXT_PREFIX,
    canvasPositionFromClient: canvasPositionFromClient,
    viewportCenterPosition: viewportCenterPosition,
    setPaletteDragData: setPaletteDragData,
    parsePaletteDragData: parsePaletteDragData,
    allowsPaletteDrop: allowsPaletteDrop,
    resolvePaletteDrop: resolvePaletteDrop,
    setActivePaletteKind: setActivePaletteKind,
    getActivePaletteKind: getActivePaletteKind,
  }
})
