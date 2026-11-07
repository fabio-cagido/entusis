-- ayolia — Migration 0005: Soft Delete & 7-Day Trash Retention on item_nodes
-- Substitui a exclusão física imediata por Soft Delete (deleted_at) com retenção de 7 dias.

-- 1. Adicionar coluna deleted_at e índice
ALTER TABLE public.item_nodes
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_item_nodes_deleted_at
  ON public.item_nodes(deleted_at);

-- 2. Função utilitária para expurgar itens na lixeira há mais de 7 dias
CREATE OR REPLACE FUNCTION public.purge_expired_trash()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count integer;
BEGIN
  WITH deleted AS (
    DELETE FROM public.item_nodes
    WHERE deleted_at IS NOT NULL
      AND deleted_at < NOW() - INTERVAL '7 days'
    RETURNING id
  )
  SELECT count(*) INTO deleted_count FROM deleted;

  RETURN deleted_count;
END;
$$;

