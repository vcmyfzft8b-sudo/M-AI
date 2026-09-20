import Foundation

enum AppConfiguration {
    /**
     The origin the app opens, which is the `www` alias rather than the apex.

     `memoai.eu` is the canonical domain and it answers every request with a 307
     to `www`, so the app has always ended up here — it just arrived via a
     redirect. That was invisible until offline mode: a service worker belongs
     to one origin, so the one the app registers is `www`'s, and a launch with
     no connection was still asking for the apex. Nothing is registered there,
     nothing could intercept the navigation, and the app fell back to its native
     "could not connect" screen with a whole cached library sitting behind it.

     Opening `www` directly also saves a redirect on every cold launch, and
     sidesteps the apex dropping `Authorization` on the way through.
     */
    static let productionOrigin = URL(string: "https://www.memoai.eu")!

    /// The canonical domain, which redirects here. Trusted, never opened.
    static let productionApex = URL(string: "https://memoai.eu")!
    static let origin: URL = {
        #if DEBUG
        if let value = ProcessInfo.processInfo.environment["MEMO_IOS_URL"],
           let url = URL(string: value),
           url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
           (url.path.isEmpty || url.path == "/"),
           /*
            * `https` is accepted for localhost as well as for previews, and it
            * is not redundant: a service worker only runs in a secure context,
            * and WKWebView does not extend that courtesy to `http://localhost`
            * the way browsers do — it registers nothing at all. Offline mode is
            * a service worker, so plain `http` cannot exercise it. Serve the
            * local build over TLS and trust the certificate in the simulator
            * (`xcrun simctl keychain <udid> add-root-cert`); see docs/ios-app.md.
            */
           (url.scheme == "https" && url.host?.hasSuffix(".vercel.app") == true
            || ["https", "http"].contains(url.scheme ?? "")
               && ["localhost", "127.0.0.1"].contains(url.host ?? "")) {
            return url
        }
        #endif
        return productionOrigin
    }()
    static let productIDs = ["eu.memoai.premium.monthly", "eu.memoai.premium.yearly",
                             "eu.memoai.premium.trial.monthly", "eu.memoai.premium.trial.yearly"]
    // The auth page resumes an existing session into /app. A fresh install must
    // open sign-in directly, without relying on a marketing-page redirect.
    static var startURL: URL { origin.appendingPathComponent("auth/continue") }
    // Both production hosts are internal — a link to the canonical domain, or a
    // redirect arriving from it, must not be treated as leaving the app.
    // Preview builds trust only their explicitly selected origin.
    static var trustedOrigins: [URL] {
        origin == productionOrigin ? [productionOrigin, productionApex] : [origin]
    }
    static var trustedOriginsJSON: String {
        String(data: try! JSONEncoder().encode(trustedOrigins.map {
            $0.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        }), encoding: .utf8)!
    }

    /**
     Whether every trusted origin is in `WKAppBoundDomains`.

     Only then may the web view opt into the app-bound restriction, which is
     what lets a service worker run — and so what makes offline mode possible.
     A Vercel preview's host is generated per deployment and cannot be in a
     static list, so a preview build stays unrestricted and has no worker.
     */
    static var isAppBound: Bool {
        trustedOrigins.allSatisfy { ["memoai.eu", "www.memoai.eu", "localhost"].contains($0.host ?? "") }
    }

    static func isInternal(_ url: URL) -> Bool {
        url.user == nil && url.password == nil && trustedOrigins.contains {
            url.scheme == $0.scheme && url.host == $0.host && url.port == $0.port
        }
    }
}
