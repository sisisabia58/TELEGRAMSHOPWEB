# Flow Builder Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Achieve Domino / Typebot-style Flow Builder parity in Teleshop using native Drawflow + EJS + Express with full WYSIWYG text composition, dynamic button CRUD, canvas node CRUD, media attachments, and Global Strings drawer.

**Architecture:** Extend existing EJS + Drawflow frontend (`views/settings-bot-flow.ejs`, `public/js/flow-builder.js`, `public/css/flow-builder.css`) and backend draft/flow runtime (`lib/flow-draft.js`, `lib/flow.js`, `lib/copy.js`) to support dynamic rich text editing, dynamic buttons CRUD, media preview & dispatch, global copy drawer modal, and graph CRUD operations.

**Tech Stack:** Node.js, Express, EJS, Drawflow, Supabase Postgres, Vanilla JS/CSS, Node test runner (`node --test`).

**Spec:** `docs/superpowers/specs/2026-08-09-visual-flow-builder-design.md`

## Global Constraints

- Retain Teleshop's existing Express + EJS + vanilla JS + Drawflow architecture without introducing third-party React or monorepo dependencies.
- Telegram Markdown syntax (`*bold*`, `_italic_`, `~strikethrough~`, `` `code` ``, `[text](url)`) for rich text formatting.
- Dynamic variable insertion keywords: `{{first_name}}`, `{{saldo}}`, `{{username}}`, `{{user_id}}`.
- Database backward compatibility for `bot_flow_node` with new `media_url` and `media_type` columns via Supabase SQL migration.
- Clean separation: unit test coverage for `lib/flow-draft.js`, `lib/flow.js`, and `lib/copy.js` using `node --test`.

---

### Task 1: Media Database Schema & Flow Draft Support (Backend Foundation)

