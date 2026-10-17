-- Originally committed on phase13-flow-builder-graph-crud as
-- 20260818000000_publish_bot_flow_graph.sql. Renamed on merge so it does not
-- share a version with 20260818000000_supplier_sourcing.sql from PR #34.
SET search_path TO public, extensions;

-- Ensure media columns exist on the quoted table used by the app.
-- 20260817000000 targeted unquoted bot_flow_node, which is a different identifier.
ALTER TABLE "BotFlowNode"
  ADD COLUMN IF NOT EXISTS media_url TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS media_type VARCHAR(20) DEFAULT 'photo';

-- Atomically apply a flow-builder publish diff (nodes + screen copies + BotFlow).
-- Separate supabase-js writes do not share a transaction.
CREATE OR REPLACE FUNCTION public.publish_bot_flow_graph(
  p_flow_id uuid,
  p_draft jsonb,
  p_entry_key text,
  p_node_deletes text[],
  p_node_upserts jsonb,
  p_copy_inserts jsonb,
  p_copy_upserts jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO public
AS $$
BEGIN
  IF p_flow_id IS NULL THEN
    RAISE EXCEPTION 'flow id required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM "BotFlow" WHERE id = p_flow_id) THEN
    RAISE EXCEPTION 'flow not found';
  END IF;

  IF p_node_deletes IS NOT NULL AND cardinality(p_node_deletes) > 0 THEN
    DELETE FROM "BotFlowNode"
    WHERE flow_id = p_flow_id
      AND key = ANY (p_node_deletes);
  END IF;

  INSERT INTO "BotFlowNode" (
    flow_id, key, kind, screen_key, action, description, buttons,
    pos_x, pos_y, media_url, media_type, updated_at
  )
  SELECT
    p_flow_id,
    n->>'key',
    n->>'kind',
    n->>'screen_key',
    n->>'action',
    COALESCE(n->>'description', ''),
    COALESCE(n->'buttons', '[]'::jsonb),
    COALESCE(NULLIF(n->>'pos_x', '')::double precision, 0),
    COALESCE(NULLIF(n->>'pos_y', '')::double precision, 0),
    NULLIF(n->>'media_url', ''),
    COALESCE(NULLIF(n->>'media_type', ''), 'photo'),
    NOW()
  FROM jsonb_array_elements(COALESCE(p_node_upserts, '[]'::jsonb)) AS n
  ON CONFLICT (flow_id, key) DO UPDATE SET
    kind = EXCLUDED.kind,
    screen_key = EXCLUDED.screen_key,
    action = EXCLUDED.action,
    description = EXCLUDED.description,
    buttons = EXCLUDED.buttons,
    pos_x = EXCLUDED.pos_x,
    pos_y = EXCLUDED.pos_y,
    media_url = EXCLUDED.media_url,
    media_type = EXCLUDED.media_type,
    updated_at = NOW();

  INSERT INTO "BotCopy" (key, kind, body, description, variables)
  SELECT
    c->>'key',
    'screen',
    COALESCE(c->>'body', ''),
    COALESCE(c->>'description', ''),
    '[]'::jsonb
  FROM jsonb_array_elements(COALESCE(p_copy_inserts, '[]'::jsonb)) AS c;

  UPDATE "BotCopy" AS bc
  SET
    body = COALESCE(c->>'body', ''),
    updated_at = NOW()
  FROM jsonb_array_elements(COALESCE(p_copy_upserts, '[]'::jsonb)) AS c
  WHERE bc.key = c->>'key'
    AND bc.kind = 'screen';

  UPDATE "BotFlow"
  SET
    draft = p_draft,
    draft_updated_at = NOW(),
    entry_key = p_entry_key
  WHERE id = p_flow_id;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_bot_flow_graph(uuid, jsonb, text, text[], jsonb, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_bot_flow_graph(uuid, jsonb, text, text[], jsonb, jsonb, jsonb)
  TO anon, authenticated, service_role;
