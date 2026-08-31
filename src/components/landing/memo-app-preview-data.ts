import type { CSSProperties } from "react";

export type SourceKind = "audio" | "pdf" | "text" | "link";
export type NoteStatus = "uploading" | "queued" | "transcribing" | "generating_notes" | "ready" | "failed";

export type PreviewNote = {
  id: string;
  emoji: string;
  title: string;
  source: SourceKind;
  date: string;
  status: NoteStatus;
};

export type PreviewFolder = {
  id: string;
  name: string;
  icon: string;
  noteIds: string[];
};

export type CaptureMode = "record" | "upload" | "file" | "link";

/* The create sheet's four rows, as `createOptions` lists them. */
export const CREATE_OPTIONS: Array<{ id: CaptureMode; emoji: string; label: string }> = [
  { id: "record", emoji: "🎙️", label: "Posnemi zvok" },
  { id: "upload", emoji: "🔊", label: "Naloži zvok" },
  { id: "file", emoji: "📚", label: "PDF, datoteka ali besedilo" },
  { id: "link", emoji: "🔗", label: "Spletna povezava" },
];

/*
 * The capture screen each option opens, from the design's own `CAPTURE` table.
 * `noteTitle` is the title the finished note takes, as `addNote` sets it.
 */
export const CAPTURE: Record<
  CaptureMode,
  {
    title: string;
    cta: string;
    emoji: string;
    source: SourceKind;
    placeholder?: string;
    noteTitle: string;
    /* The demo already has something to work with, so the capture screen opens
       on a chosen file rather than an empty picker: this is what it shows. */
    pickedName?: string;
    pickedMeta?: string;
    pickedText?: string;
  }
> = {
  record: { title: "Posnemi zvok", cta: "Ustavi in ustvari zapisek", emoji: "🎙️", source: "audio", noteTitle: "Nov posnetek predavanja" },
  upload: {
    title: "Naloži zvok",
    cta: "Ustvari zapisek",
    emoji: "🔊",
    placeholder: "MP3, M4A, WAV ali WEBM",
    source: "audio",
    noteTitle: "Naložen posnetek",
    pickedName: "Predavanje-IS-4.m4a",
    pickedMeta: "51,2 MB • 47:38",
  },
  file: {
    title: "PDF, datoteka ali besedilo",
    cta: "Ustvari zapisek",
    emoji: "📚",
    placeholder: "PDF, DOCX, PPTX ali slika",
    source: "pdf",
    noteTitle: "Naloženo gradivo",
    pickedName: "Poslovni-IS-skripta.pdf",
    pickedMeta: "24 strani • 3,1 MB",
  },
  link: {
    title: "Spletna povezava",
    cta: "Ustvari zapisek",
    emoji: "🔗",
    placeholder: "https://…",
    source: "link",
    noteTitle: "Uvožena povezava",
    pickedText: "https://www.finance.si/erp-sistemi-v-praksi",
  },
};

/* The help centre's three groups, exactly as the design's `helpSections` list
   them. The rows lead somewhere in the real app; here they are the design's
   own inert rows. */
export const HELP_SECTIONS = [
  {
    title: "Pogosto",
    items: ["Družinski paket?", "Ali lahko podarim Memo?", "Ali podpirate moj jezik?", "Predlog funkcije"],
  },
  {
    title: "Snemanje in zapiski",
    items: ["Video povezava ne deluje", "Ne morem naložiti zvoka", "Prepis je prekratek ali netočen"],
  },
  {
    title: "Račun in dostop",
    items: ["Unovči kodo", "Politika zasebnosti", "Politika vračil", "Pogoji uporabe"],
  },
];

export const THEME_OPTIONS = [
  { value: "system", label: "Sistem", icon: "💻" },
  { value: "light", label: "Svetla", icon: "☀️" },
  { value: "dark", label: "Temna", icon: "🌙" },
] as const;

export type PreviewTheme = (typeof THEME_OPTIONS)[number]["value"];

