-- Community Phase 1: reactions, reply threading, more channels.
-- Builds on standard_channels/channel_messages from migrations 0004/0005.

alter table channel_messages add column if not exists reply_to_id uuid references channel_messages(id) on delete set null;
create index if not exists channel_messages_reply_to_idx on channel_messages(reply_to_id);

create table if not exists message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references channel_messages(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);

create index if not exists message_reactions_message_id_idx on message_reactions(message_id);

alter table message_reactions enable row level security;

create policy "Approved members can read reactions"
  on message_reactions for select
  using (
    is_admin() or exists (
      select 1 from profiles where profiles.id = auth.uid() and profiles.status = 'approved'
    )
  );

create policy "Approved members can add their own reactions"
  on message_reactions for insert
  with check (
    user_id = auth.uid()
    and (
      is_admin() or exists (
        select 1 from profiles where profiles.id = auth.uid() and profiles.status = 'approved'
      )
    )
  );

create policy "Users can remove their own reactions"
  on message_reactions for delete
  using (user_id = auth.uid());

-- Realtime for reactions, matching channel_messages
alter publication supabase_realtime add table message_reactions;

-- A few more channels beyond General, matching The Standard's real focus areas
insert into standard_channels (name, description, position, admin_only_post)
select * from (values
  ('Wins', 'Share your wins, big or small', 1, false),
  ('Accountability', 'Daily and weekly check-ins — keep each other on track', 2, false),
  ('Introductions', 'New to The Standard? Introduce yourself here', 3, false),
  ('Training Talk', 'Programming, technique, recovery, anything training-related', 4, false)
) as v(name, description, position, admin_only_post)
where not exists (select 1 from standard_channels where standard_channels.name = v.name);
