/**
 * Static study material for the `/creator` demo. Nothing here is generated at
 * runtime: every note, flashcard, quiz question and practice question is
 * authored so UGC recordings always show the same polished content, with no
 * account, no upload and no AI call involved.
 *
 * The markdown follows the same "Structured Plus" shape the real note
 * generator produces (see `@/lib/note-generation`), so the demo renders
 * identically to production notes.
 */

export type DemoDifficulty = "easy" | "medium" | "hard";

export type DemoFlashcard = {
  front: string;
  back: string;
  hint?: string;
  difficulty: DemoDifficulty;
  sectionIdx: number;
};

export type DemoQuizQuestion = {
  prompt: string;
  options: [string, string, string, string];
  correctOptionIdx: number;
  explanation: string;
  difficulty: DemoDifficulty;
};

export type DemoPracticeQuestion = {
  prompt: string;
  answerGuide: string;
  difficulty: DemoDifficulty;
  expectedAnswer: string;
  strengths: string;
  missingPoints: string;
};

export type DemoTranscriptSegment = {
  startMs: number;
  endMs: number;
  speakerLabel: string | null;
  text: string;
};

export type DemoSection = {
  title: string;
  sourceLabel: string;
};

/**
 * A figure inside the note. `afterText` is a distinctive fragment of the block
 * the image sits under — resolved to a real block id at build time, so edits to
 * the markdown can't silently detach an image.
 */
export type DemoNoteImage = {
  file: string;
  fileName: string;
  alt: string;
  afterText: string;
  widthPercent?: number;
};

export type DemoNotePack = {
  key: string;
  title: string;
  sourceType: "audio" | "pdf" | "text" | "link" | "presentation";
  durationSeconds: number | null;
  /** Documents print a page count on the note row, the way the design does. */
  pageCount?: number;
  summary: string;
  keyTopics: string[];
  notesMd: string;
  images: DemoNoteImage[];
  sections: DemoSection[];
  flashcards: DemoFlashcard[];
  quiz: DemoQuizQuestion[];
  practice: DemoPracticeQuestion[];
  transcript: DemoTranscriptSegment[];
  chatAnswers: string[];
};

