# Flow Engine (Phase 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dashboard-editable navigation flow graph (`BotFlow` / `BotFlowNode`), execute screen/action nodes from the bot behind a kill switch, and persist `BotSession.screen_key` / `nav_stack` / `banner_msg_id` without rewriting checkout.

**Architecture:** Seed one active flow mirroring today’s welcome menu. Pure `lib/flow.js` + `lib/session.js` (cache + resolve + session writes). Bot reloads flow when `runtimeSettings` version bumps (alongside copy). `FLOW_ENGINE_ENABLED` / `flow_engine_enabled` toggles engine vs legacy if-chain. Dashboard `/settings/bot-flow` edits nodes/buttons and calls `bump()`.

**Tech Stack:** Node.js 20, Express 5 + EJS, `@supabase/supabase-js`, Telegram Bot API, `node --test`, Railway + Supabase.

**Design spec:** [docs/superpowers/specs/2026-08-09-flow-engine-design.md](../specs/2026-08-09-flow-engine-design.md)

## Global Constraints

- Node kinds: **`screen` | `action` only** — no conditionals/loops in the graph
- Flow builder = **navigation only**; qty / bayar / QRIS / deliver stay in existing `index.js` handlers
- Kill switch default **off**; must not regress Phase 5 when disabled
- Shared invalidation: `runtimeSettings.bump()` after flow writes — **no second version key**
- Keep EJS + vanilla JS; no React/Vue graph canvas
- Tests: pure functions via `node --test` only; no Telegram mocks
- Leave `User`, `Deposit`, `Payment`, `Voucher`, `Varian`, `HargaTier`, `BotCopy` schema alone (read BotCopy via `copy.get`)
- Do not start Phase 7+ (no owner command retirement, no err/btn registry)
- Cart API (`lib/cart.js`) unchanged — session helpers must not clear/overwrite `cart`
- Callback `f:<nodeKey>` for engine gotos; keep `p:` / `v:` code paths
- Prepend `SET search_path TO public, extensions;` in new migrations

---

## File map

| File | Responsibility |
|------|----------------|
| `supabase/migrations/20260814000000_bot_flow.sql` | `BotFlow`, `BotFlowNode`, seed graph, seed `flow_engine_enabled` |
| `lib/session.js` | Read/write `screen_key`, `nav_stack`, `banner_msg_id` |
| `test/session.test.js` | Session nav stack / banner tests (mocked supabase) |
| `lib/flow.js` | Cache, legacy aliases, keyboard build, `goto`, `isEnabled`, `refresh` |
| `test/flow.test.js` | Resolve screen/action, keyboard, aliases, disabled path helpers |
| `index.js` | Boot refresh; dispatch `/start` + menu callbacks through engine when enabled |
| `dashboard.js` | `/settings/bot-flow` GET/POST + enable toggle |
| `views/settings-bot-flow.ejs` | Editor UI |
| `views/partials/sidebar.ejs` | Nav link |
| `docs/runbooks/phase6-flow-engine.md` | Cutover: migrate → enable → verify → disable rollback |
| Update | `docs/superpowers/plans/2026-08-09-admin-ux-overhaul-roadmap.md` |

---

### Task 1: Migration + runbook + roadmap

**Files:**
- Create: `supabase/migrations/20260814000000_bot_flow.sql`
- Create: `docs/runbooks/phase6-flow-engine.md`
- Modify: `docs/superpowers/plans/2026-08-09-admin-ux-overhaul-roadmap.md`
- Create (if missing): `docs/superpowers/specs/2026-08-09-flow-engine-design.md`

