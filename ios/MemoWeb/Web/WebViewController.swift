import SafariServices
import UIKit
import WebKit
import os

/// The whole app: one full-screen `WKWebView` pointed at the production web app, plus the native
/// affordances a bare web view does not provide (splash, offline state, pull to refresh, share
/// sheet, external-link routing, media permissions).
final class WebViewController: UIViewController {
    private let log = Logger(subsystem: "eu.memoai.app", category: "webview")

    private let policy = NavigationPolicy(allowedDomains: AppConfig.allowedDomains)
    private let lastLocation = LastLocationStore()

    private lazy var webView = makeWebView()
    private lazy var downloads = DownloadCoordinator(presenter: self)
    private let splashView = SplashView()
    private let errorView = ErrorStateView()
    private let progressView = UIProgressView(progressViewStyle: .bar)
    private let refreshControl = UIRefreshControl()

    private var observations: [NSKeyValueObservation] = []
    private var statusBarStyle: UIStatusBarStyle = .default
    private var hasCommittedContent = false
    private var pendingURL: URL?

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()

        view.backgroundColor = UIColor(named: "LaunchBackground") ?? .systemBackground

        installWebView()
        installOverlays()
        observeWebView()

        NetworkMonitor.shared.onReachabilityChange = { [weak self] reachable in
            guard let self, reachable, !self.hasCommittedContent else { return }
            self.reload()
        }
        NetworkMonitor.shared.start()

        load(pendingURL ?? lastLocation.restore(matching: policy) ?? NativeRouting.startURL())
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { statusBarStyle }

    // MARK: - Public entry points

    /// Loads a URL, queueing it if the view is not loaded yet (deep link on a cold launch).
    func load(_ url: URL) {
        guard isViewLoaded else {
            pendingURL = url
            return
        }

        errorView.hide()
        webView.load(URLRequest(url: url))
    }

    func reload() {
        errorView.hide()

        // A failed first load leaves the web view with no back-forward list to reload from.
        if webView.url == nil {
            load(lastLocation.restore(matching: policy) ?? NativeRouting.startURL())
        } else {
            webView.reload()
        }
    }

    // MARK: - Setup

    private func makeWebView() -> WKWebView {
        let controller = WKUserContentController()
        controller.add(WeakScriptMessageHandler(target: self), name: "memoNative")
        controller.addUserScript(makeBridgeScript())

        let configuration = WKWebViewConfiguration()
        configuration.userContentController = controller
        // The default (persistent) store is what keeps the Supabase session cookie across launches.
        configuration.websiteDataStore = .default()
        configuration.applicationNameForUserAgent = AppConfig.userAgentApplicationName
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.allowsAirPlayForMediaPlayback = true
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.allowsLinkPreview = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.keyboardDismissMode = .interactive
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.isOpaque = false
        webView.backgroundColor = .clear

        #if DEBUG
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
        #endif

        return webView
    }

    /// Injects `bridge.js` with build metadata prepended, at document start on the main frame.
    private func makeBridgeScript() -> WKUserScript {
        guard
            let url = Bundle.main.url(forResource: "bridge", withExtension: "js"),
            let source = try? String(contentsOf: url, encoding: .utf8)
        else {
            preconditionFailure("bridge.js is missing from the app bundle")
        }

        // The browser-path list is passed in rather than duplicated in JavaScript, so the native
        // policy and the click interceptor cannot drift apart.
        let browserPaths = NativeRouting.browserPathPrefixes
            .map { "\"\($0)\"" }
            .joined(separator: ", ")

        let config = """
        window.__MEMO_NATIVE_CONFIG__ = {
          appVersion: "\(AppConfig.appVersion)",
          buildNumber: "\(AppConfig.buildNumber)",
          browserPathPrefixes: [\(browserPaths)]
        };
        """

        return WKUserScript(
            source: config + "\n" + source,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
    }

    private func installWebView() {
        view.addSubview(webView)

        // Edge to edge at the bottom, inset below the status bar at the top.
        //
        // The bottom is deliberately not inset: the page's own CSS already pads for the home
        // indicator with `env(safe-area-inset-bottom)` (which resolves for real only under
        // `viewport-fit=cover`, guaranteed by `bridge.js`), so insetting here would double the
        // padding and leave a dead band of background colour below the list.
        //
        // The top is inset because `.app-topbar` — unlike the landing and auth shells — has no
        // `env(safe-area-inset-top)` handling, so an edge-to-edge top puts the brand mark
        // underneath the clock. WebKit reports the web view's own safe-area insets to the page,
        // so pinning here makes `env(safe-area-inset-top)` 0 and nothing double-pads.
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])

        refreshControl.addTarget(self, action: #selector(pullToRefresh), for: .valueChanged)
        webView.scrollView.refreshControl = refreshControl
    }

