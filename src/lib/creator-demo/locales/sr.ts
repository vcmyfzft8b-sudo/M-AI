/**
 * The `/creator` demo in Serbian (Latin script, ekavian), translated from the
 * Slovenian source in `./sl.ts`. See `../content-types.ts` for what each field
 * is and the rules a translation has to keep.
 */
import type { DemoLocaleContent, DemoNotePack } from "@/lib/creator-demo/content-types";

const MIKROEKONOMIJA: DemoNotePack = {
  key: "mikroekonomija",
  title: "Mikroekonomija – ponuda i tražnja",
  sourceType: "audio",
  durationSeconds: 2842,
  summary:
    "Predavanje objašnjava kako krive ponude i tražnje određuju tržišnu ravnotežu, šta pomera celu krivu i kako elastičnost pokazuje koliko količina reaguje na promenu cene.",
  keyTopics: [
    "Zakon tražnje",
    "Zakon ponude",
    "Tržišna ravnoteža",
    "Pomeranje krive naspram kretanja duž krive",
    "Cenovna elastičnost",
  ],
  notesMd: `## Brzi pregled

Tržište funkcioniše kao pregovaranje između kupaca i prodavaca: kupci žele nisku cenu, prodavci visoku, a cena se ustaljuje tamo gde se poklope količina koju kupci žele da kupe i količina koju prodavci žele da prodaju. Ta tačka je tržišna ravnoteža. Kada se promeni bilo koji faktor osim cene, pomera se cela kriva i nastaje nova ravnoteža.

> **Ključno:** Cena ne pomera krivu – pomera samo tačku na njoj. Krivu pomeraju dohodak, cene drugih dobara, očekivanja, tehnologija i broj učesnika na tržištu.

## Ključne stvari koje moraš znati

- Zakon tražnje: po višoj ceni kupci, uz nepromenjene ostale uslove, kupuju manje.
- Zakon ponude: po višoj ceni proizvođači nude više, jer je proizvodnja isplativija.
- Ravnoteža je jedina cena pri kojoj nema ni viška ni manjka.
- Iznad ravnotežne cene nastaje višak ponude, ispod nje manjak.
- Kretanje duž krive izaziva samo promena cene; pomeranje krive izaziva sve ostalo.
- Elastičnost meri osetljivost količine na promenu cene i odlučuje da li poskupljenje povećava ili smanjuje prihod.

| Događaj | Koja kriva | Smer pomeranja | Uticaj na ravnotežnu cenu |
| --- | --- | --- | --- |
| Rast dohotka kupaca | Tražnja | Udesno | Raste |
| Jeftinije sirovine | Ponuda | Udesno | Pada |
| Novi konkurent na tržištu | Ponuda | Udesno | Pada |
| Očekivano buduće poskupljenje | Tražnja | Udesno | Raste |

## 1. 📉 Tražnja

### Glavna ideja

Tražnja pokazuje koliko jedinica nekog dobra su kupci spremni i u stanju da kupe po svakoj ceni u datom periodu.

### Detaljne beleške

Kriva tražnje opada jer svaka dodatna jedinica kupcu donosi manju dodatnu korist, a viša cena istovremeno smanjuje realnu kupovnu moć. Važno je da govorimo o planiranoj, a ne o stvarno ostvarenoj količini kupovine.

- **Definicija:** Tražena količina je količina pri samo jednoj ceni, a tražnja je ceo odnos između cene i količine.
- Tržišnu tražnju dobijamo sabiranjem individualnih tražnji svih kupaca na tržištu.
- Neophodna dobra imaju strmiju krivu od luksuznih dobara.

### Ključni pojmovi

- **Supstituti:** dobra koja zamenjuju jedno drugo (čaj i kafa).
- **Komplementi:** dobra koja se koriste zajedno (štampač i kertridži).
- **Inferiorno dobro:** tražnja opada kada dohodak raste.

## 2. 📈 Ponuda

### Glavna ideja

Ponuda pokazuje koliko jedinica su proizvođači spremni da prodaju po svakoj ceni.

### Detaljne beleške

Kriva ponude raste jer viša cena pokriva veće granične troškove proizvodnje i privlači nove ponuđače u granu. Zato ponuda kratkoročno reaguje sporije od tražnje – kapacitete nije moguće povećati preko noći.

- Troškovi rada i sirovina pomeraju krivu ponude naviše, odnosno ulevo.
- Bolja tehnologija smanjuje troškove po jedinici i pomera ponudu udesno.
- Porez na proizvod deluje kao dodatni trošak i smanjuje ponudu.

## 3. ⚖️ Tržišna ravnoteža

### Glavna ideja

Ravnoteža je cena pri kojoj je tražena količina jednaka ponuđenoj količini.

### Detaljne beleške

Ako je cena previsoka, roba ostaje neprodata i prodavci snižavaju cenu. Ako je cena preniska, pojavljuju se redovi i prodavci podižu cenu. Tržište zato samo gura ka ravnoteži, iako prilagođavanje nije uvek brzo.

> **Česta greška:** Višak ponude nije znak da su kupci nestali – najčešće znači samo da je cena iznad ravnotežne.

### Primer

Ako ulaznica za koncert košta 60 EUR, a ravnotežna cena je 45 EUR, deo sale ostaje prazan. Organizator snižava cenu, a broj prodatih ulaznica raste duž iste krive tražnje.

## 4. 🔁 Elastičnost

### Glavna ideja

Cenovna elastičnost tražnje pokazuje za koliko procenata se menja količina kada se cena promeni za jedan procenat.

### Detaljne beleške

Elastičnost se računa kao odnos procentualne promene količine i procentualne promene cene. Kada je rezultat po apsolutnoj vrednosti veći od 1, tražnja je elastična i poskupljenje smanjuje ukupan prihod.

- **Elastična tražnja:** mnogo supstituta, dug vremenski period, luksuzna dobra.
- **Neelastična tražnja:** malo supstituta, kratak rok, neophodna dobra.
- **Ključno:** prihod je najveći tamo gde je elastičnost jednaka 1.

### Proveri svoje znanje

- Šta se dešava sa ravnotežnom cenom ako se istovremeno povećaju i ponuda i tražnja?
- Zašto promena cene ne pomera krivu tražnje?
- Kada poskupljenje povećava ukupan prihod preduzeća?
- Koji faktori čine tražnju elastičnijom?

## Završni pregled

- Kriva tražnje opada, kriva ponude raste, a njihov presek je ravnoteža.
- Promena cene znači kretanje duž krive, a sve ostalo pomera celu krivu.
- Višak ponude gura cenu naniže, a manjak naviše.
- Elastičnost određuje kako poskupljenje utiče na prihod.
- Najčešća greška na ispitu je mešanje pomeranja krive sa kretanjem duž krive.`,
  images: [
    {
      file: "sr/ponudba-povprasevanje.svg",
      fileName: "grafik-ravnoteza.png",
      alt: "Grafik ponude i tražnje sa tačkom ravnoteže",
      afterText: "Ako je cena previsoka, roba ostaje neprodata",
    },
    {
      file: "sr/elasticnost.svg",
      fileName: "elasticnost-poredjenje.png",
      alt: "Poređenje elastične i neelastične tražnje",
      afterText: "Elastičnost se računa kao odnos",
    },
  ],
  sections: [
    { title: "Tražnja", sourceLabel: "00:00 – 11:20" },
    { title: "Ponuda", sourceLabel: "11:20 – 24:05" },
    { title: "Tržišna ravnoteža", sourceLabel: "24:05 – 36:40" },
    { title: "Elastičnost", sourceLabel: "36:40 – 47:22" },
  ],
  flashcards: [
    {
      front: "Šta kaže zakon tražnje?",
      back: "Uz nepromenjene ostale uslove, kupci po višoj ceni kupuju manju količinu dobra.",
      hint: "Cena gore, količina dole.",
      difficulty: "easy",
      sectionIdx: 0,
    },
    {
      front: "Razlika između tražnje i tražene količine?",
      back: "Tražena količina je jedna tačka pri jednoj ceni, a tražnja je ceo odnos između cene i količine, dakle cela kriva.",
      difficulty: "medium",
      sectionIdx: 0,
    },
    {
      front: "Šta su supstituti?",
      back: "Dobra koja zamenjuju jedno drugo. Poskupljenje jednog povećava tražnju za drugim, na primer čaj i kafa.",
      difficulty: "easy",
      sectionIdx: 0,
    },
    {
      front: "Zašto kriva ponude raste?",
      back: "Viša cena pokriva veće granične troškove i privlači dodatne ponuđače u granu, pa se isplati proizvoditi više.",
      difficulty: "medium",
      sectionIdx: 1,
    },
    {
      front: "Kako porez na proizvod utiče na ponudu?",
      back: "Deluje kao dodatni trošak po jedinici, pa krivu ponude pomera ulevo, odnosno naviše.",
      difficulty: "medium",
      sectionIdx: 1,
    },
    {
      front: "Šta je tržišna ravnoteža?",
      back: "Cena pri kojoj je tražena količina jednaka ponuđenoj, pa nema ni viška ni manjka.",
      difficulty: "easy",
      sectionIdx: 2,
    },
    {
      front: "Šta nastaje ako je cena iznad ravnotežne?",
      back: "Višak ponude: neprodata roba gura cenu naniže, ka ravnoteži.",
      difficulty: "medium",
      sectionIdx: 2,
    },
    {
      front: "Kada se pomera cela kriva tražnje?",
      back: "Pri promeni dohotka, cena supstituta ili komplemenata, ukusa, očekivanja ili broja kupaca – nikada pri promeni sopstvene cene.",
      hint: "Sve osim cene.",
      difficulty: "hard",
      sectionIdx: 2,
    },
    {
      front: "Kako se računa cenovna elastičnost tražnje?",
      back: "Procentualnu promenu količine delimo procentualnom promenom cene. Apsolutna vrednost veća od 1 znači elastičnu tražnju.",
      difficulty: "hard",
      sectionIdx: 3,
    },
    {
      front: "Kada poskupljenje povećava ukupan prihod?",
      back: "Kada je tražnja neelastična, odnosno kada se količina menja relativno manje od cene.",
      difficulty: "hard",
      sectionIdx: 3,
    },
  ],
  quiz: [
    {
      prompt: "Cena kafe raste. Šta se dešava na tržištu čaja?",
      options: [
        "Tražnja za čajem se povećava",
        "Tražnja za čajem se smanjuje",
        "Ponuda čaja se smanjuje",
        "Na tržištu čaja se ništa ne menja",
      ],
      correctOptionIdx: 0,
      explanation:
        "Čaj je supstitut za kafu, pa deo kupaca prelazi na čaj i kriva tražnje za čajem se pomera udesno.",
      difficulty: "easy",
    },
    {
      prompt: "Koji događaj pomera krivu ponude udesno?",
      options: [
        "Rast cena sirovina",
        "Novi porez na proizvod",
        "Jeftinija tehnologija proizvodnje",
        "Rast cene finalnog proizvoda",
      ],
      correctOptionIdx: 2,
      explanation:
        "Bolja tehnologija smanjuje troškove po jedinici, pa su proizvođači spremni da po svakoj ceni ponude više.",
      difficulty: "medium",
    },
    {
      prompt: "Cena je ispod ravnotežne. Šta se dešava?",
      options: [
        "Nastaje višak ponude",
        "Nastaje manjak i cena raste",
        "Tržište je u ravnoteži",
        "Kriva tražnje se pomera ulevo",
      ],
      correctOptionIdx: 1,
      explanation:
        "Pri preniskoj ceni kupci žele više nego što je dostupno. Manjak gura cenu naviše, ka ravnoteži.",
      difficulty: "easy",
    },
    {
      prompt: "Promena sopstvene cene dobra izaziva:",
      options: [
        "Kretanje duž krive tražnje",
        "Pomeranje cele krive tražnje",
        "Pomeranje cele krive ponude",
        "Promenu elastičnosti",
      ],
      correctOptionIdx: 0,
      explanation:
        "Cena je na osi grafika, pa njena promena znači kretanje duž postojeće krive, a ne njeno pomeranje.",
      difficulty: "medium",
    },
    {
      prompt: "Tražnja je elastična kada je koeficijent elastičnosti:",
      options: [
        "Po apsolutnoj vrednosti manji od 1",
        "Po apsolutnoj vrednosti jednak 1",
        "Po apsolutnoj vrednosti veći od 1",
        "Uvek negativan",
      ],
      correctOptionIdx: 2,
      explanation:
        "Apsolutna vrednost veća od 1 znači da se količina menja relativno više od cene.",
      difficulty: "medium",
    },
    {
      prompt: "Preduzeće prodaje neophodno dobro bez supstituta i podiže cenu. Prihod će najverovatnije:",
      options: [
        "Pasti, jer će kupci otići",
        "Porasti, jer je tražnja neelastična",
        "Ostati isti",
        "Zavisiti samo od ponude",
      ],
      correctOptionIdx: 1,
      explanation:
        "Bez supstituta tražnja je neelastična, pa količina opada relativno manje nego što cena raste.",
      difficulty: "hard",
    },
    {
      prompt: "Dohodak kupaca raste, a dobro je inferiorno. Tražnja se:",
      options: ["Povećava", "Smanjuje", "Ne menja", "Pretvara u ponudu"],
      correctOptionIdx: 1,
      explanation:
        "Kod inferiornih dobara kupci sa većim dohotkom prelaze na kvalitetnije zamene.",
      difficulty: "hard",
    },
    {
      prompt: "Istovremeno se povećaju i ponuda i tražnja. Šta sigurno važi?",
      options: [
        "Cena sigurno raste",
        "Cena sigurno pada",
        "Ravnotežna količina se povećava",
        "Ravnotežna količina se smanjuje",
      ],
      correctOptionIdx: 2,
      explanation:
        "Oba pomeranja povećavaju količinu, a uticaj na cenu zavisi od toga koje je pomeranje jače.",
      difficulty: "hard",
    },
  ],
  practice: [
    {
      prompt:
        "Objasni razliku između kretanja duž krive tražnje i pomeranja cele krive. Navedi po jedan primer za svako.",
      answerGuide:
        "Kretanje duž krive izaziva isključivo promena sopstvene cene dobra. Pomeranje cele krive izazivaju necenovni faktori: dohodak, cene supstituta i komplemenata, ukusi, očekivanja i broj kupaca.",
      difficulty: "medium",
      expectedAnswer:
        "Promena cene = kretanje duž krive (npr. cena kafe padne, kupci kupuju više kafe). Promena necenovnog faktora = pomeranje krive (npr. dohodak poraste i cela kriva se pomera udesno).",
      strengths: "Jasno razlikuješ cenovni i necenovni faktor.",
      missingPoints: "Dodaj i konkretan primer pomeranja ulevo, na primer pad dohotka.",
    },
    {
      prompt:
        "Na tržištu nastaje višak ponude. Opiši mehanizam koji vraća tržište u ravnotežu.",
      answerGuide:
        "Višak znači da je cena iznad ravnotežne. Neprodate zalihe teraju prodavce da snize cenu, čime se tražena količina povećava, a ponuđena smanjuje, dok se ne izjednače.",
      difficulty: "easy",
      expectedAnswer:
        "Cena je previsoka, zalihe rastu, prodavci snižavaju cene, tražena količina raste, a ponuđena opada, dok višak ne nestane.",
      strengths: "Tačno prepoznaješ smer pritiska na cenu.",
      missingPoints: "Pomeni da se krećemo duž obe krive, a ne da ih pomeramo.",
    },
    {
      prompt:
        "Preduzeće razmišlja o poskupljenju od 10 odsto. Šta mora da zna o elastičnosti pre nego što odluči?",
      answerGuide:
        "Ako je tražnja elastična, prihod će pasti, jer će količina pasti za više od 10 odsto. Ako je neelastična, prihod će porasti. Ključni faktori su dostupnost supstituta, udeo u budžetu kupca i vremenski period.",
      difficulty: "hard",
      expectedAnswer:
        "Mora da izračuna cenovnu elastičnost. Iznad 1 znači gubitak prihoda, a ispod 1 rast prihoda. Mora da uzme u obzir supstitute i dugoročnu reakciju kupaca.",
      strengths: "Povezuješ elastičnost sa prihodom.",
      missingPoints: "Dodaj da je dugoročna elastičnost obično veća od kratkoročne.",
    },
    {
      prompt:
        "Država uvodi porez na proizvod. Objasni uticaj na krivu ponude, ravnotežnu cenu i količinu.",
      answerGuide:
        "Porez povećava troškove po jedinici i pomera ponudu ulevo. Ravnotežna cena za kupca raste, a ravnotežna količina opada. Poreski teret se deli između kupca i prodavca u zavisnosti od elastičnosti.",
      difficulty: "medium",
      expectedAnswer:
        "Ponuda se pomera ulevo, cena raste, količina opada, a poreski teret više snosi ona strana tržišta koja je neelastičnija.",
      strengths: "Prepoznaješ smer pomeranja ponude.",
      missingPoints: "Objasni raspodelu poreskog tereta u zavisnosti od elastičnosti.",
    },
    {
      prompt: "Zašto ponuda kratkoročno reaguje sporije od tražnje?",
      answerGuide:
        "Proizvodni kapaciteti, ugovori i sirovine su kratkoročno fiksni, pa proizvođači ne mogu brzo da povećaju obim proizvodnje. Kupci, s druge strane, mogu odmah da promene svoje odluke.",
      difficulty: "medium",
      expectedAnswer:
        "Zato što su kapaciteti i inputi kratkoročno ograničeni, dok kupci odluku o kupovini menjaju odmah.",
      strengths: "Prepoznaješ vremensku dimenziju prilagođavanja.",
      missingPoints: "Navedi konkretan primer, na primer izgradnju nove proizvodne linije.",
    },
  ],
  transcript: [
    {
      startMs: 0,
      endMs: 28000,
      speakerLabel: "Predavač",
      text: "Dobro jutro. Danas završavamo poglavlje o tržištu, dakle ponudu, tražnju i ravnotežu. To je gradivo koje će vam na ispitu trebati praktično u svakom zadatku.",
    },
    {
      startMs: 28000,
      endMs: 74000,
      speakerLabel: "Predavač",
      text: "Počnimo sa tražnjom. Tražnja nije jedan broj, nego odnos između cene i količine. Kada cena raste, tražena količina opada. To je zakon tražnje.",
    },
    {
      startMs: 74000,
      endMs: 132000,
      speakerLabel: "Predavač",
      text: "Obratite pažnju na razliku koju studenti najčešće promaše. Tražena količina je jedna tačka na krivoj, a tražnja je cela kriva. Ako se promeni cena, krećemo se duž krive.",
    },
    {
      startMs: 132000,
      endMs: 205000,
      speakerLabel: "Predavač",
      text: "Krivu pomeraju drugi faktori: dohodak, cene supstituta i komplemenata, ukusi, očekivanja i broj kupaca na tržištu. Ako dohodak poraste, kriva se pomera udesno.",
    },
    {
      startMs: 205000,
      endMs: 268000,
      speakerLabel: "Studentkinja",
      text: "A kako je kod inferiornih dobara? Tamo je baš obrnuto, zar ne?",
    },
    {
      startMs: 268000,
      endMs: 330000,
      speakerLabel: "Predavač",
      text: "Upravo tako. Kod inferiornih dobara veći dohodak smanjuje tražnju, jer kupci prelaze na kvalitetniju zamenu.",
    },
    {
      startMs: 680000,
      endMs: 742000,
      speakerLabel: "Predavač",
      text: "Pređimo na ponudu. Kriva ponude raste jer viša cena pokriva veće granične troškove i privlači nove proizvođače u granu.",
    },
    {
      startMs: 742000,
      endMs: 815000,
      speakerLabel: "Predavač",
      text: "Ponudu pomeraju troškovi sirovina, tehnologija, porezi i subvencije. Nova tehnologija smanjuje troškove po jedinici i pomera ponudu udesno.",
    },
    {
      startMs: 1445000,
      endMs: 1512000,
      speakerLabel: "Predavač",
      text: "Ravnoteža je presek dve krive. To je jedina cena pri kojoj nema viška i nema manjka.",
    },
    {
      startMs: 1512000,
      endMs: 1588000,
      speakerLabel: "Predavač",
      text: "Ako je cena previsoka, roba ostaje neprodata, nastaje višak i prodavci snižavaju cenu. Ako je preniska, nastaje manjak i cena raste.",
    },
    {
      startMs: 2200000,
      endMs: 2276000,
      speakerLabel: "Predavač",
      text: "Poslednja tema je elastičnost. Elastičnost je procentualna promena količine podeljena procentualnom promenom cene.",
    },
    {
      startMs: 2276000,
      endMs: 2360000,
      speakerLabel: "Predavač",
      text: "Ako je apsolutna vrednost veća od jedan, tražnja je elastična i poskupljenje smanjuje prihod. Ako je manja od jedan, poskupljenje povećava prihod.",
    },
    {
      startMs: 2360000,
      endMs: 2430000,
      speakerLabel: "Student",
      text: "Da li to znači da se kod neophodnih dobara uvek isplati podići cenu?",
    },
    {
      startMs: 2430000,
      endMs: 2520000,
      speakerLabel: "Predavač",
      text: "Kratkoročno često da, ali dugoročno kupci pronađu zamene, pa je dugoročna elastičnost gotovo uvek veća od kratkoročne.",
    },
    {
      startMs: 2760000,
      endMs: 2842000,
      speakerLabel: "Predavač",
      text: "Za sledeći put pregledajte primere od jedan do pet. Na ispitu će sigurno biti zadatak sa pomeranjem krive, zato vežbajte crtanje grafikona.",
    },
  ],
  chatAnswers: [
    "Ukratko: kriva tražnje opada jer svaka dodatna jedinica kupcu donosi manju korist, a viša cena istovremeno smanjuje njegovu realnu kupovnu moć. Zato po višoj ceni kupci planiraju da kupe manju količinu.",
    "Razlika je u tome šta se pomera. Ako se promeni cena samog dobra, krećeš se duž postojeće krive. Ako se promeni bilo šta drugo – dohodak, cena supstituta, očekivanja – pomera se cela kriva.",
    "Da, to je klasično ispitno pitanje. Ako je tražnja neelastična (koeficijent ispod 1), poskupljenje povećava ukupan prihod, jer količina opada relativno manje nego što cena raste. Kod elastične tražnje efekat je obrnut.",
    "Višak ponude znači da je cena iznad ravnotežne. Zalihe rastu, prodavci snižavaju cenu, a time se tražena količina povećava, a ponuđena smanjuje, dok se tržište ne vrati u ravnotežu.",
  ],
};

