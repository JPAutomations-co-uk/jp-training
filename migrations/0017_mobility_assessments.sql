-- Move/mobility questionnaire results were stored as OB.mobility, a single
-- object reassigned wholesale on every completion (app.html) — the
-- previous result was gone the moment a new one was generated, no trail
-- at all. Fixing this by growing OB.mobility into an array inside the
-- same jsonb blob was considered and rejected: user_state.onboarding
-- already broke auth once by growing too large (see 0005) — unbounded
-- history does not belong in that blob. Same real-table fix as
-- hormone_lab_assessments (0012) and athlete_lab_assessments (0016).

create table mobility_assessments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),

  state jsonb not null default '{}'::jsonb,      -- the submitted questionnaire (goals, problems, posture, desk, time, pref, growing, flex, injuries)
  results jsonb                                   -- the generated mobility protocol (api/mobility.js response, or the on-device fallback)
);

create index mobility_assessments_user_id_idx on mobility_assessments(user_id);
create index mobility_assessments_user_created_idx on mobility_assessments(user_id, created_at desc);

alter table mobility_assessments enable row level security;

create policy "Users can read their own mobility assessments"
  on mobility_assessments for select
  using (user_id = auth.uid());

create policy "Users can insert their own mobility assessments"
  on mobility_assessments for insert
  with check (user_id = auth.uid());

create policy "Users can delete their own mobility assessments"
  on mobility_assessments for delete
  using (user_id = auth.uid());

-- No update policy — same reasoning as the other assessment tables:
-- immutable snapshots, not editable state.
