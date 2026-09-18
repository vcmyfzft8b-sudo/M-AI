import ActivityKit
import AVFoundation
import Foundation

/// Native lecture capture.
///
/// `MediaRecorder` inside the web view cannot survive the screen locking: iOS
/// suspends the web content process and ends the microphone track with it, so
/// a lecture recorded through the page is silently truncated the moment the
/// phone goes dark. Capture therefore happens here, on an `AVAudioSession` the
/// app owns, kept alive by the `audio` background mode, and the page drives it
/// over the `memoNative` bridge.
///
/// The file is handed back in chunks rather than in one base64 string: three
/// hours is the upload limit, which is ~43 MB at this bitrate, and a single
/// message that size is a memory spike on both sides of the bridge.
@MainActor
final class LectureRecorder: NSObject, AVAudioRecorderDelegate {
    enum State: String {
        case idle, recording, paused
    }

    /// Mono AAC at 16 kHz. The web pipeline transcodes anything it uploads down
    /// to mono 16 kHz anyway, so recording straight into the target shape means
    /// the file leaves the phone without a second, lossy pass — and a three-hour
    /// lecture lands around 43 MB rather than 300.
    private static let settings: [String: Any] = [
        AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
        AVSampleRateKey: 16_000.0,
        AVNumberOfChannelsKey: 1,
        AVEncoderBitRateKey: 32_000,
    ]

    private(set) var state: State = .idle
    private var recorder: AVAudioRecorder?
    private var file: URL?
    private var handle: FileHandle?
    /// True between an interruption beginning and the user (or the system)
    /// resuming. The page shows the same paused UI either way, but only a
    /// user-requested pause may be resumed by a user-requested resume.
    private var interrupted = false
    private var activity: Activity<RecordingActivityAttributes>?

    /// Localized by the app, whose locale follows the web page's. Set before
    /// the first `start` so the banner never shows an English word to a
    /// Slovenian user.
    var statusText: (recording: String, paused: String) = ("Recording", "Paused")

    override init() {
        super.init()
        NotificationCenter.default.addObserver(
            self, selector: #selector(handleInterruption),
            name: AVAudioSession.interruptionNotification, object: AVAudioSession.sharedInstance())
        NotificationCenter.default.addObserver(
            self, selector: #selector(handleMediaServicesReset),
            name: AVAudioSession.mediaServicesWereResetNotification, object: nil)
    }

    // MARK: - Recording

    func start() async throws -> [String: Any] {
        guard state == .idle else { throw BridgeFailure(reason: "already recording") }
        guard await Self.requestPermission() else { throw BridgeFailure(reason: "microphone denied") }

        let session = AVAudioSession.sharedInstance()
        do {
            // .record rather than .playAndRecord: nothing here plays, and the
            // narrower category leaves other audio alone on the way out.
            try session.setCategory(.record, mode: .default, options: [.allowBluetoothHFP])
            try session.setActive(true)
        } catch {
            throw BridgeFailure(reason: "audio session: \(error.localizedDescription)")
        }

        let url = try Self.makeFileURL()
        do {
            let recorder = try AVAudioRecorder(url: url, settings: Self.settings)
            recorder.delegate = self
            guard recorder.record() else { throw BridgeFailure(reason: "recorder refused to start") }
            self.recorder = recorder
        } catch let failure as BridgeFailure {
            try? session.setActive(false, options: .notifyOthersOnDeactivation)
            throw failure
        } catch {
            try? session.setActive(false, options: .notifyOthersOnDeactivation)
            throw BridgeFailure(reason: "recorder: \(error.localizedDescription)")
        }

        file = url
        interrupted = false
        state = .recording
        startActivity()
        return snapshot()
    }

    func pause() throws -> [String: Any] {
        guard state == .recording, let recorder else { throw BridgeFailure(reason: "not recording") }
        recorder.pause()
        state = .paused
        interrupted = false
        updateActivity()
        return snapshot()
    }

    func resume() throws -> [String: Any] {
        guard state == .paused, let recorder else { throw BridgeFailure(reason: "not paused") }
        // An interruption deactivates the session; recording into a dead one
        // fails silently, which is the worst possible outcome for a lecture.
        try? AVAudioSession.sharedInstance().setActive(true)
        guard recorder.record() else { throw BridgeFailure(reason: "recorder refused to resume") }
        state = .recording
        interrupted = false
        updateActivity()
        return snapshot()
    }

    /// Finalizes the file and reports what the page has to collect. The audio
    /// stays on disk until `discard`, which the page calls once it holds every
    /// chunk.
    func stop() throws -> [String: Any] {
        guard state != .idle, let recorder, let file else { throw BridgeFailure(reason: "not recording") }
        let elapsed = recorder.currentTime
        recorder.stop()
        self.recorder = nil
        state = .idle
        interrupted = false
        endActivity()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)

