const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ejs = require('ejs')
const {
  PALETTE_MIME,
  PALETTE_TEXT_PREFIX,
  canvasPositionFromClient,
  viewportCenterPosition,
  setPaletteDragData,
  parsePaletteDragData,
  allowsPaletteDrop,
  resolvePaletteDrop,
} = require('../public/js/flow-builder/palette')
const { createEditorState } = require('../public/js/flow-builder/state')
const { addNode } = require('../public/js/flow-builder/commands')

const viewRoot = path.join(__dirname, '..', 'views')
const viewFile = path.join(viewRoot, 'settings-bot-flow.ejs')
const cssFile = path.join(__dirname, '..', 'public/css/flow-builder.css')
const jsFile = path.join(__dirname, '..', 'public/js/flow-builder.js')

function rect(left, top, width, height) {
  return { left, top, width, height, x: left, y: top, right: left + width, bottom: top + height }
}

function transferFromStore(store) {
  const data = Object.assign({}, store)
  return {
    types: Object.keys(data),
    getData: function (type) { return Object.prototype.hasOwnProperty.call(data, type) ? data[type] : '' },
    setData: function (type, value) { data[type] = value },
    effectAllowed: 'all',
    dropEffect: 'none',
  }
}

function withinTen(actual, expected) {
  assert.ok(Math.abs(actual - expected) <= 10, actual + ' should be within ±10px of ' + expected)
}

test('canvasPositionFromClient maps client coords through pan and zoom (M3)', () => {
  const precanvas = rect(80, 40, 2000, 1400)

  const zoom1 = canvasPositionFromClient(230, 170, precanvas, 1)
  assert.equal(zoom1.x, 150)
  assert.equal(zoom1.y, 130)

  const zoom2 = canvasPositionFromClient(230, 170, precanvas, 2)
  assert.equal(zoom2.x, 75)
  assert.equal(zoom2.y, 65)

  const zoomHalf = canvasPositionFromClient(230, 170, precanvas, 0.5)
  assert.equal(zoomHalf.x, 300)
  assert.equal(zoomHalf.y, 260)
})

test('dropping a palette item at a canvas point places the node within ±10px (M3)', () => {
  const precanvas = rect(120, 60, 1800, 1200)
  const drop = { clientX: 412, clientY: 301, dataTransfer: transferFromStore({}) }
  setPaletteDragData(drop.dataTransfer, 'message')

  const resolved = resolvePaletteDrop(drop, { precanvasRect: precanvas, zoom: 1 })
  assert.equal(resolved.kind, 'message')
  withinTen(resolved.pos_x, 292)
  withinTen(resolved.pos_y, 241)

  const zoomed = resolvePaletteDrop({
    clientX: 412,
    clientY: 301,
    dataTransfer: drop.dataTransfer,
  }, { precanvasRect: precanvas, zoom: 1.6 })
  const expectedX = (412 - 120) / 1.6
  const expectedY = (301 - 60) / 1.6
  withinTen(zoomed.pos_x, expectedX)
  withinTen(zoomed.pos_y, expectedY)
})

test('palette drop create is a single applyCommand step that undo restores', () => {
  const state = createEditorState()
  state.replaceDraft({ entry_key: 'welcome', nodes: [{ key: 'welcome', kind: 'screen', pos_x: 0, pos_y: 0 }] })
  const before = JSON.parse(JSON.stringify(state.getDraft()))

  const precanvas = rect(0, 0, 1000, 800)
  const drop = {
    clientX: 240,
    clientY: 180,
    dataTransfer: transferFromStore({}),
  }
  setPaletteDragData(drop.dataTransfer, 'action')
  const resolved = resolvePaletteDrop(drop, { precanvasRect: precanvas, zoom: 1 })

  const after = state.applyCommand((draft) => addNode(draft, {
    key: 'action.custom_1',
    kind: 'action',
    action: 'product_list',
    pos_x: resolved.pos_x,
    pos_y: resolved.pos_y,
    buttons: [],
    description: 'Open product catalog',
  }))

  assert.equal(after.nodes.length, 2)
  const added = after.nodes.find((n) => n.key === 'action.custom_1')
  withinTen(added.pos_x, 240)
  withinTen(added.pos_y, 180)
  assert.equal(state.canUndo(), true)
  assert.equal(state.canRedo(), false)

  const undone = state.undo()
  assert.deepEqual(undone, before)
  assert.equal(state.canRedo(), true)
})

