import Foundation

/// Elapsed-time bookkeeping for one recording session.
///
/// A pure value type on purpose: the pause/resume arithmetic is the part that goes subtly wrong,
/// and it is far cheaper to unit test than to infer from Lock Screen screenshots.
struct RecordingSession: Equatable {
    /// Time banked from previous run stretches, excluding the one in progress.
    private(set) var accumulated: TimeInterval = 0

    /// When the current run stretch began, or `nil` while paused.
    private(set) var runningSince: Date?

    var isPaused: Bool { runningSince == nil }

    mutating func start(at date: Date) {
        accumulated = 0
        runningSince = date
    }

    mutating func pause(at date: Date) {
        guard let runningSince else { return }
        accumulated += max(0, date.timeIntervalSince(runningSince))
        self.runningSince = nil
    }

    mutating func resume(at date: Date) {
        guard runningSince == nil else { return }
        runningSince = date
    }

    func elapsed(at date: Date) -> TimeInterval {
        guard let runningSince else { return accumulated }
        return accumulated + max(0, date.timeIntervalSince(runningSince))
    }
}
