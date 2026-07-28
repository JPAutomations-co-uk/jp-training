-- ============================================================
-- Migration 0001 — habit_log table
-- Fixes a real, confirmed-live bug: app.html's habit tracking
-- (initHabits/toggleHabit, 4 call sites) reads/writes
-- daily_habits with a row-per-habit shape (date, habit_name,
-- completed), but the daily_habits table that actually exists
-- in this Supabase project only has the OTHER frontend's shape
-- (jp-training-app, the Expo mobile app: one row per day, a
-- boolean column per fixed habit). Confirmed via a live query:
-- selecting `date` from daily_habits returns
-- "42703 column daily_habits.date does not exist" — every
-- habit toggle on jptraining.fit has been silently failing to
-- save, for every user (at least one real signed-up user,
-- Fraser, has XP/streak data suggesting active use).
--
-- Reshaping daily_habits itself would break the Expo app's
-- existing boolean-column queries, so this adds a SEPARATE
-- table matching what app.html actually needs — including
-- support for arbitrary user-defined custom habits, which a
-- fixed-column table can never support anyway.
--
-- Idempotent — safe to run more than once.
-- Run in Supabase > SQL Editor.
-- ============================================================

create table if not exists public.habit_log (
  id          uuid default gen_random_uuid() primary key,
  user_id     uuid references auth.users(id) on delete cascade not null,
  date        date not null default current_date,
  habit_name  text not null,
  completed   boolean not null default false,
  created_at  timestamptz default now() not null,
  unique(user_id, date, habit_name)
);

alter table public.habit_log enable row level security;

do $do$ begin
  if not exists (select 1 from pg_policies where tablename = 'habit_log' and policyname = 'Users manage own habit log') then
    create policy "Users manage own habit log" on public.habit_log for all using (auth.uid() = user_id);
  end if;
end $do$;
