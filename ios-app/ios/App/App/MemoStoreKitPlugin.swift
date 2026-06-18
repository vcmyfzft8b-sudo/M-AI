import Capacitor
import StoreKit

@objc(MemoStoreKitPlugin)
public class MemoStoreKitPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MemoStoreKitPlugin"
    public let jsName = "MemoStoreKit"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "products", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise)
    ]

    private var productIdsByPlan: [String: String] {
        let info = Bundle.main.infoDictionary ?? [:]
        return [
            "monthly": info["MEMO_IAP_MONTHLY_PRODUCT_ID"] as? String ?? "eu.memoai.pro.monthly",
            "yearly": info["MEMO_IAP_YEARLY_PRODUCT_ID"] as? String ?? "eu.memoai.pro.yearly"
        ]
    }

    @objc func products(_ call: CAPPluginCall) {
        Task {
            do {
                let products = try await Product.products(for: Array(productIdsByPlan.values))
                let payload = products.compactMap { product -> [String: String]? in
                    guard let plan = productIdsByPlan.first(where: { $0.value == product.id })?.key else {
                        return nil
                    }

                    return [
                        "id": product.id,
                        "plan": plan,
                        "displayName": product.displayName,
                        "displayPrice": product.displayPrice
                    ]
                }

                call.resolve(["products": payload])
            } catch {
                call.reject("Unable to load App Store products.", nil, error)
            }
        }
    }

    @objc func purchase(_ call: CAPPluginCall) {
        guard let plan = call.getString("plan"),
              let productId = productIdsByPlan[plan] else {
            call.reject("Unsupported App Store product.")
            return
        }

        guard let appAccountTokenValue = call.getString("appAccountToken"),
              let appAccountToken = UUID(uuidString: appAccountTokenValue) else {
            call.reject("A valid app account token is required.")
            return
        }

        Task {
            do {
                let products = try await Product.products(for: [productId])

                guard let product = products.first else {
                    call.reject("App Store product is not configured.")
                    return
                }

                let result = try await product.purchase(options: [
                    .appAccountToken(appAccountToken)
                ])

                switch result {
                case .success(let verificationResult):
                    let transaction = try checkVerified(verificationResult)
                    await transaction.finish()
                    call.resolve([
                        "signedTransactionInfo": transaction.jwsRepresentation,
                        "productId": transaction.productID
                    ])
                case .userCancelled:
                    call.reject("Purchase cancelled.")
                case .pending:
                    call.reject("Purchase is pending App Store approval.")
                @unknown default:
                    call.reject("Unknown App Store purchase result.")
                }
            } catch {
                call.reject("Unable to complete App Store purchase.", nil, error)
            }
        }
    }

    @objc func restore(_ call: CAPPluginCall) {
        Task {
            do {
                try await AppStore.sync()
                var transactions: [[String: String]] = []

                for await entitlement in Transaction.currentEntitlements {
                    let transaction = try checkVerified(entitlement)

                    if productIdsByPlan.values.contains(transaction.productID) {
                        transactions.append([
                            "signedTransactionInfo": transaction.jwsRepresentation,
                            "productId": transaction.productID
                        ])
                    }
                }

                call.resolve(["transactions": transactions])
            } catch {
                call.reject("Unable to restore App Store purchases.", nil, error)
            }
        }
    }

    private func checkVerified<T>(_ result: VerificationResult<T>) throws -> T {
        switch result {
        case .verified(let value):
            return value
        case .unverified(_, let error):
            throw error
        }
    }
}
