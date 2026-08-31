/**
 * A topical emoji for a note, the way the redesign draws every note row and
 * note header.
 *
 * The lectures table has no emoji column, so this derives one: a keyword match
 * against the title first, then a stable hash of the title (or, failing that,
 * the source type) so the same note always gets the same glyph. Swap this for a
 * stored, model-picked emoji when there is a column to read it from.
 */

const SOURCE_EMOJI: Record<string, string> = {
  audio: "🎙️",
  recording: "🎙️",
  upload: "🔊",
  link: "🔗",
  text: "📝",
  pdf: "📚",
  document: "📚",
  scan: "🖼️",
  image: "🖼️",
  youtube: "📺",
};

/** Keyword → emoji, longest match wins. Slovenian first, English alongside. */
const TOPIC_EMOJI: Array<[string[], string]> = [
  [["mikroekonom", "makroekonom", "ekonom", "econom", "trg", "inflacij"], "📈"],
  [["statistik", "verjetnost", "statistic", "probabil"], "🎲"],
  [["matematik", "algebra", "analiz", "integral", "odvod", "math", "calculus"], "➗"],
  [["geometrij", "trigonom", "geometry"], "📐"],
  [["anatomij", "nevro", "možgan", "anatomy", "neuro", "brain"], "🧠"],
  [["medicin", "bolezn", "klinič", "medicine", "clinical", "patolog"], "🩺"],
  [["biologij", "celic", "genetik", "biology", "cell", "dna", "evolucij"], "🧬"],
  [["kemij", "molekul", "chemistry", "reakcij"], "⚗️"],
  [["fizik", "mehanik", "kvantn", "physics", "quantum", "termodinam"], "⚛️"],
  [["pravo", "pogodb", "zakon", "ustav", "law", "legal", "obligacij"], "⚖️"],
  [["algoritm", "podatkovn", "programir", "algorithm", "data structure", "koda", "code"], "🕸️"],
  [["računalni", "informatik", "computer", "software", "omrež", "network"], "💻"],
  [["umetna intelig", "strojno uč", "machine learning", "nevronsk", "artificial intel"], "🤖"],
  [["zgodovin", "history", "vojn", "revolucij", "antik"], "📜"],
  [["geograf", "geolog", "geography", "podnebj", "climate"], "🌍"],
  [["psiholog", "vedenj", "psychology", "kognitiv"], "🫀"],
  [["sociolog", "družb", "politolog", "sociology", "politic"], "🏛️"],
  [["filozof", "etik", "philosoph", "ethic", "logik"], "🤔"],
  [["jezik", "slovnic", "književn", "literatur", "language", "grammar"], "📖"],
  [["marketing", "prodaj", "oglaš", "brand"], "📣"],
  [["računovod", "finanč", "finance", "accounting", "davk", "bilanc"], "💶"],
  [["management", "podjetni", "vodenj", "business", "strateg"], "🧭"],
  [["arhitektur", "gradben", "architect", "construction"], "🏗️"],
  [["strojni", "elektro", "engineer", "inženir"], "⚙️"],
  [["umetnost", "glasb", "art", "music", "design", "oblikovanj"], "🎨"],
  [["šport", "trening", "sport", "fitness"], "🏃"],
  [["izpit", "kolokvij", "exam", "test", "ponovitev"], "📝"],
];

/** A varied fallback set, so untitled or unmatched notes still look distinct. */
const FALLBACK_EMOJI = [
  "📘",
  "📗",
  "📙",
  "📕",
  "🗂️",
  "🧩",
  "🔬",
  "🧮",
  "🗺️",
  "💡",
  "🔖",
  "📔",
];

function hash(value: string) {
  let h = 0;

  for (let index = 0; index < value.length; index += 1) {
    h = (h * 31 + value.charCodeAt(index)) | 0;
  }

  return Math.abs(h);
}

export function noteEmoji(
  lecture: { title?: string | null; source_type?: string | null; id?: string },
): string {
  const title = (lecture.title ?? "").toLowerCase();

  if (title) {
    for (const [keywords, emoji] of TOPIC_EMOJI) {
      if (keywords.some((keyword) => title.includes(keyword))) {
        return emoji;
      }
    }
  }

  const seed = title || lecture.id || "";

  if (!seed) {
    return SOURCE_EMOJI[lecture.source_type ?? ""] ?? "📝";
  }

  return FALLBACK_EMOJI[hash(seed) % FALLBACK_EMOJI.length];
}