const MIKROEKONOMIJA: DemoNotePack = {
  key: "mikroekonomija",
  title: "Mikroekonomija – ponudba in povpraševanje",
  sourceType: "audio",
  durationSeconds: 2842,
  summary:
    "Predavanje razloži, kako krivulji ponudbe in povpraševanja določita tržno ravnovesje, kaj premakne celotno krivuljo in kako elastičnost pove, koliko se količina odzove na spremembo cene.",
  keyTopics: [
    "Zakon povpraševanja",
    "Zakon ponudbe",
    "Tržno ravnovesje",
    "Premik krivulje proti premiku po krivulji",
    "Cenovna elastičnost",
  ],
  notesMd: `## Hiter pregled

Trg deluje kot pogajanje med kupci in prodajalci: kupci želijo nizko ceno, prodajalci visoko, cena pa se ustali tam, kjer se želena količina nakupa in prodaje ujameta. Ta točka je tržno ravnovesje. Ko se spremeni katerikoli dejavnik razen cene, se celotna krivulja premakne in nastane novo ravnovesje.

> **Ključno:** Cena ne premakne krivulje – premakne le točko na njej. Krivuljo premaknejo dohodek, cene drugih dobrin, pričakovanja, tehnologija in število udeležencev na trgu.

## Ključne stvari, ki jih moraš znati

- Zakon povpraševanja: ob višji ceni kupci ob nespremenjenih drugih pogojih kupijo manj.
- Zakon ponudbe: ob višji ceni proizvajalci ponudijo več, ker je proizvodnja bolj donosna.
- Ravnovesje je edina cena, pri kateri ni ne presežka ne primanjkljaja.
- Nad ravnovesno ceno nastane presežek ponudbe, pod njo primanjkljaj.
- Premik po krivulji sproži samo sprememba cene; premik krivulje sproži vse ostalo.
- Elastičnost meri občutljivost količine na spremembo cene in odloča, ali podražitev poveča ali zmanjša prihodek.

| Dogodek | Katera krivulja | Smer premika | Učinek na ravnovesno ceno |
| --- | --- | --- | --- |
| Zvišanje dohodka kupcev | Povpraševanje | V desno | Zraste |
| Cenejše surovine | Ponudba | V desno | Pade |
| Nov konkurent na trgu | Ponudba | V desno | Pade |
| Pričakovana prihodnja podražitev | Povpraševanje | V desno | Zraste |

## 1. 📉 Povpraševanje

### Glavna ideja

Povpraševanje pokaže, koliko enot dobrine so kupci pripravljeni in sposobni kupiti pri vsaki ceni v danem obdobju.

### Podrobni zapiski

Krivulja povpraševanja pada, ker vsaka dodatna enota kupcu prinese manj dodatne koristi, hkrati pa višja cena zmanjša realno kupno moč. Pomembno je, da govorimo o načrtovani in ne o dejansko izvedeni nakupni količini.

- **Definicija:** Povpraševana količina je količina pri eni sami ceni, povpraševanje pa celoten odnos med ceno in količino.
- Povpraševanje sestavimo iz individualnih povpraševanj vseh kupcev na trgu.
- Nujne dobrine imajo bolj strmo krivuljo kot razkošne dobrine.

### Ključni pojmi

- **Substituti:** dobrini, ki se med seboj nadomeščata (čaj in kava).
- **Komplementi:** dobrini, ki se uporabljata skupaj (tiskalnik in kartuše).
- **Inferiorna dobrina:** povpraševanje pade, ko dohodek zraste.

## 2. 📈 Ponudba

### Glavna ideja

Ponudba pokaže, koliko enot so proizvajalci pripravljeni prodati pri vsaki ceni.

### Podrobni zapiski

Krivulja ponudbe raste, ker višja cena pokrije višje mejne stroške proizvodnje in v panogo privabi nove ponudnike. Zato se ponudba kratkoročno odziva počasneje kot povpraševanje – zmogljivosti ni mogoče povečati čez noč.

- Stroški dela in surovin premaknejo krivuljo ponudbe navzgor oziroma v levo.
- Boljša tehnologija zniža stroške na enoto in premakne ponudbo v desno.
- Davek na proizvod deluje kot dodaten strošek in zmanjša ponudbo.

## 3. ⚖️ Tržno ravnovesje

### Glavna ideja

Ravnovesje je cena, pri kateri je povpraševana količina enaka ponujeni količini.

### Podrobni zapiski

Če je cena previsoka, ostane blago neprodano in prodajalci znižujejo ceno. Če je cena prenizka, se pojavijo čakalne vrste in prodajalci ceno zvišajo. Trg zato sam pritiska proti ravnovesju, čeprav prilagoditev ni vedno hitra.

> **Pogosta napaka:** Presežek ponudbe ni znak, da so kupci izginili – najpogosteje pomeni le, da je cena nad ravnovesno.

### Primer

Če cena vstopnice za koncert znaša 60 EUR, ravnovesna cena pa je 45 EUR, ostane del dvorane prazen. Organizator zniža ceno, količina prodanih vstopnic pa se poveča po isti krivulji povpraševanja.

## 4. 🔁 Elastičnost

### Glavna ideja

Cenovna elastičnost povpraševanja pove, za koliko odstotkov se spremeni količina, če se cena spremeni za en odstotek.

### Podrobni zapiski

Elastičnost računamo kot razmerje med odstotno spremembo količine in odstotno spremembo cene. Kadar je rezultat po absolutni vrednosti večji od 1, je povpraševanje elastično in podražitev zniža skupni prihodek.

- **Elastično povpraševanje:** veliko substitutov, dolgo časovno obdobje, razkošne dobrine.
- **Neelastično povpraševanje:** malo substitutov, kratek rok, nujne dobrine.
- **Ključno:** prihodek je največji tam, kjer je elastičnost enaka 1.

### Preveri svoje znanje

- Kaj se zgodi z ravnovesno ceno, če se hkrati povečata ponudba in povpraševanje?
- Zakaj cena ne premakne krivulje povpraševanja?
- Kdaj podražitev poveča skupni prihodek podjetja?
- Kateri dejavniki naredijo povpraševanje bolj elastično?

## Končni pregled

- Krivulja povpraševanja pada, krivulja ponudbe raste, presečišče je ravnovesje.
- Sprememba cene pomeni gibanje po krivulji, vse drugo premakne celo krivuljo.
- Presežek ponudbe pritiska ceno navzdol, primanjkljaj navzgor.
- Elastičnost odloča o učinku podražitve na prihodek.
- Najpogostejša napaka na izpitu je zamenjava premika krivulje s premikom po krivulji.`,
  images: [
    {
      file: "ponudba-povprasevanje.svg",
      fileName: "graf-ravnovesje.png",
      alt: "Graf ponudbe in povpraševanja z ravnovesno točko",
      afterText: "Če je cena previsoka, ostane blago neprodano",
    },
    {
      file: "elasticnost.svg",
      fileName: "elasticnost-primerjava.png",
      alt: "Primerjava elastičnega in neelastičnega povpraševanja",
      afterText: "Elastičnost računamo kot razmerje",
    },
  ],
  sections: [
    { title: "Povpraševanje", sourceLabel: "00:00 – 11:20" },
    { title: "Ponudba", sourceLabel: "11:20 – 24:05" },
    { title: "Tržno ravnovesje", sourceLabel: "24:05 – 36:40" },
    { title: "Elastičnost", sourceLabel: "36:40 – 47:22" },
  ],
  flashcards: [
    {
      front: "Kaj pravi zakon povpraševanja?",
      back: "Ob nespremenjenih drugih pogojih kupci ob višji ceni kupijo manjšo količino dobrine.",
      hint: "Cena gor, količina dol.",
      difficulty: "easy",
      sectionIdx: 0,
    },
    {
      front: "Razlika med povpraševanjem in povpraševano količino?",
      back: "Povpraševana količina je ena točka pri eni ceni, povpraševanje pa celoten odnos med ceno in količino, torej cela krivulja.",
      difficulty: "medium",
      sectionIdx: 0,
    },
    {
      front: "Kaj so substituti?",
      back: "Dobrini, ki se med seboj nadomeščata. Podražitev ene poveča povpraševanje po drugi, na primer čaj in kava.",
      difficulty: "easy",
      sectionIdx: 0,
    },
    {
      front: "Zakaj krivulja ponudbe raste?",
      back: "Višja cena pokrije višje mejne stroške in v panogo privabi dodatne ponudnike, zato je smiselno proizvesti več.",
      difficulty: "medium",
      sectionIdx: 1,
    },
    {
      front: "Kako davek na proizvod vpliva na ponudbo?",
      back: "Deluje kot dodaten strošek na enoto, zato krivuljo ponudbe premakne v levo oziroma navzgor.",
      difficulty: "medium",
      sectionIdx: 1,
    },
    {
      front: "Kaj je tržno ravnovesje?",
      back: "Cena, pri kateri je povpraševana količina enaka ponujeni količini, zato ni ne presežka ne primanjkljaja.",
      difficulty: "easy",
      sectionIdx: 2,
    },
    {
      front: "Kaj nastane, če je cena nad ravnovesno?",
      back: "Presežek ponudbe: neprodano blago pritiska ceno navzdol proti ravnovesju.",
      difficulty: "medium",
      sectionIdx: 2,
    },
    {
      front: "Kdaj se premakne cela krivulja povpraševanja?",
      back: "Ob spremembi dohodka, cen substitutov ali komplementov, okusov, pričakovanj ali števila kupcev – nikoli ob spremembi lastne cene.",
      hint: "Vse razen cene.",
      difficulty: "hard",
      sectionIdx: 2,
    },
    {
      front: "Kako izračunamo cenovno elastičnost povpraševanja?",
      back: "Odstotno spremembo količine delimo z odstotno spremembo cene. Absolutna vrednost nad 1 pomeni elastično povpraševanje.",
      difficulty: "hard",
      sectionIdx: 3,
    },
    {
      front: "Kdaj podražitev poveča skupni prihodek?",
      back: "Kadar je povpraševanje neelastično, torej se količina spremeni relativno manj kot cena.",
      difficulty: "hard",
      sectionIdx: 3,
    },
  ],
  quiz: [
    {
      prompt: "Cena kave zraste. Kaj se zgodi na trgu čaja?",
      options: [
        "Povpraševanje po čaju se poveča",
        "Povpraševanje po čaju se zmanjša",
        "Ponudba čaja se zmanjša",
        "Na trgu čaja se nič ne spremeni",
      ],
      correctOptionIdx: 0,
      explanation:
        "Čaj je substitut za kavo, zato del kupcev preide na čaj in krivulja povpraševanja po čaju se premakne v desno.",
      difficulty: "easy",
    },
    {
      prompt: "Kateri dogodek premakne krivuljo ponudbe v desno?",
      options: [
        "Zvišanje cene surovin",
        "Nov davek na proizvod",
        "Cenejša proizvodna tehnologija",
        "Zvišanje cene končnega izdelka",
      ],
      correctOptionIdx: 2,
      explanation:
        "Boljša tehnologija zniža stroške na enoto, zato so proizvajalci pri vsaki ceni pripravljeni ponuditi več.",
      difficulty: "medium",
    },
    {
      prompt: "Cena je pod ravnovesno. Kaj se zgodi?",
      options: [
        "Nastane presežek ponudbe",
        "Nastane primanjkljaj in cena se dvigne",
        "Trg je v ravnovesju",
        "Krivulja povpraševanja se premakne v levo",
      ],
      correctOptionIdx: 1,
      explanation:
        "Pri prenizki ceni kupci želijo več, kot je na voljo. Primanjkljaj pritiska ceno navzgor proti ravnovesju.",
      difficulty: "easy",
    },
    {
      prompt: "Sprememba lastne cene dobrine povzroči:",
      options: [
        "Premik po krivulji povpraševanja",
        "Premik cele krivulje povpraševanja",
        "Premik cele krivulje ponudbe",
        "Spremembo elastičnosti",
      ],
      correctOptionIdx: 0,
      explanation:
        "Cena je na osi grafa, zato njena sprememba pomeni gibanje po obstoječi krivulji, ne njenega premika.",
      difficulty: "medium",
    },
    {
      prompt: "Povpraševanje je elastično, ko je koeficient elastičnosti:",
      options: [
        "Po absolutni vrednosti manjši od 1",
        "Po absolutni vrednosti enak 1",
        "Po absolutni vrednosti večji od 1",
        "Vedno negativen",
      ],
      correctOptionIdx: 2,
      explanation:
        "Absolutna vrednost nad 1 pomeni, da se količina spremeni relativno bolj kot cena.",
      difficulty: "medium",
    },
    {
      prompt: "Podjetje proda nujno dobrino brez substitutov in dvigne ceno. Prihodek bo najverjetneje:",
      options: [
        "Padel, ker bodo kupci odšli",
        "Zrasel, ker je povpraševanje neelastično",
        "Ostal enak",
        "Odvisen samo od ponudbe",
      ],
      correctOptionIdx: 1,
      explanation:
        "Brez substitutov je povpraševanje neelastično, zato se količina zmanjša relativno manj kot zraste cena.",
      difficulty: "hard",
    },
    {
      prompt: "Dohodek kupcev zraste, dobrina pa je inferiorna. Povpraševanje se:",
      options: ["Poveča", "Zmanjša", "Ne spremeni", "Spremeni v ponudbo"],
      correctOptionIdx: 1,
      explanation:
        "Pri inferiornih dobrinah kupci ob višjem dohodku preidejo na kakovostnejše nadomestke.",
      difficulty: "hard",
    },
    {
      prompt: "Hkrati se povečata ponudba in povpraševanje. Kaj zagotovo velja?",
      options: [
        "Cena zagotovo zraste",
        "Cena zagotovo pade",
        "Ravnovesna količina se poveča",
        "Ravnovesna količina se zmanjša",
      ],
      correctOptionIdx: 2,
      explanation:
        "Oba premika povečata količino, učinek na ceno pa je odvisen od tega, kateri premik je močnejši.",
      difficulty: "hard",
    },
  ],
  practice: [
    {
      prompt:
        "Razloži razliko med premikom po krivulji povpraševanja in premikom cele krivulje. Navedi po en primer za vsakega.",
      answerGuide:
        "Premik po krivulji sproži izključno sprememba lastne cene dobrine. Premik cele krivulje sprožijo necenovni dejavniki: dohodek, cene substitutov in komplementov, okusi, pričakovanja in število kupcev.",
      difficulty: "medium",
      expectedAnswer:
        "Sprememba cene = gibanje po krivulji (npr. cena kave pade, kupci kupijo več kave). Sprememba necenovnega dejavnika = premik krivulje (npr. dohodek zraste in celotna krivulja se premakne v desno).",
      strengths: "Jasno ločiš cenovni in necenovni dejavnik.",
      missingPoints: "Dodaj še konkreten primer premika v levo, na primer padec dohodka.",
    },
    {
      prompt:
        "Na trgu nastane presežek ponudbe. Opiši mehanizem, ki trg vrne v ravnovesje.",
      answerGuide:
        "Presežek pomeni ceno nad ravnovesno. Neprodane zaloge silijo prodajalce v znižanje cene, kar poveča povpraševano količino in zmanjša ponujeno količino, dokler se ne izenačita.",
      difficulty: "easy",
      expectedAnswer:
        "Cena je previsoka, zaloge naraščajo, prodajalci znižujejo cene, količina povpraševanja raste in ponudbe pada, dokler ni presežka več.",
      strengths: "Pravilno prepoznaš smer pritiska na ceno.",
      missingPoints: "Omeni, da se gibljemo po obeh krivuljah in ju ne premikamo.",
    },
    {
      prompt:
        "Podjetje razmišlja o 10-odstotni podražitvi. Kaj mora vedeti o elastičnosti, preden se odloči?",
      answerGuide:
        "Če je povpraševanje elastično, bo prihodek padel, saj bo količina padla za več kot 10 odstotkov. Če je neelastično, bo prihodek zrasel. Ključni dejavniki so razpoložljivost substitutov, delež v proračunu kupca in časovno obdobje.",
      difficulty: "hard",
      expectedAnswer:
        "Izračunati mora cenovno elastičnost. Nad 1 pomeni izgubo prihodka, pod 1 pa rast prihodka. Upoštevati mora substitute in dolgoročni odziv kupcev.",
      strengths: "Povežeš elastičnost s prihodkom.",
      missingPoints: "Dodaj, da je dolgoročna elastičnost običajno večja od kratkoročne.",
    },
    {
      prompt:
        "Država uvede davek na proizvod. Razloži učinek na krivuljo ponudbe, ravnovesno ceno in količino.",
      answerGuide:
        "Davek zviša stroške na enoto in premakne ponudbo v levo. Ravnovesna cena za kupca zraste, ravnovesna količina pa pade. Breme davka se porazdeli med kupca in prodajalca glede na elastičnost.",
      difficulty: "medium",
      expectedAnswer:
        "Ponudba se premakne v levo, cena zraste, količina pade, davčno breme pa nosi bolj tista stran trga, ki je bolj neelastična.",
      strengths: "Prepoznaš smer premika ponudbe.",
      missingPoints: "Razloži porazdelitev davčnega bremena glede na elastičnost.",
    },
    {
      prompt: "Zakaj se ponudba kratkoročno odziva počasneje kot povpraševanje?",
      answerGuide:
        "Proizvodne zmogljivosti, pogodbe in surovine so kratkoročno fiksne, zato proizvajalci ne morejo hitro povečati obsega. Kupci pa lahko svoje odločitve spremenijo takoj.",
      difficulty: "medium",
      expectedAnswer:
        "Ker so kapacitete in vhodni viri kratkoročno omejeni, medtem ko kupci nakupno odločitev spremenijo takoj.",
      strengths: "Prepoznaš časovno dimenzijo prilagajanja.",
      missingPoints: "Navedi konkreten primer, na primer gradnjo nove proizvodne linije.",
    },
  ],
  transcript: [
    {
      startMs: 0,
      endMs: 28000,
      speakerLabel: "Predavatelj",
      text: "Dobro jutro. Danes zaključujemo poglavje o trgu, torej ponudbo, povpraševanje in ravnovesje. To je snov, ki jo boste potrebovali na izpitu praktično pri vsaki nalogi.",
    },
    {
      startMs: 28000,
      endMs: 74000,
      speakerLabel: "Predavatelj",
      text: "Začnimo s povpraševanjem. Povpraševanje ni ena sama številka, ampak odnos med ceno in količino. Ko cena raste, povpraševana količina pada. To je zakon povpraševanja.",
    },
    {
      startMs: 74000,
      endMs: 132000,
      speakerLabel: "Predavatelj",
      text: "Pozor na razliko, ki jo študentje najpogosteje zgrešijo. Povpraševana količina je ena točka na krivulji, povpraševanje pa je cela krivulja. Če se spremeni cena, se premaknemo po krivulji.",
    },
    {
      startMs: 132000,
      endMs: 205000,
      speakerLabel: "Predavatelj",
      text: "Krivuljo premaknejo drugi dejavniki: dohodek, cene substitutov in komplementov, okusi, pričakovanja in število kupcev na trgu. Če dohodek zraste, se krivulja premakne v desno.",
    },
    {
      startMs: 205000,
      endMs: 268000,
      speakerLabel: "Študentka",
      text: "Kako pa je pri inferiornih dobrinah? Tam je ravno obratno, kajne?",
    },
    {
      startMs: 268000,
      endMs: 330000,
      speakerLabel: "Predavatelj",
      text: "Točno tako. Pri inferiornih dobrinah višji dohodek zniža povpraševanje, ker kupci preidejo na kakovostnejši nadomestek.",
    },
    {
      startMs: 680000,
      endMs: 742000,
      speakerLabel: "Predavatelj",
      text: "Preidimo na ponudbo. Krivulja ponudbe raste, ker višja cena pokrije višje mejne stroške in privabi nove proizvajalce v panogo.",
    },
    {
      startMs: 742000,
      endMs: 815000,
      speakerLabel: "Predavatelj",
      text: "Ponudbo premaknejo stroški surovin, tehnologija, davki in subvencije. Nova tehnologija zniža stroške na enoto in premakne ponudbo v desno.",
    },
    {
      startMs: 1445000,
      endMs: 1512000,
      speakerLabel: "Predavatelj",
      text: "Ravnovesje je presečišče obeh krivulj. To je edina cena, pri kateri ni presežka in ni primanjkljaja.",
    },
    {
      startMs: 1512000,
      endMs: 1588000,
      speakerLabel: "Predavatelj",
      text: "Če je cena previsoka, ostane blago neprodano, nastane presežek in prodajalci znižajo ceno. Če je prenizka, nastane primanjkljaj in cena se dvigne.",
    },
    {
      startMs: 2200000,
      endMs: 2276000,
      speakerLabel: "Predavatelj",
      text: "Zadnja tema je elastičnost. Elastičnost je odstotna sprememba količine deljena z odstotno spremembo cene.",
    },
    {
      startMs: 2276000,
      endMs: 2360000,
      speakerLabel: "Predavatelj",
      text: "Če je absolutna vrednost večja od ena, je povpraševanje elastično in podražitev zniža prihodek. Če je manjša od ena, podražitev prihodek poveča.",
    },
    {
      startMs: 2360000,
      endMs: 2430000,
      speakerLabel: "Študent",
      text: "Ali to pomeni, da se za nujne dobrine vedno splača dvigniti ceno?",
    },
    {
      startMs: 2430000,
      endMs: 2520000,
      speakerLabel: "Predavatelj",
      text: "Kratkoročno pogosto res, dolgoročno pa kupci najdejo nadomestke, zato je dolgoročna elastičnost skoraj vedno večja od kratkoročne.",
    },
    {
      startMs: 2760000,
      endMs: 2842000,
      speakerLabel: "Predavatelj",
      text: "Za naslednjič preglejte primere od ena do pet. Na izpitu bo zagotovo naloga s premikom krivulje, zato vadite risanje grafov.",
    },
  ],
  chatAnswers: [
    "Na kratko: krivulja povpraševanja pada, ker vsaka dodatna enota kupcu prinese manj koristi, hkrati pa višja cena zmanjša njegovo realno kupno moč. Zato pri višji ceni kupci načrtujejo manjšo količino nakupa.",
    "Razlika je v tem, kaj se premika. Če se spremeni cena dobrine same, se premikaš po obstoječi krivulji. Če se spremeni karkoli drugega – dohodek, cena substituta, pričakovanja – se premakne cela krivulja.",
    "Da, to je klasično izpitno vprašanje. Če je povpraševanje neelastično (koeficient pod 1), podražitev poveča skupni prihodek, ker količina pade relativno manj kot zraste cena. Pri elastičnem povpraševanju je učinek obraten.",
    "Presežek ponudbe pomeni, da je cena nad ravnovesno. Zaloge naraščajo, prodajalci znižujejo ceno, s tem pa se povpraševana količina povečuje in ponujena zmanjšuje, dokler trg ne pride nazaj v ravnovesje.",
  ],
};

