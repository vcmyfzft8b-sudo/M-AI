import AuthenticationServices
import UIKit

/// Google disallows embedded web-view login. Keep the system browser session
/// alive and return only its PKCE code to the originating web-view cookie jar.
@MainActor
final class GoogleSignIn: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?
    private var anchor: UIWindow?

    func authorize(url: URL, state: String, window: UIWindow) async throws -> [String: String] {
        let hosts = AppConfiguration.origin == AppConfiguration.productionOrigin
            ? ["zrcwmhuwwvguiekzmcdj.supabase.co"] : ["yviipoccwsndxyrhtcjm.supabase.co"]
        guard session == nil, url.scheme == "https", hosts.contains(url.host ?? ""),
              url.user == nil, url.password == nil, url.port == nil,
              url.path == "/auth/v1/authorize", state.count == 64 else { throw Store.StoreError.unavailable }
        anchor = window
        return try await withCheckedThrowingContinuation { pending in
            let auth = ASWebAuthenticationSession(url: url, callbackURLScheme: "eu.memoai.memo.auth") { [weak self] callback, error in
                Task { @MainActor in
                    defer { self?.session = nil; self?.anchor = nil }
                    if (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin {
                        pending.resume(returning: ["status": "cancelled"]); return
                    }
                    guard error == nil, let callback,
                          callback.scheme == "eu.memoai.memo.auth", callback.host == "google",
                          callback.path == "/callback", callback.user == nil, callback.password == nil,
                          callback.port == nil, callback.fragment == nil,
                          let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems,
                          items.filter({ $0.name == "state" }).count == 1,
                          items.first(where: { $0.name == "state" })?.value == state,
                          items.filter({ $0.name == "code" }).count == 1,
                          let code = items.first(where: { $0.name == "code" })?.value,
                          !code.isEmpty, code.count <= 4096 else {
                        pending.resume(throwing: Store.StoreError.unavailable); return
                    }
                    pending.resume(returning: ["code": code, "state": state])
                }
            }
            session = auth
            auth.presentationContextProvider = self
            if !auth.start() {
                session = nil; anchor = nil
                pending.resume(throwing: Store.StoreError.unavailable)
            }
        }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor { anchor! }
}