/*
 * The mockup's palette: the `.phone` token block from the redesign's phone
 * artboard, verbatim. The names keep an `--m-` prefix because the mockup
 * renders inside the landing page, where `--surface` and friends already belong
 * to something else. `landing.css` states the same pair for the system theme;
 * these are what the in-mockup theme switch writes inline.
 */
export const LIGHT_TOKENS: Record<string, string> = {
  "--m-bg": "#f1f1f5",
  "--m-surface": "#ffffff",
  "--m-label": "#000000",
  "--m-second": "#8e8e95",
  "--m-tile": "rgba(0,0,0,0.05)",
  "--m-field": "rgba(0,0,0,0.07)",
  "--m-line": "rgba(0,0,0,0.09)",
  "--m-shadow": "0 2px 10px rgba(0,0,0,0.05)",
  "--m-shadow-lg": "0 -12px 40px rgba(0,0,0,0.18)",
  "--m-promo": "#5b21e0",
  "--m-scrim": "rgba(0,0,0,0.28)",
  "--m-focus-ring": "rgba(0,0,0,0.22)",
  "--m-head-hl": "color-mix(in srgb, #2563eb 24%, transparent)",
  "--m-callout-definition-line": "color-mix(in srgb, #2563eb 20%, var(--m-line))",
  "--m-callout-definition-bg": "color-mix(in srgb, #dbeafe 44%, var(--m-surface))",
  "--m-callout-example-line": "color-mix(in srgb, #16a34a 20%, var(--m-line))",
  "--m-callout-example-bg": "color-mix(in srgb, #dcfce7 40%, var(--m-surface))",
  "--m-callout-mistake-line": "color-mix(in srgb, #dc2626 20%, var(--m-line))",
  "--m-callout-mistake-bg": "color-mix(in srgb, #fee2e2 38%, var(--m-surface))",
  "--m-callout-takeaway-line": "color-mix(in srgb, #f59e0b 22%, var(--m-line))",
  "--m-callout-takeaway-bg": "color-mix(in srgb, #fef3c7 44%, var(--m-surface))",
  "--m-drag-easy-bg": "rgba(230,246,234,0.9)",
  "--m-drag-easy-ink": "#16a34a",
  "--m-drag-again-bg": "rgba(253,233,230,0.9)",
  "--m-drag-again-ink": "#dc2626",
  "--m-exit-easy-bg": "#e6f6ea",
  "--m-exit-easy-line": "#67d48a",
  "--m-exit-again-bg": "#fde9e6",
  "--m-exit-again-line": "#f28b82",
};

export const DARK_TOKENS: Record<string, string> = {
  "--m-bg": "#000000",
  "--m-surface": "#1c1c1e",
  "--m-label": "#ffffff",
  "--m-second": "#8e8e95",
  "--m-tile": "rgba(255,255,255,0.09)",
  "--m-field": "rgba(255,255,255,0.12)",
  "--m-line": "rgba(255,255,255,0.14)",
  "--m-shadow": "0 2px 10px rgba(0,0,0,0.5)",
  "--m-shadow-lg": "0 -12px 40px rgba(0,0,0,0.75)",
  "--m-promo": "#b18bff",
  "--m-scrim": "rgba(0,0,0,0.5)",
  "--m-focus-ring": "rgba(255,255,255,0.28)",
  "--m-head-hl": "color-mix(in srgb, #2563eb 42%, transparent)",
  "--m-callout-definition-line": "color-mix(in srgb, #2563eb 28%, var(--m-line))",
  "--m-callout-definition-bg": "color-mix(in srgb, #1d4ed8 22%, var(--m-surface))",
  "--m-callout-example-line": "color-mix(in srgb, #16a34a 28%, var(--m-line))",
  "--m-callout-example-bg": "color-mix(in srgb, #15803d 22%, var(--m-surface))",
  "--m-callout-mistake-line": "color-mix(in srgb, #dc2626 28%, var(--m-line))",
  "--m-callout-mistake-bg": "color-mix(in srgb, #b91c1c 20%, var(--m-surface))",
  "--m-callout-takeaway-line": "color-mix(in srgb, #f59e0b 30%, var(--m-line))",
  "--m-callout-takeaway-bg": "color-mix(in srgb, #b45309 22%, var(--m-surface))",
  "--m-drag-easy-bg": "color-mix(in srgb, var(--m-surface) 78%, #32d74b)",
  "--m-drag-easy-ink": "#32d74b",
  "--m-drag-again-bg": "color-mix(in srgb, var(--m-surface) 78%, #ff453a)",
  "--m-drag-again-ink": "#ff453a",
  "--m-exit-easy-bg": "color-mix(in srgb, var(--m-surface) 82%, #32d74b)",
  "--m-exit-easy-line": "color-mix(in srgb, #32d74b 45%, rgba(255,255,255,0.25))",
  "--m-exit-again-bg": "color-mix(in srgb, var(--m-surface) 82%, #ff453a)",
  "--m-exit-again-line": "color-mix(in srgb, #ff453a 45%, rgba(255,255,255,0.25))",
};

