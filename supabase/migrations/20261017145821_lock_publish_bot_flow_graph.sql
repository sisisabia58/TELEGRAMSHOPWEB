-- Lock the publish RPC to the server-side service_role.
--
-- 20260818000001_publish_bot_flow_graph.sql granted EXECUTE on
-- public.publish_bot_flow_graph to anon and authenticated. That exposes the
-- function through PostgREST (/rest/v1/rpc/publish_bot_flow_graph) to anyone
-- holding the public anon key. The only caller is the dashboard's
-- POST /api/bot-flow/publish route (dashboard.js), which goes through the shared
-- server-side client in lib/supabase.js built from SUPABASE_KEY. That key must be
-- the service_role key (see docs/runbooks/phase13-supplier-sourcing.md), so
-- Publish keeps working after this change.
--
-- The function is SECURITY INVOKER with SET search_path TO public already pinned,
-- so no search_path change is needed here.
SET search_path TO public, extensions;

REVOKE EXECUTE ON FUNCTION public.publish_bot_flow_graph(uuid, jsonb, text, text[], jsonb, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_bot_flow_graph(uuid, jsonb, text, text[], jsonb, jsonb, jsonb)
  TO service_role;