const ANATOMIJA: DemoNotePack = {
  key: "anatomija",
  title: "Anatomija – građa nervnog sistema",
  sourceType: "pdf",
  durationSeconds: null,
  pageCount: 24,
  summary:
    "Skripta deli nervni sistem na centralni i periferni deo, opisuje neuron kao osnovnu jedinicu i objašnjava kako akcijski potencijal i sinapsa prenose informaciju kroz telo.",
  keyTopics: [
    "Centralni i periferni nervni sistem",
    "Građa neurona",
    "Akcijski potencijal",
    "Sinaptički prenos",
    "Autonomni nervni sistem",
  ],
  notesMd: `## Brzi pregled

Nervni sistem je informacioni sistem tela: prima draži, obrađuje ih i pokreće odgovor. Anatomski ga delimo na centralni nervni sistem, koji obrađuje informacije, i periferni nervni sistem, koji ih prenosi između tela i mozga. Osnovna funkcionalna jedinica je neuron, koji informaciju prenosi elektrohemijski.

> **Ključno:** Električni signal putuje unutar neurona, a između neurona se prenos uvek pretvara u hemijski signal preko sinapse.

## Ključne stvari koje moraš znati

- Centralni nervni sistem čine mozak i kičmena moždina.
- Periferni nervni sistem čine nervi i ganglije izvan centralnog nervnog sistema.
- Neuron ima dendrite, telo, akson i aksonske završetke.
- Mijelinski omotač ubrzava provođenje jer signal skokovito preskače između Ranvijeovih suženja.
- Akcijski potencijal je odgovor po principu sve ili ništa.
- Autonomni nervni sistem delimo na simpatičku i parasimpatičku granu, koje imaju suprotna dejstva.

| Deo nervnog sistema | Glavni zadatak | Karakteristična struktura |
| --- | --- | --- |
| Centralni | Obrada i čuvanje informacija | Moždana kora, kičmena moždina |
| Somatski | Svesni pokreti i opažanje | Motorna i senzorna vlakna |
| Simpatički | Aktivacija, borba ili bekstvo | Preovlađuje noradrenalin |
| Parasimpatički | Smirivanje, varenje i oporavak | Preovlađuje acetilholin |

## 1. 🧠 Podela nervnog sistema

### Glavna ideja

Nervni sistem funkcionalno delimo na centralni deo, koji obrađuje informacije, i periferni deo, koji ih prenosi.

### Detaljne beleške

Mozak i kičmena moždina čine centralni nervni sistem, koji štite kosti, moždane ovojnice i likvor. Periferni nervni sistem čine nervi koji povezuju centralni deo sa organima, mišićima i kožom.

- Somatski deo kontroliše svesne pokrete skeletnih mišića.
- Autonomni deo reguliše rad organa bez svesne kontrole.
- Kičmena moždina nije samo kabl: sama izvodi refleksni luk bez učešća mozga.

### Ključni pojmovi

- **Ganglija:** skup nervnih ćelija izvan centralnog nervnog sistema.
- **Jedro:** skup nervnih ćelija unutar centralnog nervnog sistema.
- **Refleksni luk:** najkraći put od receptora do efektora.

## 2. 🔬 Neuron

### Glavna ideja

Neuron je ćelija specijalizovana za prijem, provođenje i predaju električnog signala.

### Detaljne beleške

Dendriti primaju signale, telo ih sabira, a akson provodi akcijski potencijal do aksonskih završetaka. Mijelinski omotač deluje kao izolator, pa signal preskače između Ranvijeovih suženja i putuje znatno brže.

- **Definicija:** Aksonski brežuljak je mesto gde se odlučuje da li će akcijski potencijal biti pokrenut.
- Glijalne ćelije hrane i podržavaju neurone i stvaraju mijelin.
- Deblji i jače mijelinizovan akson brže provodi signal.

## 3. ⚡ Akcijski potencijal

### Glavna ideja

Akcijski potencijal je brzo obrtanje membranskog napona koje se bez slabljenja širi duž aksona.

### Detaljne beleške

U mirovanju je unutrašnjost ćelije negativna. Kada draž dostigne prag, otvaraju se natrijumovi kanali, natrijum ulazi u ćeliju i nastaje depolarizacija. Sledi izlazak kalijuma, odnosno repolarizacija, a zatim kratak refraktarni period.

> **Česta greška:** Jača draž ne stvara veći akcijski potencijal – samo povećava frekvenciju okidanja.

### Proces

- Draž dostiže prag nadražljivosti.
- Natrijumovi kanali se otvaraju i sledi depolarizacija.
- Kalijumovi kanali se otvaraju i sledi repolarizacija.
- Natrijum-kalijumova pumpa vraća potencijal mirovanja.

## 4. 🔗 Sinapsa

### Glavna ideja

Sinapsa je spoj dva neurona na kom se električni signal pretvara u hemijski.

### Detaljne beleške

Kada akcijski potencijal stigne do aksonskog završetka, otvaraju se kalcijumovi kanali. Vezikule sa neurotransmiterom stapaju se sa membranom i oslobađaju prenosilac u sinaptičku pukotinu, gde se on vezuje za receptore sledeće ćelije.

- Ekscitatorni prenosioci povećavaju verovatnoću novog akcijskog potencijala.
- Inhibitorni prenosioci tu verovatnoću smanjuju.
- Prenosilac se posle delovanja razgrađuje ili vraća u presinaptičku ćeliju.

### Proveri svoje znanje

- Koje strukture čine centralni nervni sistem?
- Zašto mijelin ubrzava provođenje?
- Šta znači princip sve ili ništa?
- Kako se signal prenosi između dva neurona?

## Završni pregled

- Centralni nervni sistem obrađuje informacije, a periferni ih prenosi.
- Neuron čine dendriti, telo, akson i aksonski završeci.
- Akcijski potencijal deluje po principu sve ili ništa, a jačinu draži kodira frekvencija.
- Mijelin omogućava skokovito i brže provođenje.
- Sinapsa pretvara električni signal u hemijski i nazad.`,
  images: [
    {
      file: "sr/nevron.svg",
      fileName: "sema-neurona.png",
      alt: "Građa neurona sa dendritima, telom, aksonom i aksonskim završecima",
      afterText: "Dendriti primaju signale, telo ih sabira",
    },
    {
      file: "sr/akcijski-potencial.svg",
      fileName: "akcijski-potencijal.png",
      alt: "Tok akcijskog potencijala u vremenu",
      afterText: "U mirovanju je unutrašnjost ćelije negativna",
    },
  ],
  sections: [
    { title: "Podela nervnog sistema", sourceLabel: "str. 3–7" },
    { title: "Građa neurona", sourceLabel: "str. 8–12" },
    { title: "Akcijski potencijal", sourceLabel: "str. 13–18" },
    { title: "Sinaptički prenos", sourceLabel: "str. 19–24" },
  ],
  flashcards: [
    {
      front: "Šta čini centralni nervni sistem?",
      back: "Mozak i kičmena moždina, koje štite kosti, moždane ovojnice i likvor.",
      difficulty: "easy",
      sectionIdx: 0,
    },
    {
      front: "Razlika između ganglije i jedra?",
      back: "Ganglija je skup nervnih ćelija izvan centralnog nervnog sistema, a jedro je skup unutar njega.",
      difficulty: "hard",
      sectionIdx: 0,
    },
    {
      front: "Šta je refleksni luk?",
      back: "Najkraći nervni put od receptora preko kičmene moždine do efektora, bez učešća mozga.",
      difficulty: "medium",
      sectionIdx: 0,
    },
    {
      front: "Nabroj glavne delove neurona.",
      back: "Dendriti, telo ćelije, akson i aksonski završeci.",
      hint: "Od prijema do predaje signala.",
      difficulty: "easy",
      sectionIdx: 1,
    },
    {
      front: "Zašto mijelinski omotač ubrzava provođenje?",
      back: "Deluje kao izolator, pa signal preskače između Ranvijeovih suženja – to je skokovito provođenje.",
      difficulty: "medium",
      sectionIdx: 1,
    },
    {
      front: "Šta se dešava na aksonskom brežuljku?",
      back: "Tu se sabiraju ulazni signali i odlučuje se da li je prag premašen i da li će akcijski potencijal biti pokrenut.",
      difficulty: "hard",
      sectionIdx: 1,
    },
    {
      front: "Šta znači princip sve ili ništa?",
      back: "Akcijski potencijal se pokreće ili u punoj veličini ili se uopšte ne pokreće. Jačina draži se kodira frekvencijom okidanja.",
      difficulty: "medium",
      sectionIdx: 2,
    },
    {
      front: "Koji jon izaziva depolarizaciju?",
      back: "Natrijum, koji ulazi u ćeliju kada se otvore naponski zavisni kanali.",
      difficulty: "easy",
      sectionIdx: 2,
    },
    {
      front: "Šta je refraktarni period?",
      back: "Kratak period posle akcijskog potencijala u kom neuron nije nadražljiv, što obezbeđuje jednosmerno širenje signala.",
      difficulty: "hard",
      sectionIdx: 2,
    },
    {
      front: "Kako teče prenos preko sinapse?",
      back: "Akcijski potencijal izaziva ulazak kalcijuma, vezikule oslobađaju neurotransmiter u pukotinu, a on se vezuje za receptore sledeće ćelije.",
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
        "Kičmena moždina i ganglije",
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
        "Mijelinski omotač sa Ranvijeovim suženjima",
        "Broj sinapsi",
        "Veličina tela ćelije",
      ],
      correctOptionIdx: 1,
      explanation:
        "Mijelin izoluje akson, pa se depolarizacija dešava samo u suženjima i signal preskače.",
      difficulty: "medium",
    },
    {
      prompt: "Jača draž izaziva:",
      options: [
        "Veći akcijski potencijal",
        "Duži akcijski potencijal",
        "Veću frekvenciju akcijskih potencijala",
        "Sporije provođenje",
      ],
      correctOptionIdx: 2,
      explanation:
        "Zbog principa sve ili ništa jačina draži se kodira frekvencijom, a ne amplitudom.",
      difficulty: "medium",
    },
    {
      prompt: "Koji jon je odgovoran za repolarizaciju?",
      options: ["Natrijum", "Kalijum", "Kalcijum", "Hlor"],
      correctOptionIdx: 1,
      explanation: "Posle depolarizacije kalijum napušta ćeliju i membranski napon se vraća naniže.",
      difficulty: "medium",
    },
    {
      prompt: "Šta pokreće oslobađanje neurotransmitera u sinaptičku pukotinu?",
      options: [
        "Ulazak kalcijuma u aksonski završetak",
        "Izlazak kalijuma iz dendrita",
        "Zatvaranje natrijumovih kanala",
        "Delovanje mijelina",
      ],
      correctOptionIdx: 0,
      explanation:
        "Akcijski potencijal otvara kalcijumove kanale, a kalcijum pokreće stapanje vezikula sa membranom.",
      difficulty: "hard",
    },
    {
      prompt: "Parasimpatički nervni sistem pre svega:",
      options: [
        "Priprema telo za borbu ili bekstvo",
        "Ubrzava rad srca",
        "Smiruje telo i podstiče varenje",
        "Kontroliše svesne pokrete",
      ],
      correctOptionIdx: 2,
      explanation: "Parasimpatikus preovlađuje u mirovanju i podržava varenje i oporavak.",
      difficulty: "easy",
    },
    {
      prompt: "Skup nervnih ćelija izvan centralnog nervnog sistema zove se:",
      options: ["Jedro", "Ganglija", "Sinapsa", "Ovojnica"],
      correctOptionIdx: 1,
      explanation: "Izvan centralnog nervnog sistema to je ganglija, a unutar njega jedro.",
      difficulty: "hard",
    },
  ],
  practice: [
    {
      prompt: "Opiši put signala od dendrita do sledeće ćelije.",
      answerGuide:
        "Dendriti primaju signal, telo ga sabira, na aksonskom brežuljku se, kada je prag premašen, pokreće akcijski potencijal, koji putuje duž aksona do aksonskih završetaka, gde se neurotransmiter oslobađa u sinaptičku pukotinu.",
      difficulty: "medium",
      expectedAnswer:
        "Dendrit → telo ćelije → aksonski brežuljak → akson → aksonski završetak → sinaptička pukotina → receptori sledeće ćelije.",
      strengths: "Redosled struktura je tačan.",
      missingPoints: "Pomeni i ulogu kalcijuma u oslobađanju vezikula.",
    },
    {
      prompt: "Objasni princip sve ili ništa i reci kako telo kodira jačinu draži.",
      answerGuide:
        "Akcijski potencijal se pokreće u punoj veličini ili se uopšte ne pokreće. Jača draž povećava frekvenciju okidanja i broj nadraženih neurona, ali ne i amplitudu signala.",
      difficulty: "medium",
      expectedAnswer:
        "Amplituda je uvek ista; jačina draži se kodira frekvencijom akcijskih potencijala i brojem aktiviranih vlakana.",
      strengths: "Tačno navodiš da amplituda ostaje ista.",
      missingPoints: "Dodaj ulogu praga nadražljivosti.",
    },
    {
      prompt: "Uporedi simpatički i parasimpatički nervni sistem.",
      answerGuide:
        "Simpatikus priprema telo za napor: ubrzava rad srca, širi bronhije i usporava varenje. Parasimpatikus deluje suprotno i preovlađuje u mirovanju. Glavni prenosioci su noradrenalin i acetilholin.",
      difficulty: "easy",
      expectedAnswer:
        "Simpatikus = aktivacija (borba ili bekstvo, noradrenalin), parasimpatikus = smirivanje i varenje (acetilholin).",
      strengths: "Suprotna dejstva su jasno predstavljena.",
      missingPoints: "Navedi bar jedan konkretan organ i dejstvo na njega.",
    },
    {
      prompt: "Zašto je refraktarni period važan za pravilan rad nervnog sistema?",
      answerGuide:
        "Tokom refraktarnog perioda neuron nije nadražljiv, pa akcijski potencijal ne može da se vrati unazad duž aksona. To obezbeđuje jednosmerno provođenje i ograničava najveću frekvenciju okidanja.",
      difficulty: "hard",
      expectedAnswer:
        "Obezbeđuje jednosmerno širenje signala i ograničava frekvenciju akcijskih potencijala.",
      strengths: "Prepoznaješ zaštitnu ulogu refraktarnog perioda.",
      missingPoints: "Razlikuj apsolutni i relativni refraktarni period.",
    },
  ],
  transcript: [],
  chatAnswers: [
    "Mijelinski omotač deluje kao izolator, pa se depolarizacija dešava samo u Ranvijeovim suženjima. Signal tako bukvalno preskače od suženja do suženja, što zovemo skokovito provođenje, i ono je znatno brže od kontinuiranog.",
    "Princip sve ili ništa znači da akcijski potencijal ili nastaje u punoj veličini ili ga uopšte nema. Zato jača draž ne povećava amplitudu, već frekvenciju okidanja i broj aktiviranih vlakana.",
    "Ganglija i jedro su i jedno i drugo skupovi tela nervnih ćelija – razlika je samo u položaju. Ganglija leži izvan centralnog nervnog sistema, a jedro unutar njega. To je često ispitno pitanje.",
    "Prenos preko sinapse teče ovako: akcijski potencijal stiže do aksonskog završetka, otvaraju se kalcijumovi kanali, kalcijum pokreće stapanje vezikula sa membranom, a neurotransmiter se oslobađa u pukotinu i vezuje za receptore sledeće ćelije.",
  ],
};