export const TABS = [
  { id: "notes", label: "Zapiski", icon: "description", tint: "#f45f5a" },
  { id: "flashcards", label: "Flashcards", icon: "style", tint: "oklch(0.66 0.15 295)" },
  { id: "quiz", label: "Kviz", icon: "quiz", tint: "oklch(0.66 0.15 340)" },
  { id: "test", label: "Test", icon: "assignment", tint: "oklch(0.66 0.15 150)" },
  { id: "transcript", label: "Prepis", icon: "text_snippet", tint: "oklch(0.66 0.15 250)" },
] as const;

export type NoteTab = (typeof TABS)[number]["id"];

/** What the phone's nav bar names each study screen. Flashcards names nothing. */
export const SUB_SCREEN_TITLES: Record<NoteTab, string> = {
  notes: "",
  flashcards: "",
  quiz: "Kviz",
  test: "Vadbeni test",
  transcript: "Prepis",
};

export type NoteThemeKey = "is" | "micro" | "anatomy" | "stats";

export type ChatMessage = { role: "assistant" | "user"; text: string };

export type ThemeStudy = {
  cards: Array<{ front: string; back: string }>;
  practice: Array<{ id: string; prompt: string }>;
  quiz: Array<{ question: string; options: string[]; correct: number; explanation: string }>;
  transcript: Array<{ time: string; text: string }>;
  chat: ChatMessage[];
  chatReply: string;
};

