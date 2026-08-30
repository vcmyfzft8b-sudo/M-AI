export type HelpArticle = {
  slug: string;
  title: string;
  category: "Pogosto" | "Snemanje in zapiski" | "Račun in dostop";
  content: string;
};

export const HELP_ARTICLES: HelpArticle[] = [
  {
    slug: "family-plan",
    title: "Družinski paket?",
    category: "Pogosto",
    content: `# Družinski paket

Skupni družinski delovni prostor še ni podprt.

Za zdaj ima vsak račun svojo knjižnico zapiskov in zgodovino obdelav.

## Kaj lahko narediš zdaj

- prijavi se z računom, ki naj bo lastnik zapiskov
- zapiske po potrebi kopiraj iz prikaza zapiska
- za bolj dosledne rezultate nalagaj gradivo istega predmeta v isti račun`,
  },
  {
    slug: "gift-coconote",
    title: "Ali lahko podarim Memo?",
    category: "Pogosto",
    content: `# Podarjanje dostopa

Če imaš promocijsko ali darilno kodo, jo lahko prejemnik uporabi v Stripe Checkout pred zaključkom nakupa.

Za uporabo Memo naj si prejemnik ustvari svoj račun, nato pa pri plačilu v Stripe vnese kodo in preveri, da se popust prikaže pred potrditvijo plačila.`,
  },
  {
    slug: "supported-language",
    title: "Ali podpirate moj jezik?",
    category: "Pogosto",
    content: `# Podprti jeziki

Jezika ni treba nastavljati. Memo AI prebere gradivo in zapiske, kartice in kvize napiše v jeziku, v katerem je gradivo samo.

## Priporočila

- gradivo naloži takšno, kot je — prevajanje vnaprej ni potrebno
- pri mešanju jezikov pomagajo krajši posnetki
- tehnični angleški izrazi lahko ostanejo v končnem rezultatu, kadar so del izvorne vsebine`,
  },
  {
    slug: "feature-request",
    title: "Predlog funkcije",
    category: "Pogosto",
    content: `# Predlagaj izboljšavo

Najbolj uporaben predlog je kratek in konkreten opis tvojega načina uporabe.

Koristno je vključiti:

- kaj si želel doseči
- kje si se zataknil
- kakšen rezultat si pričakoval
- ali gre za težavo pri zvoku, besedilu, PDF-ju ali povezavi`,
  },
  {
    slug: "video-isnt-working",
    title: "Video povezava ne deluje",
    category: "Snemanje in zapiski",
    content: `# Težave z video povezavo

Memo lahko obdela samo vsebino, ki je javno dostopna in dovolj berljiva za povzemanje.

## Poskusi to

- preveri, da stran ne zahteva prijave
- uporabi neposreden URL strani
- če imaš gradivo drugje, naloži PDF ali prilepi besedilo`,
  },
  {
    slug: "audio-upload-issue",
    title: "Ne morem naložiti zvoka",
    category: "Snemanje in zapiski",
    content: `# Težave pri nalaganju zvoka

Podprti formati so MP3, M4A, WAV, OGG in WEBM.

## Kontrolni seznam

- preveri, da datoteka ni poškodovana
- ostani pod trenutno omejitvijo velikosti
- če je zvok nastal s snemanjem zaslona, ga ponovno izvozi
- če se je nalaganje prej ustavilo, poskusi znova z domače strani`,
  },
  {
    slug: "transcript-cut-short",
    title: "Prepis je prekratek ali netočen",
    category: "Snemanje in zapiski",
    content: `# Kakovost prepisa

Kakovost prepisa je odvisna od čistosti zvoka in prekrivanja govorcev. Jezik prepozna Memo AI sam.

## Kako izboljšati rezultate

- posnemi čim bližje govorcu
- pri pogovorih omogoči zajem več govorcev
- zmanjša ozadni hrup
- zelo dolge posnetke razdeli na manjše dele`,
  },
  {
    slug: "redeem-code",
    title: "Unovči kodo",
    category: "Račun in dostop",
    content: `# Unovčenje kode

Promocijsko ali darilno kodo lahko uporabiš v Stripe Checkout pred zaključkom nakupa.

## Kako vneseš kodo

- v nastavitvah izberi možnost za nakup ali nadgradnjo
- v Stripe plačilnem obrazcu odpri polje za promocijsko kodo
- vnesi kodo in potrdi, da se popust prikaže pred plačilom

Če se polje ne prikaže ali koda ni sprejeta, preveri, ali je koda še veljavna in ali je namenjena izbranemu paketu.`,
  },
  {
    slug: "privacy-policy",
    title: "Politika zasebnosti",
    category: "Račun in dostop",
    content: `# Politika zasebnosti

Ta politika pojasnjuje, katere osebne podatke obdelujemo, zakaj jih obdelujemo, komu jih posredujemo, kako dolgo jih hranimo in katere pravice imaš. Velja za spletno mesto memoai.eu in za aplikacijo Memo AI.

## 1. Upravljavec podatkov

Upravljavec tvojih osebnih podatkov je ponudnik storitve Memo AI, dostopne na memoai.eu.

Kontakt za vprašanja o zasebnosti in za uveljavljanje pravic: info@memoai.eu

## 2. Katere podatke obdelujemo

**Podatki o računu**

- e-naslov
- identifikator uporabnika in avtentikacijski podatki
- podatki, ki jih posreduje Google ali Apple, če se prijaviš prek njiju: e-naslov, ime in identifikator računa
- ime, če ga vpišeš

**Podatki iz uvodne nastavitve**

- odgovori v uvodnem vprašalniku, na primer študijsko področje, način uporabe in razlog za uporabo

**Vsebina, ki jo pošlješ**

- zvočni posnetki, ustvarjeni v aplikaciji, in naložene zvočne datoteke
- prilepljeno besedilo, ročni zapiski in pozivi
- PDF-ji, dokumenti in slike, ki jih naložiš ali skeniraš
- javne spletne povezave, za katere želiš, da jih Memo AI prebere
- sporočila v klepetu z zapiski

**Podatki, ki nastanejo pri uporabi**

- prepisi, povzetki, zapiski, kartice, kvizi, testi in odgovori v klepetu, ustvarjeni iz tvojega gradiva
- struktura knjižnice, mape, oznake napredka in zgodovina obdelav
- stanje opravil v ozadju in dnevniki napak

**Plačilni podatki**

- stanje naročnine, izbrani paket, obdobje in zgodovina plačil
- identifikator stranke in naročnine pri Stripe

Podatkov o tvoji plačilni kartici ne prejmemo in ne hranimo. Vnašaš jih neposredno pri Stripe.

**Tehnični podatki**

- IP-naslov, vrsta naprave, brskalnik in operacijski sistem
- časi dostopa, zahtevki in odzivi strežnika
- podatki o napakah in zrušitvah
- agregirani podatki o obisku strani

## 3. Nameni obdelave in pravne podlage

**Izvajanje pogodbe (člen 6(1)(b) GDPR)**

- ustvarjanje in vodenje računa ter prijava
- shranjevanje in urejanje tvoje knjižnice zapiskov
- prepisovanje, analiza in obdelava gradiva, ki ga pošlješ
- ustvarjanje povzetkov, zapiskov, kartic, kvizov, testov in odgovorov v klepetu
- obračun naročnine, obdelava plačil in vračil
- podpora uporabnikom

**Zakonita obveznost (člen 6(1)(c) GDPR)**

- izdaja in hramba računov ter druge davčne in računovodske obveznosti
- odgovori na zahtevke pristojnih organov

**Zakoniti interes (člen 6(1)(f) GDPR)**

- varnost storitve, preprečevanje zlorab, omejevanje števila zahtevkov in odkrivanje goljufij
- odpravljanje napak in izboljševanje zanesljivosti izdelka
- agregirana statistika uporabe, iz katere ni mogoče prepoznati posameznika
- uveljavljanje ali obramba pravnih zahtevkov

Pri obdelavi na podlagi zakonitega interesa smo pretehtali svoj interes in tvoje pravice. Zoper tako obdelavo lahko kadar koli ugovarjaš.

**Privolitev (člen 6(1)(a) GDPR)**

- neobvezna sporočila o izdelku, kadar se nanje prijaviš
- neobvezni piškotki ali podobne tehnologije, kadar so v uporabi

Privolitev lahko kadar koli prekličeš. Preklic ne vpliva na zakonitost obdelave pred preklicem.

## 4. Posebne vrste osebnih podatkov

Memo AI ni namenjen obdelavi posebnih vrst osebnih podatkov, na primer zdravstvenih podatkov, biometričnih podatkov ali podatkov o veroizpovedi, političnem prepričanju ali spolni usmerjenosti.

Če takšno gradivo vseeno naložiš, to počneš na lastno odgovornost in moraš imeti zanj veljavno pravno podlago. Odsvetujemo nalaganje takšnega gradiva o drugih osebah.

## 5. Dovoljenja za snemanje in gradiva

Z uporabo Memo AI potrjuješ, da imaš vsa potrebna dovoljenja in pravice za snemanje, nalaganje, lepljenje ali povezovanje vsebine, ki jo pošlješ v aplikacijo. To vključuje dovoljenja šole, učitelja, predavatelja, ustanove, delodajalca, udeležencev snemanja ali drugih imetnikov pravic, kadar so taka dovoljenja potrebna.

V Memo AI ne nalagaj posnetkov predavanj, prosojnic, učnih gradiv, dokumentov ali druge vsebine, če za to nimaš dovoljenja oziroma zakonske podlage.

Kadar v gradivu nastopajo drugi ljudje, si glede njihovih osebnih podatkov ti tisti, ki odloča o obdelavi, mi pa gradivo obdelujemo po tvojem naročilu.

## 6. Komu podatke posredujemo

Podatkov ne prodajamo. Posredujemo jih le ponudnikom, ki jih potrebujemo za delovanje storitve, in sicer v obsegu, potrebnem za posamezno funkcijo. Z njimi imamo sklenjene pogodbe o obdelavi podatkov.

- **Supabase** — avtentikacija, baza podatkov in shramba datotek
- **Stripe** — obdelava plačil, naročnin in vračil
- **Google (Gemini)** — prepisovanje, izluščanje besedila iz dokumentov, embeddingi, ustvarjanje zapiskov in odgovorov v klepetu
- **Soniox** — prepisovanje zvočnih posnetkov, kadar je ta storitev vklopljena
- **Vercel** — gostovanje aplikacije in agregirana statistika obiska
- **Inngest** — izvajanje opravil v ozadju, kadar je vklopljen
- **Sentry** — spremljanje napak in zrušitev
- **Google in Apple** — prijava, kadar izbereš prijavo prek njiju

Podatke lahko razkrijemo tudi pristojnim organom, kadar smo k temu zakonsko zavezani, in svojim pravnim ali računovodskim svetovalcem, kadar je to potrebno.

Če bi prišlo do statusne spremembe ali prodaje dejavnosti, se lahko podatki prenesejo na prevzemnika, pri čemer ta politika velja naprej, dokler te o spremembi ne obvestimo.

## 7. Prenosi izven EU in EGP

Nekateri ponudniki obdelujejo podatke tudi izven Evropskega gospodarskega prostora, zlasti v Združenih državah Amerike.

V takih primerih se prenos opravi na podlagi:

- sklepa Evropske komisije o ustreznosti, kadar ta obstaja, ali
- standardnih pogodbenih klavzul Evropske komisije skupaj z dodatnimi zaščitnimi ukrepi

Kopijo uporabljenih zaščitnih ukrepov lahko zahtevaš na info@memoai.eu.

## 8. Kako dolgo hranimo podatke

- **podatki o računu** — dokler obstaja tvoj račun, nato do 30 dni po izbrisu
- **vsebina in ustvarjeni zapiski** — dokler jih ne izbrišeš ali dokler ne izbrišeš računa; iz varnostnih kopij se odstranijo najpozneje v 30 dneh
- **podatki o plačilih in računi** — 10 let, kolikor zahteva davčna zakonodaja
- **dnevniki napak in varnostni dnevniki** — do 12 mesecev
- **korespondenca s podporo** — do 24 mesecev po zaključku zadeve
- **podatki, potrebni za pravne zahtevke** — do zastaranja zahtevka

Vsebina ostane povezana s tvojim računom, dokler je ne izbrišeš v aplikaciji ali dokler je ne odstranimo prek podpore ali rednega čiščenja.

## 9. Varnost

Uporabljamo tehnične in organizacijske ukrepe, primerne tveganju, med drugim:

- šifriranje prenosa podatkov
- ločevanje dostopa do podatkov na ravni baze, tako da do svojih zapiskov dostopaš samo ti
- omejen in beležen dostop zaposlenih na primere, ko je to nujno
- spremljanje napak in nenavadnega prometa

Noben sistem ni popolnoma varen. Če pride do kršitve varnosti osebnih podatkov, ki bi lahko povzročila veliko tveganje zate, te o tem obvestimo in obvestimo tudi Informacijskega pooblaščenca, kot to zahteva zakon.

## 10. Tvoje pravice

Po GDPR imaš pravico do:

- **dostopa** — potrditve, ali obdelujemo tvoje podatke, in kopije teh podatkov
- **popravka** — popravka netočnih ali dopolnitve nepopolnih podatkov
- **izbrisa** — izbrisa podatkov, kadar za obdelavo ni več podlage
- **omejitve obdelave** — v primerih, ki jih določa zakon
- **prenosljivosti** — prejema podatkov v strojno berljivi obliki ali prenosa k drugemu ponudniku
- **ugovora** — zoper obdelavo, ki temelji na zakonitem interesu
- **preklica privolitve** — kadar obdelava temelji na privolitvi

Ne izvajamo avtomatiziranega sprejemanja odločitev s pravnimi učinki zate niti oblikovanja profilov v smislu člena 22 GDPR.

## 11. Kako uveljaviš pravice

Zahtevo pošlji na info@memoai.eu z e-naslova, povezanega s tvojim računom. Odgovorimo najpozneje v enem mesecu; v zahtevnih primerih se rok lahko podaljša za dva meseca, o čemer te obvestimo.

Za preverjanje istovetnosti lahko zahtevamo dodatne podatke, vendar le v obsegu, ki je za to potreben.

Če meniš, da tvoje podatke obdelujemo nezakonito, lahko vložiš pritožbo pri Informacijskem pooblaščencu Republike Slovenije, Dunajska cesta 22, 1000 Ljubljana, gp.ip@ip-rs.si.

## 12. Piškotki in podobne tehnologije

Uporabljamo:

- **nujne piškotke in lokalno shrambo** — za prijavo, ohranjanje seje, varnost in osnovne nastavitve. Ti so potrebni za delovanje storitve in jih ni mogoče izklopiti
- **statistiko obiska** — agregirane in neosebne meritve obiska strani prek Vercel Analytics

Oglaševalskih piškotkov in sledenja med spletnimi mesti ne uporabljamo. Če bi v prihodnje uvedli neobvezne piškotke, bomo zanje pridobili tvojo privolitev.

## 13. Otroci

Memo AI ni namenjen otrokom, mlajšim od 16 let. Če ugotovimo, da smo brez ustrezne podlage obdelali podatke otroka, mlajšega od 16 let, jih izbrišemo. Če si starš ali skrbnik in meniš, da se je to zgodilo, nam piši na info@memoai.eu.

## 14. Tvoje možnosti

Če ne želiš, da pride do obdelave, opisane v tej politiki, te vsebine v Memo AI ne nalagaj, ne lepi, ne snemaj in ne poveži. Če potrebuješ strožje pogoje glede hrambe, brisanja ali pogodbenih določil, se pred uporabo obrni na nas.

## 15. Spremembe te politike

Politiko lahko posodobimo, ko se izdelek, ponudniki ali zakonodaja spremenijo. O bistvenih spremembah te obvestimo po e-pošti ali v aplikaciji.

## 16. Kontakt

info@memoai.eu
`,
  },
  {
    slug: "refund-policy",
    title: "Politika vračil",
    category: "Račun in dostop",
    content: `# Politika vračil

Ta politika pojasnjuje, kdaj vrnemo plačilo za naročnino Memo AI, v kakšnem deležu in kako vračilo zahtevaš. Je del pogojev uporabe.

## 1. Na kratko

- **zahteva v 5 dneh od plačila** — vrnemo 50 % plačanega zneska
- **zahteva po 5 dneh od plačila** — vračila ni
- **preklic naročnine** — kadar koli; dostop ostane do konca plačanega obdobja
- **naša napaka ali dvojna bremenitev** — vrnemo v celoti
- **zakonska pravica potrošnika do odstopa** — velja poleg te politike in ima prednost pred njo

## 2. Za kaj velja

Ta politika velja za naročnine, kupljene neposredno v Memo AI prek Stripe.

Velja za vsako posamezno plačilo, tudi za samodejno podaljšanje. Rok 5 dni se za vsako plačilo šteje znova, od datuma bremenitve.

## 3. Delno vračilo v 5 dneh

Če v **5 koledarskih dneh od dneva bremenitve** pošlješ zahtevo za vračilo, ti vrnemo **50 % plačanega zneska** za to obdobje.

- rok začne teči na dan, ko je bilo plačilo obračunano
- šteje datum, ko tvoja zahteva prispe na info@memoai.eu
- ob odobrenem vračilu se naročnina prekliče, plačljivi dostop pa preneha takoj po izvedbi vračila
- delno vračilo je mogoče enkrat na obračunsko obdobje

## 4. Po 5 dneh

Za zahteve, poslane **po izteku 5 koledarskih dni** od bremenitve, vračila ni.

Naročnino lahko še vedno kadar koli prekličeš. V tem primeru se ne obračuna novo obdobje, plačljivi dostop pa ti ostane do konca že plačanega obdobja.

## 5. Kdaj vrnemo celoten znesek

Ne glede na rok iz 3. in 4. točke vrnemo celoten znesek, kadar:

- je bil isti znesek pomotoma obračunan dvakrat
- je bilo plačilo obračunano po veljavnem preklicu naročnine
- je bilo plačilo obračunano brez tvojega dovoljenja in nam to sporočiš takoj, ko za to izveš
- plačljivih funkcij zaradi napake na naši strani daljše obdobje ni bilo mogoče uporabljati in napake nismo odpravili v razumnem roku
- smo ti račun ukinili brez tvoje krivde; v tem primeru vrnemo sorazmerni del za neizrabljeno obdobje
- to zahteva zakon

## 6. Kdaj vračila ni

- za obdobja, ki so se že v celoti iztekla
- za brezplačno preizkusno obdobje, ker zanj ni bilo plačila
- za promocijske in darilne kode ter popuste; ti se ne izplačujejo v denarju
- kadar je bil račun ukinjen zaradi kršitve pogojev uporabe
- pri ponavljajočih se zahtevah istega uporabnika, kadar je očitno, da gre za zlorabo te politike

Vračila ne zavrnemo zato, ker si storitev uporabljal. Če si v obdobju, za katero zahtevaš vračilo, ustvaril vsebino, to na višino vračila po tej politiki ne vpliva.

## 7. Kako zahtevaš vračilo

Piši na **info@memoai.eu** z e-naslova, povezanega s tvojim računom, in navedi:

- datum plačila in znesek
- paket, ki si ga kupil
- ali želiš tudi preklic naročnine
- kratek razlog, ki nam pomaga izboljšati izdelek; razloga ni treba navesti

Prejem zahteve potrdimo in ti odgovorimo najpozneje v **5 delovnih dneh**.

## 8. Izvedba vračila

- vračilo izvedemo prek Stripe, na isto plačilno sredstvo, s katerim je bilo opravljeno plačilo
- vračilo odobrimo najpozneje v **14 dneh** od prejema zahteve
- koliko časa traja, da je znesek viden na tvojem računu, je odvisno od tvoje banke ali izdajatelja kartice; običajno 5 do 10 delovnih dni
- stroškov obdelave vračila ti ne zaračunamo

## 9. Preklic naročnine

Preklic in vračilo nista isto.

Naročnino prekličeš v nastavitvah računa ali prek povezave do Stripe portala. Preklic prepreči naslednje obračunavanje, ne pa vračila že plačanega zneska. Za vračilo moraš poslati ločeno zahtevo po 7. točki.

Če prekličeš pred iztekom brezplačnega preizkusnega obdobja, plačilo ni obračunano.

## 10. Ugovor bremenitve pri banki

Če meniš, da je bilo plačilo napačno, nam najprej piši. Večino primerov rešimo hitreje kot postopek ugovora pri banki.

Če ugovor pri banki ali izdajatelju kartice vložiš, ne da bi nas prej kontaktiral, lahko dostop do računa začasno omejimo, dokler postopek ni zaključen.

## 11. Spremembe te politike

To politiko lahko spremenimo. Za posamezno plačilo vedno velja različica, objavljena na dan tega plačila.

## 12. Kontakt

info@memoai.eu
`,
  },
  {
    slug: "terms-of-use",
    title: "Pogoji uporabe",
    category: "Račun in dostop",
    content: `# Pogoji uporabe

Ti pogoji so pravno zavezujoča pogodba med tabo in upravljavcem storitve Memo AI. Preberi jih, preden ustvariš račun ali kupiš naročnino.

## 1. Kdo smo

Memo AI je spletna storitev, dostopna na memoai.eu (v nadaljevanju »Memo AI«, »mi« ali »nas«).

Za vsa vprašanja, zahtevke in obvestila po teh pogojih piši na info@memoai.eu.

## 2. Sprejem pogojev

Z ustvarjanjem računa, prijavo ali uporabo Memo AI potrjuješ, da si te pogoje prebral, jih razumeš in se z njimi strinjaš. Če se z njimi ne strinjaš, Memo AI ne uporabljaj.

Skupaj s temi pogoji veljata tudi:

- politika zasebnosti, ki pojasnjuje, kako ravnamo z osebnimi podatki
- politika vračil, ki ureja preklice in vračila plačil

Pogodba je sklenjena v slovenskem jeziku. Besedilo pogodbe hranimo v obliki teh objavljenih pogojev in ti je ves čas dostopno na tej strani.

## 3. Kdo lahko uporablja Memo AI

- za uporabo moraš biti star najmanj 16 let
- če si mlajši od 18 let, moraš imeti soglasje starša ali zakonitega zastopnika, ki s temi pogoji soglaša v tvojem imenu
- račun je oseben; podatkov za prijavo ne deli in računa ne prenašaj na drugo osebo
- če Memo AI uporabljaš v imenu šole, podjetja ali druge organizacije, potrjuješ, da imaš pooblastilo, da to organizacijo zavežeš s temi pogoji

Memo AI je namenjen osebni študijski uporabi. Za uporabo v ustanovi ali podjetju z lastnimi zahtevami glede hrambe, brisanja ali pogodbenih določil se pred uporabo obrni na nas.

## 4. Račun in varnost

- ob registraciji navedi resnične podatke in e-naslov, do katerega dejansko dostopaš
- odgovoren si za varnost svojega e-predala, prijavnih kod in povezanih računov Google ali Apple
- za vso dejavnost na svojem računu odgovarjaš sam, razen če je do nje prišlo po naši krivdi
- če sumiš na nepooblaščen dostop, nas nemudoma obvesti na info@memoai.eu

## 5. Kaj Memo AI je

Memo AI je učno orodje, ki deluje z umetno inteligenco. Iz gradiva, ki ga pošlješ, ustvarja prepise, povzetke, strukturirane zapiske, kartice, kvize, teste in odgovore v klepetu ter omogoča izvoz in urejanje knjižnice zapiskov.

Memo AI ni:

- nadomestilo za predavanja, študijsko literaturo ali lastno delo
- strokovni nasvet katere koli vrste, zlasti ne medicinski, pravni, finančni, davčni ali varnostni
- storitev hrambe podatkov, na katero bi se smel zanašati kot na edini izvod svojega gradiva

Za lastne varnostne kopije pomembnega gradiva poskrbi sam.

## 6. Brezplačna uporaba in preizkusno obdobje

- brez naročnine lahko ustvariš omejeno količino vsebine, vključno z enim preizkusnim zapiskom in omejenim številom sporočil v klepetu
- ob prvem nakupu naročnine lahko dobiš 3-dnevno brezplačno preizkusno obdobje, če izpolnjuješ pogoje zanj
- brezplačno preizkusno obdobje pripada eni osebi enkrat; do njega niso upravičeni uporabniki, ki so pri nas že imeli naročnino
- če preizkusnega obdobja ne prekličeš pred iztekom, se naročnina samodejno nadaljuje in plačilo se obračuna po veljavnem ceniku
- obseg brezplačne uporabe lahko spremenimo za naprej

## 7. Naročnine, cene in plačila

- Memo AI se prodaja kot ponavljajoča se naročnina; aktualne cene in obdobja so navedeni na strani s cenami in v Stripe Checkout pred potrditvijo nakupa
- vse cene so navedene v evrih; ali je davek vključen ali se prišteje, je jasno prikazano pred zaključkom nakupa
- plačila v našem imenu obdeluje Stripe; celotnih podatkov o tvoji kartici ne prejmemo in ne hranimo
- naročnina se samodejno podaljšuje ob koncu vsakega obračunskega obdobja, dokler je ne prekličeš
- plačilo za novo obdobje se obračuna na dan podaljšanja s plačilnim sredstvom, shranjenim pri Stripe
- če plačilo ne uspe, lahko dostop do plačljivih funkcij začasno omejimo, dokler plačilo ni poravnano
- promocijske in darilne kode veljajo pod pogoji, navedenimi ob kodi, in jih ni mogoče zamenjati za gotovino
- cene lahko spremenimo; o spremembi te obvestimo najmanj 30 dni pred njeno uveljavitvijo, sprememba pa velja za naslednje obračunsko obdobje. Če se s ceno ne strinjaš, lahko naročnino prekličeš pred uveljavitvijo

Račun za vsako plačilo prejmeš na e-naslov, povezan s tvojim računom.

## 8. Preklic

Naročnino lahko kadar koli prekličeš v nastavitvah računa ali prek povezave do Stripe portala. Preklic začne veljati ob koncu tekočega plačanega obdobja; do takrat plačljive funkcije ostanejo na voljo. Preklic sam po sebi ne pomeni vračila že plačanega zneska.

Vračila ureja politika vračil.

## 9. Tvoje odgovornosti

- nalagaš, snemaš, lepiš ali povezuješ lahko samo gradivo, ki ga imaš v lasti ali ga smeš uporabljati
- odgovoren si za zakonitost in točnost vsebine, ki jo pošlješ
- upoštevati moraš pravila svoje šole, fakultete ali delodajalca glede snemanja in deljenja gradiv
- rezultate, ki jih ustvari Memo AI, moraš pred uporabo preveriti

## 10. Dovoljenja za snemanje in gradiva

Z uporabo Memo AI potrjuješ, da imaš pred snemanjem, nalaganjem, lepljenjem ali povezovanjem vsebine vsa potrebna dovoljenja in pravice. To vključuje dovoljenja šole, učitelja, predavatelja, ustanove, delodajalca, udeležencev snemanja ali drugih imetnikov pravic, kadar so taka dovoljenja potrebna.

Ne snemaj predavanj, pogovorov ali drugih oseb in ne nalagaj prosojnic, zapiskov, učnih gradiv, dokumentov ali drugih datotek, če za to nimaš dovoljenja oziroma zakonske podlage. Odgovoren si, da tvoja uporaba Memo AI ne krši pravil šole, pogodbenih omejitev, avtorskih pravic, zasebnosti, pravil o snemanju ali drugih veljavnih zakonov in pravil.

V Memo AI ne nalagaj posebnih vrst osebnih podatkov drugih ljudi, na primer zdravstvenih podatkov, podatkov o veroizpovedi, političnem prepričanju ali spolni usmerjenosti, razen če imaš za to veljavno pravno podlago.

## 11. Prepovedana uporaba

Memo AI ne smeš uporabljati, da bi:

- nalagal zlonamerno programsko opremo ali poskušal ogroziti varnost storitve
- dostopal do delov storitve, računov ali podatkov, do katerih nimaš pravice
- obšel omejitve količine, plačilno steno, preizkusne omejitve ali tehnične zaščite
- storitev samodejno zajemal, obratno inženiril ali izvajal obremenitvene teste brez našega pisnega dovoljenja
- ustvarjal ali širil nezakonito, žaljivo, zavajajočo ali nasilno vsebino
- posegal v pravice drugih, vključno z avtorskimi pravicami in pravico do zasebnosti
- storitev preprodajal, oddajal v najem ali jo ponujal kot lastno storitev
- kršil akademska pravila o poštenosti ali oddajal ustvarjeno vsebino kot lastno delo, kadar to ni dovoljeno
- uporabljal Memo AI za samodejno množično obdelavo gradiva, ki ni povezana z lastnim študijem

## 12. Tvoja vsebina

Gradivo, ki ga pošlješ v Memo AI, ostane tvoje. Zaradi delovanja storitve nam podeljuješ neizključno, časovno omejeno in prostorsko neomejeno pravico, da to gradivo shranimo, prikažemo, obdelamo in posredujemo našim ponudnikom obdelave izključno zato, da lahko izvedemo funkcije, ki jih zahtevaš.

Ta pravica preneha, ko vsebino izbrišeš ali ko izbrišemo tvoj račun, razen kadar moramo podatke še hraniti zaradi zakonskih obveznosti.

Tvoje vsebine ne prodajamo in je ne uporabljamo za oglaševanje.

## 13. Naše pravice

Memo AI, njegova programska oprema, oblikovanje, blagovna znamka in vsebina, ki ni tvoja, so naša last ali last naših dajalcev licenc. S sklenitvijo naročnine dobiš osebno, neprenosljivo in nevključno pravico do uporabe storitve v skladu s temi pogoji, ne pa tudi lastninske pravice na njej.

## 14. AI obdelava in omejitve rezultatov

Za prepise, povzetke, kartice, kvize, odgovore v klepetu in izluščanje vsebine iz dokumentov lahko Memo AI tvojo vsebino obdela pri zunanjih AI in infrastrukturnih ponudnikih.

To lahko vključuje:

- zvočne posnetke in naložene zvočne datoteke
- prilepljeno besedilo in zapiske
- PDF-je in druge podprte dokumente
- javne spletne povezave, za katere želiš, da jih Memo AI prebere
- metapodatke, potrebne za delovanje, varnost in izboljšave storitve

Seznam ponudnikov in podlage za obdelavo so navedeni v politiki zasebnosti.

Memo AI lahko ustvari napake, nepopolne odgovore ali zavajajoče učno gradivo. Preden se zaneseš na rezultate pri izpitih, seminarskih nalogah, medicinskih, pravnih, finančnih, skladnostnih ali varnostno kritičnih odločitvah, jih moraš preveriti sam.

## 15. Razpoložljivost in spremembe storitve

Prizadevamo si za nemoteno delovanje, ne obljubljamo pa neprekinjene razpoložljivosti. Storitev je lahko začasno nedosegljiva zaradi vzdrževanja, napak, posodobitev ali motenj pri zunanjih ponudnikih.

Posamezne funkcije lahko spreminjamo, dodajamo ali ukinjamo. Če bi bila sprememba za plačljive uporabnike bistveno neugodna, te o njej obvestimo vnaprej, ti pa lahko naročnino prekličeš.

## 16. Ukrepanje in prekinitev računa

Dostop lahko začasno omejimo, onemogočimo nekatere funkcije ali odstranimo vsebino, kadar je uporaba videti zlorabna, nezakonita, nevarna ali škodljiva za storitev ali druge uporabnike.

Pri hujših ali ponavljajočih se kršitvah lahko račun ukinemo. Kadar je to izvedljivo in dopustno, te o razlogu obvestimo in ti damo možnost, da ukrep pojasniš ali odpraviš. Če račun ukinemo brez tvoje krivde, ti sorazmerni del vnaprej plačane naročnine vrnemo.

Svoj račun lahko kadar koli ukineš tako, da nam pišeš na info@memoai.eu.

## 17. Jamstva

Storitev je na voljo takšna, kot je. V obsegu, ki ga dovoljuje zakon, ne dajemo jamstev, da bo storitev brez napak, neprekinjena ali primerna za točno določen namen, in ne jamčimo za točnost rezultatov, ki jih ustvari AI.

To ne posega v obvezna jamstva, ki ti kot potrošniku pripadajo po slovenskem in evropskem pravu.

## 18. Omejitev odgovornosti

V obsegu, ki ga dovoljuje zakon, ne odgovarjamo za:

- izgubljeni dobiček, izgubo priložnosti, izgubo podatkov ali posredno škodo
- posledice odločitev, ki si jih sprejel na podlagi nepreverjenih rezultatov AI
- ravnanje tretjih oseb ali izpad njihovih storitev
- škodo, ki je nastala zaradi tvoje kršitve teh pogojev

Naša skupna odgovornost iz posameznega zahtevka je omejena na znesek, ki si nam ga plačal v 12 mesecih pred dogodkom, ki je povzročil škodo.

Nič v teh pogojih ne izključuje in ne omejuje odgovornosti za namen, hudo malomarnost, smrt ali telesno poškodbo ter odgovornosti, ki je po zakonu ni mogoče izključiti. Če si potrošnik, ti ostanejo v celoti na voljo vse pravice po Zakonu o varstvu potrošnikov.

## 19. Tvoja odškodninska odgovornost

Če zaradi tvoje kršitve teh pogojev ali zaradi gradiva, ki si ga poslal brez ustreznih pravic, proti nam zahtevek vloži tretja oseba, nam povrneš utemeljene stroške, ki nam pri tem nastanejo. To velja le v obsegu, v katerem je zahtevek posledica tvojega ravnanja.

## 20. Spremembe pogojev

Te pogoje lahko spremenimo, ko se izdelek, zakonodaja ali ponudniki spremenijo.

- o bistvenih spremembah te obvestimo po e-pošti ali v aplikaciji najmanj 30 dni pred uveljavitvijo
- manjše popravke, ki ne posegajo v tvoje pravice, objavimo neposredno na tej strani
- če po uveljavitvi nadaljuješ z uporabo, to pomeni, da sprejemaš posodobljeno različico
- če se s spremembo ne strinjaš, lahko pred njeno uveljavitvijo prekličeš naročnino

## 21. Prenehanje

Ob prenehanju pogodbe preneha tvoja pravica do uporabe storitve. Vsebina, povezana s tvojim računom, se obravnava v skladu s politiko zasebnosti. Določbe o intelektualni lastnini, omejitvi odgovornosti, odškodninski odgovornosti in reševanju sporov veljajo tudi po prenehanju.

## 22. Veljavno pravo in reševanje sporov

Za te pogoje velja pravo Republike Slovenije, brez uporabe kolizijskih pravil. Če si potrošnik s prebivališčem v drugi državi EU, te ta izbira ne prikrajša za varstvo, ki ti ga zagotavljajo prisilni predpisi tvoje države.

Spore najprej poskusimo rešiti sporazumno; piši nam na info@memoai.eu in odgovorili ti bomo v razumnem roku.

Kot potrošnik lahko uporabiš tudi:

- postopek izvensodnega reševanja potrošniških sporov, kadar je ta na voljo. Trenutno ne priznavamo nobenega izvajalca izvensodnega reševanja potrošniških sporov kot pristojnega za reševanje sporov iz teh pogojev
- pritožbo pri Tržnem inšpektoratu Republike Slovenije

Za spore, ki jih ni mogoče rešiti sporazumno, je pristojno stvarno pristojno sodišče v Republiki Sloveniji. Če si potrošnik, to ne posega v tvojo pravico, da tožbo vložiš pri sodišču v kraju svojega prebivališča.

## 23. Končne določbe

- če je posamezna določba teh pogojev neveljavna, ostanejo druge določbe v veljavi
- teh pogojev ne moreš prenesti na drugo osebo brez našega soglasja; mi jih lahko prenesemo ob statusni spremembi ali prodaji dejavnosti, pri čemer se tvoje pravice ne poslabšajo
- če kakšne pravice ne uveljavimo takoj, se ji s tem ne odpovemo
- ti pogoji skupaj s politiko zasebnosti in politiko vračil predstavljajo celoten dogovor med tabo in nami glede uporabe Memo AI

## 24. Kontakt

info@memoai.eu

---

**Zakonska pravica potrošnika do odstopa.** Če si potrošnik s prebivališčem v EU ali EGP, imaš po zakonu pravico, da v 14 dneh od sklenitve naročniške pogodbe od nje odstopiš, brez navedbe razloga. Ker se storitev na tvojo izrecno zahtevo začne izvajati takoj po nakupu, ob nakupu izrecno zahtevaš, da se izvajanje začne pred iztekom odstopnega roka; če med odstopnim rokom odstopiš, ti vrnemo plačani znesek, zmanjšan za sorazmerni del, ki ustreza storitvi, opravljeni do dneva odstopa. Ta zakonska pravica velja poleg politike vračil: če ti zakon v konkretnem primeru daje višje vračilo, kot ga predvideva politika vračil, velja zakon. Za odstop zadostuje jasna izjava po e-pošti na info@memoai.eu, uporabiš pa lahko tudi obrazec za odstop iz priloge k Zakonu o varstvu potrošnikov. Nič v teh pogojih ali v politiki vračil ne omejuje pravic, ki ti kot potrošniku pripadajo po prisilnih predpisih.
`,
  },
];

export const HELP_SECTIONS = [
  {
    title: "Pogosto",
    items: HELP_ARTICLES.filter((article) => article.category === "Pogosto"),
  },
  {
    title: "Snemanje in zapiski",
    items: HELP_ARTICLES.filter((article) => article.category === "Snemanje in zapiski"),
  },
  {
    title: "Račun in dostop",
    items: HELP_ARTICLES.filter((article) => article.category === "Račun in dostop"),
  },
];

export function getHelpArticle(slug: string) {
  return HELP_ARTICLES.find((article) => article.slug === slug) ?? null;
}

/**
 * A legal document may close with a fine-print block after a horizontal rule.
 * The public legal pages lift that block out and render it below the footer;
 * anywhere else (the in-app support reader) it stays inline at the end.
 */
export function splitArticleFinePrint(content: string) {
  const marker = "\n---\n";
  const markerIndex = content.indexOf(marker);

  if (markerIndex === -1) {
    return { body: content, finePrint: null };
  }

  return {
    body: content.slice(0, markerIndex).trimEnd(),
    finePrint: content.slice(markerIndex + marker.length).trim() || null,
  };
}
