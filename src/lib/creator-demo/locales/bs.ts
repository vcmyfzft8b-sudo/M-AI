/**
 * The `/creator` demo in Bosnian (ijekavian, Latin script), translated from the
 * Slovenian source in `./sl.ts`. See `../content.ts` for what each field is and
 * the rules a translation has to keep.
 */
import type { DemoLocaleContent, DemoNotePack } from "@/lib/creator-demo/content-types";

const MIKROEKONOMIJA: DemoNotePack = {
  key: "mikroekonomija",
  title: "Mikroekonomija – ponuda i potražnja",
  sourceType: "audio",
  durationSeconds: 2842,
  summary:
    "Predavanje objašnjava kako krive ponude i potražnje određuju tržišnu ravnotežu, šta pomjera cijelu krivu i kako elastičnost pokazuje koliko količina reaguje na promjenu cijene.",
  keyTopics: [
    "Zakon potražnje",
    "Zakon ponude",
    "Tržišna ravnoteža",
    "Pomjeranje krive naspram kretanja duž krive",
    "Cjenovna elastičnost",
  ],
  notesMd: `## Brzi pregled

Tržište funkcioniše kao pregovaranje između kupaca i prodavača: kupci žele nisku cijenu, prodavači visoku, a cijena se ustali tamo gdje se željena količina kupovine i prodaje poklope. Ta tačka je tržišna ravnoteža. Kada se promijeni bilo koji faktor osim cijene, pomjera se cijela kriva i nastaje nova ravnoteža.

> **Ključno:** Cijena ne pomjera krivu – pomjera samo tačku na njoj. Krivu pomjeraju dohodak, cijene drugih dobara, očekivanja, tehnologija i broj učesnika na tržištu.

## Ključne stvari koje moraš znati

- Zakon potražnje: uz višu cijenu kupci, kada su ostali uslovi nepromijenjeni, kupuju manje.
- Zakon ponude: uz višu cijenu proizvođači nude više, jer je proizvodnja isplativija.
- Ravnoteža je jedina cijena pri kojoj nema ni viška ni manjka.
- Iznad ravnotežne cijene nastaje višak ponude, ispod nje manjak.
- Kretanje duž krive izaziva samo promjena cijene; pomjeranje krive izaziva sve ostalo.
- Elastičnost mjeri osjetljivost količine na promjenu cijene i određuje da li poskupljenje povećava ili smanjuje prihod.

| Događaj | Koja kriva | Smjer pomjeranja | Uticaj na ravnotežnu cijenu |
| --- | --- | --- | --- |
| Rast dohotka kupaca | Potražnja | Udesno | Raste |
| Jeftinije sirovine | Ponuda | Udesno | Pada |
| Novi konkurent na tržištu | Ponuda | Udesno | Pada |
| Očekivano buduće poskupljenje | Potražnja | Udesno | Raste |

## 1. 📉 Potražnja

### Glavna ideja

Potražnja pokazuje koliko jedinica nekog dobra su kupci spremni i u stanju kupiti pri svakoj cijeni u datom periodu.

### Detaljne bilješke

Kriva potražnje opada jer svaka dodatna jedinica kupcu donosi manju dodatnu korist, a viša cijena istovremeno smanjuje njegovu realnu kupovnu moć. Važno je da govorimo o planiranoj, a ne o stvarno ostvarenoj količini kupovine.

- **Definicija:** Tražena količina je količina pri jednoj jedinoj cijeni, a potražnja je cijeli odnos između cijene i količine.
- Tržišnu potražnju sastavljamo od pojedinačnih potražnji svih kupaca na tržištu.
- Nužna dobra imaju strmiju krivu od luksuznih dobara.

### Ključni pojmovi

- **Supstituti:** dobra koja se međusobno zamjenjuju (čaj i kahva).
- **Komplementi:** dobra koja se koriste zajedno (štampač i toner).
- **Inferiorno dobro:** potražnja pada kada dohodak raste.

## 2. 📈 Ponuda

### Glavna ideja

Ponuda pokazuje koliko jedinica su proizvođači spremni prodati pri svakoj cijeni.

### Detaljne bilješke

Kriva ponude raste jer viša cijena pokriva više granične troškove proizvodnje i privlači nove ponuđače u granu. Zato ponuda kratkoročno reaguje sporije od potražnje – kapaciteti se ne mogu povećati preko noći.

- Troškovi rada i sirovina pomjeraju krivu ponude nagore, odnosno ulijevo.
- Bolja tehnologija snižava troškove po jedinici i pomjera ponudu udesno.
- Porez na proizvod djeluje kao dodatni trošak i smanjuje ponudu.

## 3. ⚖️ Tržišna ravnoteža

### Glavna ideja

Ravnoteža je cijena pri kojoj je tražena količina jednaka ponuđenoj količini.

### Detaljne bilješke

Ako je cijena previsoka, roba ostaje neprodana i prodavači snižavaju cijenu. Ako je cijena preniska, pojavljuju se redovi čekanja i prodavači podižu cijenu. Tržište zato samo gura prema ravnoteži, iako prilagođavanje nije uvijek brzo.

> **Česta greška:** Višak ponude ne znači da su kupci nestali – najčešće znači samo da je cijena iznad ravnotežne.

### Primjer

Ako ulaznica za koncert košta 60 EUR, a ravnotežna cijena je 45 EUR, dio dvorane ostaje prazan. Organizator snižava cijenu, a broj prodanih ulaznica raste duž iste krive potražnje.

## 4. 🔁 Elastičnost

### Glavna ideja

Cjenovna elastičnost potražnje pokazuje za koliko procenata se mijenja količina kada se cijena promijeni za jedan procenat.

### Detaljne bilješke

Elastičnost računamo kao odnos procentualne promjene količine i procentualne promjene cijene. Kada je rezultat po apsolutnoj vrijednosti veći od 1, potražnja je elastična i poskupljenje smanjuje ukupni prihod.

- **Elastična potražnja:** mnogo supstituta, dug vremenski period, luksuzna dobra.
- **Neelastična potražnja:** malo supstituta, kratak rok, nužna dobra.
- **Ključno:** prihod je najveći tamo gdje je elastičnost jednaka 1.

### Provjeri svoje znanje

- Šta se dešava s ravnotežnom cijenom ako istovremeno porastu i ponuda i potražnja?
- Zašto cijena ne pomjera krivu potražnje?
- Kada poskupljenje povećava ukupni prihod preduzeća?
- Koji faktori čine potražnju elastičnijom?

## Završni pregled

- Kriva potražnje opada, kriva ponude raste, a njihovo presjecište je ravnoteža.
- Promjena cijene znači kretanje duž krive, a sve ostalo pomjera cijelu krivu.
- Višak ponude gura cijenu nadolje, a manjak nagore.
- Elastičnost određuje kako poskupljenje utiče na prihod.
- Najčešća greška na ispitu je zamjena pomjeranja krive kretanjem duž krive.`,
  images: [
    {
      file: "bs/ponudba-povprasevanje.svg",
      fileName: "graf-ravnoteza.png",
      alt: "Graf ponude i potražnje s tačkom ravnoteže",
      afterText: "Ako je cijena previsoka, roba ostaje neprodana",
    },
    {
      file: "bs/elasticnost.svg",
      fileName: "elasticnost-poredjenje.png",
      alt: "Poređenje elastične i neelastične potražnje",
      afterText: "Elastičnost računamo kao odnos",
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
      front: "Šta kaže zakon potražnje?",
      back: "Kada su ostali uslovi nepromijenjeni, kupci uz višu cijenu kupuju manju količinu dobra.",
      hint: "Cijena gore, količina dolje.",
      difficulty: "easy",
      sectionIdx: 0,
    },
    {
      front: "Razlika između potražnje i tražene količine?",
      back: "Tražena količina je jedna tačka pri jednoj cijeni, a potražnja je cijeli odnos između cijene i količine, dakle cijela kriva.",
      difficulty: "medium",
      sectionIdx: 0,
    },
    {
      front: "Šta su supstituti?",
      back: "Dobra koja se međusobno zamjenjuju. Poskupljenje jednog povećava potražnju za drugim, na primjer čaj i kahva.",
      difficulty: "easy",
      sectionIdx: 0,
    },
    {
      front: "Zašto kriva ponude raste?",
      back: "Viša cijena pokriva više granične troškove i privlači dodatne ponuđače u granu, pa se isplati proizvesti više.",
      difficulty: "medium",
      sectionIdx: 1,
    },
    {
      front: "Kako porez na proizvod utiče na ponudu?",
      back: "Djeluje kao dodatni trošak po jedinici, pa krivu ponude pomjera ulijevo, odnosno nagore.",
      difficulty: "medium",
      sectionIdx: 1,
    },
    {
      front: "Šta je tržišna ravnoteža?",
      back: "Cijena pri kojoj je tražena količina jednaka ponuđenoj količini, pa nema ni viška ni manjka.",
      difficulty: "easy",
      sectionIdx: 2,
    },
    {
      front: "Šta nastaje kada je cijena iznad ravnotežne?",
      back: "Višak ponude: neprodana roba gura cijenu nadolje, prema ravnoteži.",
      difficulty: "medium",
      sectionIdx: 2,
    },
    {
      front: "Kada se pomjera cijela kriva potražnje?",
      back: "Kada se promijene dohodak, cijene supstituta ili komplemenata, ukusi, očekivanja ili broj kupaca – nikada pri promjeni vlastite cijene.",
      hint: "Sve osim cijene.",
      difficulty: "hard",
      sectionIdx: 2,
    },
    {
      front: "Kako računamo cjenovnu elastičnost potražnje?",
      back: "Procentualnu promjenu količine dijelimo procentualnom promjenom cijene. Apsolutna vrijednost iznad 1 znači elastičnu potražnju.",
      difficulty: "hard",
      sectionIdx: 3,
    },
    {
      front: "Kada poskupljenje povećava ukupni prihod?",
      back: "Kada je potražnja neelastična, odnosno kada se količina relativno mijenja manje od cijene.",
      difficulty: "hard",
      sectionIdx: 3,
    },
  ],
  quiz: [
    {
      prompt: "Cijena kahve poraste. Šta se dešava na tržištu čaja?",
      options: [
        "Potražnja za čajem raste",
        "Potražnja za čajem opada",
        "Ponuda čaja se smanjuje",
        "Na tržištu čaja se ništa ne mijenja",
      ],
      correctOptionIdx: 0,
      explanation:
        "Čaj je supstitut za kahvu, pa dio kupaca prelazi na čaj i kriva potražnje za čajem pomjera se udesno.",
      difficulty: "easy",
    },
    {
      prompt: "Koji događaj pomjera krivu ponude udesno?",
      options: [
        "Rast cijena sirovina",
        "Novi porez na proizvod",
        "Jeftinija proizvodna tehnologija",
        "Rast cijene gotovog proizvoda",
      ],
      correctOptionIdx: 2,
      explanation:
        "Bolja tehnologija snižava troškove po jedinici, pa su proizvođači pri svakoj cijeni spremni ponuditi više.",
      difficulty: "medium",
    },
    {
      prompt: "Cijena je ispod ravnotežne. Šta se dešava?",
      options: [
        "Nastaje višak ponude",
        "Nastaje manjak i cijena raste",
        "Tržište je u ravnoteži",
        "Kriva potražnje se pomjera ulijevo",
      ],
      correctOptionIdx: 1,
      explanation:
        "Pri preniskoj cijeni kupci žele više nego što je dostupno. Manjak gura cijenu nagore, prema ravnoteži.",
      difficulty: "easy",
    },
    {
      prompt: "Promjena vlastite cijene dobra uzrokuje:",
      options: [
        "Kretanje duž krive potražnje",
        "Pomjeranje cijele krive potražnje",
        "Pomjeranje cijele krive ponude",
        "Promjenu elastičnosti",
      ],
      correctOptionIdx: 0,
      explanation:
        "Cijena je na osi grafa, pa njena promjena znači kretanje duž postojeće krive, a ne njeno pomjeranje.",
      difficulty: "medium",
    },
    {
      prompt: "Potražnja je elastična kada je koeficijent elastičnosti:",
      options: [
        "Po apsolutnoj vrijednosti manji od 1",
        "Po apsolutnoj vrijednosti jednak 1",
        "Po apsolutnoj vrijednosti veći od 1",
        "Uvijek negativan",
      ],
      correctOptionIdx: 2,
      explanation:
        "Apsolutna vrijednost iznad 1 znači da se količina relativno mijenja jače od cijene.",
      difficulty: "medium",
    },
    {
      prompt: "Preduzeće prodaje nužno dobro bez supstituta i podigne cijenu. Prihod će najvjerovatnije:",
      options: [
        "Pasti, jer će kupci otići",
        "Porasti, jer je potražnja neelastična",
        "Ostati isti",
        "Zavisiti samo od ponude",
      ],
      correctOptionIdx: 1,
      explanation:
        "Bez supstituta potražnja je neelastična, pa se količina smanjuje relativno manje nego što cijena raste.",
      difficulty: "hard",
    },
    {
      prompt: "Dohodak kupaca raste, a dobro je inferiorno. Potražnja se:",
      options: ["Povećava", "Smanjuje", "Ne mijenja", "Pretvara u ponudu"],
      correctOptionIdx: 1,
      explanation:
        "Kod inferiornih dobara kupci uz veći dohodak prelaze na kvalitetnije zamjene.",
      difficulty: "hard",
    },
    {
      prompt: "Istovremeno rastu i ponuda i potražnja. Šta sigurno važi?",
      options: [
        "Cijena sigurno raste",
        "Cijena sigurno pada",
        "Ravnotežna količina se povećava",
        "Ravnotežna količina se smanjuje",
      ],
      correctOptionIdx: 2,
      explanation:
        "Oba pomjeranja povećavaju količinu, a uticaj na cijenu zavisi od toga koje je pomjeranje jače.",
      difficulty: "hard",
    },
  ],
  practice: [
    {
      prompt:
        "Objasni razliku između kretanja duž krive potražnje i pomjeranja cijele krive. Navedi po jedan primjer za svako.",
      answerGuide:
        "Kretanje duž krive izaziva isključivo promjena vlastite cijene dobra. Pomjeranje cijele krive izazivaju necjenovni faktori: dohodak, cijene supstituta i komplemenata, ukusi, očekivanja i broj kupaca.",
      difficulty: "medium",
      expectedAnswer:
        "Promjena cijene = kretanje duž krive (npr. cijena kahve padne, kupci kupe više kahve). Promjena necjenovnog faktora = pomjeranje krive (npr. dohodak poraste i cijela kriva se pomjeri udesno).",
      strengths: "Jasno razlikuješ cjenovni i necjenovni faktor.",
      missingPoints: "Dodaj i konkretan primjer pomjeranja ulijevo, recimo pad dohotka.",
    },
    {
      prompt:
        "Na tržištu nastane višak ponude. Opiši mehanizam koji tržište vraća u ravnotežu.",
      answerGuide:
        "Višak znači da je cijena iznad ravnotežne. Neprodane zalihe tjeraju prodavače da snize cijenu, što povećava traženu i smanjuje ponuđenu količinu, sve dok se ne izjednače.",
      difficulty: "easy",
      expectedAnswer:
        "Cijena je previsoka, zalihe rastu, prodavači snižavaju cijene, tražena količina raste, a ponuđena pada, sve dok višak ne nestane.",
      strengths: "Tačno prepoznaješ smjer pritiska na cijenu.",
      missingPoints: "Spomeni da se krećemo duž obje krive, a ne da ih pomjeramo.",
    },
    {
      prompt:
        "Preduzeće razmišlja o poskupljenju od 10 posto. Šta mora znati o elastičnosti prije nego što odluči?",
      answerGuide:
        "Ako je potražnja elastična, prihod će pasti, jer će količina pasti za više od 10 posto. Ako je neelastična, prihod će porasti. Ključni faktori su dostupnost supstituta, udio u budžetu kupca i vremenski period.",
      difficulty: "hard",
      expectedAnswer:
        "Mora izračunati cjenovnu elastičnost. Iznad 1 znači gubitak prihoda, ispod 1 rast prihoda. Treba uzeti u obzir supstitute i dugoročnu reakciju kupaca.",
      strengths: "Povezuješ elastičnost s prihodom.",
      missingPoints: "Dodaj da je dugoročna elastičnost obično veća od kratkoročne.",
    },
    {
      prompt:
        "Država uvede porez na proizvod. Objasni uticaj na krivu ponude, ravnotežnu cijenu i količinu.",
      answerGuide:
        "Porez povećava troškove po jedinici i pomjera ponudu ulijevo. Ravnotežna cijena za kupca raste, a ravnotežna količina pada. Poreski teret dijeli se između kupca i prodavača u zavisnosti od elastičnosti.",
      difficulty: "medium",
      expectedAnswer:
        "Ponuda se pomjera ulijevo, cijena raste, količina pada, a poreski teret više snosi ona strana tržišta koja je neelastičnija.",
      strengths: "Prepoznaješ smjer pomjeranja ponude.",
      missingPoints: "Objasni kako se poreski teret raspoređuje prema elastičnosti.",
    },
    {
      prompt: "Zašto ponuda kratkoročno reaguje sporije od potražnje?",
      answerGuide:
        "Proizvodni kapaciteti, ugovori i sirovine kratkoročno su fiksni, pa proizvođači ne mogu brzo povećati obim. Kupci, s druge strane, svoje odluke mogu promijeniti odmah.",
      difficulty: "medium",
      expectedAnswer:
        "Zato što su kapaciteti i inputi kratkoročno ograničeni, dok kupci odluku o kupovini mijenjaju odmah.",
      strengths: "Prepoznaješ vremensku dimenziju prilagođavanja.",
      missingPoints: "Navedi konkretan primjer, recimo izgradnju nove proizvodne linije.",
    },
  ],
  transcript: [
    {
      startMs: 0,
      endMs: 28000,
      speakerLabel: "Predavač",
      text: "Dobro jutro. Danas završavamo poglavlje o tržištu, dakle ponudu, potražnju i ravnotežu. To je gradivo koje će vam na ispitu trebati praktično u svakom zadatku.",
    },
    {
      startMs: 28000,
      endMs: 74000,
      speakerLabel: "Predavač",
      text: "Počnimo s potražnjom. Potražnja nije jedan jedini broj, nego odnos između cijene i količine. Kada cijena raste, tražena količina opada. To je zakon potražnje.",
    },
    {
      startMs: 74000,
      endMs: 132000,
      speakerLabel: "Predavač",
      text: "Pazite na razliku koju studenti najčešće promaše. Tražena količina je jedna tačka na krivoj, a potražnja je cijela kriva. Ako se promijeni cijena, krećemo se duž krive.",
    },
    {
      startMs: 132000,
      endMs: 205000,
      speakerLabel: "Predavač",
      text: "Krivu pomjeraju drugi faktori: dohodak, cijene supstituta i komplemenata, ukusi, očekivanja i broj kupaca na tržištu. Ako dohodak poraste, kriva se pomjera udesno.",
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
      text: "Tačno tako. Kod inferiornih dobara veći dohodak smanjuje potražnju, jer kupci prelaze na kvalitetniju zamjenu.",
    },
    {
      startMs: 680000,
      endMs: 742000,
      speakerLabel: "Predavač",
      text: "Pređimo na ponudu. Kriva ponude raste jer viša cijena pokriva više granične troškove i privlači nove proizvođače u granu.",
    },
    {
      startMs: 742000,
      endMs: 815000,
      speakerLabel: "Predavač",
      text: "Ponudu pomjeraju troškovi sirovina, tehnologija, porezi i subvencije. Nova tehnologija snižava troškove po jedinici i pomjera ponudu udesno.",
    },
    {
      startMs: 1445000,
      endMs: 1512000,
      speakerLabel: "Predavač",
      text: "Ravnoteža je presjecište obje krive. To je jedina cijena pri kojoj nema viška i nema manjka.",
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
      text: "Posljednja tema je elastičnost. Elastičnost je procentualna promjena količine podijeljena procentualnom promjenom cijene.",
    },
    {
      startMs: 2276000,
      endMs: 2360000,
      speakerLabel: "Predavač",
      text: "Ako je apsolutna vrijednost veća od jedan, potražnja je elastična i poskupljenje smanjuje prihod. Ako je manja od jedan, poskupljenje povećava prihod.",
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
      text: "Za sljedeći put pregledajte primjere od jedan do pet. Na ispitu će sigurno biti zadatak s pomjeranjem krive, zato vježbajte crtanje grafova.",
    },
  ],
  chatAnswers: [
    "Ukratko: kriva potražnje opada jer svaka dodatna jedinica kupcu donosi manju korist, a viša cijena istovremeno smanjuje njegovu realnu kupovnu moć. Zato pri višoj cijeni kupci planiraju kupiti manju količinu.",
    "Razlika je u tome šta se pomjera. Ako se promijeni cijena samog dobra, krećeš se duž postojeće krive. Ako se promijeni bilo šta drugo – dohodak, cijena supstituta, očekivanja – pomjera se cijela kriva.",
    "Da, to je klasično ispitno pitanje. Ako je potražnja neelastična (koeficijent ispod 1), poskupljenje povećava ukupni prihod, jer količina pada relativno manje nego što cijena raste. Kod elastične potražnje učinak je obrnut.",
    "Višak ponude znači da je cijena iznad ravnotežne. Zalihe rastu, prodavači snižavaju cijenu, pa se tražena količina povećava, a ponuđena smanjuje, sve dok se tržište ne vrati u ravnotežu.",
  ],
};