**Files:**
- Create: `supabase/migrations/20260817000000_bot_flow_media.sql`
- Modify: [lib/flow-draft.js](file:///d:/teleshopweb/TELEGRAMSHOPWEB/lib/flow-draft.js#L61-L130)
- Test: [test/flow-draft.test.js](file:///d:/teleshopweb/TELEGRAMSHOPWEB/test/flow-draft.test.js)

**Interfaces:**
- Consumes: Existing `bot_flow_node` schema and `draftFromPublished` / `publishPlan` functions.
- Produces: Extended draft node objects containing `media_url: string|null` and `media_type: 'photo'|'document'`.

- [ ] **Step 1: Write the failing test for draft media handling**

Add to `test/flow-draft.test.js`:

```javascript
test('draftFromPublished and publishPlan preserve media_url and media_type', () => {
  const nodes = [
    {
      key: 'welcome',
      kind: 'screen',
      screen_key: 'screen.welcome',
      pos_x: 0,
      pos_y: 0,
      buttons: [],
      media_url: 'https://example.com/banner.png',
      media_type: 'photo',
    },
  ]
  const copyByKey = { 'screen.welcome': 'Halo!' }
  const draft = draftFromPublished(nodes, copyByKey, 'welcome')
  assert.strictEqual(draft.nodes[0].media_url, 'https://example.com/banner.png')
  assert.strictEqual(draft.nodes[0].media_type, 'photo')

  const plan = publishPlan(draft)
  assert.strictEqual(plan.nodes[0].media_url, 'https://example.com/banner.png')
  assert.strictEqual(plan.nodes[0].media_type, 'photo')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/flow-draft.test.js`
Expected: FAIL with assertion error `undefined !== 'https://example.com/banner.png'`

- [ ] **Step 3: Write SQL migration and update flow-draft.js**

Create `supabase/migrations/20260817000000_bot_flow_media.sql`:
```sql
-- Migration: Add media support to bot_flow_node
ALTER TABLE bot_flow_node 
ADD COLUMN IF NOT EXISTS media_url TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS media_type VARCHAR(20) DEFAULT 'photo';
```

Modify `lib/flow-draft.js`:
In `draftFromPublished(nodes, copyByKey, entryKey)`:
```javascript
media_url: n.media_url || null,
media_type: n.media_type || 'photo',
```

In `publishPlan(draft)`:
```javascript
media_url: n.media_url || null,
media_type: n.media_type || 'photo',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/flow-draft.test.js`
Expected: PASS (All tests in suite pass)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260817000000_bot_flow_media.sql lib/flow-draft.js test/flow-draft.test.js
git commit -m "feat(flow): add media_url and media_type schema and draft support"
```

---

### Task 2: Bot Runtime Photo & Caption Dispatch (Backend Runtime)

**Files:**
- Modify: [lib/flow.js](file:///d:/teleshopweb/TELEGRAMSHOPWEB/lib/flow.js#L100-L170)
- Test: [test/flow.test.js](file:///d:/teleshopweb/TELEGRAMSHOPWEB/test/flow.test.js)

**Interfaces:**
- Consumes: Node `media_url` and `media_type` from `getNode(key)`
- Produces: `dispatchFlowScreen(bot, chatId, node, messageId)` helper that dispatches `sendPhoto` / `editMessageCaption` when `media_url` is set, or `sendMessage` / `editMessageText` when empty.

- [ ] **Step 1: Write the failing test for media dispatch routing**

Add to `test/flow.test.js`:

```javascript
test('dispatchFlowScreen selects sendPhoto when media_url is present', async () => {
  let dispatchedMethod = null
  let dispatchedPayload = null
  const mockBot = {
    sendPhoto: async (chatId, photo, opts) => {
      dispatchedMethod = 'sendPhoto'
      dispatchedPayload = { chatId, photo, opts }
    },
    sendMessage: async (chatId, text, opts) => {
      dispatchedMethod = 'sendMessage'
      dispatchedPayload = { chatId, text, opts }
    },
  }
  const mediaNode = {
    key: 'welcome',
    kind: 'screen',
    screen_key: 'screen.welcome',
    media_url: 'https://example.com/logo.jpg',
    media_type: 'photo',
    buttons: [],
  }

  await flow.dispatchFlowScreen(mockBot, 12345, mediaNode, null, 'Welcome Text')
  assert.strictEqual(dispatchedMethod, 'sendPhoto')
  assert.strictEqual(dispatchedPayload.photo, 'https://example.com/logo.jpg')
  assert.strictEqual(dispatchedPayload.opts.caption, 'Welcome Text')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/flow.test.js`
Expected: FAIL with `dispatchFlowScreen is not a function`

- [ ] **Step 3: Implement dispatchFlowScreen in lib/flow.js**

Export and implement `dispatchFlowScreen` in `lib/flow.js`:

```javascript
async function dispatchFlowScreen(bot, chatId, node, messageId, bodyText, extraOpts = {}) {
  const keyboard = buildKeyboard(node, extraOpts.urlResolver)
  const parse_mode = 'Markdown'

  if (node && node.media_url) {
    if (messageId) {
      try {
        return await bot.editMessageCaption(bodyText, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: keyboard,
          parse_mode,
        })
      } catch (err) {
        // Fallback to sending new photo message if edit caption fails
        return await bot.sendPhoto(chatId, node.media_url, {
          caption: bodyText,
          reply_markup: keyboard,
          parse_mode,
        })
      }
    } else {
      return await bot.sendPhoto(chatId, node.media_url, {
        caption: bodyText,
        reply_markup: keyboard,
        parse_mode,
      })
    }
  } else {
    if (messageId) {
      return await bot.editMessageText(bodyText, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: keyboard,
        parse_mode,
      })
    } else {
      return await bot.sendMessage(chatId, bodyText, {
        reply_markup: keyboard,
        parse_mode,
      })
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/flow.test.js`
Expected: PASS (All tests in suite pass)

- [ ] **Step 5: Commit**

```bash
git add lib/flow.js test/flow.test.js
git commit -m "feat(flow): implement dispatchFlowScreen with media sendPhoto support"
```

---

### Task 3: Node Composer UI - Toolbar, Variable Picker & Live Preview (Frontend UX)

**Files:**
- Modify: [views/settings-bot-flow.ejs](file:///d:/teleshopweb/TELEGRAMSHOPWEB/views/settings-bot-flow.ejs#L29-L37)
- Modify: [public/css/flow-builder.css](file:///d:/teleshopweb/TELEGRAMSHOPWEB/public/css/flow-builder.css#L1-L200)
- Modify: [public/js/flow-builder.js](file:///d:/teleshopweb/TELEGRAMSHOPWEB/public/js/flow-builder.js#L150-L300)
- Test: [test/flow-preview.test.js](file:///d:/teleshopweb/TELEGRAMSHOPWEB/test/flow-preview.test.js)

**Interfaces:**
- Consumes: EJS `#flowPanel` markup, Drawflow selected node state.
- Produces: Formatting toolbar helpers (`applyFormatting(wrapper)`), Variable dropup menu (`insertVariable(varName)`), and live preview strip synchronization.

- [ ] **Step 1: Write the failing test for composer markup rendering**

Add to `test/flow-preview.test.js`:

```javascript
test('renderTelegramMarkdown converts Telegram formatting to HTML snippet', () => {
  const input = '*Halo* _user_ ~strikethrough~ `code` [link](https://example.com)'
  const html = flowPreview.renderTelegramMarkdown(input)
  assert.strictEqual(
    html,
    '<b>Halo</b> <i>user</i> <del>strikethrough</del> <code>code</code> <a href="https://example.com" target="_blank">link</a>'
  )
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/flow-preview.test.js`
Expected: FAIL with `renderTelegramMarkdown is not a function`

- [ ] **Step 3: Implement renderTelegramMarkdown and EJS / JS composer panels**

In `lib/flow-preview.js` (or client helper):
```javascript
function renderTelegramMarkdown(text) {
  if (!text) return ''
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*(.*?)\*/g, '<b>$1</b>')
    .replace(/_(.*?)_/g, '<i>$1</i>')
    .replace(/~(.*?)~/g, '<del>$1</del>')
    .replace(/`(.*?)`/g, '<code>$1</code>')
    .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank">$1</a>')
}
```

Update `views/settings-bot-flow.ejs`:
Replace `#flowPanel` inner HTML template with structured inspector sections (Media, Text with toolbar + variable dropup menu, Buttons list, Advanced metadata).

Update `public/js/flow-builder.js`:
Add text selection formatting functions:
```javascript
function applyFormatting(syntaxBefore, syntaxAfter) {
  const textarea = document.getElementById('panelBodyText')
  if (!textarea) return
  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  const sel = textarea.value.substring(start, end)
  const replacement = syntaxBefore + (sel || 'text') + (syntaxAfter || syntaxBefore)
  textarea.value = textarea.value.substring(0, start) + replacement + textarea.value.substring(end)
  textarea.dispatchEvent(new Event('input'))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/flow-preview.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add views/settings-bot-flow.ejs public/css/flow-builder.css public/js/flow-builder.js lib/flow-preview.js test/flow-preview.test.js
git commit -m "feat(flow-builder): implement rich text formatting toolbar, variable picker, and live preview"
```

---

### Task 4: Dynamic Button CRUD & Copy Key Sync (Frontend & Backend Integration)

**Files:**
- Modify: [public/js/flow-builder.js](file:///d:/teleshopweb/TELEGRAMSHOPWEB/public/js/flow-builder.js#L300-L450)
- Modify: [lib/flow-draft.js](file:///d:/teleshopweb/TELEGRAMSHOPWEB/lib/flow-draft.js#L80-L120)
- Test: [test/flow-draft.test.js](file:///d:/teleshopweb/TELEGRAMSHOPWEB/test/flow-draft.test.js)

**Interfaces:**
- Consumes: Node `buttons` matrix structure (`btn[][]`).
- Produces: Button management UI (Add Button, Delete Button, Reorder Up/Down, Mode Selector `go`|`url`|`callback`|`url_from`) with auto label key mapping (`btn.<screen_key>.<index>`).

- [ ] **Step 1: Write the failing test for button reordering & key generation**

Add to `test/flow-draft.test.js`:

```javascript
test('reorderButtons and generateButtonLabelKey maintain valid button rows', () => {
  const buttons = [
    [{ label: 'B1', go: 'step1' }],
    [{ label: 'B2', go: 'step2' }],
  ]
  const reordered = reorderButtonRow(buttons, 0, 1) // move row 0 down
  assert.strictEqual(reordered[0][0].label, 'B2')
  assert.strictEqual(reordered[1][0].label, 'B1')

  const labelKey = generateButtonLabelKey('screen.welcome', 0)
  assert.strictEqual(labelKey, 'btn.welcome.0')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/flow-draft.test.js`
Expected: FAIL with `reorderButtonRow is not defined`

- [ ] **Step 3: Implement button CRUD functions in flow-draft.js and flow-builder.js**

In `lib/flow-draft.js`:
```javascript
function generateButtonLabelKey(screenKey, index) {
  const base = String(screenKey || 'node').replace(/^screen\./, '')
  return `btn.${base}.${index}`
}

function reorderButtonRow(buttons, fromIdx, toIdx) {
  const copy = clone(buttons || [])
  if (fromIdx < 0 || fromIdx >= copy.length || toIdx < 0 || toIdx >= copy.length) return copy
  const [moved] = copy.splice(fromIdx, 1)
  copy.splice(toIdx, 0, moved)
  return copy
}
```

In `public/js/flow-builder.js`:
Wire "+ Add Button", "Delete Button", "Move Up", and "Move Down" buttons in the inspector panel to mutate `node.buttons` and refresh Drawflow node cards.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/flow-draft.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/flow-draft.js public/js/flow-builder.js test/flow-draft.test.js
git commit -m "feat(flow-builder): add dynamic button CRUD and label key synchronization"
```

---

### Task 5: Canvas Node Graph CRUD & View Controls (Frontend Graph)

**Files:**
- Modify: [views/settings-bot-flow.ejs](file:///d:/teleshopweb/TELEGRAMSHOPWEB/views/settings-bot-flow.ejs#L14-L26)
- Modify: [public/js/flow-builder.js](file:///d:/teleshopweb/TELEGRAMSHOPWEB/public/js/flow-builder.js#L450-L600)
- Modify: [public/css/flow-builder.css](file:///d:/teleshopweb/TELEGRAMSHOPWEB/public/css/flow-builder.css#L200-L350)
- Test: [test/flow-preview.test.js](file:///d:/teleshopweb/TELEGRAMSHOPWEB/test/flow-preview.test.js)

**Interfaces:**
- Consumes: Drawflow editor instance (`editor.addNode()`, `editor.removeNodeId()`, `editor.zoom_in()`)
- Produces: Flow canvas header controls (`+ Message Node`, `+ Action Node`, `Zoom In (+)`, `Zoom Out (-)`, `Fit View (⛶)`), unique `screen_key` assignment, and node removal handlers.

- [ ] **Step 1: Write the failing test for node key generation**

Add to `test/flow-preview.test.js`:

```javascript
test('generateUniqueNodeKey creates non-colliding screen key', () => {
  const existingKeys = ['screen.welcome', 'screen.custom_1']
  const newKey = generateUniqueNodeKey('screen', existingKeys)
  assert.strictEqual(newKey, 'screen.custom_2')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/flow-preview.test.js`
Expected: FAIL with `generateUniqueNodeKey is not defined`

- [ ] **Step 3: Implement canvas graph operations in flow-builder.js & EJS**

In `views/settings-bot-flow.ejs`:
Add toolbar buttons in `.flow-toolbar-actions`:
```html
<button type="button" id="btnAddMessageNode" class="btn btn-secondary">+ Message Node</button>
<button type="button" id="btnAddActionNode" class="btn btn-secondary">+ Action Node</button>
<div class="zoom-controls">
  <button type="button" id="btnZoomIn" title="Zoom In">+</button>
  <button type="button" id="btnZoomOut" title="Zoom Out">-</button>
  <button type="button" id="btnFitView" title="Reset View">⛶</button>
</div>
```

In `public/js/flow-builder.js`:
Implement `generateUniqueNodeKey`, `addMessageNode()`, `addActionNode()`, and wire zoom events to `editor.zoom_in()`, `editor.zoom_out()`, and `editor.zoom_reset()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/flow-preview.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add views/settings-bot-flow.ejs public/js/flow-builder.js public/css/flow-builder.css test/flow-preview.test.js
git commit -m "feat(flow-builder): implement node CRUD operations and canvas zoom controls"
```

---

### Task 6: Global Strings Drawer Modal & Sidebar Navigation (Frontend & Copy Management)

**Files:**
- Modify: [views/settings-bot-flow.ejs](file:///d:/teleshopweb/TELEGRAMSHOPWEB/views/settings-bot-flow.ejs#L38-L55)
- Modify: [views/partials/sidebar.ejs](file:///d:/teleshopweb/TELEGRAMSHOPWEB/views/partials/sidebar.ejs#L40-L70)
- Modify: [public/js/flow-builder.js](file:///d:/teleshopweb/TELEGRAMSHOPWEB/public/js/flow-builder.js#L600-L674)
- Modify: [public/css/flow-builder.css](file:///d:/teleshopweb/TELEGRAMSHOPWEB/public/css/flow-builder.css#L350-L500)
- Test: [test/copy.test.js](file:///d:/teleshopweb/TELEGRAMSHOPWEB/test/copy.test.js)

**Interfaces:**
- Consumes: BotCopy table non-graph string keys (`err.*`, `msg.checkout.*`, `msg.deposit.*`).
- Produces: **Global Strings** drawer modal in Flow Builder, enabling full copy edits without navigating away from the graph.

- [ ] **Step 1: Write the failing test for non-graph copy key filter**

Add to `test/copy.test.js`:

```javascript
test('filterGlobalStrings isolates non-graph copy keys from screen copy keys', () => {
  const allCopy = {
    'screen.welcome': 'Welcome!',
    'err.stock_empty': 'Stok Kosong',
    'msg.checkout.success': 'Terima kasih',
    'btn.kembali': 'Kembali',
  }
  const globalStrings = copy.filterGlobalStrings(allCopy)
  assert.deepStrictEqual(Object.keys(globalStrings), ['err.stock_empty', 'msg.checkout.success', 'btn.kembali'])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/copy.test.js`
Expected: FAIL with `copy.filterGlobalStrings is not a function`

- [ ] **Step 3: Implement filterGlobalStrings and Global Strings drawer**

In `lib/copy.js`:
```javascript
function filterGlobalStrings(copyMap) {
  const out = {}
  for (const [k, v] of Object.entries(copyMap || {})) {
    if (!k.startsWith('screen.')) {
      out[k] = v
    }
  }
  return out
}
```

In `views/settings-bot-flow.ejs`:
Add Global Strings modal container `#globalStringsModal` with search filter input and copy table editor.

In `public/js/flow-builder.js`:
Add drawer toggle handler, table populated with `filterGlobalStrings`, and batch save event.

In `views/partials/sidebar.ejs`:
Update menu links to consolidate **Copy & Text** into Flow Builder with Global Strings drawer access.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/copy.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/copy.js views/settings-bot-flow.ejs views/partials/sidebar.ejs public/js/flow-builder.js public/css/flow-builder.css test/copy.test.js
git commit -m "feat(flow-builder): add Global Strings drawer modal and consolidate sidebar copy navigation"
```

---

## Verification Plan

### Automated Tests
Execute the full test suite with Node's native test runner:
```bash
npm test
```

Execute specific test suites for Flow Builder components:
```bash
node --test test/flow.test.js test/flow-draft.test.js test/copy.test.js test/flow-preview.test.js
```

### Manual Verification
1. Open `http://localhost:3000/settings/bot-flow` in browser.
2. Select a Message Node; test rich text formatting toolbar (`Bold`, `Italic`, `Link`), click `{}` variable inserter dropup, and observe real-time node card and phone preview updating.
3. Test Button CRUD: Click **+ Add Button**, change action mode to `url`, type label, click **Move Up**, and check inline badge on node card.
4. Canvas CRUD: Click **+ Message Node**, verify new node is created on canvas with clean `screen.custom_1` key, use **Zoom In (+)** and **Fit View (⛶)** controls.
5. Global Strings Drawer: Click **Global Strings** in toolbar, search `err.stock_empty`, edit string, click Save, and publish flow.
6. Telegram Bot Verification: Send `/start` in Telegram bot to verify image caption rendering and dynamic flow navigation.
