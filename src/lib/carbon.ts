import { canonicalCrop, familyOf } from "./crops";
import { perennialInfo } from "./perennials";
import { coverEndsOn } from "./plantings";
import type { Bed, Planting } from "./types";

/**
 * A rough estimate of the CO₂ the garden saved, from the space each crop took up. No AI and no harvest weights
 * needed, so the same records always give the same number.
 *
 * Two parts:
 * - Produce: each crop that reached harvest gets its plot's area (shared with whatever else was in that plot then)
 *   × a typical home-garden yield per square foot × the footprint of buying the same food in a store
 *   (farm to shelf: farming, transport, packaging, retail).
 * - Fertilizer: each legume that grew to maturity fixed about 1 g of nitrogen per square foot, which would
 *   otherwise come from synthetic fertilizer (making it plus the nitrous oxide it gives off in the soil).
 * Perennials count each year they're old enough to bear, for the harvest months that have passed.
 *
 * Sources (rounded): yields from typical intensive home-garden figures (about 0.3–1.5 lb per sq ft);
 * footprints from Poore & Nemecek (2018), via Our World in Data; car miles from the US EPA (about 400 g CO₂ per mile).
 */

/** Typical harvest, kg per square foot of plot, per planting (or per year for perennials). 0 = not eaten. */
const YIELD_KG_PER_SQFT: Record<string, number> = {
  tomatoes: 0.68,
  pepper: 0.27,
  potato: 0.45,
  eggplant: 0.34,
  goldenberry: 0.18,
  cabbage: 0.45,
  kale: 0.34,
  broccoli: 0.18,
  collards: 0.34,
  radish: 0.23,
  turnip: 0.34,
  beans: 0.27,
  peas: 0.14,
  clover: 0,
  carrots: 0.45,
  parsley: 0.14,
  dill: 0.09,
  "sweet potato": 0.41,
  spinach: 0.18,
  chard: 0.34,
  beet: 0.41,
  lettuce: 0.27,
  corn: 0.14,
  "winter rye": 0,
  garlic: 0.18,
  onion: 0.41,
  leeks: 0.27,
  chives: 0.09,
  pumpkin: 0.23,
  squash: 0.45,
  cucumber: 0.54,
  melon: 0.27,
  watermelon: 0.34,
  "bitter melon": 0.23,
  luffa: 0,
  gourd: 0,
  okra: 0.18,
  basil: 0.14,
  herbs: 0.09,
  raspberry: 0.14,
  blackberry: 0.18,
  blueberry: 0.14,
  strawberry: 0.18,
  asparagus: 0.07,
  rhubarb: 0.23,
};

/** Families grown for flowers, shade or fun, not food. */
const NOT_FOOD = new Set(["flower", "woody"]);
const NOT_FOOD_CROPS = new Set(["rose", "lavender", "clover", "winter rye", "luffa", "gourd", "trees"]);
/** For crops not in the table (e.g. from a Gemini profile): a modest middle-of-the-road harvest. */
const DEFAULT_YIELD = 0.23;

/** Store-bought footprint, kg CO₂e per kg of food. */
const FOOTPRINT_BY_CROP: Record<string, number> = { tomatoes: 2.1, potato: 0.46, "sweet potato": 0.43, corn: 1.7, beet: 0.43 };
const FOOTPRINT_BY_FAMILY: Record<string, number> = {
  nightshade: 0.53,
  brassica: 0.51,
  legume: 0.98,
  umbellifer: 0.43,
  "morning glory": 0.43,
  allium: 0.5,
  rose: 1.53,
  heath: 1.53,
};
/** "Other vegetables" in the same study. */
const DEFAULT_FOOTPRINT = 0.53;

/** Nitrogen a legume fixes, kg per sq ft (about 100 kg per hectare). */
const FIXED_N_KG_PER_SQFT = 0.001;
/** CO₂e of synthetic nitrogen fertilizer per kg of nitrogen: making it, plus nitrous oxide once applied. */
const FERTILIZER_CO2_PER_KG_N = 8;
/** Average US car, kg CO₂ per mile. */
export const CAR_KG_PER_MILE = 0.4;

export type CarbonEstimate = {
  /** Total kg CO₂e avoided. */
  kg: number;
  /** kg CO₂e from produce not bought, and the food it came from (kg). */
  produceKg: number;
  foodKg: number;
  /** kg CO₂e of fertilizer not needed, from legumes. */
  fertilizerKg: number;
  /** Crops that saved the most, biggest first. */
  top: Array<{ crop: string; kg: number }>;
  /** Harvests counted (an annual reaching harvest, or a perennial's season). */
  harvests: number;
};

