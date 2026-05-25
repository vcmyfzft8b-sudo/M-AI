import { SEO_BRAND_NAME, SEO_SITE_URL } from "@/lib/brand";

export type SeoPublicPage = {
  slug: string;
  title: string;
  description: string;
  h1: string;
  eyebrow: string;
  intro: string;
  primaryKeyword: string;
  searchTerms: string[];
  useCases: string[];
  inputs: string[];
  outputs: string[];
  consentNote: string;
  ctaLabel: string;
};

export const SEO_LAST_MODIFIED = "2026-05-25";

export const SEO_PUBLIC_PAGES: SeoPublicPage[] = [
  {
    slug: "ai-zapiski",
    title: "AI zapiski predavanj za dijake in študente",
    description:
      "Memo AI iz predavanj, PDF-jev in dokumentov ustvari urejene AI zapiske, prepise, flashcarde, kvize in AI chat za učenje.",
    h1: "AI zapiski predavanj v slovenščini",
    eyebrow: "AI zapiski",
    intro:
      "Memo AI pomaga, ko želiš iz predavanja hitro dobiti uporabne zapiske za učenje. Naloži posnetek, PDF, dokument, povezavo ali besedilo, Memo pa pripravi strukturiran zapis, povzetek in vaje za ponavljanje.",
    primaryKeyword: "AI zapiski",
    searchTerms: ["AI zapiski", "AI zapiski predavanj", "AI notetaker", "zapiski z umetno inteligenco"],
    useCases: [
      "urejanje dolgih predavanj v jasne zapiske",
      "hitro ponavljanje pred kolokvijem ali izpitom",
      "pretvorba gradiva v flashcarde, kvize in testna vprašanja",
    ],
    inputs: ["audio posnetki predavanj", "PDF gradiva", "DOCX dokumenti", "spletne povezave", "prilepljeno besedilo"],
    outputs: ["urejeni zapiski", "prepisi", "povzetki", "flashcardi", "kvizi", "AI chat z gradivom"],
    consentNote:
      "Pred snemanjem ali nalaganjem predavanja preveri, da imaš dovoljenje šole, predavatelja ali drugih udeležencev, kadar je to potrebno.",
    ctaLabel: "Ustvari AI zapiske",
  },
  {
    slug: "zapiski-predavanj",
    title: "Zapiski predavanj brez ročnega prepisovanja",
    description:
      "Aplikacija za zapiske predavanj, ki iz posnetkov, PDF-jev in besedila pripravi pregledne zapiske, povzetke in vaje za učenje.",
    h1: "Zapiski predavanj, pripravljeni za učenje",
    eyebrow: "Zapiski predavanj",
    intro:
      "Namesto da po predavanju ure in ure prepisuješ snov, lahko gradivo naložiš v Memo AI. Aplikacija pripravi zapiske, ki jih lahko takoj bereš, poslušaš, sprašuješ in pretvoriš v učne kartice.",
    primaryKeyword: "zapiski predavanj",
    searchTerms: ["zapiski predavanj", "aplikacija za zapiske", "zapiski za faks", "zapiski za učenje"],
    useCases: [
      "ko predavatelj govori hitreje, kot lahko pišeš",
      "ko imaš PDF prosojnice in želiš bolj berljive zapiske",
      "ko želiš iz iste snovi dobiti še vprašanja za ponavljanje",
    ],
    inputs: ["posnetki predavanj", "prosojnice v PDF-ju", "dokumenti", "zapisi iz učilnice", "linki do javnih gradiv"],
    outputs: ["strukturirani zapiski", "ključni pojmi", "povzetki poglavij", "kartice za učenje", "testi"],
    consentNote:
      "Memo je namenjen gradivu, ki ga smeš uporabljati. Če snemaš predavanje, najprej preveri pravila svoje šole ali fakultete.",
    ctaLabel: "Začni z zapiski",
  },
  {
    slug: "prepis-predavanj",
    title: "Prepis predavanj in urejeni zapiski iz zvoka",
    description:
      "Pretvori audio posnetek predavanja v prepis, povzetek, zapiske, flashcarde in kviz za hitrejše učenje.",
    h1: "Prepis predavanj iz audio posnetka",
    eyebrow: "Prepis predavanj",
    intro:
      "Če imaš zvočni posnetek predavanja, ga Memo AI pretvori v prepis in nato v bolj uporabno učno gradivo. Tako lahko najprej preveriš, kaj je bilo povedano, potem pa iz tega ponavljaš snov.",
    primaryKeyword: "prepis predavanj",
    searchTerms: ["prepis predavanj", "transkripcija predavanj", "audio v zapiske", "prepis zvoka"],
    useCases: [
      "prepis daljšega predavanja v berljivo besedilo",
      "iskanje pomembnih delov v posnetku",
      "priprava povzetka, kartic in kviza iz prepisa",
    ],
    inputs: ["MP3", "M4A", "WAV", "OGG", "WEBM", "posnetki iz telefona"],
    outputs: ["prepis zvoka", "urejeni zapiski", "povzetek snovi", "vprašanja za preverjanje", "AI klepet"],
    consentNote:
      "Zvok naloži samo, če imaš pravico uporabljati posnetek in če snemanje ne krši pravil predavanja ali zasebnosti drugih oseb.",
    ctaLabel: "Prepiši predavanje",
  },
  {
    slug: "povzetek-pdf",
    title: "Povzetek PDF gradiva z AI",
    description:
      "Naloži PDF, skripto ali dokument in Memo AI pripravi povzetek, zapiske, ključne pojme, flashcarde in kvize za učenje.",
    h1: "Povzetek PDF gradiva za hitrejše učenje",
    eyebrow: "Povzetek PDF",
    intro:
      "Dolgi PDF-ji, skripte in prosojnice so pogosto težki za hitro ponavljanje. Memo AI iz gradiva izlušči strukturo, ključne pojme in vprašanja, da se lahko lažje pripraviš na preverjanje znanja.",
    primaryKeyword: "povzetek PDF",
    searchTerms: ["povzetek PDF", "povzemanje PDF z AI", "AI povzetek skripte", "PDF v zapiske"],
    useCases: [
      "povzemanje skript in prosojnic",
      "izpis ključnih pojmov iz daljšega dokumenta",
      "ustvarjanje učnih vprašanj iz PDF gradiva",
    ],
    inputs: ["PDF skripte", "prosojnice", "študijski dokumenti", "prilepljeno besedilo", "javni spletni članki"],
    outputs: ["povzetek", "zapiski", "ključni pojmi", "flashcardi", "kvizi", "testi"],
    consentNote:
      "Nalagaj samo dokumente, ki jih smeš uporabljati v osebne učne namene ali za katere imaš ustrezna dovoljenja.",
    ctaLabel: "Povzemi PDF",
  },
  {
    slug: "flashcardi",
    title: "Flashcardi in kartice za učenje iz zapiskov",
    description:
      "Memo AI iz zapiskov in predavanj ustvari flashcarde oziroma kartice za učenje, da hitreje ponoviš ključne pojme.",
    h1: "Flashcardi iz tvojih zapiskov",
    eyebrow: "Flashcardi",
    intro:
      "Kartice za učenje so najbolj uporabne, ko nastanejo iz snovi, ki jo dejansko potrebuješ. Memo AI iz predavanja ali dokumenta izbere pomembne pojme in jih spremeni v flashcarde za ponavljanje.",
    primaryKeyword: "flashcardi",
    searchTerms: ["flashcardi", "kartice za učenje", "AI flashcards", "učne kartice"],
    useCases: [
      "ponavljanje definicij in ključnih pojmov",
      "hitro preverjanje pred izpitom",
      "učenje iz lastnih predavanj, ne iz generičnih vprašanj",
    ],
    inputs: ["zapiski", "prepisi predavanj", "PDF-ji", "dokumenti", "besedilo"],
    outputs: ["flashcardi", "vprašanja in odgovori", "pojmi za ponavljanje", "kvizi", "testna vprašanja"],
    consentNote:
      "Flashcarde ustvarjaj iz gradiva, ki ga smeš obdelovati in uporabljati za svoje učenje.",
    ctaLabel: "Ustvari flashcarde",
  },
  {
    slug: "kvizi-iz-zapiskov",
    title: "Kvizi iz zapiskov za pripravo na izpit",
    description:
      "Iz zapiskov, PDF-jev in predavanj ustvari kvize, teste in vprašanja za preverjanje znanja z Memo AI.",
    h1: "Kvizi iz zapiskov in predavanj",
    eyebrow: "Kvizi iz zapiskov",
    intro:
      "Branje zapiskov ni vedno dovolj. Memo AI iz tvoje snovi pripravi kvize in daljša testna vprašanja, da lahko preveriš razumevanje še pred pravim preverjanjem.",
    primaryKeyword: "kvizi iz zapiskov",
    searchTerms: ["kvizi iz zapiskov", "testi za učenje", "AI kviz", "vprašanja za izpit"],
    useCases: [
      "preverjanje, kaj res razumeš",
      "vaja pred kolokvijem, maturo ali izpitom",
      "ustvarjanje vprašanj iz lastnih predavanj in PDF-jev",
    ],
    inputs: ["zapiski", "prepisi", "PDF gradiva", "dokumenti", "učna besedila"],
    outputs: ["kvizi", "testi", "vprašanja s kratkimi odgovori", "razlage odgovorov", "AI chat z gradivom"],
    consentNote:
      "Vprašanja naj služijo kot pomoč pri učenju. Odgovore vedno preveri pri uradnem gradivu, kadar gre za ocenjevanje ali pomembne odločitve.",
    ctaLabel: "Ustvari kviz",
  },
  {
    slug: "ucenje",
    title: "Učenje z AI za dijake in študente",
    description:
      "Memo AI pomaga pri učenju iz predavanj, PDF-jev in zapiskov z urejenimi povzetki, flashcardi, kvizi, testi in AI klepetom.",
    h1: "Učenje z AI iz tvojega gradiva",
    eyebrow: "Učenje",
    intro:
      "Ko imaš veliko snovi in malo časa, Memo AI pomaga gradivo spremeniti v bolj jasen sistem za učenje. Iz posnetkov, PDF-jev in zapiskov pripravi povzetke, kartice, kvize in vprašanja za ponavljanje.",
    primaryKeyword: "učenje",
    searchTerms: ["učenje", "učenje z AI", "učenje za izpit", "aplikacija za učenje"],
    useCases: [
      "ko želiš snov najprej razumeti in potem vaditi",
      "ko imaš več virov za isti predmet",
      "ko potrebuješ vprašanja za aktivno ponavljanje",
    ],
    inputs: ["predavanja", "PDF skripte", "zapiski", "dokumenti", "besedilo"],
    outputs: ["povzetki", "urejeni zapiski", "flashcardi", "kvizi", "testi", "AI chat"],
    consentNote:
      "Za učenje uporabljaj gradivo, ki ga smeš obdelovati, in rezultate preveri pri uradnih virih pred pomembnim preverjanjem.",
    ctaLabel: "Začni učenje",
  },
  {
    slug: "aplikacija-za-ucenje",
    title: "Aplikacija za učenje iz zapiskov in predavanj",
    description:
      "Aplikacija za učenje, ki iz tvojega gradiva pripravi zapiske, povzetke, flashcarde, kvize, teste in AI chat.",
    h1: "Aplikacija za učenje iz tvoje snovi",
    eyebrow: "Aplikacija za učenje",
    intro:
      "Memo AI združi zapiske, prepise, povzetke in vaje v enem prostoru. Namesto ločenih orodij za zapiske, kartice in kvize lahko iz istega gradiva pripraviš celoten učni tok.",
    primaryKeyword: "aplikacija za učenje",
    searchTerms: ["aplikacija za učenje", "učna aplikacija", "aplikacija za študente", "AI aplikacija za učenje"],
    useCases: [
      "urejanje gradiva za več predmetov",
      "ponavljanje s karticami in kvizi",
      "iskanje odgovorov v lastnih zapiskih",
    ],
    inputs: ["audio", "PDF", "DOCX", "spletne povezave", "prilepljeno besedilo"],
    outputs: ["zapiski", "prepisi", "povzetki", "učne kartice", "kvizi", "AI pomočnik"],
    consentNote:
      "Aplikacija je namenjena osebnemu učenju iz gradiva, ki ga lahko zakonito uporabljaš.",
    ctaLabel: "Preizkusi aplikacijo",
  },
  {
    slug: "ai-ucenje",
    title: "AI učenje iz predavanj, PDF-jev in zapiskov",
    description:
      "Uporabi AI za učenje: Memo AI iz gradiva ustvari zapiske, povzetke, flashcarde, kvize in odgovore na vprašanja.",
    h1: "AI učenje, ki začne pri tvoji snovi",
    eyebrow: "AI učenje",
    intro:
      "AI je najbolj uporaben za učenje, ko dela z dejanskim gradivom predmeta. Memo AI prebere ali prepiše tvoje vire in jih spremeni v zapiske, vprašanja in vaje.",
    primaryKeyword: "AI učenje",
    searchTerms: ["AI učenje", "umetna inteligenca za učenje", "AI za študente", "AI pomoč pri učenju"],
    useCases: [
      "razlaga snovi iz lastnih zapiskov",
      "ustvarjanje vprašanj za preverjanje znanja",
      "hitro povzemanje dolgih gradiv",
    ],
    inputs: ["zapiski", "prepisi", "PDF-ji", "dokumenti", "predavanja"],
    outputs: ["AI povzetki", "AI zapiski", "AI kvizi", "flashcardi", "AI chat z gradivom"],
    consentNote:
      "AI lahko naredi napake, zato odgovore pred izpiti in nalogami preveri z uradnim gradivom.",
    ctaLabel: "Preizkusi AI učenje",
  },
  {
    slug: "ucenje-za-izpit",
    title: "Učenje za izpit z zapiski, kvizi in flashcardi",
    description:
      "Pripravi se na izpit z AI zapiski, povzetki, flashcardi, kvizi in testnimi vprašanji iz svojega gradiva.",
    h1: "Učenje za izpit iz lastnih zapiskov",
    eyebrow: "Učenje za izpit",
    intro:
      "Pred izpitom ni dovolj samo prebrati zapiskov. Memo AI iz snovi pripravi povzetke, kartice in vprašanja, da lahko aktivno preverjaš, kaj že znaš in kaj moraš še ponoviti.",
    primaryKeyword: "učenje za izpit",
    searchTerms: ["učenje za izpit", "priprava na izpit", "kako se učiti za izpit", "vprašanja za izpit"],
    useCases: [
      "ponavljanje ključnih pojmov",
      "vaja z vprašanji iz predavanja",
      "hiter pregled snovi tik pred izpitom",
    ],
    inputs: ["zapiski s faksa", "predavanja", "PDF skripte", "stara vprašanja", "besedilo"],
    outputs: ["povzetek snovi", "flashcardi", "kvizi", "testi", "AI razlage"],
    consentNote:
      "Memo naj bo pomoč pri pripravi, ne nadomestilo za uradna navodila predmeta in preverjanje odgovorov.",
    ctaLabel: "Pripravi se na izpit",
  },
  {
    slug: "priprava-na-izpit",
    title: "Priprava na izpit z AI učnim gradivom",
    description:
      "Iz predavanj in skript ustvari povzetke, vprašanja, kvize, teste in flashcarde za boljšo pripravo na izpit.",
    h1: "Priprava na izpit brez ročnega urejanja vse snovi",
    eyebrow: "Priprava na izpit",
    intro:
      "Memo AI pomaga iz razpršenih predavanj, dokumentov in zapiskov narediti bolj pregleden učni paket. Tako se lahko hitreje premakneš od branja k preverjanju znanja.",
    primaryKeyword: "priprava na izpit",
    searchTerms: ["priprava na izpit", "učenje pred izpitom", "izpitna vprašanja", "AI priprava na izpit"],
    useCases: [
      "združevanje snovi iz več predavanj",
      "iskanje šibkih točk pred izpitom",
      "ustvarjanje testnih vprašanj iz skripte",
    ],
    inputs: ["PDF skripte", "zapiski", "prepisi", "dokumenti", "besedilo"],
    outputs: ["izpitni povzetki", "vprašanja", "kvizi", "testi", "kartice za učenje"],
    consentNote:
      "Pri pripravi na ocenjevanje vedno preveri, ali se AI odgovor ujema z uradno snovjo predmeta.",
    ctaLabel: "Začni pripravo",
  },
  {
    slug: "ucenje-za-maturo",
    title: "Učenje za maturo z zapiski, testi in karticami",
    description:
      "Memo AI pomaga pri učenju za maturo z urejenimi povzetki, flashcardi, kvizi in testnimi vprašanji iz tvojega gradiva.",
    h1: "Učenje za maturo z bolj urejeno snovjo",
    eyebrow: "Učenje za maturo",
    intro:
      "Pri maturi je snovi veliko, zato pomaga, če lahko zapiske, skripte in dokumente spremeniš v pregledne povzetke in vprašanja. Memo AI pripravi gradivo za ponavljanje iz tvojih virov.",
    primaryKeyword: "učenje za maturo",
    searchTerms: ["učenje za maturo", "priprava na maturo", "matura zapiski", "matura vprašanja"],
    useCases: [
      "povzetki maturitetnih tem",
      "kartice za definicije in pojme",
      "kvizi za preverjanje razumevanja",
    ],
    inputs: ["maturitetni zapiski", "PDF gradiva", "skripte", "besedilo", "dokumenti"],
    outputs: ["povzetki", "učne kartice", "kvizi", "testna vprašanja", "AI razlage"],
    consentNote:
      "Za maturo se opiraj na uradne kataloge znanja in šolsko gradivo; Memo naj pomaga pri urejanju in ponavljanju.",
    ctaLabel: "Uči se za maturo",
  },
  {
    slug: "ucenje-za-kolokvij",
    title: "Učenje za kolokvij iz predavanj in PDF gradiva",
    description:
      "Pripravi se na kolokvij z AI povzetki, zapiski, flashcardi, kvizi in vprašanji iz svojega gradiva.",
    h1: "Učenje za kolokvij iz dejanske snovi",
    eyebrow: "Učenje za kolokvij",
    intro:
      "Kolokvij pogosto preverja zadnja predavanja, zato je pomembno, da hitro urediš svežo snov. Memo AI iz posnetkov, PDF-jev in zapiskov pripravi povzetke in vprašanja za vajo.",
    primaryKeyword: "učenje za kolokvij",
    searchTerms: ["učenje za kolokvij", "priprava na kolokvij", "kolokvij vprašanja", "zapiski za kolokvij"],
    useCases: [
      "hitra priprava po več predavanjih",
      "ponavljanje formul, definicij in pojmov",
      "preverjanje znanja pred kratkim testom",
    ],
    inputs: ["predavanja", "prosojnice", "zapiski", "PDF-ji", "besedilo"],
    outputs: ["povzetki", "flashcardi", "kvizi", "testna vprašanja", "AI chat"],
    consentNote:
      "Vprašanja in odgovore uporabi kot vajo, končne razlage pa preveri pri gradivu predmeta.",
    ctaLabel: "Pripravi se na kolokvij",
  },
  {
    slug: "testi-za-ucenje",
    title: "Testi za učenje iz zapiskov in predavanj",
    description:
      "Memo AI iz tvojih zapiskov, PDF-jev in predavanj ustvari teste za učenje in preverjanje znanja.",
    h1: "Testi za učenje iz tvoje snovi",
    eyebrow: "Testi za učenje",
    intro:
      "Testi pomagajo pokazati, ali snov res razumeš. Memo AI iz gradiva pripravi vprašanja za vajo, da lahko pred preverjanjem vidiš, katere teme potrebujejo še več ponavljanja.",
    primaryKeyword: "testi za učenje",
    searchTerms: ["testi za učenje", "test iz zapiskov", "AI test", "preverjanje znanja"],
    useCases: [
      "vaja pred šolskim testom",
      "preverjanje razumevanja po predavanju",
      "ustvarjanje vprašanj iz skripte",
    ],
    inputs: ["zapiski", "PDF-ji", "predavanja", "prepisi", "besedilo"],
    outputs: ["testi", "kvizi", "vprašanja", "razlage odgovorov", "povzetki"],
    consentNote:
      "AI testi so pomoč za učenje in ne uradna ocena znanja; odgovore preveri pri zanesljivih virih.",
    ctaLabel: "Ustvari test",
  },
  {
    slug: "vprasanja-za-izpit",
    title: "Vprašanja za izpit iz zapiskov in skript",
    description:
      "Iz svojih zapiskov, predavanj in PDF skript ustvari vprašanja za izpit, kvize in testne vaje z Memo AI.",
    h1: "Vprašanja za izpit iz tvojega gradiva",
    eyebrow: "Vprašanja za izpit",
    intro:
      "Najboljša vprašanja za vajo izhajajo iz snovi, ki jo boš dejansko pisal ali odgovarjal. Memo AI iz zapiskov in skript pripravi vprašanja, ki ti pomagajo preveriti razumevanje.",
    primaryKeyword: "vprašanja za izpit",
    searchTerms: ["vprašanja za izpit", "izpitna vprašanja", "AI vprašanja", "vaja za izpit"],
    useCases: [
      "ustvarjanje vprašanj po poglavjih",
      "vaja kratkih in daljših odgovorov",
      "preverjanje, katere teme še niso jasne",
    ],
    inputs: ["skripte", "zapiski", "prepisi", "predavanja", "PDF dokumenti"],
    outputs: ["vprašanja", "kvizi", "testi", "razlage", "flashcardi"],
    consentNote:
      "Ustvarjena vprašanja so učna vaja; ne predstavljajo uradnih ali zagotovljenih izpitnih vprašanj.",
    ctaLabel: "Ustvari vprašanja",
  },
  {
    slug: "testna-vprasanja",
    title: "Testna vprašanja iz učnega gradiva",
    description:
      "Memo AI pripravi testna vprašanja iz zapiskov, PDF-jev, dokumentov in predavanj za hitrejše preverjanje znanja.",
    h1: "Testna vprašanja iz zapiskov in predavanj",
    eyebrow: "Testna vprašanja",
    intro:
      "Ko želiš snov ponoviti aktivno, so testna vprašanja boljša od pasivnega branja. Memo AI uporabi tvoje gradivo in pripravi vprašanja za vajo.",
    primaryKeyword: "testna vprašanja",
    searchTerms: ["testna vprašanja", "vprašanja iz zapiskov", "AI testna vprašanja", "preverjanje znanja"],
    useCases: [
      "preverjanje po posameznih temah",
      "vaja pred ustnim ali pisnim preverjanjem",
      "pretvorba povzetka v vprašanja",
    ],
    inputs: ["zapiski", "PDF-ji", "prepisi", "dokumenti", "besedilo"],
    outputs: ["testna vprašanja", "kvizi", "testi", "flashcardi", "povzetki"],
    consentNote:
      "Odgovore pri pomembnih preverjanjih primerjaj z uradnim gradivom in navodili predmeta.",
    ctaLabel: "Naredi testna vprašanja",
  },
  {
    slug: "ucne-kartice",
    title: "Učne kartice iz zapiskov, PDF-jev in predavanj",
    description:
      "Iz svojega gradiva ustvari učne kartice za ponavljanje definicij, pojmov, formul in pomembnih razlag.",
    h1: "Učne kartice iz tvoje snovi",
    eyebrow: "Učne kartice",
    intro:
      "Učne kartice pomagajo pri aktivnem priklicu znanja. Memo AI iz zapiskov, PDF-jev in predavanj izbere pomembne pojme in jih spremeni v kartice za ponavljanje.",
    primaryKeyword: "učne kartice",
    searchTerms: ["učne kartice", "kartice za učenje", "flashcardi", "AI učne kartice"],
    useCases: [
      "ponavljanje definicij",
      "učenje izrazov in ključnih pojmov",
      "hitro preverjanje pred testom",
    ],
    inputs: ["zapiski", "PDF", "predavanja", "prepisi", "besedilo"],
    outputs: ["učne kartice", "flashcardi", "vprašanja", "odgovori", "kvizi"],
    consentNote:
      "Kartice ustvarjaj iz gradiva, ki ga smeš uporabljati za osebno učenje.",
    ctaLabel: "Ustvari učne kartice",
  },
  {
    slug: "kartice-za-ucenje",
    title: "Kartice za učenje iz predavanj in zapiskov",
    description:
      "Memo AI ustvari kartice za učenje iz zapiskov, prepisov, PDF-jev in dokumentov, da lažje ponavljaš snov.",
    h1: "Kartice za učenje brez ročnega prepisovanja",
    eyebrow: "Kartice za učenje",
    intro:
      "Ročno delanje kartic lahko vzame veliko časa. Memo AI iz tvojega gradiva pripravi vprašanja in odgovore, ki jih uporabiš za hitrejše ponavljanje.",
    primaryKeyword: "kartice za učenje",
    searchTerms: ["kartice za učenje", "učne kartice", "flashcards", "AI flashcardi"],
    useCases: [
      "pretvorba zapiskov v vprašanja in odgovore",
      "ponavljanje najpomembnejših pojmov",
      "učenje pred kolokvijem ali izpitom",
    ],
    inputs: ["zapiski", "predavanja", "PDF gradiva", "dokumenti", "besedilo"],
    outputs: ["kartice za učenje", "flashcardi", "kvizi", "povzetki", "AI razlage"],
    consentNote:
      "Uporabi vire, za katere imaš dovoljenje, in pred preverjanjem znanja preveri pravilnost odgovorov.",
    ctaLabel: "Naredi kartice",
  },
  {
    slug: "povzetki-besedila",
    title: "Povzetki besedila z AI za učenje",
    description:
      "Prilepi besedilo ali naloži dokument in Memo AI pripravi povzetek, zapiske, ključne pojme, flashcarde in kvize.",
    h1: "Povzetki besedila za hitrejše razumevanje",
    eyebrow: "Povzetki besedila",
    intro:
      "Dolga besedila so lažja za učenje, ko najprej dobiš jasen povzetek in ključne pojme. Memo AI lahko iz besedila pripravi tudi vprašanja za ponavljanje.",
    primaryKeyword: "povzetki besedila",
    searchTerms: ["povzetki besedila", "AI povzetek besedila", "povzemanje besedila", "besedilo v zapiske"],
    useCases: [
      "povzemanje člankov in učnih besedil",
      "izpis ključnih pojmov",
      "pretvorba besedila v kviz",
    ],
    inputs: ["prilepljeno besedilo", "dokumenti", "PDF-ji", "spletni članki", "zapiski"],
    outputs: ["povzetki", "zapiski", "ključni pojmi", "flashcardi", "kvizi"],
    consentNote:
      "Ne lepi ali nalagaj besedil, ki jih ne smeš obdelovati ali uporabljati.",
    ctaLabel: "Povzemi besedilo",
  },
  {
    slug: "povzetek-skripte",
    title: "Povzetek skripte za izpit ali kolokvij",
    description:
      "Naloži skripto ali PDF gradivo in Memo AI pripravi povzetek, zapiske, ključne pojme, vprašanja in flashcarde.",
    h1: "Povzetek skripte za učenje",
    eyebrow: "Povzetek skripte",
    intro:
      "Skripte so pogosto dolge in goste. Memo AI pomaga iz njih narediti povzetek, ključne pojme in vprašanja, da hitreje vidiš strukturo snovi.",
    primaryKeyword: "povzetek skripte",
    searchTerms: ["povzetek skripte", "AI povzetek skripte", "skripta v zapiske", "povzetek za izpit"],
    useCases: [
      "hiter pregled dolge skripte",
      "razdelitev snovi po temah",
      "ustvarjanje vprašanj iz poglavij",
    ],
    inputs: ["PDF skripte", "DOCX dokumenti", "besedilo", "prosojnice", "študijska gradiva"],
    outputs: ["povzetek skripte", "zapiski", "ključni pojmi", "vprašanja", "flashcardi"],
    consentNote:
      "Skripte nalagaj samo, če jih smeš uporabljati in obdelovati za svoje učenje.",
    ctaLabel: "Povzemi skripto",
  },
  {
    slug: "zapiski-iz-pdf",
    title: "Zapiski iz PDF gradiva z AI",
    description:
      "Pretvori PDF, skripto ali prosojnice v urejene zapiske, povzetke, flashcarde, kvize in testna vprašanja.",
    h1: "Zapiski iz PDF-ja brez ročnega urejanja",
    eyebrow: "Zapiski iz PDF",
    intro:
      "Memo AI iz PDF gradiva pripravi bolj berljive zapiske in vaje za učenje. To pomaga pri prosojnicah, skriptah, člankih in drugih študijskih dokumentih.",
    primaryKeyword: "zapiski iz PDF",
    searchTerms: ["zapiski iz PDF", "PDF v zapiske", "AI zapiski iz PDF", "povzetek PDF"],
    useCases: [
      "urejanje prosojnic v zapiske",
      "povzemanje skript",
      "ustvarjanje vprašanj iz PDF-ja",
    ],
    inputs: ["PDF", "skripte", "prosojnice", "dokumenti", "besedilo"],
    outputs: ["zapiski iz PDF", "povzetki", "ključni pojmi", "flashcardi", "kvizi"],
    consentNote:
      "PDF nalagaj samo, če imaš dovoljenje za uporabo gradiva.",
    ctaLabel: "Ustvari zapiske iz PDF",
  },
  {
    slug: "zapiski-iz-zvoka",
    title: "Zapiski iz zvoka in audio posnetkov",
    description:
      "Memo AI iz audio posnetka pripravi prepis, zapiske, povzetek, flashcarde in kvize za učenje.",
    h1: "Zapiski iz zvoka za predavanja",
    eyebrow: "Zapiski iz zvoka",
    intro:
      "Če imaš posnetek predavanja, ga lahko spremeniš v zapiske in vaje. Memo AI najprej pripravi prepis, nato pa iz njega ustvari bolj uporabno učno gradivo.",
    primaryKeyword: "zapiski iz zvoka",
    searchTerms: ["zapiski iz zvoka", "audio v zapiske", "zvok v besedilo", "prepis predavanja"],
    useCases: [
      "prepis posnetka iz telefona",
      "urejanje govorjene snovi v zapiske",
      "ustvarjanje kviza iz predavanja",
    ],
    inputs: ["MP3", "M4A", "WAV", "OGG", "WEBM", "audio posnetki"],
    outputs: ["prepis", "zapiski iz zvoka", "povzetki", "flashcardi", "kvizi"],
    consentNote:
      "Pred snemanjem in nalaganjem zvoka preveri pravila predavanja ter pravice drugih udeležencev.",
    ctaLabel: "Pretvori zvok v zapiske",
  },
  {
    slug: "transkripcija-zvoka",
    title: "Transkripcija zvoka za predavanja in učenje",
    description:
      "Pretvori zvočne posnetke v transkripcijo, nato pa v zapiske, povzetke, vprašanja in flashcarde.",
    h1: "Transkripcija zvoka v uporabne zapiske",
    eyebrow: "Transkripcija zvoka",
    intro:
      "Transkripcija je prvi korak, ko želiš iz posnetka narediti učno gradivo. Memo AI prepis uporabi še za povzetke, vprašanja, kvize in AI klepet.",
    primaryKeyword: "transkripcija zvoka",
    searchTerms: ["transkripcija zvoka", "prepis zvoka", "zvok v besedilo", "audio transkripcija"],
    useCases: [
      "prepis predavanj in govorjenih razlag",
      "iskanje pomembnih delov posnetka",
      "pretvorba prepisa v učna vprašanja",
    ],
    inputs: ["audio datoteke", "posnetki predavanj", "MP3", "M4A", "WAV"],
    outputs: ["transkripcija", "prepis", "povzetek", "zapiski", "kvizi"],
    consentNote:
      "Transkribiraj samo posnetke, ki jih smeš uporabljati in pri katerih ne kršiš zasebnosti drugih oseb.",
    ctaLabel: "Transkribiraj zvok",
  },
  {
    slug: "audio-v-besedilo",
    title: "Audio v besedilo in zapiske z AI",
    description:
      "Pretvori audio posnetek v besedilo, nato pa v zapiske, povzetek, flashcarde, kvize in testna vprašanja.",
    h1: "Audio v besedilo za učenje",
    eyebrow: "Audio v besedilo",
    intro:
      "Memo AI pomaga, ko želiš zvočni posnetek spremeniti v berljivo besedilo in učno gradivo. Iz prepisa lahko takoj dobiš še povzetke in vprašanja.",
    primaryKeyword: "audio v besedilo",
    searchTerms: ["audio v besedilo", "zvok v besedilo", "prepis audio posnetka", "audio v zapiske"],
    useCases: [
      "pretvorba posnetka predavanja v besedilo",
      "urejanje prepisa v zapiske",
      "vaja s kvizi iz posnetka",
    ],
    inputs: ["MP3", "M4A", "WAV", "WEBM", "OGG"],
    outputs: ["besedilo", "prepis", "zapiski", "povzetki", "flashcardi", "kvizi"],
    consentNote:
      "Audio datoteke naloži samo, če jih smeš uporabljati in obdelovati.",
    ctaLabel: "Pretvori audio",
  },
  {
    slug: "ai-asistent-za-ucenje",
    title: "AI asistent za učenje iz tvojih zapiskov",
    description:
      "AI asistent za učenje, ki odgovarja na vprašanja iz tvojih zapiskov, PDF-jev, predavanj in dokumentov.",
    h1: "AI asistent za učenje, povezan s tvojim gradivom",
    eyebrow: "AI asistent za učenje",
    intro:
      "Splošni AI odgovori niso vedno vezani na tvojo snov. Memo AI dela z gradivom, ki ga naložiš, zato lahko sprašuješ po svojih zapiskih, prepisih in PDF-jih.",
    primaryKeyword: "AI asistent za učenje",
    searchTerms: ["AI asistent za učenje", "AI pomočnik za učenje", "AI za študente", "klepet z zapiski"],
    useCases: [
      "vprašanja o lastnih zapiskih",
      "razlaga pojmov iz gradiva",
      "preverjanje razumevanja s kvizi",
    ],
    inputs: ["zapiski", "PDF-ji", "prepisi", "predavanja", "dokumenti"],
    outputs: ["AI odgovori", "razlage", "povzetki", "kvizi", "flashcardi"],
    consentNote:
      "AI odgovore uporabljaj kot pomoč pri učenju in jih pri pomembnih odločitvah preveri pri zanesljivih virih.",
    ctaLabel: "Vprašaj AI asistenta",
  },
  {
    slug: "klepet-z-gradivom",
    title: "Klepet z gradivom, zapiski in PDF-ji",
    description:
      "Naloži gradivo in vprašaj AI chat o svojih zapiskih, PDF-jih, prepisih in dokumentih.",
    h1: "Klepet z gradivom za hitrejše razumevanje",
    eyebrow: "Klepet z gradivom",
    intro:
      "Ko imaš veliko gradiva, je hitreje vprašati konkretno vprašanje kot iskati po vseh zapiskih. Memo AI omogoča AI chat z vsebino, ki jo naložiš.",
    primaryKeyword: "klepet z gradivom",
    searchTerms: ["klepet z gradivom", "AI chat z zapiski", "klepet z PDF", "vprašaj zapiske"],
    useCases: [
      "iskanje odgovorov v zapiskih",
      "razlaga pojmov iz PDF-ja",
      "hitra priprava vprašanj pred izpitom",
    ],
    inputs: ["PDF", "zapiski", "prepisi", "dokumenti", "besedilo"],
    outputs: ["AI chat", "odgovori iz gradiva", "povzetki", "razlage", "kvizi"],
    consentNote:
      "Naloži samo gradivo, ki ga smeš uporabljati; AI odgovori lahko potrebujejo dodatno preverjanje.",
    ctaLabel: "Začni klepet",
  },
  {
    slug: "organizacija-zapiskov",
    title: "Organizacija zapiskov za šolo in faks",
    description:
      "Uredi predavanja, PDF-je in zapiske v en prostor ter iz njih ustvari povzetke, flashcarde, kvize in teste.",
    h1: "Organizacija zapiskov in učnega gradiva",
    eyebrow: "Organizacija zapiskov",
    intro:
      "Ko so zapiski, PDF-ji in posnetki razpršeni, je učenje počasnejše. Memo AI pomaga iz gradiva narediti bolj urejeno knjižnico zapiskov in vaj.",
    primaryKeyword: "organizacija zapiskov",
    searchTerms: ["organizacija zapiskov", "urejanje zapiskov", "digitalni zapiski", "zapiski za faks"],
    useCases: [
      "urejanje gradiva po predmetih",
      "ponavljanje iz iste knjižnice",
      "iskanje stare snovi pred izpitom",
    ],
    inputs: ["predavanja", "PDF-ji", "dokumenti", "zapiski", "povezave"],
    outputs: ["urejena knjižnica", "zapiski", "povzetki", "flashcardi", "kvizi"],
    consentNote:
      "Gradivo organiziraj in obdeluj samo, če ga smeš uporabljati v osebne učne namene.",
    ctaLabel: "Uredi zapiske",
  },
  {
    slug: "ucni-nacrt",
    title: "Učni načrt iz zapiskov in gradiva",
    description:
      "Memo AI pomaga razdeliti gradivo na pregledne teme, povzetke, vprašanja in kartice za bolj strukturirano učenje.",
    h1: "Učni načrt iz tvojega gradiva",
    eyebrow: "Učni načrt",
    intro:
      "Za dobro pripravo pomaga, da najprej vidiš, katere teme moraš obdelati. Memo AI iz gradiva naredi pregledne zapiske, pojme in vaje, ki jih lahko uporabiš kot osnovo za učni načrt.",
    primaryKeyword: "učni načrt",
    searchTerms: ["učni načrt", "načrt učenja", "organizacija učenja", "učenje za izpit"],
    useCases: [
      "razdelitev snovi po temah",
      "pregled, kaj je treba ponoviti",
      "ustvarjanje vaj za vsako poglavje",
    ],
    inputs: ["skripte", "zapiski", "predavanja", "PDF-ji", "dokumenti"],
    outputs: ["teme", "povzetki", "vprašanja", "flashcardi", "kvizi"],
    consentNote:
      "Učni načrt prilagodi uradnim zahtevam predmeta in preveri, ali pokriva vso zahtevano snov.",
    ctaLabel: "Uredi učni načrt",
  },
  {
    slug: "ponavljanje-snovi",
    title: "Ponavljanje snovi z AI karticami, kvizi in testi",
    description:
      "Iz zapiskov in predavanj ustvari flashcarde, kvize, teste in vprašanja za aktivno ponavljanje snovi.",
    h1: "Ponavljanje snovi iz zapiskov in predavanj",
    eyebrow: "Ponavljanje snovi",
    intro:
      "Ponavljanje je učinkovitejše, ko se ne ustavi pri branju. Memo AI iz tvoje snovi pripravi kartice, kvize in vprašanja, da aktivno preverjaš znanje.",
    primaryKeyword: "ponavljanje snovi",
    searchTerms: ["ponavljanje snovi", "aktivno učenje", "preverjanje znanja", "flashcardi za učenje"],
    useCases: [
      "ponavljanje pred testom",
      "preverjanje po vsakem poglavju",
      "utrjevanje ključnih pojmov",
    ],
    inputs: ["zapiski", "predavanja", "PDF-ji", "prepisi", "besedilo"],
    outputs: ["flashcardi", "kvizi", "testi", "vprašanja", "povzetki"],
    consentNote:
      "Ponavljanje z AI naj dopolni tvoje učenje; pomembne odgovore preveri pri uradnih virih.",
    ctaLabel: "Začni ponavljanje",
  },
  {
    slug: "digitalni-zapiski",
    title: "Digitalni zapiski z AI za šolo in faks",
    description:
      "Digitalni zapiski iz predavanj, PDF-jev, dokumentov in povezav z možnostjo flashcardov, kvizov, testov in AI chata.",
    h1: "Digitalni zapiski, ki se spremenijo v vaje",
    eyebrow: "Digitalni zapiski",
    intro:
      "Digitalni zapiski so uporabnejši, ko jih lahko iščeš, poslušaš in pretvoriš v vaje. Memo AI iz gradiva pripravi zapiske ter dodatno učno podporo.",
    primaryKeyword: "digitalni zapiski",
    searchTerms: ["digitalni zapiski", "AI digitalni zapiski", "zapiski za študente", "aplikacija za zapiske"],
    useCases: [
      "shranjevanje zapiskov iz več virov",
      "hitro iskanje in ponavljanje",
      "pretvorba zapiskov v učne kartice",
    ],
    inputs: ["audio", "PDF", "DOCX", "linki", "besedilo"],
    outputs: ["digitalni zapiski", "prepisi", "povzetki", "flashcardi", "kvizi"],
    consentNote:
      "Digitaliziraj samo gradivo, ki ga smeš uporabljati in obdelovati.",
    ctaLabel: "Ustvari digitalne zapiske",
  },
  {
    slug: "orodja-za-studente",
    title: "AI orodja za študente: zapiski, kvizi in flashcardi",
    description:
      "Memo AI združuje AI zapiske, prepise, povzetke, flashcarde, kvize, teste in klepet z gradivom za študente.",
    h1: "AI orodja za študente v enem prostoru",
    eyebrow: "Orodja za študente",
    intro:
      "Študenti pogosto uporabljajo več orodij za zapiske, povzetke, kartice in kvize. Memo AI združi ključne funkcije v en tok, ki začne pri tvojem gradivu.",
    primaryKeyword: "orodja za študente",
    searchTerms: ["orodja za študente", "AI orodja za študente", "aplikacije za študente", "študijska orodja"],
    useCases: [
      "zapiski iz predavanj",
      "povzetki PDF gradiva",
      "kvizi in flashcardi za izpit",
    ],
    inputs: ["predavanja", "PDF-ji", "dokumenti", "linki", "besedilo"],
    outputs: ["AI zapiski", "prepisi", "povzetki", "flashcardi", "kvizi", "AI chat"],
    consentNote:
      "Orodje uporabljaj odgovorno in samo za gradivo, ki ga smeš obdelovati.",
    ctaLabel: "Preizkusi orodje",
  },
  {
    slug: "studentski-zapiski",
    title: "Študentski zapiski iz predavanj in PDF-jev",
    description:
      "Memo AI pomaga študentom iz predavanj, PDF-jev in dokumentov ustvariti zapiske, povzetke, flashcarde, kvize in teste.",
    h1: "Študentski zapiski, pripravljeni za ponavljanje",
    eyebrow: "Študentski zapiski",
    intro:
      "Na faksu se snov hitro nabira. Memo AI pomaga študentske vire spremeniti v zapiske in vaje, da lažje slediš predmetom in se pripraviš na izpite.",
    primaryKeyword: "študentski zapiski",
    searchTerms: ["študentski zapiski", "zapiski za faks", "zapiski za študente", "AI zapiski za študente"],
    useCases: [
      "urejanje zapiskov po predavanjih",
      "povzemanje skript",
      "vaja za kolokvije in izpite",
    ],
    inputs: ["predavanja", "skripte", "PDF-ji", "dokumenti", "besedilo"],
    outputs: ["študentski zapiski", "povzetki", "flashcardi", "kvizi", "testi"],
    consentNote:
      "Upoštevaj pravila fakultete glede snemanja, deljenja in uporabe gradiva.",
    ctaLabel: "Uredi študentske zapiske",
  },
  {
    slug: "zapiski-za-faks",
    title: "Zapiski za faks z AI pomočjo",
    description:
      "Iz predavanj, skript, PDF-jev in dokumentov ustvari zapiske za faks, povzetke, kartice, kvize in testna vprašanja.",
    h1: "Zapiski za faks iz predavanj in skript",
    eyebrow: "Zapiski za faks",
    intro:
      "Memo AI pomaga, ko moraš urediti veliko fakultetne snovi. Iz predavanj in dokumentov pripravi zapiske, povzetke in vprašanja za bolj sistematično učenje.",
    primaryKeyword: "zapiski za faks",
    searchTerms: ["zapiski za faks", "faks zapiski", "študentski zapiski", "AI zapiski za faks"],
    useCases: [
      "zapiski po predavanjih",
      "povzetki skript za izpit",
      "vprašanja za kolokvij",
    ],
    inputs: ["predavanja", "PDF skripte", "prosojnice", "dokumenti", "besedilo"],
    outputs: ["zapiski za faks", "povzetki", "flashcardi", "kvizi", "testi"],
    consentNote:
      "Pred snemanjem predavanj in nalaganjem gradiva preveri pravila fakultete in dovoljenja predavatelja.",
    ctaLabel: "Naredi zapiske za faks",
  },
];

export function getSeoPublicPage(slug: string) {
  return SEO_PUBLIC_PAGES.find((page) => page.slug === slug) ?? null;
}

export function getSeoPublicPageUrl(page: SeoPublicPage) {
  return `${SEO_SITE_URL}/${page.slug}`;
}

export function getSeoBreadcrumbJsonLd(page: SeoPublicPage) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: SEO_BRAND_NAME,
        item: `${SEO_SITE_URL}/`,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: page.eyebrow,
        item: getSeoPublicPageUrl(page),
      },
    ],
  };
}

export function getSeoSoftwareJsonLd(page: SeoPublicPage) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SEO_BRAND_NAME,
    applicationCategory: "EducationalApplication",
    operatingSystem: "Web",
    inLanguage: "sl",
    url: getSeoPublicPageUrl(page),
    description: page.description,
    keywords: page.searchTerms.join(", "),
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "EUR",
    },
  };
}
