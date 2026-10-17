# Phase 13 — Flow Builder Graph CRUD Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Flow Builder canvas add/delete, action selection, media publish, and preview media work end-to-end through draft validation and publish — closing the Phase 12 UI/backend gap.

**Architecture:** Replace Phase 6b fixed-key `validateDraft` with graph-integrity rules in `lib/flow-draft.js`. Add `diffPublishPlan(draft, publishedKeys, existingCopyKeys)` to compute INSERT/UPDATE/DELETE patches. `POST /api/bot-flow/publish` validates the draft (graph + screen message text) and the RPC argument shapes, then applies the diff atomically through `supabase.rpc('publish_bot_flow_graph', payload)`. `POST /api/bot-flow/draft` uses the same draft validation. Extend inspector UI and preview mock for action picker, media type, entry node selector, and image preview.

**Tech Stack:** Node.js 20, Express 5 + EJS, vanilla JS, Drawflow (CDN), Supabase (`BotFlow`, `BotFlowNode`, `BotCopy`), `node --test`, Railway deploy from `main`.

**Design spec:** `docs/superpowers/specs/2026-08-24-flow-builder-graph-crud-design.md`

## Global Constraints

- Navigation-only: **`screen` | `action`** — no Filter / API / Pause / Random / wait-for-reply / AI nodes
- No conditional edges or expressions (`if saldo > 0`)
- Preview = in-dashboard phone frame only — not live Telegram
- Media = URL input only — no file upload to storage this phase
- Do not expand `ACTIONS` allowlist in `lib/flow.js` beyond existing 7 actions
- Do not change checkout (`p:` / `v:` / bayar) or `FLOW_ENGINE_ENABLED` kill switch
- Keep EJS + vanilla JS + Drawflow CDN — **no React/Vue/build step**
- Tests: pure functions via `node --test` only; no Telegram mocks; no browser automation for CI
- `runtimeSettings.bump()` on Publish and enable toggle only (draft save does not bump)
- Publish is atomic via `public.publish_bot_flow_graph` (`SECURITY INVOKER`, `search_path` = `public`). Original function: `supabase/migrations/20260818000001_publish_bot_flow_graph.sql`. Payload-shape checks: `20261017225540_validate_publish_bot_flow_graph.sql` (`CREATE OR REPLACE`, same signature; does not change grants). Never apply graph changes as separate supabase-js writes — that reintroduces partial-publish risk. Handle the RPC error, including a failed `BotFlow` update, before `runtimeSettings.bump()`.

---

## File map

| File | Responsibility |
|------|----------------|
| `docs/superpowers/specs/2026-08-24-flow-builder-graph-crud-design.md` | Locked decisions + non-goals |
| `lib/flow-draft.js` | Graph `validateDraft`, screen-text checks, `diffPublishPlan`, `buildPublishRpcPayload`, `validatePublishRpcPayload`, `DEFAULT_FLOW_ACTIONS` |
| `test/flow-draft.test.js` | Unit tests for validation + diff + RPC payload shape |
| `dashboard.js` | Draft/publish routes validate then call `publish_bot_flow_graph`. Draft failures return 400 `{ errors: string[] }` (same messages as `collectDraftIssues`). Payload-shape failures return 400 `{ errors: [{ key, reason }] }` |
| `supabase/migrations/20260818000001_publish_bot_flow_graph.sql` | Atomic publish RPC (media columns + function) |
| `supabase/migrations/20261017225540_validate_publish_bot_flow_graph.sql` | `CREATE OR REPLACE` with cheap payload-shape checks |
| `public/js/flow-builder.js` | Action select, media type, entry picker, preview media |
| `views/settings-bot-flow.ejs` | Entry node `<select>`, preview media container |
| `public/css/flow-builder.css` | Entry highlight + preview image styles |
| `lib/flow-preview.js` | `buildScreenView` returns `media_url`/`media_type` |
| `test/flow-preview.test.js` | Assert media fields on screen preview |
| `docs/runbooks/phase13-flow-builder-graph-crud.md` | Manual QA checklist |
| `docs/superpowers/plans/2026-08-09-admin-ux-overhaul-roadmap.md` | Add Phase 12 (Done) + Phase 13 row |

---

### Task 1: Design spec + roadmap stub

**Files:**
- Create: `docs/superpowers/specs/2026-08-24-flow-builder-graph-crud-design.md`
- Modify: `docs/superpowers/plans/2026-08-09-admin-ux-overhaul-roadmap.md`

