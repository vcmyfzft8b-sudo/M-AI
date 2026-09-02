import { NextResponse } from "next/server";
import convert from "heic-convert";
import sharp from "sharp";

import { canConvertScanPreview } from "@/lib/scan-preview";
import { normalizeMimeType } from "@/lib/storage";
import { tr } from "@/lib/i18n/server";

export const runtime = "nodejs";

function isPreviewableScanImage(file: File) {
  const lowerName = file.name.toLowerCase();
  const mimeType = normalizeMimeType(file.type || "");

  return (
    mimeType === "image/heic" ||
    mimeType === "image/heif" ||
    lowerName.endsWith(".heic") ||
    lowerName.endsWith(".heif")
  );
}

async function createScanPreview(file: File) {
  if (!isPreviewableScanImage(file)) {
    throw new Error(await tr("api.noPreviewNeeded"));
  }

  if (!canConvertScanPreview(file.size)) {
    throw new Error(await tr("api.photoTooLargeForPreview"));
  }

  const inputBuffer = Buffer.from(await file.arrayBuffer());
  const convertedBuffer = await convert({
    buffer: inputBuffer,
    format: "JPEG",
    quality: 0.82,
  });
  const previewBuffer = await sharp(convertedBuffer)
    .rotate()
    .resize({
      width: 1600,
      height: 1600,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();

  return previewBuffer;
}

export async function POST(request: Request) {
  const acceptsImagePreview = request.headers.get("accept")?.includes("image/jpeg") ?? false;
  const formData = await request.formData();
  const files = formData
    .getAll("files")
    .filter((file): file is File => file instanceof File);
  const legacyFile = formData.get("file");

  if (files.length === 0 && legacyFile instanceof File) {
    files.push(legacyFile);
  }

  if (files.length === 0) {
    return NextResponse.json({ error: await tr("api.missingPhotoPreview") }, { status: 400 });
  }

  if (files.length > 10) {
    return NextResponse.json({ error: await tr("api.tooManyPhotos") }, { status: 400 });
  }

  try {
    if (acceptsImagePreview && files.length === 1) {
      const previewBuffer = await createScanPreview(files[0]);

      return new NextResponse(new Uint8Array(previewBuffer), {
        headers: {
          "Cache-Control": "no-store",
          "Content-Length": String(previewBuffer.byteLength),
          "Content-Type": "image/jpeg",
        },
      });
    }

    const previews = await Promise.all(
      files.map(async (file, index) => ({
        index,
        previewDataUrl: `data:image/jpeg;base64,${(await createScanPreview(file)).toString("base64")}`,
      })),
    );

    return NextResponse.json(
      {
        previews,
        previewDataUrl: previews[0]?.previewDataUrl ?? "",
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error("Failed to create scan image preview", error);
    return NextResponse.json(
      { error: await tr("api.scanPreviewFailed") },
      { status: 422 },
    );
  }
}
