import XCTest
@testable import MemoWeb

final class AppConfigTests: XCTestCase {
    func testProductionURLUsesCanonicalSignInGateway() {
        XCTAssertEqual(AppConfig.productionURL.absoluteString, "https://memoai.eu/auth/continue")
    }

    func testCanonicalAndRedirectedHostsStayInsideApp() throws {
        XCTAssertTrue(AppConfig.isMemoURL(try XCTUnwrap(URL(string: "https://memoai.eu"))))
        XCTAssertTrue(AppConfig.isMemoURL(try XCTUnwrap(URL(string: "https://www.memoai.eu/auth/continue"))))
    }

    func testAuthenticationProvidersStayInsideWebSession() throws {
        XCTAssertTrue(AppConfig.isAuthenticationURL(try XCTUnwrap(URL(string: "https://accounts.google.com/o/oauth2/v2/auth"))))
        XCTAssertTrue(AppConfig.isAuthenticationURL(try XCTUnwrap(URL(string: "https://example.supabase.co/auth/v1/authorize"))))
    }

    func testMarketingRootIsAlwaysReplacedBySignInGateway() throws {
        let rootURL = try XCTUnwrap(URL(string: "https://memoai.eu/"))
        XCTAssertEqual(AppConfig.embeddedURL(for: rootURL), AppConfig.productionURL)

        let appURL = try XCTUnwrap(URL(string: "https://memoai.eu/app"))
        XCTAssertEqual(AppConfig.embeddedURL(for: appURL), appURL)
    }

    func testUserInitiatedExternalLinksOpenOutsideApp() throws {
        let externalURL = try XCTUnwrap(URL(string: "https://example.com/help"))
        XCTAssertTrue(AppConfig.shouldOpenExternally(externalURL, userInitiated: true))
        XCTAssertFalse(AppConfig.shouldOpenExternally(externalURL, userInitiated: false))
    }

    func testSystemSchemesOpenOutsideApp() throws {
        XCTAssertTrue(AppConfig.shouldOpenExternally(try XCTUnwrap(URL(string: "mailto:podpora@memoai.eu")), userInitiated: true))
        XCTAssertTrue(AppConfig.shouldOpenExternally(try XCTUnwrap(URL(string: "tel:+38612345678")), userInitiated: true))
    }
}
