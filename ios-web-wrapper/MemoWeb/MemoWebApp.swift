import SwiftUI

@main
struct MemoWebApp: App {
    @StateObject private var webViewStore = WebViewStore()

    var body: some Scene {
        WindowGroup {
            WebContainerView(store: webViewStore)
        }
    }
}
