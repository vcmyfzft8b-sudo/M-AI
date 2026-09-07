export type PalaceResults = Record<string, "again" | "easy">;

/** Storage is optional and untrusted; old visits contain no answer history. */
export function parsePalaceResults(raw: string | null): PalaceResults {
  try {
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        ([, grade]) => grade === "again" || grade === "easy",
      ),
    ) as PalaceResults;
  } catch {
    return {};
  }
}
