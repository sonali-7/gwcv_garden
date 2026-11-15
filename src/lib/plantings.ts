import { isPerennial } from "./perennials";
import { addDays } from "./time";
import type { Planting } from "./types";

/** An unconfirmed plan: not in the ground yet, whatever its date says. */
export function isPlan(planting: Planting): boolean {
  return planting.status === "planned";
}

/** A plan whose date has come and gone without anyone confirming it was planted. */
export function isOverduePlan(planting: Planting, today: string): boolean {
  return isPlan(planting) && !planting.removed_date && planting.planted_date <= today;
}

/** In the ground on a date. Unconfirmed plans never are. */
export function isActive(planting: Planting, onYmd: string): boolean {
  if (isPlan(planting)) return false;
  if (planting.planted_date > onYmd) return false;
  if (planting.removed_date && planting.removed_date <= onYmd) return false;
  return true;
}

export function activePlantings(plantings: Planting[], onYmd: string): Planting[] {
  return plantings.filter((planting) => isActive(planting, onYmd));
}

/** When looking ahead, a crop nobody has marked removed is assumed cleared this many days after its expected harvest. */
export const CLEAR_AFTER_HARVEST_DAYS = 14;

/** Last day a planting covered the soil: the day before it was removed, two weeks after harvest for annuals, never for perennials. */
export function coverEndsOn(planting: Planting): string {
  if (planting.removed_date) return addDays(planting.removed_date, -1);
  if (isPerennial(planting.crop)) return "9999-12-31";
  return addDays(planting.expected_harvest_date, CLEAR_AFTER_HARVEST_DAYS);
}

/**
 * Whether a planting is in the ground on `day`, as the garden timeline shows it.
 * Up to today this is the record as logged. After today, crops with no removal date
 * are assumed cleared two weeks after their expected harvest, so beds open up for planning.
 * Perennials (trees, berries, asparagus, roses, woody herbs) stay put until someone pulls them.
 */
export function inGroundOn(planting: Planting, day: string, today: string): boolean {
  if (isPlan(planting)) {
    // Looking ahead, a plan that isn't due yet is pictured in the ground from its date. One that's overdue isn't:
    // it waits for someone to confirm it.
    if (planting.removed_date || planting.planted_date <= today || day <= today || planting.planted_date > day) return false;
  } else if (!isActive(planting, day)) {
    return false;
  }
  if (day <= today || planting.removed_date || isPerennial(planting.crop)) return true;
  return addDays(planting.expected_harvest_date, CLEAR_AFTER_HARVEST_DAYS) > day;
}

/**
 * Whether a planting is still a plan as of `day`. Looking back shows no plans: we don't know when
 * a plan was made, and later plantings weren't plans back then.
 */
export function plannedAfter(planting: Planting, day: string, today: string): boolean {
  if (day < today || planting.removed_date) return false;
  // Overdue plans stay plans (from today on) until someone confirms them.
  return planting.planted_date > day || isOverduePlan(planting, today);
}
