import { z } from "zod";

import { APPLICATION_COUNTRIES, OTHER_COUNTRY, marketForCountry } from "./creator-program.ts";

/**
 * What the apply form at `/ugc` sends, checked the same way in the browser (per step,
 * so a mistake is shown where it was made) and on the server (all at once, because the
 * browser can be skipped).
 *
 * Every field the form asks for is named here, so `ApplicationField` doubles as the key
 * for the form's error messages.
 */

/** The private bucket sample videos are uploaded into. Created by migration 0058. */
export const APPLICATION_VIDEO_BUCKET = "ugc-application-videos";

/** Matches the bucket's own `file_size_limit`, so the browser can refuse before uploading. */
export const APPLICATION_VIDEO_MAX_BYTES = 200 * 1024 * 1024;

/** What phones record, mapped to the extension the stored object gets. */
export const APPLICATION_VIDEO_TYPES: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-m4v": "m4v",
  "video/3gpp": "3gp",
};

/** Where an upload lands: `pending/<uuid>.<ext>`. The server makes the name; the form only echoes it. */
export const APPLICATION_VIDEO_PATH = /^pending\/[0-9a-f-]{36}\.(?:mp4|mov|webm|m4v|3gp)$/;

/** A TikTok or Instagram username: what the form keeps from `@name`, `name` or a profile link. */
const HANDLE = /^[A-Za-z0-9._]{1,30}$/;

export function normalizeHandle(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  // A pasted profile link: keep the first path segment, without the "@".
  const fromUrl = trimmed.match(/^(?:https?:\/\/)?(?:[\w-]+\.)*(?:tiktok|instagram)\.com\/@?([^/?#\s]+)/i);

  return (fromUrl ? fromUrl[1] : trimmed).replace(/^@+/, "");
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || null);

const optionalHandle = z
  .string()
  .transform(normalizeHandle)
  .refine((value) => value === "" || HANDLE.test(value))
  .transform((value) => value || null);

export const applicationSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120),
    email: z.string().trim().toLowerCase().max(254).email(),
    country: z.enum([...APPLICATION_COUNTRIES, OTHER_COUNTRY]),
    age: z.coerce.number().int().min(13).max(99),
    phone: z
      .string()
      .trim()
      .max(40)
      .refine((value) => value === "" || /^\+?[0-9 ()./-]{6,}$/.test(value))
      .transform((value) => value || null),
    studies: optionalText(160),
    tiktok: optionalHandle,
    instagram: optionalHandle,
    sampleVideoPath: z
      .string()
      .refine((value) => value === "" || APPLICATION_VIDEO_PATH.test(value))
      .transform((value) => value || null),
    sampleVideoUrl: z
      .string()
      .trim()
      .max(500)
      .refine((value) => value === "" || /^https?:\/\/[^\s]+\.[^\s]+/i.test(value))
      .transform((value) => value || null),
    message: optionalText(1000),
    consent: z.literal(true),
  })
  // The video is the application: an upload, a link, or both, but never neither.
  .refine((value) => value.sampleVideoPath || value.sampleVideoUrl, { path: ["sampleVideo"] });

export type ApplicationInput = z.input<typeof applicationSchema>;
export type Application = z.output<typeof applicationSchema>;

/** The form's fields, plus `sampleVideo` for "neither an upload nor a link". */
export type ApplicationField = keyof ApplicationInput | "sampleVideo";

/** The fields each step of the form asks for, in order. */
export const APPLICATION_STEPS: ReadonlyArray<ReadonlyArray<ApplicationField>> = [
  [],
  ["fullName", "email", "country", "age", "phone", "studies", "tiktok", "instagram"],
  ["sampleVideo", "sampleVideoPath", "sampleVideoUrl", "message"],
  ["consent"],
];

/** The fields that failed, in the order the form shows them. */
export function invalidFields(input: unknown, only?: ReadonlyArray<ApplicationField>): ApplicationField[] {
  const result = applicationSchema.safeParse(input);

  if (result.success) {
    return [];
  }

  const failed = new Set(result.error.issues.map((issue) => issue.path[0] as ApplicationField));

  // An object-level refinement only runs once every field has passed, so while another
  // step still has an error (consent, before the last step) the missing video would go
  // unreported. Checked by hand so each step answers for itself.
  const raw = (input ?? {}) as Record<string, unknown>;
  const filled = (key: string) => typeof raw[key] === "string" && (raw[key] as string).trim() !== "";

  if (!filled("sampleVideoPath") && !filled("sampleVideoUrl")) {
    failed.add("sampleVideo");
  }

  const order = APPLICATION_STEPS.flat();

  return order.filter((field) => failed.has(field) && (!only || only.includes(field)));
}

/** The `?ref=` a shared link carried, kept only when it looks like a tag rather than a payload. */
export function normalizeReferrer(value: unknown): string | null {
  return typeof value === "string" && /^[\w.-]{1,80}$/.test(value) ? value : null;
}

export function marketForApplication(country: string): "si" | "balkans" | "other" {
  return marketForCountry(country) ?? "other";
}

/**
 * A player the admin can embed for a pasted sample-video link, or `null` when the
 * site has no embeddable player we know (the admin then gets a plain link).
 */
export function videoEmbedUrl(link: string): string | null {
  let url: URL;

  try {
    url = new URL(link);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^(www|m|vm)\./, "");

  if (host === "tiktok.com") {
    const id = url.pathname.match(/\/video\/(\d+)/)?.[1];

    return id ? `https://www.tiktok.com/embed/v2/${id}` : null;
  }

  if (host === "instagram.com") {
    const id = url.pathname.match(/\/(?:reel|reels|p|tv)\/([\w-]+)/)?.[1];

    return id ? `https://www.instagram.com/reel/${id}/embed` : null;
  }

  if (host === "youtube.com" || host === "youtu.be") {
    const id =
      host === "youtu.be"
        ? url.pathname.slice(1)
        : (url.searchParams.get("v") ?? url.pathname.match(/\/(?:shorts|embed)\/([\w-]+)/)?.[1]);

    return id && /^[\w-]{6,}$/.test(id) ? `https://www.youtube.com/embed/${id}` : null;
  }

  if (host === "drive.google.com") {
    const id = url.pathname.match(/\/file\/d\/([\w-]+)/)?.[1] ?? url.searchParams.get("id");

    return id ? `https://drive.google.com/file/d/${id}/preview` : null;
  }

  return null;
}
