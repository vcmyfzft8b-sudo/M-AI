import Foundation
import PhotosUI
import StoreKit
import SwiftUI
import UniformTypeIdentifiers

@MainActor
final class AppModel: ObservableObject {
    @Published private(set) var session: MemoSession?
    @Published private(set) var profile: ProfileRow?
    @Published private(set) var subscriptions: [BillingSubscriptionRow] = []
    @Published private(set) var lectures: [LectureRow] = []
    @Published private(set) var folders: [LibraryFolderRow] = []
    @Published private(set) var folderMemberships: [FolderLectureRow] = []
    @Published var themePreference: ThemePreference = {
        let stored = UserDefaults.standard.string(forKey: "memo-theme")
        return ThemePreference(rawValue: stored ?? "") ?? .system
    }() {
        didSet {
            UserDefaults.standard.set(themePreference.rawValue, forKey: "memo-theme")
        }
    }
    @Published var selectedLectureDetail: LectureDetail?
    @Published var isLoading = false
    @Published var statusMessage: String?
    @Published var errorMessage: String?
    @Published var didDismissPaywall = false
    /// Set when the API answers with HTTP 402. The web client redirects to the
    /// paywall page there; the native shell presents the StoreKit paywall.
    @Published var billingRequired = false

    let configuration: AppConfiguration
    let store: StoreKitSubscriptionService
    let recorder = AudioRecorder()

    private let auth: AuthService
    private let rest: SupabaseRESTClient
    private let api: MemoAPIClient

    init(configuration: AppConfiguration, keychain: KeychainStore) {
        self.configuration = configuration
        self.auth = AuthService(configuration: configuration, keychain: keychain)
        self.rest = SupabaseRESTClient(configuration: configuration)
        self.api = MemoAPIClient(configuration: configuration)
        self.store = StoreKitSubscriptionService(productIDs: configuration.productIDs)
        self.store.transactionUpdateHandler = { [weak self] receipt in
            await self?.syncStoreKitReceipt(receipt)
        }
    }

    var isSignedIn: Bool {
        session != nil
    }

    var onboardingComplete: Bool {
        profile?.onboardingCompletedAt != nil
    }

    var hasPaidAccess: Bool {
        !store.activeProductIDs.isEmpty || subscriptions.contains(where: \.isActive)
    }

    var canCreateNotes: Bool {
        hasPaidAccess || profile?.trialConsumedAt == nil
    }

    func bootstrap() async {
        store.start()
        await store.refresh()
        #if DEBUG
        // A legacy UI-test build persisted an injected access token in
        // UserDefaults. Replaying that short-lived token on every launch could
        // overwrite a newer Keychain session and leave the Simulator showing
        // "unauthorized" indefinitely. Launch-time injection is now explicit
        // and ephemeral, exactly like a normal process environment override.
        UserDefaults.standard.removeObject(forKey: "MEMO_DEBUG_SESSION")
        if let injected = debugSessionFromLaunchArgs() {
            try? auth.saveSession(injected)
            session = injected
            await refreshAppState()
            return
        }
        #endif
        session = auth.storedSession()
        await refreshAppState()
    }

    #if DEBUG
    /// Test-only hook: lets UI automation inject a base64-encoded session via a
    /// launch argument. Compiled out of release builds.
    private func debugSessionFromLaunchArgs() -> MemoSession? {
        let encoded = ProcessInfo.processInfo.environment["MEMO_DEBUG_SESSION"]
        guard let encoded, let data = Data(base64Encoded: encoded) else {
            NSLog("MEMO_DEBUG_SESSION not present")
            return nil
        }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .secondsSince1970
        do {
            let session = try decoder.decode(MemoSession.self, from: data)
            NSLog("MEMO_DEBUG_SESSION decoded for user \(session.user.id)")
            return session
        } catch {
            NSLog("MEMO_DEBUG_SESSION decode failed: \(error)")
            return nil
        }
    }
    #endif

    func sendEmailCode(to email: String) async {
        await run("Check your email for the login code.") {
            try await auth.sendEmailCode(to: email)
        }
    }

    func verifyEmail(email: String, token: String) async {
        await run {
            let verified = try await auth.verifyEmailCode(email: email, token: token)
            session = verified
            try await reloadUserData(session: verified)
            await syncStoreKitReceipts()
        }
    }

    func signInWithApple(identityToken: String, nonce: String?) async {
        await run {
            let signedIn = try await auth.signInWithApple(identityToken: identityToken, nonce: nonce)
            session = signedIn
            try await reloadUserData(session: signedIn)
            await syncStoreKitReceipts()
        }
    }

    func signInWithGoogle() async {
        await run {
            let signedIn = try await auth.signInWithGoogle()
            session = signedIn
            try await reloadUserData(session: signedIn)
            await syncStoreKitReceipts()
        }
    }

