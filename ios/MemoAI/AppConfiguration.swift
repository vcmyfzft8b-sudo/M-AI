import Foundation

enum AppConfiguration {
    static let productionOrigin = URL(string: "https://memoai.eu")!
    static let origin: URL = {
        #if DEBUG
        if let value = ProcessInfo.processInfo.environment["MEMO_IOS_URL"],
           let url = URL(string: value),
           url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
           (url.path.isEmpty || url.path == "/"),
           (url.scheme == "https" && url.host?.hasSuffix(".vercel.app") == true
            || url.scheme == "http" && ["localhost", "127.0.0.1"].contains(url.host ?? "")) {
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
    // The canonical domain currently redirects to its www alias in production.
    // Preview builds trust only their explicitly selected origin.
    static var trustedOrigins: [URL] {
        origin == productionOrigin ? [productionOrigin, URL(string: "https://www.memoai.eu")!] : [origin]
    }
    static var trustedOriginsJSON: String {
        String(data: try! JSONEncoder().encode(trustedOrigins.map {
            $0.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        }), encoding: .utf8)!
    }

    static func isInternal(_ url: URL) -> Bool {
        url.user == nil && url.password == nil && trustedOrigins.contains {
            url.scheme == $0.scheme && url.host == $0.host && url.port == $0.port
        }
    }
}
