import AVFoundation
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

// Lecture detail workspace matching the web LectureWorkspace:
// header (title + date + processing note), segmented tabs
// (Zapiski / Učenje / Klepet / Prepis), and per-tab panels.

enum WorkspaceTab: String, CaseIterable, Identifiable {
    case notes
    case study
    case chat
    case transcript
    case audio

    var id: String { rawValue }

    var emoji: String {
        switch self {
        case .notes: "📝"
        case .study: "🧠"
        case .chat: "💬"
        case .transcript: "📜"
        case .audio: "🎧"
        }
    }

    var label: String {
        switch self {
        case .notes: "Zapiski"
        case .study: "Učenje"
        case .chat: "Klepet"
        case .transcript: "Prepis"
        case .audio: "Zvok"
        }
    }
}

struct LectureWorkspaceView: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.memoTheme) private var theme
    let lecture: LectureRow
    let openAppTab: (AppTab) -> Void

    @State private var activeTab: WorkspaceTab = .notes
    @State private var activeStudyMode: StudyMode = .flashcards
    @State private var pollTask: Task<Void, Never>?
    @State private var dockOpen = false
    @State private var showStudyManager = false
    @State private var noteSelection: NoteWordSelection?
    @State private var annotationColorID = "orange"
    @State private var annotationPaletteOpen = false
    @State private var annotationPhoto: PhotosPickerItem?
    @StateObject private var speech = NoteSpeechController()

    init(lecture: LectureRow, openAppTab: @escaping (AppTab) -> Void = { _ in }) {
        self.lecture = lecture
        self.openAppTab = openAppTab
    }

    private var detail: LectureDetail? {
        guard appModel.selectedLectureDetail?.lecture.id == lecture.id else {
            return nil
        }
        return appModel.selectedLectureDetail
    }

    private var currentLecture: LectureRow {
        detail?.lecture ?? lecture
    }

    private var showsTranscript: Bool {
        // Web shows the transcript tab for audio-source lectures even while
        // the transcript is still being prepared.
        if !(detail?.transcript.isEmpty ?? true) {
            return true
        }
        return currentLecture.sourceType == "audio" || currentLecture.sourceType == "scan"
    }

    private var recordingURL: URL? {
        detail?.audioUrl.flatMap { $0.isEmpty ? nil : URL(string: $0) }
    }

    private var visibleTabs: [WorkspaceTab] {
        var tabs: [WorkspaceTab] = [.notes, .study, .chat]
        if showsTranscript {
            tabs.append(.transcript)
        }
        if recordingURL != nil {
            tabs.append(.audio)
        }
        return tabs
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            VStack(spacing: 0) {
                topBar
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 16) {
                        header
                        tabBar
                        panel
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 10)
                    .padding(.bottom, 16)
                }
                // The dock and the action pill float over this scroll view. A
                // trailing content padding is not enough: panels that size
                // themselves to the viewport (the flashcard reviewer) then lay
                // their controls out underneath the pill, so "Good" and "next"
                // were only half tappable. Reserving the strip as safe area
                // shrinks the viewport instead, which every panel respects.
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    Color.clear.frame(height: workspaceOverlayHeight)
                }
            }

            if dockOpen {
                Color.clear
                    .contentShape(Rectangle())
                    .ignoresSafeArea()
                    .padding(.bottom, 88)
                    .onTapGesture { closeDock() }
                    .accessibilityHidden(true)
                    .zIndex(1)
            }

            workspaceBottomOverlay
                .zIndex(2)
        }
        .background(theme.canvas.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .task {
            await appModel.loadLecture(lecture)
            await speech.configure(
                configuration: appModel.configuration,
                session: appModel.session,
                lectureID: lecture.id
            )
            startPollingIfNeeded()
            #if DEBUG
            if let raw = ProcessInfo.processInfo.environment["MEMO_DEBUG_WTAB"],
               let parsed = WorkspaceTab(rawValue: raw) {
                activeTab = parsed
            }
            if ProcessInfo.processInfo.environment["MEMO_DEBUG_STUDY_MANAGER"] == "1" {
                activeTab = .study
                try? await Task.sleep(for: .milliseconds(250))
                showStudyManager = true
            }
            if ProcessInfo.processInfo.environment["MEMO_DEBUG_AUDIO_GUIDE"] == "1" {
                try? await Task.sleep(for: .milliseconds(250))
                await speech.toggle()
            }
            #endif
        }
        .onDisappear {
            pollTask?.cancel()
            pollTask = nil
            speech.stop()
        }
        .onChange(of: activeTab) {
            noteSelection = nil
            annotationPaletteOpen = false
        }
        .onChange(of: visibleTabs) { _, tabs in
            // Mirrors the web effects that fall back to the notes tab when the
            // transcript or recording tab disappears.
            if !tabs.contains(activeTab) {
                activeTab = .notes
            }
        }
        .onChange(of: appModel.selectedLectureDetail?.hasPendingStudyGeneration ?? false) { _, pending in
            // Queueing study material, a quiz or a practice test restarts the
            // poller so the workspace fills in as soon as generation lands.
            if pending {
                startPollingIfNeeded()
            }
        }
        .onChange(of: appModel.session) { _, refreshedSession in
            Task {
                await speech.configure(
                    configuration: appModel.configuration,
                    session: refreshedSession,
                    lectureID: lecture.id
                )
            }
        }
        .onChange(of: annotationPhoto) { _, item in
            guard let item, let selection = noteSelection else { return }
            uploadAnnotationPhoto(item, afterBlockID: selection.blockID)
        }
        .sheet(isPresented: $showStudyManager) {
            StudyManagerSheet(lecture: currentLecture, detail: detail, initialMode: activeStudyMode)
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
    }

    private var notesMarkdown: String {
        guard let markdown = detail?.artifact?.bestNotesMarkdown else {
            return ""
        }
        return MemoMarkdown.strippingRedundantLeadingHeading(markdown, title: currentLecture.title)
    }

    /// Height of the floating dock/pill strip that sits over the scroll view.
    private var workspaceOverlayHeight: CGFloat { 72 }

    private var workspaceBottomOverlay: some View {
        HStack(alignment: .bottom, spacing: 12) {
            workspaceDock
            Spacer()
            if activeTab == .notes, noteSelection != nil {
                annotationPill
            } else if activeTab == .notes, !notesMarkdown.isEmpty {
                listenPill
            } else if activeTab == .study, canManageActiveStudyView {
                manageStudyPill
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 0)
    }

    private var annotationPill: some View {
        HStack(spacing: 7) {
            if annotationPaletteOpen {
                ForEach(NoteSpeechController.highlightColors, id: \.self) { colorID in
                    Button {
                        annotationColorID = colorID
                        annotationPaletteOpen = false
                    } label: {
                        Circle()
                            .fill(NoteReadHighlightPalette.current(colorID))
                            .frame(width: 25, height: 25)
                            .overlay(
                                Circle().stroke(.white, lineWidth: annotationColorID == colorID ? 2.5 : 0)
                            )
                    }
                    .accessibilityLabel("Barva \(colorID)")
                }
            } else {
                Button {
                    applyAnnotation("highlight")
                } label: {
                    Label("Označi", systemImage: "highlighter")
                        .font(.system(size: 14, weight: .bold))
                }
                Button {
                    applyAnnotation("underline")
                } label: {
                    Image(systemName: "underline")
                        .font(.system(size: 16, weight: .bold))
                }
                Button {
                    annotationPaletteOpen = true
                } label: {
                    Image(systemName: "paintpalette")
                        .font(.system(size: 16, weight: .bold))
                }
                PhotosPicker(selection: $annotationPhoto, matching: .images) {
                    Image(systemName: "photo.badge.plus")
                        .font(.system(size: 16, weight: .bold))
                }
                .accessibilityLabel("Dodaj fotografijo")
                Button {
                    noteSelection = nil
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 13, weight: .bold))
                }
                .accessibilityLabel("Zapri orodja")
            }
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 15)
        .frame(minHeight: 51)
        .memoLiquidGlassCapsule(tint: Color(hex: 0x2563EB))
        .shadow(color: Color(hex: 0x2563EB).opacity(0.28), radius: 14, y: 7)
        .animation(.spring(response: 0.28, dampingFraction: 0.86), value: annotationPaletteOpen)
    }

    private func applyAnnotation(_ kind: String) {
        guard let selection = noteSelection else { return }
        Task {
            let success = await appModel.toggleNoteAnnotation(
                lectureID: currentLecture.id,
                startWordIndex: selection.startWordIndex,
                endWordIndex: selection.endWordIndex,
                kind: kind,
                colorID: annotationColorID
            )
            if success {
                noteSelection = nil
                annotationPaletteOpen = false
            }
        }
    }

    private func uploadAnnotationPhoto(_ item: PhotosPickerItem, afterBlockID: String) {
        Task {
            defer { annotationPhoto = nil }
            guard let data = try? await item.loadTransferable(type: Data.self), !data.isEmpty else {
                appModel.errorMessage = "Fotografije ni bilo mogoče prebrati."
                return
            }
            let contentType = item.supportedContentTypes.first ?? .jpeg
            _ = await appModel.addNotePhoto(
                lectureID: currentLecture.id,
                data: data,
                fileName: "photo-\(UUID().uuidString).\(contentType.preferredFilenameExtension ?? "jpg")",
                mimeType: contentType.preferredMIMEType ?? "image/jpeg",
                afterBlockID: afterBlockID
            )
            noteSelection = nil
        }
    }

    private var workspaceDock: some View {
        ZStack(alignment: .leading) {
            MemoDraggableNavigationDock(
                items: [AppTab.home, .support, .settings],
                selected: .home,
                width: 280,
                height: 51
            ) { tab in
                closeDock()
                openAppTab(tab)
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
                Text("🏠")
                    .font(.system(size: 21))
                    .frame(width: 51, height: 51)
            }
            .accessibilityLabel("Odpri navigacijo")
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

    private var listenPill: some View {
        Button {
            MemoHaptics.impact(.light)
            closeDock()
            Task { await speech.toggle() }
        } label: {
            HStack(spacing: dockOpen ? 0 : 8) {
                Text(speech.isPreparing ? "⏳" : speech.isSpeaking && !speech.isPaused ? "⏸️" : "🎧")
                    .font(.system(size: 19))
                Text(
                    speech.isPreparing
                        ? "Pripravljam..."
                        : speech.isPaused
                            ? "Nadaljuj"
                            : speech.isSpeaking ? "Premor" : "Poslušaj"
                )
                    .font(.system(size: 16, weight: .bold))
                    .lineLimit(1)
                    .fixedSize(horizontal: true, vertical: false)
                    .frame(width: dockOpen ? 0 : nil, alignment: .center)
                    .opacity(dockOpen ? 0 : 1)
                    .clipped()
            }
            .foregroundStyle(.white)
            .frame(width: dockOpen ? 51 : 178, height: 51)
            .memoLiquidGlassCapsule(tint: theme.tint)
            .shadow(color: theme.tint.opacity(0.28), radius: 14, y: 7)
        }
        .disabled(speech.isPreparing)
        .accessibilityLabel(speech.isPreparing ? "Pripravljam zvok" : speech.isSpeaking && !speech.isPaused ? "Premor" : speech.isPaused ? "Nadaljuj poslušanje" : "Poslušaj zapiske")
        .animation(MemoMotion.dock, value: dockOpen)
        .animation(MemoMotion.dockLabel, value: dockOpen)
    }

    private var manageStudyPill: some View {
        Button {
            MemoHaptics.impact(.light)
            closeDock()
            showStudyManager = true
        } label: {
            HStack(spacing: dockOpen ? 0 : 8) {
                Text("✏️")
                    .font(.system(size: 19))
                Text("Uredi")
                    .font(.system(size: 16, weight: .bold))
                    .lineLimit(1)
                    .frame(width: dockOpen ? 0 : 68, alignment: .leading)
                    .opacity(dockOpen ? 0 : 1)
                    .clipped()
            }
            .foregroundStyle(.white)
            .frame(width: dockOpen ? 51 : 178, height: 51)
            .memoLiquidGlassCapsule(tint: theme.green)
            .shadow(color: theme.green.opacity(0.28), radius: 14, y: 7)
        }
        .accessibilityLabel("Uredi učna gradiva")
        .animation(MemoMotion.dock, value: dockOpen)
        .animation(MemoMotion.dockLabel, value: dockOpen)
    }

    private var canManageActiveStudyView: Bool {
        switch activeStudyMode {
        case .flashcards:
            return !(detail?.flashcards.isEmpty ?? true)
        case .quiz:
            return !(detail?.quizQuestions.isEmpty ?? true)
        case .practiceTest:
            return false
        }
    }

    private func closeDock() {
        withAnimation(MemoMotion.dock) {
            dockOpen = false
        }
    }

    private var topBar: some View {
        HStack(spacing: 0) {
            MemoBrandBanner(height: 40)
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(.ultraThinMaterial)
        .overlay(alignment: .bottom) {
            Rectangle().fill(theme.separator).frame(height: 1)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(currentLecture.title ?? "Predavanje v obdelavi")
                .font(.system(size: 32, weight: .bold))
                .tracking(-1.25)
                .foregroundStyle(theme.label)
            Text(MemoFormat.calendarDate(currentLecture.createdAt))
                .font(.system(size: 14.5))
                .foregroundStyle(theme.secondaryLabel)

            if let error = currentLecture.errorMessage {
                MemoBanner(kind: .error, message: error)
                    .padding(.top, 6)
            }
            if currentLecture.status.isProcessing {
                Text("Obdelava še poteka. Ta pogled se samodejno osvežuje.")
                    .font(.system(size: 13.5))
                    .foregroundStyle(theme.secondaryLabel)
                    .padding(.top, 4)
            }
        }
    }

    private var tabBar: some View {
        // Web mobile shows icon-only segments.
        MemoGlassSegmentedPicker(
            items: visibleTabs,
            selection: $activeTab,
            minHeight: 28,
            cornerRadius: 8
        ) { tab, _ in
            Text(tab.emoji)
                .font(.system(size: 16))
                .accessibilityLabel(tab.label)
        }
        .frame(height: 32)
    }

    @ViewBuilder
    private var panel: some View {
        switch activeTab {
        case .notes:
            NotesPanel(
                lecture: currentLecture,
                detail: detail,
                speech: speech,
                selection: $noteSelection
            )
        case .study:
            StudyPanel(lecture: currentLecture, detail: detail, mode: $activeStudyMode)
        case .chat:
            ChatPanel(lecture: currentLecture, detail: detail)
        case .transcript:
            TranscriptPanel(detail: detail)
        case .audio:
            RecordingPlaybackPanel(url: recordingURL)
        }
    }

    // Poll the lecture detail while the note itself is processing or while any
    // study asset is still queued/generating (mirrors the web auto-refresh).
    private func startPollingIfNeeded() {
        guard pollTask == nil else {
            return
        }
        pollTask = Task {
            while !Task.isCancelled {
                let detail = appModel.selectedLectureDetail
                let processing = (detail?.lecture.status ?? lecture.status).isProcessing
                let generating = detail?.hasPendingStudyGeneration ?? false
                guard processing || generating else {
                    break
                }
                // Asset generation finishes faster than transcription, so poll
                // it at the web app's faster cadence.
                try? await Task.sleep(for: .seconds(processing ? 8 : 4))
                if Task.isCancelled {
                    break
                }
                await appModel.pollLectureDetail(lectureID: lecture.id)
            }
            pollTask = nil
        }
    }
}

@MainActor
final class NoteSpeechController: ObservableObject {
    static let voices = ["Grace", "Maya", "Emma", "Claire", "Nina", "Daniel", "Adrian", "Noah"]
    static let speeds: [Double] = [0.5, 1, 1.5, 2]
    static let highlightColors = ["orange", "yellow", "green", "blue", "pink"]

    @Published private(set) var isSpeaking = false
    @Published private(set) var isPaused = false
    @Published private(set) var isPreparing = false
    @Published private(set) var generationPercent: Int?
    @Published private(set) var status: NoteTTSStatus?
    @Published private(set) var completedWordIndex = -1
    @Published private(set) var currentWordIndex: Int?
    @Published private(set) var errorMessage: String?
    @Published var speed: Double {
        didSet {
            UserDefaults.standard.set(speed, forKey: "memo-note-tts-rate")
            if isSpeaking { player?.rate = Float(speed) }
        }
    }
    @Published var voice: String {
        didSet {
            guard oldValue != voice else { return }
            UserDefaults.standard.set(voice, forKey: "memo-note-tts-voice")
            resetPlayback(clearCache: true)
        }
    }
    @Published var highlightColorID: String {
        didSet { UserDefaults.standard.set(highlightColorID, forKey: "memo-note-tts-color") }
    }

    private var api: MemoAPIClient?
    private var session: MemoSession?
    private var lectureID: String?
    private var readSessionID = UUID().uuidString
    private var chunks: [Int: NoteTTSChunk] = [:]
    private var pendingChunks: [Int: Task<NoteTTSChunk?, Never>] = [:]
    private var activeChunkIndex = 0
    private var activeChunk: NoteTTSChunk?
    private var player: AVPlayer?
    private var timeObserver: Any?
    private var endObserver: NSObjectProtocol?
    private var progressTask: Task<Void, Never>?

    init() {
        let storedSpeed = UserDefaults.standard.double(forKey: "memo-note-tts-rate")
        speed = Self.speeds.contains(storedSpeed) ? storedSpeed : 1
        let storedVoice = UserDefaults.standard.string(forKey: "memo-note-tts-voice") ?? "Grace"
        voice = Self.voices.contains(storedVoice) ? storedVoice : "Grace"
        let storedColor = UserDefaults.standard.string(forKey: "memo-note-tts-color") ?? "orange"
        highlightColorID = Self.highlightColors.contains(storedColor) ? storedColor : "orange"
    }

    func configure(configuration: AppConfiguration, session: MemoSession?, lectureID: String) async {
        if self.lectureID != lectureID {
            stop()
            self.lectureID = lectureID
            api = MemoAPIClient(configuration: configuration)
            self.session = session
        } else if self.session != session {
            self.session = session
        }
        guard let api, let session else { return }
        do {
            status = try await api.fetchNoteTTSStatus(lectureID: lectureID, session: session)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func toggle() async {
        if isPreparing { return }
        if isSpeaking {
            player?.pause()
            isSpeaking = false
            isPaused = true
            return
        }
        if isPaused, let player, activeChunk != nil {
            player.playImmediately(atRate: Float(speed))
            isSpeaking = true
            isPaused = false
            return
        }
        guard await ensureAvailable() else { return }
        await playChunk(activeChunkIndex, showProgress: true)
    }

    func stop() {
        progressTask?.cancel()
        progressTask = nil
        removePlayerObservers()
        player?.pause()
        player = nil
        chunks.removeAll()
        pendingChunks.values.forEach { $0.cancel() }
        pendingChunks.removeAll()
        activeChunk = nil
        activeChunkIndex = 0
        readSessionID = UUID().uuidString
        generationPercent = nil
        isPreparing = false
        isSpeaking = false
        isPaused = false
        completedWordIndex = -1
        currentWordIndex = nil
    }

    var remainingPercent: Int {
        Int((status?.remainingFraction ?? 1) * 100)
    }

    private func ensureAvailable() async -> Bool {
        guard let api, let session, let lectureID else { return false }
        if status?.available == true { return true }
        do {
            let next = try await api.fetchNoteTTSStatus(lectureID: lectureID, session: session)
            status = next
            guard next.available else {
                errorMessage = next.reason == "subscription_required"
                    ? "Pred poslušanjem izberi paket."
                    : "Poslušanje ni na voljo."
                return false
            }
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    private func fetchChunk(_ index: Int, surfaceErrors: Bool = true) async -> NoteTTSChunk? {
        if let cached = chunks[index] { return cached }
        if let pending = pendingChunks[index] { return await pending.value }
        guard let api, let session, let lectureID else { return nil }
        let task = Task<NoteTTSChunk?, Never> {
            do {
                return try await api.fetchNoteTTSChunk(
                    lectureID: lectureID,
                    sessionID: readSessionID,
                    chunkIndex: index,
                    voice: voice,
                    session: session
                )
            } catch {
                if surfaceErrors {
                    errorMessage = error.localizedDescription
                }
                return nil
            }
        }
        pendingChunks[index] = task
        let chunk = await task.value
        pendingChunks[index] = nil
        if let chunk {
            chunks[index] = chunk
            if let current = status {
                status = NoteTTSStatus(
                    available: current.available,
                    reason: current.reason,
                    tier: current.tier,
                    limitSeconds: chunk.limitSeconds,
                    secondsUsed: chunk.secondsUsed,
                    remainingSeconds: chunk.remainingSeconds,
                    hasUnlimitedUsage: chunk.hasUnlimitedUsage,
                    chunkCount: chunk.chunkCount,
                    totalWords: current.totalWords
                )
            }
        }
        return chunk
    }

    private func playChunk(_ index: Int, showProgress: Bool) async {
        let expectedChunkCount = status?.chunkCount ?? 0
        let shouldWarmNextChunk = showProgress && index + 1 < expectedChunkCount
        if showProgress {
            beginGenerationProgress(workloadChunks: shouldWarmNextChunk ? 2 : 1)
        }
        guard let chunk = await fetchChunk(index), let url = chunk.audioURL else {
            cancelGenerationProgress()
            if errorMessage == nil {
                errorMessage = "Zvoka ni bilo mogoče pripraviti."
            }
            return
        }
        // Mobile web warms the next chunk before starting playback, so the
        // first transition is seamless and the progress estimate reflects
        // both generation requests. Keep native playback behavior identical.
        if showProgress, index + 1 < chunk.chunkCount {
            _ = await fetchChunk(index + 1, surfaceErrors: false)
        }
        finishGenerationProgress()
        activeChunkIndex = index
        activeChunk = chunk
        completedWordIndex = chunk.wordStartIndex - 1
        currentWordIndex = chunk.alignment.first?.wordIndex ?? chunk.wordStartIndex
        configurePlayer(url: url)
        player?.playImmediately(atRate: Float(speed))
        isSpeaking = true
        isPaused = false
        errorMessage = nil

        if index + 1 < chunk.chunkCount {
            Task { _ = await fetchChunk(index + 1, surfaceErrors: false) }
        }
    }

    private func configurePlayer(url: URL) {
        removePlayerObservers()
        player?.pause()
        let nextPlayer = AVPlayer(url: url)
        player = nextPlayer
        timeObserver = nextPlayer.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.08, preferredTimescale: 600),
            queue: .main
        ) { [weak self] time in
            Task { @MainActor [weak self] in self?.updateWord(at: time.seconds) }
        }
        if let item = nextPlayer.currentItem {
            endObserver = NotificationCenter.default.addObserver(
                forName: .AVPlayerItemDidPlayToEndTime,
                object: item,
                queue: .main
            ) { [weak self] _ in
                Task { @MainActor [weak self] in await self?.advanceAfterChunk() }
            }
        }
    }

    private func updateWord(at seconds: Double) {
        guard let chunk = activeChunk, seconds.isFinite else { return }
        let currentMS = max(0, Int(seconds * 1_000))
        var completed = chunk.wordStartIndex - 1
        var current = chunk.alignment.first?.wordIndex
        for timing in chunk.alignment {
            if timing.startMs <= currentMS {
                current = timing.wordIndex
                if timing.endMs <= currentMS { completed = timing.wordIndex }
            } else {
                break
            }
        }
        completedWordIndex = completed
        currentWordIndex = current
    }

    private func advanceAfterChunk() async {
        guard let chunk = activeChunk else { return }
        completedWordIndex = chunk.wordEndIndex
        currentWordIndex = nil
        if activeChunkIndex + 1 < chunk.chunkCount {
            await playChunk(activeChunkIndex + 1, showProgress: chunks[activeChunkIndex + 1] == nil)
        } else {
            isSpeaking = false
            isPaused = false
            activeChunkIndex = 0
            activeChunk = nil
        }
    }

    private func beginGenerationProgress(workloadChunks: Int = 1) {
        progressTask?.cancel()
        isPreparing = true
        generationPercent = 5
        let started = Date()
        let workload = Double(max(1, workloadChunks))
        progressTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(450))
                guard let self, !Task.isCancelled else { return }
                let elapsed = Date().timeIntervalSince(started) / workload
                let percent: Double
                if elapsed < 5 { percent = 5 + elapsed / 5 * 14 }
                else if elapsed < 18 { percent = 19 + (elapsed - 5) / 13 * 31 }
                else if elapsed < 42 { percent = 50 + (elapsed - 18) / 24 * 28 }
                else { percent = min(89, 78 + (1 - exp(-(elapsed - 42) / 28)) * 11) }
                generationPercent = max(generationPercent ?? 5, Int(percent.rounded()))
            }
        }
    }

    private func finishGenerationProgress() {
        progressTask?.cancel()
        progressTask = nil
        generationPercent = 100
        isPreparing = false
        Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(650))
            guard self?.isPreparing == false else { return }
            self?.generationPercent = nil
        }
    }

    private func cancelGenerationProgress() {
        progressTask?.cancel()
        progressTask = nil
        generationPercent = nil
        isPreparing = false
    }

    private func resetPlayback(clearCache: Bool) {
        removePlayerObservers()
        player?.pause()
        player = nil
        if clearCache { chunks.removeAll() }
        activeChunk = nil
        activeChunkIndex = 0
        readSessionID = UUID().uuidString
        isSpeaking = false
        isPaused = false
        completedWordIndex = -1
        currentWordIndex = nil
    }

    private func removePlayerObservers() {
        if let timeObserver, let player { player.removeTimeObserver(timeObserver) }
        timeObserver = nil
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        endObserver = nil
    }
}

