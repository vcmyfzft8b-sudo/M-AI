import SwiftUI

// Root routing + main shell + home dashboard, matching the web mobile layout:
// floating collapsible dock (bottom-left), floating "Nov zapisek" pill (bottom-right),
// quick-action cards, searchable note list with folders and swipe actions.

struct AppRootView: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        MemoThemeProvider {
            Group {
                if !appModel.isSignedIn {
                    AuthFlowView()
                } else if !appModel.onboardingComplete && !bypassOnboardingForDebugLaunch {
                    OnboardingView()
                } else if !appModel.hasPaidAccess && !appModel.didDismissPaywall && !bypassOnboardingForDebugLaunch {
                    PaywallView(onClose: { appModel.didDismissPaywall = true })
                } else {
                    MainShellView()
                }
            }
        }
        .preferredColorScheme(appModel.themePreference.colorScheme)
        .task(id: appModel.session?.user.id) {
            while !Task.isCancelled, appModel.session != nil {
                try? await Task.sleep(for: .seconds(60))
                guard !Task.isCancelled else { return }
                await appModel.maintainSession()
            }
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            Task {
                await appModel.maintainSession()
            }
        }
    }

    private var bypassOnboardingForDebugLaunch: Bool {
        #if DEBUG
        ProcessInfo.processInfo.environment["MEMO_DEBUG_BYPASS_ONBOARDING"] == "1"
            || ProcessInfo.processInfo.environment["MEMO_DEBUG_CREATE_MODE"] != nil
            || ProcessInfo.processInfo.environment["MEMO_DEBUG_OPEN_LECTURE"] != nil
            || ProcessInfo.processInfo.environment["MEMO_DEBUG_AUTO_RECORD"] == "1"
        #else
        false
        #endif
    }
}

enum AppTab: String, CaseIterable, Identifiable {
    case home
    case support
    case settings

    var id: String { rawValue }

    var emoji: String {
        switch self {
        case .home: "🏠"
        case .support: "❓"
        case .settings: "⚙️"
        }
    }

    var label: String {
        switch self {
        case .home: "Domov"
        case .support: "Pomoč"
        case .settings: "Nastavitve"
        }
    }
}

