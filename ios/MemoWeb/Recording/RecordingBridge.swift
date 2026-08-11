import Foundation
import WebKit
import os

/// The `window.MemoNative.recorder` endpoint.
///
/// Deliberately thin: it starts and stops native capture, keeps the Live Activity in step, and
/// hands the finished file to the page as a URL. Everything downstream of that — creating the
/// lecture, the signed upload, billing, processing — stays in the web app, so there is exactly
/// one implementation of it.
final class RecordingBridge: NSObject {
    static let messageName = "memoRecorder"

    private let log = Logger(subsystem: "eu.memoai.app", category: "capture")
    private let capture = AudioCaptureController()
    private let files: RecordingSchemeHandler
    private let activity: RecordingActivityController

    init(files: RecordingSchemeHandler, activity: RecordingActivityController) {
        self.files = files
        self.activity = activity
        super.init()

        // One source of truth for the Lock Screen: whatever the recorder is actually doing.
        capture.onStateChange = { [weak self] session, isRecording in
            guard let self else { return }

            if !isRecording {
                self.activity.captureStopped()
            } else if session.isPaused {
                self.activity.capturePaused()
            } else {
                self.activity.captureStarted()
            }
        }
    }

    /// Ends any recording still running — the web view is going away or reloading.
    func cancelIfRunning() {
        guard capture.isRecording else { return }
        capture.cancel()
    }
}

// MARK: - WKScriptMessageHandlerWithReply

extension RecordingBridge: WKScriptMessageHandlerWithReply {
    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        guard
            let body = message.body as? [String: Any],
            let action = body["action"] as? String
        else {
            replyHandler(nil, "Malformed recorder message")
            return
        }

        switch action {
        case "start":
            Task { @MainActor in
                do {
                    try await capture.start()
                    replyHandler(["ok": true], nil)
                } catch {
                    log.error("Start failed: \(error.localizedDescription, privacy: .public)")
                    replyHandler(nil, error.localizedDescription)
                }
            }

        case "pause":
            capture.pause()
            replyHandler(["ok": true, "elapsed": capture.elapsed], nil)

        case "resume":
            capture.resume()
            replyHandler(["ok": true, "elapsed": capture.elapsed], nil)

        case "stop":
            guard let recording = capture.stop() else {
                replyHandler(nil, "No recording in progress")
                return
            }

            let url = files.publish(recording.url)
            replyHandler(
                [
                    "ok": true,
                    "url": url.absoluteString,
                    "durationSeconds": recording.duration,
                    "mimeType": recording.mimeType,
                    "fileName": "recording-\(Int(Date().timeIntervalSince1970)).m4a",
                ],
                nil
            )

        case "cancel":
            capture.cancel()
            replyHandler(["ok": true], nil)

        case "release":
            // The page has the bytes; drop the staged copy rather than leaving it in tmp.
            if let raw = body["url"] as? String, let url = URL(string: raw) {
                files.discard(url)
            }
            replyHandler(["ok": true], nil)

        case "state":
            replyHandler(
                [
                    "isRecording": capture.isRecording,
                    "elapsed": capture.elapsed,
                ],
                nil
            )

        default:
            replyHandler(nil, "Unknown recorder action: \(action)")
        }
    }
}