    func signOut() async {
        await auth.signOut(session)
        session = nil
        profile = nil
        subscriptions = []
        lectures = []
        folders = []
        selectedLectureDetail = nil
    }

    func refreshAppState() async {
        guard let existing = session else {
            return
        }
        await run {
            let refreshed = try await auth.refreshIfNeeded(existing)
            session = refreshed
            try await reloadUserData(session: refreshed)
            await syncStoreKitReceipts()
        }
    }

    /// Keeps an open native session valid without showing loading UI. Supabase
    /// access tokens are short-lived, while the web client refreshes them in
    /// the background. Running this before the five-minute expiry window keeps
    /// long-lived iOS screens and their API actions at parity with the web app.
    func maintainSession() async {
        guard let existing = session else {
            return
        }
        do {
            let refreshed = try await auth.refreshIfNeeded(existing)
            if refreshed != existing {
                session = refreshed
            }
        } catch {
            // Keep the current UI and retry on the next foreground/timer pass.
            // Individual requests still surface a useful failure if connectivity
            // is unavailable rather than unexpectedly signing the user out.
        }
    }

    func completeOnboarding(_ answers: OnboardingAnswers) async {
        guard let session else {
            return
        }
        await run("Profil je shranjen.") {
            try await api.saveOnboarding(answers, session: session)
            profile = try await rest.fetchProfile(session: session)
        }
    }

    func refreshLibrary() async {
        guard let session else {
            return
        }
        await run {
            lectures = try await rest.fetchLectures(session: session)
            folders = try await rest.fetchFolders(session: session)
            folderMemberships = try await rest.fetchFolderMemberships(session: session)
        }
    }

    /// Silent refresh used by the dashboard poller — no loading state or error banner.
    func pollLibrary() async {
        guard let session else {
            return
        }
        if let fresh = try? await rest.fetchLectures(session: session) {
            lectures = fresh
        }
    }

    func lectureIDs(inFolder folderID: String) -> Set<String> {
        Set(folderMemberships.filter { $0.folderId == folderID }.map(\.lectureId))
    }

    func renameLecture(id: String, title: String) async -> Bool {
        guard let session else {
            return false
        }
        do {
            try await rest.renameLecture(id: id, title: title, session: session)
            lectures = try await rest.fetchLectures(session: session)
            return true
        } catch {
            errorMessage = "Naslova ni bilo mogoče shraniti."
            return false
        }
    }

    func deleteLecture(id: String) async -> Bool {
        guard let existingSession = session else {
            return false
        }
        errorMessage = nil
        do {
            var activeSession = try await auth.refreshIfNeeded(existingSession)
            if activeSession != existingSession {
                session = activeSession
            }

            do {
                try await api.deleteLecture(id: id, session: activeSession)
            } catch MemoError.http(let status, _) where status == 401 {
                activeSession = try await auth.refresh(activeSession)
                session = activeSession
                do {
                    try await api.deleteLecture(id: id, session: activeSession)
                } catch MemoError.http(let retryStatus, _) where retryStatus == 404 {
                    // The first request may have completed before auth state
                    // was refreshed locally; a missing row is already deleted.
                }
            } catch MemoError.http(let status, _) where status == 404 {
                // A previous request may have deleted the database row while
                // cleanup failed. Match web behavior and remove the stale row.
            }

            lectures.removeAll { $0.id == id }
            folderMemberships.removeAll { $0.lectureId == id }
            if selectedLectureDetail?.lecture.id == id {
                selectedLectureDetail = nil
            }
            statusMessage = "Zapisek je izbrisan."
            return true
        } catch {
            errorMessage = "Zapiska ni bilo mogoče izbrisati."
            return false
        }
    }

    func createFolder(name: String, lectureIDs: [String]) async -> Bool {
        guard let session else {
            return false
        }
        do {
            _ = try await rest.createFolder(name: name, lectureIDs: lectureIDs, session: session)
            folders = try await rest.fetchFolders(session: session)
            folderMemberships = try await rest.fetchFolderMemberships(session: session)
            return true
        } catch {
            errorMessage = "Mape ni bilo mogoče ustvariti."
            return false
        }
    }

    func updateFolder(id: String, name: String, lectureIDs: [String]) async -> Bool {
        guard let session else {
            return false
        }
        do {
            try await rest.updateFolder(id: id, name: name, lectureIDs: lectureIDs, session: session)
            folders = try await rest.fetchFolders(session: session)
            folderMemberships = try await rest.fetchFolderMemberships(session: session)
            return true
        } catch {
            errorMessage = "Mape ni bilo mogoče shraniti."
            return false
        }
    }

    func deleteFolder(id: String) async -> Bool {
        guard let session else {
            return false
        }
        do {
            try await rest.deleteFolder(id: id, session: session)
            folders.removeAll { $0.id == id }
            folderMemberships.removeAll { $0.folderId == id }
            return true
        } catch {
            errorMessage = "Mape ni bilo mogoče izbrisati."
            return false
        }
    }

