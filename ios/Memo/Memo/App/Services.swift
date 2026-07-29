import AuthenticationServices
import CryptoKit
import Foundation
import Security
import StoreKit
import UIKit
import UniformTypeIdentifiers

struct AppConfiguration {
    let siteURL: URL
    let mobileAPIURL: URL
    let supabaseURL: URL?
    let supabaseAnonKey: String
    let productIDs: [String]
    let privacyPolicyURL: URL
    let termsURL: URL
    let supportURL: URL

    static var live: AppConfiguration {
        let bundle = Bundle.main
        #if DEBUG
        let debugSiteURL = UserDefaults.standard.string(forKey: "MEMO_DEBUG_SITE_URL").flatMap(URL.init(string:))
        let debugMobileAPI = UserDefaults.standard.string(forKey: "MEMO_DEBUG_MOBILE_API_URL").flatMap(URL.init(string:))
        #else
        let debugSiteURL: URL? = nil
        let debugMobileAPI: URL? = nil
        #endif
        // Use the canonical host. The apex domain answers API requests with a
        // cross-host 307 to www, and URLSession drops the Authorization header
        // across that redirect, which would silently sign every request out.
        let site = debugSiteURL
            ?? bundle.string(for: "MEMO_SITE_URL").flatMap(URL.init(string:))
            ?? URL(string: "https://www.memoai.eu")!
        // StoreKit entitlement sync and account deletion live on the mobile
        // backend, which is mounted inside the web deployment at /api/mobile.
        // Default to the configured site so a single URL configures the app.
        let mobileAPI = debugMobileAPI
            ?? bundle.string(for: "MEMO_MOBILE_API_URL").flatMap(URL.init(string:))
            ?? site.appending(path: "api/mobile")
        let supabaseURL = bundle.string(for: "MEMO_SUPABASE_URL").flatMap(URL.init(string:))
        let supabaseAnonKey = bundle.string(for: "MEMO_SUPABASE_ANON_KEY") ?? ""
        let products = bundle.string(for: "MEMO_STOREKIT_PRODUCT_IDS")?
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty } ?? [
                "eu.memoai.memo.weekly",
                "eu.memoai.memo.monthly",
                "eu.memoai.memo.yearly"
            ]

        return AppConfiguration(
            siteURL: site,
            mobileAPIURL: mobileAPI,
            supabaseURL: supabaseURL,
            supabaseAnonKey: supabaseAnonKey,
            productIDs: products,
            privacyPolicyURL: site.appending(path: "app/support/privacy-policy"),
            termsURL: site.appending(path: "app/support/terms-of-use"),
            supportURL: site.appending(path: "app/support")
        )
    }

    /// The production web API. The native client calls the exact same feature
    /// routes as the website (bearer-authenticated), so notes, study material,
    /// quizzes and read-aloud all run through the identical server pipeline.
    var webAPIURL: URL {
        siteURL.appending(path: "api")
    }

    func requireSupabaseURL() throws -> URL {
        guard let supabaseURL else {
            throw MemoError.missingConfiguration("MEMO_SUPABASE_URL")
        }
        return supabaseURL
    }

    func requireSupabaseAnonKey() throws -> String {
        guard !supabaseAnonKey.isEmpty else {
            throw MemoError.missingConfiguration("MEMO_SUPABASE_ANON_KEY")
        }
        return supabaseAnonKey
    }
}

private extension Bundle {
    func string(for key: String) -> String? {
        let value = object(forInfoDictionaryKey: key) as? String
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed?.isEmpty == false ? trimmed : nil
    }
}

enum AppleSignInNonce {
    private static let charset = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._")

    static func random(length: Int = 32) throws -> String {
        var randomBytes = [UInt8](repeating: 0, count: length)
        let status = randomBytes.withUnsafeMutableBytes { buffer in
            SecRandomCopyBytes(kSecRandomDefault, length, buffer.baseAddress!)
        }
        guard status == errSecSuccess else {
            throw MemoError.unsupported("Could not generate a secure Apple sign-in nonce.")
        }
        return String(randomBytes.map { charset[Int($0) % charset.count] })
    }

    static func sha256(_ input: String) -> String {
        let inputData = Data(input.utf8)
        let hashedData = SHA256.hash(data: inputData)
        return hashedData.map { String(format: "%02x", $0) }.joined()
    }
}

final class KeychainStore {
    private let service: String

    init(service: String) {
        self.service = service
    }

    func save<T: Encodable>(_ value: T, account: String) throws {
        let data = try JSONEncoder().encode(value)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        SecItemDelete(query as CFDictionary)
        var attributes = query
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(attributes as CFDictionary, nil)
        if status == errSecSuccess {
            removeSimulatorFallback(account: account)
            return
        }
        #if targetEnvironment(simulator)
        // Unsigned Simulator builds can reject otherwise valid Keychain writes
        // with errSecMissingEntitlement. Keep UI/testing sessions persistent in
        // the Simulator without weakening storage on a physical device.
        UserDefaults.standard.set(data, forKey: simulatorFallbackKey(account: account))
        return
        #else
        throw MemoError.http(status: Int(status), message: "Could not save secure session.")
        #endif
    }

    func read<T: Decodable>(_ type: T.Type, account: String) throws -> T? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound {
            return try simulatorFallback(type, account: account)
        }
        guard status == errSecSuccess, let data = result as? Data else {
            #if targetEnvironment(simulator)
            return try simulatorFallback(type, account: account)
            #else
            throw MemoError.http(status: Int(status), message: "Could not read secure session.")
            #endif
        }
        return try JSONDecoder().decode(type, from: data)
    }

    func delete(account: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        SecItemDelete(query as CFDictionary)
        removeSimulatorFallback(account: account)
    }

    private func simulatorFallbackKey(account: String) -> String {
        "memo.simulator-keychain.\(service).\(account)"
    }

    private func simulatorFallback<T: Decodable>(_ type: T.Type, account: String) throws -> T? {
        #if targetEnvironment(simulator)
        guard let data = UserDefaults.standard.data(forKey: simulatorFallbackKey(account: account)) else {
            return nil
        }
        return try JSONDecoder().decode(type, from: data)
        #else
        return nil
        #endif
    }

    private func removeSimulatorFallback(account: String) {
        #if targetEnvironment(simulator)
        UserDefaults.standard.removeObject(forKey: simulatorFallbackKey(account: account))
        #endif
    }
}

