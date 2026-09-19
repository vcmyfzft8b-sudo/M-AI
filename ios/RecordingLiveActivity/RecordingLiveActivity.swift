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
            // No background tint: the system's own material follows the
            // phone's appearance, so the banner is dark on a dark Lock Screen
            // instead of a pale card pinned to one theme. The lockup carries a
            // white sticker outline around every stroke, so the wordmark reads
            // on either ground without a second asset.
            LockScreenBanner(context: context)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    // The island's own background is always black, so here the
                    // mark goes on its own and the name is drawn as text.
                    MemoMark(size: 32)
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
            } minimal: {
                RecordingDot(isPaused: context.state.isPaused)
            }
            .keylineTint(.red)
        }
    }
}

private struct LockScreenBanner: View {
    let context: ActivityViewContext<RecordingActivityAttributes>

    private static let lockupHeight: CGFloat = 38
    /// memo-lockup.png is 480 × 148.
    private static let lockupAspect: CGFloat = 480 / 148

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 8) {
                // One asset: the brain and the "Memo AI" wordmark together, the
                // same lockup the web app signs its pages with. Both dimensions
                // are given: a resizable image with only a height still asks
                // for every point of width going, which left the clock adrift
                // in the middle of the banner instead of against its edge.
                Image("MemoLockup")
                    .resizable()
                    .scaledToFit()
                    .frame(width: Self.lockupHeight * Self.lockupAspect, height: Self.lockupHeight)
                    .accessibilityLabel(context.attributes.title)
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
            .fill(isPaused ? AnyShapeStyle(.secondary) : AnyShapeStyle(Color.red))
            .frame(width: 8, height: 8)
    }
}

/// Counts up while recording; holds the figure it stopped at while paused.
private struct Clock: View {
    let state: RecordingActivityAttributes.ContentState

    /// The end of the range a running clock is laid out for.
    ///
    /// `Text(timerInterval:)` reserves room for the widest value its range can
    /// reach, so `distantFuture` made the clock claim most of the banner and
    /// then render as "1:--" once the text it had sized for no longer fitted.
    /// Nine hours bounds that at seven characters, far past both the three-hour
    /// upload limit and the eight hours the system gives an activity.
    private static let horizon: TimeInterval = 9 * 60 * 60

    var body: some View {
        Group {
            if state.isPaused {
                Text(Self.formatted(state.elapsed))
            } else {
                // `startedAt` is `now - elapsed`, recomputed on every resume, so
                // the running count never includes time spent paused.
                Text(
                    timerInterval: state.startedAt...state.startedAt.addingTimeInterval(Self.horizon),
                    countsDown: false)
            }
        }
        .monospacedDigit()
        .lineLimit(1)
        .minimumScaleFactor(0.7)
        // The box is sized for the longest value the range can reach, so the
        // digits are laid out from its right edge: the clock then grows
        // leftwards past the hour instead of shunting itself sideways.
        .multilineTextAlignment(.trailing)
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
