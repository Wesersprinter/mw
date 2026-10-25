-- Maschenwerk – Datenbank für Konten und Abgleich
-- Einmal komplett im Supabase SQL Editor ausführen (New query → einfügen → Run).
-- Das Skript lässt sich gefahrlos erneut ausführen.

-- 1. Einträge: Projekte, Anleitungen, Garne, Nadeln, Maschenproben -----------------
create table if not exists public.items (
  user_id        uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  kind           text        not null check (kind in ('projects','patterns','yarns','needles','swatches')),
  id             text        not null check (char_length(id) between 1 and 64),
  data           jsonb       not null check (octet_length(data::text) < 1000000),
  updated_at     bigint      not null,                    -- Zeitstempel des Geräts (ms), der jüngere Stand gewinnt
  deleted        boolean     not null default false,
  server_updated timestamptz not null default clock_timestamp(),
  primary key (user_id, kind, id)
);
create index if not exists items_user_server_updated on public.items (user_id, server_updated);

alter table public.items enable row level security;

revoke all on public.items from anon;
grant select, insert, update, delete on public.items to authenticated;

drop policy if exists items_select_own on public.items;
drop policy if exists items_insert_own on public.items;
drop policy if exists items_update_own on public.items;
drop policy if exists items_delete_own on public.items;
create policy items_select_own on public.items for select to authenticated using ((select auth.uid()) = user_id);
create policy items_insert_own on public.items for insert to authenticated with check ((select auth.uid()) = user_id);
create policy items_update_own on public.items for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy items_delete_own on public.items for delete to authenticated using ((select auth.uid()) = user_id);

-- Älterer Stand überschreibt nie einen jüngeren; der Server stempelt jede Änderung
create or replace function public.items_lww() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return null;
  end if;
  new.server_updated := clock_timestamp();
  return new;
end $$;

drop trigger if exists items_lww on public.items;
create trigger items_lww before insert or update on public.items
  for each row execute function public.items_lww();

-- Live-Abgleich zwischen Geräten
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'items') then
    alter publication supabase_realtime add table public.items;
  end if;
end $$;

-- 2. Dateien: PDFs und Fotos, jede Person nur im eigenen Ordner ---------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('files', 'files', false, 20971520,
        array['application/pdf','image/jpeg','image/png','image/webp','image/gif','text/plain','text/markdown'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists files_select_own on storage.objects;
drop policy if exists files_insert_own on storage.objects;
drop policy if exists files_update_own on storage.objects;
drop policy if exists files_delete_own on storage.objects;
create policy files_select_own on storage.objects for select to authenticated
  using (bucket_id = 'files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy files_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy files_update_own on storage.objects for update to authenticated
  using (bucket_id = 'files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy files_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'files' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- 3. Konto löschen (DSGVO Art. 17) -------------------------------------------------
-- Die App löscht vorher die Dateien über die Storage-Schnittstelle; diese Funktion
-- entfernt dann das Konto, alle Einträge folgen über "on delete cascade".
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'nicht angemeldet';
  end if;
  delete from auth.users where id = auth.uid();
end $$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
