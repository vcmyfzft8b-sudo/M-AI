import SwiftUI

enum MemoMotion {
    /// Matches the mobile web dock/pill transition:
    /// `220ms cubic-bezier(0.22, 1, 0.36, 1)`.
    static let dock = Animation.timingCurve(0.22, 1, 0.36, 1, duration: 0.22)
    static let dockLabel = Animation.easeOut(duration: 0.15)
}
import UIKit

// Shared UI primitives matching the web app's visual language
// (ios-primary-button, auth-provider-button, auth-field, pills, banners).

struct BrandLogo: View {
    var size: CGFloat = 56

    var body: some View {
        Image("MemoLogo")
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
    }
}

/// Combined Memo AI artwork used in the signed-in app headers.
/// The source image is trimmed only around transparent pixels so the visible
/// artwork can align to the same leading edge as the web header.
struct MemoBrandBanner: View {
    var height: CGFloat = 52

    var body: some View {
        Image("MemoWordmark")
            .resizable()
            .scaledToFit()
            .frame(height: height)
            .accessibilityLabel("Memo AI")
    }
}

struct BrandWordmark: View {
    @Environment(\.memoTheme) private var theme
    var size: CGFloat = 34
    var textColor: Color?

    var body: some View {
        HStack(spacing: 10) {
            BrandLogo(size: size * 1.3)
            Text("Memo AI")
                .font(.system(size: size, weight: .heavy))
                .tracking(-0.5)
                .foregroundStyle(textColor ?? theme.label)
        }
    }
}

/// Web `ios-primary-button`: tint fill, white text, weight 600.
struct MemoPrimaryButtonStyle: ButtonStyle {
    @Environment(\.memoTheme) private var theme
    @Environment(\.isEnabled) private var isEnabled
    var minHeight: CGFloat = 52
    var cornerRadius: CGFloat = 16
    var fill: Color?

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 17, weight: .semibold))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: minHeight)
            .background(fill ?? theme.tint)
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .opacity(isEnabled ? (configuration.isPressed ? 0.85 : 1) : 0.5)
            .animation(.easeOut(duration: 0.18), value: configuration.isPressed)
            .onChange(of: configuration.isPressed) { _, isPressed in
                if isPressed { MemoHaptics.impact(.light) }
            }
    }
}

/// Web `auth-provider-button` / secondary buttons: surface fill + hairline border.
struct MemoSecondaryButtonStyle: ButtonStyle {
    @Environment(\.memoTheme) private var theme
    @Environment(\.isEnabled) private var isEnabled
    var minHeight: CGFloat = 54
    var cornerRadius: CGFloat = 16

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(theme.label)
            .frame(maxWidth: .infinity, minHeight: minHeight)
            .background(theme.surfaceStrong)
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(theme.separatorStrong, lineWidth: 1)
            )
            .opacity(isEnabled ? (configuration.isPressed ? 0.8 : 1) : 0.5)
            .animation(.easeOut(duration: 0.18), value: configuration.isPressed)
            .onChange(of: configuration.isPressed) { _, isPressed in
                if isPressed { MemoHaptics.impact(.light) }
            }
    }
}

/// Solid label-fill button (black in light theme, white in dark) used for
/// the Apple / email provider rows on the web landing auth options.
struct MemoInvertedButtonStyle: ButtonStyle {
    @Environment(\.memoTheme) private var theme
    @Environment(\.isEnabled) private var isEnabled
    var minHeight: CGFloat = 64
    var cornerRadius: CGFloat = 18

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 17, weight: .semibold))
            .foregroundStyle(theme.canvas)
            .frame(maxWidth: .infinity, minHeight: minHeight)
            .background(theme.label)
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .opacity(isEnabled ? (configuration.isPressed ? 0.82 : 1) : 0.5)
            .animation(.easeOut(duration: 0.18), value: configuration.isPressed)
            .onChange(of: configuration.isPressed) { _, isPressed in
                if isPressed { MemoHaptics.impact(.light) }
            }
    }
}

/// Centralized, deliberately restrained haptics. These generators are only
/// used for controls where iOS users expect physical confirmation: selecting,
/// navigating, completing and destructive actions.
enum MemoHaptics {
    static func impact(_ style: UIImpactFeedbackGenerator.FeedbackStyle = .light) {
        let generator = UIImpactFeedbackGenerator(style: style)
        generator.prepare()
        generator.impactOccurred()
    }

