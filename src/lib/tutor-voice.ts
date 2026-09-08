import "server-only";
import { resolveSourceLanguage } from "@/lib/source-language";
import { buildSpeechLanguageInstruction, resolveSpeechLanguage, toSpeechScript } from "@/lib/speech-language";

import { generateStructuredObject, streamStructuredObject } from "@/lib/ai/json";
import { repairPassage } from "@/lib/ai/language-check";
import { createProofreadStream, shouldCheckLanguage } from "@/lib/ai/language-repair";
import {
  isLanguageCheckEnabled,
  resolveStageModelConfig,
  writerNeedsLanguageCheck,
} from "@/lib/ai/model-config";
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
import { stripLeadingRedundantHeading } from "@/lib/note-tts-text";
import { resolvePassageLanguage, resolveSpokenLanguage } from "@/lib/tutor/spoken-language";
import { getServerEnv } from "@/lib/server-env";
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
export async function loadTutorGrounding(
  lectureId: string,
  ownedLecture?: { title: string | null; language_hint: string | null },
): Promise<TutorGrounding | null> {
  const supabase = createSupabaseServiceRoleClient();
  const [{ data: artifact }, { data: lecture }] = await Promise.all([
    supabase
      .from("lecture_artifacts")
      .select("summary, key_topics, structured_notes_md, model_metadata")
      .eq("lecture_id", lectureId)
      .maybeSingle(),
    ownedLecture
      ? Promise.resolve({ data: ownedLecture })
      : supabase.from("lectures").select("title, language_hint").eq("id", lectureId).maybeSingle(),
  ]);

  const artifactRow = (artifact ?? null) as {
    summary: string;
    key_topics: string[];
    structured_notes_md: string;
    model_metadata: unknown;
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

  // Trust generation metadata only while its full-note hash matches. Older or edited
  // material is detected once and shared through the source-language cache.
  const materialLanguage = await resolveSourceLanguage({
    text: artifactRow.structured_notes_md ?? "", hint: lectureRow?.language_hint,
    lectureId, metadata: artifactRow.model_metadata,
  });

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
 * Runs on GLM, on its own `tutor_plan` stage, and both halves of that matter.
 *
 * GLM, because planning quality is not prose quality. The plan decides which topics exist,
 * and a topic it omits is one the walkthrough never teaches however well the turns are
 * written. Marked against the omrezja-sl fixture's own 23-fact answer key on 2026-09-04, GLM
 * covered 23 of 23 on every run; gemini-3.5-flash-lite, which writes the spoken turns better
 * than GLM does, covered 9. So the tutor deliberately runs on two models.
 *
 * Its own stage, because it used to share the spoken turn's twenty-second leash and could not
 * live inside it. GLM writes about 1,100 tokens here and takes 19 to 51 seconds doing it — five
 * runs in six blew the limit, and every one of those aborted a paid call and handed the session
 * the fallback tier's plan, which covers about half the material. The session was quietly being
 * taught from the wrong plan almost every time.
 *
 * The seconds are affordable because nobody waits through them: the plan is fetched beside the
 * opening turn rather than ahead of it, and the opening is the better part of a minute of speech.
 */
export async function planTutorLesson(grounding: TutorGrounding) {
  return generateStructuredObject({
    schema: tutorLessonPlanSchema,
    stage: "tutor_plan",
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
    usageContext: { stage: "tutor_plan" },
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
   * Opening, answer and feedback turns can run before the plan exists. Replies
   * are grounded in the note and conversation; only lesson progression needs
   * the running order. An early question must not wait for the planner.
   */
  plan: (Omit<TutorLessonPlan, "language"> & { language: string | null }) | null;
  request: TutorTurnRequest;
  onDelta: (text: string) => void;
}) {
  const { plan, request } = params;
  const topic = plan?.topics[request.topicIndex] ?? null;
  const call = {
    schema: tutorTurnSchema,
    stage: "tutor_turn" as const,
    instructions: buildTutorVoiceInstructions(request.kind) + "\n" + buildSpeechLanguageInstruction(params.grounding.language),
    input: JSON.stringify(
      {
        language: resolveSpeechLanguage(params.grounding.language),
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
   * Everything the writer produces goes through the language repair on its way to the speech
   * socket — see language-repair.ts for why it is done inside the stream rather than over the
   * finished turn. The repair is allowed to fail: a unit whose correction is late or refused is
   * spoken exactly as GLM wrote it, so the worst case here is the turn we would have had anyway.
   */
  const language = resolveSpeechLanguage(resolveSpokenLanguage(params.grounding.language, request));

  /*
   * Chat can throw away a half-streamed answer and re-run the call, because
   * nothing has happened yet that the learner cannot un-see. Speech cannot: the
   * first half has already been said out loud, and following it with a second,
   * complete version of the same turn is worse than stopping short. So the
   * fallback is only available while the turn is still silent.
   *
   * `spoken` is what actually reached the learner, which after the repair is not the same string
   * the model wrote. It is what goes back as the turn, so the conversation history the next turn
   * reads matches what was said out loud.
   */
  let spoken = "";
  const emit = (text: string) => {
    const speakable = toSpeechScript(text, language);
    spoken += speakable;
    params.onDelta(speakable);
  };

  /*
   * Switched off — or writing in a model that does not need checking — the words go straight
   * through as they always did, rather than through a pipeline that would hand them back
   * unchanged. The difference is the buffering: the checker gives the client whole phrases where
   * the raw stream gives it words, so off has to mean off rather than a quiet imitation of it.
   *
   * Which language a unit is in is decided per unit rather than once per turn, and the decision
   * is made from the unit itself — see resolvePassageLanguage. Deciding it up front from the
   * request looks equivalent and is not: a learner's spoken interruption is usually too short for
   * the detector to commit on, so a Slovenian question about an English lecture resolves to
   * English, and English is the one language this is skipped for. That turn would go out
   * unchecked, and it is exactly the kind of turn the check exists for.
   */
  const writer = resolveStageModelConfig({
    stage: "tutor_turn",
    env: process.env,
    fallbackModel: getServerEnv().GEMINI_TEXT_MODEL,
  }).model;

  const proofreader = isLanguageCheckEnabled() && writerNeedsLanguageCheck(writer)
    ? createProofreadStream({
        onDelta: emit,
        correct: ({ text, preceding, signal }) => {
          const passageLanguage = resolvePassageLanguage(language, `${preceding} ${text}`);

          return shouldCheckLanguage(passageLanguage)
            ? repairPassage({ text, preceding, language: passageLanguage, spoken: true, signal })
            : Promise.resolve(null);
        },
      })
    : null;

  try {
    const streamed = await streamStructuredObject({
      ...call,
      streamField: "speech",
      onDelta: (text) => (proofreader ? proofreader.push(text) : emit(text)),
    });

    if (streamed) {
      await proofreader?.flush();

      /*
       * What was said, not what was written — the repair changed it, and the next turn reads this
       * back as the conversation so far. `streamed.speech` is the floor rather than a preference:
       * if nothing was ever emitted, something went wrong on the way out and the model's own text
       * is a better answer than an empty turn.
       */
      return { ...streamed, speech: spoken.trim() ? spoken : toSpeechScript(streamed.speech, language) };
    }
  } catch (error) {
    console.error("[tutor] streaming failed", error);

    // Whatever the writer had already handed over is still worth saying, and some of it may be
    // sitting in the repair queue rather than out of the door.
    await proofreader?.flush();

    if (spoken.trim()) {
      // Half a turn was said out loud before the stream broke. Hand the floor back rather
      // than leaving the learner waiting on a check question that was never spoken.
      return { speech: spoken, handBack: true, awaitingExplanation: false };
    }
  }

  /*
   * The unstreamed path, reached when the stage is not routed through the gateway or the stream
   * died before saying a word. Nothing has been spoken, so the turn is repaired in one call
   * instead of unit by unit — there is no audio to hide the wait behind and nothing to keep in
   * order.
   */
  const generated = await generateStructuredObject(call);
  const repaired = writerNeedsLanguageCheck(writer)
    ? await repairPassage({
        text: generated.speech,
        // The whole turn is in hand here, which is the best evidence of its language there is.
        language: resolvePassageLanguage(language, generated.speech),
        spoken: true,
      })
    : null;

  return { ...generated, speech: toSpeechScript(repaired ?? generated.speech, language) };
}
