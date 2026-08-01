-- Root cause of the Community channels failure (and a latent risk for
-- every other feature that grows OB over time): OB (training/nutrition/
-- mobility/habits/future-self/beliefs — everything saveOnboardingSection()
-- and friends have been writing all session) was stored entirely in
-- auth.users.user_metadata via sb.auth.updateUser({data:{onboarding:OB}}).
-- Supabase embeds user_metadata directly in the JWT payload on every
-- request. For JP's account specifically, OB had grown to ~50KB, making
-- his access token ~50,788 characters — Supabase's API gateway rejects
-- requests with oversized Authorization headers before they ever reach
-- PostgREST, which is what was actually breaking Community (nothing to do
-- with the channels table itself, which was rebuilt clean three times).
--
-- This moves OB into its own table instead, which isn't embedded in the
-- JWT and has no meaningful size ceiling for this use case.

create table user_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  onboarding jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table user_state enable row level security;

create policy "Users can read their own state"
  on user_state for select
  using (user_id = auth.uid());

create policy "Users can write their own state"
  on user_state for insert
  with check (user_id = auth.uid());

create policy "Users can update their own state"
  on user_state for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
