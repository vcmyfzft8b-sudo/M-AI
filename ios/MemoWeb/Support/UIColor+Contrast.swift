import UIKit

extension UIColor {
    /// Relative luminance in 0...1, used to pick a readable status-bar style against whatever
    /// background colour WebKit derived from the loaded page.
    var relativeLuminance: CGFloat {
        var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
        guard resolvedColor(with: .current).getRed(&red, green: &green, blue: &blue, alpha: &alpha) else {
            return 1
        }

        func linear(_ channel: CGFloat) -> CGFloat {
            channel <= 0.03928 ? channel / 12.92 : pow((channel + 0.055) / 1.055, 2.4)
        }

        return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
    }

    var isLight: Bool { relativeLuminance > 0.5 }
}