// MARK: - Notes panel

/// Renders the note as stable web-compatible markdown blocks and inserts each
/// uploaded photo immediately after its saved block. This is deliberately a
/// block stack instead of a trailing gallery: placement, resizing, horizontal
/// dragging, reordering, preview, and deletion now operate on the same editable
/// note document used by the web app.
private struct SelectableAnnotatedNoteDocument: View {
    @Environment(\.colorScheme) private var colorScheme
    let markdown: String
    let annotations: [NoteAnnotation]
    let mediaBlocks: [NoteMediaBlock]
    let media: [NoteMediaAsset]
    let completedWordIndex: Int
    let currentWordIndex: Int?
    let readAlongColorID: String?
    @Binding var selection: NoteWordSelection?
    let onMove: (String, Int) -> Void
    let onLayout: (String, Double, Double) -> Void
    let onDelete: (String) -> Void

    private var blocks: [MarkdownBlock] { MarkdownBlock.parse(markdown) }
    private var textRanges: [Range<Int>] {
        guard !blocks.isEmpty else { return [] }
        var boundaries: Set<Int> = [0, blocks.count]
        for item in mediaBlocks {
            guard item.afterBlockId.hasPrefix("note-tts-block-"),
                  let index = Int(item.afterBlockId.dropFirst("note-tts-block-".count)),
                  blocks.indices.contains(index) else { continue }
            boundaries.insert(index + 1)
        }
        // Quotes need their own native surface so they retain the web blue
        // callout while remaining a selectable, globally indexed text range.
        for (index, block) in blocks.enumerated() {
            if case .quote = block {
                boundaries.insert(index)
                boundaries.insert(index + 1)
            }
        }
        let points = boundaries.sorted()
        return zip(points, points.dropFirst()).compactMap { lower, upper in
            lower < upper ? lower..<upper : nil
        }
    }
    private var mediaByID: [String: NoteMediaAsset] {
        Dictionary(uniqueKeysWithValues: media.map { ($0.id, $0) })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(textRanges, id: \.lowerBound) { range in
                selectableText(range)

                ForEach(mediaBlocks.filter {
                    $0.afterBlockId == "note-tts-block-\(range.upperBound - 1)"
                }) { mediaBlock in
                    if let asset = mediaByID[mediaBlock.mediaId] {
                        InlineEditableNotePhoto(
                            block: mediaBlock,
                            asset: asset,
                            onMove: onMove,
                            onLayout: onLayout,
                            onDelete: onDelete
                        )
                        .id("\(mediaBlock.id)-\(mediaBlock.widthPercent ?? 100)-\(mediaBlock.xPercent ?? 50)")
                        .padding(.bottom, 13)
                    }
                }
            }

            // Older records used `note-end`; keep them visible inline at the
            // end until the user moves them, rather than falling back to a
            // disconnected gallery.
            ForEach(mediaBlocks.filter {
                $0.afterBlockId == "note-end" || !$0.afterBlockId.hasPrefix("note-tts-block-")
            }) { mediaBlock in
                if let asset = mediaByID[mediaBlock.mediaId] {
                    InlineEditableNotePhoto(
                        block: mediaBlock,
                        asset: asset,
                        onMove: onMove,
                        onLayout: onLayout,
                        onDelete: onDelete
                    )
                    .id("\(mediaBlock.id)-\(mediaBlock.widthPercent ?? 100)-\(mediaBlock.xPercent ?? 50)")
                    .padding(.bottom, 13)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func selectableText(_ range: Range<Int>) -> some View {
        let text = SelectableAnnotatedMarkdownText(
            markdown: markdown,
            annotations: annotations,
            completedWordIndex: completedWordIndex,
            currentWordIndex: currentWordIndex,
            readAlongColorID: readAlongColorID,
            blockRange: range,
            selection: $selection
        )
        if range.count == 1, case .quote = blocks[range.lowerBound] {
            let callout = NoteCalloutAppearance(
                text: blocks[range.lowerBound].plainText,
                colorScheme: colorScheme
            )
            HStack(spacing: 12) {
                RoundedRectangle(cornerRadius: 2)
                    .fill(callout.accent)
                    .frame(width: 4)
                text
                Spacer(minLength: 0)
            }
            .padding(.vertical, 13)
            .padding(.horizontal, 14)
            .background(callout.background)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(callout.border, lineWidth: 1)
            )
            .padding(.bottom, 13)
        } else {
            text
        }
    }
}

private struct InlineEditableNotePhoto: View {
    @Environment(\.memoTheme) private var theme
    let block: NoteMediaBlock
    let asset: NoteMediaAsset
    let onMove: (String, Int) -> Void
    let onLayout: (String, Double, Double) -> Void
    let onDelete: (String) -> Void

    @State private var selected = false
    @State private var preview = false
    @State private var widthPercent: Double
    @State private var xPercent: Double
    @State private var dragStartX: Double?
    @State private var resizeStartWidth: Double?

    init(
        block: NoteMediaBlock,
        asset: NoteMediaAsset,
        onMove: @escaping (String, Int) -> Void,
        onLayout: @escaping (String, Double, Double) -> Void,
        onDelete: @escaping (String) -> Void
    ) {
        self.block = block
        self.asset = asset
        self.onMove = onMove
        self.onLayout = onLayout
        self.onDelete = onDelete
        _widthPercent = State(initialValue: min(100, max(35, block.widthPercent ?? 100)))
        _xPercent = State(initialValue: min(100, max(0, block.xPercent ?? 50)))
    }

    var body: some View {
        GeometryReader { proxy in
            let photoWidth = proxy.size.width * widthPercent / 100
            let available = max(0, proxy.size.width - photoWidth)
            let left = available * xPercent / 100

            ZStack(alignment: .topLeading) {
                Color.clear
                photo
                    .frame(width: photoWidth, height: 220)
                    .offset(x: left)
                    .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .onTapGesture {
                        if selected { preview = true }
                        selected = true
                    }
                    .highPriorityGesture(
                        DragGesture(minimumDistance: 5)
                            .onChanged { value in
                                guard widthPercent < 100 else { return }
                                if dragStartX == nil { dragStartX = xPercent }
                                let start = dragStartX ?? xPercent
                                xPercent = min(100, max(0, start + Double(value.translation.width / max(available, 1)) * 100))
                                selected = true
                            }
                            .onEnded { _ in
                                dragStartX = nil
                                onLayout(block.id, widthPercent, xPercent)
                            }
                    )

                if selected {
                    HStack(spacing: 6) {
                        photoAction("arrow.up", label: "Premakni gor") { onMove(block.id, -1) }
                        photoAction("arrow.down", label: "Premakni dol") { onMove(block.id, 1) }
                        photoAction("trash", label: "Izbriši fotografijo", destructive: true) {
                            onDelete(asset.id)
                        }
                    }
                    .padding(7)
                    .background(.black.opacity(0.72), in: Capsule())
                    .offset(x: min(left + 8, max(0, proxy.size.width - 144)), y: 8)

                    Image(systemName: "arrow.up.left.and.arrow.down.right")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 38, height: 38)
                        .background(theme.tint, in: Circle())
                        .offset(x: min(proxy.size.width - 38, left + photoWidth - 26), y: 194)
                        .gesture(
                            DragGesture(minimumDistance: 2)
                                .onChanged { value in
                                    if resizeStartWidth == nil { resizeStartWidth = widthPercent }
                                    let start = resizeStartWidth ?? widthPercent
                                    widthPercent = min(100, max(35, start + Double(value.translation.width / proxy.size.width) * 100))
                                }
                                .onEnded { _ in
                                    resizeStartWidth = nil
                                    if widthPercent >= 99 { xPercent = 50 }
                                    onLayout(block.id, widthPercent, xPercent)
                                }
                        )
                }
            }
        }
        .frame(height: 232)
        .fullScreenCover(isPresented: $preview) {
            ZStack(alignment: .topTrailing) {
                Color.black.ignoresSafeArea()
                AsyncImage(url: asset.signedURL) { phase in
                    if case .success(let image) = phase {
                        image.resizable().scaledToFit()
                    } else {
                        ProgressView().tint(.white)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                MemoCloseButton(size: 44, foreground: .white) {
                    preview = false
                }
                .padding(18)
            }
        }
    }

    private var photo: some View {
        AsyncImage(url: asset.signedURL) { phase in
            switch phase {
            case .success(let image):
                image.resizable().scaledToFit()
            case .failure:
                ContentUnavailableView("Fotografije ni mogoče prikazati", systemImage: "photo")
            default:
                ProgressView()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(theme.surfaceMuted)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(selected ? theme.tint : theme.separator, lineWidth: selected ? 2 : 1)
        )
    }

    private func photoAction(
        _ systemName: String,
        label: String,
        destructive: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(destructive ? Color.red : Color.white)
                .frame(width: 30, height: 30)
        }
        .accessibilityLabel(label)
    }
}

struct NotesPanel: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.memoTheme) private var theme
    let lecture: LectureRow
    let detail: LectureDetail?
    @ObservedObject var speech: NoteSpeechController
    @Binding var selection: NoteWordSelection?

    @State private var selectedPhoto: PhotosPickerItem?
    @State private var isUploadingPhoto = false
    @State private var showTools = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if let artifact = detail?.artifact, lecture.status == .ready {
                VStack(alignment: .leading, spacing: 14) {
                        HStack {
                            Spacer()
                            Button {
                                showTools = true
                            } label: {
                                Image(systemName: "chevron.down")
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundStyle(theme.secondaryLabel)
                                    .frame(width: 38, height: 38)
                                    .background(theme.surfaceSolid, in: Circle())
                                    .overlay(Circle().stroke(theme.separator, lineWidth: 1))
                                    .shadow(color: .black.opacity(0.05), radius: 8, y: 3)
                            }
                            .accessibilityLabel("Nastavitve zapiska")
                        }
                        if let percent = speech.generationPercent {
                            NoteTTSGenerationProgress(percent: percent)
                                .padding(.top, -4)
                                .padding(.bottom, 2)
                                .transition(.opacity)
                        }
                        if let message = speech.errorMessage {
                            Text(message)
                                .font(.system(size: 12.5))
                                .foregroundStyle(theme.red)
                                .accessibilityLabel(message)
                        }
                        SelectableAnnotatedNoteDocument(
                            markdown: MemoMarkdown.strippingRedundantLeadingHeading(
                                artifact.bestNotesMarkdown,
                                title: lecture.title
                            ),
                            annotations: artifact.editableNotesDoc?.annotations ?? [],
                            mediaBlocks: artifact.editableNotesDoc?.mediaBlocks ?? [],
                            media: detail?.noteMedia ?? [],
                            completedWordIndex: speech.completedWordIndex,
                            currentWordIndex: speech.currentWordIndex,
                            readAlongColorID: speech.isSpeaking || speech.isPaused
                                ? speech.highlightColorID
                                : nil,
                            selection: $selection,
                            onMove: movePhoto,
                            onLayout: layoutPhoto,
                            onDelete: { mediaID in
                                Task { _ = await appModel.deleteNotePhoto(lectureID: lecture.id, mediaID: mediaID) }
                            }
                        )
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .memoCard(cornerRadius: 18, padding: 18)
            } else if lecture.status.isProcessing {
                processingCard
            } else if lecture.status == .failed {
                Text("Zapiski še niso pripravljeni.")
                    .font(.system(size: 15))
                    .foregroundStyle(theme.secondaryLabel)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 30)
            } else if appModel.isLoading && detail == nil {
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 40)
            } else {
                Text("Zapiski še niso pripravljeni.")
                    .font(.system(size: 15))
                    .foregroundStyle(theme.secondaryLabel)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 30)
            }
        }
        .onChange(of: selectedPhoto) { _, item in
            guard let item else { return }
            upload(item)
        }
        .sheet(isPresented: $showTools) {
            noteToolsSheet
                // SwiftUI adds roughly 19 pt of sheet chrome to a fixed detent on
                // this device. 381 pt produces the web sheet's measured 400 pt
                // visible height without introducing a second/expandable stop.
                .presentationDetents([.height(381)])
                .presentationDragIndicator(.visible)
                .presentationContentInteraction(.scrolls)
        }
        #if DEBUG
        .task {
            if ProcessInfo.processInfo.environment["MEMO_DEBUG_NOTE_SETTINGS"] == "1" {
                try? await Task.sleep(for: .milliseconds(250))
                showTools = true
            }
        }
        #endif
    }

    private var noteToolsSheet: some View {
        VStack(alignment: .leading, spacing: 0) {
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(theme.surfaceMuted)
                    Capsule()
                        .fill(
                            LinearGradient(
                                colors: [Color(hex: 0xF97316), Color(hex: 0xFDBA74)],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                        .frame(width: proxy.size.width * (speech.status?.remainingFraction ?? 1))
                    Text("\(speech.remainingPercent)%")
                        .font(.system(size: 11.84, weight: .heavy))
                        .foregroundStyle(Color(hex: 0x7C2D12))
                        .frame(maxWidth: .infinity)
                }
            }
            .frame(height: 19.2)

            Text("Ponastavi se ob 00:00")
                .font(.system(size: 11.2, weight: .semibold))
                .foregroundStyle(theme.secondaryLabel)
                .padding(.top, 7.36)

            Rectangle()
                .fill(theme.separator.opacity(0.78))
                .frame(height: 1)
                .padding(.vertical, 13.12)

            noteSettingLabel("Hitrost")
            HStack(spacing: 4.8) {
                ForEach(NoteSpeechController.speeds, id: \.self) { value in
                    Button(value == 1 ? "1x" : "\(value.formatted())x") {
                        speech.speed = value
                    }
                    .font(.system(size: 11.52, weight: .heavy))
                    .foregroundStyle(speech.speed == value ? Color(hex: 0x7C2D12) : theme.secondaryLabel)
                    .frame(maxWidth: .infinity, minHeight: 29.76, maxHeight: 29.76)
                    .background(speech.speed == value ? Color(hex: 0xFFF7ED) : theme.surfaceMuted)
                    .clipShape(Capsule())
                    .overlay(
                        Capsule().stroke(
                            speech.speed == value ? Color(hex: 0xFB923C).opacity(0.52) : theme.separator.opacity(0.75),
                            lineWidth: 1
                        )
                    )
                }
            }
            .padding(.top, 6.72)

            noteSettingLabel("Glas")
                .padding(.top, 11.84)
            Menu {
                ForEach(NoteSpeechController.voices, id: \.self) { voice in
                    Button {
                        speech.voice = voice
                    } label: {
                        if speech.voice == voice {
                            Label(voice, systemImage: "checkmark")
                        } else {
                            Text(voice)
                        }
                    }
                }
            } label: {
                HStack {
                    Text(speech.voice)
                        .font(.system(size: 13.12, weight: .bold))
                    Spacer()
                    Image(systemName: "chevron.down")
                        .font(.system(size: 10, weight: .bold))
                }
                .foregroundStyle(theme.label)
                .padding(.horizontal, 10.56)
                .frame(maxWidth: .infinity, minHeight: 35.52, maxHeight: 35.52)
                .background(theme.surfaceMuted)
                .clipShape(Capsule())
                .overlay(Capsule().stroke(theme.separator.opacity(0.8), lineWidth: 1))
            }
            .padding(.top, 6.72)

            noteSettingLabel("Barva")
                .padding(.top, 11.84)
            HStack(spacing: 7.36) {
                ForEach(NoteSpeechController.highlightColors, id: \.self) { colorID in
                    Button {
                        speech.highlightColorID = colorID
                    } label: {
                        Circle()
                            .fill(NoteReadHighlightPalette.current(colorID))
                            .frame(width: 27.84, height: 27.84)
                            .overlay(
                                Circle().stroke(
                                    speech.highlightColorID == colorID ? theme.label : theme.separator.opacity(0.76),
                                    lineWidth: 2
                                )
                            )
                            .overlay(Circle().stroke(.white.opacity(0.68), lineWidth: 2).padding(3))
                    }
                    .accessibilityLabel(colorID)
                }
            }
            .padding(.top, 6.72)

            if let message = speech.errorMessage {
                Text(message)
                    .font(.system(size: 11.5))
                    .foregroundStyle(theme.red)
                    .padding(.top, 10)
            }
        }
        .padding(.horizontal, 17)
        .padding(.top, 33)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(theme.surfaceSolid.ignoresSafeArea())
    }

    private func noteSettingLabel(_ title: String) -> some View {
        Text(title)
            .font(.system(size: 11.52, weight: .bold))
            .foregroundStyle(theme.secondaryLabel)
    }

    private func movePhoto(blockID: String, direction: Int) {
        guard let doc = detail?.artifact?.editableNotesDoc else { return }
        let markdown = detail?.artifact.map {
            MemoMarkdown.strippingRedundantLeadingHeading($0.bestNotesMarkdown, title: lecture.title)
        } ?? ""
        let blockIDs = MarkdownBlock.parse(markdown).indices.map { "note-tts-block-\($0)" }
        guard let mediaBlock = doc.mediaBlocks.first(where: { $0.id == blockID }),
              !blockIDs.isEmpty else { return }
        let current = max(0, blockIDs.firstIndex(of: mediaBlock.afterBlockId) ?? blockIDs.count - 1)
        let next = min(blockIDs.count - 1, max(0, current + direction))
        guard blockIDs[next] != mediaBlock.afterBlockId else { return }
        Task {
            _ = await appModel.updateNotePhotoBlock(
                lectureID: lecture.id,
                blockID: blockID,
                afterBlockID: blockIDs[next]
            )
        }
    }

    private func layoutPhoto(blockID: String, widthPercent: Double, xPercent: Double) {
        Task {
            _ = await appModel.updateNotePhotoBlock(
                lectureID: lecture.id,
                blockID: blockID,
                widthPercent: widthPercent,
                xPercent: xPercent
            )
        }
    }

    private func upload(_ item: PhotosPickerItem) {
        isUploadingPhoto = true
        Task {
            defer {
                isUploadingPhoto = false
                selectedPhoto = nil
            }
            guard let data = try? await item.loadTransferable(type: Data.self), !data.isEmpty else {
                appModel.errorMessage = "Fotografije ni bilo mogoče prebrati."
                return
            }
            let contentType = item.supportedContentTypes.first ?? .jpeg
            let mimeType = contentType.preferredMIMEType ?? "image/jpeg"
            let fileExtension = contentType.preferredFilenameExtension ?? "jpg"
            _ = await appModel.addNotePhoto(
                lectureID: lecture.id,
                data: data,
                fileName: "photo-\(UUID().uuidString).\(fileExtension)",
                mimeType: mimeType
            )
        }
    }

    private var processingCard: some View {
        StudyGenerationNotice(
            stage: processingStageLabel,
            body: "Obdelava teče v ozadju. Lahko zapreš ta pogled in se vrneš čez nekaj minut."
        )
    }

    private var processingStageLabel: String {
        switch lecture.status {
        case .uploading: "Nalagam gradivo"
        case .queued: "Pripravljam obdelavo"
        case .transcribing: "Prepisujem predavanje"
        case .generatingNotes: "Ustvarjam zapiske"
        default: "Pripravljam zapiske"
        }
    }
}

