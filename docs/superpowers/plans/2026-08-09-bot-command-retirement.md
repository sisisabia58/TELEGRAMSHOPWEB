# Bot Command Retirement (Phase 7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove owner Telegram admin wizards from `index.js` so the dashboard is the only place to manage products, stock, vouchers, and broadcasts; keep buyer flows plus `/stok`, `/rekap`, `/listuser`.

**Architecture:** Introduce a tiny pure module listing retired/kept owner commands and a single stub `bot.onText` router. Delete wizard handlers, `*State` machines, owner callback UIs, and owner stock-edit callbacks in grouped commits. Collapse the command-reset block to deposit-only. Verify with `rg` gates + `node --test`.

**Tech Stack:** Node.js 20, `node-telegram-bot-api`, Supabase, Express dashboard (unchanged), `node --test`.

**Design spec:** [docs/superpowers/specs/2026-08-09-bot-command-retirement-design.md](../specs/2026-08-09-bot-command-retirement-design.md)

## Global Constraints

- Keep buyer commands: `/start`, `/saldo`, `/deposit`, `/riwayatdeposit`, `/getid`
- Keep owner reports: `/stok` (read), `/rekap`, `/listuser` (list only)
- Keep `depositState` and deposit custom-nominal message handling
- Do **not** delete `addStokItems` / stock helpers used by checkout or buyer stock
- Do **not** expand flow engine or change checkout (`p:` / `v:` / bayar)
- Premium + `/deluser`: retire from bot; Studio fallback (no new dashboard UI required in this phase)
- `/setgrup` family: already gone — skip
- Tests: pure functions via `node --test`; use `rg` for deletion gates
- Commits: small groups by domain — never one mega-delete
- Migrations: none expected

---

## File map

| File | Responsibility |
|------|----------------|
| `lib/retired-commands.js` | Pure lists + `isRetiredOwnerCommand` / `retiredOwnerHelpText` |
| `test/retired-commands.test.js` | Unit tests for the lists |
| `index.js` | Delete wizards/states/callbacks; add stub router; simplify `/listuser` + `/stok` owner UI |
| `docs/runbooks/phase7-bot-command-retirement.md` | Cutover + Studio gaps |
| `docs/superpowers/plans/2026-08-09-admin-ux-overhaul-roadmap.md` | Status → Plan ready / Done |
| Update | design spec (already created with this plan) |

---

### Task 1: Spec, pure module, runbook, roadmap

**Files:**
- Create: `lib/retired-commands.js`
- Create: `test/retired-commands.test.js`
- Create: `docs/runbooks/phase7-bot-command-retirement.md`
- Modify: `docs/superpowers/plans/2026-08-09-admin-ux-overhaul-roadmap.md`
- Ensure: `docs/superpowers/specs/2026-08-09-bot-command-retirement-design.md` exists

**Interfaces:**
- Consumes: nothing
- Produces:
  - `RETIRED_OWNER_COMMANDS: string[]`
  - `KEPT_OWNER_COMMANDS: string[]`
  - `isRetiredOwnerCommand(cmd: string): boolean`
  - `retiredOwnerHelpText(dashboardUrl?: string): string`

- [ ] **Step 1: Write failing tests**

```js
// test/retired-commands.test.js
const test = require('node:test')
const assert = require('node:assert')
const {
  RETIRED_OWNER_COMMANDS,
  KEPT_OWNER_COMMANDS,
  isRetiredOwnerCommand,
  retiredOwnerHelpText,
} = require('../lib/retired-commands')

test('retired list includes addproduk and excludes stok', () => {
  assert.ok(RETIRED_OWNER_COMMANDS.includes('addproduk'))
  assert.ok(RETIRED_OWNER_COMMANDS.includes('bc'))
  assert.ok(RETIRED_OWNER_COMMANDS.includes('setpremium'))
  assert.ok(!RETIRED_OWNER_COMMANDS.includes('stok'))
  assert.ok(KEPT_OWNER_COMMANDS.includes('stok'))
  assert.ok(KEPT_OWNER_COMMANDS.includes('rekap'))
  assert.ok(KEPT_OWNER_COMMANDS.includes('listuser'))
})

test('isRetiredOwnerCommand normalizes slash and case', () => {
  assert.equal(isRetiredOwnerCommand('/AddProduk'), true)
  assert.equal(isRetiredOwnerCommand('addproduk foo'), true)
  assert.equal(isRetiredOwnerCommand('/stok'), false)
  assert.equal(isRetiredOwnerCommand('/start'), false)
})

test('retiredOwnerHelpText mentions Dashboard', () => {
  const t = retiredOwnerHelpText('https://example.com')
  assert.match(t, /Dashboard/i)
  assert.match(t, /example\.com/)
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
node --test test/retired-commands.test.js
```

