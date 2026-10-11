/**
 * The creator program's Terms of Participation, one Markdown template per language.
 *
 * Slovenian is the governing text (13.5); the others are translations of it. Keep all five
 * in step: change a clause in every language in the same commit, and bump
 * `CREATOR_TERMS_VERSION` in `creator-terms.ts` whenever the meaning changes, so every
 * acceptance stays tied to the words that were accepted.
 *
 * `{placeholders}` are filled from the program config (pay, caps). Everything that is
 * one campaign's alone sits between `<!--si-->`/`<!--/si-->` or
 * `<!--balkans-->`/`<!--/balkans-->` markers: the two campaigns are separate programs,
 * and a creator's copy never shows the other campaign's pay or terms.
 */

export const CREATOR_TERMS_TEXT = {
  sl: `# Program za ustvarjalce Memo AI – pogoji sodelovanja

Različica {version}

## 1. O teh pogojih

Ti pogoji sodelovanja („pogoji“) so pogodba med teboj („ustvarjalec“) in **Memo AI, Nace Valenčič s.p., poslovno svetovanje**, Zgoša 87, 4275 Begunje na Gorenjskem, Slovenija, matična številka 7578474000, davčna številka 52958248 („Memo AI“, „mi“), ki razvija aplikacijo za učenje Memo AI.

Pogodba je sklenjena, ko po sprejetju tvoje prijave odpreš svojo osebno povezavo za pridružitev, vpišeš svoje ime in klikneš „Sprejmi in se pridruži“. Hranimo zapis o različici pogojev, ki si jo sprejel, datumu in uri ter vpisanem imenu. Od takrat ti pogoji urejajo tvoje sodelovanje, dokler se to ne konča po 9. točki.

Če si mlajši od 18 let, mora pogoje skupaj s tabo sprejeti eden od staršev ali zakoniti zastopnik. Z vpisom njegovega imena potrjuješ, da jih je prebral in se z njimi strinja.

## 2. Pomen izrazov

<!--si-->
- **Kampanja**: kampanja Slovenija, v katero si sprejet. Določa tvoje plačilo (4. točka) in tvoj strežnik Discord.
<!--/si-->
<!--balkans-->
- **Kampanja**: kampanja Balkan (Hrvaška, Bosna in Hercegovina, Srbija, Črna gora, Severna Makedonija), v katero si sprejet. Določa tvoje plačilo (4. točka) in tvoj strežnik Discord.
<!--/balkans-->
- **Video**: nov, izviren kratek video o Memo AI, ki ga posnameš za program in še ni bil objavljen na nobenem profilu.
- **Upravičen video**: video, ki izpolnjuje točko 3.2, je objavljen na javnem profilu TikTok ali Instagram, ki ga upravljaš, in ostane objavljen, kot zahteva 7. točka.
- **Navodila**: navodila, formati, primeri in povratne informacije, ki ti jih damo na Discordu kampanje ali po e-pošti.
<!--si-->
- **Koda za popust**: tvoja osebna koda Memo AI.
<!--/si-->
- **Ogledi**: ogledi tvojih upravičenih videov, kot jih kaže analitika platforme.

Izrazi v moški slovnični obliki (na primer ustvarjalec) so uporabljeni kot nevtralni in veljajo enako za vse spole.

## 3. Kaj delaš

3.1 Videe ustvarjaš in objavljaš samostojno, po svojem urniku in v skladu z navodili. Najmanjšega števila videov ni, priporočamo pa vsakodnevno objavljanje. Če 14 dni zapored ne objaviš ničesar, lahko tvoje sodelovanje končamo (9. točka).

3.2 Video je upravičen, če: sledi navodilom in našim povratnim informacijam; je vsaj tako kakovosten kot testni video, s katerim si se prijavil; si v njem ti; je pravilno označen kot oglas (6. točka); in ne krši teh pogojev, zakona ali pravil platforme.

3.3 Vsak video objaviš na TikToku in isti video lahko objaviš tudi v Instagram Reels; še vedno je to en upravičen video, plačan po platformah, kot določa 4. točka. Ponovna objava starejšega videa je dovoljena, a ni nov upravičen video (njegovi ogledi se štejejo, kjer se plačujejo ogledi).

3.4 Plačilo na video velja za največ **{monthCap} upravičenih videov na koledarski mesec**.

3.5 Uporabljaš svoj telefon in opremo ter sam kriješ svoje stroške.

## 4. Plačilo

<!--si-->
### Kampanja Slovenija

- **{siTikTok} za vsak upravičen video, objavljen na TikToku**, in še **{siInstagram}**, ko isti video objaviš tudi v Instagram Reels (skupaj do {siVideo} na video).
- **Bonus {siShare} %** zneska, ki so ga v koledarskem mesecu dejansko plačali kupci, ki so naročnino Memo AI kupili s tvojo kodo za popust, brez DDV, vračil in povratnih bremenitev, do največ **{siCap} na mesec**.
<!--/si-->

<!--balkans-->
### Kampanja Balkan

- **{bkTikTok} za vsak upravičen video, objavljen na TikToku**, in še **{bkInstagram}**, ko isti video objaviš tudi v Instagram Reels (skupaj do {bkVideo} na video).
- **Bonus za oglede {bkRate} na 1000 ogledov**, ki jih tvoji upravičeni videi zberejo v koledarskem mesecu, do največ **{bkCap} na mesec**.
<!--/balkans-->

### Izplačilo

4.1 Zneski so v evrih in so bruto zneski. Kjer slovenski zakon od Memo AI zahteva, da od plačila odtegne davek ali prispevke, jih odtegnemo in ti izplačamo preostanek; sicer sam prijaviš in plačaš svoje davke. Za to nam posreduješ potrebne podatke (ime, naslov, davčno številko, bančni račun).

4.2 Izplačujemo enkrat na mesec, za pretekli koledarski mesec, v 15 dneh po tem, ko pošlješ mesečno poročilo (8. točka), na bančni račun (IBAN) ali Revolut.

4.3 Ocene in primeri zaslužka na naši spletni strani so ponazoritve, ne zagotovila. Plačamo samo upravičene videe in bonus po tej točki.

4.4 Če po izplačilu ugotovimo, da video ni bil upravičen, lahko znesek pobotamo z naslednjim izplačilom.

## 5. Samo pristni ogledi

Prepovedano je: plačevati promocijo svojih videov (tudi z orodji platforme, kot je TikTok Promote), razen če se pisno dogovorimo; kupovati oglede, všečke, sledilce ali komentarje; uporabljati bote, avtomatizacijo, skupine za izmenjavo interakcij, „klik farme“ ali nagrajen promet; ali kako drugače umetno povečevati oglede ali prodajo s svojo kodo (tudi z nakupi s svojo kodo zaradi bonusa) („goljufija“).

Če utemeljeno ugotovimo goljufijo: za prizadeti mesec ne dolgujemo plačila, neizplačane zneske lahko zadržimo, tvoje sodelovanje se lahko takoj konča, ti pa plačaš pogodbeno kazen **1000 € za vsak ugotovljen primer**. Če dokažemo večjo škodo, lahko zahtevamo tudi njeno povrnitev.

## 6. Označevanje oglasov

Videi so plačani oglasi. Vsak video moraš označiti kot oglas z nastavitvijo platforme za plačano partnerstvo oziroma razkritje vsebine in, kjer to zahtevamo, z oznako, kot je #oglas, kot to zahtevajo zakon (vključno s slovensko zakonodajo o varstvu potrošnikov in Direktivo EU o nepoštenih poslovnih praksah) in pravila platforme. O Memo AI ne smeš trditi ničesar, kar ni res ali ni v navodilih (na primer obljubljati ocen).

## 7. Vsebina in profili

7.1 Profili in videi so tvoji. Memo AI podeljuješ neizključno, brezplačno in svetovno licenco, da tvoje videe, vključno s tvojo podobo, glasom in imenom, kot so v njih, uporablja, kopira, ureja, podnaslavlja in objavlja na svojih kanalih, na spletni strani in v plačanih oglasih (tudi kot oglase s tvojega profila, na primer TikTok Spark Ads, če nam posreduješ kodo), ves čas sodelovanja in še **24 mesecev** po njegovem koncu. Oglasi, ki ob izteku tega obdobja že tečejo, se lahko izteče do konca.

7.2 Vsak upravičen video ostane objavljen vsaj **90 dni** po objavi in ga ne urejaš tako, da bi odstranil oznako oglasa ali Memo AI. Če profil, ki ga uporabljaš za program, izgubiš ali je blokiran, nam to sporoči.

7.3 Tvoji videi ne smejo kršiti pravic drugih (glasba, podoba drugih ljudi, blagovne znamke). Uporabljaj licencirane zvoke platforme.

## 8. Mesečno poročilo

Do 5. dne v mesecu nam prek Discorda ali e-pošte pošlješ povezave do videov, objavljenih v preteklem mesecu, in posnetke zaslona analitike z ogledi ali kar zahtevamo. Za vsak video lahko zahtevamo celotno analitiko. Izplačilo je odvisno od poročila: če ga ne pošlješ v 30 dneh po koncu meseca, plačamo le plačilo na video za videe, ki jih lahko preverimo sami<!--balkans-->, bonus za oglede za ta mesec pa zapade<!--/balkans-->.

## 9. Konec sodelovanja

9.1 Ti ali mi lahko sodelovanje kadar koli končamo s takojšnjim učinkom, s sporočilom po e-pošti ali na Discordu. Razlog ni potreben.

9.2 Ob koncu plačamo upravičene videe, objavljene do tega dne, in zaslužen bonus, ko v 7 dneh pošlješ zadnje poročilo.

9.3 Točke 5, 7, 10, 11.3 in 13 veljajo tudi po koncu sodelovanja.

## 10. Zaupnost

Navodila, scenariji, vsebina Discorda, rezultati, plačila drugih ustvarjalcev in neobjavljene funkcije Memo AI so zaupni. Uporabljaš jih le za videe za Memo AI; ne deliš jih in jih ne uporabljaš za nikogar drugega. To velja ves čas sodelovanja in še 2 leti po njem. Za vsako ugotovljeno kršitev plačaš pogodbeno kazen **1000 €**; če dokažemo večjo škodo, lahko zahtevamo tudi njeno povrnitev.

## 11. Konkurenca

11.1 Med sodelovanjem ne ustvarjaš in ne objavljaš vsebin za neposredne konkurente: aplikacije ali storitve, katerih glavni namen je pomoč pri učenju z umetno inteligenco – na primer AI zapiski s predavanj, AI kartice, kvizi in priprava na izpite ter AI tutorji. Splošne vsebine za druge znamke so dovoljene.

11.2 Če te kontaktira konkurent, nam to sporoči, preden se s čimer koli strinjaš. Če nisi prepričan, ali je znamka konkurent, nas najprej vprašaj.

11.3 Če sodelovanje končaš ti, ta omejitev velja še **1 mesec** po koncu. Če ga končamo mi, preneha takoj.

11.4 Ob kršitvi ne dolgujemo plačila za videe, ustvarjene med kršitvijo, sodelovanje pa se lahko takoj konča.

## 12. Osebni podatki

Osebne podatke, ki nam jih posreduješ (prijava, kontakt, podatki za izplačilo in davke, zapis o sprejetju pogojev), obdelujemo za izvajanje programa, izplačila in izpolnjevanje zakonskih obveznosti, kot je opisano v naši politiki zasebnosti. Podatke o izplačilih in davkih hranimo, kolikor dolgo zahteva zakon.

## 13. Druge določbe

13.1 Sodeluješ kot samostojni izvajalec. Ti pogoji ne ustvarjajo delovnega razmerja, družbeništva ali zastopanja.

13.2 Pogoje lahko spremenimo z obvestilom po e-pošti ali na Discordu vsaj 7 dni vnaprej. Spremembe plačila veljajo le za videe, objavljene po uveljavitvi spremembe. Če se ne strinjaš, lahko sodelovanje končaš; če po uveljavitvi spremembe še naprej objavljaš, sprejemaš nove pogoje.

13.3 Ti pogoji skupaj z navodili so celoten dogovor med nama o programu.

13.4 Velja slovensko pravo. O sporih odloča pristojno sodišče v Kranju, Slovenija, razen če ti prisilni predpisi dajejo pravico do tožbe v kraju tvojega prebivališča.

13.5 Pogoji so objavljeni v slovenščini, angleščini, hrvaščini, bosanščini in srbščini. Ob razhajanjih velja slovenska različica.

13.6 Kontakt: info@memoai.eu.
`,

  en: `# Memo AI Creator Program – Terms of Participation

Version {version}

## 1. About these Terms

These Terms of Participation (the "Terms") are the agreement between you (the "Creator") and **Memo AI, Nace Valenčič s.p., poslovno svetovanje**, Zgoša 87, 4275 Begunje na Gorenjskem, Slovenia, registration number 7578474000, tax number 52958248 ("Memo AI", "we"), which makes the Memo AI study app.

The agreement is concluded when, after we have accepted your application, you open your personal join link, type your name and click "Accept and join". We keep a record of the version you accepted, the date and time, and the name you typed. From then on these Terms govern your participation until it ends under Section 9.

If you are under 18, a parent or legal guardian must accept these Terms with you. By typing their name you confirm that they have read and agree to them.

## 2. Definitions

<!--si-->
- **Campaign**: the Slovenia campaign you were accepted into. It sets your pay (Section 4) and your Discord server.
<!--/si-->
<!--balkans-->
- **Campaign**: the Balkans campaign (Croatia, Bosnia and Herzegovina, Serbia, Montenegro, North Macedonia) you were accepted into. It sets your pay (Section 4) and your Discord server.
<!--/balkans-->
- **Video**: a new, original short-form video about Memo AI that you make for the Program and that has not been published on any account before.
- **Eligible Video**: a Video that meets Section 3.2, is published on a public TikTok or Instagram account you manage, and stays published as Section 7 requires.
- **Brief**: the instructions, formats, examples and feedback we give you in your Campaign's Discord or by email.
<!--si-->
- **Discount Code**: your personal Memo AI code.
<!--/si-->
- **Views**: views of your Eligible Videos as shown in the platform's own analytics.

## 3. What you do

3.1 You create and publish Videos independently, on your own schedule, following the Brief. There is no minimum number of Videos, but we recommend posting daily. If you post nothing for 14 days in a row we may end your participation (Section 9).

3.2 A Video is eligible if it: follows the Brief and our feedback; is at least as good as the sample video you applied with; features you; is properly labelled as an advertisement (Section 6); and does not break these Terms, the law or the platform's rules.

3.3 You publish each Video on TikTok and may publish the same Video on Instagram Reels too; it is still one Eligible Video, paid per platform as Section 4 sets out. Reposting an earlier Video is allowed but is not a new Eligible Video (its Views still count where Views are paid).

3.4 The per-video fees are paid for at most **{monthCap} Eligible Videos per calendar month**.

3.5 You use your own phone and equipment and bear your own costs.

## 4. Pay

<!--si-->
### Slovenia Campaign

- **{siTikTok} for every Eligible Video published on TikTok**, and **{siInstagram} more** when you also publish the same Video on Instagram Reels (up to {siVideo} per Video).
- **A {siShare}% bonus** on the amount actually paid in the calendar month by customers who bought a Memo AI subscription with your Discount Code, excluding VAT, refunds and chargebacks, up to **{siCap} a month**.
<!--/si-->

<!--balkans-->
### Balkans Campaign

- **{bkTikTok} for every Eligible Video published on TikTok**, and **{bkInstagram} more** when you also publish the same Video on Instagram Reels (up to {bkVideo} per Video).
- **A view bonus of {bkRate} per 1,000 Views** your Eligible Videos gain in the calendar month, up to **{bkCap} a month**.
<!--/balkans-->

### Payment

4.1 Amounts are in euros and are gross amounts. Where Slovenian law requires Memo AI to withhold tax or contributions from a payment, we withhold them and pay you the rest; otherwise you declare and pay your own taxes. You give us the details needed for this (name, address, tax number, bank account).

4.2 We pay once a month, for the previous calendar month, within 15 days of receiving your monthly report (Section 8), by bank transfer (IBAN) or Revolut.

4.3 Estimates and earnings examples on our website are illustrations, not guarantees. Only Eligible Videos and the bonus under this Section are paid.

4.4 If we find after paying that a Video was not eligible, we may set the amount off against your next payout.

## 5. Authentic views only

You must not: pay to promote your Videos (including with platform tools such as TikTok Promote) unless we agree in writing; buy views, likes, followers or comments; use bots, automation, engagement groups or pods, click farms or incentivised traffic; or inflate Views or sales with your code in any other artificial way (including buying with your own code to earn the bonus) ("Fraud").

If we reasonably establish Fraud: no pay is owed for the affected month, pending amounts may be withheld, your participation may end immediately, and you pay a contractual penalty of **€1,000 per established case**. If we prove greater damage, we may also claim it.

## 6. Advertising disclosure

Videos are paid advertising. You must label every Video as an advertisement using the platform's paid-partnership or content-disclosure setting and, where we ask, a tag such as #ad or #oglas, as the law (including Slovenian consumer protection law and the EU Unfair Commercial Practices Directive) and platform rules require. You must not claim anything about Memo AI that is untrue or not in the Brief (for example, promising grades).

## 7. Content and accounts

7.1 Your accounts and your Videos are yours. You grant Memo AI a non-exclusive, worldwide, royalty-free licence to use, copy, edit, subtitle and publish your Videos, including your image, voice and name as they appear in them, on Memo AI's own channels, its website and in paid ads (including as ads from your account, such as TikTok Spark Ads, if you give us the code), for as long as you take part and for **24 months** after. Ads already running when that period ends may finish their run.

7.2 You keep every Eligible Video published for at least **90 days** after posting and do not edit it to remove the advertising label or Memo AI. If an account you use for the Program is lost or banned, tell us.

7.3 Your Videos must not infringe anyone's rights (music, other people's likeness, trademarks). Use the platform's licensed sounds.

## 8. Monthly report

By the 5th day of each month you send us, through Discord or by email, the links of the Videos you published in the previous month and screenshots of their analytics showing Views, or whatever we ask for. We may ask for the full analytics of any Video. Payment depends on the report: if you do not send it within 30 days of the month's end, we pay only the per-video fee for Videos we can verify ourselves<!--balkans-->, and that month's view bonus lapses<!--/balkans-->.

## 9. Ending participation

9.1 You or we may end your participation at any time, with immediate effect, by a message by email or on Discord. No reason is needed.

9.2 When it ends, we pay for the Eligible Videos published, and the bonus earned, up to that day, once you send the final report within 7 days.

9.3 Sections 5, 7, 10, 11.3 and 13 continue to apply after it ends.

## 10. Confidentiality

Briefs, scripts, Discord content, results, other creators' pay and unreleased Memo AI features are confidential. You use them only to make Videos for Memo AI and do not share them or use them for anyone else. This applies while you take part and for 2 years after. For each established breach you pay a contractual penalty of **€1,000**; if we prove greater damage, we may also claim it.

## 11. Competitors

11.1 While you take part, you do not create or publish content for direct competitors: apps or services whose main purpose is helping people study with AI – for example AI lecture note-takers, AI flashcard, quiz and exam-prep apps, and AI tutors. General content for other brands is fine.

11.2 If a competitor approaches you, tell us before agreeing to anything. If you are unsure whether a brand is a competitor, ask us first.

11.3 If you end your participation, this restriction continues for **1 month** after the end. If we end it, the restriction ends at once.

11.4 If you breach it, no pay is owed for Videos made during the breach, and your participation may end immediately.

## 12. Personal data

We process the personal data you give us (application, contact, payout and tax details, the record of your acceptance) to run the Program, pay you and meet our legal duties, as described in our Privacy Policy. Payout and tax records are kept for as long as the law requires.

## 13. Other terms

13.1 You take part as an independent contractor. These Terms do not create employment, a partnership or agency.

13.2 We may change these Terms by notifying you by email or on Discord at least 7 days in advance. Changes to pay apply only to Videos published after the change takes effect. If you do not agree, you may end your participation; if you keep publishing after the change takes effect, you accept the new Terms.

13.3 These Terms, together with the Brief, are the entire agreement between us about the Program.

13.4 Slovenian law applies. Disputes are decided by the competent court in Kranj, Slovenia, unless mandatory law gives you the right to sue where you live.

13.5 These Terms are published in Slovenian, English, Croatian, Bosnian and Serbian. If they differ, the Slovenian version prevails.

13.6 Contact: info@memoai.eu.
`,

  hr: `# Program za kreatore Memo AI – uvjeti sudjelovanja

Verzija {version}

## 1. O ovim uvjetima

Ovi uvjeti sudjelovanja („uvjeti”) ugovor su između tebe („kreator”) i **Memo AI, Nace Valenčič s.p., poslovno svetovanje**, Zgoša 87, 4275 Begunje na Gorenjskem, Slovenija, matični broj 7578474000, porezni broj 52958248 („Memo AI”, „mi”), koji razvija aplikaciju za učenje Memo AI.

Ugovor je sklopljen kada nakon prihvaćanja tvoje prijave otvoriš svoju osobnu poveznicu za pridruživanje, upišeš svoje ime i klikneš „Prihvati i pridruži se”. Čuvamo zapis o verziji uvjeta koju si prihvatio, datumu i vremenu te upisanom imenu. Od tada ovi uvjeti uređuju tvoje sudjelovanje dok ono ne završi prema točki 9.

Ako imaš manje od 18 godina, uvjete s tobom mora prihvatiti roditelj ili zakonski skrbnik. Upisom njegova imena potvrđuješ da ih je pročitao i da se s njima slaže.

## 2. Značenje pojmova

<!--si-->
- **Kampanja**: kampanja Slovenija u koju si primljen. Određuje tvoju naknadu (točka 4) i tvoj Discord poslužitelj.
<!--/si-->
<!--balkans-->
- **Kampanja**: kampanja Balkan (Hrvatska, Bosna i Hercegovina, Srbija, Crna Gora, Sjeverna Makedonija) u koju si primljen. Određuje tvoju naknadu (točka 4) i tvoj Discord poslužitelj.
<!--/balkans-->
- **Video**: novi, izvorni kratki video o Memo AI koji snimiš za program i koji još nije objavljen ni na jednom profilu.
- **Prihvatljiv video**: video koji ispunjava točku 3.2, objavljen je na javnom TikTok ili Instagram profilu kojim upravljaš i ostaje objavljen kako zahtijeva točka 7.
- **Upute**: upute, formati, primjeri i povratne informacije koje ti dajemo na Discordu kampanje ili e-poštom.
<!--si-->
- **Kod za popust**: tvoj osobni Memo AI kod.
<!--/si-->
- **Pregledi**: pregledi tvojih prihvatljivih videa prema analitici platforme.

Izrazi u muškom rodu (na primjer kreator) koriste se neutralno i jednako se odnose na sve spolove.

## 3. Što radiš

3.1 Videa izrađuješ i objavljuješ samostalno, prema vlastitom rasporedu i u skladu s uputama. Najmanji broj videa ne postoji, ali preporučujemo svakodnevno objavljivanje. Ako 14 dana zaredom ništa ne objaviš, možemo završiti tvoje sudjelovanje (točka 9).

3.2 Video je prihvatljiv ako: slijedi upute i naše povratne informacije; kvalitetom je barem jednak probnom videu s kojim si se prijavio; u njemu si ti; pravilno je označen kao oglas (točka 6); i ne krši ove uvjete, zakon ni pravila platforme.

3.3 Svaki video objavljuješ na TikToku, a isti video možeš objaviti i u Instagram Reelsima; to je i dalje jedan prihvatljiv video, plaćen po platformama kako određuje točka 4. Ponovna objava starijeg videa dopuštena je, ali nije novi prihvatljiv video (njegovi se pregledi broje tamo gdje se plaćaju pregledi).

3.4 Naknade po videu plaćaju se za najviše **{monthCap} prihvatljivih videa po kalendarskom mjesecu**.

3.5 Koristiš vlastiti mobitel i opremu te sam snosiš svoje troškove.

## 4. Naknada

<!--si-->
### Kampanja Slovenija

- **{siTikTok} za svaki prihvatljiv video objavljen na TikToku** i još **{siInstagram}** kad isti video objaviš i u Instagram Reelsima (ukupno do {siVideo} po videu).
- **Bonus od {siShare} %** iznosa koji su u kalendarskom mjesecu stvarno platili kupci koji su pretplatu na Memo AI kupili s tvojim kodom za popust, bez PDV-a, povrata i storniranih plaćanja, do najviše **{siCap} mjesečno**.
<!--/si-->

<!--balkans-->
### Kampanja Balkan

- **{bkTikTok} za svaki prihvatljiv video objavljen na TikToku** i još **{bkInstagram}** kad isti video objaviš i u Instagram Reelsima (ukupno do {bkVideo} po videu).
- **Bonus za preglede od {bkRate} na 1000 pregleda** koje tvoji prihvatljivi videi skupe u kalendarskom mjesecu, do najviše **{bkCap} mjesečno**.
<!--/balkans-->

### Isplata

4.1 Iznosi su u eurima i bruto su iznosi. Gdje slovenski zakon od Memo AI zahtijeva da od isplate obustavi porez ili doprinose, obustavljamo ih i isplaćujemo ti ostatak; inače sam prijavljuješ i plaćaš svoje poreze. Za to nam daješ potrebne podatke (ime, adresu, porezni broj, bankovni račun).

4.2 Isplaćujemo jednom mjesečno, za prethodni kalendarski mjesec, u roku od 15 dana nakon što pošalješ mjesečni izvještaj (točka 8), na bankovni račun (IBAN) ili Revolut.

4.3 Procjene i primjeri zarade na našoj web stranici ilustracije su, a ne jamstva. Plaćamo samo prihvatljiva videa i bonus prema ovoj točki.

4.4 Ako nakon isplate utvrdimo da video nije bio prihvatljiv, iznos možemo prebiti sa sljedećom isplatom.

## 5. Samo pravi pregledi

Zabranjeno je: plaćati promociju svojih videa (i alatima platforme poput TikTok Promote), osim ako se pisano dogovorimo; kupovati preglede, lajkove, pratitelje ili komentare; koristiti botove, automatizaciju, grupe za razmjenu interakcija, „klik farme” ili nagrađivani promet; ili na bilo koji drugi način umjetno povećavati preglede ili prodaju svojim kodom (uključujući kupnju vlastitim kodom radi bonusa) („prijevara”).

Ako opravdano utvrdimo prijevaru: za taj mjesec ne dugujemo naknadu, neisplaćene iznose možemo zadržati, tvoje sudjelovanje može odmah završiti, a ti plaćaš ugovornu kaznu od **1000 € za svaki utvrđeni slučaj**. Ako dokažemo veću štetu, možemo zahtijevati i njezinu naknadu.

## 6. Označavanje oglasa

Videa su plaćeni oglasi. Svaki video moraš označiti kao oglas postavkom platforme za plaćeno partnerstvo ili otkrivanje sadržaja te, gdje to zatražimo, oznakom poput #oglas ili #ad, kako to zahtijevaju zakon (uključujući slovenske propise o zaštiti potrošača i Direktivu EU o nepoštenoj poslovnoj praksi) i pravila platforme. O Memo AI ne smiješ tvrditi ništa što nije istina ili nije u uputama (na primjer obećavati ocjene).

## 7. Sadržaj i profili

7.1 Profili i videa su tvoji. Memo AI-ju daješ neisključivu, besplatnu licencu za cijeli svijet da tvoja videa, uključujući tvoj lik, glas i ime kako se u njima pojavljuju, koristi, kopira, uređuje, titlira i objavljuje na svojim kanalima, web stranici i u plaćenim oglasima (uključujući kao oglase s tvog profila, npr. TikTok Spark Ads, ako nam daš kod), za cijelo vrijeme sudjelovanja i još **24 mjeseca** nakon njegova završetka. Oglasi koji su u tijeku na isteku tog razdoblja mogu se privesti kraju.

7.2 Svaki prihvatljiv video ostaje objavljen najmanje **90 dana** nakon objave i ne uređuješ ga tako da ukloniš oznaku oglasa ili Memo AI. Ako izgubiš profil koji koristiš za program ili on bude blokiran, javi nam.

7.3 Tvoja videa ne smiju kršiti tuđa prava (glazba, lik drugih osoba, žigovi). Koristi licencirane zvukove platforme.

## 8. Mjesečni izvještaj

Do 5. dana u mjesecu putem Discorda ili e-pošte šalješ nam poveznice na videa objavljena u prethodnom mjesecu i snimke zaslona analitike s pregledima ili ono što zatražimo. Za svaki video možemo zatražiti cjelokupnu analitiku. Isplata ovisi o izvještaju: ako ga ne pošalješ u roku od 30 dana od kraja mjeseca, plaćamo samo naknadu po videu za videa koja možemo sami provjeriti<!--balkans-->, a bonus za preglede za taj mjesec propada<!--/balkans-->.

## 9. Završetak sudjelovanja

9.1 Ti ili mi možemo u bilo kojem trenutku završiti sudjelovanje s trenutačnim učinkom, porukom e-poštom ili na Discordu. Razlog nije potreban.

9.2 Po završetku plaćamo prihvatljiva videa objavljena do tog dana i zarađeni bonus, nakon što u roku od 7 dana pošalješ završni izvještaj.

9.3 Točke 5, 7, 10, 11.3 i 13 vrijede i nakon završetka.

## 10. Povjerljivost

Upute, scenariji, sadržaj Discorda, rezultati, naknade drugih kreatora i neobjavljene funkcije Memo AI povjerljivi su. Koristiš ih samo za izradu videa za Memo AI; ne dijeliš ih i ne koristiš ni za koga drugoga. To vrijedi tijekom sudjelovanja i još 2 godine nakon njega. Za svaku utvrđenu povredu plaćaš ugovornu kaznu od **1000 €**; ako dokažemo veću štetu, možemo zahtijevati i njezinu naknadu.

## 11. Konkurencija

11.1 Tijekom sudjelovanja ne izrađuješ i ne objavljuješ sadržaj za izravne konkurente: aplikacije ili usluge kojima je glavna svrha pomoć pri učenju s umjetnom inteligencijom – na primjer AI bilješke s predavanja, AI kartice, kvizovi i priprema za ispite te AI tutori. Opći sadržaj za druge brendove dopušten je.

11.2 Ako ti se javi konkurent, javi nam prije nego što na bilo što pristaneš. Ako nisi siguran je li brend konkurent, prvo nas pitaj.

11.3 Ako sudjelovanje završiš ti, ovo ograničenje vrijedi još **1 mjesec** nakon završetka. Ako ga završimo mi, prestaje odmah.

11.4 U slučaju povrede ne dugujemo naknadu za videa izrađena tijekom povrede, a sudjelovanje može odmah završiti.

## 12. Osobni podaci

Osobne podatke koje nam daješ (prijava, kontakt, podaci za isplatu i porez, zapis o prihvaćanju uvjeta) obrađujemo radi provedbe programa, isplata i ispunjavanja zakonskih obveza, kako je opisano u našoj politici privatnosti. Podatke o isplatama i porezu čuvamo onoliko dugo koliko zahtijeva zakon.

## 13. Ostale odredbe

13.1 Sudjeluješ kao samostalni izvođač. Ovi uvjeti ne stvaraju radni odnos, ortakluk ni zastupanje.

13.2 Uvjete možemo promijeniti obavijesti e-poštom ili na Discordu najmanje 7 dana unaprijed. Promjene naknade vrijede samo za videa objavljena nakon stupanja promjene na snagu. Ako se ne slažeš, možeš završiti sudjelovanje; ako nakon stupanja promjene na snagu nastaviš objavljivati, prihvaćaš nove uvjete.

13.3 Ovi uvjeti zajedno s uputama cjelokupan su dogovor između nas o programu.

13.4 Primjenjuje se slovensko pravo. O sporovima odlučuje nadležni sud u Kranju, Slovenija, osim ako ti prisilni propisi daju pravo na tužbu u mjestu prebivališta.

13.5 Uvjeti su objavljeni na slovenskom, engleskom, hrvatskom, bosanskom i srpskom jeziku. U slučaju razlika vrijedi slovenska verzija.

13.6 Kontakt: info@memoai.eu.
`,

  bs: `# Program za kreatore Memo AI – uslovi učešća

Verzija {version}

## 1. O ovim uslovima

Ovi uslovi učešća („uslovi”) su ugovor između tebe („kreator”) i **Memo AI, Nace Valenčič s.p., poslovno svetovanje**, Zgoša 87, 4275 Begunje na Gorenjskem, Slovenija, matični broj 7578474000, poreski broj 52958248 („Memo AI”, „mi”), koji razvija aplikaciju za učenje Memo AI.

Ugovor je zaključen kada nakon prihvatanja tvoje prijave otvoriš svoj lični link za pridruživanje, upišeš svoje ime i klikneš „Prihvati i pridruži se”. Čuvamo zapis o verziji uslova koju si prihvatio, datumu i vremenu te upisanom imenu. Od tada ovi uslovi uređuju tvoje učešće dok ono ne završi prema tački 9.

Ako imaš manje od 18 godina, uslove s tobom mora prihvatiti roditelj ili zakonski staratelj. Upisom njegovog imena potvrđuješ da ih je pročitao i da se s njima slaže.

## 2. Značenje pojmova

<!--si-->
- **Kampanja**: kampanja Slovenija u koju si primljen. Određuje tvoju naknadu (tačka 4) i tvoj Discord server.
<!--/si-->
<!--balkans-->
- **Kampanja**: kampanja Balkan (Hrvatska, Bosna i Hercegovina, Srbija, Crna Gora, Sjeverna Makedonija) u koju si primljen. Određuje tvoju naknadu (tačka 4) i tvoj Discord server.
<!--/balkans-->
- **Video**: novi, originalni kratki video o Memo AI koji snimiš za program i koji još nije objavljen ni na jednom profilu.
- **Prihvatljiv video**: video koji ispunjava tačku 3.2, objavljen je na javnom TikTok ili Instagram profilu kojim upravljaš i ostaje objavljen kako zahtijeva tačka 7.
- **Upute**: upute, formati, primjeri i povratne informacije koje ti dajemo na Discordu kampanje ili e-poštom.
<!--si-->
- **Kod za popust**: tvoj lični Memo AI kod.
<!--/si-->
- **Pregledi**: pregledi tvojih prihvatljivih videa prema analitici platforme.

Izrazi u muškom rodu (na primjer kreator) koriste se neutralno i jednako se odnose na sve spolove.

## 3. Šta radiš

3.1 Videe praviš i objavljuješ samostalno, prema vlastitom rasporedu i u skladu s uputama. Najmanji broj videa ne postoji, ali preporučujemo svakodnevno objavljivanje. Ako 14 dana zaredom ništa ne objaviš, možemo završiti tvoje učešće (tačka 9).

3.2 Video je prihvatljiv ako: prati upute i naše povratne informacije; kvalitetom je barem jednak probnom videu s kojim si se prijavio; u njemu si ti; pravilno je označen kao oglas (tačka 6); i ne krši ove uslove, zakon ni pravila platforme.

3.3 Svaki video objavljuješ na TikToku, a isti video možeš objaviti i u Instagram Reelsima; to je i dalje jedan prihvatljiv video, plaćen po platformama kako određuje tačka 4. Ponovna objava starijeg videa je dozvoljena, ali nije novi prihvatljiv video (njegovi pregledi se broje tamo gdje se plaćaju pregledi).

3.4 Naknade po videu plaćaju se za najviše **{monthCap} prihvatljivih videa po kalendarskom mjesecu**.

3.5 Koristiš vlastiti mobitel i opremu te sam snosiš svoje troškove.

## 4. Naknada

<!--si-->
### Kampanja Slovenija

- **{siTikTok} za svaki prihvatljiv video objavljen na TikToku** i još **{siInstagram}** kad isti video objaviš i u Instagram Reelsima (ukupno do {siVideo} po videu).
- **Bonus od {siShare} %** iznosa koji su u kalendarskom mjesecu stvarno platili kupci koji su pretplatu na Memo AI kupili s tvojim kodom za popust, bez PDV-a, povrata i storniranih plaćanja, do najviše **{siCap} mjesečno**.
<!--/si-->

<!--balkans-->
### Kampanja Balkan

- **{bkTikTok} za svaki prihvatljiv video objavljen na TikToku** i još **{bkInstagram}** kad isti video objaviš i u Instagram Reelsima (ukupno do {bkVideo} po videu).
- **Bonus za preglede od {bkRate} na 1000 pregleda** koje tvoji prihvatljivi videi skupe u kalendarskom mjesecu, do najviše **{bkCap} mjesečno**.
<!--/balkans-->

### Isplata

4.1 Iznosi su u eurima i bruto su iznosi. Gdje slovenski zakon od Memo AI zahtijeva da od isplate obustavi porez ili doprinose, obustavljamo ih i isplaćujemo ti ostatak; u suprotnom sam prijavljuješ i plaćaš svoje poreze. Za to nam daješ potrebne podatke (ime, adresu, poreski broj, bankovni račun).

4.2 Isplaćujemo jednom mjesečno, za prethodni kalendarski mjesec, u roku od 15 dana nakon što pošalješ mjesečni izvještaj (tačka 8), na bankovni račun (IBAN) ili Revolut.

4.3 Procjene i primjeri zarade na našoj web stranici su ilustracije, a ne garancije. Plaćamo samo prihvatljive videe i bonus prema ovoj tački.

4.4 Ako nakon isplate utvrdimo da video nije bio prihvatljiv, iznos možemo prebiti sa sljedećom isplatom.

## 5. Samo pravi pregledi

Zabranjeno je: plaćati promociju svojih videa (i alatima platforme poput TikTok Promote), osim ako se pismeno dogovorimo; kupovati preglede, lajkove, pratioce ili komentare; koristiti botove, automatizaciju, grupe za razmjenu interakcija, „klik farme” ili nagrađivani saobraćaj; ili na bilo koji drugi način vještački povećavati preglede ili prodaju svojim kodom (uključujući kupovinu vlastitim kodom radi bonusa) („prevara”).

Ako opravdano utvrdimo prevaru: za taj mjesec ne dugujemo naknadu, neisplaćene iznose možemo zadržati, tvoje učešće može odmah završiti, a ti plaćaš ugovornu kaznu od **1000 € za svaki utvrđeni slučaj**. Ako dokažemo veću štetu, možemo zahtijevati i njenu naknadu.

## 6. Označavanje oglasa

Videi su plaćeni oglasi. Svaki video moraš označiti kao oglas postavkom platforme za plaćeno partnerstvo ili otkrivanje sadržaja te, gdje to zatražimo, oznakom poput #oglas ili #ad, kako to zahtijevaju zakon (uključujući slovenske propise o zaštiti potrošača i Direktivu EU o nepoštenoj poslovnoj praksi) i pravila platforme. O Memo AI ne smiješ tvrditi ništa što nije istina ili nije u uputama (naprimjer obećavati ocjene).

## 7. Sadržaj i profili

7.1 Profili i videi su tvoji. Memo AI-ju daješ neisključivu, besplatnu licencu za cijeli svijet da tvoje videe, uključujući tvoj lik, glas i ime kako se u njima pojavljuju, koristi, kopira, uređuje, titluje i objavljuje na svojim kanalima, web stranici i u plaćenim oglasima (uključujući kao oglase s tvog profila, npr. TikTok Spark Ads, ako nam daš kod), za cijelo vrijeme učešća i još **24 mjeseca** nakon njegovog završetka. Oglasi koji su u toku na isteku tog perioda mogu se privesti kraju.

7.2 Svaki prihvatljiv video ostaje objavljen najmanje **90 dana** nakon objave i ne uređuješ ga tako da ukloniš oznaku oglasa ili Memo AI. Ako izgubiš profil koji koristiš za program ili on bude blokiran, javi nam.

7.3 Tvoji videi ne smiju kršiti tuđa prava (muzika, lik drugih osoba, žigovi). Koristi licencirane zvukove platforme.

## 8. Mjesečni izvještaj

Do 5. dana u mjesecu putem Discorda ili e-pošte šalješ nam linkove na videe objavljene u prethodnom mjesecu i snimke ekrana analitike s pregledima ili ono što zatražimo. Za svaki video možemo zatražiti kompletnu analitiku. Isplata zavisi od izvještaja: ako ga ne pošalješ u roku od 30 dana od kraja mjeseca, plaćamo samo naknadu po videu za videe koje možemo sami provjeriti<!--balkans-->, a bonus za preglede za taj mjesec propada<!--/balkans-->.

## 9. Završetak učešća

9.1 Ti ili mi možemo u bilo kojem trenutku završiti učešće s trenutnim učinkom, porukom e-poštom ili na Discordu. Razlog nije potreban.

9.2 Po završetku plaćamo prihvatljive videe objavljene do tog dana i zarađeni bonus, nakon što u roku od 7 dana pošalješ završni izvještaj.

9.3 Tačke 5, 7, 10, 11.3 i 13 važe i nakon završetka.

## 10. Povjerljivost

Upute, scenariji, sadržaj Discorda, rezultati, naknade drugih kreatora i neobjavljene funkcije Memo AI su povjerljivi. Koristiš ih samo za pravljenje videa za Memo AI; ne dijeliš ih i ne koristiš ni za koga drugog. To važi tokom učešća i još 2 godine nakon njega. Za svaku utvrđenu povredu plaćaš ugovornu kaznu od **1000 €**; ako dokažemo veću štetu, možemo zahtijevati i njenu naknadu.

## 11. Konkurencija

11.1 Tokom učešća ne praviš i ne objavljuješ sadržaj za direktne konkurente: aplikacije ili usluge kojima je glavna svrha pomoć pri učenju s vještačkom inteligencijom – naprimjer AI bilješke s predavanja, AI kartice, kvizovi i priprema za ispite te AI tutori. Opći sadržaj za druge brendove je dozvoljen.

11.2 Ako ti se javi konkurent, javi nam prije nego što na bilo šta pristaneš. Ako nisi siguran da li je brend konkurent, prvo nas pitaj.

11.3 Ako učešće završiš ti, ovo ograničenje važi još **1 mjesec** nakon završetka. Ako ga završimo mi, prestaje odmah.

11.4 U slučaju povrede ne dugujemo naknadu za videe napravljene tokom povrede, a učešće može odmah završiti.

## 12. Lični podaci

Lične podatke koje nam daješ (prijava, kontakt, podaci za isplatu i porez, zapis o prihvatanju uslova) obrađujemo radi provođenja programa, isplata i ispunjavanja zakonskih obaveza, kako je opisano u našoj politici privatnosti. Podatke o isplatama i porezu čuvamo onoliko dugo koliko zahtijeva zakon.

## 13. Ostale odredbe

13.1 Učestvuješ kao samostalni izvođač. Ovi uslovi ne stvaraju radni odnos, ortakluk ni zastupanje.

13.2 Uslove možemo promijeniti obavještenjem e-poštom ili na Discordu najmanje 7 dana unaprijed. Promjene naknade važe samo za videe objavljene nakon stupanja promjene na snagu. Ako se ne slažeš, možeš završiti učešće; ako nakon stupanja promjene na snagu nastaviš objavljivati, prihvataš nove uslove.

13.3 Ovi uslovi zajedno s uputama su cjelokupan dogovor između nas o programu.

13.4 Primjenjuje se slovensko pravo. O sporovima odlučuje nadležni sud u Kranju, Slovenija, osim ako ti prinudni propisi daju pravo na tužbu u mjestu prebivališta.

13.5 Uslovi su objavljeni na slovenskom, engleskom, hrvatskom, bosanskom i srpskom jeziku. U slučaju razlika važi slovenska verzija.

13.6 Kontakt: info@memoai.eu.
`,

  sr: `# Program za kreatore Memo AI – uslovi učešća

Verzija {version}

## 1. O ovim uslovima

Ovi uslovi učešća („uslovi”) su ugovor između tebe („kreator”) i **Memo AI, Nace Valenčič s.p., poslovno svetovanje**, Zgoša 87, 4275 Begunje na Gorenjskem, Slovenija, matični broj 7578474000, poreski broj 52958248 („Memo AI”, „mi”), koji razvija aplikaciju za učenje Memo AI.

Ugovor je zaključen kada nakon prihvatanja tvoje prijave otvoriš svoj lični link za pridruživanje, upišeš svoje ime i klikneš „Prihvati i pridruži se”. Čuvamo zapis o verziji uslova koju si prihvatio, datumu i vremenu i upisanom imenu. Od tada ovi uslovi uređuju tvoje učešće dok se ono ne završi prema tački 9.

Ako imaš manje od 18 godina, uslove sa tobom mora da prihvati roditelj ili zakonski staratelj. Upisom njegovog imena potvrđuješ da ih je pročitao i da se sa njima slaže.

## 2. Značenje pojmova

<!--si-->
- **Kampanja**: kampanja Slovenija u koju si primljen. Određuje tvoju naknadu (tačka 4) i tvoj Discord server.
<!--/si-->
<!--balkans-->
- **Kampanja**: kampanja Balkan (Hrvatska, Bosna i Hercegovina, Srbija, Crna Gora, Severna Makedonija) u koju si primljen. Određuje tvoju naknadu (tačka 4) i tvoj Discord server.
<!--/balkans-->
- **Snimak**: nov, originalan kratak video o Memo AI koji snimiš za program i koji još nije objavljen ni na jednom nalogu.
- **Prihvatljiv snimak**: snimak koji ispunjava tačku 3.2, objavljen je na javnom TikTok ili Instagram nalogu kojim upravljaš i ostaje objavljen kako zahteva tačka 7.
- **Uputstva**: uputstva, formati, primeri i povratne informacije koje ti dajemo na Discordu kampanje ili imejlom.
<!--si-->
- **Kod za popust**: tvoj lični Memo AI kod.
<!--/si-->
- **Pregledi**: pregledi tvojih prihvatljivih snimaka prema analitici platforme.

Izrazi u muškom rodu (na primer kreator) koriste se neutralno i jednako se odnose na sve polove.

## 3. Šta radiš

3.1 Snimke praviš i objavljuješ samostalno, prema sopstvenom rasporedu i u skladu sa uputstvima. Najmanji broj snimaka ne postoji, ali preporučujemo svakodnevno objavljivanje. Ako 14 dana zaredom ništa ne objaviš, možemo da završimo tvoje učešće (tačka 9).

3.2 Snimak je prihvatljiv ako: prati uputstva i naše povratne informacije; kvalitetom je bar jednak probnom snimku sa kojim si se prijavio; u njemu si ti; pravilno je označen kao oglas (tačka 6); i ne krši ove uslove, zakon ni pravila platforme.

3.3 Svaki snimak objavljuješ na TikToku, a isti snimak možeš da objaviš i u Instagram Reels-u; to je i dalje jedan prihvatljiv snimak, plaćen po platformama kako određuje tačka 4. Ponovna objava starijeg snimka je dozvoljena, ali nije nov prihvatljiv snimak (njegovi pregledi se broje tamo gde se plaćaju pregledi).

3.4 Naknade po snimku plaćaju se za najviše **{monthCap} prihvatljivih snimaka po kalendarskom mesecu**.

3.5 Koristiš sopstveni telefon i opremu i sam snosiš svoje troškove.

## 4. Naknada

<!--si-->
### Kampanja Slovenija

- **{siTikTok} za svaki prihvatljiv snimak objavljen na TikToku** i još **{siInstagram}** kad isti snimak objaviš i u Instagram Reels-u (ukupno do {siVideo} po snimku).
- **Bonus od {siShare} %** iznosa koji su u kalendarskom mesecu zaista platili kupci koji su pretplatu na Memo AI kupili sa tvojim kodom za popust, bez PDV-a, povraćaja i storniranih plaćanja, do najviše **{siCap} mesečno**.
<!--/si-->

<!--balkans-->
### Kampanja Balkan

- **{bkTikTok} za svaki prihvatljiv snimak objavljen na TikToku** i još **{bkInstagram}** kad isti snimak objaviš i u Instagram Reels-u (ukupno do {bkVideo} po snimku).
- **Bonus za preglede od {bkRate} na 1000 pregleda** koje tvoji prihvatljivi snimci sakupe u kalendarskom mesecu, do najviše **{bkCap} mesečno**.
<!--/balkans-->

### Isplata

4.1 Iznosi su u evrima i bruto su iznosi. Gde slovenački zakon od Memo AI zahteva da od isplate obustavi porez ili doprinose, obustavljamo ih i isplaćujemo ti ostatak; u suprotnom sam prijavljuješ i plaćaš svoje poreze. Za to nam daješ potrebne podatke (ime, adresu, poreski broj, bankovni račun).

4.2 Isplaćujemo jednom mesečno, za prethodni kalendarski mesec, u roku od 15 dana nakon što pošalješ mesečni izveštaj (tačka 8), na bankovni račun (IBAN) ili Revolut.

4.3 Procene i primeri zarade na našem sajtu su ilustracije, a ne garancije. Plaćamo samo prihvatljive snimke i bonus prema ovoj tački.

4.4 Ako nakon isplate utvrdimo da snimak nije bio prihvatljiv, iznos možemo da prebijemo sa sledećom isplatom.

## 5. Samo pravi pregledi

Zabranjeno je: plaćati promociju svojih snimaka (i alatima platforme kao što je TikTok Promote), osim ako se pismeno dogovorimo; kupovati preglede, lajkove, pratioce ili komentare; koristiti botove, automatizaciju, grupe za razmenu interakcija, „klik farme” ili nagrađivani saobraćaj; ili na bilo koji drugi način veštački povećavati preglede ili prodaju svojim kodom (uključujući kupovinu sopstvenim kodom radi bonusa) („prevara”).

Ako opravdano utvrdimo prevaru: za taj mesec ne dugujemo naknadu, neisplaćene iznose možemo da zadržimo, tvoje učešće može odmah da se završi, a ti plaćaš ugovornu kaznu od **1000 € za svaki utvrđeni slučaj**. Ako dokažemo veću štetu, možemo da zahtevamo i njenu naknadu.

## 6. Označavanje oglasa

Snimci su plaćeni oglasi. Svaki snimak moraš da označiš kao oglas podešavanjem platforme za plaćeno partnerstvo ili otkrivanje sadržaja i, gde to zatražimo, oznakom kao što je #oglas ili #ad, kako to zahtevaju zakon (uključujući slovenačke propise o zaštiti potrošača i Direktivu EU o nepoštenoj poslovnoj praksi) i pravila platforme. O Memo AI ne smeš da tvrdiš ništa što nije istina ili nije u uputstvima (na primer da obećavaš ocene).

## 7. Sadržaj i nalozi

7.1 Nalozi i snimci su tvoji. Memo AI-ju daješ neisključivu, besplatnu licencu za ceo svet da tvoje snimke, uključujući tvoj lik, glas i ime kako se u njima pojavljuju, koristi, kopira, uređuje, titluje i objavljuje na svojim kanalima, sajtu i u plaćenim oglasima (uključujući kao oglase sa tvog naloga, npr. TikTok Spark Ads, ako nam daš kod), tokom celog učešća i još **24 meseca** nakon njegovog završetka. Oglasi koji su u toku na isteku tog perioda mogu da se privedu kraju.

7.2 Svaki prihvatljiv snimak ostaje objavljen najmanje **90 dana** nakon objave i ne uređuješ ga tako da ukloniš oznaku oglasa ili Memo AI. Ako izgubiš nalog koji koristiš za program ili on bude blokiran, javi nam.

7.3 Tvoji snimci ne smeju da krše tuđa prava (muzika, lik drugih osoba, žigovi). Koristi licencirane zvukove platforme.

## 8. Mesečni izveštaj

Do 5. dana u mesecu preko Discorda ili imejla šalješ nam linkove do snimaka objavljenih u prethodnom mesecu i snimke ekrana analitike sa pregledima ili ono što zatražimo. Za svaki snimak možemo da zatražimo kompletnu analitiku. Isplata zavisi od izveštaja: ako ga ne pošalješ u roku od 30 dana od kraja meseca, plaćamo samo naknadu po snimku za snimke koje možemo sami da proverimo<!--balkans-->, a bonus za preglede za taj mesec propada<!--/balkans-->.

## 9. Završetak učešća

9.1 Ti ili mi možemo u bilo kom trenutku da završimo učešće sa trenutnim dejstvom, porukom imejlom ili na Discordu. Razlog nije potreban.

9.2 Po završetku plaćamo prihvatljive snimke objavljene do tog dana i zarađeni bonus, nakon što u roku od 7 dana pošalješ završni izveštaj.

9.3 Tačke 5, 7, 10, 11.3 i 13 važe i nakon završetka.

## 10. Poverljivost

Uputstva, scenariji, sadržaj Discorda, rezultati, naknade drugih kreatora i neobjavljene funkcije Memo AI su poverljivi. Koristiš ih samo za pravljenje snimaka za Memo AI; ne deliš ih i ne koristiš ni za koga drugog. To važi tokom učešća i još 2 godine nakon njega. Za svaku utvrđenu povredu plaćaš ugovornu kaznu od **1000 €**; ako dokažemo veću štetu, možemo da zahtevamo i njenu naknadu.

## 11. Konkurencija

11.1 Tokom učešća ne praviš i ne objavljuješ sadržaj za direktne konkurente: aplikacije ili usluge kojima je glavna svrha pomoć pri učenju uz veštačku inteligenciju – na primer AI beleške sa predavanja, AI kartice, kvizovi i priprema za ispite i AI tutori. Opšti sadržaj za druge brendove je dozvoljen.

11.2 Ako ti se javi konkurent, javi nam pre nego što na bilo šta pristaneš. Ako nisi siguran da li je brend konkurent, prvo nas pitaj.

11.3 Ako učešće završiš ti, ovo ograničenje važi još **1 mesec** nakon završetka. Ako ga završimo mi, prestaje odmah.

11.4 U slučaju povrede ne dugujemo naknadu za snimke napravljene tokom povrede, a učešće može odmah da se završi.

## 12. Lični podaci

Lične podatke koje nam daješ (prijava, kontakt, podaci za isplatu i porez, zapis o prihvatanju uslova) obrađujemo radi sprovođenja programa, isplata i ispunjavanja zakonskih obaveza, kako je opisano u našoj politici privatnosti. Podatke o isplatama i porezu čuvamo onoliko dugo koliko zahteva zakon.

## 13. Ostale odredbe

13.1 Učestvuješ kao samostalni izvođač. Ovi uslovi ne stvaraju radni odnos, ortačko društvo ni zastupanje.

13.2 Uslove možemo da promenimo obaveštenjem imejlom ili na Discordu najmanje 7 dana unapred. Promene naknade važe samo za snimke objavljene posle stupanja promene na snagu. Ako se ne slažeš, možeš da završiš učešće; ako posle stupanja promene na snagu nastaviš da objavljuješ, prihvataš nove uslove.

13.3 Ovi uslovi zajedno sa uputstvima su celokupan dogovor između nas o programu.

13.4 Primenjuje se slovenačko pravo. O sporovima odlučuje nadležni sud u Kranju, Slovenija, osim ako ti prinudni propisi daju pravo na tužbu u mestu prebivališta.

13.5 Uslovi su objavljeni na slovenačkom, engleskom, hrvatskom, bosanskom i srpskom jeziku. U slučaju razlika važi slovenačka verzija.

13.6 Kontakt: info@memoai.eu.
`,
} as const;