    static func selection() {
        let generator = UISelectionFeedbackGenerator()
        generator.prepare()
        generator.selectionChanged()
    }

    static func notification(_ type: UINotificationFeedbackGenerator.FeedbackType) {
        let generator = UINotificationFeedbackGenerator()
        generator.prepare()
        generator.notificationOccurred(type)
    }
}

/// Web `auth-field` input chrome.
struct MemoFieldModifier: ViewModifier {
    @Environment(\.memoTheme) private var theme
    var minHeight: CGFloat = 54
    var cornerRadius: CGFloat = 16
    var tinted = false

    func body(content: Content) -> some View {
        content
            .padding(.horizontal, 16)
            .frame(maxWidth: .infinity, minHeight: minHeight)
            .background(tinted ? theme.tintSoft : theme.surfaceStrong)
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(theme.separatorStrong, lineWidth: 1)
            )
    }
}

extension View {
    func memoField(minHeight: CGFloat = 54, cornerRadius: CGFloat = 16, tinted: Bool = false) -> some View {
        modifier(MemoFieldModifier(minHeight: minHeight, cornerRadius: cornerRadius, tinted: tinted))
    }
}

/// Card chrome matching web surface cards (hairline border + soft shadow).
struct MemoCardModifier: ViewModifier {
    @Environment(\.memoTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    var cornerRadius: CGFloat = 18
    var padding: CGFloat = 16

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background(theme.surfaceSolid)
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(theme.separator, lineWidth: 1)
            )
            .shadow(
                color: .black.opacity(colorScheme == .dark ? 0.35 : 0.04),
                radius: colorScheme == .dark ? 14 : 10,
                y: 4
            )
    }
}

extension View {
    func memoCard(cornerRadius: CGFloat = 18, padding: CGFloat = 16) -> some View {
        modifier(MemoCardModifier(cornerRadius: cornerRadius, padding: padding))
    }
}

/// Real system Liquid Glass chrome for floating docks and action pills.
/// iOS owns refraction and interaction on 26+, while older supported systems
/// retain the same geometry with a material/solid-color fallback.
private struct MemoLiquidGlassCapsuleModifier: ViewModifier {
    let tint: Color?

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            if let tint {
                content.glassEffect(.regular.tint(tint).interactive(), in: Capsule())
            } else {
                content.glassEffect(.regular.interactive(), in: Capsule())
            }
        } else if let tint {
            content
                .background(tint, in: Capsule())
                .overlay(Capsule().stroke(.white.opacity(0.16), lineWidth: 0.7))
        } else {
            content
                .background(.ultraThinMaterial, in: Capsule())
                .overlay(Capsule().stroke(.white.opacity(0.38), lineWidth: 0.7))
        }
    }
}

extension View {
    func memoLiquidGlassCapsule(tint: Color? = nil) -> some View {
        modifier(MemoLiquidGlassCapsuleModifier(tint: tint))
    }
}

/// Original mobile-web navigation dock chrome. This deliberately stays
/// opaque and separate from the app's Liquid Glass action controls.
private struct MemoClassicNavigationDockModifier: ViewModifier {
    @Environment(\.memoTheme) private var theme

    func body(content: Content) -> some View {
        content
            .background(theme.dockSurface, in: Capsule())
            // `strokeBorder` keeps the full line inside the capsule; a centered
            // stroke would lose half its width to the dock's own clip shape.
            .overlay(Capsule().strokeBorder(theme.dockBorder, lineWidth: 1.5))
    }
}

extension View {
    func memoClassicNavigationDock() -> some View {
        modifier(MemoClassicNavigationDockModifier())
    }
}

/// Apple's native segmented control. On iOS 26 the system renders this as
/// Liquid Glass and owns the complete press, scrub, refraction, spring, haptic,
/// accessibility and reduced-motion behavior. Keeping this as a real Picker
/// avoids approximating Apple interaction physics in application code.
struct MemoGlassSegmentedPicker<Item: Hashable, Label: View>: View {
    let items: [Item]
    @Binding var selection: Item
    var minHeight: CGFloat = 38
    var cornerRadius: CGFloat = 12
    @ViewBuilder let label: (Item, Bool) -> Label

