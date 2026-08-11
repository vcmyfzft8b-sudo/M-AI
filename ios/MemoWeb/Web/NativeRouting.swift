import Foundation

/// Entry-point routing for the native shell.
///
/// The web app serves a marketing landing page at `/`, which someone who has already installed
/// the app has no reason to see. The wrapper therefore opens straight into the product, and
/// rewrites any navigation that would land on the landing page.
///
/// This matters more than cosmetics: `/app` redirects a signed-out visitor to `/` (see
/// `requireUser()` in `src/lib/auth.ts`), and so does `/auth/logout`. Without the rewrite the app
/// would drop the user on marketing copy every time their session expired.
enum NativeRouting {
    /// Where a launch with no restored location goes.
    static let startPath = "/app"

    /// Where a redirect to the landing page goes instead.
    ///
    /// `/auth/continue` is the entry point every landing-page call to action uses on the web, and
    /// it sends an already-signed-in visitor on to `/app`, so it can never loop with `startPath`.
    static let signInPath = "/auth/continue"

    static func startURL(baseURL: URL = AppConfig.baseURL) -> URL {
        url(path: startPath, basedOn: baseURL)
    }

    /// Returns a replacement URL when `url` would render the marketing landing page, else `nil`.
    ///
    /// Only the product's own host is rewritten — a third-party root such as
    /// `https://accounts.google.com/` must be left exactly as the provider sent it.
    static func redirectAwayFromLandingPage(_ url: URL, productHost: String) -> URL? {
        guard let host = url.host?.lowercased() else { return nil }

        let productHost = productHost.lowercased()
        guard host == productHost || host.hasSuffix(".\(productHost)") else { return nil }

        // Query and fragment are dropped with the path: nothing on `/` is worth carrying over,
        // and `?next=` style parameters are re-derived by the sign-in page itself.
        guard url.path.isEmpty || url.path == "/" else { return nil }

        return self.url(path: signInPath, basedOn: url)
    }

    /// Rebuilds `base` with a different path, preserving scheme, host and port.
    private static func url(path: String, basedOn base: URL) -> URL {
        guard var components = URLComponents(url: base, resolvingAgainstBaseURL: false) else {
            return base
        }
        components.path = path
        components.query = nil
        components.fragment = nil
        return components.url ?? base
    }
}
