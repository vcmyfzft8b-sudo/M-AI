import "server-only";

import { generateStructuredObject, streamStructuredObject } from "@/lib/ai/json";
import {
  buildTutorLessonPlanInstructions,
  buildTutorVoiceInstructions,
  TUTOR_VOICE_HISTORY_CHAR_CAP,
  TUTOR_VOICE_HISTORY_TURN_LIMIT,
  tutorLessonPlanSchema,
  tutorTurnSchema,
  type TutorLessonPlan,
  type TutorTurnKind,
} from "@/lib/ai/tutor-voice-prompt";
import { detectSourceLanguage, normalizeNoteLanguage } from "@/lib/languages";
import { stripLeadingRedundantHeading } from "@/lib/note-tts-text";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

/**
 * How much of the note the tutor reads.
 *
 * The whole note would be better and is usually affordable, but a walkthrough
 * makes one model call per topic and each of them re-sends this — so a very
 * long note would be paid for eight or nine times over in one session. Notes
 * past this length are cut at the tail, which is where the least examinable
 * material tends to sit.
 */
const TUTOR_NOTE_CHAR_CAP = 24_000;

/**
 * What a spoken turn is allowed to run to, in tokens.
 *
 * A teaching turn is asked for at around a hundred and eighty words, which is
 * well under this; the ceiling exists so a model that decides to keep going
 * cannot leave the learner listening to five minutes it cannot interrupt out
 * of, and so one runaway turn cannot cost what a whole session should.
 */
const TUTOR_TURN_MAX_TOKENS = 700;

/** The plan is small — a title and a handful of points per topic. */
const TUTOR_PLAN_MAX_TOKENS = 1_600;

export type TutorHistoryTurn = {
  role: "tutor" | "learner";
  content: string;
};

type TutorGrounding = {
  title: string | null;
  summary: string | null;
  keyTopics: string[];
  notes: string;
  /**
   * The language the tutor speaks: the one the material is written in.
   *
   * The note decides, not the app's own locale. Somebody studying a Slovenian lecture
   * wants it explained in Slovenian even with the interface in English, and the terms
   * they will be examined on are the ones on the page. Whatever this says, the learner's
   * own voice overrides it the moment they speak — see SPOKEN_LANGUAGE in
   * tutor-voice-prompt.ts.
   */
  language: string;
};

/**
 * The note the tutor teaches from, and the language it teaches in.
 *
 * Read with the service-role client because ownership has already been checked
 * at the route — the same shape every other lecture-scoped helper here uses.
 */
export async function loadTutorGrounding(lectureId: string): Promise<TutorGrounding | null> {
  const supabase = createSupabaseServiceRoleClient();
  const [{ data: artifact }, { data: lecture }] = await Promise.all([
    supabase
      .from("lecture_artifacts")
      .select("summary, key_topics, structured_notes_md")
      .eq("lecture_id", lectureId)
      .maybeSingle(),
    supabase.from("lectures").select("title, language_hint").eq("id", lectureId).maybeSingle(),
  ]);

  const artifactRow = (artifact ?? null) as {
    summary: string;
    key_topics: string[];
    structured_notes_md: string;
  } | null;
  const lectureRow = (lecture ?? null) as {
    title: string | null;
    language_hint: string | null;
  } | null;

  if (!artifactRow) {
    return null;
  }

  const notes = stripLeadingRedundantHeading(
    artifactRow.structured_notes_md ?? "",
    lectureRow?.title ?? null,
  ).slice(0, TUTOR_NOTE_CHAR_CAP);

  /*
   * What the note is written in. Detection over the note beats the lecture's
   * `language_hint`, which is what the transcriber was told — for an uploaded PDF that is
   * whatever the default was rather than what is on the page. Detection answers null when
   * it cannot tell, and only then does the hint decide.
   */
  const detected = detectSourceLanguage(`${artifactRow.summary ?? ""}\n${notes}`);
  const materialLanguage = normalizeNoteLanguage(detected ?? lectureRow?.language_hint ?? null);

  return {
    title: lectureRow?.title ?? null,
    summary: artifactRow.summary ?? null,
    keyTopics: artifactRow.key_topics ?? [],
    notes,
    language: materialLanguage,
  };
}

/**
 * The running order for a session.
 *
 * Regenerated per session rather than stored: it is one cheap call, and a plan
 * that is not persisted cannot go stale against a note the learner has since
 * edited.
 *
 * Runs on the stage's own model, like everything else the tutor does.
 *
 * It was briefly split onto a faster one, on the reasoning that nobody hears the plan so
 * its quality does not matter. That was wrong twice over. Planning quality is not prose
 * quality: the plan decides which topics exist, and a topic the plan omits is one the
 * walkthrough never teaches. Marked against the omrezja-sl fixture's own 23-fact answer
 * key, GLM's plans covered 94% (22, 22, 21) against gemini-2.5-flash's 74% (19, 17, 19,
 * 13) — and the bad Gemini run dropped LAN, WAN and MAN entirely.
 *
 * The speed argument that justified the split had also stopped being true: the plan is
 * fetched alongside the opening turn rather than before it, so its seven seconds sit
 * behind a greeting that is the better part of a minute of speech. Nobody waits for it.
 */
