import StoreKit
import UIKit

/// A transaction is finished only after our server verifies and saves its JWS.
@MainActor
final class Store {
    private var updates: Task<Void, Never>?
    private var intents: Task<Void, Never>?
    private var pendingProduct: Product?
    private var purchasing = false
    var deliver: ((String) async throws -> Void)?
    var showPurchaseIntent: (() -> Void)?
    var pendingProductID: String? { pendingProduct?.id }

    init() {
        updates = Task { [weak self] in
            for await result in Transaction.updates {
                guard let self else { return }
                try? await self.accept(result)
            }
        }
        intents = Task { [weak self] in
            for await intent in PurchaseIntent.intents {
                guard let self else { return }
                guard AppConfiguration.productIDs.contains(intent.product.id) else { continue }
                self.pendingProduct = intent.product
                // Finish login/consent and show the selected plan before buying.
                // The normal purchase command obtains the server-verified user UUID.
                self.showPurchaseIntent?()
            }
        }
    }

    deinit { updates?.cancel(); intents?.cancel() }

    func products() async throws -> [[String: Any]] {
        let products = try await Product.products(for: AppConfiguration.productIDs)
            .filter { $0.type == .autoRenewable }
            .sorted { $0.price < $1.price }
        var result: [[String: Any]] = []
        for product in products {
            var item = await presentation(product)
            if product.subscription?.subscriptionPeriod.unit == .year,
               let monthly = products.first(where: {
                   $0.subscription?.subscriptionPeriod.unit == .month &&
                   $0.priceFormatStyle.currencyCode == product.priceFormatStyle.currencyCode
               }), monthly.price > 0 {
                let saving = 1 - NSDecimalNumber(decimal: product.price / (monthly.price * 12)).doubleValue
                item["yearlySavings"] = max(0, min(100, Int((saving * 100).rounded())))
            }
            result.append(item)
        }
        return result
    }

    /// Only advertise the first-period offers this paywall can explain accurately.
    /// StoreKit still decides eligibility and applies the configured introductory offer.
    private func presentation(_ product: Product) async -> [String: Any] {
        var result: [String: Any] = ["id": product.id, "name": product.displayName,
            "price": product.displayPrice]
        if product.subscription?.subscriptionPeriod.unit == .year {
            result["monthlyPrice"] = (product.price / 12).formatted(product.priceFormatStyle)
        } else {
            result["monthlyPrice"] = product.displayPrice
        }
        var offerKey = "standard"
        if let subscription = product.subscription,
           let offer = subscription.introductoryOffer,
           await subscription.isEligibleForIntroOffer {
            let isThreeDayTrial = offer.paymentMode == .freeTrial && offer.price == 0 &&
                offer.periodCount == 1 && offer.period.unit == .day && offer.period.value == 3
            let isFirstPeriodDiscount = offer.paymentMode == .payUpFront && offer.periodCount == 1 &&
                offer.period.unit == subscription.subscriptionPeriod.unit &&
                offer.period.value == subscription.subscriptionPeriod.value
            // Never describe a free trial as a discounted paid month or year.
            guard isThreeDayTrial || isFirstPeriodDiscount else {
                result["available"] = false
                return result
            }
            offerKey = "intro:\(offer.paymentMode):\(offer.id ?? "default"):\(offer.price):\(offer.displayPrice):\(offer.period.value):\(offer.period.unit)"
            if isThreeDayTrial {
                result["trialDays"] = 3
            } else {
                result["introPrice"] = offer.displayPrice
                // This tolerance is only for the badge; never calculate the charged price.
                let regular = NSDecimalNumber(decimal: product.price).doubleValue
                // StoreKit Test on iOS 26.5 returned price 64 for displayPrice €64.99.
                // Match the badge to the Apple-formatted price we actually show, using
                // Apple's own currency/locale parser, and fail closed if it cannot parse.
                if let displayed = try? Decimal(offer.displayPrice, format: product.priceFormatStyle) {
                    if subscription.subscriptionPeriod.unit == .year {
                        result["introWeeklyPrice"] = (displayed / 52).formatted(product.priceFormatStyle)
                    }
                    let introductory = NSDecimalNumber(decimal: displayed).doubleValue
                    result["halfOff"] = regular > 0 && abs(introductory / regular - 0.5) < 0.001
                } else {
                    result["halfOff"] = false
                }
            }
        }
        result["available"] = true
        result["quote"] = "\(product.id):\(product.price):\(product.priceFormatStyle.currencyCode):\(product.displayPrice):\(offerKey)"
        return result
    }

    func purchase(id: String, account: UUID, quote: String) async throws -> String {
        guard !purchasing, AppConfiguration.productIDs.contains(id) else { throw StoreError.unavailable }
        purchasing = true
        defer { purchasing = false }
        guard let product = try await Product.products(for: [id]).first else { throw StoreError.unavailable }
        let current = await presentation(product)
        guard current["available"] as? Bool == true, current["quote"] as? String == quote else {
            return "priceChanged"
        }
        switch try await product.purchase(options: [.appAccountToken(account)]) {
        case .success(let result):
            try await accept(result)
            pendingProduct = nil
            return "purchased"
        case .pending: return "pending"
        case .userCancelled: return "cancelled"
        @unknown default: throw StoreError.unavailable
        }
    }

    func restore() async throws {
        try await AppStore.sync()
        try await reconcile()
    }

    func reconcile() async throws {
        try await reconcileStoreTransactions(
            unfinished: Transaction.unfinished,
            currentEntitlements: Transaction.currentEntitlements
        ) { try await self.accept($0) }
    }

    private func accept(_ result: VerificationResult<Transaction>) async throws {
        guard case .verified(let transaction) = result,
              AppConfiguration.productIDs.contains(transaction.productID),
              let deliver else { throw StoreError.unavailable }
        try await deliver(result.jwsRepresentation)
        await transaction.finish()
    }

    enum StoreError: Error { case unavailable }
}

/// A native step that failed for a reason worth showing: the page appends it
/// to its generic message so a failed sign-in can be reported precisely.
struct BridgeFailure: Error {
    let reason: String
}