**Interfaces:**
- Consumes: Phase 1 `BotSession` columns; Phase 5 `BotCopy` keys; Phase 0 `cache_version`
- Produces: tables `BotFlow`, `BotFlowNode`; setting `flow_engine_enabled`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260814000000_bot_flow.sql
SET search_path TO public, extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS "BotFlow" (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT false,
    entry_key TEXT NOT NULL DEFAULT 'welcome',
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS "BotFlowNode" (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    flow_id UUID NOT NULL REFERENCES "BotFlow"(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('screen', 'action')),
    screen_key TEXT,
    action TEXT,
    buttons JSONB NOT NULL DEFAULT '[]'::jsonb,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    UNIQUE (flow_id, key)
);

CREATE INDEX IF NOT EXISTS idx_botflownode_flow ON "BotFlowNode"(flow_id);

DROP TRIGGER IF EXISTS update_botflow_updated_at ON "BotFlow";
CREATE TRIGGER update_botflow_updated_at
    BEFORE UPDATE ON "BotFlow"
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_botflownode_updated_at ON "BotFlowNode";
CREATE TRIGGER update_botflownode_updated_at
    BEFORE UPDATE ON "BotFlowNode"
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE "BotFlow" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for service role" ON "BotFlow";
CREATE POLICY "Allow all for service role" ON "BotFlow"
    FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE "BotFlowNode" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for service role" ON "BotFlowNode";
CREATE POLICY "Allow all for service role" ON "BotFlowNode"
    FOR ALL USING (true) WITH CHECK (true);

-- Kill switch default OFF
INSERT INTO "NotificationSettings" (setting_key, setting_value, updated_at)
VALUES ('flow_engine_enabled', '{"value": false}'::jsonb, NOW())
ON CONFLICT (setting_key) DO NOTHING;

-- Seed active flow
INSERT INTO "BotFlow" (id, name, is_active, entry_key)
VALUES ('a0000000-0000-4000-8000-000000000001', 'default', true, 'welcome')
ON CONFLICT (id) DO NOTHING;

INSERT INTO "BotFlowNode" (flow_id, key, kind, screen_key, action, buttons, description) VALUES
(
  'a0000000-0000-4000-8000-000000000001',
  'welcome',
  'screen',
  'screen.welcome',
  NULL,
  '[
    [{"label_key":"msg.menu_daftar_produk","go":"product_list"}],
    [{"label_key":"msg.menu_kategori","go":"kategori_menu"}],
    [{"label_key":"msg.menu_riwayat","go":"riwayat"},{"label_key":"msg.menu_cara_order","go":"cara_order"}],
    [{"label_key":"msg.menu_saldo","go":"saldo_menu"},{"label_key":"msg.menu_stok","go":"stok"}],
    [{"label_key":"msg.menu_channel","url_from":"channel_store"}],
    [{"label_key":"msg.menu_cs","url_from":"cs"}]
  ]'::jsonb,
  'Home /start and kembaliawal'
),
(
  'a0000000-0000-4000-8000-000000000001',
  'saldo_menu',
  'screen',
  'screen.saldo_menu',
  NULL,
  '[
    [{"label":"💳 Top Up Saldo","callback":"deposit_menu"}],
    [{"label":"📋 Riwayat Deposit","callback":"riwayatdeposit"}],
    [{"label":"🔙 Menu Utama","go":"welcome"}]
  ]'::jsonb,
  'Saldo & deposit menu'
),
(
  'a0000000-0000-4000-8000-000000000001',
  'cara_order',
  'screen',
  'screen.cara_order',
  NULL,
  '[
    [{"label":"📦 Mulai Order","go":"product_list"},{"label":"💰 Top Up Saldo","go":"saldo_menu"}],
    [{"label":"❓ FAQ","callback":"caraorder_faq"},{"label":"💳 Metode Bayar","callback":"caraorder_payment"}],
    [{"label_key":"msg.menu_cs","url_from":"cs"},{"label_key":"msg.menu_channel","url_from":"channel_store"}],
    [{"label":"🔙 Kembali","go":"welcome"}]
  ]'::jsonb,
  'Cara order guide'
),
(
  'a0000000-0000-4000-8000-000000000001',
  'product_list',
  'action',
  NULL,
  'product_list',
  '[]'::jsonb,
  'Opens sendProductPage'
),
(
  'a0000000-0000-4000-8000-000000000001',
  'kategori_menu',
  'action',
  NULL,
  'kategori_menu',
  '[]'::jsonb,
  'Opens kategori picker'
),
(
  'a0000000-0000-4000-8000-000000000001',
  'stok',
  'action',
  NULL,
  'stok',
  '[]'::jsonb,
  'Buyer stok report'
),
(
  'a0000000-0000-4000-8000-000000000001',
  'riwayat',
  'action',
  NULL,
  'riwayat',
  '[]'::jsonb,
  'Riwayat transaksi'
)
ON CONFLICT (flow_id, key) DO NOTHING;
```

- [ ] **Step 2: Write the runbook**

Create `docs/runbooks/phase6-flow-engine.md`:

```markdown
# Phase 6 cutover runbook — Flow engine

1. Merge Phase 6 PR → Railway deploys (engine defaults OFF → legacy path).
2. Apply migration: `supabase db push` (project sajffqniegtvhyopshvx).
3. Confirm Studio: `BotFlow` (1 active), `BotFlowNode` (≥7 rows), `flow_engine_enabled=false`.
4. Smoke with engine OFF: `/start`, daftar produk, qty, bayar path OK.
5. Dashboard → Settings → Bot Flow → enable toggle → Save (bumps cache).
6. Within ~10s: `/start` still works; welcome buttons use flow (callback `f:…` on new messages).
7. Edit welcome buttons JSON (swap two labels) → save → `/start` reflects change.
8. Rollback: disable toggle → Save → bot uses legacy if-chain again.
```

- [ ] **Step 3: Update roadmap**

In `docs/superpowers/plans/2026-08-09-admin-ux-overhaul-roadmap.md`:

- Phase 5 status stays **Done**
- Phase 6 → `[2026-08-09-flow-engine.md](./2026-08-09-flow-engine.md)`, status **Plan ready**

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260814000000_bot_flow.sql \
  docs/runbooks/phase6-flow-engine.md \
  docs/superpowers/plans/2026-08-09-admin-ux-overhaul-roadmap.md \
  docs/superpowers/specs/2026-08-09-flow-engine-design.md \
  docs/superpowers/plans/2026-08-09-flow-engine.md
git commit -m "docs(phase6): flow engine design, plan, migration stub"
```

---

### Task 2: `lib/session.js` + tests (TDD)

**Files:**
- Create: `lib/session.js`
- Create: `test/session.test.js`

**Interfaces:**
- Consumes: `lib/supabase.js` → table `BotSession`
- Produces:
  - `async getNav(userId): Promise<{ screen_key: string|null, nav_stack: string[], banner_msg_id: number|null }>`
  - `async setScreen(userId, screenKey, opts?: { push?: boolean }): Promise<boolean>`
  - `async setBanner(userId, messageId): Promise<boolean>`
  - `async popScreen(userId): Promise<string|null>`

- [ ] **Step 1: Write failing tests**

