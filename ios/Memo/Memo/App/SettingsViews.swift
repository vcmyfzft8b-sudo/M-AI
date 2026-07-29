import StoreKit
import SwiftUI

// Settings screen matching web /app/settings (Tema / Naročnina / Račun / Pomoč),
// extended with iOS-required actions: StoreKit subscription management,
// restore purchases, and in-app account deletion (App Store rule 5.1.1(v)).

struct SettingsView: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.memoTheme) private var theme
    @Binding var showPaywall: Bool

    @State private var showManageSubscriptions = false
    @State private var isRestoring = false
    @State private var showDeleteConfirm = false
    @State private var isDeleting = false
    @State private var showShare = false
    @State private var helpArticle: HelpArticle?

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 20) {
                Text("Nastavitve")
                    .font(.system(size: 28, weight: .bold))
                    .foregroundStyle(theme.label)

                themeSection
                subscriptionSection
                accountSection
                helpSection

                if let error = appModel.errorMessage {
                    MemoBanner(kind: .error, message: error)
                }
            }
            .padding(.horizontal, 18)
            .padding(.top, 16)
            .padding(.bottom, 110)
        }
        .manageSubscriptionsSheet(isPresented: $showManageSubscriptions)
        .sheet(isPresented: $showShare) {
            ShareSheet(items: [
                "Uporabljam Memo za zapiske predavanj in mislim, da bi ti lahko prišel prav. \(appModel.configuration.siteURL.absoluteString)"
            ])
            .presentationDetents([.medium])
        }
        .sheet(item: $helpArticle) { article in
            SupportArticleSheet(article: article)
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
        .confirmationDialog(
            "Izbriši račun",
            isPresented: $showDeleteConfirm,
            titleVisibility: .visible
        ) {
            Button("Trajno izbriši račun in vse podatke", role: .destructive) {
                MemoHaptics.notification(.warning)
                deleteAccount()
            }
            Button("Prekliči", role: .cancel) {}
        } message: {
            Text("To bo trajno izbrisalo tvoj račun, vse zapiske, prepise in učno gradivo. Tega ni mogoče razveljaviti. Naročnino prek App Stora upravlja Apple — prekliči jo v nastavitvah App Stora.")
        }
    }

    private func sectionHeader(_ title: String) -> some View {
        Text(title)
            .font(.system(size: 18, weight: .bold))
            .foregroundStyle(theme.label)
    }

    // MARK: - Theme

    private var themeSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionHeader("Tema")
            themeCard(.system, emoji: "💻", label: "Sistem")
            themeCard(.light, emoji: "☀️", label: "Svetla")
            themeCard(.dark, emoji: "🌙", label: "Temna")
        }
    }

    private func themeCard(_ preference: ThemePreference, emoji: String, label: String) -> some View {
        let active = appModel.themePreference == preference
        return Button {
            MemoHaptics.selection()
            appModel.themePreference = preference
        } label: {
            HStack(spacing: 14) {
                Text(emoji)
                    .font(.system(size: 22))
                    .frame(width: 42, height: 42)
                    .background(theme.surfaceMuted, in: Circle())
                Text(label)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(theme.label)
                Spacer()
            }
            .padding(.horizontal, 16)
            .frame(maxWidth: .infinity, minHeight: 76)
            .background(active ? theme.tint.opacity(0.075) : theme.surfaceSolid)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(active ? theme.tint.opacity(0.52) : theme.separator, lineWidth: active ? 1.25 : 1)
            )
        }
    }

    // MARK: - Subscription

    private var activeSubscription: BillingSubscriptionRow? {
        appModel.subscriptions.first(where: \.isActive)
    }

    private var hasAppStoreSubscription: Bool {
        !appModel.store.activeProductIDs.isEmpty
    }

    private var subscriptionSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionHeader("Naročnina")
            HStack(alignment: .center, spacing: 14) {
                VStack(alignment: .leading, spacing: 5) {
                    Text("PAKET")
                        .font(.system(size: 11.5, weight: .bold))
                        .tracking(0.8)
                        .foregroundStyle(theme.secondaryLabel)
                    Text(subscriptionValue)
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(theme.label)
                    Text(subscriptionDetail)
                        .font(.system(size: 13.5))
                        .foregroundStyle(theme.secondaryLabel)
                }
                Spacer(minLength: 8)
                subscriptionAction
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .memoCard()

            Button {
                restore()
            } label: {
                if isRestoring {
                    HStack(spacing: 8) { ProgressView(); Text("Obnavljam...") }
                } else {
                    HStack(spacing: 7) { Text("🔄"); Text("Obnovi nakupe") }
                }
            }
            .buttonStyle(MemoSecondaryButtonStyle(minHeight: 48))
            .disabled(isRestoring)
        }
    }

    @ViewBuilder
    private var subscriptionAction: some View {
        if hasAppStoreSubscription {
            Button("💳  Uredi naročnino") { showManageSubscriptions = true }
                .font(.system(size: 14, weight: .semibold))
        } else if activeSubscription != nil {
            Text("✓  Aktivna")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(theme.secondaryLabel)
        } else {
            Button("✨  Izberi paket") { showPaywall = true }
                .font(.system(size: 14, weight: .semibold))
        }
    }

    private var subscriptionValue: String {
        if hasAppStoreSubscription {
            if let productID = appModel.store.activeProductIDs.first,
               let plan = BillingPlan.allCases.first(where: { productID.hasSuffix($0.rawValue) }) {
                return "\(planLabel(plan)) (App Store)"
            }
            return "Aktivna (App Store)"
        }
        if let subscription = activeSubscription {
            return "\(planLabel(subscription.plan)) (\(subscription.status.replacingOccurrences(of: "_", with: " ")))"
        }
        return "Brez naročnine"
    }

    private func planLabel(_ plan: BillingPlan) -> String {
        switch plan {
        case .weekly: "Tedensko"
        case .monthly: "Mesečno"
        case .yearly: "Letno"
        }
    }

    private var subscriptionDetail: String {
        if hasAppStoreSubscription {
            return "Naročnino upravlja Apple prek App Stora."
        }
        if let end = activeSubscription?.currentPeriodEnd {
            return "Aktivno do \(MemoFormat.calendarDate(end))"
        }
        return "Pred vstopom v glavno aplikacijo uporabnik najprej opravi onboarding in plačilo."
    }

    // MARK: - Account

    private var accountSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionHeader("Račun")
            HStack(spacing: 14) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("PRIJAVLJEN")
                        .font(.system(size: 11.5, weight: .bold))
                        .tracking(0.8)
                        .foregroundStyle(theme.secondaryLabel)
                    Text(appModel.session?.user.email ?? "Prijavljen uporabnik")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(theme.label)
                }
                Spacer(minLength: 8)
                Button {
                    Task {
                        await appModel.signOut()
                    }
                } label: {
                    HStack(spacing: 7) {
                        Text("🚪")
                        Text("Odjava")
                    }
                }
                .font(.system(size: 14, weight: .semibold))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .memoCard()

            linkCard(emoji: "🎟️", title: "Unovči kodo") {
                helpArticle = HelpArticle(slug: "redeem-code", title: "Unovči kodo")
            }
            linkCard(emoji: "🔒", title: "Zasebnost") {
                helpArticle = HelpArticle(slug: "privacy-policy", title: "Politika zasebnosti")
            }
            linkCard(emoji: "📄", title: "Pogoji uporabe") {
                helpArticle = HelpArticle(slug: "terms-of-use", title: "Pogoji uporabe")
            }
            linkCard(emoji: "🗑️", title: "Izbriši račun", danger: true) {
                showDeleteConfirm = true
            }

            if isDeleting {
                HStack(spacing: 10) {
                    ProgressView()
                    Text("Brišem račun...")
                        .font(.system(size: 14))
                        .foregroundStyle(theme.secondaryLabel)
                }
            }
        }
    }

    // MARK: - Help

    private var helpSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionHeader("Pomoč")
            linkCard(emoji: "📤", title: "Deli") {
                showShare = true
            }
            linkCard(emoji: "💡", title: "Predlagaj funkcijo") {
                helpArticle = HelpArticle(slug: "feature-request", title: "Predlog funkcije")
            }
        }
    }

    private func linkCard(emoji: String, title: String, danger: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Text(emoji)
                    .font(.system(size: 20))
                    .frame(width: 34)
                Text(title)
                    .font(.system(size: 14.5, weight: .semibold))
                    .foregroundStyle(danger ? theme.red : theme.label)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(theme.tertiaryLabel)
            }
            .frame(maxWidth: .infinity, minHeight: 54, alignment: .leading)
            .padding(.horizontal, 14)
            .background(theme.surfaceSolid)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(theme.separator, lineWidth: 1)
            )
            .shadow(color: .black.opacity(0.04), radius: 8, y: 3)
        }
    }

    private func restore() {
        isRestoring = true
        Task {
            await appModel.restorePurchases()
            isRestoring = false
        }
    }

    private func deleteAccount() {
        isDeleting = true
        Task {
            await appModel.deleteAccount()
            isDeleting = false
        }
    }
}

