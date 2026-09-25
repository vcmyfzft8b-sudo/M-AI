import UIKit
import WebKit
import StoreKit
import AuthenticationServices

/// WKWebView shows a browser-style accessory bar (previous/next/done) above
/// the keyboard for every form field. Memo's sheets already carry their own
/// controls. WKWebView supports this public responder override directly.
final class MemoWebView: WKWebView, UIScrollViewDelegate {
    override init(frame: CGRect, configuration: WKWebViewConfiguration) {
        super.init(frame: frame, configuration: configuration)
        scrollView.delegate = self
    }

    /// When the keyboard opens, WebKit scrolls the document to reveal the focused
    /// field even when the document is not scrollable. Memo's phone screens are
    /// fixed and already shrink above the keyboard, so that scroll only pushes
    /// a sheet's header off the top. Keep a non-scrollable document at rest.
    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        guard scrollView.contentSize.height <= scrollView.bounds.height + 1,
              scrollView.contentOffset.y != 0 || scrollView.contentOffset.x != 0 else { return }
        scrollView.contentOffset = .zero
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override var inputAccessoryView: UIView? { nil }
}

@MainActor
final class WebViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandlerWithReply, WKDownloadDelegate {
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .portrait }
    override var preferredInterfaceOrientationForPresentation: UIInterfaceOrientation { .portrait }

    private var webView: WKWebView!
    private let store = Store()
    private let appleSignIn = AppleSignIn()
    private let googleSignIn = GoogleSignIn()
    private let recorder = LectureRecorder()
    private let haptics = Haptics()
    private let push: PushNotifications
    private let overlay = UIStackView()
    private let loadingCover = UIView()
    private let message = UILabel()
    private let retry = UIButton(type: .system)
    private var timeout: Task<Void, Never>?
    private var loadTimeoutPaused = false
    /// The note a launching notification tap asked for, opened after the first page.
    private var launchNote: URL?
    private var downloadFiles: [ObjectIdentifier: URL] = [:]
    private var checkingAppleCredential = false
    private var memoLocale: String?
    private let themePreferenceKey = "memo.pwa.theme"

    init(push: PushNotifications) {
        self.push = push
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    private func setMemoTheme(_ value: String) {
        guard ["system", "light", "dark"].contains(value) else { return }
        overrideUserInterfaceStyle = value == "dark" ? .dark : value == "light" ? .light : .unspecified
        UserDefaults.standard.set(value, forKey: themePreferenceKey)
        setNeedsStatusBarAppearanceUpdate()
    }

    private func text(_ key: String) -> String {
        let path = Bundle.main.path(forResource: memoLocale ?? "en", ofType: "lproj")
        let bundle = path.flatMap(Bundle.init(path:)) ?? .main
        return bundle.localizedString(forKey: key, value: nil, table: nil)
    }

    private func setMemoLocale(_ value: String) {
        let locale = value.trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased().split(separator: "-").first.map(String.init) ?? ""
        guard ["sl", "hr", "bs", "sr", "en"].contains(locale) else { return }
        memoLocale = locale
        recorder.statusText = (text("recording"), text("recordingPaused"))
        retry.setTitle(text("retry"), for: .normal)
        if !overlay.isHidden, !retry.isHidden { message.text = text("connectionFailed") }
    }

    private var keyboardMotion: KeyboardMotion?

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        keyboardMotion?.layoutChanged()
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        // A take the page never collected cannot be recovered — the draft it
        // belonged to is the page's — and a banner outlives the process that
        // started it, so a crash mid-lecture would leave a clock running on the
        // Lock Screen with nothing behind it.
        LectureRecorder.removeOrphanedRecordings()
        LectureRecorder.dismissStaleActivities()
        recorder.statusText = (text("recording"), text("recordingPaused"))
        setMemoTheme(UserDefaults.standard.string(forKey: themePreferenceKey) ?? "system")
        view.backgroundColor = UIColor(named: "Canvas")
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        /*
         * Offline mode is a service worker, and WKWebView will only run one for
         * a domain listed in `WKAppBoundDomains` *and* only when the web view
         * opts into that restriction here. Without both halves the page's
         * `navigator.serviceWorker.register` never fires — measured: zero
         * requests for `/sw.js` — and the app has nothing cached to open with
         * no connection.
         *
         * The restriction it buys is one this wrapper already imposes on
         * itself: the web view may navigate only to Memo. Every external link
         * is already handed to the system browser, and both native sign-ins run
         * in `ASWebAuthenticationSession`, outside this view.
         *
         * Preview builds include their selected host via MEMO_APP_BOUND_HOST.
         * The same restriction must be enabled there for the native bridge
         * and service worker to behave as they do in the release app.
         */
        config.limitsNavigationsToAppBoundDomains = AppConfiguration.isAppBound
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = [.video]
        config.applicationNameForUserAgent = "MemoAI-iOS/1.0"
        config.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "memoNative")
        config.userContentController.addUserScript(WKUserScript(source: """
            (() => {
              if (!\(AppConfiguration.trustedOriginsJSON).includes(location.origin)) return;
              Object.defineProperty(window, 'memoNative', { value: Object.freeze({
                // 4 adds keyboard layout frames. The page is deployed
                // independently of the binary, so it has to ask before calling
                // a command an installed older build would reject.
                version: 6,
                get keyboardFrame() { return window.__memoKeyboardFrame; },
                request: (command, payload = {}) => window.webkit.messageHandlers.memoNative.postMessage({command, ...payload})
              }) });
              \(Haptics.script)
              // WebKit does not consistently promote blob anchor clicks to
              // WKDownload. Move generated exports through the same native sheet.
              document.addEventListener('click', async event => {
                const link = event.target.closest?.('a[download]');
                if (!link || !link.href.startsWith('blob:')) return;
                event.preventDefault();
                try {
                  const blob = await (await fetch(link.href)).blob();
                  if (blob.size > 32 * 1024 * 1024) throw new Error('Export too large');
                  const encoded = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result.split(',')[1]);
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                  });
                  await window.memoNative.request('shareFile', { name: link.download, data: encoded });
                } catch { await window.memoNative.request('fileError'); }
              }, true);
            })();
            """, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        config.userContentController.addUserScript(WKUserScript(source: """
            (() => {
              if (!\(AppConfiguration.trustedOriginsJSON).includes(location.origin)) return;
              // The web view runs edge to edge. The site serves viewport-fit=cover to
              // this user agent; older deployments did not, and without it the page
              // lays out under the status bar with zero safe-area insets.
              const viewport = document.querySelector('meta[name="viewport"]');
              if (viewport && !/viewport-fit\\s*=\\s*cover/.test(viewport.content)) {
                viewport.content = viewport.content.replace(/,?\\s*viewport-fit\\s*=\\s*\\w+/, '') + ', viewport-fit=cover';
              }
              const sync = () => {
                window.memoNative.request('setLocale', {locale: document.documentElement.lang}).catch(() => {});
                window.memoNative.request('setTheme', {theme: document.documentElement.dataset.theme || 'system'}).catch(() => {});
              };
              sync();
              new MutationObserver(sync).observe(document.documentElement, {attributes: true, attributeFilter: ['lang', 'data-theme']});
            })();
            """, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        webView = MemoWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isOpaque = false
        // Keep partially rendered pages behind the launch artwork until ready.
        webView.isHidden = true
        webView.backgroundColor = UIColor(named: "Canvas")
        webView.scrollView.backgroundColor = UIColor(named: "Canvas")
        // The web app owns its single scroller and, like the installed PWA, the
        // safe areas: the page is served with viewport-fit=cover for this user
        // agent and lays out with env(safe-area-inset-*). Insetting the web view
        // instead left light native bands above and below every dimmed sheet.
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.showsVerticalScrollIndicator = false
        webView.scrollView.showsHorizontalScrollIndicator = false
        webView.allowsBackForwardNavigationGestures = true
        webView.allowsLinkPreview = false
        #if DEBUG
        webView.isInspectable = true
        #endif
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])
        keyboardMotion = KeyboardMotion(host: view, webView: webView)
        buildOverlay()
        store.deliver = { [weak self] jws in
            guard let self else { throw Store.StoreError.unavailable }
            _ = try await self.api(path: "/api/mobile/transactions", body: ["signedTransaction": jws])
        }
        store.deliverConsumable = { [weak self] jws in
            guard let self else { throw Store.StoreError.unavailable }
            _ = try await self.api(path: "/api/mobile/tutor-credits", body: ["signedTransaction": jws])
        }
        store.warmPlans()
        store.showPurchaseIntent = { [weak self] in
            self?.webView.load(URLRequest(url: AppConfiguration.origin.appendingPathComponent("app/start")))
        }
        push.tokenChanged = { [weak self] token in
            // Apple reissues tokens unprompted — a restore, an OS upgrade — and
            // the old one stops working the moment it does.
            Task { await self?.savePushToken(token) }
        }
        NotificationCenter.default.addObserver(self, selector: #selector(resume), name: UIApplication.didBecomeActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(pauseLoadTimeout), name: UIApplication.didEnterBackgroundNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(checkAppleCredential), name: ASAuthorizationAppleIDProvider.credentialRevokedNotification, object: nil)
        Task {
            // The PWA cookie persists across launches in WKWebView. Do not seed
            // it from iOS language/region: the first web request uses IP country.
            let cookies = await config.websiteDataStore.httpCookieStore.allCookies()
            if let cookie = cookies.first(where: { cookie in
                cookie.name == "memo-locale" && AppConfiguration.trustedOrigins.contains {
                    $0.host == cookie.domain.trimmingCharacters(in: CharacterSet(charactersIn: "."))
                }
            }) { setMemoLocale(cookie.value) }
            /*
             * A tap on a "notes ready" notification can be what launched the
             * app. Its note used to be opened before the start page and then
             * replaced by it, landing on the home screen (UI test, 23
             * September). It is now opened once the start page has loaded —
             * the same path as a tap while the app is running. Loading the
             * note as the very first document timed out on a cold start.
             */
            launchNote = push.takePendingNote().flatMap(noteURL)
            webView.load(URLRequest(url: AppConfiguration.startURL))
            // From here on a tap navigates straight to its note.
            push.openNote = { [weak self] lecture in
                guard let self, let url = self.noteURL(lecture) else { return }
                self.webView.load(URLRequest(url: url))
            }
        }
    }

    /// A notification only ever carries a lecture id this app was told about,
    /// but it arrives from outside the web view, so it is built into a path
    /// here rather than interpolated into a URL string.
    private func noteURL(_ lecture: String) -> URL? {
        guard let id = UUID(uuidString: lecture) else { return nil }
        return AppConfiguration.origin.appendingPathComponent("app/lectures").appendingPathComponent(id.uuidString.lowercased())
    }

    private func buildOverlay() {
        overlay.axis = .vertical
        overlay.spacing = 20
        overlay.alignment = .center
        overlay.translatesAutoresizingMaskIntoConstraints = false
        loadingCover.backgroundColor = UIColor(named: "Canvas")
        loadingCover.translatesAutoresizingMaskIntoConstraints = false
        loadingCover.accessibilityIdentifier = "launch-cover"
        view.addSubview(loadingCover)
        NSLayoutConstraint.activate([
            loadingCover.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            loadingCover.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            loadingCover.topAnchor.constraint(equalTo: view.topAnchor),
            loadingCover.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        let mark = UIImageView(image: UIImage(named: "LaunchMark"))
        mark.contentMode = .scaleAspectFit
        mark.translatesAutoresizingMaskIntoConstraints = false
        mark.accessibilityIdentifier = "launch-mark"
        loadingCover.addSubview(mark)
        // Match LaunchScreen.storyboard exactly: no jump in logo size/position.
        NSLayoutConstraint.activate([
            mark.widthAnchor.constraint(equalToConstant: 128),
            mark.heightAnchor.constraint(equalToConstant: 115),
            mark.centerXAnchor.constraint(equalTo: loadingCover.centerXAnchor),
            mark.centerYAnchor.constraint(equalTo: loadingCover.centerYAnchor)
        ])
        message.font = .preferredFont(forTextStyle: .body)
        message.adjustsFontForContentSizeCategory = true
        message.textColor = .secondaryLabel
        message.numberOfLines = 0
        message.textAlignment = .center
        retry.setTitle(text("retry"), for: .normal)
        retry.accessibilityIdentifier = "retry"
        retry.addTarget(self, action: #selector(reload), for: .touchUpInside)
        retry.isHidden = true
        /*
         * No spinner, at any point. The launch is meant to be the mark alone,
         * held still on the app's own canvas — the same mark, in the same
         * place, as the launch image iOS shows before the process is even
         * running, so the handover between the two is invisible. A throbber
         * underneath it broke that: it was the one thing on screen that moved,
         * and it announced "loading" over a screen whose whole job is to look
         * like the app has already opened.
         *
         * This stack exists for `showFailure`, which is the only thing here
         * that has something to say, so it starts hidden.
         */
        overlay.isHidden = true
        [message, retry].forEach(overlay.addArrangedSubview)
        loadingCover.addSubview(overlay)
        NSLayoutConstraint.activate([
            overlay.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            overlay.topAnchor.constraint(equalTo: mark.bottomAnchor, constant: 20),
            overlay.widthAnchor.constraint(lessThanOrEqualTo: view.safeAreaLayoutGuide.widthAnchor, constant: -48)
        ])
    }

    @objc private func reload() { webView.load(URLRequest(url: AppConfiguration.startURL)) }
    @objc private func resume() {
        /*
         * A phone call, the lock button or the app switcher suspends the app,
         * and iOS cancels its loads while it is away. Coming back to the
         * "could not connect" screen that caused is not something to ask the
         * reader to fix: try again unprompted. A load that was still running
         * gets its timeout back, now that it can make progress again.
         */
        if UIApplication.shared.applicationState == .active {
            if !overlay.isHidden && !retry.isHidden { reload() }
            else if loadTimeoutPaused && webView.isLoading { startLoadTimeout() }
            loadTimeoutPaused = false
        }
        Task { try? await store.reconcile() }
        checkAppleCredential()
    }

    /// Time in the background is not time the page failed to load in.
    @objc private func pauseLoadTimeout() {
        guard let timeout, webView.isLoading else { return }
        timeout.cancel()
        self.timeout = nil
        loadTimeoutPaused = true
    }

    private func startLoadTimeout() {
        timeout?.cancel()
        timeout = Task { [weak self] in
            try? await Task.sleep(for: .seconds(30))
            guard !Task.isCancelled else { return }
            self?.webView.stopLoading()
            self?.showFailure()
        }
    }

    @objc private func checkAppleCredential() {
        guard !checkingAppleCredential, let user = AppleSignIn.currentUser() else { return }
        checkingAppleCredential = true
        Task {
            defer { checkingAppleCredential = false }
            do {
                let state = try await ASAuthorizationAppleIDProvider().credentialState(forUserID: user)
                guard state == .revoked || state == .notFound else { return }
                AppleSignIn.setCurrentUser(nil)
                if webView.url.map(AppConfiguration.isInternal) == true {
                    _ = try? await webView.callAsyncJavaScript("await fetch('/auth/logout', {method:'POST', credentials:'same-origin'});", arguments: [:], in: nil, contentWorld: .page)
                }
                await webView.configuration.websiteDataStore.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast)
                webView.load(URLRequest(url: AppConfiguration.startURL))
            } catch { /* An offline Apple check does not invalidate a valid Memo session. */ }
        }
    }

    private func showFailure() {
        timeout?.cancel()
        webView.isHidden = true
        loadingCover.isHidden = false
        overlay.isHidden = false
        message.text = text("connectionFailed")
        retry.isHidden = false
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        // A recording belongs to the capture modal, and a page load takes the
        // modal with it — including the reload this controller performs after a
        // web content process crash. Left running, the recorder would hold the
        // microphone and a Lock Screen clock for a draft that no longer exists,
        // and the next attempt to record would be refused as "already
        // recording". Client-side route changes do not come through here.
        recorder.discard()
        if !loadingCover.isHidden || webView.isHidden {
            loadingCover.isHidden = false
            /*
             * The mark on its own while it loads — no spinner, no caption. The
             * launch image is the same mark in the same place, so the app comes
             * up as one still frame rather than a logo that sprouts a status
             * line a moment later. The stack below it is for `showFailure`,
             * which is the only thing that has something to say.
             */
            overlay.isHidden = true
            message.text = nil
            retry.isHidden = true
        }
        startLoadTimeout()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if let note = launchNote {
            launchNote = nil
            webView.load(URLRequest(url: note))
        }
        timeout?.cancel()
        overlay.isHidden = true
        webView.isHidden = false
        loadingCover.isHidden = true
        resume()
        keyboardMotion?.refresh()
        // A settled page is the only dependable sign that a sign-in finished,
        // and the token has to be attached to whoever is signed in *now*. Does
        // nothing when notifications were never allowed, and the post is
        // harmless when nobody is signed in: the route answers 401 and stops.
        Task { if let token = await push.refresh() { await savePushToken(token) } }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code != NSURLErrorCancelled { showFailure() }
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code != NSURLErrorCancelled { showFailure() }
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { showFailure() }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        let main = action.targetFrame?.isMainFrame ?? true
        if !main { decisionHandler(url.scheme == "https" || url.scheme == "about" ? .allow : .cancel); return }
        if AppConfiguration.isInternal(url) {
            /*
             * Never navigate the apex, even though it is trusted. It answers
             * with a redirect to `www`, so online this only costs a round trip —
             * but a service worker belongs to one origin, and the app's is
             * `www`'s. A main-frame navigation to the apex with no connection
             * lands where nothing can intercept it, and the reader gets the
             * native "could not connect" screen with a cached library sitting
             * behind it. Rewritten here rather than only at the start URL,
             * because a link inside the app can name the canonical domain too.
             */
            if url.host == AppConfiguration.productionApex.host, main,
               var parts = URLComponents(url: url, resolvingAgainstBaseURL: false) {
                parts.host = AppConfiguration.productionOrigin.host
                if let canonical = parts.url {
                    decisionHandler(.cancel)
                    webView.load(URLRequest(url: canonical))
                    return
                }
            }
            if url.path == "/auth/logout" || url.path == "/auth/account-deleted" {
                // Before the page navigates away, while it can still make the
                // call: a token left pointing at the account that is leaving
                // would notify them on a phone someone else is now signed into.
                // Letting the navigation proceed immediately cancels the WebView's
                // DELETE request before it can remove the token.
                Task {
                    await forgetPushToken()
                    AppleSignIn.setCurrentUser(nil)
                    decisionHandler(.allow)
                }
                return
            }
            if ["/auth/google", "/auth/apple"].contains(url.path) {
                decisionHandler(.cancel)
                webView.load(URLRequest(url: AppConfiguration.origin.appendingPathComponent("auth/continue")))
                return
            }
            // The marketing page has no place in the app. It is rewritten to
            // the same entry point the app launches on, which sorts a resumed
            // session, a fresh install and a signed-out return between them.
            if url.path == "/" {
                decisionHandler(.cancel)
                webView.load(URLRequest(url: AppConfiguration.startURL))
                return
            }
            if url.path.hasPrefix("/api/billing/") { decisionHandler(.cancel); return }
            if action.shouldPerformDownload { decisionHandler(.download); return }
            if action.targetFrame == nil { decisionHandler(.cancel); webView.load(action.request); return }
            decisionHandler(.allow)
        } else if url.scheme == "blob", action.sourceFrame.isMainFrame,
                  action.sourceFrame.request.url.map(AppConfiguration.isInternal) == true {
            decisionHandler(.download)
        } else {
            decisionHandler(.cancel)
            // Mail and phone hand-offs cannot reach a checkout; the PWA starts
            // them from scripts (Settings → Share Memo), so accept every type.
            if ["mailto", "tel"].contains(url.scheme ?? "") { UIApplication.shared.open(url); return }
            // No redirects, scripts or popups can send users to external checkout.
            guard action.navigationType == .linkActivated, url.scheme == "https",
                  !["checkout.stripe.com", "billing.stripe.com"].contains(url.host ?? "") else { return }
            // Memo stays in its full-screen web view. User-selected external
            // websites belong in the system browser, not an in-app browser sheet.
            UIApplication.shared.open(url)
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if response.isForMainFrame, let http = response.response as? HTTPURLResponse, http.statusCode >= 400 {
            decisionHandler(.cancel); showFailure(); return
        }
        decisionHandler(response.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        let trusted = frame.isMainFrame && frame.request.url.map(AppConfiguration.isInternal) == true
        // WKWebView plus iOS present the consent prompts; never silently grant.
        decisionHandler(trusted ? .prompt : .deny)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame,
              message.frameInfo.request.url.map(AppConfiguration.isInternal) == true,
              webView.url.map(AppConfiguration.isInternal) == true,
              let body = message.body as? [String: Any], let command = body["command"] as? String else {
            replyHandler(nil, "Untrusted request"); return
        }
        Task {
            do {
                switch command {
                case "haptic":
                    if let kind = body["kind"] as? String { haptics.play(kind) }
                    replyHandler(["status": "done"], nil)
                case "signInWithGoogle":
                    guard let window = view.window else { throw Store.StoreError.unavailable }
                    let challenge = try await api(path: "/api/mobile/google-auth")
                    guard let value = challenge["url"] as? String, let url = URL(string: value),
                          let state = challenge["state"] as? String else { throw Store.StoreError.unavailable }
                    let result = try await googleSignIn.authorize(url: url, state: state, window: window)
                    if result["status"] == "cancelled" { replyHandler(result, nil) }
                    else {
                        _ = try await api(path: "/api/mobile/google-auth", body: result)
                        AppleSignIn.setCurrentUser(nil)
                        replyHandler(["status": "signedIn"], nil)
                    }
                case "signInWithApple":
                    guard let window = view.window else { throw Store.StoreError.unavailable }
                    let challenge = try await api(path: "/api/mobile/apple-auth")
                    guard let nonce = challenge["nonce"] as? String else { throw Store.StoreError.unavailable }
                    var credentials = try await appleSignIn.authorize(nonce: nonce, window: window)
                    if credentials["status"] == "cancelled" {
                        replyHandler(["status": "cancelled"], nil)
                    } else {
                        let appleUserID = credentials.removeValue(forKey: "appleUserID")
                        credentials["nonce"] = nonce
                        _ = try await api(path: "/api/mobile/apple-auth", body: credentials)
                        AppleSignIn.setCurrentUser(appleUserID)
                        replyHandler(["status": "signedIn"], nil)
                    }
                case "shareFile":
                    guard let encoded = body["data"] as? String, encoded.utf8.count <= 45_000_000,
                          let data = Data(base64Encoded: encoded), data.count <= 32 * 1024 * 1024,
                          let name = body["name"] as? String else { throw Store.StoreError.unavailable }
                    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
                    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                    let filename = URL(fileURLWithPath: name).lastPathComponent
                    let file = directory.appendingPathComponent(filename.isEmpty ? "Memo" : filename)
                    do { try data.write(to: file, options: [.atomic, .completeFileProtection]) }
                    catch { try? FileManager.default.removeItem(at: directory); throw error }
                    share(file)
                    replyHandler(["status": "shared"], nil)
                case "fileError":
                    showActionError()
                    replyHandler(["status": "failed"], nil)
                case "setLocale":
                    guard let locale = body["locale"] as? String else { throw Store.StoreError.unavailable }
                    setMemoLocale(locale)
                    replyHandler(["status": "updated"], nil)
                case "setTheme":
                    guard let theme = body["theme"] as? String else { throw Store.StoreError.unavailable }
                    setMemoTheme(theme)
                    replyHandler(["status": "updated"], nil)
                // Lecture capture. The page owns the draft and the upload;
                // everything here is the microphone and the Lock Screen banner,
                // which a suspended web content process cannot hold on to.
                case "recorderStart": replyHandler(try await recorder.start(), nil)
                case "recorderPause": replyHandler(try recorder.pause(), nil)
                case "recorderResume": replyHandler(try recorder.resume(), nil)
                case "recorderState": replyHandler(recorder.snapshot(), nil)
                case "recorderStop": replyHandler(try recorder.stop(), nil)
                case "recorderRead":
                    guard let offset = body["offset"] as? Int, let length = body["length"] as? Int
                    else { throw Store.StoreError.unavailable }
                    replyHandler(try recorder.read(offset: offset, length: length), nil)
                case "recorderDiscard":
                    recorder.discard()
                    replyHandler(["status": "discarded"], nil)
                // Remote notifications. The page asks at the moment the wait
                // becomes real — just after a note starts generating — rather
                // than at launch, where the question means nothing yet.
                case "pushStatus": replyHandler(await push.settingsSnapshot(), nil)
                case "enablePushNotifications":
                    let token = try await push.enable()
                    guard await savePushToken(token) else { throw BridgeFailure(reason: "token not saved") }
                    replyHandler(["status": "enabled"], nil)
                case "disablePushNotifications":
                    await forgetPushToken()
                    replyHandler(["status": "disabled"], nil)
                case "products": replyHandler(try await store.plans(), nil)
                case "codeProducts", "codePurchase":
                    guard let code = body["code"] as? String else { throw Store.StoreError.unavailable }
                    var request = ["code": code]
                    if command == "codePurchase" {
                        guard let product = body["productId"] as? String else { throw Store.StoreError.unavailable }
                        request["productId"] = product
                    }
                    // Revalidate the code and membership at purchase time. The server
                    // selects the offer and signs it with this user's appAccountToken.
                    let offer = try await api(path: "/api/mobile/promotions", body: request)
                    guard let userID = offer["userId"] as? String, let account = UUID(uuidString: userID),
                          let mode = offer["mode"] as? String, ["introductory", "promotional"].contains(mode),
                          let ids = offer["offers"] as? [String: String] else { throw Store.StoreError.unavailable }
                    if command == "codeProducts" {
                        let items = try await store.products(promotionalOffers: mode == "promotional" ? ids : nil)
                        replyHandler(items.filter { item in (item["id"] as? String).map { ids[$0] != nil } ?? false }, nil)
                    } else {
                        guard let product = request["productId"], ids[product] != nil,
                              let quote = body["quote"] as? String else { throw Store.StoreError.unavailable }
                        var promotion: Store.Promotion?
                        if mode == "promotional" {
                            guard let signature = offer["signature"] as? [String: Any] else { throw Store.StoreError.unavailable }
                            promotion = try Store.Promotion(signature)
                            guard promotion?.offerID == ids[product] else { throw Store.StoreError.unavailable }
                        }
                        replyHandler(["status": try await store.purchase(id: product, account: account, quote: quote, promotion: promotion)], nil)
                    }
                case "pendingProduct": replyHandler(["productId": store.pendingProductID as Any? ?? NSNull()], nil)
                case "purchase":
                    let account = try await api(path: "/api/mobile/account")
                    guard account["canPurchase"] as? Bool == true,
                          let id = account["userId"] as? String, let uuid = UUID(uuidString: id),
                          let product = body["productId"] as? String,
                          let quote = body["quote"] as? String else { throw Store.StoreError.unavailable }
                    replyHandler(["status": try await store.purchase(id: product, account: uuid, quote: quote)], nil)
                case "tutorProduct": replyHandler(try await store.tutorProduct(), nil)
                case "purchaseTutorHour":
                    // Subscribers only, decided by the server, before Apple's sheet opens.
                    let account = try await api(path: "/api/mobile/tutor-credits")
                    guard account["canPurchase"] as? Bool == true,
                          let id = account["userId"] as? String, let uuid = UUID(uuidString: id),
                          let quote = body["quote"] as? String else { throw Store.StoreError.unavailable }
                    replyHandler(["status": try await store.purchaseTutorHour(account: uuid, quote: quote)], nil)
                case "restore":
                    try await store.restore()
                    replyHandler(["status": "restored"], nil)
                case "manageSubscriptions":
                    guard let scene = view.window?.windowScene else { throw Store.StoreError.unavailable }
                    try await AppStore.showManageSubscriptions(in: scene)
                    try? await store.reconcile()
                    replyHandler(["status": "done"], nil)
                default: replyHandler(nil, "Unsupported request")
                }
            } catch {
                // A reason travels with the generic text so the page can show
                // what actually failed; the web copy stays the headline.
                let reason: String?
                if let failure = error as? BridgeFailure { reason = failure.reason }
                else if let message = (error as NSError).userInfo["WKJavaScriptExceptionMessage"] as? String { reason = message }
                else { reason = nil }
                replyHandler(nil, reason.map { "\(text("actionFailed")) [\($0)]" } ?? text("actionFailed"))
            }
        }
    }

    /// Hands the device token to the server as the signed-in user. Returns
    /// false rather than throwing: a failure here is worth reporting to the
    /// page, but it is never worth interrupting what the reader was doing.
    @discardableResult
    private func savePushToken(_ token: String) async -> Bool {
        do {
            _ = try await api(path: "/api/mobile/push-token", body: [
                "token": token,
                "environment": PushNotifications.environment,
                "locale": memoLocale ?? "en",
            ])
            return true
        } catch { return false }
    }

    /// Sign-out, and account deletion. The token has to stop pointing at the
    /// account that is leaving before the next person signs in on this phone.
    private func forgetPushToken() async {
        guard let token = push.currentToken else { return }
        _ = try? await webView.callAsyncJavaScript("""
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 3000);
            try {
              await fetch('/api/mobile/push-token', {
                method: 'DELETE', credentials: 'same-origin',
                headers: {'content-type': 'application/json'},
                body: JSON.stringify({token}), signal: controller.signal
              });
            } finally {
              clearTimeout(timeout);
            }
            """, arguments: ["token": token], in: nil, contentWorld: .page)
    }

    private func api(path: String, body: [String: String]? = nil) async throws -> [String: Any] {
        guard webView.url.map(AppConfiguration.isInternal) == true else { throw Store.StoreError.unavailable }
        let value = try await webView.callAsyncJavaScript("""
            const response = await fetch(path, {
              method: body === null ? 'GET' : 'POST', credentials: 'same-origin',
              headers: {'content-type': 'application/json'},
              body: body === null ? undefined : JSON.stringify(body)
            });
            if (!response.ok) {
              let detail = '';
              try { detail = (await response.json()).error || ''; } catch {}
              return { __memoFailure: response.status, detail };
            }
            return await response.json();
            """, arguments: ["path": path, "body": body as Any? ?? NSNull()], in: nil, contentWorld: .page)
        guard let result = value as? [String: Any] else { throw Store.StoreError.unavailable }
        /*
         * A refusal comes back as a value, not a thrown exception, so its
         * status always reaches the page: the text of a JavaScript exception
         * did not survive the trip on TestFlight, and a 409 ("belongs to
         * another Memo account") was shown as "could not be confirmed yet".
         */
        if let status = result["__memoFailure"] as? Int {
            let detail = result["detail"] as? String ?? ""
            throw BridgeFailure(reason: "server \(status)" + (detail.isEmpty ? "" : ": \(detail)"))
        }
        return result
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        do {
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let name = URL(fileURLWithPath: suggestedFilename).lastPathComponent
            let file = directory.appendingPathComponent(name.isEmpty ? "Memo" : name)
            downloadFiles[ObjectIdentifier(download)] = file
            completionHandler(file)
        } catch { completionHandler(nil) }
    }
    func downloadDidFinish(_ download: WKDownload) {
        guard let url = downloadFiles.removeValue(forKey: ObjectIdentifier(download)) else { return }
        share(url)
    }
    private func share(_ url: URL) {
        let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        sheet.popoverPresentationController?.sourceView = view
        sheet.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
        sheet.completionWithItemsHandler = { _, _, _, _ in try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        present(sheet, animated: true)
    }
    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        if let url = downloadFiles.removeValue(forKey: ObjectIdentifier(download)) { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        showActionError()
    }
    private func showActionError() {
        let alert = UIAlertController(title: text("actionFailed"), message: nil, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: text("ok"), style: .default))
        present(alert, animated: true)
    }
}