export async function planTutorLesson(grounding: TutorGrounding) {
  return generateStructuredObject({
    schema: tutorLessonPlanSchema,
    stage: "tutor_turn",
    instructions: buildTutorLessonPlanInstructions(),
    input: JSON.stringify(
      {
        // Named rather than inferred: the plan is spoken aloud too, and a note that quotes
        // English sources inside Slovenian prose is exactly where inference goes wrong.
        language: grounding.language,
        noteTitle: grounding.title,
        summary: grounding.summary,
        keyTopics: grounding.keyTopics,
        notes: grounding.notes,
      },
      null,
      2,
    ),
    maxOutputTokens: TUTOR_PLAN_MAX_TOKENS,
    usageContext: { stage: "tutor_turn" },
  });
}

/**
 * The recent conversation, trimmed to what is worth re-sending.
 *
 * Oldest first, because that is the order it was said in. Without it an
 * interruption arrives with no memory of the last one — "explain that again
 * even simpler" would have nothing to be simpler than.
 */
export function buildTutorVoiceHistory(messages: readonly TutorHistoryTurn[]) {
  return messages
    .filter((message) => typeof message.content === "string" && message.content.trim().length > 0)
    .slice(-TUTOR_VOICE_HISTORY_TURN_LIMIT)
    .map((message) => ({
      role: message.role,
      content:
        message.content.trim().length > TUTOR_VOICE_HISTORY_CHAR_CAP
          ? `${message.content.trim().slice(0, TUTOR_VOICE_HISTORY_CHAR_CAP)}…`
          : message.content.trim(),
    }));
}

export type TutorTurnRequest = {
  kind: TutorTurnKind;
  /** Index into the plan's topics. Ignored for `opening` and `closing`. */
  topicIndex: number;
  /** What the tutor has already said about this topic, so a resume does not repeat it. */
  spokenSoFar: string;
  /** What the learner just said, for an `answer` turn. */
  question: string | null;
  history: TutorHistoryTurn[];
};

/**
 * One spoken turn, streamed as it is written.
 *
 * Streaming is not a nicety here: the client feeds these deltas straight into
 * the speech socket, so the tutor starts talking about a second after the
 * learner stops rather than after the whole turn has been generated. The
 * non-streaming path is the fallback for the same reason it is everywhere else
 * — a stream that breaks should cost a retry, not the answer.
 */
export async function speakTutorTurn(params: {
  grounding: TutorGrounding;
  /*
   * Null only for the opening turn, which is generated before the running order
   * exists. The greeting needs the note, not the plan, and firing the two at once
   * is what takes time-to-first-word from about ten seconds down to three.
   */
  plan: TutorLessonPlan | null;
  request: TutorTurnRequest;
  onDelta: (text: string) => void;
}) {
  const { plan, request } = params;
  const topic = plan?.topics[request.topicIndex] ?? null;
  const call = {
    schema: tutorTurnSchema,
    stage: "tutor_turn" as const,
    instructions: buildTutorVoiceInstructions(request.kind),
    input: JSON.stringify(
      {
        language: params.grounding.language,
        noteTitle: params.grounding.title,
        subject: plan?.subject ?? params.grounding.summary,
        runningOrder:
          plan?.topics.map((entry, index) => ({
            index,
            title: entry.title,
            current: index === request.topicIndex,
          })) ?? null,
        topic,
        // The opening reads these instead of a topic, since the plan does not exist yet.
        keyTopics: plan ? null : params.grounding.keyTopics,
        spokenSoFar: request.spokenSoFar || null,
        learnerJustSaid: request.question,
        conversation: buildTutorVoiceHistory(request.history),
        notes: params.grounding.notes,
      },
      null,
      2,
    ),
    maxOutputTokens: TUTOR_TURN_MAX_TOKENS,
    usageContext: { stage: "tutor_turn" as const },
  };

  /*
   * Chat can throw away a half-streamed answer and re-run the call, because
   * nothing has happened yet that the learner cannot un-see. Speech cannot: the
   * first half has already been said out loud, and following it with a second,
   * complete version of the same turn is worse than stopping short. So the
   * fallback is only available while the turn is still silent.
   */
  let spoken = "";
  const onDelta = (text: string) => {
    spoken += text;
    params.onDelta(text);
  };

  try {
    const streamed = await streamStructuredObject({ ...call, streamField: "speech", onDelta });

    if (streamed) {
      return streamed;
    }
  } catch (error) {
    console.error("[tutor] streaming failed", error);

    if (spoken.trim()) {
      // Half a turn was said out loud before the stream broke. Hand the floor back rather
      // than leaving the learner waiting on a check question that was never spoken.
      return { speech: spoken, handBack: true, awaitingExplanation: false };
    }
  }

  return generateStructuredObject(call);
}