    func loadLecture(_ lecture: LectureRow) async {
        guard let session else {
            return
        }
        await run {
            selectedLectureDetail = try await api.fetchLectureDetail(lectureID: lecture.id, session: session)
        }
    }

    func deleteLectures(at offsets: IndexSet) async {
        guard let session else {
            return
        }
        let ids = offsets.map { lectures[$0].id }
        await run("Deleted.") {
            for id in ids {
                try await api.deleteLecture(id: id, session: session)
            }
            lectures.removeAll { ids.contains($0.id) }
        }
    }

    func retryLecture(id: String) async -> Bool {
        guard let session else { return false }
        do {
            try await api.retryLecture(id: id, session: session)
            lectures = try await rest.fetchLectures(session: session)
            statusMessage = "Ponovni poskus se je začel."
            return true
        } catch {
            report(error)
            return false
        }
    }

    func createManual(sourceType: LectureSourceType) async {
        guard let session else {
            return
        }
        await run("Created draft note.") {
            _ = try await api.createManualLecture(sourceType: sourceType, session: session)
            lectures = try await rest.fetchLectures(session: session)
        }
    }

    func createFromText(_ text: String, languageHint: String = "sl", createInitialAudio: Bool = false, initialAudioVoice: String = "Grace") async -> String? {
        guard let session else {
            return nil
        }
        return await runReturning {
            let draft = try await api.createManualLecture(sourceType: .text, languageHint: languageHint, session: session)
            var processingStarted = false
            do {
                let response = try await api.processText(lectureID: draft.lectureId, text: text, languageHint: languageHint, createInitialAudio: createInitialAudio, initialAudioVoice: initialAudioVoice, session: session)
                processingStarted = true
                lectures = try await rest.fetchLectures(session: session)
                return response.lectureId
            } catch {
                if !processingStarted {
                    try? await api.deleteLecture(id: draft.lectureId, session: session)
                }
                throw error
            }
        }
    }

    func createFromLink(_ url: String, languageHint: String = "sl", createInitialAudio: Bool = false, initialAudioVoice: String = "Grace") async -> String? {
        guard let session else {
            return nil
        }
        return await runReturning {
            let draft = try await api.createManualLecture(sourceType: .link, languageHint: languageHint, session: session)
            var processingStarted = false
            do {
                _ = try await api.processLink(lectureID: draft.lectureId, url: url, languageHint: languageHint, createInitialAudio: createInitialAudio, initialAudioVoice: initialAudioVoice, session: session)
                processingStarted = true
                lectures = try await rest.fetchLectures(session: session)
                return draft.lectureId
            } catch {
                if !processingStarted {
                    try? await api.deleteLecture(id: draft.lectureId, session: session)
                }
                throw error
            }
        }
    }

    func createFromAudio(url: URL, duration: TimeInterval, languageHint: String = "sl", createInitialAudio: Bool = false, initialAudioVoice: String = "Grace") async -> String? {
        guard let session else {
            return nil
        }
        return await runReturning {
            let size = try FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber
            if (size?.int64Value ?? 0) > 300 * 1024 * 1024 {
                throw MemoError.unsupported("Zvočna datoteka je prevelika. Omejitev je 300 MB.")
            }
            if duration > 3 * 60 * 60 {
                throw MemoError.unsupported("Zvočna datoteka je predolga. Omejitev je 3 ure.")
            }
            let didAccess = url.startAccessingSecurityScopedResource()
            defer {
                if didAccess {
                    url.stopAccessingSecurityScopedResource()
                }
            }
            let created = try await api.createAudioLecture(fileURL: url, duration: duration, languageHint: languageHint, createInitialAudio: createInitialAudio, initialAudioVoice: initialAudioVoice, session: session)
            var processingStarted = false
            do {
                guard let path = created.path, let token = created.token else {
                    throw MemoError.invalidResponse
                }
                let signedURL = try api.signedUploadURL(path: path, token: token)
                let mimeType = api.mimeTypeForFile(at: url, fallback: "audio/mp4")
                try await api.uploadFile(fileURL: url, to: signedURL, contentType: mimeType)
                try await api.finalizeUpload(lectureID: created.lectureId, path: path, session: session)
                processingStarted = true
                // Transcription and note generation run server-side. The web app
                // opens the note immediately and polls, so the native app does too.
                lectures = try await rest.fetchLectures(session: session)
                return created.lectureId
            } catch {
                if !processingStarted {
                    try? await api.deleteLecture(id: created.lectureId, session: session)
                }
                throw error
            }
        }
    }

