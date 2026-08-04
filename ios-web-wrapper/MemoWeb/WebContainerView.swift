import SwiftUI
import UIKit
import WebKit

struct WebContainerView: View {
    @ObservedObject var store: WebViewStore

    var body: some View {
        ZStack {
            MemoWebView(store: store)

            if let errorMessage = store.errorMessage {
                ConnectionErrorView(message: errorMessage) {
                    store.reload()
                }
            }
        }
        .overlay(alignment: .top) {
            if store.isLoading {
                ProgressView(value: max(store.estimatedProgress, 0.05))
                    .progressViewStyle(.linear)
                    .tint(Color(red: 0.22, green: 0.48, blue: 0.97))
            }
        }
        .background(Color(uiColor: .systemBackground))
    }
}

private struct ConnectionErrorView: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 18) {
            Image(systemName: "wifi.exclamationmark")
                .font(.system(size: 42, weight: .medium))
                .foregroundStyle(.secondary)

            VStack(spacing: 6) {
                Text("Povezava ni uspela")
                    .font(.headline)
                Text(message)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }

            Button("Poskusi znova", action: retry)
                .buttonStyle(.borderedProminent)
        }
        .padding(28)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(uiColor: .systemBackground))
        .accessibilityIdentifier("ConnectionErrorView")
    }
}

struct MemoWebView: UIViewRepresentable {
    @ObservedObject var store: WebViewStore

    func makeCoordinator() -> Coordinator {
        Coordinator(store: store)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        configuration.allowsAirPlayForMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.applicationNameForUserAgent = "MemoAI-iOS/1.0"
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = true

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.allowsLinkPreview = false
        webView.scrollView.keyboardDismissMode = .interactive
        webView.scrollView.contentInsetAdjustmentBehavior = .automatic
        webView.accessibilityIdentifier = "MemoWebView"

#if DEBUG
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
#endif

        let refreshControl = UIRefreshControl()
        refreshControl.addTarget(
            context.coordinator,
            action: #selector(Coordinator.refresh(_:)),
            for: .valueChanged
        )
        webView.scrollView.refreshControl = refreshControl

        context.coordinator.connect(to: webView)
        webView.load(URLRequest(url: AppConfig.productionURL))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
        private let store: WebViewStore
        private weak var webView: WKWebView?
        private var progressObservation: NSKeyValueObservation?
        private var downloads: [ObjectIdentifier: URL] = [:]

        init(store: WebViewStore) {
            self.store = store
        }

        func connect(to webView: WKWebView) {
            self.webView = webView
            store.reload = { [weak webView, weak store] in
                store?.errorMessage = nil
                if webView?.url == nil {
                    webView?.load(URLRequest(url: AppConfig.productionURL))
                } else {
                    webView?.reload()
                }
            }
            store.goBack = { [weak webView] in
                guard webView?.canGoBack == true else { return }
                webView?.goBack()
            }
            progressObservation = webView.observe(\.estimatedProgress, options: [.new]) { [weak store] webView, _ in
                Task { @MainActor in
                    store?.estimatedProgress = webView.estimatedProgress
                }
            }
        }

        @objc func refresh(_ refreshControl: UIRefreshControl) {
            webView?.reload()
            refreshControl.endRefreshing()
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation?) {
            store.isLoading = true
            store.errorMessage = nil
        }

        func webView(_ webView: WKWebView, didCommit navigation: WKNavigation?) {
            store.canGoBack = webView.canGoBack
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation?) {
            store.isLoading = false
            store.estimatedProgress = 1
            store.canGoBack = webView.canGoBack
        }

        func webView(
            _ webView: WKWebView,
            didFailProvisionalNavigation navigation: WKNavigation?,
            withError error: Error
        ) {
            handleNavigationError(error)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation?, withError error: Error) {
            handleNavigationError(error)
        }

        private func handleNavigationError(_ error: Error) {
            let nsError = error as NSError
            guard nsError.code != NSURLErrorCancelled else { return }
            store.isLoading = false
            store.errorMessage = nsError.localizedDescription
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }

            if navigationAction.shouldPerformDownload {
                decisionHandler(.download)
                return
            }

            let userInitiated = navigationAction.navigationType == .linkActivated
            if AppConfig.shouldOpenExternally(url, userInitiated: userInitiated) {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
                return
            }

            if navigationAction.targetFrame == nil {
                webView.load(navigationAction.request)
                decisionHandler(.cancel)
                return
            }

            decisionHandler(.allow)
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationResponse: WKNavigationResponse,
            decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
        ) {
            decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
        }

        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            guard let url = navigationAction.request.url else { return nil }
            let userInitiated = navigationAction.navigationType == .linkActivated