/// Mirrors the mobile-web `note-read-generation-progress`: copy above a
/// 19-point orange gradient track with the percentage in a trailing badge.
private struct NoteTTSGenerationProgress: View {
    @Environment(\.memoTheme) private var theme
    let percent: Int

    private var clampedPercent: Int { min(max(percent, 0), 100) }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Ustvarjam zvok")
                .font(.system(size: 12.5, weight: .bold))
                .foregroundStyle(theme.label)

            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(theme.separator.opacity(0.48))

                    Capsule()
                        .fill(
                            LinearGradient(
                                colors: [Color(hex: 0xF97316), Color(hex: 0xFDBA74)],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                        .frame(width: proxy.size.width * CGFloat(clampedPercent) / 100)
                        .animation(.easeOut(duration: 0.42), value: clampedPercent)

                    HStack {
                        Spacer()
                        Text("\(clampedPercent)%")
                            .font(.system(size: 11, weight: .heavy))
                            .foregroundStyle(theme.label)
                            .frame(minWidth: 39, minHeight: 14)
                            .background(theme.canvas.opacity(0.88), in: Capsule())
                            .overlay(Capsule().stroke(theme.separator.opacity(0.68), lineWidth: 1))
                            .shadow(color: .black.opacity(0.18), radius: 2, y: 1)
                            .padding(.trailing, 5)
                    }
                }
                .clipShape(Capsule())
            }
            .frame(height: 19)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Ustvarjam zvok \(clampedPercent) odstotkov")
    }
}

