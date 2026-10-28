-- êntusis — Migration 0002: Mind Map Sharing (Multi-user Access via RLS)
-- Paste into Supabase → SQL Editor and run.

-- 1. Tabela de compartilhamento por e-mail
create table if not exists public.item_node_shares (
  id            uuid primary key default gen_random_uuid(),
  item_id       uuid not null references public.item_nodes(id) on delete cascade,
  invited_email text not null,
  permission    text not null default 'write' check (permission in ('read', 'write')),
  created_by    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at    timestamptz not null default now(),
  constraint item_node_shares_email_lower_chk check (invited_email = lower(invited_email)),
  constraint item_node_shares_item_email_unique unique (item_id, invited_email)
);

create index if not exists item_node_shares_item_idx  on public.item_node_shares (item_id);
create index if not exists item_node_shares_email_idx on public.item_node_shares (lower(invited_email));

-- Garantir conversão automática de invited_email para lowercase em INSERT/UPDATE
create or replace function public.normalize_share_email()
returns trigger
language plpgsql
as $$
begin
  new.invited_email := lower(trim(new.invited_email));
  return new;
end;
$$;

drop trigger if exists trg_normalize_share_email on public.item_node_shares;
create trigger trg_normalize_share_email
  before insert or update on public.item_node_shares
  for each row execute function public.normalize_share_email();

-- 2. Funções auxiliares SECURITY DEFINER (evitam recursão infinita de RLS em item_nodes)

-- Verifica se o usuário autenticado é dono do item_node
create or replace function public.is_item_owner(target_item_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.item_nodes n
    where n.id = target_item_id
      and n.user_id = auth.uid()
  );
$$;

-- Verifica se o e-mail do usuário autenticado possui compartilhamento no próprio item
-- ou em qualquer nó ancestral (parent_id -> ... -> raiz do mapa mental).
-- Quando required_perm = 'write', exige permission = 'write'.
-- Quando required_perm = 'read', aceita 'read' ou 'write'.
create or replace function public.has_item_share_access(
  target_item_id uuid,
  target_parent_id uuid,
  required_perm text default 'read'
)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  with recursive ancestors as (
    select target_item_id as id, target_parent_id as parent_id, 0 as depth
    union all
    select p.id, p.parent_id, a.depth + 1
    from public.item_nodes p
    join ancestors a on p.id = a.parent_id
    where a.parent_id is not null
      and a.depth < 50
  )
  select exists (
    select 1
    from ancestors a
    join public.item_node_shares s on s.item_id = a.id
    where a.id is not null
      and lower(s.invited_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and (
        required_perm = 'read'
        or (required_perm = 'write' and s.permission = 'write')
      )
  );
$$;

-- 3. Políticas de RLS para item_node_shares
alter table public.item_node_shares enable row level security;

drop policy if exists "shares_select_policy" on public.item_node_shares;
create policy "shares_select_policy" on public.item_node_shares
  for select
  using (
    created_by = auth.uid()
    or public.is_item_owner(item_id)
    or lower(invited_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

drop policy if exists "shares_insert_policy" on public.item_node_shares;
create policy "shares_insert_policy" on public.item_node_shares
  for insert
  with check (
    created_by = auth.uid()
    and public.is_item_owner(item_id)
  );

drop policy if exists "shares_update_policy" on public.item_node_shares;
create policy "shares_update_policy" on public.item_node_shares
  for update
  using (
    created_by = auth.uid()
    or public.is_item_owner(item_id)
  )
  with check (
    created_by = auth.uid()
    or public.is_item_owner(item_id)
  );

drop policy if exists "shares_delete_policy" on public.item_node_shares;
create policy "shares_delete_policy" on public.item_node_shares
  for delete
  using (
    created_by = auth.uid()
    or public.is_item_owner(item_id)
    or lower(invited_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

-- 4. Atualização das Políticas de RLS em public.item_nodes
drop policy if exists "own items" on public.item_nodes;
drop policy if exists "item_nodes_select_policy" on public.item_nodes;
drop policy if exists "item_nodes_insert_policy" on public.item_nodes;
drop policy if exists "item_nodes_update_policy" on public.item_nodes;
drop policy if exists "item_nodes_delete_policy" on public.item_nodes;

-- SELECT: dono OU convidado ('read' ou 'write') no item ou ancestral raiz
create policy "item_nodes_select_policy" on public.item_nodes
  for select
  using (
    user_id = auth.uid()
    or public.has_item_share_access(id, parent_id, 'read')
  );

-- INSERT: dono OU convidado com permissão 'write' adicionando nós filhos em mapa compartilhado
create policy "item_nodes_insert_policy" on public.item_nodes
  for insert
  with check (
    user_id = auth.uid()
    or public.has_item_share_access(id, parent_id, 'write')
  );

-- UPDATE: dono OU convidado com permissão 'write' no item ou ancestral raiz
create policy "item_nodes_update_policy" on public.item_nodes
  for update
  using (
    user_id = auth.uid()
    or public.has_item_share_access(id, parent_id, 'write')
  )
  with check (
    user_id = auth.uid()
    or public.has_item_share_access(id, parent_id, 'write')
  );

-- DELETE: dono OU convidado com permissão 'write' excluindo nós filhos do mapa compartilhado
create policy "item_nodes_delete_policy" on public.item_nodes
  for delete
  using (
    user_id = auth.uid()
    or (parent_id is not null and public.has_item_share_access(id, parent_id, 'write'))
  );

-- 5. Habilitar Realtime na tabela de compartilhamentos (idempotente)
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'item_node_shares'
  ) then
    alter publication supabase_realtime add table public.item_node_shares;
  end if;
end;
$$;