const ANATOMIJA: DemoNotePack = {
  key: "anatomija",
  title: "Anatomija – građa nervnog sistema",
  sourceType: "pdf",
  durationSeconds: null,
  pageCount: 24,
  summary:
    "Skripta dijeli nervni sistem na centralni i periferni dio, opisuje neuron kao osnovnu jedinicu i objašnjava kako akcijski potencijal i sinapsa prenose informaciju kroz tijelo.",
  keyTopics: [
    "Centralni i periferni nervni sistem",
    "Građa neurona",
    "Akcijski potencijal",
    "Sinaptički prenos",
    "Autonomni nervni sistem",
  ],
  notesMd: `## Brzi pregled

Nervni sistem je informacioni sistem tijela: prima podražaje, obrađuje ih i pokreće odgovor. Anatomski ga dijelimo na centralni nervni sistem, koji obrađuje informacije, i periferni nervni sistem, koji ih prenosi između tijela i mozga. Osnovna funkcionalna jedinica je neuron, koji informaciju prenosi elektrohemijski.

> **Ključno:** Električni signal putuje unutar neurona, a između neurona se prenos uvijek pretvara u hemijski signal preko sinapse.

## Ključne stvari koje moraš znati

- Centralni nervni sistem čine mozak i kičmena moždina.
- Periferni nervni sistem čine nervi i gangliji izvan centralnog nervnog sistema.
- Neuron ima dendrite, tijelo, akson i završne čvoriće.
- Mijelinski omotač ubrzava provođenje skokovitim provođenjem između Ranvierovih suženja.
- Akcijski potencijal je odgovor po pravilu sve ili ništa.
- Autonomni nervni sistem dijelimo na simpatički i parasimpatički dio, koji djeluju suprotno.

| Dio nervnog sistema | Glavni zadatak | Karakteristična struktura |
| --- | --- | --- |
| Centralni | Obrada i pohranjivanje informacija | Moždana kora, kičmena moždina |
| Somatski | Svjesno kretanje i opažanje | Motorna i senzorna vlakna |
| Simpatički | Aktivacija, borba ili bijeg | Preovladava noradrenalin |
| Parasimpatički | Smirivanje, probava i obnova | Preovladava acetilholin |

## 1. 🧠 Podjela nervnog sistema

### Glavna ideja

Nervni sistem funkcionalno dijelimo na centralni dio, koji obrađuje informacije, i periferni dio, koji ih prenosi.

### Detaljne bilješke

Mozak i kičmena moždina čine centralni nervni sistem, zaštićen kostima, moždanim ovojnicama i likvorom. Periferni nervni sistem čine nervi koji povezuju centralni dio s organima, mišićima i kožom.

- Somatski dio upravlja svjesnim pokretima skeletnih mišića.
- Autonomni dio reguliše rad organa bez svjesne kontrole.
- Kičmena moždina nije samo kabl: sama izvodi refleksni luk bez posredovanja mozga.

### Ključni pojmovi

- **Ganglion:** skup nervnih ćelija izvan centralnog nervnog sistema.
- **Jedro:** skup nervnih ćelija unutar centralnog nervnog sistema.
- **Refleksni luk:** najkraći put od receptora do efektora.

## 2. 🔬 Neuron

### Glavna ideja

Neuron je ćelija specijalizovana za primanje, provođenje i predaju električnog signala.

### Detaljne bilješke

Dendriti primaju signale, tijelo ih sabira, a akson provodi akcijski potencijal do završnih čvorića. Mijelinski omotač djeluje kao izolator, pa signal preskače između Ranvierovih suženja i putuje znatno brže.

- **Definicija:** Aksonski brežuljak je mjesto gdje se odlučuje da li će akcijski potencijal biti pokrenut.
- Glija ćelije hrane i podupiru neurone i stvaraju mijelin.
- Deblji i jače mijelinizirani akson provodi brže.

## 3. ⚡ Akcijski potencijal

### Glavna ideja

Akcijski potencijal je brz preokret membranskog napona koji se bez slabljenja širi duž aksona.

### Detaljne bilješke

U mirovanju je unutrašnjost ćelije negativna. Kada podražaj dostigne prag, otvaraju se natrijevi kanali, natrij ulazi u ćeliju i nastaje depolarizacija. Slijedi izlazak kalija, odnosno repolarizacija, a zatim kratak refraktorni period.

> **Česta greška:** Jači podražaj ne stvara veći akcijski potencijal – povećava samo frekvenciju okidanja.

### Proces

- Podražaj dostiže prag podražljivosti.
- Natrijevi kanali se otvaraju i slijedi depolarizacija.
- Kalijevi kanali se otvaraju i slijedi repolarizacija.
- Natrij-kalij pumpa vraća potencijal mirovanja.

## 4. 🔗 Sinapsa

### Glavna ideja

Sinapsa je spoj dva neurona, gdje se električni signal pretvara u hemijski.

### Detaljne bilješke

Kada akcijski potencijal stigne do završnog čvorića, otvaraju se kalcijevi kanali. Vezikule s neurotransmiterom stapaju se s membranom i otpuštaju prenosilac u sinaptičku pukotinu, gdje se veže za receptore sljedeće ćelije.

- Ekscitacijski prenosioci povećavaju vjerovatnoću novog akcijskog potencijala.
- Inhibicijski prenosioci tu vjerovatnoću smanjuju.
- Prenosilac se nakon djelovanja razgrađuje ili vraća u presinaptičku ćeliju.

### Provjeri svoje znanje

- Koje strukture čine centralni nervni sistem?
- Zašto mijelin ubrzava provođenje?
- Šta znači pravilo sve ili ništa?
- Kako se signal prenosi između dva neurona?

## Završni pregled

- Centralni nervni sistem obrađuje, a periferni prenosi informacije.
- Neuron čine dendriti, tijelo, akson i završni čvorići.
- Akcijski potencijal radi po pravilu sve ili ništa, a jačinu podražaja kodira frekvencija.
- Mijelin omogućava skokovito i brže provođenje.
- Sinapsa pretvara električni signal u hemijski i nazad.`,
  images: [
    {
      file: "bs/nevron.svg",
      fileName: "sema-neurona.png",
      alt: "Građa neurona s dendritima, tijelom, aksonom i završnim čvorićima",
      afterText: "Dendriti primaju signale, tijelo ih sabira",
    },
    {
      file: "bs/akcijski-potencial.svg",
      fileName: "akcijski-potencijal.png",
      alt: "Tok akcijskog potencijala kroz vrijeme",
      afterText: "U mirovanju je unutrašnjost ćelije negativna",
    },
  ],
  sections: [
    { title: "Podjela nervnog sistema", sourceLabel: "str. 3–7" },
    { title: "Građa neurona", sourceLabel: "str. 8–12" },
    { title: "Akcijski potencijal", sourceLabel: "str. 13–18" },
    { title: "Sinaptički prenos", sourceLabel: "str. 19–24" },
  ],
  flashcards: [
    {
      front: "Šta čini centralni nervni sistem?",
      back: "Mozak i kičmena moždina, zaštićeni kostima, moždanim ovojnicama i likvorom.",
      difficulty: "easy",
      sectionIdx: 0,
    },
    {
      front: "Razlika između gangliona i jedra?",
      back: "Ganglion je skup nervnih ćelija izvan centralnog nervnog sistema, a jedro unutar njega.",
      difficulty: "hard",
      sectionIdx: 0,
    },
    {
      front: "Šta je refleksni luk?",
      back: "Najkraći nervni put od receptora preko kičmene moždine do efektora, bez posredovanja mozga.",
      difficulty: "medium",
      sectionIdx: 0,
    },
    {
      front: "Nabroji glavne dijelove neurona.",
      back: "Dendriti, tijelo ćelije, akson i završni čvorići.",
      hint: "Od prijema do predaje signala.",
      difficulty: "easy",
      sectionIdx: 1,
    },
    {
      front: "Zašto mijelinski omotač ubrzava provođenje?",
      back: "Djeluje kao izolator, pa signal preskače između Ranvierovih suženja – to je skokovito provođenje.",
      difficulty: "medium",
      sectionIdx: 1,
    },
    {
      front: "Šta se dešava na aksonskom brežuljku?",
      back: "Tu se sabiraju ulazni signali i odlučuje da li će prag biti premašen i akcijski potencijal pokrenut.",
      difficulty: "hard",
      sectionIdx: 1,
    },
    {
      front: "Šta znači pravilo sve ili ništa?",
      back: "Akcijski potencijal se ili pokrene u punoj veličini ili se uopšte ne pokrene. Jačina podražaja kodira se frekvencijom okidanja.",
      difficulty: "medium",
      sectionIdx: 2,
    },
    {
      front: "Koji jon izaziva depolarizaciju?",
      back: "Natrij, koji ulazi u ćeliju kada se otvore naponski zavisni kanali.",
      difficulty: "easy",
      sectionIdx: 2,
    },
    {
      front: "Šta je refraktorni period?",
      back: "Kratko razdoblje poslije akcijskog potencijala u kojem neuron nije podražljiv, što osigurava jednosmjerno širenje signala.",
      difficulty: "hard",
      sectionIdx: 2,
    },
    {
      front: "Kako teče prenos preko sinapse?",
      back: "Akcijski potencijal pokreće ulazak kalcija, vezikule otpuštaju neurotransmiter u pukotinu, a on se veže za receptore sljedeće ćelije.",
      difficulty: "medium",
      sectionIdx: 3,
    },
  ],
  quiz: [
    {
      prompt: "Koji par čini centralni nervni sistem?",
      options: [
        "Mozak i kičmena moždina",
        "Mozak i periferni nervi",
        "Kičmena moždina i gangliji",
        "Nervi i receptori",
      ],
      correctOptionIdx: 0,
      explanation: "Centralni nervni sistem po definiciji čine mozak i kičmena moždina.",
      difficulty: "easy",
    },
    {
      prompt: "Šta omogućava skokovito provođenje signala?",
      options: [
        "Debljina dendrita",
        "Mijelinski omotač s Ranvierovim suženjima",
        "Broj sinapsi",
        "Veličina tijela ćelije",
      ],
      correctOptionIdx: 1,
      explanation:
        "Mijelin izoluje akson, pa se depolarizacija dešava samo u suženjima i signal preskače.",
      difficulty: "medium",
    },
    {
      prompt: "Jači podražaj uzrokuje:",
      options: [
        "Veći akcijski potencijal",
        "Duži akcijski potencijal",
        "Višu frekvenciju akcijskih potencijala",
        "Sporije provođenje",
      ],
      correctOptionIdx: 2,
      explanation:
        "Zbog pravila sve ili ništa jačina podražaja kodira se frekvencijom, a ne amplitudom.",
      difficulty: "medium",
    },
    {
      prompt: "Koji jon je odgovoran za repolarizaciju?",
      options: ["Natrij", "Kalij", "Kalcij", "Hlor"],
      correctOptionIdx: 1,
      explanation: "Poslije depolarizacije kalij napušta ćeliju i membranski napon se vraća nadolje.",
      difficulty: "medium",
    },
    {
      prompt: "Šta pokreće otpuštanje neurotransmitera u sinaptičku pukotinu?",
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
      prompt: "Parasimpatički nervni sistem prije svega:",
      options: [
        "Priprema tijelo za borbu ili bijeg",
        "Ubrzava rad srca",
        "Smiruje tijelo i podstiče probavu",
        "Upravlja svjesnim kretanjem",
      ],
      correctOptionIdx: 2,
      explanation: "Parasimpatikus preovladava u mirovanju i podržava probavu i obnovu.",
      difficulty: "easy",
    },
    {
      prompt: "Skup nervnih ćelija izvan centralnog nervnog sistema zovemo:",
      options: ["Jedro", "Ganglion", "Sinapsa", "Ovojnica"],
      correctOptionIdx: 1,
      explanation: "Izvan centralnog nervnog sistema to je ganglion, a unutar njega jedro.",
      difficulty: "hard",
    },
  ],
  practice: [
    {
      prompt: "Opiši put signala od dendrita do sljedeće ćelije.",
      answerGuide:
        "Dendriti primaju signal, tijelo ga sabira, na aksonskom brežuljku se, kada je prag premašen, pokreće akcijski potencijal, koji putuje duž aksona do završnih čvorića, gdje se neurotransmiter otpušta u sinaptičku pukotinu.",
      difficulty: "medium",
      expectedAnswer:
        "Dendrit → tijelo ćelije → aksonski brežuljak → akson → završni čvorić → sinaptička pukotina → receptori sljedeće ćelije.",
      strengths: "Redoslijed struktura je tačan.",
      missingPoints: "Spomeni i ulogu kalcija u otpuštanju vezikula.",
    },
    {
      prompt: "Objasni pravilo sve ili ništa i reci kako tijelo kodira jačinu podražaja.",
      answerGuide:
        "Akcijski potencijal se pokreće u punoj veličini ili se uopšte ne pokreće. Jači podražaj povećava frekvenciju okidanja i broj podraženih neurona, a ne amplitudu signala.",
      difficulty: "medium",
      expectedAnswer:
        "Amplituda je uvijek ista; jačina podražaja kodira se frekvencijom akcijskih potencijala i brojem aktiviranih vlakana.",
      strengths: "Tačno navodiš da amplituda ostaje ista.",
      missingPoints: "Dodaj ulogu praga podražljivosti.",
    },
    {
      prompt: "Uporedi simpatički i parasimpatički nervni sistem.",
      answerGuide:
        "Simpatikus priprema tijelo za napor: ubrzava rad srca, širi bronhije i koči probavu. Parasimpatikus djeluje suprotno i preovladava u mirovanju. Glavni prenosioci su noradrenalin i acetilholin.",
      difficulty: "easy",
      expectedAnswer:
        "Simpatikus = aktivacija (borba ili bijeg, noradrenalin), parasimpatikus = smirivanje i probava (acetilholin).",
      strengths: "Suprotna djelovanja su jasno predstavljena.",
      missingPoints: "Navedi bar jedan konkretan organ i učinak na njega.",
    },
    {
      prompt: "Zašto je refraktorni period važan za pravilan rad nervnog sistema?",
      answerGuide:
        "Tokom refraktornog perioda neuron nije podražljiv, pa se akcijski potencijal ne može vratiti unazad duž aksona. To osigurava jednosmjerno provođenje i ograničava najveću frekvenciju okidanja.",
      difficulty: "hard",
      expectedAnswer:
        "Osigurava jednosmjerno širenje signala i ograničava frekvenciju akcijskih potencijala.",
      strengths: "Prepoznaješ zaštitnu ulogu refraktornog perioda.",
      missingPoints: "Razlikuj apsolutni i relativni refraktorni period.",
    },
  ],
  transcript: [],
  chatAnswers: [
    "Mijelinski omotač djeluje kao izolator, pa se depolarizacija dešava samo u Ranvierovim suženjima. Signal tako doslovno preskače od suženja do suženja, što zovemo skokovito provođenje i što je znatno brže od kontinuiranog.",
    "Pravilo sve ili ništa znači da akcijski potencijal ili nastane u punoj veličini ili ga uopšte nema. Zato jači podražaj ne povećava amplitudu, nego frekvenciju okidanja i broj aktiviranih vlakana.",
    "Ganglion i jedro su oboje skupovi tijela nervnih ćelija – razlika je samo u položaju. Ganglion leži izvan centralnog nervnog sistema, a jedro unutar njega. To je često ispitno pitanje.",
    "Prenos preko sinapse teče ovako: akcijski potencijal stigne do završnog čvorića, otvore se kalcijevi kanali, kalcij pokrene stapanje vezikula s membranom, neurotransmiter se otpusti u pukotinu i veže za receptore sljedeće ćelije.",
  ],
};

