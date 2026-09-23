import type { HelpArticles } from "@/lib/help/articles";

/**
 * Croatian.
 *
 * The three legal documents are translations of the Slovenian originals,
 * which remain the authoritative version — the public legal pages say so
 * under the fine print (`legal.prevailingNotice`). They name the Slovenian
 * controller, the Slovenian supervisory authority and Slovenian law,
 * because that is the factual position, not an artefact of translation.
 */
export const hrHelpArticles: HelpArticles = {
  "family-plan": {
    title: "Obiteljski paket?",
    content: `# Obiteljski paket

Zajednički obiteljski radni prostor još nije podržan.

Zasad svaki račun ima vlastitu knjižnicu bilježaka i vlastitu povijest obrada.

## Što možeš učiniti sada

- prijavi se računom koji treba biti vlasnik bilježaka
- bilješke po potrebi kopiraj iz prikaza bilješke
- za dosljednije rezultate gradivo istog predmeta učitavaj na isti račun`,
  },
  "gift-coconote": {
    title: "Mogu li pokloniti Memo?",
    content: `# Poklanjanje pristupa

Ako imaš promotivni ili poklon kod, primatelj ga može upotrijebiti u Stripe Checkoutu prije dovršetka kupnje.

Za korištenje Memo-a primatelj treba izraditi vlastiti račun, zatim kod unijeti kod plaćanja u Stripeu i provjeriti da se popust prikazuje prije potvrde plaćanja.`,
  },
  "supported-language": {
    title: "Podržavate li moj jezik?",
    content: `# Podržani jezici

Jezik nije potrebno postavljati. Memo AI pročita tvoje gradivo i bilješke, kartice i kvizove napiše na jeziku na kojem je samo gradivo.

## Preporuke

- gradivo učitaj takvo kakvo jest — nije ga potrebno unaprijed prevoditi
- kod miješanja jezika pomažu kraće snimke
- tehnički engleski izrazi mogu ostati u rezultatu kada su dio izvornog sadržaja`,
  },
  "feature-request": {
    title: "Prijedlog značajke",
    content: `# Predloži poboljšanje

Najkorisniji je prijedlog kratak i konkretan opis načina na koji radiš.

Korisno je uključiti:

- što si htio postići
- gdje si zapeo
- kakav si rezultat očekivao
- radi li se o zvuku, dokumentu, PDF-u ili poveznici`,
  },
  "video-isnt-working": {
    title: "Poveznica na video ne radi",
    content: `# Problemi s poveznicom na video

Memo može obraditi samo sadržaj koji je javno dostupan i dovoljno čitljiv za sažimanje.

## Pokušaj ovo

- provjeri da stranica ne traži prijavu
- upotrijebi izravan URL stranice
- ako gradivo imaš drugdje, učitaj PDF ili dokument`,
  },
  "audio-upload-issue": {
    title: "Ne mogu učitati zvuk",
    content: `# Problemi pri učitavanju zvuka

Podržani formati su MP3, M4A, WAV, OGG i WEBM.

## Popis za provjeru

- provjeri da datoteka nije oštećena
- ostani ispod trenutačnog ograničenja veličine
- ako je zvuk nastao snimanjem zaslona, izvezi ga ponovno
- ako se učitavanje ranije zaustavilo, pokušaj ponovno s početne stranice`,
  },
  "transcript-cut-short": {
    title: "Transkript je prekratak ili netočan",
    content: `# Kvaliteta transkripta

Kvaliteta transkripta ovisi o čistoći zvuka i preklapanju govornika. Jezik Memo AI prepoznaje sam.

## Kako poboljšati rezultate

- snimaj što bliže govorniku
- kod razgovora omogući snimanje više govornika
- smanji pozadinsku buku
- vrlo duge snimke podijeli na manje dijelove`,
  },
  "redeem-code": {
    title: "Iskoristi kod",
    content: `# Iskorištavanje koda

Promotivni ili poklon kod možeš upotrijebiti u Stripe Checkoutu prije dovršetka kupnje.

## Kako unijeti kod

- u postavkama odaberi opciju za kupnju ili nadogradnju
- u Stripe obrascu za plaćanje otvori polje za promotivni kod
- unesi kod i potvrdi da se popust prikazuje prije plaćanja

Ako se polje ne prikaže ili kod nije prihvaćen, provjeri je li kod još valjan i odnosi li se na odabrani paket.`,
  },
  "privacy-policy": {
    title: "Politika privatnosti",
    content: `# Politika privatnosti

Ova politika objašnjava koje osobne podatke obrađujemo, zašto ih obrađujemo, kome ih prosljeđujemo, koliko ih dugo čuvamo i koja prava imaš. Vrijedi za web-mjesto memoai.eu i za aplikaciju Memo AI.

## 1. Voditelj obrade podataka

Voditelj obrade tvojih osobnih podataka je **Memo AI, Nace Valenčič s.p., poslovno svetovanje**, Zgoša 87, 4275 Begunje na Gorenjskem, Slovenija (matični broj 7578474000, porezni broj 52958248), koji upravlja uslugom Memo AI dostupnom na memoai.eu.

Kontakt za pitanja o privatnosti i za ostvarivanje prava: info@memoai.eu

## 2. Koje podatke obrađujemo

**Podaci o računu**

- adresa e-pošte
- identifikator korisnika i autentikacijski podaci
- podaci koje prosljeđuju Google ili Apple ako se prijaviš preko njih: adresa e-pošte, ime i identifikator računa
- ime, ako ga upišeš

**Podaci iz početnog postavljanja**

- odgovori u uvodnom upitniku, primjerice područje studija, način korištenja i razlog korištenja

**Sadržaj koji pošalješ**

- audiosnimke izrađene u aplikaciji i učitane zvučne datoteke
- zalijepljeni tekst, ručne bilješke i upiti
- PDF-ovi, dokumenti i slike koje učitaš ili skeniraš
- javne web-poveznice koje želiš da Memo AI pročita
- poruke u chatu s bilješkama

**Podaci koji nastaju korištenjem**

- transkripti, sažeci, bilješke, kartice, kvizovi, testovi i odgovori u chatu izrađeni iz tvog gradiva
- struktura knjižnice, mape, oznake napretka i povijest obrada
- stanje poslova u pozadini i zapisi o pogreškama

**Podaci o plaćanju**

- status pretplate, odabrani paket, razdoblje i povijest plaćanja
- identifikator kupca i pretplate kod Stripea

Za pretplate u App Storeu obrađujemo Appleove potpisane zapise o transakcijama, identifikatore proizvoda i transakcija, datume kupnje i isteka te status povrata ili opoziva pristupa. Appleu šaljemo tehnički identifikator tvog Memo računa kako bismo kupnju povezali s računom i provjerili pristup.

Ako u iOS aplikaciji dopustiš obavijesti, pohranjujemo token za push obavijesti koji Apple dodjeljuje tvom uređaju i povezujemo ga s tvojim računom. Putem Appleove usluge za push obavijesti javljamo ti kad je bilješka spremna. Obavijest sadrži naslov bilješke. Obavijesti možeš u bilo kojem trenutku isključiti u postavkama iOS-a; odjavom se token uklanja, a brisanjem računa briše.

Podatke o tvojoj platnoj kartici ne primamo i ne čuvamo. Podatke o plaćanju izravno obrađuje Stripe za web kupnje ili Apple za kupnje u App Storeu.

**Tehnički podaci**

- IP adresa, vrsta uređaja, preglednik i operacijski sustav
- vremena pristupa, zahtjevi i odgovori poslužitelja
- podaci o pogreškama i rušenjima
- posjeti stranicama, približna država/regija/grad i podaci o uređaju, povezani s tvojim računom kada je dostupan, ako uključiš neobveznu analitiku

## 3. Svrhe obrade i pravne osnove

**Izvršenje ugovora (članak 6. stavak 1. točka (b) GDPR-a)**

- izrada i vođenje računa te prijava
- pohrana i uređivanje tvoje knjižnice bilježaka
- transkripcija, analiza i obrada gradiva koje pošalješ
- izrada sažetaka, bilježaka, kartica, kvizova, testova i odgovora u chatu
- obračun pretplate, obrada plaćanja i povrata
- korisnička podrška

**Zakonska obveza (članak 6. stavak 1. točka (c) GDPR-a)**

- izdavanje i čuvanje računa te druge porezne i računovodstvene obveze
- odgovori na zahtjeve nadležnih tijela

**Legitimni interes (članak 6. stavak 1. točka (f) GDPR-a)**

- sigurnost usluge, sprječavanje zlouporabe, ograničavanje broja zahtjeva i otkrivanje prijevara
- otklanjanje pogrešaka i poboljšavanje pouzdanosti proizvoda
- ostvarivanje ili obrana pravnih zahtjeva

Kod obrade na temelju legitimnog interesa odvagnuli smo svoj interes i tvoja prava. Takvoj obradi možeš prigovoriti bilo kada.

**Privola (članak 6. stavak 1. točka (a) GDPR-a)**

- neobvezne poruke o proizvodu, kada se na njih prijaviš
- neobvezna analitika, tek nakon što je uključiš u postavkama

Privolu možeš povući bilo kada. Povlačenje ne utječe na zakonitost obrade prije povlačenja.

## 4. Posebne kategorije osobnih podataka

Memo AI nije namijenjen obradi posebnih kategorija osobnih podataka, primjerice zdravstvenih podataka, biometrijskih podataka ili podataka o vjeroispovijesti, političkom uvjerenju ili spolnoj orijentaciji.

Ako takvo gradivo ipak učitaš, činiš to na vlastitu odgovornost i moraš za njega imati valjanu pravnu osnovu. Odvraćamo od učitavanja takvog gradiva o drugim osobama.

## 5. Dopuštenja za snimanje i gradiva

Korištenjem Memo AI potvrđuješ da imaš sva potrebna dopuštenja i prava za snimanje, učitavanje, lijepljenje ili povezivanje sadržaja koji šalješ u aplikaciju. To uključuje dopuštenja škole, učitelja, predavača, ustanove, poslodavca, sudionika snimanja ili drugih nositelja prava, kada su takva dopuštenja potrebna.

U Memo AI nemoj učitavati snimke predavanja, prezentacije, nastavne materijale, dokumente ili drugi sadržaj ako za to nemaš dopuštenje odnosno zakonsku osnovu.

Kada se u gradivu pojavljuju druge osobe, u pogledu njihovih osobnih podataka ti si taj koji odlučuje o obradi, a mi gradivo obrađujemo po tvom nalogu.

## 6. Kome prosljeđujemo podatke

Podatke ne prodajemo. Prosljeđujemo ih samo pružateljima koji su nam potrebni za rad usluge, i to u opsegu potrebnom za pojedinu funkciju. S njima imamo sklopljene ugovore o obradi podataka.

- **Supabase** — autentikacija, baza podataka i pohrana datoteka
- **Stripe** — obrada plaćanja, pretplata i povrata
- **OpenRouter i odabrani pružatelji modela** — generiranje AI odgovora i sadržaja za učenje kada se koriste te usluge
- **Google (Gemini)** — transkripcija, izdvajanje teksta iz dokumenata, ugrađivanja, izrada bilježaka i odgovora u chatu
- **Soniox** — transkripcija audiosnimki, kada je ta usluga uključena
- **Vercel** — hosting, neobvezna analitika posjeta i mjerenja performansi
- **Inngest** — izvršavanje poslova u pozadini, kada je uključen
- **Sentry** — praćenje pogrešaka i rušenja
- **Google i Apple** — prijava, kada odabereš prijavu preko njih

Apple također obrađuje kupnje i upravljanje pretplatama u App Storeu prema svojoj [politici privatnosti](https://www.apple.com/legal/privacy/). S Appleom razmjenjujemo prethodno opisane podatke o transakcijama radi provjere i održavanja tvog plaćenog pristupa.

Podatke možemo otkriti i nadležnim tijelima kada smo na to zakonski obvezani, te svojim pravnim ili računovodstvenim savjetnicima kada je to potrebno.

Ako dođe do statusne promjene ili prodaje djelatnosti, podaci se mogu prenijeti na stjecatelja, pri čemu ova politika vrijedi i dalje dok te o promjeni ne obavijestimo.

## 7. Prijenosi izvan EU-a i EGP-a

Neki pružatelji obrađuju podatke i izvan Europskog gospodarskog prostora, osobito u Sjedinjenim Američkim Državama.

U takvim se slučajevima prijenos obavlja na temelju:

- odluke Europske komisije o primjerenosti, kada ona postoji, ili
- standardnih ugovornih klauzula Europske komisije zajedno s dodatnim zaštitnim mjerama

Kopiju primijenjenih zaštitnih mjera možeš zatražiti na info@memoai.eu.

## 8. Koliko dugo čuvamo podatke

- **podaci o računu** — dok tvoj račun postoji, zatim do 30 dana nakon brisanja
- **sadržaj i izrađene bilješke** — dok ih ne izbrišeš ili dok ne izbrišeš račun; iz sigurnosnih se kopija uklanjaju najkasnije u roku od 30 dana
- **podaci o plaćanjima i računi** — 10 godina, koliko zahtijeva porezno zakonodavstvo
- **zapisi o pogreškama i sigurnosni zapisi** — do 12 mjeseci
- **korespondencija s podrškom** — do 24 mjeseca nakon zaključenja predmeta
- **podaci potrebni za pravne zahtjeve** — do zastare zahtjeva

Sadržaj ostaje povezan s tvojim računom dok ga ne izbrišeš u aplikaciji ili dok ga ne uklonimo putem podrške ili redovitog čišćenja.

## 9. Sigurnost

Primjenjujemo tehničke i organizacijske mjere primjerene riziku, među ostalim:

- šifriranje prijenosa podataka
- razdvajanje pristupa podacima na razini baze, tako da svojim bilješkama pristupaš samo ti
- ograničen i zabilježen pristup zaposlenika, samo u slučajevima kada je to nužno
- praćenje pogrešaka i neuobičajenog prometa

Nijedan sustav nije potpuno siguran. Ako dođe do povrede osobnih podataka koja bi za tebe mogla predstavljati visok rizik, obavijestit ćemo tebe i nadležno nadzorno tijelo, kako to zahtijeva zakon.

## 10. Tvoja prava

Prema GDPR-u imaš pravo na:

- **pristup** — potvrdu obrađujemo li tvoje podatke i primjerak tih podataka
- **ispravak** — ispravak netočnih ili dopunu nepotpunih podataka
- **brisanje** — brisanje podataka kada za obradu više nema osnove
- **ograničenje obrade** — u slučajevima koje propisuje zakon
- **prenosivost** — primanje podataka u strojno čitljivom obliku ili prijenos drugom pružatelju
- **prigovor** — na obradu koja se temelji na legitimnom interesu
- **povlačenje privole** — kada se obrada temelji na privoli

Ne provodimo automatizirano donošenje odluka s pravnim učincima za tebe niti izradu profila u smislu članka 22. GDPR-a.

## 11. Kako ostvariti prava

Zahtjev pošalji na info@memoai.eu s adrese e-pošte povezane s tvojim računom. Odgovaramo najkasnije u roku od mjesec dana; u složenim se slučajevima rok može produljiti za dva mjeseca, o čemu te obavještavamo.

Radi provjere identiteta možemo zatražiti dodatne podatke, ali samo u opsegu koji je za to potreban.

Ako smatraš da tvoje podatke obrađujemo nezakonito, možeš podnijeti pritužbu Informacijskom povjereniku Republike Slovenije, Dunajska cesta 22, 1000 Ljubljana, gp.ip@ip-rs.si, kao vodećem nadzornom tijelu, ili nadzornom tijelu u državi svog uobičajenog boravišta.

## 12. Kolačići i slične tehnologije

Nužne kolačiće i lokalnu pohranu koristimo za prijavu, sigurnost, postavke i pamćenje tvog odabira analitike. Potrebni su za funkcije koje tražiš.

**Neobvezna analitika zadano je isključena.** U Postavke → Neobvezna analitika možeš dopustiti Memu i Vercelu prikupljanje posjeta stranicama, približne lokacije, podataka o uređaju i mjerenja performansi. Posjeti mogu biti povezani s tvojim Memo računom. Na istom uređaju možeš je isključiti u bilo kojem trenutku bez gubitka pristupa aplikaciji.

Nužni kolačić odabira \`memo-analytics\` traje do 180 dana. Nakon privole analitički kolačić \`memo-visit\` traje do 24 sata. Isključivanje analitike uklanja kolačić posjeta i zaustavlja buduće neobvezno prikupljanje. Istek kolačića ne briše zapise već pohranjene na poslužitelju: zapisi posjeta povezani s računom uklanjaju se pri brisanju računa, a njihovo uklanjanje možeš zatražiti i na info@memoai.eu.

Ne koristimo oglašivačke kolačiće, oglašivačko praćenje između web-mjesta ni ponovnu reprodukciju korisničkih sesija. Nužna sigurnosna dijagnostika i prijava pogrešaka nastavljaju raditi neovisno o neobveznoj analitici.

## 13. Djeca

Memo AI nije namijenjen djeci mlađoj od 16 godina. Ako utvrdimo da smo bez odgovarajuće osnove obradili podatke djeteta mlađeg od 16 godina, brišemo ih. Ako si roditelj ili skrbnik i smatraš da se to dogodilo, piši nam na info@memoai.eu.

## 14. Tvoje mogućnosti

Ako ne želiš da dođe do obrade opisane u ovoj politici, nemoj taj sadržaj učitavati, lijepiti, snimati ni povezivati u Memo AI. Ako trebaš strože uvjete u pogledu čuvanja, brisanja ili ugovornih odredbi, obrati nam se prije korištenja.

## 15. Izmjene ove politike

Politiku možemo ažurirati kada se proizvod, pružatelji ili zakonodavstvo promijene. O bitnim te izmjenama obavještavamo e-poštom ili u aplikaciji.

## 16. Kontakt

info@memoai.eu`,
  },
  "refund-policy": {
    title: "Politika povrata",
    content: `# Politika povrata

Ova politika objašnjava kada vraćamo uplatu za pretplatu na Memo AI, u kojem udjelu i kako povrat zatražiti. Dio je uvjeta korištenja.

## 1. Ukratko

**Kupnje u App Storeu:** povrat zatraži putem [Applea](https://reportaproblem.apple.com/). Apple obrađuje te zahtjeve; rokovi i postotci djelomičnih povrata za web kupnje navedeni u nastavku ne primjenjuju se na transakcije u App Storeu. Tvoja zakonska potrošačka prava ostaju nepromijenjena. Za pomoć sa samom uslugom piši na info@memoai.eu.

**Web kupnje putem Stripea:**

- **zahtjev u roku od 24 sata od uplate** — vraćamo 50 % uplaćenog iznosa
- **zahtjev nakon 24 sata od uplate** — nema povrata
- **otkazivanje pretplate** — bilo kada; pristup ostaje do kraja plaćenog razdoblja
- **naša pogreška ili dvostruko terećenje** — vraćamo u cijelosti
- **zakonsko pravo potrošača na odustanak** — vrijedi uz ovu politiku i ima prednost pred njom

## 2. Na što se odnosi

Ova politika odnosi se na pretplate kupljene izravno u Memo AI putem Stripea.

Vrijedi za svaku pojedinu uplatu, uključujući automatsko produljenje. Rok od 24 sata za svaku se uplatu računa iznova, od trenutka terećenja.

## 3. Djelomični povrat u roku od 24 sata

Ako u roku od **24 sata od trenutka terećenja** pošalješ zahtjev za povrat, vraćamo ti **50 % uplaćenog iznosa** za to razdoblje.

- rok počinje teći u trenutku kada je uplata obračunata
- računa se vrijeme kada tvoj zahtjev stigne na info@memoai.eu
- kada je povrat odobren, pretplata se otkazuje, a plaćeni pristup prestaje odmah nakon izvršenja povrata
- djelomični povrat moguć je jednom po obračunskom razdoblju

## 4. Nakon 24 sata

Za zahtjeve poslane **više od 24 sata** nakon terećenja nema povrata.

Pretplatu i dalje možeš otkazati bilo kada. U tom se slučaju novo razdoblje ne obračunava, a plaćeni pristup ostaje ti do kraja već plaćenog razdoblja.

## 5. Kada vraćamo cijeli iznos

Neovisno o rokovima iz točaka 3. i 4., vraćamo cijeli iznos kada:

- je isti iznos greškom obračunat dvaput
- je uplata obračunata nakon valjanog otkazivanja pretplate
- je uplata obračunata bez tvog odobrenja i o tome nas obavijestiš čim saznaš
- plaćene značajke zbog pogreške na našoj strani dulje vrijeme nije bilo moguće koristiti, a pogrešku nismo otklonili u razumnom roku
- smo ti račun ukinuli bez tvoje krivnje; u tom slučaju vraćamo razmjerni dio za neiskorišteno razdoblje
- to zahtijeva zakon

## 6. Kada nema povrata

- za razdoblja koja su već u cijelosti istekla
- za besplatno probno razdoblje, jer za njega nije bilo uplate
- za promotivne i poklon kodove te popuste; oni se ne isplaćuju u novcu
- kada je račun ukinut zbog kršenja uvjeta korištenja
- kod ponavljajućih zahtjeva istog korisnika, kada je očito da se ova politika zloupotrebljava

Povrat ne odbijamo zato što si uslugu koristio. Ako si u razdoblju za koje tražiš povrat izradio sadržaj, to ne utječe na visinu povrata prema ovoj politici.

## 7. Kako zatražiti povrat

Piši na **info@memoai.eu** s adrese e-pošte povezane s tvojim računom i navedi:

- datum uplate i iznos
- paket koji si kupio
- želiš li i otkazivanje pretplate
- kratak razlog, koji nam pomaže poboljšati proizvod; razlog nije obvezan

Primitak zahtjeva potvrđujemo i odgovaramo najkasnije u roku od **5 radnih dana**.

## 8. Izvršenje povrata

- povrat izvršavamo putem Stripea, na isto sredstvo plaćanja kojim je uplata obavljena
- povrat odobravamo najkasnije u roku od **14 dana** od primitka zahtjeva
- koliko vremena treba da iznos bude vidljiv na tvom računu ovisi o tvojoj banci ili izdavatelju kartice; obično 5 do 10 radnih dana
- troškove obrade povrata ti ne naplaćujemo

## 9. Otkazivanje pretplate

Otkazivanje i povrat nisu isto.

Pretplatu otkazuješ u postavkama računa ili putem poveznice na Stripe portal. Otkazivanje sprječava sljedeće obračunavanje, ali ne i povrat već uplaćenog iznosa. Za povrat moraš poslati zaseban zahtjev prema točki 7.

Ako otkažeš prije isteka besplatnog probnog razdoblja, uplata se ne obračunava.

## 10. Prigovor na terećenje kod banke

Ako smatraš da je uplata bila pogrešna, prvo piši nama. Većinu slučajeva rješavamo brže nego što traje postupak prigovora kod banke.

Ako prigovor kod banke ili izdavatelja kartice podneseš bez prethodnog kontakta s nama, možemo privremeno ograničiti pristup računu dok postupak ne bude zaključen.

## 11. Izmjene ove politike

Ovu politiku možemo izmijeniti. Za pojedinu uplatu uvijek vrijedi verzija objavljena na dan te uplate.

## 12. Kontakt

info@memoai.eu`,
  },
  "terms-of-use": {
    title: "Uvjeti korištenja",
    content: `# Uvjeti korištenja

Ovi su uvjeti pravno obvezujući ugovor između tebe i operatora usluge Memo AI. Pročitaj ih prije nego što izradiš račun ili kupiš pretplatu.

## 1. Tko smo

Memo AI je internetska usluga dostupna na memoai.eu (u nastavku „Memo AI”, „mi” ili „nas”). Uslugom upravlja:

- **Memo AI, Nace Valenčič s.p., poslovno svetovanje**
- sjedište: Zgoša 87, 4275 Begunje na Gorenjskem, Slovenija
- matični broj: 7578474000
- porezni broj: 52958248

Za sva pitanja, zahtjeve i obavijesti prema ovim uvjetima piši na info@memoai.eu.

## 2. Prihvaćanje uvjeta

Izradom računa, prijavom ili korištenjem Memo AI potvrđuješ da si ove uvjete pročitao, da ih razumiješ i da se s njima slažeš. Ako se s njima ne slažeš, nemoj koristiti Memo AI.

Uz ove uvjete vrijede i:

- politika privatnosti, koja objašnjava kako postupamo s osobnim podacima
- politika povrata, koja uređuje otkazivanja i povrate uplata

Ugovor je sklopljen na slovenskom jeziku. Tekst ugovora čuvamo u obliku ovih objavljenih uvjeta i stalno ti je dostupan na ovoj stranici.

## 3. Tko može koristiti Memo AI

- za korištenje moraš imati najmanje 16 godina
- ako si mlađi od 18 godina, moraš imati suglasnost roditelja ili zakonskog zastupnika koji s ovim uvjetima suglasi u tvoje ime
- račun je osoban; podatke za prijavu nemoj dijeliti i račun nemoj prenositi na drugu osobu
- ako Memo AI koristiš u ime škole, tvrtke ili druge organizacije, potvrđuješ da si ovlašten tu organizaciju obvezati ovim uvjetima

Memo AI namijenjen je osobnom korištenju za učenje. Za korištenje u ustanovi ili tvrtki s vlastitim zahtjevima u pogledu čuvanja, brisanja ili ugovornih odredbi, obrati nam se prije korištenja.

## 4. Račun i sigurnost

- pri registraciji navedi istinite podatke i adresu e-pošte kojoj stvarno pristupaš
- odgovoran si za sigurnost svog poštanskog sandučića, prijavnih kodova i povezanih Google ili Apple računa
- za svu aktivnost na svom računu odgovaraš sam, osim ako je do nje došlo našom krivnjom
- ako sumnjaš na neovlašten pristup, odmah nas obavijesti na info@memoai.eu

## 5. Što je Memo AI

Memo AI je alat za učenje koji radi s umjetnom inteligencijom. Iz gradiva koje pošalješ izrađuje transkripte, sažetke, strukturirane bilješke, kartice, kvizove, testove i odgovore u chatu te omogućuje izvoz i uređivanje knjižnice bilježaka.

Memo AI nije:

- zamjena za predavanja, stručnu literaturu ili vlastiti rad
- stručni savjet bilo koje vrste, osobito ne medicinski, pravni, financijski, porezni ili sigurnosni
- usluga pohrane podataka na koju bi se smio osloniti kao na jedini primjerak svog gradiva

Za vlastite sigurnosne kopije važnog gradiva pobrini se sam.

## 6. Besplatno korištenje i probno razdoblje

Probno razdoblje u App Storeu vrijedi samo ako ga Apple prikaže u potvrdi kupnje. Web probna razdoblja i promotivni kodovi ne primjenjuju se automatski na kupnje u App Storeu. Pravila probnog razdoblja u nastavku opisuju našu web ponudu.

- bez pretplate možeš izraditi ograničenu količinu sadržaja, uključujući jednu probnu bilješku i ograničen broj poruka u chatu
- pri prvoj kupnji pretplate možeš dobiti 3-dnevno besplatno probno razdoblje, ako ispunjavaš uvjete za njega
- besplatno probno razdoblje pripada jednoj osobi jednom; na njega nemaju pravo korisnici koji su kod nas već imali pretplatu
- ako probno razdoblje ne otkažeš prije isteka, pretplata se automatski nastavlja i uplata se obračunava prema važećem cjeniku
- opseg besplatnog korištenja možemo promijeniti za ubuduće

## 7. Pretplate, cijene i plaćanja

**Pretplate u App Storeu**

Na iOS-u kupnje pretplata u aplikaciji obrađuje Apple. Prije potvrde kupnje Apple prikazuje cijenu, valutu, obračunsko razdoblje i eventualnu ponudu. Pretplata se automatski obnavlja dok je ne otkažeš putem Applea. Apple upravlja naplatom, potvrdama o kupnji i odgovarajućim obavijestima o promjeni cijena. Mjesečni i godišnji paket nude iste značajke Memo Premium za različita obračunska razdoblja. Obnovu kupnji upotrijebi dok si prijavljen u Memo račun korišten za izvornu kupnju. Appleove pretplate nije moguće prenositi između Memo računa.

**Web pretplate putem Stripea**

- Memo AI se prodaje kao pretplata koja se ponavlja; aktualne cijene i razdoblja navedeni su na stranici s cijenama i u Stripe Checkoutu prije potvrde kupnje
- sve su cijene navedene u eurima; je li porez uključen ili se pribraja jasno je prikazano prije dovršetka kupnje
- plaćanja u naše ime obrađuje Stripe; cjelovite podatke o tvojoj kartici ne primamo i ne čuvamo
- pretplata se automatski produljuje na kraju svakog obračunskog razdoblja dok je ne otkažeš
- uplata za novo razdoblje obračunava se na dan produljenja sredstvom plaćanja pohranjenim kod Stripea
- ako plaćanje ne uspije, možemo privremeno ograničiti pristup plaćenim značajkama dok uplata ne bude podmirena
- promotivni i poklon kodovi vrijede pod uvjetima navedenima uz kod i ne mogu se zamijeniti za gotovinu
- cijene možemo promijeniti; o promjeni te obavještavamo najmanje 30 dana prije njezina stupanja na snagu, a promjena vrijedi za sljedeće obračunsko razdoblje. Ako se s cijenom ne slažeš, pretplatu možeš otkazati prije stupanja na snagu

Račun za svaku uplatu primaš na adresu e-pošte povezanu s tvojim računom.

## 8. Otkazivanje

Za pretplate u App Storeu upotrijebi upravljanje Apple pretplatom u postavkama Memo-a ili otvori Postavke na iPhoneu → tvoje ime → Pretplate. Otkaži prije datuma obnove; plaćeni pristup obično traje do isteka pretplate. Brisanje Memo-a ili Memo računa ne otkazuje Appleovu pretplatu. Povrat za kupnju u App Storeu zatraži putem [Applea](https://reportaproblem.apple.com/).

**Web pretplate putem Stripea:**

Pretplatu možeš otkazati bilo kada u postavkama računa ili putem poveznice na Stripe portal. Otkazivanje stupa na snagu na kraju tekućeg plaćenog razdoblja; do tada plaćene značajke ostaju dostupne. Otkazivanje samo po sebi ne znači povrat već uplaćenog iznosa.

Povrate uređuje politika povrata.

## 9. Tvoje odgovornosti

- učitavati, snimati, lijepiti ili povezivati smiješ samo gradivo koje posjeduješ ili koje smiješ koristiti
- odgovoran si za zakonitost i točnost sadržaja koji pošalješ
- moraš poštovati pravila svoje škole, fakulteta ili poslodavca u pogledu snimanja i dijeljenja gradiva
- rezultate koje izradi Memo AI moraš provjeriti prije korištenja

## 10. Dopuštenja za snimanje i gradiva

Korištenjem Memo AI potvrđuješ da prije snimanja, učitavanja, lijepljenja ili povezivanja sadržaja imaš sva potrebna dopuštenja i prava. To uključuje dopuštenja škole, učitelja, predavača, ustanove, poslodavca, sudionika snimanja ili drugih nositelja prava, kada su takva dopuštenja potrebna.

Nemoj snimati predavanja, razgovore ili druge osobe i nemoj učitavati prezentacije, bilješke, nastavne materijale, dokumente ili druge datoteke ako za to nemaš dopuštenje odnosno zakonsku osnovu. Odgovoran si da tvoje korištenje Memo AI ne krši pravila škole, ugovorna ograničenja, autorska prava, privatnost, pravila o snimanju ili druge važeće zakone i pravila.

U Memo AI nemoj učitavati posebne kategorije osobnih podataka drugih ljudi, primjerice zdravstvene podatke ili podatke o vjeroispovijesti, političkom uvjerenju ili spolnoj orijentaciji, osim ako za to imaš valjanu pravnu osnovu.

## 11. Zabranjeno korištenje

Memo AI ne smiješ koristiti kako bi:

- učitavao zlonamjerni softver ili pokušavao ugroziti sigurnost usluge
- pristupao dijelovima usluge, računima ili podacima na koje nemaš pravo
- zaobišao ograničenja količine, naplatni zid, probna ograničenja ili tehničke zaštite
- uslugu automatski prikupljao, obrnuto inženjerio ili provodio testove opterećenja bez našeg pisanog dopuštenja
- izrađivao ili širio nezakonit, uvredljiv, obmanjujući ili nasilan sadržaj
- zadirao u prava drugih, uključujući autorska prava i pravo na privatnost
- uslugu preprodavao, iznajmljivao ili je nudio kao vlastitu
- kršio akademska pravila o poštenju ili predavao izrađeni sadržaj kao vlastiti rad kada to nije dopušteno
- koristio Memo AI za automatsku masovnu obradu gradiva koje nije povezano s vlastitim studijem

## 12. Tvoj sadržaj

Gradivo koje pošalješ u Memo AI ostaje tvoje. Radi rada usluge dodjeljuješ nam neisključivo, vremenski ograničeno i prostorno neograničeno pravo da to gradivo pohranimo, prikažemo, obradimo i proslijedimo našim pružateljima obrade isključivo zato da bismo mogli izvesti funkcije koje zatražiš.

To pravo prestaje kada sadržaj izbrišeš ili kada izbrišemo tvoj račun, osim kada podatke moramo još čuvati zbog zakonskih obveza.

Tvoj sadržaj ne prodajemo i ne koristimo ga za oglašavanje.

## 13. Naša prava

Memo AI, njegov softver, dizajn, žig i sadržaj koji nije tvoj vlasništvo su nas ili naših davatelja licencija. Sklapanjem pretplate dobivaš osobno, neprenosivo i neisključivo pravo korištenja usluge u skladu s ovim uvjetima, ali ne i vlasništvo nad njom.

## 14. AI obrada i ograničenja rezultata

Za transkripte, sažetke, kartice, kvizove, odgovore u chatu i izdvajanje sadržaja iz dokumenata Memo AI može tvoj sadržaj obraditi kod vanjskih AI i infrastrukturnih pružatelja.

To može uključivati:

- audiosnimke i učitane zvučne datoteke
- zalijepljeni tekst i bilješke
- PDF-ove i druge podržane dokumente
- javne web-poveznice koje želiš da Memo AI pročita
- metapodatke potrebne za rad, sigurnost i poboljšavanje usluge

Popis pružatelja i osnove za obradu navedeni su u politici privatnosti.

Memo AI može izraditi pogreške, nepotpune odgovore ili obmanjujuće gradivo za učenje. Prije nego što se osloniš na rezultate kod ispita, seminarskih radova, medicinskih, pravnih, financijskih, usklađenosnih ili sigurnosno kritičnih odluka, moraš ih sam provjeriti.

## 15. Dostupnost i izmjene usluge

Nastojimo osigurati neometan rad, ali ne obećavamo neprekinutu dostupnost. Usluga može biti privremeno nedostupna zbog održavanja, pogrešaka, ažuriranja ili smetnji kod vanjskih pružatelja.

Pojedine značajke možemo mijenjati, dodavati ili ukidati. Ako bi promjena za plaćene korisnike bila bitno nepovoljna, o njoj te obavještavamo unaprijed, a ti pretplatu možeš otkazati.

## 16. Postupanje i prekid računa

Pristup možemo privremeno ograničiti, onemogućiti određene značajke ili ukloniti sadržaj kada korištenje izgleda zloupotrebno, nezakonito, opasno ili štetno za uslugu ili druge korisnike.

Kod težih ili ponavljajućih kršenja račun možemo ukinuti. Kada je to izvedivo i dopušteno, o razlogu te obavještavamo i dajemo ti mogućnost da postupak objasniš ili otkloniš. Ako račun ukinemo bez tvoje krivnje, vraćamo ti razmjerni dio unaprijed plaćene pretplate.

Svoj račun možeš ukinuti bilo kada tako da nam pišeš na info@memoai.eu.

## 17. Jamstva

Usluga je dostupna takva kakva jest. U opsegu koji dopušta zakon ne dajemo jamstva da će usluga biti bez pogrešaka, neprekinuta ili prikladna za točno određenu svrhu, i ne jamčimo za točnost rezultata koje izradi AI.

To ne dira u obvezna jamstva koja ti kao potrošaču pripadaju prema slovenskom i europskom pravu.

## 18. Ograničenje odgovornosti

U opsegu koji dopušta zakon ne odgovaramo za:

- izgubljenu dobit, izgubljenu priliku, gubitak podataka ili neizravnu štetu
- posljedice odluka koje si donio na temelju neprovjerenih rezultata AI-ja
- postupanje trećih osoba ili prekid njihovih usluga
- štetu nastalu zbog tvog kršenja ovih uvjeta

Naša ukupna odgovornost po pojedinom zahtjevu ograničena je na iznos koji si nam platio u 12 mjeseci prije događaja koji je prouzročio štetu.

Ništa u ovim uvjetima ne isključuje i ne ograničava odgovornost za namjeru, krajnju nepažnju, smrt ili tjelesnu ozljedu te odgovornost koju prema zakonu nije moguće isključiti. Ako si potrošač, u cijelosti ti ostaju dostupna sva prava prema propisima o zaštiti potrošača.

## 19. Tvoja odgovornost za naknadu štete

Ako zbog tvog kršenja ovih uvjeta ili zbog gradiva koje si poslao bez odgovarajućih prava treća osoba protiv nas podnese zahtjev, nadoknađuješ nam opravdane troškove koji nam pritom nastanu. To vrijedi samo u opsegu u kojem je zahtjev posljedica tvog postupanja.

## 20. Izmjene uvjeta

Ove uvjete možemo izmijeniti kada se proizvod, zakonodavstvo ili pružatelji promijene.

- o bitnim te izmjenama obavještavamo e-poštom ili u aplikaciji najmanje 30 dana prije stupanja na snagu
- manje ispravke koje ne diraju u tvoja prava objavljujemo izravno na ovoj stranici
- ako nakon stupanja na snagu nastaviš s korištenjem, to znači da prihvaćaš ažuriranu verziju
- ako se s izmjenom ne slažeš, prije njezina stupanja na snagu možeš otkazati pretplatu

## 21. Prestanak

Prestankom ugovora prestaje tvoje pravo korištenja usluge. Sa sadržajem povezanim s tvojim računom postupa se u skladu s politikom privatnosti. Odredbe o intelektualnom vlasništvu, ograničenju odgovornosti, naknadi štete i rješavanju sporova vrijede i nakon prestanka.

## 22. Mjerodavno pravo i rješavanje sporova

Za ove uvjete vrijedi pravo Republike Slovenije, bez primjene kolizijskih pravila. Ako si potrošač s prebivalištem u drugoj državi EU-a, taj te izbor ne lišava zaštite koju ti jamče prisilni propisi tvoje države.

Sporove najprije pokušavamo riješiti sporazumno; piši nam na info@memoai.eu i odgovorit ćemo ti u razumnom roku.

Kao potrošač možeš koristiti i:

- postupak izvansudskog rješavanja potrošačkih sporova, kada je dostupan. Trenutačno ne priznajemo nijednog provoditelja izvansudskog rješavanja potrošačkih sporova kao nadležnog za sporove iz ovih uvjeta
- pritužbu Tržišnom inspektoratu Republike Slovenije

Za sporove koje nije moguće riješiti sporazumno nadležan je stvarno nadležni sud u Republici Sloveniji. Ako si potrošač, to ne dira u tvoje pravo da tužbu podneseš sudu u mjestu svog prebivališta.

## 23. Završne odredbe

- ako je pojedina odredba ovih uvjeta nevaljana, ostale odredbe ostaju na snazi
- ove uvjete ne možeš prenijeti na drugu osobu bez naše suglasnosti; mi ih možemo prenijeti kod statusne promjene ili prodaje djelatnosti, pri čemu se tvoja prava ne pogoršavaju
- ako neko pravo ne ostvarimo odmah, time ga se ne odričemo
- ovi uvjeti zajedno s politikom privatnosti i politikom povrata čine cjelokupni dogovor između tebe i nas o korištenju Memo AI

## 24. Kontakt

info@memoai.eu

---

**Zakonsko pravo potrošača na odustanak.** Ako si potrošač s prebivalištem u EU-u ili EGP-u, prema zakonu imaš pravo u roku od 14 dana od sklapanja pretplatničkog ugovora od njega odustati, bez navođenja razloga. Budući da se usluga na tvoj izričit zahtjev počinje pružati odmah nakon kupnje, pri kupnji izričito zahtijevaš da pružanje počne prije isteka roka za odustanak; ako tijekom roka za odustanak odustaneš, vraćamo ti uplaćeni iznos umanjen za razmjerni dio koji odgovara usluzi pruženoj do dana odustanka. To zakonsko pravo vrijedi uz politiku povrata: ako ti zakon u konkretnom slučaju daje veći povrat nego što ga predviđa politika povrata, vrijedi zakon. Za odustanak je dovoljna jasna izjava e-poštom na info@memoai.eu, a možeš upotrijebiti i obrazac za odustanak iz priloga slovenskom Zakonu o zaštiti potrošača. Ništa u ovim uvjetima ni u politici povrata ne ograničava prava koja ti kao potrošaču pripadaju prema prisilnim propisima.`,
  },
};
