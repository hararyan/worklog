-- Run this once in Supabase: SQL Editor -> New query -> paste -> Run

create table if not exists public.entries (
  id            bigint generated always as identity primary key,
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title         text not null,
  category      text not null default 'Learning',
  description   text not null default '',
  links         text[] not null default '{}',
  entry_date    date not null,
  start_time    time,
  end_time      time,
  duration_min  integer not null default 0 check (duration_min between 0 and 1440),
  images        text[] not null default '{}',   -- paths of files in the "screenshots" bucket
  created_at    timestamptz not null default now()
);

create index if not exists entries_user_date on public.entries (user_id, entry_date desc);

-- Each person can only see and change their own entries
alter table public.entries enable row level security;
drop policy if exists "own entries" on public.entries;
create policy "own entries" on public.entries
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Private bucket for screenshots (images only, max 8 MB each)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('screenshots', 'screenshots', false, 8388608,
        array['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
on conflict (id) do nothing;

-- Files are stored under a folder named after the user's id
drop policy if exists "own screenshots" on storage.objects;
create policy "own screenshots" on storage.objects
  for all to authenticated
  using (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text);