const ERP_CLANEK: DemoNotePack = {
  key: "erp",
  title: "Članak: ERP sistemi u praksi",
  sourceType: "link",
  durationSeconds: null,
  summary:
    "Članak objašnjava šta je ERP sistem, koje module preduzeća uvode prve, zašto uvođenja često probiju budžet i koji pokazatelji otkrivaju da li se ulaganje isplatilo.",
  keyTopics: [
    "Definicija ERP sistema",
    "Ključni moduli",
    "Tok uvođenja",
    "Najčešći razlozi neuspjeha",
    "Mjerenje isplativosti",
  ],
  notesMd: `## Brzi pregled

ERP je jedinstven informacioni sistem koji poslovne procese različitih odjela povezuje u zajedničku bazu podataka. Umjesto odvojenih programa za finansije, nabavku i proizvodnju, svi rade s istim podacima u realnom vremenu. Najveći izazov uvođenja nije tehnologija, nego promjena radnih navika.

> **Ključno:** Vrijednost ERP sistema ne nastaje pri instalaciji, nego onda kada preduzeće prilagodi svoje procese sistemu, a ne obrnuto.

## Ključne stvari koje moraš znati

- ERP znači Enterprise Resource Planning, odnosno planiranje resursa preduzeća.
- Osnova sistema je jedna jedina zajednička baza podataka za sve module.
- Najčešće se prvo uvode finansijski modul i modul nabavke.
- Prilagođavanje standardnog rješenja glavni je izvor prekoračenja troškova.
- Uspjeh uvođenja više zavisi od podrške uprave i obuke nego od izbora ponuđača.

| Modul | Šta pokriva | Tipična korist |
| --- | --- | --- |
| Finansije | Glavna knjiga, potraživanja, obaveze | Brže zatvaranje perioda |
| Nabavka | Narudžbe, dobavljači, zalihe | Niže zalihe i bolji uslovi |
| Proizvodnja | Radni nalozi, sastavnice | Kraći rokovi isporuke |
| Kadrovi | Evidencija, plate, odsustva | Manje ručnog rada |

## 1. 🏢 Šta je ERP sistem

### Glavna ideja

ERP je cjelovito softversko rješenje koje poslovne procese preduzeća povezuje oko jedne zajedničke baze podataka.

### Detaljne bilješke

Prije ERP-a odjeli su koristili odvojene programe, a podatke su prenosili ručno ili putem izvještaja. Zbog toga su nastajala neslaganja među odjelima. ERP to otklanja tako što se svaki događaj zapisuje jednom i odmah je vidljiv svima.

- **Definicija:** Modul je funkcionalno zaokružen dio sistema za određeno poslovno područje.
- Sistem je dobar onoliko koliko su kvalitetni uneseni podaci.
- Savremena rješenja sve češće su u oblaku, što snižava početni trošak.

## 2. 🧩 Uvođenje po fazama

### Glavna ideja

Uvođenje teče u fazama, jer istovremeni prelazak svih odjela znatno povećava rizik.

### Detaljne bilješke

Preduzeća obično počinju s finansijskim modulom, jer su tamo procesi najviše standardizovani. Slijede nabavka i prodaja, a tek onda proizvodnja, koja je najspecifičnija za granu.

### Proces

- Analiza postojećih procesa i popis zahtjeva.
- Izbor ponuđača i određivanje obima projekta.
- Konfiguracija, migracija podataka i testiranje.
- Obuka korisnika i puštanje u produkciju.
- Stabilizacija i postepeno dodavanje modula.

## 3. ⚠️ Zašto uvođenja propadaju

### Glavna ideja

Većina neuspješnih projekata propada zbog organizacijskih, a ne tehničkih razloga.

### Detaljne bilješke

Najčešći uzroci su nejasan obim projekta, pretjerano prilagođavanje standardnog rješenja, loš kvalitet prenesenih podataka i premalo obuke. Svako prilagođavanje poskupljuje i svaku buduću nadogradnju.

> **Česta greška:** Preduzeće prenese stari, neefikasan proces u novi sistem i onda ustanovi da se ništa nije poboljšalo.

## 4. 📊 Mjerenje isplativosti

### Glavna ideja

Isplativost mjerimo poslovnim pokazateljima prije i poslije uvođenja, a ne osjećajem korisnika.

### Detaljne bilješke

Najčešće se prate vrijeme zatvaranja mjeseca, obrt zaliha, udio zakašnjelih isporuka i broj ručnih ispravki. Stvarni učinak obično se pokaže tek nakon nekoliko mjeseci stabilizacije.

### Provjeri svoje znanje

- Koja je glavna prednost zajedničke baze podataka?
- Zašto uvođenje obično počinje finansijskim modulom?
- Koja su tri najčešća razloga neuspjeha?
- Kako mjerimo da li se ulaganje isplatilo?

## Završni pregled

- ERP povezuje odjele oko jedne jedine baze podataka.
- Uvođenje treba teći po fazama, počevši od najstandardizovanijih procesa.
- Pretjerano prilagođavanje glavni je izvor prekoračenja budžeta.
- Kvalitet podataka i obuka odlučuju o uspjehu.
- Isplativost dokazuju mjerljivi pokazatelji prije i poslije uvođenja.`,
  images: [
    {
      file: "bs/erp-moduli.svg",
      fileName: "erp-moduli.png",
      alt: "Moduli ERP sistema oko zajedničke baze podataka",
      afterText: "Prije ERP-a odjeli su koristili odvojene programe",
    },
    {
      file: "bs/erp-uvedba.svg",
      fileName: "faze-uvodjenja.png",
      alt: "Faze uvođenja ERP sistema",
      afterText: "Preduzeća obično počinju s finansijskim modulom",
    },
  ],
  sections: [
    { title: "Šta je ERP sistem", sourceLabel: "1. dio članka" },
    { title: "Uvođenje po fazama", sourceLabel: "2. dio članka" },
    { title: "Razlozi neuspjeha", sourceLabel: "3. dio članka" },
    { title: "Mjerenje isplativosti", sourceLabel: "4. dio članka" },
  ],
  flashcards: [
    {
      front: "Šta znači skraćenica ERP?",
      back: "Enterprise Resource Planning – planiranje resursa preduzeća.",
      difficulty: "easy",
      sectionIdx: 0,
    },
    {
      front: "Koja je glavna tehnička prednost ERP sistema?",
      back: "Jedna zajednička baza podataka, pa se svaki podatak unosi jednom i odmah je vidljiv svim odjelima.",
      difficulty: "easy",
      sectionIdx: 0,
    },
    {
      front: "Šta je modul u ERP sistemu?",
      back: "Funkcionalno zaokružen dio sistema koji pokriva jedno poslovno područje, na primjer finansije ili nabavku.",
      difficulty: "medium",
      sectionIdx: 0,
    },
    {
      front: "S kojim modulom uvođenje obično počinje i zašto?",
      back: "S finansijskim, jer su finansijski procesi najviše standardizovani i najmanje zavise od grane.",
      difficulty: "medium",
      sectionIdx: 1,
    },
    {
      front: "Nabroji faze uvođenja ERP sistema.",
      back: "Analiza procesa, izbor ponuđača, konfiguracija i migracija podataka, testiranje, obuka, puštanje u rad i stabilizacija.",
      difficulty: "hard",
      sectionIdx: 1,
    },
    {
      front: "Zašto je pretjerano prilagođavanje sistema opasno?",
      back: "Povećava troškove projekta i poskupljuje svaku buduću nadogradnju, jer se prilagodbe moraju svaki put iznova provjeravati.",
      difficulty: "hard",
      sectionIdx: 2,
    },
    {
      front: "Koji su najčešći razlozi neuspjeha uvođenja?",
      back: "Nejasan obim projekta, pretjerano prilagođavanje, loš kvalitet podataka i premalo obuke korisnika.",
      difficulty: "medium",
      sectionIdx: 2,
    },
    {
      front: "Kojim pokazateljima mjerimo isplativost ERP sistema?",
      back: "Vrijeme zatvaranja mjeseca, obrt zaliha, udio zakašnjelih isporuka i broj ručnih ispravki.",
      difficulty: "medium",
      sectionIdx: 3,
    },
  ],
  quiz: [
    {
      prompt: "Koja je osnovna karakteristika ERP sistema?",
      options: [
        "Svaki odjel ima svoju bazu podataka",
        "Svi moduli dijele jednu zajedničku bazu podataka",
        "Sistem radi samo bez internetske veze",
        "Namijenjen je isključivo računovodstvu",
      ],
      correctOptionIdx: 1,
      explanation:
        "Zajednička baza podataka je suština ERP sistema i otklanja neslaganja među odjelima.",
      difficulty: "easy",
    },
    {
      prompt: "Koji modul preduzeća obično uvode prvi?",
      options: ["Proizvodnja", "Kadrovi", "Finansije", "Održavanje"],
      correctOptionIdx: 2,
      explanation:
        "Finansijski procesi su najviše standardizovani, pa je rizik uvođenja najmanji.",
      difficulty: "medium",
    },
    {
      prompt: "Šta je najčešći uzrok prekoračenja budžeta?",
      options: [
        "Pretjerano prilagođavanje standardnog rješenja",
        "Premali broj korisnika",
        "Korištenje rješenja u oblaku",
        "Prebrz početak proizvodnje",
      ],
      correctOptionIdx: 0,
      explanation:
        "Svako prilagođavanje poskupljuje projekat i sve buduće nadogradnje sistema.",
      difficulty: "medium",
    },
    {
      prompt: "Zašto je kvalitet podataka ključan pri migraciji?",
      options: [
        "Jer sistem bez podataka ne radi",
        "Jer pogrešni podaci u novom sistemu stvaraju pogrešne odluke",
        "Jer migracija zahtijeva više servera",
        "Jer se podaci nakon migracije brišu",
      ],
      correctOptionIdx: 1,
      explanation:
        "Novi sistem ne popravlja loše podatke, nego ih samo brže širi kroz preduzeće.",
      difficulty: "hard",
    },
    {
      prompt: "Koji pokazatelj najbolje pokazuje učinak ERP-a na zalihe?",
      options: [
        "Broj korisnika sistema",
        "Obrt zaliha",
        "Broj modula",
        "Trajanje obuke",
      ],
      correctOptionIdx: 1,
      explanation: "Obrt zaliha direktno mjeri koliko efikasno preduzeće upravlja zalihama.",
      difficulty: "medium",
    },
    {
      prompt: "Kada se stvarni učinci uvođenja obično pokažu?",
      options: [
        "Odmah pri puštanju u rad",
        "Nakon nekoliko mjeseci stabilizacije",
        "Tek nakon promjene ponuđača",
        "Nikada ih nije moguće izmjeriti",
      ],
      correctOptionIdx: 1,
      explanation:
        "Poslije puštanja u rad slijedi period stabilizacije, dok se korisnici ne naviknu na nove procese.",
      difficulty: "easy",
    },
  ],
  practice: [
    {
      prompt: "Objasni zašto je zajednička baza podataka glavna prednost ERP sistema.",
      answerGuide:
        "Podatak se unosi jednom i odmah je dostupan svim odjelima, čime se otklanjaju dupliranje, ručni prenosi i neslaganja između izvještaja različitih odjela.",
      difficulty: "easy",
      expectedAnswer:
        "Jedan unos, jedan izvor istine, nema ručnih prenosa između sistema i nema razilaženja među odjelima.",
      strengths: "Prepoznaješ da se otklanja dupliranje podataka.",
      missingPoints: "Dodaj konkretan primjer, recimo zajednički zapis o zalihama.",
    },
    {
      prompt: "Opiši faze uvođenja ERP sistema i objasni zašto je fazni pristup sigurniji.",
      answerGuide:
        "Analiza, izbor ponuđača, konfiguracija i migracija, testiranje, obuka, puštanje u rad i stabilizacija. Fazni pristup ograničava obim rizika i omogućava učenje na manjem dijelu sistema.",
      difficulty: "medium",
      expectedAnswer:
        "Faze idu od analize do stabilizacije; postepenost smanjuje rizik da svi procesi istovremeno stanu.",
      strengths: "Faze su navedene pravilnim redoslijedom.",
      missingPoints: "Objasni zašto je proizvodni modul obično posljednji.",
    },
    {
      prompt: "Preduzeće ni nakon godinu dana ne vidi koristi od ERP sistema. Šta bi prvo provjerio?",
      answerGuide:
        "Da li su procesi ostali nepromijenjeni, da li je obuka bila dovoljna, kakav je kvalitet migriranih podataka i da li se uopšte mjere pravi pokazatelji prije i poslije uvođenja.",
      difficulty: "hard",
      expectedAnswer:
        "Provjerio bih promjenu procesa, obuku, kvalitet podataka i postojanje početnih mjerenja.",
      strengths: "Tražiš organizacijske, a ne samo tehničke uzroke.",
      missingPoints: "Spomeni i obim prilagođavanja standardnog rješenja.",
    },
    {
      prompt: "Kako bi izmjerio isplativost ulaganja u ERP sistem?",
      answerGuide:
        "Poređenjem mjerljivih pokazatelja prije i poslije uvođenja: vremena zatvaranja mjeseca, obrta zaliha, udjela zakašnjelih isporuka i obima ručnih ispravki, uz uračunate ukupne troškove vlasništva.",
      difficulty: "medium",
      expectedAnswer:
        "Postavim početna mjerenja, ponovim ih nakon stabilizacije i uporedim s ukupnim troškovima projekta.",
      strengths: "Naglašavaš početno mjerenje prije uvođenja.",
      missingPoints: "Uključi i troškove održavanja i licenci.",
    },
  ],
  transcript: [],
  chatAnswers: [
    "Glavna prednost je jedna jedina zajednička baza podataka. Podatak se unosi jednom i odmah je vidljiv svim odjelima, pa nema ručnih prenosa, dupliranja ni razilaženja između izvještaja finansija i nabavke.",
    "Preduzeća počinju s finansijskim modulom jer su finansijski procesi najviše standardizovani i najmanje zavise od grane. Proizvodni modul dolazi posljednji jer je najspecifičniji.",
    "Najčešći razlozi neuspjeha su organizacijski: nejasan obim projekta, pretjerano prilagođavanje standardnog rješenja, loš kvalitet migriranih podataka i premalo obuke korisnika.",
    "Isplativost mjeriš tako što prije uvođenja zabilježiš početne pokazatelje – vrijeme zatvaranja mjeseca, obrt zaliha, udio zakašnjelih isporuka – i nakon nekoliko mjeseci stabilizacije ih ponovo izmjeriš.",
  ],
};