export const THEME_STUDY: Record<NoteThemeKey, ThemeStudy> = {
  is: {
    cards: [
      { front: "Kaj je transakcijski informacijski sistem?", back: "Sistem, ki zajema in obdeluje vsakodnevne poslovne dogodke, npr. naročila in plačila." },
      { front: "Kaj poveže ERP sistem?", back: "Finance, nabavo, proizvodnjo, prodajo in kadre v skupno podatkovno bazo." },
      { front: "Zakaj je prenova procesov pomembna?", back: "Ker uvedba informatike v slab proces le pospeši slabe prakse." },
    ],
    practice: [
      { id: "p1", prompt: "Primerjaj funkcijske in integrirane informacijske sisteme." },
      { id: "p2", prompt: "Opiši, zakaj je prenova poslovnih procesov pogoj za uspešno uvedbo ERP." },
    ],
    quiz: [
      {
        question: "Kaj je glavna prednost integriranih IS pred funkcijskimi?",
        options: ["Skupna podatkovna baza in manj podvajanja", "Nižja cena licenc", "Manj uporabnikov v sistemu", "Krajši čas snemanja predavanj"],
        correct: 0,
        explanation: "Integrirani sistemi si delijo eno bazo, zato podatka ni treba vnašati večkrat, poročila pa so vedno skladna.",
      },
      {
        question: "Kateri sistem podpira odločanje vodstva?",
        options: ["Transakcijski sistem", "Poslovodski informacijski sistem", "Sistem za zajem podatkov", "Operacijski sistem"],
        correct: 1,
        explanation: "Poslovodski (MIS) sistemi povzamejo transakcijske podatke v poročila, ki jih vodstvo uporabi za odločitve.",
      },
    ],
    transcript: [
      { time: "00:12", text: "Danes bomo pogledali, zakaj so poslovni informacijski sistemi jedro sodobnega podjetja." },
      { time: "04:38", text: "Najprej ločimo transakcijske sisteme od poslovodskih, ker imajo različne uporabnike." },
      { time: "11:05", text: "ERP je odgovor na razdrobljenost podatkov med oddelki." },
      { time: "23:41", text: "Pred uvedbo je nujna prenova procesov, sicer digitaliziramo napake." },
    ],
    chat: [
      { role: "assistant", text: "Živjo! Vprašaj me karkoli o tem zapisku." },
      { role: "user", text: "Zakaj je ERP pomemben za izpit?" },
      { role: "assistant", text: "Ker povezuje oddelke v eno bazo – profesor to pogosto vpraša skupaj s prenovo procesov." },
    ],
    chatReply: "V zapisku to najdeš pod “Hiter pregled” – ERP poveže oddelke v skupno bazo in zmanjša podvajanje podatkov.",
  },
  micro: {
    cards: [
      { front: "Kaj meri cenovna elastičnost povpraševanja?", back: "Za koliko odstotkov se spremeni povpraševana količina, če se cena spremeni za en odstotek." },
      { front: "Kdaj je povpraševanje elastično?", back: "Ko je koeficient večji od 1 – takrat dvig cene zniža skupni prihodek." },
      { front: "Kaj vpliva na elastičnost?", back: "Število substitutov, delež izdatka v proračunu in dolžina obdobja." },
    ],
    practice: [
      { id: "p1", prompt: "Izračunaj koeficient elastičnosti in razloži učinek na skupni prihodek." },
      { id: "p2", prompt: "Primerjaj elastičnost nujnih in luksuznih dobrin ter utemelji razliko." },
    ],
    quiz: [
      {
        question: "Kaj velja pri elastičnem povpraševanju?",
        options: ["Dvig cene zniža skupni prihodek", "Dvig cene poveča prihodek", "Količina se ne spremeni", "Krivulja ponudbe je navpična"],
        correct: 0,
        explanation: "Pri koeficientu nad 1 količina pade močneje, kot zraste cena, zato skupni prihodek upade.",
      },
      {
        question: "Katera dobrina ima najbolj neelastično povpraševanje?",
        options: ["Zdravila na recept", "Letalska karta za počitnice", "Večerja v restavraciji", "Nova igralna konzola"],
        correct: 0,
        explanation: "Nujne dobrine brez substitutov kupimo tudi ob višji ceni, zato je povpraševanje neelastično.",
      },
    ],
    transcript: [
      { time: "00:20", text: "Elastičnost je razmerje med odstotno spremembo količine in odstotno spremembo cene." },
      { time: "06:14", text: "Če je koeficient večji od ena, govorimo o elastičnem povpraševanju." },
      { time: "14:52", text: "Poglejmo primer: dvig cene kave za deset odstotkov in padec količine za petnajst." },
      { time: "27:09", text: "Prihodek je največji tam, kjer je elastičnost enaka ena." },
    ],
    chat: [
      { role: "assistant", text: "Živjo! Vprašaj me karkoli o tem zapisku." },
      { role: "user", text: "Kako izračunam elastičnost?" },
      { role: "assistant", text: "Odstotno spremembo količine deliš z odstotno spremembo cene – predznak zanemariš, gledaš le velikost." },
    ],
    chatReply: "V zapisku je to pod “Hiter pregled” – koeficient nad 1 pomeni elastično povpraševanje in nižji prihodek ob dvigu cene.",
  },
  anatomy: {
    cards: [
      { front: "Kateri so glavni deli nevrona?", back: "Dendriti, celično telo, akson in sinaptični končiči." },
      { front: "Kaj naredi mielinska ovojnica?", back: "Pospeši prevajanje impulza s skoki med Ranvierjevimi zažemki." },
      { front: "Kaj obsega osrednji živčni sistem?", back: "Možgane in hrbtenjačo." },
    ],
    practice: [
      { id: "p1", prompt: "Opiši pot dražljaja od receptorja do efektorja." },
      { id: "p2", prompt: "Razloži načelo vse ali nič pri akcijskem potencialu." },
    ],
    quiz: [
      {
        question: "Kje se signal med nevronoma prenese kemično?",
        options: ["V sinapsi", "V dendritu", "V mielinski ovojnici", "V celičnem jedru"],
        correct: 0,
        explanation: "V sinaptični špranji se sproščajo nevrotransmiterji, ki signal prenesejo na naslednji nevron.",
      },
      {
        question: "Kaj spada v obkrajni živčni sistem?",
        options: ["Hrbtenjača", "Možgansko deblo", "Periferni živec", "Mali možgani"],
        correct: 2,
        explanation: "Obkrajni živčni sistem sestavljajo živci in gangliji zunaj možganov in hrbtenjače.",
      },
    ],
    transcript: [
      { time: "00:15", text: "Osnovna enota živčevja je nevron, ki dražljaj prevaja v obliki akcijskega potenciala." },
      { time: "05:47", text: "Mielinska ovojnica omogoča skokovito prevajanje in s tem veliko hitrost." },
      { time: "13:22", text: "V sinapsi se električni signal pretvori v kemičnega." },
      { time: "25:36", text: "Refleksni lok pokazuje najkrajšo pot od receptorja do efektorja." },
    ],
    chat: [
      { role: "assistant", text: "Živjo! Vprašaj me karkoli o tem zapisku." },
      { role: "user", text: "Kaj moram vedeti o sinapsi?" },
      { role: "assistant", text: "Da je to stik med nevronoma, kjer nevrotransmiterji prenesejo signal – prenos je enosmeren." },
    ],
    chatReply: "V zapisku je to pod “Hiter pregled” – dražljaj potuje po aksonu do sinapse, kjer se prenese kemično.",
  },
  stats: {
    cards: [
      { front: "Kaj je ničelna hipoteza?", back: "Predpostavka, da razlike ni — testiramo, ali jo podatki ovržejo." },
      { front: "Kaj pove p-vrednost?", back: "Verjetnost, da bi ob veljavni ničelni hipotezi dobili tako ali bolj skrajen rezultat." },
      { front: "Kdaj ničelno hipotezo zavrnemo?", back: "Ko je p-vrednost manjša od izbrane stopnje značilnosti, običajno 0,05." },
    ],
    practice: [
      { id: "p1", prompt: "Razloži razliko med napako prve in druge vrste." },
      { id: "p2", prompt: "Opiši, zakaj nizka p-vrednost sama po sebi ne dokazuje velikega učinka." },
    ],
    quiz: [
      {
        question: "Kaj pomeni p-vrednost 0,03 pri stopnji značilnosti 0,05?",
        options: [
          "Ničelno hipotezo zavrnemo",
          "Ničelno hipotezo sprejmemo kot dokazano",
          "Vzorec je premajhen",
          "Rezultat je gotovo praktično pomemben",
        ],
        correct: 0,
        explanation: "Ker je 0,03 < 0,05, je rezultat statistično značilen in ničelno hipotezo zavrnemo.",
      },
      {
        question: "Kaj je napaka prve vrste?",
        options: [
          "Ohranimo napačno ničelno hipotezo",
          "Zavrnemo pravilno ničelno hipotezo",
          "Napačno izmerimo vzorec",
          "Uporabimo napačno formulo",
        ],
        correct: 1,
        explanation: "Napaka prve vrste (alfa) pomeni, da zavrnemo ničelno hipotezo, ki je v resnici pravilna.",
      },
    ],
    transcript: [
      { time: "00:18", text: "Hipotezno testiranje je postopek, s katerim iz vzorca sklepamo o celotni populaciji." },
      { time: "07:42", text: "Ničelna hipoteza trdi, da razlike ni; alternativna, da razlika obstaja." },
      { time: "15:10", text: "P-vrednost primerjamo s stopnjo značilnosti, ki jo določimo vnaprej." },
      { time: "26:55", text: "Statistična značilnost ni isto kot praktična pomembnost rezultata." },
    ],
    chat: [
      { role: "assistant", text: "Živjo! Vprašaj me karkoli o tem zapisku." },
      { role: "user", text: "Kdaj zavrnem ničelno hipotezo?" },
      { role: "assistant", text: "Ko je p-vrednost manjša od stopnje značilnosti – najpogosteje 0,05." },
    ],
    chatReply: "V zapisku je to pod “Hiter pregled” – p-vrednost pod stopnjo značilnosti pomeni, da ničelno hipotezo zavrnemo.",
  },
};