struct MainShellView: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.memoTheme) private var theme
    @State private var activeTab: AppTab = .home
    @State private var dockOpen = false
    @State private var showCreateSheet = false
    @State private var showCreateMenu = false
    @State private var createMode: CaptureMode?
    @State private var navigationPath = NavigationPath()
    @State private var showPaywall = false

    var body: some View {
        NavigationStack(path: $navigationPath) {
            ZStack(alignment: .bottom) {
                theme.canvas.ignoresSafeArea()

                VStack(spacing: 0) {
                    if activeTab != .home {
                        shellTopBar
                    }
                    Group {
                        switch activeTab {
                        case .home:
                            HomeDashboardView(
                                openLecture: { lecture in
                                    openLecture(lecture)
                                },
                                openQuickAction: { mode in
                                    openQuickAction(mode)
                                }
                            )
                        case .support:
                            SupportListView()
                        case .settings:
                            SettingsView(showPaywall: $showPaywall)
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)

                if dockOpen {
                    Color.clear
                        .contentShape(Rectangle())
                        .ignoresSafeArea()
                        .padding(.bottom, 88)
                        .onTapGesture {
                            withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                                dockOpen = false
                            }
                        }
                        .accessibilityHidden(true)
                        .zIndex(1)
                }

                bottomOverlay
                    .zIndex(2)
            }
            .navigationDestination(for: LectureRow.self) { lecture in
                LectureWorkspaceView(lecture: lecture) { destination in
                    activeTab = destination
                    navigationPath = NavigationPath()
                }
            }
            .toolbar(.hidden, for: .navigationBar)
        }
        #if DEBUG
        .task {
            if ProcessInfo.processInfo.environment["MEMO_DEBUG_AUTO_RECORD"] == "1",
               !appModel.recorder.isRecording {
                await appModel.recorder.start()
            }
            if let requestedLectureID = ProcessInfo.processInfo.environment["MEMO_DEBUG_OPEN_LECTURE"] {
                for _ in 0..<20 {
                    let requested = appModel.lectures.first { lecture in
                        requestedLectureID.isEmpty || lecture.id == requestedLectureID
                    }
                    if let requested {
                        navigationPath.append(requested)
                        break
                    }
                    try? await Task.sleep(for: .milliseconds(500))
                }
            }
            if let tab = ProcessInfo.processInfo.environment["MEMO_DEBUG_TAB"],
               let parsed = AppTab(rawValue: tab) {
                activeTab = parsed
            }
            if let rawMode = ProcessInfo.processInfo.environment["MEMO_DEBUG_CREATE_MODE"],
               let mode = CaptureMode(rawValue: rawMode) {
                createMode = mode
                showCreateSheet = true
            }
        }
        #endif
        .sheet(isPresented: $showCreateMenu) {
            CreateMenuSheet { mode in
                showCreateMenu = false
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                    openQuickAction(mode)
                }
            }
            .presentationDetents([.medium])
            .presentationContentInteraction(.scrolls)
            .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $showCreateSheet) {
            CreateNoteSheet(
                initialMode: createMode ?? .record,
                onCreated: { lecture in
                    showCreateSheet = false
                    Task {
                        await appModel.refreshLibrary()
                        if let lecture {
                            openLecture(lecture)
                        }
                    }
                }
            )
        }
        .fullScreenCover(isPresented: $showPaywall) {
            PaywallView(onClose: {
                showPaywall = false
                appModel.billingRequired = false
            })
        }
        .onChange(of: appModel.billingRequired) { _, required in
            // The API answered 402. The web client redirects to the paywall
            // page here, so the native shell presents the StoreKit paywall.
            if required {
                showPaywall = true
            }
        }
        .overlay(alignment: .top) {
            if let status = appModel.statusMessage {
                StatusToast(message: status)
                    .padding(.top, 4)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .task {
                        try? await Task.sleep(for: .seconds(2.4))
                        appModel.statusMessage = nil
                    }
            }
        }
        .animation(.easeOut(duration: 0.24), value: appModel.statusMessage)
    }

    private func openLecture(_ lecture: LectureRow) {
        if appModel.hasPaidAccess || appModel.profile?.trialLectureId == lecture.id {
            navigationPath.append(lecture)
        } else {
            showPaywall = true
        }
    }

    private func openQuickAction(_ mode: CaptureMode) {
        if appModel.canCreateNotes {
            createMode = mode
            showCreateSheet = true
        } else {
            showPaywall = true
        }
    }

    // MARK: - Floating dock + create pill

    private var shellTopBar: some View {
        HStack {
            MemoBrandBanner(height: 44)
            Spacer()
        }
        .padding(.horizontal, 16)
        .frame(height: 60)
        .background(.ultraThinMaterial)
        .overlay(alignment: .bottom) {
            Rectangle().fill(theme.separator).frame(height: 1)
        }
    }

    private var bottomOverlay: some View {
        HStack(alignment: .bottom, spacing: 12) {
            dock
            Spacer()
            if activeTab == .home {
                createPill
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 0)
    }

    private var dock: some View {
        ZStack(alignment: .leading) {
            MemoDraggableNavigationDock(
                items: expandedDockTabs,
                selected: activeTab,
                width: 280,
                height: 51
            ) { tab in
                activeTab = tab
                withAnimation(MemoMotion.dock) {
                    dockOpen = false
                }
            } label: { tab, _ in
                Text(tab.emoji)
                    .font(.system(size: 21))
                    .accessibilityLabel(tab.label)
            }
            .opacity(dockOpen ? 1 : 0)
            .allowsHitTesting(dockOpen)

            Button {
                MemoHaptics.impact(.light)
                withAnimation(MemoMotion.dock) {
                    dockOpen = true
                }
            } label: {
                Text(collapsedDockEmoji)
                    .font(.system(size: 21))
                    .frame(width: 51, height: 51)
            }
            .frame(width: 51, height: 51)
            .memoClassicNavigationDock()
            .opacity(dockOpen ? 0 : 1)
            .allowsHitTesting(!dockOpen)
        }
        .frame(width: dockOpen ? 280 : 51, height: 51, alignment: .leading)
        .clipShape(Capsule())
        .shadow(color: .black.opacity(0.18), radius: 14, y: 7)
        .animation(MemoMotion.dock, value: dockOpen)
        .animation(MemoMotion.dockLabel, value: dockOpen)
    }

    /// The mobile web dock keeps its collapsed destination in the first slot
    /// when it expands. On Home that destination is Settings, followed by the
    /// active Home item and Help; elsewhere it is Home, Help, then Settings.
    private var expandedDockTabs: [AppTab] {
        activeTab == .home ? [.settings, .home, .support] : [.home, .support, .settings]
    }

    private var collapsedDockEmoji: String {
        activeTab == .home ? "⚙️" : "🏠"
    }

    private var createPill: some View {
        Button {
            MemoHaptics.impact(.medium)
            withAnimation(.easeOut(duration: 0.2)) {
                dockOpen = false
            }
            showCreateMenu = true
        } label: {
            HStack(spacing: dockOpen ? 0 : 8) {
                Image(systemName: "plus")
                    .font(.system(size: 15, weight: .bold))
                Text("Nov zapisek")
                    .font(.system(size: 16, weight: .semibold))
                    .lineLimit(1)
                    .frame(width: dockOpen ? 0 : 96, alignment: .leading)
                    .opacity(dockOpen ? 0 : 1)
                    .clipped()
            }
            .foregroundStyle(.white)
            .frame(width: dockOpen ? 51 : 178, height: 51)
            .memoLiquidGlassCapsule(tint: Color(hex: 0xF45F5A))
            .shadow(color: Color(hex: 0xF45F5A).opacity(0.24), radius: 12, y: 6)
        }
        .accessibilityLabel("Nov zapisek")
        .animation(MemoMotion.dock, value: dockOpen)
        .animation(MemoMotion.dockLabel, value: dockOpen)
    }
}

