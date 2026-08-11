import Foundation

/// Translates inbound links into a URL the web view can load.
///
/// Two entry points are supported:
///
/// * `memo://` custom-scheme links, which work with no server-side setup. `memo://lectures/42`
///   and `memo:///app/lectures/42` both resolve to `<base>/app/lectures/42`.
/// * Universal links on the product domain, once the Associated Domains capability and the
///   server's `apple-app-site-association` file are in place (see `ios/README.md`).
enum DeepLink {
    static func resolve(_ url: URL, baseURL: URL = AppConfig.baseURL) -> URL? {
        guard let scheme = url.scheme?.lowercased() else { return nil }

        if scheme == "http" || scheme == "https" {
            let policy = NavigationPolicy(allowedDomains: [baseURL.host ?? ""])
            return policy.isInAppHost(url) ? url : nil
        }

        guard scheme == AppConfig.customScheme else { return nil }

        // `memo://lectures/42` parses the first segment as the host, `memo:///app/x` does not.
        var path = url.path
        if let host = url.host, !host.isEmpty {
            path = "/\(host)\(path)"
        }
        if path.isEmpty || path == "/" {
            path = "/app"
        }

        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)
        components?.path = path
        components?.query = url.query
        components?.fragment = url.fragment
        return components?.url
    }
}