Expected: cannot find module `../lib/retired-commands`.

- [ ] **Step 3: Implement `lib/retired-commands.js`**

```js
// lib/retired-commands.js
const RETIRED_OWNER_COMMANDS = [
  'ownermenu',
  'addproduk',
  'delproduk',
  'addstok',
  'editstok',
  'setpremium',
  'addpremiumuser',
  'removepremiumuser',
  'editnama',
  'editkode',
  'editharga',
  'editdeskripsi',
  'editsnk',
  'editformat',
  'editkategori',
  'deluser',
  'bc',
  'addvoucher',
  'delvoucher',
  'listvoucher',
]

const KEPT_OWNER_COMMANDS = ['stok', 'rekap', 'listuser']

function normalizeCommand(cmd) {
  if (!cmd || typeof cmd !== 'string') return ''
  const raw = cmd.trim().split(/\s+/)[0].toLowerCase()
  return raw.startsWith('/') ? raw.slice(1) : raw
}

function isRetiredOwnerCommand(cmd) {
  return RETIRED_OWNER_COMMANDS.includes(normalizeCommand(cmd))
}

function retiredOwnerHelpText(dashboardUrl) {
  const url = dashboardUrl || process.env.DASHBOARD_URL || ''
  let msg = '🛠️ *Perintah admin bot sudah dipensiunkan.*\n\n'
  msg += 'Kelola toko lewat *Dashboard* (produk, stok, voucher, broadcast, flow, copy).\n'
  if (url) msg += `\n🔗 ${url}\n`
  msg += '\nLaporan cepat di bot: `/stok` · `/rekap` · `/listuser`'
  return msg
}

module.exports = {
  RETIRED_OWNER_COMMANDS,
  KEPT_OWNER_COMMANDS,
  isRetiredOwnerCommand,
  retiredOwnerHelpText,
  normalizeCommand,
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
node --test test/retired-commands.test.js
```

- [ ] **Step 5: Write runbook**

Create `docs/runbooks/phase7-bot-command-retirement.md`:

```markdown
# Phase 7 cutover — Bot command retirement

1. Merge PR → Railway deploys.
2. As owner, send `/addproduk` → expect “use Dashboard” stub (not wizard).
3. Open Dashboard → Products / Stock / Vouchers / Broadcast — confirm CRUD still works.
4. Owner `/stok`, `/rekap`, `/listuser` still reply.
5. Buyer `/start` → Daftar Produk still works.
6. **Gaps (Studio):** `Premium` whitelist and deleting a `User` row — no dashboard UI yet.
7. Rollback: revert the Phase 7 commit(s) on `main` (commands return).
```

- [ ] **Step 6: Update roadmap**

Set Phase 7 row to link this plan with status **Plan ready** (implementers flip to **Done** after verify).

- [ ] **Step 7: Commit**

```bash
git add lib/retired-commands.js test/retired-commands.test.js \
  docs/runbooks/phase7-bot-command-retirement.md \
  docs/superpowers/specs/2026-08-09-bot-command-retirement-design.md \
  docs/superpowers/plans/2026-08-09-bot-command-retirement.md \
  docs/superpowers/plans/2026-08-09-admin-ux-overhaul-roadmap.md
git commit -m "docs(phase7): bot command retirement plan and retired-commands helper"
```

---

### Task 2: Stub router + retire product CRUD slash handlers