/// Web `.mobile-create-menu`: bottom sheet with the four quick-action cards.
struct CreateMenuSheet: View {
    @Environment(\.memoTheme) private var theme
    @Environment(\.dismiss) private var dismiss
    let pick: (CaptureMode) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Nov zapisek")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(theme.label)
                Spacer()
                MemoCloseButton(size: 30, accessibilityLabel: "Zapri meni za nov zapisek") {
                    dismiss()
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 18)
            .padding(.bottom, 12)

            ScrollView(showsIndicators: false) {
                VStack(spacing: 12) {
                    menuCard(mode: .record, emoji: "🎙️", label: "Posnemi predavanje", detail: "Začni z enim dotikom", accent: true)
                    menuCard(mode: .upload, emoji: "📤", label: "Naloži zvok", detail: "MP3, M4A, WAV ali WEBM")
                    menuCard(mode: .text, emoji: "📄", label: "Prilepi besedilo ali PDF", detail: "Pretvori gradivo v strukturirane zapiske")
                    menuCard(mode: .link, emoji: "🔗", label: "Dodaj povezavo", detail: "Spletni članek ali vir")
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 26)
            }
        }
        .background(theme.sheetBackground.ignoresSafeArea())
    }

    private func menuCard(mode: CaptureMode, emoji: String, label: String, detail: String, accent: Bool = false) -> some View {
        Button {
            pick(mode)
        } label: {
            HStack(spacing: 15) {
                Text(emoji)
                    .font(.system(size: 21))
                    .frame(width: 46, height: 46)
                    .background(accent ? theme.redSoft : theme.surfaceMuted)
                    .clipShape(Circle())
                VStack(alignment: .leading, spacing: 3) {
                    Text(label)
                        .font(.system(size: 16.5, weight: .semibold))
                        .foregroundStyle(theme.label)
                    Text(detail)
                        .font(.system(size: 13))
                        .foregroundStyle(theme.secondaryLabel)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(theme.tertiaryLabel)
            }
            .padding(.horizontal, 16)
            .frame(maxWidth: .infinity, minHeight: 84, alignment: .leading)
            .background(theme.surfaceMuted.opacity(0.6))
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        }
    }
}

// MARK: - Dashboard