    var body: some View {
        Picker("", selection: $selection) {
            ForEach(items, id: \.self) { item in
                label(item, selection == item)
                    .tag(item)
            }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .frame(maxWidth: .infinity, minHeight: minHeight)
        .accessibilityElement(children: .contain)
        .onChange(of: selection) { _, _ in
            MemoHaptics.selection()
        }
    }
}

/// The original navigation dock appearance with an added scrub interaction.
/// Dragging horizontally moves the soft selected circle between destinations,
/// emits one selection tick per crossed item, and activates on release.
struct MemoDraggableNavigationDock<Item: Hashable, Label: View>: View {
    @Environment(\.memoTheme) private var theme
    let items: [Item]
    let selected: Item?
    var width: CGFloat = 280
    var height: CGFloat = 51
    let action: (Item) -> Void
    @ViewBuilder let label: (Item, Bool) -> Label

    @State private var scrubbedItem: Item?

    private var displayedSelection: Item? { scrubbedItem ?? selected }

    var body: some View {
        GeometryReader { proxy in
            HStack(spacing: 0) {
                ForEach(items, id: \.self) { item in
                    label(item, displayedSelection == item)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background {
                            if displayedSelection == item {
                                Circle().fill(theme.dockPressed)
                            }
                        }
                        .contentShape(Rectangle())
                        .onTapGesture {
                            MemoHaptics.selection()
                            action(item)
                        }
                }
            }
            .contentShape(Capsule())
            .gesture(
                DragGesture(minimumDistance: 4, coordinateSpace: .local)
                    .onChanged { value in
                        guard let item = item(at: value.location.x, totalWidth: proxy.size.width),
                              scrubbedItem != item else { return }
                        scrubbedItem = item
                        MemoHaptics.selection()
                    }
                    .onEnded { value in
                        let destination = item(at: value.location.x, totalWidth: proxy.size.width) ?? scrubbedItem
                        scrubbedItem = nil
                        if let destination { action(destination) }
                    }
            )
        }
        .frame(width: width, height: height)
        .memoClassicNavigationDock()
        .accessibilityElement(children: .contain)
    }

    private func item(at x: CGFloat, totalWidth: CGFloat) -> Item? {
        guard !items.isEmpty, totalWidth > 0 else { return nil }
        let segmentWidth = totalWidth / CGFloat(items.count)
        let index = min(max(Int(x / segmentWidth), 0), items.count - 1)
        return items[index]
    }
}

/// Apple system back capsule. iOS 26 supplies native Liquid Glass; earlier
/// versions retain the same compact web geometry with a material fallback.
struct MemoBackButton: View {
    @Environment(\.memoTheme) private var theme
    var label = "Nazaj"
    var action: () -> Void

    @ViewBuilder
    var body: some View {
        if #available(iOS 26.0, *) {
            backButton
                .buttonStyle(.glass)
                .buttonBorderShape(.capsule)
        } else {
            backButton
                .buttonStyle(.plain)
                .padding(.horizontal, 15)
                .frame(minHeight: 38)
                .background(.ultraThinMaterial, in: Capsule())
                .overlay(Capsule().stroke(theme.separator, lineWidth: 0.7))
        }
    }

    private var backButton: some View {
        Button {
            MemoHaptics.impact(.light)
            action()
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "chevron.left")
                    .font(.system(size: 15, weight: .semibold))
                Text(label)
                    .font(.system(size: 16, weight: .semibold))
            }
            .foregroundStyle(theme.label)
        }
    }
}

/// Apple system close button shared by sheets, editors and overlays.
struct MemoCloseButton: View {
    @Environment(\.memoTheme) private var theme
    var size: CGFloat = 32
    var accessibilityLabel = "Zapri"
    var foreground: Color?
    var action: () -> Void

    @ViewBuilder
    var body: some View {
        if #available(iOS 26.0, *) {
            closeButton
                .buttonStyle(.glass)
                .buttonBorderShape(.circle)
        } else {
            closeButton
                .buttonStyle(.plain)
                .background(theme.closeFill, in: Circle())
        }
    }

    private var closeButton: some View {
        Button {
            MemoHaptics.impact(.light)
            action()
        } label: {
            Image(systemName: "xmark")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(foreground ?? theme.secondaryLabel)
                .frame(width: size, height: size)
        }
        .accessibilityLabel(accessibilityLabel)
    }
}

/// Compact Apple system back control for progress flows where the text label
/// would compete with a centered progress indicator.
struct MemoBackIconButton: View {
    @Environment(\.memoTheme) private var theme
    var size: CGFloat = 40
    var foreground: Color?
    var action: () -> Void

