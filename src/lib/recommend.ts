import guide from "../data/crop-guide.json";
import { canonicalCrop, familyOf } from "./crops";
import { inGroundOn, plannedAfter } from "./plantings";
import { addDays } from "./time";
import type { Bed, Planting } from "./types";

export type CropGuide = {
  crop: string;
  water: "low" | "medium" | "high";
  sun: string;
  soil: string;
  sowMonths: number[];
  days: number;
  cover: boolean;
};

export const CROP_GUIDE = guide as CropGuide[];

export type Recommendation = {
  crop: string;
  family: string;
  score: number;
  reasons: string[];
  water: CropGuide["water"];
  sun: string;
  soil: string;
  /** First date the crop could go in this bed (bed free and inside its sowing window). */
  plantOn: string;
  /** First date it could go in next to what's already in the bed (not before tomorrow, and inside its sowing window). */
  alongsideOn: string;
  now: boolean;
  cover: boolean;
};

export type Avoid = { crop: string; reason: string };

export type BedAdvice = {
  bedId: string;
  freeFrom: string;
  current: Planting[];
  planned: Planting[];
  history: Planting[];
  recommendations: Recommendation[];
  avoid: Avoid[];
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function monthName(month: number): string {
  return MONTHS[(month - 1 + 12) % 12];
}

export function guideFor(crop: string): CropGuide | null {
  const key = canonicalCrop(crop);
  return CROP_GUIDE.find((item) => item.crop === key) ?? null;
}

/** Earliest date on or after `from` that falls inside one of the sowing months. */
export function nextSowDate(from: string, months: number[]): string {
  const year = Number(from.slice(0, 4));
  const month = Number(from.slice(5, 7));
  if (months.includes(month)) return from;
  for (let step = 1; step <= 12; step++) {
    const m = ((month - 1 + step) % 12) + 1;
    if (months.includes(m)) {
      const y = year + Math.floor((month - 1 + step) / 12);
      return `${y}-${String(m).padStart(2, "0")}-01`;
    }
  }
  return from;
}

/**
 * Deterministic, explainable suggestions for one bed. Rules:
 * - never repeat a family grown here this season or last season (crop rotation)
 * - discourage a family grown two seasons ago
 * - follow a heavy feeder with a nitrogen fixer, and a nitrogen fixer with a heavy feeder
 * - prefer crops whose sowing window is open once the bed is free
 * `day` is the date being looked at (the garden timeline can move it); `today` is the real date.
 */
export function adviseBed(bed: Bed, plantings: Planting[], day: string, today = day): BedAdvice {
  const all = plantings
    .filter((planting) => planting.bed_id === bed.id)
    .sort((a, b) => a.planted_date.localeCompare(b.planted_date));
  const current = all.filter((planting) => inGroundOn(planting, day, today));
  const planned = all.filter((planting) => plannedAfter(planting, day, today));
  // Looking back, plantings after `day` hadn't happened yet, so they don't count for history or rotation.
  const mine = all.filter((planting) => planting.planted_date <= day || planned.includes(planting));
  const history = mine.filter((planting) => !current.includes(planting) && !planned.includes(planting)).reverse();

  const lastPlanted = [...current, ...planned].map((planting) => planting.expected_harvest_date).sort().at(-1);
  const freeFrom = lastPlanted && lastPlanted > day ? addDays(lastPlanted, 1) : day;
  const year = Number(day.slice(0, 4));

  const recentFamilies = new Map<string, Planting>();
  const olderFamilies = new Map<string, Planting>();
  for (const planting of mine) {
    if (planting.crop.toLowerCase().includes("tree")) continue;
    const family = familyOf(planting.crop)?.family;
    if (!family) continue;
    if (planting.season_year >= year - 1) recentFamilies.set(family, planting);
    else if (planting.season_year === year - 2) olderFamilies.set(family, planting);
  }

  const previous = [...mine]
    .filter((planting) => planting.planted_date <= day && !planting.crop.toLowerCase().includes("tree"))
    .at(-1);
  const previousFamily = previous ? familyOf(previous.crop) : null;

  const recommendations: Recommendation[] = [];
  const avoid: Avoid[] = [];

  for (const item of CROP_GUIDE) {
    const family = familyOf(item.crop);
    if (!family) continue;
    const reasons: string[] = [];
    let score = 0;

    const recent = recentFamilies.get(family.family);
    if (recent && !item.cover) {
      avoid.push({
        crop: item.crop,
        reason: `${titleCase(family.family)} family (${recent.crop}) grew here in ${recent.season_year}.`,
      });
      continue;
    }
    const older = olderFamilies.get(family.family);
    if (older && !item.cover) {
      score -= 2;
      reasons.push(`Same family as the ${older.crop} from ${older.season_year}; okay, but not ideal.`);
    }

    if (previousFamily && previous) {
      if (previousFamily.feeder === "heavy" && family.nitrogenFixer) {
        score += 3;
        reasons.push(`Puts nitrogen back after the ${previous.crop} (a heavy feeder).`);
      } else if (previousFamily.nitrogenFixer && family.feeder === "heavy") {
        score += 2;
        reasons.push(`Uses the nitrogen the ${previous.crop} left behind.`);
      } else if (previousFamily.feeder === "heavy" && family.feeder === "light") {
        score += 1;
        reasons.push(`A light feeder gives the soil a rest after ${previous.crop}.`);
      }
    }

    const plantOn = nextSowDate(freeFrom, item.sowMonths);
    const now = plantOn === day;
    if (now) {
      score += 3;
      const month = monthName(Number(day.slice(5, 7)));
      reasons.unshift(day === today ? `Can go in now (${month} is in its planting window).` : `Can go in then (${month} is in its planting window).`);
    } else {
      const wait = Math.round((Date.parse(plantOn) - Date.parse(day)) / 86_400_000);
      score -= Math.min(2, wait / 120);
    }
    if (item.cover && current.length === 0) {
      score += 1;
      reasons.push("Cover crop: protects bare soil and feeds it for spring.");
    }

    const earliest = day > today ? day : addDays(today, 1);
    recommendations.push({
      alongsideOn: nextSowDate(earliest, item.sowMonths),
      crop: item.crop,
      family: family.family,
      score,
      reasons: reasons.length ? reasons : ["Fits the rotation for this bed."],
      water: item.water,
      sun: item.sun,
      soil: item.soil,
      plantOn,
      now,
      cover: item.cover,
    });
  }

  recommendations.sort((a, b) => b.score - a.score || a.plantOn.localeCompare(b.plantOn) || a.crop.localeCompare(b.crop));
  return { bedId: bed.id, freeFrom, current, planned, history, recommendations, avoid };
}

function titleCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
