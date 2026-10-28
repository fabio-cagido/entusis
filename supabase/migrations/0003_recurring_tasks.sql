-- Migration 0003: Recurring Tasks Metadata on item_nodes
-- Allows tasks to automatically return to "DOING" status on a configured monthly or weekly day.

ALTER TABLE public.item_nodes
  ADD COLUMN IF NOT EXISTS is_recurring boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recurrence_type text CHECK (recurrence_type IN ('monthly', 'weekly') OR recurrence_type IS NULL),
  ADD COLUMN IF NOT EXISTS recurrence_day_of_month smallint CHECK (recurrence_day_of_month IS NULL OR (recurrence_day_of_month >= 1 AND recurrence_day_of_month <= 31)),
  ADD COLUMN IF NOT EXISTS recurrence_day_of_week smallint CHECK (recurrence_day_of_week IS NULL OR (recurrence_day_of_week >= 0 AND recurrence_day_of_week <= 6)),
  ADD COLUMN IF NOT EXISTS last_recurred_at timestamptz;

