import Foundation

@MainActor
final class WebViewStore: ObservableObject {
    @Published var estimatedProgress = 0.0
    @Published var isLoading = true
    @Published var canGoBack = false
    @Published var errorMessage: String?

    var reload: () -> Void = {}
    var goBack: () -> Void = {}
}
