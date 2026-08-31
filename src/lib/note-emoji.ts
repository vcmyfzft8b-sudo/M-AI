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

/*
 * Keyword → emoji, longest match wins.
 *
 * Stems rather than words, and one list across every language Memo ships in, because the title
 * being matched is the learner's — written in whatever language their material is in — not the
 * language the interface happens to be set to. A Croatian student's "Povijest" and a Serbian
 * student's "Istorija" have to land on the same scroll as a Slovenian "Zgodovina".
 *
 * Most Slovenian stems already cover Croatian, Bosnian and Serbian: "matematik", "biologij" and
 * "psiholog" are shared. The entries below add the ones that are not — mainly where the
 * ijekavian/ekavian split or a different loanword moves the stem ("povijest"/"istorij",
 * "znanost"/"nauk", "tvrtk", "preduzeć") — plus the words those markets use for an exam.
 */
const TOPIC_EMOJI: Array<[string[], string]> = [
  [["mikroekonom", "makroekonom", "ekonom", "econom", "trg", "tržišt", "inflacij"], "📈"],
  [["statistik", "verjetnost", "vjerojatn", "verovatn", "statistic", "probabil"], "🎲"],
  [["matematik", "algebra", "analiz", "integral", "odvod", "izvod", "math", "calculus"], "➗"],
  [["geometrij", "trigonom", "geometry"], "📐"],
  [["anatomij", "nevro", "neuro", "možgan", "mozg", "anatomy", "brain"], "🧠"],
  [["medicin", "bolezn", "bolest", "klinič", "medicine", "clinical", "patolog"], "🩺"],
  [["biologij", "celic", "ćelij", "stanic", "genetik", "biology", "cell", "dna", "evolucij"], "🧬"],
  [["kemij", "hemij", "molekul", "chemistry", "reakcij"], "⚗️"],
  [["fizik", "mehanik", "kvantn", "physics", "quantum", "termodinam"], "⚛️"],
  [["pravo", "pogodb", "ugovor", "zakon", "ustav", "law", "legal", "obligacij"], "⚖️"],
  [["algoritm", "podatkovn", "programir", "algorithm", "data structure", "koda", "code"], "🕸️"],
  [["računalni", "računarstv", "informatik", "computer", "software", "omrež", "mrež", "network"], "💻"],
  [["umetna intelig", "umjetna intelig", "veštačka intelig", "vještačka intelig", "strojno uč", "mašinsko uč", "machine learning", "nevronsk", "neuronsk", "artificial intel"], "🤖"],
  [["zgodovin", "povijest", "istorij", "history", "vojn", "rat", "revolucij", "antik"], "📜"],
  [["geograf", "geolog", "geography", "podnebj", "klim", "climate"], "🌍"],
  [["psiholog", "vedenj", "ponašanj", "psychology", "kognitiv"], "🫀"],
  [["sociolog", "družb", "društv", "politolog", "sociology", "politic"], "🏛️"],
  [["filozof", "etik", "philosoph", "ethic", "logik"], "🤔"],
  [["jezik", "slovnic", "gramatik", "književn", "literatur", "language", "grammar"], "📖"],
  [["marketing", "prodaj", "oglaš", "reklam", "brand"], "📣"],
  [["računovod", "finanč", "finansij", "finance", "accounting", "davk", "porez", "bilanc"], "💶"],
  [["management", "menadžment", "podjetni", "poduzetni", "preduzetni", "vodenj", "business", "strateg"], "🧭"],
  [["arhitektur", "gradben", "građevin", "architect", "construction"], "🏗️"],
  [["strojni", "mašinstv", "elektro", "engineer", "inženir", "inženjer"], "⚙️"],
  [["umetnost", "umjetnost", "glasb", "muzik", "art", "music", "design", "oblikovanj", "dizajn"], "🎨"],
  [["šport", "sport", "trening", "fitness"], "🏃"],
  [["naravoslov", "prirodn znanost", "prirodn nauk", "science"], "🔬"],
  [["izpit", "ispit", "kolokvij", "matur", "exam", "test", "ponovitev", "ponavljanj"], "📝"],
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
