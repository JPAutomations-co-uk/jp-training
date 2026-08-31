-- Dedicated table for real, user-submitted bloodwork results — same
-- pattern as 0012_hormone_lab_assessments.sql (each test is its own
-- immutable row so users can see marker trends over time, not stored in
-- user_state.onboarding jsonb, which already broke auth once by growing
-- too large — see 0005). Reference ranges are stored PER ASSESSMENT,
-- submitted by the user alongside each value, rather than hardcoded
-- against a "standard" range — different UK labs report different
-- ranges/units for the same marker, and flagging a value against the
-- wrong lab's range would be actively misleading.

create table bloodwork_assessments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),

  test_date date not null,                              -- date blood was drawn, not date entered
  lab_name text,                                         -- e.g. 'Medichecks' — optional, for context only

  engine_version text not null,                          -- classification rules will change; keeps old rows interpretable against the rules that produced them
  markers jsonb not null default '{}'::jsonb,             -- raw submission: { [marker_key]: {value, unit, refLow, refHigh} }

  flags jsonb not null default '[]'::jsonb,               -- deterministic output: [{marker, status, value, unit, refLow, refHigh}] — computed in code, never touched by the LLM
  clinical_review jsonb not null default '[]'::jsonb,     -- deterministic output: named patterns/critical markers flagged as needing a doctor, not a lifestyle tweak — computed in code, never touched by the LLM
  narrative jsonb,                                        -- LLM prose layered on top of flags/clinical_review only: {summary, in_scope_guidance:{...}} — nullable, can fail independently of scoring
  narrative_model text                                    -- e.g. 'claude-haiku-4-5-20251001', for audit if the model changes later
);

create index bloodwork_assessments_user_id_idx on bloodwork_assessments(user_id);
create index bloodwork_assessments_user_created_idx on bloodwork_assessments(user_id, created_at desc);

alter table bloodwork_assessments enable row level security;

create policy "Users can read their own bloodwork"
  on bloodwork_assessments for select
  using (user_id = auth.uid());

create policy "Users can insert their own bloodwork"
  on bloodwork_assessments for insert
  with check (user_id = auth.uid());

create policy "Users can delete their own bloodwork"
  on bloodwork_assessments for delete
  using (user_id = auth.uid());

-- No update policy — assessments are immutable snapshots, not editable state.
-- If a user makes a data-entry error, the correct fix is deleting the row
-- and resubmitting, not silently editing a historical medical record.