const ANATOMIJA: DemoNotePack = {
  key: "anatomija",
  title: "Anatomija – zgradba živčevja",
  sourceType: "pdf",
  durationSeconds: null,
  pageCount: 24,
  summary:
    "Skripta razdeli živčevje na osrednji in obkrajni del, opiše nevron kot osnovno enoto ter razloži, kako akcijski potencial in sinapsa prenašata informacijo po telesu.",
  keyTopics: [
    "Osrednje in obkrajno živčevje",
    "Zgradba nevrona",
    "Akcijski potencial",
    "Sinaptični prenos",
    "Avtonomno živčevje",
  ],
  notesMd: `## Hiter pregled

Živčevje je informacijski sistem telesa: sprejema dražljaje, jih obdela in sproži odziv. Anatomsko ga delimo na osrednje živčevje, ki obdeluje informacije, in obkrajno živčevje, ki jih prenaša med telesom in možgani. Osnovna funkcionalna enota je nevron, ki informacijo prenaša elektrokemično.

> **Ključno:** Električni signal potuje znotraj nevrona, med nevroni pa se prenos vedno prevede v kemični signal preko sinapse.

## Ključne stvari, ki jih moraš znati

- Osrednje živčevje sestavljata možgani in hrbtenjača.
- Obkrajno živčevje sestavljajo živci in gangliji zunaj osrednjega živčevja.
- Nevron ima dendrite, telo, akson in končne gumbke.
- Mielinska ovojnica pospeši prevajanje s skokovitim prevajanjem med Ranvierjevimi zožitvami.
- Akcijski potencial je odziv po pravilu vse ali nič.
- Avtonomno živčevje delimo na simpatično in parasimpatično vejo z nasprotnima učinkoma.

| Del živčevja | Glavna naloga | Značilna struktura |
| --- | --- | --- |
| Osrednje | Obdelava in shranjevanje informacij | Možganska skorja, hrbtenjača |
| Somatsko | Zavestno gibanje in zaznava | Motorična in senzorična vlakna |
| Simpatično | Aktivacija, boj ali beg | Prevladuje noradrenalin |
| Parasimpatično | Umirjanje, prebava in obnova | Prevladuje acetilholin |

## 1. 🧠 Delitev živčevja

### Glavna ideja

Živčevje delimo funkcionalno na osrednji obdelovalni del in obkrajni prenosni del.

### Podrobni zapiski

Možgani in hrbtenjača tvorita osrednje živčevje, zaščiteno s kostjo, možganskimi ovojnicami in likvorjem. Obkrajno živčevje sestavljajo živci, ki povezujejo osrednji del z organi, mišicami in kožo.

- Somatski del nadzoruje zavestne gibe skeletnih mišic.
- Avtonomni del uravnava organe brez zavestnega nadzora.
- Hrbtenjača ni le kabel: sama izvede refleksni lok brez posredovanja možganov.

### Ključni pojmi

- **Ganglij:** skupek živčnih celic zunaj osrednjega živčevja.
- **Jedro:** skupek živčnih celic znotraj osrednjega živčevja.
- **Refleksni lok:** najkrajša pot od receptorja do efektorja.

## 2. 🔬 Nevron

### Glavna ideja

Nevron je celica, specializirana za sprejem, prevajanje in oddajo električnega signala.

### Podrobni zapiski

Dendriti sprejemajo signale, telo jih sešteje, akson pa prevaja akcijski potencial do končnih gumbkov. Mielinska ovojnica deluje kot izolator, zaradi česar signal preskakuje med Ranvierjevimi zožitvami in potuje bistveno hitreje.

- **Definicija:** Aksonski grič je mesto, kjer se odloči, ali bo akcijski potencial sprožen.
- Glia celice nevrona hranijo, podpirajo in tvorijo mielin.
- Debelejši in bolj mieliniziran akson prevaja hitreje.

## 3. ⚡ Akcijski potencial

### Glavna ideja

Akcijski potencial je hiter obrat membranske napetosti, ki se brez slabljenja širi po aksonu.

### Podrobni zapiski

V mirovanju je notranjost celice negativna. Ko dražljaj doseže prag, se odprejo natrijevi kanalčki, natrij vdre v celico in nastane depolarizacija. Sledi izstop kalija oziroma repolarizacija, nato kratka refraktorna doba.

> **Pogosta napaka:** Močnejši dražljaj ne naredi večjega akcijskega potenciala – poveča le frekvenco proženja.

### Proces

- Dražljaj doseže prag vzdraženosti.
- Natrijevi kanalčki se odprejo, sledi depolarizacija.
- Kalijevi kanalčki se odprejo, sledi repolarizacija.
- Natrij-kalijeva črpalka obnovi mirovni potencial.

## 4. 🔗 Sinapsa

### Glavna ideja

Sinapsa je stik med nevronoma, kjer se električni signal prevede v kemičnega.

### Podrobni zapiski

Ko akcijski potencial doseže končni gumbek, se odprejo kalcijevi kanalčki. Vezikli z nevrotransmiterjem se zlijejo z membrano in sprostijo prenašalec v sinaptično špranjo, kjer se veže na receptorje naslednje celice.

- Vzdražujoči prenašalci povečajo verjetnost novega akcijskega potenciala.
- Zaviralni prenašalci to verjetnost zmanjšajo.
- Prenašalec se po delovanju razgradi ali vrne v presinaptično celico.

### Preveri svoje znanje

- Katere strukture sestavljajo osrednje živčevje?
- Zakaj mielin pospeši prevajanje?
- Kaj pomeni pravilo vse ali nič?
- Kako se signal prenese med dvema nevronoma?

## Končni pregled

- Osrednje živčevje obdeluje, obkrajno prenaša informacije.
- Nevron sestavljajo dendriti, telo, akson in končni gumbki.
- Akcijski potencial deluje po pravilu vse ali nič, moč dražljaja kodira frekvenca.
- Mielin omogoča skokovito in hitrejše prevajanje.
- Sinapsa prevede električni signal v kemičnega in nazaj.`,
  images: [
    {
      file: "nevron.svg",
      fileName: "shema-nevrona.png",
      alt: "Zgradba nevrona z dendriti, telesom, aksonom in končnimi gumbki",
      afterText: "Dendriti sprejemajo signale, telo jih sešteje",
    },
    {
      file: "akcijski-potencial.svg",
      fileName: "akcijski-potencial.png",
      alt: "Potek akcijskega potenciala v času",
      afterText: "V mirovanju je notranjost celice negativna",
    },
  ],
  sections: [
    { title: "Delitev živčevja", sourceLabel: "str. 3–7" },
    { title: "Zgradba nevrona", sourceLabel: "str. 8–12" },
    { title: "Akcijski potencial", sourceLabel: "str. 13–18" },
    { title: "Sinaptični prenos", sourceLabel: "str. 19–24" },
  ],
  flashcards: [
    {
      front: "Kaj sestavlja osrednje živčevje?",
      back: "Možgani in hrbtenjača, zaščiteni s kostjo, možganskimi ovojnicami in likvorjem.",
      difficulty: "easy",
      sectionIdx: 0,
    },
    {
      front: "Razlika med ganglijem in jedrom?",
      back: "Ganglij je skupek živčnih celic zunaj osrednjega živčevja, jedro pa znotraj njega.",
      difficulty: "hard",
      sectionIdx: 0,
    },
    {
      front: "Kaj je refleksni lok?",
      back: "Najkrajša živčna pot od receptorja preko hrbtenjače do efektorja, brez posredovanja možganov.",
      difficulty: "medium",
      sectionIdx: 0,
    },
    {
      front: "Naštej glavne dele nevrona.",
      back: "Dendriti, celično telo, akson in končni gumbki.",
      hint: "Od sprejema do oddaje signala.",
      difficulty: "easy",
      sectionIdx: 1,
    },
    {
      front: "Zakaj mielinska ovojnica pospeši prevajanje?",
      back: "Deluje kot izolator, zato signal preskakuje med Ranvierjevimi zožitvami – to je skokovito prevajanje.",
      difficulty: "medium",
      sectionIdx: 1,
    },
    {
      front: "Kaj se dogaja na aksonskem griču?",
      back: "Tam se seštejejo vhodni signali in odloči, ali bo prag presežen in akcijski potencial sprožen.",
      difficulty: "hard",
      sectionIdx: 1,
    },
    {
      front: "Kaj pomeni pravilo vse ali nič?",
      back: "Akcijski potencial se ali sproži v polni velikosti ali pa sploh ne. Moč dražljaja se kodira s frekvenco proženja.",
      difficulty: "medium",
      sectionIdx: 2,
    },
    {
      front: "Kateri ion povzroči depolarizacijo?",
      back: "Natrij, ki ob odprtju napetostno odvisnih kanalčkov vdre v celico.",
      difficulty: "easy",
      sectionIdx: 2,
    },
    {
      front: "Kaj je refraktorna doba?",
      back: "Kratko obdobje po akcijskem potencialu, ko nevron ni vzdražen, kar zagotovi enosmerno širjenje signala.",
      difficulty: "hard",
      sectionIdx: 2,
    },
    {
      front: "Kako poteka prenos čez sinapso?",
      back: "Akcijski potencial sproži vstop kalcija, vezikli sprostijo nevrotransmiter v špranjo, ta pa se veže na receptorje naslednje celice.",
      difficulty: "medium",
      sectionIdx: 3,
    },
  ],
  quiz: [
    {
      prompt: "Kateri par tvori osrednje živčevje?",
      options: [
        "Možgani in hrbtenjača",
        "Možgani in obkrajni živci",
        "Hrbtenjača in gangliji",
        "Živci in receptorji",
      ],
      correctOptionIdx: 0,
      explanation: "Osrednje živčevje po definiciji sestavljata možgani in hrbtenjača.",
      difficulty: "easy",
    },
    {
      prompt: "Kaj omogoča skokovito prevajanje signala?",
      options: [
        "Debelina dendritov",
        "Mielinska ovojnica z Ranvierjevimi zožitvami",
        "Število sinaps",
        "Velikost celičnega telesa",
      ],
      correctOptionIdx: 1,
      explanation:
        "Mielin izolira akson, zato se depolarizacija zgodi samo v zožitvah in signal preskakuje.",
      difficulty: "medium",
    },
    {
      prompt: "Močnejši dražljaj povzroči:",
      options: [
        "Večji akcijski potencial",
        "Daljši akcijski potencial",
        "Višjo frekvenco akcijskih potencialov",
        "Počasnejše prevajanje",
      ],
      correctOptionIdx: 2,
      explanation:
        "Zaradi pravila vse ali nič se moč dražljaja kodira s frekvenco in ne z amplitudo.",
      difficulty: "medium",
    },
    {
      prompt: "Kateri ion je odgovoren za repolarizacijo?",
      options: ["Natrij", "Kalij", "Kalcij", "Klor"],
      correctOptionIdx: 1,
      explanation: "Po depolarizaciji kalij zapusti celico in membranska napetost se vrne navzdol.",
      difficulty: "medium",
    },
    {
      prompt: "Kaj sproži sproščanje nevrotransmiterja v sinaptično špranjo?",
      options: [
        "Vstop kalcija v končni gumbek",
        "Izstop kalija iz dendrita",
        "Zaprtje natrijevih kanalčkov",
        "Delovanje mielina",
      ],
      correctOptionIdx: 0,
      explanation:
        "Akcijski potencial odpre kalcijeve kanalčke, kalcij pa sproži zlitje veziklov z membrano.",
      difficulty: "hard",
    },
    {
      prompt: "Parasimpatično živčevje predvsem:",
      options: [
        "Pripravi telo na boj ali beg",
        "Pospeši srčni utrip",
        "Umirja telo in spodbuja prebavo",
        "Nadzoruje zavestno gibanje",
      ],
      correctOptionIdx: 2,
      explanation: "Parasimpatikus prevladuje v mirovanju in podpira prebavo ter obnovo.",
      difficulty: "easy",
    },
    {
      prompt: "Skupek živčnih celic zunaj osrednjega živčevja imenujemo:",
      options: ["Jedro", "Ganglij", "Sinapsa", "Ovojnica"],
      correctOptionIdx: 1,
      explanation: "Zunaj osrednjega živčevja je to ganglij, znotraj pa jedro.",
      difficulty: "hard",
    },
  ],
  practice: [
    {
      prompt: "Opiši pot signala od dendrita do naslednje celice.",
      answerGuide:
        "Dendriti sprejmejo signal, telo ga sešteje, na aksonskem griču se ob preseženem pragu sproži akcijski potencial, ta potuje po aksonu do končnih gumbkov, kjer se sprosti nevrotransmiter v sinaptično špranjo.",
      difficulty: "medium",
      expectedAnswer:
        "Dendrit → celično telo → aksonski grič → akson → končni gumbek → sinaptična špranja → receptorji naslednje celice.",
      strengths: "Zaporedje struktur je pravilno.",
      missingPoints: "Omeni še vlogo kalcija pri sproščanju veziklov.",
    },
    {
      prompt: "Razloži pravilo vse ali nič in povej, kako telo kodira moč dražljaja.",
      answerGuide:
        "Akcijski potencial se sproži v polni velikosti ali pa sploh ne. Močnejši dražljaj poveča frekvenco proženja in število vzdraženih nevronov, ne pa amplitude signala.",
      difficulty: "medium",
      expectedAnswer:
        "Amplituda je vedno enaka; moč dražljaja se kodira s frekvenco akcijskih potencialov in številom aktiviranih vlaken.",
      strengths: "Pravilno navedeš, da amplituda ostane enaka.",
      missingPoints: "Dodaj vlogo praga vzdraženosti.",
    },
    {
      prompt: "Primerjaj simpatično in parasimpatično živčevje.",
      answerGuide:
        "Simpatikus pripravi telo na napor: pospeši srčni utrip, razširi bronhije, zavre prebavo. Parasimpatikus deluje nasprotno in prevladuje v mirovanju. Glavna prenašalca sta noradrenalin in acetilholin.",
      difficulty: "easy",
      expectedAnswer:
        "Simpatikus = aktivacija (boj ali beg, noradrenalin), parasimpatikus = umirjanje in prebava (acetilholin).",
      strengths: "Nasprotujoča si učinka sta jasno predstavljena.",
      missingPoints: "Navedi vsaj en konkreten organ in učinek na njem.",
    },
    {
      prompt: "Zakaj je refraktorna doba pomembna za pravilno delovanje živčevja?",
      answerGuide:
        "Med refraktorno dobo nevron ni vzdražen, zato se akcijski potencial ne more vrniti nazaj po aksonu. To zagotovi enosmerno prevajanje in omeji največjo frekvenco proženja.",
      difficulty: "hard",
      expectedAnswer:
        "Zagotavlja enosmerno širjenje signala in omejuje frekvenco akcijskih potencialov.",
      strengths: "Prepoznaš zaščitno vlogo refraktorne dobe.",
      missingPoints: "Loči absolutno in relativno refraktorno dobo.",
    },
  ],
  transcript: [],
  chatAnswers: [
    "Mielinska ovojnica deluje kot izolator, zato se depolarizacija zgodi le v Ranvierjevih zožitvah. Signal tako dobesedno preskakuje od zožitve do zožitve, kar imenujemo skokovito prevajanje in je bistveno hitrejše od zveznega.",
    "Pravilo vse ali nič pomeni, da akcijski potencial ali nastane v polni velikosti ali pa ga sploh ni. Zato močnejši dražljaj ne poveča amplitude, ampak frekvenco proženja in število aktiviranih vlaken.",
    "Ganglij in jedro sta oba skupka živčnih celičnih teles – razlika je samo v legi. Ganglij leži zunaj osrednjega živčevja, jedro pa znotraj njega. To je pogosto izpitno vprašanje.",
    "Prenos čez sinapso poteka takole: akcijski potencial doseže končni gumbek, odprejo se kalcijevi kanalčki, kalcij sproži zlitje veziklov z membrano, nevrotransmiter se sprosti v špranjo in se veže na receptorje naslednje celice.",
  ],
};

