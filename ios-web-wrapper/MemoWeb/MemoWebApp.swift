import SwiftUI

@main
struct MemoWebApp: App {
    @StateObject private var webViewStore = WebViewStore()
    @StateObject private var recordingBridge = RecordingBridge()

    var body: some Scene {
        WindowGroup {
            WebContainerView(store: webViewStore, recordingBridge: recordingBridge)
        }
    }
}
