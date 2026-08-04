import Foundation

enum AppConfig {
    static let productionURL = URL(string: "https://memoai.eu")!

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