    func createFromDocument(url: URL, languageHint: String = "sl", createInitialAudio: Bool = false, initialAudioVoice: String = "Grace") async -> String? {
        guard let session else {
            return nil
        }
        return await runReturning {
            let didAccess = url.startAccessingSecurityScopedResource()
            defer {
                if didAccess {
                    url.stopAccessingSecurityScopedResource()
                }
            }
            // The web client shrinks oversized documents before upload rather
            // than refusing them, so the native app has to do the same or it
            // rejects course material the website happily accepts.
            let uploadURL = try DocumentCompressor.compressedDocumentIfNeeded(at: url)
            defer {
                if uploadURL != url {
                    try? FileManager.default.removeItem(at: uploadURL)
                }
            }
            let draft = try await api.createManualLecture(sourceType: .pdf, languageHint: languageHint, session: session)
            var processingStarted = false
            do {
                try await api.uploadDocument(
                    lectureID: draft.lectureId,
                    fileURL: uploadURL,
                    languageHint: languageHint,
                    createInitialAudio: createInitialAudio,
                    initialAudioVoice: initialAudioVoice,
                    session: session
                )
                processingStarted = true
                lectures = try await rest.fetchLectures(session: session)
                return draft.lectureId
            } catch {
                if !processingStarted {
                    try? await api.deleteLecture(id: draft.lectureId, session: session)
                }
                throw error
            }
        }
    }

    func createFromScanData(_ files: [LocalScanUploadFile], languageHint: String = "sl", createInitialAudio: Bool = false, initialAudioVoice: String = "Grace") async -> String? {
        guard let session else {
            return nil
        }
        return await runReturning {
            if files.contains(where: { $0.data.count > 10 * 1024 * 1024 }) {
                throw MemoError.unsupported("Slika je tudi po stiskanju prevelika. Omejitev je 10 MB.")
            }
            let draft = try await api.createManualLecture(sourceType: .text, languageHint: languageHint, session: session)
            var processingStarted = false
            do {
                let targets = try await api.prepareScanUploads(
                    lectureID: draft.lectureId,
                    files: files,
                    session: session
                )
                let targetsByIndex = Dictionary(uniqueKeysWithValues: targets.uploads.map { ($0.index, $0) })
                var images: [[String: Any]] = []
                for file in files {
                    guard let target = targetsByIndex[file.index] else {
                        throw MemoError.invalidResponse
                    }
                    let signedURL = try api.signedUploadURL(path: target.path, token: target.token)
                    try await api.uploadData(file.data, to: signedURL, contentType: file.mimeType)
                    images.append([
                        "index": file.index,
                        "path": target.path,
                        "mimeType": file.mimeType,
                        "fileName": file.fileName,
                        "size": file.data.count
                    ])
                }
                try await api.processScan(
                    lectureID: draft.lectureId,
                    images: images,
                    text: nil,
                    languageHint: languageHint,
                    createInitialAudio: createInitialAudio,
                    initialAudioVoice: initialAudioVoice,
                    session: session
                )
                processingStarted = true
                lectures = try await rest.fetchLectures(session: session)
                return draft.lectureId
            } catch {
                if !processingStarted {
                    try? await api.deleteLecture(id: draft.lectureId, session: session)
                }
                throw error
            }
        }
    }

    func createFromScan(_ items: [PhotosPickerItem], languageHint: String = "sl") async -> String? {
        do {
            let files = try await loadScanFiles(items)
            return await createFromScanData(files, languageHint: languageHint)
        } catch {
            report(error)
            return nil
        }
    }

    func purchase(_ product: Product) async {
        await run("Subscription active.") {
            if let receipt = try await store.purchase(product),
               let session {
                try await api.verifyStoreKitReceipt(receipt, session: session)
            }
        }
    }

    /// Open Stripe Checkout for `plan` and refresh entitlement when the user
    /// comes back. Used when `BillingMode.current == .stripeCheckout`.
    func startStripeCheckout(plan: BillingPlan) async -> URL? {
        guard let session else {
            return nil
        }
        do {
            return try await api.createStripeCheckout(plan: plan, session: session)
        } catch {
            errorMessage = "Plačila ni bilo mogoče začeti. Poskusi znova."
            return nil
        }
    }

    /// Re-read entitlement after returning from the hosted checkout page; the
    /// Stripe webhook writes the subscription, so the app just refetches.
    func refreshEntitlementAfterCheckout() async {
        await refreshAppState()
    }

    func restorePurchases() async {
        await store.restorePurchases()
        await syncStoreKitReceipts()
        statusMessage = "Purchases restored."
    }

    func deleteAccount() async {
        guard let session else {
            return
        }
        await run("Account deleted.") {
            try await api.deleteAccount(session: session)
            await auth.signOut(session)
            self.session = nil
            profile = nil
            subscriptions = []
            lectures = []
            folders = []
            selectedLectureDetail = nil
        }
    }

