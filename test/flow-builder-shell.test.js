const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ejs = require('ejs')

const viewRoot = path.join(__dirname, '..', 'views')
const viewFile = path.join(viewRoot, 'settings-bot-flow.ejs')
const cssFile = path.join(__dirname, '..', 'public/css/flow-builder.css')
const jsFile = path.join(__dirname, '..', 'public/js/flow-builder.js')

const locals = {
  title: 'Bot Flow - Test',
  namaBot: 'Test Bot',
  username: 'tester',
  req: { session: { role: 'admin' } },
  currentPage: 'settings-bot-flow',
  pageTitle: 'Bot Flow',
}

async function renderFlowPage() {
  return ejs.renderFile(viewFile, locals, { views: [viewRoot] })
}

test('Bot Flow page renders the Phase 14 PR3 layout shell (M2)', async () => {
  const html = await renderFlowPage()

  assert.match(html, /class="[^"]*\bflow-topbar\b/)
  assert.match(html, /id="flowName"/)
  assert.match(html, /id="btnPreview"/)
  assert.match(html, /id="btnUndo"/)
  assert.match(html, /id="btnRedo"/)
  assert.match(html, /id="flowStatus"/)

  assert.match(html, /id="btnSaveMenu"/)
  assert.match(html, /id="btnSaveDraft"/)
  assert.match(html, /id="btnPublish"/)
  assert.match(html, /Save draft/)
  assert.match(html, /Publish/)

  assert.match(html, /id="flowEnabled"/)
  assert.match(html, /id="btnGlobalStrings"/)
  assert.match(html, /id="entryKeySelect"/)
  assert.match(html, /id="btnOverflowMenu"/)

  assert.match(html, /class="[^"]*\bflow-palette\b/)
  assert.match(html, /id="btnAddMessageNode"/)
  assert.match(html, /id="btnAddActionNode"/)
  assert.equal(html.includes('draggable="true"'), false, 'PR4 drag-from-palette is out of scope')

  assert.match(html, /id="drawflow"/)
  assert.match(html, /class="[^"]*\bflow-canvas\b/)
  assert.match(html, /id="flowPanel"/)

  assert.match(html, /id="btnZoomIn"/)
  assert.match(html, /id="btnZoomOut"/)
  assert.match(html, /id="btnFitView"/)
  assert.match(html, /class="[^"]*\bflow-canvas-controls\b/)

  assert.equal(html.includes('id="selectionToolbar"'), false)
  assert.equal(html.includes('id="validationList"'), false)
  assert.equal(html.includes('id="flowMinimap"'), false)
  assert.equal(html.includes('id="btnAddNoteNode"'), false)
})

test('flow-builder CSS styles the dark top bar, palette, dotted canvas, Start pill, and inspector (M2/M7)', () => {
  const css = fs.readFileSync(cssFile, 'utf8')
  assert.match(css, /\.flow-topbar\b/)
  assert.match(css, /#0f2a3a/)
  assert.match(css, /\.flow-palette\b/)
  assert.match(css, /radial-gradient/)
  assert.match(css, /\.sp-start-pill\b/)
  assert.match(css, /\.flow-panel\b/)
  assert.match(css, /@media \(max-width: 900px\)/)
})

test('flow-builder JS puts a Start pill on entry_key and refuses deleting that node (M7)', () => {
  const js = fs.readFileSync(jsFile, 'utf8')
  assert.match(js, /sp-start-pill/)
  assert.match(js, /node\.key === entryKey/)
  assert.match(js, /Cannot delete the entry node/)
  assert.match(js, /is-entry/)
  assert.match(js, /btnSaveMenu/)
  assert.match(js, /btnOverflowMenu/)
  assert.match(js, /applyCommand/)
})
