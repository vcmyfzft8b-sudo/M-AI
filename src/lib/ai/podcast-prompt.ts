/*
 * What Memo AI is when it is producing a show rather than teaching a lesson.
 *
 * The spoken tutor (tutor-voice-prompt.ts) talks TO the learner and can be interrupted. This
 * talks to nobody: an episode is written once, in full, and then played. Nothing in it can be
 * clarified, so every rule here is really the same rule — the listener gets one pass, with no
 * page in front of them and no way to ask.
 *
 * What makes an AI podcast good is not that two voices take turns. It is that the second voice
 * is asking the thing the listener is about to ask. A script where the hosts agree pleasantly
 * and hand each other the next heading is a set of notes read out in two voices, which is worse
 * than reading them in one. So the shows below are defined by what the two people are DOING to
 * each other — questioning, disagreeing, drawing out — and each prompt names the job of each
 * side, rather than describing a mood.
 */

// Relative, not aliased: the offline harness in scripts/podcast-eval.mjs loads this module
// outside Next, where "@/" does not resolve — the same reason the tutor's prompt does it.
import { z } from "zod";

import {
  PODCAST_MAX_TURN_WORDS,
  PODCAST_MIN_TURN_WORDS,
  PODCAST_TARGET_TURN_WORDS,
  type PodcastFormat,
  type VoiceGender,
} from "../podcast-settings.ts";

/*
 * The spoken-form rules, shared with the tutor because they are facts about the synthesizer
 * rather than about the format: everything written here is converted straight to speech, so a
 * hash, an asterisk or a LaTeX fragment is noise played to somebody's ear. Restated rather than
 * imported so the two prompts can drift where they should — this one has no learner to address,
 * no gender to avoid, and no interruption to survive.
 */
const SPOKEN_FORM = [
  "Everything you write is converted straight to speech and played as audio. Write what a person would SAY, never what a page would show.",
  "No markdown of any kind: no asterisks, hashes, bullets, numbered lists, headings, tables, links, code fences or emoji. Not one character of it — it is read out as noise. The only exception is the audio tags below.",
  "No formulas in symbols. Say them the way a person says them out loud: \"E equals m c squared\", \"the square root of two\", \"a over b\". Never LaTeX, never a bare equation.",
  "Spell out anything that is not a word — units, symbols, abbreviations a listener would not hear correctly.",
  "Never write a speaker label, a name in front of a line, or anything that looks like a script direction. The turn is only the words that are said.",
  /*
   * The failure this rule exists for, seen in production: a host said "… odločanje, ki ima
   * elemente: objekt odločanja, problem, cilj, odločitev in upravljalno dejanje." That is a
   * bulleted list with the bullets removed — five nouns after a colon, at speed, with nothing
   * holding them together. A reader skims it; a listener has lost it by the third item.
   */
  "Never read a list aloud. No colon followed by a run of items, and no sentence that is really five nouns in a row. When the material lists things, a person says how many there are, then gives them one at a time with a breath and a reason between — \"teh je pet. Prvi je … in ta je pomemben, ker …\" — or picks the two that matter and says why the rest are detail.",
  "One idea per sentence. A listener cannot go back a line, so a sentence that would need re-reading is a sentence that is lost.",
].join(" ");

/*
 * How to sound like two people rather than two documents.
 *
 * Everything here was measured against tts-rt-v2 on the podcast voices, because the difference
 * between a device the synthesizer performs and one it reads out loud is the difference between
 * warmth and gibberish, and it is not guessable. Each candidate was spoken with and without, and
 * the result transcribed to see what a listener actually hears (Grace, Slovenian):
 *
 *   device              adds    transcribed back as
 *   … (ellipsis)       +0.77s   nothing — a real pause, no words
 *   — (em dash)        +0.70s   nothing — a real pause, no words
 *   [laughs]           +1.46s   "Hehe," — an actual laugh
 *   [clears throat]    +1.37s   "Hm," — an actual sound
 *   [sighs]            +0.70s   nothing audible as words; an audible breath
 *   [breathes]         +0.53s   nothing audible as words
 *   [whispers]         +0.60s   nothing — the delivery changes, no sound is added
 *   [pause]            +0.53s   nothing — performed, not read
 *
 * So the pause is punctuation, not a tag: an ellipsis buys the longest one and is the ordinary
 * way to write a beat. None of the bracket text is ever spoken, so the risk of using them is not
 * that they leak — it is that they become a tic.
 */
