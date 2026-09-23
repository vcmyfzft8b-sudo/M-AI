/// A rejected or temporarily undeliverable transaction must not prevent the
/// remaining purchases from reaching the server. Report the first failure only
/// after both queues have been checked; the caller leaves failed items unfinished.
@MainActor
func reconcileStoreTransactions<Pending: AsyncSequence, Current: AsyncSequence>(
    unfinished: Pending,
    currentEntitlements: Current,
    deliver: (Pending.Element) async throws -> Void
) async throws where Pending.Element == Current.Element {
    var firstFailure: Error?

    func drain<Items: AsyncSequence>(_ items: Items) async throws where Items.Element == Pending.Element {
        do {
            for try await item in items {
                try Task.checkCancellation()
                do { try await deliver(item) }
                catch is CancellationError { throw CancellationError() }
                catch { if firstFailure == nil { firstFailure = error } }
            }
        } catch is CancellationError { throw CancellationError() }
        catch { if firstFailure == nil { firstFailure = error } }
    }

    try await drain(unfinished)
    try await drain(currentEntitlements)
    if let firstFailure { throw firstFailure }
}