struct HomeDashboardView: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.memoTheme) private var theme
    let openLecture: (LectureRow) -> Void
    let openQuickAction: (CaptureMode) -> Void

    @State private var searchText = ""
    @State private var selectedFolderID: String?
    @State private var showFolderSheet = false
    @State private var folderEditorMode: FolderEditorMode?
    @State private var renameTarget: LectureRow?
    @State private var deleteTarget: LectureRow?
    @State private var openSwipeLectureID: String?
    @State private var pollTask: Task<Void, Never>?

    var body: some View {
        VStack(spacing: 0) {
            topBar
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 16) {
                    if !appModel.hasPaidAccess && !appModel.canCreateNotes {
                        Button {
                            openQuickAction(.record)
                        } label: {
                            HStack {
                                Text("Nadgradi za nov zapisek")
                                    .font(.system(size: 15, weight: .semibold))
                                Image(systemName: "chevron.right")
                                    .font(.system(size: 13, weight: .semibold))
                            }
                            .foregroundStyle(theme.tint)
                        }
                    }

                    // The web mobile layout hides the quick-action grid — creation
                    // goes through the floating "Nov zapisek" pill instead.
                    Text("Moji zapiski")
                        .font(.system(size: 15, weight: .semibold))
                        .tracking(-0.45)
                        .foregroundStyle(theme.label)
                        .padding(.top, 8)

                    searchField
                    folderTrigger

                    if let error = appModel.errorMessage {
                        MemoBanner(kind: .error, message: error)
                    }

                    failedSection
                    noteList
                }
                .padding(.horizontal, 16)
                .padding(.top, 6)
                .padding(.bottom, 150)
            }
            .refreshable {
                await appModel.refreshLibrary()
            }
        }
        .sheet(isPresented: $showFolderSheet) {
            FolderMenuSheet(
                selectedFolderID: $selectedFolderID,
                openEditor: { mode in
                    showFolderSheet = false
                    folderEditorMode = mode
                }
            )
            .presentationDetents([.large])
            .presentationContentInteraction(.scrolls)
            .presentationDragIndicator(.visible)
        }
        .sheet(item: $folderEditorMode) { mode in
            FolderEditorSheet(mode: mode, selectedFolderID: $selectedFolderID)
                .presentationDragIndicator(.visible)
        }
        .sheet(item: $renameTarget) { lecture in
            RenameLectureSheet(lecture: lecture)
                .presentationDetents([.height(320)])
                .presentationDragIndicator(.visible)
        }
        .confirmationDialog(
            "Izbriši zapisek",
            isPresented: Binding(
                get: { deleteTarget != nil },
                set: { if !$0 { deleteTarget = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Izbriši zapisek", role: .destructive) {
                if let target = deleteTarget {
                    Task {
                        _ = await appModel.deleteLecture(id: target.id)
                    }
                }
            }
            Button("Prekliči", role: .cancel) {}
        } message: {
            Text("Izbriši \u{201E}\(deleteTarget?.displayTitle ?? "Neimenovan zapisek")\u{201C}? Tega ni mogoče razveljaviti.")
        }
        .task {
            await appModel.refreshLibrary()
        }
        .onAppear(perform: startPollingIfNeeded)
        .onChange(of: appModel.lectures) {
            startPollingIfNeeded()
        }
        .onDisappear {
            pollTask?.cancel()
            pollTask = nil
        }
    }

    private var topBar: some View {
        HStack(spacing: 11) {
            MemoBrandBanner(height: 44)
            Spacer()
            if !appModel.hasPaidAccess {
                Button {
                    openQuickAction(.record)
                } label: {
                    HStack(spacing: 5) {
                        Text("✨")
                        Text("Kupi")
                            .font(.system(size: 14, weight: .semibold))
                    }
                    .foregroundStyle(theme.tint)
                    .padding(.horizontal, 13)
                    .padding(.vertical, 8)
                    .background(theme.tintSoft)
                    .clipShape(Capsule())
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(.ultraThinMaterial)
        .overlay(alignment: .bottom) {
            Rectangle().fill(theme.separator).frame(height: 1)
        }
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Text("🔎")
                .font(.system(size: 15))
            TextField("Išči po naslovu", text: $searchText)
                .font(.system(size: 16))
                .autocorrectionDisabled()
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 40)
        .background(theme.surfaceMuted)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var folderTrigger: some View {
        Button {
            showFolderSheet = true
        } label: {
            HStack(spacing: 8) {
                Text("📁")
                    .font(.system(size: 16))
                Text(selectedFolderName)
                    .font(.system(size: 14.5, weight: .semibold))
                    .foregroundStyle(theme.label)
                    .lineLimit(1)
                Image(systemName: "chevron.down")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(theme.secondaryLabel)
            }
            .padding(.horizontal, 13)
            .frame(minHeight: 34)
            .background(theme.surfaceSolid)
            .clipShape(Capsule())
            .overlay(Capsule().stroke(theme.separator, lineWidth: 1))
            .shadow(color: .black.opacity(0.04), radius: 8, y: 3)
        }
    }

    private var selectedFolderName: String {
        guard let id = selectedFolderID,
              let folder = appModel.folders.first(where: { $0.id == id }) else {
            return "Vsi zapiski"
        }
        return folder.name
    }

    // MARK: - Note filtering

    private var filteredLectures: [LectureRow] {
        var result = appModel.lectures
        if let folderID = selectedFolderID {
            let ids = appModel.lectureIDs(inFolder: folderID)
            result = result.filter { ids.contains($0.id) }
        }
        let query = searchText.trimmingCharacters(in: .whitespaces).lowercased()
        if !query.isEmpty {
            result = result.filter { lecture in
                lecture.displayTitle.lowercased().contains(query)
                    || (lecture.errorMessage ?? "").lowercased().contains(query)
                    || sourceLabel(lecture).lowercased().contains(query)
            }
        }
        return result
    }

    private var failedLectures: [LectureRow] {
        filteredLectures.filter { $0.status == .failed }
    }

    private var regularLectures: [LectureRow] {
        filteredLectures.filter { $0.status != .failed }
    }

    @ViewBuilder
    private var failedSection: some View {
        if !failedLectures.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Text("Potrebno pozornosti")
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(theme.label)
                ForEach(failedLectures) { lecture in
                    failedCard(lecture)
                }
            }
        }
    }

    private func failedCard(_ lecture: LectureRow) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text("⚠️")
                .font(.system(size: 15))
                .frame(width: 32, height: 32)
                .background(theme.redSoft)
                .clipShape(Circle())
            VStack(alignment: .leading, spacing: 4) {
                Text(lecture.errorMessage != nil ? "Napaka pri obdelavi zapiska" : "Napaka pri ustvarjanju zapiska")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(theme.red)
                Text(lecture.errorMessage ?? "Poskusi znova ali odstrani zapisek iz knjižnice.")
                    .font(.system(size: 13))
                    .foregroundStyle(theme.label)
                HStack(spacing: 9) {
                    Button {
                        Task { _ = await appModel.retryLecture(id: lecture.id) }
                    } label: {
                        Text("Poskusi znova")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(theme.tint)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 7)
                            .background(theme.tintSoft)
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }
                    Button {
                        deleteTarget = lecture
                    } label: {
                        Text("Izbriši")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(theme.red)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 7)
                            .background(theme.redSoft)
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }
                }
                .padding(.top, 4)
            }
            Spacer(minLength: 0)
        }
        .memoCard()
    }

    @ViewBuilder
    private var noteList: some View {
        if regularLectures.isEmpty && failedLectures.isEmpty {
            emptyState
        } else {
            VStack(spacing: 11) {
                ForEach(regularLectures) { lecture in
                    noteRow(lecture)
                }
            }
        }
    }

    private func noteRow(_ lecture: LectureRow) -> some View {
        HomeLectureSwipeRow(
            lecture: lecture,
            subtitle: "\(sourceLabel(lecture)) • \(MemoFormat.calendarDate(lecture.createdAt))",
            emoji: sourceEmoji(lecture),
            isOpen: Binding(
                get: { openSwipeLectureID == lecture.id },
                set: { openSwipeLectureID = $0 ? lecture.id : nil }
            ),
            open: { openLecture(lecture) },
            rename: { renameTarget = lecture },
            delete: { deleteTarget = lecture }
        )
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Text("📝")
                .font(.system(size: 40))
            Text(emptyTitle)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(theme.label)
            Text(emptySubtitle)
                .font(.system(size: 14))
                .foregroundStyle(theme.secondaryLabel)
                .multilineTextAlignment(.center)
            if searchText.isEmpty && selectedFolderID == nil {
                Button {
                    openQuickAction(.record)
                } label: {
                    HStack(spacing: 4) {
                        Text("Ustvari svoj prvi zapisek")
                            .font(.system(size: 15, weight: .semibold))
                        Image(systemName: "chevron.right")
                            .font(.system(size: 12, weight: .semibold))
                    }
                    .foregroundStyle(theme.tint)
                }
                .padding(.top, 6)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 48)
    }

    private var emptyTitle: String {
        if !searchText.isEmpty {
            return "Ni ujemajočih zapiskov"
        }
        if selectedFolderID != nil {
            return "Ta mapa je prazna"
        }
        return "Tvoja knjižnica je prazna"
    }

    private var emptySubtitle: String {
        if !searchText.isEmpty {
            return "Poskusi krajši iskalni izraz ali počisti iskanje."
        }
        if selectedFolderID != nil {
            return "Dodaj predavanja v to mapo ali se vrni na vse zapiske."
        }
        return "Začni s posnetkom, zvočno datoteko, PDF-jem, PPTX-om, besedilom ali povezavo."
    }

    private func sourceEmoji(_ lecture: LectureRow) -> String {
        switch lecture.sourceType {
        case "link": "🔗"
        case "text", "pdf", "presentation": "📄"
        default: "🎙️"
        }
    }

    private func sourceLabel(_ lecture: LectureRow) -> String {
        switch lecture.sourceType {
        case "link": "Povezava"
        case "text": "Besedilo"
        case "pdf": "PDF"
        case "presentation": "Predstavitev"
        default: "Zvok"
        }
    }

    // Poll every 8 s while anything is processing (mirrors POLL_INTERVAL_MS).
    private func startPollingIfNeeded() {
        let hasProcessing = appModel.lectures.contains { $0.status.isProcessing }
        if hasProcessing, pollTask == nil {
            pollTask = Task {
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(8))
                    if Task.isCancelled {
                        break
                    }
                    await appModel.pollLibrary()
                    if !appModel.lectures.contains(where: { $0.status.isProcessing }) {
                        break
                    }
                }
                pollTask = nil
            }
        }
    }
}

