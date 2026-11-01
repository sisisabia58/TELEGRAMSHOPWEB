-- publish_bot_flow_graph raised Postgres 42702 on every Publish:
--   column reference "n" is ambiguous
--   It could refer to either a PL/pgSQL variable or a table column.
--
-- 20261017225540 added DECLARE n jsonb / c jsonb for payload checks, but the
-- INSERT/UPDATE statements still used those same names as FROM aliases
-- (`jsonb_array_elements(...) AS n` and `AS c`). PL/pgSQL then treats `n->>'key'`
-- as both the variable and the alias. The node INSERT runs first, so production
-- only reported "n"; the copy statements have the same collision on "c".
--
-- Save draft does not call this function (it updates "BotFlow".draft only).
-- Publish always does, including after a successful save.
--
-- Signature, SECURITY INVOKER, and search_path are unchanged. Grants are not
-- modified: CREATE OR REPLACE keeps the service_role-only EXECUTE from
-- 20261017145821.

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
  node_item jsonb;
  copy_item jsonb;
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

  FOR node_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_node_upserts, '[]'::jsonb))
  LOOP
    IF node_item IS NULL OR jsonb_typeof(node_item) <> 'object' THEN
      RAISE EXCEPTION 'each node upsert must be a JSON object';
    END IF;
    IF node_item->>'key' IS NULL OR btrim(node_item->>'key') = '' THEN
      RAISE EXCEPTION 'node upsert missing key';
    END IF;
    IF node_item->>'kind' IS NULL OR node_item->>'kind' NOT IN ('screen', 'action') THEN
      RAISE EXCEPTION 'node % has invalid kind', node_item->>'key';
    END IF;
    IF NULLIF(btrim(COALESCE(node_item->>'pos_x', '')), '') IS NOT NULL
       AND (node_item->>'pos_x') !~ '^[+-]?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?$' THEN
      RAISE EXCEPTION 'node % pos_x must be numeric', node_item->>'key';
    END IF;
    IF NULLIF(btrim(COALESCE(node_item->>'pos_y', '')), '') IS NOT NULL
       AND (node_item->>'pos_y') !~ '^[+-]?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?$' THEN
      RAISE EXCEPTION 'node % pos_y must be numeric', node_item->>'key';
    END IF;
  END LOOP;

  FOR copy_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_copy_inserts, '[]'::jsonb))
  LOOP
    IF copy_item IS NULL OR jsonb_typeof(copy_item) <> 'object' THEN
      RAISE EXCEPTION 'each copy insert must be a JSON object';
    END IF;
    IF copy_item->>'key' IS NULL OR btrim(copy_item->>'key') = '' THEN
      RAISE EXCEPTION 'copy insert missing key';
    END IF;
  END LOOP;

  FOR copy_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_copy_upserts, '[]'::jsonb))
  LOOP
    IF copy_item IS NULL OR jsonb_typeof(copy_item) <> 'object' THEN
      RAISE EXCEPTION 'each copy upsert must be a JSON object';
    END IF;
    IF copy_item->>'key' IS NULL OR btrim(copy_item->>'key') = '' THEN
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

  -- Alias and column are qualified (`node_row.value`). Do not reuse a DECLARE
  -- name here: PL/pgSQL rejects that as ambiguous_column (42702).
  INSERT INTO "BotFlowNode" (
    flow_id, key, kind, screen_key, action, description, buttons,
    pos_x, pos_y, media_url, media_type, updated_at
  )
  SELECT
    p_flow_id,
    node_row.value->>'key',
    node_row.value->>'kind',
    node_row.value->>'screen_key',
    node_row.value->>'action',
    COALESCE(node_row.value->>'description', ''),
    COALESCE(node_row.value->'buttons', '[]'::jsonb),
    COALESCE(NULLIF(btrim(node_row.value->>'pos_x'), '')::double precision, 0),
    COALESCE(NULLIF(btrim(node_row.value->>'pos_y'), '')::double precision, 0),
    NULLIF(node_row.value->>'media_url', ''),
    COALESCE(NULLIF(node_row.value->>'media_type', ''), 'photo'),
    NOW()
  FROM jsonb_array_elements(COALESCE(p_node_upserts, '[]'::jsonb)) AS node_row
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
    copy_row.value->>'key',
    'screen',
    COALESCE(copy_row.value->>'body', ''),
    COALESCE(copy_row.value->>'description', ''),
    '[]'::jsonb
  FROM jsonb_array_elements(COALESCE(p_copy_inserts, '[]'::jsonb)) AS copy_row;

  UPDATE "BotCopy" AS bc
  SET
    body = COALESCE(copy_row.value->>'body', ''),
    updated_at = NOW()
  FROM jsonb_array_elements(COALESCE(p_copy_upserts, '[]'::jsonb)) AS copy_row
  WHERE bc.key = copy_row.value->>'key'
    AND bc.kind = 'screen';

  UPDATE "BotFlow"
  SET
    draft = p_draft,
    draft_updated_at = NOW(),
    entry_key = p_entry_key
  WHERE id = p_flow_id;
END;
$$;
