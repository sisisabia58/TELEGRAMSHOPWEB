SET search_path TO public, extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS "BotFlow" (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT false,
    entry_key TEXT NOT NULL DEFAULT 'welcome',
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS "BotFlowNode" (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    flow_id UUID NOT NULL REFERENCES "BotFlow"(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('screen', 'action')),
    screen_key TEXT,
    action TEXT,
    buttons JSONB NOT NULL DEFAULT '[]'::jsonb,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    UNIQUE (flow_id, key)
);

CREATE INDEX IF NOT EXISTS idx_botflownode_flow ON "BotFlowNode"(flow_id);

DROP TRIGGER IF EXISTS update_botflow_updated_at ON "BotFlow";
CREATE TRIGGER update_botflow_updated_at
    BEFORE UPDATE ON "BotFlow"
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_botflownode_updated_at ON "BotFlowNode";
CREATE TRIGGER update_botflownode_updated_at
    BEFORE UPDATE ON "BotFlowNode"
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE "BotFlow" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for service role" ON "BotFlow";
CREATE POLICY "Allow all for service role" ON "BotFlow"
    FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE "BotFlowNode" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for service role" ON "BotFlowNode";
CREATE POLICY "Allow all for service role" ON "BotFlowNode"
    FOR ALL USING (true) WITH CHECK (true);

INSERT INTO "NotificationSettings" (setting_key, setting_value, updated_at)
VALUES ('flow_engine_enabled', '{"value": false}'::jsonb, NOW())
ON CONFLICT (setting_key) DO NOTHING;

INSERT INTO "BotFlow" (id, name, is_active, entry_key)
VALUES ('a0000000-0000-4000-8000-000000000001', 'default', true, 'welcome')
ON CONFLICT (id) DO NOTHING;

INSERT INTO "BotFlowNode" (flow_id, key, kind, screen_key, action, buttons, description) VALUES
(
  'a0000000-0000-4000-8000-000000000001',
  'welcome',
  'screen',
  'screen.welcome',
  NULL,
  '[
    [{"label_key":"msg.menu_daftar_produk","go":"product_list"}],
    [{"label_key":"msg.menu_kategori","go":"kategori_menu"}],
    [{"label_key":"msg.menu_riwayat","go":"riwayat"},{"label_key":"msg.menu_cara_order","go":"cara_order"}],
    [{"label_key":"msg.menu_saldo","go":"saldo_menu"},{"label_key":"msg.menu_stok","go":"stok"}],
    [{"label_key":"msg.menu_channel","url_from":"channel_store"}],
    [{"label_key":"msg.menu_cs","url_from":"cs"}]
  ]'::jsonb,
  'Home /start and kembaliawal'
),
(
  'a0000000-0000-4000-8000-000000000001',
  'saldo_menu',
  'screen',
  'screen.saldo_menu',
  NULL,
  '[
    [{"label":"💳 Top Up Saldo","callback":"deposit_menu"}],
    [{"label":"📋 Riwayat Deposit","callback":"riwayatdeposit"}],
    [{"label":"🔙 Menu Utama","go":"welcome"}]
  ]'::jsonb,
  'Saldo & deposit menu'
),
(
  'a0000000-0000-4000-8000-000000000001',
  'cara_order',
  'screen',
  'screen.cara_order',
  NULL,
  '[
    [{"label":"📦 Mulai Order","go":"product_list"},{"label":"💰 Top Up Saldo","go":"saldo_menu"}],
    [{"label":"❓ FAQ","callback":"caraorder_faq"},{"label":"💳 Metode Bayar","callback":"caraorder_payment"}],
    [{"label_key":"msg.menu_cs","url_from":"cs"},{"label_key":"msg.menu_channel","url_from":"channel_store"}],
    [{"label":"🔙 Kembali","go":"welcome"}]
  ]'::jsonb,
  'Cara order guide'
),
(
  'a0000000-0000-4000-8000-000000000001',
  'product_list',
  'action',
  NULL,
  'product_list',
  '[]'::jsonb,
  'Opens sendProductPage'
),
(
  'a0000000-0000-4000-8000-000000000001',
  'kategori_menu',
  'action',
  NULL,
  'kategori_menu',
  '[]'::jsonb,
  'Opens kategori picker'
),
(
  'a0000000-0000-4000-8000-000000000001',
  'stok',
  'action',
  NULL,
  'stok',
  '[]'::jsonb,
  'Buyer stok report'
),
(
  'a0000000-0000-4000-8000-000000000001',
  'riwayat',
  'action',
  NULL,
  'riwayat',
  '[]'::jsonb,
  'Riwayat transaksi'
)
ON CONFLICT (flow_id, key) DO NOTHING;
