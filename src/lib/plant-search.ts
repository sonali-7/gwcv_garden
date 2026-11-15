import { CROP_FAMILIES, canonicalCrop, familyOf, knownCrops } from "./crops";
import { isPerennial, perennialCrops, perennialInfo, type PerennialInfo } from "./perennials";
import type { Avoid, BedAdvice, Recommendation } from "./recommend";

/** One plant that matches a search, with what the app knows about growing it in this plot. */
export type SearchHit = {
  crop: string;
  family: string | null;
  /** The built-in suggestion for this plot, if the crop has a planting guide and rotation allows it. */
  rec: Recommendation | null;
  /** Why rotation says to skip it here (its own entry, or another crop from the same family). */
  avoid: Avoid | null;
  perennial: PerennialInfo | null;
};

let cached: string[] | null = null;

/** Every plant name the app knows, once each: crops, plants listed under each family, and perennials. */
export function searchableCrops(): string[] {
  if (cached) return cached;
  const names = [...knownCrops(), ...CROP_FAMILIES.flatMap((family) => family.crops), ...perennialCrops()].map(canonicalCrop);
  cached = [...new Set(names)].sort();
  return cached;
}

/**
 * Plants matching `query` for one plot, best first: exact names (any spelling, like "tomato" for tomatoes),
 * then names starting with it, then names with a word starting with it, then anywhere in the name, then family
 * names ("brassica" finds cabbage, kale, …).
 */
export function searchPlants(query: string, advice: BedAdvice, limit = 6): SearchHit[] {
  const q = query.toLowerCase().replace(/\s+/g, " ").trim();
  if (!q) return [];
  const exact = canonicalCrop(q);
  const rank = (crop: string): number => {
    if (crop === exact || crop === q) return 0;
    if (crop.startsWith(q)) return 1;
    if (crop.split(/[ -]/).some((word) => word.startsWith(q))) return 2;
    if (q.length >= 3 && crop.includes(q)) return 3;
    const family = familyOf(crop)?.family ?? "";
    if (q.length >= 3 && family.startsWith(q)) return 4;
    return -1;
  };
  return searchableCrops()
    .map((crop) => ({ crop, score: rank(crop) }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => a.score - b.score || a.crop.localeCompare(b.crop))
    .slice(0, limit)
    .map(({ crop }) => describe(crop, advice));
}

function describe(crop: string, advice: BedAdvice): SearchHit {
  const family = familyOf(crop)?.family ?? null;
  const perennial = perennialInfo(crop);
  // Perennials don't rotate; anything else is skipped if its family grew here recently.
  const avoid = isPerennial(crop)
    ? null
    : (advice.avoid.find((item) => item.crop === crop) ??
      (family ? (advice.avoid.find((item) => familyOf(item.crop)?.family === family) ?? null) : null));
  return {
    crop,
    family,
    rec: advice.recommendations.find((item) => item.crop === crop) ?? null,
    avoid,
    perennial,
  };
}
