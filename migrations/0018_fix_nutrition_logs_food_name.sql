-- The post-data-loss rebuild (migrations/0000) reconstructed
-- nutrition_logs with a column called `name`, but the app has always
-- inserted `food_name` (logFoodEntry(), app.html) — confirmed by
-- checking every real call site, nothing in the app ever wrote or read
-- a `name` column on this table. Every food log attempt has been
-- failing outright with PGRST204 ("Could not find the food_name column
-- ... in the schema cache") since the rebuild, not silently dropping
-- data — this just renames the column to match reality.

alter table public.nutrition_logs rename column name to food_name;
