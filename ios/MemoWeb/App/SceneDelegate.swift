import UIKit

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    private var rootViewController: WebViewController?

    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        guard let windowScene = scene as? UIWindowScene else { return }

        let root = WebViewController()
        rootViewController = root

        let window = UIWindow(windowScene: windowScene)
        window.rootViewController = root
        window.makeKeyAndVisible()
        self.window = window

        // A cold launch from a link: resolve before the first load so the deep link is the
        // initial navigation rather than a redirect after the home screen renders.
        let launchURL = connectionOptions.urlContexts.first?.url
            ?? connectionOptions.userActivities.first(where: { $0.activityType == NSUserActivityTypeBrowsingWeb })?.webpageURL

        if let launchURL, let resolved = DeepLink.resolve(launchURL) {
            root.load(resolved)
        }
    }

    /// `memo://` custom-scheme links while the app is already running.
    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        guard
            let url = URLContexts.first?.url,
            let resolved = DeepLink.resolve(url)
        else { return }
        rootViewController?.load(resolved)
    }

    /// Universal links, once Associated Domains is configured (see `ios/README.md`).
    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        guard
            userActivity.activityType == NSUserActivityTypeBrowsingWeb,
            let url = userActivity.webpageURL,
            let resolved = DeepLink.resolve(url)
        else { return }
        rootViewController?.load(resolved)
    }
}
