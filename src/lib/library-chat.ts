import "server-only";

import { z } from "zod";

import { createEmbeddings } from "@/lib/ai/embeddings";
import { generateStructuredObject, streamStructuredObject } from "@/lib/ai/json";
import {
  buildTutorHistory,
  buildTutorInstructions,
  type TutorHistoryTurn,
} from "@/lib/ai/tutor-prompt";
import { fetchLearnerProfile } from "@/lib/learner-profile.server";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { serializeVector } from "@/lib/utils";

/**
 * Chat across the whole library, as the redesign's home ask-bar does.
 *
 * Unlike the per-note chat this is deliberately stateless: the design tells the
 * learner "Ta pogovor se ne shrani v tvoj račun", so nothing is written to
 * chat_messages and the client owns the transcript for the session.
 *
 * Two tiers of context, because sending every note's transcript would blow the
 * window and the budget:
 *   - always: each note's summary and key topics (cheap, and enough to answer
 *     "what should I revise?" style questions);
 *   - optionally: the transcript chunks nearest the question, retrieved per
 *     note, capped at TRANSCRIPT_NOTE_CAP notes — the "25 max" the design shows
 *     next to the "Uporabi prepise" switch.
 */

export const LIBRARY_CHAT_SCOPES = ["recent", "all", "folder"] as const;
export type LibraryChatScope = (typeof LIBRARY_CHAT_SCOPES)[number];

/** "Nedavni zapiski — najnovejših 25 zapiskov" in the scope picker. */
const RECENT_NOTE_LIMIT = 25;
/** The cap the design prints beside the transcripts switch. */
const TRANSCRIPT_NOTE_CAP = 25;
/** Transcript chunks pulled per note. Small, because it is multiplied by 25. */
const TRANSCRIPT_MATCHES_PER_NOTE = 3;
/** Summaries are trimmed so a large library still fits one request. */
const SUMMARY_CHAR_CAP = 1200;
/** Above this many notes we stop sending summaries in full. */
const ALL_SCOPE_NOTE_CAP = 120;

const libraryAnswerSchema = z.object({
  /* The description travels to the model with the schema — see chatAnswerSchema. */
  answer: z
    .string()
    .min(1)
    .describe(
      "The reply, in the language of the learner's last message. It opens with the answer "
        + "itself — no preamble — and is around 60 words and never more than 120. It ends with "
        + "exactly one short question unless they were only saying thanks or goodbye.",
    ),
  /** Titles of the notes the answer leaned on, so the UI can show its sources. */
  usedNotes: z.array(z.string()).max(6),
});

type LectureRow = {
  id: string;
  title: string | null;
  created_at: string;
  language_hint: string | null;
};

type ArtifactRow = {
  lecture_id: string;
  summary: string;
  key_topics: string[];
};

type TranscriptMatch = {
  idx: number;
  text: string;
  start_ms: number;
  end_ms: number;
};

export type LibraryChatResult = {
  answer: string;
  usedNotes: string[];
  /** How many notes actually went into the prompt, for the UI's footnote. */
  noteCount: number;
  usedTranscripts: boolean;
};