**Interfaces:**
- Consumes: Phase 12 plan (`2026-08-16-flow-builder-parity.md`), Phase 6b design non-goals
- Produces: written decisions referenced by Tasks 2–6

- [ ] **Step 1: Create design spec**

Create `docs/superpowers/specs/2026-08-24-flow-builder-graph-crud-design.md`:

```markdown
# Phase 13 — Flow Builder Graph CRUD (Design Spec)

**Date:** 2026-08-24
**Source:** Phase 12 parity shipped UI CRUD but backend still enforces fixed published keys

## Problem

`validateDraft(draft, publishedKeys)` rejects any key not in the published set. Publish only UPDATEs `BotFlowNode` and omits `media_url`/`media_type`. Admins cannot persist add/delete or media.

## Locked decisions

| Topic | Decision |
|-------|----------|
| Validation | Graph integrity only — unique keys, valid kinds, `entry_key` exists, `go` targets exist, actions in allowlist |
| Publish diff | `diffPublishPlan` → nodeDeletes, nodeUpserts, copyInserts, copyUpserts, entryKey |
| New screen nodes | INSERT `BotCopy` row (`kind: 'screen'`) on publish |
| Deleted nodes | DELETE `BotFlowNode`; leave orphan `BotCopy` rows |
| Entry node | Cannot delete; toolbar dropdown changes `draft.entry_key` |
| Media | Publish writes `media_url` + `media_type`; preview shows image |

## Non-goals

Filter/API/Pause/Random nodes, conditional edges, Telegram live preview, media file upload, expanding ACTIONS allowlist, checkout rewrite.
```

- [ ] **Step 2: Add roadmap rows**

In `docs/superpowers/plans/2026-08-09-admin-ux-overhaul-roadmap.md` after Phase 11:

```markdown
| 12 — Flow Builder Parity | [2026-08-16-flow-builder-parity.md](./2026-08-16-flow-builder-parity.md) | **Done** |
| 13 — Flow Builder Graph CRUD | [2026-08-24-flow-builder-graph-crud.md](./2026-08-24-flow-builder-graph-crud.md) | **Plan ready** |
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-08-24-flow-builder-graph-crud-design.md docs/superpowers/plans/2026-08-09-admin-ux-overhaul-roadmap.md
git commit -m "docs(phase13): flow builder graph CRUD design spec and roadmap row"
```

---

### Task 2: Graph validation + diffPublishPlan (pure layer)

**Files:**
- Modify: `lib/flow-draft.js`
- Modify: `test/flow-draft.test.js`

**Interfaces:**
- Consumes: existing `publishPlan`, `buttonModeCount`, `clone`
- Produces:
  - `DEFAULT_FLOW_ACTIONS` — `string[]`
  - `validateDraft(draft, options?)` → `{ ok: boolean, errors: string[] }` where `options.allowedActions` defaults to `DEFAULT_FLOW_ACTIONS`
  - `diffPublishPlan(draft, publishedKeys, existingCopyKeys)` → `{ nodeDeletes, nodeUpserts, copyInserts, copyUpserts, entryKey }`

- [ ] **Step 1: Write failing tests**

Replace tests at lines 50–63 in `test/flow-draft.test.js` (old fixed-key rejection tests) and append:

