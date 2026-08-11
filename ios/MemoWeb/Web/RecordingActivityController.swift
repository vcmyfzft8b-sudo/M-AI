import ActivityKit
import Foundation
import os

/// Publishes the Lock Screen / Dynamic Island recording activity.
///
/// The wrapper does not need the web app to tell it when recording starts. WebKit exposes
/// `WKWebView.microphoneCaptureState`, which flips to `.active` the moment the page's
/// `getUserMedia` track goes live and back to `.none` when it is stopped — so the activity is
/// driven straight off the real capture state, with no bridge call and no web-side change.
final class RecordingActivityController {
    private let log = Logger(subsystem: "eu.memoai.app", category: "live-activity")

    private var activity: Activity<MemoRecordingAttributes>?
    private var session = RecordingSession()

    /// Capture is live and unmuted.
    func captureStarted(now: Date = Date()) {
        if activity == nil {
            session.start(at: now)
            Task { await publish(now: now) }
        } else if session.isPaused {
            session.resume(at: now)
            update(now: now)
        }
    }

    /// The page muted the track — the web app's pause control.
    func capturePaused(now: Date = Date()) {
        guard activity != nil, !session.isPaused else { return }
        session.pause(at: now)
        update(now: now)
    }

    /// The track ended, the page navigated away, or the web view went away.
    func captureStopped(now: Date = Date()) {
        #if DEBUG
        // `-MemoDebugKeepActivity 1` holds the activity open after capture ends, so the widget's
        // rendering can be inspected on the Lock Screen and in the Dynamic Island — which is
        // otherwise impossible, because WebKit ends capture at the very moment the app leaves
        // the foreground. Diagnostics only; never set in a shipping build.
        if UserDefaults.standard.bool(forKey: "MemoDebugKeepActivity") {
            log.notice("Keeping Live Activity open (debug)")
            return
        }
        #endif

        guard let activity else { return }
        self.activity = nil

        let final = session.elapsed(at: now)
        session = RecordingSession()

        let state = MemoRecordingAttributes.ContentState(
            elapsed: final,
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

    // MARK: - ActivityKit

    private func publish(now: Date) async {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            log.notice("Live Activities are disabled for this app")
            return
        }

        // A crash or a force-quit mid-recording can leave an orphaned activity on the Lock
        // Screen. Retire any stragglers before publishing, so the system never shows two.
        for stale in Activity<MemoRecordingAttributes>.activities {
            await stale.end(nil, dismissalPolicy: .immediate)
        }

        let state = MemoRecordingAttributes.ContentState(
            elapsed: session.elapsed(at: now),
            isPaused: false,
            resumedAt: now
        )

        do {
            activity = try Activity.request(
                attributes: MemoRecordingAttributes(title: "Memo snema predavanje"),
                content: ActivityContent(state: state, staleDate: nil),
                pushType: nil
            )
        } catch {
            // Recording must keep working even when the activity cannot be shown.
            log.error("Could not start Live Activity: \(error.localizedDescription, privacy: .public)")
        }
    }

    private func update(now: Date) {
        guard let activity else { return }

        let paused = session.isPaused
        let state = MemoRecordingAttributes.ContentState(
            elapsed: session.elapsed(at: now),
            isPaused: paused,
            resumedAt: paused ? nil : now
        )

        Task {
            await activity.update(ActivityContent(state: state, staleDate: nil))
        }
    }
}