private struct HomeLectureSwipeRow: View {
    @Environment(\.memoTheme) private var theme
    let lecture: LectureRow
    let subtitle: String
    let emoji: String
    @Binding var isOpen: Bool
    let open: () -> Void
    let rename: () -> Void
    let delete: () -> Void

    private enum DragAxis {
        case horizontal
        case vertical
    }

    @State private var dragOffset: CGFloat = 0
    @State private var dragAxis: DragAxis?
    @State private var dragStartedOpen = false
    @State private var suppressTap = false

    // Keep these dimensions in lockstep with the mobile web swipe tray:
    // 8.15rem total, two 3.7rem actions and a 0.35rem gap.
    private let actionWidth: CGFloat = 130.4
    private let actionButtonWidth: CGFloat = 59.2
    private let actionGap: CGFloat = 5.6

    var body: some View {
        ZStack(alignment: .trailing) {
            HStack(spacing: actionGap) {
                Spacer()
                swipeAction(title: "Uredi", icon: "pencil", destructive: false) {
                    close()
                    rename()
                }
                swipeAction(title: "Izbriši", icon: "trash", destructive: true) {
                    close()
                    delete()
                }
            }
            .padding(.leading, actionGap)
            .frame(width: actionWidth)
            .opacity(revealProgress)
            .allowsHitTesting(isOpen && dragAxis == nil)

            HStack(spacing: 15) {
                EmojiChip(emoji: emoji, size: 42)
                VStack(alignment: .leading, spacing: 3) {
                    Text(lecture.displayTitle)
                        .font(.system(size: 15.5, weight: .medium))
                        .foregroundStyle(theme.label)
                        .lineLimit(1)
                    Text(subtitle)
                        .font(.system(size: 13))
                        .foregroundStyle(theme.secondaryLabel)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
                if lecture.status != .ready {
                    StatusBadge(status: lecture.status)
                }
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 16)
            .background(theme.surfaceSolid)
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(theme.separator, lineWidth: 1)
            )
            .shadow(color: .black.opacity(0.04), radius: 8, y: 3)
            .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .onTapGesture {
                guard !suppressTap else { return }
                if !isOpen {
                    open()
                } else {
                    close()
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isButton)
            .accessibilityAction {
                guard !isOpen else {
                    close()
                    return
                }
                open()
            }
            // Reveal the action tray from the trailing edge without pushing the
            // card's leading corner outside the viewport. This preserves the
            // rounded left edge throughout the interactive drag.
            .padding(.trailing, max(0, -visibleOffset))
            .simultaneousGesture(
                // A short minimum distance makes the child row win before the
                // enclosing ScrollView can recognise a vertical pan (especially
                // on iOS 18+). A deliberate 18 pt threshold keeps horizontal
                // swipe actions responsive while preserving natural library
                // scrolling through the rows.
                DragGesture(minimumDistance: 18)
                    .onChanged { value in
                        if dragAxis == nil {
                            let horizontal = abs(value.translation.width)
                            let vertical = abs(value.translation.height)
                            guard max(horizontal, vertical) >= 6 else { return }
                            dragAxis = horizontal > vertical ? .horizontal : .vertical
                            dragStartedOpen = isOpen
                            suppressTap = true
                        }

                        guard dragAxis == .horizontal else { return }
                        var transaction = Transaction()
                        transaction.animation = nil
                        withTransaction(transaction) {
                            dragOffset = value.translation.width
                        }
                    }
                    .onEnded { value in
                        // Very quick swipes can finish before SwiftUI delivers a
                        // second onChanged sample. Resolve the axis from the final
                        // translation as a fallback so the gesture still settles
                        // deterministically instead of snapping back.
                        let resolvedAxis = dragAxis ?? (
                            abs(value.translation.width) > abs(value.translation.height)
                                ? DragAxis.horizontal
                                : DragAxis.vertical
                        )
                        guard resolvedAxis == .horizontal else {
                            resetDragState()
                            return
                        }
                        let startedOpen = dragAxis == .horizontal ? dragStartedOpen : isOpen
                        let startOffset = startedOpen ? -actionWidth : 0
                        let finalOffset = min(0, max(-actionWidth, startOffset + value.translation.width))
                        let shouldOpen = finalOffset < -actionWidth / 2
                        let changed = shouldOpen != isOpen
                        withAnimation(.spring(response: 0.26, dampingFraction: 0.92)) {
                            isOpen = shouldOpen
                            dragOffset = 0
                            dragAxis = nil
                        }
                        if changed {
                            MemoHaptics.selection()
                        }
                        allowTapAfterGestureSettles()
                    }
            )
            .contextMenu {
                Button(action: rename) { Label("Preimenuj", systemImage: "pencil") }
                Button(role: .destructive, action: delete) { Label("Izbriši", systemImage: "trash") }
            }
        }
        .frame(maxWidth: .infinity)
    }

    private var visibleOffset: CGFloat {
        let startsOpen = dragAxis == .horizontal ? dragStartedOpen : isOpen
        let translation = dragAxis == .horizontal ? dragOffset : 0
        return min(0, max(-actionWidth, (startsOpen ? -actionWidth : 0) + translation))
    }

    private var revealProgress: CGFloat {
        min(1, max(0, -visibleOffset / actionWidth))
    }

    private func swipeAction(
        title: String,
        icon: String,
        destructive: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            VStack(spacing: 5) {
                Image(systemName: icon)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(destructive ? Color.white : theme.label)
                    .frame(width: 46.4, height: 46.4)
                    .background(destructive ? theme.red : theme.surfaceSolid)
                    .clipShape(Circle())
                    .overlay(
                        Circle()
                            .stroke(destructive ? theme.red.opacity(0.55) : theme.separator, lineWidth: 1)
                    )
                    .shadow(
                        color: destructive ? theme.red.opacity(0.28) : .black.opacity(0.14),
                        radius: 8,
                        y: 4
                    )
                Text(title)
                    .font(.system(size: 10.5, weight: .semibold))
                    .foregroundStyle(destructive ? theme.red : theme.secondaryLabel)
            }
            .frame(width: actionButtonWidth)
            .frame(maxHeight: .infinity)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func close() {
        withAnimation(.spring(response: 0.26, dampingFraction: 0.92)) {
            isOpen = false
        }
    }

    private func resetDragState() {
        dragOffset = 0
        dragAxis = nil
        allowTapAfterGestureSettles()
    }

    private func allowTapAfterGestureSettles() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
            suppressTap = false
        }
    }
}