```js
// test/session.test.js
const test = require('node:test')
const assert = require('node:assert')

const jalurClient = require.resolve('../lib/supabase.js')
const jalurSession = require.resolve('../lib/session.js')

function muatSession(store) {
  delete require.cache[jalurSession]
  require.cache[jalurClient] = {
    id: jalurClient,
    filename: jalurClient,
    loaded: true,
    exports: {
      from(tabel) {
        assert.equal(tabel, 'BotSession')
        return {
          select() {
            return {
              eq(_c, userId) {
                return {
                  maybeSingle: async () => ({
                    data: store.get(userId) || null,
                    error: null,
                  }),
                }
              },
            }
          },
          upsert: async (row) => {
            const prev = store.get(row.user_id) || {}
            store.set(row.user_id, { ...prev, ...row })
            return { error: null }
          },
          update: (patch) => ({
            eq: async (_c, userId) => {
              const prev = store.get(userId) || { user_id: userId }
              store.set(userId, { ...prev, ...patch })
              return { error: null }
            },
          }),
        }
      },
    },
  }
  return require(jalurSession)
}

test.after(() => {
  delete require.cache[jalurClient]
  delete require.cache[jalurSession]
})

test('getNav returns defaults when no row', async () => {
  const session = muatSession(new Map())
  const nav = await session.getNav(1)
  assert.deepEqual(nav, { screen_key: null, nav_stack: [], banner_msg_id: null })
})

test('setScreen without push replaces screen_key and clears stack when push false', async () => {
  const store = new Map()
  store.set(1, { user_id: 1, screen_key: 'saldo_menu', nav_stack: ['welcome'], banner_msg_id: 9 })
  const session = muatSession(store)
  await session.setScreen(1, 'welcome', { push: false })
  const row = store.get(1)
  assert.equal(row.screen_key, 'welcome')
  assert.deepEqual(row.nav_stack, [])
})

test('setScreen with push appends previous key', async () => {
  const store = new Map()
  store.set(1, { user_id: 1, screen_key: 'welcome', nav_stack: [], banner_msg_id: null })
  const session = muatSession(store)
  await session.setScreen(1, 'saldo_menu', { push: true })
  const row = store.get(1)
  assert.equal(row.screen_key, 'saldo_menu')
  assert.deepEqual(row.nav_stack, ['welcome'])
})

test('popScreen restores previous', async () => {
  const store = new Map()
  store.set(1, { user_id: 1, screen_key: 'saldo_menu', nav_stack: ['welcome'], banner_msg_id: null })
  const session = muatSession(store)
  const prev = await session.popScreen(1)
  assert.equal(prev, 'welcome')
  assert.equal(store.get(1).screen_key, 'welcome')
  assert.deepEqual(store.get(1).nav_stack, [])
})

test('setBanner writes banner_msg_id', async () => {
  const store = new Map()
  const session = muatSession(store)
  await session.setBanner(1, 42)
  assert.equal(store.get(1).banner_msg_id, 42)
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
node --test test/session.test.js
```

Expected: FAIL `Cannot find module '../lib/session.js'`.

- [ ] **Step 3: Implement `lib/session.js`**

```js
// lib/session.js
const supabase = require('./supabase')

const TABLE = 'BotSession'
const NAV_CAP = 20

function emptyNav() {
  return { screen_key: null, nav_stack: [], banner_msg_id: null }
}

async function getNav(userId) {
  if (!userId) return emptyNav()
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select('screen_key, nav_stack, banner_msg_id')
      .eq('user_id', userId)
      .maybeSingle()
    if (error) {
      console.error('[session] getNav:', error.message)
      return emptyNav()
    }
    if (!data) return emptyNav()
    return {
      screen_key: data.screen_key ?? null,
      nav_stack: Array.isArray(data.nav_stack) ? data.nav_stack : [],
      banner_msg_id: data.banner_msg_id ?? null,
    }
  } catch (e) {
    console.error('[session] getNav:', e.message)
    return emptyNav()
  }
}

async function setScreen(userId, screenKey, opts = {}) {
  if (!userId) return false
  const push = !!opts.push
  try {
    const current = await getNav(userId)
    let nav_stack = Array.isArray(current.nav_stack) ? [...current.nav_stack] : []
    if (push && current.screen_key) {
      nav_stack.push(current.screen_key)
      if (nav_stack.length > NAV_CAP) nav_stack = nav_stack.slice(-NAV_CAP)
    } else if (!push) {
      nav_stack = []
    }
    const { error } = await supabase.from(TABLE).upsert({
      user_id: userId,
      screen_key: screenKey,
      nav_stack,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
    if (error) {
      console.error('[session] setScreen:', error.message)
      return false
    }
    return true
  } catch (e) {
    console.error('[session] setScreen:', e.message)
    return false
  }
}

async function setBanner(userId, messageId) {
  if (!userId) return false
  try {
    const { error } = await supabase.from(TABLE).upsert({
      user_id: userId,
      banner_msg_id: messageId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
    if (error) {
      console.error('[session] setBanner:', error.message)
      return false
    }
    return true
  } catch (e) {
    console.error('[session] setBanner:', e.message)
    return false
  }
}

async function popScreen(userId) {
  if (!userId) return null
  try {
    const current = await getNav(userId)
    const nav_stack = Array.isArray(current.nav_stack) ? [...current.nav_stack] : []
    const prev = nav_stack.pop()
    if (!prev) return null
    const { error } = await supabase.from(TABLE).upsert({
      user_id: userId,
      screen_key: prev,
      nav_stack,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
    if (error) {
      console.error('[session] popScreen:', error.message)
      return null
    }
    return prev
  } catch (e) {
    console.error('[session] popScreen:', e.message)
    return null
  }
}

module.exports = { getNav, setScreen, setBanner, popScreen }
```

