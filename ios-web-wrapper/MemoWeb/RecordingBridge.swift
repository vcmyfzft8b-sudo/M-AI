import ActivityKit
import AVFoundation
import Foundation
import OSLog
import WebKit

private let log = Logger(subsystem: "eu.memoai.web", category: "recording")

/// Owns the recording Live Activity and the capture behind it.
///
/// The page's own `MediaRecorder` cannot survive the screen locking — iOS ends
/// the microphone track when the app backgrounds — so `RecordingBridge.userScript`
/// replaces it with a shim that drives `NativeAudioRecorder` through this bridge
/// and gets the finished file back over the app's custom URL scheme.
///
/// Listening deliberately has no Live Activity: iOS already publishes a Now
/// Playing card for the page's audio, with a scrubber and transport controls a
/// Live Activity cannot offer, and a second card saying the same thing is just
/// clutter on the Lock Screen.
@MainActor
final class RecordingBridge: NSObject, ObservableObject, WKScriptMessageHandler {
    static let messageHandlerName = "memoRecording"
    /// Host on `EmbeddedBranding.resourceScheme` that serves finished recordings.
    static let recordingHost = "recording"

    @Published private(set) var isRecording = false
    @Published private(set) var isPaused = false

    private let recorder = NativeAudioRecorder()
    private var activity: Activity<MemoRecordingAttributes>?
    private var levelTimer: Timer?
    private var observers: [NSObjectProtocol] = []
    private weak var webView: WKWebView?

    override init() {
        super.init()
        registerSessionObservers()
        recorder.onUnexpectedStop = { [weak self] message in
            self?.handleRecorderFailure(message)
        }
        recorder.discardStaleRecordings()
    }

    deinit {
        for observer in observers {
            NotificationCenter.default.removeObserver(observer)
        }
    }

    func attach(to webView: WKWebView) {
        self.webView = webView
    }

    func recordingFileURL(forName name: String) -> URL? {
        recorder.fileURL(forName: name)
    }

    /// A full page load replaces the shim that would have collected the recording,
    /// so there is no longer anywhere for the audio to go. Stop rather than leave
    /// a banner running against a session nothing can finish. In-app SPA routing
    /// does not reach here, so recording survives navigation inside the app.
    func webContentDidReset() {
        if isRecording {
            let url = recorder.stop()
            isRecording = false
            isPaused = false
            stopLevelUpdates()
            endActivity(finalElapsed: 0)
            if let url {
                recorder.discard(url)
            }
        }
    }

    // MARK: - WKScriptMessageHandler