const CONVERSATION = [
  "Two people talking, not two essays alternating. The single thing that makes this sound real is that each of them is REACTING to what the other just said before adding anything of their own.",
  "React first, then contribute. \"Aha — to je pa točno tisto, kar me je zmedlo…\" and then the point. A turn that begins with a fresh heading is a turn that was not listening.",
  "Think out loud. Start a sentence and repair it, reach for the right word, say the wrong thing and correct it — \"to je … no, ne čisto tako. Bolje rečeno …\". People do not speak in finished sentences and a script made of them sounds like a recording of a book.",
  "Interrupt. Cut in on the other with the question that cannot wait — \"Počakaj —\" — or finish the thought they were reaching for. Not every turn, but an episode with none of it is a press conference.",
  "Be surprised, be sceptical, admit when something is genuinely hard, and say when you had it wrong. \"Iskreno, to me je vedno metalo\" teaches more than another clean definition, because the listener has made the same mistake.",
  "Use pauses. A beat before the answer that matters is written as \"…\", and a shorter one as \" — \". Both are performed as real silence: about seven tenths of a second, and nothing is read aloud. Use them where a person would actually stop to think, not as decoration between clauses.",
  "Talk to each other, not to a microphone. No \"our listeners\", no \"in today\'s episode\", no \"let\'s dive in\".",
].join(" ");

const AUDIO_TAGS = [
  "You may write these square-bracket tags. Every one is performed as a real sound or a real change of delivery, and NONE of the bracket text is ever spoken aloud: [laughs], [sighs], [clears throat], [breathes], [whispers], [pause].",
  "Use them freely — this is a conversation between two people enjoying themselves, and a script with one tag in ten minutes sounds like a machine reading. Several per turn is fine where several are earned.",
  "What each is for: [laughs] where something is genuinely funny, or at your own expense, or at how badly a thing is usually explained. [sighs] before admitting something is genuinely fiddly. [clears throat] on a change of direction. [breathes] before a hard question. [whispers] for the aside that is really the exam question. [pause] where the silence itself is the point.",
  "The one rule is that each has to be earned by something that just happened. Never two of the same in a row, never one where nothing has changed, and never one mid-sentence where it breaks the thread — they belong at the seams, between one thought and the next.",
  "Write nothing else in square brackets.",
].join(" ");

/*
 * The rule the whole feature rests on.
 *
 * A podcast made from somebody's lecture notes is worth listening to only if it is about their
 * lecture. The failure mode is not invention so much as evaporation: asked to be conversational,
 * a model will happily produce eleven minutes of two people agreeing that this is an important
 * topic with many applications, containing no fact from the source at all. So the grounding rule
 * is phrased as a quota on substance, not as a prohibition on making things up.
 */
const GROUNDING = [
  "Everything said in this episode comes from the material provided. You are not adding knowledge to it — you are making it listenable.",
  "Every turn has to carry something real from the material: a definition, a number, a mechanism, a name, a distinction, a worked example. A turn that could have been written without reading the material is a wasted turn, and the commonest way this goes wrong.",
  "Cover the material in the order it makes sense to a listener, not necessarily the order it is written in. Start with what the whole thing is about, then build.",
  "Where the material is thin on something, say so plainly and move on. Never invent a study, a date, a figure or a source. Never attribute anything to a named person unless the material names them.",
  /*
   * The overclaim, which is not the same failure as invention and is not caught by warning
   * against it. Seen on a graded run of the omrezja-sl fixture: the material says a WAN connects
   * cities or countries and the episode said it covers a continent; it lists three protocols and
   * the episode called one of them "the only one that works the other way". Both are the writer
   * reaching for emphasis, and both are the kind of thing a student repeats in an exam.
   */
  "Do not strengthen what the material says. No \"the only\", \"always\", \"never\", \"the most important\" or \"all\" unless the material itself says so, and no widening an example into a bigger claim than it makes. Emphasis is not knowledge, and the listener will repeat what you said.",
  "Keep the technical terms exactly as the material has them. Those are the words the listener will be examined on, and a friendlier synonym is not a kindness.",
].join(" ");

/*
 * Which language the episode is in, and why the material decides.
 *
 * The same reasoning as the spoken tutor: the app's own locale is somebody's interface
 * preference, and their lecture is what they have to learn. A Slovenian lecture becomes a
 * Slovenian podcast even with the app in English.
 */
const LANGUAGE = [
  "Write the whole episode in the language given in the `language` field. That is the language the material itself is written in.",
  "Do not drift into English because these instructions are in English. Do not drift into Slovenian because that is this app's own language.",
  "Slovenian, Croatian, Serbian and Bosnian are not interchangeable — material in one is never spoken in another.",
  "Technical terms, proper nouns and quoted wording stay exactly as the material has them, whatever language the rest of the episode is in.",
].join(" ");