- [ ] **Step 4: Run — expect PASS**

```bash
node --test test/session.test.js
```

- [ ] **Step 5: Commit**

```bash
git add lib/session.js test/session.test.js
git commit -m "feat(phase6): BotSession nav helpers for screen_key/nav_stack"
```

---

### Task 3: `lib/flow.js` + tests (TDD)

**Files:**
- Create: `lib/flow.js`
- Create: `test/flow.test.js`

**Interfaces:**
- Consumes: `lib/supabase.js`, `lib/copy.js` (`get`), `lib/runtime-settings.js` (`get`), `lib/session.js` (`setScreen`)
- Produces:
  - `ACTIONS: string[]` allowlist
  - `LEGACY_ALIASES: Record<string,string>`
  - `async refresh(): Promise<boolean>`
  - `isEnabled(): boolean`
  - `getEntryKey(): string`
  - `getNode(key): object|null`
  - `legacyToKey(callbackData): string|null`
  - `buildKeyboard(node, urlResolver): object` — Telegram `reply_markup`
  - `async goto(userId, nodeKey, ctx): Promise<FlowResult>`
  - `parseFlowCallback(data): string|null` — `f:key` → key

`ctx` shape: `{ vars: object, push?: boolean, urlResolver?: (name) => string }`

`FlowResult`: `{ type:'screen', node, caption, reply_markup } | { type:'action', node, action } | { type:'error', message }`

- [ ] **Step 1: Write failing tests**

```js
// test/flow.test.js
const test = require('node:test')
const assert = require('node:assert')

const jalurClient = require.resolve('../lib/supabase.js')
const jalurCopy = require.resolve('../lib/copy.js')
const jalurRuntime = require.resolve('../lib/runtime-settings.js')
const jalurSession = require.resolve('../lib/session.js')
const jalurFlow = require.resolve('../lib/flow.js')

function muatFlow({ nodes, entryKey = 'welcome', enabled = true } = {}) {
  delete require.cache[jalurFlow]
  require.cache[jalurClient] = {
    id: jalurClient,
    filename: jalurClient,
    loaded: true,
    exports: {
      from(tabel) {
        if (tabel === 'BotFlow') {
          const b = {
            select() { return b },
            eq() { return b },
            maybeSingle: async () => ({
              data: { id: 'flow1', entry_key: entryKey, is_active: true },
              error: null,
            }),
            then(res, rej) {
              return Promise.resolve({
                data: { id: 'flow1', entry_key: entryKey, is_active: true },
                error: null,
              }).then(res, rej)
            },
          }
          return b
        }
        if (tabel === 'BotFlowNode') {
          const b = {
            select() { return b },
            eq() { return b },
            then(res, rej) {
              return Promise.resolve({ data: nodes || [], error: null }).then(res, rej)
            },
          }
          return b
        }
        assert.fail('unexpected table ' + tabel)
      },
    },
  }
  require.cache[jalurCopy] = {
    id: jalurCopy, filename: jalurCopy, loaded: true,
    exports: {
      get(key, vars) {
        return `COPY:${key}:${vars && vars.first_name ? vars.first_name : ''}`
      },
    },
  }
  require.cache[jalurRuntime] = {
    id: jalurRuntime, filename: jalurRuntime, loaded: true,
    exports: {
      get(key, fallback) {
        if (key === 'flow_engine_enabled') return enabled
        return fallback
      },
    },
  }
  const screens = []
  require.cache[jalurSession] = {
    id: jalurSession, filename: jalurSession, loaded: true,
    exports: {
      async setScreen(userId, key, opts) {
        screens.push({ userId, key, opts })
        return true
      },
      screens,
    },
  }
  return require(jalurFlow)
}

test.after(() => {
  for (const j of [jalurClient, jalurCopy, jalurRuntime, jalurSession, jalurFlow]) {
    delete require.cache[j]
  }
})

const sampleNodes = [
  {
    key: 'welcome',
    kind: 'screen',
    screen_key: 'screen.welcome',
    action: null,
    buttons: [
      [{ label_key: 'msg.menu_saldo', go: 'saldo_menu' }],
      [{ label: 'Channel', url_from: 'channel_store' }],
    ],
  },
  {
    key: 'saldo_menu',
    kind: 'screen',
    screen_key: 'screen.saldo_menu',
    action: null,
    buttons: [[{ label: 'Back', go: 'welcome' }]],
  },
  {
    key: 'product_list',
    kind: 'action',
    screen_key: null,
    action: 'product_list',
    buttons: [],
  },
]

test('buildKeyboard uses f: callbacks and url_from', () => {
  const flow = muatFlow({ nodes: sampleNodes })
  const kb = flow.buildKeyboard(sampleNodes[0], (n) => (n === 'channel_store' ? 'https://t.me/x' : ''))
  assert.equal(kb.inline_keyboard[0][0].callback_data, 'f:saldo_menu')
  assert.equal(kb.inline_keyboard[1][0].url, 'https://t.me/x')
})

test('legacyToKey maps daftarproduk', () => {
  const flow = muatFlow({ nodes: sampleNodes })
  assert.equal(flow.legacyToKey('daftarproduk'), 'product_list')
  assert.equal(flow.parseFlowCallback('f:welcome'), 'welcome')
  assert.equal(flow.parseFlowCallback('p:slug'), null)
})

test('goto screen returns caption and sets session', async () => {
  const flow = muatFlow({ nodes: sampleNodes })
  await flow.refresh()
  const result = await flow.goto(9, 'welcome', {
    vars: { first_name: 'Ada' },
    push: false,
    urlResolver: () => 'https://t.me/x',
  })
  assert.equal(result.type, 'screen')
  assert.match(result.caption, /COPY:screen\.welcome:Ada/)
  assert.equal(result.reply_markup.inline_keyboard[0][0].callback_data, 'f:saldo_menu')
})

test('goto action returns action name', async () => {
  const flow = muatFlow({ nodes: sampleNodes })
  await flow.refresh()
  const result = await flow.goto(9, 'product_list', { vars: {}, push: true })
  assert.equal(result.type, 'action')
  assert.equal(result.action, 'product_list')
})

test('isEnabled reads runtime setting', () => {
  const on = muatFlow({ nodes: sampleNodes, enabled: true })
  assert.equal(on.isEnabled(), true)
  delete require.cache[jalurFlow]
  const off = muatFlow({ nodes: sampleNodes, enabled: false })
  assert.equal(off.isEnabled(), false)
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
node --test test/flow.test.js
```