```javascript
const { diffPublishPlan, DEFAULT_FLOW_ACTIONS } = require('../lib/flow-draft')

test('validateDraft accepts new custom screen node key', () => {
  const d = structuredClone(baseDraft)
  d.nodes.push({
    key: 'screen.custom_1',
    kind: 'screen',
    screen_key: 'screen.custom_1',
    body: 'Custom',
    pos_x: 0,
    pos_y: 0,
    buttons: [],
    description: '',
  })
  const r = validateDraft(d, { allowedActions: DEFAULT_FLOW_ACTIONS })
  assert.equal(r.ok, true, r.errors.join('; '))
})

test('validateDraft rejects go target that does not exist', () => {
  const d = structuredClone(baseDraft)
  d.nodes[0].buttons = [[{ label: 'X', go: 'missing_node' }]]
  const r = validateDraft(d)
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => /missing_node/.test(e)))
})

test('validateDraft rejects unknown action', () => {
  const d = structuredClone(baseDraft)
  d.nodes[1].action = 'not_a_real_action'
  const r = validateDraft(d)
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => /action/i.test(e)))
})

test('diffPublishPlan emits nodeDeletes for removed published keys', () => {
  const d = structuredClone(baseDraft)
  d.nodes = d.nodes.filter((n) => n.key !== 'saldo_menu')
  const diff = diffPublishPlan(d, KEYS, ['screen.welcome', 'screen.saldo_menu'])
  assert.deepEqual(diff.nodeDeletes, ['saldo_menu'])
  assert.equal(diff.nodeUpserts.length, 2)
})

test('diffPublishPlan emits copyInserts for new screen_key', () => {
  const d = structuredClone(baseDraft)
  d.nodes.push({
    key: 'screen.custom_1',
    kind: 'screen',
    screen_key: 'screen.custom_1',
    body: 'Hello custom',
    pos_x: 10,
    pos_y: 10,
    buttons: [],
    description: 'Custom info screen',
  })
  const diff = diffPublishPlan(d, KEYS, ['screen.welcome', 'screen.saldo_menu'])
  assert.equal(diff.copyInserts.length, 1)
  assert.deepEqual(diff.copyInserts[0], {
    key: 'screen.custom_1',
    body: 'Hello custom',
    description: 'Custom info screen',
  })
  assert.ok(!diff.copyUpserts.some((c) => c.key === 'screen.custom_1'))
})

test('diffPublishPlan emits copyUpserts for existing screen keys', () => {
  const diff = diffPublishPlan(baseDraft, KEYS, ['screen.welcome', 'screen.saldo_menu'])
  assert.ok(diff.copyUpserts.some((c) => c.key === 'screen.welcome' && c.body === 'Hi {{first_name}}'))
})

test('diffPublishPlan sets entryKey from draft', () => {
  const d = structuredClone(baseDraft)
  d.entry_key = 'product_list'
  const diff = diffPublishPlan(d, KEYS, [])
  assert.equal(diff.entryKey, 'product_list')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/flow-draft.test.js`
Expected: FAIL — `diffPublishPlan is not a function` and/or old tests still pass on fixed-key rejection

- [ ] **Step 3: Implement validateDraft + diffPublishPlan**

In `lib/flow-draft.js`, add at top:

```javascript
const DEFAULT_FLOW_ACTIONS = [
  'product_list', 'product_card', 'kategori_menu', 'stok', 'riwayat', 'deposit_menu', 'noop',
]
```

Replace the `publishedKeys` equality block (lines 17–22) in `validateDraft` with graph rules. Change signature to:

```javascript
function validateDraft(draft, options = {}) {
  const allowedActions = options.allowedActions || DEFAULT_FLOW_ACTIONS
  const allowedSet = new Set(allowedActions)
  // ... existing draft/nodes checks ...
  if (!draft.nodes.length) errors.push('at least one node required')
  // remove publishedKeys equality loops
  for (const n of draft.nodes) {
    // ... existing kind/screen_key/button checks ...
    if (n.kind === 'action' && !allowedSet.has(n.action)) {
      errors.push(`${n.key}: unknown action: ${n.action}`)
    }
    // go targets: empty string allowed; non-empty must exist in set
    for (const row of rows) {
      for (const btn of row) {
        if (btn.go && String(btn.go).trim() && !set.has(btn.go)) {
          errors.push(`${n.key}: go target unknown: ${btn.go}`)
        }
      }
    }
  }
  // entry_key check unchanged
}
```

Add `diffPublishPlan`:

```javascript
function diffPublishPlan(draft, publishedKeys = [], existingCopyKeys = []) {
  const published = new Set(publishedKeys)
  const copyKnown = new Set(existingCopyKeys)
  const draftKeys = new Set((draft.nodes || []).map((n) => n.key))
  const plan = publishPlan(draft)

  const nodeDeletes = publishedKeys.filter((k) => !draftKeys.has(k))
  const copyInserts = []
  const copyUpserts = []
  for (const c of plan.copies) {
    if (copyKnown.has(c.key)) {
      copyUpserts.push(c)
    } else {
      const node = (draft.nodes || []).find((n) => n.screen_key === c.key)
      copyInserts.push({
        key: c.key,
        body: c.body,
        description: (node && node.description) || '',
      })
    }
  }
  return {
    nodeDeletes,
    nodeUpserts: plan.nodes,
    copyInserts,
    copyUpserts,
    entryKey: draft.entry_key || 'welcome',
  }
}
```

Export `DEFAULT_FLOW_ACTIONS` and `diffPublishPlan` from `module.exports`.