/*
 * A note body, in the blocks the design's own renderer takes: a highlighted
 * heading, bulleted lines, plain lines and the four callouts. `blockStyle`
 * below is the artboard's function, transcribed.
 */
export type NoteBlockKind =
  | "h2"
  | "li"
  | "p"
  | "callout-definition"
  | "callout-example"
  | "callout-common_mistake"
  | "callout-key_takeaway";

export type NoteBlock = { text: string; kind: NoteBlockKind };

/*
 * The left rule stays one colour in both themes; the fill and the hairline
 * change with it, so each callout reads as a tint of its own colour rather
 * than a washed-out block on a dark page. The pairs live in landing.css.
 */
const CALLOUTS: Record<string, { edge: string; token: string }> = {
  definition: { edge: "#2563eb", token: "definition" },
  example: { edge: "#16a34a", token: "example" },
  common_mistake: { edge: "#dc2626", token: "mistake" },
  key_takeaway: { edge: "#f59e0b", token: "takeaway" },
};

export function blockStyle(kind: NoteBlockKind): CSSProperties {
  if (kind === "h2") {
    return {
      display: "inline-block",
      margin: "30.4px 0 11.2px",
      padding: "1.6px 5.12px",
      borderRadius: "6.72px",
      background: "var(--m-head-hl)",
      color: "var(--m-label)",
      fontSize: "21.12px",
      fontWeight: 800,
      letterSpacing: "-0.035em",
    };
  }
  if (kind.startsWith("callout-")) {
    const c = CALLOUTS[kind.slice(8)] ?? CALLOUTS.definition;
    return {
      margin: "16px 0",
      padding: "13.6px 16px 13.6px 18.4px",
      borderRadius: "14px",
      border: `1px solid var(--m-callout-${c.token}-line)`,
      borderLeft: `4px solid ${c.edge}`,
      background: `var(--m-callout-${c.token}-bg)`,
      fontSize: "16.96px",
      lineHeight: 1.82,
      letterSpacing: "-0.015em",
    };
  }
  return {
    position: "relative",
    margin: "0 0 8.8px",
    paddingLeft: "16.8px",
    fontSize: "16.96px",
    lineHeight: 1.82,
    letterSpacing: "-0.015em",
  };
}

