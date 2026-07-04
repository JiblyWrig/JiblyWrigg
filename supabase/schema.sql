-- ============================================================
--  Lilac Chat — Supabase schema
--  Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- 1. Messages table -------------------------------------------------
create table if not exists public.messages (
  id            uuid primary key default gen_random_uuid(),
  sender_id     text not null check (sender_id in ('user1','user2')),
  content       text not null default '',
  file_url      text,
  file_type     text check (file_type in ('image','video','audio','file') or file_type is null),
  file_name     text,
  created_at    bigint not null default (extract(epoch from now()) * 1000)::bigint,
  read_at       bigint,
  delivered_at  bigint,
  sticker       text,
  pinned        boolean not null default false,
  reply_to      uuid
);

-- Newest last
create index if not exists messages_created_at_idx
  on public.messages (created_at asc);

-- 2. Row Level Security --------------------------------------------
alter table public.messages enable row level security;

drop policy if exists "anyone can read messages" on public.messages;
create policy "anyone can read messages"
  on public.messages for select using (true);

drop policy if exists "anyone can insert messages" on public.messages;
create policy "anyone can insert messages"
  on public.messages for insert with check (true);

drop policy if exists "anyone can update messages" on public.messages;
create policy "anyone can update messages"
  on public.messages for update using (true);

drop policy if exists "anyone can delete messages" on public.messages;
create policy "anyone can delete messages"
  on public.messages for delete using (true);

-- 3. Realtime -------------------------------------------------------
alter publication supabase_realtime add table public.messages;

-- 4. Storage bucket for files / selfies ----------------------------
insert into storage.buckets (id, name, public)
values ('chat-files', 'chat-files', true)
on conflict (id) do nothing;

drop policy if exists "anyone can upload chat files" on storage.objects;
create policy "anyone can upload chat files"
  on storage.objects for insert with check (bucket_id = 'chat-files');

drop policy if exists "anyone can read chat files" on storage.objects;
create policy "anyone can read chat files"
  on storage.objects for select using (bucket_id = 'chat-files');

drop policy if exists "anyone can delete chat files" on storage.objects;
create policy "anyone can delete chat files"
  on storage.objects for delete using (bucket_id = 'chat-files');

-- 5. Device identity claims (auto-assign "me" vs "her" per device) --
create table if not exists public.device_claims (
  client_id    text primary key,
  user_id      text not null unique check (user_id in ('user1','user2')),
  claimed_at   bigint not null default (extract(epoch from now()) * 1000)::bigint
);

alter table public.device_claims enable row level security;

drop policy if exists "anyone can read claims" on public.device_claims;
create policy "anyone can read claims"
  on public.device_claims for select using (true);

drop policy if exists "anyone can insert claims" on public.device_claims;
create policy "anyone can insert claims"
  on public.device_claims for insert with check (true);

drop policy if exists "anyone can delete claims" on public.device_claims;
create policy "anyone can delete claims"
  on public.device_claims for delete using (true);

-- Done.
