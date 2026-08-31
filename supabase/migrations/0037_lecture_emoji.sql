-- ---------------------------------------------------------------------------
-- Topical emoji per note
-- ---------------------------------------------------------------------------
--
-- Every note row and note header in the redesign carries a topical emoji
-- (📈 for microeconomics, 🧠 for anatomy) rather than a source-type icon. The
-- note pipeline already reads the whole source to write the summary, so it
-- picks the emoji in the same pass and stores it here.
--
-- Null is a normal state, not an error: notes created before this column, and
-- notes whose generation has not finished, have none. The client falls back to
-- deriving one from the title (src/lib/note-emoji.ts), so a null never shows up
-- as a blank tile.
--
-- Deliberately plain text, not a constrained domain: an emoji can be several
-- code points (skin tone, ZWJ sequences) and the pipeline is the only writer.

alter table public.lectures
  add column if not exists emoji text;