export const NOTE_BODIES: Record<NoteThemeKey, NoteBlock[]> = {
  is: [
    { kind: "h2", text: "Pregled" },
    {
      kind: "p",
      text: "Poslovni informacijski sistemi zbirajo, obdelujejo in posredujejo informacije, ki podpirajo upravljanje in odločanje. Z razvojem od funkcijskih do integriranih rešitev, kot so ERP sistemi, se povečuje učinkovitost in preglednost poslovanja.",
    },
    {
      kind: "callout-definition",
      text: "Integriran sistem hrani podatke v eni bazi, zato pot od dogodka do odločitve traja minute in ne dni.",
    },
    { kind: "h2", text: "Ključni pojmi" },
    { kind: "li", text: "Transakcijski sistemi zajemajo podatke, poslovodski jih povzamejo v poročila." },
    { kind: "li", text: "ERP poveže finance, nabavo, proizvodnjo in kadre v eno bazo." },
    { kind: "li", text: "Prenova procesov pred uvedbo prepreči prenos slabih praks." },
    { kind: "callout-common_mistake", text: "Pozor: informatika v slabem procesu ga le pospeši — najprej prenova, šele nato uvedba." },
    { kind: "h2", text: "Za izpit" },
    {
      kind: "callout-key_takeaway",
      text: "Zapomni si: integriran sistem skrajša pot od dogodka do odločitve, kar je pogosto izpitno vprašanje.",
    },
    { kind: "li", text: "Znaj primerjati funkcijske in integrirane sisteme na primeru." },
  ],
  micro: [
    { kind: "h2", text: "Pregled" },
    {
      kind: "p",
      text: "Cenovna elastičnost povpraševanja pove, za koliko odstotkov se spremeni povpraševana količina, če se cena spremeni za en odstotek. Kadar je koeficient večji od 1, je povpraševanje elastično in dvig cene zniža skupni prihodek.",
    },
    {
      kind: "callout-definition",
      text: "Koeficient elastičnosti = odstotna sprememba količine / odstotna sprememba cene.",
    },
    { kind: "h2", text: "Ključni pojmi" },
    { kind: "li", text: "Več substitutov in daljše obdobje pomenita bolj elastično povpraševanje." },
    { kind: "li", text: "Nujne dobrine so neelastične, luksuzne pa elastične." },
    { kind: "li", text: "Prihodek je največji tam, kjer je elastičnost enaka 1." },
    { kind: "callout-common_mistake", text: "Pozor: premik krivulje ni isto kot premik po krivulji." },
    { kind: "h2", text: "Za izpit" },
    {
      kind: "callout-key_takeaway",
      text: "Zapomni si: nad točko enotske elastičnosti vsak dvig cene skupni prihodek zmanjša.",
    },
    { kind: "li", text: "Znaj izračunati koeficient in razložiti učinek na prihodek." },
  ],
  anatomy: [
    { kind: "h2", text: "Pregled" },
    {
      kind: "p",
      text: "Živčni sistem sprejema, obdeluje in prenaša informacije po telesu. Osnovna enota je nevron, ki dražljaj prevaja po aksonu do sinapse, kjer se signal prenese kemično.",
    },
    {
      kind: "callout-definition",
      text: "Akcijski potencial je odziv po načelu vse ali nič — jakost dražljaja se kodira s frekvenco impulzov.",
    },
    { kind: "h2", text: "Ključni pojmi" },
    { kind: "li", text: "Nevron sestavljajo dendriti, celično telo, akson in sinaptični končiči." },
    { kind: "li", text: "Mielinska ovojnica močno pospeši prevajanje impulza po aksonu." },
    { kind: "li", text: "Refleksni lok teče od receptorja prek hrbtenjače do efektorja." },
    { kind: "callout-common_mistake", text: "Pozor: močnejši dražljaj ne pomeni večjega impulza, ampak pogostejšega." },
    { kind: "h2", text: "Za izpit" },
    {
      kind: "callout-key_takeaway",
      text: "Zapomni si: pot dražljaja od receptorja do odziva je osnova za razlago refleksov.",
    },
    { kind: "li", text: "Znaj narisati refleksni lok in poimenovati vse člene." },
  ],
  stats: [
    { kind: "h2", text: "Pregled" },
    {
      kind: "p",
      text: "Hipotezno testiranje je postopek, s katerim iz vzorca sklepamo o celotni populaciji. Postavimo ničelno hipotezo, izračunamo p-vrednost in jo primerjamo s stopnjo značilnosti, ki jo določimo vnaprej.",
    },
    {
      kind: "callout-definition",
      text: "P-vrednost je verjetnost, da bi ob veljavni ničelni hipotezi dobili tako ali bolj skrajen rezultat.",
    },
    { kind: "h2", text: "Ključni pojmi" },
    { kind: "li", text: "Ničelna hipoteza predpostavlja, da razlike med skupinama ni." },
    { kind: "li", text: "P-vrednost pod stopnjo značilnosti (običajno 0,05) pomeni zavrnitev ničelne hipoteze." },
    { kind: "li", text: "Napaka prve vrste zavrne pravilno hipotezo, napaka druge vrste spregleda pravo razliko." },
    { kind: "callout-common_mistake", text: "Pozor: statistična značilnost ne pove, kako velika ali praktično pomembna je razlika." },
    { kind: "h2", text: "Za izpit" },
    {
      kind: "callout-key_takeaway",
      text: "Zapomni si: sklep je ponovljiv le, če je stopnja značilnosti določena vnaprej.",
    },
    { kind: "li", text: "Znaj izračunati p-vrednost in utemeljiti odločitev o zavrnitvi." },
  ],
};

