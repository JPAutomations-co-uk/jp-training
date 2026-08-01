-- Posts & Feed (X-style) + profile links.

create table if not exists posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  body text,
  media_url text,
  media_type text, -- 'video' | 'image' | null
  parent_post_id uuid references posts(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists posts_user_id_idx on posts(user_id);
create index if not exists posts_parent_post_id_idx on posts(parent_post_id);
create index if not exists posts_created_at_idx on posts(created_at desc);

create table if not exists post_likes (
  post_id uuid not null references posts(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

alter table posts enable row level security;
alter table post_likes enable row level security;

create policy "Approved members can read posts"
  on posts for select
  using (is_admin() or is_approved());

create policy "Approved members can create their own posts"
  on posts for insert
  with check (user_id = auth.uid() and (is_admin() or is_approved()));

create policy "Users can delete their own posts"
  on posts for delete
  using (user_id = auth.uid());

create policy "Approved members can read likes"
  on post_likes for select
  using (is_admin() or is_approved());

create policy "Approved members can like posts"
  on post_likes for insert
  with check (user_id = auth.uid() and (is_admin() or is_approved()));

create policy "Users can remove their own likes"
  on post_likes for delete
  using (user_id = auth.uid());

alter publication supabase_realtime add table posts;
alter publication supabase_realtime add table post_likes;

-- Storage for post media (video/images). Public bucket — same reasoning
-- as avatars, this content is meant to be seen by other members and a
-- public bucket avoids needing signed URLs to render it.
insert into storage.buckets (id, name, public)
values ('post-media', 'post-media', true)
on conflict (id) do nothing;

create policy "Anyone can view post media"
  on storage.objects for select
  using (bucket_id = 'post-media');

create policy "Users can upload their own post media"
  on storage.objects for insert
  with check (bucket_id = 'post-media' and (storage.foldername(name))[1] = auth.uid()::text);

-- Profile links — simple newline-separated URLs, parsed client-side.
alter table profiles add column if not exists links text;
