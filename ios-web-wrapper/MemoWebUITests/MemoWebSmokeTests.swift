import XCTest

final class MemoWebSmokeTests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testProductionAppLoadsDirectSignInScreen() throws {
        let webView = launchApp()

        XCTAssertTrue(webView.staticTexts["Prijava"].waitForExistence(timeout: 30))
        XCTAssertTrue(webView.descendants(matching: .any)["Nadaljuj z e-pošto"].exists)
        XCTAssertFalse(
            webView.staticTexts["Nikoli več ne piši zapiskov!"].exists,
            "The iOS app must not show the marketing landing page before sign-in."
        )
    }

    func testThirdPartySignInMeetsAppleLoginRequirement() throws {
        let webView = launchApp()
        XCTAssertTrue(webView.staticTexts["Prijava"].waitForExistence(timeout: 30))

        let googleButton = webView.buttons["Nadaljuj z Google"]
        let appleButton = webView.buttons["Nadaljuj z Apple"]
        XCTAssertTrue(
            appleButton.exists || !googleButton.exists,
            "Google must be hidden in the iOS wrapper until Sign in with Apple is available."
        )
    }

    private func launchApp() -> XCUIElement {
        let app = XCUIApplication()
        app.launch()

        let webView = app.webViews["MemoWebView"]
        XCTAssertTrue(webView.waitForExistence(timeout: 30), "The embedded web app did not load.")
        return webView
    }
}
