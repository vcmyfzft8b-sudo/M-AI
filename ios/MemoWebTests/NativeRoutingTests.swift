import XCTest

@testable import MemoWeb

final class NativeRoutingTests: XCTestCase {
    private let host = "memoai.eu"

    private func url(_ string: String) -> URL {
        guard let url = URL(string: string) else {
            preconditionFailure("bad test URL: \(string)")
        }
        return url
    }

    func testLaunchGoesStraightToTheProduct() {
        XCTAssertEqual(
            NativeRouting.startURL(baseURL: url("https://memoai.eu")).absoluteString,
            "https://memoai.eu/app"
        )
    }

    func testStartURLKeepsANonStandardOrigin() {
        // Debug builds point at a Vercel preview; the port and host must survive.
        XCTAssertEqual(
            NativeRouting.startURL(baseURL: url("http://localhost:3000")).absoluteString,
            "http://localhost:3000/app"
        )
    }

    func testLandingPageIsReplacedBySignIn() {
        // `/app` and `/auth/logout` both bounce a signed-out visitor to `/`.
        XCTAssertEqual(
            NativeRouting.redirectAwayFromLandingPage(url("https://memoai.eu/"), productHost: host)?.absoluteString,
            "https://memoai.eu/auth/continue"
        )
        XCTAssertEqual(
            NativeRouting.redirectAwayFromLandingPage(url("https://memoai.eu"), productHost: host)?.absoluteString,
            "https://memoai.eu/auth/continue"
        )
    }

    func testLandingPageQueryIsNotCarriedOver() {
        XCTAssertEqual(
            NativeRouting.redirectAwayFromLandingPage(url("https://memoai.eu/?ref=x#y"), productHost: host)?.absoluteString,
            "https://memoai.eu/auth/continue"
        )
    }

    func testSubdomainOfTheProductIsRewrittenToo() {
        XCTAssertEqual(
            NativeRouting.redirectAwayFromLandingPage(url("https://www.memoai.eu/"), productHost: host)?.absoluteString,
            "https://www.memoai.eu/auth/continue"
        )
    }

    func testRealPagesAreLeftAlone() {
        // Anything with a path renders as-is — no loop between /app, / and /auth/continue.
        XCTAssertNil(NativeRouting.redirectAwayFromLandingPage(url("https://memoai.eu/app"), productHost: host))
        XCTAssertNil(NativeRouting.redirectAwayFromLandingPage(url("https://memoai.eu/auth/continue"), productHost: host))
        XCTAssertNil(NativeRouting.redirectAwayFromLandingPage(url("https://memoai.eu/legal/privacy"), productHost: host))
    }

    // MARK: - Legal pages

    func testLegalPagesOpenInTheBrowser() {
        XCTAssertTrue(NativeRouting.opensInBrowser(url("https://memoai.eu/legal/terms-of-use"), productHost: host))
        XCTAssertTrue(NativeRouting.opensInBrowser(url("https://memoai.eu/legal/privacy-policy"), productHost: host))
        XCTAssertTrue(NativeRouting.opensInBrowser(url("https://memoai.eu/legal"), productHost: host))
    }

    func testProductPagesDoNotOpenInTheBrowser() {
        XCTAssertFalse(NativeRouting.opensInBrowser(url("https://memoai.eu/app"), productHost: host))
        XCTAssertFalse(NativeRouting.opensInBrowser(url("https://memoai.eu/auth/continue"), productHost: host))
        // Prefix matching must stop at a path boundary.
        XCTAssertFalse(NativeRouting.opensInBrowser(url("https://memoai.eu/legalese"), productHost: host))
    }

    func testForeignLegalPathsAreNotOurConcern() {
        // Off-host URLs are already routed by NavigationPolicy; this rule must not double-handle.
        XCTAssertFalse(NativeRouting.opensInBrowser(url("https://example.com/legal/terms"), productHost: host))
    }

    func testThirdPartyRootsAreLeftAlone() {
        // Rewriting an OAuth provider's root would break the sign-in redirect chain.
        XCTAssertNil(NativeRouting.redirectAwayFromLandingPage(url("https://accounts.google.com/"), productHost: host))
        XCTAssertNil(NativeRouting.redirectAwayFromLandingPage(url("https://memoai.eu.evil.com/"), productHost: host))
    }
}
