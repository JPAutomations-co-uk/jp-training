-- Channel-tagged posts — channels double as topic/niche feeds (like
-- subreddits/hashtags), not just live chat rooms. Nullable: a post left
-- untagged simply stays in the general Feed only, never appears in any
-- channel's Posts tab.

alter table posts add column if not exists channel_id uuid references standard_channels(id) on delete set null;
create index if not exists posts_channel_id_idx on posts(channel_id);
