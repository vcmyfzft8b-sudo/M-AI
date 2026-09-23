import type { HelpArticles } from "@/lib/help/articles";

/**
 * Serbian (Latin script).
 *
 * The three legal documents are translations of the Slovenian originals,
 * which remain the authoritative version — the public legal pages say so
 * under the fine print (`legal.prevailingNotice`). They name the Slovenian
 * controller, the Slovenian supervisory authority and Slovenian law,
 * because that is the factual position, not an artefact of translation.
 */
export const srHelpArticles: HelpArticles = {
  "family-plan": {
    title: "Porodični paket?",
    content: `# Porodični paket

Zajednički porodični radni prostor još nije podržan.

Zasad svaki nalog ima sopstvenu biblioteku beleški i sopstvenu istoriju obrada.

## Šta možeš da uradiš sada

- prijavi se nalogom koji treba da bude vlasnik beleški
- beleške po potrebi kopiraj iz prikaza beleške
- za doslednije rezultate gradivo istog predmeta učitavaj na isti nalog`,
  },
  "gift-coconote": {
    title: "Mogu li da poklonim Memo?",
    content: `# Poklanjanje pristupa

Ako imaš promotivni ili poklon kod, primalac može da ga upotrebi u Stripe Checkoutu pre završetka kupovine.

Za korišćenje Memo-a primalac treba da napravi sopstveni nalog, zatim kod unese pri plaćanju u Stripeu i proveri da se popust prikazuje pre potvrde plaćanja.`,
  },
  "supported-language": {
    title: "Da li podržavate moj jezik?",
    content: `# Podržani jezici

Jezik nije potrebno podešavati. Memo AI pročita tvoje gradivo i beleške, kartice i kvizove napiše na jeziku na kojem je samo gradivo.

## Preporuke

- gradivo učitaj takvo kakvo jeste — nije ga potrebno unapred prevoditi
- kod mešanja jezika pomažu kraći snimci
- tehnički engleski izrazi mogu ostati u rezultatu kada su deo izvornog sadržaja`,
  },
  "feature-request": {
    title: "Predlog funkcije",
    content: `# Predloži poboljšanje

Najkorisniji predlog je kratak i konkretan opis načina na koji radiš.

Korisno je uključiti:

- šta si hteo da postigneš
- gde si zapeo
- kakav si rezultat očekivao
- da li se radi o zvuku, dokumentu, PDF-u ili linku`,
  },
  "video-isnt-working": {
    title: "Link ka videu ne radi",
    content: `# Problemi sa linkom ka videu

Memo može da obradi samo sadržaj koji je javno dostupan i dovoljno čitljiv za sažimanje.

## Pokušaj ovo

- proveri da stranica ne traži prijavu
- upotrebi direktan URL stranice
- ako gradivo imaš negde drugde, učitaj PDF ili dokument`,
  },
  "audio-upload-issue": {
    title: "Ne mogu da učitam zvuk",
    content: `# Problemi pri učitavanju zvuka

Podržani formati su MP3, M4A, WAV, OGG i WEBM.

## Lista za proveru

- proveri da datoteka nije oštećena
- ostani ispod trenutnog ograničenja veličine
- ako je zvuk nastao snimanjem ekrana, izvezi ga ponovo
- ako se učitavanje ranije zaustavilo, pokušaj ponovo sa početne stranice`,
  },
  "transcript-cut-short": {
    title: "Transkript je prekratak ili netačan",
    content: `# Kvalitet transkripta

Kvalitet transkripta zavisi od čistoće zvuka i preklapanja govornika. Jezik Memo AI prepoznaje sam.

## Kako poboljšati rezultate

- snimaj što bliže govorniku
- kod razgovora omogući snimanje više govornika
- smanji pozadinsku buku
- veoma duge snimke podeli na manje delove`,
  },
  "redeem-code": {
    title: "Iskoristi kod",
    content: `# Iskorišćavanje koda

Promotivni ili poklon kod možeš da upotrebiš u Stripe Checkoutu pre završetka kupovine.

## Kako da uneseš kod

- u podešavanjima izaberi opciju za kupovinu ili nadogradnju
- u Stripe obrascu za plaćanje otvori polje za promotivni kod
- unesi kod i potvrdi da se popust prikazuje pre plaćanja

Ako se polje ne prikaže ili kod nije prihvaćen, proveri da li je kod još važeći i da li se odnosi na izabrani paket.`,
  },
  "privacy-policy": {
    title: "Politika privatnosti",
    content: `# Politika privatnosti

Ova politika objašnjava koje lične podatke obrađujemo, zašto ih obrađujemo, kome ih prosleđujemo, koliko ih dugo čuvamo i koja prava imaš. Važi za veb-sajt memoai.eu i za aplikaciju Memo AI.

## 1. Rukovalac podataka

Rukovalac tvojim ličnim podacima je **Memo AI, Nace Valenčič s.p., poslovno svetovanje**, Zgoša 87, 4275 Begunje na Gorenjskem, Slovenija (matični broj 7578474000, poreski broj 52958248), koji upravlja uslugom Memo AI dostupnom na memoai.eu.

Kontakt za pitanja o privatnosti i za ostvarivanje prava: info@memoai.eu

## 2. Koje podatke obrađujemo

**Podaci o nalogu**

- adresa e-pošte
- identifikator korisnika i autentikacioni podaci
- podaci koje prosleđuju Google ili Apple ako se prijaviš preko njih: adresa e-pošte, ime i identifikator naloga
- ime, ako ga upišeš

**Podaci iz početnog podešavanja**

- odgovori u uvodnom upitniku, na primer oblast studija, način korišćenja i razlog korišćenja

**Sadržaj koji pošalješ**

- audiosnimci napravljeni u aplikaciji i učitane zvučne datoteke
- nalepljeni tekst, ručne beleške i upiti
- PDF-ovi, dokumenti i slike koje učitaš ili skeniraš
- javni veb-linkovi za koje želiš da ih Memo AI pročita
- poruke u chatu sa beleškama

**Podaci koji nastaju korišćenjem**

- transkripti, sažeci, beleške, kartice, kvizovi, testovi i odgovori u chatu napravljeni iz tvog gradiva
- struktura biblioteke, fascikle, oznake napretka i istorija obrada
- stanje poslova u pozadini i zapisi o greškama

**Podaci o plaćanju**

- status pretplate, izabrani paket, period i istorija plaćanja
- identifikator kupca i pretplate kod Stripea

Za pretplate u App Storeu obrađujemo Appleove potpisane zapise o transakcijama, identifikatore proizvoda i transakcija, datume kupovine i isteka i status povraćaja ili opoziva pristupa. Appleu šaljemo tehnički identifikator tvog Memo naloga kako bismo kupovinu povezali s nalogom i proverili pristup.

Ako u iOS aplikaciji dozvoliš obaveštenja, čuvamo token za push obaveštenja koji Apple dodeljuje tvom uređaju i povezujemo ga s tvojim nalogom. Preko Appleove usluge za push obaveštenja javljamo ti kada je beleška spremna. Obaveštenje sadrži naslov beleške. Obaveštenja možeš u bilo kom trenutku isključiti u podešavanjima iOS-a; odjavom se token uklanja, a brisanjem naloga briše.

Podatke o tvojoj platnoj kartici ne primamo i ne čuvamo. Podatke o plaćanju direktno obrađuje Stripe za veb kupovine ili Apple za kupovine u App Storeu.

**Tehnički podaci**

- IP adresa, vrsta uređaja, pregledač i operativni sistem
- vremena pristupa, zahtevi i odgovori servera
- podaci o greškama i rušenjima
- posete stranicama, približna država/regija/grad i podaci o uređaju, povezani s tvojim nalogom kada je dostupan, putem neobavezne analitike (u iOS aplikaciji tek kad je uključiš; na veb-sajtu dok je ne isključiš)

## 3. Svrhe obrade i pravni osnovi

**Izvršenje ugovora (član 6. stav 1. tačka (b) GDPR-a)**

- pravljenje i vođenje naloga i prijava
- čuvanje i uređivanje tvoje biblioteke beleški
- transkripcija, analiza i obrada gradiva koje pošalješ
- izrada sažetaka, beleški, kartica, kvizova, testova i odgovora u chatu
- obračun pretplate, obrada plaćanja i povraćaja
- korisnička podrška

**Zakonska obaveza (član 6. stav 1. tačka (c) GDPR-a)**

- izdavanje i čuvanje računa i druge poreske i računovodstvene obaveze
- odgovori na zahteve nadležnih organa

**Legitimni interes (član 6. stav 1. tačka (f) GDPR-a)**

- bezbednost usluge, sprečavanje zloupotrebe, ograničavanje broja zahteva i otkrivanje prevara
- otklanjanje grešaka i poboljšavanje pouzdanosti proizvoda
- ostvarivanje ili odbrana pravnih zahteva

Kod obrade na osnovu legitimnog interesa odmerili smo svoj interes i tvoja prava. Takvoj obradi možeš da prigovoriš bilo kada.

**Pristanak (član 6. stav 1. tačka (a) GDPR-a)**

- neobavezne poruke o proizvodu, kada se na njih prijaviš
- neobavezna analitika: u iOS aplikaciji tek nakon što je uključiš u podešavanjima; na veb-sajtu dok je tamo ne isključiš

Pristanak možeš da povučeš bilo kada. Povlačenje ne utiče na zakonitost obrade pre povlačenja.

## 4. Posebne kategorije ličnih podataka

Memo AI nije namenjen obradi posebnih kategorija ličnih podataka, na primer zdravstvenih podataka, biometrijskih podataka ili podataka o veroispovesti, političkom uverenju ili seksualnoj orijentaciji.

Ako takvo gradivo ipak učitaš, činiš to na sopstvenu odgovornost i moraš za njega imati važeći pravni osnov. Odvraćamo od učitavanja takvog gradiva o drugim licima.

## 5. Dozvole za snimanje i gradiva

Korišćenjem Memo AI potvrđuješ da imaš sve potrebne dozvole i prava za snimanje, učitavanje, nalepljivanje ili povezivanje sadržaja koji šalješ u aplikaciju. To uključuje dozvole škole, nastavnika, predavača, ustanove, poslodavca, učesnika snimanja ili drugih nosilaca prava, kada su takve dozvole potrebne.

U Memo AI nemoj da učitavaš snimke predavanja, prezentacije, nastavne materijale, dokumente ili drugi sadržaj ako za to nemaš dozvolu odnosno zakonski osnov.

Kada se u gradivu pojavljuju druga lica, u pogledu njihovih ličnih podataka ti si taj koji odlučuje o obradi, a mi gradivo obrađujemo po tvom nalogu.

## 6. Kome prosleđujemo podatke

Podatke ne prodajemo. Prosleđujemo ih samo pružaocima koji su nam potrebni za rad usluge, i to u obimu potrebnom za pojedinu funkciju. Sa njima imamo zaključene ugovore o obradi podataka.

- **Supabase** — autentikacija, baza podataka i skladištenje datoteka
- **Stripe** — obrada plaćanja, pretplata i povraćaja
- **OpenRouter i izabrani pružaoci modela** — generisanje AI odgovora i sadržaja za učenje kada se koriste te usluge
- **Google (Gemini)** — transkripcija, izdvajanje teksta iz dokumenata, ugrađivanja, izrada beleški i odgovora u chatu
- **Soniox** — transkripcija audiosnimaka, kada je ta usluga uključena
- **Vercel** — hosting, neobavezna analitika poseta i merenja performansi
- **Inngest** — izvršavanje poslova u pozadini, kada je uključen
- **Sentry** — praćenje grešaka i rušenja
- **Google i Apple** — prijava, kada izabereš prijavu preko njih

Apple takođe obrađuje kupovine i upravljanje pretplatama u App Storeu prema svojoj [politici privatnosti](https://www.apple.com/legal/privacy/). S Appleom razmenjujemo prethodno opisane podatke o transakcijama radi provere i održavanja tvog plaćenog pristupa.

Podatke možemo da otkrijemo i nadležnim organima kada smo na to zakonski obavezani, kao i svojim pravnim ili računovodstvenim savetnicima kada je to potrebno.

Ako dođe do statusne promene ili prodaje delatnosti, podaci se mogu preneti na sticaoca, pri čemu ova politika važi i dalje dok te o promeni ne obavestimo.

## 7. Prenosi izvan EU i EEP

Neki pružaoci obrađuju podatke i izvan Evropskog ekonomskog prostora, posebno u Sjedinjenim Američkim Državama.

U takvim se slučajevima prenos obavlja na osnovu:

- odluke Evropske komisije o primerenosti, kada ona postoji, ili
- standardnih ugovornih klauzula Evropske komisije zajedno sa dodatnim zaštitnim merama

Kopiju primenjenih zaštitnih mera možeš da zatražiš na info@memoai.eu.

## 8. Koliko dugo čuvamo podatke

- **podaci o nalogu** — dok tvoj nalog postoji, zatim do 30 dana nakon brisanja
- **sadržaj i napravljene beleške** — dok ih ne obrišeš ili dok ne obrišeš nalog; iz rezervnih se kopija uklanjaju najkasnije u roku od 30 dana
- **podaci o plaćanjima i računi** — 10 godina, koliko zahteva poresko zakonodavstvo
- **zapisi o greškama i bezbednosni zapisi** — do 12 meseci
- **prepiska sa podrškom** — do 24 meseca nakon zatvaranja predmeta
- **podaci potrebni za pravne zahteve** — do zastarelosti zahteva

Sadržaj ostaje povezan sa tvojim nalogom dok ga ne obrišeš u aplikaciji ili dok ga ne uklonimo putem podrške ili redovnog čišćenja.

## 9. Bezbednost

Primenjujemo tehničke i organizacione mere primerene riziku, između ostalog:

- šifrovanje prenosa podataka
- razdvajanje pristupa podacima na nivou baze, tako da svojim beleškama pristupaš samo ti
- ograničen i zabeležen pristup zaposlenih, samo u slučajevima kada je to neophodno
- praćenje grešaka i neuobičajenog saobraćaja

Nijedan sistem nije potpuno bezbedan. Ako dođe do povrede ličnih podataka koja bi za tebe mogla da predstavlja visok rizik, obavestićemo tebe i nadležni nadzorni organ, kako to zahteva zakon.

## 10. Tvoja prava

Prema GDPR-u imaš pravo na:

- **pristup** — potvrdu da li obrađujemo tvoje podatke i primerak tih podataka
- **ispravku** — ispravku netačnih ili dopunu nepotpunih podataka
- **brisanje** — brisanje podataka kada za obradu više nema osnova
- **ograničenje obrade** — u slučajevima koje propisuje zakon
- **prenosivost** — primanje podataka u mašinski čitljivom obliku ili prenos drugom pružaocu
- **prigovor** — na obradu koja se zasniva na legitimnom interesu
- **povlačenje pristanka** — kada se obrada zasniva na pristanku

Ne sprovodimo automatizovano donošenje odluka sa pravnim dejstvom za tebe niti profilisanje u smislu člana 22. GDPR-a.

## 11. Kako da ostvariš prava

Zahtev pošalji na info@memoai.eu sa adrese e-pošte povezane sa tvojim nalogom. Odgovaramo najkasnije u roku od mesec dana; u složenim se slučajevima rok može produžiti za dva meseca, o čemu te obaveštavamo.

Radi provere identiteta možemo da zatražimo dodatne podatke, ali samo u obimu koji je za to potreban.

Ako smatraš da tvoje podatke obrađujemo nezakonito, možeš da podneseš pritužbu Informacionom povereniku Republike Slovenije, Dunajska cesta 22, 1000 Ljubljana, gp.ip@ip-rs.si, kao vodećem nadzornom organu, ili nadzornom organu u državi svog uobičajenog boravišta.

## 12. Kolačići i slične tehnologije

Neophodne kolačiće i lokalnu memoriju koristimo za prijavu, bezbednost, podešavanja i pamćenje tvog izbora analitike. Potrebni su za funkcije koje tražiš.

**U iOS aplikaciji neobavezna analitika podrazumevano je isključena, a na veb-sajtu podrazumevano je uključena.** U Podešavanja → Neobavezna analitika odlučuješ da li dozvoljavaš Memu i Vercelu prikupljanje poseta stranicama, približne lokacije, podataka o uređaju i merenja performansi. Posete mogu biti povezane s tvojim Memo nalogom. Na istom uređaju možeš je isključiti u bilo kom trenutku bez gubitka pristupa aplikaciji.

Neophodni kolačić izbora \`memo-analytics\` traje do 180 dana. Nakon pristanka analitički kolačić \`memo-visit\` traje do 24 sata. Isključivanje analitike uklanja kolačić posete i zaustavlja buduće neobavezno prikupljanje. Istek kolačića ne briše zapise već sačuvane na serveru: zapisi poseta povezani s nalogom uklanjaju se pri brisanju naloga, a njihovo uklanjanje možeš zatražiti i na info@memoai.eu.

Ne koristimo oglašivačke kolačiće ni oglašivačko praćenje između sajtova. Samo na veb-sajtu usluga za greške može pri grešci da sačuva snimak trenutaka pre nje, sa skrivenim celim tekstom, unosima i medijima; iOS aplikacija to nikad ne snima. Neophodna bezbednosna dijagnostika i prijava grešaka nastavljaju da rade nezavisno od neobavezne analitike.

## 13. Deca

Memo AI nije namenjen deci mlađoj od 16 godina. Ako utvrdimo da smo bez odgovarajućeg osnova obradili podatke deteta mlađeg od 16 godina, brišemo ih. Ako si roditelj ili staratelj i smatraš da se to dogodilo, piši nam na info@memoai.eu.

## 14. Tvoje mogućnosti

Ako ne želiš da dođe do obrade opisane u ovoj politici, nemoj taj sadržaj da učitavaš, nalepljuješ, snimaš ni povezuješ u Memo AI. Ako su ti potrebni stroži uslovi u pogledu čuvanja, brisanja ili ugovornih odredbi, obrati nam se pre korišćenja.

## 15. Izmene ove politike

Politiku možemo da ažuriramo kada se proizvod, pružaoci ili zakonodavstvo promene. O bitnim te izmenama obaveštavamo e-poštom ili u aplikaciji.

## 16. Kontakt

info@memoai.eu`,
  },
  "refund-policy": {
    title: "Politika povraćaja",
    content: `# Politika povraćaja

Ova politika objašnjava kada vraćamo uplatu za pretplatu na Memo AI, u kom delu i kako povraćaj zatražiti. Deo je uslova korišćenja.

## 1. Ukratko

**Kupovine u App Storeu:** povraćaj zatraži putem [Applea](https://reportaproblem.apple.com/). Apple obrađuje te zahteve; rokovi i procenti delimičnih povraćaja za veb kupovine navedeni u nastavku ne primenjuju se na transakcije u App Storeu. Tvoja zakonska potrošačka prava ostaju nepromenjena. Za pomoć sa samom uslugom piši na info@memoai.eu.

**Veb kupovine putem Stripea:**

- **zahtev u roku od 24 sata od uplate** — vraćamo 50 % uplaćenog iznosa
- **zahtev nakon 24 sata od uplate** — nema povraćaja
- **otkazivanje pretplate** — bilo kada; pristup ostaje do kraja plaćenog perioda
- **naša greška ili dvostruko zaduženje** — vraćamo u celosti
- **zakonsko pravo potrošača na odustanak** — važi uz ovu politiku i ima prednost nad njom

## 2. Na šta se odnosi

Ova politika odnosi se na pretplate kupljene direktno u Memo AI putem Stripea.

Važi za svaku pojedinačnu uplatu, uključujući automatsko produženje. Rok od 24 sata za svaku se uplatu računa iznova, od trenutka zaduženja.

## 3. Delimičan povraćaj u roku od 24 sata

Ako u roku od **24 sata od trenutka zaduženja** pošalješ zahtev za povraćaj, vraćamo ti **50 % uplaćenog iznosa** za taj period.

- rok počinje da teče u trenutku kada je uplata obračunata
- računa se vreme kada tvoj zahtev stigne na info@memoai.eu
- kada je povraćaj odobren, pretplata se otkazuje, a plaćeni pristup prestaje odmah nakon izvršenja povraćaja
- delimičan povraćaj moguć je jednom po obračunskom periodu

## 4. Nakon 24 sata

Za zahteve poslate **više od 24 sata** nakon zaduženja nema povraćaja.

Pretplatu i dalje možeš da otkažeš bilo kada. U tom se slučaju novi period ne obračunava, a plaćeni pristup ostaje ti do kraja već plaćenog perioda.

## 5. Kada vraćamo ceo iznos

Bez obzira na rokove iz tačaka 3. i 4., vraćamo ceo iznos kada:

- je isti iznos greškom obračunat dvaput
- je uplata obračunata nakon punovažnog otkazivanja pretplate
- je uplata obračunata bez tvog odobrenja i o tome nas obavestiš čim saznaš
- plaćene funkcije zbog greške na našoj strani duže vreme nije bilo moguće koristiti, a grešku nismo otklonili u razumnom roku
- smo ti nalog ukinuli bez tvoje krivice; u tom slučaju vraćamo srazmerni deo za neiskorišćeni period
- to zahteva zakon

## 6. Kada nema povraćaja

- za periode koji su već u celosti istekli
- za besplatni probni period, jer za njega nije bilo uplate
- za promotivne i poklon kodove i popuste; oni se ne isplaćuju u novcu
- kada je nalog ukinut zbog kršenja uslova korišćenja
- kod ponavljajućih zahteva istog korisnika, kada je očigledno da se ova politika zloupotrebljava

Povraćaj ne odbijamo zato što si uslugu koristio. Ako si u periodu za koji tražiš povraćaj napravio sadržaj, to ne utiče na visinu povraćaja prema ovoj politici.

## 7. Kako zatražiti povraćaj

Piši na **info@memoai.eu** sa adrese e-pošte povezane sa tvojim nalogom i navedi:

- datum uplate i iznos
- paket koji si kupio
- da li želiš i otkazivanje pretplate
- kratak razlog, koji nam pomaže da poboljšamo proizvod; razlog nije obavezan

Prijem zahteva potvrđujemo i odgovaramo najkasnije u roku od **5 radnih dana**.

## 8. Izvršenje povraćaja

- povraćaj izvršavamo putem Stripea, na isto sredstvo plaćanja kojim je uplata obavljena
- povraćaj odobravamo najkasnije u roku od **14 dana** od prijema zahteva
- koliko vremena treba da iznos bude vidljiv na tvom računu zavisi od tvoje banke ili izdavaoca kartice; obično 5 do 10 radnih dana
- troškove obrade povraćaja ti ne naplaćujemo

## 9. Otkazivanje pretplate

Otkazivanje i povraćaj nisu isto.

Pretplatu otkazuješ u podešavanjima naloga ili putem linka ka Stripe portalu. Otkazivanje sprečava sledeće obračunavanje, ali ne i povraćaj već uplaćenog iznosa. Za povraćaj moraš da pošalješ zaseban zahtev prema tački 7.

Ako otkažeš pre isteka besplatnog probnog perioda, uplata se ne obračunava.

## 10. Prigovor na zaduženje kod banke

Ako smatraš da je uplata bila pogrešna, prvo piši nama. Većinu slučajeva rešavamo brže nego što traje postupak prigovora kod banke.

Ako prigovor kod banke ili izdavaoca kartice podneseš bez prethodnog kontakta sa nama, možemo privremeno da ograničimo pristup nalogu dok postupak ne bude zaključen.

## 11. Izmene ove politike

Ovu politiku možemo da izmenimo. Za pojedinačnu uplatu uvek važi verzija objavljena na dan te uplate.

## 12. Kontakt

info@memoai.eu`,
  },
  "terms-of-use": {
    title: "Uslovi korišćenja",
    content: `# Uslovi korišćenja

Ovi uslovi su pravno obavezujući ugovor između tebe i operatora usluge Memo AI. Pročitaj ih pre nego što napraviš nalog ili kupiš pretplatu.

## 1. Ko smo

Memo AI je internet usluga dostupna na memoai.eu (u nastavku „Memo AI”, „mi” ili „nas”). Uslugom upravlja:

- **Memo AI, Nace Valenčič s.p., poslovno svetovanje**
- sedište: Zgoša 87, 4275 Begunje na Gorenjskem, Slovenija
- matični broj: 7578474000
- poreski broj: 52958248

Za sva pitanja, zahteve i obaveštenja prema ovim uslovima piši na info@memoai.eu.

## 2. Prihvatanje uslova

Pravljenjem naloga, prijavom ili korišćenjem Memo AI potvrđuješ da si ove uslove pročitao, da ih razumeš i da se sa njima slažeš. Ako se sa njima ne slažeš, nemoj da koristiš Memo AI.

Uz ove uslove važe i:

- politika privatnosti, koja objašnjava kako postupamo sa ličnim podacima
- politika povraćaja, koja uređuje otkazivanja i povraćaje uplata

Ugovor je zaključen na slovenačkom jeziku. Tekst ugovora čuvamo u obliku ovih objavljenih uslova i stalno ti je dostupan na ovoj stranici.

## 3. Ko može da koristi Memo AI

- za korišćenje moraš da imaš najmanje 16 godina
- ako si mlađi od 18 godina, moraš da imaš saglasnost roditelja ili zakonskog zastupnika koji se sa ovim uslovima saglasi u tvoje ime
- nalog je ličan; podatke za prijavu nemoj da deliš i nalog nemoj da prenosiš na drugo lice
- ako Memo AI koristiš u ime škole, firme ili druge organizacije, potvrđuješ da si ovlašćen da tu organizaciju obavežeš ovim uslovima

Memo AI je namenjen ličnom korišćenju za učenje. Za korišćenje u ustanovi ili firmi sa sopstvenim zahtevima u pogledu čuvanja, brisanja ili ugovornih odredbi, obrati nam se pre korišćenja.

## 4. Nalog i bezbednost

- pri registraciji navedi istinite podatke i adresu e-pošte kojoj stvarno pristupaš
- odgovoran si za bezbednost svog poštanskog sandučeta, prijavnih kodova i povezanih Google ili Apple naloga
- za svu aktivnost na svom nalogu odgovaraš sam, osim ako je do nje došlo našom krivicom
- ako sumnjaš na neovlašćen pristup, odmah nas obavesti na info@memoai.eu

## 5. Šta je Memo AI

Memo AI je alat za učenje koji radi sa veštačkom inteligencijom. Iz gradiva koje pošalješ pravi transkripte, sažetke, strukturirane beleške, kartice, kvizove, testove i odgovore u chatu i omogućava izvoz i uređivanje biblioteke beleški.

Memo AI nije:

- zamena za predavanja, stručnu literaturu ili sopstveni rad
- stručni savet bilo koje vrste, posebno ne medicinski, pravni, finansijski, poreski ili bezbednosni
- usluga čuvanja podataka na koju bi smeo da se osloniš kao na jedini primerak svog gradiva

Za sopstvene rezervne kopije važnog gradiva pobrini se sam.

## 6. Besplatno korišćenje i probni period

Probni period u App Storeu važi samo ako ga Apple prikaže u potvrdi kupovine. Veb probni periodi i promotivni kodovi ne primenjuju se automatski na kupovine u App Storeu. Pravila probnog perioda u nastavku opisuju našu veb ponudu.

- bez pretplate možeš da napraviš ograničenu količinu sadržaja, uključujući jednu probnu belešku i ograničen broj poruka u chatu
- pri prvoj kupovini pretplate možeš da dobiješ 3-dnevni besplatni probni period, ako ispunjavaš uslove za njega
- besplatni probni period pripada jednom licu jednom; na njega nemaju pravo korisnici koji su kod nas već imali pretplatu
- ako probni period ne otkažeš pre isteka, pretplata se automatski nastavlja i uplata se obračunava prema važećem cenovniku
- obim besplatnog korišćenja možemo da promenimo ubuduće

## 7. Pretplate, cene i plaćanja

**Pretplate u App Storeu**

Na iOS-u kupovine pretplata u aplikaciji obrađuje Apple. Pre potvrde kupovine Apple prikazuje cenu, valutu, obračunski period i eventualnu ponudu. Pretplata se automatski obnavlja dok je ne otkažeš putem Applea. Apple upravlja naplatom, potvrdama o kupovini i odgovarajućim obaveštenjima o promeni cena. Mesečni i godišnji paket nude iste funkcije Memo Premium za različite obračunske periode. Obnovu kupovina upotrebi dok si prijavljen u Memo nalog korišćen za izvornu kupovinu. Appleove pretplate nije moguće prenositi između Memo naloga.

**Veb pretplate putem Stripea**

- Memo AI se prodaje kao pretplata koja se ponavlja; aktuelne cene i periodi navedeni su na stranici sa cenama i u Stripe Checkoutu pre potvrde kupovine
- sve cene su navedene u evrima; da li je porez uključen ili se dodaje jasno je prikazano pre završetka kupovine
- plaćanja u naše ime obrađuje Stripe; celovite podatke o tvojoj kartici ne primamo i ne čuvamo
- pretplata se automatski produžava na kraju svakog obračunskog perioda dok je ne otkažeš
- uplata za novi period obračunava se na dan produženja sredstvom plaćanja sačuvanim kod Stripea
- ako plaćanje ne uspe, možemo privremeno da ograničimo pristup plaćenim funkcijama dok uplata ne bude izmirena
- promotivni i poklon kodovi važe pod uslovima navedenim uz kod i ne mogu da se zamene za gotovinu
- cene možemo da promenimo; o promeni te obaveštavamo najmanje 30 dana pre njenog stupanja na snagu, a promena važi za sledeći obračunski period. Ako se sa cenom ne slažeš, pretplatu možeš da otkažeš pre stupanja na snagu

Račun za svaku uplatu primaš na adresu e-pošte povezanu sa tvojim nalogom.

## 8. Otkazivanje

Za pretplate u App Storeu upotrebi upravljanje Apple pretplatom u podešavanjima Memo-a ili otvori Podešavanja na iPhoneu → tvoje ime → Pretplate. Otkaži pre datuma obnove; plaćeni pristup obično traje do isteka pretplate. Brisanje Memo-a ili Memo naloga ne otkazuje Appleovu pretplatu. Povraćaj za kupovinu u App Storeu zatraži putem [Applea](https://reportaproblem.apple.com/).

**Veb pretplate putem Stripea:**

Pretplatu možeš da otkažeš bilo kada u podešavanjima naloga ili putem linka ka Stripe portalu. Otkazivanje stupa na snagu na kraju tekućeg plaćenog perioda; do tada plaćene funkcije ostaju dostupne. Otkazivanje samo po sebi ne znači povraćaj već uplaćenog iznosa.

Povraćaje uređuje politika povraćaja.

## 9. Tvoje odgovornosti

- učitavati, snimati, nalepljivati ili povezivati smeš samo gradivo koje posjeduješ ili koje smeš da koristiš
- odgovoran si za zakonitost i tačnost sadržaja koji pošalješ
- moraš da poštuješ pravila svoje škole, fakulteta ili poslodavca u pogledu snimanja i deljenja gradiva
- rezultate koje napravi Memo AI moraš da proveriš pre korišćenja

## 10. Dozvole za snimanje i gradiva

Korišćenjem Memo AI potvrđuješ da pre snimanja, učitavanja, nalepljivanja ili povezivanja sadržaja imaš sve potrebne dozvole i prava. To uključuje dozvole škole, nastavnika, predavača, ustanove, poslodavca, učesnika snimanja ili drugih nosilaca prava, kada su takve dozvole potrebne.

Nemoj da snimaš predavanja, razgovore ili druga lica i nemoj da učitavaš prezentacije, beleške, nastavne materijale, dokumente ili druge datoteke ako za to nemaš dozvolu odnosno zakonski osnov. Odgovoran si da tvoje korišćenje Memo AI ne krši pravila škole, ugovorna ograničenja, autorska prava, privatnost, pravila o snimanju ili druge važeće zakone i pravila.

U Memo AI nemoj da učitavaš posebne kategorije ličnih podataka drugih ljudi, na primer zdravstvene podatke ili podatke o veroispovesti, političkom uverenju ili seksualnoj orijentaciji, osim ako za to imaš važeći pravni osnov.

## 11. Zabranjeno korišćenje

Memo AI ne smeš da koristiš kako bi:

- učitavao zlonamerni softver ili pokušavao da ugroziš bezbednost usluge
- pristupao delovima usluge, nalozima ili podacima na koje nemaš pravo
- zaobišao ograničenja količine, naplatni zid, probna ograničenja ili tehničke zaštite
- uslugu automatski prikupljao, obrnuto inženjerio ili sprovodio testove opterećenja bez naše pisane dozvole
- pravio ili širio nezakonit, uvredljiv, obmanjujući ili nasilan sadržaj
- zadirao u prava drugih, uključujući autorska prava i pravo na privatnost
- uslugu preprodavao, iznajmljivao ili je nudio kao sopstvenu
- kršio akademska pravila o poštenju ili predavao napravljeni sadržaj kao sopstveni rad kada to nije dozvoljeno
- koristio Memo AI za automatsku masovnu obradu gradiva koje nije povezano sa sopstvenim studijem

## 12. Tvoj sadržaj

Gradivo koje pošalješ u Memo AI ostaje tvoje. Radi rada usluge dodeljuješ nam neisključivo, vremenski ograničeno i prostorno neograničeno pravo da to gradivo sačuvamo, prikažemo, obradimo i prosledimo našim pružaocima obrade isključivo zato da bismo mogli da izvedemo funkcije koje zatražiš.

To pravo prestaje kada sadržaj obrišeš ili kada obrišemo tvoj nalog, osim kada podatke moramo još da čuvamo zbog zakonskih obaveza.

Tvoj sadržaj ne prodajemo i ne koristimo ga za oglašavanje.

## 13. Naša prava

Memo AI, njegov softver, dizajn, žig i sadržaj koji nije tvoj vlasništvo su nas ili naših davalaca licenci. Zaključivanjem pretplate dobijaš lično, neprenosivo i neisključivo pravo korišćenja usluge u skladu sa ovim uslovima, ali ne i vlasništvo nad njom.

## 14. AI obrada i ograničenja rezultata

Za transkripte, sažetke, kartice, kvizove, odgovore u chatu i izdvajanje sadržaja iz dokumenata Memo AI može tvoj sadržaj da obradi kod spoljnih AI i infrastrukturnih pružalaca.

To može da uključuje:

- audiosnimke i učitane zvučne datoteke
- nalepljeni tekst i beleške
- PDF-ove i druge podržane dokumente
- javne veb-linkove za koje želiš da ih Memo AI pročita
- metapodatke potrebne za rad, bezbednost i poboljšavanje usluge

Spisak pružalaca i osnovi za obradu navedeni su u politici privatnosti.

Memo AI može da napravi greške, nepotpune odgovore ili obmanjujuće gradivo za učenje. Pre nego što se osloniš na rezultate kod ispita, seminarskih radova, medicinskih, pravnih, finansijskih, usklađenosnih ili bezbednosno kritičnih odluka, moraš sam da ih proveriš.

## 15. Dostupnost i izmene usluge

Nastojimo da obezbedimo neometan rad, ali ne obećavamo neprekinutu dostupnost. Usluga može biti privremeno nedostupna zbog održavanja, grešaka, ažuriranja ili smetnji kod spoljnih pružalaca.

Pojedine funkcije možemo da menjamo, dodajemo ili ukidamo. Ako bi promena za plaćene korisnike bila bitno nepovoljna, o njoj te obaveštavamo unapred, a ti pretplatu možeš da otkažeš.

## 16. Postupanje i prekid naloga

Pristup možemo privremeno da ograničimo, onemogućimo određene funkcije ili uklonimo sadržaj kada korišćenje izgleda zloupotrebno, nezakonito, opasno ili štetno za uslugu ili druge korisnike.

Kod težih ili ponavljajućih kršenja nalog možemo da ukinemo. Kada je to izvodljivo i dozvoljeno, o razlogu te obaveštavamo i dajemo ti mogućnost da postupak objasniš ili otkloniš. Ako nalog ukinemo bez tvoje krivice, vraćamo ti srazmerni deo unapred plaćene pretplate.

Svoj nalog možeš da ukineš bilo kada tako da nam pišeš na info@memoai.eu.

## 17. Garancije

Usluga je dostupna takva kakva jeste. U obimu koji dozvoljava zakon ne dajemo garancije da će usluga biti bez grešaka, neprekinuta ili prikladna za tačno određenu svrhu, i ne garantujemo za tačnost rezultata koje napravi AI.

To ne dira u obavezne garancije koje ti kao potrošaču pripadaju prema slovenačkom i evropskom pravu.

## 18. Ograničenje odgovornosti

U obimu koji dozvoljava zakon ne odgovaramo za:

- izgubljenu dobit, izgubljenu priliku, gubitak podataka ili posrednu štetu
- posledice odluka koje si doneo na osnovu neprovjerenih rezultata AI-ja
- postupanje trećih lica ili prekid njihovih usluga
- štetu nastalu zbog tvog kršenja ovih uslova

Naša ukupna odgovornost po pojedinačnom zahtevu ograničena je na iznos koji si nam platio u 12 meseci pre događaja koji je prouzrokovao štetu.

Ništa u ovim uslovima ne isključuje i ne ograničava odgovornost za nameru, krajnju nepažnju, smrt ili telesnu povredu, kao ni odgovornost koju prema zakonu nije moguće isključiti. Ako si potrošač, u celosti ti ostaju dostupna sva prava prema propisima o zaštiti potrošača.

## 19. Tvoja odgovornost za naknadu štete

Ako zbog tvog kršenja ovih uslova ili zbog gradiva koje si poslao bez odgovarajućih prava treće lice protiv nas podnese zahtev, nadoknađuješ nam opravdane troškove koji nam pritom nastanu. To važi samo u obimu u kojem je zahtev posledica tvog postupanja.

## 20. Izmene uslova

Ove uslove možemo da izmenimo kada se proizvod, zakonodavstvo ili pružaoci promene.

- o bitnim te izmenama obaveštavamo e-poštom ili u aplikaciji najmanje 30 dana pre stupanja na snagu
- manje ispravke koje ne diraju u tvoja prava objavljujemo direktno na ovoj stranici
- ako nakon stupanja na snagu nastaviš sa korišćenjem, to znači da prihvataš ažuriranu verziju
- ako se sa izmenom ne slažeš, pre njenog stupanja na snagu možeš da otkažeš pretplatu

## 21. Prestanak

Prestankom ugovora prestaje tvoje pravo korišćenja usluge. Sa sadržajem povezanim sa tvojim nalogom postupa se u skladu sa politikom privatnosti. Odredbe o intelektualnoj svojini, ograničenju odgovornosti, naknadi štete i rešavanju sporova važe i nakon prestanka.

## 22. Merodavno pravo i rešavanje sporova

Za ove uslove važi pravo Republike Slovenije, bez primene kolizionih pravila. Ako si potrošač sa prebivalištem u drugoj državi, taj te izbor ne lišava zaštite koju ti jemče prinudni propisi tvoje države.

Sporove najpre pokušavamo da rešimo sporazumno; piši nam na info@memoai.eu i odgovorićemo ti u razumnom roku.

Kao potrošač možeš da koristiš i:

- postupak vansudskog rešavanja potrošačkih sporova, kada je dostupan. Trenutno ne priznajemo nijednog sprovodioca vansudskog rešavanja potrošačkih sporova kao nadležnog za sporove iz ovih uslova
- pritužbu Tržišnom inspektoratu Republike Slovenije

Za sporove koje nije moguće rešiti sporazumno nadležan je stvarno nadležni sud u Republici Sloveniji. Ako si potrošač, to ne dira u tvoje pravo da tužbu podneseš sudu u mestu svog prebivališta.

## 23. Završne odredbe

- ako je pojedina odredba ovih uslova nevažeća, ostale odredbe ostaju na snazi
- ove uslove ne možeš da preneseš na drugo lice bez naše saglasnosti; mi ih možemo preneti kod statusne promene ili prodaje delatnosti, pri čemu se tvoja prava ne pogoršavaju
- ako neko pravo ne ostvarimo odmah, time ga se ne odričemo
- ovi uslovi zajedno sa politikom privatnosti i politikom povraćaja čine celokupan dogovor između tebe i nas o korišćenju Memo AI

## 24. Kontakt

info@memoai.eu

---

**Zakonsko pravo potrošača na odustanak.** Ako si potrošač sa prebivalištem u EU ili EEP, prema zakonu imaš pravo da u roku od 14 dana od zaključenja pretplatničkog ugovora od njega odustaneš, bez navođenja razloga. Budući da se usluga na tvoj izričit zahtev počinje pružati odmah nakon kupovine, pri kupovini izričito zahtevaš da pružanje počne pre isteka roka za odustanak; ako tokom roka za odustanak odustaneš, vraćamo ti uplaćeni iznos umanjen za srazmerni deo koji odgovara usluzi pruženoj do dana odustanka. To zakonsko pravo važi uz politiku povraćaja: ako ti zakon u konkretnom slučaju daje veći povraćaj nego što ga predviđa politika povraćaja, važi zakon. Za odustanak je dovoljna jasna izjava e-poštom na info@memoai.eu, a možeš da upotrebiš i obrazac za odustanak iz priloga slovenačkom Zakonu o zaštiti potrošača. Ništa u ovim uslovima ni u politici povraćaja ne ograničava prava koja ti kao potrošaču pripadaju prema prinudnim propisima.`,
  },
};
