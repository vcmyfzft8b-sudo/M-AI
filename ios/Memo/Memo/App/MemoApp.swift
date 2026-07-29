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
                .task {
                    await appModel.bootstrap()
                }
        }
    }
}