const ERP_CLANEK: DemoNotePack = {
  key: "erp",
  title: "Članak: ERP sistemi u praksi",
  sourceType: "link",
  durationSeconds: null,
  summary:
    "Članak objašnjava šta je ERP sistem, koje module preduzeća uvode prve, zašto uvođenje često premaši budžet i koji pokazatelji otkrivaju da li se ulaganje isplatilo.",
  keyTopics: [
    "Definicija ERP sistema",
    "Ključni moduli",
    "Tok uvođenja",
    "Najčešći razlozi neuspeha",
    "Merenje isplativosti",
  ],
  notesMd: `## Brzi pregled

ERP je jedinstven informacioni sistem koji poslovne procese različitih sektora povezuje u zajedničku bazu podataka. Umesto odvojenih programa za finansije, nabavku i proizvodnju, svi rade sa istim podacima u realnom vremenu. Najveći izazov uvođenja nije tehnologija, već promena radnih navika.

> **Ključno:** Vrednost ERP sistema ne nastaje pri instalaciji, već onda kada preduzeće svoje procese prilagodi sistemu, a ne obrnuto.

## Ključne stvari koje moraš znati

- ERP znači Enterprise Resource Planning, odnosno planiranje resursa preduzeća.
- Osnova sistema je jedna jedina zajednička baza podataka za sve module.
- Najčešće se prvo uvode modul finansija i modul nabavke.
- Prilagođavanje standardnog rešenja glavni je izvor prekoračenja troškova.
- Uspeh uvođenja više zavisi od podrške rukovodstva i obuke nego od izbora isporučioca.

| Modul | Šta pokriva | Tipična korist |
| --- | --- | --- |
| Finansije | Glavna knjiga, potraživanja, obaveze | Brže zatvaranje perioda |
| Nabavka | Porudžbine, dobavljači, zalihe | Niže zalihe i bolji uslovi |
| Proizvodnja | Radni nalozi, sastavnice | Kraći rokovi isporuke |
| Kadrovi | Evidencija, plate, odsustva | Manje ručnog rada |

## 1. 🏢 Šta je ERP sistem

### Glavna ideja

ERP je celovito softversko rešenje koje poslovne procese preduzeća povezuje oko jedne zajedničke baze podataka.

### Detaljne beleške

Pre ERP-a sektori su koristili odvojene programe, a podatke su prenosili ručno ili putem izveštaja. Zbog toga su nastajala neslaganja između sektora. ERP to otklanja tako što se svaki događaj beleži jednom i odmah je vidljiv svima.

- **Definicija:** Modul je funkcionalno zaokružen deo sistema za određenu oblast poslovanja.
- Sistem je dobar onoliko koliko su kvalitetni uneti podaci.
- Savremena rešenja su sve češće u oblaku, što smanjuje početni trošak.

## 2. 🧩 Uvođenje po fazama

### Glavna ideja

Uvođenje teče u fazama, jer istovremeni prelazak svih sektora znatno povećava rizik.

### Detaljne beleške

Preduzeća obično počinju modulom finansija, jer su tu procesi najviše standardizovani. Slede nabavka, prodaja i tek onda proizvodnja, koja najviše zavisi od delatnosti.

### Proces

- Analiza postojećih procesa i popis zahteva.
- Izbor isporučioca i određivanje obima projekta.
- Konfiguracija, migracija podataka i testiranje.
- Obuka korisnika i puštanje u rad.
- Stabilizacija i postepeno dodavanje modula.

## 3. ⚠️ Zašto uvođenja propadaju

### Glavna ideja

Većina neuspešnih projekata propada iz organizacionih, a ne iz tehničkih razloga.

### Detaljne beleške

Najčešći uzroci su nejasan obim projekta, preterano prilagođavanje standardnog rešenja, loš kvalitet prenetih podataka i premalo obuke. Svako prilagođavanje poskupljuje i svaku buduću nadogradnju.

> **Česta greška:** Preduzeće prenese star, neefikasan proces u novi sistem i onda shvati da se ništa nije poboljšalo.

## 4. 📊 Merenje isplativosti

### Glavna ideja

Isplativost merimo poslovnim pokazateljima pre i posle uvođenja, a ne utiskom korisnika.

### Detaljne beleške

Najčešće se prate vreme zatvaranja meseca, obrt zaliha, udeo zakasnelih isporuka i broj ručnih ispravki. Stvarni efekat se obično vidi tek posle nekoliko meseci stabilizacije.

### Proveri svoje znanje

- Koja je glavna prednost zajedničke baze podataka?
- Zašto uvođenje obično počinje modulom finansija?
- Koja su tri najčešća razloga neuspeha?
- Kako merimo da li se ulaganje isplatilo?

## Završni pregled

- ERP povezuje sektore oko jedne jedine baze podataka.
- Uvođenje treba da teče u fazama, počevši od najstandardizovanijih procesa.
- Preterano prilagođavanje je glavni izvor prekoračenja budžeta.
- Kvalitet podataka i obuka odlučuju o uspehu.
- Isplativost dokazuju merljivi pokazatelji pre i posle uvođenja.`,
  images: [
    {
      file: "sr/erp-moduli.svg",
      fileName: "erp-moduli.png",
      alt: "Moduli ERP sistema oko zajedničke baze podataka",
      afterText: "Pre ERP-a sektori su koristili odvojene programe",
    },
    {
      file: "sr/erp-uvedba.svg",
      fileName: "faze-uvodjenja.png",
      alt: "Faze uvođenja ERP sistema",
      afterText: "Preduzeća obično počinju modulom finansija",
    },
  ],
  sections: [
    { title: "Šta je ERP sistem", sourceLabel: "1. deo članka" },
    { title: "Uvođenje po fazama", sourceLabel: "2. deo članka" },
    { title: "Razlozi neuspeha", sourceLabel: "3. deo članka" },
    { title: "Merenje isplativosti", sourceLabel: "4. deo članka" },
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
      back: "Jedna zajednička baza podataka, pa se svaki podatak unosi jednom i odmah je vidljiv svim sektorima.",
      difficulty: "easy",
      sectionIdx: 0,
    },
    {
      front: "Šta je modul u ERP sistemu?",
      back: "Funkcionalno zaokružen deo sistema koji pokriva jednu poslovnu oblast, na primer finansije ili nabavku.",
      difficulty: "medium",
      sectionIdx: 0,
    },
    {
      front: "Kojim modulom uvođenje obično počinje i zašto?",
      back: "Modulom finansija, jer su finansijski procesi najviše standardizovani i najmanje zavise od delatnosti.",
      difficulty: "medium",
      sectionIdx: 1,
    },
    {
      front: "Nabroj faze uvođenja ERP sistema.",
      back: "Analiza procesa, izbor isporučioca, konfiguracija i migracija podataka, testiranje, obuka, puštanje u rad i stabilizacija.",
      difficulty: "hard",
      sectionIdx: 1,
    },
    {
      front: "Zašto je preterano prilagođavanje sistema opasno?",
      back: "Povećava troškove projekta i poskupljuje svaku buduću nadogradnju, jer prilagođavanja svaki put treba ponovo proveriti.",
      difficulty: "hard",
      sectionIdx: 2,
    },
    {
      front: "Koji su najčešći razlozi neuspeha uvođenja?",
      back: "Nejasan obim projekta, preterano prilagođavanje, loš kvalitet podataka i premalo obuke korisnika.",
      difficulty: "medium",
      sectionIdx: 2,
    },
    {
      front: "Kojim pokazateljima merimo isplativost ERP sistema?",
      back: "Vreme zatvaranja meseca, obrt zaliha, udeo zakasnelih isporuka i broj ručnih ispravki.",
      difficulty: "medium",
      sectionIdx: 3,
    },
  ],
  quiz: [
    {
      prompt: "Koja je osnovna karakteristika ERP sistema?",
      options: [
        "Svaki sektor ima svoju bazu podataka",
        "Svi moduli dele jednu zajedničku bazu podataka",
        "Sistem radi samo van mreže",
        "Namenjen je isključivo računovodstvu",
      ],
      correctOptionIdx: 1,
      explanation:
        "Zajednička baza podataka je suština ERP sistema i otklanja neslaganja između sektora.",
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
        "Preterano prilagođavanje standardnog rešenja",
        "Premali broj korisnika",
        "Korišćenje rešenja u oblaku",
        "Prebrzo pokretanje proizvodnje",
      ],
      correctOptionIdx: 0,
      explanation:
        "Svako prilagođavanje poskupljuje projekat i sve buduće nadogradnje sistema.",
      difficulty: "medium",
    },
    {
      prompt: "Zašto je kvalitet podataka ključan pri migraciji?",
      options: [
        "Zato što sistem bez podataka ne radi",
        "Zato što pogrešni podaci u novom sistemu dovode do pogrešnih odluka",
        "Zato što migracija zahteva više servera",
        "Zato što se podaci posle migracije brišu",
      ],
      correctOptionIdx: 1,
      explanation:
        "Novi sistem ne ispravlja loše podatke, već ih samo brže širi kroz preduzeće.",
      difficulty: "hard",
    },
    {
      prompt: "Koji pokazatelj najbolje pokazuje uticaj ERP-a na zalihe?",
      options: [
        "Broj korisnika sistema",
        "Obrt zaliha",
        "Broj modula",
        "Trajanje obuke",
      ],
      correctOptionIdx: 1,
      explanation: "Obrt zaliha direktno meri koliko efikasno preduzeće upravlja zalihama.",
      difficulty: "medium",
    },
    {
      prompt: "Kada se stvarni efekti uvođenja obično vide?",
      options: [
        "Odmah pri puštanju u rad",
        "Posle nekoliko meseci stabilizacije",
        "Tek posle promene isporučioca",
        "Nikada ih nije moguće izmeriti",
      ],
      correctOptionIdx: 1,
      explanation:
        "Posle puštanja u rad sledi period stabilizacije, u kom se korisnici navikavaju na nove procese.",
      difficulty: "easy",
    },
  ],
  practice: [
    {
      prompt: "Objasni zašto je zajednička baza podataka glavna prednost ERP sistema.",
      answerGuide:
        "Podatak se unosi jednom i odmah je dostupan svim sektorima, što otklanja dupliranje, ručne prenose i neslaganja između izveštaja različitih sektora.",
      difficulty: "easy",
      expectedAnswer:
        "Jedan unos, jedan izvor istine, nema ručnih prenosa između sistema i nema razlika između sektora.",
      strengths: "Prepoznaješ da se otklanja dupliranje podataka.",
      missingPoints: "Dodaj konkretan primer, na primer zajednički zapis o zalihama.",
    },
    {
      prompt: "Opiši faze uvođenja ERP sistema i objasni zašto je fazni pristup bezbedniji.",
      answerGuide:
        "Analiza, izbor isporučioca, konfiguracija i migracija, testiranje, obuka, puštanje u rad i stabilizacija. Fazni pristup ograničava obim rizika i omogućava učenje na manjem delu sistema.",
      difficulty: "medium",
      expectedAnswer:
        "Faze slede jedna za drugom od analize do stabilizacije; postepenost smanjuje rizik da svi procesi zastanu istovremeno.",
      strengths: "Faze su navedene pravilnim redosledom.",
      missingPoints: "Objasni zašto je modul proizvodnje obično poslednji.",
    },
    {
      prompt: "Preduzeće posle godinu dana ne vidi koristi od ERP sistema. Šta bi prvo proverio?",
      answerGuide:
        "Da li su procesi ostali nepromenjeni, da li je obuka bila dovoljna, kakav je kvalitet migriranih podataka i da li se uopšte mere pravi pokazatelji pre i posle uvođenja.",
      difficulty: "hard",
      expectedAnswer:
        "Proverio bih promenu procesa, obuku, kvalitet podataka i postojanje polaznih merenja.",
      strengths: "Tražiš organizacione, a ne samo tehničke uzroke.",
      missingPoints: "Pomeni i obim prilagođavanja standardnog rešenja.",
    },
    {
      prompt: "Kako bi izmerio isplativost ulaganja u ERP sistem?",
      answerGuide:
        "Poređenjem merljivih pokazatelja pre i posle uvođenja: vreme zatvaranja meseca, obrt zaliha, udeo zakasnelih isporuka i obim ručnih ispravki, uz uračunavanje ukupnih troškova vlasništva.",
      difficulty: "medium",
      expectedAnswer:
        "Postavim polazna merenja, ponovim ih posle stabilizacije i uporedim sa ukupnim troškovima projekta.",
      strengths: "Ističeš polazno merenje pre uvođenja.",
      missingPoints: "Uključi i troškove održavanja i licenci.",
    },
  ],
  transcript: [],
  chatAnswers: [
    "Glavna prednost je jedna jedina zajednička baza podataka. Podatak se unosi jednom i odmah je vidljiv svim sektorima, pa nema ručnih prenosa, dupliranja ni razlika između izveštaja finansija i nabavke.",
    "Preduzeća počinju modulom finansija, jer su finansijski procesi najviše standardizovani i najmanje zavise od delatnosti. Modul proizvodnje dolazi poslednji, jer je najspecifičniji.",
    "Najčešći razlozi neuspeha su organizacioni: nejasan obim projekta, preterano prilagođavanje standardnog rešenja, loš kvalitet migriranih podataka i premalo obuke korisnika.",
    "Isplativost meriš tako što pre uvođenja zabeležiš polazne pokazatelje – vreme zatvaranja meseca, obrt zaliha, udeo zakasnelih isporuka – i posle nekoliko meseci stabilizacije ih ponovo izmeriš.",
  ],
};

