# Phase 6b cutover — Visual flow builder

1. Merge PR → Railway deploys (old form gone; canvas loads).
2. `supabase db push` (adds draft + pos columns).
3. Open Dashboard → Settings → Bot Flow. Confirm canvas shows nodes.
4. Edit welcome text → Save draft → bot /start unchanged.
5. Preview → phone mock shows draft text.
6. Publish → within ~10s live bot (engine ON) shows new text.
7. Rollback live copy: re-edit + Publish previous text, or restore BotCopy row in Studio.