export function yieldPerSqFt(crop: string): number {
  const key = canonicalCrop(crop);
  if (key in YIELD_KG_PER_SQFT) return YIELD_KG_PER_SQFT[key];
  const family = familyOf(key)?.family;
  if (NOT_FOOD_CROPS.has(key) || /\btrees?\b/.test(key) || (family && NOT_FOOD.has(family))) return 0;
  return family === "herb" ? 0.09 : DEFAULT_YIELD;
}

export function storeFootprint(crop: string): number {
  const key = canonicalCrop(crop);
  return FOOTPRINT_BY_CROP[key] ?? FOOTPRINT_BY_FAMILY[familyOf(key)?.family ?? ""] ?? DEFAULT_FOOTPRINT;
}

function endOfMonth(year: number, month: number): string {
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * When a planting paid off within [from, to], as (day, share of a harvest) pairs.
 * Annuals: once, at harvest (or when pulled, if that was close enough to harvest to have picked something).
 * Perennials: each harvest month that ended in the stretch, once they're old enough to bear.
 */
function harvestsIn(p: Planting, from: string, to: string): Array<{ day: string; share: number }> {
  const info = perennialInfo(p.crop);
  if (info) {
    if (!info.harvestMonths.length) return [];
    const out: Array<{ day: string; share: number }> = [];
    const firstYear = Number(p.planted_date.slice(0, 4)) + info.yearsToFirstHarvest;
    for (let year = Math.max(firstYear, Number(from.slice(0, 4))); year <= Number(to.slice(0, 4)); year++) {
      for (const month of info.harvestMonths) {
        const end = endOfMonth(year, month);
        const start = `${end.slice(0, 8)}01`;
        if (end < from || end > to || start < p.planted_date) continue;
        if (p.removed_date && p.removed_date <= end) continue;
        out.push({ day: end, share: 1 / info.harvestMonths.length });
      }
    }
    return out;
  }
  let day = p.expected_harvest_date;
  if (p.removed_date && p.removed_date < day) {
    // Pulled early: only counts if it had most of its growing time.
    const grown = (Date.parse(p.removed_date) - Date.parse(p.planted_date)) / 86_400_000;
    if (grown < 0.75 * Math.max(1, p.days_to_maturity)) return [];
    day = p.removed_date;
  }
  return day >= from && day <= to ? [{ day, share: 1 }] : [];
}

/**
 * CO₂ saved by plantings in `beds` that paid off between `from` and `to`.
 * `area` gives a plot's size in square feet.
 */
export function carbonSaved(beds: Bed[], plantings: Planting[], from: string, to: string, area: (bed: Bed) => number): CarbonEstimate {
  const byBed = new Map<string, Planting[]>();
  for (const p of plantings) byBed.set(p.bed_id, [...(byBed.get(p.bed_id) ?? []), p]);
  const byCrop = new Map<string, number>();
  let produceKg = 0;
  let foodKg = 0;
  let fertilizerKg = 0;
  let harvests = 0;

  for (const bed of beds) {
    const list = byBed.get(bed.id) ?? [];
    const size = area(bed);
    for (const p of list) {
      const crop = canonicalCrop(p.crop);
      for (const { day, share } of harvestsIn(p, from, to)) {
        // A plot shared with other crops while this one grew splits its space evenly.
        const start = perennialInfo(p.crop) ? `${day.slice(0, 8)}01` : p.planted_date;
        const neighbours = list.filter((o) => o !== p && o.planted_date <= day && coverEndsOn(o) >= start).length;
        const sqft = size / (1 + neighbours);
        const food = yieldPerSqFt(crop) * sqft * share;
        const fromFood = food * storeFootprint(crop);
        const fromN = familyOf(crop)?.nitrogenFixer ? sqft * share * FIXED_N_KG_PER_SQFT * FERTILIZER_CO2_PER_KG_N : 0;
        if (!food && !fromN) continue;
        harvests++;
        foodKg += food;
        produceKg += fromFood;
        fertilizerKg += fromN;
        byCrop.set(crop, (byCrop.get(crop) ?? 0) + fromFood + fromN);
      }
    }
  }
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    kg: round(produceKg + fertilizerKg),
    produceKg: round(produceKg),
    foodKg: round(foodKg),
    fertilizerKg: round(fertilizerKg),
    top: [...byCrop]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([crop, kg]) => ({ crop, kg: round(kg) })),
    harvests,
  };
}
