import ActivityKit
import SwiftUI
import WidgetKit

/// The Lock Screen banner shown for the whole of a lecture recording, and its
/// Dynamic Island counterpart.
///
/// The clock is a `Text(timerInterval:)` rather than a value the app pushes:
/// the system ticks it locally, so the banner stays right to the second on a
/// locked phone without the app being woken once a second — and without
/// spending the activity's update budget on a two-hour lecture.
struct RecordingLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RecordingActivityAttributes.self) { context in
            LockScreenBanner(context: context)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    MemoMark(size: 36)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Clock(state: context.state)
                        .font(.title2.weight(.semibold))
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(context.attributes.title)
                            .font(.headline)
                        StatusLine(state: context.state)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            } compactLeading: {
                MemoMark(size: 20)
            } compactTrailing: {
                Clock(state: context.state)
                    .font(.caption.weight(.semibold))
                    // Without a ceiling the compact region keeps growing as the
                    // clock rolls past an hour and crowds out everything else.
                    .frame(maxWidth: 52)
            } minimal: {
                RecordingDot(isPaused: context.state.isPaused)
            }
            .keylineTint(.red)
        }
    }
}

private struct LockScreenBanner: View {
    let context: ActivityViewContext<RecordingActivityAttributes>

    var body: some View {
        HStack(spacing: 12) {
            MemoMark(size: 42)
            VStack(alignment: .leading, spacing: 3) {
                Text(context.attributes.title)
                    .font(.headline)
                    .foregroundStyle(.primary)
                StatusLine(state: context.state)
            }
            Spacer(minLength: 8)
            Clock(state: context.state)
                .font(.system(.title, design: .rounded).weight(.semibold))
                .foregroundStyle(.primary)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
    }
}

private struct StatusLine: View {
    let state: RecordingActivityAttributes.ContentState

    var body: some View {
        HStack(spacing: 5) {
            RecordingDot(isPaused: state.isPaused)
            Text(state.status)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
    }
}

private struct RecordingDot: View {
    let isPaused: Bool

    var body: some View {
        Circle()
            .fill(isPaused ? Color.secondary : Color.red)
            .frame(width: 8, height: 8)
    }
}

/// Counts up while recording; holds the figure it stopped at while paused.
private struct Clock: View {
    let state: RecordingActivityAttributes.ContentState

    var body: some View {
        Group {
            if state.isPaused {
                Text(Self.formatted(state.elapsed))
            } else {
                // `startedAt` is `now - elapsed`, recomputed on every resume, so
                // the running count never includes time spent paused.
                Text(timerInterval: state.startedAt...Date.distantFuture, countsDown: false)
            }
        }
        .monospacedDigit()
        .lineLimit(1)
        .minimumScaleFactor(0.7)
    }

    /// Matches the running clock's own shape: m:ss until an hour, h:mm:ss after.
    static func formatted(_ seconds: TimeInterval) -> String {
        let total = Int(seconds.rounded())
        let (hours, minutes, remainder) = (total / 3600, (total % 3600) / 60, total % 60)
        return hours > 0
            ? String(format: "%d:%02d:%02d", hours, minutes, remainder)
            : String(format: "%d:%02d", minutes, remainder)
    }
}

private struct MemoMark: View {
    let size: CGFloat

    var body: some View {
        Image("MemoMark")
            .resizable()
            .aspectRatio(contentMode: .fit)
            .frame(width: size, height: size)
    }
}
