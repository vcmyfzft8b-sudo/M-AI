import XCTest

@testable import MemoWeb

final class DeepLinkTests: XCTestCase {
    private let base = URL(string: "https://memoai.eu")!

    func testCustomSchemeWithHostSegment() {
        // `memo://lectures/42` parses "lectures" as the host, not as the first path component.
        XCTAssertEqual(
            DeepLink.resolve(URL(string: "memo://lectures/42")!, baseURL: base)?.absoluteString,
            "https://memoai.eu/lectures/42"
        )
    }

    func testCustomSchemeWithLeadingSlashes() {
        XCTAssertEqual(
            DeepLink.resolve(URL(string: "memo:///app/lectures/42")!, baseURL: base)?.absoluteString,
            "https://memoai.eu/app/lectures/42"
        )
    }

    func testCustomSchemeQueryAndFragmentSurvive() {
        XCTAssertEqual(
            DeepLink.resolve(URL(string: "memo://app?tab=quiz#top")!, baseURL: base)?.absoluteString,
            "https://memoai.eu/app?tab=quiz#top"
        )
    }

    func testBareCustomSchemeLandsOnTheAppHome() {
        XCTAssertEqual(
            DeepLink.resolve(URL(string: "memo://")!, baseURL: base)?.absoluteString,
            "https://memoai.eu/app"
        )
    }

    func testUniversalLinkOnOurDomainPassesThrough() {
        XCTAssertEqual(
            DeepLink.resolve(URL(string: "https://memoai.eu/app/lectures/7")!, baseURL: base)?.absoluteString,
            "https://memoai.eu/app/lectures/7"
        )
    }

    func testForeignHttpsLinkIsRejected() {
        XCTAssertNil(DeepLink.resolve(URL(string: "https://example.com/app")!, baseURL: base))
    }

    func testUnknownSchemeIsRejected() {
        XCTAssertNil(DeepLink.resolve(URL(string: "other://app")!, baseURL: base))
    }
}
