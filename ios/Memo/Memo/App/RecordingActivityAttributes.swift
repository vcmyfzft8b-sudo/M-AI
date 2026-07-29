import ActivityKit
import Foundation

struct MemoRecordingAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var elapsed: TimeInterval
        var isPaused: Bool
        var resumedAt: Date?
    }

    var title: String
}
