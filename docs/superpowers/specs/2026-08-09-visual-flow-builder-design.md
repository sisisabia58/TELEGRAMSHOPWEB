# Visual Flow Builder (Phase 6b) — Design Spec

**Date:** 2026-08-09  
**Source:** SendPulse-style canvas request + Phase 6 flow engine on `main`  
**Status:** Approved decisions from brainstorming (navigation-only)

## Problem

Phase 6 shipped a working navigation flow engine and a **form + JSON textarea** editor at `/settings/bot-flow`. Admins want a **SendPulse-like visual builder**: canvas, wires, side panel, plus **draft → preview → publish** so live buyers are not affected until Publish.

## Goal

Replace the Bot Flow form UI with a two-pane visual editor over the **existing** `BotFlow` / `BotFlowNode` graph (edit existing nodes only). Support **Save draft**, **in-dashboard Telegram mock preview** of the draft, and **Publish** (promote draft → live nodes + BotCopy bodies + `bump()`).

## Non-goals

- Add/delete nodes or invent new node keys
- Filter / Pause / API / Random / wait-for-reply / AI steps (full SendPulse)
- Real Telegram “send to myself” preview
- React / Vue / SPA rewrite of the dashboard
- Changing checkout (`p:` / `v:` / bayar) or expanding `ACTIONS` allowlist
- Phase 7 command retirement / Phase 8 IA

## Locked decisions

| Topic | Decision |
|-------|----------|
| Scope | Navigation-only: `screen` + `action` |
| Nodes | Edit existing only |
| Layout | Two-pane: canvas + right panel |
| Message text | Edit in panel; draft holds body; Publish writes `BotCopy` |
| Buttons | Panel edits labels/types; draw wires for `go` |
| Lifecycle | Save draft → Preview (mock) → Publish |
| Preview | In-dashboard phone-frame mock (not live Telegram) |
| Stack | EJS + vanilla JS + Drawflow (CDN) |

## Decisions

### D1 — Draft snapshot on `BotFlow`

Do **not** duplicate all rows into a second node table. Store one JSON draft on the active flow:

```
BotFlow.draft JSONB NULL
BotFlow.draft_updated_at TIMESTAMPTZ NULL
```

Draft shape:

```json
{
  "entry_key": "welcome",
  "nodes": [
    {
      "key": "welcome",
      "kind": "screen",
      "screen_key": "screen.welcome",
      "action": null,
      "description": "...",
      "pos_x": 80,
      "pos_y": 120,
      "body": "Halo, *{{first_name}}* ...",
      "buttons": [[{ "label": "‹📦› Daftar Produk", "go": "product_list" }]]
    },
    {
      "key": "product_list",
      "kind": "action",
      "screen_key": null,
      "action": "product_list",
      "description": "...",
      "pos_x": 420,
      "pos_y": 80,
      "buttons": []
    }
  ]
}
```

Rules:

- `key` set is **fixed** to published keys (no create/delete). Save draft rejects unknown keys / missing required keys.
- Screen nodes may include `body` (draft copy). Action nodes ignore `body`.
- Button `label_key` may be dropped in the editor in favor of resolved `label` text (Publish keeps literal `label`; optional: preserve `label_key` if unchanged).

### D2 — Canvas positions on published nodes

```
BotFlowNode.pos_x DOUBLE PRECISION NOT NULL DEFAULT 0
BotFlowNode.pos_y DOUBLE PRECISION NOT NULL DEFAULT 0
```

Publish copies `pos_*` from draft so reload after publish restores layout. Seed migration backfills a simple left-to-right layout for existing rows.

### D3 — Lifecycle API

| Action | Effect |
|--------|--------|
| **Save draft** | Validate draft → write `BotFlow.draft` + `draft_updated_at`. **No** `bump()`. Live bot unchanged. |
| **Preview** | Client loads draft (or last saved); phone mock walks **screen** nodes. Action taps show stub sheet (“Opens product list in live bot”). |
| **Publish** | Validate draft → upsert each `BotFlowNode` (buttons, description, kind fields, pos) → for each screen node with `body`, update `BotCopy.body` where `key = screen_key` → clear or keep draft (keep; mark published) → `runtimeSettings.bump()`. |

Enable toggle (`flow_engine_enabled`) stays separate: Publish updates graph/copy; kill switch still controls whether the bot uses the engine.

### D4 — UI layout

```
┌─────────────────────────────────────────────────────────────┐
│ Bot Flow          [Save draft] [Preview] [Publish]  Enable  │
├──────────────────────────────┬──────────────────────────────┤
│                              │  Selected node               │
│   Start ──► welcome ──► …    │  kind / key (read-only)      │
│              │               │  body textarea (screen)      │
│         product_list         │  action select (action)      │
│                              │  buttons table + Add row     │
│         (Drawflow canvas)    │  Apply to canvas (local)     │
└──────────────────────────────┴──────────────────────────────┘
```

- No left toolbox (cannot add nodes).
- Wires: output port per `go` button → input of target node; drawing/removing updates `buttons[].go`.
- URL / `url_from` / `callback` buttons: no wire; edited only in the panel.

### D5 — Preview mock

- Overlay / drawer with phone frame (~390×700).
- Start at `entry_key`; render Markdown-ish caption as plain/simple HTML (reuse existing patterns or escape + bold `*text*`).
- Inline keyboard from draft buttons; `go` navigates; `url`/`url_from` open link or show toast; `callback` shows “Legacy callback: X (not simulated)”.
- Action node: title + “This opens **{action}** in the live bot” + Back.
- Template vars: sample `{ first_name: 'Preview', nama_bot, user_count: 1, … }` via `copy.render` on the server endpoint **or** client-side same regex as `lib/copy.js` (prefer shared pure `render` already in `lib/copy.js` via a tiny preview API that returns rendered caption).

Prefer: `POST /api/bot-flow/preview-step` with `{ nodeKey, vars? }` returning `{ type, caption, buttons }` from **draft** (server uses draft JSON + `copy.render`). Keeps Markdown/render consistent; still not Telegram.

### D6 — Pure graph helpers (`lib/flow-draft.js`)

Testable without DOM:

- `validateDraft(draft, publishedKeys: string[]): { ok, errors[] }`
- `draftFromPublished(nodes, copyBodies): draft` — initial draft hydrate
- `applyWire(draft, fromKey, buttonIndex, toKey): draft`
- `publishPlan(draft): { nodePatches[], copyPatches[] }` — pure transform used by Publish route

### D7 — Drawflow

Load Drawflow CSS/JS from CDN in the Bot Flow page only. Custom node HTML for screen vs action. Persist positions into draft on drag-end. Do not add React.

## Success criteria

1. Open `/settings/bot-flow` → canvas shows seeded nodes with wires for `go` buttons  
2. Edit welcome body in panel → Save draft → live `/start` **unchanged**  
3. Preview shows new welcome text in phone mock; click Daftar Produk → action stub  
4. Publish → within ~10s bot `/start` (engine on) shows new text + keyboard  
5. Cannot add/delete nodes from UI  
6. `node --test` covers `lib/flow-draft.js`  
7. Form JSON editor removed/replaced (no dual editors)

## Architecture

```
Dashboard canvas (draft in memory)
        │ Save draft
        ▼
BotFlow.draft (JSONB)
        │ Preview API (read draft)
        ▼
Phone mock (dashboard)
        │ Publish
        ▼
BotFlowNode + BotCopy + bump()
        │ poll
        ▼
Bot runtime (published only)
```
