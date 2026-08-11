import UIKit
import WebKit
import os

/// Receives files the web app produces — server responses WebKit cannot render inline, and
/// client-generated `blob:`/`data:` exports forwarded by `bridge.js` — and hands them to the
/// system share sheet so the user can save them to Files, Mail, or another app.
final class DownloadCoordinator: NSObject {
    private let log = Logger(subsystem: "eu.memoai.app", category: "downloads")
    private weak var presenter: UIViewController?
    private var destinations: [ObjectIdentifier: URL] = [:]

    init(presenter: UIViewController) {
        self.presenter = presenter
    }

    // MARK: - Client-generated files

    /// Decodes a `data:` URL produced in the page and presents it as a file.
    func presentDataURL(_ dataURL: String, suggestedFilename: String) {
        guard
            let url = URL(string: dataURL),
            let data = try? Data(contentsOf: url)
        else {
            log.error("Could not decode data URL for \(suggestedFilename, privacy: .public)")
            presentFailure()
            return
        }

        do {
            let fileURL = try stage(data: data, filename: suggestedFilename)
            present(fileURL: fileURL)
        } catch {
            log.error("Could not stage download: \(error.localizedDescription, privacy: .public)")
            presentFailure()
        }
    }

    // MARK: - Staging

    /// Each download gets its own directory so identically named files never collide.
    private func stage(data: Data, filename: String) throws -> URL {
        let directory = try makeStagingDirectory()
        let fileURL = directory.appendingPathComponent(sanitize(filename))
        try data.write(to: fileURL, options: .atomic)
        return fileURL
    }

    private func makeStagingDirectory() throws -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("Downloads", isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    /// Strips path separators so a hostile filename cannot escape the staging directory.
    private func sanitize(_ filename: String) -> String {
        let cleaned = filename
            .replacingOccurrences(of: "/", with: "-")
            .replacingOccurrences(of: "\\", with: "-")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.isEmpty || cleaned.hasPrefix(".") ? "datoteka" : cleaned
    }

    // MARK: - Presentation

    private func present(fileURL: URL) {
        guard let presenter else { return }

        let controller = UIActivityViewController(activityItems: [fileURL], applicationActivities: nil)
        controller.popoverPresentationController?.sourceView = presenter.view
        controller.popoverPresentationController?.sourceRect = CGRect(
            x: presenter.view.bounds.midX,
            y: presenter.view.bounds.maxY,
            width: 0,
            height: 0
        )
        controller.completionWithItemsHandler = { _, _, _, _ in
            // The staged copy lives in tmp; remove the whole per-download folder once shared.
            try? FileManager.default.removeItem(at: fileURL.deletingLastPathComponent())
        }
        presenter.present(controller, animated: true)
    }

    private func presentFailure() {
        guard let presenter else { return }
        let alert = UIAlertController(
            title: String(localized: "Prenos ni uspel"),
            message: String(localized: "Datoteke ni bilo mogoče shraniti. Poskusi znova."),
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: String(localized: "V redu"), style: .default))
        presenter.present(alert, animated: true)
    }
}

// MARK: - WKDownloadDelegate

extension DownloadCoordinator: WKDownloadDelegate {
    func download(
        _ download: WKDownload,
        decideDestinationUsing response: URLResponse,
        suggestedFilename: String,
        completionHandler: @escaping (URL?) -> Void
    ) {
        do {
            let directory = try makeStagingDirectory()
            let destination = directory.appendingPathComponent(sanitize(suggestedFilename))
            destinations[ObjectIdentifier(download)] = destination
            completionHandler(destination)
        } catch {
            log.error("Could not create download destination: \(error.localizedDescription, privacy: .public)")
            completionHandler(nil)
            presentFailure()
        }
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let destination = destinations.removeValue(forKey: ObjectIdentifier(download)) else { return }
        present(fileURL: destination)
    }

    func download(_ download: WKDownload, didFailWithError error: any Error, resumeData: Data?) {
        destinations.removeValue(forKey: ObjectIdentifier(download))
        log.error("Download failed: \(error.localizedDescription, privacy: .public)")
        presentFailure()
    }
}
