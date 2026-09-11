-- One row per user per calendar day, holding the aggregate nutrition
-- score for that day. Per JP's direction: the per-meal AI score/tagline
-- on nutrition_logs are no longer the important permanent record (those
-- columns stay for historical rows, just unused for new ones going
-- forward — see logFoodEntry()) — this table is the new durable record,
-- kept current by updateDayScore() every time a meal is logged or removed.

create table if not exists public.nutrition_day_scores (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  date date not null,
  score numeric,
  meals_scored int not null default 0,
  updated_at timestamptz default now() not null,
  unique(user_id, date)
);

alter table public.nutrition_day_scores enable row level security;

do $do$ begin
  if not exists (select 1 from pg_policies where tablename = 'nutrition_day_scores' and policyname = 'Users manage own nutrition day scores') then
    create policy "Users manage own nutrition day scores" on public.nutrition_day_scores for all using (auth.uid() = user_id);
  end if;
end $do$;