**Files:**
- Modify: `index.js` (require + stub + delete product command blocks)

**Interfaces:**
- Consumes: `lib/retired-commands.js`
- Produces: owners typing retired product commands get help text

- [ ] **Step 1: Add require near other `lib/` requires**

```js
const retiredCommands = require('./lib/retired-commands')
```

- [ ] **Step 2: Locate handlers with rg**

```bash
rg -n "bot\.onText\(/\\\\/(ownermenu|addproduk|delproduk|editnama|editkode|editharga|editdeskripsi|editsnk|editformat|editkategori)" index.js
```

- [ ] **Step 3: Delete each `bot.onText` block for those commands** (from the `bot.onText` line through the closing `})` of that handler). Do **not** delete `/listuser`, `/stok`, `/rekap`.

Also delete interactive product-wizard **callback** blocks found via:

```bash
rg -n "addproduk_cancel|delproduk_select_|delproduk_confirm_|delproduk_cancel|editnama_select_|editnama_cancel|editkode_|editharga_|editdeskripsi_|editsnk_|editformat_|editkategori_" index.js
```

Delete matching `if (cmd === …)` / `cmd.startsWith` branches in the callback dispatcher.

- [ ] **Step 4: Install stub router once** (after kept owner commands, or near other `bot.onText` registrations)

```js
const retiredCmdPattern = new RegExp(
  '^\\/(' + retiredCommands.RETIRED_OWNER_COMMANDS.join('|') + ')(?:\\s|$)',
  'i'
)
bot.onText(retiredCmdPattern, async (msg) => {
  if (!isOwner(msg)) return
  const url = process.env.DASHBOARD_URL || ''
  return bot.sendMessage(msg.from.id, retiredCommands.retiredOwnerHelpText(url), {
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
  })
})
```

Note: `/ownermenu` is in `RETIRED_OWNER_COMMANDS`, so the stub covers it — do **not** leave a separate ownermenu handler.

- [ ] **Step 5: Gate**

```bash
rg -n "bot\.onText\(/\\\\/(addproduk|delproduk|editnama|ownermenu)" index.js
# expect: no matches (stub uses RegExp, not these literals)

node --check index.js
```

- [ ] **Step 6: Commit**

```bash
git add index.js
git commit -m "feat(phase7): stub retired commands; remove product CRUD wizards"
```

---

### Task 3: Retire stock wizards + owner stock-edit callbacks

**Files:**
- Modify: `index.js`

**Interfaces:**
- Consumes: Task 2 stub (already covers `/addstok`, `/editstok`)
- Produces: buyer/owner `/stok` read path intact; edit callbacks gone

- [ ] **Step 1: Delete slash handlers**

```bash
rg -n "bot\.onText\(/\\\\/(addstok|editstok)" index.js
```

Delete those `bot.onText` blocks if still present (Task 2 may have left them if you scoped product-only — remove now).

- [ ] **Step 2: Delete stock-edit callbacks**

```bash
rg -n "editstok_|bataleditstok|addstok_|stok_edit_menu|cmd\.startsWith\(\"editstok" index.js
```

Delete owner **edit** branches. **Keep** read branches:

```bash
rg -n 'cmd === "stok"|stok_detail_|stok_filter|stok_statistik|stok_viewall_|stok_history_' index.js
```

- [ ] **Step 3: Strip “Edit Stok” buttons from kept `/stok` / `openStokBuyer` UIs**

```bash
rg -n "Edit Stok|editstok_" index.js
```

Remove inline keyboard rows that only open edit wizards. Leave filter/statistik/detail **read** buttons.

- [ ] **Step 4: Delete message-handler branches for `editstok[...]` and `addStokState`**

```bash
rg -n "editstok\[msg\.from\.id\]|addStokState\[msg\.from\.id\]" index.js
```

Remove those `if` blocks inside `bot.on('message')` (including `.waitingFile` document upload for add-stok). **Keep** `depositState` handlers.

- [ ] **Step 5: Gate**

```bash
rg -n "editstok_|addStokState|bot\.onText\(/\\\\/addstok" index.js
# expect: no wizard leftovers

node --check index.js
node --test
```

