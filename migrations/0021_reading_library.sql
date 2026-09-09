-- ============================================================
-- Migration 0021 — Reading / Study Library
-- Adds the "reading" daily habit (see app.html getHabits()) and its
-- backing data: reading_items is the catalogue (one row per book/
-- article/paper/course/podcast), reading_sessions is one row per logged
-- session against an item (minutes + optional notes). The Habits pane's
-- 30-min/day goal is computed by summing reading_sessions.minutes for the
-- viewed date — there is no separate boolean flag to drift out of sync.
--
-- Idempotent — safe to run more than once.
-- Run in Supabase > SQL Editor.
-- ============================================================

create table if not exists public.reading_items (
  id             uuid default gen_random_uuid() primary key,
  user_id        uuid references auth.users(id) on delete cascade not null,
  title          text not null,
  author         text,
  type           text not null default 'book' check (type in ('book','article','paper','course','podcast','other')),
  category       text,
  status         text not null default 'in_progress' check (status in ('wishlist','in_progress','completed','abandoned')),
  rating         smallint check (rating between 1 and 5),
  key_takeaway   text,
  date_started   date,
  date_finished  date,
  created_at     timestamptz default now() not null,
  updated_at     timestamptz default now() not null
);

create table if not exists public.reading_sessions (
  id          uuid default gen_random_uuid() primary key,
  user_id     uuid references auth.users(id) on delete cascade not null,
  item_id     uuid references public.reading_items(id) on delete cascade not null,
  date        date not null default current_date,
  minutes     integer not null check (minutes > 0),
  notes       text,
  created_at  timestamptz default now() not null
);

create index if not exists reading_sessions_user_date_idx on public.reading_sessions(user_id, date);
create index if not exists reading_sessions_item_idx on public.reading_sessions(item_id);
create index if not exists reading_items_user_status_idx on public.reading_items(user_id, status);

alter table public.reading_items enable row level security;
alter table public.reading_sessions enable row level security;

do $do$ begin
  if not exists (select 1 from pg_policies where tablename = 'reading_items' and policyname = 'Users manage own reading items') then
    create policy "Users manage own reading items" on public.reading_items for all using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'reading_sessions' and policyname = 'Users manage own reading sessions') then
    create policy "Users manage own reading sessions" on public.reading_sessions for all using (auth.uid() = user_id);
  end if;
end $do$;
