import type { MessageKey } from "@/lib/i18n/messages/keys";
import type { Locale } from "@/lib/i18n/locales";
import type { Translate } from "@/lib/i18n/translate";
import { formatCalendarDate } from "@/lib/utils";

import { PREVIEW_TODAY, sourceMeta, type SourceDetail, type SourceKind } from "../memo-app-preview-data";

/*
 * A note row's second line, as the app's library writes it (`NoteRow` in
 * home-dashboard.tsx): "Writing the notes…" while the note is being made, and
 * "29. 8. 2026 • Audio, 48 min" once it is. The phone shows no status badge — that
 * is the desktop row's — so the landing's phone-sized screens don't either.
 *
 * Dates count back from the demos' fixed "today", so the server and the browser
 * print the same thing whatever the visitor's clock says.
 */
export function landingNoteMeta(
  t: Translate<MessageKey>,
  locale: Locale,
  note: { source: SourceKind; detail?: SourceDetail; daysAgo?: number; writing?: boolean },
): string {
  if (note.writing) {
    return t("note.generating");
  }

  return `${landingNoteDate(locale, note.daysAgo)} • ${sourceMeta(note, t)}`;
}

/*
 * The line under an open note's title on the phone: "29. 8. 2026, Audio, 48 min" —
 * the same facts as the row, joined with commas (`noteMetaLine` in lecture-workspace.tsx).
 */
export function landingNoteTitleMeta(
  t: Translate<MessageKey>,
  locale: Locale,
  note: { source: SourceKind; detail?: SourceDetail; daysAgo?: number },
): string {
  return `${landingNoteDate(locale, note.daysAgo)}, ${sourceMeta(note, t)}`;
}

function landingNoteDate(locale: Locale, daysAgo = 0) {
  const day = new Date(`${PREVIEW_TODAY}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() - daysAgo);
  return formatCalendarDate(day.toISOString(), locale);
}
