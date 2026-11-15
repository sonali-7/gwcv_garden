import { activePlantings } from "./plantings";
import type { Bed, Planting } from "./types";

export type LocationMatch = {
  bed: Bed | null;
  /** All beds this text clearly names (Plot 8 and Plot 9 → both). */
  beds: Bed[];
  planting: Planting | null;
  ambiguous: boolean;
  choices: string[];
};

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
  options?: { choices?: string[] },
): LocationMatch {
  const hay = normalize(text);
  const pool = options?.choices?.length
    ? beds.filter((bed) => options.choices!.some((name) => normalize(name) === normalize(bed.name) || name === bed.name))
    : beds;
  const active = activePlantings(plantings, onYmd);

  // "both" / "all" while clarifying → every offered choice.
  if (options?.choices?.length && isMultiAccept(text)) {
    return finishMatch(pool, active, hay);
  }

  // Exact / near-exact reply to "Which row — A or B?" should win immediately.
  if (hay && options?.choices?.length) {
    const exact = pool.filter((bed) => normalize(bed.name) === hay);
    if (exact.length === 1) {
      return {
        bed: exact[0],
        beds: [exact[0]],
        planting: pickPlanting(exact[0], active, hay),
        ambiguous: false,
        choices: [],
      };
    }
    // "plot 8 and plot 9" style answers against the choice list.
    const named = namedBedsInText(hay, pool);
    if (named.length) return finishMatch(named, active, hay);
  }

  const byName = namedBedsInText(hay, pool);
  // Named beds win and may be several ("plot 8 and plot 9"). Crop-only matches stay single-or-ask.
  if (byName.length >= 1) return finishMatch(byName, active, hay);

  const cropHits = bedsFromCrops(hay, pool, beds, active);
  if (cropHits.length === 1) return finishMatch(cropHits, active, hay);
  if (cropHits.length > 1) {
    return { bed: null, beds: [], planting: null, ambiguous: true, choices: cropHits.map((bed) => bed.name) };
  }
  return { bed: null, beds: [], planting: null, ambiguous: false, choices: [] };
}

function finishMatch(hits: Bed[], active: Planting[], hay: string): LocationMatch {
  if (hits.length === 0) return { bed: null, beds: [], planting: null, ambiguous: false, choices: [] };
  if (hits.length === 1) {
    return {
      bed: hits[0],
      beds: hits,
      planting: pickPlanting(hits[0], active, hay),
      ambiguous: false,
      choices: [],
    };
  }
  // Several clearly named beds → log all of them (not "which one?").
  return {
    bed: hits[0],
    beds: hits,
    planting: pickPlanting(hits[0], active, hay),
    ambiguous: false,
    choices: [],
  };
}

function namedBedsInText(hay: string, pool: Bed[]): Bed[] {
  const hits: Bed[] = [];
  // Longer names first so "kale peas 2" beats "kale".
  const ranked = [...pool].sort((a, b) => bedKey(b.name).length - bedKey(a.name).length);
  for (const bed of ranked) {
    const distinctive = bedKey(bed.name);
    if (distinctive.length < 2) continue;
    if (includesPhrase(hay, distinctive) || loosePlotMatch(hay, distinctive)) {
      if (!hits.some((hit) => hit.id === bed.id)) hits.push(bed);
    }
  }
  return preferSpecificBeds(hits);
}

function bedsFromCrops(hay: string, pool: Bed[], allBeds: Bed[], active: Planting[]): Bed[] {
  const hits: Bed[] = [];
  for (const planting of active) {
    const crop = normalize(planting.crop);
    const singular = crop.endsWith("s") ? crop.slice(0, -1) : crop;
    if ((crop.length >= 3 && includesPhrase(hay, crop)) || (singular.length >= 4 && includesPhrase(hay, singular))) {
      const bed = allBeds.find((item) => item.id === planting.bed_id);
      if (bed && pool.some((item) => item.id === bed.id) && !hits.some((hit) => hit.id === bed.id)) {
        hits.push(bed);
      }
    }
  }
  return preferSpecificBeds(hits);
}

/** "plot 8" / "row 8" matches bed "Plot 8" even with odd spacing. */
function loosePlotMatch(hay: string, key: string): boolean {
  const plot = key.match(/^plot\s+(\d+[a-z]?)$/);
  if (!plot) return false;
  return new RegExp(`(?:^|\\s)(?:plot|row)\\s*${plot[1]}(?:\\s|$)`).test(` ${hay} `);
}

/** Drop shorter bed names that only matched because they sit inside a longer hit. */
export function preferSpecificBeds(hits: Bed[]): Bed[] {
  if (hits.length <= 1) return hits;
  const keyed = hits.map((bed) => ({ bed, key: bedKey(bed.name) }));
  return keyed
    .filter(
      ({ bed, key }) =>
        !keyed.some(
          (other) =>
            other.bed.id !== bed.id &&
            other.key.length > key.length &&
            (includesPhrase(other.key, key) || other.key.startsWith(`${key} `) || other.key.endsWith(` ${key}`)),
        ),
    )
    .map((item) => item.bed);
}

export function isMultiAccept(text: string): boolean {
  const lower = text.trim().toLowerCase();
  return /^(both|all|those|them|each|every|all of them|all of those|yes both)$/.test(lower);
}

function bedKey(name: string): string {
  return normalize(name).replace(/\brow\b/g, "").replace(/\s+/g, " ").trim();
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
