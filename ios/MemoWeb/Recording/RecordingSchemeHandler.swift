import Foundation
import WebKit
import os

/// Serves finished recordings to the page over a custom `memo-recording://` scheme.
///
/// This is what lets native capture slot into the web app's existing flow. The page does
/// `fetch("memo-recording://<id>")`, gets a `Blob`, wraps it in a `File`, and hands it to the
/// very same upload path a browser recording used — so lecture creation, the signed upload
/// target, billing and processing stay entirely in the web app, with nothing reimplemented here.
///
/// Base64 through the message bridge was the alternative, and it is not viable: a three-hour
/// lecture is tens of megabytes, and base64 inflates it by a third before it ever reaches JS.
final class RecordingSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "memo-recording"

    private let log = Logger(subsystem: "eu.memoai.app", category: "capture")
    private var files: [String: URL] = [:]
    private var activeTasks: Set<ObjectIdentifier> = []

    /// Registers a file and returns the URL the page should fetch.
    func publish(_ fileURL: URL) -> URL {
        let id = UUID().uuidString
        files[id] = fileURL
        return URL(string: "\(Self.scheme)://\(id)")!
    }

    /// Drops the registration and deletes the file. Called once the page has the bytes.
    func discard(_ url: URL) {
        guard let id = url.host, let fileURL = files.removeValue(forKey: id) else { return }
        try? FileManager.default.removeItem(at: fileURL)
    }

    // MARK: - WKURLSchemeHandler

    func webView(_ webView: WKWebView, start task: any WKURLSchemeTask) {
        activeTasks.insert(ObjectIdentifier(task))

        guard
            let id = task.request.url?.host,
            let fileURL = files[id],
            let handle = try? FileHandle(forReadingFrom: fileURL),
            let size = try? FileManager.default.attributesOfItem(atPath: fileURL.path)[.size] as? Int
        else {
            finish(task, with: URLError(.fileDoesNotExist))
            return
        }

        defer { try? handle.close() }

        let response = HTTPURLResponse(
            url: task.request.url!,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            // The page is on https://memoai.eu, so this response is cross-origin to it; without
            // the CORS header `fetch` rejects before the body is ever read.
            headerFields: [
                "Content-Type": "audio/mp4",
                "Content-Length": String(size),
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "no-store",
            ]
        )!

        guard isActive(task) else { return }
        task.didReceive(response)

        // Streamed in chunks: a whole lecture read into one Data would spike memory badly on an
        // older device.
        let chunkSize = 512 * 1024
        while isActive(task), let chunk = try? handle.read(upToCount: chunkSize), !chunk.isEmpty {
            task.didReceive(chunk)
        }

        finish(task, with: nil)
    }

    func webView(_ webView: WKWebView, stop task: any WKURLSchemeTask) {
        // WebKit forbids calling back into a stopped task; forgetting it is how we know.
        activeTasks.remove(ObjectIdentifier(task))
    }

    // MARK: - Task bookkeeping

    private func isActive(_ task: any WKURLSchemeTask) -> Bool {
        activeTasks.contains(ObjectIdentifier(task))
    }

    private func finish(_ task: any WKURLSchemeTask, with error: (any Error)?) {
        guard isActive(task) else { return }
        activeTasks.remove(ObjectIdentifier(task))

        if let error {
            log.error("Could not serve recording: \(error.localizedDescription, privacy: .public)")
            task.didFailWithError(error)
        } else {
            task.didFinish()
        }
    }
}
