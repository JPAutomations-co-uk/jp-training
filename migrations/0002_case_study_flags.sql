-- ============================================================
-- Migration 0002 — case study flag on channel_messages
--
-- Lets JP mark a real member message (#wins or anywhere) as a
-- case-study candidate — ties genuine results into the content
-- pipeline. This is the FLAGGING step only; the actual 90-day
-- consent conversation with the member still happens separately
-- (see jp-training-group-offer memory — no fabricated case
-- studies, ever).
--
-- No new RLS needed: channel_messages' existing UPDATE policy
-- already grants admins full write access, and the
-- restrict_message_update trigger only restricts non-admin
-- actors — an admin flagging these columns is unaffected by it.
--
-- Idempotent — safe to run more than once.
-- Run in Supabase > SQL Editor.
-- ============================================================

alter table public.channel_messages
  add column if not exists case_study_flagged boolean not null default false;

alter table public.channel_messages
  add column if not exists case_study_notes text;
