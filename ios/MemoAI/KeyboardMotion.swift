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
    private var layoutTop: CGFloat = -1
    private var lastMovement: CFTimeInterval = 0
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
        guard let host else { return }
        let top = marker.frame.minY
        guard host.bounds.size != layoutSize || top != layoutTop else { return }
        layoutSize = host.bounds.size
        layoutTop = top
        refresh()
    }

    @objc func refresh() {
        last = []
        keepAliveUntil = CACurrentMediaTime() + 1
        lastMovement = CACurrentMediaTime()
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
        guard let host, let webView, host.window != nil,
              let url = webView.url, AppConfiguration.isInternal(url) else { stop(); return }
        let layer = marker.layer.presentation() ?? marker.layer
        let top = min(host.bounds.maxY, max(host.bounds.minY, layer.frame.minY))
        let endTop = min(host.bounds.maxY, max(host.bounds.minY, marker.frame.minY))
        let height = webView.bounds.height
        let inset = max(0, webView.frame.maxY - top)
        let target = max(0, webView.frame.maxY - endTop)
        let extent = min(height, max(keyboardHeight, target))
        let values = [inset, height, target, extent]
        let spring = springState(target: target)
        // Guide constraints cause a layout pass whenever the keyboard moves,
        // including interactive drags. That wakes layoutChanged(). Sample the
        // intervening presentation frames, then sleep even if the keys remain
        // visible. Don't leave a display link running during ordinary typing.
        let now = CACurrentMediaTime()
        if values != last { lastMovement = now }
        if values == last && !pending && now > keepAliveUntil && now - lastMovement > 0.12 { stop(); return }
        guard !pending, values != last else { return }
        last = values
        pending = true
        webView.evaluateJavaScript("""
            (() => {
              if (!\(AppConfiguration.trustedOriginsJSON).includes(location.origin)) return;
              const frame = {inset: \(inset), height: \(height), target: \(target), keyboardHeight: \(extent)\(spring)};
              window.__memoKeyboardFrame = frame;
              window.dispatchEvent(new CustomEvent('memo:keyboard', {detail: frame}));
            })();
            """) { [weak self] _, error in
                self?.pending = false
                if error != nil { self?.stop() }
            }
    }

    /**
     The keyboard's own path, so the page can draw where it *will* be.

     UIKit moves the keyboard (and the layout guide this marker follows) with an
     additive `CASpringAnimation` — measured: mass 1, stiffness 555.03, damping
     47.12, 0.383 s, i.e. critically damped. Every sample the page receives is
     already a frame or two old by the time it is drawn, which is exactly the
     gap between the keys and a composer riding on them. Handing over the
     spring, how far into it we are and when this was sent lets the page
     compute the position for the moment its own frame reaches the screen.
     Interactive drags carry no animation and stay sample-driven.
     */
    private func springState(target: CGFloat) -> String {
        guard let animation = marker.layer.animation(forKey: "position") as? CASpringAnimation,
              animation.isAdditive, animation.beginTime > 0,
              let from = animation.fromValue as? CGPoint ?? (animation.fromValue as? NSValue)?.cgPointValue,
              animation.mass > 0, animation.stiffness > 0 else { return "" }
        let now = CACurrentMediaTime()
        let elapsed = marker.layer.convertTime(now, from: nil) - animation.beginTime
        guard elapsed >= -0.05, elapsed < animation.duration else { return "" }
        let omega = (animation.stiffness / animation.mass).squareRoot()
        let zeta = animation.damping / (2 * (animation.stiffness * animation.mass).squareRoot())
        // The animation offsets the marker's top by `from.y` at its start and
        // by nothing at its end; the inset moves the opposite way.
        return ", spring: {offset: \(from.y), omega: \(omega), zeta: \(zeta), duration: \(animation.duration), elapsed: \(elapsed), sentAt: \(now), target: \(target)}"
    }

    @MainActor private final class DisplayTarget: NSObject {
        weak var owner: KeyboardMotion?
        @objc func tick() { owner?.sample() }
    }
}
