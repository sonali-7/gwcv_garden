import { activePlantings } from "./plantings";
import type { Bed, Planting } from "./types";

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchLocation(
  text: string,
  beds: Bed[],
  plantings: Planting[],
  onYmd: string,
): { bed: Bed | null; planting: Planting | null; ambiguous: boolean; choices: string[] } {
  const hay = normalize(text);
  const hits: Bed[] = [];
  const push = (bed: Bed | undefined) => {
    if (bed && !hits.some((hit) => hit.id === bed.id)) hits.push(bed);
  };

  for (const bed of beds) {
    const distinctive = normalize(bed.name).replace(/\brow\b/g, "").trim();
    if (distinctive.length < 3) continue;
    if (includesPhrase(hay, distinctive)) push(bed);
  }

  const active = activePlantings(plantings, onYmd);
  for (const planting of active) {
    const crop = normalize(planting.crop);
    const singular = crop.endsWith("s") ? crop.slice(0, -1) : crop;
    if ((crop.length >= 3 && includesPhrase(hay, crop)) || (singular.length >= 4 && includesPhrase(hay, singular))) {
      push(beds.find((bed) => bed.id === planting.bed_id));
    }
  }

  if (hits.length === 1) {
    return {
      bed: hits[0],
      planting: pickPlanting(hits[0], active, hay),
      ambiguous: false,
      choices: [],
    };
  }
  if (hits.length > 1) {
    return { bed: null, planting: null, ambiguous: true, choices: hits.map((bed) => bed.name) };
  }
  return { bed: null, planting: null, ambiguous: false, choices: [] };
}

function pickPlanting(bed: Bed, active: Planting[], hay: string): Planting | null {
  const onBed = active.filter((planting) => planting.bed_id === bed.id);
  if (onBed.length === 0) return null;
  if (onBed.length === 1) return onBed[0];
  const named = onBed.filter((planting) => includesPhrase(hay, normalize(planting.crop)));
  if (named.length === 1) return named[0];
  return null;
}

function includesPhrase(hay: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`).test(` ${hay} `);
}
