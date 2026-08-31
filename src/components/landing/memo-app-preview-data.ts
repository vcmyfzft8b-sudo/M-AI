import type { CSSProperties } from "react";

export type SourceKind = "audio" | "pdf" | "text" | "link";
export type NoteStatus = "uploading" | "queued" | "transcribing" | "generating_notes" | "ready" | "failed";

export type PreviewNote = {
  id: string;
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

export type SheetMode = "record" | "upload" | "text" | "link";

export const QUICK_ACTIONS: Array<{ id: SheetMode; label: string; detail: string; icon: string; accent: string }> = [
  { id: "record", label: "Posnemi predavanje", detail: "Začni z enim dotikom", icon: "🎙️", accent: "record" },
  { id: "upload", label: "Naloži zvok", detail: "MP3, M4A, WAV ali WEBM", icon: "📤", accent: "default" },
  { id: "text", label: "Naloži PDF ali dokument", detail: "Pretvori gradivo v strukturirane zapiske", icon: "📄", accent: "default" },
  { id: "link", label: "Dodaj povezavo", detail: "Spletni članek ali vir", icon: "🔗", accent: "default" },
];

export const SOURCE_MODES: Array<{ id: SheetMode; label: string; icon: string }> = [
  { id: "record", label: "Snemaj", icon: "🎙️" },
  { id: "upload", label: "Naloži", icon: "📤" },
  { id: "text", label: "Dokumenti", icon: "📄" },
  { id: "link", label: "Povezava", icon: "🔗" },
];

export const SHEET_CONTENT: Record<
  SheetMode,
  {
    title: string;
    cardLabel: string;
    cardTitle: string;
    cardMeta: string;
    createIcon: string;
    secondary: string;
    noteTitle: string;
    source: SourceKind;
  }
> = {
  record: {
    title: "Posnemi predavanje",
    cardLabel: "Pripravljen posnetek",
    cardTitle: "posnetek-predavanje-4.m4a",
    cardMeta: "48:12 • posneto v aplikaciji",
    createIcon: "📄",
    secondary: "Posnemi znova",
    noteTitle: "Posneto predavanje – 4. teden",
    source: "audio",
  },
  upload: {
    title: "Naloži zvok",
    cardLabel: "Izbrana datoteka",
    cardTitle: "Predavanje-IS-4.m4a",
    cardMeta: "51,2 MB • 47:38",
    createIcon: "📄",
    secondary: "Izberi drugo datoteko",
    noteTitle: "Predavanje IS – 4. teden",
    source: "audio",
  },
  text: {
    title: "Naloži dokument ali fotografije",
    cardLabel: "Izbran dokument",
    cardTitle: "Poslovni-IS-skripta.pdf",
    cardMeta: "24 strani • 3,1 MB",
    createIcon: "📄",
    secondary: "Izberi drug dokument",
    noteTitle: "Poslovni IS – skripta",
    source: "pdf",
  },
  link: {
    title: "Dodaj povezavo",
    cardLabel: "Povezava",
    cardTitle: "https://www.finance.si/erp-sistemi-v-praksi",
    cardMeta: "Spletni članek • slovenščina",
    createIcon: "📄",
    secondary: "Prilepi drugo povezavo",
    noteTitle: "Članek: ERP sistemi v praksi",
    source: "link",
  },
};

export const SOURCE_VARIANTS: Record<SheetMode, Array<{ cardTitle: string; cardMeta: string; noteTitle: string }>> = {
  record: [
    { cardTitle: "posnetek-predavanje-4.m4a", cardMeta: "48:12 • posneto v aplikaciji", noteTitle: "Posneto predavanje – 4. teden" },
    { cardTitle: "posnetek-vaje-2.m4a", cardMeta: "31:47 • posneto v aplikaciji", noteTitle: "Posnete vaje – 2. teden" },
  ],
  upload: [
    { cardTitle: "Predavanje-IS-4.m4a", cardMeta: "51,2 MB • 47:38", noteTitle: "Predavanje IS – 4. teden" },
    { cardTitle: "Mikroekonomija-5.mp3", cardMeta: "38,6 MB • 36:02", noteTitle: "Mikroekonomija – 5. predavanje" },
  ],
  text: [
    { cardTitle: "Poslovni-IS-skripta.pdf", cardMeta: "24 strani • 3,1 MB", noteTitle: "Poslovni IS – skripta" },
    { cardTitle: "Anatomija-zivcevje.pptx", cardMeta: "42 prosojnic • 8,4 MB", noteTitle: "Anatomija – živčevje" },
  ],
  link: [
    { cardTitle: "https://www.finance.si/erp-sistemi-v-praksi", cardMeta: "Spletni članek • slovenščina", noteTitle: "Članek: ERP sistemi v praksi" },
    { cardTitle: "https://sl.wikipedia.org/wiki/Informacijski_sistem", cardMeta: "Wikipedia • slovenščina", noteTitle: "Wikipedia: Informacijski sistem" },
  ],
};

export const HELP_SECTIONS = [
  {
    title: "Pogosto",
    items: [
      { title: "Družinski paket?", body: "Enega paketa ne moreš deliti med več računov. Vsak študent ima svojo knjižnico zapiskov." },
      { title: "Ali lahko podarim Memo AI?", body: "Da. Kupiš kodo, jo pošlješ prijatelju, on pa jo unovči v nastavitvah." },
      { title: "Ali podpirate moj jezik?", body: "Podpiramo slovenščino, angleščino, nemščino, hrvaščino in še 20 drugih jezikov." },
      { title: "Predlog funkcije", body: "Napiši nam na info@memoai.eu. Predloge študentov uvrstimo v načrt razvoja." },
    ],
  },
  {
    title: "Snemanje in zapiski",
    items: [
      { title: "Video povezava ne deluje", body: "Povezave do videov (YouTube, Drive) niso podprte. Naloži zvok ali dokument." },
      { title: "Ne morem naložiti zvoka", body: "Datoteka mora biti krajša od 3 ur in manjša od 300 MB. Uporabi MP3, M4A, WAV ali WEBM." },
      { title: "Prepis je prekratek ali netočen", body: "Telefon približaj predavatelju in se izogibaj hrupu. Krajše datoteke dajo natančnejši prepis." },
    ],
  },
  {
    title: "Račun in dostop",
    items: [
      { title: "Unovči kodo", body: "Odpri Nastavitve, izberi Unovči kodo in vpiši 8-mestno kodo." },
      { title: "Pogoji uporabe", body: "Memo AI je namenjen osebni študijski uporabi. Gradiva ne deli naprej brez dovoljenja avtorja." },
      { title: "Politika zasebnosti", body: "Posnetki in zapiski so tvoji. Hranimo jih šifrirano, brisanje je takojšnje in trajno." },
    ],
  },
];

export const THEME_OPTIONS = [
  { value: "system", label: "Sistem", icon: "💻" },
  { value: "light", label: "Svetla", icon: "☀️" },
  { value: "dark", label: "Temna", icon: "🌙" },
] as const;

export type PreviewTheme = (typeof THEME_OPTIONS)[number]["value"];

export const LIGHT_TOKENS: Record<string, string> = {
  "--m-canvas": "#e9e9ed",
  "--m-surface": "#ffffff",
  "--m-muted": "#f5f5f7",
  "--m-sheet": "#ffffff",
  "--m-label": "#000000",
  "--m-second": "#66666d",
  "--m-third": "#d2d2d7",
  "--m-sep": "rgba(0,0,0,0.08)",
  "--m-sep-strong": "rgba(0,0,0,0.16)",
  "--m-tint": "#0066cc",
  "--m-tint-soft": "rgba(0,102,204,0.1)",
  "--m-green": "#34c759",
  "--m-green-soft": "rgba(52,199,89,0.12)",
  "--m-red": "#ff3b30",
  "--m-red-soft": "rgba(255,59,48,0.12)",
  "--m-shadow": "0 4px 20px rgba(0,0,0,0.04)",
  "--m-nav": "rgba(255,255,255,0.72)",
  "--m-card-grad": "linear-gradient(180deg, #ffffff, #fafafb)",
  "--m-hl-blue": "rgba(88,140,255,0.32)",
  "--m-hl-orange": "rgba(232,132,52,0.4)",
  "--m-hl-deep": "rgba(226,86,32,0.4)",
  "--m-dock-toggle": "rgba(255,255,255,0.98)",
  "--m-dock-toggle-color": "#000000",
  "--m-tab-active": "linear-gradient(180deg, rgba(255,255,255,0.78), rgba(255,255,255,0.52))",
  "--m-tab-active-shadow": "inset 0 1px 0 rgba(255,255,255,0.58), 0 12px 24px rgba(0,0,0,0.1)",
  "--m-action-card": "#f7f7f9",
  "--m-card-border": "rgba(0,0,0,0.058)",
  "--m-icon-surface": "rgba(255,255,255,0.92)",
};

export const DARK_TOKENS: Record<string, string> = {
  "--m-canvas": "#000000",
  "--m-surface": "#1c1c1e",
  "--m-muted": "#2c2c2e",
  "--m-sheet": "#1c1c1e",
  "--m-label": "#ffffff",
  "--m-second": "#a1a1a8",
  "--m-third": "#636366",
  "--m-sep": "rgba(255,255,255,0.15)",
  "--m-sep-strong": "rgba(255,255,255,0.25)",
  "--m-tint": "#0a84ff",
  "--m-tint-soft": "rgba(10,132,255,0.15)",
  "--m-green": "#32d74b",
  "--m-green-soft": "rgba(50,215,75,0.15)",
  "--m-red": "#ff453a",
  "--m-red-soft": "rgba(255,69,58,0.15)",
  "--m-shadow": "0 8px 30px rgba(0,0,0,0.4)",
  "--m-nav": "rgba(28,28,30,0.72)",
  "--m-card-grad": "linear-gradient(180deg, #1c1c1e, #232325)",
  "--m-hl-blue": "rgba(88,140,255,0.42)",
  "--m-hl-orange": "rgba(232,132,52,0.5)",
  "--m-hl-deep": "rgba(226,86,32,0.55)",
  "--m-dock-toggle": "linear-gradient(135deg, #1b1b1f, #2a2a30)",
  "--m-dock-toggle-color": "#ffffff",
  "--m-tab-active": "linear-gradient(180deg, rgba(54,54,58,0.72), rgba(34,34,38,0.66))",
  "--m-tab-active-shadow": "inset 0 1px 0 rgba(255,255,255,0.03), 0 4px 12px rgba(0,0,0,0.16)",
  "--m-action-card": "#2a2a2c",
  "--m-card-border": "rgba(255,255,255,0.108)",
  "--m-icon-surface": "rgba(28,28,30,0.92)",
};

export const TABS = [
  { id: "notes", label: "Zapiski", icon: "📝" },
  { id: "study", label: "Učenje", icon: "🧠" },
  { id: "chat", label: "Klepet", icon: "💬" },
  { id: "transcript", label: "Prepis", icon: "📜" },
] as const;

export type NoteTab = (typeof TABS)[number]["id"];

export const STUDY_MODES = [
  { id: "flashcards", label: "Flashcards" },
  { id: "quiz", label: "Kviz" },
  { id: "practice_test", label: "Test" },
] as const;

export type StudyMode = (typeof STUDY_MODES)[number]["id"];

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

export type NoteSegment = { text: string; hl?: "orange" | "deep" | "blue" | "underline" | null };

export type NoteBody = {
  overview: NoteSegment[];
  callout: string;
  points: NoteSegment[][];
  why: string;
};

export const NOTE_BODIES: Record<NoteThemeKey, NoteBody> = {
  is: {
    overview: [
      { text: "Poslovni informacijski sistemi (IS)", hl: "orange" },
      { text: "so ključni za zbiranje, obdelavo in posredovanje informacij, ki podpirajo upravljanje in odločanje v podjetjih. Z razvojem od funkcijskih do" },
      { text: "integriranih", hl: "deep" },
      { text: "rešitev, kot so" },
      { text: "ERP sistemi", hl: "blue" },
      { text: ", se povečuje učinkovitost in preglednost poslovanja. Razumevanje poslovnih procesov in njihova prenova, podprta z informatiko," },
      { text: "sta bistvena za konkurenčnost", hl: "underline" },
      { text: "." },
    ],
    callout: "Ključno: Integriran sistem hrani podatke v eni bazi, zato pot od dogodka do odločitve traja minute in ne dni.",
    points: [
      [{ text: "Transakcijski sistemi zajemajo podatke, poslovodski jih povzamejo v poročila." }],
      [{ text: "ERP", hl: "blue" }, { text: "poveže finance, nabavo, proizvodnjo in kadre v eno bazo." }],
      [{ text: "Prenova procesov pred uvedbo prepreči prenos slabih praks." }],
    ],
    why: "Podjetje, ki podatke zbira ročno, izgublja čas in dela napake. Integriran sistem skrajša pot od dogodka do odločitve, kar je pogosto vprašanje na izpitu.",
  },
  micro: {
    overview: [
      { text: "Cenovna elastičnost povpraševanja", hl: "orange" },
      { text: "pove, za koliko odstotkov se spremeni povpraševana količina, če se cena spremeni za en odstotek. Kadar je koeficient večji od 1, je povpraševanje" },
      { text: "elastično", hl: "deep" },
      { text: "in dvig cene zniža skupni prihodek; kadar je manjši od 1, je" },
      { text: "neelastično", hl: "blue" },
      { text: ". Elastičnost je odvisna od števila substitutov, deleža v proračunu in časa," },
      { text: "zato je ključna za odločitve o cenah", hl: "underline" },
      { text: "." },
    ],
    callout: "Ključno: Prihodek je največji tam, kjer je elastičnost enaka 1 — nad to točko vsak dvig cene prihodek zmanjša.",
    points: [
      [{ text: "Koeficient", hl: "blue" }, { text: "= odstotna sprememba količine / odstotna sprememba cene." }],
      [{ text: "Več substitutov in daljše obdobje pomenita bolj elastično povpraševanje." }],
      [{ text: "Nujne dobrine so neelastične, luksuzne pa elastične." }],
    ],
    why: "Podjetje, ki elastičnosti svojih izdelkov ne pozna, napačno postavi ceno in izgubi prihodek. Na izpitu se to preverja z izračunom koeficienta in razlago učinka na prihodek.",
  },
  anatomy: {
    overview: [
      { text: "Živčni sistem", hl: "orange" },
      { text: "sprejema, obdeluje in prenaša informacije po telesu. Osnovna enota je" },
      { text: "nevron", hl: "deep" },
      { text: ", ki dražljaj prevaja po aksonu do" },
      { text: "sinapse", hl: "blue" },
      { text: ", kjer se signal prenese kemično. Delimo ga na osrednji del z možgani in hrbtenjačo ter obkrajni del," },
      { text: "ki povezuje telo z okoljem", hl: "underline" },
      { text: "." },
    ],
    callout: "Ključno: Akcijski potencial je odziv po načelu vse ali nič — jakost dražljaja se kodira s frekvenco impulzov, ne z njihovo velikostjo.",
    points: [
      [{ text: "Nevron sestavljajo dendriti, celično telo, akson in sinaptični končiči." }],
      [{ text: "Mielinska ovojnica", hl: "blue" }, { text: "močno pospeši prevajanje impulza po aksonu." }],
      [{ text: "Refleksni lok teče od receptorja prek hrbtenjače do efektorja." }],
    ],
    why: "Pot dražljaja od receptorja do odziva je osnova za razlago refleksov in bolezni živčevja — tipično izpitno vprašanje.",
  },
  stats: {
    overview: [
      { text: "Hipotezno testiranje", hl: "orange" },
      { text: "je postopek, s katerim iz vzorca sklepamo o celotni populaciji. Postavimo" },
      { text: "ničelno hipotezo", hl: "deep" },
      { text: ", ki trdi, da razlike ni, in ji nasproti alternativno hipotezo. Iz podatkov izračunamo" },
      { text: "p-vrednost", hl: "blue" },
      { text: "in jo primerjamo s stopnjo značilnosti, ki jo določimo vnaprej," },
      { text: "zato je sklep ponovljiv in preverljiv", hl: "underline" },
      { text: "." },
    ],
    callout: "Ključno: Statistična značilnost pove le, da razlika verjetno ni naključna — ne pove, kako velika ali praktično pomembna je.",
    points: [
      [{ text: "Ničelna hipoteza", hl: "blue" }, { text: "predpostavlja, da razlike med skupinama ni." }],
      [{ text: "P-vrednost pod stopnjo značilnosti (običajno 0,05) pomeni zavrnitev ničelne hipoteze." }],
      [{ text: "Napaka prve vrste zavrne pravilno hipotezo, napaka druge vrste spregleda pravo razliko." }],
    ],
    why: "Brez pravilno zastavljene hipoteze in razumevanja p-vrednosti so sklepi iz podatkov lahko napačni. Na izpitu se to preverja z izračunom in razlago odločitve o zavrnitvi.",
  },
};

export const INITIAL_NOTES: PreviewNote[] = [
  { id: "n1", title: "Poslovni informacijski sistemi – 4. predavanje", source: "audio", date: "12. avgust", status: "ready" },
  { id: "n2", title: "Mikroekonomija: elastičnost povpraševanja", source: "pdf", date: "9. avgust", status: "ready" },
  { id: "n3", title: "Anatomija – živčni sistem", source: "audio", date: "7. avgust", status: "ready" },
  { id: "n4", title: "Članek: Kako deluje ERP", source: "link", date: "5. avgust", status: "ready" },
  { id: "n5", title: "Statistika – hipotezno testiranje", source: "text", date: "2. avgust", status: "ready" },
];

export const FOLDERS: PreviewFolder[] = [
  { id: "f1", name: "Poslovni IS", icon: "📘", noteIds: ["n1", "n4"] },
  { id: "f2", name: "Biologija", icon: "🧬", noteIds: ["n3"] },
  { id: "f3", name: "Ekonomija", icon: "📈", noteIds: ["n2", "n5"] },
];

export const SOURCE_META: Record<SourceKind, { icon: string; label: string }> = {
  audio: { icon: "🎙️", label: "Zvok" },
  pdf: { icon: "📄", label: "PDF" },
  text: { icon: "📄", label: "Besedilo" },
  link: { icon: "🔗", label: "Povezava" },
};

export const STATUS_LABELS: Record<NoteStatus, string> = {
  uploading: "Nalaganje",
  queued: "V čakalni vrsti",
  transcribing: "Prepisovanje",
  generating_notes: "Ustvarjanje zapiskov",
  ready: "Pripravljeno",
  failed: "Napaka",
};

export const SEGMENT_BASE: CSSProperties = {
  flex: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "34px",
  border: 0,
  borderRadius: "6px",
  fontSize: "14px",
  fontWeight: 500,
  fontFamily: "inherit",
  cursor: "pointer",
  color: "var(--m-label)",
  transition: "background-color 0.15s ease, box-shadow 0.15s ease",
};

export function completionShell(): CSSProperties {
  return {
    display: "grid",
    gap: "16px",
    alignContent: "space-evenly",
    justifyItems: "center",
    width: "100%",
    minHeight: "462px",
    margin: "auto",
    padding: "34px 14px",
    borderRadius: "16px",
    border: "1px solid var(--m-sep)",
    background:
      "radial-gradient(circle at top, rgba(10,132,255,0.18), transparent 55%), linear-gradient(180deg, var(--m-surface), var(--m-muted))",
    boxShadow: "var(--m-shadow)",
  };
}

export function completionAction(): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "7.2px",
    width: "100%",
    minHeight: "50px",
    padding: "0 18px",
    borderRadius: "999px",
    border: "1px solid var(--m-sep)",
    background: "var(--m-surface)",
    color: "var(--m-label)",
    fontSize: "16px",
    fontWeight: 600,
    fontFamily: "inherit",
    cursor: "pointer",
    transition: "transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease",
  };
}