- [ ] **Step 6: Commit**

```bash
git add index.js
git commit -m "feat(phase7): remove bot stock edit wizards; keep /stok read"
```

---

### Task 4: Retire voucher + broadcast (`/bc`) commands

**Files:**
- Modify: `index.js`

- [ ] **Step 1: Locate and delete**

```bash
rg -n "bot\.onText\(/\\\\/(bc|addvoucher|delvoucher|listvoucher)" index.js
```

Delete each handler block. Stub already answers these names.

- [ ] **Step 2: Delete voucher/bc-only callbacks if any**

```bash
rg -n "addvoucher_|delvoucher_|bc_|listvoucher_" index.js
```

Only delete owner-admin branches, not buyer payment callbacks.

- [ ] **Step 3: Gate + commit**

```bash
rg -n "bot\.onText\(/\\\\/(bc|addvoucher|delvoucher|listvoucher)" index.js
node --check index.js
git add index.js
git commit -m "feat(phase7): remove bot voucher and broadcast admin commands"
```

---

### Task 5: Retire premium + `/deluser`

**Files:**
- Modify: `index.js`

- [ ] **Step 1: Delete slash handlers**

```bash
rg -n "bot\.onText\(/\\\\/(setpremium|addpremiumuser|removepremiumuser|deluser)" index.js
```

Delete blocks. Stub covers the names. **Do not** delete runtime checks that read `Premium` during **buyer** purchase if present — only the admin commands.

```bash
rg -n 'from\("Premium"\)|Premium' index.js
```

If purchase still gates on `Premium`, leave that read path.

- [ ] **Step 2: Gate + commit**

```bash
rg -n "bot\.onText\(/\\\\/(setpremium|addpremiumuser|removepremiumuser|deluser)" index.js
node --check index.js
git add index.js
git commit -m "feat(phase7): remove premium and deluser admin commands"
```

---

### Task 6: Retire owner callback dashboards (produk_/user_ detail)

**Files:**
- Modify: `index.js` (`/listuser` keyboard + callback dispatcher)

- [ ] **Step 1: Find callbacks**

```bash
rg -n "produk_detail_|produk_trx_|produk_statistik|produk_export|user_detail_|user_statistik|user_export" index.js
```

- [ ] **Step 2: Delete handler branches** for those `cmd` values in the callback switch/if-chain.

- [ ] **Step 3: Simplify `/listuser` output**

Locate `bot.onText(/\/listuser/` and remove inline buttons that use `user_detail_`, `user_statistik`, `user_export`. Keep a plain text (or pagination) list of users. Example keyboard after change: empty or only `[{ text: '🔙 Tutup', callback_data: 'kembaliawal' }]` if a banner message is used — prefer **no** retired callbacks.

- [ ] **Step 4: Remove any remaining buttons** in `/stok` owner views that point at `produk_detail_` / `produk_export`.

- [ ] **Step 5: Gate**

```bash
rg -n "produk_detail_|user_detail_|user_export|produk_export" index.js
# expect: no matches

node --check index.js
```

- [ ] **Step 6: Commit**

```bash
git add index.js
git commit -m "feat(phase7): remove owner produk/user callback dashboards"
```

---

### Task 7: Collapse state objects + command-reset block

**Files:**
- Modify: `index.js` (top declarations + `bot.on('message')` reset)

- [ ] **Step 1: Confirm no remaining references**

```bash
rg -n "addProdukState|addStokState|editNamaState|editKodeState|editHargaState|editDeskripsiState|editSnkState|editFormatState|editKategoriState|\beditstok\b" index.js
```

Expected: only comments (if any) or zero hits. If hits remain, delete those message/callback branches first.

- [ ] **Step 2: Remove declarations** near top of `index.js` (keep `depositState`):

Delete:

```js
let editstok = {}
let addProdukState = {}
let addStokState = {}
let editNamaState = {}
let editKodeState = {}
let editHargaState = {}
let editDeskripsiState = {}
let editSnkState = {}
let editFormatState = {}
let editKategoriState = {}
```