    @ViewBuilder
    var body: some View {
        if #available(iOS 26.0, *) {
            backButton
                .buttonStyle(.glass)
                .buttonBorderShape(.circle)
        } else {
            backButton
                .buttonStyle(.plain)
                .background(.ultraThinMaterial, in: Circle())
        }
    }

    private var backButton: some View {
        Button {
            MemoHaptics.impact(.light)
            action()
        } label: {
            Image(systemName: "chevron.left")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(foreground ?? theme.label)
                .frame(width: size, height: size)
        }
        .accessibilityLabel("Nazaj")
    }
}

/// Status / error banner pill matching web `app-start-banner`.
struct MemoBanner: View {
    @Environment(\.memoTheme) private var theme
    enum Kind {
        case error
        case success
        case info
    }

    let kind: Kind
    let message: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .semibold))
            Text(message)
                .font(.system(size: 14, weight: .medium))
                .multilineTextAlignment(.leading)
        }
        .foregroundStyle(tint)
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(softTint)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private var icon: String {
        switch kind {
        case .error: "exclamationmark.circle.fill"
        case .success: "checkmark.circle.fill"
        case .info: "info.circle.fill"
        }
    }

    private var tint: Color {
        switch kind {
        case .error: theme.red
        case .success: theme.green
        case .info: theme.tint
        }
    }

    private var softTint: Color {
        switch kind {
        case .error: theme.redSoft
        case .success: theme.greenSoft
        case .info: theme.tintSoft
        }
    }
}

/// Uppercase status badge matching web `.ios-status` (only shown when status != ready).
struct StatusBadge: View {
    @Environment(\.memoTheme) private var theme
    let status: LectureStatus

    var body: some View {
        Text(label.uppercased())
            .font(.system(size: 11, weight: .medium))
            .tracking(0.5)
            .foregroundStyle(foreground)
            .padding(.horizontal, 8)
            .frame(minHeight: 24)
            .background(background)
            .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
    }

    private var label: String {
        switch status {
        case .uploading: "Nalaganje"
        case .queued: "V čakalni vrsti"
        case .transcribing: "Prepisovanje"
        case .generatingNotes: "Ustvarjanje zapiskov"
        case .ready: "Pripravljeno"
        case .failed: "Napaka"
        }
    }

    private var foreground: Color {
        switch status {
        case .ready: theme.green
        case .failed: theme.red
        default: theme.secondaryLabel
        }
    }

    private var background: Color {
        switch status {
        case .ready: theme.greenSoft
        case .failed: theme.redSoft
        default: theme.surfaceMuted
        }
    }
}

extension LectureStatus {
    var isProcessing: Bool {
        switch self {
        case .uploading, .queued, .transcribing, .generatingNotes: true
        case .ready, .failed: false
        }
    }
}

/// Google mark from the asset catalog.
struct GoogleMark: View {
    var size: CGFloat = 20

    var body: some View {
        Image("GoogleLogo")
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
    }
}

/// Divider row with centered label, matching the web "ali" separator.
struct LabeledDivider: View {
    @Environment(\.memoTheme) private var theme
    let label: String

    var body: some View {
        HStack(spacing: 12) {
            Rectangle().fill(theme.separator).frame(height: 1)
            Text(label.uppercased())
                .font(.system(size: 12, weight: .semibold))
                .tracking(1.4)
                .foregroundStyle(theme.tertiaryLabel)
            Rectangle().fill(theme.separator).frame(height: 1)
        }
    }
}

/// Toast for transient status messages.
struct StatusToast: View {
    @Environment(\.memoTheme) private var theme
    let message: String

    var body: some View {
        Text(message)
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(theme.label)
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
            .background(.ultraThinMaterial, in: Capsule())
            .overlay(Capsule().stroke(theme.separator, lineWidth: 1))
            .shadow(color: .black.opacity(0.12), radius: 14, y: 6)
    }
}

/// Legal footer used on auth screens.
struct AuthLegalText: View {
    @Environment(\.memoTheme) private var theme
    let configuration: AppConfiguration

    var body: some View {
        Text(attributed)
            .font(.system(size: 12.5))
            .foregroundStyle(theme.secondaryLabel)
            .multilineTextAlignment(.center)
            .tint(theme.tint)
    }