// MARK: - Support / help center

struct HelpArticle: Identifiable {
    let slug: String
    let title: String
    var id: String { slug }
}

private struct HelpSection: Identifiable {
    let title: String
    let articles: [HelpArticle]
    var id: String { title }
}

private let helpSections: [HelpSection] = [
    .init(title: "Pogosto", articles: [
        .init(slug: "family-plan", title: "Družinski paket?"),
        .init(slug: "gift-coconote", title: "Ali lahko podarim Memo?"),
        .init(slug: "supported-language", title: "Ali podpirate moj jezik?"),
        .init(slug: "feature-request", title: "Predlog funkcije")
    ]),
    .init(title: "Snemanje in zapiski", articles: [
        .init(slug: "video-isnt-working", title: "Video povezava ne deluje"),
        .init(slug: "audio-upload-issue", title: "Ne morem naložiti zvoka"),
        .init(slug: "transcript-cut-short", title: "Prepis je prekratek ali netočen")
    ]),
    .init(title: "Račun in dostop", articles: [
        .init(slug: "terms-of-use", title: "Pogoji uporabe"),
        .init(slug: "redeem-code", title: "Unovči kodo"),
        .init(slug: "privacy-policy", title: "Politika zasebnosti")
    ])
]

struct SupportListView: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.memoTheme) private var theme
    @State private var selectedArticle: HelpArticle?
    #if DEBUG
    @State private var didApplyDebugArticle = false
    #endif

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 20) {
                Text("Pomoč")
                    .font(.system(size: 28, weight: .bold))
                    .foregroundStyle(theme.label)

                ForEach(helpSections) { section in
                    VStack(alignment: .leading, spacing: 10) {
                        Text(section.title)
                            .font(.system(size: 18, weight: .bold))
                            .foregroundStyle(theme.label)
                        VStack(spacing: 8) {
                            ForEach(section.articles) { article in
                                Button {
                                    selectedArticle = article
                                } label: {
                                    HStack {
                                        Text(article.title)
                                            .font(.system(size: 15.5, weight: .medium))
                                            .foregroundStyle(theme.label)
                                        Spacer()
                                        Image(systemName: "chevron.right")
                                            .font(.system(size: 13, weight: .semibold))
                                            .foregroundStyle(theme.tertiaryLabel)
                                    }
                                    .padding(.horizontal, 16)
                                    .frame(minHeight: 54)
                                    .background(theme.surfaceSolid)
                                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                                            .stroke(theme.separator, lineWidth: 1)
                                    )
                                }
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, 18)
            .padding(.top, 16)
            .padding(.bottom, 110)
        }
        .sheet(item: $selectedArticle) { article in
            SupportArticleSheet(article: article)
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
        #if DEBUG
        .onAppear {
            guard !didApplyDebugArticle,
                  let slug = ProcessInfo.processInfo.environment["MEMO_DEBUG_SUPPORT_SLUG"],
                  let article = helpSections.flatMap(\.articles).first(where: { $0.slug == slug }) else {
                return
            }
            didApplyDebugArticle = true
            selectedArticle = article
        }
        #endif
    }
}

struct SupportArticleSheet: View {
    @Environment(\.memoTheme) private var theme
    @Environment(\.dismiss) private var dismiss
    let article: HelpArticle

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Spacer()
                MemoCloseButton(size: 34) {
                    dismiss()
                }
            }
            .padding(.horizontal, 18)
            .padding(.top, 10)
            .padding(.bottom, 8)
            .overlay(alignment: .bottom) { Rectangle().fill(theme.separator).frame(height: 1) }

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 18) {
                    Text(helpCategory(article.slug).uppercased())
                        .font(.system(size: 11.5, weight: .bold))
                        .tracking(1.2)
                        .foregroundStyle(theme.secondaryLabel)
                    Text(article.title)
                        .font(.system(size: 30.4, weight: .bold))
                        .tracking(-1.368)
                        .foregroundStyle(theme.label)
                    MarkdownText(markdown: helpArticleContent(article.slug), style: .help)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .memoCard(cornerRadius: 26, padding: 19.2)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 18)
                .padding(.bottom, 24)
            }
        }
        .background(theme.canvas.ignoresSafeArea())
    }
}