async function resolveLectureIds(params: {
  userId: string;
  scope: LibraryChatScope;
  folderId: string | null;
}): Promise<LectureRow[]> {
  const supabase = createSupabaseServiceRoleClient();

  let folderLectureIds: string[] | null = null;

  if (params.scope === "folder") {
    if (!params.folderId) {
      return [];
    }

    const { data: folder, error: folderError } = await supabase
      .from("library_folders")
      .select("id")
      .eq("id", params.folderId)
      .eq("user_id", params.userId)
      .maybeSingle();

    if (folderError) {
      throw folderError;
    }

    if (!folder) {
      return [];
    }

    const { data: rows, error: rowsError } = await supabase
      .from("library_folder_lectures")
      .select("lecture_id")
      .eq("folder_id", params.folderId);

    if (rowsError) {
      throw rowsError;
    }

    folderLectureIds = ((rows ?? []) as Array<{ lecture_id: string }>).map(
      (row) => row.lecture_id,
    );

    if (folderLectureIds.length === 0) {
      return [];
    }
  }

  let query = supabase
    .from("lectures")
    .select("id, title, created_at, language_hint")
    .eq("user_id", params.userId)
    .eq("status", "ready")
    .order("created_at", { ascending: false });

  if (folderLectureIds) {
    query = query.in("id", folderLectureIds);
  }

  if (params.scope === "recent") {
    query = query.limit(RECENT_NOTE_LIMIT);
  } else {
    query = query.limit(ALL_SCOPE_NOTE_CAP);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return (data ?? []) as LectureRow[];
}

/**
 * The excerpts nearest the question, or none of them.
 *
 * Every note's summary and key topics are in the prompt whatever happens here,
 * so an embedding provider having a bad minute should cost the answer its
 * quotes, never its existence. A single note failing to retrieve was already
 * survivable; this makes the embedding call survivable too.
 */
async function fetchTranscriptContext(params: {
  lectureIds: string[];
  question: string;
}) {
  const supabase = createSupabaseServiceRoleClient();
  let embedding: number[] | undefined;

  try {
    [embedding] = await createEmbeddings([params.question]);
  } catch (error) {
    console.warn("[library-chat] embedding failed; answering from summaries alone", error);
    return new Map<string, TranscriptMatch[]>();
  }

  if (!embedding) {
    return new Map<string, TranscriptMatch[]>();
  }

  const queryEmbedding = serializeVector(embedding);

  const results = await Promise.all(
    params.lectureIds.map(async (lectureId) => {
      // One note failing to retrieve should not sink the whole answer — whether it
      // comes back as a Postgres error or throws on the way there. Twenty-five of
      // these run at once, so one of them rejecting would take the rest with it.
      try {
        const { data, error } = await supabase.rpc("match_transcript_segments" as never, {
          filter_lecture_id: lectureId,
          match_count: TRANSCRIPT_MATCHES_PER_NOTE,
          query_embedding: queryEmbedding,
        } as never);

        if (error) {
          return [lectureId, [] as TranscriptMatch[]] as const;
        }

        return [lectureId, ((data ?? []) as TranscriptMatch[])] as const;
      } catch (error) {
        console.warn(`[library-chat] transcript search failed for ${lectureId}`, error);
        return [lectureId, [] as TranscriptMatch[]] as const;
      }
    }),
  );

  return new Map(results);
}

/**
 * Streams when there is somewhere to send the tokens and the stage is routed
 * through the gateway, and returns null when it cannot — no handler, not
 * routed, or the stream broke. Null means "make the ordinary call", so a
 * failure to stream costs a second request rather than the answer.
 */
async function streamLibraryAnswer(
  call: {
    schema: typeof libraryAnswerSchema;
    stage: "chat";
    instructions: string;
    input: string;
  },
  onDelta: ((text: string) => void) | undefined,
) {
  if (!onDelta) {
    return null;
  }

  try {
    return await streamStructuredObject({ ...call, streamField: "answer", onDelta });
  } catch (error) {
    console.error("[library-chat] streaming failed, falling back to a plain call", error);
    return null;
  }
}

export async function answerLibraryChat(params: {
  userId: string;
  question: string;
  sourceLanguageAction?: boolean;
  scope: LibraryChatScope;
  folderId: string | null;
  useTranscripts: boolean;
  /**
   * The transcript so far. This chat is never written to the database — the
   * design promises the learner it is not saved — so the conversation comes
   * back from the client on every turn or it does not exist at all.
   */
  history?: TutorHistoryTurn[];
  /** Supplied when the answer is being streamed to a watching learner. */
  onDelta?: (text: string) => void;
}): Promise<LibraryChatResult> {
  const supabase = createSupabaseServiceRoleClient();
  const [lectures, learner] = await Promise.all([
    resolveLectureIds(params),
    fetchLearnerProfile(params.userId),
  ]);
  const lectureIds = lectures.map((lecture) => lecture.id);

  /*
   * An empty library is not a dead end.
   *
   * This used to return a fixed "you have no notes yet" line without asking the
   * model anything, which meant a brand new account got that same sentence back
   * for "hello", "who are you?" and "how does this work?" — every one of them a
   * question that has nothing to do with having notes. The model is asked
   * either way now; it is simply told the library is empty, and says so itself
   * when the question actually needed something to read.
   */
  const artifacts = new Map<string, ArtifactRow>();

  if (lectureIds.length > 0) {
    const { data: artifactRows, error: artifactError } = await supabase
      .from("lecture_artifacts")
      .select("lecture_id, summary, key_topics")
      .in("lecture_id", lectureIds);

    if (artifactError) {
      throw artifactError;
    }

    for (const row of (artifactRows ?? []) as ArtifactRow[]) {
      artifacts.set(row.lecture_id, row);
    }
  }

  const useTranscripts =
    params.useTranscripts && lectureIds.length > 0 && lectures.length <= TRANSCRIPT_NOTE_CAP;
  const transcripts = useTranscripts
    ? await fetchTranscriptContext({ lectureIds, question: params.question })
    : new Map<string, TranscriptMatch[]>();

  const notes = lectures.map((lecture) => {
    const artifact = artifacts.get(lecture.id);
    const excerpts = transcripts.get(lecture.id) ?? [];

    return {
      title: lecture.title?.trim() || "Neimenovan zapisek",
      date: lecture.created_at,
      summary: artifact?.summary?.slice(0, SUMMARY_CHAR_CAP) ?? null,
      keyTopics: artifact?.key_topics ?? [],
      ...(excerpts.length
        ? { transcriptExcerpts: excerpts.map((excerpt) => excerpt.text) }
        : null),
    };
  });

  const call = {
    schema: libraryAnswerSchema,
    stage: "chat" as const,
    instructions: [
      buildTutorInstructions("library"),
      params.sourceLanguageAction ? "This is a translated interface action, not a typed language choice. Override the latest-message language rule: use the predominant source-note language and script. When notes have different languages, preserve each note's language for its own study content; use the conversation language (or English if absent) only for connecting commentary. Never translate Bosnian, Croatian or Serbian into a neighboring variety." : "",
      "List in usedNotes the exact titles of the notes you actually drew on.",
    ].join("\n\n"),
    input: JSON.stringify(
      {
        question: params.question,
        conversation: buildTutorHistory(params.history ?? []),
        ...(learner ? { learner } : {}),
        scope: params.scope,
        noteCount: notes.length,
        ...(notes.length === 0
          ? {
              libraryIsEmpty: true,
              libraryEmptyMeaning:
                params.scope === "folder"
                  ? "This folder has no finished notes yet. Other folders may."
                  : "This learner has no finished notes yet.",
            }
          : {}),
        includesTranscripts: useTranscripts,
        notes,
      },
      null,
      2,
    ),
  };

  const result = (await streamLibraryAnswer(call, params.onDelta)) ??
    (await generateStructuredObject(call));

  return {
    answer: result.answer,
    usedNotes: result.usedNotes,
    noteCount: notes.length,
    usedTranscripts: useTranscripts,
  };
}
