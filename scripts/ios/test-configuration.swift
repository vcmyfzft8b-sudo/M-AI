import Foundation

@main
struct ConfigurationChecks {
    static func main() throws {
        func trusts(_ url: String) -> Bool { AppConfiguration.isInternal(URL(string: url)!) }
        let expected = ProcessInfo.processInfo.environment["EXPECTED_MEMO_ORIGIN"] ?? "https://memoai.eu"
        precondition(AppConfiguration.origin.absoluteString == expected)
        precondition(trusts(expected + "/app"))
        precondition(!trusts("https://memoai.eu.attacker.example/app"))
        precondition(!trusts("https://other.vercel.app/app"))
        precondition(!trusts("https://user:pass@memoai.eu/app"))
        precondition(!trusts("http://memoai.eu/app"))
        if expected == "https://memoai.eu" {
            precondition(trusts("https://www.memoai.eu/app"))
        } else {
            precondition(!trusts("https://memoai.eu/app"))
            precondition(!trusts("https://www.memoai.eu/app"))
        }
        let origins = try JSONDecoder().decode([String].self, from: Data(AppConfiguration.trustedOriginsJSON.utf8))
        precondition(origins.allSatisfy { !$0.hasSuffix("/") })
        print("Trusted-origin checks passed: \(expected)")
    }
}
