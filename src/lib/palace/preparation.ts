type Material = { count: number; status?: string | null };

/** Existing question banks are reused; only absent banks need preparation. */
export function palacePreparation(material: Record<"study" | "quiz" | "practice-test", Material>) {
  const missing = (Object.keys(material) as (keyof typeof material)[])
    .filter((kind) => material[kind].count === 0);
  const pending = missing.some((kind) => ["queued", "generating"].includes(material[kind].status ?? ""));
  return {
    ready: missing.length === 0,
    pending,
    // A ready bank with no loaded rows needs a refreshed read, not regeneration.
    request: missing.filter((kind) => !["queued", "generating", "ready"].includes(material[kind].status ?? "")),
  };
}
