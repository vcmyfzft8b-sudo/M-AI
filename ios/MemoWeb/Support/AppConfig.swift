import Foundation

/// Static configuration for the web wrapper.
///
/// The production URL lives in `Support/Info.plist` under `MemoBaseURL` so a build can be
/// retargeted (for example at a Vercel preview) without touching code. Debug builds may also
/// override it at runtime with the `-MemoBaseURL <url>` launch argument.
enum AppConfig {
    /// Computed rather than stored, so the Debug environment switcher can repoint a running app
    /// without a rebuild.
    static var baseURL: URL {
        #if DEBUG
        if let override = DebugEnvironment.current {
            return override
        }
        #endif

        return productionURL
    }

    /// The URL baked into this build, ignoring any Debug override.
    static var productionURL: URL {
        guard
            let raw = Bundle.main.object(forInfoDictionaryKey: "MemoBaseURL") as? String,
            let url = URL(string: raw)
        else {
            preconditionFailure("MemoBaseURL is missing or malformed in Info.plist")
        }
        return url
    }

    /// Custom scheme registered in `Info.plist`, used for `memo://` deep links.
    static let customScheme = "memo"

    /// The product's own host, as distinct from the auth and payment hosts we also allow in-app.
    static var productHost: String { baseURL.host ?? "memoai.eu" }

    static var appVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
    }

    static var buildNumber: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0"
    }

    /// Appended to the WKWebView user agent.
    ///
    /// WKWebView's stock user agent omits the `Version/` and `Safari/` tokens that mobile Safari
    /// sends, which makes server- and client-side sniffing treat the wrapper as an unknown
    /// browser. Restoring them keeps the web app on exactly the code path it uses in Safari, and
    /// the trailing `MemoiOS/` token lets the web app detect the native shell.
    static var userAgentApplicationName: String {
        "Version/\(ProcessInfo.processInfo.operatingSystemVersion.majorVersion).0 Safari/604.1 MemoiOS/\(appVersion)"
    }

    /// Hosts whose pages are allowed to render inside the wrapper.
    ///
    /// Anything else opens in `SFSafariViewController` so users keep Safari's address bar and
    /// trust indicators for third-party content.
    static let inAppDomains: Set<String> = [
        // The product itself.
        "memoai.eu",

        // Supabase auth + storage.
        "supabase.co",
        "supabase.in",

        // Google sign-in.
        "accounts.google.com",
        "accounts.youtube.com",
        "apis.google.com",
        "googleusercontent.com",
        "googleapis.com",
        "gstatic.com",

        // Sign in with Apple.
        "appleid.apple.com",
        "apple.com",
        "cdn-apple.com",

        // Stripe checkout and billing portal.
        "stripe.com",
        "stripe.network",

        // Bot / abuse challenges that can appear mid-flow.
        "recaptcha.net",
        "hcaptcha.com",
    ]

    /// Extra domains accepted only in Debug, so a build can be pointed at a Vercel preview.
    static let debugOnlyDomains: Set<String> = ["vercel.app", "vercel.com"]

    static var allowedDomains: Set<String> {
        // Whatever `MemoBaseURL` points at is by definition in-app. Without this, repointing the
        // build at a preview host would send the app's own start URL to Safari.
        var domains = inAppDomains
        domains.insert(productHost)

        #if DEBUG
        domains.formUnion(debugOnlyDomains)
        #endif

        return domains
    }
}