final class AuthService {
    private let configuration: AppConfiguration
    private let keychain: KeychainStore
    private let sessionAccount = "memo-session"
    private let urlSession: URLSession
    private let oauthPresentationProvider = WebAuthenticationPresentationProvider()
    private var webAuthenticationSession: ASWebAuthenticationSession?

    init(configuration: AppConfiguration, keychain: KeychainStore, urlSession: URLSession = .shared) {
        self.configuration = configuration
        self.keychain = keychain
        self.urlSession = urlSession
    }

    func storedSession() -> MemoSession? {
        try? keychain.read(MemoSession.self, account: sessionAccount)
    }

    func saveSession(_ session: MemoSession) throws {
        try keychain.save(session, account: sessionAccount)
    }

    func clearSession() {
        keychain.delete(account: sessionAccount)
    }

    func sendEmailCode(to email: String) async throws {
        let url = try configuration.requireSupabaseURL().appending(path: "auth/v1/otp")
        let body: [String: Any] = [
            "email": email,
            "create_user": true
        ]
        _ = try await supabaseRequest(url: url, method: "POST", body: body, session: nil) as EmptyResponse
    }

    func verifyEmailCode(email: String, token: String) async throws -> MemoSession {
        let url = try configuration.requireSupabaseURL().appending(path: "auth/v1/verify")
        let body: [String: Any] = [
            "email": email,
            "token": token,
            "type": "email"
        ]
        let response: SupabaseSessionResponse = try await supabaseRequest(
            url: url,
            method: "POST",
            body: body,
            session: nil
        )
        let session = response.asMemoSession()
        try saveSession(session)
        return session
    }

    func signInWithApple(identityToken: String, nonce: String?) async throws -> MemoSession {
        var components = URLComponents(
            url: try configuration.requireSupabaseURL().appending(path: "auth/v1/token"),
            resolvingAgainstBaseURL: false
        )!
        components.queryItems = [URLQueryItem(name: "grant_type", value: "id_token")]
        guard let url = components.url else {
            throw MemoError.invalidResponse
        }
        var body: [String: Any] = [
            "provider": "apple",
            "id_token": identityToken
        ]
        if let nonce {
            body["nonce"] = nonce
        }
        let response: SupabaseSessionResponse = try await supabaseRequest(
            url: url,
            method: "POST",
            body: body,
            session: nil
        )
        let session = response.asMemoSession()
        try saveSession(session)
        return session
    }

    @MainActor
    func signInWithGoogle() async throws -> MemoSession {
        let supabaseURL = try configuration.requireSupabaseURL()
        let redirectURL = URL(string: "eu.memoai.memo://auth/callback")!
        var components = URLComponents(url: supabaseURL.appending(path: "auth/v1/authorize"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "provider", value: "google"),
            URLQueryItem(name: "redirect_to", value: redirectURL.absoluteString)
        ]
        guard let authURL = components.url else {
            throw MemoError.invalidResponse
        }

        let callbackURL: URL = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<URL, Error>) in
            let session = ASWebAuthenticationSession(url: authURL, callbackURLScheme: "eu.memoai.memo") { callbackURL, error in
                if let error {
                    let nsError = error as NSError
                    if nsError.domain == ASWebAuthenticationSessionError.errorDomain,
                       nsError.code == ASWebAuthenticationSessionError.canceledLogin.rawValue {
                        continuation.resume(throwing: CancellationError())
                        return
                    }
                    continuation.resume(throwing: error)
                    return
                }
                guard let callbackURL else {
                    continuation.resume(throwing: MemoError.invalidResponse)
                    return
                }
                continuation.resume(returning: callbackURL)
            }
            session.presentationContextProvider = oauthPresentationProvider
            session.prefersEphemeralWebBrowserSession = false
            webAuthenticationSession = session
            guard session.start() else {
                continuation.resume(throwing: MemoError.unsupported("Could not start Google sign in."))
                return
            }
        }

        defer { webAuthenticationSession = nil }
        let session = try await sessionFromOAuthCallback(callbackURL)
        try saveSession(session)
        return session
    }

    func refreshIfNeeded(_ session: MemoSession) async throws -> MemoSession {
        guard session.needsRefresh else {
            return session
        }
        return try await refresh(session)
    }

    /// Forces a refresh after an authenticated API request reports 401. A
    /// token can be revoked or rejected before its local expiry timestamp, so
    /// relying only on `needsRefresh` can leave destructive actions unusable.
    func refresh(_ session: MemoSession) async throws -> MemoSession {
        var components = URLComponents(
            url: try configuration.requireSupabaseURL().appending(path: "auth/v1/token"),
            resolvingAgainstBaseURL: false
        )!
        components.queryItems = [URLQueryItem(name: "grant_type", value: "refresh_token")]
        guard let url = components.url else {
            throw MemoError.invalidResponse
        }
        let response: SupabaseSessionResponse = try await supabaseRequest(
            url: url,
            method: "POST",
            body: ["refresh_token": session.refreshToken],
            session: nil
        )
        let refreshed = response.asMemoSession()
        try saveSession(refreshed)
        return refreshed
    }

    func signOut(_ session: MemoSession?) async {
        defer { clearSession() }
        guard let session else {
            return
        }
        do {
            let url = try configuration.requireSupabaseURL().appending(path: "auth/v1/logout")
            _ = try await supabaseRequest(url: url, method: "POST", body: nil, session: session) as EmptyResponse
        } catch {
            return
        }
    }

    private func supabaseRequest<T: Decodable>(
        url: URL,
        method: String,
        body: [String: Any]?,
        session: MemoSession?
    ) async throws -> T {
        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let anonKey = try configuration.requireSupabaseAnonKey()
        request.setValue(anonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(session?.accessToken ?? anonKey)", forHTTPHeaderField: "Authorization")
        if let body {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await urlSession.data(for: request)
        try Self.validate(data: data, response: response)
        if data.isEmpty, T.self == EmptyResponse.self {
            return EmptyResponse() as! T
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func sessionFromOAuthCallback(_ callbackURL: URL) async throws -> MemoSession {
        let values = callbackValues(from: callbackURL)
        if let errorDescription = values["error_description"] ?? values["error"] {
            throw MemoError.unsupported(errorDescription)
        }
        guard let accessToken = values["access_token"],
              let refreshToken = values["refresh_token"] else {
            throw MemoError.invalidResponse
        }
        let tokenType = values["token_type"] ?? "bearer"
        let expiresAt: Date
        if let expiresAtValue = values["expires_at"], let timestamp = TimeInterval(expiresAtValue) {
            expiresAt = Date(timeIntervalSince1970: timestamp)
        } else {
            let expiresIn = TimeInterval(values["expires_in"] ?? "") ?? 3600
            expiresAt = Date().addingTimeInterval(expiresIn)
        }
        let provisionalSession = MemoSession(
            accessToken: accessToken,
            refreshToken: refreshToken,
            tokenType: tokenType,
            expiresAt: expiresAt,
            user: MemoUser(id: "", email: nil)
        )
        let user: SupabaseUser = try await supabaseRequest(
            url: try configuration.requireSupabaseURL().appending(path: "auth/v1/user"),
            method: "GET",
            body: nil,
            session: provisionalSession
        )
        return MemoSession(
            accessToken: accessToken,
            refreshToken: refreshToken,
            tokenType: tokenType,
            expiresAt: expiresAt,
            user: MemoUser(id: user.id, email: user.email)
        )
    }

    private func callbackValues(from callbackURL: URL) -> [String: String] {
        var values: [String: String] = [:]
        if let components = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false) {
            for item in components.queryItems ?? [] {
                values[item.name] = item.value
            }
        }
        if let fragment = callbackURL.fragment,
           let fragmentComponents = URLComponents(string: "memo://callback?\(fragment)") {
            for item in fragmentComponents.queryItems ?? [] {
                values[item.name] = item.value
            }
        }
        return values
    }

    static func validate(data: Data, response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else {
            throw MemoError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
#if DEBUG
            if let responseBody = String(data: data, encoding: .utf8) {
                print("Memo HTTP \(http.statusCode): \(responseBody)")
            }
#endif
            let decoded = try? JSONDecoder().decode(APIErrorResponse.self, from: data)
            let fallback = HTTPURLResponse.localizedString(forStatusCode: http.statusCode)
            if http.statusCode == 402 {
                throw MemoError.billingRequired(
                    message: decoded?.error ?? "Za to dejanje je potreben plačljiv paket.",
                    code: decoded?.code
                )
            }
            throw MemoError.http(status: http.statusCode, message: decoded?.error ?? fallback)
        }
    }
}

final class WebAuthenticationPresentationProvider: NSObject, ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first { $0.isKeyWindow } ?? ASPresentationAnchor()
    }
}

