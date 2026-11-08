-- Migration 0007: Add completed_at timestamp to item_nodes for temporal grouping of newly completed tasks
ALTER TABLE item_nodes
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ DEFAULT NULL;