Remove old tests `validateDraft rejects unknown key` and `validateDraft rejects missing published key`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/flow-draft.test.js`
Expected: PASS (all tests in file)

- [ ] **Step 5: Commit**

```bash
git add lib/flow-draft.js test/flow-draft.test.js
git commit -m "feat(phase13): graph validateDraft and diffPublishPlan for flow CRUD"
```

---

### Task 3: Dashboard draft + publish routes

**Files:**
- Modify: `dashboard.js` (`POST /api/bot-flow/draft`, `POST /api/bot-flow/publish`)

**Interfaces:**
- Consumes: `flowDraft.validateDraft(draft, { allowedActions: FLOW_ACTIONS })`, `flowDraft.diffPublishPlan(draft, publishedKeys, existingCopies)`, `flowDraft.buildPublishRpcPayload(flow.id, draft, diff)`, `flowDraft.validatePublishRpcPayload(payload)`
- Produces: working `POST /api/bot-flow/draft` and `POST /api/bot-flow/publish`. Publish applies the graph **atomically** via `publish_bot_flow_graph`. `validateDraft` failures return **400** `{ success: false, errors: string[] }` (Phase 14 message strings, including screen-text reasons). `validatePublishRpcPayload` failures return **400** `{ success: false, errors: [{ key, reason }] }`. Call `runtimeSettings.bump()` only after the RPC succeeds.

Shipped publish path (do **not** reintroduce per-row supabase-js writes):

```javascript
app.post('/api/bot-flow/publish', isAuthenticated, async (req, res) => {
  try {
    const { flow, nodes, existingCopies } = await loadActiveFlowBundle()
    if (!flow) throw new Error('No active flow')
    const publishedKeys = nodes.map((n) => n.key)
    const draft = req.body.draft || flow.draft
    if (!draft) throw new Error('No draft to publish')

    const v = flowDraft.validateDraft(draft, { allowedActions: FLOW_ACTIONS })
    if (!v.ok) {
      return res.status(400).json({ success: false, errors: v.errors })
    }

    const diff = flowDraft.diffPublishPlan(draft, publishedKeys, existingCopies)
    const payload = flowDraft.buildPublishRpcPayload(flow.id, draft, diff)
    const rpcV = flowDraft.validatePublishRpcPayload(payload)
    if (!rpcV.ok) {
      return res.status(400).json({ success: false, errors: rpcV.errors })
    }
    const { error } = await supabase.rpc('publish_bot_flow_graph', payload)
    if (error) throw error

    await runtimeSettings.bump()
    res.json({ success: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ success: false, error: e.message })
  }
})
```

`validateDraft` now also rejects screen nodes whose `body` is empty, exceeds Telegram's 1024-character **caption** limit when `media_url` is set (4096 for plain text with no media), or is invalid legacy Markdown (`parse_mode: 'Markdown'`). Those checks live in `collectDraftIssues`, so the canvas and the 400 response share one message list. The draft route returns that string list. Payload-shape failures stay `{ key, reason }` objects.

Draft save (`POST /api/bot-flow/draft`) runs the same `validateDraft` and returns the same 400 shape; it does not bump runtime settings.

Empty, over-limit, or invalid-Markdown screen bodies must 400 before the RPC. The SQL function additionally rejects malformed upsert/copy JSON so a cast/constraint failure is not the first signal.

---

### Task 4: Inspector UI — action picker, media type, entry node

**Files:**
- Modify: `views/settings-bot-flow.ejs` (~14–33)
- Modify: `public/js/flow-builder.js` (~313–355, ~517–530, canvas render)
- Modify: `public/css/flow-builder.css`

**Interfaces:**
- Consumes: `state.actions` from `GET /api/bot-flow`
- Produces: editable `node.action`, `node.media_type`, `state.draft.entry_key`, `.is-entry` canvas class

- [ ] **Step 1: Add entry node selector to toolbar**

In `views/settings-bot-flow.ejs` inside `.flow-toolbar-actions` before Save draft:

```html
<label class="flow-entry-picker">
    Entry node
    <select id="entryKeySelect" aria-label="Flow entry node"></select>
