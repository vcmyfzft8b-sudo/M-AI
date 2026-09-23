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
    /// One hour of tutor time, an Apple consumable. Never an entitlement.
    static let tutorHourProductID = "eu.memoai.tutor.hour"
    /**
     Where the app opens.

     `/onboarding` rather than `/auth/continue`, because it is the one entry
     point that knows what to do with everybody: a resumed session goes
     straight through to the app, a fresh install gets the survey, and a
     returning reader who signed out gets sign-in rather than twenty-three
     questions they have already answered. The page decides — the wrapper has
     no way to know which of the three it is holding.
     */
    static var startURL: URL { origin.appendingPathComponent("onboarding") }
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

    /// The plist also limits JavaScript injection and native message handlers.
    /// Preview builds must include their selected host at build time; disabling
    /// limitsNavigationsToAppBoundDomains does not bypass those restrictions.
    static var isAppBound: Bool {
        let hosts = Bundle.main.object(forInfoDictionaryKey: "WKAppBoundDomains") as? [String] ?? []
        return trustedOrigins.allSatisfy { hosts.contains($0.host ?? "") }
    }

    static func isInternal(_ url: URL) -> Bool {
        url.user == nil && url.password == nil && trustedOrigins.contains {
            url.scheme == $0.scheme && url.host == $0.host && url.port == $0.port
        }
    }
}
