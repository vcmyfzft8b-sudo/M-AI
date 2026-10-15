/**
 * A study set the tutor made in the chat: flashcards, a quiz, a test or a mind map.
 *
 * The learner asks for one in their own words ("naredi mi kartice", "quiz me on this"), the chat
 * model says what was asked for, a second call writes the set, and it is attached to the answer
 * and drawn under it with the same components the note's own tabs use.
 *
 * Deliberately free of `server-only` and of every Next import: the same parser checks what a
 * model wrote, what comes back from `chat_messages.attachment_json`, and what the browser is
 * about to draw, so a set that reaches the screen has passed the same checks wherever it came
 * from.
 */
import { parseMindmapDoc, type MindmapDoc } from "./mindmap-doc.ts";

export const CHAT_STUDY_KINDS = ["flashcards", "quiz", "test", "mindmap"] as const;
export type ChatStudyKind = (typeof CHAT_STUDY_KINDS)[number];

export const CHAT_STUDY_SET_VERSION = 1;

/**
 * How many items a set has when the learner did not say, and how far a number they did say is
 * honoured. A few is the point: this is a set to work through in the chat, not the note's deck.
 */
export const CHAT_STUDY_COUNTS: Record<
  Exclude<ChatStudyKind, "mindmap">,
  { default: number; min: number; max: number }
> = {
  flashcards: { default: 8, min: 3, max: 20 },
  quiz: { default: 5, min: 3, max: 12 },
  test: { default: 5, min: 2, max: 10 },
};

/* Caps applied in code rather than on the wire schema (see mindmap-doc.ts for why). */
const TITLE_MAX_LENGTH = 90;
const FRONT_MAX_LENGTH = 240;
const BACK_MAX_LENGTH = 480;
const OPTION_MAX_LENGTH = 200;
const EXPLANATION_MAX_LENGTH = 400;
const QUIZ_OPTION_COUNT = 4;

export type ChatFlashcard = { front: string; back: string };
export type ChatQuizQuestion = {
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string | null;
};
export type ChatTestQuestion = { prompt: string; answer: string };

export type ChatStudySet =
  | { version: 1; kind: "flashcards"; title: string; cards: ChatFlashcard[] }
  | { version: 1; kind: "quiz"; title: string; questions: ChatQuizQuestion[] }
  | { version: 1; kind: "test"; title: string; questions: ChatTestQuestion[] }
  | { version: 1; kind: "mindmap"; title: string; doc: MindmapDoc };

/**
 * What hangs off an answer: the set, or the fact that one was asked for and could not be made.
 * The failure is kept rather than dropped because the answer above it already says "here are
 * your flashcards", and a reply that promises cards and shows none reads as a bug.
 */
export type ChatStudyAttachment =
  | ChatStudySet
  | { version: 1; kind: ChatStudyKind; failed: true };