const ERP_CLANEK: DemoNotePack = {
  key: "erp",
  title: "Članek: ERP sistemi v praksi",
  sourceType: "link",
  durationSeconds: null,
  summary:
    "Članek pojasni, kaj je ERP sistem, katere module podjetja uvajajo najprej, zakaj uvedbe pogosto presežejo proračun in kateri kazalniki pokažejo, ali se je naložba izplačala.",
  keyTopics: [
    "Definicija ERP sistema",
    "Ključni moduli",
    "Potek uvedbe",
    "Najpogostejši razlogi za neuspeh",
    "Merjenje donosnosti",
  ],
  notesMd: `## Hiter pregled

ERP je enoten informacijski sistem, ki poslovne procese različnih oddelkov poveže v skupno bazo podatkov. Namesto ločenih programov za finance, nabavo in proizvodnjo vsi delajo z istimi podatki v realnem času. Največji izziv uvedbe ni tehnologija, ampak sprememba delovnih navad.

> **Ključno:** Vrednost ERP sistema ne nastane ob namestitvi, ampak takrat, ko podjetje svoje procese prilagodi sistemu namesto obratno.

## Ključne stvari, ki jih moraš znati

- ERP pomeni Enterprise Resource Planning, torej načrtovanje virov podjetja.
- Osnova sistema je ena sama skupna podatkovna baza za vse module.
- Najpogosteje se najprej uvedeta finančni in nabavni modul.
- Prilagajanje standardne rešitve je glavni vir stroškovnih preseganj.
- Uspeh uvedbe je bolj odvisen od podpore vodstva in izobraževanja kot od izbire ponudnika.

| Modul | Kaj pokriva | Tipična korist |
| --- | --- | --- |
| Finance | Glavna knjiga, terjatve, obveznosti | Hitrejše zaključevanje obdobij |
| Nabava | Naročila, dobavitelji, zaloge | Nižje zaloge in boljši pogoji |
| Proizvodnja | Delovni nalogi, kosovnice | Krajši dobavni roki |
| Kadri | Evidenca, plače, odsotnosti | Manj ročnega dela |

## 1. 🏢 Kaj je ERP sistem

### Glavna ideja

ERP je celovita programska rešitev, ki poslovne procese podjetja poveže okoli ene skupne baze podatkov.

### Podrobni zapiski

Pred ERP so oddelki uporabljali ločene programe, podatke pa so prenašali ročno ali s poročili. Zaradi tega so nastajale razlike med oddelki. ERP to odpravi tako, da se vsak dogodek zapiše enkrat in je takoj viden vsem.

- **Definicija:** Modul je funkcionalno zaokrožen del sistema za določeno področje poslovanja.
- Sistem je le tako dober, kot so kakovostni vneseni podatki.
- Sodobne rešitve so vse pogosteje v oblaku, kar zniža vstopni strošek.

## 2. 🧩 Uvedba po fazah

### Glavna ideja

Uvedba poteka v fazah, saj hkraten prehod vseh oddelkov močno poveča tveganje.

### Podrobni zapiski

Podjetja običajno začnejo s finančnim modulom, ker so tam procesi najbolj standardizirani. Sledijo nabava, prodaja in šele nato proizvodnja, ki je najbolj specifična za panogo.

### Proces

- Analiza obstoječih procesov in popis zahtev.
- Izbira ponudnika in določitev obsega projekta.
- Konfiguracija, migracija podatkov in testiranje.
- Izobraževanje uporabnikov in produkcijski zagon.
- Stabilizacija ter postopno dodajanje modulov.

## 3. ⚠️ Zakaj uvedbe spodletijo

### Glavna ideja

Večina neuspešnih projektov propade zaradi organizacijskih in ne tehničnih razlogov.

### Podrobni zapiski

Najpogostejši vzroki so nejasen obseg projekta, pretirano prilagajanje standardne rešitve, slaba kakovost prenesenih podatkov in premalo izobraževanja. Vsaka prilagoditev poveča tudi stroške vsake prihodnje nadgradnje.

> **Pogosta napaka:** Podjetje prenese star, neučinkovit proces v nov sistem in nato ugotovi, da se ni nič izboljšalo.

## 4. 📊 Merjenje donosnosti

### Glavna ideja

Donosnost merimo s poslovnimi kazalniki pred uvedbo in po njej, ne z občutkom uporabnikov.

### Podrobni zapiski

Najpogosteje spremljajo čas zaključevanja meseca, obrat zalog, delež zamujenih dobav in število ročnih popravkov. Realen učinek se običajno pokaže šele po nekaj mesecih stabilizacije.

### Preveri svoje znanje

- Kaj je glavna prednost skupne podatkovne baze?
- Zakaj se uvedba običajno začne s finančnim modulom?
- Kateri so trije najpogostejši razlogi za neuspeh?
- Kako izmerimo, ali se je naložba izplačala?

## Končni pregled

- ERP poveže oddelke okoli ene same baze podatkov.
- Uvedba naj poteka po fazah, začenši z najbolj standardiziranimi procesi.
- Prekomerno prilagajanje je glavni vir preseganja proračuna.
- Kakovost podatkov in izobraževanje odločata o uspehu.
- Donosnost dokazujejo merljivi kazalniki pred uvedbo in po njej.`,
  images: [
    {
      file: "erp-moduli.svg",
      fileName: "erp-moduli.png",
      alt: "Moduli ERP sistema okoli skupne podatkovne baze",
      afterText: "Pred ERP so oddelki uporabljali ločene programe",
    },
    {
      file: "erp-uvedba.svg",
      fileName: "faze-uvedbe.png",
      alt: "Faze uvedbe ERP sistema",
      afterText: "Podjetja običajno začnejo s finančnim modulom",
    },
  ],
  sections: [
    { title: "Kaj je ERP sistem", sourceLabel: "1. del članka" },
    { title: "Uvedba po fazah", sourceLabel: "2. del članka" },
    { title: "Razlogi za neuspeh", sourceLabel: "3. del članka" },
    { title: "Merjenje donosnosti", sourceLabel: "4. del članka" },
  ],
  flashcards: [
    {
      front: "Kaj pomeni kratica ERP?",
      back: "Enterprise Resource Planning – načrtovanje virov podjetja.",
      difficulty: "easy",
      sectionIdx: 0,
    },
    {
      front: "Kaj je glavna tehnična prednost ERP sistema?",
      back: "Ena skupna podatkovna baza, zato se vsak podatek vnese enkrat in je takoj viden vsem oddelkom.",
      difficulty: "easy",
      sectionIdx: 0,
    },
    {
      front: "Kaj je modul v ERP sistemu?",
      back: "Funkcionalno zaokrožen del sistema, ki pokriva eno poslovno področje, na primer finance ali nabavo.",
      difficulty: "medium",
      sectionIdx: 0,
    },
    {
      front: "S katerim modulom se uvedba običajno začne in zakaj?",
      back: "S finančnim, ker so finančni procesi najbolj standardizirani in najmanj odvisni od panoge.",
      difficulty: "medium",
      sectionIdx: 1,
    },
    {
      front: "Naštej faze uvedbe ERP sistema.",
      back: "Analiza procesov, izbira ponudnika, konfiguracija in migracija podatkov, testiranje, izobraževanje, zagon in stabilizacija.",
      difficulty: "hard",
      sectionIdx: 1,
    },
    {
      front: "Zakaj je prekomerno prilagajanje sistema nevarno?",
      back: "Poveča stroške projekta in podraži vsako prihodnjo nadgradnjo, saj je treba prilagoditve vsakič znova preveriti.",
      difficulty: "hard",
      sectionIdx: 2,
    },
    {
      front: "Kateri so najpogostejši razlogi za neuspeh uvedbe?",
      back: "Nejasen obseg projekta, prekomerno prilagajanje, slaba kakovost podatkov in premalo izobraževanja uporabnikov.",
      difficulty: "medium",
      sectionIdx: 2,
    },
    {
      front: "S katerimi kazalniki merimo donosnost ERP sistema?",
      back: "Čas zaključevanja meseca, obrat zalog, delež zamujenih dobav in število ročnih popravkov.",
      difficulty: "medium",
      sectionIdx: 3,
    },
  ],
  quiz: [
    {
      prompt: "Kaj je osnovna značilnost ERP sistema?",
      options: [
        "Vsak oddelek ima svojo bazo podatkov",
        "Vsi moduli delijo eno skupno bazo podatkov",
        "Sistem deluje samo brez povezave",
        "Namenjen je izključno računovodstvu",
      ],
      correctOptionIdx: 1,
      explanation:
        "Skupna baza podatkov je bistvo ERP sistema in odpravlja neskladja med oddelki.",
      difficulty: "easy",
    },
    {
      prompt: "Kateri modul podjetja običajno uvedejo prvega?",
      options: ["Proizvodnja", "Kadri", "Finance", "Vzdrževanje"],
      correctOptionIdx: 2,
      explanation:
        "Finančni procesi so najbolj standardizirani, zato je tveganje uvedbe najmanjše.",
      difficulty: "medium",
    },
    {
      prompt: "Kaj je najpogostejši vzrok za preseganje proračuna?",
      options: [
        "Prekomerno prilagajanje standardne rešitve",
        "Premajhno število uporabnikov",
        "Uporaba oblačne rešitve",
        "Prehiter zagon proizvodnje",
      ],
      correctOptionIdx: 0,
      explanation:
        "Vsaka prilagoditev podraži projekt in vse prihodnje nadgradnje sistema.",
      difficulty: "medium",
    },
    {
      prompt: "Zakaj je kakovost podatkov ključna pri migraciji?",
      options: [
        "Ker sistem brez podatkov ne deluje",
        "Ker napačni podatki v novem sistemu ustvarijo napačne odločitve",
        "Ker migracija zahteva več strežnikov",
        "Ker se podatki po migraciji izbrišejo",
      ],
      correctOptionIdx: 1,
      explanation:
        "Nov sistem ne popravi slabih podatkov, ampak jih le hitreje razširi po podjetju.",
      difficulty: "hard",
    },
    {
      prompt: "Kateri kazalnik najbolje pokaže učinek ERP na zaloge?",
      options: [
        "Število uporabnikov sistema",
        "Obrat zalog",
        "Število modulov",
        "Trajanje izobraževanja",
      ],
      correctOptionIdx: 1,
      explanation: "Obrat zalog neposredno meri, kako učinkovito podjetje upravlja zaloge.",
      difficulty: "medium",
    },
    {
      prompt: "Kdaj se realni učinki uvedbe običajno pokažejo?",
      options: [
        "Takoj ob zagonu",
        "Po nekaj mesecih stabilizacije",
        "Šele po zamenjavi ponudnika",
        "Nikoli jih ni mogoče izmeriti",
      ],
      correctOptionIdx: 1,
      explanation:
        "Po zagonu sledi obdobje stabilizacije, ko se uporabniki privadijo novim procesom.",
      difficulty: "easy",
    },
  ],
  practice: [
    {
      prompt: "Pojasni, zakaj je skupna podatkovna baza glavna prednost ERP sistema.",
      answerGuide:
        "Podatek se vnese enkrat in je takoj na voljo vsem oddelkom, kar odpravi podvajanje, ročne prenose in neskladja med poročili različnih oddelkov.",
      difficulty: "easy",
      expectedAnswer:
        "En vnos, en vir resnice, ni ročnih prenosov med sistemi in ni razhajanj med oddelki.",
      strengths: "Prepoznaš odpravo podvajanja podatkov.",
      missingPoints: "Dodaj konkreten primer, na primer skupen zapis o zalogi.",
    },
    {
      prompt: "Opiši faze uvedbe ERP sistema in razloži, zakaj je fazni pristop varnejši.",
      answerGuide:
        "Analiza, izbira ponudnika, konfiguracija in migracija, testiranje, izobraževanje, zagon in stabilizacija. Fazni pristop omeji obseg tveganja in omogoča učenje na manjšem delu sistema.",
      difficulty: "medium",
      expectedAnswer:
        "Faze si sledijo od analize do stabilizacije; postopnost zmanjša tveganje hkratnega izpada vseh procesov.",
      strengths: "Faze so navedene v pravilnem vrstnem redu.",
      missingPoints: "Razloži, zakaj je proizvodni modul običajno zadnji.",
    },
    {
      prompt: "Podjetje po enem letu ne vidi koristi ERP sistema. Kaj bi preveril najprej?",
      answerGuide:
        "Ali so procesi ostali nespremenjeni, ali je bilo izobraževanje zadostno, kakšna je kakovost migriranih podatkov in ali sploh merijo prave kazalnike pred uvedbo in po njej.",
      difficulty: "hard",
      expectedAnswer:
        "Preveril bi spremembo procesov, izobraževanje, kakovost podatkov in obstoj izhodiščnih meritev.",
      strengths: "Iščeš organizacijske in ne le tehnične vzroke.",
      missingPoints: "Omeni tudi obseg prilagoditev standardne rešitve.",
    },
    {
      prompt: "Kako bi izmeril donosnost naložbe v ERP sistem?",
      answerGuide:
        "S primerjavo merljivih kazalnikov pred uvedbo in po njej: čas zaključevanja meseca, obrat zalog, delež zamujenih dobav in obseg ročnih popravkov, ob upoštevanju skupnih stroškov lastništva.",
      difficulty: "medium",
      expectedAnswer:
        "Postavim izhodiščne meritve, jih po stabilizaciji ponovim in primerjam s skupnimi stroški projekta.",
      strengths: "Poudariš izhodiščno meritev pred uvedbo.",
      missingPoints: "Vključi še stroške vzdrževanja in licenc.",
    },
  ],
  transcript: [],
  chatAnswers: [
    "Glavna prednost je ena sama skupna baza podatkov. Podatek se vnese enkrat in je takoj viden vsem oddelkom, zato ni ročnih prenosov, podvajanja ali razhajanj med poročili financ in nabave.",
    "Podjetja začnejo s finančnim modulom, ker so finančni procesi najbolj standardizirani in najmanj odvisni od panoge. Proizvodni modul pride zadnji, ker je najbolj specifičen.",
    "Najpogostejši razlogi za neuspeh so organizacijski: nejasen obseg projekta, prekomerno prilagajanje standardne rešitve, slaba kakovost migriranih podatkov in premalo izobraževanja uporabnikov.",
    "Donosnost izmeriš tako, da pred uvedbo posnameš izhodiščne kazalnike – čas zaključevanja meseca, obrat zalog, delež zamujenih dobav – in jih po nekaj mesecih stabilizacije ponovno izmeriš.",
  ],
};