    private var attributed: AttributedString {
        var text = AttributedString(
            "Z nadaljevanjem se strinjaš s Memo pogoji uporabe in politiko zasebnosti, vključno z AI obdelavo zvoka, besedila, dokumentov in povezav. Potrjuješ tudi, da imaš potrebna dovoljenja za snemanje, nalaganje in uporabo gradiva, ki ga pošlješ v Memo."
        )
        if let range = text.range(of: "pogoji uporabe") {
            text[range].link = configuration.termsURL
            text[range].underlineStyle = .single
        }
        if let range = text.range(of: "politiko zasebnosti") {
            text[range].link = configuration.privacyPolicyURL
            text[range].underlineStyle = .single
        }
        return text
    }
}

/// Emoji icon inside a rounded circle chip, matching web `.ios-row-icon`.
struct EmojiChip: View {
    @Environment(\.memoTheme) private var theme
    let emoji: String
    var size: CGFloat = 42
    var background: Color?

    var body: some View {
        Text(emoji)
            .font(.system(size: size * 0.45))
            .frame(width: size, height: size)
            .background(background ?? theme.surfaceMuted)
            .clipShape(Circle())
    }
}

/// Pulsing red dot used while recording (web LiveAudioWave).
struct LiveAudioWave: View {
    let active: Bool
    @State private var pulsing = false

    var body: some View {
        ZStack {
            Circle()
                .fill(Color(hex: 0xFF3B30).opacity(0.22))
                .frame(width: 44, height: 44)
                .scaleEffect(active && pulsing ? 1.5 : 0.9)
                .opacity(active ? (pulsing ? 0 : 0.8) : 0)
            Circle()
                .fill(Color(hex: 0xFF3B30))
                .frame(width: 20, height: 20)
                .scaleEffect(active ? 1 : 0.75)
                .opacity(active ? 1 : 0.35)
                .shadow(color: Color(hex: 0xFF3B30).opacity(0.5), radius: active ? 10 : 0)
        }
        .frame(height: 52)
        .onAppear { startPulse() }
        .onChange(of: active) { startPulse() }
    }

    private func startPulse() {
        pulsing = false
        guard active else {
            return
        }
        withAnimation(.easeOut(duration: 1.1).repeatForever(autoreverses: false)) {
            pulsing = true
        }
    }
}

// MARK: - Formatting helpers (mirror src/lib/utils.ts, sl-SI locale)

enum MemoFormat {
    static let slLocale = Locale(identifier: "sl_SI")

    /// "9. 7. 2026"
    static func calendarDate(_ isoString: String?) -> String {
        guard let date = Date.fromSupabase(isoString) else {
            return ""
        }
        let formatter = DateFormatter()
        formatter.locale = slLocale
        formatter.dateFormat = "d. M. yyyy"
        return formatter.string(from: date)
    }

    /// "9. 7. 2026 ob 14:05"
    static func relativeDate(_ isoString: String?) -> String {
        guard let date = Date.fromSupabase(isoString) else {
            return ""
        }
        let formatter = DateFormatter()
        formatter.locale = slLocale
        formatter.dateFormat = "d. M. yyyy 'ob' HH:mm"
        return formatter.string(from: date)
    }

    /// MM:SS or HH:MM:SS
    static func timestamp(_ interval: TimeInterval) -> String {
        let total = max(0, Int(interval))
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        let seconds = total % 60
        if hours > 0 {
            return String(format: "%d:%02d:%02d", hours, minutes, seconds)
        }
        return String(format: "%d:%02d", minutes, seconds)
    }

    static func timestampMs(_ ms: Int) -> String {
        timestamp(TimeInterval(ms) / 1000)
    }

    /// Slovenian pluralization for lecture counts: 1 predavanje, 2 predavanji, 3-4 predavanja, 5+ predavanj
    static func lectureCount(_ count: Int) -> String {
        let mod100 = count % 100
        let word: String
        switch mod100 {
        case 1: word = "predavanje"
        case 2: word = "predavanji"
        case 3, 4: word = "predavanja"
        default: word = "predavanj"
        }
        return "\(count) \(word)"
    }
}

extension Date {
    /// Parses Supabase ISO-8601 timestamps (with or without fractional seconds).
    static func fromSupabase(_ string: String?) -> Date? {
        guard let string else {
            return nil
        }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: string) {
            return date
        }
        let plain = ISO8601DateFormatter()
        return plain.date(from: string)
    }
}
