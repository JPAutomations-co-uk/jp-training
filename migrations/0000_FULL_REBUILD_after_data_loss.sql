-- ============================================================
-- FULL DATABASE REBUILD — 31 Aug 2026
--
-- Context: the Supabase project's data was lost during a migration
-- attempt (project ref confusion + a "restore" action that appears to
-- have wiped rather than restored). This script rebuilds the complete
-- schema this app needs, from two sources:
--
--   1. HIGH CONFIDENCE — every table/column/policy that exists in this
--      repo's migrations/0001-0017 files, replayed here in final form
--      (later migrations that superseded earlier ones — e.g. 0004
--      superseding 0003's rename — are represented in their FINAL
--      state only, not replayed step-by-step).
--
--   2. RECONSTRUCTED FROM APP CODE — `profiles`, `progress_checkins`,
--      `workout_sessions`, `session_sets`, `nutrition_logs`, `calls`,
--      `call_rsvps`, `applications`, `business_metrics`, `xp_log`, and
--      the `is_admin()` function were NEVER captured in this repo's
--      migrations at all — they were created directly (some via the
--      separate jp-training-app session sharing this same Supabase
--      project, some via one-off exec_raw/setup.js calls) and existed
--      only as live, unversioned database state. That state is what
--      was lost. The definitions below are reverse-engineered from
--      every real .from('table').select/insert/update/upsert call in
--      app.html and api/*.js — this is a best-effort reconstruction,
--      not a certain one. Marked clearly below with "RECONSTRUCTED".
--      Spot-check these against real usage once the app is live again
--      — a missing or wrong column here will surface as a specific,
--      loud PostgREST error (e.g. "column X does not exist"), not a
--      silent failure, so problems will be easy to find and patch with
--      a simple ALTER TABLE.
--
-- WHAT THIS CANNOT DO: recover actual data. Real user accounts
-- (auth.users — Fraser, any Standard members who signed up, your own
-- account), every real habit/workout/nutrition log, every real
-- community post — none of that comes back from a schema rebuild.
-- This makes the app FUNCTIONAL again for new signups and new activity
-- going forward. If a Supabase-side backup of the old project exists,
-- restoring that is a completely different and better outcome than
-- this script — check that first if it hasn't been ruled out already.
--
-- Run this ONCE, in order, top to bottom, in the target project's SQL
-- Editor. Idempotent where the source migrations were idempotent;
-- some DROP+CREATE blocks are destructive by design (matching the
-- original migrations) — safe here only because the target is empty.
-- ============================================================


-- ══════════════════════════════════════════════════════════════
-- SECTION 1 — RECONSTRUCTED CORE TABLES (not in any migration file)
-- ══════════════════════════════════════════════════════════════

-- profiles — the central user-profile table almost everything else
-- foreign-keys against. RECONSTRUCTED from every real column referenced
-- across app.html/api/*.js: id, email, display_name, status (used in
-- 'pending'/'approved' gating throughout Community), is_admin (real
-- boolean column, read as PROFILE?.is_admin client-side), xp, level,
-- streak_days, last_active_date (XP/gamification), bio, avatar_url,
-- links, location_name/location_lat/location_lng (member map, added in
-- 0007/0009/0010 as ALTER TABLE — included here directly since the base
-- table itself is being created fresh).
create table if not exists public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  email             text,
  display_name      text,
  status            text not null default 'pending',   -- 'pending' | 'approved' | other admin-set values
  is_admin          boolean not null default false,
  xp                integer not null default 0,
  level             integer not null default 1,
  streak_days       integer not null default 0,
  last_active_date  date,
  bio               text,
  avatar_url        text,
  links             text,
  location_name     text,
  location_lat      double precision,
  location_lng      double precision,
  created_at        timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- is_admin() — SECURITY DEFINER so it can be used inside other tables'
-- RLS policies without those policies recursing into profiles' own RLS.
-- Referenced by nearly every Community policy in this file.
create or replace function public.is_admin() returns boolean
language sql security definer stable as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.is_approved() returns boolean
language sql security definer stable as $$
  select coalesce((select status = 'approved' from public.profiles where id = auth.uid()), false);
$$;

do $do$ begin
  if not exists (select 1 from pg_policies where tablename = 'profiles' and policyname = 'Users can read their own profile') then
    create policy "Users can read their own profile" on public.profiles for select using (id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'profiles' and policyname = 'Users can update their own profile') then
    create policy "Users can update their own profile" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'profiles' and policyname = 'Users can insert their own profile') then
    create policy "Users can insert their own profile" on public.profiles for insert with check (id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'profiles' and policyname = 'Approved members can view other approved members') then
    create policy "Approved members can view other approved members" on public.profiles for select using (is_admin() or (status = 'approved' and is_approved()));
  end if;
end $do$;

-- progress_checkins — 5-metric daily check-in (CHECK_METRICS in app.html:
-- energy, sleep_q, mood, libido, adherence).
create table if not exists public.progress_checkins (
  user_id     uuid not null references auth.users(id) on delete cascade,
  date        date not null default current_date,
  energy      smallint,
  sleep_q     smallint,
  mood        smallint,
  libido      smallint,
  adherence   smallint,
  created_at  timestamptz not null default now(),
  primary key (user_id, date)
);
alter table public.progress_checkins enable row level security;
do $do$ begin
  if not exists (select 1 from pg_policies where tablename = 'progress_checkins' and policyname = 'Users manage own checkins') then
    create policy "Users manage own checkins" on public.progress_checkins for all using (auth.uid() = user_id);
  end if;
end $do$;

-- workout_sessions + session_sets — training log. workout_sessions is the
-- session header (one per day trained), session_sets is one row per
-- logged set (weight/reps), referencing the session.
create table if not exists public.workout_sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  date          date not null default current_date,
  session_type  text,
  created_at    timestamptz not null default now()
);
create index if not exists workout_sessions_user_id_idx on public.workout_sessions(user_id);
create index if not exists workout_sessions_user_date_idx on public.workout_sessions(user_id, date);
alter table public.workout_sessions enable row level security;
do $do$ begin
  if not exists (select 1 from pg_policies where tablename = 'workout_sessions' and policyname = 'Users manage own workout sessions') then
    create policy "Users manage own workout sessions" on public.workout_sessions for all using (auth.uid() = user_id);
  end if;
end $do$;

create table if not exists public.session_sets (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references public.workout_sessions(id) on delete cascade,
  exercise_name  text not null,
  set_number     integer not null default 1,
  reps           integer,
  weight_kg      numeric,
  created_at     timestamptz not null default now()
);
create index if not exists session_sets_session_id_idx on public.session_sets(session_id);
create index if not exists session_sets_exercise_name_idx on public.session_sets(exercise_name);
alter table public.session_sets enable row level security;
do $do$ begin
  if not exists (select 1 from pg_policies where tablename = 'session_sets' and policyname = 'Users manage own session sets') then
    create policy "Users manage own session sets" on public.session_sets for all
      using (exists (select 1 from public.workout_sessions ws where ws.id = session_id and ws.user_id = auth.uid()));
  end if;
end $do$;

-- nutrition_logs — free-text food logging + AI scoring (Eat tab).
-- Columns beyond the required ones are a best-effort superset based on
-- what the food scorer/UI clearly needs (calories/macros, a name, a
-- score) — verify against a real log entry once live and ALTER TABLE
-- to add anything missing rather than guessing further here.
create table if not exists public.nutrition_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  date        date not null default current_date,
  food_name   text,
  calories    numeric,
  protein_g   numeric,
  carbs_g     numeric,
  fat_g       numeric,
  score       numeric,
  notes       text,
  created_at  timestamptz not null default now()
);
create index if not exists nutrition_logs_user_date_idx on public.nutrition_logs(user_id, date);
alter table public.nutrition_logs enable row level security;
do $do$ begin
  if not exists (select 1 from pg_policies where tablename = 'nutrition_logs' and policyname = 'Users manage own nutrition logs') then
    create policy "Users manage own nutrition logs" on public.nutrition_logs for all using (auth.uid() = user_id);
  end if;
end $do$;

-- xp_log — one row per XP-earning action, used to prevent double-earn
-- (unique on user_id+action_type+action_key+earned_at) and to compute
-- "perfect day" completion.
create table if not exists public.xp_log (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  action_type  text not null,
  action_key   text not null,
  xp_earned    integer not null default 0,
  earned_at    date not null default current_date,
  created_at   timestamptz not null default now(),
  unique (user_id, action_type, action_key, earned_at)
);
alter table public.xp_log enable row level security;
do $do$ begin
  if not exists (select 1 from pg_policies where tablename = 'xp_log' and policyname = 'Users manage own xp log') then
    create policy "Users manage own xp log" on public.xp_log for all using (auth.uid() = user_id);
  end if;
end $do$;

-- calls — scheduled group calls (title/description/scheduled_at seen in
-- app.html's call card rendering). host/link/type are a reasonable
-- best-effort superset for a calls-listing feature — verify against
-- actual usage once live.
create table if not exists public.calls (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  description    text,
  scheduled_at   timestamptz not null,
  link           text,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now()
);
alter table public.calls enable row level security;
do $do$ begin
  if not exists (select 1 from pg_policies where tablename = 'calls' and policyname = 'Approved members can read calls') then
    create policy "Approved members can read calls" on public.calls for select using (is_admin() or is_approved());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'calls' and policyname = 'Admins manage calls') then
    create policy "Admins manage calls" on public.calls for all using (is_admin()) with check (is_admin());
  end if;
end $do$;

create table if not exists public.call_rsvps (
  call_id     uuid not null references public.calls(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  status      text not null default 'going',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (call_id, user_id)
);
alter table public.call_rsvps enable row level security;
do $do$ begin
  if not exists (select 1 from pg_policies where tablename = 'call_rsvps' and policyname = 'Approved members can read rsvps') then
    create policy "Approved members can read rsvps" on public.call_rsvps for select using (is_admin() or is_approved());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'call_rsvps' and policyname = 'Users manage own rsvp') then
    create policy "Users manage own rsvp" on public.call_rsvps for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end $do$;

-- applications — apply-funnel submissions (name/email/phone/status/
-- reviewed_at/updated_at confirmed from admin review UI). Real
-- application intake mostly flows through the separate Modal webhook
-- (execution/modal_webhook.py, outside this repo), which likely writes
-- here with the service-role key — this table just needs to exist with
-- a compatible shape for the admin review screen to read/update.
create table if not exists public.applications (
  id            uuid primary key default gen_random_uuid(),
  name          text,
  email         text,
  phone         text,
  status        text not null default 'pending',   -- 'pending' | 'screening_booked' | 'accepted' | 'rejected'
  answers       jsonb default '{}'::jsonb,          -- raw quiz answers, whatever shape the webhook sends
  reviewed_at   timestamptz,
  updated_at    timestamptz,
  created_at    timestamptz not null default now()
);
alter table public.applications enable row level security;
do $do$ begin
  if not exists (select 1 from pg_policies where tablename = 'applications' and policyname = 'Admins manage applications') then
    create policy "Admins manage applications" on public.applications for all using (is_admin()) with check (is_admin());
  end if;
end $do$;

-- business_metrics — member-submitted revenue tracking (user_id,
-- period_start, revenue confirmed from admin compliance dashboard).
create table if not exists public.business_metrics (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  period_start  date not null,
  revenue       numeric,
  created_at    timestamptz not null default now(),
  unique (user_id, period_start)
);
alter table public.business_metrics enable row level security;
do $do$ begin
  if not exists (select 1 from pg_policies where tablename = 'business_metrics' and policyname = 'Users manage own business metrics') then
    create policy "Users manage own business metrics" on public.business_metrics for all using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'business_metrics' and policyname = 'Admins read all business metrics') then
    create policy "Admins read all business metrics" on public.business_metrics for select using (is_admin());
  end if;
end $do$;


-- ══════════════════════════════════════════════════════════════
-- SECTION 2 — FROM MIGRATION HISTORY (high confidence, final state)
-- ══════════════════════════════════════════════════════════════

-- ── 0001: habit_log ──
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

-- ── 0005: user_state ──
create table if not exists public.user_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  onboarding jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.user_state enable row level security;
do $do$ begin
  if not exists (select 1 from pg_policies where tablename = 'user_state' and policyname = 'Users can read their own state') then
    create policy "Users can read their own state" on public.user_state for select using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'user_state' and policyname = 'Users can write their own state') then
    create policy "Users can write their own state" on public.user_state for insert with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'user_state' and policyname = 'Users can update their own state') then
    create policy "Users can update their own state" on public.user_state for update using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $do$;

-- ── 0004 (final form, supersedes 0003's community_channels naming): standard_channels + channel_messages ──
create table if not exists public.standard_channels (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  position integer not null default 0,
  admin_only_post boolean not null default false,
  last_message_at timestamptz,     -- added by 0008
  created_at timestamptz not null default now()
);
create index if not exists standard_channels_position_idx on public.standard_channels(position);
alter table public.standard_channels enable row level security;

create table if not exists public.channel_messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.standard_channels(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  case_study_flagged boolean not null default false,   -- 0002
  case_study_notes text,                                 -- 0002
  reply_to_id uuid references public.channel_messages(id) on delete set null,  -- 0006
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists channel_messages_channel_id_idx on public.channel_messages(channel_id);
create index if not exists channel_messages_user_id_idx on public.channel_messages(user_id);
create index if not exists channel_messages_reply_to_idx on public.channel_messages(reply_to_id);
alter table public.channel_messages enable row level security;

do $do$ begin
  if not exists (select 1 from pg_policies where tablename = 'standard_channels' and policyname = 'Approved members can read channels') then
    create policy "Approved members can read channels" on public.standard_channels for select
      using (is_admin() or exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.status = 'approved'));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'standard_channels' and policyname = 'Admins manage channels') then
    create policy "Admins manage channels" on public.standard_channels for all using (is_admin()) with check (is_admin());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'channel_messages' and policyname = 'Approved members can read messages') then
    create policy "Approved members can read messages" on public.channel_messages for select
      using (is_admin() or exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.status = 'approved'));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'channel_messages' and policyname = 'Approved members can post messages') then
    create policy "Approved members can post messages" on public.channel_messages for insert
      with check (
        user_id = auth.uid() and (
          is_admin() or (
            exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.status = 'approved')
            and not exists (select 1 from public.standard_channels c where c.id = channel_id and c.admin_only_post = true)
          )
        )
      );
  end if;
  if not exists (select 1 from pg_policies where tablename = 'channel_messages' and policyname = 'Admins update messages') then
    create policy "Admins update messages" on public.channel_messages for update using (is_admin()) with check (is_admin());
  end if;
  -- 0013: additive own-message-delete path (combines with admin policy via OR)
  if not exists (select 1 from pg_policies where tablename = 'channel_messages' and policyname = 'Users update their own messages') then
    create policy "Users update their own messages" on public.channel_messages for update using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $do$;

do $$ begin
  alter publication supabase_realtime add table public.channel_messages;
exception when duplicate_object then null; end $$;

insert into public.standard_channels (name, description, position, admin_only_post)
select * from (values
  ('General', 'General discussion for The Standard', 0, false),
  ('Wins', 'Share your wins, big or small', 1, false),
  ('Accountability', 'Daily and weekly check-ins — keep each other on track', 2, false),
  ('Introductions', 'New to The Standard? Introduce yourself here', 3, false),
  ('Training Talk', 'Programming, technique, recovery, anything training-related', 4, false)
) as v(name, description, position, admin_only_post)
where not exists (select 1 from public.standard_channels where standard_channels.name = v.name);

-- ── 0006: message_reactions ──
create table if not exists public.message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.channel_messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);
create index if not exists message_reactions_message_id_idx on public.message_reactions(message_id);
alter table public.message_reactions enable row level security;
do $do$ begin
  if not exists (select 1 from pg_policies where tablename = 'message_reactions' and policyname = 'Approved members can read reactions') then
    create policy "Approved members can read reactions" on public.message_reactions for select
      using (is_admin() or exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.status = 'approved'));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'message_reactions' and policyname = 'Approved members can add their own reactions') then
    create policy "Approved members can add their own reactions" on public.message_reactions for insert
      with check (user_id = auth.uid() and (is_admin() or exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.status = 'approved')));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'message_reactions' and policyname = 'Users can remove their own reactions') then
    create policy "Users can remove their own reactions" on public.message_reactions for delete using (user_id = auth.uid());
  end if;
end $do$;
do $$ begin
  alter publication supabase_realtime add table public.message_reactions;
exception when duplicate_object then null; end $$;

-- ── 0007: avatars storage bucket ──
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true) on conflict (id) do nothing;
do $do$ begin
  if not exists (select 1 from pg_policies where tablename = 'objects' and schemaname='storage' and policyname = 'Anyone can view avatars') then
    create policy "Anyone can view avatars" on storage.objects for select using (bucket_id = 'avatars');
  end if;
  if not exists (select 1 from pg_policies where tablename = 'objects' and schemaname='storage' and policyname = 'Users can upload their own avatar') then
    create policy "Users can upload their own avatar" on storage.objects for insert with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'objects' and schemaname='storage' and policyname = 'Users can update their own avatar') then
    create policy "Users can update their own avatar" on storage.objects for update using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
end $do$;

-- ── 0008: last_message_at trigger, channel_reads, notifications, DMs ──
create or replace function public.update_channel_last_message() returns trigger
language plpgsql as $$
begin
  update public.standard_channels set last_message_at = new.created_at where id = new.channel_id;
  return new;
end;
$$;
drop trigger if exists channel_messages_update_last_message on public.channel_messages;
create trigger channel_messages_update_last_message
  after insert on public.channel_messages
  for each row execute function public.update_channel_last_message();

create table if not exists public.channel_reads (
  user_id uuid not null references public.profiles(id) on delete cascade,
  channel_id uuid not null references public.standard_channels(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id, channel_id)
);
alter table public.channel_reads enable row level security;
do $do$ begin
  if not exists (select 1 from pg_policies where tablename = 'channel_reads' and policyname = 'Users manage their own read state') then
    create policy "Users manage their own read state" on public.channel_reads for all using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $do$;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  channel_id uuid references public.standard_channels(id) on delete cascade,
  message_id uuid references public.channel_messages(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  post_id uuid,             -- fk added below once posts exists (0014)
  dm_conversation_id uuid,  -- fk added below once dm_conversations exists (0014)
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_id_idx on public.notifications(user_id);
alter table public.notifications enable row level security;
do $do$ begin
  if not exists (select 1 from pg_policies where tablename = 'notifications' and policyname = 'Users can read their own notifications') then
    create policy "Users can read their own notifications" on public.notifications for select using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'notifications' and policyname = 'Any approved member can notify another about their own action') then
    create policy "Any approved member can notify another about their own action" on public.notifications for insert with check (actor_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'notifications' and policyname = 'Users can update their own notifications') then
    create policy "Users can update their own notifications" on public.notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $do$;
do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null; end $$;

create table if not exists public.dm_conversations (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_a, user_b)
);
create table if not exists public.dm_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.dm_conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists dm_messages_conversation_id_idx on public.dm_messages(conversation_id);
alter table public.dm_conversations enable row level security;
alter table public.dm_messages enable row level security;
do $do$ begin
  if not exists (select 1 from pg_policies where tablename = 'dm_conversations' and policyname = 'Users can read their own conversations') then
    create policy "Users can read their own conversations" on public.dm_conversations for select using (auth.uid() = user_a or auth.uid() = user_b);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'dm_conversations' and policyname = 'Users can create conversations they''re part of') then
    create policy "Users can create conversations they're part of" on public.dm_conversations for insert with check (auth.uid() = user_a or auth.uid() = user_b);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'dm_messages' and policyname = 'Users can read messages in their conversations') then
    create policy "Users can read messages in their conversations" on public.dm_messages for select
      using (exists (select 1 from public.dm_conversations c where c.id = conversation_id and (c.user_a = auth.uid() or c.user_b = auth.uid())));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'dm_messages' and policyname = 'Users can send messages in their conversations') then
    create policy "Users can send messages in their conversations" on public.dm_messages for insert
      with check (sender_id = auth.uid() and exists (select 1 from public.dm_conversations c where c.id = conversation_id and (c.user_a = auth.uid() or c.user_b = auth.uid())));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'dm_messages' and policyname = 'Users can mark messages read in their conversations') then
    create policy "Users can mark messages read in their conversations" on public.dm_messages for update
      using (exists (select 1 from public.dm_conversations c where c.id = conversation_id and (c.user_a = auth.uid() or c.user_b = auth.uid())));
  end if;
end $do$;
do $$ begin
  alter publication supabase_realtime add table public.dm_messages;
exception when duplicate_object then null; end $$;

-- ── 0009: posts, post_likes, post-media storage, profiles.links (already on profiles above) ──
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text,
  media_url text,
  media_type text,
  parent_post_id uuid references public.posts(id) on delete cascade,
  channel_id uuid references public.standard_channels(id) on delete set null,  -- 0011
  created_at timestamptz not null default now()
);
create index if not exists posts_user_id_idx on public.posts(user_id);
create index if not exists posts_parent_post_id_idx on public.posts(parent_post_id);
create index if not exists posts_created_at_idx on public.posts(created_at desc);
create index if not exists posts_channel_id_idx on public.posts(channel_id);

create table if not exists public.post_likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
alter table public.posts enable row level security;
alter table public.post_likes enable row level security;
do $do$ begin
  if not exists (select 1 from pg_policies where tablename = 'posts' and policyname = 'Approved members can read posts') then
    create policy "Approved members can read posts" on public.posts for select using (is_admin() or is_approved());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'posts' and policyname = 'Approved members can create their own posts') then
    create policy "Approved members can create their own posts" on public.posts for insert with check (user_id = auth.uid() and (is_admin() or is_approved()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'posts' and policyname = 'Users can delete their own posts') then
    create policy "Users can delete their own posts" on public.posts for delete using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'post_likes' and policyname = 'Approved members can read likes') then
    create policy "Approved members can read likes" on public.post_likes for select using (is_admin() or is_approved());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'post_likes' and policyname = 'Approved members can like posts') then
    create policy "Approved members can like posts" on public.post_likes for insert with check (user_id = auth.uid() and (is_admin() or is_approved()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'post_likes' and policyname = 'Users can remove their own likes') then
    create policy "Users can remove their own likes" on public.post_likes for delete using (user_id = auth.uid());
  end if;
end $do$;
do $$ begin alter publication supabase_realtime add table public.posts; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.post_likes; exception when duplicate_object then null; end $$;

insert into storage.buckets (id, name, public) values ('post-media', 'post-media', true) on conflict (id) do nothing;
do $do$ begin
  if not exists (select 1 from pg_policies where tablename = 'objects' and schemaname='storage' and policyname = 'Anyone can view post media') then
    create policy "Anyone can view post media" on storage.objects for select using (bucket_id = 'post-media');
  end if;
  if not exists (select 1 from pg_policies where tablename = 'objects' and schemaname='storage' and policyname = 'Users can upload their own post media') then
    create policy "Users can upload their own post media" on storage.objects for insert with check (bucket_id = 'post-media' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
end $do$;

-- ── 0014: notifications fk backfill now that posts/dm_conversations exist ──
do $do$ begin
  if not exists (select 1 from information_schema.table_constraints where constraint_name = 'notifications_post_id_fkey') then
    alter table public.notifications add constraint notifications_post_id_fkey foreign key (post_id) references public.posts(id) on delete cascade;
  end if;
  if not exists (select 1 from information_schema.table_constraints where constraint_name = 'notifications_dm_conversation_id_fkey') then
    alter table public.notifications add constraint notifications_dm_conversation_id_fkey foreign key (dm_conversation_id) references public.dm_conversations(id) on delete cascade;
  end if;
end $do$;

-- ── 0012: hormone_lab_assessments ──
create table if not exists public.hormone_lab_assessments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  engine_version text not null,
  selected_pains text[] not null default '{}',
  answers jsonb not null default '{}'::jsonb,
  profile_snapshot jsonb not null default '{}'::jsonb,
  patterns jsonb not null default '[]'::jsonb,
  narrative jsonb,
  narrative_model text
);
create index if not exists hormone_lab_assessments_user_id_idx on public.hormone_lab_assessments(user_id);
create index if not exists hormone_lab_assessments_user_created_idx on public.hormone_lab_assessments(user_id, created_at desc);
alter table public.hormone_lab_assessments enable row level security;
do $do$ begin
  if not exists (select 1 from pg_policies where tablename = 'hormone_lab_assessments' and policyname = 'Users can read their own assessments') then
    create policy "Users can read their own assessments" on public.hormone_lab_assessments for select using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'hormone_lab_assessments' and policyname = 'Users can insert their own assessments') then
    create policy "Users can insert their own assessments" on public.hormone_lab_assessments for insert with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'hormone_lab_assessments' and policyname = 'Users can delete their own assessments') then
    create policy "Users can delete their own assessments" on public.hormone_lab_assessments for delete using (user_id = auth.uid());
  end if;
end $do$;

-- ── 0015: bloodwork_assessments ──
create table if not exists public.bloodwork_assessments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  test_date date not null,
  lab_name text,
  engine_version text not null,
  markers jsonb not null default '{}'::jsonb,
  flags jsonb not null default '[]'::jsonb,
  clinical_review jsonb not null default '[]'::jsonb,
  narrative jsonb,
  narrative_model text
);
create index if not exists bloodwork_assessments_user_id_idx on public.bloodwork_assessments(user_id);
create index if not exists bloodwork_assessments_user_created_idx on public.bloodwork_assessments(user_id, created_at desc);
alter table public.bloodwork_assessments enable row level security;
do $do$ begin
  if not exists (select 1 from pg_policies where tablename = 'bloodwork_assessments' and policyname = 'Users can read their own bloodwork') then
    create policy "Users can read their own bloodwork" on public.bloodwork_assessments for select using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'bloodwork_assessments' and policyname = 'Users can insert their own bloodwork') then
    create policy "Users can insert their own bloodwork" on public.bloodwork_assessments for insert with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'bloodwork_assessments' and policyname = 'Users can delete their own bloodwork') then
    create policy "Users can delete their own bloodwork" on public.bloodwork_assessments for delete using (user_id = auth.uid());
  end if;
end $do$;

-- ── 0016: athlete_lab_assessments ──
create table if not exists public.athlete_lab_assessments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  input jsonb not null default '{}'::jsonb,
  result jsonb,
  result_model text
);
create index if not exists athlete_lab_assessments_user_id_idx on public.athlete_lab_assessments(user_id);
create index if not exists athlete_lab_assessments_user_created_idx on public.athlete_lab_assessments(user_id, created_at desc);
alter table public.athlete_lab_assessments enable row level security;
do $do$ begin
  if not exists (select 1 from pg_policies where tablename = 'athlete_lab_assessments' and policyname = 'Users can read their own athlete lab assessments') then
    create policy "Users can read their own athlete lab assessments" on public.athlete_lab_assessments for select using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'athlete_lab_assessments' and policyname = 'Users can insert their own athlete lab assessments') then
    create policy "Users can insert their own athlete lab assessments" on public.athlete_lab_assessments for insert with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'athlete_lab_assessments' and policyname = 'Users can delete their own athlete lab assessments') then
    create policy "Users can delete their own athlete lab assessments" on public.athlete_lab_assessments for delete using (user_id = auth.uid());
  end if;
end $do$;

-- ── 0017: mobility_assessments ──
create table if not exists public.mobility_assessments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  state jsonb not null default '{}'::jsonb,
  results jsonb
);
create index if not exists mobility_assessments_user_id_idx on public.mobility_assessments(user_id);
create index if not exists mobility_assessments_user_created_idx on public.mobility_assessments(user_id, created_at desc);
alter table public.mobility_assessments enable row level security;
do $do$ begin
  if not exists (select 1 from pg_policies where tablename = 'mobility_assessments' and policyname = 'Users can read their own mobility assessments') then
    create policy "Users can read their own mobility assessments" on public.mobility_assessments for select using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'mobility_assessments' and policyname = 'Users can insert their own mobility assessments') then
    create policy "Users can insert their own mobility assessments" on public.mobility_assessments for insert with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'mobility_assessments' and policyname = 'Users can delete their own mobility assessments') then
    create policy "Users can delete their own mobility assessments" on public.mobility_assessments for delete using (user_id = auth.uid());
  end if;
end $do$;

-- ============================================================
-- END. Next steps after running this:
--   1. Confirm every table above exists (Table Editor) and RLS shows
--      "Enabled" on each.
--   2. Sign up a fresh test account through the real signup flow and
--      confirm a profile row gets created (profiles insert policy).
--   3. Walk through Habits/Train/Eat/Community and watch for any
--      "column X does not exist" error — that pinpoints exactly which
--      RECONSTRUCTED table needs a column added, fast to fix with a
--      one-line ALTER TABLE once you see the real error.
--   4. Set your own account (and JP's) to is_admin = true and
--      status = 'approved' directly in the Table Editor once signed up
--      — nothing does this automatically for the first account.
-- ============================================================