/// Animated processing notice matching web StudyGenerationNotice.
struct StudyGenerationNotice: View {
    @Environment(\.memoTheme) private var theme
    let stage: String
    let body_: String
    @State private var animating = false

    init(stage: String, body: String) {
        self.stage = stage
        self.body_ = body
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(theme.tintSoft)
                    Capsule()
                        .fill(theme.tint)
                        .frame(width: proxy.size.width * 0.35)
                        .offset(x: animating ? proxy.size.width * 0.7 : -proxy.size.width * 0.35)
                }
            }
            .frame(height: 6)
            .clipShape(Capsule())
            .onAppear {
                withAnimation(.easeInOut(duration: 1.4).repeatForever(autoreverses: false)) {
                    animating = true
                }
            }

            Text(stage)
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(theme.label)
            Text(body_)
                .font(.system(size: 14))
                .foregroundStyle(theme.secondaryLabel)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .memoCard(cornerRadius: 20, padding: 18)
    }
}

// MARK: - Transcript panel

struct TranscriptPanel: View {
    @Environment(\.memoTheme) private var theme
    let detail: LectureDetail?

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            if let segments = detail?.transcript, !segments.isEmpty {
                VStack(alignment: .leading, spacing: 18) {
                    ForEach(segments) { segment in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(timeLabel(segment))
                                .font(.system(size: 12.5, weight: .semibold))
                                .foregroundStyle(theme.secondaryLabel)
                            Text(segment.text)
                                .font(.system(size: 15.5))
                                .foregroundStyle(theme.label)
                                .lineSpacing(7)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .memoCard(cornerRadius: 20, padding: 18)
            } else {
                VStack(spacing: 6) {
                    Text("Prepis se še pripravlja.")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(theme.label)
                    Text("Ko bo pripravljen, se bo prikazal tukaj.")
                        .font(.system(size: 14))
                        .foregroundStyle(theme.secondaryLabel)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 36)
            }
        }
    }