const ZGODOVINA: DemoNotePack = {
  key: "zgodovina",
  title: "Historija – Francuska revolucija",
  sourceType: "presentation",
  pageCount: 18,
  durationSeconds: null,
  summary:
    "Bilješke sažimaju uzroke Francuske revolucije, njen tok od sazivanja Generalnih staleža do Napoleonovog preuzimanja vlasti i dugoročne posljedice za Evropu.",
  keyTopics: [
    "Uzroci revolucije",
    "Generalni staleži i Narodna skupština",
    "Deklaracija o pravima",
    "Jakobinska diktatura",
    "Posljedice za Evropu",
  ],
  notesMd: `## Brzi pregled

Francuska revolucija počela je kao finansijska kriza apsolutističke monarhije i prerasla u temeljit raskid sa starim društvenim poretkom. Za deset godina Francuska je od staleškog društva došla do republike, a zatim do Napoleonove diktature. Ideje jednakosti pred zakonom ipak su se proširile cijelom Evropom.

> **Ključno:** Revolucija nije izbila zbog jedne jedine nepravde, nego zbog podudaranja državnog bankrota, loše žetve i staleškog sistema koji je poreski teret svaljivao na one s najmanje prava.

## Ključne stvari koje moraš znati

- Francusko društvo bilo je podijeljeno na tri staleža, a poreze je plaćao uglavnom treći stalež.
- Državna blagajna bila je iscrpljena ratovima i troškovima dvora.
- Sazivanje Generalnih staleža 1789. godine pokrenulo je politički spor o načinu glasanja.
- Deklaracija o pravima čovjeka i građanina uvela je jednakost pred zakonom.
- Revolucija je završila Napoleonovim državnim udarom 1799. godine.

| Period | Ključni događaj | Posljedica |
| --- | --- | --- |
| 1789 | Sazivanje Generalnih staleža, zauzimanje Bastilje | Kraj apsolutizma |
| 1791 | Prvi ustav | Ustavna monarhija |
| 1793–1794 | Jakobinska diktatura | Teror i masovna pogubljenja |
| 1799 | Napoleonov državni udar | Kraj revolucije |

## 1. 🔥 Uzroci

### Glavna ideja

Revoluciju je pokrenulo podudaranje finansijskog sloma države i dubokih društvenih nejednakosti.

### Detaljne bilješke

Prva dva staleža, sveštenstvo i plemstvo, bila su uglavnom oslobođena poreza, iako su posjedovala najviše imovine. Treći stalež obuhvatao je više od devedeset procenata stanovništva i nosio gotovo cijeli poreski teret. Loša žetva 1788. godine podigla je cijenu hljeba do granice koja je za gradsko stanovništvo značila glad.

- **Definicija:** Staleško društvo je poredak u kojem su prava određena rođenjem, a ne zaslugama.
- Prosvjetiteljske ideje ponudile su jezik za kritiku apsolutizma.
- Podrška Američkoj revoluciji konačno je ispraznila državnu blagajnu.

## 2. 🏛️ Od Generalnih staleža do republike

### Glavna ideja

Spor oko načina glasanja doveo je treći stalež do proglašenja Narodne skupštine.

### Detaljne bilješke

Kralj je u maju 1789. sazvao Generalne staleže kako bi odobrili nove poreze. Budući da je svaki stalež imao jedan glas, treći stalež bi uvijek bio nadglasan. U junu se proglasio Narodnom skupštinom i zakletvom u dvorani za igru loptom obećao da se neće razići dok Francuska ne dobije ustav.

### Proces

- Maj 1789: sazivanje Generalnih staleža u Versaillesu.
- Juni 1789: proglašenje Narodne skupštine i zakletva u dvorani za igru loptom.
- Juli 1789: zauzimanje Bastilje kao simbolični kraj apsolutizma.
- August 1789: Deklaracija o pravima čovjeka i građanina.
- Septembar 1792: proglašenje republike.

## 3. ⚔️ Jakobinska diktatura

### Glavna ideja

Rat i unutrašnje pobune doveli su do vanrednog režima koji je protivnike uklanjao smrtnim presudama.

### Detaljne bilješke

Komitet javnog spasa pod Robespierreom uveo je opštu mobilizaciju, ograničenja cijena i revolucionarne sudove. Teror je predstavljan kao privremeno sredstvo za spas republike, ali je zahvatio i same revolucionare.

> **Česta greška:** Teror nije bio program cijele revolucije, nego odgovor na posebno razdoblje rata i unutrašnje krize.

## 4. 🌍 Posljedice

### Glavna ideja

Revolucija je ukinula feudalne privilegije i proširila načelo jednakosti pred zakonom po Evropi.

### Detaljne bilješke

Napoleonovi pohodi prenijeli su zakonik i upravne reforme na okupirana područja. Stari poredak je poslije 1815. djelimično obnovljen, ali se ideja narodnog suvereniteta održala i u 19. stoljeću pokrenula nove pokrete.

### Provjeri svoje znanje

- Zašto je poreski sistem prije revolucije bio neodrživ?
- Šta je značila zakletva u dvorani za igru loptom?
- Koji je dokument uveo jednakost pred zakonom?
- Zašto je revolucija završila diktaturom?

## Završni pregled

- Uzroci su bili istovremeno finansijski, društveni i idejni.
- Zauzimanje Bastilje je simbolični, a ne stvarni kraj apsolutizma.
- Deklaracija iz 1789. godine temelj je modernih prava građanina.
- Teror je bio odgovor na ratno stanje, a ne cilj revolucije.
- Naslijeđe revolucije je ideja jednakosti pred zakonom i narodnog suvereniteta.`,
  images: [
    {
      file: "bs/revolucija-casovnica.svg",
      fileName: "vremenska-linija-1789-1799.png",
      alt: "Vremenska linija Francuske revolucije od 1789. do 1799. godine",
      afterText: "Kralj je u maju 1789. sazvao Generalne staleže",
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
      front: "Kako je bilo podijeljeno francusko društvo prije revolucije?",
      back: "Na tri staleža: sveštenstvo, plemstvo i treći stalež, koji je obuhvatao više od 90 procenata stanovništva.",
      difficulty: "easy",
      sectionIdx: 0,
    },
    {
      front: "Zašto je poreski sistem bio neodrživ?",
      back: "Prva dva staleža bila su uglavnom oslobođena poreza, a teret je nosio treći stalež, koji je imao najmanje prava.",
      difficulty: "medium",
      sectionIdx: 0,
    },
    {
      front: "Šta je bila zakletva u dvorani za igru loptom?",
      back: "Obećanje poslanika Narodne skupštine 1789. godine da se neće razići dok Francuska ne dobije ustav.",
      difficulty: "medium",
      sectionIdx: 1,
    },
    {
      front: "Šta simbolizuje zauzimanje Bastilje?",
      back: "Simbolični pad apsolutističke vlasti i početak revolucije; 14. juli je i danas državni praznik.",
      difficulty: "easy",
      sectionIdx: 1,
    },
    {
      front: "Šta je uvela Deklaracija o pravima čovjeka i građanina?",
      back: "Jednakost pred zakonom, slobodu govora i vjere te načelo da vlast proizlazi iz naroda.",
      difficulty: "medium",
      sectionIdx: 1,
    },
    {
      front: "Ko je vodio Komitet javnog spasa?",
      back: "Maximilien Robespierre, u periodu jakobinske diktature 1793–1794.",
      difficulty: "hard",
      sectionIdx: 2,
    },
    {
      front: "Zašto je došlo do terora?",
      back: "Zbog vanjskog rata i unutrašnjih pobuna režim je uveo vanredne mjere i revolucionarne sudove.",
      difficulty: "hard",
      sectionIdx: 2,
    },
    {
      front: "Kada i kako je revolucija završila?",
      back: "Godine 1799. Napoleonovim državnim udarom, koji je republiku pretvorio u ličnu vlast.",
      difficulty: "medium",
      sectionIdx: 3,
    },
  ],
  quiz: [
    {
      prompt: "Koji je stalež nosio najveći poreski teret?",
      options: ["Sveštenstvo", "Plemstvo", "Treći stalež", "Svi podjednako"],
      correctOptionIdx: 2,
      explanation:
        "Prva dva staleža bila su uglavnom oslobođena poreza, pa je teret pao na treći stalež.",
      difficulty: "easy",
    },
    {
      prompt: "Šta je bio neposredni povod za sazivanje Generalnih staleža?",
      options: [
        "Pobjeda u ratu",
        "Finansijska kriza države",
        "Smrt kralja",
        "Otkriće novih teritorija",
      ],
      correctOptionIdx: 1,
      explanation: "Kralju je trebalo odobrenje novih poreza jer je blagajna bila iscrpljena.",
      difficulty: "medium",
    },
    {
      prompt: "Koji događaj važi za simbolični početak revolucije?",
      options: [
        "Zakletva u dvorani za igru loptom",
        "Zauzimanje Bastilje",
        "Proglašenje republike",
        "Napoleonov udar",
      ],
      correctOptionIdx: 1,
      explanation: "Zauzimanje Bastilje 14. jula 1789. simbolični je pad apsolutizma.",
      difficulty: "easy",
    },
    {
      prompt: "Šta je propisivala Deklaracija o pravima čovjeka i građanina?",
      options: [
        "Povratak feudalnih privilegija",
        "Jednakost pred zakonom i narodni suverenitet",
        "Obaveznu vojnu službu",
        "Ukidanje privatnog vlasništva",
      ],
      correctOptionIdx: 1,
      explanation:
        "Deklaracija je uvela jednakost pred zakonom i načelo da vlast proizlazi iz naroda.",
      difficulty: "medium",
    },
    {
      prompt: "Jakobinska diktatura bila je prije svega odgovor na:",
      options: [
        "Privredni rast",
        "Vanjski rat i unutrašnje pobune",
        "Povratak kralja na prijesto",
        "Osnivanje kolonija",
      ],
      correctOptionIdx: 1,
      explanation: "Vanredne mjere opravdavane su ratnim stanjem i unutrašnjim pobunama.",
      difficulty: "hard",
    },
    {
      prompt: "Šta je najtrajnije naslijeđe revolucije?",
      options: [
        "Obnova staleškog društva",
        "Ideja jednakosti pred zakonom i narodnog suvereniteta",
        "Ukidanje vojske",
        "Povratak apsolutizma",
      ],
      correctOptionIdx: 1,
      explanation:
        "Uprkos restauraciji poslije 1815. godine, ideje jednakosti i narodnog suvereniteta su opstale.",
      difficulty: "medium",
    },
  ],
  practice: [
    {
      prompt: "Nabroji i objasni tri glavna uzroka Francuske revolucije.",
      answerGuide:
        "Finansijski slom države zbog ratova i troškova dvora, društvena nejednakost staleškog društva s poreskim privilegijama i prosvjetiteljske ideje, koje su ponudile jezik za kritiku apsolutizma. Loša žetva 1788. godine djelovala je kao okidač.",
      difficulty: "medium",
      expectedAnswer:
        "Finansijska kriza, staleška nejednakost i prosvjetiteljske ideje, uz skupoću hljeba kao okidač.",
      strengths: "Razlikuješ dugoročne uzroke od neposrednog povoda.",
      missingPoints: "Dodaj ulogu podrške Američkoj revoluciji u pražnjenju blagajne.",
    },
    {
      prompt: "Objasni zašto je spor o glasanju u Generalnim staležima doveo do raskida.",
      answerGuide:
        "Glasalo se po staležima, pa bi treći stalež uvijek bio nadglasan s dva prema jedan, iako je predstavljao veliku većinu stanovništva. Zahtjev za glasanjem po glavi odbijen je, pa se treći stalež proglasio Narodnom skupštinom.",
      difficulty: "hard",
      expectedAnswer:
        "Glasanje po staležima uvijek je stavljalo treći stalež u manjinu, pa se on osamostalio kao Narodna skupština.",
      strengths: "Prepoznaješ mehanizam nadglasavanja.",
      missingPoints: "Spomeni zakletvu u dvorani za igru loptom kao tačku bez povratka.",
    },
    {
      prompt: "Zašto je revolucija, koja je počela zahtjevom za slobodom, završila diktaturom?",
      answerGuide:
        "Rat, unutrašnje pobune i ekonomska kriza doveli su do vanrednih mjera i terora. Nakon Robespierreovog pada nastala je politička nestabilnost, koju je uz podršku vojske iskoristio Napoleon.",
      difficulty: "hard",
      expectedAnswer:
        "Zbog ratnog stanja, terora i kasnije nestabilnosti Direktorija, koju je iskoristila vojska.",
      strengths: "Povezuješ vanjsku ugroženost s unutrašnjom radikalizacijom.",
      missingPoints: "Dodaj ulogu vojske kao nosioca reda poslije 1795. godine.",
    },
    {
      prompt: "Kakve su bile posljedice revolucije za ostatak Evrope?",
      answerGuide:
        "Napoleonovi pohodi proširili su Građanski zakonik i upravne reforme, ukinuli feudalne ostatke i podstakli nacionalne pokrete. Poslije 1815. godine stari poredak je djelimično obnovljen, ali su ideje ostale žive.",
      difficulty: "medium",
      expectedAnswer:
        "Širenje Građanskog zakonika i jednakosti pred zakonom, ukidanje feudalnih ostataka i uspon nacionalnih pokreta.",
      strengths: "Prepoznaješ prenošenje ideja vojnim pohodima.",
      missingPoints: "Spomeni Bečki kongres i pokušaj restauracije.",
    },
  ],
  transcript: [],
  chatAnswers: [
    "Glavnih uzroka bilo je tri i djelovali su istovremeno: državni bankrot poslije skupih ratova, staleško društvo s poreskim privilegijama za prva dva staleža i prosvjetiteljske ideje, koje su ponudile jezik za kritiku apsolutizma. Skupoća hljeba 1788. godine bila je okidač.",
    "U Generalnim staležima svaki stalež je imao jedan glas, pa bi treći stalež uvijek bio nadglasan s dva prema jedan – iako je predstavljao više od 90 procenata stanovništva. Zato se u junu 1789. proglasio Narodnom skupštinom.",
    "Teror je bio odgovor na vanredne prilike: Francuska je ratovala protiv saveza evropskih monarhija i suočavala se s unutrašnjim pobunama. Komitet javnog spasa opravdavao je vanredne mjere spasom republike.",
    "Deklaracija o pravima čovjeka i građanina iz augusta 1789. uvela je jednakost pred zakonom, slobodu govora i vjere te načelo da vlast proizlazi iz naroda, a ne od kralja.",
  ],
};

