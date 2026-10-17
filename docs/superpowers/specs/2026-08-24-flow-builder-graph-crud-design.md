# Phase 13 — Flow Builder Graph CRUD (Design Spec)

**Date:** 2026-08-24
**Source:** Phase 12 parity shipped UI CRUD but backend still enforces fixed published keys

## Problem

`validateDraft(draft, publishedKeys)` rejects any key not in the published set. Publish only UPDATEs `BotFlowNode` and omits `media_url`/`media_type`. Admins cannot persist add/delete or media.

## Locked decisions

| Topic | Decision |
|-------|----------|
| Validation | Graph integrity (unique keys, valid kinds, `entry_key` exists, `go` targets exist, actions in allowlist) plus screen `body` checks: non-empty, Telegram length (1024 caption / 4096 text), legacy Markdown |
| Publish | Atomic `publish_bot_flow_graph` RPC. JS validates payload shape before `rpc()`; SQL re-checks types. 400 `{ errors: [{ key, reason }] }` on validation failure. |
| Publish diff | `diffPublishPlan` → nodeDeletes, nodeUpserts, copyInserts, copyUpserts, entryKey |
| New screen nodes | INSERT `BotCopy` row (`kind: 'screen'`) on publish |
| Deleted nodes | DELETE `BotFlowNode`; leave orphan `BotCopy` rows |
| Entry node | Cannot delete; toolbar dropdown changes `draft.entry_key` |
| Media | Publish writes `media_url` + `media_type`; preview shows image |

## Non-goals

Filter/API/Pause/Random nodes, conditional edges, Telegram live preview, media file upload, expanding ACTIONS allowlist, checkout rewrite.
