-- Posts & Feed (X-style) + profile links.
-- Fully re-runnable: every create is preceded by a drop-if-exists, so this
-- can be run again from any partial state (like the 42703 parent_post_id
-- error caused by an earlier partial run) without manual cleanup first.

drop table if exists post_likes cascade;
drop table if exists posts cascade;

create table posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  body text,
  media_url text,
  media_type text, -- 'video' | 'image' | null
  parent_post_id uuid references posts(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index posts_user_id_idx on posts(user_id);
create index posts_parent_post_id_idx on posts(parent_post_id);
create index posts_created_at_idx on posts(created_at desc);

create table post_likes (
  post_id uuid not null references posts(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

alter table posts enable row level security;
alter table post_likes enable row level security;

drop policy if exists "Approved members can read posts" on posts;
create policy "Approved members can read posts"
  on posts for select
  using (is_admin() or is_approved());

drop policy if exists "Approved members can create their own posts" on posts;
create policy "Approved members can create their own posts"
  on posts for insert
  with check (user_id = auth.uid() and (is_admin() or is_approved()));

drop policy if exists "Users can delete their own posts" on posts;
create policy "Users can delete their own posts"
  on posts for delete
  using (user_id = auth.uid());

drop policy if exists "Approved members can read likes" on post_likes;
create policy "Approved members can read likes"
  on post_likes for select
  using (is_admin() or is_approved());

drop policy if exists "Approved members can like posts" on post_likes;
create policy "Approved members can like posts"
  on post_likes for insert
  with check (user_id = auth.uid() and (is_admin() or is_approved()));

drop policy if exists "Users can remove their own likes" on post_likes;
create policy "Users can remove their own likes"
  on post_likes for delete
  using (user_id = auth.uid());

-- Realtime publication add is idempotent-safe via the exception check below
-- (ALTER PUBLICATION ... ADD TABLE errors if the table's already a member).
do $$
begin
  alter publication supabase_realtime add table posts;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table post_likes;
exception when duplicate_object then null;
end $$;

-- Storage for post media (video/images). Public bucket — same reasoning
-- as avatars, this content is meant to be seen by other members and a
-- public bucket avoids needing signed URLs to render it.
insert into storage.buckets (id, name, public)
values ('post-media', 'post-media', true)
on conflict (id) do nothing;

drop policy if exists "Anyone can view post media" on storage.objects;
create policy "Anyone can view post media"
  on storage.objects for select
  using (bucket_id = 'post-media');

drop policy if exists "Users can upload their own post media" on storage.objects;
create policy "Users can upload their own post media"
  on storage.objects for insert
  with check (bucket_id = 'post-media' and (storage.foldername(name))[1] = auth.uid()::text);

-- Profile links — simple newline-separated URLs, parsed client-side.
alter table profiles add column if not exists links text;
