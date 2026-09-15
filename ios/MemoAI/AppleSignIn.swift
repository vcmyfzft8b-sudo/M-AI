import AuthenticationServices
import CryptoKit
import UIKit
import Security

/// Keep the authorization controller/delegate alive until Apple's sheet finishes.
/// The server supplies the nonce and verifies it before creating a web session.
@MainActor
final class AppleSignIn: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    private var continuation: CheckedContinuation<[String: String], Error>?
    private var controller: ASAuthorizationController?
    private var anchor: UIWindow?

    func authorize(nonce: String, window: UIWindow) async throws -> [String: String] {
        guard continuation == nil else { throw Store.StoreError.unavailable }
        anchor = window
        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.fullName, .email]
        request.nonce = SHA256.hash(data: Data(nonce.utf8)).map { String(format: "%02x", $0) }.joined()
        return try await withCheckedThrowingContinuation { pending in
            continuation = pending
            let authorization = ASAuthorizationController(authorizationRequests: [request])
            controller = authorization
            authorization.delegate = self
            authorization.presentationContextProvider = self
            authorization.performRequests()
        }
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        // Set by authorize before presenting the sheet, retained until completion.
        anchor!
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let identity = credential.identityToken.flatMap({ String(data: $0, encoding: .utf8) }),
              let code = credential.authorizationCode.flatMap({ String(data: $0, encoding: .utf8) }) else {
            finish(.failure(Store.StoreError.unavailable)); return
        }
        var result = ["identityToken": identity, "authorizationCode": code, "appleUserID": credential.user]
        if let name = credential.fullName {
            let formatted = PersonNameComponentsFormatter().string(from: name)
            if !formatted.isEmpty { result["fullName"] = formatted }
        }
        finish(.success(result))
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        if (error as? ASAuthorizationError)?.code == .canceled {
            finish(.success(["status": "cancelled"]))
        } else { finish(.failure(error)) }
    }

    private func finish(_ result: Result<[String: String], Error>) {
        let pending = continuation
        continuation = nil
        controller = nil
        anchor = nil
        pending?.resume(with: result)
    }

    private static var keychainQuery: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: "eu.memoai.memo.apple-sign-in",
         kSecAttrAccount as String: "current-user"]
    }
    static func currentUser() -> String? {
        var query = keychainQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
    static func setCurrentUser(_ user: String?) {
        SecItemDelete(keychainQuery as CFDictionary)
        guard let user else { return }
        var query = keychainQuery
        query[kSecValueData as String] = Data(user.utf8)
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(query as CFDictionary, nil)
    }
}
