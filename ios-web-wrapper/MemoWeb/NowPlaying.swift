import WebKit

/// Makes the Lock Screen's Now Playing card usable while a note is read aloud.
///
/// Listening has no Live Activity of its own — iOS already shows a Now Playing
/// card, and a second Memo card saying the same thing is just clutter. Left alone
/// though that card is poor: a blank grey artwork well, a title taken from
/// `document.title`, and no play/pause, because the page publishes no Media
/// Session metadata or action handlers. This supplies both.
enum NowPlaying {
    static func userScript() -> WKUserScript {
        WKUserScript(
            source: source(),
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
    }

    private static func source() -> String {
        // Artwork comes from the site's own assets rather than a bundled image:
        // WebKit fetches Now Playing artwork through its own loader, which does
        // not go through the app's `WKURLSchemeHandler` and ignores `data:` URIs.
        // A same-origin https URL is the one form it reliably loads.
        let origin = AppConfig.productionURL.absoluteString
        return """
        (() => {
          const ORIGIN = "\(origin)".replace(/\\/$/, "");
          const ARTWORK = [
            { src: ORIGIN + "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
            { src: ORIGIN + "/memo-logo-compressed.png", sizes: "512x460", type: "image/png" },
          ];

          const session = navigator.mediaSession;
          if (!session || typeof MediaMetadata !== "function") return;

          let current = null;

          const noteTitle = () =>
            document.querySelector("main h1, article h1, h1")?.textContent?.trim() ||
            document.title.split("|")[0].trim() ||
            "Memo AI";

          const applyMetadata = () => {
            try {
              session.metadata = new MediaMetadata({
                title: noteTitle(),
                artist: "Memo AI",
                artwork: ARTWORK,
              });
            } catch {
              // Metadata is cosmetic; never let it break playback.
            }
          };

          const setHandler = (action, handler) => {
            try {
              session.setActionHandler(action, handler);
            } catch {
              // Unsupported actions are simply not offered by the platform.
            }
          };

          // Registered up front rather than on first play: iOS decides which
          // transport controls to draw from the handlers that exist when the
          // audio session starts, so installing them later can be too late.
          setHandler("play", () => current?.play());
          setHandler("pause", () => current?.pause());
          setHandler("stop", () => {
            if (!current) return;
            current.pause();
            current.currentTime = 0;
          });
          setHandler("seekbackward", (details) => {
            if (!current) return;
            current.currentTime = Math.max(0, current.currentTime - (details?.seekOffset || 15));
          });
          setHandler("seekforward", (details) => {
            if (!current) return;
            const limit = Number.isFinite(current.duration) ? current.duration : Infinity;
            current.currentTime = Math.min(limit, current.currentTime + (details?.seekOffset || 15));
          });
          setHandler("seekto", (details) => {
            if (!current || typeof details?.seekTime !== "number") return;
            current.currentTime = details.seekTime;
          });

          const updatePosition = () => {
            if (!current || !Number.isFinite(current.duration) || current.duration <= 0) return;
            try {
              session.setPositionState({
                duration: current.duration,
                playbackRate: current.playbackRate || 1,
                position: Math.min(current.currentTime, current.duration),
              });
            } catch {
              // Position state is advisory.
            }
          };

          // Media events do not bubble, so these listen in the capture phase. The
          // title is read at play time because the page is a single-page app and
          // the heading changes without a navigation.
          document.addEventListener("play", (event) => {
            if (!(event.target instanceof HTMLMediaElement)) return;
            current = event.target;
            applyMetadata();
            session.playbackState = "playing";
            updatePosition();
          }, true);

          document.addEventListener("pause", (event) => {
            if (event.target !== current) return;
            session.playbackState = "paused";
            updatePosition();
          }, true);

          document.addEventListener("ended", (event) => {
            if (event.target !== current) return;
            session.playbackState = "none";
          }, true);

          document.addEventListener("timeupdate", (event) => {
            if (event.target !== current) return;
            updatePosition();
          }, true);
        })();
        """
    }
}
