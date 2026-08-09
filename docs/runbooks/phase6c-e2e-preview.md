# Phase 6c — E2E buyer preview in flow builder

## What changed

Preview on `/settings/bot-flow` now walks a realistic buyer path:

1. **Resolved labels** — `label_key` / BotCopy (`msg.menu_*`) shown as real button text
2. **Product list** — live catalog via `catalog.listProducts` (stock counts, pagination, popular filter)
3. **Categories** — kategori menu → filtered product list
4. **Product card** — variants + prices from DB
5. **Qty screen** — copy template; payment remains live-bot only
6. **Stok / riwayat / deposit** — informative preview screens (not empty stubs)

## Still live-bot only

- Actual QRIS / saldo checkout
- Per-user transaction history
- External URL opens (channel / CS)

## API

`POST /api/bot-flow/preview-step`

```json
{ "draft": {…}, "nodeKey": "welcome" }
{ "draft": {…}, "nodeKey": "product_list" }
{ "draft": {…}, "preview": { "type": "product", "slug": "netflix" } }
{ "draft": {…}, "preview": { "type": "product_list", "page": 0, "kategori": "game" } }
{ "draft": {…}, "preview": { "type": "qty", "kode": "nf1", "slug": "netflix", … } }
```

## Files

- `lib/flow-preview.js` + `test/flow-preview.test.js`
- `dashboard.js` preview handler
- `public/js/flow-builder.js` / `public/css/flow-builder.css`
