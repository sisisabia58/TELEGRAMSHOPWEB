# Visual Flow Builder (Phase 6b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `/settings/bot-flow` form/JSON editor with a Drawflow canvas + side panel, add Save draft → Preview (phone mock) → Publish, without changing the live bot until Publish.

**Architecture:** Draft graph JSON on `BotFlow.draft`. Pure `lib/flow-draft.js` validates and builds publish patches. Dashboard loads Drawflow (CDN), edits existing nodes only, wires `go` buttons, edits screen `body` in the panel. Publish writes `BotFlowNode` + `BotCopy` + `runtimeSettings.bump()`. Bot continues to read published rows only.

**Tech Stack:** Node.js 20, Express 5 + EJS, vanilla JS, Drawflow (CDN), `@supabase/supabase-js`, `node --test`, Railway + Supabase.

**Design spec:** [docs/superpowers/specs/2026-08-09-visual-flow-builder-design.md](../specs/2026-08-09-visual-flow-builder-design.md)

## Global Constraints

- Navigation-only: **`screen` | `action`** — no Filter/API/Pause/Random
- **Edit existing nodes only** — no add/delete node keys
- Lifecycle: **Save draft** (no bump) → **Preview mock** → **Publish** (nodes + BotCopy + bump)
- Preview = **in-dashboard phone frame**, not live Telegram
- Keep EJS + vanilla JS; Drawflow via CDN only — **no React/Vue**
- Tests: pure functions via `node --test` only; no Telegram mocks; no browser automation required for CI
- Do not change `lib/flow.js` runtime goto semantics except reading published data (already does)
- Do not expand `ACTIONS` allowlist
- Leave checkout (`p:` / `v:` / bayar) alone
- Shared invalidation: `bump()` **only on Publish** (and existing enable toggle)
- Migrations: `SET search_path TO public, extensions;`

---

## File map

| File | Responsibility |
|------|----------------|
| `supabase/migrations/20260815000000_bot_flow_draft.sql` | `draft`, `draft_updated_at`, `pos_x`/`pos_y`; backfill positions |
| `lib/flow-draft.js` | validateDraft, draftFromPublished, applyWire, publishPlan |
| `test/flow-draft.test.js` | Pure unit tests |
| `dashboard.js` | GET graph API; POST draft/preview-step/publish; simplify page render |
| `views/settings-bot-flow.ejs` | Two-pane canvas + panel + preview overlay |
| `public/css/flow-builder.css` | Canvas/panel/phone styles |
| `public/js/flow-builder.js` | Drawflow wiring, panel, draft save, preview, publish |
| `docs/runbooks/phase6b-visual-flow-builder.md` | Cutover notes |
| Update | `docs/superpowers/plans/2026-08-09-admin-ux-overhaul-roadmap.md` |

---

### Task 1: Migration + runbook + roadmap

**Files:**
- Create: `supabase/migrations/20260815000000_bot_flow_draft.sql`
- Create: `docs/runbooks/phase6b-visual-flow-builder.md`
- Modify: `docs/superpowers/plans/2026-08-09-admin-ux-overhaul-roadmap.md`
- Create (if missing): `docs/superpowers/specs/2026-08-09-visual-flow-builder-design.md`

**Interfaces:**
- Consumes: existing `BotFlow` / `BotFlowNode`
- Produces: draft columns + node positions

- [ ] **Step 1: Write migration**

```sql
-- supabase/migrations/20260815000000_bot_flow_draft.sql
SET search_path TO public, extensions;

ALTER TABLE "BotFlow"
  ADD COLUMN IF NOT EXISTS draft JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS draft_updated_at TIMESTAMPTZ DEFAULT NULL;

ALTER TABLE "BotFlowNode"
  ADD COLUMN IF NOT EXISTS pos_x DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pos_y DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Simple left-to-right seed layout for known keys (idempotent updates)
UPDATE "BotFlowNode" SET pos_x = 80,  pos_y = 140 WHERE key = 'welcome';
UPDATE "BotFlowNode" SET pos_x = 420, pos_y = 40  WHERE key = 'product_list';
UPDATE "BotFlowNode" SET pos_x = 420, pos_y = 160 WHERE key = 'kategori_menu';
UPDATE "BotFlowNode" SET pos_x = 420, pos_y = 280 WHERE key = 'riwayat';
UPDATE "BotFlowNode" SET pos_x = 420, pos_y = 400 WHERE key = 'stok';
UPDATE "BotFlowNode" SET pos_x = 760, pos_y = 140 WHERE key = 'saldo_menu';
UPDATE "BotFlowNode" SET pos_x = 760, pos_y = 300 WHERE key = 'cara_order';
```

