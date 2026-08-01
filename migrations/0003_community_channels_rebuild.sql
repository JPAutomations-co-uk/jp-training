-- Complete rebuild of the Community channels feature — drops and recreates
-- both tables from scratch. The previous `channels` table failed every
-- query with a bare, non-JSON "Bad Request" rejected at Supabase's edge
-- layer (confirmed via API logs: 0ms latency, never reached PostgREST),
-- surviving a schema-cache reload and a table rename. Rather than keep
-- inspecting an already-broken table, this recreates it clean.
--
-- Schema below matches exactly what app.html's Community code expects —
-- read loadChannels()/loadMessages()/sendCommunityMessage()/
-- toggleCaseStudyFlag()/openChannel() before changing any column here,
-- the client code depends on these exact names.

drop table if exists channel_messages cascade;
drop table if exists community_channels cascade;
drop table if exists channels cascade; -- old pre-rename name, in case it still lingers

create table community_channels (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  position integer not null default 0,
  admin_only_post boolean not null default false,
  created_at timestamptz not null default now()
);

create table channel_messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references community_channels(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  body text not null,
  case_study_flagged boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create index channel_messages_channel_id_idx on channel_messages(channel_id);
create index channel_messages_user_id_idx on channel_messages(user_id);
create index community_channels_position_idx on community_channels(position);

alter table community_channels enable row level security;
alter table channel_messages enable row level security;

-- Channels: any approved member (or admin) can read the channel list.
-- Only admins can create/edit/delete channels — there's no in-app UI for
-- this, it's a direct-SQL/Table-Editor action, so this just protects
-- against a non-admin doing it via a raw API call.
create policy "Approved members can read channels"
  on community_channels for select
  using (
    is_admin() or exists (
      select 1 from profiles where profiles.id = auth.uid() and profiles.status = 'approved'
    )
  );

create policy "Admins manage channels"
  on community_channels for all
  using (is_admin())
  with check (is_admin());

-- Messages: any approved member (or admin) can read messages in any
-- channel — admin_only_post only gates who can POST, not who can read
-- (matches openChannel()'s canPost logic, which only hides the composer).
create policy "Approved members can read messages"
  on channel_messages for select
  using (
    is_admin() or exists (
      select 1 from profiles where profiles.id = auth.uid() and profiles.status = 'approved'
    )
  );

-- Posting: must be posting as yourself, must be approved (or admin), and
-- if the channel is admin_only_post you must be an admin. This was
-- previously only enforced client-side (hiding the composer) — now also
-- enforced at the database level so it can't be bypassed via a direct API
-- call, not just via the UI.
create policy "Approved members can post messages"
  on channel_messages for insert
  with check (
    user_id = auth.uid()
    and (
      is_admin()
      or (
        exists (select 1 from profiles where profiles.id = auth.uid() and profiles.status = 'approved')
        and not exists (select 1 from community_channels c where c.id = channel_id and c.admin_only_post = true)
      )
    )
  );

-- Updates: only admins (case-study flagging is admin-only in the app;
-- soft-delete via deleted_at is also admin-only there in practice).
create policy "Admins update messages"
  on channel_messages for update
  using (is_admin())
  with check (is_admin());

-- Realtime: openChannel() subscribes to postgres_changes on
-- channel_messages — without this, INSERT/UPDATE events never fire and
-- messages only ever appear after a manual reload.
alter publication supabase_realtime add table channel_messages;

-- Seed one real channel so there's actually something to open and test —
-- an empty table would just show "No channels yet" with nothing to click.
insert into community_channels (name, description, position, admin_only_post)
values ('General', 'General discussion for The Standard', 0, false);