    private func installOverlays() {
        progressView.translatesAutoresizingMaskIntoConstraints = false
        progressView.progressTintColor = .tintColor
        progressView.trackTintColor = .clear
        progressView.alpha = 0
        view.addSubview(progressView)

        for overlay in [splashView, errorView] as [UIView] {
            overlay.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(overlay)
            NSLayoutConstraint.activate([
                overlay.topAnchor.constraint(equalTo: view.topAnchor),
                overlay.bottomAnchor.constraint(equalTo: view.bottomAnchor),
                overlay.leadingAnchor.constraint(equalTo: view.leadingAnchor),
                overlay.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            ])
        }

        NSLayoutConstraint.activate([
            progressView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            progressView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            progressView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            progressView.heightAnchor.constraint(equalToConstant: 2),
        ])

        errorView.onRetry = { [weak self] in self?.reload() }
    }

    private func observeWebView() {
        observations = [
            webView.observe(\.estimatedProgress, options: [.new]) { [weak self] webView, _ in
                self?.updateProgress(webView.estimatedProgress, isLoading: webView.isLoading)
            },
            webView.observe(\.isLoading, options: [.new]) { [weak self] webView, _ in
                if !webView.isLoading { self?.refreshControl.endRefreshing() }
            },
            // WebKit derives this from the loaded page, which is how the safe-area bands and the
            // status bar follow the web app's light/dark theme without any bridge round trip.
            webView.observe(\.underPageBackgroundColor, options: [.new, .initial]) { [weak self] webView, _ in
                self?.applyPageBackground(webView.underPageBackgroundColor)
            },
        ]
    }

    // MARK: - Chrome updates

    private func applyPageBackground(_ color: UIColor?) {
        guard let color, color.cgColor.alpha > 0 else { return }

        view.backgroundColor = color
        webView.scrollView.backgroundColor = color

        let style: UIStatusBarStyle = color.isLight ? .darkContent : .lightContent
        guard style != statusBarStyle else { return }
        statusBarStyle = style
        setNeedsStatusBarAppearanceUpdate()
    }

    private func updateProgress(_ progress: Double, isLoading: Bool) {
        progressView.setProgress(Float(progress), animated: true)

        let shouldShow = isLoading && progress < 1
        guard (progressView.alpha > 0) != shouldShow else { return }

        UIView.animate(withDuration: 0.2) {
            self.progressView.alpha = shouldShow ? 1 : 0
        } completion: { _ in
            if !shouldShow { self.progressView.setProgress(0, animated: false) }
        }
    }

    @objc private func pullToRefresh() {
        webView.reload()
    }

    // MARK: - Presenting other content

    private func openInBrowser(_ url: URL) {
        // SFSafariViewController only accepts http(s); anything else falls through to the system.
        guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else {
            openInSystem(url)
            return
        }

        let safari = SFSafariViewController(url: url)
        safari.preferredControlTintColor = .tintColor
        safari.dismissButtonStyle = .close
        present(safari, animated: true)
    }

    private func openInSystem(_ url: URL) {
        UIApplication.shared.open(url, options: [:]) { [weak self] opened in
            guard !opened else { return }
            self?.log.notice("System declined to open \(url.scheme ?? "?", privacy: .public) URL")
        }
    }

    private func presentFailure(_ kind: ErrorStateView.Kind) {
        splashView.dismiss()
        // Only take over the screen when there is nothing to fall back to; a failed navigation
        // away from a working page should leave that page on screen.
        guard !hasCommittedContent else { return }
        errorView.present(kind)
    }
}

// MARK: - WKNavigationDelegate

extension WebViewController: WKNavigationDelegate {
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        if navigationAction.shouldPerformDownload {
            decisionHandler(.download)
            return
        }

        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }

        // `targetFrame == nil` means a new window (`target="_blank"`); treat it as main frame so
        // an off-domain popup still reaches Safari instead of silently opening in place.
        let isMainFrame = navigationAction.targetFrame?.isMainFrame ?? true

        switch policy.decide(for: url, isMainFrame: isMainFrame) {
        case .allow:
            // A signed-out session, or a logout, redirects to the marketing landing page. In the
            // app that should be the sign-in screen instead. Cancelling here means `/` never
            // commits, so the landing page does not flash before the replacement loads.
            if isMainFrame,
               let replacement = NativeRouting.redirectAwayFromLandingPage(url, productHost: AppConfig.productHost) {
                decisionHandler(.cancel)
                webView.load(URLRequest(url: replacement))
                return
            }

            // Terms and privacy open in the browser, not in the app.
            if isMainFrame, NativeRouting.opensInBrowser(url, productHost: AppConfig.productHost) {
                decisionHandler(.cancel)
                openInBrowser(url)
                return
            }

            decisionHandler(.allow)
        case .openInBrowser(let target):
            decisionHandler(.cancel)
            openInBrowser(target)
        case .openInSystem(let target):
            decisionHandler(.cancel)
            openInSystem(target)
        case .block:
            decisionHandler(.cancel)
        }
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
    ) {
        // Anything WebKit cannot render (zip exports, attachments with Content-Disposition)
        // becomes a download rather than a blank page.
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
    }

    func webView(
        _ webView: WKWebView,
        navigationAction: WKNavigationAction,
        didBecome download: WKDownload
    ) {
        download.delegate = downloads
    }

    func webView(
        _ webView: WKWebView,
        navigationResponse: WKNavigationResponse,
        didBecome download: WKDownload
    ) {
        download.delegate = downloads
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        hasCommittedContent = true
        errorView.hide()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        splashView.dismiss()
        if let url = webView.url {
            lastLocation.save(url)
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: any Error) {
        handle(error)
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: any Error
    ) {
        handle(error)
    }

    /// WebKit's content process can be jettisoned under memory pressure, leaving a white view.
    /// Reloading is the documented recovery.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        log.error("Web content process terminated; reloading")
        hasCommittedContent = false
        reload()
    }

    private func handle(_ error: any Error) {
        let nsError = error as NSError

        // Navigations we cancelled on purpose, and loads superseded by a newer one, are not
        // failures the user should ever see.
        let ignored: Set<Int> = [NSURLErrorCancelled, 102 /* frame load interrupted by policy */]
        guard !ignored.contains(nsError.code) else { return }

        log.error("Navigation failed: \(nsError.domain, privacy: .public) \(nsError.code)")

        let isOffline = [
            NSURLErrorNotConnectedToInternet,
            NSURLErrorNetworkConnectionLost,
            NSURLErrorDataNotAllowed,
            NSURLErrorTimedOut,
            NSURLErrorCannotFindHost,
        ].contains(nsError.code)

        presentFailure(isOffline ? .offline : .loadFailed)
    }
}