    private func timeLabel(_ segment: TranscriptSegmentRow) -> String {
        var label = MemoFormat.timestampMs(segment.startMs)
        if segment.endMs > segment.startMs {
            label += " - " + MemoFormat.timestampMs(segment.endMs)
        }
        if let speaker = segment.speakerLabel, !speaker.isEmpty {
            label += " · " + speaker
        }
        return label
    }
}

// MARK: - Recording playback panel

/// Native counterpart of the web workspace's "Zvok" tab: plays back the
/// original uploaded recording from its signed Supabase Storage URL.
struct RecordingPlaybackPanel: View {
    @Environment(\.memoTheme) private var theme
    let url: URL?

    @State private var player: AVPlayer?
    @State private var isPlaying = false
    @State private var progress: Double = 0
    @State private var duration: Double = 0
    @State private var timeObserver: Any?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Zvok")
                .font(.system(size: 12.5, weight: .semibold))
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(theme.secondaryLabel)

            if url != nil {
                HStack(spacing: 14) {
                    Button {
                        toggle()
                    } label: {
                        Image(systemName: isPlaying ? "pause.fill" : "play.fill")
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundStyle(.white)
                            .frame(width: 46, height: 46)
                            .background(theme.tint, in: Circle())
                    }
                    .accessibilityLabel(isPlaying ? "Ustavi predvajanje" : "Predvajaj posnetek")

                    VStack(alignment: .leading, spacing: 6) {
                        Slider(
                            value: Binding(
                                get: { progress },
                                set: { seek(to: $0) }
                            ),
                            in: 0...max(duration, 0.1)
                        )
                        .tint(theme.tint)

                        HStack {
                            Text(MemoFormat.timestamp(progress))
                            Spacer()
                            Text(MemoFormat.timestamp(duration))
                        }
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(theme.secondaryLabel)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .memoCard(cornerRadius: 20, padding: 18)
            } else {
                VStack(spacing: 6) {
                    Text("Zvok še ni na voljo.")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(theme.label)
                    Text("Prikazal se bo po koncu nalaganja.")
                        .font(.system(size: 14))
                        .foregroundStyle(theme.secondaryLabel)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 36)
            }
        }
        .task(id: url) {
            preparePlayer()
        }
        .onDisappear {
            stop()
        }
    }

