import { familyOf } from "./crops";
import { addDays } from "./time";
import type { Planting } from "./types";

/**
 * A rough, explainable nitrogen balance for one plot, from what grew there.
 * It isn't a soil test: it's a reminder of what the crops took out and put back.
 *
 * Each crop planted in the two years before the date counts once:
 *   nitrogen fixers (beans, peas, clover) +2, heavy feeders (tomatoes, corn, squash, cabbage…) −2,
 *   medium feeders (lettuce, spinach, beets) −1, light feeders 0.
 * Crops from the last year count fully; the year before counts half.
 */
export type NitrogenLevel = "low" | "balanced" | "rich";

export type NitrogenEffect = { crop: string; planted_date: string; change: number };

export type NitrogenBalance = {
  score: number;
  level: NitrogenLevel;
  /** The crops that moved the score, newest first. */
  effects: NitrogenEffect[];
};

const LOW_AT = -3;
const RICH_AT = 2;
/** A crop pulled this soon after planting barely touched the soil. */
const TOO_SHORT_DAYS = 14;

export function nitrogenChange(crop: string): number {
  const family = familyOf(crop);
  if (!family) return 0;
  if (family.nitrogenFixer) return 2;
  return family.feeder === "heavy" ? -2 : family.feeder === "medium" ? -1 : 0;
}

/** Whether a planting had happened by `day`, as the timeline sees it. */
function grewBy(planting: Planting, day: string, today: string): boolean {
  if (planting.planted_date > day) return false;
  // Unconfirmed plans whose date has passed never went in. Looking ahead, plans still to come count from their date.
  if (planting.status === "planned" && planting.planted_date <= today) return false;
  if (planting.removed_date && planting.removed_date < addDays(planting.planted_date, TOO_SHORT_DAYS)) return false;
  return true;
}

export function nitrogenBalance(plantings: Planting[], day: string, today = day): NitrogenBalance {
  const yearAgo = addDays(day, -365);
  const twoYearsAgo = addDays(day, -730);
  const effects: NitrogenEffect[] = [];
  let score = 0;
  for (const planting of plantings) {
    if (!grewBy(planting, day, today) || planting.planted_date <= twoYearsAgo) continue;
    const full = nitrogenChange(planting.crop);
    if (!full) continue;
    const change = planting.planted_date > yearAgo ? full : full / 2;
    score += change;
    effects.push({ crop: planting.crop, planted_date: planting.planted_date, change });
  }
  effects.sort((a, b) => b.planted_date.localeCompare(a.planted_date));
  const level: NitrogenLevel = score <= LOW_AT ? "low" : score >= RICH_AT ? "rich" : "balanced";
  return { score, level, effects };
}

function list(names: string[]): string {
  const unique = [...new Set(names)];
  if (unique.length <= 1) return unique.join("");
  return `${unique.slice(0, -1).join(", ")} and ${unique.at(-1)}`;
}

/** One plain sentence on why the plot is where it is. */
export function nitrogenReason(balance: NitrogenBalance): string {
  const took = balance.effects.filter((e) => e.change < 0).map((e) => e.crop);
  const gave = balance.effects.filter((e) => e.change > 0).map((e) => e.crop);
  if (!took.length && !gave.length) return "Nothing that uses or adds much nitrogen has grown here in the last two years.";
  const parts: string[] = [];
  if (took.length) parts.push(`${list(took)} used nitrogen`);
  if (gave.length) parts.push(`${list(gave)} put some back`);
  const sentence = parts.join("; ");
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)} in the last two years.`;
}

export function nitrogenTip(level: NitrogenLevel): string {
  if (level === "low") return "Plant beans, peas or clover next, or work in compost before another heavy feeder.";
  if (level === "rich") return "A good spot for a heavy feeder like tomatoes, corn, squash or cabbage.";
  return "Fine for most crops.";
}