    @discardableResult
    func sendChat(lectureID: String, message: String) async -> Bool {
        guard let session else { return false }
        errorMessage = nil
        do {
            let reply = try await api.sendChat(lectureID: lectureID, message: message, session: session)
            if var detail = selectedLectureDetail {
                if let answer = reply.answer {
                    detail.chatMessages.append(answer)
                }
                selectedLectureDetail = detail
            }
            return true
        } catch {
            report(error)
            // Replace optimistic messages with the server's authoritative chat
            // history, matching the web client's rollback on a failed send.
            selectedLectureDetail = try? await api.fetchLectureDetail(lectureID: lectureID, session: session)
            return false
        }
    }

    /// Generation is queued on the server. The workspace poller then refreshes
    /// the detail until the asset reports `ready`, exactly like the web app.
    func generateStudyAssets(lectureID: String) async {
        guard let session else {
            return
        }
        await run("Učno gradivo se pripravlja.") {
            try await api.generateStudyAssets(lectureID: lectureID, session: session)
            selectedLectureDetail = try await api.fetchLectureDetail(lectureID: lectureID, session: session)
        }
    }

    func generateQuizAssets(lectureID: String) async {
        guard let session else { return }
        await run("Kviz se pripravlja.") {
            try await api.generateQuizAssets(lectureID: lectureID, session: session)
            selectedLectureDetail = try await api.fetchLectureDetail(lectureID: lectureID, session: session)
        }
    }

    /// Silent detail refresh used by the workspace poller — no spinner or banner.
    func pollLectureDetail(lectureID: String) async {
        guard let session else { return }
        if let fresh = try? await api.fetchLectureDetail(lectureID: lectureID, session: session) {
            selectedLectureDetail = fresh
        }
    }

    func persistActiveStudyMode(lectureID: String, mode: StudyMode) async {
        await persistStudySession(
            lectureID: lectureID,
            activeView: mode.apiValue,
            flashcardState: selectedLectureDetail?.studySession?.flashcardState,
            quizState: selectedLectureDetail?.studySession?.quizState,
            practiceTestState: selectedLectureDetail?.studySession?.practiceTestState
        )
    }

    func persistFlashcardStudyState(lectureID: String, state: PersistedFlashcardSessionState) async {
        await persistStudySession(
            lectureID: lectureID,
            activeView: "flashcards",
            flashcardState: state,
            quizState: selectedLectureDetail?.studySession?.quizState,
            practiceTestState: selectedLectureDetail?.studySession?.practiceTestState
        )
    }

    func persistQuizStudyState(lectureID: String, state: PersistedQuizSessionState) async {
        await persistStudySession(
            lectureID: lectureID,
            activeView: "quiz",
            flashcardState: selectedLectureDetail?.studySession?.flashcardState,
            quizState: state,
            practiceTestState: selectedLectureDetail?.studySession?.practiceTestState
        )
    }

    func persistPracticeTestStudyState(lectureID: String, state: PersistedPracticeTestSessionState) async {
        await persistStudySession(
            lectureID: lectureID,
            activeView: "practice_test",
            flashcardState: selectedLectureDetail?.studySession?.flashcardState,
            quizState: selectedLectureDetail?.studySession?.quizState,
            practiceTestState: state
        )
    }

    private func persistStudySession(
        lectureID: String,
        activeView: String,
        flashcardState: PersistedFlashcardSessionState?,
        quizState: PersistedQuizSessionState?,
        practiceTestState: PersistedPracticeTestSessionState?
    ) async {
        guard let session else { return }
        let now = ISO8601DateFormatter().string(from: Date())
        let previous = selectedLectureDetail?.studySession
        let optimistic = StudySession(
            userId: session.user.id,
            lectureId: lectureID,
            activeStudyView: activeView,
            flashcardState: flashcardState,
            quizState: quizState,
            practiceTestState: practiceTestState,
            createdAt: previous?.createdAt ?? now,
            updatedAt: now
        )
        if var detail = selectedLectureDetail, detail.lecture.id == lectureID {
            detail.studySession = optimistic
            selectedLectureDetail = detail
        }
        do {
            try await api.persistStudySession(
                lectureID: lectureID,
                activeStudyView: activeView,
                flashcardState: flashcardState,
                quizState: quizState,
                practiceTestState: practiceTestState,
                session: session
            )
        } catch {
            // Preserve the local snapshot just like the web app's localStorage
            // fallback, while surfacing that server sync needs another attempt.
            report(error)
        }
    }

    func startPracticeTest(lectureID: String) async -> PracticeTestAttemptRow? {
        guard let session else { return nil }
        do {
            let started = try await api.startPracticeTest(lectureID: lectureID, session: session)
            let refreshed = try await api.fetchLectureDetail(lectureID: lectureID, session: session)
            selectedLectureDetail = refreshed
            return refreshed.practiceTestAttempts?.first { $0.id == started.id }
        } catch {
            report(error)
            return nil
        }
    }