Expected: FAIL missing `../lib/flow.js`.

- [ ] **Step 3: Implement `lib/flow.js`**

```js
// lib/flow.js
const supabase = require('./supabase')
const copy = require('./copy')
const runtimeSettings = require('./runtime-settings')
const session = require('./session')

const ACTIONS = [
  'product_list',
  'product_card',
  'kategori_menu',
  'stok',
  'riwayat',
  'deposit_menu',
  'noop',
]

const LEGACY_ALIASES = {
  daftarproduk: 'product_list',
  saldomenu: 'saldo_menu',
  caraorder: 'cara_order',
  kembaliawal: 'welcome',
  kategori_menu: 'kategori_menu',
  stok: 'stok',
  riwayattransaksi: 'riwayat',
}

let flowMeta = { id: null, entry_key: 'welcome' }
let nodesByKey = Object.create(null)
let ready = false

function isEnabled() {
  if (process.env.FLOW_ENGINE_ENABLED === 'true') return true
  if (process.env.FLOW_ENGINE_ENABLED === 'false') return false
  return runtimeSettings.get('flow_engine_enabled', false) === true
}

function getEntryKey() {
  return flowMeta.entry_key || 'welcome'
}

function getNode(key) {
  return nodesByKey[key] || null
}

function legacyToKey(callbackData) {
  if (!callbackData) return null
  if (Object.prototype.hasOwnProperty.call(LEGACY_ALIASES, callbackData)) {
    return LEGACY_ALIASES[callbackData]
  }
  return null
}

function parseFlowCallback(data) {
  if (!data || typeof data !== 'string') return null
  if (!data.startsWith('f:')) return null
  const key = data.slice(2)
  return key || null
}

function buttonLabel(btn) {
  if (btn.label_key) return copy.get(btn.label_key)
  return String(btn.label || '•')
}

function buildKeyboard(node, urlResolver) {
  const rows = Array.isArray(node?.buttons) ? node.buttons : []
  const inline_keyboard = []
  for (const row of rows) {
    if (!Array.isArray(row)) continue
    const out = []
    for (const btn of row) {
      if (!btn || typeof btn !== 'object') continue
      const text = buttonLabel(btn)
      if (btn.go) {
        out.push({ text, callback_data: `f:${btn.go}` })
      } else if (btn.callback) {
        const cb = String(btn.callback)
        if (Buffer.byteLength(cb, 'utf8') <= 64) out.push({ text, callback_data: cb })
      } else if (btn.url_from && typeof urlResolver === 'function') {
        const url = urlResolver(btn.url_from)
        if (url) out.push({ text, url })
      } else if (btn.url) {
        out.push({ text, url: String(btn.url) })
      }
    }
    if (out.length) inline_keyboard.push(out)
  }
  return { inline_keyboard }
}

async function refresh() {
  try {
    const { data: flow, error: flowErr } = await supabase
      .from('BotFlow')
      .select('id, entry_key, is_active')
      .eq('is_active', true)
      .maybeSingle()
    if (flowErr) {
      console.error('[flow] refresh flow:', flowErr.message)
      return false
    }
    if (!flow) {
      nodesByKey = Object.create(null)
      flowMeta = { id: null, entry_key: 'welcome' }
      ready = true
      return true
    }
    const { data: nodes, error: nodeErr } = await supabase
      .from('BotFlowNode')
      .select('key, kind, screen_key, action, buttons, description')
      .eq('flow_id', flow.id)
    if (nodeErr) {
      console.error('[flow] refresh nodes:', nodeErr.message)
      return false
    }
    const next = Object.create(null)
    for (const n of nodes || []) {
      if (n && n.key) next[n.key] = n
    }
    nodesByKey = next
    flowMeta = { id: flow.id, entry_key: flow.entry_key || 'welcome' }
    ready = true
    return true
  } catch (e) {
    console.error('[flow] refresh:', e.message)
    return false
  }
}

function isReady() {
  return ready
}

async function goto(userId, nodeKey, ctx = {}) {
  const node = getNode(nodeKey)
  if (!node) return { type: 'error', message: `unknown node: ${nodeKey}` }

  const push = ctx.push !== undefined ? !!ctx.push : nodeKey !== getEntryKey()
  await session.setScreen(userId, nodeKey, { push: nodeKey === getEntryKey() ? false : push })

  if (node.kind === 'action') {
    const action = ACTIONS.includes(node.action) ? node.action : null
    if (!action) return { type: 'error', message: `invalid action on ${nodeKey}` }
    return { type: 'action', node, action }
  }

  if (node.kind !== 'screen' || !node.screen_key) {
    return { type: 'error', message: `invalid screen node: ${nodeKey}` }
  }

  const caption = copy.get(node.screen_key, ctx.vars || {})
  const reply_markup = buildKeyboard(node, ctx.urlResolver)
  return { type: 'screen', node, caption, reply_markup }
}

module.exports = {
  ACTIONS,
  LEGACY_ALIASES,
  refresh,
  isReady,
  isEnabled,
  getEntryKey,
  getNode,
  legacyToKey,
  parseFlowCallback,
  buildKeyboard,
  goto,
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
node --test test/flow.test.js test/session.test.js
```

