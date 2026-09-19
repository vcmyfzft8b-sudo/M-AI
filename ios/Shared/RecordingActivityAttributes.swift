import ActivityKit
import Foundation

/// The Lock Screen banner's data contract, shared by the app (which owns the
/// recording) and the widget extension (which draws it).
///
/// The widget runs its own clock from `startedAt` — `Text(timerInterval:)`
/// ticks without the app being scheduled — so the app only pushes an update
/// when the recording actually changes state. A once-a-second push would be
/// throttled by the system long before a lecture ends.
struct RecordingActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        /// The instant the displayed count runs from, recomputed on every
        /// resume as `now - elapsed`. Paused time is therefore never counted:
        /// the reference point simply moves forward by the length of the pause.
        var startedAt: Date
        /// Seconds of audio captured so far. Only read while paused, when the
        /// banner shows a frozen figure instead of a running clock.
        var elapsed: TimeInterval
        var isPaused: Bool
        /// Already localized by the app, which follows the web app's language.
        /// The extension has no way to know which of the five the user picked.
        var status: String
    }

    /// The product name. Not localized: it is the brand.
    var title: String
}
