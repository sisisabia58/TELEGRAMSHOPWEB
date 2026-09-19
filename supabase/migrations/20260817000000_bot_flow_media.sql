-- Migration: Add media support to BotFlowNode
ALTER TABLE "BotFlowNode"
ADD COLUMN IF NOT EXISTS media_url TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS media_type VARCHAR(20) DEFAULT 'photo';
