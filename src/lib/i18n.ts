export const LOCALE_COOKIE_NAME = "memo_locale";

export const SUPPORTED_LOCALES = ["sl-SI", "cs-CZ"] as const;

export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = "sl-SI";
export const CZECH_LOCALE: AppLocale = "cs-CZ";

export type LocaleDictionary = {
  brand: {
    tagline: string;
    shortline: string;
    seoDescription: string;
  };
  common: {
    and: string;
    back: string;
    close: string;
    home: string;
    language: string;
    slovenian: string;
    czech: string;
  };
  landing: {
    navCta: string;
    proofItems: readonly string[];
    heroTitle: string;
    heroCopy: string;
    primaryCta: string;
    secondaryCta: string;
    benefitsLabel: string;
    workflowEyebrow: string;
    workflowTitle: string;
    workflowSteps: readonly { icon: string; title: string; detail: string }[];
    featuresEyebrow: string;
    featuresTitle: string;
    featureCards: readonly { icon: string; title: string; detail: string }[];
    examplesEyebrow: string;
    examplesTitle: string;
    studyExamples: readonly { label: string; title: string; detail: string; meta: string }[];
    story: {
      aria: string;
      choose: string;
      show: string;
      previous: string;
      next: string;
      navigation: string;
      slides: readonly { kind: string; title: string; caption: string; label: string; image: string }[];
    };
  };
  auth: {
    signIn: string;
    signInCopy: string;
    legalPrefix: string;
    terms: string;
    privacy: string;
    legalSuffix: string;
    continueGoogle: string;
    continueApple: string;
    continueEmail: string;
    redirecting: string;
    opening: string;
    welcomeBack: string;
    createAccount: string;
    loginCopy: string;
    signupCopy: string;
    loginEyebrow: string;
    signupEyebrow: string;
    googleLogin: string;
    googleSignup: string;
    appleLogin: string;
    appleSignup: string;
    emailLogin: string;
    emailSignup: string;
    or: string;
    emailHelper: string;
    emailPlaceholder: string;
    sendingCode: string;
    firstTime: string;
    alreadyAccount: string;
    checkEmail: string;
    enterCode: string;
    fallbackEmail: string;
    codeSent: (email: string) => string;
    emailQuestion: string;
    emailEntryCopy: string;
    authErrorEyebrow: string;
    authErrorTitle: string;
    authErrorCopy: string;
    backToLogin: string;
  };
  appShell: {
    tabs: readonly { href: string; displayLabel: string; icon: string }[];
    startTitle: string;
    startSubtitle: string;
    noteTitle: string;
    noteSubtitle: string;
    helpTitle: string;
    helpArticleSubtitle: string;
    helpSubtitle: string;
    settingsTitle: string;
    settingsSubtitle: string;
    notesTitle: string;
    notesSubtitle: string;
    buy: string;
    mainNavigation: string;
    sideNavigation: string;
  };
  settings: {
    title: string;
    theme: string;
    subscription: string;
    package: string;
    noSubscription: string;
    onboardingPayment: string;
    choosePlan: string;
    account: string;
    signedIn: string;
    signedInFallback: string;
    redeemCode: string;
    privacy: string;
    help: string;
    share: string;
    shareSubject: string;
    shareBody: string;
    featureRequest: string;
    languageTitle: string;
    languageDetail: string;
    logout: string;
    loggingOut: string;
    billingPortal: string;
    billingPortalError: string;
  };
  theme: {
    system: string;
    light: string;
    dark: string;
  };
  help: {
    pageTitle: string;
    categories: {
      frequent: string;
      recording: string;
      account: string;
    };
    articles: readonly HelpArticleTranslation[];
  };
  ui: Record<string, string>;
};

export type HelpArticleCategoryKey = "frequent" | "recording" | "account";

export type HelpArticleTranslation = {
  slug: string;
  title: string;
  category: HelpArticleCategoryKey;
  content: string;
};

