import ActivityKit
import AVFoundation
import Foundation

@MainActor
final class AudioRecorder: NSObject, ObservableObject, AVAudioRecorderDelegate {
    @Published private(set) var isRecording = false
    @Published private(set) var isPaused = false
    @Published private(set) var lastRecordingURL: URL?
    @Published private(set) var duration: TimeInterval = 0
    @Published var permissionError: String?

    private var recorder: AVAudioRecorder?
    private var timer: Timer?
    private var recordingActivity: Activity<MemoRecordingAttributes>?

    func requestPermission() async -> Bool {
        await withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission { allowed in
                continuation.resume(returning: allowed)
            }
        }
    }

    func start() async {
        guard !isRecording else {
            return
        }
        let allowed = await requestPermission()
        guard allowed else {
            permissionError = "Za snemanje predavanj je potreben dostop do mikrofona."
            return
        }

        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, mode: .spokenAudio, options: [.defaultToSpeaker])
            try session.setActive(true)

            let url = FileManager.default.temporaryDirectory
                .appending(path: "memo-recording-\(UUID().uuidString).m4a")
            let settings: [String: Any] = [
                AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
                AVSampleRateKey: 44_100,
                AVNumberOfChannelsKey: 1,
                AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
            ]

            let newRecorder = try AVAudioRecorder(url: url, settings: settings)
            newRecorder.delegate = self
            newRecorder.prepareToRecord()
            guard newRecorder.record() else {
                throw AudioRecorderError.couldNotStart
            }
            recorder = newRecorder
            lastRecordingURL = url
            duration = 0
            isRecording = true
            isPaused = false
            startTimer()
            await startLiveActivity()
        } catch {
            permissionError = error.localizedDescription
        }
    }

    func pause() {
        guard isRecording, !isPaused else {
            return
        }
        recorder?.pause()
        duration = recorder?.currentTime ?? duration
        isPaused = true
        updateLiveActivity()
    }

    func resume() {
        guard isRecording, isPaused else {
            return
        }
        recorder?.record()
        isPaused = false
        updateLiveActivity()
    }

    func stop() {
        guard isRecording else {
            return
        }
        duration = recorder?.currentTime ?? duration
        recorder?.stop()
        recorder = nil
        timer?.invalidate()
        timer = nil
        isRecording = false
        isPaused = false
        endLiveActivity(finalDuration: duration)
        try? AVAudioSession.sharedInstance().setActive(false)
    }

    func reset() {
        stop()
        lastRecordingURL = nil
        duration = 0
    }

    private func startTimer() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, let recorder = self.recorder, !self.isPaused else {
                    return
                }
                self.duration = recorder.currentTime
            }
        }
    }

    private func startLiveActivity() async {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            return
        }

        // An app update or terminated recording can leave a stale activity on
        // the Lock Screen. Always retire it before publishing the new session
        // so the system never keeps showing an orphaned snapshot.
        for activity in Activity<MemoRecordingAttributes>.activities {
            await activity.end(nil, dismissalPolicy: .immediate)
        }

        let state = MemoRecordingAttributes.ContentState(
            elapsed: duration,
            isPaused: false,
            resumedAt: Date()
        )
        do {
            recordingActivity = try Activity.request(
                attributes: MemoRecordingAttributes(title: "Memo snema predavanje"),
                content: ActivityContent(state: state, staleDate: nil),
                pushType: nil
            )
        } catch {
            // Recording must remain functional even when Live Activities are disabled.
        }
    }

    private func updateLiveActivity() {
        guard let recordingActivity else {
            return
        }
        let state = MemoRecordingAttributes.ContentState(
            elapsed: duration,
            isPaused: isPaused,
            resumedAt: isPaused ? nil : Date()
        )
        Task {
            await recordingActivity.update(ActivityContent(state: state, staleDate: nil))
        }
    }

    private func endLiveActivity(finalDuration: TimeInterval) {
        guard let recordingActivity else {
            return
        }
        self.recordingActivity = nil
        let state = MemoRecordingAttributes.ContentState(
            elapsed: finalDuration,
            isPaused: true,
            resumedAt: nil
        )
        Task {
            await recordingActivity.end(
                ActivityContent(state: state, staleDate: nil),
                dismissalPolicy: .immediate
            )
        }
    }
}

private enum AudioRecorderError: LocalizedError {
    case couldNotStart

    var errorDescription: String? {
        "Snemanja ni bilo mogoče začeti."
    }
}
