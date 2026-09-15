import type { HelpArticles } from "@/lib/help/articles";

/**
 * Bosnian.
 *
 * The three legal documents are translations of the Slovenian originals,
 * which remain the authoritative version — the public legal pages say so
 * under the fine print (`legal.prevailingNotice`). They name the Slovenian
 * controller, the Slovenian supervisory authority and Slovenian law,
 * because that is the factual position, not an artefact of translation.
 */
export const bsHelpArticles: HelpArticles = {
  "family-plan": {
    title: "Porodični paket?",
    content: `# Porodični paket

Zajednički porodični radni prostor još nije podržan.

Zasad svaki račun ima vlastitu biblioteku bilježaka i vlastitu historiju obrada.

## Šta možeš uraditi sada

- prijavi se računom koji treba biti vlasnik bilježaka
- bilješke po potrebi kopiraj iz prikaza bilješke
- za dosljednije rezultate gradivo istog predmeta učitavaj na isti račun`,
  },
  "gift-coconote": {
    title: "Mogu li pokloniti Memo?",
    content: `# Poklanjanje pristupa

Ako imaš promotivni ili poklon kod, primalac ga može upotrijebiti u Stripe Checkoutu prije završetka kupovine.

Za korištenje Memo-a primalac treba napraviti vlastiti račun, zatim kod unijeti pri plaćanju u Stripeu i provjeriti da se popust prikazuje prije potvrde plaćanja.`,
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
    title: "Prijedlog funkcije",
    content: `# Predloži poboljšanje

Najkorisniji je prijedlog kratak i konkretan opis načina na koji radiš.

Korisno je uključiti:

- šta si htio postići
- gdje si zapeo
- kakav si rezultat očekivao
- radi li se o zvuku, dokumentu, PDF-u ili linku`,
  },
  "video-isnt-working": {
    title: "Link na video ne radi",
    content: `# Problemi s linkom na video

Memo može obraditi samo sadržaj koji je javno dostupan i dovoljno čitljiv za sažimanje.

## Pokušaj ovo

- provjeri da stranica ne traži prijavu
- upotrijebi direktan URL stranice
- ako gradivo imaš drugdje, učitaj PDF ili dokument`,
  },
  "audio-upload-issue": {
    title: "Ne mogu učitati zvuk",
    content: `# Problemi pri učitavanju zvuka

Podržani formati su MP3, M4A, WAV, OGG i WEBM.

## Lista za provjeru

- provjeri da datoteka nije oštećena
- ostani ispod trenutnog ograničenja veličine
- ako je zvuk nastao snimanjem ekrana, izvezi ga ponovo
- ako se učitavanje ranije zaustavilo, pokušaj ponovo s početne stranice`,
  },
  "transcript-cut-short": {
    title: "Transkript je prekratak ili netačan",
    content: `# Kvalitet transkripta

Kvalitet transkripta ovisi o čistoći zvuka i preklapanju govornika. Jezik Memo AI prepoznaje sam.

## Kako poboljšati rezultate

- snimaj što bliže govorniku
- kod razgovora omogući snimanje više govornika
- smanji pozadinsku buku
- vrlo duge snimke podijeli na manje dijelove`,
  },
  "redeem-code": {
    title: "Iskoristi kod",
    content: `# Iskorištavanje koda

Promotivni ili poklon kod možeš upotrijebiti u Stripe Checkoutu prije završetka kupovine.

## Kako unijeti kod

- u postavkama odaberi opciju za kupovinu ili nadogradnju
- u Stripe obrascu za plaćanje otvori polje za promotivni kod
- unesi kod i potvrdi da se popust prikazuje prije plaćanja

Ako se polje ne prikaže ili kod nije prihvaćen, provjeri je li kod još važeći i odnosi li se na odabrani paket.`,
  },
  "privacy-policy": {
    title: "Politika privatnosti",
    content: `# Politika privatnosti

Ova politika objašnjava koje lične podatke obrađujemo, zašto ih obrađujemo, kome ih prosljeđujemo, koliko ih dugo čuvamo i koja prava imaš. Vrijedi za web-stranicu memoai.eu i za aplikaciju Memo AI.

## 1. Kontrolor podataka

Kontrolor tvojih ličnih podataka je **Memo AI, Nace Valenčič s.p., poslovno svetovanje**, Zgoša 87, 4275 Begunje na Gorenjskem, Slovenija (matični broj 7578474000, poreski broj 52958248), koji upravlja uslugom Memo AI dostupnom na memoai.eu.

Kontakt za pitanja o privatnosti i za ostvarivanje prava: info@memoai.eu

## 2. Koje podatke obrađujemo

**Podaci o računu**

- adresa e-pošte
- identifikator korisnika i autentikacijski podaci
- podaci koje prosljeđuju Google ili Apple ako se prijaviš preko njih: adresa e-pošte, ime i identifikator računa
- ime, ako ga upišeš

**Podaci iz početnog podešavanja**

- odgovori u uvodnom upitniku, naprimjer oblast studija, način korištenja i razlog korištenja

**Sadržaj koji pošalješ**

- audiosnimci napravljeni u aplikaciji i učitane zvučne datoteke
- zalijepljeni tekst, ručne bilješke i upiti
- PDF-ovi, dokumenti i slike koje učitaš ili skeniraš
- javni web-linkovi za koje želiš da ih Memo AI pročita
- poruke u chatu s bilješkama

**Podaci koji nastaju korištenjem**

- transkripti, sažeci, bilješke, kartice, kvizovi, testovi i odgovori u chatu napravljeni iz tvog gradiva
- struktura biblioteke, mape, oznake napretka i historija obrada
- stanje poslova u pozadini i zapisi o greškama

**Podaci o plaćanju**

- status pretplate, odabrani paket, period i historija plaćanja
- identifikator kupca i pretplate kod Stripea

Za pretplate u App Storeu obrađujemo Appleove potpisane zapise o transakcijama, identifikatore proizvoda i transakcija, datume kupovine i isteka te status povrata ili opoziva pristupa. Appleu šaljemo tehnički identifikator tvog Memo računa kako bismo kupovinu povezali s računom i provjerili pristup.

Podatke o tvojoj platnoj kartici ne primamo i ne čuvamo. Podatke o plaćanju direktno obrađuje Stripe za web kupovine ili Apple za kupovine u App Storeu.

**Tehnički podaci**

- IP adresa, vrsta uređaja, preglednik i operativni sistem
- vremena pristupa, zahtjevi i odgovori servera
- podaci o greškama i rušenjima
- agregirani podaci o posjetama stranicama

## 3. Svrhe obrade i pravni osnovi

**Izvršenje ugovora (član 6. stav 1. tačka (b) GDPR-a)**

- pravljenje i vođenje računa te prijava
- pohrana i uređivanje tvoje biblioteke bilježaka
- transkripcija, analiza i obrada gradiva koje pošalješ
- izrada sažetaka, bilježaka, kartica, kvizova, testova i odgovora u chatu
- obračun pretplate, obrada plaćanja i povrata
- korisnička podrška

**Zakonska obaveza (član 6. stav 1. tačka (c) GDPR-a)**

- izdavanje i čuvanje računa te druge poreske i računovodstvene obaveze
- odgovori na zahtjeve nadležnih organa

**Legitimni interes (član 6. stav 1. tačka (f) GDPR-a)**

- sigurnost usluge, sprječavanje zloupotrebe, ograničavanje broja zahtjeva i otkrivanje prevara
- otklanjanje grešaka i poboljšavanje pouzdanosti proizvoda
- agregirana statistika korištenja iz koje nije moguće prepoznati pojedinca
- ostvarivanje ili odbrana pravnih zahtjeva

Kod obrade na osnovu legitimnog interesa odmjerili smo svoj interes i tvoja prava. Takvoj obradi možeš prigovoriti bilo kada.

**Saglasnost (član 6. stav 1. tačka (a) GDPR-a)**

- neobavezne poruke o proizvodu, kada se na njih prijaviš
- neobavezni kolačići ili slične tehnologije, kada su u upotrebi

Saglasnost možeš povući bilo kada. Povlačenje ne utiče na zakonitost obrade prije povlačenja.

## 4. Posebne kategorije ličnih podataka

Memo AI nije namijenjen obradi posebnih kategorija ličnih podataka, naprimjer zdravstvenih podataka, biometrijskih podataka ili podataka o vjeroispovijesti, političkom uvjerenju ili seksualnoj orijentaciji.

Ako takvo gradivo ipak učitaš, činiš to na vlastitu odgovornost i moraš za njega imati važeći pravni osnov. Odvraćamo od učitavanja takvog gradiva o drugim osobama.

## 5. Dozvole za snimanje i gradiva

Korištenjem Memo AI potvrđuješ da imaš sve potrebne dozvole i prava za snimanje, učitavanje, lijepljenje ili povezivanje sadržaja koji šalješ u aplikaciju. To uključuje dozvole škole, nastavnika, predavača, ustanove, poslodavca, učesnika snimanja ili drugih nosilaca prava, kada su takve dozvole potrebne.

U Memo AI nemoj učitavati snimke predavanja, prezentacije, nastavne materijale, dokumente ili drugi sadržaj ako za to nemaš dozvolu odnosno zakonski osnov.

Kada se u gradivu pojavljuju druge osobe, u pogledu njihovih ličnih podataka ti si taj koji odlučuje o obradi, a mi gradivo obrađujemo po tvom nalogu.

## 6. Kome prosljeđujemo podatke

Podatke ne prodajemo. Prosljeđujemo ih samo pružaocima koji su nam potrebni za rad usluge, i to u obimu potrebnom za pojedinu funkciju. S njima imamo sklopljene ugovore o obradi podataka.

- **Supabase** — autentikacija, baza podataka i pohrana datoteka
- **Stripe** — obrada plaćanja, pretplata i povrata
- **OpenRouter i odabrani pružaoci modela** — generisanje AI odgovora i sadržaja za učenje kada se koriste te usluge
- **Google (Gemini)** — transkripcija, izdvajanje teksta iz dokumenata, ugrađivanja, izrada bilježaka i odgovora u chatu
- **Soniox** — transkripcija audiosnimaka, kada je ta usluga uključena
- **Vercel** — hosting aplikacije i agregirana statistika posjeta
- **Inngest** — izvršavanje poslova u pozadini, kada je uključen
- **Sentry** — praćenje grešaka i rušenja
- **Google i Apple** — prijava, kada odabereš prijavu preko njih

Apple također obrađuje kupovine i upravljanje pretplatama u App Storeu prema svojoj [politici privatnosti](https://www.apple.com/legal/privacy/). S Appleom razmjenjujemo prethodno opisane podatke o transakcijama radi provjere i održavanja tvog plaćenog pristupa.

Podatke možemo otkriti i nadležnim organima kada smo na to zakonski obavezani, te svojim pravnim ili računovodstvenim savjetnicima kada je to potrebno.

Ako dođe do statusne promjene ili prodaje djelatnosti, podaci se mogu prenijeti na sticaoca, pri čemu ova politika vrijedi i dalje dok te o promjeni ne obavijestimo.

## 7. Prijenosi izvan EU i EEP

Neki pružaoci obrađuju podatke i izvan Evropskog ekonomskog prostora, posebno u Sjedinjenim Američkim Državama.

U takvim se slučajevima prijenos obavlja na osnovu:

- odluke Evropske komisije o primjerenosti, kada ona postoji, ili
- standardnih ugovornih klauzula Evropske komisije zajedno s dodatnim zaštitnim mjerama

Kopiju primijenjenih zaštitnih mjera možeš zatražiti na info@memoai.eu.

## 8. Koliko dugo čuvamo podatke

- **podaci o računu** — dok tvoj račun postoji, zatim do 30 dana nakon brisanja
- **sadržaj i napravljene bilješke** — dok ih ne izbrišeš ili dok ne izbrišeš račun; iz sigurnosnih se kopija uklanjaju najkasnije u roku od 30 dana
- **podaci o plaćanjima i računi** — 10 godina, koliko zahtijeva poresko zakonodavstvo
- **zapisi o greškama i sigurnosni zapisi** — do 12 mjeseci
- **korespondencija s podrškom** — do 24 mjeseca nakon zatvaranja predmeta
- **podaci potrebni za pravne zahtjeve** — do zastare zahtjeva

Sadržaj ostaje povezan s tvojim računom dok ga ne izbrišeš u aplikaciji ili dok ga ne uklonimo putem podrške ili redovnog čišćenja.

## 9. Sigurnost

Primjenjujemo tehničke i organizacijske mjere primjerene riziku, između ostalog:

- šifriranje prijenosa podataka
- razdvajanje pristupa podacima na nivou baze, tako da svojim bilješkama pristupaš samo ti
- ograničen i zabilježen pristup zaposlenih, samo u slučajevima kada je to neophodno
- praćenje grešaka i neuobičajenog saobraćaja

Nijedan sistem nije potpuno siguran. Ako dođe do povrede ličnih podataka koja bi za tebe mogla predstavljati visok rizik, obavijestit ćemo tebe i nadležni nadzorni organ, kako to zahtijeva zakon.

## 10. Tvoja prava

Prema GDPR-u imaš pravo na:

- **pristup** — potvrdu obrađujemo li tvoje podatke i primjerak tih podataka
- **ispravku** — ispravku netačnih ili dopunu nepotpunih podataka
- **brisanje** — brisanje podataka kada za obradu više nema osnova
- **ograničenje obrade** — u slučajevima koje propisuje zakon
- **prenosivost** — primanje podataka u mašinski čitljivom obliku ili prijenos drugom pružaocu
- **prigovor** — na obradu koja se zasniva na legitimnom interesu
- **povlačenje saglasnosti** — kada se obrada zasniva na saglasnosti

Ne provodimo automatizirano donošenje odluka s pravnim učincima za tebe niti izradu profila u smislu člana 22. GDPR-a.

## 11. Kako ostvariti prava

Zahtjev pošalji na info@memoai.eu s adrese e-pošte povezane s tvojim računom. Odgovaramo najkasnije u roku od mjesec dana; u složenim se slučajevima rok može produžiti za dva mjeseca, o čemu te obavještavamo.

Radi provjere identiteta možemo zatražiti dodatne podatke, ali samo u obimu koji je za to potreban.

Ako smatraš da tvoje podatke obrađujemo nezakonito, možeš podnijeti pritužbu Informacijskom povjereniku Republike Slovenije, Dunajska cesta 22, 1000 Ljubljana, gp.ip@ip-rs.si, kao vodećem nadzornom organu, ili nadzornom organu u državi svog uobičajenog boravišta.

## 12. Kolačići i slične tehnologije

Koristimo:

- **neophodne kolačiće i lokalnu pohranu** — za prijavu, održavanje sesije, sigurnost i osnovna podešavanja. Oni su potrebni za rad usluge i nije ih moguće isključiti
- **statistiku posjeta** — agregirana i nelična mjerenja posjeta stranicama putem Vercel Analyticsa

Oglašivačke kolačiće i praćenje između web-stranica ne koristimo. Ako u budućnosti uvedemo neobavezne kolačiće, za njih ćemo zatražiti tvoju saglasnost.

## 13. Djeca

Memo AI nije namijenjen djeci mlađoj od 16 godina. Ako utvrdimo da smo bez odgovarajućeg osnova obradili podatke djeteta mlađeg od 16 godina, brišemo ih. Ako si roditelj ili staratelj i smatraš da se to dogodilo, piši nam na info@memoai.eu.

## 14. Tvoje mogućnosti

Ako ne želiš da dođe do obrade opisane u ovoj politici, nemoj taj sadržaj učitavati, lijepiti, snimati ni povezivati u Memo AI. Ako trebaš strože uvjete u pogledu čuvanja, brisanja ili ugovornih odredbi, obrati nam se prije korištenja.

## 15. Izmjene ove politike

Politiku možemo ažurirati kada se proizvod, pružaoci ili zakonodavstvo promijene. O bitnim te izmjenama obavještavamo e-poštom ili u aplikaciji.

## 16. Kontakt

info@memoai.eu`,
  },
  "refund-policy": {
    title: "Politika povrata",
    content: `# Politika povrata

Ova politika objašnjava kada vraćamo uplatu za pretplatu na Memo AI, u kojem dijelu i kako povrat zatražiti. Dio je uvjeta korištenja.

## 1. Ukratko

**Kupovine u App Storeu:** povrat zatraži putem [Applea](https://reportaproblem.apple.com/). Apple obrađuje te zahtjeve; rokovi i procenti djelimičnih povrata za web kupovine navedeni u nastavku ne primjenjuju se na transakcije u App Storeu. Tvoja zakonska potrošačka prava ostaju nepromijenjena. Za pomoć sa samom uslugom piši na info@memoai.eu.

**Web kupovine putem Stripea:**

- **zahtjev u roku od 24 sata od uplate** — vraćamo 50 % uplaćenog iznosa
- **zahtjev nakon 24 sata od uplate** — nema povrata
- **otkazivanje pretplate** — bilo kada; pristup ostaje do kraja plaćenog perioda
- **naša greška ili dvostruko terećenje** — vraćamo u cijelosti
- **zakonsko pravo potrošača na odustanak** — važi uz ovu politiku i ima prednost pred njom

## 2. Na šta se odnosi

Ova politika odnosi se na pretplate kupljene direktno u Memo AI putem Stripea.

Važi za svaku pojedinu uplatu, uključujući automatsko produženje. Rok od 24 sata za svaku se uplatu računa iznova, od trenutka terećenja.

## 3. Djelimični povrat u roku od 24 sata

Ako u roku od **24 sata od trenutka terećenja** pošalješ zahtjev za povrat, vraćamo ti **50 % uplaćenog iznosa** za taj period.

- rok počinje teći u trenutku kada je uplata obračunata
- računa se vrijeme kada tvoj zahtjev stigne na info@memoai.eu
- kada je povrat odobren, pretplata se otkazuje, a plaćeni pristup prestaje odmah nakon izvršenja povrata
- djelimični povrat moguć je jednom po obračunskom periodu

## 4. Nakon 24 sata

Za zahtjeve poslane **više od 24 sata** nakon terećenja nema povrata.

Pretplatu i dalje možeš otkazati bilo kada. U tom se slučaju novi period ne obračunava, a plaćeni pristup ostaje ti do kraja već plaćenog perioda.

## 5. Kada vraćamo cijeli iznos

Bez obzira na rokove iz tačaka 3. i 4., vraćamo cijeli iznos kada:

- je isti iznos greškom obračunat dvaput
- je uplata obračunata nakon valjanog otkazivanja pretplate
- je uplata obračunata bez tvog odobrenja i o tome nas obavijestiš čim saznaš
- plaćene funkcije zbog greške na našoj strani duže vrijeme nije bilo moguće koristiti, a grešku nismo otklonili u razumnom roku
- smo ti račun ukinuli bez tvoje krivice; u tom slučaju vraćamo srazmjerni dio za neiskorišteni period
- to zahtijeva zakon

## 6. Kada nema povrata

- za periode koji su već u cijelosti istekli
- za besplatni probni period, jer za njega nije bilo uplate
- za promotivne i poklon kodove te popuste; oni se ne isplaćuju u novcu
- kada je račun ukinut zbog kršenja uvjeta korištenja
- kod ponavljajućih zahtjeva istog korisnika, kada je očito da se ova politika zloupotrebljava

Povrat ne odbijamo zato što si uslugu koristio. Ako si u periodu za koji tražiš povrat napravio sadržaj, to ne utiče na visinu povrata prema ovoj politici.

## 7. Kako zatražiti povrat

Piši na **info@memoai.eu** s adrese e-pošte povezane s tvojim računom i navedi:

- datum uplate i iznos
- paket koji si kupio
- želiš li i otkazivanje pretplate
- kratak razlog, koji nam pomaže poboljšati proizvod; razlog nije obavezan

Prijem zahtjeva potvrđujemo i odgovaramo najkasnije u roku od **5 radnih dana**.

## 8. Izvršenje povrata

- povrat izvršavamo putem Stripea, na isto sredstvo plaćanja kojim je uplata obavljena
- povrat odobravamo najkasnije u roku od **14 dana** od prijema zahtjeva
- koliko vremena treba da iznos bude vidljiv na tvom računu ovisi o tvojoj banci ili izdavaocu kartice; obično 5 do 10 radnih dana
- troškove obrade povrata ti ne naplaćujemo

## 9. Otkazivanje pretplate

Otkazivanje i povrat nisu isto.

Pretplatu otkazuješ u postavkama računa ili putem linka na Stripe portal. Otkazivanje sprječava sljedeće obračunavanje, ali ne i povrat već uplaćenog iznosa. Za povrat moraš poslati zaseban zahtjev prema tački 7.

Ako otkažeš prije isteka besplatnog probnog perioda, uplata se ne obračunava.

## 10. Prigovor na terećenje kod banke

Ako smatraš da je uplata bila pogrešna, prvo piši nama. Većinu slučajeva rješavamo brže nego što traje postupak prigovora kod banke.

Ako prigovor kod banke ili izdavaoca kartice podneseš bez prethodnog kontakta s nama, možemo privremeno ograničiti pristup računu dok postupak ne bude zaključen.

## 11. Izmjene ove politike

Ovu politiku možemo izmijeniti. Za pojedinu uplatu uvijek važi verzija objavljena na dan te uplate.

## 12. Kontakt

info@memoai.eu`,
  },
  "terms-of-use": {
    title: "Uvjeti korištenja",
    content: `# Uvjeti korištenja

Ovi su uvjeti pravno obavezujući ugovor između tebe i operatora usluge Memo AI. Pročitaj ih prije nego što napraviš račun ili kupiš pretplatu.

## 1. Ko smo

Memo AI je internetska usluga dostupna na memoai.eu (u nastavku „Memo AI”, „mi” ili „nas”). Uslugom upravlja:

- **Memo AI, Nace Valenčič s.p., poslovno svetovanje**
- sjedište: Zgoša 87, 4275 Begunje na Gorenjskem, Slovenija
- matični broj: 7578474000
- poreski broj: 52958248

Za sva pitanja, zahtjeve i obavijesti prema ovim uvjetima piši na info@memoai.eu.

## 2. Prihvatanje uvjeta

Pravljenjem računa, prijavom ili korištenjem Memo AI potvrđuješ da si ove uvjete pročitao, da ih razumiješ i da se s njima slažeš. Ako se s njima ne slažeš, nemoj koristiti Memo AI.

Uz ove uvjete važe i:

- politika privatnosti, koja objašnjava kako postupamo s ličnim podacima
- politika povrata, koja uređuje otkazivanja i povrate uplata

Ugovor je sklopljen na slovenskom jeziku. Tekst ugovora čuvamo u obliku ovih objavljenih uvjeta i stalno ti je dostupan na ovoj stranici.

## 3. Ko može koristiti Memo AI

- za korištenje moraš imati najmanje 16 godina
- ako si mlađi od 18 godina, moraš imati saglasnost roditelja ili zakonskog zastupnika koji se s ovim uvjetima saglasi u tvoje ime
- račun je ličan; podatke za prijavu nemoj dijeliti i račun nemoj prenositi na drugu osobu
- ako Memo AI koristiš u ime škole, firme ili druge organizacije, potvrđuješ da si ovlašten tu organizaciju obavezati ovim uvjetima

Memo AI namijenjen je ličnom korištenju za učenje. Za korištenje u ustanovi ili firmi s vlastitim zahtjevima u pogledu čuvanja, brisanja ili ugovornih odredbi, obrati nam se prije korištenja.

## 4. Račun i sigurnost

- pri registraciji navedi istinite podatke i adresu e-pošte kojoj stvarno pristupaš
- odgovoran si za sigurnost svog poštanskog sandučeta, prijavnih kodova i povezanih Google ili Apple računa
- za svu aktivnost na svom računu odgovaraš sam, osim ako je do nje došlo našom krivicom
- ako sumnjaš na neovlašten pristup, odmah nas obavijesti na info@memoai.eu

## 5. Šta je Memo AI

Memo AI je alat za učenje koji radi s vještačkom inteligencijom. Iz gradiva koje pošalješ pravi transkripte, sažetke, strukturirane bilješke, kartice, kvizove, testove i odgovore u chatu te omogućava izvoz i uređivanje biblioteke bilježaka.

Memo AI nije:

- zamjena za predavanja, stručnu literaturu ili vlastiti rad
- stručni savjet bilo koje vrste, posebno ne medicinski, pravni, finansijski, poreski ili sigurnosni
- usluga pohrane podataka na koju bi se smio osloniti kao na jedini primjerak svog gradiva

Za vlastite sigurnosne kopije važnog gradiva pobrini se sam.

## 6. Besplatno korištenje i probni period

Probni period u App Storeu vrijedi samo ako ga Apple prikaže u potvrdi kupovine. Web probni periodi i promotivni kodovi ne primjenjuju se automatski na kupovine u App Storeu. Pravila probnog perioda u nastavku opisuju našu web ponudu.

- bez pretplate možeš napraviti ograničenu količinu sadržaja, uključujući jednu probnu bilješku i ograničen broj poruka u chatu
- pri prvoj kupovini pretplate možeš dobiti 3-dnevni besplatni probni period, ako ispunjavaš uvjete za njega
- besplatni probni period pripada jednoj osobi jednom; na njega nemaju pravo korisnici koji su kod nas već imali pretplatu
- ako probni period ne otkažeš prije isteka, pretplata se automatski nastavlja i uplata se obračunava prema važećem cjenovniku
- obim besplatnog korištenja možemo promijeniti ubuduće

## 7. Pretplate, cijene i plaćanja

**Pretplate u App Storeu**

Na iOS-u kupovine pretplata u aplikaciji obrađuje Apple. Prije potvrde kupovine Apple prikazuje cijenu, valutu, obračunski period i eventualnu ponudu. Pretplata se automatski obnavlja dok je ne otkažeš putem Applea. Apple upravlja naplatom, potvrdama o kupovini i odgovarajućim obavijestima o promjeni cijena. Mjesečni i godišnji paket nude iste funkcije Memo Premium za različite obračunske periode. Obnovu kupovina upotrijebi dok si prijavljen u Memo račun korišten za izvornu kupovinu. Appleove pretplate nije moguće prenositi između Memo računa.

**Web pretplate putem Stripea**

- Memo AI se prodaje kao pretplata koja se ponavlja; aktuelne cijene i periodi navedeni su na stranici s cijenama i u Stripe Checkoutu prije potvrde kupovine
- sve su cijene navedene u eurima; je li porez uključen ili se dodaje jasno je prikazano prije završetka kupovine
- plaćanja u naše ime obrađuje Stripe; cjelovite podatke o tvojoj kartici ne primamo i ne čuvamo
- pretplata se automatski produžava na kraju svakog obračunskog perioda dok je ne otkažeš
- uplata za novi period obračunava se na dan produženja sredstvom plaćanja pohranjenim kod Stripea
- ako plaćanje ne uspije, možemo privremeno ograničiti pristup plaćenim funkcijama dok uplata ne bude izmirena
- promotivni i poklon kodovi važe pod uvjetima navedenim uz kod i ne mogu se zamijeniti za gotovinu
- cijene možemo promijeniti; o promjeni te obavještavamo najmanje 30 dana prije njenog stupanja na snagu, a promjena važi za sljedeći obračunski period. Ako se s cijenom ne slažeš, pretplatu možeš otkazati prije stupanja na snagu

Račun za svaku uplatu primaš na adresu e-pošte povezanu s tvojim računom.

## 8. Otkazivanje

Za pretplate u App Storeu upotrijebi upravljanje Apple pretplatom u postavkama Memo-a ili otvori Postavke na iPhoneu → tvoje ime → Pretplate. Otkaži prije datuma obnove; plaćeni pristup obično traje do isteka pretplate. Brisanje Memo-a ili Memo računa ne otkazuje Appleovu pretplatu. Povrat za kupovinu u App Storeu zatraži putem [Applea](https://reportaproblem.apple.com/).

**Web pretplate putem Stripea:**

Pretplatu možeš otkazati bilo kada u postavkama računa ili putem linka na Stripe portal. Otkazivanje stupa na snagu na kraju tekućeg plaćenog perioda; do tada plaćene funkcije ostaju dostupne. Otkazivanje samo po sebi ne znači povrat već uplaćenog iznosa.

Povrate uređuje politika povrata.

## 9. Tvoje odgovornosti

- učitavati, snimati, lijepiti ili povezivati smiješ samo gradivo koje posjeduješ ili koje smiješ koristiti
- odgovoran si za zakonitost i tačnost sadržaja koji pošalješ
- moraš poštovati pravila svoje škole, fakulteta ili poslodavca u pogledu snimanja i dijeljenja gradiva
- rezultate koje napravi Memo AI moraš provjeriti prije korištenja

## 10. Dozvole za snimanje i gradiva

Korištenjem Memo AI potvrđuješ da prije snimanja, učitavanja, lijepljenja ili povezivanja sadržaja imaš sve potrebne dozvole i prava. To uključuje dozvole škole, nastavnika, predavača, ustanove, poslodavca, učesnika snimanja ili drugih nosilaca prava, kada su takve dozvole potrebne.

Nemoj snimati predavanja, razgovore ili druge osobe i nemoj učitavati prezentacije, bilješke, nastavne materijale, dokumente ili druge datoteke ako za to nemaš dozvolu odnosno zakonski osnov. Odgovoran si da tvoje korištenje Memo AI ne krši pravila škole, ugovorna ograničenja, autorska prava, privatnost, pravila o snimanju ili druge važeće zakone i pravila.

U Memo AI nemoj učitavati posebne kategorije ličnih podataka drugih ljudi, naprimjer zdravstvene podatke ili podatke o vjeroispovijesti, političkom uvjerenju ili seksualnoj orijentaciji, osim ako za to imaš važeći pravni osnov.

## 11. Zabranjeno korištenje

Memo AI ne smiješ koristiti kako bi:

- učitavao zlonamjerni softver ili pokušavao ugroziti sigurnost usluge
- pristupao dijelovima usluge, računima ili podacima na koje nemaš pravo
- zaobišao ograničenja količine, naplatni zid, probna ograničenja ili tehničke zaštite
- uslugu automatski prikupljao, obrnuto inženjerio ili provodio testove opterećenja bez naše pisane dozvole
- pravio ili širio nezakonit, uvredljiv, obmanjujući ili nasilan sadržaj
- zadirao u prava drugih, uključujući autorska prava i pravo na privatnost
- uslugu preprodavao, iznajmljivao ili je nudio kao vlastitu
- kršio akademska pravila o poštenju ili predavao napravljeni sadržaj kao vlastiti rad kada to nije dozvoljeno
- koristio Memo AI za automatsku masovnu obradu gradiva koje nije povezano s vlastitim studijem

## 12. Tvoj sadržaj

Gradivo koje pošalješ u Memo AI ostaje tvoje. Radi rada usluge dodjeljuješ nam neisključivo, vremenski ograničeno i prostorno neograničeno pravo da to gradivo pohranimo, prikažemo, obradimo i proslijedimo našim pružaocima obrade isključivo zato da bismo mogli izvesti funkcije koje zatražiš.

To pravo prestaje kada sadržaj izbrišeš ili kada izbrišemo tvoj račun, osim kada podatke moramo još čuvati zbog zakonskih obaveza.

Tvoj sadržaj ne prodajemo i ne koristimo ga za oglašavanje.

## 13. Naša prava

Memo AI, njegov softver, dizajn, žig i sadržaj koji nije tvoj vlasništvo su nas ili naših davalaca licenci. Sklapanjem pretplate dobijaš lično, neprenosivo i neisključivo pravo korištenja usluge u skladu s ovim uvjetima, ali ne i vlasništvo nad njom.

## 14. AI obrada i ograničenja rezultata

Za transkripte, sažetke, kartice, kvizove, odgovore u chatu i izdvajanje sadržaja iz dokumenata Memo AI može tvoj sadržaj obraditi kod vanjskih AI i infrastrukturnih pružalaca.

To može uključivati:

- audiosnimke i učitane zvučne datoteke
- zalijepljeni tekst i bilješke
- PDF-ove i druge podržane dokumente
- javne web-linkove za koje želiš da ih Memo AI pročita
- metapodatke potrebne za rad, sigurnost i poboljšavanje usluge

Spisak pružalaca i osnovi za obradu navedeni su u politici privatnosti.

Memo AI može napraviti greške, nepotpune odgovore ili obmanjujuće gradivo za učenje. Prije nego što se osloniš na rezultate kod ispita, seminarskih radova, medicinskih, pravnih, finansijskih, usklađenosnih ili sigurnosno kritičnih odluka, moraš ih sam provjeriti.

## 15. Dostupnost i izmjene usluge

Nastojimo osigurati neometan rad, ali ne obećavamo neprekinutu dostupnost. Usluga može biti privremeno nedostupna zbog održavanja, grešaka, ažuriranja ili smetnji kod vanjskih pružalaca.

Pojedine funkcije možemo mijenjati, dodavati ili ukidati. Ako bi promjena za plaćene korisnike bila bitno nepovoljna, o njoj te obavještavamo unaprijed, a ti pretplatu možeš otkazati.

## 16. Postupanje i prekid računa

Pristup možemo privremeno ograničiti, onemogućiti određene funkcije ili ukloniti sadržaj kada korištenje izgleda zloupotrebno, nezakonito, opasno ili štetno za uslugu ili druge korisnike.

Kod težih ili ponavljajućih kršenja račun možemo ukinuti. Kada je to izvedivo i dozvoljeno, o razlogu te obavještavamo i dajemo ti mogućnost da postupak objasniš ili otkloniš. Ako račun ukinemo bez tvoje krivice, vraćamo ti srazmjerni dio unaprijed plaćene pretplate.

Svoj račun možeš ukinuti bilo kada tako da nam pišeš na info@memoai.eu.

## 17. Garancije

Usluga je dostupna takva kakva jest. U obimu koji dozvoljava zakon ne dajemo garancije da će usluga biti bez grešaka, neprekinuta ili prikladna za tačno određenu svrhu, i ne garantujemo za tačnost rezultata koje napravi AI.

To ne dira u obavezne garancije koje ti kao potrošaču pripadaju prema slovenskom i evropskom pravu.

## 18. Ograničenje odgovornosti

U obimu koji dozvoljava zakon ne odgovaramo za:

- izgubljenu dobit, izgubljenu priliku, gubitak podataka ili posrednu štetu
- posljedice odluka koje si donio na osnovu neprovjerenih rezultata AI-ja
- postupanje trećih lica ili prekid njihovih usluga
- štetu nastalu zbog tvog kršenja ovih uvjeta

Naša ukupna odgovornost po pojedinom zahtjevu ograničena je na iznos koji si nam platio u 12 mjeseci prije događaja koji je prouzrokovao štetu.

Ništa u ovim uvjetima ne isključuje i ne ograničava odgovornost za namjeru, krajnju nepažnju, smrt ili tjelesnu povredu te odgovornost koju prema zakonu nije moguće isključiti. Ako si potrošač, u cijelosti ti ostaju dostupna sva prava prema propisima o zaštiti potrošača.

## 19. Tvoja odgovornost za naknadu štete

Ako zbog tvog kršenja ovih uvjeta ili zbog gradiva koje si poslao bez odgovarajućih prava treće lice protiv nas podnese zahtjev, nadoknađuješ nam opravdane troškove koji nam pritom nastanu. To važi samo u obimu u kojem je zahtjev posljedica tvog postupanja.

## 20. Izmjene uvjeta

Ove uvjete možemo izmijeniti kada se proizvod, zakonodavstvo ili pružaoci promijene.

- o bitnim te izmjenama obavještavamo e-poštom ili u aplikaciji najmanje 30 dana prije stupanja na snagu
- manje ispravke koje ne diraju u tvoja prava objavljujemo direktno na ovoj stranici
- ako nakon stupanja na snagu nastaviš s korištenjem, to znači da prihvaćaš ažuriranu verziju
- ako se s izmjenom ne slažeš, prije njenog stupanja na snagu možeš otkazati pretplatu

## 21. Prestanak

Prestankom ugovora prestaje tvoje pravo korištenja usluge. Sa sadržajem povezanim s tvojim računom postupa se u skladu s politikom privatnosti. Odredbe o intelektualnom vlasništvu, ograničenju odgovornosti, naknadi štete i rješavanju sporova važe i nakon prestanka.

## 22. Mjerodavno pravo i rješavanje sporova

Za ove uvjete važi pravo Republike Slovenije, bez primjene kolizijskih pravila. Ako si potrošač s prebivalištem u drugoj državi, taj te izbor ne lišava zaštite koju ti jamče prisilni propisi tvoje države.

Sporove najprije pokušavamo riješiti sporazumno; piši nam na info@memoai.eu i odgovorit ćemo ti u razumnom roku.

Kao potrošač možeš koristiti i:

- postupak vansudskog rješavanja potrošačkih sporova, kada je dostupan. Trenutno ne priznajemo nijednog provodioca vansudskog rješavanja potrošačkih sporova kao nadležnog za sporove iz ovih uvjeta
- pritužbu Tržišnom inspektoratu Republike Slovenije

Za sporove koje nije moguće riješiti sporazumno nadležan je stvarno nadležni sud u Republici Sloveniji. Ako si potrošač, to ne dira u tvoje pravo da tužbu podneseš sudu u mjestu svog prebivališta.

## 23. Završne odredbe

- ako je pojedina odredba ovih uvjeta nevažeća, ostale odredbe ostaju na snazi
- ove uvjete ne možeš prenijeti na drugu osobu bez naše saglasnosti; mi ih možemo prenijeti kod statusne promjene ili prodaje djelatnosti, pri čemu se tvoja prava ne pogoršavaju
- ako neko pravo ne ostvarimo odmah, time ga se ne odričemo
- ovi uvjeti zajedno s politikom privatnosti i politikom povrata čine cjelokupni dogovor između tebe i nas o korištenju Memo AI

## 24. Kontakt

info@memoai.eu

---

**Zakonsko pravo potrošača na odustanak.** Ako si potrošač s prebivalištem u EU ili EEP, prema zakonu imaš pravo da u roku od 14 dana od sklapanja pretplatničkog ugovora od njega odustaneš, bez navođenja razloga. Budući da se usluga na tvoj izričit zahtjev počinje pružati odmah nakon kupovine, pri kupovini izričito zahtijevaš da pružanje počne prije isteka roka za odustanak; ako tokom roka za odustanak odustaneš, vraćamo ti uplaćeni iznos umanjen za srazmjerni dio koji odgovara usluzi pruženoj do dana odustanka. To zakonsko pravo važi uz politiku povrata: ako ti zakon u konkretnom slučaju daje veći povrat nego što ga predviđa politika povrata, važi zakon. Za odustanak je dovoljna jasna izjava e-poštom na info@memoai.eu, a možeš upotrijebiti i obrazac za odustanak iz priloga slovenskom Zakonu o zaštiti potrošača. Ništa u ovim uvjetima ni u politici povrata ne ograničava prava koja ti kao potrošaču pripadaju prema prisilnim propisima.`,
  },
};
