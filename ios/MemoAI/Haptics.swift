import UIKit

/// Tactile feedback belongs to the wrapper, so browser/PWA controls stay intact.
@MainActor
final class Haptics {
    private let tap = UIImpactFeedbackGenerator(style: .light)
    private let selection = UISelectionFeedbackGenerator()
    private var lastFeedback: TimeInterval = -.infinity

    func play(_ kind: String) {
        guard UIApplication.shared.applicationState == .active,
              kind == "tap" || kind == "selection" else { return }
        let now = ProcessInfo.processInfo.systemUptime
        guard now - lastFeedback >= 0.1 else { return }
        lastFeedback = now
        if kind == "selection" {
            selection.selectionChanged()
        } else {
            tap.impactOccurred(intensity: 0.55)
        }
    }

    /// Delegation survives client-side navigation and newly opened sheets.
    /// Only real activations count: scrolling, typing and scripted clicks do not.
    static let script = """
        document.addEventListener('click', event => {
          if (!event.isTrusted) return;
          const control = event.target.closest?.('button, a[href], [role="button"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"], input[type="checkbox"], input[type="radio"]');
          if (!control || control.matches(':disabled') || control.closest('[inert], [aria-disabled="true"]')) return;
          const selection = control.matches('[aria-pressed], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"], input[type="checkbox"], input[type="radio"]');
          window.memoNative.request('haptic', {kind: selection ? 'selection' : 'tap'}).catch(() => {});
        }, true);
        """
}
