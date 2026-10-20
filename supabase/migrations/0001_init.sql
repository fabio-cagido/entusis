-- entusis — initial schema
-- Paste into Supabase → SQL Editor and run once.

create type item_type as enum ('PAGE', 'MINDMAP_NODE', 'TASK', 'EVENT');
create type item_status as enum ('BACKLOG', 'TODO', 'DOING', 'DONE');
create type view_kind as enum ('PAGE', 'CANVAS', 'BOARD');

create table public.projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  name        text not null,
  color       text not null default '#7c6cff',
  icon        text,
  sort_order  double precision not null default 0,
  created_at  timestamptz not null default now()
);

create table public.item_nodes (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users on delete cascade,
  title           text not null default '',
  content         text not null default '',
  icon            text,
  type            item_type not null default 'PAGE',
  parent_id       uuid references public.item_nodes(id) on delete cascade,
  project_id      uuid references public.projects(id) on delete set null,
  status          item_status,
  is_today        boolean not null default false,
  start_time      timestamptz,
  end_time        timestamptz,
  google_event_id text,
  attachments     jsonb not null default '[]'::jsonb,
  links           uuid[] not null default '{}',
  canvas          jsonb,
  default_view    view_kind not null default 'PAGE',
  sort_order      double precision not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index item_nodes_user_idx     on public.item_nodes (user_id);
create index item_nodes_parent_idx   on public.item_nodes (parent_id);
create index item_nodes_project_idx  on public.item_nodes (project_id);
create index item_nodes_status_idx   on public.item_nodes (status) where status is not null;
create unique index item_nodes_gcal_idx on public.item_nodes (user_id, google_event_id)
  where google_event_id is not null;

-- Row Level Security: each user only sees their own data
alter table public.projects   enable row level security;
alter table public.item_nodes enable row level security;

create policy "own projects" on public.projects
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own items" on public.item_nodes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Realtime
alter publication supabase_realtime add table public.item_nodes;
alter publication supabase_realtime add table public.projects;
