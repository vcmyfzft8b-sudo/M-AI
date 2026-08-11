import Foundation

/// What the wrapper should do with a main-frame navigation.
enum NavigationDecision: Equatable {
    /// Render inside the wrapper's web view.
    case allow
    /// Present in `SFSafariViewController` — third-party web content keeps Safari's chrome.
    case openInBrowser(URL)
    /// Hand to `UIApplication.open` — `mailto:`, `tel:`, App Store links and similar.
    case openInSystem(URL)
    /// Swallow the navigation entirely.
    case block
}

/// Decides where each navigation goes. Deliberately free of UIKit so it can be unit tested.
struct NavigationPolicy {
    /// Registrable domains that may render in-app. A host matches a domain when it *is* the
    /// domain or is a subdomain of it — never on a bare substring, so `notmemoai.eu` is rejected.
    let allowedDomains: Set<String>

    /// Schemes the system should handle rather than WebKit.
    private static let systemSchemes: Set<String> = [
        "mailto", "tel", "telprompt", "sms", "facetime", "facetime-audio",
        "itms-apps", "itms-appss", "maps", "shareddocuments", "message",
    ]

    init(allowedDomains: Set<String>) {
        self.allowedDomains = allowedDomains
    }

    func isInAppHost(_ url: URL) -> Bool {
        guard let host = url.host?.lowercased() else { return false }
        return allowedDomains.contains { host == $0 || host.hasSuffix(".\($0)") }
    }

    /// - Parameters:
    ///   - url: The navigation target.
    ///   - isMainFrame: Sub-frame loads (Stripe, reCAPTCHA, embeds) are always allowed; only
    ///     main-frame navigations can take the user away from the app.
    func decide(for url: URL, isMainFrame: Bool) -> NavigationDecision {
        guard isMainFrame else { return .allow }

        guard let scheme = url.scheme?.lowercased() else { return .block }

        switch scheme {
        case "http", "https":
            // Upgrade bare http on our own domains; everything else off-domain goes to Safari.
            return isInAppHost(url) ? .allow : .openInBrowser(url)

        case "about", "blob", "data", "javascript":
            // WebKit-internal loads (`about:blank` popups, blob previews) stay in the web view.
            return .allow

        case AppConfig.customScheme:
            // Handled by `DeepLink` before it ever reaches WebKit.
            return .block

        case _ where Self.systemSchemes.contains(scheme):
            return .openInSystem(url)

        default:
            // Unknown scheme: let the system try (bank apps, `x-apple-*`, third-party helpers).
            return .openInSystem(url)
        }
    }
}