const ZGODOVINA: DemoNotePack = {
  key: "zgodovina",
  title: "Istorija – Francuska revolucija",
  sourceType: "presentation",
  pageCount: 18,
  durationSeconds: null,
  summary:
    "Beleške sažimaju uzroke Francuske revolucije, tok od sazivanja Generalnih staleža do Napoleonovog preuzimanja vlasti i dugoročne posledice za Evropu.",
  keyTopics: [
    "Uzroci revolucije",
    "Generalni staleži i Narodna skupština",
    "Deklaracija o pravima",
    "Jakobinska diktatura",
    "Posledice za Evropu",
  ],
  notesMd: `## Brzi pregled

Francuska revolucija počela je kao finansijska kriza apsolutističke monarhije i prerasla u temeljan raskid sa starim društvenim poretkom. Za deset godina Francuska je prešla put od staleškog društva do republike, a zatim do Napoleonove diktature. Ideje jednakosti pred zakonom ipak su se proširile po celoj Evropi.

> **Ključno:** Revolucija nije izbila zbog jedne jedine nepravde, već zbog podudaranja državnog bankrota, loše žetve i staleškog sistema koji je poreski teret svaljivao na one sa najmanje prava.

## Ključne stvari koje moraš znati

- Francusko društvo bilo je podeljeno na tri staleža, a poreze je plaćao uglavnom treći stalež.
- Državna blagajna bila je iscrpljena ratovima i troškovima dvora.
- Sazivanje Generalnih staleža 1789. godine pokrenulo je politički spor o načinu glasanja.
- Deklaracija o pravima čoveka i građanina uvela je jednakost pred zakonom.
- Revolucija se završila Napoleonovim državnim udarom 1799. godine.

| Period | Ključni događaj | Posledica |
| --- | --- | --- |
| 1789 | Sazivanje Generalnih staleža, pad Bastilje | Kraj apsolutizma |
| 1791 | Prvi ustav | Ustavna monarhija |
| 1793–1794 | Jakobinska diktatura | Teror i masovna pogubljenja |
| 1799 | Napoleonov državni udar | Kraj revolucije |

## 1. 🔥 Uzroci

### Glavna ideja

Revoluciju je pokrenulo podudaranje finansijskog sloma države i dubokih društvenih nejednakosti.

### Detaljne beleške

Prva dva staleža, sveštenstvo i plemstvo, bila su uglavnom oslobođena poreza, iako su imala najviše imovine. Treći stalež obuhvatao je više od devedeset odsto stanovništva i nosio gotovo ceo poreski teret. Loša žetva 1788. godine podigla je cenu hleba do granice koja je za gradsko stanovništvo značila glad.

- **Definicija:** Staleško društvo je poredak u kom su prava određena rođenjem, a ne zaslugama.
- Prosvetiteljske ideje dale su jezik za kritiku apsolutizma.
- Podrška Američkoj revoluciji konačno je iscrpla državnu blagajnu.

## 2. 🏛️ Od Generalnih staleža do republike

### Glavna ideja

Spor o načinu glasanja doveo je treći stalež do proglašenja Narodne skupštine.

### Detaljne beleške

Kralj je u maju 1789. sazvao Generalne staleže da bi odobrili nove poreze. Pošto je svaki stalež imao jedan glas, treći stalež bi uvek bio nadglasan. U junu se proglasio Narodnom skupštinom i zakletvom u dvorani za igru loptom obećao da se neće razići dok Francuska ne dobije ustav.

### Proces

- Maj 1789: sazivanje Generalnih staleža u Versaju.
- Jun 1789: proglašenje Narodne skupštine i zakletva u dvorani za igru loptom.
- Jul 1789: pad Bastilje kao simbolični kraj apsolutizma.
- Avgust 1789: Deklaracija o pravima čoveka i građanina.
- Septembar 1792: proglašenje republike.

## 3. ⚔️ Jakobinska diktatura

### Glavna ideja

Rat i unutrašnje pobune doveli su do vanrednog režima koji je protivnike uklanjao smrtnim presudama.

### Detaljne beleške

Komitet javnog spasa pod Robespjerom uveo je opštu mobilizaciju, ograničenja cena i revolucionarne sudove. Teror je predstavljan kao privremeno sredstvo za spas republike, ali je zahvatio i same revolucionare.

> **Česta greška:** Teror nije bio program cele revolucije, već odgovor na poseban period rata i unutrašnje krize.

## 4. 🌍 Posledice

### Glavna ideja

Revolucija je ukinula feudalne privilegije i proširila načelo jednakosti pred zakonom po Evropi.

### Detaljne beleške

Napoleonovi pohodi preneli su zakonik i upravne reforme na okupirane teritorije. Stari poredak je posle 1815. delimično obnovljen, ali se ideja narodnog suvereniteta održala i u 19. veku pokrenula nove pokrete.

### Proveri svoje znanje

- Zašto je poreski sistem pre revolucije bio neodrživ?
- Šta je značila zakletva u dvorani za igru loptom?
- Koji dokument je uveo jednakost pred zakonom?
- Zašto se revolucija završila diktaturom?

## Završni pregled

- Uzroci su bili istovremeno finansijski, društveni i idejni.
- Pad Bastilje je simbolični, a ne stvarni kraj apsolutizma.
- Deklaracija iz 1789. godine temelj je modernih građanskih prava.
- Teror je bio odgovor na ratno stanje, a ne cilj revolucije.
- Nasleđe revolucije je ideja jednakosti pred zakonom i narodnog suvereniteta.`,
  images: [
    {
      file: "sr/revolucija-casovnica.svg",
      fileName: "vremenska-linija-1789-1799.png",
      alt: "Vremenska linija Francuske revolucije od 1789. do 1799.",
      afterText: "Kralj je u maju 1789. sazvao Generalne staleže",
    },
  ],
  sections: [
    { title: "Uzroci revolucije", sourceLabel: "1. celina" },
    { title: "Od staleža do republike", sourceLabel: "2. celina" },
    { title: "Jakobinska diktatura", sourceLabel: "3. celina" },
    { title: "Posledice", sourceLabel: "4. celina" },
  ],
  flashcards: [
    {
      front: "Kako je bilo podeljeno francusko društvo pre revolucije?",
      back: "Na tri staleža: sveštenstvo, plemstvo i treći stalež, koji je obuhvatao više od 90 odsto stanovništva.",
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
      front: "Šta simbolizuje pad Bastilje?",
      back: "Simbolični pad apsolutističke vlasti i početak revolucije; 14. jul je i danas državni praznik.",
      difficulty: "easy",
      sectionIdx: 1,
    },
    {
      front: "Šta je uvela Deklaracija o pravima čoveka i građanina?",
      back: "Jednakost pred zakonom, slobodu govora i veroispovesti i načelo da vlast potiče od naroda.",
      difficulty: "medium",
      sectionIdx: 1,
    },
    {
      front: "Ko je vodio Komitet javnog spasa?",
      back: "Maksimilijan Robespjer, u vreme jakobinske diktature 1793–1794.",
      difficulty: "hard",
      sectionIdx: 2,
    },
    {
      front: "Zašto je došlo do terora?",
      back: "Zbog spoljnog rata i unutrašnjih pobuna režim je uveo vanredne mere i revolucionarne sudove.",
      difficulty: "hard",
      sectionIdx: 2,
    },
    {
      front: "Kada i kako se revolucija završila?",
      back: "Godine 1799. Napoleonovim državnim udarom, kojim je republika pretvorena u ličnu vlast.",
      difficulty: "medium",
      sectionIdx: 3,
    },
  ],
  quiz: [
    {
      prompt: "Koji stalež je nosio najveći poreski teret?",
      options: ["Sveštenstvo", "Plemstvo", "Treći stalež", "Svi podjednako"],
      correctOptionIdx: 2,
      explanation:
        "Prva dva staleža bila su uglavnom oslobođena poreza, pa je teret pao na treći stalež.",
      difficulty: "easy",
    },
    {
      prompt: "Šta je bio neposredni povod za sazivanje Generalnih staleža?",
      options: [
        "Pobeda u ratu",
        "Finansijska kriza države",
        "Smrt kralja",
        "Otkriće novih teritorija",
      ],
      correctOptionIdx: 1,
      explanation: "Kralju je bilo potrebno odobrenje novih poreza, jer je blagajna bila iscrpljena.",
      difficulty: "medium",
    },
    {
      prompt: "Koji događaj se smatra simboličnim početkom revolucije?",
      options: [
        "Zakletva u dvorani za igru loptom",
        "Pad Bastilje",
        "Proglašenje republike",
        "Napoleonov udar",
      ],
      correctOptionIdx: 1,
      explanation: "Pad Bastilje 14. jula 1789. simbolični je pad apsolutizma.",
      difficulty: "easy",
    },
    {
      prompt: "Šta je propisivala Deklaracija o pravima čoveka i građanina?",
      options: [
        "Povratak feudalnih privilegija",
        "Jednakost pred zakonom i narodni suverenitet",
        "Obavezni vojni rok",
        "Ukidanje privatne svojine",
      ],
      correctOptionIdx: 1,
      explanation:
        "Deklaracija je uvela jednakost pred zakonom i načelo da vlast potiče od naroda.",
      difficulty: "medium",
    },
    {
      prompt: "Jakobinska diktatura bila je pre svega odgovor na:",
      options: [
        "Privredni rast",
        "Spoljni rat i unutrašnje pobune",
        "Povratak kralja na presto",
        "Osnivanje kolonija",
      ],
      correctOptionIdx: 1,
      explanation: "Vanredne mere opravdavane su ratnim stanjem i unutrašnjim pobunama.",
      difficulty: "hard",
    },
    {
      prompt: "Šta je najtrajnije nasleđe revolucije?",
      options: [
        "Obnova staleškog društva",
        "Ideja jednakosti pred zakonom i narodnog suvereniteta",
        "Ukidanje vojske",
        "Povratak apsolutizma",
      ],
      correctOptionIdx: 1,
      explanation:
        "Uprkos restauraciji posle 1815. godine, ideje jednakosti i narodnog suvereniteta su opstale.",
      difficulty: "medium",
    },
  ],
  practice: [
    {
      prompt: "Nabroj i objasni tri glavna uzroka Francuske revolucije.",
      answerGuide:
        "Finansijski slom države zbog ratova i troškova dvora, društvena nejednakost staleškog društva sa poreskim privilegijama i prosvetiteljske ideje, koje su dale jezik za kritiku apsolutizma. Loša žetva 1788. godine delovala je kao okidač.",
      difficulty: "medium",
      expectedAnswer:
        "Finansijska kriza, staleška nejednakost i prosvetiteljske ideje, uz okidač u vidu skupoće hleba.",
      strengths: "Razlikuješ dugoročne uzroke od neposrednog povoda.",
      missingPoints: "Dodaj ulogu podrške Američkoj revoluciji u iscrpljivanju blagajne.",
    },
    {
      prompt: "Objasni zašto je spor o glasanju u Generalnim staležima doveo do raskida.",
      answerGuide:
        "Glasalo se po staležima, pa bi treći stalež uvek bio nadglasan sa dva prema jedan, iako je predstavljao veliku većinu stanovništva. Zahtev za glasanje po glavi je odbijen, pa se treći stalež proglasio Narodnom skupštinom.",
      difficulty: "hard",
      expectedAnswer:
        "Glasanje po staležima uvek je stavljalo treći stalež u manjinu, pa se on osamostalio kao Narodna skupština.",
      strengths: "Prepoznaješ mehanizam nadglasavanja.",
      missingPoints: "Pomeni zakletvu u dvorani za igru loptom kao tačku bez povratka.",
    },
    {
      prompt: "Zašto se revolucija, koja je počela zahtevom za slobodom, završila diktaturom?",
      answerGuide:
        "Rat, unutrašnje pobune i ekonomska kriza doveli su do vanrednih mera i terora. Posle Robespjerovog pada nastala je politička nestabilnost, koju je uz podršku vojske iskoristio Napoleon.",
      difficulty: "hard",
      expectedAnswer:
        "Zbog ratnog stanja, terora i kasnije nestabilnosti Direktorijuma, koju je iskoristila vojska.",
      strengths: "Povezuješ spoljnu ugroženost sa unutrašnjom radikalizacijom.",
      missingPoints: "Dodaj ulogu vojske kao nosioca reda posle 1795. godine.",
    },
    {
      prompt: "Kakve su bile posledice revolucije za ostatak Evrope?",
      answerGuide:
        "Napoleonovi pohodi proširili su građanski zakonik i upravne reforme, ukinuli ostatke feudalizma i podstakli nacionalne pokrete. Posle 1815. stari poredak je delimično obnovljen, ali su ideje ostale žive.",
      difficulty: "medium",
      expectedAnswer:
        "Širenje građanskog zakonika i jednakosti pred zakonom, ukidanje ostataka feudalizma i uspon nacionalnih pokreta.",
      strengths: "Prepoznaješ prenošenje ideja kroz vojne pohode.",
      missingPoints: "Pomeni Bečki kongres i pokušaj restauracije.",
    },
  ],
  transcript: [],
  chatAnswers: [
    "Glavna su bila tri uzroka, koja su delovala istovremeno: državni bankrot posle skupih ratova, staleško društvo sa poreskim privilegijama za prva dva staleža i prosvetiteljske ideje, koje su dale jezik za kritiku apsolutizma. Skupoća hleba 1788. godine bila je okidač.",
    "U Generalnim staležima svaki stalež je imao jedan glas, pa bi treći stalež uvek bio nadglasan sa dva prema jedan – iako je predstavljao više od 90 odsto stanovništva. Zato se u junu 1789. proglasio Narodnom skupštinom.",
    "Teror je bio odgovor na vanredne okolnosti: Francuska je ratovala sa savezom evropskih monarhija i suočavala se sa unutrašnjim pobunama. Komitet javnog spasa opravdavao je vanredne mere spasavanjem republike.",
    "Deklaracija o pravima čoveka i građanina iz avgusta 1789. uvela je jednakost pred zakonom, slobodu govora i veroispovesti i načelo da vlast potiče od naroda, a ne od kralja.",
  ],
};

