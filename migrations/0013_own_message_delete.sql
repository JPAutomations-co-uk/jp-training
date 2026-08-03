-- Users can soft-delete their own channel messages (deleted_at), matching
-- Feed/Posts which already let a user delete their own content — Discussion
-- chat was the one place in Community without any delete-own-message
-- option at all. Additive: the existing "Admins update messages" policy
-- (0004_standard_channels_rebuild.sql, still needed for case-study flagging
-- on anyone's message) is untouched — Postgres RLS combines multiple
-- permissive policies for the same command with OR, so this just adds a
-- second allowed path rather than replacing the admin one.

drop policy if exists "Users update their own messages" on channel_messages;
create policy "Users update their own messages"
  on channel_messages for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
