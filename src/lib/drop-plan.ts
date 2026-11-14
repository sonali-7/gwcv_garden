import { inGroundOn, plannedAfter } from "./plantings";
import { nextSowDate } from "./recommend";
import { addDays } from "./time";
import type { Planting } from "./types";

/** A crop already in the patch when another is dropped on it. */
export type Occupant = { planting: Planting; established: boolean };

/**
 * What dropping a crop on a patch should do, as of `day` (the timeline date):
 * - "empty": nothing there; plan it as usual.
 * - "replace": one crop there that hasn't been in the ground a full day yet (or is still a plan); swap it without asking.
 * - "ask": anything else; ask whether to replace (and which), plant after, or plant alongside.
 */
export type DropSituation = { kind: "empty" } | { kind: "replace"; old: Planting } | { kind: "ask"; there: Occupant[] };

/** In the ground at least one full day before `day`. */
export function isEstablished(planting: Planting, day: string): boolean {
  return planting.planted_date < day;
}

/** What the patch shows on `day`: what's growing, or else everything planned for its next planting date. */
export function cropsInPatch(bedId: string, plantings: Planting[], day: string, today: string): Planting[] {
  const mine = plantings.filter((p) => p.bed_id === bedId);
  const growing = mine.filter((p) => inGroundOn(p, day, today));
  if (growing.length) return growing;
  const planned = mine.filter((p) => plannedAfter(p, day, today)).sort((a, b) => a.planted_date.localeCompare(b.planted_date));
  return planned.filter((p) => p.planted_date === planned[0]?.planted_date);
}

export function dropSituation(bedId: string, plantings: Planting[], day: string, today: string): DropSituation {
  const there = cropsInPatch(bedId, plantings, day, today);
  if (!there.length) return { kind: "empty" };
  if (there.length === 1 && !isEstablished(there[0], day)) return { kind: "replace", old: there[0] };
  return { kind: "ask", there: there.map((planting) => ({ planting, established: isEstablished(planting, day) })) };
}

/** Plans that haven't started and didn't come from a text can be deleted outright (the server enforces the same rule). */
export function canDelete(planting: Planting, today: string): boolean {
  return planting.planted_date > today && !planting.source_session_id;
}

/**
 * How to clear a replaced crop: delete a fresh plan; otherwise mark it pulled on `day`
 * (or the day it went in, if later) so it stays in the bed's history.
 */
export function clearing(planting: Planting, day: string, today: string): { action: "delete" } | { action: "pull"; on: string } {
  if (!isEstablished(planting, day) && canDelete(planting, today)) return { action: "delete" };
  return { action: "pull", on: planting.planted_date > day ? planting.planted_date : day };
}

/**
 * When the new crop goes in: the timeline date (never before tomorrow), or the replaced plan's date if that's later,
 * pushed into the crop's sowing months if it has them.
 */
export function replacementDate(replaced: Planting[], day: string, today: string, sowMonths?: number[]): string {
  let start = day > today ? day : addDays(today, 1);
  const freshDates = replaced.filter((p) => !isEstablished(p, day)).map((p) => p.planted_date).sort();
  if (freshDates[0] && freshDates[0] > start) start = freshDates[0];
  return sowMonths?.length ? nextSowDate(start, sowMonths) : start;
}
