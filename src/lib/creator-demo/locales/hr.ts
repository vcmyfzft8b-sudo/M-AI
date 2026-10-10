/**
 * The `/creator` demo in Croatian, translated from the Slovenian source in
 * `./sl.ts`. See `../content-types.ts` for what each field is and the rules a
 * translation has to keep.
 */
import type { DemoLocaleContent, DemoNotePack } from "@/lib/creator-demo/content-types";

const MIKROEKONOMIJA: DemoNotePack = {
  key: "mikroekonomija",
  title: "Mikroekonomija – ponuda i potražnja",
  sourceType: "audio",
  durationSeconds: 2842,
  summary:
    "Predavanje objašnjava kako krivulje ponude i potražnje određuju tržišnu ravnotežu, što pomiče cijelu krivulju i kako elastičnost pokazuje koliko količina reagira na promjenu cijene.",
  keyTopics: [
    "Zakon potražnje",
    "Zakon ponude",
    "Tržišna ravnoteža",
    "Pomak krivulje naspram pomaka po krivulji",
    "Cjenovna elastičnost",
  ],
  notesMd: `## Brzi pregled

Tržište funkcionira kao pregovaranje između kupaca i prodavača: kupci žele nisku cijenu, prodavači visoku, a cijena se ustali ondje gdje se željena količina kupnje i prodaje poklope. Ta je točka tržišna ravnoteža. Kad se promijeni bilo koji čimbenik osim cijene, pomiče se cijela krivulja i nastaje nova ravnoteža.

> **Ključno:** Cijena ne pomiče krivulju – pomiče samo točku na njoj. Krivulju pomiču dohodak, cijene drugih dobara, očekivanja, tehnologija i broj sudionika na tržištu.

## Ključne stvari koje moraš znati

- Zakon potražnje: uz višu cijenu i nepromijenjene ostale uvjete kupci kupuju manje.
- Zakon ponude: uz višu cijenu proizvođači nude više jer je proizvodnja isplativija.
- Ravnoteža je jedina cijena pri kojoj nema ni viška ni manjka.
- Iznad ravnotežne cijene nastaje višak ponude, ispod nje manjak.
- Pomak po krivulji izaziva samo promjena cijene; pomak krivulje izaziva sve ostalo.
- Elastičnost mjeri osjetljivost količine na promjenu cijene i određuje hoće li poskupljenje povećati ili smanjiti prihod.

| Događaj | Koja krivulja | Smjer pomaka | Učinak na ravnotežnu cijenu |
| --- | --- | --- | --- |
| Rast dohotka kupaca | Potražnja | Udesno | Raste |
| Jeftinije sirovine | Ponuda | Udesno | Pada |
| Novi konkurent na tržištu | Ponuda | Udesno | Pada |
| Očekivano buduće poskupljenje | Potražnja | Udesno | Raste |

## 1. 📉 Potražnja

### Glavna ideja

Potražnja pokazuje koliko su jedinica nekog dobra kupci spremni i sposobni kupiti pri svakoj cijeni u danom razdoblju.

### Detaljne bilješke

Krivulja potražnje opada jer svaka dodatna jedinica kupcu donosi manje dodatne koristi, a viša cijena istodobno smanjuje njegovu realnu kupovnu moć. Važno je da govorimo o planiranoj, a ne o stvarno ostvarenoj količini kupnje.

- **Definicija:** Tražena količina je količina pri jednoj cijeni, a potražnja je cijeli odnos između cijene i količine.
- Tržišnu potražnju dobivamo zbrajanjem pojedinačnih potražnji svih kupaca na tržištu.
- Nužna dobra imaju strmiju krivulju od luksuznih dobara.

### Ključni pojmovi

- **Supstituti:** dobra koja se međusobno zamjenjuju (čaj i kava).
- **Komplementi:** dobra koja se koriste zajedno (pisač i tinte).
- **Inferiorno dobro:** potražnja pada kad dohodak raste.

## 2. 📈 Ponuda

### Glavna ideja

Ponuda pokazuje koliko su jedinica proizvođači spremni prodati pri svakoj cijeni.

### Detaljne bilješke

Krivulja ponude raste jer viša cijena pokriva više granične troškove proizvodnje i privlači nove ponuđače u djelatnost. Zato ponuda kratkoročno reagira sporije od potražnje – kapacitete nije moguće povećati preko noći.

- Troškovi rada i sirovina pomiču krivulju ponude prema gore, odnosno ulijevo.
- Bolja tehnologija snižava trošak po jedinici i pomiče ponudu udesno.
- Porez na proizvod djeluje kao dodatni trošak i smanjuje ponudu.

## 3. ⚖️ Tržišna ravnoteža

### Glavna ideja

Ravnoteža je cijena pri kojoj je tražena količina jednaka ponuđenoj količini.

### Detaljne bilješke

Ako je cijena previsoka, roba ostaje neprodana i prodavači snižavaju cijenu. Ako je cijena preniska, nastaju redovi i prodavači podižu cijenu. Tržište zato samo gura prema ravnoteži, iako prilagodba nije uvijek brza.

> **Česta pogreška:** Višak ponude nije znak da su kupci nestali – najčešće znači samo da je cijena iznad ravnotežne.

### Primjer

Ako ulaznica za koncert stoji 60 EUR, a ravnotežna cijena iznosi 45 EUR, dio dvorane ostaje prazan. Organizator snizi cijenu, a broj prodanih ulaznica raste duž iste krivulje potražnje.

## 4. 🔁 Elastičnost

### Glavna ideja

Cjenovna elastičnost potražnje pokazuje za koliko se posto promijeni količina ako se cijena promijeni za jedan posto.

### Detaljne bilješke

Elastičnost računamo kao omjer postotne promjene količine i postotne promjene cijene. Kad je rezultat po apsolutnoj vrijednosti veći od 1, potražnja je elastična i poskupljenje smanjuje ukupni prihod.

- **Elastična potražnja:** mnogo supstituta, dugo vremensko razdoblje, luksuzna dobra.
- **Neelastična potražnja:** malo supstituta, kratak rok, nužna dobra.
- **Ključno:** prihod je najveći ondje gdje je elastičnost jednaka 1.

### Provjeri svoje znanje

- Što se događa s ravnotežnom cijenom ako se istodobno povećaju i ponuda i potražnja?
- Zašto promjena cijene ne pomiče krivulju potražnje?
- Kada poskupljenje povećava ukupni prihod poduzeća?
- Koji čimbenici čine potražnju elastičnijom?

## Završni pregled

- Krivulja potražnje opada, krivulja ponude raste, a njihovo je sjecište ravnoteža.
- Promjena cijene znači kretanje po krivulji, a sve ostalo pomiče cijelu krivulju.
- Višak ponude gura cijenu prema dolje, a manjak prema gore.
- Elastičnost određuje kako poskupljenje djeluje na prihod.
- Najčešća pogreška na ispitu je zamjena pomaka krivulje pomakom po krivulji.`,
  images: [
    {
      file: "hr/ponudba-povprasevanje.svg",
      fileName: "graf-ravnoteza.png",
      alt: "Graf ponude i potražnje s točkom ravnoteže",
      afterText: "Ako je cijena previsoka, roba ostaje neprodana",
    },
    {
      file: "hr/elasticnost.svg",
      fileName: "usporedba-elasticnosti.png",
      alt: "Usporedba elastične i neelastične potražnje",
      afterText: "Elastičnost računamo kao omjer",
    },
  ],
  sections: [
    { title: "Potražnja", sourceLabel: "00:00 – 11:20" },
    { title: "Ponuda", sourceLabel: "11:20 – 24:05" },
    { title: "Tržišna ravnoteža", sourceLabel: "24:05 – 36:40" },
    { title: "Elastičnost", sourceLabel: "36:40 – 47:22" },
  ],
  flashcards: [
    {
      front: "Što kaže zakon potražnje?",
      back: "Uz nepromijenjene ostale uvjete kupci pri višoj cijeni kupuju manju količinu dobra.",
      hint: "Cijena gore, količina dolje.",
      difficulty: "easy",
      sectionIdx: 0,
    },
    {
      front: "Koja je razlika između potražnje i tražene količine?",
      back: "Tražena količina je jedna točka pri jednoj cijeni, a potražnja je cijeli odnos između cijene i količine, dakle cijela krivulja.",
      difficulty: "medium",
      sectionIdx: 0,
    },
    {
      front: "Što su supstituti?",
      back: "Dobra koja se međusobno zamjenjuju. Poskupljenje jednoga povećava potražnju za drugim, na primjer čaj i kava.",
      difficulty: "easy",
      sectionIdx: 0,
    },
    {
      front: "Zašto krivulja ponude raste?",
      back: "Viša cijena pokriva više granične troškove i privlači dodatne ponuđače u djelatnost, pa se isplati proizvoditi više.",
      difficulty: "medium",
      sectionIdx: 1,
    },
    {
      front: "Kako porez na proizvod utječe na ponudu?",
      back: "Djeluje kao dodatni trošak po jedinici, pa krivulju ponude pomiče ulijevo, odnosno prema gore.",
      difficulty: "medium",
      sectionIdx: 1,
    },
    {
      front: "Što je tržišna ravnoteža?",
      back: "Cijena pri kojoj je tražena količina jednaka ponuđenoj količini, pa nema ni viška ni manjka.",
      difficulty: "easy",
      sectionIdx: 2,
    },
    {
      front: "Što nastaje ako je cijena iznad ravnotežne?",
      back: "Višak ponude: neprodana roba gura cijenu prema dolje, prema ravnoteži.",
      difficulty: "medium",
      sectionIdx: 2,
    },
    {
      front: "Kada se pomiče cijela krivulja potražnje?",
      back: "Pri promjeni dohotka, cijena supstituta ili komplemenata, ukusa, očekivanja ili broja kupaca – nikad pri promjeni vlastite cijene.",
      hint: "Sve osim cijene.",
      difficulty: "hard",
      sectionIdx: 2,
    },
    {
      front: "Kako se računa cjenovna elastičnost potražnje?",
      back: "Postotnu promjenu količine dijelimo s postotnom promjenom cijene. Apsolutna vrijednost veća od 1 znači elastičnu potražnju.",
      difficulty: "hard",
      sectionIdx: 3,
    },
    {
      front: "Kada poskupljenje povećava ukupni prihod?",
      back: "Kad je potražnja neelastična, odnosno kad se količina relativno mijenja manje od cijene.",
      difficulty: "hard",
      sectionIdx: 3,
    },
  ],
  quiz: [
    {
      prompt: "Cijena kave raste. Što se događa na tržištu čaja?",
      options: [
        "Potražnja za čajem raste",
        "Potražnja za čajem pada",
        "Ponuda čaja se smanjuje",
        "Na tržištu čaja ništa se ne mijenja",
      ],
      correctOptionIdx: 0,
      explanation:
        "Čaj je supstitut za kavu, pa dio kupaca prelazi na čaj i krivulja potražnje za čajem pomiče se udesno.",
      difficulty: "easy",
    },
    {
      prompt: "Koji događaj pomiče krivulju ponude udesno?",
      options: [
        "Rast cijena sirovina",
        "Novi porez na proizvod",
        "Jeftinija proizvodna tehnologija",
        "Rast cijene gotovog proizvoda",
      ],
      correctOptionIdx: 2,
      explanation:
        "Bolja tehnologija snižava trošak po jedinici, pa su proizvođači pri svakoj cijeni spremni ponuditi više.",
      difficulty: "medium",
    },
    {
      prompt: "Cijena je ispod ravnotežne. Što se događa?",
      options: [
        "Nastaje višak ponude",
        "Nastaje manjak i cijena raste",
        "Tržište je u ravnoteži",
        "Krivulja potražnje pomiče se ulijevo",
      ],
      correctOptionIdx: 1,
      explanation:
        "Pri preniskoj cijeni kupci žele više nego što je dostupno. Manjak gura cijenu prema gore, prema ravnoteži.",
      difficulty: "easy",
    },
    {
      prompt: "Promjena vlastite cijene dobra uzrokuje:",
      options: [
        "Pomak po krivulji potražnje",
        "Pomak cijele krivulje potražnje",
        "Pomak cijele krivulje ponude",
        "Promjenu elastičnosti",
      ],
      correctOptionIdx: 0,
      explanation:
        "Cijena je na osi grafa, pa njezina promjena znači kretanje po postojećoj krivulji, a ne njezin pomak.",
      difficulty: "medium",
    },
    {
      prompt: "Potražnja je elastična kad je koeficijent elastičnosti:",
      options: [
        "Po apsolutnoj vrijednosti manji od 1",
        "Po apsolutnoj vrijednosti jednak 1",
        "Po apsolutnoj vrijednosti veći od 1",
        "Uvijek negativan",
      ],
      correctOptionIdx: 2,
      explanation:
        "Apsolutna vrijednost veća od 1 znači da se količina relativno mijenja više od cijene.",
      difficulty: "medium",
    },
    {
      prompt: "Poduzeće prodaje nužno dobro bez supstituta i podiže cijenu. Prihod će najvjerojatnije:",
      options: [
        "Pasti jer će kupci otići",
        "Porasti jer je potražnja neelastična",
        "Ostati isti",
        "Ovisiti samo o ponudi",
      ],
      correctOptionIdx: 1,
      explanation:
        "Bez supstituta potražnja je neelastična, pa se količina relativno smanjuje manje nego što cijena raste.",
      difficulty: "hard",
    },
    {
      prompt: "Dohodak kupaca raste, a dobro je inferiorno. Potražnja se:",
      options: ["Povećava", "Smanjuje", "Ne mijenja", "Pretvara u ponudu"],
      correctOptionIdx: 1,
      explanation:
        "Kod inferiornih dobara kupci uz viši dohodak prelaze na kvalitetnije zamjene.",
      difficulty: "hard",
    },
    {
      prompt: "Istodobno se povećaju ponuda i potražnja. Što sigurno vrijedi?",
      options: [
        "Cijena sigurno raste",
        "Cijena sigurno pada",
        "Ravnotežna količina se povećava",
        "Ravnotežna količina se smanjuje",
      ],
      correctOptionIdx: 2,
      explanation:
        "Oba pomaka povećavaju količinu, a učinak na cijenu ovisi o tome koji je pomak jači.",
      difficulty: "hard",
    },
  ],
  practice: [
    {
      prompt:
        "Objasni razliku između pomaka po krivulji potražnje i pomaka cijele krivulje. Navedi po jedan primjer za svaki.",
      answerGuide:
        "Pomak po krivulji izaziva isključivo promjena vlastite cijene dobra. Pomak cijele krivulje izazivaju necjenovni čimbenici: dohodak, cijene supstituta i komplemenata, ukusi, očekivanja i broj kupaca.",
      difficulty: "medium",
      expectedAnswer:
        "Promjena cijene = kretanje po krivulji (npr. cijena kave padne, kupci kupuju više kave). Promjena necjenovnog čimbenika = pomak krivulje (npr. dohodak raste i cijela se krivulja pomiče udesno).",
      strengths: "Jasno razlikuješ cjenovni i necjenovni čimbenik.",
      missingPoints: "Dodaj i konkretan primjer pomaka ulijevo, na primjer pad dohotka.",
    },
    {
      prompt:
        "Na tržištu nastane višak ponude. Opiši mehanizam koji tržište vraća u ravnotežu.",
      answerGuide:
        "Višak znači cijenu iznad ravnotežne. Neprodane zalihe tjeraju prodavače na sniženje cijene, što povećava traženu i smanjuje ponuđenu količinu dok se ne izjednače.",
      difficulty: "easy",
      expectedAnswer:
        "Cijena je previsoka, zalihe rastu, prodavači snižavaju cijene, tražena količina raste, a ponuđena pada dok višak ne nestane.",
      strengths: "Točno prepoznaješ smjer pritiska na cijenu.",
      missingPoints: "Spomeni da se krećemo po objema krivuljama i da ih ne pomičemo.",
    },
    {
      prompt:
        "Poduzeće razmišlja o poskupljenju od 10 posto. Što mora znati o elastičnosti prije nego što odluči?",
      answerGuide:
        "Ako je potražnja elastična, prihod će pasti jer će količina pasti za više od 10 posto. Ako je neelastična, prihod će porasti. Ključni su čimbenici dostupnost supstituta, udio u kupčevu budžetu i vremensko razdoblje.",
      difficulty: "hard",
      expectedAnswer:
        "Mora izračunati cjenovnu elastičnost. Iznad 1 znači gubitak prihoda, ispod 1 rast prihoda. Mora uzeti u obzir supstitute i dugoročnu reakciju kupaca.",
      strengths: "Povezuješ elastičnost s prihodom.",
      missingPoints: "Dodaj da je dugoročna elastičnost obično veća od kratkoročne.",
    },
    {
      prompt:
        "Država uvede porez na proizvod. Objasni učinak na krivulju ponude, ravnotežnu cijenu i količinu.",
      answerGuide:
        "Porez povećava trošak po jedinici i pomiče ponudu ulijevo. Ravnotežna cijena za kupca raste, a ravnotežna količina pada. Porezni teret raspoređuje se između kupca i prodavača ovisno o elastičnosti.",
      difficulty: "medium",
      expectedAnswer:
        "Ponuda se pomiče ulijevo, cijena raste, količina pada, a porezni teret više snosi ona strana tržišta koja je neelastičnija.",
      strengths: "Prepoznaješ smjer pomaka ponude.",
      missingPoints: "Objasni raspodjelu poreznog tereta s obzirom na elastičnost.",
    },
    {
      prompt: "Zašto ponuda kratkoročno reagira sporije od potražnje?",
      answerGuide:
        "Proizvodni kapaciteti, ugovori i sirovine kratkoročno su fiksni, pa proizvođači ne mogu brzo povećati obujam. Kupci, s druge strane, mogu svoje odluke promijeniti odmah.",
      difficulty: "medium",
      expectedAnswer:
        "Zato što su kapaciteti i inputi kratkoročno ograničeni, dok kupci odluku o kupnji mijenjaju odmah.",
      strengths: "Prepoznaješ vremensku dimenziju prilagodbe.",
      missingPoints: "Navedi konkretan primjer, na primjer izgradnju nove proizvodne linije.",
    },
  ],
  transcript: [
    {
      startMs: 0,
      endMs: 28000,
      speakerLabel: "Predavač",
      text: "Dobro jutro. Danas završavamo poglavlje o tržištu, dakle ponudu, potražnju i ravnotežu. To je gradivo koje će vam na ispitu trebati praktički u svakom zadatku.",
    },
    {
      startMs: 28000,
      endMs: 74000,
      speakerLabel: "Predavač",
      text: "Počnimo s potražnjom. Potražnja nije jedan jedini broj, nego odnos između cijene i količine. Kad cijena raste, tražena količina pada. To je zakon potražnje.",
    },
    {
      startMs: 74000,
      endMs: 132000,
      speakerLabel: "Predavač",
      text: "Pazite na razliku koju studenti najčešće promaše. Tražena količina je jedna točka na krivulji, a potražnja je cijela krivulja. Ako se promijeni cijena, krećemo se po krivulji.",
    },
    {
      startMs: 132000,
      endMs: 205000,
      speakerLabel: "Predavač",
      text: "Krivulju pomiču drugi čimbenici: dohodak, cijene supstituta i komplemenata, ukusi, očekivanja i broj kupaca na tržištu. Ako dohodak raste, krivulja se pomiče udesno.",
    },
    {
      startMs: 205000,
      endMs: 268000,
      speakerLabel: "Studentica",
      text: "A kako je kod inferiornih dobara? Tamo je upravo obrnuto, zar ne?",
    },
    {
      startMs: 268000,
      endMs: 330000,
      speakerLabel: "Predavač",
      text: "Upravo tako. Kod inferiornih dobara viši dohodak smanjuje potražnju jer kupci prelaze na kvalitetniju zamjenu.",
    },
    {
      startMs: 680000,
      endMs: 742000,
      speakerLabel: "Predavač",
      text: "Prijeđimo na ponudu. Krivulja ponude raste jer viša cijena pokriva više granične troškove i privlači nove proizvođače u djelatnost.",
    },
    {
      startMs: 742000,
      endMs: 815000,
      speakerLabel: "Predavač",
      text: "Ponudu pomiču troškovi sirovina, tehnologija, porezi i subvencije. Nova tehnologija snižava trošak po jedinici i pomiče ponudu udesno.",
    },
    {
      startMs: 1445000,
      endMs: 1512000,
      speakerLabel: "Predavač",
      text: "Ravnoteža je sjecište obiju krivulja. To je jedina cijena pri kojoj nema ni viška ni manjka.",
    },
    {
      startMs: 1512000,
      endMs: 1588000,
      speakerLabel: "Predavač",
      text: "Ako je cijena previsoka, roba ostaje neprodana, nastaje višak i prodavači snižavaju cijenu. Ako je preniska, nastaje manjak i cijena raste.",
    },
    {
      startMs: 2200000,
      endMs: 2276000,
      speakerLabel: "Predavač",
      text: "Posljednja tema je elastičnost. Elastičnost je postotna promjena količine podijeljena s postotnom promjenom cijene.",
    },
    {
      startMs: 2276000,
      endMs: 2360000,
      speakerLabel: "Predavač",
      text: "Ako je apsolutna vrijednost veća od jedan, potražnja je elastična i poskupljenje smanjuje prihod. Ako je manja od jedan, poskupljenje prihod povećava.",
    },
    {
      startMs: 2360000,
      endMs: 2430000,
      speakerLabel: "Student",
      text: "Znači li to da se kod nužnih dobara uvijek isplati podići cijenu?",
    },
    {
      startMs: 2430000,
      endMs: 2520000,
      speakerLabel: "Predavač",
      text: "Kratkoročno često da, ali dugoročno kupci pronađu zamjene, pa je dugoročna elastičnost gotovo uvijek veća od kratkoročne.",
    },
    {
      startMs: 2760000,
      endMs: 2842000,
      speakerLabel: "Predavač",
      text: "Za idući put pregledajte primjere od jedan do pet. Na ispitu će sigurno biti zadatak s pomakom krivulje, zato vježbajte crtanje grafova.",
    },
  ],
  chatAnswers: [
    "Ukratko: krivulja potražnje opada jer svaka dodatna jedinica kupcu donosi manje koristi, a viša cijena istodobno smanjuje njegovu realnu kupovnu moć. Zato kupci pri višoj cijeni planiraju kupiti manju količinu.",
    "Razlika je u tome što se pomiče. Ako se promijeni cijena samog dobra, krećeš se po postojećoj krivulji. Ako se promijeni bilo što drugo – dohodak, cijena supstituta, očekivanja – pomiče se cijela krivulja.",
    "Da, to je klasično ispitno pitanje. Ako je potražnja neelastična (koeficijent ispod 1), poskupljenje povećava ukupni prihod jer količina relativno pada manje nego što cijena raste. Kod elastične potražnje učinak je obrnut.",
    "Višak ponude znači da je cijena iznad ravnotežne. Zalihe rastu, prodavači snižavaju cijenu, pa se tražena količina povećava, a ponuđena smanjuje, sve dok se tržište ne vrati u ravnotežu.",
  ],
};