const commonUiCs = {
  "Nazaj": "Zpět",
  "Zapri": "Zavřít",
  "Domov": "Domů",
  "Pomoč": "Pomoc",
  "Pojdi na": "Přejít na",
  "Odpri navigacijo": "Otevřít navigaci",
  "Nastavitve": "Nastavení",
  "Začni": "Začít",
  "Zapiski": "Poznámky",
  "Zapisek": "Poznámka",
  "Učenje": "Učení",
  "Klepet": "Chat",
  "Prepis": "Přepis",
  "Zvok": "Audio",
  "Kupi": "Koupit",
  "Prijava": "Přihlášení",
  "Registracija": "Registrace",
  "Ustvari račun": "Vytvořit účet",
  "Odjava": "Odhlásit se",
  "Odjavljam...": "Odhlašuji...",
  "Tema": "Motiv",
  "Sistem": "Systém",
  "Svetla": "Světlý",
  "Temna": "Tmavý",
  "Naročnina": "Předplatné",
  "Paket": "Balíček",
  "Brez naročnine": "Bez předplatného",
  "Izberi paket": "Vybrat balíček",
  "Račun": "Účet",
  "Prijavljen": "Přihlášený účet",
  "Unovči kodo": "Uplatnit kód",
  "Zasebnost": "Soukromí",
  "Deli": "Sdílet",
  "Predlagaj funkcijo": "Navrhnout funkci",
  "Uredi naročnino": "Upravit předplatné",
  "Nalaganje": "Nahrávání",
  "V čakalni vrsti": "Ve frontě",
  "Prepisovanje": "Přepisuji",
  "Ustvarjanje zapiskov": "Vytvářím poznámky",
  "Pripravljeno": "Hotovo",
  "Napaka": "Chyba",
  "Posnemi predavanje": "Nahrát přednášku",
  "Naloži zvok": "Nahrát audio",
  "Prilepi besedilo ali PDF": "Vložit text nebo PDF",
  "Dodaj povezavo": "Přidat odkaz",
  "Začni z enim dotikom": "Začni jedním klepnutím",
  "MP3, M4A, WAV ali WEBM": "MP3, M4A, WAV nebo WEBM",
  "Pretvori gradivo v strukturirane zapiske": "Převeď materiál na strukturované poznámky",
  "Spletni članek ali vir": "Webový článek nebo zdroj",
  "Povezava": "Odkaz",
  "Besedilo": "Text",
  "Predstavitev": "Prezentace",
  "PDF": "PDF",
  "Neimenovan zapisek": "Nepojmenovaná poznámka",
  "Išči po naslovu": "Hledat podle názvu",
  "Nov zapisek": "Nová poznámka",
  "Nadgradi za nov zapisek": "Upgradovat pro novou poznámku",
  "Moji zapiski": "Moje poznámky",
  "Vsi zapiski": "Všechny poznámky",
  "Tvoja knjižnica je prazna": "Tvoje knihovna je prázdná",
  "Začni s posnetkom, zvočno datoteko, PDF-jem, PPTX-om, besedilom ali povezavo.": "Začni nahrávkou, audio souborem, PDF, PPTX, textem nebo odkazem.",
  "Ni ujemajočih zapiskov": "Žádné odpovídající poznámky",
  "Ta mapa je prazna": "Tahle složka je prázdná",
  "Poskusi krajši iskalni izraz ali počisti iskanje.": "Zkus kratší hledaný výraz nebo vymaž hledání.",
  "Dodaj predavanja v to mapo ali se vrni na vse zapiske.": "Přidej přednášky do téhle složky nebo se vrať na všechny poznámky.",
  "Ustvari svoj prvi zapisek": "Vytvoř první poznámku",
  "Potrebno pozornosti": "Vyžaduje pozornost",
  "Napaka pri obdelavi zapiska": "Chyba při zpracování poznámky",
  "Napaka pri ustvarjanju zapiska": "Chyba při vytváření poznámky",
  "Poskusi znova ali odstrani zapisek iz knjižnice.": "Zkus to znovu nebo poznámku odeber z knihovny.",
  "Izbriši": "Smazat",
  "Poskusi znova": "Zkusit znovu",
  "Zapri meni za nov zapisek": "Zavřít menu nové poznámky",
  "Povleci navzdol za zapiranje": "Potáhni dolů pro zavření",
  "Nova mapa": "Nová složka",
  "Uredi mape": "Upravit složky",
  "Preimenuj zapisek": "Přejmenovat poznámku",
  "Izbriši zapisek": "Smazat poznámku",
  "Snemaj": "Nahrávat",
  "Naloži": "Nahrát",
  "Dokumenti": "Dokumenty",
  "Prilepi besedilo ali dokument": "Vložit text nebo dokument",
  "Jezik": "Jazyk",
  "Ustvari zvok": "Vytvořit audio",
  "Datoteka": "Soubor",
  "Skeniraj": "Skenovat",
  "Ustvari": "Vytvořit",
  "Zapri": "Zavřít",
  "Dodaj fotografijo": "Přidat fotku",
  "Odstrani fotografijo": "Odebrat fotku",
  "Prilepi vsebino predavanja ali članka...": "Vlož obsah přednášky nebo článku...",
  "Sem prilepi zapiske ali besedilo...": "Sem vlož poznámky nebo text...",
  "https://example.com": "https://example.com",
  "Jezik zapiskov": "Jazyk poznámek",
  "Ustvari zapiske": "Vytvořit poznámky",
  "Ustvarjam zapiske...": "Vytvářím poznámky...",
  "Flashcards": "Flashcards",
  "Kviz": "Quiz",
  "Kvizi": "Quiz",
  "Test": "Test",
  "Testi": "Test",
  "AI chat": "AI chat",
  "Vprašaj o tem predavanju": "Zeptej se na tuto přednášku",
  "Pošlji sporočilo": "Odeslat zprávu",
  "Nadaljuj": "Pokračovat",
  "Preverjam...": "Ověřuji...",
  "Pošiljam...": "Odesílám...",
  "Pošlji novo kodo": "Poslat nový kód",
  "Uporabi drugo metodo": "Použít jiný způsob",
  "Koda velja 5 minut. Če zahtevaš novo, uporabi samo najnovejšo kodo.": "Kód platí 5 minut. Pokud si vyžádáš nový, použij jen nejnovější kód.",
  "Vnesi kodo": "Zadej kód",
  "Vnesi e-naslov": "Zadej e-mail",
  "Uredi kartice": "Upravit Flashcards",
  "Uredi kviz": "Upravit Quiz",
  "Zapri urejanje": "Zavřít úpravy",
  "Poišči...": "Hledat...",
  "Vprašanje": "Otázka",
  "Odgovor": "Odpověď",
  "Shrani": "Uložit",
  "Shranjevanje ni uspelo.": "Uložení se nezdařilo.",
  "Kartice ni bilo mogoče shraniti.": "Flashcard se nepodařilo uložit.",
  "Kartice ni bilo mogoče izbrisati.": "Flashcard se nepodařilo smazat.",
  "Vprašanja ni bilo mogoče shraniti.": "Otázku se nepodařilo uložit.",
  "Vprašanja ni bilo mogoče izbrisati.": "Otázku se nepodařilo smazat.",
  "Začni znova": "Začít znovu",
  "Prejšnja kartica": "Předchozí karta",
  "Naslednja kartica": "Další karta",
  "Nisem vedel": "Nevěděl jsem",
  "Vedel sem": "Věděl jsem",
  "Pravilni odgovori": "Správné odpovědi",
  "Pravilno v tem krogu": "Správně v tomto kole",
  "Predelana vprašanja": "Procvičené otázky",
  "Dosežene točke": "Získané body",
  "Povprečje": "Průměr",
  "Najboljši rezultat": "Nejlepší výsledek",
  "Najnižji rezultat": "Nejnižší výsledek",
  "Poskusi": "Pokusy",
  "Sem napiši svoj odgovor...": "Sem napiš svou odpověď...",
  "Označi": "Zvýraznit",
  "Podčrtaj": "Podtrhnout",
  "Barva": "Barva",
  "Barva označevanja": "Barva zvýraznění",
  "Hitrost branja": "Rychlost čtení",
  "Nastavitve poslušanja": "Nastavení poslechu",
  "Zapri nastavitve poslušanja": "Zavřít nastavení poslechu",
  "Poslušanje ni na voljo.": "Poslech není dostupný.",
  "Za začetek poslušanja pritisni še enkrat.": "Pro spuštění poslechu klepni ještě jednou.",
  "Oranžna": "Oranžová",
  "Rumena": "Žlutá",
  "Zelena": "Zelená",
  "Modra": "Modrá",
  "Roza": "Růžová",
  "Pomoč": "Pomoc",
  "Pogosto": "Časté",
  "Snemanje in zapiski": "Nahrávání a poznámky",
  "Račun in dostop": "Účet a přístup",
  "Manj kot 16": "Méně než 16",
  "Srednja šola": "Střední škola",
  "Fakulteta": "Vysoká škola",
  "Magisterij": "Magisterské studium",
  "Samostojno učenje": "Samostudium",
  "Drugo": "Jiné",
  "Prijatelj": "Kamarád",
  "Zame": "Pro mě",
  "Zame + družina": "Pro mě + rodinu",
  "Za nekoga drugega (ne zame)": "Pro někoho jiného",
  "Zaposlen/a": "Pracuji",
  "Sestanki, glasovni zapiski in drugo": "Schůzky, hlasové poznámky a další",
  "Osnovnošolec": "Žák základní školy",
  "Učenje, domače naloge in priprava na teste": "Učení, domácí úkoly a příprava na testy",
  "Dijak": "Středoškolák",
  "Zapiski, testi in matura": "Poznámky, testy a maturita",
  "Študent": "Student",
  "Predavanja, izpiti/testi in študijsko gradivo": "Přednášky, zkoušky/testy a studijní materiály",
  "Starš": "Rodič",
  "Preizkus za otroka ali darilo naročnine": "Vyzkoušení pro dítě nebo dárek předplatného",
  "Učitelj/profesor": "Učitel/profesor",
  "Snemanje predavanj, deljenje zapiskov ali drugo": "Nahrávání přednášek, sdílení poznámek nebo jiné",
  "Osnovna šola": "Základní škola",
  "Nekaj drugega": "Něco jiného",
  "Gimnazija": "Gymnázium",
  "Srednja strokovna šola": "Střední odborná škola",
  "Poklicna šola": "Učiliště",
  "Fakulteta / univerza": "Vysoká škola / univerzita",
  "Višja šola": "Vyšší odborná škola",
  "1. razred": "1. třída",
  "2. razred": "2. třída",
  "3. razred": "3. třída",
  "4. razred": "4. třída",
  "5. razred": "5. třída",
  "6. razred": "6. třída",
  "7. razred": "7. třída",
  "8. razred": "8. třída",
  "9. razred": "9. třída",
  "1. letnik": "1. ročník",
  "2. letnik": "2. ročník",
  "3. letnik": "3. ročník",
  "4. letnik ali več": "4. ročník nebo víc",
  "Podiplomski študij": "Postgraduální studium",
  "Umetnost in humanistika": "Umění a humanitní obory",
  "Ekonomija": "Ekonomie",
  "Računalništvo": "Informatika",
  "Matematika": "Matematika",
  "Pedagoške smeri": "Pedagogické obory",
  "Inženirstvo in tehnologija": "Inženýrství a technologie",
  "Zdravstvo in medicina": "Zdravotnictví a medicína",
  "Pravo": "Právo",
  "Naravoslovje": "Přírodní vědy",
  "Družboslovje": "Společenské vědy",
  "Izboljšati ocene": "Zlepšit známky",
  "Učiti se 10x hitreje": "Učit se 10x rychleji",
  "Bolje slediti predavanjem": "Lépe sledovat přednášky",
  "Ne zamuditi podrobnosti na predavanju": "Nepřicházet o detaily na přednášce",
  "Audio zapiski": "Audio poznámky",
  "Personalizacija zapiskov": "Personalizace poznámek",
  "Branje zapiskov": "Čtení poznámek",
  "Da, določen predmet": "Ano, konkrétní předmět",
  "Da, prihajajoči izpit/test": "Ano, nadcházející zkouška/test",
  "Da, nekaj drugega": "Ano, něco jiného",
  "Ne, pomagaj mi na splošno": "Ne, pomoz mi obecně",
  "Sproščeno - 10 min / dan": "Lehce - 10 min / den",
  "Redno - 20 min / dan": "Pravidelně - 20 min / den",
  "Resno - 60 min / dan": "Vážně - 60 min / den",
  "Intenzivno - 90+ min / dan": "Intenzivně - 90+ min / den",
  "Izberi Add to Home Screen": "Vyber Add to Home Screen",
  "Klikni Share": "Klepni na Share",
  "V Safariju odpri meni in pritisni Share.": "V Safari otevři menu a klepni na Share.",
  "V share meniju pritisni Add to Home Screen.": "V menu Share klepni na Add to Home Screen.",
  "Pritisni Add": "Klepni na Add",
  "Ime lahko pustiš Memo AI in potrdiš z Add.": "Název můžeš nechat Memo AI a potvrdit tlačítkem Add.",
  "Naslednjič ga odpreš kot aplikacijo.": "Příště ho otevřeš jako aplikaci.",
  "Safari meni z možnostjo Share": "Menu Safari s možností Share",
  "iPhone delilni meni z možnostjo Add to Home Screen": "Sdílecí menu iPhonu s možností Add to Home Screen",
  "Memo AI ikona na začetnem zaslonu iPhona": "Ikona Memo AI na domovské obrazovce iPhonu",
  "Memo AI je zdaj na Home Screenu": "Memo AI je teď na Home Screenu",
  "Kateri razred si?": "Do které třídy chodíš?",
  "Kateri letnik si?": "Ve kterém jsi ročníku?",
  "Plačilo prejeto. Stripe trenutno zaključuje aktivacijo naročnine.": "Platba přijata. Stripe právě dokončuje aktivaci předplatného.",
  "Plačilo je bilo preklicano. Spodaj lahko ponovno izbereš paket.": "Platba byla zrušena. Níže můžeš znovu vybrat balíček.",
  "Onboardinga ni bilo mogoče shraniti.": "Onboarding se nepodařilo uložit.",
  "Izberi povprečno oceno": "Vyber průměrnou známku",
  "Znižaj oceno": "Snížit známku",
  "Zvišaj oceno": "Zvýšit známku",
  "Kako si izvedel/a za Memo AI?": "Jak ses dozvěděl/a o Memo AI?",
  "Za koga je Memo AI?": "Pro koho je Memo AI?",
  "Kaj te najbolje opiše?": "Co tě nejlépe vystihuje?",
  "Kje se šolaš?": "Kde studuješ?",
  "Katero je tvoje glavno področje študija?": "Jaký je tvůj hlavní obor studia?",
  "Veliko tvojih sošolcev že uporablja Memo AI za:": "Hodně tvých spolužáků už používá Memo AI na:",
  "Si v dobri družbi!": "Jsi v dobré společnosti!",
  "Podrobne zapiske s predavanj": "Podrobné poznámky z přednášek",
  "Natančne prepise": "Přesné přepisy",
  "Klepet z dolgimi PDF-ji in dokumenti": "Chat s dlouhými PDF a dokumenty",
  "AI vaje za izpite/teste": "AI cvičení na zkoušky/testy",
  "Kaj te pripelje v Memo AI?": "Co tě přivádí do Memo AI?",
  "Kakšna je tvoja povprečna ocena zdaj?": "Jaký máš teď průměr známek?",
  "Približek je v redu.": "Přibližný odhad stačí.",
  "Kakšna je tvoja ciljna povprečna ocena?": "Jaký průměr známek chceš mít?",
  "Na pravem mestu si.": "Jsi na správném místě.",
  "Študent financ": "Student financí",
  "Univerza v Ljubljani": "Univerzita v Lublani",
  "Nepogrešljivo za hiter tempo na fakulteti. V predavalnici sem bolj miren, ker vem, da lahko pozneje znova pregledam vse pomembne razlage.": "Skvělé pro rychlé tempo na vysoké. Na přednášce jsem klidnější, protože vím, že si později můžu znovu projít všechna důležitá vysvětlení.",
  "5 od 5 zvezdic": "5 z 5 hvězdiček",
  "Naredil/a si prvi korak!": "Udělala jsi první krok!",
  "Preskoči": "Přeskočit",
  "Z rednim delom ti Memo AI pomaga doseči dolgoročen napredek.": "Pravidelná práce s Memo AI ti pomůže dosáhnout dlouhodobého pokroku.",
  "Primer napredka ocen": "Ukázka zlepšení známek",
  "Tvoje ocene": "Tvoje známky",
  "z Memo AI": "s Memo AI",
  "samostojno": "samostatně",
  "Kateri del Memo AI-ja ti bo najbolj pomagal?": "Která část Memo AI ti pomůže nejvíc?",
  "Imaš v mislih določen predmet ali izpit/test, pri katerem naj ti Memo AI pomaga?": "Máš konkrétní předmět nebo zkoušku/test, se kterým ti má Memo AI pomoct?",
  "Kakšen je tvoj dnevni študijski cilj?": "Jaký je tvůj denní studijní cíl?",
  "Dodaj Memo AI na homescreen": "Přidej Memo AI na Home Screen",
  "Plačila ni bilo mogoče začeti.": "Platbu se nepodařilo spustit.",
  "Plačilo je bilo preklicano. Spodaj lahko ponovno izbereš paket.": "Platba byla zrušena. Níže si můžeš znovu vybrat balíček.",
  "Zapri ponudbo naročnine": "Zavřít nabídku předplatného",
  "Nadgradi in ustvarjaj več zapiskov": "Upgraduj a vytvářej víc poznámek",
  "Neomejeni zapiski": "Neomezené poznámky",
  "Naloži neomejeno PDF-jev in zvoka": "Nahrávej neomezeně PDF a audio",
  "Pametna učna orodja": "Chytré studijní nástroje",
  "Personalizirane vaje za boljše rezultate": "Personalizovaná cvičení pro lepší výsledky",
  "Uči se 10x hitreje": "Uč se 10x rychleji",
  "Pospeši učenje z AI podporo": "Zrychli učení s AI podporou",
  "Izberi paket": "Vybrat balíček",
  "Letno": "Ročně",
  "Mesečno": "Měsíčně",
  "/ mesec": "/ měsíc",
  "Obračunano mesečno": "Účtováno měsíčně",
  "Obračunano letno": "Účtováno ročně",
  "Najbolj priljubljeno": "Nejoblíbenější",
  "Prihrani": "Ušetři",
  "Danes brez plačila": "Dnes bez platby",
  "Varno plačilo prek Stripe": "Bezpečná platba přes Stripe",
  "Trenutni paket": "Aktuální balíček",
  "Začni 3-dnevni brezplačni preizkus": "Začít 3denní bezplatnou zkoušku",
  "Nadaljuj na plačilo": "Pokračovat k platbě",
  "Prekliči kadarkoli": "Zrušit můžeš kdykoliv",
  "Koraki za Home Screen": "Kroky pro Home Screen",
  "Prejšnji korak": "Předchozí krok",
  "Prikaži korak": "Zobrazit krok",
  "Naslednji korak": "Další krok",
  "Končaj": "Dokončit",
} as const;

