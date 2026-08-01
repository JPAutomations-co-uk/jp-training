-- Community Phase 2: member directory + profiles.
-- New profile fields, safe (non-recursive) visibility policy for viewing
-- other approved members, and an avatars storage bucket.

alter table profiles add column if not exists bio text;
alter table profiles add column if not exists avatar_url text;

-- Mirrors the existing is_admin() pattern (SECURITY DEFINER, queries
-- profiles internally) — needed so this policy's own subquery doesn't
-- recurse back into profiles' RLS.
create or replace function is_approved() returns boolean
language sql security definer stable as $$
  select coalesce((select status = 'approved' from public.profiles where id = auth.uid()), false);
$$;

-- Adds visibility (doesn't replace whatever "read your own row" policy
-- already exists — profiles.xp/streak_days/display_name updates already
-- work throughout this app, so that policy is already in place).
create policy "Approved members can view other approved members"
  on profiles for select
  using (is_admin() or (status = 'approved' and is_approved()));

-- Public read bucket for avatars — profile photos aren't sensitive, and a
-- public bucket avoids needing signed URLs just to render an avatar image.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "Anyone can view avatars"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "Users can upload their own avatar"
  on storage.objects for insert
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can update their own avatar"
  on storage.objects for update
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
