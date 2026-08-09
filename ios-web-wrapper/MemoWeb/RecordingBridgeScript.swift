import WebKit

/// Routes the page's recorder to native capture.
///
/// The page keeps its own UI and upload flow; only the capture engine is swapped.
/// `MediaRecorder` is replaced with a shim that starts `NativeAudioRecorder` and,
/// on stop, hands back the finished file as a `Blob` — which is what the page
/// already expects — so nothing on memoai.eu has to change. `getUserMedia` is
/// shimmed too, so WebKit never opens the microphone it cannot keep in the
/// background; the waveform is driven by real input levels pushed from native.
extension RecordingBridge {
    static let userScript = WKUserScript(
        source: source,
        injectionTime: .atDocumentStart,
        forMainFrameOnly: true
    )

    private static let source = #"""
        (() => {
          const bridge = window.webkit?.messageHandlers?.memoRecording;
          if (!bridge) return;

          const MIME_TYPE = "audio/mp4";
          const post = (event) => {
            try {
              bridge.postMessage({ event });
            } catch {
              // A missing handler must never break the page.
            }
          };

          // ---- synthetic capture stream -------------------------------------
          // The page feeds its waveform from the capture stream. Native capture
          // has no such stream, so this stands in for it and native pushes the
          // real input level into its gain.
          let audioContext = null;
          let levelGain = null;

          const makeSyntheticStream = () => {
            const Context = window.AudioContext || window.webkitAudioContext;
            if (!Context) return new MediaStream();
            audioContext = audioContext || new Context();
            if (audioContext.state === "suspended") audioContext.resume();

            const destination = audioContext.createMediaStreamDestination();
            const oscillator = audioContext.createOscillator();
            oscillator.type = "sawtooth";
            oscillator.frequency.value = 160;
            levelGain = audioContext.createGain();
            levelGain.gain.value = 0;
            oscillator.connect(levelGain);
            levelGain.connect(destination);
            oscillator.start();
            return destination.stream;
          };

          // ---- native-backed MediaRecorder ----------------------------------
          let pending = null;

          class NativeMediaRecorder extends EventTarget {
            constructor(stream, options) {
              super();
              this.stream = stream ?? new MediaStream();
              this.mimeType = options?.mimeType || MIME_TYPE;
              this.state = "inactive";
              this.ondataavailable = null;
              this.onstop = null;
              this.onerror = null;
              this.onstart = null;
              this.onpause = null;
              this.onresume = null;
            }

            static isTypeSupported(type) {
              // Steer the page to the container native capture actually produces.
              return typeof type === "string" && type.startsWith("audio/mp4");
            }

            #emit(name, init) {
              const event = new Event(name);
              Object.assign(event, init);
              this.dispatchEvent(event);
              const handler = this[`on${name}`];
              if (typeof handler === "function") handler.call(this, event);
            }

            start() {
              if (this.state !== "inactive") return;
              this.state = "recording";
              pending = this;
              post("record-start");
              this.#emit("start");
            }

            pause() {
              if (this.state !== "recording") return;
              this.state = "paused";
              post("record-pause");
              this.#emit("pause");
            }

            resume() {
              if (this.state !== "paused") return;
              this.state = "recording";
              post("record-resume");
              this.#emit("resume");
            }

            stop() {
              if (this.state === "inactive") return;
              this.state = "inactive";
              post("record-stop");
              // `dataavailable` and `stop` are emitted once native hands the
              // finished file back, through window.__memoNative below.
            }

            requestData() {}

            deliver(blob) {
              this.#emit("dataavailable", { data: blob });
              this.#emit("stop");
            }

            fail(message) {
              this.#emit("error", { error: new DOMException(message, "UnknownError") });
              this.#emit("dataavailable", { data: new Blob([], { type: this.mimeType }) });
              this.#emit("stop");
            }
          }

          window.__memoNative = {
            async recordingReady(source, elapsed) {
              const recorder = pending;
              pending = null;
              if (!recorder) return;
              try {
                const response = await fetch(source);
                const blob = await response.blob();
                recorder.deliver(new Blob([blob], { type: recorder.mimeType }));
              } catch (error) {
                recorder.fail(String(error));
              }
            },
            recordingFailed(message) {
              const recorder = pending;
              pending = null;
              if (recorder) recorder.fail(message);
            },
            recordingInterrupted() {},
            level(value) {
              if (!levelGain) return;
              // Kept well below unity: this only has to move the waveform, and it
              // is mixed into a stream the page may also play back.
              levelGain.gain.value = Math.max(0, Math.min(1, value)) * 0.6;
            },
          };

          window.MediaRecorder = NativeMediaRecorder;

          const devices = navigator.mediaDevices;
          if (devices?.getUserMedia) {
            const original = devices.getUserMedia.bind(devices);
            devices.getUserMedia = async (constraints) => {
              // Video still goes to WebKit; only microphone capture moves native.
              if (!constraints?.audio || constraints?.video) {
                return original(constraints);
              }
              return makeSyntheticStream();
            };
          }

          // Playback is left alone on purpose: iOS publishes its own Now Playing
          // card for it, which already carries the title, elapsed and remaining
          // time, and transport controls.

          post("ready");
        })();
        """#
}
