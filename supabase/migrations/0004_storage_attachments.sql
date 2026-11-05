-- ayolia — Migration 0004: Supabase Storage Bucket & RLS Policies for Page Attachments
-- Execute este script no SQL Editor do Supabase para habilitar o upload de arquivos nas páginas.

-- 1. Criar o bucket "attachments" (caso ainda não exista)
insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', true, 52428800) -- 50 MB limite por arquivo
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit;

-- 2. Políticas de RLS na tabela storage.objects para o bucket "attachments"

-- SELECT: permitir leitura dos anexos do bucket 'attachments'
drop policy if exists "attachments_select_policy" on storage.objects;
create policy "attachments_select_policy"
  on storage.objects
  for select
  using (bucket_id = 'attachments');

-- INSERT: permitir que usuários autenticados façam upload na sua pasta (userId/pageId/fileName)
drop policy if exists "attachments_insert_policy" on storage.objects;
create policy "attachments_insert_policy"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- UPDATE: permitir que o próprio usuário atualize seus arquivos no bucket 'attachments'
drop policy if exists "attachments_update_policy" on storage.objects;
create policy "attachments_update_policy"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- DELETE: permitir que o próprio usuário remova seus arquivos do bucket 'attachments'
drop policy if exists "attachments_delete_policy" on storage.objects;
create policy "attachments_delete_policy"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

