import "server-only";

import { z } from "zod";

import { createEmbeddings } from "@/lib/ai/embeddings";
import { generateStructuredObject } from "@/lib/ai/json";
import { buildGeneratedContentLanguageInstruction } from "@/lib/languages";
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
  answer: z.string().min(4),
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

async function fetchTranscriptContext(params: {
  lectureIds: string[];
  question: string;
}) {
  const supabase = createSupabaseServiceRoleClient();
  const [embedding] = await createEmbeddings([params.question]);

  if (!embedding) {
    return new Map<string, TranscriptMatch[]>();
  }

  const queryEmbedding = serializeVector(embedding);

  const results = await Promise.all(
    params.lectureIds.map(async (lectureId) => {
      const { data, error } = await supabase.rpc("match_transcript_segments" as never, {
        filter_lecture_id: lectureId,
        match_count: TRANSCRIPT_MATCHES_PER_NOTE,
        query_embedding: queryEmbedding,
      } as never);

      // One note failing to retrieve should not sink the whole answer.
      if (error) {
        return [lectureId, [] as TranscriptMatch[]] as const;
      }

      return [lectureId, ((data ?? []) as TranscriptMatch[])] as const;
    }),
  );

  return new Map(results);
}

export async function answerLibraryChat(params: {
  userId: string;
  question: string;
  scope: LibraryChatScope;
  folderId: string | null;
  useTranscripts: boolean;
}): Promise<LibraryChatResult> {
  const supabase = createSupabaseServiceRoleClient();
  const lectures = await resolveLectureIds(params);

  if (lectures.length === 0) {
    return {
      answer:
        params.scope === "folder"
          ? "V tej mapi še ni dokončanih zapiskov, zato nimam česa prebrati. Izberi drugo mapo ali dodaj zapisek."
          : "Nimaš še nobenega dokončanega zapiska, zato nimam česa prebrati. Posnemi predavanje ali naloži gradivo in poskusi znova.",
      usedNotes: [],
      noteCount: 0,
      usedTranscripts: false,
    };
  }

  const lectureIds = lectures.map((lecture) => lecture.id);

  const { data: artifactRows, error: artifactError } = await supabase
    .from("lecture_artifacts")
    .select("lecture_id, summary, key_topics")
    .in("lecture_id", lectureIds);

  if (artifactError) {
    throw artifactError;
  }

  const artifacts = new Map(
    ((artifactRows ?? []) as ArtifactRow[]).map((row) => [row.lecture_id, row]),
  );

  const useTranscripts = params.useTranscripts && lectures.length <= TRANSCRIPT_NOTE_CAP;
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

  // The library spans notes that may be in different languages; the newest
  // note's hint is the best single guess at what the learner studies in.
  const languageHint = lectures.find((lecture) => lecture.language_hint)?.language_hint ?? null;

  const result = await generateStructuredObject({
    schema: libraryAnswerSchema,
    stage: "chat",
    instructions: [
      buildGeneratedContentLanguageInstruction(languageHint),
      "You are Memo, helping a student across their whole note library.",
      "Answer using only the supplied notes. If the notes do not cover it, say so plainly instead of guessing.",
      "Prefer concrete pointers — which note, which topic — over general study advice.",
      "Keep the answer short enough to read on a phone: a few sentences, or a short list when the question asks for one.",
      "List in usedNotes the exact titles of the notes you actually drew on.",
    ].join(" "),
    input: JSON.stringify(
      {
        question: params.question,
        scope: params.scope,
        noteCount: notes.length,
        includesTranscripts: useTranscripts,
        notes,
      },
      null,
      2,
    ),
  });

  return {
    answer: result.answer,
    usedNotes: result.usedNotes,
    noteCount: notes.length,
    usedTranscripts: useTranscripts,
  };
}