- [ ] **Step 5: Commit**

```bash
git add lib/flow.js test/flow.test.js
git commit -m "feat(phase6): add lib/flow graph cache, keyboard, goto"
```

---

### Task 4: Hook flow.refresh to runtime-settings polling

**Files:**
- Modify: `index.js` (boot block next to `copy.refresh`)

**Interfaces:**
- Consumes: `flow.refresh`, existing `runtimeSettings.startPolling(ms, onReload)`
- Produces: flow cache warm on boot; reloads with copy on bump

- [ ] **Step 1: Require flow**

Near other libs:

```js
const copy = require('./lib/copy')
const flow = require('./lib/flow')
const session = require('./lib/session')
```

- [ ] **Step 2: Extend boot refresh**

Replace the boot `.then` so both copy and flow refresh, and polling reloads both:

```js
runtimeSettings.refresh(true)
  .then(async () => {
    await copy.refresh()
    await flow.refresh()
    runtimeSettings.startPolling(10000, () => {
      copy.refresh().catch(() => {})
      flow.refresh().catch(() => {})
    })
  })
  .catch((e) => console.error('[runtime-settings] gagal muat awal:', e.message))
```

- [ ] **Step 3: Commit**

```bash
git add index.js
git commit -m "feat(phase6): reload BotFlow when cache_version bumps"
```

---

### Task 5: Wire bot dispatch behind kill switch

**Files:**
- Modify: `index.js` (`/start`, `kembaliawal`, menu callback branch)

**Interfaces:**
- Consumes: `flow.isEnabled()`, `flow.goto`, `flow.parseFlowCallback`, `flow.legacyToKey`, `flow.getEntryKey`, `session.setBanner`
- Produces: helper `dispatchFlow(userId, nodeKey, opts)` + `handleFlowResult`

- [ ] **Step 1: Add helpers** (near `welcomeCaption` / `welcomeInlineKeyboard`)

```js
function flowUrlResolver(name) {
  if (name === 'channel_store') return channelContact.channelStore
  if (name === 'cs') return channelContact.cs
  return ''
}

async function collectWelcomeVars(userId, firstName) {
  const [trxCountResult, userCountResult, stoktersedia, stokterjual, userSaldo] = await Promise.all([
    supabase.from('Trx').select('*', { count: 'exact', head: true }),
    supabase.from('User').select('*', { count: 'exact', head: true }),
    getTotalStokTersedia(),
    getTotalStokTerjual(),
    cekSaldo(userId),
  ])
  return {
    first_name: firstName || 'User',
    nama_bot: NamaBot,
    user_count: userCountResult.count || 0,
    stok_terjual: stokterjual,
    stok_tersedia: stoktersedia,
    saldo: formatrupiah(userSaldo),
  }
}

async function handleFlowResult(userId, result, msgId = null) {
  if (!result || result.type === 'error') {
    console.error('[flow]', result && result.message)
    return false
  }
  if (result.type === 'screen') {
    if (msgId) {
      await editOrSendBannerMessage(userId, msgId, result.caption, { reply_markup: result.reply_markup })
    } else {
      await sendBannerMessage(userId, result.caption, { reply_markup: result.reply_markup })
    }
    return true
  }
  if (result.type === 'action') {
    // Delegate to existing handlers by invoking the same code paths used today.
    // Implement as a switch that calls into local functions / sets cmd equivalents.
    switch (result.action) {
      case 'product_list': {
        // Reuse the body of daftarproduk: load products + sendProductPage
        // (copy the data-load lines from the existing daftarproduk handler)
        break
      }
      case 'kategori_menu':
      case 'stok':
      case 'riwayat':
      case 'deposit_menu':
        // Prefer: call extracted async function wrappers created in this task
        // from the existing handler bodies (see Step 2).
        break
      default:
        return false
    }
    return true
  }
  return false
}

async function dispatchFlow(userId, nodeKey, { msgId = null, push, firstName } = {}) {
  const vars = nodeKey === 'welcome' || nodeKey === flow.getEntryKey()
    ? await collectWelcomeVars(userId, firstName)
    : {
        first_name: firstName || 'User',
        nama_bot: NamaBot,
        saldo: formatrupiah(await cekSaldo(userId)),
      }
  const result = await flow.goto(userId, nodeKey, {
    vars,
    push,
    urlResolver: flowUrlResolver,
  })
  return handleFlowResult(userId, result, msgId)
}
```