final class SupabaseRESTClient {
    private let configuration: AppConfiguration
    private let urlSession: URLSession

    init(configuration: AppConfiguration, urlSession: URLSession = .shared) {
        self.configuration = configuration
        self.urlSession = urlSession
    }

    func fetchProfile(session: MemoSession) async throws -> ProfileRow? {
        let rows: [ProfileRow] = try await request(
            table: "profiles",
            queryItems: [
                .init(name: "select", value: "id,email,full_name,onboarding_completed_at,age_range,education_level,current_average_grade,target_grade,study_goal,trial_lecture_id,trial_consumed_at"),
                .init(name: "id", value: "eq.\(session.user.id)"),
                .init(name: "limit", value: "1")
            ],
            session: session
        )
        return rows.first
    }

    func fetchSubscriptions(session: MemoSession) async throws -> [BillingSubscriptionRow] {
        try await request(
            table: "billing_subscriptions",
            queryItems: [
                .init(name: "select", value: "id,plan,status,current_period_end,cancel_at_period_end"),
                .init(name: "user_id", value: "eq.\(session.user.id)"),
                .init(name: "order", value: "updated_at.desc")
            ],
            session: session
        )
    }

    func fetchLectures(session: MemoSession) async throws -> [LectureRow] {
        try await request(
            table: "lectures",
            queryItems: [
                .init(name: "select", value: "id,user_id,title,source_type,access_tier,duration_seconds,status,language_hint,error_message,created_at,updated_at"),
                .init(name: "user_id", value: "eq.\(session.user.id)"),
                .init(name: "order", value: "updated_at.desc")
            ],
            session: session
        )
    }

    func fetchFolders(session: MemoSession) async throws -> [LibraryFolderRow] {
        try await request(
            table: "library_folders",
            queryItems: [
                .init(name: "select", value: "id,name,created_at"),
                .init(name: "user_id", value: "eq.\(session.user.id)"),
                .init(name: "order", value: "created_at.desc")
            ],
            session: session
        )
    }

    func fetchArtifact(lectureID: String, session: MemoSession) async throws -> LectureArtifactRow? {
        let rows: [LectureArtifactRow] = try await request(
            table: "lecture_artifacts",
            queryItems: [
                .init(name: "select", value: "lecture_id,summary,key_topics,structured_notes_md,editable_notes_md,generated_at"),
                .init(name: "lecture_id", value: "eq.\(lectureID)"),
                .init(name: "limit", value: "1")
            ],
            session: session
        )
        return rows.first
    }

    func fetchTranscript(lectureID: String, session: MemoSession) async throws -> [TranscriptSegmentRow] {
        try await request(
            table: "transcript_segments",
            queryItems: [
                .init(name: "select", value: "id,lecture_id,idx,start_ms,end_ms,speaker_label,text"),
                .init(name: "lecture_id", value: "eq.\(lectureID)"),
                .init(name: "order", value: "idx.asc")
            ],
            session: session
        )
    }

    func fetchFlashcards(lectureID: String, session: MemoSession) async throws -> [FlashcardRow] {
        try await request(
            table: "flashcards",
            queryItems: [
                .init(name: "select", value: "id,lecture_id,idx,front,back,hint,difficulty,source_locator"),
                .init(name: "lecture_id", value: "eq.\(lectureID)"),
                .init(name: "order", value: "idx.asc")
            ],
            session: session
        )
    }

    func fetchFlashcardProgress(for flashcardIDs: [String], session: MemoSession) async throws -> [FlashcardProgressRow] {
        guard !flashcardIDs.isEmpty else {
            return []
        }
        return try await request(
            table: "flashcard_progress",
            queryItems: [
                .init(name: "select", value: "user_id,flashcard_id,confidence_bucket,review_count,last_reviewed_at"),
                .init(name: "user_id", value: "eq.\(session.user.id)"),
                .init(name: "flashcard_id", value: "in.(\(flashcardIDs.joined(separator: ",")))")
            ],
            session: session
        )
    }

