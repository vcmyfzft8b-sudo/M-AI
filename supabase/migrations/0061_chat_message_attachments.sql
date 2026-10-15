-- A study set the tutor made in the chat (flashcards, a quiz, a test or a mind map), stored on
-- the assistant message it was attached to so it is still there when the note is reopened.
-- The shape is checked by `parseChatStudyAttachment` (src/lib/chat-study-set.ts) on the way in
-- and on the way out, so the column is plain jsonb with no constraint of its own. Null on every
-- message that has no set, which is all of them before this migration.
alter table public.chat_messages
  add column if not exists attachment_json jsonb;
