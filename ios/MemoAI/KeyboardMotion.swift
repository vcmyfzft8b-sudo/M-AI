import UIKit
import WebKit

/// A native marker follows UIKit's keyboard layout guide. Its presentation
/// layer is where that marker is *being drawn*, rather than the end frame of
/// an animation. Forward only the latest sample; never queue animation frames
/// behind a busy web process. Browsers and older binaries retain their fallback.
@MainActor final class KeyboardMotion: NSObject {
    private weak var host: UIView?
    private weak var webView: WKWebView?
    private let marker = UIView()
    private var link: CADisplayLink?
    private var pending = false
    private var last: [CGFloat] = []
    private var keepAliveUntil: CFTimeInterval = 0
    private var layoutSize: CGSize = .zero
    private var keyboardHeight: CGFloat = 0

    init(host: UIView, webView: WKWebView) {
        self.host = host
        self.webView = webView
        super.init()
        marker.isUserInteractionEnabled = false
        marker.accessibilityElementsHidden = true
        marker.translatesAutoresizingMaskIntoConstraints = false
        host.addSubview(marker)
        // With no keyboard the marker must reach the screen's bottom, not the
        // home indicator's safe area. Floating iPad keyboards don't lift a
        // full-width sheet off the bottom of the window.
        host.keyboardLayoutGuide.usesBottomSafeArea = false
        host.keyboardLayoutGuide.followsUndockedKeyboard = false
        NSLayoutConstraint.activate([
            marker.topAnchor.constraint(equalTo: host.keyboardLayoutGuide.topAnchor),
            marker.leadingAnchor.constraint(equalTo: host.leadingAnchor),
            marker.widthAnchor.constraint(equalToConstant: 1),
            marker.heightAnchor.constraint(equalToConstant: 1)
        ])
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(keyboardChanged(_:)), name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
        center.addObserver(self, selector: #selector(refresh), name: UIApplication.didBecomeActiveNotification, object: nil)
        center.addObserver(self, selector: #selector(stop), name: UIApplication.didEnterBackgroundNotification, object: nil)
    }

    deinit { NotificationCenter.default.removeObserver(self); link?.invalidate() }

    @objc private func keyboardChanged(_ notification: Notification) {
        if let end = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect,
           end.height > 0 { keyboardHeight = end.height }
        refresh()
    }

    func layoutChanged() {
        guard let host, host.bounds.size != layoutSize else { return }
        layoutSize = host.bounds.size
        refresh()
    }

    @objc func refresh() {
        last = []
        keepAliveUntil = CACurrentMediaTime() + 1
        guard link == nil else { return }
        let proxy = DisplayTarget()
        proxy.owner = self
        let displayLink = CADisplayLink(target: proxy, selector: #selector(DisplayTarget.tick))
        let maximum = Float(host?.window?.screen.maximumFramesPerSecond ?? 60)
        displayLink.preferredFrameRateRange = CAFrameRateRange(minimum: 30, maximum: maximum, preferred: maximum)
        displayLink.add(to: .main, forMode: .common)
        link = displayLink
    }

    @objc private func stop() { link?.invalidate(); link = nil; last = [] }

    private func sample() {
        guard let host, let webView, host.window != nil else { stop(); return }
        let layer = marker.layer.presentation() ?? marker.layer
        let top = min(host.bounds.maxY, max(host.bounds.minY, layer.frame.minY))
        let endTop = min(host.bounds.maxY, max(host.bounds.minY, marker.frame.minY))
        let height = webView.bounds.height
        let inset = max(0, webView.frame.maxY - top)
        let target = max(0, webView.frame.maxY - endTop)
        let extent = min(height, max(keyboardHeight, target))
        let values = [inset, height, target, extent]
        // Keep sampling while visible, including interactive dismissal, but
        // don't wake JavaScript when nothing changed. Stop entirely at rest.
        // Deliver the exact final zero before stopping, including a slow
        // interactive dismissal that outlasts the notification's animation.
        if inset == 0 && target == 0 && values == last && !pending && CACurrentMediaTime() > keepAliveUntil { stop(); return }
        guard !pending, values != last,
              let url = webView.url, AppConfiguration.isInternal(url) else { return }
        last = values
        pending = true
        webView.evaluateJavaScript("""
            (() => {
              if (!\(AppConfiguration.trustedOriginsJSON).includes(location.origin)) return;
              const frame = {inset: \(inset), height: \(height), target: \(target), keyboardHeight: \(extent)};
              window.__memoKeyboardFrame = frame;
              window.dispatchEvent(new CustomEvent('memo:keyboard', {detail: frame}));
            })();
            """) { [weak self] _, error in
                self?.pending = false
                if error != nil { self?.last = [] }
            }
    }

    @MainActor private final class DisplayTarget: NSObject {
        weak var owner: KeyboardMotion?
        @objc func tick() { owner?.sample() }
    }
}