Keep:

```js
let depositState = {}
```

- [ ] **Step 3: Collapse command-reset block**

Find the block under `bot.on('message')` that resets states when `text.startsWith('/')`. Replace the multi-`if` chain with deposit-only:

```js
  if (text && typeof text === 'string' && text.startsWith('/')) {
    const command = text.split(' ')[0].toLowerCase()
    if (command !== '/deposit' && command !== '/batal') {
      if (depositState[msg.from.id]) {
        delete depositState[msg.from.id]
      }
    }
  }
```

- [ ] **Step 4: Delete leftover message wizards** for editnama/editkode/…/addproduk if any remain:

```bash
rg -n "editNamaState|addProdukState|editKodeState|editHargaState|editDeskripsiState|editSnkState|editFormatState|editKategoriState" index.js
```

- [ ] **Step 5: Full verify**

```bash
node --check index.js
node --test
rg -n "addProdukState|editNamaState|editstok\s*=" index.js
# expect: no matches

wc -l index.js
# expect: noticeably lower than pre-phase (~11868 on main at plan time)
```

- [ ] **Step 6: Commit**

```bash
git add index.js
git commit -m "feat(phase7): drop owner *State maps; simplify command reset"
```

---

### Task 8: Final gates, roadmap Done, PR

**Files:**
- Modify: roadmap status → **Done**
- Modify: runbook if line counts / gaps need updating

- [ ] **Step 1: Automated gates**

```bash
node --test
node --check index.js

# Retired slash handlers must not exist as dedicated onText literals:
rg -n "bot\.onText\(/\\\\/(ownermenu|addproduk|delproduk|addstok|editstok|setpremium|addpremiumuser|removepremiumuser|editnama|editkode|editharga|editdeskripsi|editsnk|editformat|editkategori|deluser|bc|addvoucher|delvoucher|listvoucher)" index.js
# expect: exit 1 (no matches)

# Stub module must still be wired:
rg -n "retired-commands|RETIRED_OWNER_COMMANDS" index.js
# expect: matches

# Kept commands:
rg -n "bot\.onText\(/\\\\/(stok|rekap|listuser|start|saldo|deposit|getid)" index.js
# expect: matches
```

- [ ] **Step 2: Manual E2E checklist**

1. Owner `/addproduk` → dashboard stub message  
2. Dashboard product + stock CRUD still works  
3. Owner `/stok` read works; no Edit Stok wizard  
4. Owner `/listuser` lists users without detail callbacks  
5. Owner `/rekap` works  
6. Buyer `/start` → product path works (flow on and off)  
7. Studio note: Premium / User delete  

- [ ] **Step 3: Mark roadmap Done + commit + PR**

```bash
# set Phase 7 status to Done in admin-ux-overhaul-roadmap.md
git add docs/superpowers/plans/2026-08-09-admin-ux-overhaul-roadmap.md docs/runbooks/phase7-bot-command-retirement.md
git commit -m "docs(phase7): mark bot command retirement done"
git push -u origin HEAD
```

Open PR targeting `main` with summary of lines removed + coverage map.

---

## Spec coverage self-review

| Spec requirement | Task |
|------------------|------|
| Delete ~21 owner commands | 2–5 |
| Keep `/stok` `/rekap` `/listuser` | Global + 3, 6, 8 |
| Stub / help text for retired names | 1–2 |
| Collapse `*State` + reset block | 7 |
| Retire produk_/user_ owner callbacks | 6 |
| Keep stok read, drop edit | 3 |
| Premium / deluser Studio gap | Design + runbook + Task 5 |
| `rg` + `node --test` verify | 8 |
| No checkout / flow changes | Global |

## Placeholder scan

No TBD steps. Exact module API, stub snippet, `rg` gates, and commit messages included. Line numbers in `index.js` drift — tasks use `rg` anchors, not hard-coded spans.

## Type consistency

- `RETIRED_OWNER_COMMANDS` / `KEPT_OWNER_COMMANDS` / `isRetiredOwnerCommand` / `retiredOwnerHelpText` used consistently in Tasks 1–2 and 8.
