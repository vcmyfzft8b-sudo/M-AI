"use client";

import {
  MAX_AUDIO_BYTES,
  MAX_DOCUMENT_BYTES,
  MAX_SCAN_IMAGE_BYTES,
} from "@/lib/constants";
import {
  getLowercaseExtension,
  isDocxDocument,
  isHtmlDocument,
  isPdfDocument,
  isPlainTextDocument,
  isPptxDocument,
  isRtfDocument,
} from "@/lib/document-files";
import {
  getExtensionForMimeType,
  normalizeUploadAudioMimeType,
} from "@/lib/storage";
import type JSZip from "jszip";

const COMPRESSED_IMAGE_MIME_TYPE = "image/jpeg";
const MAX_COMPRESSIBLE_SCAN_IMAGE_BYTES = 120 * 1024 * 1024;
const MAX_COMPRESSIBLE_DOCUMENT_BYTES = 250 * 1024 * 1024;
// Mounting the source file into ffmpeg's worker FS reads it from disk instead of copying it into
// the wasm heap, so the ceiling is set by output size, not input size. A 3-hour lossless WAV is
// ~1.9 GB in and ~65 MB of mono 16 kHz mp3 out.
const MAX_COMPRESSIBLE_AUDIO_BYTES = 2 * 1024 * 1024 * 1024;

// Lossless and uncompressed formats are transcoded even when they fit the upload cap: a 200 MB
// WAV is a slow, failure-prone upload that turns into ~15 MB of mp3 with nothing the
// transcription model cares about lost.
const BULKY_AUDIO_TRANSCODE_THRESHOLD_BYTES = 25 * 1024 * 1024;
const BULKY_AUDIO_MIME_TYPES = new Set([
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/aiff",
  "audio/x-aiff",
  "audio/flac",
  "audio/x-flac",
  "audio/x-caf",
]);
const DOCUMENT_TEXT_TRUNCATION_MARKER =
  "\n\n[Dokument je bil skrajsan, ker je presegal tehnicno omejitev nalaganja.]\n";
const PDF_RENDER_BACKGROUND = "#ffffff";

type CompressionResult = {
  file: File;
  compressed: boolean;
};

type RasterCompressionProfile = {
  maxDimension: number;
  quality: number;
};

const SCAN_IMAGE_PROFILES: RasterCompressionProfile[] = [
  { maxDimension: 2600, quality: 0.82 },
  { maxDimension: 2200, quality: 0.74 },
  { maxDimension: 1800, quality: 0.66 },
  { maxDimension: 1500, quality: 0.58 },
  { maxDimension: 1200, quality: 0.5 },
  { maxDimension: 960, quality: 0.44 },
  { maxDimension: 720, quality: 0.36 },
  { maxDimension: 540, quality: 0.28 },
  { maxDimension: 360, quality: 0.2 },
  { maxDimension: 240, quality: 0.14 },
];

const OFFICE_IMAGE_PROFILES: RasterCompressionProfile[] = [
  { maxDimension: 1800, quality: 0.78 },
  { maxDimension: 1500, quality: 0.68 },
  { maxDimension: 1200, quality: 0.58 },
  { maxDimension: 960, quality: 0.5 },
  { maxDimension: 720, quality: 0.4 },
  { maxDimension: 540, quality: 0.32 },
  { maxDimension: 360, quality: 0.24 },
  { maxDimension: 240, quality: 0.16 },
  { maxDimension: 160, quality: 0.1 },
];

const PDF_PROFILES: RasterCompressionProfile[] = [
  { maxDimension: 1500, quality: 0.72 },
  { maxDimension: 1200, quality: 0.62 },
  { maxDimension: 1000, quality: 0.54 },
  { maxDimension: 820, quality: 0.46 },
  { maxDimension: 640, quality: 0.36 },
  { maxDimension: 520, quality: 0.3 },
  { maxDimension: 420, quality: 0.24 },
  { maxDimension: 320, quality: 0.18 },
  { maxDimension: 240, quality: 0.13 },
  { maxDimension: 180, quality: 0.1 },
  { maxDimension: 120, quality: 0.08 },
  { maxDimension: 90, quality: 0.06 },
];

