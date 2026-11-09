-- 0010: Garante RLS estrito em public.projects (isolamento por usuário).
-- Idempotente e NÃO destrutivo: não executa DELETE/DROP/TRUNCATE nem altera linhas existentes.
-- Apenas habilita RLS e cria as políticas que ainda não existirem.

alter table public.projects enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'projects' and policyname = 'projects_select_own') then
    create policy "projects_select_own" on public.projects
      for select using (auth.uid() = user_id);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'projects' and policyname = 'projects_insert_own') then
    create policy "projects_insert_own" on public.projects
      for insert with check (auth.uid() = user_id);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'projects' and policyname = 'projects_update_own') then
    create policy "projects_update_own" on public.projects
      for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'projects' and policyname = 'projects_delete_own') then
    create policy "projects_delete_own" on public.projects
      for delete using (auth.uid() = user_id);
  end if;
end
$$;