    private func preparePlayer() {
        stop()
        guard let url else { return }
        let newPlayer = AVPlayer(url: url)
        timeObserver = newPlayer.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.25, preferredTimescale: 600),
            queue: .main
        ) { time in
            progress = time.seconds
            if let itemDuration = newPlayer.currentItem?.duration.seconds,
               itemDuration.isFinite {
                duration = itemDuration
            }
        }
        player = newPlayer
    }

    private func toggle() {
        guard let player else { return }
        if isPlaying {
            player.pause()
        } else {
            // Restart once playback has reached the end.
            if duration > 0, progress >= duration - 0.25 {
                player.seek(to: .zero)
            }
            player.play()
        }
        isPlaying.toggle()
    }

    private func seek(to seconds: Double) {
        progress = seconds
        player?.seek(to: CMTime(seconds: seconds, preferredTimescale: 600))
    }

    private func stop() {
        if let timeObserver {
            player?.removeTimeObserver(timeObserver)
        }
        timeObserver = nil
        player?.pause()
        player = nil
        isPlaying = false
        progress = 0
        duration = 0
    }
}

// MARK: - Chat panel

struct ChatPanel: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.memoTheme) private var theme
    let lecture: LectureRow
    let detail: LectureDetail?

    @State private var draft = ""
    @State private var isSending = false

    private var messages: [ChatMessageRow] {
        detail?.chatMessages ?? []
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView(showsIndicators: false) {
                    VStack(spacing: 10) {
                        if messages.isEmpty && !isSending {
                            emptyState
                        }
                        ForEach(messages) { message in
                            bubble(message)
                                .id(message.id)
                        }
                        if isSending {
                            loadingBubble
                        }
                    }
                    .padding(14)
                }
                .frame(minHeight: 260, maxHeight: 420)
                .onChange(of: messages.count) {
                    if let last = messages.last {
                        withAnimation {
                            proxy.scrollTo(last.id, anchor: .bottom)
                        }
                    }
                }
            }

            Divider().overlay(theme.separator)

            composer
        }
        .background(theme.surfaceSolid)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(theme.separator, lineWidth: 1)
        )
    }

    private var emptyState: some View {
        VStack(spacing: 5) {
            Text("Vprašaj o tem predavanju.")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(theme.label)
            Text(detail?.transcript.isEmpty == false
                ? "Kot kontekst uporabi zapiske in prepis."
                : "Kot kontekst uporabi zapiske.")
                .font(.system(size: 13.5))
                .foregroundStyle(theme.secondaryLabel)
        }
        .padding(.vertical, 26)
    }

    private func bubble(_ message: ChatMessageRow) -> some View {
        HStack {
            if message.role == "user" {
                Spacer(minLength: 40)
            }
            MarkdownText(markdown: message.content, style: .chat)
                .padding(.horizontal, 16)
                .padding(.vertical, 15)
                .background(message.role == "user" ? theme.tint.opacity(0.14) : theme.surfaceMuted.opacity(0.92))
                .foregroundStyle(theme.label)
                .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .stroke(
                            message.role == "user" ? theme.tint.opacity(0.16) : theme.separator.opacity(0.45),
                            lineWidth: 1
                        )
                )
            if message.role != "user" {
                Spacer(minLength: 40)
            }
        }
    }

    private var loadingBubble: some View {
        HStack {
            HStack(spacing: 5) {
                ForEach(0..<3, id: \.self) { index in
                    PulsingDot(delay: Double(index) * 0.18)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .background(theme.surfaceMuted)
            .clipShape(RoundedRectangle(cornerRadius: 17, style: .continuous))
            Spacer(minLength: 40)
        }
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                TextField("Vprašaj o tem predavanju", text: $draft, axis: .vertical)
                    .font(.system(size: 15.5))
                    .lineLimit(1...4)
                    .padding(.horizontal, 13)
                    .padding(.vertical, 9)
                    .background(theme.surfaceMuted)
                    .clipShape(RoundedRectangle(cornerRadius: 17, style: .continuous))
                    .disabled(isSending || !isReady)

                Button {
                    send()
                } label: {
                    Group {
                        if isSending {
                            ProgressView()
                                .tint(.white)
                        } else {
                            Image(systemName: "arrow.up")
                                .font(.system(size: 15, weight: .bold))
                                .foregroundStyle(theme.canvas)
                        }
                    }
                    .frame(width: 36, height: 36)
                    .background(theme.label)
                    .clipShape(Circle())
                }
                .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty || isSending || !isReady)
            }

            Text(footerText)
                .font(.system(size: 12))
                .foregroundStyle(theme.secondaryLabel)
        }
        .padding(12)
    }

    private var isReady: Bool {
        lecture.status == .ready
    }

    private var footerText: String {
        if !isReady {
            return "Na voljo bo po koncu obdelave."
        }
        return "Odgovori ostajajo vezani na to predavanje."
    }

    private func send() {
        let question = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !question.isEmpty else {
            return
        }
        draft = ""
        isSending = true
        // Optimistic local echo of the user message.
        if var current = appModel.selectedLectureDetail {
            current.chatMessages.append(
                ChatMessageRow(
                    id: UUID().uuidString,
                    lectureId: lecture.id,
                    userId: appModel.session?.user.id ?? "",
                    role: "user",
                    content: question,
                    createdAt: ISO8601DateFormatter().string(from: Date())
                )
            )
            appModel.selectedLectureDetail = current
        }
        Task {
            await appModel.sendChat(lectureID: lecture.id, message: question)
            isSending = false
        }
    }
}

struct PulsingDot: View {
    @Environment(\.memoTheme) private var theme
    let delay: Double
    @State private var animating = false

    var body: some View {
        Circle()
            .fill(theme.secondaryLabel)
            .frame(width: 7, height: 7)
            .opacity(animating ? 1 : 0.3)
            .onAppear {
                withAnimation(.easeInOut(duration: 0.6).repeatForever().delay(delay)) {
                    animating = true
                }
            }
    }
}