function cleanFileBaseName(fileName: string) {
  return fileName.replace(/\.[^.]+$/i, "") || "file";
}

function createCompressedFileName(fileName: string, extension: string) {
  return `${cleanFileBaseName(fileName)}.${extension}`;
}

function formatMegabytes(bytes: number) {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

function fileTooLargeMessage(kind: "audio" | "document" | "photo", maxBytes: number) {
  if (kind === "audio") {
    return `Zvočna datoteka je tudi po stiskanju prevelika. Največja velikost je ${formatMegabytes(maxBytes)}.`;
  }

  if (kind === "photo") {
    return `Slika je tudi po stiskanju prevelika. Največja velikost je ${formatMegabytes(maxBytes)}.`;
  }

  return `Dokumenta po stiskanju ni bilo mogoče pripraviti v dovolj berljivi obliki za obdelavo. Poskusi z jasnejsim ali krajsim dokumentom.`;
}

function unsupportedCompressionMessage(kind: "audio" | "document" | "photo") {
  if (kind === "audio") {
    return "Zvočne datoteke ni bilo mogoče stisniti dovolj. Poskusi s krajšo ali že stisnjeno datoteko.";
  }

  if (kind === "photo") {
    return "Slike ni bilo mogoče stisniti dovolj. Poskusi z manjšo fotografijo ali formatom JPG/WebP.";
  }

  return "Dokumenta ni bilo mogoče pripraviti za obdelavo. Poskusi ga izvoziti kot PDF ali odstrani elemente, ki niso del gradiva.";
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

async function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Slike ni bilo mogoče stisniti."));
          return;
        }

        resolve(blob);
      },
      type,
      quality,
    );
  });
}

async function loadImageBitmap(blob: Blob) {
  try {
    return await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch {
    const objectUrl = URL.createObjectURL(blob);

    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error("Slike ni bilo mogoče prebrati."));
        element.src = objectUrl;
      });

      return image;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }
}

async function renderRasterBlobToJpeg(
  blob: Blob,
  profile: RasterCompressionProfile,
) {
  const source = await loadImageBitmap(blob);
  const width = source.width;
  const height = source.height;

  if (width <= 0 || height <= 0) {
    throw new Error("Slike ni bilo mogoče prebrati.");
  }

  const scale = Math.min(1, profile.maxDimension / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Slike ni bilo mogoče stisniti.");
  }

  context.fillStyle = PDF_RENDER_BACKGROUND;
  context.fillRect(0, 0, targetWidth, targetHeight);
  context.drawImage(source, 0, 0, targetWidth, targetHeight);

  if ("close" in source && typeof source.close === "function") {
    source.close();
  }

  return canvasToBlob(canvas, COMPRESSED_IMAGE_MIME_TYPE, profile.quality);
}

async function compressRasterImageFile(params: {
  file: File;
  maxBytes: number;
  profiles: RasterCompressionProfile[];
  kind: "photo" | "document";
}) {
  if (params.file.size <= params.maxBytes) {
    return {
      file: params.file,
      compressed: false,
    };
  }

  const maxCompressibleBytes =
    params.kind === "photo"
      ? MAX_COMPRESSIBLE_SCAN_IMAGE_BYTES
      : MAX_COMPRESSIBLE_DOCUMENT_BYTES;

  if (params.file.size > maxCompressibleBytes) {
    throw new Error(fileTooLargeMessage(params.kind, params.maxBytes));
  }

  let bestBlob: Blob | null = null;

  for (const profile of params.profiles) {
    const blob = await renderRasterBlobToJpeg(params.file, profile);

    if (!bestBlob || blob.size < bestBlob.size) {
      bestBlob = blob;
    }

    if (blob.size <= params.maxBytes) {
      return {
        file: new File(
          [blob],
          createCompressedFileName(params.file.name, "jpg"),
          {
            type: COMPRESSED_IMAGE_MIME_TYPE,
            lastModified: Date.now(),
          },
        ),
        compressed: true,
      };
    }
  }

  if (bestBlob && bestBlob.size < params.file.size && bestBlob.size <= params.maxBytes) {
    return {
      file: new File([bestBlob], createCompressedFileName(params.file.name, "jpg"), {
        type: COMPRESSED_IMAGE_MIME_TYPE,
        lastModified: Date.now(),
      }),
      compressed: true,
    };
  }

  throw new Error(fileTooLargeMessage(params.kind, params.maxBytes));
}