</label>
```

- [ ] **Step 2: Replace readonly action field with select**

In `public/js/flow-builder.js` `renderPanel()`, replace the action branch (~352–355):

```javascript
} else {
  html += '<div class="field"><label>Action</label><select id="panelAction">'
  ;(state.actions || []).forEach((a) => {
    html += '<option value="' + escapeHtml(a) + '"' + (node.action === a ? ' selected' : '') + '>' + escapeHtml(a) + '</option>'
  })
  html += '</select></div>'
  html += '<p class="flow-panel-hint">Action nodes open live catalog tools in the bot.</p>'
}
```

After media URL input (~322), add media type select:

```javascript
html += '<div class="field"><label>Media type</label>'
html += '<select id="panelMediaType">'
;['photo', 'document'].forEach((t) => {
  html += '<option value="' + t + '"' + ((node.media_type || 'photo') === t ? ' selected' : '') + '>' + t + '</option>'
})
html += '</select></div>'
```

In `applyPanelToDraft()` (~525–530), persist:

```javascript
const mediaTypeEl = document.getElementById('panelMediaType')
if (mediaTypeEl) node.media_type = mediaTypeEl.value || 'photo'
// action branch:
const actionEl = document.getElementById('panelAction')
if (actionEl && node.kind === 'action') node.action = actionEl.value
```

- [ ] **Step 3: Wire entry node dropdown + canvas highlight**

Add functions:

```javascript
function renderEntryKeySelect() {
  const sel = document.getElementById('entryKeySelect')
  if (!sel || !state.draft) return
  const cur = state.draft.entry_key || 'welcome'
  sel.innerHTML = ''
  for (const n of state.draft.nodes || []) {
    const opt = document.createElement('option')
    opt.value = n.key
    opt.textContent = n.key
    if (n.key === cur) opt.selected = true
    sel.appendChild(opt)
  }
}

