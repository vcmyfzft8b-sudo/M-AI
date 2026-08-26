// Kept free of imports so the header contract stays unit-testable (tests/wav-duration.test.mjs).
//
// Duration for uncompressed audio has to come from the file itself, because the browser is not a
// reliable reader of it: 24-bit and float PCM exports — what recorders, Audacity and lecture
// capture tools produce by default — are refused outright by Safari and Chrome, so an <audio>
// element yields no metadata at all. That refusal used to reach the user as "could not read the
// file's duration" and turned away a perfectly good one-hour recording.

/** Chunk headers sit at the front of the file; reading past this buys nothing. */
const WAV_HEADER_SCAN_BYTES = 64 * 1024;
/** Bytes of a canonical RIFF header, used when the data chunk sits past the scanned window. */
const CANONICAL_WAV_HEADER_BYTES = 44;

function readAsciiTag(view: DataView, offset: number) {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

/**
 * Duration from the RIFF header — bytes of audio divided by bytes per second — which every WAV
 * carries whether or not a decoder exists for its sample format. WAVE_FORMAT_EXTENSIBLE and IEEE
 * float come along for free, since both keep the same `fmt ` layout.
 *
 * Returns null for anything that is not a readable WAV, so the caller can try something else
 * rather than treat a guess as a measurement.
 */
export async function readWavDurationSeconds(file: File): Promise<number | null> {
  try {
    const header = await file.slice(0, Math.min(WAV_HEADER_SCAN_BYTES, file.size)).arrayBuffer();
    const view = new DataView(header);

    if (
      view.byteLength < CANONICAL_WAV_HEADER_BYTES ||
      readAsciiTag(view, 0) !== "RIFF" ||
      readAsciiTag(view, 8) !== "WAVE"
    ) {
      return null;
    }

    let offset = 12;
    let bytesPerSecond = 0;

    while (offset + 8 <= view.byteLength) {
      const chunkId = readAsciiTag(view, offset);
      const chunkSize = view.getUint32(offset + 4, true);
      const payloadOffset = offset + 8;

      if (chunkId === "fmt " && payloadOffset + 12 <= view.byteLength) {
        bytesPerSecond = view.getUint32(payloadOffset + 8, true);
      }

      if (chunkId === "data") {
        if (bytesPerSecond <= 0) {
          return null;
        }

        // A recorder killed mid-write still declares the size it meant to reach, so the file's
        // real length wins whenever the declared size cannot be true. Believing the claim would
        // report hours of audio that is not there and could trip the duration limit.
        const availableSize = file.size - payloadOffset;
        const dataSize = chunkSize > 0 && chunkSize <= availableSize ? chunkSize : availableSize;

        return dataSize > 0 ? dataSize / bytesPerSecond : null;
      }

      // Chunks are word-aligned: an odd size is followed by a pad byte that belongs to neither.
      offset = payloadOffset + chunkSize + (chunkSize % 2);
    }

    // The data chunk sits past the window we read (a long LIST or bext block). Everything after
    // a canonical header is audio to within a rounding error at this scale.
    return bytesPerSecond > 0
      ? Math.max(file.size - CANONICAL_WAV_HEADER_BYTES, 0) / bytesPerSecond
      : null;
  } catch {
    return null;
  }
}