- [ ] **Step 2: Write runbook**

Create `docs/runbooks/phase6b-visual-flow-builder.md`:

```markdown
# Phase 6b cutover — Visual flow builder

1. Merge PR → Railway deploys (old form gone; canvas loads).
2. `supabase db push` (adds draft + pos columns).
3. Open Dashboard → Settings → Bot Flow. Confirm canvas shows nodes.
4. Edit welcome text → Save draft → bot /start unchanged.
5. Preview → phone mock shows draft text.
6. Publish → within ~10s live bot (engine ON) shows new text.
7. Rollback live copy: re-edit + Publish previous text, or restore BotCopy row in Studio.
```

- [ ] **Step 3: Update roadmap**

Add row (or footnote) after Phase 6:

| 6b — Visual flow builder | [2026-08-09-visual-flow-builder.md](./2026-08-09-visual-flow-builder.md) | **Plan ready** |

Keep Phase 6 **Done**.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260815000000_bot_flow_draft.sql \
  docs/runbooks/phase6b-visual-flow-builder.md \
  docs/superpowers/plans/2026-08-09-admin-ux-overhaul-roadmap.md \
  docs/superpowers/specs/2026-08-09-visual-flow-builder-design.md \
  docs/superpowers/plans/2026-08-09-visual-flow-builder.md
git commit -m "docs(phase6b): visual flow builder design and plan"
```

---

### Task 2: `lib/flow-draft.js` + tests (TDD)

**Files:**
- Create: `lib/flow-draft.js`
- Create: `test/flow-draft.test.js`

**Interfaces:**
- Consumes: nothing (pure)
- Produces:
  - `validateDraft(draft, publishedKeys: string[]): { ok: boolean, errors: string[] }`
  - `draftFromPublished(nodes, copyByKey: Record<string,string>): object`
  - `applyWire(draft, fromKey, buttonFlatIndex, toKey): object` — immutable update
  - `publishPlan(draft): { nodes: object[], copies: { key: string, body: string }[] }`

- [ ] **Step 1: Write failing tests**

```js
// test/flow-draft.test.js
const test = require('node:test')
const assert = require('node:assert')
const {
  validateDraft,
  draftFromPublished,
  applyWire,
  publishPlan,
} = require('../lib/flow-draft')

const KEYS = ['welcome', 'product_list', 'saldo_menu']

const baseDraft = {
  entry_key: 'welcome',
  nodes: [
    {
      key: 'welcome',
      kind: 'screen',
      screen_key: 'screen.welcome',
      action: null,
      body: 'Hi {{first_name}}',
      pos_x: 0,
      pos_y: 0,
      buttons: [[{ label: 'Go', go: 'product_list' }]],
      description: '',
    },
    {
      key: 'product_list',
      kind: 'action',
      screen_key: null,
      action: 'product_list',
      pos_x: 100,
      pos_y: 0,
      buttons: [],
      description: '',
    },
    {
      key: 'saldo_menu',
      kind: 'screen',
      screen_key: 'screen.saldo_menu',
      action: null,
      body: 'Saldo',
      pos_x: 100,
      pos_y: 100,
      buttons: [[{ label: 'Back', go: 'welcome' }]],
      description: '',
    },
  ],
}

test('validateDraft rejects unknown key', () => {
  const d = structuredClone(baseDraft)
  d.nodes.push({ key: 'nope', kind: 'screen', screen_key: 'x', buttons: [], pos_x: 0, pos_y: 0 })
  const r = validateDraft(d, KEYS)
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => /unknown key/i.test(e)))
})