function isCanvasCompressibleImage(file: File) {
  const extension = getLowercaseExtension(file.name);
  return (
    ["jpg", "jpeg", "png", "webp", "bmp"].includes(extension) ||
    ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/bmp"].includes(
      file.type.toLowerCase(),
    )
  );
}

export async function compressScanImageForUpload(file: File): Promise<CompressionResult> {
  if (file.size <= MAX_SCAN_IMAGE_BYTES) {
    return {
      file,
      compressed: false,
    };
  }

  if (!isCanvasCompressibleImage(file)) {
    throw new Error(unsupportedCompressionMessage("photo"));
  }

  return compressRasterImageFile({
    file,
    maxBytes: MAX_SCAN_IMAGE_BYTES,
    profiles: SCAN_IMAGE_PROFILES,
    kind: "photo",
  });
}

async function generateZipBlob(zip: JSZip) {
  return zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: {
      level: 9,
    },
  });
}

function getOfficeMediaPaths(zip: JSZip, file: File) {
  const paths: string[] = [];
  const mediaPattern = isPptxDocument(file)
    ? /^ppt\/media\/[^/]+\.(?:jpe?g|png|webp|bmp)$/i
    : /^word\/media\/[^/]+\.(?:jpe?g|png|webp|bmp)$/i;

  zip.forEach((path, entry) => {
    if (!entry.dir && mediaPattern.test(path)) {
      paths.push(path);
    }
  });

  return paths;
}

function getOfficeRemovableBulkPaths(zip: JSZip, file: File) {
  const paths: string[] = [];
  const removablePattern = isPptxDocument(file)
    ? /^(?:docProps\/thumbnail\.[^/]+|ppt\/embeddings\/.+|ppt\/media\/[^/]+\.(?:mp4|m4v|mov|avi|wmv|mp3|m4a|wav|aiff?|caf|zip|bin))$/i
    : /^(?:docProps\/thumbnail\.[^/]+|word\/embeddings\/.+|word\/media\/[^/]+\.(?:mp4|m4v|mov|avi|wmv|mp3|m4a|wav|aiff?|caf|zip|bin))$/i;

  zip.forEach((path, entry) => {
    if (!entry.dir && removablePattern.test(path)) {
      paths.push(path);
    }
  });

  return paths;
}

async function compressOfficeDocument(file: File): Promise<CompressionResult> {
  if (file.size > MAX_COMPRESSIBLE_DOCUMENT_BYTES) {
    throw new Error(fileTooLargeMessage("document", MAX_DOCUMENT_BYTES));
  }

  const { default: JSZip } = await import("jszip");
  const originalBytes = await file.arrayBuffer();
  const recompressedZip = await JSZip.loadAsync(originalBytes);
  const recompressedBlob = await generateZipBlob(recompressedZip);

  if (recompressedBlob.size <= MAX_DOCUMENT_BYTES) {
    return {
      file: new File([recompressedBlob], file.name, {
        type: file.type,
        lastModified: Date.now(),
      }),
      compressed: true,
    };
  }

  const mediaPaths = getOfficeMediaPaths(recompressedZip, file);
  const removablePaths = getOfficeRemovableBulkPaths(recompressedZip, file);

  if (removablePaths.length > 0) {
    const strippedZip = await JSZip.loadAsync(originalBytes);

    for (const removablePath of removablePaths) {
      strippedZip.remove(removablePath);
    }

    const strippedBlob = await generateZipBlob(strippedZip);

    if (strippedBlob.size <= MAX_DOCUMENT_BYTES) {
      return {
        file: new File([strippedBlob], file.name, {
          type: file.type,
          lastModified: Date.now(),
        }),
        compressed: true,
      };
    }
  }

  for (const profile of OFFICE_IMAGE_PROFILES) {
    const zip = await JSZip.loadAsync(originalBytes);

    for (const removablePath of removablePaths) {
      zip.remove(removablePath);
    }

    await Promise.all(
      mediaPaths.map(async (mediaPath) => {
        const entry = zip.file(mediaPath);

        if (!entry) {
          return;
        }

        const originalBlob = new Blob([await entry.async("arraybuffer")]);
        const compressedBlob = await renderRasterBlobToJpeg(originalBlob, profile).catch(() => null);

        if (!compressedBlob || compressedBlob.size >= originalBlob.size) {
          return;
        }

        zip.file(mediaPath, compressedBlob);
      }),
    );

    const compressedBlob = await generateZipBlob(zip);

    if (compressedBlob.size <= MAX_DOCUMENT_BYTES) {
      return {
        file: new File([compressedBlob], file.name, {
          type: file.type,
          lastModified: Date.now(),
        }),
        compressed: true,
      };
    }
  }

  // Last resort: drop the media outright. The pipeline reads only the text XML out of office
  // files, so a deck whose photos cannot be re-encoded small enough (HEIC, EMF, huge TIFFs)
  // still produces full notes — losing decorative images beats rejecting the whole file.
  const textOnlyZip = await JSZip.loadAsync(originalBytes);

  for (const removablePath of removablePaths) {
    textOnlyZip.remove(removablePath);
  }

  for (const mediaPath of mediaPaths) {
    textOnlyZip.remove(mediaPath);
  }

  const textOnlyBlob = await generateZipBlob(textOnlyZip);

  if (textOnlyBlob.size <= MAX_DOCUMENT_BYTES) {
    return {
      file: new File([textOnlyBlob], file.name, {
        type: file.type,
        lastModified: Date.now(),
      }),
      compressed: true,
    };
  }

  throw new Error(fileTooLargeMessage("document", MAX_DOCUMENT_BYTES));
}