const ANATOMIJA: DemoNotePack = {
  key: "anatomija",
  title: "Anatomija – građa živčanog sustava",
  sourceType: "pdf",
  durationSeconds: null,
  pageCount: 24,
  summary:
    "Skripta dijeli živčani sustav na središnji i periferni dio, opisuje neuron kao osnovnu jedinicu te objašnjava kako akcijski potencijal i sinapsa prenose informaciju kroz tijelo.",
  keyTopics: [
    "Središnji i periferni živčani sustav",
    "Građa neurona",
    "Akcijski potencijal",
    "Sinaptički prijenos",
    "Autonomni živčani sustav",
  ],
  notesMd: `## Brzi pregled

Živčani sustav informacijski je sustav tijela: prima podražaje, obrađuje ih i pokreće odgovor. Anatomski ga dijelimo na središnji živčani sustav, koji obrađuje informacije, i periferni živčani sustav, koji ih prenosi između tijela i mozga. Osnovna funkcionalna jedinica je neuron, koji informaciju prenosi elektrokemijski.

> **Ključno:** Električni signal putuje unutar neurona, a između neurona prijenos se uvijek pretvara u kemijski signal preko sinapse.

## Ključne stvari koje moraš znati

- Središnji živčani sustav čine mozak i leđna moždina.
- Periferni živčani sustav čine živci i gangliji izvan središnjeg živčanog sustava.
- Neuron ima dendrite, tijelo, akson i završne čvoriće.
- Mijelinska ovojnica ubrzava provođenje jer signal skače između Ranvierovih suženja (saltatorno provođenje).
- Akcijski potencijal odgovor je po načelu sve ili ništa.
- Autonomni živčani sustav dijelimo na simpatički i parasimpatički dio, koji imaju suprotne učinke.

| Dio živčanog sustava | Glavna zadaća | Karakteristična struktura |
| --- | --- | --- |
| Središnji | Obrada i pohrana informacija | Moždana kora, leđna moždina |
| Somatski | Svjesni pokreti i osjeti | Motorička i senzorička vlakna |
| Simpatički | Aktivacija, borba ili bijeg | Prevladava noradrenalin |
| Parasimpatički | Smirivanje, probava i oporavak | Prevladava acetilkolin |

## 1. 🧠 Podjela živčanog sustava

### Glavna ideja

Živčani sustav funkcionalno dijelimo na središnji dio, koji obrađuje informacije, i periferni dio, koji ih prenosi.

### Detaljne bilješke

Mozak i leđna moždina čine središnji živčani sustav, koji štite kosti, moždane ovojnice i likvor. Periferni živčani sustav čine živci koji povezuju središnji dio s organima, mišićima i kožom.

- Somatski dio upravlja svjesnim pokretima skeletnih mišića.
- Autonomni dio regulira rad organa bez svjesne kontrole.
- Leđna moždina nije samo kabel: sama izvodi refleksni luk bez posredovanja mozga.

### Ključni pojmovi

- **Ganglij:** nakupina živčanih stanica izvan središnjeg živčanog sustava.
- **Jezgra:** nakupina živčanih stanica unutar središnjeg živčanog sustava.
- **Refleksni luk:** najkraći put od receptora do efektora.

## 2. 🔬 Neuron

### Glavna ideja

Neuron je stanica specijalizirana za primanje, provođenje i prenošenje električnog signala.

### Detaljne bilješke

Dendriti primaju signale, tijelo ih zbraja, a akson provodi akcijski potencijal do završnih čvorića. Mijelinska ovojnica djeluje kao izolator, pa signal preskače između Ranvierovih suženja i putuje znatno brže.

- **Definicija:** Aksonski brežuljak je mjesto gdje se odlučuje hoće li se pokrenuti akcijski potencijal.
- Glija stanice hrane i podupiru neurone te stvaraju mijelin.
- Deblji i jače mijelinizirani akson provodi brže.

## 3. ⚡ Akcijski potencijal

### Glavna ideja

Akcijski potencijal je brzi obrat membranskog napona koji se bez slabljenja širi duž aksona.

### Detaljne bilješke

U mirovanju je unutrašnjost stanice negativna. Kad podražaj dosegne prag, otvaraju se natrijevi kanali, natrij ulazi u stanicu i nastaje depolarizacija. Slijedi izlazak kalija, odnosno repolarizacija, a zatim kratko refraktorno razdoblje.

> **Česta pogreška:** Jači podražaj ne stvara veći akcijski potencijal – povećava samo frekvenciju okidanja.

### Proces

- Podražaj dosegne prag podražljivosti.
- Otvaraju se natrijevi kanali i slijedi depolarizacija.
- Otvaraju se kalijevi kanali i slijedi repolarizacija.
- Natrij-kalijeva crpka vraća membranski potencijal mirovanja.

## 4. 🔗 Sinapsa

### Glavna ideja

Sinapsa je spoj između dvaju neurona na kojem se električni signal pretvara u kemijski.

### Detaljne bilješke

Kad akcijski potencijal dosegne završni čvorić, otvaraju se kalcijevi kanali. Vezikule s neurotransmiterom stapaju se s membranom i otpuštaju prijenosnik u sinaptičku pukotinu, gdje se on veže na receptore sljedeće stanice.

- Ekscitacijski prijenosnici povećavaju vjerojatnost novog akcijskog potencijala.
- Inhibicijski prijenosnici tu vjerojatnost smanjuju.
- Nakon djelovanja prijenosnik se razgrađuje ili vraća u presinaptičku stanicu.

### Provjeri svoje znanje

- Koje strukture čine središnji živčani sustav?
- Zašto mijelin ubrzava provođenje?
- Što znači načelo sve ili ništa?
- Kako se signal prenosi između dvaju neurona?

## Završni pregled

- Središnji živčani sustav obrađuje, a periferni prenosi informacije.
- Neuron čine dendriti, tijelo, akson i završni čvorići.
- Akcijski potencijal slijedi načelo sve ili ništa, a jakost podražaja kodira frekvencija.
- Mijelin omogućuje skokovito i brže provođenje.
- Sinapsa pretvara električni signal u kemijski i natrag.`,
  images: [
    {
      file: "hr/nevron.svg",
      fileName: "shema-neurona.png",
      alt: "Građa neurona s dendritima, tijelom, aksonom i završnim čvorićima",
      afterText: "Dendriti primaju signale, tijelo ih zbraja",
    },
    {
      file: "hr/akcijski-potencial.svg",
      fileName: "akcijski-potencijal.png",
      alt: "Tijek akcijskog potencijala u vremenu",
      afterText: "U mirovanju je unutrašnjost stanice negativna",
    },
  ],
  sections: [
    { title: "Podjela živčanog sustava", sourceLabel: "str. 3–7" },
    { title: "Građa neurona", sourceLabel: "str. 8–12" },
    { title: "Akcijski potencijal", sourceLabel: "str. 13–18" },
    { title: "Sinaptički prijenos", sourceLabel: "str. 19–24" },
  ],
  flashcards: [
    {
      front: "Što čini središnji živčani sustav?",
      back: "Mozak i leđna moždina, koje štite kosti, moždane ovojnice i likvor.",
      difficulty: "easy",
      sectionIdx: 0,
    },
    {
      front: "Koja je razlika između ganglija i jezgre?",
      back: "Ganglij je nakupina živčanih stanica izvan središnjeg živčanog sustava, a jezgra je nakupina unutar njega.",
      difficulty: "hard",
      sectionIdx: 0,
    },
    {
      front: "Što je refleksni luk?",
      back: "Najkraći živčani put od receptora preko leđne moždine do efektora, bez posredovanja mozga.",
      difficulty: "medium",
      sectionIdx: 0,
    },
    {
      front: "Nabroji glavne dijelove neurona.",
      back: "Dendriti, tijelo stanice, akson i završni čvorići.",
      hint: "Od primanja do prenošenja signala.",
      difficulty: "easy",
      sectionIdx: 1,
    },
    {
      front: "Zašto mijelinska ovojnica ubrzava provođenje?",
      back: "Djeluje kao izolator, pa signal preskače između Ranvierovih suženja – to je saltatorno (skokovito) provođenje.",
      difficulty: "medium",
      sectionIdx: 1,
    },
    {
      front: "Što se događa na aksonskom brežuljku?",
      back: "Ondje se zbrajaju ulazni signali i odlučuje se hoće li prag biti prijeđen i akcijski potencijal pokrenut.",
      difficulty: "hard",
      sectionIdx: 1,
    },
    {
      front: "Što znači načelo sve ili ništa?",
      back: "Akcijski potencijal nastaje ili u punoj veličini ili uopće ne nastaje. Jakost podražaja kodira se frekvencijom okidanja.",
      difficulty: "medium",
      sectionIdx: 2,
    },
    {
      front: "Koji ion uzrokuje depolarizaciju?",
      back: "Natrij, koji ulazi u stanicu kad se otvore naponski ovisni kanali.",
      difficulty: "easy",
      sectionIdx: 2,
    },
    {
      front: "Što je refraktorno razdoblje?",
      back: "Kratko razdoblje nakon akcijskog potencijala u kojem neuron nije podražljiv, što osigurava jednosmjerno širenje signala.",
      difficulty: "hard",
      sectionIdx: 2,
    },
    {
      front: "Kako se odvija prijenos preko sinapse?",
      back: "Akcijski potencijal pokreće ulazak kalcija, vezikule otpuštaju neurotransmiter u pukotinu, a on se veže na receptore sljedeće stanice.",
      difficulty: "medium",
      sectionIdx: 3,
    },
  ],
  quiz: [
    {
      prompt: "Koji par čini središnji živčani sustav?",
      options: [
        "Mozak i leđna moždina",
        "Mozak i periferni živci",
        "Leđna moždina i gangliji",
        "Živci i receptori",
      ],
      correctOptionIdx: 0,
      explanation: "Središnji živčani sustav po definiciji čine mozak i leđna moždina.",
      difficulty: "easy",
    },
    {
      prompt: "Što omogućuje skokovito provođenje signala?",
      options: [
        "Debljina dendrita",
        "Mijelinska ovojnica s Ranvierovim suženjima",
        "Broj sinapsi",
        "Veličina tijela stanice",
      ],
      correctOptionIdx: 1,
      explanation:
        "Mijelin izolira akson, pa se depolarizacija događa samo u suženjima i signal preskače.",
      difficulty: "medium",
    },
    {
      prompt: "Jači podražaj uzrokuje:",
      options: [
        "Veći akcijski potencijal",
        "Dulji akcijski potencijal",
        "Višu frekvenciju akcijskih potencijala",
        "Sporije provođenje",
      ],
      correctOptionIdx: 2,
      explanation:
        "Zbog načela sve ili ništa jakost podražaja kodira se frekvencijom, a ne amplitudom.",
      difficulty: "medium",
    },
    {
      prompt: "Koji je ion odgovoran za repolarizaciju?",
      options: ["Natrij", "Kalij", "Kalcij", "Klor"],
      correctOptionIdx: 1,
      explanation: "Nakon depolarizacije kalij izlazi iz stanice i membranski napon se vraća prema dolje.",
      difficulty: "medium",
    },
    {
      prompt: "Što pokreće otpuštanje neurotransmitera u sinaptičku pukotinu?",
      options: [
        "Ulazak kalcija u završni čvorić",
        "Izlazak kalija iz dendrita",
        "Zatvaranje natrijevih kanala",
        "Djelovanje mijelina",
      ],
      correctOptionIdx: 0,
      explanation:
        "Akcijski potencijal otvara kalcijeve kanale, a kalcij pokreće stapanje vezikula s membranom.",
      difficulty: "hard",
    },
    {
      prompt: "Parasimpatički živčani sustav ponajprije:",
      options: [
        "Priprema tijelo za borbu ili bijeg",
        "Ubrzava rad srca",
        "Smiruje tijelo i potiče probavu",
        "Upravlja svjesnim pokretima",
      ],
      correctOptionIdx: 2,
      explanation: "Parasimpatikus prevladava u mirovanju i podupire probavu te oporavak.",
      difficulty: "easy",
    },
    {
      prompt: "Nakupinu živčanih stanica izvan središnjeg živčanog sustava nazivamo:",
      options: ["Jezgra", "Ganglij", "Sinapsa", "Ovojnica"],
      correctOptionIdx: 1,
      explanation: "Izvan središnjeg živčanog sustava to je ganglij, a unutar njega jezgra.",
      difficulty: "hard",
    },
  ],
  practice: [
    {
      prompt: "Opiši put signala od dendrita do sljedeće stanice.",
      answerGuide:
        "Dendriti primaju signal, tijelo ga zbraja, na aksonskom brežuljku pri prijeđenom pragu nastaje akcijski potencijal, koji putuje duž aksona do završnih čvorića, gdje se neurotransmiter otpušta u sinaptičku pukotinu.",
      difficulty: "medium",
      expectedAnswer:
        "Dendrit → tijelo stanice → aksonski brežuljak → akson → završni čvorić → sinaptička pukotina → receptori sljedeće stanice.",
      strengths: "Redoslijed struktura je točan.",
      missingPoints: "Spomeni i ulogu kalcija u otpuštanju vezikula.",
    },
    {
      prompt: "Objasni načelo sve ili ništa i reci kako tijelo kodira jakost podražaja.",
      answerGuide:
        "Akcijski potencijal nastaje u punoj veličini ili uopće ne nastaje. Jači podražaj povećava frekvenciju okidanja i broj podraženih neurona, ali ne i amplitudu signala.",
      difficulty: "medium",
      expectedAnswer:
        "Amplituda je uvijek jednaka; jakost podražaja kodira se frekvencijom akcijskih potencijala i brojem aktiviranih vlakana.",
      strengths: "Točno navodiš da amplituda ostaje jednaka.",
      missingPoints: "Dodaj ulogu praga podražljivosti.",
    },
    {
      prompt: "Usporedi simpatički i parasimpatički živčani sustav.",
      answerGuide:
        "Simpatikus priprema tijelo za napor: ubrzava rad srca, širi bronhe i koči probavu. Parasimpatikus djeluje suprotno i prevladava u mirovanju. Glavni su prijenosnici noradrenalin i acetilkolin.",
      difficulty: "easy",
      expectedAnswer:
        "Simpatikus = aktivacija (borba ili bijeg, noradrenalin), parasimpatikus = smirivanje i probava (acetilkolin).",
      strengths: "Suprotni učinci jasno su prikazani.",
      missingPoints: "Navedi barem jedan konkretan organ i učinak na njemu.",
    },
    {
      prompt: "Zašto je refraktorno razdoblje važno za pravilan rad živčanog sustava?",
      answerGuide:
        "Tijekom refraktornog razdoblja neuron nije podražljiv, pa se akcijski potencijal ne može vratiti unatrag duž aksona. To osigurava jednosmjerno provođenje i ograničava najveću frekvenciju okidanja.",
      difficulty: "hard",
      expectedAnswer:
        "Osigurava jednosmjerno širenje signala i ograničava frekvenciju akcijskih potencijala.",
      strengths: "Prepoznaješ zaštitnu ulogu refraktornog razdoblja.",
      missingPoints: "Razlikuj apsolutno i relativno refraktorno razdoblje.",
    },
  ],
  transcript: [],
  chatAnswers: [
    "Mijelinska ovojnica djeluje kao izolator, pa se depolarizacija događa samo u Ranvierovim suženjima. Signal tako doslovno preskače od suženja do suženja, što zovemo saltatornim ili skokovitim provođenjem, a ono je znatno brže od kontinuiranog.",
    "Načelo sve ili ništa znači da akcijski potencijal nastaje u punoj veličini ili ga uopće nema. Zato jači podražaj ne povećava amplitudu, nego frekvenciju okidanja i broj aktiviranih vlakana.",
    "I ganglij i jezgra nakupine su tijela živčanih stanica – razlika je samo u položaju. Ganglij leži izvan središnjeg živčanog sustava, a jezgra unutar njega. To je često ispitno pitanje.",
    "Prijenos preko sinapse teče ovako: akcijski potencijal dosegne završni čvorić, otvaraju se kalcijevi kanali, kalcij pokreće stapanje vezikula s membranom, neurotransmiter se otpušta u pukotinu i veže se na receptore sljedeće stanice.",
  ],
};

