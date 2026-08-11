import WebKit

/// `WKUserContentController` retains its message handlers strongly. Registering a view controller
/// directly would form a retain cycle through the web view's configuration, so registration goes
/// through this weak forwarder instead.
final class WeakScriptMessageHandler: NSObject, WKScriptMessageHandler {
    private weak var target: (any WKScriptMessageHandler)?

    init(target: any WKScriptMessageHandler) {
        self.target = target
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        target?.userContentController(userContentController, didReceive: message)
    }
}