        let size = (try? FileManager.default.attributesOfItem(atPath: file.path)[.size] as? Int) ?? nil
        guard let size, size > 0 else {
            discard()
            throw BridgeFailure(reason: "recording was empty")
        }
        return [
            "status": "stopped",
            "fileName": file.lastPathComponent,
            "mimeType": "audio/mp4",
            "size": size,
            "elapsed": elapsed,
        ]
    }

    /// One slice of the finished file, base64 encoded. Reads through a single
    /// open handle so a 40 MB lecture is never resident in memory whole.
    func read(offset: Int, length: Int) throws -> [String: Any] {
        guard state == .idle, let file else { throw BridgeFailure(reason: "no finished recording") }
        guard offset >= 0, length > 0, length <= 8 * 1024 * 1024 else { throw BridgeFailure(reason: "bad range") }
        do {
            let handle = try self.handle ?? FileHandle(forReadingFrom: file)
            self.handle = handle
            try handle.seek(toOffset: UInt64(offset))
            let data = try handle.read(upToCount: length) ?? Data()
            return ["data": data.base64EncodedString(), "length": data.count]
        } catch {
            throw BridgeFailure(reason: "read: \(error.localizedDescription)")
        }
    }

    /// Drops the recording and everything holding it open. Safe to call in any
    /// state, including from `deinit`-like cleanup on launch.
    func discard() {
        recorder?.stop()
        recorder = nil
        if state != .idle {
            endActivity()
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        }
        state = .idle
        interrupted = false
        try? handle?.close()
        handle = nil
        if let file { try? FileManager.default.removeItem(at: file) }
        file = nil
    }

    func snapshot() -> [String: Any] {
        [
            "state": state.rawValue,
            "elapsed": recorder?.currentTime ?? 0,
            "interrupted": interrupted,
            // Live Activities can be switched off per app in Settings. Recording
            // still works; the page says so rather than promising a banner that
            // will not appear.
            "bannerAvailable": ActivityAuthorizationInfo().areActivitiesEnabled,
        ]
    }

    // MARK: - Interruptions

    /// A call, a Siri request or another app taking the microphone stops the
    /// recorder where it stands. iOS does not resume it for us, and it does not
    /// always offer `.shouldResume` either — so the recording holds at a pause
    /// the page can show and the user can lift, rather than ending a lecture
    /// halfway through without telling anyone.
    @objc private func handleInterruption(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        switch type {
        case .began:
            guard state == .recording else { return }
            recorder?.pause()
            state = .paused
            interrupted = true
            updateActivity()
        case .ended:
            guard state == .paused, interrupted else { return }
            let options = (note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt)
                .map(AVAudioSession.InterruptionOptions.init(rawValue:)) ?? []
            guard options.contains(.shouldResume) else { return }
            _ = try? resume()
        @unknown default:
            return
        }
    }

    /// The audio server restarting invalidates the recorder outright. Whatever
    /// reached disk is kept — the page can still collect it — but the take ends.
    @objc private func handleMediaServicesReset() {
        guard state != .idle else { return }
        recorder?.stop()
        recorder = nil
        state = .idle
        interrupted = false
        endActivity()
    }

    // MARK: - Lock Screen banner

    private func startActivity() {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        let attributes = RecordingActivityAttributes(title: "Memo AI")
        let state = RecordingActivityAttributes.ContentState(
            startedAt: Date(), elapsed: 0, isPaused: false, status: statusText.recording)
        // `staleDate: nil` keeps the banner live for the whole lecture; the
        // system ends it when the app does, or after its own eight-hour ceiling.
        activity = try? Activity.request(
            attributes: attributes, content: ActivityContent(state: state, staleDate: nil), pushType: nil)
    }

    private func updateActivity() {
        guard let activity else { return }
        let elapsed = recorder?.currentTime ?? 0
        let content = RecordingActivityAttributes.ContentState(
            startedAt: Date().addingTimeInterval(-elapsed),
            elapsed: elapsed,
            isPaused: state == .paused,
            status: state == .paused ? statusText.paused : statusText.recording)
        Task { await activity.update(ActivityContent(state: content, staleDate: nil)) }
    }

    private func endActivity() {
        guard let activity else { return }
        self.activity = nil
        Task { await activity.end(nil, dismissalPolicy: .immediate) }
    }

    /// Banners outlive the process that started them. A crash or a force quit
    /// mid-lecture would otherwise leave a clock running on the Lock Screen
    /// with nothing recording behind it.
    static func dismissStaleActivities() {
        Task {
            for activity in Activity<RecordingActivityAttributes>.activities {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
        }
    }

    // MARK: - Files

    private static func directory() throws -> URL {
        let base = try FileManager.default.url(
            for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let directory = base.appendingPathComponent("Recordings", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    private static func makeFileURL() throws -> URL {
        do {
            return try directory().appendingPathComponent("lecture-\(Int(Date().timeIntervalSince1970)).m4a")
        } catch {
            throw BridgeFailure(reason: "storage: \(error.localizedDescription)")
        }
    }

    /// Anything left behind by a previous launch. A take the page never
    /// collected is not recoverable — the page owns the draft it belongs to —
    /// and a few hours of audio is not something to leave on a user's phone.
    static func removeOrphanedRecordings() {
        guard let directory = try? directory(),
              let files = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
        else { return }
        for file in files { try? FileManager.default.removeItem(at: file) }
    }

    private static func requestPermission() async -> Bool {
        switch AVAudioApplication.shared.recordPermission {
        case .granted: return true
        case .denied: return false
        default: return await AVAudioApplication.requestRecordPermission()
        }
    }
}