export const BS_DEMO_CONTENT: DemoLocaleContent = {
  packs: [MIKROEKONOMIJA, ANATOMIJA, ERP_CLANEK, ZGODOVINA],
  folderNames: {
    "demo-folder-izpiti": "Ispitni rok",
    "demo-folder-seminarska": "Seminarski rad",
  },
  liveFigures: [
    {
      file: "bs/ponudba-povprasevanje.svg",
      fileName: "graf-ravnoteza.png",
      alt: "Graf ponude i potražnje s tačkom ravnoteže",
      anchor: "Kada se promijeni bilo koji faktor osim cijene",
    },
    {
      file: "bs/elasticnost.svg",
      fileName: "elasticnost-poredjenje.png",
      alt: "Poređenje elastične i neelastične potražnje",
      anchor: "Elastičnost mjeri osjetljivost količine na promjenu cijene",
    },
    {
      file: "bs/premik-krivulje.svg",
      fileName: "pomjeranje-potraznje.png",
      alt: "Pomjeranje krive potražnje udesno i nova ravnoteža",
      anchor: "Kriva potražnje opada jer svaka dodatna jedinica",
    },
    {
      file: "bs/substituti-komplementi.svg",
      fileName: "supstituti-i-komplementi.png",
      alt: "Supstituti se međusobno zamjenjuju, komplementi se koriste zajedno",
      anchor: "dobra koja se međusobno zamjenjuju",
    },
    {
      file: "bs/premik-ponudbe.svg",
      fileName: "pomjeranje-ponude.png",
      alt: "Pomjeranje krive ponude udesno zbog nižih troškova",
      anchor: "Troškovi rada i sirovina pomjeraju krivu ponude",
    },
    {
      file: "bs/presezek-primanjkljaj.svg",
      fileName: "visak-i-manjak.png",
      alt: "Višak ponude iznad ravnotežne cijene i manjak ispod nje",
      anchor: "Ako je cijena previsoka, roba ostaje neprodana",
    },
    {
      file: "bs/prihodek-elasticnost.svg",
      fileName: "prihod-i-elasticnost.png",
      alt: "Ukupni prihod je najveći tamo gdje je elastičnost jednaka 1",
      anchor: "Kada je rezultat po apsolutnoj vrijednosti veći od 1",
    },
  ],
  liveHighlights: [
    { phrase: "Ta tačka je tržišna ravnoteža", color: "green" },
    { phrase: "Cijena ne pomjera krivu", color: "purple" },
    { phrase: "Tražena količina je količina pri jednoj jedinoj cijeni", color: "green" },
    {
      phrase: "Ravnoteža je jedina cijena pri kojoj nema ni viška ni manjka",
      color: "green",
    },
    { phrase: "Kretanje duž krive izaziva samo promjena cijene", color: "purple" },
    { phrase: "malo supstituta, kratak rok, nužna dobra", color: "green" },
    { phrase: "prihod je najveći tamo gdje je elastičnost jednaka 1", color: "purple" },
    {
      phrase:
        "Najčešća greška na ispitu je zamjena pomjeranja krive kretanjem duž krive",
      color: "purple",
    },
  ],
  podcastTurns: [
    { speaker: "a", text: "Hajde da pogledamo ove bilješke — šta je ono što zaista moraš zapamtiti?" },
    { speaker: "b", text: "Prvo okvir: bez njega su pojedinačni podaci samo spisak." },
    { speaker: "a", text: "Znači, prvo shvatiš čemu sve to služi, a tek onda detalje." },
    { speaker: "b", text: "Tačno. A kad to jednom sjedne, detalje zapamtiš gotovo sami od sebe." },
    { speaker: "a", text: "Dobro. Idemo sad redom da provjerimo gdje se najčešće zapne." },
    { speaker: "b", text: "Važi. I na kraju sve sažmemo u jednu rečenicu, da ti ostane za ispit." },
  ],
};
