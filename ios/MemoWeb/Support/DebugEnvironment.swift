#if DEBUG
import Foundation

/// Which web app a Debug build is pointed at.
///
/// Working on the app used to mean waiting for a web change to reach production, because the
/// wrapper only ever loaded `MemoBaseURL` from `Info.plist`. This lets a build be repointed at a
/// dev server or a branch preview at runtime — shake the device to switch (`ShakeGesture`), or
/// pass `-MemoBaseURL <url>` as a launch argument.
///
/// Compiled out of Release entirely: a shipping app must never be repointable.
enum DebugEnvironment {
    private static let overrideKey = "MemoDebugBaseURL"

    /// Posted after a switch, so the scene can rebuild the root with the new server.
    static let didChange = Notification.Name("MemoDebugEnvironmentDidChange")

    /// A named destination in the switcher.
    struct Choice {
        let title: String
        let url: URL?   // nil means "back to the build's own MemoBaseURL"
    }

    /// The simulator shares the Mac's network, so `localhost` is the Mac. A physical device needs
    /// the Mac's LAN address instead — use Custom for that (`ios/scripts/run-local.sh` prints it).
    static var choices: [Choice] {
        [
            Choice(title: "Production", url: nil),
            Choice(title: "Local dev (:3000)", url: URL(string: "http://localhost:3000")),
            Choice(title: "Local dev (:3001)", url: URL(string: "http://localhost:3001")),
        ]
    }

    /// The active override, or `nil` when the build's own URL is in use.
    static var current: URL? {
        // A launch argument wins, so a scripted run is never surprised by a stored choice.
        if let argument = launchArgumentURL {
            return argument
        }

        guard
            let raw = UserDefaults.standard.string(forKey: overrideKey),
            let url = URL(string: raw)
        else { return nil }

        return url
    }

    private static var launchArgumentURL: URL? {
        guard
            let raw = UserDefaults.standard.string(forKey: "MemoBaseURL"),
            let url = URL(string: raw),
            url.scheme?.hasPrefix("http") == true
        else { return nil }

        return url
    }

    static func select(_ url: URL?) {
        if let url {
            UserDefaults.standard.set(url.absoluteString, forKey: overrideKey)
        } else {
            UserDefaults.standard.removeObject(forKey: overrideKey)
        }

        NotificationCenter.default.post(name: didChange, object: nil)
    }

    /// Whether a launch argument is pinning the environment, in which case the switcher would
    /// appear to do nothing and is better disabled.
    static var isPinnedByLaunchArgument: Bool { launchArgumentURL != nil }
}
#endif
