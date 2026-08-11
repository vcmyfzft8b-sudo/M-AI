import AVFoundation
import Foundation
import os

/// Native audio capture, so a lecture survives the screen locking.
///
/// The web app records with `MediaRecorder`, which WebKit tears down the instant the web view
/// stops being frontmost — locking the phone or pressing Home silently truncates the recording.
/// `AVAudioRecorder` plus the `audio` background mode keeps running, which is the whole reason
/// this exists. The web app still owns everything else: it asks for a recording, gets a file
/// back, and runs its own upload and billing flow unchanged.
final class AudioCaptureController: NSObject {
    enum CaptureError: LocalizedError {
        case permissionDenied
        case sessionUnavailable(any Error)
        case recorderUnavailable

        var errorDescription: String? {
            switch self {
            case .permissionDenied:
                return String(localized: "Memo nima dovoljenja za uporabo mikrofona.")
            case .sessionUnavailable, .recorderUnavailable:
                return String(localized: "Snemanja ni bilo mogoče začeti.")
            }
        }
    }

    struct Recording {
        let url: URL
        let duration: TimeInterval
        let mimeType = "audio/mp4"
    }

    private let log = Logger(subsystem: "eu.memoai.app", category: "capture")
    private let session = AVAudioSession.sharedInstance()

    private var recorder: AVAudioRecorder?
    private var timing = RecordingSession()

    /// Fires on start, pause, resume and stop so the Live Activity can follow along.
    var onStateChange: ((RecordingSession, Bool) -> Void)?

    private(set) var isRecording = false

    var elapsed: TimeInterval { timing.elapsed(at: Date()) }

    override init() {
        super.init()

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleInterruption(_:)),
            name: AVAudioSession.interruptionNotification,
            object: session
        )
    }

    // MARK: - Lifecycle

    func start() async throws -> Void {
        guard await requestPermission() else { throw CaptureError.permissionDenied }

        // `.playAndRecord` with `.mixWithOthers` off: a lecture recording should take the input
        // route exclusively. `.allowBluetooth` picks up AirPods, which is how people actually
        // record a lecture from the back of a hall.
        do {
            try session.setCategory(
                .playAndRecord,
                mode: .spokenAudio,
                options: [.allowBluetooth, .allowBluetoothA2DP]
            )
            try session.setActive(true)
        } catch {
            throw CaptureError.sessionUnavailable(error)
        }

        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("Recordings", isDirectory: true)
            .appendingPathComponent("\(UUID().uuidString).m4a")

        try? FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )

        // Mono AAC at 32 kHz / 64 kbps: speech-grade, and ~29 MB per hour. Stereo at 44.1 kHz
        // would multiply that for no gain on a lecture recorded from a pocket.
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 32_000,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 64_000,
            AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
        ]

        guard let recorder = try? AVAudioRecorder(url: url, settings: settings) else {
            throw CaptureError.recorderUnavailable
        }

        recorder.delegate = self
        guard recorder.record() else { throw CaptureError.recorderUnavailable }

        self.recorder = recorder
        isRecording = true
        timing.start(at: Date())
        notify()

        log.notice("Recording started")
    }

    func pause() {
        guard let recorder, recorder.isRecording else { return }
        recorder.pause()
        timing.pause(at: Date())
        notify()
    }

    func resume() {
        guard let recorder, !recorder.isRecording, isRecording else { return }
        guard recorder.record() else { return }
        timing.resume(at: Date())
        notify()
    }

    /// Stops and returns the finished file. The caller owns it from here.
    func stop() -> Recording? {
        guard let recorder else { return nil }

        let duration = timing.elapsed(at: Date())
        recorder.stop()

        self.recorder = nil
        isRecording = false
        timing = RecordingSession()
        notify()

        // Leaving the session active would keep the audio route captured and the recording
        // indicator lit after the user is done.
        try? session.setActive(false, options: .notifyOthersOnDeactivation)

        log.notice("Recording stopped after \(Int(duration))s")
        return Recording(url: recorder.url, duration: duration)
    }

    /// Stops and deletes — used when the user abandons the sheet.
    func cancel() {
        guard let recording = stop() else { return }
        try? FileManager.default.removeItem(at: recording.url)
    }

    // MARK: - Interruptions

    /// A phone call or a Siri request suspends the recorder. Without this the recording would
    /// keep "running" in the UI while capturing silence.
    @objc private func handleInterruption(_ notification: Notification) {
        guard
            let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
            let type = AVAudioSession.InterruptionType(rawValue: raw)
        else { return }

        switch type {
        case .began:
            pause()
        case .ended:
            let options = (notification.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt)
                .map(AVAudioSession.InterruptionOptions.init(rawValue:)) ?? []
            if options.contains(.shouldResume) {
                try? session.setActive(true)
                resume()
            }
        @unknown default:
            break
        }
    }

    private func requestPermission() async -> Bool {
        await withCheckedContinuation { continuation in
            if #available(iOS 17.0, *) {
                AVAudioApplication.requestRecordPermission { continuation.resume(returning: $0) }
            } else {
                session.requestRecordPermission { continuation.resume(returning: $0) }
            }
        }
    }

    private func notify() {
        onStateChange?(timing, isRecording)
    }
}

// MARK: - AVAudioRecorderDelegate

extension AudioCaptureController: AVAudioRecorderDelegate {
    func audioRecorderEncodeErrorDidOccur(_ recorder: AVAudioRecorder, error: (any Error)?) {
        log.error("Encoding failed: \(error?.localizedDescription ?? "unknown", privacy: .public)")
    }
}