function truncateTextToBytes(text: string, maxBytes: number) {
  const encoder = new TextEncoder();
  const markerBytes = encoder.encode(DOCUMENT_TEXT_TRUNCATION_MARKER).length;
  const targetBytes = Math.max(0, maxBytes - markerBytes - 1024);
  let low = 0;
  let high = text.length;

  while (low < high) {
    const midpoint = Math.ceil((low + high) / 2);

    if (encoder.encode(text.slice(0, midpoint)).length <= targetBytes) {
      low = midpoint;
    } else {
      high = midpoint - 1;
    }
  }

  return `${text.slice(0, low)}${DOCUMENT_TEXT_TRUNCATION_MARKER}`;
}

async function compressTextDocument(file: File): Promise<CompressionResult> {
  const text = await file.text();
  const truncatedText = truncateTextToBytes(text, MAX_DOCUMENT_BYTES);
  const type = file.type || "text/plain";
  const compressedFile = new File([truncatedText], file.name, {
    type,
    lastModified: Date.now(),
  });

  if (compressedFile.size > MAX_DOCUMENT_BYTES) {
    throw new Error(fileTooLargeMessage("document", MAX_DOCUMENT_BYTES));
  }

  return {
    file: compressedFile,
    compressed: true,
  };
}

type PdfPageImage = {
  bytes: Uint8Array;
  pixelWidth: number;
  pixelHeight: number;
  pageWidth: number;
  pageHeight: number;
};

function textBytes(value: string) {
  return new TextEncoder().encode(value);
}

function concatBytes(parts: Uint8Array[]) {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;

  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }

  return output;
}

function formatPdfNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function buildImageOnlyPdf(images: PdfPageImage[]) {
  const parts: Uint8Array[] = [textBytes("%PDF-1.4\n")];
  const offsets: number[] = [0];
  let offset = parts[0].length;

  const push = (part: Uint8Array) => {
    parts.push(part);
    offset += part.length;
  };

  const addObject = (id: number, bodyParts: Uint8Array[]) => {
    offsets[id] = offset;
    push(textBytes(`${id} 0 obj\n`));
    for (const bodyPart of bodyParts) {
      push(bodyPart);
    }
    push(textBytes("\nendobj\n"));
  };

  const objectCount = 2 + images.length * 3;
  const pageObjectIds = images.map((_, index) => 3 + index * 3);
  const imageObjectIds = images.map((_, index) => 4 + index * 3);
  const contentObjectIds = images.map((_, index) => 5 + index * 3);

  addObject(1, [textBytes("<< /Type /Catalog /Pages 2 0 R >>")]);
  addObject(2, [
    textBytes(
      `<< /Type /Pages /Count ${images.length} /Kids [${pageObjectIds
        .map((id) => `${id} 0 R`)
        .join(" ")}] >>`,
    ),
  ]);

  images.forEach((image, index) => {
    const pageId = pageObjectIds[index];
    const imageId = imageObjectIds[index];
    const contentId = contentObjectIds[index];
    const imageName = `Im${index + 1}`;
    const width = formatPdfNumber(image.pageWidth);
    const height = formatPdfNumber(image.pageHeight);
    const content = textBytes(`q\n${width} 0 0 ${height} 0 0 cm\n/${imageName} Do\nQ\n`);

    addObject(pageId, [
      textBytes(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /${imageName} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`,
      ),
    ]);
    addObject(imageId, [
      textBytes(
        `<< /Type /XObject /Subtype /Image /Width ${image.pixelWidth} /Height ${image.pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`,
      ),
      image.bytes,
      textBytes("\nendstream"),
    ]);
    addObject(contentId, [
      textBytes(`<< /Length ${content.length} >>\nstream\n`),
      content,
      textBytes("endstream"),
    ]);
  });

  const xrefOffset = offset;
  const xrefRows = ["xref", `0 ${objectCount + 1}`, "0000000000 65535 f "];

  for (let id = 1; id <= objectCount; id += 1) {
    xrefRows.push(`${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n `);
  }

  push(textBytes(`${xrefRows.join("\n")}\n`));
  push(
    textBytes(
      `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
    ),
  );

  return new Blob([concatBytes(parts)], { type: "application/pdf" });
}

async function renderPdfAsJpegPages(sourceBytes: Uint8Array, profile: RasterCompressionProfile) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.mjs",
    import.meta.url,
  ).toString();

  const loadingTask = pdfjs.getDocument({
    data: sourceBytes.slice(),
    useWorkerFetch: false,
    isEvalSupported: false,
  });
  const pdfDocument = await loadingTask.promise;
  const pages: PdfPageImage[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      const page = await pdfDocument.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(
        2,
        profile.maxDimension / Math.max(baseViewport.width, baseViewport.height),
      );
      const viewport = page.getViewport({ scale });
      const canvas = window.document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));

      const context = canvas.getContext("2d");

      if (!context) {
        throw new Error("PDF-ja ni bilo mogoče stisniti.");
      }

      context.fillStyle = PDF_RENDER_BACKGROUND;
      context.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({
        canvas,
        canvasContext: context,
        viewport,
        background: PDF_RENDER_BACKGROUND,
      }).promise;

      const blob = await canvasToBlob(canvas, COMPRESSED_IMAGE_MIME_TYPE, profile.quality);

      pages.push({
        bytes: new Uint8Array(await blob.arrayBuffer()),
        pixelWidth: canvas.width,
        pixelHeight: canvas.height,
        pageWidth: baseViewport.width,
        pageHeight: baseViewport.height,
      });

      page.cleanup();
    }
  } finally {
    await pdfDocument.cleanup();
    await pdfDocument.destroy();
    await loadingTask.destroy();
  }

  return pages;
}

async function compressPdfDocument(file: File): Promise<CompressionResult> {
  if (file.size > MAX_COMPRESSIBLE_DOCUMENT_BYTES) {
    throw new Error(fileTooLargeMessage("document", MAX_DOCUMENT_BYTES));
  }

  const sourceBytes = new Uint8Array(await file.arrayBuffer());

  for (const profile of PDF_PROFILES) {
    const pages = await renderPdfAsJpegPages(sourceBytes, profile);
    const blob = buildImageOnlyPdf(pages);

    if (blob.size <= MAX_DOCUMENT_BYTES) {
      return {
        file: new File([blob], createCompressedFileName(file.name, "pdf"), {
          type: "application/pdf",
          lastModified: Date.now(),
        }),
        compressed: true,
      };
    }
  }

  throw new Error(fileTooLargeMessage("document", MAX_DOCUMENT_BYTES));
}