/*
 * Read-aloud highlighting, matching `.note-read-word` in globals.css exactly:
 * a pale wash behind everything already spoken, a solid marker with a thin ring
 * on the word being read, and its own dark pair for each. The span wraps the
 * word alone — the spaces between words sit outside it, which is what keeps the
 * marks as tight word-shaped chips instead of one ragged band.
 */
const READ_HL = {
  readBg: "#ffedd5",
  readColor: "#7c2d12",
  currentBg: "#fb923c",
  currentColor: "#431407",
  currentRing: "rgba(251, 146, 60, 0.28)",
  darkReadBg: "rgba(251, 146, 60, 0.22)",
  darkReadColor: "#fed7aa",
  darkCurrentBg: "#c2410c",
  darkCurrentColor: "#fff7ed",
  darkCurrentRing: "rgba(251, 146, 60, 0.36)",
};

export type BodyWord = { index: number; text: string };
export type BodyLine = { kind: NoteBlockKind; words: BodyWord[] };

/** Splits a body into words carrying one running index, as the design does. */
export function tokenizeBody(blocks: NoteBlock[]): BodyLine[] {
  let index = 0;
  return blocks.map((block) => ({
    kind: block.kind,
    words: block.text
      .split(/\s+/)
      .filter(Boolean)
      .map((text) => ({ index: index++, text })),
  }));
}

