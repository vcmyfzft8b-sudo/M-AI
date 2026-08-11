import XCTest

@testable import MemoWeb

final class NavigationPolicyTests: XCTestCase {
    private let policy = NavigationPolicy(allowedDomains: ["memoai.eu", "accounts.google.com"])

    private func url(_ string: String) -> URL {
        guard let url = URL(string: string) else {
            preconditionFailure("bad test URL: \(string)")
        }
        return url
    }

    // MARK: - In-app hosts

    func testProductPagesStayInApp() {
        XCTAssertEqual(policy.decide(for: url("https://memoai.eu/app"), isMainFrame: true), .allow)
        XCTAssertEqual(policy.decide(for: url("https://www.memoai.eu/app/lectures/1"), isMainFrame: true), .allow)
    }

    func testOAuthProviderStaysInApp() {
        XCTAssertEqual(
            policy.decide(for: url("https://accounts.google.com/o/oauth2/v2/auth?client_id=x"), isMainFrame: true),
            .allow
        )
    }

    func testLookalikeDomainIsNotTreatedAsOurs() {
        // Suffix matching must be on a label boundary, or `memoai.eu.evil.com` would pass.
        let target = url("https://memoai.eu.evil.com/app")
        XCTAssertEqual(policy.decide(for: target, isMainFrame: true), .openInBrowser(target))

        let prefixed = url("https://notmemoai.eu/app")
        XCTAssertEqual(policy.decide(for: prefixed, isMainFrame: true), .openInBrowser(prefixed))
    }

    func testHostMatchingIsCaseInsensitive() {
        XCTAssertTrue(policy.isInAppHost(url("https://MemoAI.EU/app")))
    }

    func testConfiguredBaseHostIsAlwaysInApp() {
        // Repointing MemoBaseURL at a preview or a local server must not send the app's own
        // start URL to Safari.
        XCTAssertTrue(AppConfig.allowedDomains.contains(AppConfig.productHost))

        let live = NavigationPolicy(allowedDomains: AppConfig.allowedDomains)
        XCTAssertEqual(live.decide(for: NativeRouting.startURL(), isMainFrame: true), .allow)
    }

    // MARK: - Off-domain

    func testThirdPartyLinkGoesToSafari() {
        let target = url("https://wikipedia.org/wiki/Memo")
        XCTAssertEqual(policy.decide(for: target, isMainFrame: true), .openInBrowser(target))
    }

    func testSubFrameLoadsAreAlwaysAllowed() {
        // Stripe, reCAPTCHA and embedded players load in iframes and must never be diverted.
        XCTAssertEqual(policy.decide(for: url("https://js.stripe.com/v3"), isMainFrame: false), .allow)
        XCTAssertEqual(policy.decide(for: url("https://wikipedia.org"), isMainFrame: false), .allow)
    }

    // MARK: - Non-web schemes

    func testMailAndTelephoneGoToTheSystem() {
        let mail = url("mailto:info@memoai.eu")
        XCTAssertEqual(policy.decide(for: mail, isMainFrame: true), .openInSystem(mail))

        let tel = url("tel:+38612345678")
        XCTAssertEqual(policy.decide(for: tel, isMainFrame: true), .openInSystem(tel))
    }

    func testWebKitInternalSchemesAreAllowed() {
        XCTAssertEqual(policy.decide(for: url("about:blank"), isMainFrame: true), .allow)
        XCTAssertEqual(policy.decide(for: url("blob:https://memoai.eu/abc"), isMainFrame: true), .allow)
    }

    func testOwnCustomSchemeIsNotHandedBackToWebKit() {
        // `memo://` is resolved by DeepLink before WebKit ever sees it.
        XCTAssertEqual(policy.decide(for: url("memo://app/lectures/1"), isMainFrame: true), .block)
    }
}
