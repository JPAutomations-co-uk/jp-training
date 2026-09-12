-- Two nullable columns marking whether a logged food's macros were
-- deterministically calculated from the verified food-composition database
-- (matchFoodToDatabase/FOOD_MACRO_DB) or estimated by the AI scorer, and
-- whether a calculated entry still had to assume one detail (e.g. mince fat
-- ratio, an unquantified cooking-fat amount). Added 12 Sep 2026 as part of
-- the food-logging accuracy pass — this durable flag is the actual point
-- of that work, so unlike the rest of the per-meal rating detail (which
-- lives cache-only in the client's foodRatings/localStorage and is
-- accepted to be lost on a new device), this one gets a real column.
--
-- Nullable, no default: existing rows read as null, which the app already
-- treats identically to "not verified" — no backfill needed.
--
-- NOT auto-applied by this session — run this against the live Supabase
-- project (SQL editor, or the same mechanism used for prior migrations)
-- before or shortly after this deploy. The app degrades gracefully either
-- way (renderFoods() falls back to the client-side cache flag until these
-- columns exist), but food logging itself is unaffected regardless of when
-- this runs since the app does not yet write these columns on insert.

alter table public.nutrition_logs add column if not exists verified boolean;
alter table public.nutrition_logs add column if not exists assumed_composition boolean;
