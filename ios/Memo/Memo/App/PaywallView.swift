import StoreKit
import SwiftUI

// Native paywall matching the web `memo-paywall-shell` design.
// Purchases run through StoreKit in-app purchase (App Store rule 3.1.1) —
// never through Stripe checkout on iOS.

struct PaywallView: View {
    @EnvironmentObject private var appModel: AppModel
    var onClose: (() -> Void)?

    @State private var selectedPlan: BillingPlan = .yearly
    @State private var isPurchasing = false
    @State private var isRestoring = false

    private let purple = Color(hex: 0x7C5CFF)

    var body: some View {
        ZStack(alignment: .topTrailing) {
            background

            ScrollView(showsIndicators: false) {
                VStack(spacing: 22) {
                    header
                    benefits
                    planGrid
                    reassurance
                    ctaButton
                    footer
                }
                .padding(.horizontal, 22)
                .padding(.top, 54)
                .padding(.bottom, 30)
            }

            if let onClose {
                MemoCloseButton(
                    size: 36,
                    accessibilityLabel: "Zapri",
                    foreground: .white.opacity(0.88),
                    action: onClose
                )
                .padding(.top, 10)
                .padding(.trailing, 18)
            }
        }
        .preferredColorScheme(.dark)
        .task {
            await appModel.store.refresh()
        }
    }

    private var background: some View {
        ZStack {
            LinearGradient(
                colors: [Color(hex: 0x0B3158), Color(hex: 0x061828), Color(hex: 0x050505)],
                startPoint: .top,
                endPoint: .bottom
            )
            RadialGradient(
                colors: [Color(hex: 0x0A84FF).opacity(0.38), .clear],
                center: .init(x: 0.5, y: -0.1),
                startRadius: 10,
                endRadius: 340
            )
        }
        .ignoresSafeArea()
    }

