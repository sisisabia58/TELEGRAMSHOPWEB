-- Migration: Add media support to bot_flow_node
ALTER TABLE bot_flow_node 
ADD COLUMN IF NOT EXISTS media_url TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS media_type VARCHAR(20) DEFAULT 'photo';
