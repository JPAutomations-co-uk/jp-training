-- Notifications previously only fired for Discussion @mentions/replies —
-- most of Community's actual content (Feed/channel-Post likes and
-- replies, new DMs) generated no notification at all. Additive nullable
-- columns; existing 'mention'/'reply' rows (channel_id/message_id) are
-- untouched, new 'post_like'/'post_reply'/'dm' rows use the new columns
-- instead. No RLS change needed — the existing insert policy
-- ("actor_id = auth.uid()") is already generic to any notification type.

alter table notifications add column if not exists post_id uuid references posts(id) on delete cascade;
alter table notifications add column if not exists dm_conversation_id uuid references dm_conversations(id) on delete cascade;