export const dictionaries = {
  "sl-SI": {
    brand: {
      tagline: "Zapiski predavanj, prepisi in učni klepet",
      shortline: "AI zapiski predavanj",
      seoDescription:
        "Memo AI pretvori predavanja, PDF-je, dokumente in povezave v prepise, povzetke, flashcarde, kvize, teste in AI klepet.",
    },
    common: {
      and: "in",
      back: "Nazaj",
      close: "Zapri",
      home: "Domov",
      language: "Jezik",
      slovenian: "Slovenščina",
      czech: "Češčina",
    },
    landing: {
      navCta: "Preizkusi za 0 €",
      proofItems: ["Prepisi", "Flashcardi", "Kvizi", "Testi", "AI chat"],
      heroTitle: "Nikoli več ne piši zapiskov!",
      heroCopy:
        "Memo AI je tvoj AI notetaker za predavanja. Iz audio posnetkov, PDF-jev, dokumentov in povezav pripravi zapiske, prepise, flashcarde, kvize, teste in AI chat.",
      primaryCta: "Preizkusi za 0 €",
      secondaryCta: "Prijavi se",
      benefitsLabel: "Prednosti",
      workflowEyebrow: "Kako deluje",
      workflowTitle: "Memo vse poenostavi.",
      workflowSteps: [
        { icon: "🎙️", title: "1. Posnemi ali naloži", detail: "Predavanja, PDF-je, dokumente, povezave in besedilo." },
        { icon: "📝", title: "2. Dobi zapiske", detail: "Urejeni zapiski in prepis so pripravljeni v istem prostoru." },
        { icon: "🧠", title: "3. Ponavljaj snov", detail: "Flashcardi, kvizi, testi in AI chat z zapiski." },
      ],
      featuresEyebrow: "Funkcije",
      featuresTitle: "Zajemi, uredi in se uči hitreje",
      featureCards: [
        { icon: "🎙️", title: "Posnemi ali naloži", detail: "Predavanja, PDF-je, dokumente, povezave in prilepljeno besedilo." },
        { icon: "🗒️", title: "Dobi clean zapiske", detail: "Urejeni zapiski in prepisi brez ročnega prepisovanja." },
        { icon: "🧠", title: "Flashcardi", detail: "Ključni pojmi se spremenijo v kartice za hitro ponavljanje." },
        { icon: "✅", title: "Kvizi", detail: "Preveri razumevanje z vprašanji iz svojega gradiva." },
        { icon: "🧪", title: "Testi", detail: "Vadi daljše odgovore in pripravo na preverjanje znanja." },
        { icon: "🎧", title: "Poslušaj zapiske", detail: "Aplikacija ti zapiske prebere na glas, da jih lahko ponavljaš tudi brez gledanja v ekran." },
      ],
      examplesEyebrow: "Učno gradivo",
      examplesTitle: "Flashcardi, kvizi, testi in AI chat iz istega zapiska.",
      studyExamples: [
        { label: "Flashcard", title: "Kaj je aktivni transport?", detail: "Premik snovi skozi membrano proti koncentracijskemu gradientu, zato porabi energijo.", meta: "Pokaži odgovor" },
        { label: "Kviz", title: "Encimi najpogosteje delujejo kot ...", detail: "Biološki katalizatorji, ki znižajo aktivacijsko energijo reakcije.", meta: "Pravilno" },
        { label: "Test", title: "Primerjaj mitozo in mejozo.", detail: "Odgovor naj razloži število delitev, nastale celice in genetsko raznolikost.", meta: "Vaja za izpit" },
        { label: "Klepet", title: "Zakaj je to pomembno za izpit?", detail: "Ker se isti pojmi pogosto pojavijo v nalogah razlage, primerjave in uporabe.", meta: "Vprašaj gradivo" },
      ],
      story: {
        aria: "Primeri učnega gradiva",
        choose: "Izberi primer",
        show: "Pokaži",
        previous: "Prejšnji primer",
        next: "Naslednji primer",
        navigation: "Story navigacija",
        slides: [
          { kind: "notes", title: "Clean zapiski", caption: "Predavanje postane urejen povzetek.", label: "Zapiski", image: "/IMG_6651.png" },
          { kind: "flashcards", title: "Flashcardi", caption: "Ključni pojmi za hitro ponavljanje.", label: "Flashcardi", image: "/IMG_6653.png" },
          { kind: "quiz", title: "Kvizi", caption: "Vprašanja iz tvojega gradiva.", label: "Kvizi", image: "/IMG_6654.png" },
          { kind: "test", title: "Testi", caption: "Vaja za daljše odgovore in izpite.", label: "Testi", image: "/IMG_6655.png" },
          { kind: "chat", title: "AI chat", caption: "Vprašaj zapisek in dobi odgovor.", label: "AI chat", image: "/IMG_6656.png" },
          { kind: "reading", title: "Branje zapiskov", caption: "Poslušaj in beri zapiske na telefonu.", label: "Branje zapiskov", image: "/IMG_6657.png" },
        ],
      },
    },
    auth: {
      signIn: "Prijava",
      signInCopy: "Prijavi se ali ustvari nov račun.",
      legalPrefix: "Z nadaljevanjem se strinjaš s",
      terms: "pogoji uporabe",
      privacy: "politiko zasebnosti",
      legalSuffix:
        "vključno z AI obdelavo zvoka, besedila, dokumentov in povezav. Potrjuješ tudi, da imaš potrebna dovoljenja za snemanje, nalaganje in uporabo gradiva, ki ga pošlješ v Memo.",
      continueGoogle: "Nadaljuj z Google",
      continueApple: "Nadaljuj z Apple",
      continueEmail: "Nadaljuj z e-pošto",
      redirecting: "Preusmerjam...",
      opening: "Odpiram...",
      welcomeBack: "Dobrodošel nazaj",
      createAccount: "Ustvari svoj račun",
      loginCopy: "Nadaljuj tam, kjer si ostal, s prepisom, zapiski, karticami in klepetom.",
      signupCopy: "Začni z enim predavanjem in v enem prostoru dobi prepis, povzetek, kartice in klepet.",
      loginEyebrow: "Prijava",
      signupEyebrow: "Registracija",
      googleLogin: "Prijava z Google",
      googleSignup: "Ustvari račun z Google",
      appleLogin: "Prijava z Apple",
      appleSignup: "Ustvari račun z Apple",
      emailLogin: "Pošlji mi prijavno povezavo",
      emailSignup: "Pošlji mi povezavo za registracijo",
      or: "ali",
      emailHelper: "Na tvoj e-naslov bomo poslali potrditveno kodo.",
      emailPlaceholder: "Vnesi svoj e-naslov",
      sendingCode: "Pošiljam kodo...",
      firstTime: "Si tukaj prvič?",
      alreadyAccount: "Že imaš račun?",
      checkEmail: "Preveri e-pošto",
      enterCode: "Vnesi kodo",
      fallbackEmail: "tvoj e-naslov",
      codeSent: (email: string) => `Na ${email} smo poslali potrditveno kodo. Velja 5 minut. Če zahtevaš novo, uporabi samo najnovejšo kodo.`,
      emailQuestion: "Kateri je tvoj e-naslov?",
      emailEntryCopy: "Vnesi svoj e-naslov in poslali ti bomo potrditveno kodo.",
      authErrorEyebrow: "Napaka pri prijavi",
      authErrorTitle: "Prijava ni uspela",
      authErrorCopy: "Poskusi drugo metodo prijave ali preveri, ali so ponudniki prijave pravilno nastavljeni.",
      backToLogin: "Nazaj na prijavo",
    },
    appShell: {
      tabs: [
        { href: "/app", displayLabel: "Domov", icon: "🏠" },
        { href: "/app/support", displayLabel: "Pomoč", icon: "❓" },
        { href: "/app/settings", displayLabel: "Nastavitve", icon: "⚙️" },
      ],
      startTitle: "Začni",
      startSubtitle: "Prilagodi aplikacijo in izberi paket",
      noteTitle: "Zapisek",
      noteSubtitle: "Preglej in klepetaj o vsebini",
      helpTitle: "Pomoč",
      helpArticleSubtitle: "Vodnik za uporabo",
      helpSubtitle: "Vodniki",
      settingsTitle: "Nastavitve",
      settingsSubtitle: "Tema in račun",
      notesTitle: "Zapiski",
      notesSubtitle: "Celotna knjižnica na enem mestu",
      buy: "Kupi",
      mainNavigation: "Glavna navigacija",
      sideNavigation: "Stranska navigacija",
    },
    settings: {
      title: "Nastavitve",
      theme: "Tema",
      subscription: "Naročnina",
      package: "Paket",
      noSubscription: "Brez naročnine",
      onboardingPayment: "Pred vstopom v glavno aplikacijo uporabnik najprej opravi onboarding in plačilo.",
      choosePlan: "Izberi paket",
      account: "Račun",
      signedIn: "Prijavljen",
      signedInFallback: "Prijavljen uporabnik",
      redeemCode: "Unovči kodo",
      privacy: "Zasebnost",
      help: "Pomoč",
      share: "Deli",
      shareSubject: "Preizkusi Memo",
      shareBody: "Uporabljam Memo za zapiske predavanj in mislim, da bi ti lahko prišel prav.",
      featureRequest: "Predlagaj funkcijo",
      languageTitle: "Jezik",
      languageDetail: "Izberi jezik aplikacije.",
      logout: "Odjava",
      loggingOut: "Odjavljam...",
      billingPortal: "Uredi naročnino",
      billingPortalError: "Portala za obračun ni bilo mogoče odpreti.",
    },
    theme: { system: "Sistem", light: "Svetla", dark: "Temna" },
    help: {
      pageTitle: "Pomoč",
      categories: { frequent: "Pogosto", recording: "Snemanje in zapiski", account: "Račun in dostop" },
      articles: [],
    },
    ui: {},
  },
  "cs-CZ": {
    brand: {
      tagline: "Poznámky z přednášek, přepisy a AI chat pro učení",
      shortline: "AI poznámky z přednášek",
      seoDescription:
        "Memo AI převede přednášky, PDF, dokumenty a odkazy na přepisy, shrnutí, Flashcards, Quiz, Test a AI chat.",
    },
    common: {
      and: "a",
      back: "Zpět",
      close: "Zavřít",
      home: "Domů",
      language: "Jazyk",
      slovenian: "Slovinština",
      czech: "Čeština",
    },
    landing: {
      navCta: "Vyzkoušet za 0 €",
      proofItems: ["Přepisy", "Flashcards", "Quiz", "Test", "AI chat"],
      heroTitle: "Už nikdy nepiš poznámky ručně!",
      heroCopy:
        "Memo AI je tvůj AI notetaker na přednášky. Z audia, PDF, dokumentů a odkazů vytvoří poznámky, přepisy, Flashcards, Quiz, Test a AI chat.",
      primaryCta: "Vyzkoušet za 0 €",
      secondaryCta: "Přihlásit se",
      benefitsLabel: "Výhody",
      workflowEyebrow: "Jak to funguje",
      workflowTitle: "Memo všechno zjednoduší.",
      workflowSteps: [
        { icon: "🎙️", title: "1. Nahraj nebo přidej", detail: "Přednášky, PDF, dokumenty, odkazy a text." },
        { icon: "📝", title: "2. Získej poznámky", detail: "Uspořádané poznámky a přepis máš připravené na jednom místě." },
        { icon: "🧠", title: "3. Opakuj si látku", detail: "Flashcards, Quiz, Test a AI chat z tvých poznámek." },
      ],
      featuresEyebrow: "Funkce",
      featuresTitle: "Zachyť, upravuj a uč se rychleji",
      featureCards: [
        { icon: "🎙️", title: "Nahraj nebo přidej", detail: "Přednášky, PDF, dokumenty, odkazy a vložený text." },
        { icon: "🗒️", title: "Získej clean poznámky", detail: "Uspořádané poznámky a přepisy bez ručního přepisování." },
        { icon: "🧠", title: "Flashcards", detail: "Klíčové pojmy se promění v kartičky pro rychlé opakování." },
        { icon: "✅", title: "Quiz", detail: "Ověř si pochopení otázkami z vlastního materiálu." },
        { icon: "🧪", title: "Test", detail: "Procvič si delší odpovědi a přípravu na zkoušení." },
        { icon: "🎧", title: "Poslouchej poznámky", detail: "Aplikace ti poznámky přečte nahlas, takže můžeš opakovat i bez koukání do obrazovky." },
      ],
      examplesEyebrow: "Studijní materiál",
      examplesTitle: "Flashcards, Quiz, Test a AI chat ze stejné poznámky.",
      studyExamples: [
        { label: "Flashcard", title: "Co je aktivní transport?", detail: "Pohyb látek přes membránu proti koncentračnímu gradientu, proto spotřebovává energii.", meta: "Zobrazit odpověď" },
        { label: "Quiz", title: "Enzymy nejčastěji fungují jako ...", detail: "Biologické katalyzátory, které snižují aktivační energii reakce.", meta: "Správně" },
        { label: "Test", title: "Porovnej mitózu a meiózu.", detail: "Odpověď má vysvětlit počet dělení, vzniklé buňky a genetickou rozmanitost.", meta: "Cvičení na zkoušku" },
        { label: "AI chat", title: "Proč je to důležité ke zkoušce?", detail: "Protože stejné pojmy se často objevují v úlohách na vysvětlení, porovnání a použití.", meta: "Zeptej se materiálu" },
      ],
      story: {
        aria: "Ukázky studijního materiálu",
        choose: "Vybrat ukázku",
        show: "Zobrazit",
        previous: "Předchozí ukázka",
        next: "Další ukázka",
        navigation: "Story navigace",
        slides: [
          { kind: "notes", title: "Clean poznámky", caption: "Přednáška se změní v uspořádané shrnutí.", label: "Poznámky", image: "/IMG_6651.png" },
          { kind: "flashcards", title: "Flashcards", caption: "Klíčové pojmy pro rychlé opakování.", label: "Flashcards", image: "/IMG_6653.png" },
          { kind: "quiz", title: "Quiz", caption: "Otázky z tvého materiálu.", label: "Quiz", image: "/IMG_6654.png" },
          { kind: "test", title: "Test", caption: "Cvičení na delší odpovědi a zkoušky.", label: "Test", image: "/IMG_6655.png" },
          { kind: "chat", title: "AI chat", caption: "Zeptej se poznámky a dostaň odpověď.", label: "AI chat", image: "/IMG_6656.png" },
          { kind: "reading", title: "Čtení poznámek", caption: "Poslouchej a čti poznámky na telefonu.", label: "Čtení poznámek", image: "/IMG_6657.png" },
        ],
      },
    },
    auth: {
      signIn: "Přihlášení",
      signInCopy: "Přihlas se nebo si vytvoř nový účet.",
      legalPrefix: "Pokračováním souhlasíš s",
      terms: "podmínkami používání",
      privacy: "zásadami ochrany soukromí",
      legalSuffix:
        "včetně AI zpracování audia, textu, dokumentů a odkazů. Potvrzuješ také, že máš potřebná povolení k nahrávání, odesílání a používání materiálů, které pošleš do Memo.",
      continueGoogle: "Pokračovat s Google",
      continueApple: "Pokračovat s Apple",
      continueEmail: "Pokračovat e-mailem",
      redirecting: "Přesměrovávám...",
      opening: "Otevírám...",
      welcomeBack: "Vítej zpět",
      createAccount: "Vytvoř si účet",
      loginCopy: "Pokračuj tam, kde jsi skončil, s přepisem, poznámkami, kartičkami a chatem.",
      signupCopy: "Začni jednou přednáškou a získej přepis, shrnutí, kartičky a chat na jednom místě.",
      loginEyebrow: "Přihlášení",
      signupEyebrow: "Registrace",
      googleLogin: "Přihlášení přes Google",
      googleSignup: "Vytvořit účet přes Google",
      appleLogin: "Přihlášení přes Apple",
      appleSignup: "Vytvořit účet přes Apple",
      emailLogin: "Pošli mi přihlašovací odkaz",
      emailSignup: "Pošli mi registrační odkaz",
      or: "nebo",
      emailHelper: "Na tvůj e-mail pošleme potvrzovací kód.",
      emailPlaceholder: "Zadej svůj e-mail",
      sendingCode: "Posílám kód...",
      firstTime: "Jsi tu poprvé?",
      alreadyAccount: "Už máš účet?",
      checkEmail: "Zkontroluj e-mail",
      enterCode: "Zadej kód",
      fallbackEmail: "tvůj e-mail",
      codeSent: (email: string) => `Na ${email} jsme poslali potvrzovací kód. Platí 5 minut. Pokud si vyžádáš nový, použij jen nejnovější kód.`,
      emailQuestion: "Jaký je tvůj e-mail?",
      emailEntryCopy: "Zadej svůj e-mail a pošleme ti potvrzovací kód.",
      authErrorEyebrow: "Chyba přihlášení",
      authErrorTitle: "Přihlášení se nezdařilo",
      authErrorCopy: "Zkus jiný způsob přihlášení nebo zkontroluj, jestli jsou poskytovatelé přihlášení správně nastavení.",
      backToLogin: "Zpět na přihlášení",
    },
    appShell: {
      tabs: [
        { href: "/app", displayLabel: "Domů", icon: "🏠" },
        { href: "/app/support", displayLabel: "Pomoc", icon: "❓" },
        { href: "/app/settings", displayLabel: "Nastavení", icon: "⚙️" },
      ],
      startTitle: "Začít",
      startSubtitle: "Přizpůsob aplikaci a vyber balíček",
      noteTitle: "Poznámka",
      noteSubtitle: "Projdi si obsah a chatuj o něm",
      helpTitle: "Pomoc",
      helpArticleSubtitle: "Návod k použití",
      helpSubtitle: "Návody",
      settingsTitle: "Nastavení",
      settingsSubtitle: "Motiv a účet",
      notesTitle: "Poznámky",
      notesSubtitle: "Celá knihovna na jednom místě",
      buy: "Koupit",
      mainNavigation: "Hlavní navigace",
      sideNavigation: "Boční navigace",
    },
    settings: {
      title: "Nastavení",
      theme: "Motiv",
      subscription: "Předplatné",
      package: "Balíček",
      noSubscription: "Bez předplatného",
      onboardingPayment: "Před vstupem do hlavní aplikace uživatel nejdřív dokončí onboarding a platbu.",
      choosePlan: "Vybrat balíček",
      account: "Účet",
      signedIn: "Přihlášený účet",
      signedInFallback: "Přihlášený uživatel",
      redeemCode: "Uplatnit kód",
      privacy: "Soukromí",
      help: "Pomoc",
      share: "Sdílet",
      shareSubject: "Vyzkoušej Memo",
      shareBody: "Používám Memo na poznámky z přednášek a myslím, že by se ti mohlo hodit.",
      featureRequest: "Navrhnout funkci",
      languageTitle: "Jazyk",
      languageDetail: "Vyber jazyk aplikace.",
      logout: "Odhlásit se",
      loggingOut: "Odhlašuji...",
      billingPortal: "Upravit předplatné",
      billingPortalError: "Platební portál se nepodařilo otevřít.",
    },
    theme: { system: "Systém", light: "Světlý", dark: "Tmavý" },
    help: {
      pageTitle: "Pomoc",
      categories: { frequent: "Časté", recording: "Nahrávání a poznámky", account: "Účet a přístup" },
      articles: [],
    },
    ui: commonUiCs,
  },
} as const satisfies Record<AppLocale, LocaleDictionary>;