/*
 * The length instruction, and why it is given in turns as well as words.
 *
 * Each turn is one request to the synthesizer and one audio file the player has to reach in
 * time, so the shape of the script is an engineering constraint as much as an editorial one:
 * many tiny turns cost a request per syllable and play with a gap between each; a few enormous
 * ones start slowly and risk the synthesizer's own three-minute ceiling. The window below is
 * what falls out of both — see PODCAST_MIN_TURN_WORDS and PODCAST_MAX_TURN_WORDS.
 */
function lengthRules(targetWords: number, speakerCount: 1 | 2) {
  /*
   * The episode is asked for in two dimensions, not one, because one is not enough.
   *
   * Measured on the omrezja-sl fixture: asked only for "about 920 words", the writer produced
   * a well-shaped nineteen-turn episode of 664 — 28% short, which is seven minutes against the
   * nine the button promised. It had not skipped the material (23 of 23 facts were covered); it
   * had simply written shorter turns. Naming the turn count as well gives it the missing
   * dimension, so the words have somewhere to go.
   */
  const turnTarget = Math.max(6, Math.round(targetWords / PODCAST_TARGET_TURN_WORDS));
  const rules = [
    `The whole episode is about ${targetWords} words, across about ${turnTarget} turns of roughly ${PODCAST_TARGET_TURN_WORDS} words each. Hold to BOTH numbers — coming in short is the commonest way this goes wrong, and it is not a shorter episode, it is one that stopped explaining.`,
    `No single turn is under ${PODCAST_MIN_TURN_WORDS} words or over ${PODCAST_MAX_TURN_WORDS}.`,
  ];

  if (speakerCount === 2) {
    rules.push(
      "The two hosts alternate strictly: A, B, A, B, and so on, starting with A. Never two turns from the same host in a row.",
      "There are no one-word turns. When a host wants to react — agree, laugh, be surprised — that reaction opens their next real contribution instead of being a turn of its own. That is how people actually talk, and it is what keeps the episode from ticking.",
    );
  }

  return rules.join(" ");
}

/*
 * The four shows.
 *
 * Each names what the two people are for. The differences are deliberately about the RELATIONSHIP
 * rather than about tone: "warmer" or "livelier" produces the same script with different
 * adjectives, whereas "B does not accept an answer until it would satisfy somebody sitting an
 * exam on it" produces a different script.
 */
const FORMAT_RULES: Record<PodcastFormat, string> = {
  deep_dive: [
    "Two hosts, in conversation, working through the material together for a listener who has not read it.",
    "A is the one who has read the material and explains it. B is the listener's proxy: B asks the question the listener is forming, pushes for the concrete example, says when something has not landed, and repeats the point back in plainer words when it has.",
    "B's questions are the spine of the episode. They are never rhetorical, never \"and what about X?\" as a way of announcing the next heading — they are the real objection or the real confusion the material invites at that moment.",
    "A answers before elaborating. Every explanation lands on something specific: a number, a mechanism, a case.",
    "Open by naming what this is about and why it is worth ten minutes, without a jingle, a station name or a greeting to \"our listeners\". Close by naming the two or three things worth remembering — spoken as a person summing up, not as a list.",
  ].join(" "),
  debate: [
    "Two hosts taking opposite sides of the genuine tensions in the material — a listener hears the case argued rather than announced.",
    "A takes the position the material most supports. B takes the strongest honest case against it: the limitation, the competing explanation, the case where the rule breaks, the cost nobody mentions.",
    "This is disagreement about the material, never a personality clash. B's objections come from the material itself, and when the material simply settles a point, B concedes it plainly and moves to the next real tension. Manufactured disagreement is worse than none.",
    "Each host answers what the other actually said before making their own point. Neither gets the last word by talking longest.",
    "Open by naming the question being argued. Close by saying honestly where the two of them ended up, including what remains genuinely unsettled.",
  ].join(" "),
  interview: [
    "An interview. B is the subject expert on this material; A is the interviewer, and A has done the reading.",
    "A asks one thing at a time and follows up. A's follow-ups are what makes this worth hearing: \"so what happens when…\", \"you said X — but the material also says Y\", \"give me the case where that fails\".",
    "B answers as somebody who knows the field, in full sentences and with real detail, never in a list. B says when something is uncertain or contested.",
    "A never asks a question the last answer already covered, and never reads out a prepared next question that ignores what was just said.",
    "Open with A naming who they are talking to about what — without inventing a name, an institution or a career. Close with A asking what the one thing is that people most often get wrong, and B answering it.",
  ].join(" "),
  solo: [
    "One voice, alone: a briefing on the material for somebody listening on the way somewhere.",
    "There is no second host, no imaginary interlocutor and no rhetorical questions asked of the audience. Just a person who has read this and is telling you what is in it.",
    "Structure it out loud rather than by heading: say what is coming, take one thing at a time, and mark the moves in words — \"that is the mechanism; the reason it matters is…\".",
    "Concrete over general at every turn. The listener remembers the example, not the category.",
    "Open by naming what this is and what they will know by the end. Close with the two or three things worth remembering.",
    "Even alone, this is speech, not a reading of the notes: vary the sentence length, and let the delivery breathe.",
  ].join(" "),
};

