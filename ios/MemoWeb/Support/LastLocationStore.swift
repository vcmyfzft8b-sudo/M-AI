import Foundation

/// Remembers the last in-app page so a cold launch resumes where the user left off rather than
/// dumping them back on the home screen.
struct LastLocationStore {
    private enum Key {
        static let url = "MemoLastLocationURL"
        static let savedAt = "MemoLastLocationSavedAt"
    }

    /// After this long the saved page is stale enough that the home screen is the better landing.
    private let maximumAge: TimeInterval = 60 * 60 * 24 * 7
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func save(_ url: URL) {
        // Auth pages are mid-flow states; resuming into one strands the user on a dead callback.
        guard !url.path.hasPrefix("/auth") else { return }

        // The landing page is never a destination in the app (see `NativeRouting`).
        guard !url.path.isEmpty, url.path != "/" else { return }

        defaults.set(url.absoluteString, forKey: Key.url)
        defaults.set(Date().timeIntervalSince1970, forKey: Key.savedAt)
    }

    /// - Parameter host: the host the app is currently pointed at. A location saved against a
    ///   different one is discarded — otherwise repointing the build (at a dev server, a preview,
    ///   or a renamed production domain) would resurrect the previous server on the next launch.
    func restore(matching policy: NavigationPolicy, host: String) -> URL? {
        guard
            let raw = defaults.string(forKey: Key.url),
            let url = URL(string: raw),
            url.host?.lowercased() == host.lowercased(),
            policy.isInAppHost(url)
        else { return nil }

        let savedAt = defaults.double(forKey: Key.savedAt)
        guard savedAt > 0, Date().timeIntervalSince1970 - savedAt < maximumAge else { return nil }

        return url
    }

    func clear() {
        defaults.removeObject(forKey: Key.url)
        defaults.removeObject(forKey: Key.savedAt)
    }
}