private func helpCategory(_ slug: String) -> String {
    if ["family-plan", "gift-coconote", "supported-language", "feature-request"].contains(slug) {
        return "Pogosto"
    }
    if ["video-isnt-working", "audio-upload-issue", "transcript-cut-short"].contains(slug) {
        return "Snemanje in zapiski"
    }
    return "Račun in dostop"
}

private func helpArticleContent(_ slug: String) -> String {
    switch slug {
    case "family-plan":
        return """
        Skupni družinski delovni prostor še ni podprt.

        Za zdaj ima vsak račun svojo knjižnico zapiskov in zgodovino obdelav.

        ## Kaj lahko narediš zdaj

        - prijavi se z računom, ki naj bo lastnik zapiskov
        - zapiske po potrebi kopiraj iz prikaza zapiska
        - za bolj dosledne rezultate uporabljaj enake jezikovne nastavitve
        """
    case "gift-coconote":
        return """
        Če imaš promocijsko ali darilno kodo, jo lahko prejemnik uporabi v Stripe Checkout pred zaključkom nakupa.

        Za uporabo Memo naj si prejemnik ustvari svoj račun, nato pa pri plačilu v Stripe vnese kodo in preveri, da se popust prikaže pred potrditvijo plačila.
        """
    case "supported-language":
        return """
        Aplikacija lahko obdela večjezično gradivo, vendar so rezultati najboljši, če pred ustvarjanjem zapiska izbereš pravi izvorni jezik.

        ## Priporočila

        - pred oddajo izberi dejanski jezik posnetka ali besedila
        - pri mešanju jezikov pomagajo krajši posnetki
        - tehnični angleški izrazi lahko ostanejo v končnem rezultatu, kadar so del izvorne vsebine
        """
    case "feature-request":
        return """
        Najbolj uporaben predlog je kratek in konkreten opis tvojega načina uporabe.

        Koristno je vključiti:

        - kaj si želel doseči
        - kje si se zataknil
        - kakšen rezultat si pričakoval
        - ali gre za težavo pri zvoku, besedilu, PDF-ju ali povezavi
        """
    case "video-isnt-working":
        return """
        Memo lahko obdela samo vsebino, ki je javno dostopna in dovolj berljiva za povzemanje.

        ## Poskusi to

        - preveri, da stran ne zahteva prijave
        - uporabi neposreden URL strani
        - če imaš gradivo drugje, naloži PDF ali prilepi besedilo
        """
    case "audio-upload-issue":
        return """
        Podprti formati so MP3, M4A, WAV, OGG in WEBM.

        ## Kontrolni seznam

        - preveri, da datoteka ni poškodovana
        - ostani pod trenutno omejitvijo velikosti
        - če je zvok nastal s snemanjem zaslona, ga ponovno izvozi
        - če se je nalaganje prej ustavilo, poskusi znova z domače strani
        """
    case "transcript-cut-short":
        return """
        Kakovost prepisa je odvisna od čistosti zvoka, prekrivanja govorcev in izbranega izvornega jezika.

        ## Kako izboljšati rezultate

        - pred obdelavo izberi pravilen jezik
        - pri pogovorih omogoči zajem več govorcev
        - zmanjša ozadni hrup
        - zelo dolge posnetke razdeli na manjše dele
        """
    case "redeem-code":
        return """
        Promocijsko ali darilno kodo lahko uporabiš v Stripe Checkout pred zaključkom nakupa.

        ## Kako vneseš kodo

        - v nastavitvah izberi možnost za nakup ali nadgradnjo
        - v Stripe plačilnem obrazcu odpri polje za promocijsko kodo
        - vnesi kodo in potrdi, da se popust prikaže pred plačilom

        Če se polje ne prikaže ali koda ni sprejeta, preveri, ali je koda še veljavna in ali je namenjena izbranemu paketu.
        """
    case "privacy-policy":
        return """
        Tvoji zapiski ostanejo povezani s tvojim računom. Naloženo gradivo se uporablja za prepise, povzetke, strukturirane zapiske, kartice, kvize in odgovore v klepetu znotraj aplikacije.

        ## Kaj posreduješ

        Glede na način uporabe aplikacije lahko posreduješ:

        - podatke o računu, kot so e-naslov in avtentikacijski podatki
        - zvočne posnetke in naložene zvočne datoteke
        - prilepljeno besedilo, zapiske, pozive in sporočila v klepetu
        - PDF-je in dokumente
        - javne povezave, za katere želiš, da jih Memo prebere

        ## Dovoljenja za snemanje in gradiva

        Z uporabo Memo potrjuješ, da imaš vsa potrebna dovoljenja in pravice za snemanje, nalaganje, lepljenje ali povezovanje vsebine, ki jo pošlješ v aplikacijo. To vključuje dovoljenja šole, učitelja, predavatelja, ustanove, delodajalca, udeležencev snemanja ali drugih imetnikov pravic, kadar so taka dovoljenja potrebna.

        V Memo ne nalagaj posnetkov predavanj, prosojnic, učnih gradiv, dokumentov ali druge vsebine, če za to nimaš dovoljenja oziroma zakonske podlage.

        ## Kako storitev uporablja tvojo vsebino

        Tvojo vsebino uporabljamo za:

        - prijavo v račun in ohranjanje aktivne seje
        - shranjevanje in urejanje tvoje knjižnice zapiskov
        - prepisovanje in analizo izvornega gradiva
        - ustvarjanje povzetkov, zapiskov, kartic, kvizov in odgovorov v klepetu
        - izvajanje ozadnih opravil, omejevanje zahtevkov in preprečevanje zlorab

        ## Obdelava pri tretjih ponudnikih

        Za izvajanje AI funkcij lahko Memo ustrezno vsebino pošlje zunanjim ponudnikom, ki podpirajo prepisovanje, izluščanje dokumentov, embeddinge, generiranje besedila, gostovanje, shranjevanje in avtentikacijo.

        To lahko po potrebi vključuje datoteke, besedilo, zvok in pozive, ki jih pošlješ za funkcijo, ki jo zahtevaš.

        ## Tvoje možnosti

        Če ne želiš, da pride do takšne obdelave, te vsebine v Memo ne nalagaj, ne lepi, ne snemaj in ne poveži.

        ## Hramba in brisanje

        Vsebina ostane povezana s tvojim računom, dokler je ne izbrišeš v izdelku ali je ne odstranimo prek podpore ali operativnega čiščenja. Če potrebuješ strožje pogoje glede hrambe, brisanja ali pogodbenih določil, se ne zanašaj samo na to privzeto politiko.
        """
    default:
        return """
        Z ustvarjanjem računa ali nadaljevanjem v Memo se strinjaš s temi pogoji.

        ## Tvoje odgovornosti

        - nalagaš, snemaš, lepiš ali povezuješ lahko samo gradivo, ki ga imaš v lasti ali ga smeš uporabljati
        - odgovoren si za zakonitost vsebine, ki jo pošlješ
        - Memo ne smeš uporabljati za nalaganje zlonamerne programske opreme, zlorabo sistemov tretjih oseb, zajemanje zasebnih sistemov ali kršenje šolskih, službenih ali platformnih pravil

        ## Dovoljenja za snemanje in gradiva

        Z uporabo Memo potrjuješ, da imaš pred snemanjem, nalaganjem, lepljenjem ali povezovanjem vsebine vsa potrebna dovoljenja in pravice. To vključuje dovoljenja šole, učitelja, predavatelja, ustanove, delodajalca, udeležencev snemanja ali drugih imetnikov pravic, kadar so taka dovoljenja potrebna.

        Ne snemaj predavanj, pogovorov ali drugih oseb in ne nalagaj prosojnic, zapiskov, učnih gradiv, dokumentov ali drugih datotek, če za to nimaš dovoljenja oziroma zakonske podlage. Odgovoren si, da tvoja uporaba Memo ne krši pravil šole, pogodbenih omejitev, avtorskih pravic, zasebnosti, pravil o snemanju ali drugih veljavnih zakonov in pravil.

        ## AI obdelava

        Memo je AI učno orodje. Za prepise, povzetke, kartice, kvize, odgovore v klepetu in izluščanje vsebine iz dokumentov lahko Memo tvojo vsebino obdela pri zunanjih AI in infrastrukturnih ponudnikih.

        To lahko vključuje:

        - zvočne posnetke in naložene zvočne datoteke
        - prilepljeno besedilo in zapiske
        - PDF-je in druge podprte dokumente
        - javne spletne povezave, za katere želiš, da jih Memo prebere
        - metapodatke, potrebne za delovanje, varnost in izboljšave storitve

        Z nadaljevanjem soglašaš, da Memo to vsebino obdela za navedene funkcije izdelka.

        ## Brez jamstev

        Memo lahko ustvari napake, nepopolne odgovore ali zavajajoče učno gradivo. Preden se zaneseš na rezultate pri izpitih, seminarskih nalogah, medicinskih, pravnih, finančnih, skladnostnih ali varnostno kritičnih odločitvah, jih moraš preveriti sam.

        ## Račun in ukrepanje

        Dostop lahko začasno omejimo, onemogočimo nekatere funkcije ali odstranimo vsebino, kadar je uporaba videti zlorabna, nezakonita, nevarna ali škodljiva za storitev ali druge uporabnike.

        ## Spremembe

        Ti pogoji se lahko posodobijo, ko se izdelek spreminja. Če po posodobitvi nadaljuješ z uporabo, to pomeni, da sprejemaš posodobljeno različico.
        """
    }
}

// MARK: - Wrappers

struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}