// MARK: - Rename sheet

struct RenameLectureSheet: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.memoTheme) private var theme
    @Environment(\.dismiss) private var dismiss
    let lecture: LectureRow

    @State private var title: String
    @State private var isSaving = false

    init(lecture: LectureRow) {
        self.lecture = lecture
        _title = State(initialValue: lecture.title ?? "")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Preimenuj zapisek")
                .font(.system(size: 20, weight: .bold))
                .foregroundStyle(theme.label)
            Text("Daj temu zapisku bolj jasen naslov, ne da zapustiš stran.")
                .font(.system(size: 14))
                .foregroundStyle(theme.secondaryLabel)

            Text("Naslov")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(theme.secondaryLabel)
                .padding(.top, 6)
            TextField("Neimenovan zapisek", text: $title)
                .font(.system(size: 16))
                .memoField(minHeight: 50)

            Button {
                save()
            } label: {
                if isSaving {
                    ProgressView().tint(.white)
                } else {
                    Text("Shrani naslov")
                }
            }
            .buttonStyle(MemoPrimaryButtonStyle())
            .disabled(trimmedTitle.isEmpty || trimmedTitle == (lecture.title ?? "") || isSaving)

            Button("Prekliči") {
                dismiss()
            }
            .buttonStyle(MemoSecondaryButtonStyle())
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(theme.sheetBackground.ignoresSafeArea())
    }

    private var trimmedTitle: String {
        title.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func save() {
        isSaving = true
        Task {
            let success = await appModel.renameLecture(id: lecture.id, title: trimmedTitle)
            isSaving = false
            if success {
                dismiss()
            }
        }
    }
}