            if AppConfig.shouldOpenExternally(url, userInitiated: userInitiated) {
                UIApplication.shared.open(url)
            } else {
                webView.load(navigationAction.request)
            }
            return nil
        }

        func webView(
            _ webView: WKWebView,
            requestMediaCapturePermissionFor origin: WKSecurityOrigin,
            initiatedByFrame frame: WKFrameInfo,
            type: WKMediaCaptureType,
            decisionHandler: @escaping (WKPermissionDecision) -> Void
        ) {
            let trustedOrigin = origin.protocol == "https"
                && ["memoai.eu", "www.memoai.eu"].contains(origin.host.lowercased())
            decisionHandler(trustedOrigin ? .grant : .deny)
        }

        func webView(
            _ webView: WKWebView,
            runJavaScriptAlertPanelWithMessage message: String,
            initiatedByFrame frame: WKFrameInfo,
            completionHandler: @escaping () -> Void
        ) {
            presentAlert(title: nil, message: message, actions: [
                UIAlertAction(title: "V redu", style: .default) { _ in completionHandler() }
            ])
        }

        func webView(
            _ webView: WKWebView,
            runJavaScriptConfirmPanelWithMessage message: String,
            initiatedByFrame frame: WKFrameInfo,
            completionHandler: @escaping (Bool) -> Void
        ) {
            presentAlert(title: nil, message: message, actions: [
                UIAlertAction(title: "Prekliči", style: .cancel) { _ in completionHandler(false) },
                UIAlertAction(title: "V redu", style: .default) { _ in completionHandler(true) }
            ])
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
            alert.addAction(UIAlertAction(title: "Prekliči", style: .cancel) { _ in completionHandler(nil) })
            alert.addAction(UIAlertAction(title: "V redu", style: .default) { _ in
                completionHandler(alert.textFields?.first?.text)
            })
            topViewController()?.present(alert, animated: true)
        }

        private func presentAlert(title: String?, message: String, actions: [UIAlertAction]) {
            let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
            actions.forEach(alert.addAction)
            topViewController()?.present(alert, animated: true)
        }

        func webView(
            _ webView: WKWebView,
            navigationAction: WKNavigationAction,
            didBecome download: WKDownload
        ) {
            download.delegate = self
        }

        func webView(
            _ webView: WKWebView,
            navigationResponse: WKNavigationResponse,
            didBecome download: WKDownload
        ) {
            download.delegate = self
        }

        func download(
            _ download: WKDownload,
            decideDestinationUsing response: URLResponse,
            suggestedFilename: String,
            completionHandler: @escaping (URL?) -> Void
        ) {
            let safeName = suggestedFilename.replacingOccurrences(of: "/", with: "-")
            let directory = FileManager.default.temporaryDirectory
                .appendingPathComponent(UUID().uuidString, isDirectory: true)

            do {
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                let destination = directory.appendingPathComponent(safeName)
                downloads[ObjectIdentifier(download)] = destination
                completionHandler(destination)
            } catch {
                completionHandler(nil)
            }
        }

        func downloadDidFinish(_ download: WKDownload) {
            guard let url = downloads.removeValue(forKey: ObjectIdentifier(download)) else { return }
            let activityViewController = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            guard let presenter = topViewController() else { return }
            if let popover = activityViewController.popoverPresentationController {
                popover.sourceView = presenter.view
                popover.sourceRect = CGRect(
                    x: presenter.view.bounds.midX,
                    y: presenter.view.bounds.midY,
                    width: 1,
                    height: 1
                )
                popover.permittedArrowDirections = []
            }
            presenter.present(activityViewController, animated: true)
        }

        func download(
            _ download: WKDownload,
            didFailWithError error: Error,
            resumeData: Data?
        ) {
            downloads.removeValue(forKey: ObjectIdentifier(download))
            let alert = UIAlertController(
                title: "Prenos ni uspel",
                message: error.localizedDescription,
                preferredStyle: .alert
            )
            alert.addAction(UIAlertAction(title: "V redu", style: .default))
            topViewController()?.present(alert, animated: true)
        }

        private func topViewController() -> UIViewController? {
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            var controller = scenes
                .flatMap(\.windows)
                .first(where: \.isKeyWindow)?
                .rootViewController

            while let presented = controller?.presentedViewController {
                controller = presented
            }
            return controller
        }
    }
}