**Important:** Before the switch becomes a mess, **extract** the existing handler bodies for `daftarproduk`, `kategori_menu`, `stok` (buyer), and `riwayattransaksi` into named async functions (`openProductList(userId, msgId)`, etc.) used by both the legacy `cmd ===` branches and the flow action switch. Do not duplicate the product-query logic.

- [ ] **Step 2: Extract action wrappers**

For each of `product_list`, `kategori_menu`, `stok`, `riwayat` — move the core of the current `if (cmd === …)` block into:

```js
async function openProductList(userId, msgId = null, callbackId = null) { /* existing daftarproduk body */ }
async function openKategoriMenu(userId, msgId) { /* … */ }
async function openStokBuyer(userId, msgId) { /* … */ }
async function openRiwayat(userId, msgId) { /* … */ }
```

Legacy branches become one-liners calling these. Flow `handleFlowResult` calls the same.

- [ ] **Step 3: Gate `/start`**

```js
if (flow.isEnabled()) {
  await dispatchFlow(msg.from.id, flow.getEntryKey(), {
    firstName: msg.from.first_name,
    push: false,
  })
  const replyKb = await generateReplyKeyboard(msg.from.id)
  await bot.sendMessage(msg.from.id, copy.get('msg.reply_nav_enabled'), { reply_markup: replyKb })
  return
}
// else: existing Phase 5 welcomeCaption path
```

- [ ] **Step 4: Gate menu callbacks**

Near the top of the callback router (after `cmd` is known):

```js
if (flow.isEnabled()) {
  const flowKey =
    flow.parseFlowCallback(cmd) ||
    flow.legacyToKey(cmd)
  if (flowKey) {
    await bot.answerCallbackQuery(query.id).catch(() => {})
    await dispatchFlow(query.from.id, flowKey, {
      msgId: query.message?.message_id,
      firstName: query.from.first_name,
      push: flowKey !== flow.getEntryKey(),
    })
    return
  }
}
```

Leave `p:`, `v:`, cart/checkout, owner cmds on the legacy path always.

- [ ] **Step 5: Gate `kembaliawal`** when clearing cart — after cleanup, if enabled, `dispatchFlow(..., 'welcome', { push: false })` instead of inlined welcome caption.

- [ ] **Step 6: Syntax check + commit**

```bash
node --check index.js
git add index.js
git commit -m "feat(phase6): dispatch welcome/menu through flow when enabled"
```

---

### Task 6: Dashboard Bot Flow UI

**Files:**
- Modify: `dashboard.js`
- Create: `views/settings-bot-flow.ejs`
- Modify: `views/partials/sidebar.ejs`

**Interfaces:**
- Consumes: `BotFlow`, `BotFlowNode`, `runtimeSettings.bump/get`
- Produces:
  - `GET /settings/bot-flow`
  - `POST /settings/bot-flow/toggle` body `{ enabled }`
  - `POST /settings/bot-flow/nodes/:key` body `{ kind, screen_key, action, buttons, description }`

- [ ] **Step 1: Sidebar link** after Bot Copy:

```html
        <a href="/settings/bot-flow" class="nav-item <%= typeof currentPage !== 'undefined' && currentPage === 'settings-bot-flow' ? 'active' : '' %>">
            <span class="nav-item-icon">🔀</span>
            <span>Bot Flow</span>
        </a>
```

- [ ] **Step 2: Routes** (near bot-copy routes)

```js
const FLOW_ACTIONS = [
  'product_list', 'product_card', 'kategori_menu', 'stok', 'riwayat', 'deposit_menu', 'noop',
]

function parseButtonsField(raw) {
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (!Array.isArray(parsed)) throw new Error('buttons must be a JSON array of rows')
  for (const row of parsed) {
    if (!Array.isArray(row)) throw new Error('each buttons row must be an array')
    for (const btn of row) {
      const modes = [btn.go, btn.callback, btn.url_from, btn.url].filter((x) => x !== undefined && x !== null && x !== '')
      if (modes.length !== 1) throw new Error('each button needs exactly one of go|callback|url_from|url')
    }
  }
  return parsed
}

app.get('/settings/bot-flow', isAuthenticated, async (req, res) => {
  try {
    const { data: flow } = await supabase
      .from('BotFlow')
      .select('*')
      .eq('is_active', true)
      .maybeSingle()
    const { data: nodes } = flow
      ? await supabase.from('BotFlowNode').select('*').eq('flow_id', flow.id).order('key')
      : { data: [] }
    const enabled = runtimeSettings.get
      ? runtimeSettings.get('flow_engine_enabled', false)
      : false
    // Prefer reading from DB for the form default:
    const { data: flag } = await supabase
      .from('NotificationSettings')
      .select('setting_value')
      .eq('setting_key', 'flow_engine_enabled')
      .maybeSingle()
    const enabledDb = !!(flag?.setting_value && flag.setting_value.value === true)
    res.render('settings-bot-flow', {
      title: `Bot Flow - ${NamaBot}`,
      namaBot: NamaBot,
      username: req.session.username,
      currentPage: 'settings-bot-flow',
      pageTitle: '🔀 Bot Flow',
      flow,
      nodes: nodes || [],
      enabled: enabledDb,
      actions: FLOW_ACTIONS,
      req,
      success: req.query.success || '',
      error: req.query.error || '',
    })
  } catch (e) {
    console.error(e)
    res.status(500).send(e.message)
  }
})

app.post('/settings/bot-flow/toggle', isAuthenticated, async (req, res) => {
  try {
    const enabled = req.body.enabled === 'true' || req.body.enabled === true || req.body.enabled === 'on'
    const { error } = await supabase.from('NotificationSettings').upsert({
      setting_key: 'flow_engine_enabled',
      setting_value: { value: !!enabled },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'setting_key' })
    if (error) throw error
    await runtimeSettings.bump()
    res.redirect('/settings/bot-flow?success=toggle')
  } catch (e) {
    console.error(e)
    res.redirect('/settings/bot-flow?error=' + encodeURIComponent(e.message))
  }
})

app.post('/settings/bot-flow/nodes/:key', isAuthenticated, async (req, res) => {
  try {
    const key = req.params.key
    const { data: flow } = await supabase.from('BotFlow').select('id').eq('is_active', true).maybeSingle()
    if (!flow) throw new Error('No active flow')
    const kind = String(req.body.kind || '')
    if (kind !== 'screen' && kind !== 'action') throw new Error('kind must be screen|action')
    const buttons = parseButtonsField(req.body.buttons || '[]')
    const patch = {
      kind,
      screen_key: kind === 'screen' ? String(req.body.screen_key || '') : null,
      action: kind === 'action' ? String(req.body.action || '') : null,
      buttons,
      description: String(req.body.description || ''),
      updated_at: new Date().toISOString(),
    }
    if (kind === 'action' && !FLOW_ACTIONS.includes(patch.action)) {
      throw new Error('action not in allowlist')
    }
    if (kind === 'screen' && !patch.screen_key) throw new Error('screen_key required')
    const { error } = await supabase
      .from('BotFlowNode')
      .update(patch)
      .eq('flow_id', flow.id)
      .eq('key', key)
    if (error) throw error
    await runtimeSettings.bump()
    res.redirect('/settings/bot-flow?success=1')
  } catch (e) {
    console.error(e)
    res.redirect('/settings/bot-flow?error=' + encodeURIComponent(e.message))
  }
})
```