    private var header: some View {
        VStack(spacing: 16) {
            HStack(spacing: 12) {
                BrandLogo(size: 66)
                Text("Memo AI")
                    .font(.system(size: 40, weight: .black))
                    .foregroundStyle(.white)
            }
            Text("Nadgradi in ustvarjaj več zapiskov")
                .font(.system(size: 29, weight: .black))
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)
        }
    }

    private var benefits: some View {
        VStack(spacing: 10) {
            benefitCard(emoji: "📝", title: "Neomejeni zapiski", copy: "Naloži neomejeno PDF-jev in zvoka")
            benefitCard(emoji: "💡", title: "Pametna učna orodja", copy: "Personalizirane vaje za boljše rezultate")
            benefitCard(emoji: "⚡", title: "Uči se 10x hitreje", copy: "Pospeši učenje z AI podporo")
        }
    }

    private func benefitCard(emoji: String, title: String, copy: String) -> some View {
        HStack(spacing: 14) {
            Text(emoji)
                .font(.system(size: 24))
                .frame(width: 48, height: 48)
                .background(.white.opacity(0.08))
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(.white)
                Text(copy)
                    .font(.system(size: 13.5))
                    .foregroundStyle(.white.opacity(0.65))
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .background(.white.opacity(0.06))
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .stroke(.white.opacity(0.1), lineWidth: 1)
        )
    }

    // MARK: - Plans

    private var planGrid: some View {
        HStack(alignment: .top, spacing: 12) {
            planCard(.yearly)
            planCard(.monthly)
        }
        .padding(.top, 12)
    }

    private func planCard(_ plan: BillingPlan) -> some View {
        let selected = selectedPlan == plan
        return Button {
            selectedPlan = plan
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text(plan == .yearly ? "Letno" : "Mesečno")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(.white)
                    Spacer()
                    ZStack {
                        Circle()
                            .stroke(selected ? purple : .white.opacity(0.35), lineWidth: 2)
                            .frame(width: 20, height: 20)
                        if selected {
                            Circle().fill(purple).frame(width: 11, height: 11)
                        }
                    }
                }

                Spacer(minLength: 6)

                Text(monthlyPriceText(plan))
                    .font(.system(size: 30, weight: .black))
                    .foregroundStyle(.white)
                Text("/ mesec")
                    .font(.system(size: 13))
                    .foregroundStyle(.white.opacity(0.6))
                Text(plan == .yearly ? billedYearlyText : "Obračunano mesečno")
                    .font(.system(size: 12))
                    .foregroundStyle(.white.opacity(0.55))
                    .padding(.top, 2)

                if plan == .yearly {
                    Text("Prihrani 46%")
                        .font(.system(size: 11.5, weight: .bold))
                        .foregroundStyle(Color(hex: 0x32D74B))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Color(hex: 0x32D74B).opacity(0.15))
                        .clipShape(Capsule())
                        .padding(.top, 4)
                }
            }
            .padding(15)
            .frame(maxWidth: .infinity, minHeight: 175, alignment: .topLeading)
            .background(
                selected
                    ? AnyShapeStyle(LinearGradient(
                        colors: [purple.opacity(0.32), purple.opacity(0.12)],
                        startPoint: .top,
                        endPoint: .bottom
                    ))
                    : AnyShapeStyle(Color.white.opacity(0.05))
            )
            .clipShape(RoundedRectangle(cornerRadius: 23, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 23, style: .continuous)
                    .stroke(selected ? purple : .white.opacity(0.14), lineWidth: 2.5)
            )
            .overlay(alignment: .top) {
                if plan == .yearly {
                    Text("Najbolj priljubljeno")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(Color(hex: 0x0B1A30))
                        .clipShape(Capsule())
                        .overlay(Capsule().stroke(purple, lineWidth: 1.5))
                        .offset(y: -12)
                }
            }
        }
    }

    private func storeProduct(for plan: BillingPlan) -> Product? {
        appModel.store.products.first { $0.id.hasSuffix(plan.rawValue) }
    }

    private func monthlyPriceText(_ plan: BillingPlan) -> String {
        if let product = storeProduct(for: plan) {
            if plan == .yearly {
                let monthly = (product.price as NSDecimalNumber).doubleValue / 12
                return formatEuro(monthly)
            }
            return product.displayPrice
        }
        // Web fallback prices: yearly €130/yr shown as €11/mo, monthly €20/mo.
        return plan == .yearly ? "€11" : "€20"
    }

    private var billedYearlyText: String {
        if let product = storeProduct(for: .yearly) {
            return "Obračunano letno: \(product.displayPrice)"
        }
        return "Obračunano letno: €130"
    }

    private func formatEuro(_ value: Double) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = storeProduct(for: .yearly)?.priceFormatStyle.currencyCode ?? "EUR"
        formatter.locale = MemoFormat.slLocale
        formatter.maximumFractionDigits = value.truncatingRemainder(dividingBy: 1) == 0 ? 0 : 2
        return formatter.string(from: NSNumber(value: value)) ?? String(format: "€%.0f", value)
    }

    // MARK: - CTA

    private var trialEligible: Bool {
        appModel.profile?.trialConsumedAt == nil && !appModel.hasPaidAccess
    }

    private var reassurance: some View {
        HStack(spacing: 7) {
            Image(systemName: "checkmark.circle")
                .font(.system(size: 15, weight: .semibold))
            Text(trialEligible ? "Danes brez plačila" : "Varno plačilo prek App Store")
                .font(.system(size: 14, weight: .semibold))
        }
        .foregroundStyle(.white.opacity(0.8))
    }

    private var ctaButton: some View {
        Button(action: purchase) {
            Group {
                if isPurchasing {
                    ProgressView().tint(.white)
                } else if isCurrentPlan {
                    Text("Trenutni paket")
                } else if trialEligible {
                    Text("Začni 3-dnevni brezplačni preizkus")
                } else {
                    Text("Nadaljuj na plačilo")
                }
            }
            .font(.system(size: 18, weight: .black))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 68)
            .background(purple)
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            .shadow(color: Color(hex: 0x0A84FF).opacity(0.4), radius: 22, y: 8)
        }
        .disabled(isPurchasing || isCurrentPlan)
    }

    private var isCurrentPlan: Bool {
        guard let product = storeProduct(for: selectedPlan) else {
            return false
        }
        return appModel.store.activeProductIDs.contains(product.id)
    }

    private var footer: some View {
        VStack(spacing: 14) {
            HStack(spacing: 7) {
                Image(systemName: "checkmark.circle")
                    .font(.system(size: 14, weight: .semibold))
                Text("Prekliči kadarkoli")
                    .font(.system(size: 13.5, weight: .medium))
            }
            .foregroundStyle(.white.opacity(0.6))

            Button(action: restore) {
                if isRestoring {
                    ProgressView().tint(.white.opacity(0.7))
                } else {
                    Text("Obnovi nakupe")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.7))
                        .underline()
                }
            }
            .disabled(isRestoring)

            HStack(spacing: 18) {
                Link("Pogoji uporabe", destination: appModel.configuration.termsURL)
                Link("Zasebnost", destination: appModel.configuration.privacyPolicyURL)
            }
            .font(.system(size: 12.5))
            .foregroundStyle(.white.opacity(0.5))

            if let error = appModel.errorMessage {
                MemoBanner(kind: .error, message: error)
            }
        }
    }

    private func purchase() {
        guard let product = storeProduct(for: selectedPlan) else {
            appModel.errorMessage = "Paketi trenutno niso na voljo. Poskusi znova pozneje."
            return
        }
        isPurchasing = true
        Task {
            await appModel.purchase(product)
            isPurchasing = false
            if appModel.hasPaidAccess {
                onClose?()
            }
        }
    }

    private func restore() {
        isRestoring = true
        Task {
            await appModel.restorePurchases()
            isRestoring = false
            if appModel.hasPaidAccess {
                onClose?()
            }
        }
    }
}