test('click placement uses the viewport centre in canvas coordinates', () => {
  const container = rect(100, 50, 800, 600)
  const precanvas = rect(40, -10, 2000, 1600)
  const pos = viewportCenterPosition(container, precanvas, 1)
  withinTen(pos.x, 100 + 400 - 40)
  withinTen(pos.y, 50 + 300 - (-10))

  const zoomed = viewportCenterPosition(container, precanvas, 2)
  withinTen(zoomed.x, (100 + 400 - 40) / 2)
  withinTen(zoomed.y, (50 + 300 - (-10)) / 2)
})

test('parsePaletteDragData reads the custom MIME and text/plain fallback', () => {
  const dt = transferFromStore({})
  setPaletteDragData(dt, 'message')
  assert.equal(dt.getData(PALETTE_MIME), 'message')
  assert.equal(dt.getData('text/plain'), PALETTE_TEXT_PREFIX + 'message')
  assert.equal(parsePaletteDragData(dt), 'message')

  const plainOnly = transferFromStore({ 'text/plain': PALETTE_TEXT_PREFIX + 'action' })
  assert.equal(parsePaletteDragData(plainOnly), 'action')
  assert.equal(parsePaletteDragData(transferFromStore({ 'text/plain': 'hello' })), null)
  assert.equal(parsePaletteDragData(null), null)
})

test('allowsPaletteDrop accepts our MIME during dragover (types only)', () => {
  assert.equal(allowsPaletteDrop({ types: [PALETTE_MIME] }), true)
  assert.equal(allowsPaletteDrop({ types: ['text/plain'] }), true)
  assert.equal(allowsPaletteDrop({ types: ['Files'] }), false)
  assert.equal(allowsPaletteDrop(null), false)
})

test('resolvePaletteDrop ignores unknown payloads and missing geometry', () => {
  const precanvas = rect(0, 0, 100, 100)
  assert.equal(resolvePaletteDrop({
    clientX: 10,
    clientY: 10,
    dataTransfer: transferFromStore({ 'text/plain': 'nope' }),
  }, { precanvasRect: precanvas, zoom: 1 }), null)
  assert.equal(resolvePaletteDrop({
    clientX: 10,
    clientY: 10,
    dataTransfer: transferFromStore({ [PALETTE_MIME]: 'message' }),
  }, null), null)
})

test('Bot Flow palette items are draggable (M3)', async () => {
  const html = await ejs.renderFile(viewFile, {
    title: 'Bot Flow - Test',
    namaBot: 'Test Bot',
    username: 'tester',
    req: { session: { role: 'admin' } },
    currentPage: 'settings-bot-flow',
    pageTitle: 'Bot Flow',
  }, { views: [viewRoot] })

  assert.match(html, /id="btnAddMessageNode"[^>]*draggable="true"/)
  assert.match(html, /id="btnAddActionNode"[^>]*draggable="true"/)
  assert.match(html, /flow-builder\/palette\.js/)
  assert.match(html, /Drag onto the canvas/)
})

test('flow-builder CSS styles palette drag and canvas drop target', () => {
  const css = fs.readFileSync(cssFile, 'utf8')
  assert.match(css, /\.flow-palette-item\.is-dragging\b/)
  assert.match(css, /\.flow-canvas\.is-drag-over\b/)
})

test('flow-builder JS creates palette drops through applyCommand and selects the node', () => {
  const js = fs.readFileSync(jsFile, 'utf8')
  assert.match(js, /FlowBuilderPalette/)
  assert.match(js, /resolvePaletteDrop/)
  assert.match(js, /viewportCenterPosition/)
  assert.match(js, /applyCommand\(\(draft\) => FlowBuilderCommands\.addNode/)
  assert.match(js, /selectNodeByKey\(key\)/)
  assert.match(js, /addEventListener\('drop'/)
  assert.match(js, /addEventListener\('pointerdown'/)
  assert.match(js, /addEventListener\('pointerup'/)
  assert.match(js, /dropNodeAtClient/)
  assert.equal(js.includes('length * 40) % 400'), false, 'click-to-add no longer uses staggered offsets')
})