/** What the chat model hands over when the learner asked for a set. */
export type ChatStudyRequest = {
  kind: ChatStudyKind;
  count: number | null;
  focus: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function tidy(value: unknown, maxLength: number): string {
  if (typeof value !== "string") {
    return "";
  }

  const collapsed = value.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();

  return collapsed.length <= maxLength ? collapsed : `${collapsed.slice(0, maxLength - 1).trimEnd()}…`;
}

export function isChatStudyKind(value: unknown): value is ChatStudyKind {
  return typeof value === "string" && (CHAT_STUDY_KINDS as readonly string[]).includes(value);
}

/** The number of items to write: what they asked for, inside the bounds, or the default. */
export function resolveChatStudyCount(kind: ChatStudyKind, requested: number | null | undefined) {
  if (kind === "mindmap") {
    return 0;
  }

  const bounds = CHAT_STUDY_COUNTS[kind];

  if (typeof requested !== "number" || !Number.isFinite(requested) || requested <= 0) {
    return bounds.default;
  }

  return Math.min(bounds.max, Math.max(bounds.min, Math.round(requested)));
}

function parseCards(value: unknown): ChatFlashcard[] {
  const cards: ChatFlashcard[] = [];

  for (const item of Array.isArray(value) ? value : []) {
    const record = asRecord(item);
    const front = tidy(record.front, FRONT_MAX_LENGTH);
    const back = tidy(record.back, BACK_MAX_LENGTH);

    if (front && back) {
      cards.push({ front, back });
    }
  }

  return cards.slice(0, CHAT_STUDY_COUNTS.flashcards.max);
}

function parseQuizQuestions(value: unknown): ChatQuizQuestion[] {
  const questions: ChatQuizQuestion[] = [];

  for (const item of Array.isArray(value) ? value : []) {
    const record = asRecord(item);
    const prompt = tidy(record.prompt, FRONT_MAX_LENGTH);
    const rawOptions = Array.isArray(record.options) ? record.options : [];
    const options = rawOptions
      .map((option) => tidy(option, OPTION_MAX_LENGTH))
      .slice(0, QUIZ_OPTION_COUNT);
    const correctIndex = typeof record.correctIndex === "number" ? Math.round(record.correctIndex) : -1;

    /*
     * A question with a blank option, a duplicate option or no right answer is not a question
     * anybody can be marked on, so it is dropped whole rather than drawn half-broken.
     */
    if (
      !prompt ||
      options.length < 2 ||
      options.some((option) => !option) ||
      new Set(options.map((option) => option.toLowerCase())).size !== options.length ||
      correctIndex < 0 ||
      correctIndex >= options.length
    ) {
      continue;
    }

    questions.push({
      prompt,
      options,
      correctIndex,
      explanation: tidy(record.explanation, EXPLANATION_MAX_LENGTH) || null,
    });
  }

  return questions.slice(0, CHAT_STUDY_COUNTS.quiz.max);
}

function parseTestQuestions(value: unknown): ChatTestQuestion[] {
  const questions: ChatTestQuestion[] = [];

  for (const item of Array.isArray(value) ? value : []) {
    const record = asRecord(item);
    const prompt = tidy(record.prompt, FRONT_MAX_LENGTH);
    const answer = tidy(record.answer, BACK_MAX_LENGTH);

    if (prompt && answer) {
      questions.push({ prompt, answer });
    }
  }

  return questions.slice(0, CHAT_STUDY_COUNTS.test.max);
}

/**
 * A stored or freshly written attachment, or null when there is nothing worth drawing.
 *
 * A set whose every item failed the checks comes back as a failed attachment of its kind rather
 * than null, for the same reason a failure is kept at all: the answer above it promised one.
 */
export function parseChatStudyAttachment(value: unknown): ChatStudyAttachment | null {
  const record = asRecord(value);

  if (!isChatStudyKind(record.kind)) {
    return null;
  }

  const kind = record.kind;
  const failed = { version: CHAT_STUDY_SET_VERSION, kind, failed: true } as const;

  if (record.failed === true) {
    return failed;
  }

  const title = tidy(record.title, TITLE_MAX_LENGTH);

  if (kind === "flashcards") {
    const cards = parseCards(record.cards);
    return cards.length > 0 ? { version: 1, kind, title, cards } : failed;
  }

  if (kind === "quiz") {
    const questions = parseQuizQuestions(record.questions);
    return questions.length > 0 ? { version: 1, kind, title, questions } : failed;
  }

  if (kind === "test") {
    const questions = parseTestQuestions(record.questions);
    return questions.length > 0 ? { version: 1, kind, title, questions } : failed;
  }

  const doc = parseMindmapDoc(record.doc);
  return doc ? { version: 1, kind, title: title || doc.title, doc } : failed;
}

export function isChatStudySet(attachment: ChatStudyAttachment): attachment is ChatStudySet {
  return !("failed" in attachment);
}

/** How many things the learner will work through, for the set's heading. */
export function countChatStudyItems(set: ChatStudySet): number {
  switch (set.kind) {
    case "flashcards":
      return set.cards.length;
    case "quiz":
    case "test":
      return set.questions.length;
    case "mindmap":
      return set.doc.branches.length;
  }
}

/**
 * The set the tutor attached to a turn, for the transcript sent back to the model.
 *
 * Without it the tutor's own last turn reads "Here are eight cards on osmosis." and nothing else,
 * so "explain the third one" or "why is B wrong?" has nothing to point at. It travels as its own
 * field beside the turn's text (`attachedSet`), never inside it: written into the text, the model
 * read it as something it had said and began writing the same note into new replies.
 */
export function describeChatStudyAttachment(attachment: ChatStudyAttachment | null): string {
  if (!attachment || !isChatStudySet(attachment)) {
    return "";
  }

  const heading = `${attachment.kind}${attachment.title ? ` "${attachment.title}"` : ""}`;
  let lines: string[];

  switch (attachment.kind) {
    case "flashcards":
      lines = attachment.cards.map((card, index) => `${index + 1}. ${card.front} = ${card.back}`);
      break;
    case "quiz":
      /*
       * The question and its right answer, with the letter it was shown under. The wrong
       * options are left out: they are what made a long quiz overrun the history's cap, and
       * "why is B right?" needs only the right one.
       */
      lines = attachment.questions.map(
        (question, index) =>
          `${index + 1}. ${question.prompt} = ${String.fromCharCode(65 + question.correctIndex)}) ${question.options[question.correctIndex]}`,
      );
      break;
    case "test":
      lines = attachment.questions.map(
        (question, index) => `${index + 1}. ${question.prompt} = ${question.answer}`,
      );
      break;
    case "mindmap":
      lines = attachment.doc.branches.map(
        (branch) =>
          `- ${branch.label}${branch.children.length ? `: ${branch.children.map((child) => child.label).join(", ")}` : ""}`,
      );
      break;
  }

  return [heading, ...lines].join("\n");
}

/**
 * How much of a described set goes back with the history. The library chat sends its history from
 * the browser and its route refuses a longer field; the tutor trims to the same length anyway.
 */
export const CHAT_STUDY_HISTORY_CHAR_CAP = 4000;

/** Where the set's description goes on a turn of history: its own field, and only when there is one. */
export function withAttachedSet<TTurn extends { role: "user" | "assistant"; content: string }>(
  turn: TTurn,
  attachment: unknown,
): TTurn & { attachedSet?: string } {
  const described = describeChatStudyAttachment(parseChatStudyAttachment(attachment));

  return described ? { ...turn, attachedSet: described.slice(0, CHAT_STUDY_HISTORY_CHAR_CAP) } : turn;
}