const ZGODOVINA: DemoNotePack = {
  key: "zgodovina",
  title: "Zgodovina – francoska revolucija",
  sourceType: "text",
  durationSeconds: null,
  summary:
    "Zapiski povzamejo vzroke francoske revolucije, potek od sklica generalnih stanov do Napoleonovega prevzema oblasti ter dolgoročne posledice za Evropo.",
  keyTopics: [
    "Vzroki revolucije",
    "Generalni stani in narodna skupščina",
    "Deklaracija o pravicah",
    "Jakobinska diktatura",
    "Posledice za Evropo",
  ],
  notesMd: `## Hiter pregled

Francoska revolucija se je začela kot finančna kriza absolutistične monarhije in prerasla v temeljit prelom s starim družbenim redom. V desetih letih je Francija prešla od stanovske družbe do republike, nato pa v Napoleonovo diktaturo. Ideje enakosti pred zakonom so se kljub temu razširile po vsej Evropi.

> **Ključno:** Revolucija ni izbruhnila zaradi ene same krivice, ampak zaradi sovpadanja državnega bankrota, slabe letine in stanovskega sistema, ki je davčno breme nalagal tistim z najmanj pravicami.

## Ključne stvari, ki jih moraš znati

- Francoska družba je bila razdeljena na tri stanove, davke pa je plačeval predvsem tretji stan.
- Državna blagajna je bila izčrpana zaradi vojn in dvornih stroškov.
- Sklic generalnih stanov leta 1789 je sprožil politični spor o načinu glasovanja.
- Deklaracija o pravicah človeka in državljana je uvedla enakost pred zakonom.
- Revolucija se je končala z Napoleonovim državnim udarom leta 1799.

| Obdobje | Ključni dogodek | Posledica |
| --- | --- | --- |
| 1789 | Sklic generalnih stanov, zavzetje Bastilje | Konec absolutizma |
| 1791 | Prva ustava | Ustavna monarhija |
| 1793–1794 | Jakobinska diktatura | Teror in množične usmrtitve |
| 1799 | Napoleonov državni udar | Konec revolucije |

## 1. 🔥 Vzroki

### Glavna ideja

Revolucijo je sprožilo sovpadanje finančnega zloma države in globokih socialnih neenakosti.

### Podrobni zapiski

Prva dva stanova, duhovščina in plemstvo, sta bila davkov večinoma oproščena, čeprav sta imela največ premoženja. Tretji stan je obsegal več kot devetdeset odstotkov prebivalstva in nosil skoraj celotno davčno breme. Slaba letina leta 1788 je dvignila ceno kruha do meje, ki je za mestno prebivalstvo pomenila lakoto.

- **Definicija:** Stanovska družba je red, v katerem so pravice določene z rojstvom in ne z zaslugami.
- Razsvetljenske ideje so ponudile jezik za kritiko absolutizma.
- Podpora ameriški revoluciji je državno blagajno dokončno izčrpala.

## 2. 🏛️ Od generalnih stanov do republike

### Glavna ideja

Spor o načinu glasovanja je tretji stan pripeljal do razglasitve narodne skupščine.

### Podrobni zapiski

Kralj je maja 1789 sklical generalne stane, da bi potrdili nove davke. Ker je vsak stan imel en glas, bi bil tretji stan vedno preglasovan. Junija se je razglasil za narodno skupščino in v prisegi v žogarnici obljubil, da se ne razide, dokler Francija ne dobi ustave.

### Proces

- Maj 1789: sklic generalnih stanov v Versaillesu.
- Junij 1789: razglasitev narodne skupščine in prisega v žogarnici.
- Julij 1789: zavzetje Bastilje kot simbolni konec absolutizma.
- Avgust 1789: Deklaracija o pravicah človeka in državljana.
- September 1792: razglasitev republike.

## 3. ⚔️ Jakobinska diktatura

### Glavna ideja

Vojna in notranji upori so pripeljali do izrednega režima, ki je nasprotnike odstranjeval s smrtnimi obsodbami.

### Podrobni zapiski

Odbor za javno blaginjo pod Robespierrom je uvedel splošno mobilizacijo, cenovne omejitve in revolucionarna sodišča. Teror je bil predstavljen kot začasno sredstvo za rešitev republike, a je zajel tudi same revolucionarje.

> **Pogosta napaka:** Teror ni bil program celotne revolucije, ampak odziv posebnega obdobja vojne in notranje krize.

## 4. 🌍 Posledice

### Glavna ideja

Revolucija je odpravila fevdalne privilegije in razširila načelo enakosti pred zakonom po Evropi.

### Podrobni zapiski

Napoleonovi pohodi so kodeks in upravne reforme prenesli v zasedena ozemlja. Stari red je bil po letu 1815 delno obnovljen, vendar se je ideja o narodni suverenosti ohranila in v 19. stoletju sprožila nova gibanja.

### Preveri svoje znanje

- Zakaj je bil davčni sistem pred revolucijo nevzdržen?
- Kaj je pomenila prisega v žogarnici?
- Kateri dokument je uvedel enakost pred zakonom?
- Zakaj se je revolucija končala z diktaturo?

## Končni pregled

- Vzroki so bili finančni, socialni in idejni hkrati.
- Zavzetje Bastilje je simbolni, ne pa dejanski konec absolutizma.
- Deklaracija iz leta 1789 je temelj modernih pravic državljana.
- Teror je bil odziv na vojno stanje in ne cilj revolucije.
- Dediščina revolucije je ideja enakosti pred zakonom in narodne suverenosti.`,
  images: [
    {
      file: "revolucija-casovnica.svg",
      fileName: "casovnica-1789-1799.png",
      alt: "Časovnica francoske revolucije od 1789 do 1799",
      afterText: "Kralj je maja 1789 sklical generalne stane",
    },
  ],
  sections: [
    { title: "Vzroki revolucije", sourceLabel: "1. sklop" },
    { title: "Od stanov do republike", sourceLabel: "2. sklop" },
    { title: "Jakobinska diktatura", sourceLabel: "3. sklop" },
    { title: "Posledice", sourceLabel: "4. sklop" },
  ],
  flashcards: [
    {
      front: "Kako je bila razdeljena francoska družba pred revolucijo?",
      back: "Na tri stanove: duhovščino, plemstvo in tretji stan, ki je obsegal več kot 90 odstotkov prebivalstva.",
      difficulty: "easy",
      sectionIdx: 0,
    },
    {
      front: "Zakaj je bil davčni sistem nevzdržen?",
      back: "Prva dva stanova sta bila večinoma oproščena davkov, breme pa je nosil tretji stan z najmanj pravicami.",
      difficulty: "medium",
      sectionIdx: 0,
    },
    {
      front: "Kaj je bila prisega v žogarnici?",
      back: "Obljuba poslancev narodne skupščine leta 1789, da se ne razidejo, dokler Francija ne dobi ustave.",
      difficulty: "medium",
      sectionIdx: 1,
    },
    {
      front: "Kaj simbolizira zavzetje Bastilje?",
      back: "Simbolni padec absolutistične oblasti in začetek revolucije; 14. julij je še danes državni praznik.",
      difficulty: "easy",
      sectionIdx: 1,
    },
    {
      front: "Kaj je uvedla Deklaracija o pravicah človeka in državljana?",
      back: "Enakost pred zakonom, svobodo govora in vere ter načelo, da oblast izhaja iz naroda.",
      difficulty: "medium",
      sectionIdx: 1,
    },
    {
      front: "Kdo je vodil odbor za javno blaginjo?",
      back: "Maximilien Robespierre, v obdobju jakobinske diktature 1793–1794.",
      difficulty: "hard",
      sectionIdx: 2,
    },
    {
      front: "Zakaj je prišlo do terorja?",
      back: "Zaradi zunanje vojne in notranjih uporov je režim uvedel izredne ukrepe in revolucionarna sodišča.",
      difficulty: "hard",
      sectionIdx: 2,
    },
    {
      front: "Kdaj in kako se je revolucija končala?",
      back: "Leta 1799 z Napoleonovim državnim udarom, ki je republiko preoblikoval v osebno oblast.",
      difficulty: "medium",
      sectionIdx: 3,
    },
  ],
  quiz: [
    {
      prompt: "Kateri stan je nosil največje davčno breme?",
      options: ["Duhovščina", "Plemstvo", "Tretji stan", "Vsi enako"],
      correctOptionIdx: 2,
      explanation:
        "Prva dva stanova sta bila večinoma oproščena davkov, zato je breme padlo na tretji stan.",
      difficulty: "easy",
    },
    {
      prompt: "Kaj je bil neposredni povod za sklic generalnih stanov?",
      options: [
        "Zmaga v vojni",
        "Finančna kriza države",
        "Smrt kralja",
        "Odkritje novih ozemelj",
      ],
      correctOptionIdx: 1,
      explanation: "Kralj je potreboval potrditev novih davkov, ker je bila blagajna izčrpana.",
      difficulty: "medium",
    },
    {
      prompt: "Kateri dogodek velja za simbolni začetek revolucije?",
      options: [
        "Prisega v žogarnici",
        "Zavzetje Bastilje",
        "Razglasitev republike",
        "Napoleonov udar",
      ],
      correctOptionIdx: 1,
      explanation: "Zavzetje Bastilje 14. julija 1789 je simbolni padec absolutizma.",
      difficulty: "easy",
    },
    {
      prompt: "Kaj je določala Deklaracija o pravicah človeka in državljana?",
      options: [
        "Vrnitev fevdalnih privilegijev",
        "Enakost pred zakonom in narodno suverenost",
        "Obvezno vojaško službo",
        "Ukinitev zasebne lastnine",
      ],
      correctOptionIdx: 1,
      explanation:
        "Deklaracija je uvedla enakost pred zakonom in načelo, da oblast izhaja iz naroda.",
      difficulty: "medium",
    },
    {
      prompt: "Jakobinska diktatura je bila predvsem odziv na:",
      options: [
        "Gospodarsko rast",
        "Zunanjo vojno in notranje upore",
        "Vrnitev kralja na prestol",
        "Ustanovitev kolonij",
      ],
      correctOptionIdx: 1,
      explanation: "Izredni ukrepi so bili utemeljeni z vojnim stanjem in notranjimi upori.",
      difficulty: "hard",
    },
    {
      prompt: "Kaj je najbolj trajna dediščina revolucije?",
      options: [
        "Obnova stanovske družbe",
        "Ideja enakosti pred zakonom in narodne suverenosti",
        "Ukinitev vojske",
        "Vrnitev absolutizma",
      ],
      correctOptionIdx: 1,
      explanation:
        "Kljub restavraciji po letu 1815 sta se ideji enakosti in narodne suverenosti ohranili.",
      difficulty: "medium",
    },
  ],
  practice: [
    {
      prompt: "Naštej in pojasni tri glavne vzroke francoske revolucije.",
      answerGuide:
        "Finančni zlom države zaradi vojn in dvornih stroškov, socialna neenakost stanovske družbe z davčnimi privilegiji ter razsvetljenske ideje, ki so ponudile jezik za kritiko absolutizma. Slaba letina leta 1788 je delovala kot sprožilec.",
      difficulty: "medium",
      expectedAnswer:
        "Finančna kriza, stanovska neenakost in razsvetljenske ideje, ob sprožilcu v obliki draginje kruha.",
      strengths: "Ločiš dolgoročne vzroke od neposrednega povoda.",
      missingPoints: "Dodaj vlogo podpore ameriški revoluciji pri izčrpanju blagajne.",
    },
    {
      prompt: "Razloži, zakaj je spor o glasovanju v generalnih stanovih vodil v prelom.",
      answerGuide:
        "Glasovalo se je po stanovih, zato bi bil tretji stan vedno preglasovan z dva proti ena kljub temu, da je predstavljal veliko večino prebivalstva. Zahteva po glasovanju po glavah je bila zavrnjena, zato se je tretji stan razglasil za narodno skupščino.",
      difficulty: "hard",
      expectedAnswer:
        "Glasovanje po stanovih je tretji stan vedno postavilo v manjšino, zato se je osamosvojil v narodno skupščino.",
      strengths: "Prepoznaš mehanizem preglasovanja.",
      missingPoints: "Omeni prisego v žogarnici kot točko brez vrnitve.",
    },
    {
      prompt: "Zakaj se je revolucija, ki se je začela z zahtevo po svobodi, končala z diktaturo?",
      answerGuide:
        "Vojna, notranji upori in gospodarska kriza so vodili v izredne ukrepe in teror. Po padcu Robespierra je nastala politična nestabilnost, ki jo je s podporo vojske izkoristil Napoleon.",
      difficulty: "hard",
      expectedAnswer:
        "Zaradi vojnega stanja, terorja in kasnejše nestabilnosti direktorija, ki jo je izkoristila vojska.",
      strengths: "Povežeš zunanjo ogroženost z notranjo radikalizacijo.",
      missingPoints: "Dodaj vlogo vojske kot nosilke reda po letu 1795.",
    },
    {
      prompt: "Kakšne so bile posledice revolucije za preostalo Evropo?",
      answerGuide:
        "Napoleonovi pohodi so razširili civilni zakonik in upravne reforme, odpravili fevdalne ostanke ter spodbudili narodna gibanja. Po letu 1815 je bil stari red delno obnovljen, ideje pa so ostale žive.",
      difficulty: "medium",
      expectedAnswer:
        "Širjenje civilnega zakonika in enakosti pred zakonom, odprava fevdalnih ostankov in vzpon narodnih gibanj.",
      strengths: "Prepoznaš prenos idej z vojaškimi pohodi.",
      missingPoints: "Omeni Dunajski kongres in poskus restavracije.",
    },
  ],
  transcript: [],
  chatAnswers: [
    "Glavni vzroki so bili trije in so delovali hkrati: državni bankrot po dragih vojnah, stanovska družba z davčnimi privilegiji za prva dva stanova, in razsvetljenske ideje, ki so ponudile jezik za kritiko absolutizma. Draginja kruha leta 1788 je bila sprožilec.",
    "V generalnih stanovih je vsak stan imel en glas, zato bi bil tretji stan vedno preglasovan z dva proti ena – čeprav je predstavljal več kot 90 odstotkov prebivalstva. Zato se je junija 1789 razglasil za narodno skupščino.",
    "Teror je bil odziv na izredne razmere: Francija je bila v vojni z zavezništvom evropskih monarhij in se soočala z notranjimi upori. Odbor za javno blaginjo je izredne ukrepe upravičeval z rešitvijo republike.",
    "Deklaracija o pravicah človeka in državljana iz avgusta 1789 je uvedla enakost pred zakonom, svobodo govora in vere ter načelo, da oblast izhaja iz naroda in ne od kralja.",
  ],
};