    private func mergeFlashcardProgress(_ flashcards: [FlashcardRow], progress: [FlashcardProgressRow]) -> [FlashcardRow] {
        let progressByID = Dictionary(uniqueKeysWithValues: progress.map { ($0.flashcardId, $0) })
        return flashcards.map { card in
            var next = card
            next.progress = progressByID[card.id]
            return next
        }
    }

    func fetchQuizQuestions(lectureID: String, session: MemoSession) async throws -> [QuizQuestionRow] {
        try await request(
            table: "quiz_questions",
            queryItems: [
                .init(name: "select", value: "id,lecture_id,idx,prompt,options_json,correct_option_idx,explanation,source_locator"),
                .init(name: "lecture_id", value: "eq.\(lectureID)"),
                .init(name: "order", value: "idx.asc")
            ],
            session: session
        )
    }

    func fetchPracticeTestQuestions(lectureID: String, session: MemoSession) async throws -> [PracticeTestQuestionRow] {
        try await request(
            table: "practice_test_questions",
            queryItems: [
                .init(name: "select", value: "id,lecture_id,idx,prompt,answer_guide,difficulty,source_locator,source_unit_idx,concept_key"),
                .init(name: "lecture_id", value: "eq.\(lectureID)"),
                .init(name: "order", value: "idx.asc")
            ],
            session: session
        )
    }

    func fetchChat(lectureID: String, session: MemoSession) async throws -> [ChatMessageRow] {
        try await request(
            table: "chat_messages",
            queryItems: [
                .init(name: "select", value: "id,lecture_id,user_id,role,content,created_at"),
                .init(name: "lecture_id", value: "eq.\(lectureID)"),
                .init(name: "order", value: "created_at.asc")
            ],
            session: session
        )
    }

    func fetchFolderMemberships(session: MemoSession) async throws -> [FolderLectureRow] {
        try await request(
            table: "library_folder_lectures",
            queryItems: [
                .init(name: "select", value: "folder_id,lecture_id"),
                .init(name: "user_id", value: "eq.\(session.user.id)")
            ],
            session: session
        )
    }

    func createFolder(name: String, lectureIDs: [String], session: MemoSession) async throws -> LibraryFolderRow {
        let body = try JSONEncoder().encode(["user_id": session.user.id, "name": name])
        let rows: [LibraryFolderRow] = try await request(
            table: "library_folders",
            method: "POST",
            queryItems: [.init(name: "select", value: "id,name,created_at")],
            body: body,
            session: session,
            prefer: "return=representation"
        )
        guard let folder = rows.first else {
            throw MemoError.invalidResponse
        }
        try await setFolderLectures(folderID: folder.id, lectureIDs: lectureIDs, session: session)
        return folder
    }

    func updateFolder(id: String, name: String, lectureIDs: [String], session: MemoSession) async throws {
        let body = try JSONEncoder().encode(["name": name])
        let _: EmptyResponse = try await request(
            table: "library_folders",
            method: "PATCH",
            queryItems: [
                .init(name: "id", value: "eq.\(id)"),
                .init(name: "user_id", value: "eq.\(session.user.id)")
            ],
            body: body,
            session: session
        )
        try await setFolderLectures(folderID: id, lectureIDs: lectureIDs, session: session)
    }

    func deleteFolder(id: String, session: MemoSession) async throws {
        let _: EmptyResponse = try await request(
            table: "library_folder_lectures",
            method: "DELETE",
            queryItems: [
                .init(name: "folder_id", value: "eq.\(id)"),
                .init(name: "user_id", value: "eq.\(session.user.id)")
            ],
            session: session
        )
        let _: EmptyResponse = try await request(
            table: "library_folders",
            method: "DELETE",
            queryItems: [
                .init(name: "id", value: "eq.\(id)"),
                .init(name: "user_id", value: "eq.\(session.user.id)")
            ],
            session: session
        )
    }

    private func setFolderLectures(folderID: String, lectureIDs: [String], session: MemoSession) async throws {
        let _: EmptyResponse = try await request(
            table: "library_folder_lectures",
            method: "DELETE",
            queryItems: [
                .init(name: "folder_id", value: "eq.\(folderID)"),
                .init(name: "user_id", value: "eq.\(session.user.id)")
            ],
            session: session
        )
        guard !lectureIDs.isEmpty else {
            return
        }
        let rows = lectureIDs.map { lectureID in
            ["folder_id": folderID, "lecture_id": lectureID, "user_id": session.user.id]
        }
        let body = try JSONSerialization.data(withJSONObject: rows)
        let _: EmptyResponse = try await request(
            table: "library_folder_lectures",
            method: "POST",
            queryItems: [],
            body: body,
            session: session
        )
    }

    func renameLecture(id: String, title: String, session: MemoSession) async throws {
        let body = try JSONEncoder().encode(["title": title])
        let _: EmptyResponse = try await request(
            table: "lectures",
            method: "PATCH",
            queryItems: [
                .init(name: "id", value: "eq.\(id)"),
                .init(name: "user_id", value: "eq.\(session.user.id)")
            ],
            body: body,
            session: session
        )
    }

    func deleteLectureIDs(_ ids: [String], session: MemoSession) async throws {
        let joined = ids.joined(separator: ",")
        let _: EmptyResponse = try await request(
            table: "lectures",
            method: "DELETE",
            queryItems: [
                .init(name: "id", value: "in.(\(joined))"),
                .init(name: "user_id", value: "eq.\(session.user.id)")
            ],
            session: session
        )
    }