const ERP_CLANEK: DemoNotePack = {
  key: "erp",
  title: "Članak: ERP sustavi u praksi",
  sourceType: "link",
  durationSeconds: null,
  summary:
    "Članak objašnjava što je ERP sustav, koje module poduzeća uvode najprije, zašto uvođenja često premaše proračun i koji pokazatelji otkrivaju je li se ulaganje isplatilo.",
  keyTopics: [
    "Definicija ERP sustava",
    "Ključni moduli",
    "Tijek uvođenja",
    "Najčešći razlozi neuspjeha",
    "Mjerenje isplativosti",
  ],
  notesMd: `## Brzi pregled

ERP je jedinstveni informacijski sustav koji poslovne procese različitih odjela povezuje u zajedničku bazu podataka. Umjesto zasebnih programa za financije, nabavu i proizvodnju, svi rade s istim podacima u stvarnom vremenu. Najveći izazov uvođenja nije tehnologija, nego promjena radnih navika.

> **Ključno:** Vrijednost ERP sustava ne nastaje pri instalaciji, nego onda kad poduzeće svoje procese prilagodi sustavu, a ne obrnuto.

## Ključne stvari koje moraš znati

- ERP znači Enterprise Resource Planning, odnosno planiranje resursa poduzeća.
- Temelj sustava je jedna zajednička baza podataka za sve module.
- Najčešće se najprije uvode financijski modul i modul nabave.
- Prilagođavanje standardnog rješenja glavni je izvor prekoračenja troškova.
- Uspjeh uvođenja više ovisi o podršci uprave i edukaciji nego o izboru isporučitelja.

| Modul | Što pokriva | Tipična korist |
| --- | --- | --- |
| Financije | Glavna knjiga, potraživanja, obveze | Brže zaključivanje razdoblja |
| Nabava | Narudžbe, dobavljači, zalihe | Niže zalihe i bolji uvjeti |
| Proizvodnja | Radni nalozi, sastavnice | Kraći rokovi isporuke |
| Ljudski resursi | Evidencija, plaće, odsutnosti | Manje ručnog rada |

## 1. 🏢 Što je ERP sustav

### Glavna ideja

ERP je cjelovito programsko rješenje koje poslovne procese poduzeća povezuje oko jedne zajedničke baze podataka.

### Detaljne bilješke

Prije ERP-a odjeli su koristili zasebne programe, a podatke su prenosili ručno ili putem izvještaja. Zbog toga su nastajala odstupanja među odjelima. ERP to uklanja tako što se svaki događaj zapisuje jednom i odmah je vidljiv svima.

- **Definicija:** Modul je funkcionalno zaokružen dio sustava za određeno poslovno područje.
- Sustav je dobar samo onoliko koliko su kvalitetni uneseni podaci.
- Suvremena rješenja sve su češće u oblaku, što snižava početni trošak.

## 2. 🧩 Uvođenje po fazama

### Glavna ideja

Uvođenje se odvija u fazama jer istodobni prijelaz svih odjela znatno povećava rizik.

### Detaljne bilješke

Poduzeća obično počinju s financijskim modulom jer su ondje procesi najviše standardizirani. Slijede nabava, prodaja i tek onda proizvodnja, koja najviše ovisi o pojedinoj djelatnosti.

### Proces

- Analiza postojećih procesa i popis zahtjeva.
- Izbor isporučitelja i određivanje opsega projekta.
- Konfiguracija, migracija podataka i testiranje.
- Edukacija korisnika i produkcijsko pokretanje.
- Stabilizacija i postupno dodavanje modula.

## 3. ⚠️ Zašto uvođenja ne uspijevaju

### Glavna ideja

Većina neuspješnih projekata propada zbog organizacijskih, a ne tehničkih razloga.

### Detaljne bilješke

Najčešći su uzroci nejasan opseg projekta, pretjerano prilagođavanje standardnog rješenja, loša kvaliteta prenesenih podataka i premalo edukacije. Svaka prilagodba povećava i troškove svake buduće nadogradnje.

> **Česta pogreška:** Poduzeće prenese star, neučinkovit proces u novi sustav i zatim utvrdi da se ništa nije poboljšalo.

## 4. 📊 Mjerenje isplativosti

### Glavna ideja

Isplativost mjerimo poslovnim pokazateljima prije i poslije uvođenja, a ne dojmom korisnika.

### Detaljne bilješke

Najčešće se prate vrijeme zaključivanja mjeseca, obrtaj zaliha, udio zakašnjelih isporuka i broj ručnih ispravaka. Stvarni učinak obično se pokaže tek nakon nekoliko mjeseci stabilizacije.

### Provjeri svoje znanje

- Koja je glavna prednost zajedničke baze podataka?
- Zašto uvođenje obično počinje financijskim modulom?
- Koja su tri najčešća razloga neuspjeha?
- Kako mjerimo je li se ulaganje isplatilo?

## Završni pregled

- ERP povezuje odjele oko jedne baze podataka.
- Uvođenje treba teći po fazama, počevši od najstandardiziranijih procesa.
- Pretjerano prilagođavanje glavni je izvor prekoračenja proračuna.
- Kvaliteta podataka i edukacija odlučuju o uspjehu.
- Isplativost dokazuju mjerljivi pokazatelji prije i poslije uvođenja.`,
  images: [
    {
      file: "hr/erp-moduli.svg",
      fileName: "erp-moduli.png",
      alt: "Moduli ERP sustava oko zajedničke baze podataka",
      afterText: "Prije ERP-a odjeli su koristili zasebne programe",
    },
    {
      file: "hr/erp-uvedba.svg",
      fileName: "faze-uvodenja.png",
      alt: "Faze uvođenja ERP sustava",
      afterText: "Poduzeća obično počinju s financijskim modulom",
    },
  ],
  sections: [
    { title: "Što je ERP sustav", sourceLabel: "1. dio članka" },
    { title: "Uvođenje po fazama", sourceLabel: "2. dio članka" },
    { title: "Razlozi neuspjeha", sourceLabel: "3. dio članka" },
    { title: "Mjerenje isplativosti", sourceLabel: "4. dio članka" },
  ],
  flashcards: [
    {
      front: "Što znači kratica ERP?",
      back: "Enterprise Resource Planning – planiranje resursa poduzeća.",
      difficulty: "easy",
      sectionIdx: 0,
    },
    {
      front: "Koja je glavna tehnička prednost ERP sustava?",
      back: "Jedna zajednička baza podataka, pa se svaki podatak unosi jednom i odmah je vidljiv svim odjelima.",
      difficulty: "easy",
      sectionIdx: 0,
    },
    {
      front: "Što je modul u ERP sustavu?",
      back: "Funkcionalno zaokružen dio sustava koji pokriva jedno poslovno područje, na primjer financije ili nabavu.",
      difficulty: "medium",
      sectionIdx: 0,
    },
    {
      front: "Kojim modulom uvođenje obično počinje i zašto?",
      back: "Financijskim, jer su financijski procesi najviše standardizirani i najmanje ovise o djelatnosti.",
      difficulty: "medium",
      sectionIdx: 1,
    },
    {
      front: "Nabroji faze uvođenja ERP sustava.",
      back: "Analiza procesa, izbor isporučitelja, konfiguracija i migracija podataka, testiranje, edukacija, pokretanje i stabilizacija.",
      difficulty: "hard",
      sectionIdx: 1,
    },
    {
      front: "Zašto je pretjerano prilagođavanje sustava opasno?",
      back: "Povećava troškove projekta i poskupljuje svaku buduću nadogradnju jer prilagodbe treba svaki put iznova provjeriti.",
      difficulty: "hard",
      sectionIdx: 2,
    },
    {
      front: "Koji su najčešći razlozi neuspjeha uvođenja?",
      back: "Nejasan opseg projekta, pretjerano prilagođavanje, loša kvaliteta podataka i premalo edukacije korisnika.",
      difficulty: "medium",
      sectionIdx: 2,
    },
    {
      front: "Kojim pokazateljima mjerimo isplativost ERP sustava?",
      back: "Vrijeme zaključivanja mjeseca, obrtaj zaliha, udio zakašnjelih isporuka i broj ručnih ispravaka.",
      difficulty: "medium",
      sectionIdx: 3,
    },
  ],
  quiz: [
    {
      prompt: "Koja je osnovna značajka ERP sustava?",
      options: [
        "Svaki odjel ima vlastitu bazu podataka",
        "Svi moduli dijele jednu zajedničku bazu podataka",
        "Sustav radi samo izvan mreže",
        "Namijenjen je isključivo računovodstvu",
      ],
      correctOptionIdx: 1,
      explanation:
        "Zajednička baza podataka bit je ERP sustava i uklanja neusklađenosti među odjelima.",
      difficulty: "easy",
    },
    {
      prompt: "Koji modul poduzeća obično uvode prvi?",
      options: ["Proizvodnja", "Ljudski resursi", "Financije", "Održavanje"],
      correctOptionIdx: 2,
      explanation:
        "Financijski procesi najviše su standardizirani, pa je rizik uvođenja najmanji.",
      difficulty: "medium",
    },
    {
      prompt: "Koji je najčešći uzrok prekoračenja proračuna?",
      options: [
        "Pretjerano prilagođavanje standardnog rješenja",
        "Premalen broj korisnika",
        "Korištenje rješenja u oblaku",
        "Prebrzo pokretanje proizvodnje",
      ],
      correctOptionIdx: 0,
      explanation:
        "Svaka prilagodba poskupljuje projekt i sve buduće nadogradnje sustava.",
      difficulty: "medium",
    },
    {
      prompt: "Zašto je kvaliteta podataka ključna pri migraciji?",
      options: [
        "Jer sustav bez podataka ne radi",
        "Jer pogrešni podaci u novom sustavu dovode do pogrešnih odluka",
        "Jer migracija zahtijeva više poslužitelja",
        "Jer se podaci nakon migracije brišu",
      ],
      correctOptionIdx: 1,
      explanation:
        "Novi sustav ne ispravlja loše podatke, nego ih samo brže širi po poduzeću.",
      difficulty: "hard",
    },
    {
      prompt: "Koji pokazatelj najbolje pokazuje učinak ERP-a na zalihe?",
      options: [
        "Broj korisnika sustava",
        "Obrtaj zaliha",
        "Broj modula",
        "Trajanje edukacije",
      ],
      correctOptionIdx: 1,
      explanation: "Obrtaj zaliha izravno mjeri koliko učinkovito poduzeće upravlja zalihama.",
      difficulty: "medium",
    },
    {
      prompt: "Kada se stvarni učinci uvođenja obično pokažu?",
      options: [
        "Odmah pri pokretanju",
        "Nakon nekoliko mjeseci stabilizacije",
        "Tek nakon promjene isporučitelja",
        "Nikad ih nije moguće izmjeriti",
      ],
      correctOptionIdx: 1,
      explanation:
        "Nakon pokretanja slijedi razdoblje stabilizacije u kojem se korisnici naviknu na nove procese.",
      difficulty: "easy",
    },
  ],
  practice: [
    {
      prompt: "Objasni zašto je zajednička baza podataka glavna prednost ERP sustava.",
      answerGuide:
        "Podatak se unosi jednom i odmah je dostupan svim odjelima, što uklanja dupliciranje, ručne prijenose i neusklađenosti među izvještajima različitih odjela.",
      difficulty: "easy",
      expectedAnswer:
        "Jedan unos, jedan izvor istine, nema ručnih prijenosa između sustava ni odstupanja među odjelima.",
      strengths: "Prepoznaješ uklanjanje dupliciranja podataka.",
      missingPoints: "Dodaj konkretan primjer, na primjer zajednički zapis o zalihama.",
    },
    {
      prompt: "Opiši faze uvođenja ERP sustava i objasni zašto je fazni pristup sigurniji.",
      answerGuide:
        "Analiza, izbor isporučitelja, konfiguracija i migracija, testiranje, edukacija, pokretanje i stabilizacija. Fazni pristup ograničava opseg rizika i omogućuje učenje na manjem dijelu sustava.",
      difficulty: "medium",
      expectedAnswer:
        "Faze slijede jedna drugu od analize do stabilizacije; postupnost smanjuje rizik da istodobno zakažu svi procesi.",
      strengths: "Faze su navedene pravilnim redoslijedom.",
      missingPoints: "Objasni zašto je proizvodni modul obično posljednji.",
    },
    {
      prompt: "Poduzeće ni nakon godinu dana ne vidi koristi od ERP sustava. Što bi prvo provjerio?",
      answerGuide:
        "Jesu li procesi ostali nepromijenjeni, je li edukacija bila dovoljna, kakva je kvaliteta migriranih podataka i mjere li se uopće pravi pokazatelji prije i poslije uvođenja.",
      difficulty: "hard",
      expectedAnswer:
        "Provjerio bih promjenu procesa, edukaciju, kvalitetu podataka i postoje li početna mjerenja.",
      strengths: "Tražiš organizacijske, a ne samo tehničke uzroke.",
      missingPoints: "Spomeni i opseg prilagodbi standardnog rješenja.",
    },
    {
      prompt: "Kako bi izmjerio isplativost ulaganja u ERP sustav?",
      answerGuide:
        "Usporedbom mjerljivih pokazatelja prije i poslije uvođenja: vremena zaključivanja mjeseca, obrtaja zaliha, udjela zakašnjelih isporuka i opsega ručnih ispravaka, uz uzimanje u obzir ukupnih troškova vlasništva.",
      difficulty: "medium",
      expectedAnswer:
        "Postavim početna mjerenja, ponovim ih nakon stabilizacije i usporedim s ukupnim troškovima projekta.",
      strengths: "Naglašavaš početno mjerenje prije uvođenja.",
      missingPoints: "Uključi i troškove održavanja i licenci.",
    },
  ],
  transcript: [],
  chatAnswers: [
    "Glavna prednost je jedna zajednička baza podataka. Podatak se unosi jednom i odmah je vidljiv svim odjelima, pa nema ručnih prijenosa, dupliciranja ni odstupanja između izvještaja financija i nabave.",
    "Poduzeća počinju financijskim modulom jer su financijski procesi najviše standardizirani i najmanje ovise o djelatnosti. Proizvodni modul dolazi posljednji jer je najspecifičniji.",
    "Najčešći razlozi neuspjeha su organizacijski: nejasan opseg projekta, pretjerano prilagođavanje standardnog rješenja, loša kvaliteta migriranih podataka i premalo edukacije korisnika.",
    "Isplativost izmjeriš tako da prije uvođenja zabilježiš početne pokazatelje – vrijeme zaključivanja mjeseca, obrtaj zaliha, udio zakašnjelih isporuka – i nakon nekoliko mjeseci stabilizacije ih ponovno izmjeriš.",
  ],
};

