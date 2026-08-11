import AVFoundation
import os

/// Configures the shared audio session once at launch.
///
/// `.playback` is what makes text-to-speech audible with the ring/silent switch set to silent —
/// the default `.soloAmbient` category silences it, which reads to users as a broken feature.
/// WebKit swaps the category to `.playAndRecord` on its own while `getUserMedia` is live and
/// restores it afterwards, so this only sets the baseline.
enum AudioSessionController {
    private static let log = Logger(subsystem: "eu.memoai.app", category: "audio")

    static func configure() {
        do {
            try AVAudioSession.sharedInstance().setCategory(
                .playback,
                mode: .spokenAudio,
                options: []
            )
        } catch {
            log.error("Failed to configure audio session: \(error.localizedDescription, privacy: .public)")
        }
    }
}
