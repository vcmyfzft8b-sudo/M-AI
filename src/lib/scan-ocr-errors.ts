import type { ScanOcrRejection } from "./scan-ocr-text.ts";

export type ScanOcrAttemptDiagnostics = {
  acceptable: boolean | null;
  errorMessage: string | null;
  maxOutputTokens: number;
  mediaResolution: "medium" | "high";
  model: string;
  outputLength: number | null;
  /** Which rule turned this reading down, so a rejection is diagnosable from the row alone. */
  rejection: ScanOcrRejection | null;
  stage: "ocr_primary" | "ocr_rescue";
};

export type ScanOcrImageDiagnostics = {
  attempts: ScanOcrAttemptDiagnostics[];
  fileName: string;
  imageIndex: number | null;
  mimeType: string;
  sizeBytes: number;
};

export type ScanOcrDiagnostics = {
  imageCount: number;
  images: ScanOcrImageDiagnostics[];
  readableImageCount: number;
  skippedImageCount: number;
};

/**
 * One verdict for a whole set of photos.
 *
 * A single photo that yielded real but sparse text is enough to make "add more material" the
 * right advice: we did read the page, there was just not much on it. Only when nothing anywhere
 * produced usable text is the honest answer that the photos could not be read.
 */
export function resolveScanOcrRejection(
  images: ScanOcrImageDiagnostics[] | undefined,
): ScanOcrRejection {
  const sawSparseText = (images ?? []).some((image) =>
    image.attempts.some((attempt) => attempt.rejection === "too_short"),
  );

  return sawSparseText ? "too_short" : "unreadable";
}

const SCAN_REJECTION_MESSAGES: Record<ScanOcrRejection, string> = {
  too_short: "Na fotografijah je bilo premalo besedila za zapiske.",
  unreadable: "Na fotografiji ni bilo mogoče najti dovolj berljivega besedila.",
};

export class NoReadableScanTextError extends Error {
  diagnostics: ScanOcrDiagnostics;
  readonly reason: ScanOcrRejection;

  /*
   * The message is in the source language on purpose: it is what Sentry, the
   * triage automation and the lecture row record. A learner never reads it —
   * the screens resolve the code this error maps to (`scan_not_enough_text`
   * or `scan_text_too_short`) into their own language instead.
   *
   * The reason is derived from the diagnostics rather than passed in, so no
   * call site can raise this with a verdict its own evidence contradicts.
   */
  constructor(diagnostics: ScanOcrDiagnostics) {
    const reason = resolveScanOcrRejection(diagnostics.images);

    super(SCAN_REJECTION_MESSAGES[reason]);
    this.name = "NoReadableScanTextError";
    this.diagnostics = diagnostics;
    this.reason = reason;
  }
}