Note: `dashboard.js` may not call `runtimeSettings.get` for sync cache — reading `NotificationSettings` directly for the toggle form (as above) is fine; bot still picks up via bump+poll.

- [ ] **Step 3: Create `views/settings-bot-flow.ejs`**

Mirror `settings-bot-copy.ejs` chrome (sidebar, top-bar). Include:

1. Enable form (checkbox + submit) posting to `/settings/bot-flow/toggle`
2. For each node: card with key, kind select, screen_key or action select, description, textarea for `buttons` JSON (`JSON.stringify(row.buttons, null, 2)`), POST to `/settings/bot-flow/nodes/<%= node.key %>`
3. Success/error banners from query string

- [ ] **Step 4: Commit**

```bash
git add dashboard.js views/settings-bot-flow.ejs views/partials/sidebar.ejs
git commit -m "feat(phase6): dashboard Bot Flow editor and enable toggle"
```

---

### Task 7: Apply migration + verification + PR

**Files:** roadmap status → **Done** after verify; runbook tweaks if needed

- [ ] **Step 1: Full tests**

```bash
node --test
```

Expected: all prior tests + session + flow PASS.

- [ ] **Step 2: Apply migration**

```bash
supabase db push --yes
```

- [ ] **Step 3: E2E checklist**

1. Engine OFF → `/start` identical to Phase 5  
2. Enable in dashboard → bump → `/start` works; new welcome message buttons use `f:…`  
3. `f:product_list` / legacy `daftarproduk` open product list  
4. `v:` qty → checkout unchanged  
5. Edit welcome `buttons` JSON → save → new `/start` keyboard matches  
6. Disable toggle → legacy path returns  
7. `BotCopy` / broadcast UIs untouched  

- [ ] **Step 4: Mark roadmap Done + commit + push PR**

```bash
# set Phase 6 status to Done in roadmap
git add docs/superpowers/plans/2026-08-09-admin-ux-overhaul-roadmap.md
git commit -m "docs(phase6): mark flow engine done after verify"
git push -u origin HEAD
```

---

## Spec coverage self-review

| Spec requirement | Task |
|------------------|------|
| `BotFlow` / `BotFlowNode` + seed | Task 1 |
| `screen` \| `action` only; buttons JSON | Task 1, 3, 6 |
| Session `screen_key` / `nav_stack` / `banner_msg_id` | Task 2 |
| `lib/flow` refresh/goto/keyboard/aliases | Task 3 |
| Shared `cache_version` reload | Task 4 |
| Kill switch + `/start`/menu dispatch | Task 5, 6 |
| Dashboard editor + toggle | Task 6 |
| Checkout/`p:`/`v:` unchanged; no Phase 7/9 | Global + Task 5 |
| Pure `node --test` | Task 2–3 |

## Placeholder scan

No TBD steps. Migration SQL, session/flow modules, dashboard routes, and bot dispatch shape included. Task 5 requires extracting existing handler bodies into named functions — implementers must copy from current `index.js` `daftarproduk` / `kategori_menu` / `stok` / `riwayattransaksi` blocks rather than inventing new product queries.

## Type consistency

- `session.setScreen(userId, screenKey, { push?: boolean })`
- `flow.goto(userId, nodeKey, { vars, push?, urlResolver? })`
- Callbacks: `f:<nodeKey>`; legacy aliases per `LEGACY_ALIASES`
- Setting: `flow_engine_enabled` → `{ value: boolean }`
- Dashboard: `GET /settings/bot-flow`, `POST …/toggle`, `POST …/nodes/:key`