export function completionBadge(): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    minHeight: "24px",
    padding: "0 10px",
    borderRadius: "999px",
    background: "color-mix(in srgb, var(--m-tint) 16%, var(--m-surface))",
    color: "var(--m-tint)",
    fontSize: "11px",
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
  };
}

export function completionPct(done: number, total: number): number {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

export function ringStyle(pct: number): CSSProperties {
  return {
    position: "relative",
    display: "grid",
    placeItems: "center",
    width: "108px",
    height: "108px",
    padding: "7px",
    borderRadius: "50%",
    background: `conic-gradient(var(--m-tint) ${pct}%, color-mix(in srgb, var(--m-muted) 86%, transparent) ${pct}% 100%)`,
    boxShadow: "inset 0 0 0 1px var(--m-sep), 0 0 36px rgba(10,132,255,0.10)",
    transition: "background 700ms cubic-bezier(0.4,0,0.2,1)",
    flex: "0 0 auto",
  };
}

export function noteTheme(title: string | undefined | null): NoteThemeKey {
  const t = (title || "").toLowerCase();
  if (/statist|hipotez|p-vrednost|verjetnost/.test(t)) return "stats";
  if (/mikroekon|elasti|povpra|ekonom/.test(t)) return "micro";
  if (/anatom|živč|zivc|nevro/.test(t)) return "anatomy";
  return "is";
}

export type SegmentWord = { text: string; hl: NoteSegment["hl"]; space: string };

export function segmentWords(segments: NoteSegment[]): SegmentWord[] {
  const out: SegmentWord[] = [];
  segments.forEach((seg) => {
    (seg.text || "")
      .split(/\s+/)
      .filter(Boolean)
      .forEach((word) => {
        if (out.length && /^[.,;:!?)—]+$/.test(word)) {
          out[out.length - 1].text += word;
          return;
        }
        const glue = out.length === 0 || /^[.,;:!?)—]/.test(word);
        out.push({ text: word, hl: seg.hl || null, space: glue ? "" : " " });
      });
  });
  return out;
}

export function lectureSummary(count: number): string {
  const rest = count % 100;
  if (rest === 1) return `${count} zapisek`;
  if (rest === 2) return `${count} zapiska`;
  if (rest === 3 || rest === 4) return `${count} zapiski`;
  return `${count} zapiskov`;
}