const ZGODOVINA: DemoNotePack = {
  key: "zgodovina",
  title: "Povijest – Francuska revolucija",
  sourceType: "presentation",
  pageCount: 18,
  durationSeconds: null,
  summary:
    "Bilješke sažimaju uzroke Francuske revolucije, njezin tijek od sazivanja generalnih staleža do Napoleonova preuzimanja vlasti te dugoročne posljedice za Europu.",
  keyTopics: [
    "Uzroci revolucije",
    "Generalni staleži i Narodna skupština",
    "Deklaracija o pravima",
    "Jakobinska diktatura",
    "Posljedice za Europu",
  ],
  notesMd: `## Brzi pregled

Francuska revolucija počela je kao financijska kriza apsolutističke monarhije i prerasla u temeljit raskid sa starim društvenim poretkom. U deset godina Francuska je prešla put od staleškog društva do republike, a zatim do Napoleonove diktature. Ideje jednakosti pred zakonom unatoč tome su se proširile cijelom Europom.

> **Ključno:** Revolucija nije izbila zbog jedne jedine nepravde, nego zbog podudaranja državnog bankrota, loše žetve i staleškog sustava koji je porezni teret prebacivao na one s najmanje prava.

## Ključne stvari koje moraš znati

- Francusko društvo bilo je podijeljeno na tri staleža, a poreze je plaćao uglavnom treći stalež.
- Državna blagajna bila je iscrpljena zbog ratova i troškova dvora.
- Sazivanje generalnih staleža 1789. pokrenulo je politički spor o načinu glasovanja.
- Deklaracija o pravima čovjeka i građanina uvela je jednakost pred zakonom.
- Revolucija je završila Napoleonovim državnim udarom 1799.

| Razdoblje | Ključni događaj | Posljedica |
| --- | --- | --- |
| 1789. | Sazivanje generalnih staleža, zauzimanje Bastilje | Kraj apsolutizma |
| 1791. | Prvi ustav | Ustavna monarhija |
| 1793.–1794. | Jakobinska diktatura | Teror i masovna smaknuća |
| 1799. | Napoleonov državni udar | Kraj revolucije |

## 1. 🔥 Uzroci

### Glavna ideja

Revoluciju je pokrenulo podudaranje financijskog sloma države i dubokih društvenih nejednakosti.

### Detaljne bilješke

Prva dva staleža, svećenstvo i plemstvo, uglavnom su bila oslobođena poreza, iako su posjedovala najviše imovine. Treći stalež obuhvaćao je više od devedeset posto stanovništva i snosio gotovo cijeli porezni teret. Loša žetva 1788. podigla je cijenu kruha do razine koja je za gradsko stanovništvo značila glad.

- **Definicija:** Staleško društvo poredak je u kojem su prava određena rođenjem, a ne zaslugama.
- Prosvjetiteljske ideje dale su jezik za kritiku apsolutizma.
- Potpora Američkoj revoluciji konačno je ispraznila državnu blagajnu.

## 2. 🏛️ Od generalnih staleža do republike

### Glavna ideja

Spor o načinu glasovanja doveo je treći stalež do proglašenja Narodne skupštine.

### Detaljne bilješke

Kralj je u svibnju 1789. sazvao generalne staleže kako bi odobrili nove poreze. Budući da je svaki stalež imao jedan glas, treći bi stalež uvijek bio nadglasan. U lipnju se proglasio Narodnom skupštinom i zakletvom u dvorani za igru loptom obećao da se neće razići dok Francuska ne dobije ustav.

### Proces

- Svibanj 1789.: sazivanje generalnih staleža u Versaillesu.
- Lipanj 1789.: proglašenje Narodne skupštine i zakletva u dvorani za igru loptom.
- Srpanj 1789.: zauzimanje Bastilje kao simbolični kraj apsolutizma.
- Kolovoz 1789.: Deklaracija o pravima čovjeka i građanina.
- Rujan 1792.: proglašenje republike.

## 3. ⚔️ Jakobinska diktatura

### Glavna ideja

Rat i unutarnje pobune doveli su do izvanrednog režima koji je protivnike uklanjao smrtnim presudama.

### Detaljne bilješke

Odbor javnog spasa pod Robespierreovim vodstvom uveo je opću mobilizaciju, ograničenje cijena i revolucionarne sudove. Teror je prikazivan kao privremeno sredstvo za spas republike, no zahvatio je i same revolucionare.

> **Česta pogreška:** Teror nije bio program cijele revolucije, nego odgovor na posebno razdoblje rata i unutarnje krize.

## 4. 🌍 Posljedice

### Glavna ideja

Revolucija je ukinula feudalne povlastice i proširila načelo jednakosti pred zakonom po Europi.

### Detaljne bilješke

Napoleonovi pohodi prenijeli su zakonik i upravne reforme na osvojena područja. Stari je poredak nakon 1815. djelomično obnovljen, ali se ideja narodnog suvereniteta održala i u 19. stoljeću pokrenula nove pokrete.

### Provjeri svoje znanje

- Zašto je porezni sustav prije revolucije bio neodrživ?
- Što je značila zakletva u dvorani za igru loptom?
- Koji je dokument uveo jednakost pred zakonom?
- Zašto je revolucija završila diktaturom?

## Završni pregled

- Uzroci su bili istodobno financijski, društveni i idejni.
- Zauzimanje Bastilje simbolični je, ali ne i stvarni kraj apsolutizma.
- Deklaracija iz 1789. temelj je modernih građanskih prava.
- Teror je bio odgovor na ratno stanje, a ne cilj revolucije.
- Nasljeđe revolucije ideja je jednakosti pred zakonom i narodnog suvereniteta.`,
  images: [
    {
      file: "hr/revolucija-casovnica.svg",
      fileName: "vremenska-crta-1789-1799.png",
      alt: "Vremenska crta Francuske revolucije od 1789. do 1799.",
      afterText: "Kralj je u svibnju 1789. sazvao generalne staleže",
    },
  ],
  sections: [
    { title: "Uzroci revolucije", sourceLabel: "1. cjelina" },
    { title: "Od staleža do republike", sourceLabel: "2. cjelina" },
    { title: "Jakobinska diktatura", sourceLabel: "3. cjelina" },
    { title: "Posljedice", sourceLabel: "4. cjelina" },
  ],
  flashcards: [
    {
      front: "Kako je francusko društvo bilo podijeljeno prije revolucije?",
      back: "Na tri staleža: svećenstvo, plemstvo i treći stalež, koji je obuhvaćao više od 90 posto stanovništva.",
      difficulty: "easy",
      sectionIdx: 0,
    },
    {
      front: "Zašto je porezni sustav bio neodrživ?",
      back: "Prva dva staleža uglavnom su bila oslobođena poreza, a teret je snosio treći stalež s najmanje prava.",
      difficulty: "medium",
      sectionIdx: 0,
    },
    {
      front: "Što je bila zakletva u dvorani za igru loptom?",
      back: "Obećanje zastupnika Narodne skupštine iz 1789. da se neće razići dok Francuska ne dobije ustav.",
      difficulty: "medium",
      sectionIdx: 1,
    },
    {
      front: "Što simbolizira zauzimanje Bastilje?",
      back: "Simbolični pad apsolutističke vlasti i početak revolucije; 14. srpnja i danas je francuski državni praznik.",
      difficulty: "easy",
      sectionIdx: 1,
    },
    {
      front: "Što je uvela Deklaracija o pravima čovjeka i građanina?",
      back: "Jednakost pred zakonom, slobodu govora i vjere te načelo da vlast proizlazi iz naroda.",
      difficulty: "medium",
      sectionIdx: 1,
    },
    {
      front: "Tko je vodio Odbor javnog spasa?",
      back: "Maximilien Robespierre, u razdoblju jakobinske diktature 1793.–1794.",
      difficulty: "hard",
      sectionIdx: 2,
    },
    {
      front: "Zašto je došlo do terora?",
      back: "Zbog vanjskog rata i unutarnjih pobuna režim je uveo izvanredne mjere i revolucionarne sudove.",
      difficulty: "hard",
      sectionIdx: 2,
    },
    {
      front: "Kada i kako je revolucija završila?",
      back: "Godine 1799. Napoleonovim državnim udarom, koji je republiku pretvorio u osobnu vlast.",
      difficulty: "medium",
      sectionIdx: 3,
    },
  ],
  quiz: [
    {
      prompt: "Koji je stalež snosio najveći porezni teret?",
      options: ["Svećenstvo", "Plemstvo", "Treći stalež", "Svi jednako"],
      correctOptionIdx: 2,
      explanation:
        "Prva dva staleža uglavnom su bila oslobođena poreza, pa je teret pao na treći stalež.",
      difficulty: "easy",
    },
    {
      prompt: "Što je bio neposredni povod za sazivanje generalnih staleža?",
      options: [
        "Pobjeda u ratu",
        "Financijska kriza države",
        "Kraljeva smrt",
        "Otkriće novih područja",
      ],
      correctOptionIdx: 1,
      explanation: "Kralju je trebalo odobrenje novih poreza jer je blagajna bila prazna.",
      difficulty: "medium",
    },
    {
      prompt: "Koji se događaj smatra simboličnim početkom revolucije?",
      options: [
        "Zakletva u dvorani za igru loptom",
        "Zauzimanje Bastilje",
        "Proglašenje republike",
        "Napoleonov udar",
      ],
      correctOptionIdx: 1,
      explanation: "Zauzimanje Bastilje 14. srpnja 1789. simbolični je pad apsolutizma.",
      difficulty: "easy",
    },
    {
      prompt: "Što je utvrdila Deklaracija o pravima čovjeka i građanina?",
      options: [
        "Povratak feudalnih povlastica",
        "Jednakost pred zakonom i narodni suverenitet",
        "Obveznu vojnu službu",
        "Ukidanje privatnog vlasništva",
      ],
      correctOptionIdx: 1,
      explanation:
        "Deklaracija je uvela jednakost pred zakonom i načelo da vlast proizlazi iz naroda.",
      difficulty: "medium",
    },
    {
      prompt: "Jakobinska diktatura bila je ponajprije odgovor na:",
      options: [
        "Gospodarski rast",
        "Vanjski rat i unutarnje pobune",
        "Povratak kralja na prijestolje",
        "Osnivanje kolonija",
      ],
      correctOptionIdx: 1,
      explanation: "Izvanredne mjere opravdavale su se ratnim stanjem i unutarnjim pobunama.",
      difficulty: "hard",
    },
    {
      prompt: "Koje je najtrajnije nasljeđe revolucije?",
      options: [
        "Obnova staleškog društva",
        "Ideja jednakosti pred zakonom i narodnog suvereniteta",
        "Ukidanje vojske",
        "Povratak apsolutizma",
      ],
      correctOptionIdx: 1,
      explanation:
        "Unatoč restauraciji nakon 1815. ideje jednakosti i narodnog suvereniteta su opstale.",
      difficulty: "medium",
    },
  ],
  practice: [
    {
      prompt: "Navedi i objasni tri glavna uzroka Francuske revolucije.",
      answerGuide:
        "Financijski slom države zbog ratova i troškova dvora, društvena nejednakost staleškog društva s poreznim povlasticama te prosvjetiteljske ideje koje su dale jezik za kritiku apsolutizma. Loša žetva 1788. bila je okidač.",
      difficulty: "medium",
      expectedAnswer:
        "Financijska kriza, staleška nejednakost i prosvjetiteljske ideje, uz okidač u obliku skupoće kruha.",
      strengths: "Razlikuješ dugoročne uzroke od neposrednog povoda.",
      missingPoints: "Dodaj ulogu potpore Američkoj revoluciji u pražnjenju blagajne.",
    },
    {
      prompt: "Objasni zašto je spor o glasovanju u generalnim staležima doveo do raskida.",
      answerGuide:
        "Glasovalo se po staležima, pa bi treći stalež uvijek bio nadglasan s dva prema jedan, iako je predstavljao veliku većinu stanovništva. Zahtjev za glasovanjem po glavi odbijen je, pa se treći stalež proglasio Narodnom skupštinom.",
      difficulty: "hard",
      expectedAnswer:
        "Glasovanje po staležima uvijek je treći stalež stavljalo u manjinu, pa se osamostalio kao Narodna skupština.",
      strengths: "Prepoznaješ mehanizam nadglasavanja.",
      missingPoints: "Spomeni zakletvu u dvorani za igru loptom kao točku s koje nema povratka.",
    },
    {
      prompt: "Zašto je revolucija koja je počela zahtjevom za slobodom završila diktaturom?",
      answerGuide:
        "Rat, unutarnje pobune i gospodarska kriza doveli su do izvanrednih mjera i terora. Nakon Robespierreova pada nastala je politička nestabilnost koju je uz potporu vojske iskoristio Napoleon.",
      difficulty: "hard",
      expectedAnswer:
        "Zbog ratnog stanja, terora i kasnije nestabilnosti Direktorija, koju je iskoristila vojska.",
      strengths: "Povezuješ vanjsku ugroženost s unutarnjom radikalizacijom.",
      missingPoints: "Dodaj ulogu vojske kao jamca reda nakon 1795.",
    },
    {
      prompt: "Kakve su bile posljedice revolucije za ostatak Europe?",
      answerGuide:
        "Napoleonovi pohodi proširili su Građanski zakonik i upravne reforme, uklonili feudalne ostatke i potaknuli nacionalne pokrete. Nakon 1815. stari je poredak djelomično obnovljen, ali su ideje ostale žive.",
      difficulty: "medium",
      expectedAnswer:
        "Širenje Građanskog zakonika i jednakosti pred zakonom, ukidanje feudalnih ostataka i uspon nacionalnih pokreta.",
      strengths: "Prepoznaješ prijenos ideja vojnim pohodima.",
      missingPoints: "Spomeni Bečki kongres i pokušaj restauracije.",
    },
  ],
  transcript: [],
  chatAnswers: [
    "Glavna su tri uzroka i djelovala su istodobno: državni bankrot nakon skupih ratova, staleško društvo s poreznim povlasticama za prva dva staleža te prosvjetiteljske ideje koje su dale jezik za kritiku apsolutizma. Skupoća kruha 1788. bila je okidač.",
    "U generalnim staležima svaki je stalež imao jedan glas, pa bi treći stalež uvijek bio nadglasan s dva prema jedan – iako je predstavljao više od 90 posto stanovništva. Zato se u lipnju 1789. proglasio Narodnom skupštinom.",
    "Teror je bio odgovor na izvanredne prilike: Francuska je ratovala sa savezom europskih monarhija i suočavala se s unutarnjim pobunama. Odbor javnog spasa opravdavao je izvanredne mjere spašavanjem republike.",
    "Deklaracija o pravima čovjeka i građanina iz kolovoza 1789. uvela je jednakost pred zakonom, slobodu govora i vjere te načelo da vlast proizlazi iz naroda, a ne od kralja.",
  ],
};

