import AVFoundation
import Foundation

/// Captures the lecture natively instead of in the web view.
///
/// `MediaRecorder` inside `WKWebView` cannot survive the screen locking — iOS
/// ends the microphone track outright when the app backgrounds, which silently
/// truncates the recording. `AVAudioRecorder` in the app, paired with the `audio`
/// background mode, keeps running, so this owns the capture and hands the
/// finished file back to the page.
@MainActor
final class NativeAudioRecorder: NSObject, AVAudioRecorderDelegate {
    enum RecorderError: LocalizedError {
        case permissionDenied
        case couldNotStart

        var errorDescription: String? {
            switch self {
            case .permissionDenied:
                return "Za snemanje predavanj je potreben dostop do mikrofona."
            case .couldNotStart:
                return "Snemanja ni bilo mogoče začeti."
            }
        }
    }

    private(set) var isRecording = false
    private(set) var isPaused = false
    private(set) var currentURL: URL?

    /// Called when capture stops for a reason the page did not ask for, so the
    /// bridge can retire the Live Activity and tell the page.
    var onUnexpectedStop: ((String) -> Void)?

    private var recorder: AVAudioRecorder?

    /// Elapsed capture time. Taken from the recorder rather than a wall clock so
    /// it stays truthful across interruptions.
    var duration: TimeInterval {
        recorder?.currentTime ?? 0
    }

    /// Normalised 0...1 input level, used to drive the page's waveform, which no
    /// longer has a real capture stream to read.
    var level: Float {
        guard let recorder, isRecording, !isPaused else {
            return 0
        }
        recorder.updateMeters()
        let decibels = recorder.averagePower(forChannel: 0)
        guard decibels.isFinite else {
            return 0
        }
        // -50 dB is near enough to silence for a lecture room; clamp below it so
        // the waveform rests flat instead of jittering on noise.
        let floor: Float = -50
        guard decibels > floor else {
            return 0
        }
        return min(1, (decibels - floor) / -floor)
    }

    func requestPermission() async -> Bool {
        await withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission { allowed in
                continuation.resume(returning: allowed)
            }
        }
    }

    func start() async throws {
        guard !isRecording else {
            return
        }
        guard await requestPermission() else {
            throw RecorderError.permissionDenied
        }

        let session = AVAudioSession.sharedInstance()
        try session.setCategory(
            .playAndRecord,
            mode: .spokenAudio,
            options: [.defaultToSpeaker, .allowBluetooth]
        )
        try session.setActive(true)

        let url = Self.recordingsDirectory()
            .appending(path: "memo-recording-\(UUID().uuidString).m4a")
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 44_100,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
        ]

        let newRecorder = try AVAudioRecorder(url: url, settings: settings)
        newRecorder.delegate = self
        newRecorder.isMeteringEnabled = true
        newRecorder.prepareToRecord()
        guard newRecorder.record() else {
            throw RecorderError.couldNotStart
        }

        recorder = newRecorder
        currentURL = url
        isRecording = true
        isPaused = false
    }

    func pause() {
        guard isRecording, !isPaused else {
            return
        }
        recorder?.pause()
        isPaused = true
    }

    /// A prior interruption can leave the session inactive, in which case
    /// `record()` silently does nothing — re-activate before resuming.
    @discardableResult
    func resume() -> Bool {
        guard isRecording, isPaused else {
            return false
        }
        try? AVAudioSession.sharedInstance().setActive(true)
        guard recorder?.record() == true else {
            return false
        }
        isPaused = false
        return true
    }

    /// Stops capture and returns the finished file, which stays on disk until the
    /// page has read it back.
    @discardableResult
    func stop() -> URL? {
        guard isRecording else {
            return nil
        }
        recorder?.stop()
        recorder = nil
        isRecording = false
        isPaused = false
        return currentURL
    }

    /// Removes a recording once the page has taken it, or when it is abandoned.
    /// Recordings live in Application Support rather than the temporary
    /// directory — iOS may purge `tmp` under storage pressure, which would delete
    /// an hour-long lecture out from under an in-flight upload.
    func discard(_ url: URL) {
        try? FileManager.default.removeItem(at: url)
        if currentURL == url {
            currentURL = nil
        }
    }

    /// Clears recordings the page never collected, so an abandoned session does
    /// not leave hour-long files in the container forever.
    func discardStaleRecordings() {
        let directory = Self.recordingsDirectory()
        guard let entries = try? FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.contentModificationDateKey]
        ) else {
            return
        }
        for url in entries where url != currentURL {
            guard let modified = try? url.resourceValues(forKeys: [.contentModificationDateKey])
                .contentModificationDate else {
                continue
            }
            if modified.timeIntervalSinceNow < -24 * 60 * 60 {
                try? FileManager.default.removeItem(at: url)
            }
        }
    }

    func fileURL(forName name: String) -> URL? {
        // Only ever serve a file we produced: the page asks for it by name over a
        // custom URL scheme, and that name must not be able to escape the folder.
        guard !name.contains("/"), name.hasSuffix(".m4a") else {
            return nil
        }
        let url = Self.recordingsDirectory().appending(path: name)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    private static func recordingsDirectory() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        let directory = base.appending(path: "Recordings")
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    // MARK: - AVAudioRecorderDelegate

    nonisolated func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        guard !flag else {
            return
        }
        Task { @MainActor [weak self] in
            self?.handleFailure("Snemanje se je nepričakovano ustavilo.")
        }
    }

    nonisolated func audioRecorderEncodeErrorDidOccur(_ recorder: AVAudioRecorder, error: Error?) {
        let message = error?.localizedDescription
        Task { @MainActor [weak self] in
            self?.handleFailure(message ?? "Pri shranjevanju posnetka je prišlo do napake.")
        }
    }

    private func handleFailure(_ message: String) {
        recorder = nil
        isRecording = false
        isPaused = false
        onUnexpectedStop?(message)
    }
}
