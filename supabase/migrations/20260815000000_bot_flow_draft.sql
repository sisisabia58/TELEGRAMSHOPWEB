SET search_path TO public, extensions;

ALTER TABLE "BotFlow"
  ADD COLUMN IF NOT EXISTS draft JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS draft_updated_at TIMESTAMPTZ DEFAULT NULL;

ALTER TABLE "BotFlowNode"
  ADD COLUMN IF NOT EXISTS pos_x DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pos_y DOUBLE PRECISION NOT NULL DEFAULT 0;

UPDATE "BotFlowNode" SET pos_x = 80,  pos_y = 140 WHERE key = 'welcome';
UPDATE "BotFlowNode" SET pos_x = 420, pos_y = 40  WHERE key = 'product_list';
UPDATE "BotFlowNode" SET pos_x = 420, pos_y = 160 WHERE key = 'kategori_menu';
UPDATE "BotFlowNode" SET pos_x = 420, pos_y = 280 WHERE key = 'riwayat';
UPDATE "BotFlowNode" SET pos_x = 420, pos_y = 400 WHERE key = 'stok';
UPDATE "BotFlowNode" SET pos_x = 760, pos_y = 140 WHERE key = 'saldo_menu';
UPDATE "BotFlowNode" SET pos_x = 760, pos_y = 300 WHERE key = 'cara_order';
