import Foundation

enum AppConfig {
    // The auth gateway redirects an existing session to /app and otherwise
    // renders the sign-in screen. The marketing landing page is never shown.
    static let productionURL = URL(string: "https://memoai.eu/auth/continue")!

    private static let memoHosts: Set<String> = [
        "memoai.eu",
        "www.memoai.eu"
    ]

    private static let authenticationHosts: Set<String> = [
        "accounts.google.com",
        "appleid.apple.com"
    ]

    static func isMemoURL(_ url: URL) -> Bool {
        guard let host = url.host?.lowercased() else { return false }
        return memoHosts.contains(host)
    }

    static func isAuthenticationURL(_ url: URL) -> Bool {
        guard let host = url.host?.lowercased() else { return false }
        return authenticationHosts.contains(host)
            || host.hasSuffix(".supabase.co")
            || host.hasSuffix(".supabase.com")
    }

    static func embeddedURL(for url: URL) -> URL {
        guard isMemoURL(url), url.path.isEmpty || url.path == "/" else {
            return url
        }

        return productionURL
    }

    static func shouldOpenExternally(_ url: URL, userInitiated: Bool) -> Bool {
        guard let scheme = url.scheme?.lowercased() else { return true }

        if scheme != "http" && scheme != "https" {
            return true
        }

        if isMemoURL(url) || isAuthenticationURL(url) {
            return false
        }

        return userInitiated
    }
}
