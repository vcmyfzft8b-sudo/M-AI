import { NextResponse } from "next/server";
import { z } from "zod";

import { canAccessLectureContent, createBillingRequiredResponse } from "@/lib/billing";
import { tr } from "@/lib/i18n/server";
import { ensureUserOwnsLecture } from "@/lib/lectures";
import {
  NOTE_WORD_FIX_MAX_LENGTH,
  normalizeNoteWordFixInput,
  validateNoteWordFix,
} from "@/lib/note-word-fix";
import { applyNoteWordFix } from "@/lib/note-word-fix-server";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { parseJsonRequest } from "@/lib/request-validation";
import { getRouteUser } from "@/lib/supabase/server";
import { routeIdParamSchema } from "@/lib/validation";

const fixWordSchema = z.object({
  find: z.string().max(NOTE_WORD_FIX_MAX_LENGTH * 2),
  replace: z.string().max(NOTE_WORD_FIX_MAX_LENGTH * 2),
});

/** Replaces a wrong word or name everywhere in one note: see note-word-fix-server.ts. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await getRouteUser({ route: "POST /api/lectures/[id]/fix-word", request });

  if (!auth.user) {
    return auth.response;
  }

  const { user } = auth;
  const limited = await enforceRateLimit({
    request,
    route: "api:lectures:fix-word:post",
    rules: rateLimitPresets.mutate,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const parsed = await parseJsonRequest(request, fixWordSchema, { maxBytes: 4 * 1024 });

  if (!parsed.success) {
    return parsed.response;
  }

  const invalid = validateNoteWordFix(parsed.data.find, parsed.data.replace);

  if (invalid) {
    return NextResponse.json({ error: await tr("note.fixWord.invalid"), code: invalid }, { status: 400 });
  }

  const parsedParams = routeIdParamSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return NextResponse.json({ error: await tr("api.invalidLectureId") }, { status: 400 });
  }

  const { id } = parsedParams.data;
  const lecture = await ensureUserOwnsLecture({ lectureId: id, user, supabase: auth.supabase });

  if (!lecture) {
    return NextResponse.json({ error: await tr("api.notFound") }, { status: 404 });
  }

  const access = await canAccessLectureContent(user.id, id);

  if (!access.allowed) {
    return createBillingRequiredResponse(await tr("api.paidRequired.edit"), access.code);
  }

  const find = normalizeNoteWordFixInput(parsed.data.find);
  const replace = normalizeNoteWordFixInput(parsed.data.replace);
  let outcome = await applyNoteWordFix({ lectureId: id, find, replace });

  // A highlight saved between our read and our write: read again and redo the fix once.
  if (outcome.status === "conflict") {
    outcome = await applyNoteWordFix({ lectureId: id, find, replace });
  }

  if (outcome.status === "not_ready") {
    return NextResponse.json({ error: await tr("note.notReady") }, { status: 409 });
  }

  if (outcome.status === "conflict") {
    return NextResponse.json({ error: await tr("api.notesChanged") }, { status: 409 });
  }

  if (outcome.noteCount + outcome.otherCount === 0) {
    return NextResponse.json({ error: await tr("note.fixWord.notFound"), code: "not_found" }, { status: 404 });
  }

  return NextResponse.json({
    noteCount: outcome.noteCount,
    otherCount: outcome.otherCount,
    revision: outcome.revision,
    doc: outcome.doc,
  });
}
