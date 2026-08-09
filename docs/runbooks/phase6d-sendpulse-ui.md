# Phase 6d — SendPulse-like flow editor UI

## Goal

Make `/settings/bot-flow` feel like SendPulse for **editing existing nodes**, without adding Filter/API/Pause toolbox.

## Changes

1. **Cards** — Message (green) / Action (purple) headers, body preview, go-button rows with port hints
2. **Right inspector** — Always visible; auto-selects entry node on load; message textarea + buttons + green **Apply**
3. **Selection fix** — Click card opens panel (Drawflow `nodeSelected` + click fallback); id Map coerces string/number
4. **Canvas** — Dot grid background, teal ports, blue wires, selected card highlight

## How to edit

1. Click a card (or use the panel already open on `welcome`)
2. Change message / button labels / targets
3. **Apply** → updates the canvas card
4. **Save draft** → persists (bot unchanged)
5. **Preview** / **Publish** as before

## Out of scope

- Left toolbox / add-delete nodes
- Filter, API, Pause, Random, carousel media blocks
