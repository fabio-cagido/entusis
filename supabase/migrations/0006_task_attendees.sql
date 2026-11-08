-- Migration 0006: Add attendees (participants) array and google_event_link to item_nodes
ALTER TABLE item_nodes
  ADD COLUMN IF NOT EXISTS attendees TEXT[] DEFAULT '{}'::TEXT[],
  ADD COLUMN IF NOT EXISTS google_event_link TEXT DEFAULT NULL;

