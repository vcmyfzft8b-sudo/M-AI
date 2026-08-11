import UIKit

/// Full-screen fallback shown when the first load of a page fails, with a retry affordance.
/// Without it a failed load leaves an empty white web view, which reads as a crashed app.
final class ErrorStateView: UIView {
    enum Kind {
        case offline
        case loadFailed

        var symbolName: String {
            switch self {
            case .offline: return "wifi.slash"
            case .loadFailed: return "exclamationmark.triangle"
            }
        }

        var title: String {
            switch self {
            case .offline: return String(localized: "Ni internetne povezave")
            case .loadFailed: return String(localized: "Strani ni bilo mogoče naložiti")
            }
        }

        var message: String {
            switch self {
            case .offline:
                return String(localized: "Preveri svojo povezavo in poskusi znova.")
            case .loadFailed:
                return String(localized: "Nekaj je šlo narobe. Poskusi znova čez trenutek.")
            }
        }
    }

    private let symbolView = UIImageView()
    private let titleLabel = UILabel()
    private let messageLabel = UILabel()
    private let retryButton = UIButton(type: .system)

    var onRetry: (() -> Void)?

    override init(frame: CGRect) {
        super.init(frame: frame)

        backgroundColor = UIColor(named: "LaunchBackground") ?? .systemBackground
        isHidden = true

        symbolView.tintColor = .secondaryLabel
        symbolView.contentMode = .scaleAspectFit
        symbolView.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 44, weight: .regular)

        titleLabel.font = .preferredFont(forTextStyle: .title3)
        titleLabel.adjustsFontForContentSizeCategory = true
        titleLabel.textColor = .label
        titleLabel.textAlignment = .center
        titleLabel.numberOfLines = 0

        messageLabel.font = .preferredFont(forTextStyle: .callout)
        messageLabel.adjustsFontForContentSizeCategory = true
        messageLabel.textColor = .secondaryLabel
        messageLabel.textAlignment = .center
        messageLabel.numberOfLines = 0

        var configuration = UIButton.Configuration.filled()
        configuration.title = String(localized: "Poskusi znova")
        configuration.cornerStyle = .large
        configuration.contentInsets = NSDirectionalEdgeInsets(top: 12, leading: 24, bottom: 12, trailing: 24)
        retryButton.configuration = configuration
        retryButton.addTarget(self, action: #selector(retryTapped), for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [symbolView, titleLabel, messageLabel, retryButton])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 12
        stack.setCustomSpacing(20, after: symbolView)
        stack.setCustomSpacing(24, after: messageLabel)
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)

        NSLayoutConstraint.activate([
            stack.centerYAnchor.constraint(equalTo: centerYAnchor),
            stack.leadingAnchor.constraint(equalTo: layoutMarginsGuide.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: layoutMarginsGuide.trailingAnchor, constant: -16),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func present(_ kind: Kind) {
        symbolView.image = UIImage(systemName: kind.symbolName)
        titleLabel.text = kind.title
        messageLabel.text = kind.message
        isHidden = false
        alpha = 1
    }

    func hide() {
        isHidden = true
    }

    @objc private func retryTapped() {
        onRetry?()
    }
}
