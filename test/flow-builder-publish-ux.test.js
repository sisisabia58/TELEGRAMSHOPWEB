const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ejs = require('ejs')

const viewRoot = path.join(__dirname, '..', 'views')
const viewFile = path.join(viewRoot, 'settings-bot-flow.ejs')
const jsFile = path.join(__dirname, '..', 'public/js/flow-builder.js')
const cssFile = path.join(__dirname, '..', 'public/css/flow-builder.css')
const dashFile = path.join(__dirname, '..', 'dashboard.js')

test('new Message nodes use defaultMessageButtons(entry), not a hardcoded welcome go', () => {
  const js = fs.readFileSync(jsFile, 'utf8')
  assert.match(js, /FlowBuilderCommands\.defaultMessageButtons\(effectiveEntryKey\(\)\)/)
  assert.equal(js.includes("go: 'welcome'"), false)
})

test('deleting a node reports how many inbound buttons were removed', () => {
  const js = fs.readFileSync(jsFile, 'utf8')
  assert.match(js, /inboundGoCount/)
  assert.match(js, /inbound button/)
})

test('Global Strings save confirms a live write and posts only changed keys', () => {
  const js = fs.readFileSync(jsFile, 'utf8')
  assert.match(js, /go live to all buyers within ~10 seconds/i)
  assert.match(js, /no Publish step/i)
  assert.match(js, /diffStringMap/)
  assert.match(js, /No changes to save/)
})

test('publish, toggle and Global Strings save show a bump-failure warning', () => {
  const js = fs.readFileSync(jsFile, 'utf8')
  assert.match(js, /reloadPending/)
  assert.match(js, /setStatus\([^)]*warn/)
  const css = fs.readFileSync(cssFile, 'utf8')
  assert.match(css, /\.flow-status\.warn\b/)
})

test('GET /api/bot-flow reports a safe env override and the UI disables a forced toggle', async () => {
  const dash = fs.readFileSync(dashFile, 'utf8')
  const flag = fs.readFileSync(path.join(__dirname, '..', 'lib/flow-engine-flag.js'), 'utf8')
  assert.match(dash, /flow-engine-flag/)
  assert.match(dash, /envOverride/)
  assert.match(flag, /forced on/)
  assert.match(flag, /forced off/)

  const js = fs.readFileSync(jsFile, 'utf8')
  assert.match(js, /envOverride/)
  assert.match(js, /flowEnabledOverride/)
  assert.match(js, /\.disabled\s*=\s*forced/)

  const html = await ejs.renderFile(viewFile, {
    title: 'Bot Flow - Test',
    namaBot: 'Test Bot',
    username: 'tester',
    req: { session: { role: 'admin' } },
    currentPage: 'settings-bot-flow',
    pageTitle: 'Bot Flow',
  }, { views: [viewRoot] })
  assert.match(html, /id="flowEnabledOverride"/)
})

test('publish, toggle and bot-copy JSON include reloadPending when bump fails', () => {
  const dash = fs.readFileSync(dashFile, 'utf8')
  const publish = dash.match(/app\.post\('\/api\/bot-flow\/publish'[\s\S]*?\n\}\)/)
  const toggle = dash.match(/app\.post\('\/settings\/bot-flow\/toggle'[\s\S]*?\n\}\)/)
  const copy = dash.match(/app\.post\('\/api\/bot-copy'[\s\S]*?\n\}\)/)
  assert.ok(publish, 'publish route')
  assert.ok(toggle, 'toggle route')
  assert.ok(copy, 'bot-copy route')
  for (const block of [publish[0], toggle[0], copy[0]]) {
    assert.match(block, /runtimeSettings\.describeBump\(bumped\)/)
  }
})
