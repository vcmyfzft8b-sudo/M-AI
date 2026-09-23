import UIKit
import UserNotifications

/**
 Remote notifications: the permission, the device token, and the tap.

 The page decides *when* to ask — the right moment is just after someone
 starts a note, when the wait is the thing on their mind, not at launch when
 the question is meaningless. Everything iOS-shaped lives here, and the page
 drives it over the `memoNative` bridge.
 */
@MainActor
final class PushNotifications: NSObject, UNUserNotificationCenterDelegate {
    /**
     Which APNs host will recognize this build's tokens.

     A debug build carries the development entitlement and its tokens exist
     only in Apple's sandbox. TestFlight and the App Store are both release
     builds and both production, which is why this is a compile-time answer
     rather than something to detect. The server re-checks anyway — a token
     rejected as `BadDeviceToken` is retried against the other host — so a
     wrong answer here costs one delivery rather than the feature.
     */
    static var environment: String {
        #if DEBUG
        return "sandbox"
        #else
        return "production"
        #endif
    }

    /**
     Opens the note a reader tapped.

     Held until the web view controller sets it, because a tap on a
     notification is one of the ways the app is launched: the callback arrives
     while the first page is still loading, long before anything can navigate.
     */
    var openNote: ((String) -> Void)? {
        didSet {
            guard let pending = pendingNote, let openNote else { return }
            pendingNote = nil
            openNote(pending)
        }
    }
    private var pendingNote: String?

    /// The note a launching tap asked for, handed over once.
    func takePendingNote() -> String? {
        defer { pendingNote = nil }
        return pendingNote
    }

    private var deviceToken: String?
    private var waiting: [CheckedContinuation<String, Error>] = []

    override init() {
        super.init()
        UNUserNotificationCenter.current().delegate = self
        #if DEBUG
        // UI tests: behave as if this launch came from tapping a note's notification.
        if let lecture = ProcessInfo.processInfo.environment["MEMO_QA_NOTIFICATION_LECTURE"] { pendingNote = lecture }
        #endif
    }

    /// Provisional counts: it is still a delivered notification, just a quiet one.
    func isAuthorized() async -> Bool {
        let status = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
        return status == .authorized || status == .provisional
    }

    func settingsSnapshot() async -> [String: Any] {
        let status = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
        return [
            "authorized": status == .authorized || status == .provisional,
            // `notDetermined` is the only state the app can still change. Once
            // someone has said no, only iOS Settings can undo it, and the page
            // should offer that rather than a button that does nothing.
            "canAsk": status == .notDetermined,
        ]
    }

    /**
     Asks, then registers. Returns the device token, or throws.

     Returns the existing token without asking again when permission is
     already granted, so the page may call this as often as it likes.
     */
    func enable() async throws -> String {
        let center = UNUserNotificationCenter.current()
        let status = await center.notificationSettings().authorizationStatus
        if status == .denied { throw BridgeFailure(reason: "notifications denied") }
        if status == .notDetermined {
            let granted = (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
            guard granted else { throw BridgeFailure(reason: "notifications declined") }
        }
        return try await token()
    }

    /// The token for an already-permitted app, without prompting.
    func refresh() async -> String? {
        guard await isAuthorized() else { return nil }
        return try? await token()
    }

    private func token() async throws -> String {
        if let deviceToken { return deviceToken }
        return try await withCheckedThrowingContinuation { continuation in
            waiting.append(continuation)
            UIApplication.shared.registerForRemoteNotifications()
            // Neither APNs callback is guaranteed to arrive — a simulator with
            // no push support, or a device that cannot reach Apple, simply
            // says nothing. Without this the caller waits forever and the
            // continuation leaks.
            Task { [weak self] in
                try? await Task.sleep(for: .seconds(20))
                self?.settle(.failure(BridgeFailure(reason: "no device token")))
            }
        }
    }

    /// Resumes every waiter exactly once. `@MainActor` makes that safe: the
    /// list is drained before anything can append to it again.
    private func settle(_ result: Result<String, Error>) {
        guard !waiting.isEmpty else { return }
        let pending = waiting
        waiting = []
        for continuation in pending { continuation.resume(with: result) }
    }

    func didRegister(deviceToken data: Data) {
        let value = data.map { String(format: "%02x", $0) }.joined()
        deviceToken = value
        settle(.success(value))
        tokenChanged?(value)
    }

    func didFailToRegister(error: Error) {
        settle(.failure(BridgeFailure(reason: "APNs: \(error.localizedDescription)")))
    }

    /// Apple reissues a token without being asked — a restore, an OS upgrade.
    /// The controller re-posts it so the server never sends to a dead address.
    var tokenChanged: ((String) -> Void)?

    /// The token last handed out, for the sign-out that has to retract it.
    var currentToken: String? { deviceToken }

    // MARK: - UNUserNotificationCenterDelegate

    /**
     Nothing is shown while the app is open.

     The only notification Memo sends is "your note is finished", and someone
     looking at the app can already see that happen: the note appears in the
     list. A banner over the top of it would be the app telling you something
     you are in the middle of watching.
     */
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        []
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let info = response.notification.request.content.userInfo
        guard let lecture = info["lectureId"] as? String else { return }
        await MainActor.run {
            // A tap on a notification can be what launches the app, so the
            // destination is kept until something exists that can open it.
            if let openNote { openNote(lecture) } else { pendingNote = lecture }
        }
    }
}
