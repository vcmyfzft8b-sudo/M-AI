import Foundation
import Network

/// Watches connectivity so the offline screen can retry the moment the network comes back,
/// instead of leaving the user on a dead-end error page.
final class NetworkMonitor {
    static let shared = NetworkMonitor()

    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "eu.memoai.app.network-monitor")
    private var isStarted = false

    private(set) var isReachable = true

    /// Called on the main queue whenever reachability flips.
    var onReachabilityChange: ((Bool) -> Void)?

    private init() {}

    func start() {
        guard !isStarted else { return }
        isStarted = true

        monitor.pathUpdateHandler = { [weak self] path in
            guard let self else { return }
            let reachable = path.status == .satisfied
            DispatchQueue.main.async {
                guard reachable != self.isReachable else { return }
                self.isReachable = reachable
                self.onReachabilityChange?(reachable)
            }
        }
        monitor.start(queue: queue)
    }
}
