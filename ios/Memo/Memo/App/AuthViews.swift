import AuthenticationServices
import SwiftUI

// Native recreation of the web auth flow:
// /auth/continue (provider chooser) -> /auth/email-entry -> /auth/check-email (OTP code).

enum AuthStep: Equatable {
    case chooser
    case emailEntry
    case codeEntry(email: String)
}

struct AuthFlowView: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.memoTheme) private var theme
    @State private var step: AuthStep = .chooser

    var body: some View {
        ZStack {
            theme.canvas.ignoresSafeArea()
            switch step {
            case .chooser:
                AuthChooserView(step: $step)
                    .transition(.opacity)
            case .emailEntry:
                EmailEntryView(step: $step)
                    .transition(.move(edge: .trailing).combined(with: .opacity))
            case .codeEntry(let email):
                CheckEmailView(step: $step, email: email)
                    .transition(.move(edge: .trailing).combined(with: .opacity))
            }
        }
        .animation(.easeOut(duration: 0.24), value: step)
    }
}

/// Web /auth/continue — "Prijava" with the three provider buttons.
struct AuthChooserView: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.memoTheme) private var theme
    @Binding var step: AuthStep
    @StateObject private var appleCoordinator = AppleSignInCoordinator()
    @State private var pendingProvider: String?

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 24)
            BrandLogo(size: 92)
                .padding(.bottom, 28)

            Text("Prijava")
                .font(.system(size: 40, weight: .bold))
                .tracking(-1.5)
                .foregroundStyle(theme.label)
            Text("Prijavi se ali ustvari nov račun.")
                .font(.system(size: 16))
                .foregroundStyle(theme.secondaryLabel)
                .padding(.top, 6)

            Spacer(minLength: 24)

            VStack(spacing: 13) {
                Button {
                    signInWithGoogle()
                } label: {
                    HStack(spacing: 10) {
                        if pendingProvider == "google" {
                            ProgressView()
                            Text("Preusmerjam...")
                        } else {
                            GoogleMark(size: 20)
                            Text("Nadaljuj z Google")
                        }
                    }
                }
                .buttonStyle(MemoSecondaryButtonStyle(minHeight: 66, cornerRadius: 18))

                Button {
                    signInWithApple()
                } label: {
                    HStack(spacing: 10) {
                        if pendingProvider == "apple" {
                            ProgressView()
                                .tint(theme.canvas)
                        } else {
                            Image(systemName: "apple.logo")
                                .font(.system(size: 20, weight: .medium))
                        }
                        Text("Nadaljuj z Apple")
                    }
                }
                .buttonStyle(MemoInvertedButtonStyle(minHeight: 66, cornerRadius: 18))

                Button {
                    step = .emailEntry
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "envelope.fill")
                            .font(.system(size: 17, weight: .medium))
                        Text("Nadaljuj z e-pošto")
                    }
                }
                .buttonStyle(MemoInvertedButtonStyle(minHeight: 66, cornerRadius: 18))
            }
            .disabled(pendingProvider != nil)

            if let error = appModel.errorMessage {
                MemoBanner(kind: .error, message: error)
                    .padding(.top, 14)
            }

            Spacer(minLength: 20)

            AuthLegalText(configuration: appModel.configuration)
                .padding(.bottom, 8)
        }
        .padding(.horizontal, 24)
        .onChange(of: appModel.isSignedIn) {
            pendingProvider = nil
        }
    }

    private func signInWithGoogle() {
        pendingProvider = "google"
        Task {
            await appModel.signInWithGoogle()
            pendingProvider = nil
        }
    }

    private func signInWithApple() {
        pendingProvider = "apple"
        appleCoordinator.start { result in
            Task { @MainActor in
                switch result {
                case .success(let credential):
                    await appModel.signInWithApple(
                        identityToken: credential.identityToken,
                        nonce: credential.nonce
                    )
                case .failure(let error):
                    if !(error is CancellationError) {
                        appModel.errorMessage = error.localizedDescription
                    }
                }
                pendingProvider = nil
            }
        }
    }
}

