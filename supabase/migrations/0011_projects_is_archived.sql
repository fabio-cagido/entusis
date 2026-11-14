-- 0011: Garante a coluna is_archived em public.projects e políticas RLS de leitura/atualização por usuário.
-- Idempotente e seguro: não apaga, duplica nem modifica projetos existentes.

ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'projects' AND policyname = 'projects_select_own'
  ) THEN
    CREATE POLICY "projects_select_own" ON public.projects
      FOR SELECT USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'projects' AND policyname = 'projects_insert_own'
  ) THEN
    CREATE POLICY "projects_insert_own" ON public.projects
      FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'projects' AND policyname = 'projects_update_own'
  ) THEN
    CREATE POLICY "projects_update_own" ON public.projects
      FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'projects' AND policyname = 'projects_delete_own'
  ) THEN
    CREATE POLICY "projects_delete_own" ON public.projects
      FOR DELETE USING (auth.uid() = user_id);
  END IF;
END
$$;

