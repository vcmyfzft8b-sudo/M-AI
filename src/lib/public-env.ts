const previewSiteUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : undefined;

function trimEnv(value: string | undefined) {
  return value?.trim();
}

const publicEnv = {
  siteUrl: trimEnv(process.env.NEXT_PUBLIC_SITE_URL) ?? previewSiteUrl ?? "http://localhost:3000",
  supabaseUrl: trimEnv(process.env.NEXT_PUBLIC_SUPABASE_URL) ?? "",
  supabaseAnonKey: trimEnv(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) ?? "",
} as const;

export const hasPublicSupabaseEnv =
  publicEnv.supabaseUrl.length > 0 && publicEnv.supabaseAnonKey.length > 0;

export function getPublicEnv() {
  return publicEnv;
}
