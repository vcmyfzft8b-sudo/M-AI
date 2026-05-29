"use client";

import {
  MAX_AUDIO_BYTES,
  MAX_DOCUMENT_BYTES,
  MAX_SCAN_IMAGE_BYTES,
} from "@/lib/constants";
import {
  getLowercaseExtension,
  isDocxDocument,
  isPdfDocument,
  isPptxDocument,
} from "@/lib/document-files";
import {
  getExtensionForMimeType,
  normalizeUploadAudioMimeType,
} from "@/lib/storage";
import type JSZip from "jszip";

const COMPRESSED_IMAGE_MIME_TYPE = "image/jpeg";
const MAX_COMPRESSIBLE_SCAN_IMAGE_BYTES = 40 * 1024 * 1024;
const MAX_COMPRESSIBLE_DOCUMENT_BYTES = 60 * 1024 * 1024;
const MAX_COMPRESSIBLE_AUDIO_BYTES = 650 * 1024 * 1024;
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
];

const OFFICE_IMAGE_PROFILES: RasterCompressionProfile[] = [
  { maxDimension: 1800, quality: 0.78 },
  { maxDimension: 1500, quality: 0.68 },
  { maxDimension: 1200, quality: 0.58 },
  { maxDimension: 960, quality: 0.5 },
];

const PDF_PROFILES: RasterCompressionProfile[] = [
  { maxDimension: 1500, quality: 0.72 },
  { maxDimension: 1200, quality: 0.62 },
  { maxDimension: 1000, quality: 0.54 },
  { maxDimension: 820, quality: 0.46 },
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

  return `Dokument je tudi po stiskanju prevelik. Največja velikost je ${formatMegabytes(maxBytes)}.`;
}

function unsupportedCompressionMessage(kind: "audio" | "document" | "photo") {
  if (kind === "audio") {
    return "Zvočne datoteke ni bilo mogoče stisniti dovolj. Poskusi s krajšo ali že stisnjeno datoteko.";
  }

  if (kind === "photo") {
    return "Slike ni bilo mogoče stisniti dovolj. Poskusi z manjšo fotografijo ali formatom JPG/WebP.";
  }

  return "Dokumenta ni bilo mogoče stisniti dovolj. Poskusi izvoziti manjšo datoteko ali odstrani velike slike.";
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

  if (mediaPaths.length === 0) {
    throw new Error(unsupportedCompressionMessage("document"));
  }

  for (const profile of OFFICE_IMAGE_PROFILES) {
    const zip = await JSZip.loadAsync(originalBytes);
    let compressedAnyImage = false;

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
        compressedAnyImage = true;
      }),
    );

    if (!compressedAnyImage) {
      continue;
    }

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

  throw new Error(fileTooLargeMessage("document", MAX_DOCUMENT_BYTES));
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

async function renderPdfAsJpegPages(file: File, profile: RasterCompressionProfile) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.mjs",
    import.meta.url,
  ).toString();

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
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

  for (const profile of PDF_PROFILES) {
    const pages = await renderPdfAsJpegPages(file, profile);
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

export async function compressAudioForUpload(file: File): Promise<CompressionResult> {
  if (file.size <= MAX_AUDIO_BYTES) {
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

    const normalizedMimeType = normalizeUploadAudioMimeType({
      mimeType: file.type || "application/octet-stream",
      fileName: file.name,
    });
    const inputExtension = getExtensionForMimeType(normalizedMimeType);
    const outputMimeType = "audio/mpeg";
    const outputExtension = getExtensionForMimeType(outputMimeType);
    const inputPath = `/input-${crypto.randomUUID()}.${inputExtension}`;
    const outputPath = `/output-${crypto.randomUUID()}.${outputExtension}`;

    try {
      await ffmpeg.writeFile(inputPath, new Uint8Array(await file.arrayBuffer()));
      const exitCode = await ffmpeg.exec([
        "-i",
        inputPath,
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
      await ffmpeg.deleteFile(inputPath).catch(() => null);
      await ffmpeg.deleteFile(outputPath).catch(() => null);
    }
  } catch (error) {
    if (error instanceof Error && error.message === fileTooLargeMessage("audio", MAX_AUDIO_BYTES)) {
      throw error;
    }

    throw new Error(unsupportedCompressionMessage("audio"));
  }
}
