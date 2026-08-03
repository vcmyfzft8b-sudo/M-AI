import SwiftUI

@main
struct MemoApp: App {
    @StateObject private var appModel = AppModel(
        configuration: .live,
        keychain: KeychainStore(service: "eu.memoai.ios.session")
    )

    var body: some Scene {
        WindowGroup {
            AppRootView()
                .environmentObject(appModel)
                .readableContentWidth()
                .task {
                    await appModel.bootstrap()
                }
        }
    }
}

private extension View {
    /// The layout is designed for a phone column. Run unmodified on an iPad the
    /// rows stretch the full 13", which reads as a blown-up iPhone app rather
    /// than an iPad one. Centring the same column on a wide screen keeps line
    /// lengths readable without maintaining a second layout.
    func readableContentWidth() -> some View {
        modifier(ReadableContentWidth())
    }
}

private struct ReadableContentWidth: ViewModifier {
    /// Roughly the widest an iPhone column gets, so phones are untouched.
    private let maxWidth: CGFloat = 620

    func body(content: Content) -> some View {
        GeometryReader { proxy in
            if proxy.size.width > maxWidth {
                content
                    .frame(width: maxWidth)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                content
            }
        }
    }
}
