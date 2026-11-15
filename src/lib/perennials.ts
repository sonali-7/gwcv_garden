import { canonicalCrop } from "./crops";
import { addDays } from "./time";
import type { Planting } from "./types";

/**
 * Crops that come back every year. They stay in the ground until someone pulls them (they're never cleared after a
 * harvest), skip crop rotation, and are picked in the same months every year.
 * Months assume the northern hemisphere, like the sowing months in crop-guide.json.
 */
export type PerennialInfo = {
  /** Months it's picked each year. Empty for plants grown for flowers, shade or fruit you don't log (roses, trees). */
  harvestMonths: number[];
  /** Whole years after planting before the first real harvest (asparagus waits two). */
  yearsToFirstHarvest: number;
};

const PERENNIALS: Record<string, PerennialInfo> = {
  trees: { harvestMonths: [], yearsToFirstHarvest: 0 },
  raspberry: { harvestMonths: [7, 8, 9], yearsToFirstHarvest: 1 },
  blackberry: { harvestMonths: [7, 8], yearsToFirstHarvest: 1 },
  blueberry: { harvestMonths: [7, 8], yearsToFirstHarvest: 2 },
  strawberry: { harvestMonths: [6], yearsToFirstHarvest: 1 },
  asparagus: { harvestMonths: [4, 5, 6], yearsToFirstHarvest: 2 },
  rhubarb: { harvestMonths: [5, 6, 7], yearsToFirstHarvest: 1 },
  rose: { harvestMonths: [], yearsToFirstHarvest: 0 },
  lavender: { harvestMonths: [6, 7], yearsToFirstHarvest: 1 },
  chives: { harvestMonths: [4, 5, 6, 7, 8, 9], yearsToFirstHarvest: 0 },
  mint: { harvestMonths: [5, 6, 7, 8, 9], yearsToFirstHarvest: 0 },
  rosemary: { harvestMonths: [4, 5, 6, 7, 8, 9, 10], yearsToFirstHarvest: 0 },
  thyme: { harvestMonths: [5, 6, 7, 8, 9], yearsToFirstHarvest: 0 },
  oregano: { harvestMonths: [6, 7, 8, 9], yearsToFirstHarvest: 0 },
  sage: { harvestMonths: [5, 6, 7, 8, 9], yearsToFirstHarvest: 0 },
};

export function perennialInfo(crop: string): PerennialInfo | null {
  const key = canonicalCrop(crop);
  // Any kind of tree ("apple tree", "fruit trees") stays put like trees do.
  return PERENNIALS[key] ?? (/\btrees?\b/.test(key) ? PERENNIALS.trees : null);
}

export function isPerennial(crop: string): boolean {
  return perennialInfo(crop) !== null;
}

/** Every perennial the app knows, for lists and prompts. */
export function perennialCrops(): string[] {
  return Object.keys(PERENNIALS);
}

/** All crops in the ground are perennials: the plot stays as it is year to year, so rotation and suggestions don't apply. */
export function isPermanentPlot(current: Planting[]): boolean {
  return current.length > 0 && current.every((planting) => isPerennial(planting.crop));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Jul–Sep", or "Jun" for one month. Harvest months are kept as one run. */
export function monthsLabel(months: number[]): string {
  if (!months.length) return "";
  const first = MONTHS[months[0] - 1];
  const last = MONTHS[months[months.length - 1] - 1];
  return first === last ? first : `${first}–${last}`;
}

function ymd(year: number, month: number, dayOfMonth = 1): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(dayOfMonth).padStart(2, "0")}`;
}

function lastDayOf(year: number, month: number): string {
  return addDays(month === 12 ? ymd(year + 1, 1) : ymd(year, month + 1), -1);
}

/**
 * Where a perennial is in its yearly harvest, as of `day`:
 * - "none": not picked (roses, trees) or not a perennial;
 * - "now": in its harvest months; `until` is the last day of the season;
 * - "later": the next season starts `from`; `first` if it's the first harvest since planting.
 */
export type HarvestSeason =
  | { state: "none" }
  | { state: "now"; until: string }
  | { state: "later"; from: string; first: boolean };

export function harvestSeason(planting: Planting, day: string): HarvestSeason {
  const info = perennialInfo(planting.crop);
  if (!info || !info.harvestMonths.length) return { state: "none" };
  const firstYear = Number(planting.planted_date.slice(0, 4)) + info.yearsToFirstHarvest;
  const startMonth = info.harvestMonths[0];
  const endMonth = info.harvestMonths[info.harvestMonths.length - 1];
  const year = Number(day.slice(0, 4));
  for (const y of [year, year + 1, year + 2, year + 3]) {
    if (y < firstYear) continue;
    // A crop planted partway through a season it could be picked in starts from its planting date.
    let from = ymd(y, startMonth);
    if (from < planting.planted_date) from = planting.planted_date;
    const until = lastDayOf(y, endMonth);
    if (until < from || until < day) continue;
    if (from <= day) return { state: "now", until };
    return { state: "later", from, first: y === firstYear };
  }
  return { state: "none" };
}

/** The date a crop is next ready, for sorting the plant list: today if a perennial is in season, never for roses. */
export function nextReady(planting: Planting, day: string): string {
  if (!isPerennial(planting.crop)) return planting.expected_harvest_date;
  const season = harvestSeason(planting, day);
  return season.state === "now" ? day : season.state === "later" ? season.from : "9999-12-31";
}

/** Date to record for a perennial drawn on an existing plan: assumed established, so it's producing now. */
export function establishedDate(crop: string, today: string): string {
  const info = perennialInfo(crop);
  if (!info || !info.yearsToFirstHarvest) return today;
  return ymd(Number(today.slice(0, 4)) - info.yearsToFirstHarvest, 1);
}

/** Add a perennial the app didn't know (from a Gemini profile). */
export function addPerennial(crop: string, info: PerennialInfo): void {
  if (!PERENNIALS[crop]) PERENNIALS[crop] = info;
}
