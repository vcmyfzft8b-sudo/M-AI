import Foundation

private enum FixtureError: Error, Equatable { case rejected, network, queue }

@main
struct TransactionReconciliationTests {
    @MainActor static func main() async throws {
        func stream(_ values: [Int], failure: Error? = nil) -> AsyncThrowingStream<Int, Error> {
            AsyncThrowingStream { continuation in
                values.forEach { continuation.yield($0) }
                continuation.finish(throwing: failure)
            }
        }

        // Reproduces an unfinished purchase that the server cannot accept for
        // this login, followed by a valid purchase and current entitlements.
        var delivered: [Int] = []
        var finished: [Int] = []
        do {
            try await reconcileStoreTransactions(unfinished: stream([1, 2]), currentEntitlements: stream([3, 4])) {
                delivered.append($0)
                if $0 == 1 { throw FixtureError.rejected }
                if $0 == 3 { throw FixtureError.network }
                finished.append($0)
            }
            fatalError("A partial restore must report its failure")
        } catch { precondition(error as? FixtureError == .rejected) }
        precondition(delivered == [1, 2, 3, 4], "One failure must not hide later purchases")
        precondition(finished == [2, 4], "Failed deliveries must remain unfinished")

        // A later retry can successfully deliver the previously failed items.
        delivered = []
        try await reconcileStoreTransactions(unfinished: stream([1, 3]), currentEntitlements: stream([])) {
            delivered.append($0)
        }
        precondition(delivered == [1, 3])

        // A sequence failure must still allow the independent current-entitlement
        // queue to be checked, while retaining the original error for the UI.
        delivered = []
        do {
            try await reconcileStoreTransactions(unfinished: stream([1], failure: FixtureError.queue), currentEntitlements: stream([2])) {
                delivered.append($0)
            }
            fatalError("A failed queue must report its failure")
        } catch { precondition(error as? FixtureError == .queue) }
        precondition(delivered == [1, 2])

        // Cancellation is control flow, not a billing failure to swallow.
        delivered = []
        do {
            try await reconcileStoreTransactions(unfinished: stream([1, 2]), currentEntitlements: stream([3])) {
                delivered.append($0)
                throw CancellationError()
            }
            fatalError("Cancellation must propagate")
        } catch is CancellationError { }
        precondition(delivered == [1])

        // The most useful failure is reported, not merely the first: a local
        // failure first must not hide the server's answer that follows it.
        do {
            try await reconcileStoreTransactions(unfinished: stream([1]), currentEntitlements: stream([2, 3]),
                priority: { ($0 as? FixtureError) == .rejected ? 2 : ($0 as? FixtureError) == .network ? 1 : 0 }) {
                if $0 == 1 { throw FixtureError.queue }
                if $0 == 2 { throw FixtureError.network }
                throw FixtureError.rejected
            }
            fatalError("Failures must be reported")
        } catch { precondition(error as? FixtureError == .rejected, "The highest-priority failure must win") }

        try await reconcileStoreTransactions(unfinished: stream([]), currentEntitlements: stream([])) { _ in
            fatalError("An empty store must not deliver a purchase")
        }
        print("Transaction reconciliation: 6 scenarios passed")
    }
}