export function readWordStyle(state: "cur" | "read" | "", dark: boolean): CSSProperties {
  const base: CSSProperties = {
    borderRadius: "4.48px",
    padding: "0.48px 1.6px",
    boxDecorationBreak: "clone",
    WebkitBoxDecorationBreak: "clone",
    transition: "background-color 0.12s ease, box-shadow 0.12s ease, color 0.12s ease",
  };
  if (state === "read") {
    return {
      ...base,
      background: dark ? READ_HL.darkReadBg : READ_HL.readBg,
      color: dark ? READ_HL.darkReadColor : READ_HL.readColor,
    };
  }
  if (state === "cur") {
    return {
      ...base,
      background: dark ? READ_HL.darkCurrentBg : READ_HL.currentBg,
      color: dark ? READ_HL.darkCurrentColor : READ_HL.currentColor,
      boxShadow: `0 0 0 1.76px ${dark ? READ_HL.darkCurrentRing : READ_HL.currentRing}`,
    };
  }
  return base;
}

export const INITIAL_NOTES: PreviewNote[] = [
  { id: "n1", emoji: "📊", title: "Poslovni informacijski sistemi – 4. predavanje", source: "audio", date: "28. 8. 2026", status: "ready" },
  { id: "n2", emoji: "📈", title: "Mikroekonomija: elastičnost povpraševanja", source: "pdf", date: "27. 8. 2026", status: "ready" },
  { id: "n3", emoji: "🧠", title: "Anatomija – živčni sistem", source: "audio", date: "26. 8. 2026", status: "ready" },
  { id: "n4", emoji: "⚖️", title: "Članek: Kako deluje ERP", source: "link", date: "24. 8. 2026", status: "ready" },
  { id: "n5", emoji: "🎲", title: "Statistika – hipotezno testiranje", source: "text", date: "20. 8. 2026", status: "ready" },
];

export const FOLDERS: PreviewFolder[] = [
  { id: "f1", name: "Predavanja", icon: "📘", noteIds: ["n1", "n3"] },
  { id: "f2", name: "Izpiti", icon: "🎓", noteIds: ["n2", "n4", "n5"] },
];

export const SOURCE_LABELS: Record<SourceKind, string> = {
  audio: "Zvok",
  pdf: "PDF",
  text: "Besedilo",
  link: "Povezava",
};

/** The percentage a results screen reports, clamped and rounded. */
export function completionPct(done: number, total: number): number {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

export function noteTheme(title: string | undefined | null): NoteThemeKey {
  const t = (title || "").toLowerCase();
  if (/statist|hipotez|p-vrednost|verjetnost/.test(t)) return "stats";
  if (/mikroekon|elasti|povpra|ekonom/.test(t)) return "micro";
  if (/anatom|živč|zivc|nevro/.test(t)) return "anatomy";
  return "is";
}