// MARK: - Folders

/// A regular emoji folder keeps folder affordances consistent with the rest
/// of the app's emoji-led mobile navigation.
struct FolderGlyph: View {
    var size: CGFloat = 24
    var open = false

    var body: some View {
        Text(open ? "📂" : "📁")
            .font(.system(size: size))
            .frame(width: size, height: size)
    }
}

enum FolderEditorMode: Identifiable {
    case create
    case edit(LibraryFolderRow)

    var id: String {
        switch self {
        case .create: "create"
        case .edit(let folder): folder.id
        }
    }
}

struct FolderMenuSheet: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.memoTheme) private var theme
    @Environment(\.dismiss) private var dismiss
    @Binding var selectedFolderID: String?
    let openEditor: (FolderEditorMode) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Mape")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(theme.label)
                Spacer()
                MemoCloseButton(size: 30, accessibilityLabel: "Zapri mape") {
                    dismiss()
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 18)
            .padding(.bottom, 10)

            ScrollView(showsIndicators: false) {
                VStack(spacing: 6) {
                    folderRow(
                        name: "Vsi zapiski",
                        count: appModel.lectures.count,
                        isActive: selectedFolderID == nil
                    ) {
                        selectedFolderID = nil
                        dismiss()
                    }

                    ForEach(appModel.folders) { folder in
                        folderRow(
                            name: folder.name,
                            count: appModel.lectureIDs(inFolder: folder.id).count,
                            isActive: selectedFolderID == folder.id
                        ) {
                            selectedFolderID = folder.id
                            dismiss()
                        }
                    }

                    Divider()
                        .padding(.vertical, 8)

                    actionRow(emoji: "➕", label: "Nova mapa") {
                        openEditor(.create)
                    }
                    if let first = appModel.folders.first(where: { $0.id == selectedFolderID }) ?? appModel.folders.first {
                        actionRow(emoji: "✏️", label: "Uredi mape") {
                            openEditor(.edit(first))
                        }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 24)
            }
        }
        .background(theme.sheetBackground.ignoresSafeArea())
    }

    private func folderRow(name: String, count: Int, isActive: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                FolderGlyph(size: 26)
                Text(name)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(theme.label)
                    .lineLimit(1)
                Spacer()
                Text(MemoFormat.lectureCount(count))
                    .font(.system(size: 13))
                    .foregroundStyle(theme.secondaryLabel)
                if isActive {
                    Image(systemName: "checkmark")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(theme.tint)
                }
            }
            .padding(.horizontal, 14)
            .frame(minHeight: 52)
            .background(isActive ? theme.tintSoft : theme.surfaceMuted.opacity(0.6))
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
    }

    private func actionRow(emoji: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Text(emoji)
                    .font(.system(size: 16))
                Text(label)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(theme.label)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(theme.tertiaryLabel)
            }
            .padding(.horizontal, 14)
            .frame(minHeight: 52)
            .background(theme.surfaceMuted.opacity(0.6))
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
    }
}

