-- Migration 0008: Add isolated submap_canvas_data JSONB column to item_nodes
-- Non-destructive additive column for independent node submaps/diagrams ("Como mapa")
ALTER TABLE item_nodes
  ADD COLUMN IF NOT EXISTS submap_canvas_data JSONB DEFAULT NULL;

