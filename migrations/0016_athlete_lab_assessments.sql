-- Athlete Lab results were only ever stored in localStorage (alStorageKey()
-- in app.html), a single overwritten blob per browser — the previous
-- result was gone the moment a new one was generated, and nothing
-- persisted across devices. Same fix as hormone_lab_assessments
-- (0012): a real table, one immutable row per assessment, so results
-- survive and trends become possible.

create table athlete_lab_assessments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),

  input jsonb not null default '{}'::jsonb,     -- the submitted questionnaire: sport, position, level, weaknesses, goals, phase, frequency, experience, notes, profile
  result jsonb,                                  -- the generated protocol JSON returned by api/athlete-lab.js
  result_model text                              -- e.g. 'claude-haiku-4-5-20251001'
);

create index athlete_lab_assessments_user_id_idx on athlete_lab_assessments(user_id);
create index athlete_lab_assessments_user_created_idx on athlete_lab_assessments(user_id, created_at desc);

alter table athlete_lab_assessments enable row level security;

create policy "Users can read their own athlete lab assessments"
  on athlete_lab_assessments for select
  using (user_id = auth.uid());

create policy "Users can insert their own athlete lab assessments"
  on athlete_lab_assessments for insert
  with check (user_id = auth.uid());

create policy "Users can delete their own athlete lab assessments"
  on athlete_lab_assessments for delete
  using (user_id = auth.uid());

-- No update policy — same reasoning as hormone_lab_assessments and
-- bloodwork_assessments: immutable snapshots, not editable state.
