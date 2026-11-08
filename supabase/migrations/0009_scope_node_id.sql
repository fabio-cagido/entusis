-- Migration 0009: Add nullable scope_node_id to item_nodes for infinite recursive submap isolation
-- Non-destructive additive column: existing nodes remain with scope_node_id = NULL (root map scope)
ALTER TABLE item_nodes
  ADD COLUMN IF NOT EXISTS scope_node_id UUID DEFAULT NULL;

