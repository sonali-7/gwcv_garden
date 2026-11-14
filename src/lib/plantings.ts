import { addDays } from "./time";
import type { Planting } from "./types";

export function isActive(planting: Planting, onYmd: string): boolean {
  if (planting.planted_date > onYmd) return false;
  if (planting.removed_date && planting.removed_date <= onYmd) return false;
  return true;
}

export function activePlantings(plantings: Planting[], onYmd: string): Planting[] {
  return plantings.filter((planting) => isActive(planting, onYmd));
}

/** When looking ahead, a crop nobody has marked removed is assumed cleared this many days after its expected harvest. */
export const CLEAR_AFTER_HARVEST_DAYS = 14;

/**
 * Whether a planting is in the ground on `day`, as the garden timeline shows it.
 * Up to today this is the record as logged. After today, crops with no removal date
 * are assumed cleared two weeks after their expected harvest, so beds open up for planning.
 * Trees stay put.
 */
export function inGroundOn(planting: Planting, day: string, today: string): boolean {
  if (!isActive(planting, day)) return false;
  if (day <= today || planting.removed_date || planting.crop.toLowerCase().includes("tree")) return true;
  return addDays(planting.expected_harvest_date, CLEAR_AFTER_HARVEST_DAYS) > day;
}

/**
 * Whether a planting is still a plan as of `day`. Looking back shows no plans: we don't know when
 * a plan was made, and later plantings weren't plans back then.
 */
export function plannedAfter(planting: Planting, day: string, today: string): boolean {
  return day >= today && planting.planted_date > day && !planting.removed_date;
}