// MARK: - WKUIDelegate

extension WebViewController: WKUIDelegate {
    /// `window.open` / `target="_blank"`: WebKit hands us the action instead of creating a view.
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url {
            if policy.isInAppHost(url) {
                webView.load(navigationAction.request)
            } else {
                openInBrowser(url)
            }
        }
        return nil
    }

    /// Microphone and camera capture. Our own origin is granted directly — the user has already
    /// passed the system permission prompt — while anything else keeps WebKit's own gate.
    func webView(
        _ webView: WKWebView,
        requestMediaCapturePermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        let originURL = URL(string: "\(origin.protocol)://\(origin.host)")
        let isOurs = originURL.map(policy.isInAppHost) ?? false
        decisionHandler(isOurs ? .grant : .prompt)
    }

    // JavaScript dialogs do nothing at all unless the host app renders them.

    func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping () -> Void
    ) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: String(localized: "V redu"), style: .default) { _ in
            completionHandler()
        })
        presentDialog(alert, fallback: completionHandler)
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (Bool) -> Void
    ) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: String(localized: "Prekliči"), style: .cancel) { _ in
            completionHandler(false)
        })
        alert.addAction(UIAlertAction(title: String(localized: "V redu"), style: .default) { _ in
            completionHandler(true)
        })
        presentDialog(alert) { completionHandler(false) }
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptTextInputPanelWithPrompt prompt: String,
        defaultText: String?,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (String?) -> Void
    ) {
        let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        alert.addTextField { $0.text = defaultText }
        alert.addAction(UIAlertAction(title: String(localized: "Prekliči"), style: .cancel) { _ in
            completionHandler(nil)
        })
        alert.addAction(UIAlertAction(title: String(localized: "V redu"), style: .default) { [weak alert] _ in
            completionHandler(alert?.textFields?.first?.text)
        })
        presentDialog(alert) { completionHandler(nil) }
    }

    /// WebKit blocks the page until the completion handler runs, so a dialog that cannot be shown
    /// must still complete.
    private func presentDialog(_ alert: UIAlertController, fallback: @escaping () -> Void) {
        guard presentedViewController == nil else {
            fallback()
            return
        }
        present(alert, animated: true)
    }
}

// MARK: - WKScriptMessageHandler

extension WebViewController: WKScriptMessageHandler {
    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard
            message.name == "memoNative",
            let body = message.body as? [String: Any],
            let type = body["type"] as? String
        else { return }

        switch type {
        case "haptic":
            Haptics.play(body["style"] as? String ?? "light")

        case "share":
            var items: [Any] = []
            if let url = (body["url"] as? String).flatMap(URL.init(string:)) {
                items.append(url)
            }
            if let text = body["text"] as? String, !text.isEmpty {
                items.append(text)
            }
            guard !items.isEmpty else { return }
            let controller = UIActivityViewController(activityItems: items, applicationActivities: nil)
            controller.popoverPresentationController?.sourceView = view
            present(controller, animated: true)

        case "openExternal":
            guard let url = (body["url"] as? String).flatMap(URL.init(string:)) else { return }
            openInBrowser(url)

        case "download":
            guard let dataURL = body["dataURL"] as? String else { return }
            downloads.presentDataURL(dataURL, suggestedFilename: body["filename"] as? String ?? "datoteka")

        case "log":
            log.debug("web: \(String(describing: body["message"]), privacy: .public)")

        default:
            log.notice("Unhandled bridge message: \(type, privacy: .public)")
        }
    }
}
