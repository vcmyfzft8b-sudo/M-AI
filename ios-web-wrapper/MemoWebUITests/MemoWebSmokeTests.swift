import XCTest

final class MemoWebSmokeTests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testProductionAppLoadsSignInFlow() throws {
        let webView = launchSignInFlow()

        XCTAssertTrue(webView.staticTexts["Prijava"].waitForExistence(timeout: 30))
        XCTAssertTrue(webView.buttons["Nadaljuj z Google"].exists)
        XCTAssertTrue(webView.descendants(matching: .any)["Nadaljuj z e-pošto"].exists)
    }

    func testGoogleOAuthStartsWithoutEmbeddedBrowserError() throws {
        let webView = launchSignInFlow()
        let googleButton = webView.buttons["Nadaljuj z Google"]
        XCTAssertTrue(googleButton.waitForExistence(timeout: 30))
        googleButton.tap()

        XCTAssertFalse(
            googleButton.waitForExistence(timeout: 15),
            "Google authentication did not leave the Memo sign-in page."
        )

        let embeddedBrowserError = webView.descendants(matching: .any).matching(
            NSPredicate(format: "label CONTAINS[c] %@", "disallowed_useragent")
        ).firstMatch
        XCTAssertFalse(embeddedBrowserError.exists, "Google rejected the embedded authentication session.")
    }

    private func launchSignInFlow() -> XCUIElement {
        let app = XCUIApplication()
        app.launch()

        let webView = app.webViews["MemoWebView"]
        XCTAssertTrue(webView.waitForExistence(timeout: 30), "The embedded web app did not load.")

        let signInLink = webView.links["Prijavi se"]
        let freeTrialLink = webView.links["Preizkusi za 0 €"]
        if signInLink.waitForExistence(timeout: 20) {
            signInLink.tap()
        } else {
            XCTAssertTrue(freeTrialLink.waitForExistence(timeout: 5), "No sign-in entry point was visible.")
            freeTrialLink.tap()
        }

        XCTAssertTrue(webView.staticTexts["Prijava"].waitForExistence(timeout: 30))
        return webView
    }
}