function bindEntryKeySelect() {
  const sel = document.getElementById('entryKeySelect')
  if (!sel) return
  sel.addEventListener('change', function () {
    if (state.draft) {
      state.draft.entry_key = sel.value
      renderCanvas()
      setStatus('Entry node set to ' + sel.value, 'ok')
    }
  })
}
```

Call `renderEntryKeySelect()` after `renderCanvas()` and on load. In canvas node HTML builder, add class `is-entry` when `node.key === state.draft.entry_key`.

CSS in `public/css/flow-builder.css`:

```css
.flow-entry-picker { display: inline-flex; align-items: center; gap: 6px; font-size: 0.875rem; }
.drawflow-node.is-entry .drawflow_content_node { outline: 2px solid var(--teal-600, #0F766E); }
```

- [ ] **Step 4: Manual check**

1. Select action node → change Action dropdown to `riwayat` → Apply → Save draft → reload → value persists in draft
2. Entry dropdown changes highlight on canvas

- [ ] **Step 5: Commit**

```bash
git add views/settings-bot-flow.ejs public/js/flow-builder.js public/css/flow-builder.css
git commit -m "feat(phase13): action picker, media type, entry node selector in flow builder"
```

---

### Task 5: Preview media + markdown parity

**Files:**
- Modify: `lib/flow-preview.js` (`buildScreenView`)
- Modify: `test/flow-preview.test.js`
- Modify: `views/settings-bot-flow.ejs` (preview modal markup)
- Modify: `public/js/flow-builder.js` (`previewStep`, `formatCaptionHtml`)
- Modify: `public/css/flow-builder.css`

**Interfaces:**
- Consumes: `buildScreenView` from `lib/flow-preview.js`
- Produces: preview JSON includes `media_url`/`media_type`; phone mock renders `<img>`

- [ ] **Step 1: Write failing test**

Add to `test/flow-preview.test.js`:

```javascript
const { buildScreenView } = muatPreview()

test('buildScreenView includes media_url and media_type from node', () => {
  const view = buildScreenView({
    key: 'welcome',
    kind: 'screen',
    screen_key: 'screen.welcome',
    body: 'Hi',
    media_url: 'https://example.com/banner.png',
    media_type: 'photo',
    buttons: [],
  }, {}, { first_name: 'Preview' })
  assert.equal(view.media_url, 'https://example.com/banner.png')
  assert.equal(view.media_type, 'photo')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/flow-preview.test.js`
Expected: FAIL — `view.media_url` is `undefined`

- [ ] **Step 3: Implement buildScreenView media fields**

In `lib/flow-preview.js` `buildScreenView`, extend return:

```javascript
return {
  type: 'screen',
  key: node.key,
  caption,
  buttons: resolveButtons(node.buttons, copyByKey, vars),
  media_url: node.media_url || null,
  media_type: node.media_type || 'photo',
}
```

- [ ] **Step 4: Update preview modal + client renderer**

In `views/settings-bot-flow.ejs`, inside `.phone-frame` before `#previewCaption`:

```html
<div id="previewMedia" class="phone-media hidden"></div>
```

In `public/js/flow-builder.js` `previewStep()` after setting caption:

```javascript
const mediaEl = document.getElementById('previewMedia')
if (mediaEl) {
  if (data.media_url) {
    mediaEl.classList.remove('hidden')
    mediaEl.innerHTML = '<img src="' + escapeHtml(data.media_url) + '" alt="" onerror="this.parentElement.classList.add(\'hidden\')">'
  } else {
    mediaEl.classList.add('hidden')
    mediaEl.innerHTML = ''
  }
}
```

Replace `formatCaptionHtml` with shared logic matching `lib/flow-preview.js` `renderTelegramMarkdown` (copy regex for code + links):

```javascript
function formatCaptionHtml(caption) {
  if (!caption) return ''
  let s = escapeHtml(caption)
  s = s.replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>')
  s = s.replace(/_([^_\n]+)_/g, '<em>$1</em>')
  s = s.replace(/~([^~\n]+)~/g, '<s>$1</s>')
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>')
  s = s.replace(/\[(.*?)\]\((.*?)\)/g, function (_m, label, url) {
    const trimmed = String(url).trim()
    const ok = /^https?:\/\//i.test(trimmed) || /^tg:\/\//i.test(trimmed)
    const href = ok ? encodeURI(trimmed).replace(/"/g, '&quot;') : '#'
    return '<a href="' + href + '" target="_blank" rel="noopener">' + label + '</a>'
  })
  return s
}
```

CSS:

```css
.phone-media img { width: 100%; max-height: 200px; object-fit: cover; border-radius: 8px 8px 0 0; }
.phone-media.hidden { display: none; }
```

- [ ] **Step 5: Run tests**

Run: `node --test test/flow-preview.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/flow-preview.js test/flow-preview.test.js views/settings-bot-flow.ejs public/js/flow-builder.js public/css/flow-builder.css
git commit -m "feat(phase13): preview media image and markdown link/code parity"
```

---

### Task 6: Verify + runbook + roadmap Done

**Files:**
- Create: `docs/runbooks/phase13-flow-builder-graph-crud.md`
- Modify: `docs/superpowers/plans/2026-08-09-admin-ux-overhaul-roadmap.md`

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: all tests PASS

Run: `node --test test/flow-draft.test.js test/flow-preview.test.js test/flow.test.js`
Expected: PASS

- [ ] **Step 2: Write runbook**

Create `docs/runbooks/phase13-flow-builder-graph-crud.md`:

```markdown
# Phase 13 — Flow Builder Graph CRUD

## QA checklist

1. `/settings/bot-flow` — add Message Node → Save draft → reload → node in draft
2. Publish → new `BotFlowNode` row + `BotCopy` row for `screen.custom_*`
3. Delete non-entry node → Publish → row removed from DB
4. Set media URL + type photo → Publish → Telegram `/start` shows photo caption (engine on)
5. Action node: change to `riwayat` → Publish → bot opens riwayat
6. Entry dropdown → Publish → `/start` uses new entry screen
7. Preview shows image above caption when media URL set
8. Orphan BotCopy after delete: row remains in Global Strings (expected)

## Rollback

Re-publish a saved draft JSON from before changes, or restore `BotFlowNode`/`BotCopy` from Supabase backup.
```

- [ ] **Step 3: Mark roadmap Done**

In roadmap, set Phase 13 status to **Done**.

- [ ] **Step 4: Commit**

```bash
git add docs/runbooks/phase13-flow-builder-graph-crud.md docs/superpowers/plans/2026-08-09-admin-ux-overhaul-roadmap.md
git commit -m "docs(phase13): runbook and roadmap done"
```

---

## Success criteria

1. Add/delete nodes survives Save draft + Publish without `unknown key` errors
2. New screen nodes get `BotCopy` rows and render in live bot
3. `media_url` / `media_type` persist through Publish
4. Action type editable from `FLOW_ACTIONS` without code changes
5. Preview mock shows attached media
6. `node --test` covers `diffPublishPlan` and graph validation
7. No regression to checkout or `FLOW_ENGINE_ENABLED` kill switch

## Self-review (spec coverage)

| Spec requirement | Task |
|------------------|------|
| Graph validation (not fixed keys) | Task 2 |
| diffPublishPlan INSERT/DELETE | Task 2, 3 |
| BotCopy INSERT for new screens | Task 3 |
| Media publish fields | Task 3 |
| Action picker | Task 4 |
| Entry node selector | Task 4 |
| Preview media | Task 5 |
| Roadmap + runbook | Task 1, 6 |
| Non-goals respected | Global Constraints |
