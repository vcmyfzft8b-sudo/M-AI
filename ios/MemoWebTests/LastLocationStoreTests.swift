import XCTest

@testable import MemoWeb

final class LastLocationStoreTests: XCTestCase {
    private var defaults: UserDefaults!
    private var store: LastLocationStore!
    private let policy = NavigationPolicy(allowedDomains: ["memoai.eu", "localhost"])

    override func setUp() {
        super.setUp()
        // A throwaway suite, so these tests never disturb the real app's stored location.
        defaults = UserDefaults(suiteName: "LastLocationStoreTests")!
        defaults.removePersistentDomain(forName: "LastLocationStoreTests")
        store = LastLocationStore(defaults: defaults)
    }

    private func url(_ string: String) -> URL {
        guard let url = URL(string: string) else { preconditionFailure("bad test URL") }
        return url
    }

    func testRoundTrips() {
        store.save(url("https://memoai.eu/app/lectures/7"))

        XCTAssertEqual(
            store.restore(matching: policy, host: "memoai.eu")?.absoluteString,
            "https://memoai.eu/app/lectures/7"
        )
    }

    func testLocationFromAnotherServerIsDiscarded() {
        // Repointing a Debug build at a dev server must not resurrect the production page —
        // the app would silently load the wrong server on the next launch.
        store.save(url("https://memoai.eu/app/lectures/7"))

        XCTAssertNil(store.restore(matching: policy, host: "localhost"))
    }

    func testAuthPagesAreNotSaved() {
        // Resuming into a half-finished sign-in strands the user on a dead callback.
        store.save(url("https://memoai.eu/auth/continue"))

        XCTAssertNil(store.restore(matching: policy, host: "memoai.eu"))
    }

    func testLandingPageIsNotSaved() {
        store.save(url("https://memoai.eu/"))

        XCTAssertNil(store.restore(matching: policy, host: "memoai.eu"))
    }

    func testStaleLocationIsDiscarded() {
        store.save(url("https://memoai.eu/app"))
        // Eight days ago — past the one-week window.
        defaults.set(
            Date().timeIntervalSince1970 - (60 * 60 * 24 * 8),
            forKey: "MemoLastLocationSavedAt"
        )

        XCTAssertNil(store.restore(matching: policy, host: "memoai.eu"))
    }

    func testHostComparisonIgnoresCase() {
        store.save(url("https://MemoAI.eu/app"))

        XCTAssertNotNil(store.restore(matching: policy, host: "memoai.eu"))
    }
}