export const SR_DEMO_CONTENT: DemoLocaleContent = {
  packs: [MIKROEKONOMIJA, ANATOMIJA, ERP_CLANEK, ZGODOVINA],
  folderNames: {
    "demo-folder-izpiti": "Ispitni rok",
    "demo-folder-seminarska": "Seminarski rad",
  },
  liveFigures: [
    {
      file: "sr/ponudba-povprasevanje.svg",
      fileName: "grafik-ravnoteza.png",
      alt: "Grafik ponude i tražnje sa tačkom ravnoteže",
      anchor: "Kada se promeni bilo koji faktor osim cene",
    },
    {
      file: "sr/elasticnost.svg",
      fileName: "elasticnost-poredjenje.png",
      alt: "Poređenje elastične i neelastične tražnje",
      anchor: "Elastičnost meri osetljivost količine na promenu cene",
    },
    {
      file: "sr/premik-krivulje.svg",
      fileName: "pomeranje-traznje.png",
      alt: "Pomeranje krive tražnje udesno i nova ravnoteža",
      anchor: "Kriva tražnje opada jer svaka dodatna jedinica",
    },
    {
      file: "sr/substituti-komplementi.svg",
      fileName: "supstituti-i-komplementi.png",
      alt: "Supstituti zamenjuju jedan drugog, komplementi se koriste zajedno",
      anchor: "dobra koja zamenjuju jedno drugo",
    },
    {
      file: "sr/premik-ponudbe.svg",
      fileName: "pomeranje-ponude.png",
      alt: "Pomeranje krive ponude udesno zbog nižih troškova",
      anchor: "Troškovi rada i sirovina pomeraju krivu ponude",
    },
    {
      file: "sr/presezek-primanjkljaj.svg",
      fileName: "visak-i-manjak.png",
      alt: "Višak ponude iznad ravnotežne cene i manjak ispod nje",
      anchor: "Ako je cena previsoka, roba ostaje neprodata",
    },
    {
      file: "sr/prihodek-elasticnost.svg",
      fileName: "prihod-i-elasticnost.png",
      alt: "Ukupan prihod je najveći tamo gde je elastičnost jednaka 1",
      anchor: "Kada je rezultat po apsolutnoj vrednosti veći od 1",
    },
  ],
  liveHighlights: [
    { phrase: "Ta tačka je tržišna ravnoteža", color: "green" },
    { phrase: "Cena ne pomera krivu", color: "purple" },
    { phrase: "Tražena količina je količina pri samo jednoj ceni", color: "green" },
    {
      phrase: "Ravnoteža je jedina cena pri kojoj nema ni viška ni manjka",
      color: "green",
    },
    { phrase: "Kretanje duž krive izaziva samo promena cene", color: "purple" },
    { phrase: "malo supstituta, kratak rok, neophodna dobra", color: "green" },
    { phrase: "prihod je najveći tamo gde je elastičnost jednaka 1", color: "purple" },
    {
      phrase:
        "Najčešća greška na ispitu je mešanje pomeranja krive sa kretanjem duž krive",
      color: "purple",
    },
  ],
  podcastTurns: [
    { speaker: "a", text: "Hajde da pogledamo ove beleške — šta je ono što stvarno moraš da zapamtiš?" },
    { speaker: "b", text: "Prvo okvir: bez njega su pojedinačni podaci samo spisak." },
    { speaker: "a", text: "Znači, prvo shvatiš čemu služi, pa tek onda detalje." },
    { speaker: "b", text: "Tačno. A kad to jednom legne, detalje zapamtiš skoro sami od sebe." },
    { speaker: "a", text: "Dobro. Hajde sad redom, pa da proverimo gde se najčešće zapinje." },
    { speaker: "b", text: "Važi. A na kraju sve sažmemo u jednu rečenicu, da ti ostane za ispit." },
  ],
};
