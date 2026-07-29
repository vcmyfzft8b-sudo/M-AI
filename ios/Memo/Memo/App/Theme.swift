import SwiftUI

// Design tokens ported from src/app/globals.css so the native app matches the web UI
// in both light and dark themes.

enum ThemePreference: String, CaseIterable, Identifiable {
    case system
    case light
    case dark

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .system: "System"
        case .light: "Light"
        case .dark: "Dark"
        }
    }

    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}

struct MemoTheme {
    let canvas: Color
    let surface: Color
    let surfaceStrong: Color
    let surfaceSolid: Color
    let surfaceMuted: Color
    let label: Color
    let secondaryLabel: Color
    let tertiaryLabel: Color
    let separator: Color
    let separatorStrong: Color
    let tint: Color
    let tintStrong: Color
    let tintSoft: Color
    let green: Color
    let greenSoft: Color
    let red: Color
    let redSoft: Color
    let purple: Color
    let navBackground: Color
    let sheetBackground: Color
    /// Navigation dock chrome. Deliberately darker than `surfaceSolid` so the
    /// floating dock separates from the light canvas instead of blending in.
    let dockSurface: Color
    let dockBorder: Color
    let dockPressed: Color
    let pressed: Color
    let closeFill: Color
    let folderColor: Color
    let folderBackColor: Color

    static let light = MemoTheme(
        canvas: Color(hex: 0xE9E9ED),
        surface: Color.white.opacity(0.72),
        surfaceStrong: .white,
        surfaceSolid: .white,
        surfaceMuted: Color(hex: 0xF5F5F7),
        label: .black,
        secondaryLabel: Color(hex: 0x86868B),
        tertiaryLabel: Color(hex: 0xD2D2D7),
        separator: Color.black.opacity(0.08),
        separatorStrong: Color.black.opacity(0.16),
        tint: Color(hex: 0x0066CC),
        tintStrong: Color(hex: 0x004EB1),
        tintSoft: Color(hex: 0x0066CC).opacity(0.1),
        green: Color(hex: 0x34C759),
        greenSoft: Color(hex: 0x34C759).opacity(0.12),
        red: Color(hex: 0xFF3B30),
        redSoft: Color(hex: 0xFF3B30).opacity(0.12),
        purple: Color(hex: 0xBF5AF2),
        navBackground: Color.white.opacity(0.72),
        sheetBackground: .white,
        dockSurface: Color(hex: 0x2B2B31),
        dockBorder: Color.white.opacity(0.14),
        dockPressed: Color.white.opacity(0.16),
        pressed: Color.black.opacity(0.05),
        closeFill: Color.black.opacity(0.08),
        folderColor: Color(hex: 0x70A1FF),
        folderBackColor: Color(hex: 0x4785FF)
    )

    static let dark = MemoTheme(
        canvas: .black,
        surface: Color(hex: 0x1C1C1E).opacity(0.7),
        surfaceStrong: Color(hex: 0x1C1C1E),
        surfaceSolid: Color(hex: 0x1C1C1E),
        surfaceMuted: Color(hex: 0x2C2C2E),
        label: .white,
        secondaryLabel: Color(hex: 0x86868B),
        tertiaryLabel: Color(hex: 0x636366),
        separator: Color.white.opacity(0.15),
        separatorStrong: Color.white.opacity(0.25),
        tint: Color(hex: 0x0A84FF),
        tintStrong: Color(hex: 0x409CFF),
        tintSoft: Color(hex: 0x0A84FF).opacity(0.15),
        green: Color(hex: 0x32D74B),
        greenSoft: Color(hex: 0x32D74B).opacity(0.15),
        red: Color(hex: 0xFF453A),
        redSoft: Color(hex: 0xFF453A).opacity(0.15),
        purple: Color(hex: 0xBF5AF2),
        navBackground: Color(hex: 0x1C1C1E).opacity(0.72),
        sheetBackground: Color(hex: 0x1C1C1E),
        dockSurface: Color(hex: 0x3A3A3C),
        dockBorder: Color.white.opacity(0.32),
        dockPressed: Color.white.opacity(0.14),
        pressed: Color.white.opacity(0.08),
        closeFill: Color.white.opacity(0.12),
        folderColor: Color(hex: 0x70A1FF),
        folderBackColor: Color(hex: 0x4785FF)
    )

    static func current(for scheme: ColorScheme) -> MemoTheme {
        scheme == .dark ? .dark : .light
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }
}

private struct MemoThemeKey: EnvironmentKey {
    static let defaultValue = MemoTheme.light
}

extension EnvironmentValues {
    var memoTheme: MemoTheme {
        get { self[MemoThemeKey.self] }
        set { self[MemoThemeKey.self] = newValue }
    }
}

/// Injects the resolved MemoTheme for the active color scheme.
struct MemoThemeProvider<Content: View>: View {
    @Environment(\.colorScheme) private var colorScheme
    @ViewBuilder var content: Content

    var body: some View {
        content.environment(\.memoTheme, MemoTheme.current(for: colorScheme))
    }
}