    private func request<T: Decodable>(
        table: String,
        method: String = "GET",
        queryItems: [URLQueryItem],
        body: Data? = nil,
        session: MemoSession,
        prefer: String? = nil
    ) async throws -> T {
        var components = URLComponents(
            url: try configuration.requireSupabaseURL().appending(path: "rest/v1/\(table)"),
            resolvingAgainstBaseURL: false
        )!
        components.queryItems = queryItems
        guard let url = components.url else {
            throw MemoError.invalidResponse
        }
        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(try configuration.requireSupabaseAnonKey(), forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(session.accessToken)", forHTTPHeaderField: "Authorization")
        if let prefer {
            request.setValue(prefer, forHTTPHeaderField: "Prefer")
        }
        if let body {
            request.httpBody = body
        }
        let (data, response) = try await urlSession.data(for: request)
        try AuthService.validate(data: data, response: response)
        if data.isEmpty, T.self == EmptyResponse.self {
            return EmptyResponse() as! T
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
}

final class MemoAPIClient {
    private let configuration: AppConfiguration
    private let urlSession: URLSession

    private let redirectDelegate = AuthenticatedRedirectDelegate()

    init(configuration: AppConfiguration, urlSession: URLSession? = nil) {
        self.configuration = configuration
        // Chat answers, practice-test generation and document extraction run
        // synchronously on the server (the web routes allow up to 300 s), so the
        // default 60 s request timeout would cancel valid work.
        if let urlSession {
            self.urlSession = urlSession
        } else {
            let sessionConfiguration = URLSessionConfiguration.default
            sessionConfiguration.timeoutIntervalForRequest = 300
            sessionConfiguration.timeoutIntervalForResource = 900
            self.urlSession = URLSession(
                configuration: sessionConfiguration,
                delegate: redirectDelegate,
                delegateQueue: nil
            )
        }
    }

    func fetchLectureDetail(lectureID: String, session: MemoSession) async throws -> LectureDetail {
        try await jsonRequest(
            path: "lectures/\(lectureID)",
            method: "GET",
            body: nil,
            session: session
        )
    }

    func fetchNoteTTSStatus(lectureID: String, session: MemoSession) async throws -> NoteTTSStatus {
        try await jsonRequest(
            path: "lectures/\(lectureID)/tts/status",
            method: "GET",
            body: nil,
            session: session
        )
    }

    func fetchNoteTTSChunk(
        lectureID: String,
        sessionID: String,
        chunkIndex: Int,
        voice: String,
        session: MemoSession
    ) async throws -> NoteTTSChunk {
        try await jsonRequest(
            path: "lectures/\(lectureID)/tts/chunks",
            method: "POST",
            body: [
                "sessionId": sessionID,
                "chunkIndex": chunkIndex,
                "voice": voice
            ],
            session: session
        )
    }

    /// The website's draft route only accepts the three manual source types.
    /// Photo scans are drafted as `text`, matching the web upload modal.
    func createManualLecture(sourceType: LectureSourceType, languageHint: String = "sl", session: MemoSession) async throws -> CreateLectureResponse {
        let manualSourceType: String
        switch sourceType {
        case .pdf: manualSourceType = "pdf"
        case .link: manualSourceType = "link"
        default: manualSourceType = "text"
        }
        return try await jsonRequest(
            path: "lectures/manual",
            method: "POST",
            body: [
                "sourceType": manualSourceType,
                "languageHint": languageHint
            ],
            session: session
        )
    }

    func processText(lectureID: String?, text: String, languageHint: String = "sl", createInitialAudio: Bool = false, initialAudioVoice: String = "Grace", session: MemoSession) async throws -> CreateLectureResponse {
        try await jsonRequest(
            path: "lectures/text",
            method: "POST",
            body: [
                "lectureId": lectureID as Any,
                "text": text,
                "languageHint": languageHint,
                "createInitialAudio": createInitialAudio,
                "initialAudioVoice": initialAudioVoice
            ],
            session: session
        )
    }

    func processLink(lectureID: String, url: String, languageHint: String = "sl", createInitialAudio: Bool = false, initialAudioVoice: String = "Grace", session: MemoSession) async throws -> CreateLectureResponse {
        try await jsonRequest(
            path: "lectures/link",
            method: "POST",
            body: [
                "lectureId": lectureID,
                "url": url,
                "languageHint": languageHint,
                "createInitialAudio": createInitialAudio,
                "initialAudioVoice": initialAudioVoice
            ],
            session: session
        )
    }

    /// Mirrors the website's `POST /api/lectures`: it creates the lecture row and
    /// returns a signed Supabase Storage upload target for the recording.
    func createAudioLecture(fileURL: URL, duration: TimeInterval, languageHint: String = "sl", createInitialAudio: Bool = false, initialAudioVoice: String = "Grace", session: MemoSession) async throws -> CreateLectureResponse {
        let mimeType = mimeTypeForFile(at: fileURL, fallback: "audio/mp4")
        return try await jsonRequest(
            path: "lectures",
            method: "POST",
            body: [
                "fileName": fileURL.lastPathComponent,
                "mimeType": mimeType,
                "size": try fileSize(at: fileURL),
                "durationSeconds": max(duration, 1),
                "languageHint": languageHint,
                "createInitialAudio": createInitialAudio,
                "initialAudioVoice": initialAudioVoice
            ],
            session: session
        )
    }

    /// Documents are posted as multipart form data to the same route the web
    /// upload modal uses, so extraction, OCR fallbacks and note generation are
    /// handled by the production pipeline.
    func uploadDocument(
        lectureID: String,
        fileURL: URL,
        languageHint: String = "sl",
        createInitialAudio: Bool = false,
        initialAudioVoice: String = "Grace",
        session: MemoSession
    ) async throws {
        let mimeType = mimeTypeForFile(at: fileURL, fallback: "application/octet-stream")
        let fileData = try Data(contentsOf: fileURL)
        let _: CreateLectureResponse = try await multipartRequest(
            path: "lectures/pdf",
            fields: [
                "lectureId": lectureID,
                "originalFileName": fileURL.lastPathComponent,
                "languageHint": languageHint,
                "createInitialAudio": createInitialAudio ? "true" : "false",
                "initialAudioVoice": initialAudioVoice
            ],
            fileField: "file",
            fileName: fileURL.lastPathComponent,
            mimeType: mimeType,
            fileData: fileData,
            session: session
        )
    }

    func prepareScanUploads(lectureID: String, files: [LocalScanUploadFile], session: MemoSession) async throws -> ScanUploadResponse {
        try await jsonRequest(
            path: "lectures/\(lectureID)/scan-uploads",
            method: "POST",
            body: [
                "files": files.map { file in
                    [
                        "index": file.index,
                        "fileName": file.fileName,
                        "mimeType": file.mimeType,
                        "size": file.data.count
                    ]
                }
            ],
            session: session
        )
    }

    func processScan(
        lectureID: String,
        images: [[String: Any]],
        text: String?,
        languageHint: String = "sl",
        createInitialAudio: Bool = false,
        initialAudioVoice: String = "Grace",
        session: MemoSession
    ) async throws {
        var body: [String: Any] = [
            "lectureId": lectureID,
            "languageHint": languageHint,
            "createInitialAudio": createInitialAudio,
            "initialAudioVoice": initialAudioVoice,
            "images": images
        ]
        if let text, !text.isEmpty {
            body["text"] = text
        }
        let _: CreateLectureResponse = try await jsonRequest(
            path: "lectures/scan",
            method: "POST",
            body: body,
            session: session
        )
    }

    func finalizeUpload(lectureID: String, path: String, session: MemoSession) async throws {
        let _: EmptyResponse = try await jsonRequest(
            path: "lectures/\(lectureID)/finalize",
            method: "POST",
            body: ["path": path],
            session: session
        )
    }

    /// Supabase signed upload targets are returned as `path` + `token`; the
    /// upload URL is assembled the same way the web client does it.
    func signedUploadURL(path: String, token: String) throws -> URL {
        let base = try configuration.requireSupabaseURL()
        let encodedPath = path
            .split(separator: "/", omittingEmptySubsequences: false)
            .map { $0.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? String($0) }
            .joined(separator: "/")
        guard var components = URLComponents(
            url: base.appending(path: "storage/v1/object/upload/sign/\(Self.storageBucket)/\(encodedPath)"),
            resolvingAgainstBaseURL: false
        ) else {
            throw MemoError.invalidResponse
        }
        components.queryItems = [URLQueryItem(name: "token", value: token)]
        guard let url = components.url else {
            throw MemoError.invalidResponse
        }
        return url
    }

    static let storageBucket = "lecture-audio"

    func uploadFile(fileURL: URL, to signedURL: URL, contentType: String) async throws {
        var request = URLRequest(url: signedURL)
        request.httpMethod = "PUT"
        request.setValue("max-age=3600", forHTTPHeaderField: "cache-control")
        request.setValue(contentType, forHTTPHeaderField: "content-type")
        request.setValue("true", forHTTPHeaderField: "x-upsert")
        // Stream large recordings from disk. Loading the web-compatible
        // 300 MB maximum into memory can terminate the app on a real device.
        let (responseData, response) = try await urlSession.upload(for: request, fromFile: fileURL)
        try AuthService.validate(data: responseData, response: response)
    }

    func uploadData(_ data: Data, to signedURL: URL, contentType: String) async throws {
        var request = URLRequest(url: signedURL)
        request.httpMethod = "PUT"
        request.setValue("max-age=3600", forHTTPHeaderField: "cache-control")
        request.setValue(contentType, forHTTPHeaderField: "content-type")
        request.setValue("true", forHTTPHeaderField: "x-upsert")
        let (responseData, response) = try await urlSession.upload(for: request, from: data)
        try AuthService.validate(data: responseData, response: response)
    }

    func sendChat(lectureID: String, message: String, session: MemoSession) async throws -> ChatAnswerResponse {
        try await jsonRequest(
            path: "lectures/\(lectureID)/chat",
            method: "POST",
            body: ["question": message],
            session: session
        )
    }

    /// Study material, quiz and practice-test generation are queued server-side
    /// exactly like on the web; the workspace then polls the lecture detail
    /// until the asset status flips to `ready`.
    func generateStudyAssets(lectureID: String, session: MemoSession) async throws {
        let _: EmptyResponse = try await jsonRequest(
            path: "lectures/\(lectureID)/study",
            method: "POST",
            body: nil,
            session: session
        )
    }

    func generateQuizAssets(lectureID: String, session: MemoSession) async throws {
        let _: EmptyResponse = try await jsonRequest(
            path: "lectures/\(lectureID)/quiz",
            method: "POST",
            body: nil,
            session: session
        )
    }

    /// Returns only the new attempt's identity; the full attempt (with its
    /// answer rows) comes from the lecture detail, exactly as on the web.
    func startPracticeTest(lectureID: String, session: MemoSession) async throws -> PracticeTestStartResponse {
        try await jsonRequest(
            path: "lectures/\(lectureID)/practice-test/attempt",
            method: "POST",
            body: nil,
            session: session
        )
    }

    func submitPracticeTest(
        lectureID: String,
        attemptID: String,
        answers: [[String: Any]],
        session: MemoSession
    ) async throws -> PracticeTestWebSubmissionResponse {
        try await jsonRequest(
            path: "lectures/\(lectureID)/practice-test/attempt/\(attemptID)/submit",
            method: "POST",
            body: ["answers": answers],
            session: session
        )
    }

    func saveOnboarding(_ answers: OnboardingAnswers, session: MemoSession) async throws {
        let _: EmptyResponse = try await jsonRequest(
            path: "profile/onboarding",
            method: "POST",
            body: [
                "ageRange": answers.ageRange,
                "educationLevel": answers.educationLevel,
                "currentAverageGrade": answers.currentAverageGrade,
                "targetGrade": answers.targetGrade,
                "studyGoal": answers.studyGoal
            ],
            session: session
        )
    }

    func updateNoteDoc(
        lectureID: String,
        doc: EditableNoteDoc,
        expectedRevision: Int,
        session: MemoSession
    ) async throws -> NoteMediaMutationResponse {
        try await jsonRequest(
            path: "lectures/\(lectureID)/notes-doc",
            method: "PATCH",
            body: [
                "expectedRevision": expectedRevision,
                "doc": try encodedJSONObject(doc)
            ],
            session: session
        )
    }

    func persistStudySession(
        lectureID: String,
        activeStudyView: String,
        flashcardState: PersistedFlashcardSessionState?,
        quizState: PersistedQuizSessionState?,
        practiceTestState: PersistedPracticeTestSessionState?,
        session: MemoSession
    ) async throws {
        let _: APIActionResponse = try await jsonRequest(
            path: "lectures/\(lectureID)/study-session",
            method: "PATCH",
            body: [
                "activeStudyView": activeStudyView,
                "flashcardState": try flashcardState.map(encodedJSONObject) ?? NSNull(),
                "quizState": try quizState.map(encodedJSONObject) ?? NSNull(),
                "practiceTestState": try practiceTestState.map(encodedJSONObject) ?? NSNull()
            ],
            session: session
        )
    }

    func prepareNoteMediaUpload(
        lectureID: String,
        fileName: String,
        mimeType: String,
        byteSize: Int,
        session: MemoSession
    ) async throws -> NoteMediaUploadResponse {
        try await jsonRequest(
            path: "lectures/\(lectureID)/note-media/uploads",
            method: "POST",
            body: ["fileName": fileName, "mimeType": mimeType, "byteSize": byteSize],
            session: session
        )
    }

    func finalizeNoteMediaUpload(
        lectureID: String,
        mediaID: String,
        storagePath: String,
        mimeType: String,
        byteSize: Int,
        originalFileName: String,
        afterBlockID: String,
        expectedRevision: Int,
        session: MemoSession
    ) async throws -> NoteMediaMutationResponse {
        try await jsonRequest(
            path: "lectures/\(lectureID)/note-media",
            method: "POST",
            body: [
                "mediaId": mediaID,
                "storagePath": storagePath,
                "mimeType": mimeType,
                "byteSize": byteSize,
                "originalFileName": originalFileName,
                "afterBlockId": afterBlockID,
                "expectedRevision": expectedRevision
            ],
            session: session
        )
    }

    func deleteNoteMedia(lectureID: String, mediaID: String, session: MemoSession) async throws -> NoteMediaMutationResponse {
        try await jsonRequest(
            path: "lectures/\(lectureID)/note-media/\(mediaID)",
            method: "DELETE",
            body: nil,
            session: session
        )
    }

    func reviewFlashcard(id: String, confidenceBucket: String, session: MemoSession) async throws -> FlashcardProgressResponse {
        try await jsonRequest(
            path: "flashcards/\(id)/progress",
            method: "POST",
            body: ["confidenceBucket": confidenceBucket],
            session: session
        )
    }

    func createFlashcard(lectureID: String, front: String, back: String, session: MemoSession) async throws -> FlashcardMutationResponse {
        try await jsonRequest(
            path: "lectures/\(lectureID)/flashcards",
            method: "POST",
            body: ["front": front, "back": back, "difficulty": "medium"],
            session: session
        )
    }

    func updateFlashcard(id: String, front: String, back: String, session: MemoSession) async throws -> FlashcardMutationResponse {
        try await jsonRequest(
            path: "flashcards/\(id)",
            method: "PATCH",
            body: ["front": front, "back": back, "difficulty": "medium"],
            session: session
        )
    }

    func deleteFlashcard(id: String, session: MemoSession) async throws {
        let _: EmptyResponse = try await jsonRequest(
            path: "flashcards/\(id)",
            method: "DELETE",
            body: nil,
            session: session
        )
    }

    func createQuizQuestion(
        lectureID: String,
        prompt: String,
        options: [String],
        correctOptionIndex: Int,
        explanation: String,
        session: MemoSession
    ) async throws -> QuizQuestionMutationResponse {
        try await jsonRequest(
            path: "lectures/\(lectureID)/quiz/questions",
            method: "POST",
            body: [
                "prompt": prompt,
                "options": options,
                "correctOptionIndex": correctOptionIndex,
                "explanation": explanation,
                "difficulty": "medium"
            ],
            session: session
        )
    }

    func updateQuizQuestion(
        lectureID: String,
        id: String,
        prompt: String,
        options: [String],
        correctOptionIndex: Int,
        explanation: String,
        session: MemoSession
    ) async throws -> QuizQuestionMutationResponse {
        try await jsonRequest(
            path: "lectures/\(lectureID)/quiz/questions/\(id)",
            method: "PATCH",
            body: [
                "prompt": prompt,
                "options": options,
                "correctOptionIndex": correctOptionIndex,
                "explanation": explanation,
                "difficulty": "medium"
            ],
            session: session
        )
    }

    func deleteQuizQuestion(lectureID: String, id: String, session: MemoSession) async throws {
        let _: EmptyResponse = try await jsonRequest(
            path: "lectures/\(lectureID)/quiz/questions/\(id)",
            method: "DELETE",
            body: nil,
            session: session
        )
    }

    func deleteLecture(id: String, session: MemoSession) async throws {
        let _: EmptyResponse = try await jsonRequest(
            path: "lectures/\(id)",
            method: "DELETE",
            body: nil,
            session: session
        )
    }

    func retryLecture(id: String, session: MemoSession) async throws {
        let _: EmptyResponse = try await jsonRequest(
            path: "lectures/\(id)/retry",
            method: "POST",
            body: nil,
            session: session
        )
    }

    // StoreKit entitlements and in-app account deletion have no website
    // equivalent, so they stay on the dedicated mobile backend.
    func verifyStoreKitReceipt(_ receipt: StoreKitPurchaseReceipt, session: MemoSession) async throws {
        let _: EmptyResponse = try await jsonRequest(
            path: "storekit/verify",
            method: "POST",
            body: [
                "productId": receipt.productId,
                "transactionId": receipt.transactionId,
                "originalTransactionId": receipt.originalTransactionId,
                "signedTransactionJWS": receipt.signedTransactionJWS
            ],
            session: session,
            baseURL: configuration.mobileAPIURL
        )
    }

    func deleteAccount(session: MemoSession) async throws {
        let _: EmptyResponse = try await jsonRequest(
            path: "account",
            method: "DELETE",
            body: nil,
            session: session,
            baseURL: configuration.mobileAPIURL
        )
    }

    private func jsonRequest<T: Decodable>(
        path: String,
        method: String,
        body: [String: Any]?,
        session: MemoSession,
        baseURL: URL? = nil
    ) async throws -> T {
        let url = (baseURL ?? configuration.webAPIURL).appending(path: path)
        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(session.accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("ios-native", forHTTPHeaderField: "X-Memo-Client")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            var sanitizedBody: [String: Any] = [:]
            for (key, value) in body {
                if value is NSNull {
                    continue
                }
                if let optional = value as? OptionalProtocol, optional.isNil {
                    continue
                }
                sanitizedBody[key] = value
            }
            request.httpBody = try JSONSerialization.data(withJSONObject: sanitizedBody)
        }
        let (data, response) = try await urlSession.data(for: request)
        try AuthService.validate(data: data, response: response)
        if data.isEmpty, T.self == EmptyResponse.self {
            return EmptyResponse() as! T
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func multipartRequest<T: Decodable>(
        path: String,
        fields: [String: String],
        fileField: String,
        fileName: String,
        mimeType: String,
        fileData: Data,
        session: MemoSession
    ) async throws -> T {
        let boundary = "memo-\(UUID().uuidString)"
        var body = Data()
        func append(_ string: String) {
            body.append(Data(string.utf8))
        }
        for (key, value) in fields {
            append("--\(boundary)\r\n")
            append("Content-Disposition: form-data; name=\"\(key)\"\r\n\r\n")
            append("\(value)\r\n")
        }
        append("--\(boundary)\r\n")
        append("Content-Disposition: form-data; name=\"\(fileField)\"; filename=\"\(fileName)\"\r\n")
        append("Content-Type: \(mimeType)\r\n\r\n")
        body.append(fileData)
        append("\r\n--\(boundary)--\r\n")

        var request = URLRequest(url: configuration.webAPIURL.appending(path: path))
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(session.accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("ios-native", forHTTPHeaderField: "X-Memo-Client")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = body

        let (data, response) = try await urlSession.data(for: request)
        try AuthService.validate(data: data, response: response)
        if data.isEmpty, T.self == EmptyResponse.self {
            return EmptyResponse() as! T
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func encodedJSONObject<T: Encodable>(_ value: T) throws -> Any {
        let data = try JSONEncoder().encode(value)
        return try JSONSerialization.jsonObject(with: data)
    }

    func mimeTypeForFile(at url: URL, fallback: String) -> String {
        if let values = try? url.resourceValues(forKeys: [.contentTypeKey]),
           let mime = values.contentType?.preferredMIMEType {
            return mime
        }
        return UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? fallback
    }

    private func fileSize(at url: URL) throws -> Int {
        let values = try url.resourceValues(forKeys: [.fileSizeKey])
        if let size = values.fileSize {
            return size
        }
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        return (attributes[.size] as? NSNumber)?.intValue ?? 0
    }
}

/// URLSession drops the `Authorization` header when a redirect changes host,
/// so an apex-to-www hop would turn an authenticated call into a 401. Memo's
/// own hosts are re-authorised; anything else keeps the stripped default.
final class AuthenticatedRedirectDelegate: NSObject, URLSessionTaskDelegate {
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        guard
            let original = task.originalRequest,
            let authorization = original.value(forHTTPHeaderField: "Authorization"),
            request.value(forHTTPHeaderField: "Authorization") == nil,
            let originalHost = original.url?.host()?.lowercased(),
            let redirectHost = request.url?.host()?.lowercased(),
            registrableDomain(originalHost) == registrableDomain(redirectHost)
        else {
            completionHandler(request)
            return
        }

        var authorized = request
        authorized.setValue(authorization, forHTTPHeaderField: "Authorization")
        completionHandler(authorized)
    }

    private func registrableDomain(_ host: String) -> String {
        host.split(separator: ".").suffix(2).joined(separator: ".")
    }
}

struct StoreKitPurchaseReceipt: Encodable, Equatable {
    let productId: String
    let transactionId: String
    let originalTransactionId: String
    let signedTransactionJWS: String
}

@MainActor
final class StoreKitSubscriptionService: ObservableObject {
    @Published private(set) var products: [Product] = []
    @Published private(set) var activeProductIDs: Set<String> = []
    @Published private(set) var lastError: String?

    var transactionUpdateHandler: ((StoreKitPurchaseReceipt) async -> Void)?

    private let productIDs: [String]
    private var updatesTask: Task<Void, Never>?

    init(productIDs: [String]) {
        self.productIDs = productIDs
    }

    deinit {
        updatesTask?.cancel()
    }

    func start() {
        guard updatesTask == nil else {
            return
        }
        updatesTask = Task { [weak self] in
            for await update in Transaction.updates {
                await self?.handle(update)
            }
        }
    }

    func refresh() async {
        do {
            products = try await Product.products(for: productIDs).sorted { left, right in
                let leftIndex = productIDs.firstIndex(of: left.id) ?? 0
                let rightIndex = productIDs.firstIndex(of: right.id) ?? 0
                return leftIndex < rightIndex
            }
            var active = Set<String>()
            for await entitlement in Transaction.currentEntitlements {
                if case .verified(let transaction) = entitlement,
                   transaction.revocationDate == nil,
                   productIDs.contains(transaction.productID) {
                    active.insert(transaction.productID)
                }
            }
            activeProductIDs = active
        } catch {
            lastError = error.localizedDescription
        }
    }

    func purchase(_ product: Product) async throws -> StoreKitPurchaseReceipt? {
        let result = try await product.purchase()
        switch result {
        case .success(let verification):
            guard case .verified(let transaction) = verification else {
                throw MemoError.storeKit("Apple could not verify the transaction.")
            }
            activeProductIDs.insert(transaction.productID)
            let receipt = StoreKitPurchaseReceipt(
                productId: transaction.productID,
                transactionId: String(transaction.id),
                originalTransactionId: String(transaction.originalID),
                signedTransactionJWS: verification.jwsRepresentation
            )
            await transaction.finish()
            return receipt
        case .pending:
            throw MemoError.storeKit("The purchase is pending approval.")
        case .userCancelled:
            return nil
        @unknown default:
            throw MemoError.storeKit("The purchase did not complete.")
        }
    }

    func restorePurchases() async {
        do {
            try await AppStore.sync()
            await refresh()
        } catch {
            lastError = error.localizedDescription
        }
    }

    func currentReceipts() async -> [StoreKitPurchaseReceipt] {
        var receipts: [StoreKitPurchaseReceipt] = []
        for await entitlement in Transaction.currentEntitlements {
            guard case .verified(let transaction) = entitlement,
                  transaction.revocationDate == nil,
                  productIDs.contains(transaction.productID) else {
                continue
            }
            receipts.append(
                StoreKitPurchaseReceipt(
                    productId: transaction.productID,
                    transactionId: String(transaction.id),
                    originalTransactionId: String(transaction.originalID),
                    signedTransactionJWS: entitlement.jwsRepresentation
                )
            )
        }
        return receipts
    }

    private func handle(_ result: VerificationResult<Transaction>) async {
        guard case .verified(let transaction) = result else {
            return
        }
        if transaction.revocationDate == nil {
            activeProductIDs.insert(transaction.productID)
        } else {
            activeProductIDs.remove(transaction.productID)
        }
        if productIDs.contains(transaction.productID) {
            let receipt = StoreKitPurchaseReceipt(
                productId: transaction.productID,
                transactionId: String(transaction.id),
                originalTransactionId: String(transaction.originalID),
                signedTransactionJWS: result.jwsRepresentation
            )
            await transactionUpdateHandler?(receipt)
        }
        await transaction.finish()
    }
}

struct EmptyResponse: Codable {}
struct EmptyBody: Encodable {}

private struct AnyEncodable: Encodable {
    private let encodeClosure: (Encoder) throws -> Void

    init<T: Encodable>(_ wrapped: T) {
        encodeClosure = wrapped.encode
    }

    func encode(to encoder: Encoder) throws {
        try encodeClosure(encoder)
    }
}

private protocol OptionalProtocol {
    var isNil: Bool { get }
}

extension Optional: OptionalProtocol {
    var isNil: Bool { self == nil }
}