struct FolderEditorSheet: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.memoTheme) private var theme
    @Environment(\.dismiss) private var dismiss
    let mode: FolderEditorMode
    @Binding var selectedFolderID: String?

    @State private var editingFolder: LibraryFolderRow?
    @State private var name = ""
    @State private var selectedLectureIDs: Set<String> = []
    @State private var isSaving = false
    @State private var isDeleting = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                Text(isEditing ? "Uredi mapo" : "Nova mapa")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(theme.label)
                FolderGlyph(size: 26, open: true)
                Spacer()
                MemoCloseButton(size: 30) {
                    dismiss()
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 18)
            .padding(.bottom, 12)

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 14) {
                    if isEditing, appModel.folders.count > 1 {
                        Text("Izberi mapo")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(theme.secondaryLabel)
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(appModel.folders) { folder in
                                    Button {
                                        select(folder)
                                    } label: {
                                        Text(folder.name)
                                            .font(.system(size: 14, weight: .semibold))
                                            .foregroundStyle(editingFolder?.id == folder.id ? .white : theme.label)
                                            .padding(.horizontal, 14)
                                            .padding(.vertical, 8)
                                            .background(editingFolder?.id == folder.id ? theme.tint : theme.surfaceMuted)
                                            .clipShape(Capsule())
                                    }
                                }
                            }
                        }
                    }

                    Text("Ime")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(theme.secondaryLabel)
                    TextField("Biologija, Matematika, Zgodovina...", text: $name)
                        .font(.system(size: 16))
                        .memoField(minHeight: 50)

                    Text("Dodaj predavanja")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(theme.secondaryLabel)
                        .padding(.top, 4)

                    if appModel.lectures.isEmpty {
                        Text("Najprej ustvari zapiske, nato jih razporedi v mape.")
                            .font(.system(size: 14))
                            .foregroundStyle(theme.secondaryLabel)
                    } else {
                        VStack(spacing: 6) {
                            ForEach(appModel.lectures) { lecture in
                                lectureCheckRow(lecture)
                            }
                        }
                    }

                    Button {
                        save()
                    } label: {
                        if isSaving {
                            HStack(spacing: 8) {
                                ProgressView().tint(.white)
                                Text(isEditing ? "Shranjujem..." : "Ustvarjam...")
                            }
                        } else {
                            Text(isEditing ? "Shrani spremembe" : "Ustvari")
                        }
                    }
                    .buttonStyle(MemoPrimaryButtonStyle())
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || isSaving)
                    .padding(.top, 8)

                    Button("Prekliči") {
                        dismiss()
                    }
                    .buttonStyle(MemoSecondaryButtonStyle())

                    if isEditing {
                        Button {
                            deleteFolder()
                        } label: {
                            HStack(spacing: 8) {
                                if isDeleting {
                                    ProgressView().tint(theme.red)
                                    Text("Brišem...")
                                } else {
                                    Text("🗑️")
                                    Text("Izbriši mapo")
                                }
                            }
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(theme.red)
                            .frame(maxWidth: .infinity, minHeight: 52)
                            .background(theme.redSoft)
                            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                        }
                        .disabled(isDeleting)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 30)
            }
        }
        .background(theme.sheetBackground.ignoresSafeArea())
        .onAppear(perform: prepare)
    }

    private var isEditing: Bool {
        if case .edit = mode {
            return true
        }
        return editingFolder != nil
    }

    private func prepare() {
        if case .edit(let folder) = mode {
            select(folder)
        }
    }

    private func select(_ folder: LibraryFolderRow) {
        editingFolder = folder
        name = folder.name
        selectedLectureIDs = appModel.lectureIDs(inFolder: folder.id)
    }

    private func lectureCheckRow(_ lecture: LectureRow) -> some View {
        Button {
            if selectedLectureIDs.contains(lecture.id) {
                selectedLectureIDs.remove(lecture.id)
            } else {
                selectedLectureIDs.insert(lecture.id)
            }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: selectedLectureIDs.contains(lecture.id) ? "checkmark.square.fill" : "square")
                    .font(.system(size: 20))
                    .foregroundStyle(selectedLectureIDs.contains(lecture.id) ? theme.tint : theme.tertiaryLabel)
                VStack(alignment: .leading, spacing: 2) {
                    Text(lecture.displayTitle)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(theme.label)
                        .lineLimit(1)
                    Text(MemoFormat.relativeDate(lecture.createdAt))
                        .font(.system(size: 12.5))
                        .foregroundStyle(theme.secondaryLabel)
                }
                Spacer()
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(theme.surfaceMuted.opacity(0.6))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
    }

    private func save() {
        isSaving = true
        Task {
            let success: Bool
            if let folder = editingFolder {
                success = await appModel.updateFolder(
                    id: folder.id,
                    name: name.trimmingCharacters(in: .whitespaces),
                    lectureIDs: Array(selectedLectureIDs)
                )
            } else {
                success = await appModel.createFolder(
                    name: name.trimmingCharacters(in: .whitespaces),
                    lectureIDs: Array(selectedLectureIDs)
                )
            }
            isSaving = false
            if success {
                dismiss()
            }
        }
    }

    private func deleteFolder() {
        guard let folder = editingFolder else {
            return
        }
        isDeleting = true
        Task {
            let success = await appModel.deleteFolder(id: folder.id)
            isDeleting = false
            if success {
                if selectedFolderID == folder.id {
                    selectedFolderID = nil
                }
                dismiss()
            }
        }
    }
}