test('validateDraft rejects missing published key', () => {
  const d = structuredClone(baseDraft)
  d.nodes = d.nodes.filter((n) => n.key !== 'saldo_menu')
  const r = validateDraft(d, KEYS)
  assert.equal(r.ok, false)
})

test('validateDraft rejects button with multiple modes', () => {
  const d = structuredClone(baseDraft)
  d.nodes[0].buttons = [[{ label: 'X', go: 'product_list', url: 'https://x' }]]
  const r = validateDraft(d, KEYS)
  assert.equal(r.ok, false)
})

test('draftFromPublished hydrates body from copy map', () => {
  const nodes = [
    { key: 'welcome', kind: 'screen', screen_key: 'screen.welcome', action: null, buttons: [], description: '', pos_x: 1, pos_y: 2 },
    { key: 'product_list', kind: 'action', screen_key: null, action: 'product_list', buttons: [], description: '', pos_x: 3, pos_y: 4 },
  ]
  const d = draftFromPublished(nodes, { 'screen.welcome': 'BODY' })
  assert.equal(d.nodes.find((n) => n.key === 'welcome').body, 'BODY')
  assert.equal(d.entry_key, 'welcome')
})

test('applyWire updates go target by flat button index', () => {
  const next = applyWire(baseDraft, 'welcome', 0, 'saldo_menu')
  assert.equal(next.nodes[0].buttons[0][0].go, 'saldo_menu')
  assert.equal(baseDraft.nodes[0].buttons[0][0].go, 'product_list') // immutable
})

