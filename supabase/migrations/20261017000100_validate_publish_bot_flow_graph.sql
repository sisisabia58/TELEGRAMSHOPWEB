-- Validate publish_bot_flow_graph argument shapes before applying the graph.
-- Signature, SECURITY INVOKER, and search_path are unchanged. Grants are
-- intentionally not modified here (a separate migration locks EXECUTE).
--
-- Do not apply this file from this PR; it is migration-only.

SET search_path TO public, extensions;

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
DECLARE
  n jsonb;
  c jsonb;
BEGIN
  IF p_flow_id IS NULL THEN
    RAISE EXCEPTION 'flow id required';
  END IF;

  IF p_entry_key IS NULL OR btrim(p_entry_key) = '' THEN
    RAISE EXCEPTION 'entry key required';
  END IF;

  IF p_draft IS NOT NULL AND jsonb_typeof(p_draft) <> 'object' THEN
    RAISE EXCEPTION 'draft must be a JSON object';
  END IF;

  IF p_node_upserts IS NOT NULL AND jsonb_typeof(p_node_upserts) <> 'array' THEN
    RAISE EXCEPTION 'node upserts must be a JSON array';
  END IF;

  IF p_copy_inserts IS NOT NULL AND jsonb_typeof(p_copy_inserts) <> 'array' THEN
    RAISE EXCEPTION 'copy inserts must be a JSON array';
  END IF;

  IF p_copy_upserts IS NOT NULL AND jsonb_typeof(p_copy_upserts) <> 'array' THEN
    RAISE EXCEPTION 'copy upserts must be a JSON array';
  END IF;

  FOR n IN SELECT value FROM jsonb_array_elements(COALESCE(p_node_upserts, '[]'::jsonb))
  LOOP
    IF n IS NULL OR jsonb_typeof(n) <> 'object' THEN
      RAISE EXCEPTION 'each node upsert must be a JSON object';
    END IF;
    IF n->>'key' IS NULL OR btrim(n->>'key') = '' THEN
      RAISE EXCEPTION 'node upsert missing key';
    END IF;
    IF n->>'kind' IS NULL OR n->>'kind' NOT IN ('screen', 'action') THEN
      RAISE EXCEPTION 'node % has invalid kind', n->>'key';
    END IF;
    IF NULLIF(btrim(COALESCE(n->>'pos_x', '')), '') IS NOT NULL
       AND (n->>'pos_x') !~ '^[+-]?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?$' THEN
      RAISE EXCEPTION 'node % pos_x must be numeric', n->>'key';
    END IF;
    IF NULLIF(btrim(COALESCE(n->>'pos_y', '')), '') IS NOT NULL
       AND (n->>'pos_y') !~ '^[+-]?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?$' THEN
      RAISE EXCEPTION 'node % pos_y must be numeric', n->>'key';
    END IF;
  END LOOP;

  FOR c IN SELECT value FROM jsonb_array_elements(COALESCE(p_copy_inserts, '[]'::jsonb))
  LOOP
    IF c IS NULL OR jsonb_typeof(c) <> 'object' THEN
      RAISE EXCEPTION 'each copy insert must be a JSON object';
    END IF;
    IF c->>'key' IS NULL OR btrim(c->>'key') = '' THEN
      RAISE EXCEPTION 'copy insert missing key';
    END IF;
  END LOOP;

  FOR c IN SELECT value FROM jsonb_array_elements(COALESCE(p_copy_upserts, '[]'::jsonb))
  LOOP
    IF c IS NULL OR jsonb_typeof(c) <> 'object' THEN
      RAISE EXCEPTION 'each copy upsert must be a JSON object';
    END IF;
    IF c->>'key' IS NULL OR btrim(c->>'key') = '' THEN
      RAISE EXCEPTION 'copy upsert missing key';
    END IF;
  END LOOP;

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