/// Web /auth/email-entry — "Kateri je tvoj e-naslov?"
struct EmailEntryView: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.memoTheme) private var theme
    @Binding var step: AuthStep
    @State private var email = ""
    @State private var isSubmitting = false
    @FocusState private var focused: Bool

    private var isValidEmail: Bool {
        let trimmed = email.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.contains("@") && trimmed.contains(".") && trimmed.count >= 5
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            MemoBackButton {
                step = .chooser
            }
            .padding(.top, 8)

            Spacer(minLength: 12)

            HStack {
                Spacer()
                BrandLogo(size: 76)
                Spacer()
            }
            .padding(.bottom, 30)

            Text("Kateri je tvoj e-naslov?")
                .font(.system(size: 32, weight: .bold))
                .tracking(-1)
                .foregroundStyle(theme.label)
            Text("Vnesi svoj e-naslov in poslali ti bomo potrditveno kodo.")
                .font(.system(size: 16))
                .foregroundStyle(theme.secondaryLabel)
                .padding(.top, 8)

            TextField("Vnesi e-naslov", text: $email)
                .textContentType(.emailAddress)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .focused($focused)
                .font(.system(size: 18))
                .memoField(minHeight: 66, cornerRadius: 18, tinted: true)
                .padding(.top, 24)
                .disabled(isSubmitting)
                .onSubmit(submit)

            Button(action: submit) {
                if isSubmitting {
                    HStack(spacing: 8) {
                        ProgressView().tint(.white)
                        Text("Pošiljam kodo...")
                    }
                } else {
                    Text("Nadaljuj")
                }
            }
            .buttonStyle(MemoPrimaryButtonStyle(
                minHeight: 66,
                cornerRadius: 18,
                fill: Color(hex: 0x4D58EA)
            ))
            .disabled(!isValidEmail || isSubmitting)
            .padding(.top, 12)

            if let error = appModel.errorMessage {
                MemoBanner(kind: .error, message: error)
                    .padding(.top, 14)
            }

            Spacer()
        }
        .padding(.horizontal, 24)
        .onAppear {
            appModel.errorMessage = nil
            focused = true
        }
    }

    private func submit() {
        guard isValidEmail, !isSubmitting else {
            return
        }
        let trimmed = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        isSubmitting = true
        Task {
            await appModel.sendEmailCode(to: trimmed)
            isSubmitting = false
            if appModel.errorMessage == nil {
                step = .codeEntry(email: trimmed)
            }
        }
    }
}

