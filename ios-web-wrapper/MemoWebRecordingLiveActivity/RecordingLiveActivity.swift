import ActivityKit
import SwiftUI
import WidgetKit

struct RecordingLiveActivity: Widget {
    private let brandPink = Color(red: 0.98, green: 0.43, blue: 0.58)

    var body: some WidgetConfiguration {
        ActivityConfiguration(for: MemoRecordingAttributes.self) { context in
            HStack(alignment: .center, spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 7) {
                        Circle()
                            .fill(context.state.isPaused ? Color.orange : Color.red)
                            .frame(width: 10, height: 10)
                        Text("Snemanje")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(.white)
                            .lineLimit(1)
                    }

                    memoWordmark(width: 158, height: 49)
                }

                Spacer(minLength: 10)

                lockScreenDuration(context.state)
                    .font(.system(size: 30, weight: .medium, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .multilineTextAlignment(.trailing)
                    .frame(width: 112, alignment: .trailing)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12)
            .padding(.vertical, 12)
            // Recording state is intentionally visible on the Lock Screen.
            // Explicitly opt out of host redaction so the Simulator and devices
            // using "When Unlocked" notification previews don't reduce this
            // safety/status indicator to an empty material card.
            .activityBackgroundTint(Color.black.opacity(0.58))
            .activitySystemActionForegroundColor(.white)
            .widgetURL(URL(string: "eu.memoai.memo://recording"))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 7) {
                        memoBrainLogo(size: 26)
                        Text(context.state.isPaused ? "Premor" : "Snemanje")
                            .font(.system(size: 13, weight: .semibold))
                    }
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    recordingDuration(context.state)
                        .font(.system(size: 14, weight: .bold, design: .monospaced))
                        .monospacedDigit()
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(context.state.isPaused ? "Snemanje je začasno ustavljeno" : "Snemanje predavanja poteka")
                            .font(.system(size: 13, weight: .semibold))
                        Text("Memo bo nadaljeval tudi z zaklenjenim zaslonom.")
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            } compactLeading: {
                memoBrainLogo(size: 21)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } compactTrailing: {
                recordingDuration(context.state)
                    .font(.system(size: 12, weight: .semibold, design: .monospaced))
                    .monospacedDigit()
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            } minimal: {
                memoBrainLogo(size: 18)
            }
            .widgetURL(URL(string: "eu.memoai.memo://recording"))
            .keylineTint(brandPink)
        }
    }

    @ViewBuilder
    private func recordingDuration(_ state: MemoRecordingAttributes.ContentState) -> some View {
        if state.isPaused || state.resumedAt == nil {
            Text(formattedDuration(state.elapsed))
        } else if let resumedAt = state.resumedAt {
            let startedAt = resumedAt.addingTimeInterval(-state.elapsed)
            Text(timerInterval: startedAt...Date.distantFuture, countsDown: false, showsHours: false)
        }
    }

    @ViewBuilder
    private func lockScreenDuration(_ state: MemoRecordingAttributes.ContentState) -> some View {
        if state.isPaused || state.resumedAt == nil {
            Text(formattedDuration(state.elapsed))
        } else if let resumedAt = state.resumedAt {
            let startedAt = resumedAt.addingTimeInterval(-state.elapsed)
            Text(timerInterval: startedAt...Date.distantFuture, countsDown: false, showsHours: false)
        }
    }

    @ViewBuilder
    private func memoBrainLogo(size: CGFloat) -> some View {
        Image("MemoBrain")
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
            .accessibilityLabel("Memo")
    }

    @ViewBuilder
    private func memoWordmark(width: CGFloat, height: CGFloat) -> some View {
        Image("MemoWordmark")
            .resizable()
            .scaledToFit()
            .frame(width: width, height: height, alignment: .leading)
            .accessibilityLabel("Memo AI")
    }

    private func formattedDuration(_ duration: TimeInterval) -> String {
        let seconds = max(0, Int(duration.rounded(.down)))
        let hours = seconds / 3600
        if hours > 0 {
            return String(format: "%d:%02d:%02d", hours, (seconds % 3600) / 60, seconds % 60)
        }
        return String(format: "%d:%02d", seconds / 60, seconds % 60)
    }
}
