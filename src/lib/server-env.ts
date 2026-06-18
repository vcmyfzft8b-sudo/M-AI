import "server-only";

import { z } from "zod";

import { DEFAULT_NOTE_TTS_VOICE } from "@/lib/note-tts-settings";
import { getPublicEnv } from "@/lib/public-env";

const trimmedString = z.string().trim();
const optionalTrimmedString = z.string().trim().optional();

const serverEnvSchema = z.object({
  NEXT_PUBLIC_SITE_URL: trimmedString.url().optional(),
  NEXT_PUBLIC_SUPABASE_URL: trimmedString.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: trimmedString.min(1),
  SUPABASE_SERVICE_ROLE_KEY: trimmedString.min(1),
  GEMINI_API_KEY: optionalTrimmedString,
  GEMINI_TEXT_MODEL: trimmedString.default("gemini-2.5-flash-lite"),
  GEMINI_OCR_MODEL: trimmedString.default("gemini-3.1-flash-lite"),
  GEMINI_OCR_RESCUE_MODEL: trimmedString.default("gemini-3-flash-preview"),
  GEMINI_EMBEDDING_MODEL: trimmedString.default("gemini-embedding-001"),
  SONIOX_API_KEY: optionalTrimmedString,
  SONIOX_MODEL: trimmedString.default("stt-async-v4"),
  SONIOX_TTS_MODEL: trimmedString.default("tts-rt-v1-preview"),
  SONIOX_TTS_VOICE: trimmedString.default(DEFAULT_NOTE_TTS_VOICE),
  INNGEST_EVENT_KEY: optionalTrimmedString,
  INNGEST_SIGNING_KEY: optionalTrimmedString,
  INTERNAL_JOB_SECRET: optionalTrimmedString,
  VERCEL_AUTOMATION_BYPASS_SECRET: optionalTrimmedString,
  STRIPE_SECRET_KEY: optionalTrimmedString,
  STRIPE_WEBHOOK_SECRET: optionalTrimmedString,
  STRIPE_PRICE_WEEKLY: optionalTrimmedString,
  STRIPE_PRICE_MONTHLY: optionalTrimmedString,
  STRIPE_PRICE_YEARLY: optionalTrimmedString,
  APPLE_APP_STORE_ENVIRONMENT: trimmedString.default("sandbox"),
  APPLE_BUNDLE_ID: trimmedString.default("eu.memoai.app"),
  APPLE_APP_APPLE_ID: optionalTrimmedString,
  APPLE_ROOT_CERTIFICATES_BASE64: optionalTrimmedString,
  APPLE_IAP_MONTHLY_PRODUCT_ID: trimmedString.default("eu.memoai.pro.monthly"),
  APPLE_IAP_YEARLY_PRODUCT_ID: trimmedString.default("eu.memoai.pro.yearly"),
});

export function getServerEnv() {
  return serverEnvSchema.parse({
    NEXT_PUBLIC_SITE_URL: getPublicEnv().siteUrl,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_TEXT_MODEL: process.env.GEMINI_TEXT_MODEL,
    GEMINI_OCR_MODEL: process.env.GEMINI_OCR_MODEL,
    GEMINI_OCR_RESCUE_MODEL: process.env.GEMINI_OCR_RESCUE_MODEL,
    GEMINI_EMBEDDING_MODEL: process.env.GEMINI_EMBEDDING_MODEL,
    SONIOX_API_KEY: process.env.SONIOX_API_KEY,
    SONIOX_MODEL: process.env.SONIOX_MODEL,
    SONIOX_TTS_MODEL: process.env.SONIOX_TTS_MODEL,
    SONIOX_TTS_VOICE: process.env.SONIOX_TTS_VOICE,
    INNGEST_EVENT_KEY: process.env.INNGEST_EVENT_KEY,
    INNGEST_SIGNING_KEY: process.env.INNGEST_SIGNING_KEY,
    INTERNAL_JOB_SECRET: process.env.INTERNAL_JOB_SECRET,
    VERCEL_AUTOMATION_BYPASS_SECRET: process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    STRIPE_PRICE_WEEKLY: process.env.STRIPE_PRICE_WEEKLY,
    STRIPE_PRICE_MONTHLY: process.env.STRIPE_PRICE_MONTHLY,
    STRIPE_PRICE_YEARLY: process.env.STRIPE_PRICE_YEARLY,
    APPLE_APP_STORE_ENVIRONMENT: process.env.APPLE_APP_STORE_ENVIRONMENT,
    APPLE_BUNDLE_ID: process.env.APPLE_BUNDLE_ID,
    APPLE_APP_APPLE_ID: process.env.APPLE_APP_APPLE_ID,
    APPLE_ROOT_CERTIFICATES_BASE64: process.env.APPLE_ROOT_CERTIFICATES_BASE64,
    APPLE_IAP_MONTHLY_PRODUCT_ID: process.env.APPLE_IAP_MONTHLY_PRODUCT_ID,
    APPLE_IAP_YEARLY_PRODUCT_ID: process.env.APPLE_IAP_YEARLY_PRODUCT_ID,
  });
}

export function hasServerAiEnv() {
  return Boolean(process.env.GEMINI_API_KEY || process.env.SONIOX_API_KEY);
}

export function getAiProvider() {
  return "gemini" as const;
}

export function getTranscriptionProviderName() {
  return "soniox" as const;
}

export function requireGeminiEnv() {
  const env = getServerEnv();

  if (!env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  return env;
}

export function requireSonioxEnv() {
  const env = getServerEnv();

  if (!env.SONIOX_API_KEY) {
    throw new Error("SONIOX_API_KEY is not configured.");
  }

  return env;
}
