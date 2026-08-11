import UIKit

/// Covers the web view until the first page paints, so the user never sees a blank white flash
/// or half-rendered HTML. Continues the launch screen's background colour without a seam.
final class SplashView: UIView {
    private let markView = UIImageView(image: UIImage(named: "BrandMark"))
    private let spinner = UIActivityIndicatorView(style: .medium)

    override init(frame: CGRect) {
        super.init(frame: frame)

        backgroundColor = UIColor(named: "LaunchBackground") ?? .systemBackground

        markView.contentMode = .scaleAspectFit
        markView.translatesAutoresizingMaskIntoConstraints = false

        spinner.translatesAutoresizingMaskIntoConstraints = false
        spinner.hidesWhenStopped = false
        spinner.startAnimating()

        addSubview(markView)
        addSubview(spinner)

        NSLayoutConstraint.activate([
            markView.centerXAnchor.constraint(equalTo: centerXAnchor),
            markView.centerYAnchor.constraint(equalTo: centerYAnchor, constant: -32),
            markView.widthAnchor.constraint(equalToConstant: 132),
            markView.heightAnchor.constraint(equalToConstant: 132),

            spinner.centerXAnchor.constraint(equalTo: centerXAnchor),
            spinner.topAnchor.constraint(equalTo: markView.bottomAnchor, constant: 28),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    /// The splash only fades once — a reload should not flash it back over live content.
    func dismiss() {
        guard !isHidden else { return }
        UIView.animate(
            withDuration: 0.25,
            animations: { self.alpha = 0 },
            completion: { _ in
                self.isHidden = true
                self.spinner.stopAnimating()
            }
        )
    }
}
