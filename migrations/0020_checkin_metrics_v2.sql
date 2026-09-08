-- Replaces the vague 5-slider check-in (energy/sleep_q/mood/libido/
-- adherence) with markers actually cited as evidence-based proxies in this
-- project's own coaching knowledge base (.claude/knowledge-base/) — see
-- app.html's CHECK_METRICS for the citations. Additive only: the old
-- columns stay untouched (historical rows keep their data), new
-- submissions just stop writing to them. libido is reused as-is.

alter table progress_checkins
  add column if not exists waking_energy int check (waking_energy between 1 and 10),
  add column if not exists cognitive_sharpness int check (cognitive_sharpness between 1 and 10),
  add column if not exists stress_load int check (stress_load between 1 and 10),
  add column if not exists morning_erection boolean,
  add column if not exists waking_3am boolean;
