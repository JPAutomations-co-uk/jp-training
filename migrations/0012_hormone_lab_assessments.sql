-- Dedicated table for Hormone Lab results, replacing the fake-precision
-- LLM-invented hormone estimates (e.g. "Total T: 18 nmol/L, 62% confidence")
-- with deterministic pattern scores computed in code + LLM narrative layered
-- on top. NOT stored in user_state.onboarding (jsonb) — that table exists
-- specifically because cramming unstructured data into a single blob
-- already broke auth once (see 0005). Each assessment is its own row so
-- users can see pattern-likelihood trends over time instead of one
-- perpetually-overwritten object.

create table hormone_lab_assessments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),

  engine_version text not null,                          -- scoring rules will change; keeps old rows interpretable against the rules that produced them
  selected_pains text[] not null default '{}',
  answers jsonb not null default '{}'::jsonb,             -- raw questionnaire answers, forward-compatible input for re-scoring
  profile_snapshot jsonb not null default '{}'::jsonb,    -- age, BF%, TRT status, health conditions, sleep, alcohol, test_timing at run time

  patterns jsonb not null default '[]'::jsonb,            -- deterministic output: [{pattern, tier, score, stage, evidence:[...]}] — computed in code, never touched by the LLM
  narrative jsonb,                                        -- LLM prose layered on top: {summary, protocol:{...}} — nullable, can fail independently of scoring
  narrative_model text                                    -- e.g. 'claude-haiku-4-5-20251001', for audit if the model changes later
);

create index hormone_lab_assessments_user_id_idx on hormone_lab_assessments(user_id);
create index hormone_lab_assessments_user_created_idx on hormone_lab_assessments(user_id, created_at desc);

alter table hormone_lab_assessments enable row level security;

create policy "Users can read their own assessments"
  on hormone_lab_assessments for select
  using (user_id = auth.uid());

create policy "Users can insert their own assessments"
  on hormone_lab_assessments for insert
  with check (user_id = auth.uid());

create policy "Users can delete their own assessments"
  on hormone_lab_assessments for delete
  using (user_id = auth.uid());

-- No update policy — assessments are immutable snapshots, not editable state.