export function isSupportedLocale(value: string | null | undefined): value is AppLocale {
  return SUPPORTED_LOCALES.includes(value as AppLocale);
}

export function normalizeLocale(value: string | null | undefined): AppLocale {
  return isSupportedLocale(value) ? value : DEFAULT_LOCALE;
}

export function getDictionary(locale: string | null | undefined) {
  return dictionaries[normalizeLocale(locale)];
}

export function getHtmlLang(locale: AppLocale) {
  return locale === CZECH_LOCALE ? "cs" : "sl";
}

export function getOpenGraphLocale(locale: AppLocale) {
  return locale === CZECH_LOCALE ? "cs_CZ" : "sl_SI";
}

export function getLocaleFromPathname(pathname: string) {
  return pathname === "/cz" || pathname.startsWith("/cz/") ? CZECH_LOCALE : null;
}

export function getLocalizedPublicPath(locale: AppLocale) {
  return locale === CZECH_LOCALE ? "/cz" : "/";
}

export function shouldPreferCzech(params: {
  acceptLanguage: string | null;
  country: string | null;
}) {
  if (params.country?.toUpperCase() === "CZ") {
    return true;
  }

  return params.acceptLanguage
    ?.split(",")
    .some((part) => part.trim().toLowerCase().startsWith("cs")) ?? false;
}