export async function compressDocumentForUpload(file: File): Promise<CompressionResult> {
  if (file.size <= MAX_DOCUMENT_BYTES) {
    return {
      file,
      compressed: false,
    };
  }

  try {
    if (isPlainTextDocument(file) || isHtmlDocument(file) || isRtfDocument(file)) {
      return await compressTextDocument(file);
    }

    if (isPdfDocument(file)) {
      return await compressPdfDocument(file);
    }

    if (isDocxDocument(file) || isPptxDocument(file)) {
      return await compressOfficeDocument(file);
    }

    if (isCanvasCompressibleImage(file)) {
      return await compressRasterImageFile({
        file,
        maxBytes: MAX_DOCUMENT_BYTES,
        profiles: SCAN_IMAGE_PROFILES,
        kind: "document",
      });
    }
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    if (error instanceof Error) {
      throw error;
    }
  }

  throw new Error(unsupportedCompressionMessage("document"));
}

function isBulkyAudioFile(file: File) {
  const normalizedMimeType = normalizeUploadAudioMimeType({
    mimeType: file.type || "application/octet-stream",
    fileName: file.name,
  });

  return BULKY_AUDIO_MIME_TYPES.has(normalizedMimeType);
}

export async function compressAudioForUpload(file: File): Promise<CompressionResult> {
  const needsTranscode =
    file.size > MAX_AUDIO_BYTES ||
    (isBulkyAudioFile(file) && file.size > BULKY_AUDIO_TRANSCODE_THRESHOLD_BYTES);

  if (!needsTranscode) {
    return {
      file,
      compressed: false,
    };
  }

  if (file.size > MAX_COMPRESSIBLE_AUDIO_BYTES) {
    throw new Error(fileTooLargeMessage("audio", MAX_AUDIO_BYTES));
  }

  try {
    const { FFmpeg } = await import("@ffmpeg/ffmpeg");
    const ffmpeg = new FFmpeg();
    const coreBaseUrl = "/vendor/ffmpeg";

    await ffmpeg.load({
      coreURL: `${coreBaseUrl}/ffmpeg-core.js`,
      wasmURL: `${coreBaseUrl}/ffmpeg-core.wasm`,
    });

    const outputMimeType = "audio/mpeg";
    const outputExtension = getExtensionForMimeType(outputMimeType);
    // WORKERFS mounts the browser File directly: ffmpeg streams it from disk instead of holding
    // a full copy in the wasm heap, which is what limited the old path to mid-size files.
    const inputDirectory = `/compress-input-${crypto.randomUUID()}`;
    const outputPath = `/output-${crypto.randomUUID()}.${outputExtension}`;
    const workerFsType = "WORKERFS" as Parameters<typeof ffmpeg.mount>[0];

    const mountedFile = file.name
      ? file
      : new File([file], `audio-${Date.now()}.bin`, { type: file.type });

    try {
      await ffmpeg.createDir(inputDirectory);
      await ffmpeg.mount(workerFsType, { files: [mountedFile] }, inputDirectory);

      const exitCode = await ffmpeg.exec([
        "-i",
        `${inputDirectory}/${mountedFile.name}`,
        "-map",
        "0:a:0",
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-b:a",
        "48k",
        "-c:a",
        "libmp3lame",
        outputPath,
      ]);

      if (exitCode !== 0) {
        throw new Error("Audio compression failed.");
      }

      const bytes = await ffmpeg.readFile(outputPath);

      if (!(bytes instanceof Uint8Array)) {
        throw new Error("Compressed audio could not be read.");
      }

      const compressedFile = new File(
        [bytes.slice().buffer],
        createCompressedFileName(file.name, outputExtension),
        {
          type: outputMimeType,
          lastModified: Date.now(),
        },
      );

      if (compressedFile.size > MAX_AUDIO_BYTES) {
        throw new Error(fileTooLargeMessage("audio", MAX_AUDIO_BYTES));
      }

      return {
        file: compressedFile,
        compressed: true,
      };
    } finally {
      await ffmpeg.deleteFile(outputPath).catch(() => null);
      await ffmpeg.unmount(inputDirectory).catch(() => null);
      await ffmpeg.deleteDir(inputDirectory).catch(() => null);
    }
  } catch (error) {
    if (error instanceof Error && error.message === fileTooLargeMessage("audio", MAX_AUDIO_BYTES)) {
      throw error;
    }

    throw new Error(unsupportedCompressionMessage("audio"));
  }
}