export const HR_DEMO_CONTENT: DemoLocaleContent = {
  packs: [MIKROEKONOMIJA, ANATOMIJA, ERP_CLANEK, ZGODOVINA],
  folderNames: {
    "demo-folder-izpiti": "Ispitni rok",
    "demo-folder-seminarska": "Seminarski rad",
  },
  liveFigures: [
    {
      file: "hr/ponudba-povprasevanje.svg",
      fileName: "graf-ravnoteza.png",
      alt: "Graf ponude i potražnje s točkom ravnoteže",
      anchor: "Kad se promijeni bilo koji čimbenik osim cijene",
    },
    {
      file: "hr/elasticnost.svg",
      fileName: "usporedba-elasticnosti.png",
      alt: "Usporedba elastične i neelastične potražnje",
      anchor: "Elastičnost mjeri osjetljivost količine na promjenu cijene",
    },
    {
      file: "hr/premik-krivulje.svg",
      fileName: "pomak-potraznje.png",
      alt: "Pomak krivulje potražnje udesno i nova ravnoteža",
      anchor: "Krivulja potražnje opada jer svaka dodatna jedinica",
    },
    {
      file: "hr/substituti-komplementi.svg",
      fileName: "supstituti-i-komplementi.png",
      alt: "Supstituti se međusobno zamjenjuju, komplementi se koriste zajedno",
      anchor: "dobra koja se međusobno zamjenjuju",
    },
    {
      file: "hr/premik-ponudbe.svg",
      fileName: "pomak-ponude.png",
      alt: "Pomak krivulje ponude udesno zbog nižih troškova",
      anchor: "Troškovi rada i sirovina pomiču krivulju ponude",
    },
    {
      file: "hr/presezek-primanjkljaj.svg",
      fileName: "visak-i-manjak.png",
      alt: "Višak ponude iznad ravnotežne cijene i manjak ispod nje",
      anchor: "Ako je cijena previsoka, roba ostaje neprodana",
    },
    {
      file: "hr/prihodek-elasticnost.svg",
      fileName: "prihod-i-elasticnost.png",
      alt: "Ukupni prihod najveći je ondje gdje je elastičnost jednaka 1",
      anchor: "Kad je rezultat po apsolutnoj vrijednosti veći od 1",
    },
  ],
  liveHighlights: [
    { phrase: "Ta je točka tržišna ravnoteža", color: "green" },
    { phrase: "Cijena ne pomiče krivulju", color: "purple" },
    { phrase: "Tražena količina je količina pri jednoj cijeni", color: "green" },
    {
      phrase: "Ravnoteža je jedina cijena pri kojoj nema ni viška ni manjka",
      color: "green",
    },
    { phrase: "Pomak po krivulji izaziva samo promjena cijene", color: "purple" },
    { phrase: "malo supstituta, kratak rok, nužna dobra", color: "green" },
    { phrase: "prihod je najveći ondje gdje je elastičnost jednaka 1", color: "purple" },
    {
      phrase: "Najčešća pogreška na ispitu je zamjena pomaka krivulje pomakom po krivulji",
      color: "purple",
    },
  ],
  podcastTurns: [
    { speaker: "a", text: "Pogledajmo ovu bilješku — što je ono što stvarno moraš zapamtiti?" },
    { speaker: "b", text: "Najprije okvir: bez njega su pojedini podaci samo popis." },
    { speaker: "a", text: "Znači, prvo shvatiš čemu služi, a tek onda ideš na detalje." },
    { speaker: "b", text: "Točno. A kad to jednom sjedne, detalji ti ostanu gotovo sami od sebe." },
    { speaker: "a", text: "Dobro. Idemo sad redom i provjerimo gdje najčešće zapne." },
    { speaker: "b", text: "Može. A na kraju sve sažmemo u jednu rečenicu, da ti ostane za ispit." },
  ],
};