    func submitPracticeTest(
        lectureID: String,
        attemptID: String,
        answers: [[String: Any]]
    ) async -> PracticeTestAttemptRow? {
        guard let session else { return nil }
        do {
            _ = try await api.submitPracticeTest(
                lectureID: lectureID,
                attemptID: attemptID,
                answers: answers,
                session: session
            )
            let refreshed = try await api.fetchLectureDetail(lectureID: lectureID, session: session)
            selectedLectureDetail = refreshed
            return refreshed.practiceTestAttempts?.first { $0.id == attemptID }
        } catch {
            report(error)
            return nil
        }
    }

    func toggleNoteAnnotation(
        lectureID: String,
        startWordIndex: Int,
        endWordIndex: Int,
        kind: String,
        colorID: String
    ) async -> Bool {
        guard let session,
              kind == "highlight" || kind == "underline",
              startWordIndex >= 0,
              endWordIndex >= startWordIndex else {
            return false
        }

        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            let artifact = selectedLectureDetail?.artifact
            let currentDoc = artifact?.editableNotesDoc ?? EditableNoteDoc(
                version: 1,
                baseNotesHash: "local",
                updatedAt: "1970-01-01T00:00:00.000Z",
                annotations: [],
                mediaBlocks: []
            )
            let matching = currentDoc.annotations.filter {
                $0.kind == kind &&
                    $0.startWordIndex <= endWordIndex &&
                    $0.endWordIndex >= startWordIndex
            }
            let sameColor = matching.filter { ($0.colorId ?? "orange") == colorID }
            let fullyCovered = (startWordIndex...endWordIndex).allSatisfy { wordIndex in
                sameColor.contains {
                    $0.startWordIndex <= wordIndex && $0.endWordIndex >= wordIndex
                }
            }

            var nextAnnotations: [NoteAnnotation] = []
            for annotation in currentDoc.annotations {
                let overlaps = annotation.kind == kind &&
                    annotation.startWordIndex <= endWordIndex &&
                    annotation.endWordIndex >= startWordIndex
                guard overlaps else {
                    nextAnnotations.append(annotation)
                    continue
                }

                if annotation.startWordIndex < startWordIndex {
                    nextAnnotations.append(
                        NoteAnnotation(
                            id: UUID().uuidString,
                            kind: annotation.kind,
                            startWordIndex: annotation.startWordIndex,
                            endWordIndex: startWordIndex - 1,
                            colorId: annotation.colorId,
                            createdAt: annotation.createdAt
                        )
                    )
                }
                if annotation.endWordIndex > endWordIndex {
                    nextAnnotations.append(
                        NoteAnnotation(
                            id: UUID().uuidString,
                            kind: annotation.kind,
                            startWordIndex: endWordIndex + 1,
                            endWordIndex: annotation.endWordIndex,
                            colorId: annotation.colorId,
                            createdAt: annotation.createdAt
                        )
                    )
                }
            }

            let now = ISO8601DateFormatter().string(from: Date())
            if !fullyCovered {
                nextAnnotations.append(
                    NoteAnnotation(
                        id: UUID().uuidString,
                        kind: kind,
                        startWordIndex: startWordIndex,
                        endWordIndex: endWordIndex,
                        colorId: colorID,
                        createdAt: now
                    )
                )
            }

            let nextDoc = EditableNoteDoc(
                version: 1,
                baseNotesHash: currentDoc.baseNotesHash,
                updatedAt: now,
                annotations: nextAnnotations,
                mediaBlocks: currentDoc.mediaBlocks
            )
            _ = try await api.updateNoteDoc(
                lectureID: lectureID,
                doc: nextDoc,
                expectedRevision: artifact?.editableNotesRevision ?? 0,
                session: session
            )
            selectedLectureDetail = try await api.fetchLectureDetail(lectureID: lectureID, session: session)
            return true
        } catch {
            report(error)
            return false
        }
    }

    func addNotePhoto(
        lectureID: String,
        data: Data,
        fileName: String,
        mimeType: String,
        afterBlockID: String = "note-end"
    ) async -> Bool {
        guard let session else { return false }
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            let upload = try await api.prepareNoteMediaUpload(
                lectureID: lectureID,
                fileName: fileName,
                mimeType: mimeType,
                byteSize: data.count,
                session: session
            )
            let signedURL = try api.signedUploadURL(path: upload.path, token: upload.token)
            try await api.uploadData(data, to: signedURL, contentType: upload.mimeType)
            let revision = selectedLectureDetail?.artifact?.editableNotesRevision ?? 0
            _ = try await api.finalizeNoteMediaUpload(
                lectureID: lectureID,
                mediaID: upload.mediaId,
                storagePath: upload.path,
                mimeType: upload.mimeType,
                byteSize: data.count,
                originalFileName: fileName,
                afterBlockID: afterBlockID,
                expectedRevision: revision,
                session: session
            )
            selectedLectureDetail = try await api.fetchLectureDetail(lectureID: lectureID, session: session)
            statusMessage = "Fotografija je dodana."
            return true
        } catch {
            report(error)
            return false
        }
    }

    func deleteNotePhoto(lectureID: String, mediaID: String) async -> Bool {
        guard let session else { return false }
        do {
            _ = try await api.deleteNoteMedia(lectureID: lectureID, mediaID: mediaID, session: session)
            selectedLectureDetail = try await api.fetchLectureDetail(lectureID: lectureID, session: session)
            return true
        } catch {
            report(error)
            return false
        }
    }

    /// Persists the same inline-photo layout mutations as the web note reader:
    /// moving a photo between markdown blocks, resizing it, and changing its
    /// horizontal position inside the note card.
    func updateNotePhotoBlock(
        lectureID: String,
        blockID: String,
        afterBlockID: String? = nil,
        widthPercent: Double? = nil,
        xPercent: Double? = nil
    ) async -> Bool {
        guard let session,
              let artifact = selectedLectureDetail?.artifact,
              let currentDoc = artifact.editableNotesDoc,
              currentDoc.mediaBlocks.contains(where: { $0.id == blockID }) else {
            return false
        }

        let now = ISO8601DateFormatter().string(from: Date())
        let nextBlocks = currentDoc.mediaBlocks.map { block in
            guard block.id == blockID else { return block }
            let boundedWidth = widthPercent.map { min(100, max(35, $0.rounded())) }
            let boundedX = xPercent.map { min(100, max(0, $0.rounded())) }
            return NoteMediaBlock(
                id: block.id,
                mediaId: block.mediaId,
                afterBlockId: afterBlockID ?? block.afterBlockId,
                widthPercent: boundedWidth ?? block.widthPercent,
                xPercent: boundedX ?? block.xPercent,
                createdAt: block.createdAt
            )
        }
        let nextDoc = EditableNoteDoc(
            version: currentDoc.version,
            baseNotesHash: currentDoc.baseNotesHash,
            updatedAt: now,
            annotations: currentDoc.annotations,
            mediaBlocks: nextBlocks
        )

        // Apply immediately so dragging and resizing feel identical to the web
        // app, then replace it with the authoritative revision from the API.
        if var detail = selectedLectureDetail, let storedArtifact = detail.artifact {
            detail.artifact = LectureArtifactRow(
                lectureId: storedArtifact.lectureId,
                summary: storedArtifact.summary,
                keyTopics: storedArtifact.keyTopics,
                structuredNotesMarkdown: storedArtifact.structuredNotesMarkdown,
                editableNotesMarkdown: storedArtifact.editableNotesMarkdown,
                editableNotesDoc: nextDoc,
                editableNotesRevision: storedArtifact.editableNotesRevision,
                editableNotesUpdatedAt: now,
                generatedAt: storedArtifact.generatedAt
            )
            selectedLectureDetail = detail
        }

        do {
            _ = try await api.updateNoteDoc(
                lectureID: lectureID,
                doc: nextDoc,
                expectedRevision: artifact.editableNotesRevision ?? 0,
                session: session
            )
            selectedLectureDetail = try await api.fetchLectureDetail(lectureID: lectureID, session: session)
            return true
        } catch {
            report(error)
            selectedLectureDetail = try? await api.fetchLectureDetail(lectureID: lectureID, session: session)
            return false
        }
    }

    func reviewFlashcard(id: String, confidenceBucket: String) async {
        guard let session else {
            return
        }
        await run {
            let response = try await api.reviewFlashcard(id: id, confidenceBucket: confidenceBucket, session: session)
            if var detail = selectedLectureDetail,
               let index = detail.flashcards.firstIndex(where: { $0.id == id }) {
                detail.flashcards[index].progress = response.progress
                selectedLectureDetail = detail
            }
        }
    }

    func saveFlashcard(lectureID: String, id: String?, front: String, back: String) async -> Bool {
        guard let session else { return false }
        do {
            let response: FlashcardMutationResponse
            if let id {
                response = try await api.updateFlashcard(id: id, front: front, back: back, session: session)
            } else {
                response = try await api.createFlashcard(lectureID: lectureID, front: front, back: back, session: session)
            }
            if var detail = selectedLectureDetail {
                if let index = detail.flashcards.firstIndex(where: { $0.id == response.flashcard.id }) {
                    detail.flashcards[index] = response.flashcard
                } else {
                    detail.flashcards.append(response.flashcard)
                }
                detail.flashcards.sort { $0.idx < $1.idx }
                selectedLectureDetail = detail
            }
            statusMessage = "Kartica je shranjena."
            return true
        } catch {
            report(error)
            return false
        }
    }

    func deleteFlashcard(id: String) async -> Bool {
        guard let session else { return false }
        do {
            try await api.deleteFlashcard(id: id, session: session)
            if var detail = selectedLectureDetail {
                detail.flashcards.removeAll { $0.id == id }
                selectedLectureDetail = detail
            }
            return true
        } catch {
            report(error)
            return false
        }
    }

    func saveQuizQuestion(
        lectureID: String,
        id: String?,
        prompt: String,
        options: [String],
        correctOptionIndex: Int,
        explanation: String
    ) async -> Bool {
        guard let session else { return false }
        do {
            let response: QuizQuestionMutationResponse
            if let id {
                response = try await api.updateQuizQuestion(
                    lectureID: lectureID,
                    id: id,
                    prompt: prompt,
                    options: options,
                    correctOptionIndex: correctOptionIndex,
                    explanation: explanation,
                    session: session
                )
            } else {
                response = try await api.createQuizQuestion(
                    lectureID: lectureID,
                    prompt: prompt,
                    options: options,
                    correctOptionIndex: correctOptionIndex,
                    explanation: explanation,
                    session: session
                )
            }
            if var detail = selectedLectureDetail {
                if let index = detail.quizQuestions.firstIndex(where: { $0.id == response.question.id }) {
                    detail.quizQuestions[index] = response.question
                } else {
                    detail.quizQuestions.append(response.question)
                }
                detail.quizQuestions.sort { $0.idx < $1.idx }
                selectedLectureDetail = detail
            }
            statusMessage = "Vprašanje je shranjeno."
            return true
        } catch {
            report(error)
            return false
        }
    }

    func deleteQuizQuestion(lectureID: String, id: String) async -> Bool {
        guard let session else { return false }
        do {
            try await api.deleteQuizQuestion(lectureID: lectureID, id: id, session: session)
            if var detail = selectedLectureDetail {
                detail.quizQuestions.removeAll { $0.id == id }
                selectedLectureDetail = detail
            }
            return true
        } catch {
            report(error)
            return false
        }
    }

    private func reloadUserData(session: MemoSession) async throws {
        async let profileLoad = rest.fetchProfile(session: session)
        async let subscriptionLoad = rest.fetchSubscriptions(session: session)
        async let lectureLoad = rest.fetchLectures(session: session)
        async let folderLoad = rest.fetchFolders(session: session)
        profile = try await profileLoad
        subscriptions = try await subscriptionLoad
        lectures = try await lectureLoad
        folders = try await folderLoad
    }

    private func syncStoreKitReceipts() async {
        guard let session else {
            return
        }
        do {
            for receipt in await store.currentReceipts() {
                try await api.verifyStoreKitReceipt(receipt, session: session)
            }
        } catch {
            errorMessage = "Your App Store purchase is active on this device, but Memo could not sync the receipt yet: \(error.localizedDescription)"
        }
    }

    private func syncStoreKitReceipt(_ receipt: StoreKitPurchaseReceipt) async {
        guard let session else {
            return
        }
        do {
            try await api.verifyStoreKitReceipt(receipt, session: session)
        } catch {
            errorMessage = "Your App Store transaction is active on this device, but Memo could not sync it yet: \(error.localizedDescription)"
        }
    }

    private func loadScanFiles(_ items: [PhotosPickerItem]) async throws -> [LocalScanUploadFile] {
        var files: [LocalScanUploadFile] = []
        for (index, item) in items.enumerated() {
            guard let data = try await item.loadTransferable(type: Data.self) else {
                throw MemoError.unsupported("Could not read one of the selected images.")
            }
            let type = item.supportedContentTypes.first
            let mimeType = type?.preferredMIMEType ?? "image/jpeg"
            let ext = type?.preferredFilenameExtension ?? "jpg"
            files.append(
                LocalScanUploadFile(
                    index: index,
                    fileName: "scan-\(index + 1).\(ext)",
                    mimeType: mimeType,
                    data: data
                )
            )
        }
        return files
    }

    private func documentSourceType(url: URL, mimeType: String) -> String {
        let ext = url.pathExtension.lowercased()
        if ext == "pptx" || mimeType.contains("presentation") {
            return "presentation"
        }
        if ["txt", "md", "html", "htm", "rtf"].contains(ext) || mimeType.hasPrefix("text/") {
            return "text"
        }
        return "pdf"
    }

    /// Central error surface. A billing response (HTTP 402) is what the web
    /// client turns into a paywall redirect, so it raises the native paywall.
    private func report(_ error: Error) {
        if case MemoError.billingRequired = error {
            billingRequired = true
        }
        errorMessage = error.localizedDescription
    }

    private func runReturning<T>(operation: () async throws -> T) async -> T? {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            return try await operation()
        } catch is CancellationError {
            return nil
        } catch let error as URLError where error.code == .cancelled {
            return nil
        } catch {
            report(error)
            return nil
        }
    }

    private func run(_ successMessage: String? = nil, operation: () async throws -> Void) async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            try await operation()
            if let successMessage {
                statusMessage = successMessage
            }
        } catch is CancellationError {
            return
        } catch let error as URLError where error.code == .cancelled {
            return
        } catch {
            report(error)
        }
    }
}