/// Web /auth/check-email — "Vnesi kodo" OTP entry.
struct CheckEmailView: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.memoTheme) private var theme
    @Binding var step: AuthStep
    let email: String

    @State private var code = ""
    @State private var isVerifying = false
    @State private var isResending = false
    @State private var cooldown = 60
    @State private var cooldownTimer: Timer?
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Spacer()
                MemoBackButton {
                    step = .emailEntry
                }
            }
            .padding(.top, 8)

            HStack {
                Spacer()
                BrandLogo(size: 66)
                Spacer()
            }
            .padding(.top, 8)
            .padding(.bottom, 26)

            Text("PREVERI E-POŠTO")
                .font(.system(size: 13, weight: .bold))
                .tracking(2.2)
                .foregroundStyle(theme.tint)
            Text("Vnesi kodo")
                .font(.system(size: 48, weight: .bold))
                .tracking(-2.5)
                .foregroundStyle(theme.label)
                .padding(.top, 4)
            Text(introText)
                .font(.system(size: 15))
                .foregroundStyle(theme.secondaryLabel)
                .padding(.top, 8)

            TextField("Vnesi kodo", text: $code)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .focused($focused)
                .font(.system(size: 24, weight: .semibold, design: .monospaced))
                .tracking(6)
                .multilineTextAlignment(.center)
                .memoField(minHeight: 74, cornerRadius: 22, tinted: true)
                .padding(.top, 24)
                .disabled(isVerifying)
                .onChange(of: code) {
                    code = String(code.filter(\.isNumber).prefix(8))
                    if code.count >= 6 {
                        // Let users submit manually; 6 is min, up to 8 allowed.
                    }
                }

            Button(action: verify) {
                if isVerifying {
                    HStack(spacing: 8) {
                        ProgressView().tint(.white)
                        Text("Preverjam...")
                    }
                } else {
                    Text("Nadaljuj")
                        .font(.system(size: 18, weight: .bold))
                }
            }
            .buttonStyle(MemoPrimaryButtonStyle(minHeight: 62, cornerRadius: 22))
            .disabled(code.count < 6 || isVerifying)
            .padding(.top, 12)

            if let error = appModel.errorMessage {
                MemoBanner(kind: .error, message: error)
                    .padding(.top, 12)
            } else {
                Text("Koda velja 5 minut. Če zahtevaš novo, uporabi samo najnovejšo kodo.")
                    .font(.system(size: 13))
                    .foregroundStyle(theme.secondaryLabel)
                    .padding(.top, 12)
            }

            VStack(spacing: 10) {
                Button(action: resend) {
                    if isResending {
                        HStack(spacing: 8) {
                            ProgressView()
                            Text("Pošiljam...")
                        }
                    } else if cooldown > 0 {
                        Text("Novo kodo pošlji čez \(cooldown / 60):\(String(format: "%02d", cooldown % 60))")
                    } else {
                        Text("Pošlji novo kodo")
                    }
                }
                .buttonStyle(MemoSecondaryButtonStyle(minHeight: 58, cornerRadius: 18))
                .disabled(cooldown > 0 || isResending || isVerifying)

                Button {
                    step = .chooser
                } label: {
                    Text("Uporabi drugo metodo")
                }
                .buttonStyle(MemoSecondaryButtonStyle(minHeight: 58, cornerRadius: 18))
            }
            .padding(.top, 18)

            Spacer()
        }
        .padding(.horizontal, 24)
        .onAppear {
            appModel.errorMessage = nil
            focused = true
            startCooldown()
        }
        .onDisappear {
            cooldownTimer?.invalidate()
        }
    }

    private var introText: String {
        "Na \(email) smo poslali potrditveno kodo. Velja 5 minut. Če zahtevaš novo, uporabi samo najnovejšo kodo."
    }

    private func verify() {
        guard code.count >= 6, !isVerifying else {
            return
        }
        isVerifying = true
        Task {
            await appModel.verifyEmail(email: email, token: code)
            isVerifying = false
        }
    }

    private func resend() {
        guard cooldown <= 0, !isResending else {
            return
        }
        isResending = true
        Task {
            await appModel.sendEmailCode(to: email)
            isResending = false
            startCooldown()
        }
    }

    private func startCooldown() {
        cooldownTimer?.invalidate()
        cooldown = 60
        cooldownTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { timer in
            Task { @MainActor in
                if cooldown > 0 {
                    cooldown -= 1
                } else {
                    timer.invalidate()
                }
            }
        }
    }
}

// MARK: - Sign in with Apple

struct AppleSignInResult {
    let identityToken: String
    let nonce: String
}

final class AppleSignInCoordinator: NSObject, ObservableObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    private var completion: ((Result<AppleSignInResult, Error>) -> Void)?
    private var currentNonce: String?

    func start(completion: @escaping (Result<AppleSignInResult, Error>) -> Void) {
        self.completion = completion
        do {
            let nonce = try AppleSignInNonce.random()
            currentNonce = nonce
            let provider = ASAuthorizationAppleIDProvider()
            let request = provider.createRequest()
            request.requestedScopes = [.fullName, .email]
            request.nonce = AppleSignInNonce.sha256(nonce)
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            controller.performRequests()
        } catch {
            completion(.failure(error))
            self.completion = nil
        }
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        defer { completion = nil }
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = credential.identityToken,
              let token = String(data: tokenData, encoding: .utf8),
              let nonce = currentNonce else {
            completion?(.failure(MemoError.unsupported("Prijava z Apple ni vrnila veljavnega žetona.")))
            return
        }
        completion?(.success(AppleSignInResult(identityToken: token, nonce: nonce)))
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        defer { completion = nil }
        let nsError = error as NSError
        if nsError.domain == ASAuthorizationError.errorDomain,
           nsError.code == ASAuthorizationError.canceled.rawValue {
            completion?(.failure(CancellationError()))
            return
        }
        completion?(.failure(error))
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first { $0.isKeyWindow } ?? ASPresentationAnchor()
    }
}
