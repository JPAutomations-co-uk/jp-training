-- Community Phase 3 (unread indicators, notifications) + Phase 4 (DMs).

-- ══ PHASE 3a: unread channel indicators ══
-- Denormalised "when did this channel last get a message" on the channel
-- itself, kept in sync via trigger — avoids needing a GROUP BY/aggregate
-- query from the client (PostgREST's fluent API doesn't do that cleanly).
alter table standard_channels add column if not exists last_message_at timestamptz;

create or replace function update_channel_last_message() returns trigger
language plpgsql as $$
begin
  update standard_channels set last_message_at = new.created_at where id = new.channel_id;
  return new;
end;
$$;

drop trigger if exists channel_messages_update_last_message on channel_messages;
create trigger channel_messages_update_last_message
  after insert on channel_messages
  for each row execute function update_channel_last_message();

create table if not exists channel_reads (
  user_id uuid not null references profiles(id) on delete cascade,
  channel_id uuid not null references standard_channels(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id, channel_id)
);

alter table channel_reads enable row level security;

create policy "Users manage their own read state"
  on channel_reads for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ══ PHASE 3b: notifications (mentions + replies to your own posts) ══
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade, -- recipient
  type text not null, -- 'mention' | 'reply'
  channel_id uuid references standard_channels(id) on delete cascade,
  message_id uuid references channel_messages(id) on delete cascade,
  actor_id uuid references profiles(id) on delete set null, -- who triggered it
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_id_idx on notifications(user_id);

alter table notifications enable row level security;

create policy "Users can read their own notifications"
  on notifications for select
  using (user_id = auth.uid());

create policy "Any approved member can notify another about their own action"
  on notifications for insert
  with check (actor_id = auth.uid());

create policy "Users can update their own notifications"
  on notifications for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

alter publication supabase_realtime add table notifications;

-- ══ PHASE 4: direct messages ══
create table if not exists dm_conversations (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references profiles(id) on delete cascade,
  user_b uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_a, user_b)
);

create table if not exists dm_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references dm_conversations(id) on delete cascade,
  sender_id uuid not null references profiles(id) on delete cascade,
  body text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists dm_messages_conversation_id_idx on dm_messages(conversation_id);

alter table dm_conversations enable row level security;
alter table dm_messages enable row level security;

create policy "Users can read their own conversations"
  on dm_conversations for select
  using (auth.uid() = user_a or auth.uid() = user_b);

create policy "Users can create conversations they're part of"
  on dm_conversations for insert
  with check (auth.uid() = user_a or auth.uid() = user_b);

create policy "Users can read messages in their conversations"
  on dm_messages for select
  using (
    exists (select 1 from dm_conversations c where c.id = conversation_id and (c.user_a = auth.uid() or c.user_b = auth.uid()))
  );

create policy "Users can send messages in their conversations"
  on dm_messages for insert
  with check (
    sender_id = auth.uid()
    and exists (select 1 from dm_conversations c where c.id = conversation_id and (c.user_a = auth.uid() or c.user_b = auth.uid()))
  );

create policy "Users can mark messages read in their conversations"
  on dm_messages for update
  using (
    exists (select 1 from dm_conversations c where c.id = conversation_id and (c.user_a = auth.uid() or c.user_b = auth.uid()))
  );

alter publication supabase_realtime add table dm_messages;
