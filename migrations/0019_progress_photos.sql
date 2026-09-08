-- Progress photos (face/physique tracking over time). Deliberately a
-- private bucket + RLS-scoped table, unlike the existing avatars/post-media
-- buckets (both public, since those images are meant to be seen by other
-- people) — these are personal progress photos and must only ever be
-- visible to the user who uploaded them, via signed URLs.

create table progress_photos (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  date date not null default current_date,
  storage_path text not null,
  angle text, -- 'front' | 'side' | 'back' | null
  created_at timestamptz default now() not null
);
alter table progress_photos enable row level security;
create policy "Users manage own progress photos"
  on progress_photos for all
  using (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
  values ('progress-photos', 'progress-photos', false)
  on conflict (id) do nothing;

create policy "Users manage own progress photos in storage"
  on storage.objects for all
  using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = auth.uid()::text);