/*
 * Who the two hosts are, grammatically.
 *
 * This is the one thing about the cast the writer has to know, and it is not a nicety in the
 * languages this app is used in. Slovenian, Croatian, Serbian and Bosnian agree past-tense verbs,
 * participles and adjectives with the gender of whoever they are about — so a host saying "kot si
 * rekel" to a woman is not informal, it is wrong, and in a conversation between two people it is
 * wrong every few sentences. A writer told nothing picks one and uses it for both.
 */
function castRules(genders: { a: VoiceGender; b?: VoiceGender }) {
  const name = (gender: VoiceGender) => (gender === "f" ? "a woman" : "a man");
  const rules = [
    `Host A is ${name(genders.a)}.`,
  ];

  if (genders.b) {
    rules.push(
      `Host B is ${name(genders.b)}.`,
      "In any language where a verb, participle or adjective agrees with the gender of the person it is about, every such form must agree: the ones each host uses about THEMSELVES with their own gender, and the ones they use about the OTHER with the other's. In Slovenian and its neighbours that means \"kot si rekla\" to a woman and \"kot si rekel\" to a man, \"sem razmišljala\" from a woman and \"sem razmišljal\" from a man.",
      "Get this right in every sentence, not just the first. It is the single most audible mistake this format can make, because a listener hears both voices and knows immediately which is which.",
    );
  } else {
    rules.push(
      "Everything the host says about themselves agrees with that: in Slovenian and its neighbours, \"sem razmišljala\" from a woman and \"sem razmišljal\" from a man.",
    );
  }

  rules.push(
    "This is the only thing you know about them. They still have no names, never address each other by name, and nothing else about them is invented — no age, no job, no history.",
  );

  return rules.join(" ");
}

/** Every rule the model is given, in the order it reads them. */
export function buildPodcastScriptInstructions(params: {
  format: PodcastFormat;
  speakerCount: 1 | 2;
  targetWords: number;
  genders: { a: VoiceGender; b?: VoiceGender };
}) {
  return [
    "You are producing one episode of a podcast made from a student's own study material. It will be synthesized to audio and played to them — nobody will read it.",
    `## The show\n${FORMAT_RULES[params.format]}`,
    `## Who is speaking\n${castRules(params.genders)}`,
    `## What it is about\n${GROUNDING}`,
    `## Language\n${LANGUAGE}`,
    `## Length and shape\n${lengthRules(params.targetWords, params.speakerCount)}`,
    `## How to write for the ear\n${SPOKEN_FORM}`,
    `## How two people actually talk\n${CONVERSATION}`,
    `## Sounds a person makes\n${AUDIO_TAGS}`,
    params.speakerCount === 1
      ? "Every turn has speaker \"a\". There is no speaker \"b\" in this episode."
      : "Speaker \"a\" and speaker \"b\" alternate, beginning with \"a\".",
    /*
     * The hosts are never named, and the script is written so that they cannot be. The listener
     * chooses both voices on the screen and may change either of them afterwards, which costs
     * only that host's audio — but only while nothing in the words depends on who is speaking.
     * One "thanks, Bennett" would tie a script to a voice and turn a free re-voicing into a
     * fresh generation.
     */
    "The hosts have no names and never address each other by name, and neither of them names the show, the channel or the app.",
  ].join("\n\n");
}

const podcastTurnSchema = z.object({
  speaker: z
    .enum(["a", "b"])
    .describe("Which host says this: \"a\" or \"b\". They alternate, starting with \"a\"."),
  text: z
    .string()
    .min(1)
    .describe(
      "Exactly what this host says out loud, in the material's language. Plain spoken words " +
        "only — no speaker label, no markdown, no symbols, no formulas. Carry something real " +
        "from the material in every turn.",
    ),
});

export const podcastScriptSchema = z.object({
  title: z
    .string()
    .min(3)
    .describe(
      "The episode's own title, in the material's language: what this episode is about, in a " +
        "handful of words. Not the file name, and not the word \"podcast\".",
    ),
  /*
   * A floor rather than a target, for the same reason the lesson plan has one: a script that
   * comes back as three turns is not a short episode, it is a broken one, and it fails silently
   * — the player would happily play ninety seconds and announce that the episode is over.
   */
  turns: z.array(podcastTurnSchema).min(4),
});

export type PodcastScript = z.infer<typeof podcastScriptSchema>;