test('publishPlan emits node patches and copy bodies', () => {
  const plan = publishPlan(baseDraft)
  assert.equal(plan.nodes.length, 3)
  assert.deepEqual(
    plan.copies.find((c) => c.key === 'screen.welcome'),
    { key: 'screen.welcome', body: 'Hi {{first_name}}' }
  )
  assert.ok(!plan.copies.some((c) => c.key == null))
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
node --test test/flow-draft.test.js
```

Expected: FAIL cannot find module `../lib/flow-draft`.

- [ ] **Step 3: Implement `lib/flow-draft.js`**

```js
// lib/flow-draft.js

function clone(x) {
  return JSON.parse(JSON.stringify(x))
}

function buttonModeCount(btn) {
  return [btn.go, btn.callback, btn.url_from, btn.url]
    .filter((v) => v !== undefined && v !== null && String(v) !== '').length
}

function validateDraft(draft, publishedKeys) {
  const errors = []
  if (!draft || typeof draft !== 'object') return { ok: false, errors: ['draft required'] }
  if (!Array.isArray(draft.nodes)) return { ok: false, errors: ['nodes must be array'] }

  const keys = draft.nodes.map((n) => n && n.key).filter(Boolean)
  const set = new Set(keys)
  for (const k of publishedKeys) {
    if (!set.has(k)) errors.push(`missing key: ${k}`)
  }
  for (const k of keys) {
    if (!publishedKeys.includes(k)) errors.push(`unknown key: ${k}`)
  }
  if (keys.length !== set.size) errors.push('duplicate keys')

  for (const n of draft.nodes) {
    if (!n || !n.key) {
      errors.push('node missing key')
      continue
    }
    if (n.kind !== 'screen' && n.kind !== 'action') errors.push(`${n.key}: bad kind`)
    if (n.kind === 'screen' && !n.screen_key) errors.push(`${n.key}: screen_key required`)
    if (n.kind === 'action' && !n.action) errors.push(`${n.key}: action required`)
    const rows = Array.isArray(n.buttons) ? n.buttons : null
    if (!rows) {
      errors.push(`${n.key}: buttons must be array`)
      continue
    }
    for (const row of rows) {
      if (!Array.isArray(row)) {
        errors.push(`${n.key}: button row must be array`)
        continue
      }
      for (const btn of row) {
        if (buttonModeCount(btn) !== 1) {
          errors.push(`${n.key}: each button needs exactly one of go|callback|url_from|url`)
        }
        if (btn.go && !publishedKeys.includes(btn.go) && !set.has(btn.go)) {
          errors.push(`${n.key}: go target unknown: ${btn.go}`)
        }
      }
    }
  }

  if (draft.entry_key && !set.has(draft.entry_key) && publishedKeys.includes(draft.entry_key) === false) {
    // entry must exist in draft nodes
  }
  if (draft.entry_key && !set.has(draft.entry_key)) {
    errors.push(`entry_key missing from nodes: ${draft.entry_key}`)
  }

  return { ok: errors.length === 0, errors }
}

function draftFromPublished(nodes, copyByKey) {
  const list = Array.isArray(nodes) ? nodes : []
  return {
    entry_key: 'welcome',
    nodes: list.map((n) => ({
      key: n.key,
      kind: n.kind,
      screen_key: n.screen_key || null,
      action: n.action || null,
      description: n.description || '',
      pos_x: Number(n.pos_x) || 0,
      pos_y: Number(n.pos_y) || 0,
      buttons: Array.isArray(n.buttons) ? clone(n.buttons) : [],
      body: n.kind === 'screen' && n.screen_key
        ? (copyByKey[n.screen_key] || '')
        : undefined,
    })),
  }
}

function flattenButtons(buttons) {
  const out = []
  for (const row of buttons || []) {
    for (const btn of row || []) out.push(btn)
  }
  return out
}

function applyWire(draft, fromKey, buttonFlatIndex, toKey) {
  const next = clone(draft)
  const node = next.nodes.find((n) => n.key === fromKey)
  if (!node) return next
  let i = 0
  for (const row of node.buttons || []) {
    for (let c = 0; c < row.length; c++) {
      if (i === buttonFlatIndex) {
        const btn = { ...row[c] }
        delete btn.callback
        delete btn.url
        delete btn.url_from
        btn.go = toKey
        row[c] = btn
        return next
      }
      i++
    }
  }
  return next
}

function publishPlan(draft) {
  const nodes = (draft.nodes || []).map((n) => ({
    key: n.key,
    kind: n.kind,
    screen_key: n.kind === 'screen' ? n.screen_key : null,
    action: n.kind === 'action' ? n.action : null,
    description: n.description || '',
    buttons: n.buttons || [],
    pos_x: Number(n.pos_x) || 0,
    pos_y: Number(n.pos_y) || 0,
  }))
  const copies = []
  for (const n of draft.nodes || []) {
    if (n.kind === 'screen' && n.screen_key && typeof n.body === 'string' && n.body.trim()) {
      copies.push({ key: n.screen_key, body: n.body })
    }
  }
  return { nodes, copies }
}

module.exports = {
  validateDraft,
  draftFromPublished,
  applyWire,
  publishPlan,
  flattenButtons,
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
node --test test/flow-draft.test.js
```

- [ ] **Step 5: Commit**

```bash
git add lib/flow-draft.js test/flow-draft.test.js
git commit -m "feat(phase6b): pure flow-draft validate/publish helpers"
```

---

### Task 3: Dashboard APIs (draft / preview / publish)

**Files:**
- Modify: `dashboard.js` (replace or extend bot-flow routes)

**Interfaces:**
- Consumes: `lib/flow-draft.js`, `runtimeSettings.bump`, supabase `BotFlow`/`BotFlowNode`/`BotCopy`
- Produces:
  - `GET /api/bot-flow` → `{ flow, publishedKeys, draft, enabled }`
  - `POST /api/bot-flow/draft` body `{ draft }` → save draft (no bump)
  - `POST /api/bot-flow/preview-step` body `{ nodeKey, vars? }` → `{ type, caption?, action?, buttons? }`
  - `POST /api/bot-flow/publish` body `{ draft? }` → apply publishPlan + bump
  - Keep `GET /settings/bot-flow` page render (slim) + `POST /settings/bot-flow/toggle`

- [ ] **Step 1: Add requires**

Near top of `dashboard.js` (with other libs):

```js
const flowDraft = require('./lib/flow-draft')
const copyLib = require('./lib/copy')
```

- [ ] **Step 2: Replace node POST form handler with JSON APIs**

Remove (or stop using) `POST /settings/bot-flow/nodes/:key` form redirect. Add:

```js
async function loadActiveFlowBundle() {
  const { data: flow, error } = await supabase
    .from('BotFlow')
    .select('*')
    .eq('is_active', true)
    .maybeSingle()
  if (error) throw error
  if (!flow) return { flow: null, nodes: [], copyByKey: {} }
  const { data: nodes, error: nErr } = await supabase
    .from('BotFlowNode')
    .select('*')
    .eq('flow_id', flow.id)
    .order('key')
  if (nErr) throw nErr
  const screenKeys = (nodes || [])
    .filter((n) => n.kind === 'screen' && n.screen_key)
    .map((n) => n.screen_key)
  let copyByKey = {}
  if (screenKeys.length) {
    const { data: copies } = await supabase
      .from('BotCopy')
      .select('key, body')
      .in('key', screenKeys)
    for (const row of copies || []) copyByKey[row.key] = row.body
  }
  return { flow, nodes: nodes || [], copyByKey }
}

app.get('/api/bot-flow', isAuthenticated, async (req, res) => {
  try {
    const { flow, nodes, copyByKey } = await loadActiveFlowBundle()
    const publishedKeys = nodes.map((n) => n.key)
    const draft = flow?.draft || flowDraft.draftFromPublished(nodes, copyByKey)
    if (flow && !draft.entry_key) draft.entry_key = flow.entry_key || 'welcome'
    const { data: flag } = await supabase
      .from('NotificationSettings')
      .select('setting_value')
      .eq('setting_key', 'flow_engine_enabled')
      .maybeSingle()
    const enabled = !!(flag?.setting_value && flag.setting_value.value === true)
    res.json({
      success: true,
      flow: flow ? { id: flow.id, name: flow.name, entry_key: flow.entry_key, draft_updated_at: flow.draft_updated_at } : null,
      publishedKeys,
      draft,
      enabled,
      actions: FLOW_ACTIONS,
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ success: false, error: e.message })
  }
})

app.post('/api/bot-flow/draft', isAuthenticated, async (req, res) => {
  try {
    const { flow, nodes } = await loadActiveFlowBundle()
    if (!flow) throw new Error('No active flow')
    const publishedKeys = nodes.map((n) => n.key)
    const draft = req.body.draft
    const v = flowDraft.validateDraft(draft, publishedKeys)
    if (!v.ok) return res.status(400).json({ success: false, errors: v.errors })
    const { error } = await supabase
      .from('BotFlow')
      .update({ draft, draft_updated_at: new Date().toISOString() })
      .eq('id', flow.id)
    if (error) throw error
    res.json({ success: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ success: false, error: e.message })
  }
})

app.post('/api/bot-flow/preview-step', isAuthenticated, async (req, res) => {
  try {
    const { flow, nodes, copyByKey } = await loadActiveFlowBundle()
    if (!flow) throw new Error('No active flow')
    const draft = req.body.draft || flow.draft || flowDraft.draftFromPublished(nodes, copyByKey)
    const nodeKey = String(req.body.nodeKey || draft.entry_key || 'welcome')
    const node = (draft.nodes || []).find((n) => n.key === nodeKey)
    if (!node) return res.status(404).json({ success: false, error: 'node not found' })
    const vars = req.body.vars || {
      first_name: 'Preview',
      nama_bot: NamaBot,
      user_count: 1,
      stok_terjual: 0,
      stok_tersedia: 0,
      saldo: 'Rp0',
    }
    if (node.kind === 'action') {
      return res.json({ success: true, type: 'action', action: node.action, key: node.key })
    }
    const body = typeof node.body === 'string' && node.body
      ? node.body
      : (copyByKey[node.screen_key] || copyLib.DEFAULTS[node.screen_key] || '')
    const caption = copyLib.render(body, vars)
    const buttons = node.buttons || []
    res.json({ success: true, type: 'screen', key: node.key, caption, buttons })
  } catch (e) {
    console.error(e)
    res.status(500).json({ success: false, error: e.message })
  }
})

app.post('/api/bot-flow/publish', isAuthenticated, async (req, res) => {
  try {
    const { flow, nodes } = await loadActiveFlowBundle()
    if (!flow) throw new Error('No active flow')
    const publishedKeys = nodes.map((n) => n.key)
    const draft = req.body.draft || flow.draft
    if (!draft) throw new Error('No draft to publish')
    const v = flowDraft.validateDraft(draft, publishedKeys)
    if (!v.ok) return res.status(400).json({ success: false, errors: v.errors })
    const plan = flowDraft.publishPlan(draft)
    for (const patch of plan.nodes) {
      const { error } = await supabase
        .from('BotFlowNode')
        .update({
          kind: patch.kind,
          screen_key: patch.screen_key,
          action: patch.action,
          description: patch.description,
          buttons: patch.buttons,
          pos_x: patch.pos_x,
          pos_y: patch.pos_y,
          updated_at: new Date().toISOString(),
        })
        .eq('flow_id', flow.id)
        .eq('key', patch.key)
      if (error) throw error
    }
    for (const c of plan.copies) {
      const { error } = await supabase
        .from('BotCopy')
        .update({ body: c.body, updated_at: new Date().toISOString() })
        .eq('key', c.key)
      if (error) throw error
    }
    await supabase
      .from('BotFlow')
      .update({ draft, draft_updated_at: new Date().toISOString() })
      .eq('id', flow.id)
    await runtimeSettings.bump()
    res.json({ success: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ success: false, error: e.message })
  }
})
```

Keep toggle route; change `GET /settings/bot-flow` to render the canvas page with minimal locals (`title`, `namaBot`, `username`, `currentPage`, `req`) — client loads `/api/bot-flow`.

- [ ] **Step 3: Commit**

```bash
git add dashboard.js
git commit -m "feat(phase6b): bot-flow draft/preview/publish JSON APIs"
```

---

### Task 4: Canvas UI (EJS + CSS + Drawflow JS)

**Files:**
- Replace: `views/settings-bot-flow.ejs`
- Create: `public/css/flow-builder.css`
- Create: `public/js/flow-builder.js`

**Interfaces:**
- Consumes: `/api/bot-flow*`, Drawflow CDN
- Produces: working two-pane editor

- [ ] **Step 1: Rewrite `views/settings-bot-flow.ejs`**

Structure (essential pieces):

```html
<!-- head: dashboard.css + drawflow CDN css + /css/flow-builder.css -->
<!-- script defer: drawflow CDN js + /js/flow-builder.js -->
<%- include('partials/sidebar') %>
<main class="main-content">
  <div class="top-bar">... pageTitle Bot Flow ...</div>
  <div class="flow-toolbar">
    <label><input type="checkbox" id="flowEnabled"> Flow engine enabled</label>
    <button type="button" id="btnSaveDraft" class="btn btn-secondary">Save draft</button>
    <button type="button" id="btnPreview" class="btn">Preview</button>
    <button type="button" id="btnPublish" class="btn btn-primary">Publish</button>
    <span id="flowStatus"></span>
  </div>
  <div class="flow-layout">
    <div id="drawflow" class="flow-canvas"></div>
    <aside id="flowPanel" class="flow-panel">
      <p class="muted">Select a node</p>
      <!-- filled by JS: key, kind, body/action, buttons table, Apply -->
    </aside>
  </div>
  <div id="previewModal" class="preview-modal hidden">
    <div class="phone-frame">
      <div id="previewCaption" class="phone-caption"></div>
      <div id="previewKeyboard" class="phone-keyboard"></div>
      <button type="button" id="previewClose">Close</button>
    </div>
  </div>
</main>
```

Drawflow CDN (pin a known version in the plan):

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/jerosoler/Drawflow/dist/drawflow.min.css">
<script src="https://cdn.jsdelivr.net/gh/jerosoler/Drawflow/dist/drawflow.min.js"></script>
```

- [ ] **Step 2: `public/css/flow-builder.css`**

Include at minimum:

- `.flow-layout { display:flex; height: calc(100vh - 160px); }`
- `.flow-canvas { flex:1; background:#f3f4f6; }`
- `.flow-panel { width:360px; border-left:1px solid #ddd; overflow:auto; padding:16px; }`
- `.preview-modal` fixed overlay; `.phone-frame` ~390×680 white card; `.hidden { display:none }`
- Screen node header green; action node header purple (SendPulse-ish, not purple-on-white full page theme — only node chrome)

- [ ] **Step 3: `public/js/flow-builder.js`**

Implement:

1. `let state = { draft, publishedKeys, enabled, selectedKey }`
2. `fetch('/api/bot-flow')` then `renderCanvas(draft)`
3. For each node, `editor.addNode(key, inputs, outputs, pos_x, pos_y, class, html, data)`  
   - screen: outputs = flat `go` button count (or 1 shared output — prefer **one output per go button** labeled with button text)  
   - action: 0 outputs, 1 input
4. On connection created/removed → update `draft.nodes[].buttons` `go` fields via indices; keep panel in sync
5. Node click → render panel (body textarea for screen; action `<select>` disabled or read-only allowlist display; buttons table)
6. Panel **Apply** → write back into `state.draft` + refresh that node’s HTML
7. `#btnSaveDraft` → `POST /api/bot-flow/draft`
8. `#btnPublish` → confirm dialog → `POST /api/bot-flow/publish`
9. `#btnPreview` → show modal; `POST /api/bot-flow/preview-step` with `{ draft, nodeKey }`; render caption + buttons; button click if `go` loads next step; if action show stub
10. Enable checkbox → existing `POST /settings/bot-flow/toggle` (form or fetch)

**Important:** Do not allow `editor.addNode` from UI toolbox. No delete node controls.

Sketch for preview button handler:

```js
async function previewGoto(nodeKey) {
  const res = await fetch('/api/bot-flow/preview-step', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ draft: state.draft, nodeKey }),
  })
  const data = await res.json()
  if (!data.success) return alert(data.error || 'preview failed')
  if (data.type === 'action') {
    document.getElementById('previewCaption').textContent =
      `Action: ${data.action}\n\nThis opens in the live bot only.`
    document.getElementById('previewKeyboard').innerHTML =
      '<button type="button" data-go="' + (state.draft.entry_key || 'welcome') + '">Back</button>'
    return
  }
  document.getElementById('previewCaption').textContent = data.caption
  // build keyboard buttons from data.buttons …
}
```

- [ ] **Step 4: Manual check + commit**

```bash
node --check dashboard.js
git add views/settings-bot-flow.ejs public/css/flow-builder.css public/js/flow-builder.js
git commit -m "feat(phase6b): Drawflow canvas editor with preview mock"
```

---

### Task 5: Apply migration + full verify + PR

**Files:** roadmap status → Done after verify

- [ ] **Step 1: Tests**

```bash
node --test
```

Expected: prior tests + `flow-draft` PASS.

- [ ] **Step 2: Migration**

```bash
supabase db push --yes
```

- [ ] **Step 3: E2E checklist**

1. Canvas shows all seeded nodes  
2. Save draft after text edit → Studio `BotFlow.draft` updated; live bot unchanged  
3. Preview mock walks welcome → action stub  
4. Publish updates `BotCopy` + node buttons; bot picks up after bump (~10s) with engine ON  
5. Cannot add/delete nodes  
6. Enable toggle still works  

- [ ] **Step 4: Mark roadmap Done, push PR**

```bash
# set 6b status to Done
git add docs/superpowers/plans/2026-08-09-admin-ux-overhaul-roadmap.md
git commit -m "docs(phase6b): mark visual flow builder done"
git push -u origin HEAD
```

---

## Spec coverage self-review

| Spec requirement | Task |
|------------------|------|
| Draft JSON on BotFlow + positions | Task 1 |
| validate / publishPlan pure helpers | Task 2 |
| Save draft / preview-step / publish APIs | Task 3 |
| Two-pane Drawflow UI + phone mock | Task 4 |
| No add/delete; navigation-only | Global + Task 4 |
| bump only on Publish | Task 3 |
| Bot runtime unchanged (published only) | Global |

## Placeholder scan

No TBD steps. Migration SQL, pure lib, API handlers, and UI file responsibilities included. Drawflow node HTML details are specified at interface level; implementers must map each draft node to `addNode` without adding toolbox create/delete.

## Type consistency

- Draft node: `{ key, kind, screen_key, action, body?, buttons, pos_x, pos_y, description }`
- `validateDraft(draft, publishedKeys)`
- `publishPlan(draft) → { nodes, copies }`
- APIs: `GET /api/bot-flow`, `POST /api/bot-flow/{draft,preview-step,publish}`