    nonisolated func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        // WebKit always delivers script messages on the main thread; the protocol
        // just is not annotated for it.
        MainActor.assumeIsolated {
            guard let body = message.body as? [String: Any],
                  let event = body["event"] as? String else {
                return
            }
            handle(event: event)
        }
    }

    private func handle(event: String) {
        log.info("bridge event: \(event, privacy: .public)")
        switch event {
        case "record-start":
            Task { await startRecording() }
        case "record-pause":
            pauseRecording(systemInitiated: false)
        case "record-resume":
            resumeRecording()
        case "record-stop":
            stopRecording()
        case "ready", "unsupported":
            return
        default:
            return
        }
    }

    // MARK: - Recording

    private func startRecording() async {
        guard !isRecording else {
            return
        }
        do {
            try await recorder.start()
        } catch {
            log.error("native record failed: \(error.localizedDescription, privacy: .public)")
            deliverToPage("window.__memoNative?.recordingFailed(\(jsString(error.localizedDescription)))")
            return
        }
        isRecording = true
        isPaused = false
        startLevelUpdates()
        await startActivity()
    }

    private func pauseRecording(systemInitiated: Bool) {
        guard isRecording, !isPaused else {
            return
        }
        recorder.pause()
        isPaused = true
        updateActivity()
        if systemInitiated {
            deliverToPage("window.__memoNative?.recordingInterrupted()")
        }
    }

    private func resumeRecording() {
        guard isRecording, isPaused else {
            return
        }
        guard recorder.resume() else {
            log.error("native resume failed")
            return
        }
        isPaused = false
        updateActivity()
    }

    private func stopRecording() {
        guard isRecording else {
            return
        }
        let elapsed = recorder.duration
        let url = recorder.stop()
        isRecording = false
        isPaused = false
        stopLevelUpdates()
        endActivity(finalElapsed: elapsed)
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])

        guard let url else {
            deliverToPage("window.__memoNative?.recordingFailed(\(jsString("Posnetek ni na voljo.")))")
            return
        }
        // The page fetches the file over the custom scheme rather than receiving
        // it inline: an hour-long lecture is far too large to hand across the
        // bridge as a string.
        let source = "\(EmbeddedBranding.resourceScheme)://\(Self.recordingHost)/\(url.lastPathComponent)"
        deliverToPage("window.__memoNative?.recordingReady(\(jsString(source)), \(elapsed))")
    }

    private func handleRecorderFailure(_ message: String) {
        guard isRecording else {
            return
        }
        isRecording = false
        isPaused = false
        stopLevelUpdates()
        endActivity(finalElapsed: 0)
        deliverToPage("window.__memoNative?.recordingFailed(\(jsString(message)))")
    }

    /// The page's waveform used to read the capture stream. It no longer has one,
    /// so the real input level is pushed to it instead.
    private func startLevelUpdates() {
        stopLevelUpdates()
        let timer = Timer(timeInterval: 1.0 / 15.0, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, self.isRecording else {
                    return
                }
                self.deliverToPage("window.__memoNative?.level(\(self.recorder.level))")
            }
        }
        RunLoop.main.add(timer, forMode: .common)
        levelTimer = timer
    }

    private func stopLevelUpdates() {
        levelTimer?.invalidate()
        levelTimer = nil
    }

    // MARK: - Page messaging

    private func deliverToPage(_ script: String) {
        webView?.evaluateJavaScript(script)
    }

    private func jsString(_ value: String) -> String {
        let data = try? JSONSerialization.data(withJSONObject: [value])
        guard let data, let encoded = String(data: data, encoding: .utf8) else {
            return "\"\""
        }
        // Unwrap the single-element array JSONSerialization needs at the top level.
        return String(encoded.dropFirst().dropLast())
    }

    // MARK: - Session interruptions

    private func registerSessionObservers() {
        let center = NotificationCenter.default
        observers.append(
            center.addObserver(
                forName: AVAudioSession.interruptionNotification,
                object: AVAudioSession.sharedInstance(),
                queue: .main
            ) { [weak self] notification in
                let info = notification.userInfo
                Task { @MainActor [weak self] in
                    self?.handleInterruption(info)
                }
            }
        )
        observers.append(
            center.addObserver(
                forName: AVAudioSession.routeChangeNotification,
                object: AVAudioSession.sharedInstance(),
                queue: .main
            ) { [weak self] notification in
                let info = notification.userInfo
                Task { @MainActor [weak self] in
                    self?.handleRouteChange(info)
                }
            }
        )
    }

    /// A call or Siri takes the microphone away mid-lecture. Without this the
    /// banner would keep counting against silence.
    private func handleInterruption(_ userInfo: [AnyHashable: Any]?) {
        guard let raw = userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else {
            return
        }
        switch type {
        case .began:
            pauseRecording(systemInitiated: true)
        case .ended:
            guard isRecording, isPaused else {
                return
            }
            let options = (userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt)
                .map(AVAudioSession.InterruptionOptions.init(rawValue:)) ?? []
            if options.contains(.shouldResume) {
                resumeRecording()
            }
        @unknown default:
            return
        }
    }

    /// Unplugging a headset changes the input; pause rather than silently
    /// continuing to record from a device the user did not choose.
    private func handleRouteChange(_ userInfo: [AnyHashable: Any]?) {
        guard isRecording, !isPaused,
              let raw = userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
              let reason = AVAudioSession.RouteChangeReason(rawValue: raw),
              reason == .oldDeviceUnavailable else {
            return
        }
        pauseRecording(systemInitiated: true)
    }

    // MARK: - Live Activity

    private func startActivity() async {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            log.error("live activities are disabled")
            return
        }

        // An app update or a terminated session can leave a stale activity on the
        // Lock Screen. Always retire it before publishing the new one so the
        // system never keeps showing an orphaned snapshot.
        for stale in Activity<MemoRecordingAttributes>.activities {
            await stale.end(nil, dismissalPolicy: .immediate)
        }

        let state = MemoRecordingAttributes.ContentState(
            elapsed: 0,
            isPaused: false,
            resumedAt: Date()
        )
        do {
            activity = try Activity.request(
                attributes: MemoRecordingAttributes(title: "Memo snema predavanje"),
                content: ActivityContent(state: state, staleDate: nil),
                pushType: nil
            )
            log.info("live activity started")
        } catch {
            // Capture must remain functional even when Live Activities are off.
            log.error("live activity request failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    private func updateActivity() {
        guard let activity else {
            return
        }
        let state = MemoRecordingAttributes.ContentState(
            elapsed: recorder.duration,
            isPaused: isPaused,
            resumedAt: isPaused ? nil : Date()
        )
        Task {
            await activity.update(ActivityContent(state: state, staleDate: nil))
        }
    }

    private func endActivity(finalElapsed: TimeInterval) {
        guard let activity else {
            return
        }
        self.activity = nil
        let state = MemoRecordingAttributes.ContentState(
            elapsed: finalElapsed,
            isPaused: true,
            resumedAt: nil
        )
        Task {
            await activity.end(
                ActivityContent(state: state, staleDate: nil),
                dismissalPolicy: .immediate
            )
        }
    }
}