export const DEMO_NOTE_PACKS: DemoNotePack[] = [
  MIKROEKONOMIJA,
  ANATOMIJA,
  ERP_CLANEK,
  ZGODOVINA,
];

export function getDemoNotePack(key: string) {
  return DEMO_NOTE_PACKS.find((pack) => pack.key === key) ?? DEMO_NOTE_PACKS[0];
}

/**
 * Notes the demo library starts with. `daysAgo` keeps the list dates looking
 * lived-in without ever depending on a build timestamp.
 */
export const DEMO_SEED_NOTES: Array<{
  id: string;
  packKey: string;
  daysAgo: number;
}> = [
  { id: "demo-note-mikroekonomija", packKey: "mikroekonomija", daysAgo: 1 },
  { id: "demo-note-anatomija", packKey: "anatomija", daysAgo: 3 },
  { id: "demo-note-erp", packKey: "erp", daysAgo: 6 },
  { id: "demo-note-zgodovina", packKey: "zgodovina", daysAgo: 11 },
];

export const DEMO_SEED_FOLDERS: Array<{
  id: string;
  name: string;
  noteIds: string[];
}> = [
  {
    id: "demo-folder-izpiti",
    name: "Izpitni rok",
    noteIds: ["demo-note-mikroekonomija", "demo-note-anatomija"],
  },
  {
    id: "demo-folder-seminarska",
    name: "Seminarska naloga",
    noteIds: ["demo-note-erp"],
  },
];

/**
 * Which pack a newly created demo note gets, by the source the creator picked.
 * Titles stay tied to the content so a recording never shows a note whose title
 * and body disagree.
 */
export const DEMO_CREATE_PACKS: Record<
  "record" | "upload" | "text" | "pdf" | "photo" | "link",
  string[]
> = {
  record: ["mikroekonomija"],
  upload: ["mikroekonomija"],
  text: ["zgodovina"],
  pdf: ["anatomija"],
  photo: ["anatomija"],
  link: ["erp"],
};
