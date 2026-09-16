import XCTest
import StoreKitTest

/// Tests the real native StoreKit adapter against Xcode's local store. This is
/// not proof of App Store Connect configuration or server entitlement delivery.
final class StoreOfferTests: XCTestCase {
    @MainActor func testIntroductoryPricesAndStaleQuote() throws {
        let config = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "Offers", withExtension: "storekit"))
        let session = try SKTestSession(contentsOf: config)
        session.resetToDefaultState()
        session.clearTransactions()
        session.disableDialogs = true
        session.storefront = "SVN"
        session.locale = Locale(identifier: "en_GB")
        defer { session.clearTransactions(); session.resetToDefaultState() }

        let app = XCUIApplication()
        let fixture = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "fixture-url", withExtension: "txt"))
        app.launchEnvironment["MEMO_IOS_URL"] = try String(contentsOf: fixture, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_GB"]
        app.launch()
        continueAfterFailure = false
        XCTAssertTrue(app.webViews.staticTexts["Native bridge ready"].waitForExistence(timeout: 30))
        app.webViews.buttons["Check Apple offers"].tap()
        let prices = app.webViews.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "introPrice")).firstMatch
        XCTAssertTrue(prices.waitForExistence(timeout: 15))
        let data = try XCTUnwrap(prices.label.data(using: .utf8))
        let products = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [[String: Any]])
        XCTAssertEqual(products.count, 4)
        for product in products {
            if (product["id"] as? String)?.contains(".trial.") == true {
                XCTAssertEqual(product["trialDays"] as? Int, 3, String(describing: product))
                XCTAssertNil(product["introPrice"])
                XCTAssertNotEqual(product["halfOff"] as? Bool, true)
                XCTAssertEqual(product["available"] as? Bool, true)
                continue
            }
            XCTAssertEqual(product["halfOff"] as? Bool, true, String(describing: product))
            XCTAssertEqual(product["available"] as? Bool, true)
            XCTAssertTrue((product["quote"] as? String)?.contains("intro:") == true)
            let yearly = product["id"] as? String == "eu.memoai.premium.yearly"
            XCTAssertTrue((product["introPrice"] as? String)?.contains(yearly ? "64.99" : "9.99") == true)
            XCTAssertTrue((product["price"] as? String)?.contains(yearly ? "129.99" : "19.99") == true)
        }
        app.webViews.buttons["Use stale price"].tap()
        XCTAssertTrue(app.webViews.staticTexts["priceChanged"].waitForExistence(timeout: 15))
        // priceChanged is returned before product.purchase. Do not assert on
        // allTransactions(): iOS 26.5 can return [] when its test-control API fails.
    }
}
