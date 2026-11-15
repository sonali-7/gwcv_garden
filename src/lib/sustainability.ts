import { familyOf } from "./crops";
import { nitrogenBalance } from "./nitrogen";
import { isPerennial } from "./perennials";
import { CLEAR_AFTER_HARVEST_DAYS } from "./plantings";
import { addDays } from "./time";
import type { Bed, Planting } from "./types";

/**
 * A yearly sustainability score from what the garden already records, so organizers can say
 * "18% better than last year" and explain why. No AI: the same records always give the same number.
 *
 * Three measures, each 0–100, over the same stretch of each year (Jan 1 up to the date shown):
 * - Soil covered (35%): share of plot-days with something growing, weighted by plot area. Bare soil erodes and loses nutrients.
 * - Rotation kept (35%): share of plantings that didn't repeat a family grown in that plot the year before.
 * - Nitrogen (30%): share of plot area that ends the stretch "balanced" or "rich" on the nitrogen meter.
 * A plot counts from its first planting (the app doesn't record when plots were made), so a new plot
 * doesn't look bare in the years before it existed. Plots never planted don't count.
 */
export type Measure = {
  key: "cover" | "rotation" | "nitrogen";
  label: string;
  /** 0–100, or null when there's nothing to measure. */
  score: number | null;
  /** Plain words for the number, e.g. "81% of the time" or "9 of 10 plantings rotated". */
  detail: string;
};

export type YearScore = {
  year: number;
  from: string;
  to: string;
  /** Weighted average of the measures that have a score, or null if none do. */
  score: number | null;
  measures: Measure[];
  /** Plantings that grew during the stretch: too few and the comparison isn't meaningful. */
  plantings: number;
};

export type Comparison = {
  current: YearScore;
  previous: YearScore;
  /** Overall scores on the measures both years have (what the percentage compares). */
  score: number | null;
  previousScore: number | null;
  /** Percent change in the overall score, or null when last year doesn't have enough data. */
  change: number | null;
  /** The measures that moved most, as sentences, biggest first. */
  reasons: string[];
};

const WEIGHTS: Record<Measure["key"], number> = { cover: 0.35, rotation: 0.35, nitrogen: 0.3 };
/** Fewer plantings than this in last year's stretch and there's no comparison. */
export const MIN_PLANTINGS = 3;

/** A real planting (not an unconfirmed plan), whether it was planted in the app or texted in. */
function real(planting: Planting): boolean {
  return planting.status !== "planned";
}

/** Last day a planting covered the soil: removed, or two weeks after harvest for annuals, never for perennials. */
function lastDay(planting: Planting): string {
  if (planting.removed_date) return addDays(planting.removed_date, -1);
  if (isPerennial(planting.crop)) return "9999-12-31";
  return addDays(planting.expected_harvest_date, CLEAR_AFTER_HARVEST_DAYS);
}

function area(bed: Bed, fallback: number): number {
  return bed.geometry ? Math.max(0.25, bed.geometry.w * bed.geometry.h) : fallback;
}

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/** Jan 1 of `year` to the same month and day as `endOn` (Feb 29 becomes Feb 28 in other years). */
export function stretch(year: number, endOn: string): { from: string; to: string } {
  let monthDay = endOn.slice(5);
  if (monthDay === "02-29" && !(year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0))) monthDay = "02-28";
  return { from: `${year}-01-01`, to: `${year}-${monthDay}` };
}

export function yearScore(beds: Bed[], plantings: Planting[], year: number, endOn: string, today = endOn): YearScore {
  const { from, to } = stretch(year, endOn);
  const ids = new Set(beds.map((bed) => bed.id));
  const mine = plantings.filter((p) => ids.has(p.bed_id) && real(p));
  const byBed = new Map<string, Planting[]>();
  for (const p of mine) byBed.set(p.bed_id, [...(byBed.get(p.bed_id) ?? []), p]);
  const known = beds.filter((bed) => bed.geometry);
  const fallback = known.length ? known.reduce((sum, bed) => sum + area(bed, 1), 0) / known.length : 1;

  // Soil covered: day by day, area-weighted.
  let coveredArea = 0;
  let totalArea = 0;
  for (const bed of beds) {
    const list = byBed.get(bed.id) ?? [];
    if (!list.length) continue;
    const first = list.map((p) => p.planted_date).sort()[0];
    const start = first > from ? first : from;
    if (start > to) continue;
    const spans = list.map((p) => [p.planted_date, lastDay(p)] as const);
    const size = area(bed, fallback);
    for (let day = start; day <= to; day = addDays(day, 1)) {
      totalArea += size;
      if (spans.some(([a, b]) => a <= day && day <= b)) coveredArea += size;
    }
  }
  const cover = totalArea > 0 ? pct(coveredArea, totalArea) : null;

  // Rotation kept: plantings in the stretch whose family didn't grow in that plot the year before.
  const planted = mine.filter((p) => p.planted_date >= from && p.planted_date <= to && !isPerennial(p.crop) && familyOf(p.crop));
  let kept = 0;
  for (const p of planted) {
    const family = familyOf(p.crop)!.family;
    const repeat = (byBed.get(p.bed_id) ?? []).some(
      (other) => other.season_year === year - 1 && !isPerennial(other.crop) && familyOf(other.crop)?.family === family,
    );
    if (!repeat) kept++;
  }
  const rotation = planted.length ? pct(kept, planted.length) : null;

  // Nitrogen at the end of the stretch, for plots with something planted in the two years before it.
  let healthy = 0;
  let measured = 0;
  let healthyArea = 0;
  let measuredArea = 0;
  for (const bed of beds) {
    const list = (byBed.get(bed.id) ?? []).filter((p) => p.planted_date <= to);
    const balance = nitrogenBalance(list, to, today > to ? today : to);
    if (!balance.effects.length) continue;
    const size = area(bed, fallback);
    measured++;
    measuredArea += size;
    if (balance.level !== "low") {
      healthy++;
      healthyArea += size;
    }
  }
  const nitrogen = measured ? pct(healthyArea, measuredArea) : null;

  const measures: Measure[] = [
    { key: "cover", label: "Soil covered", score: cover, detail: cover === null ? "no plots planted yet" : `${cover}% of the time` },
    {
      key: "rotation",
      label: "Rotation kept",
      score: rotation,
      detail: rotation === null ? "nothing planted yet" : `${kept} of ${planted.length} planting${planted.length === 1 ? "" : "s"} rotated`,
    },
    {
      key: "nitrogen",
      label: "Healthy nitrogen",
      score: nitrogen,
      detail: nitrogen === null ? "no plots to measure" : `${healthy} of ${measured} plot${measured === 1 ? "" : "s"} balanced or rich`,
    },
  ];
  const growing = mine.filter((p) => p.planted_date <= to && lastDay(p) >= from).length;
  return { year, from, to, score: combine(measures), measures, plantings: growing };
}

/** Weighted average over the measures that have a score, re-weighted so they add up. */
function combine(measures: Measure[], only?: Set<Measure["key"]>): number | null {
  const used = measures.filter((m) => m.score !== null && (!only || only.has(m.key)));
  const weight = used.reduce((sum, m) => sum + WEIGHTS[m.key], 0);
  if (!weight) return null;
  return Math.round(used.reduce((sum, m) => sum + (m.score as number) * WEIGHTS[m.key], 0) / weight);
}

/**
 * This year against last year, over the same stretch (Jan 1 to `endOn`'s month and day).
 * Only measures both years have are compared, so a missing one doesn't swing the result.
 */
export function compareYears(beds: Bed[], plantings: Planting[], endOn: string, today = endOn): Comparison {
  const year = Number(endOn.slice(0, 4));
  const current = yearScore(beds, plantings, year, endOn, today);
  const previous = yearScore(beds, plantings, year - 1, endOn, today);
  const both = new Set(
    current.measures.filter((m, i) => m.score !== null && previous.measures[i].score !== null).map((m) => m.key),
  );
  const now = combine(current.measures, both);
  const before = combine(previous.measures, both);
  const enough = previous.plantings >= MIN_PLANTINGS && now !== null && before !== null && before > 0;
  const change = enough ? Math.round(((now! - before!) / before!) * 100) : null;
  const reasons = current.measures
    .map((m, i) => ({ m, was: previous.measures[i] }))
    .filter(({ m, was }) => m.score !== null && was.score !== null && m.score !== was.score)
    .sort((a, b) => Math.abs(b.m.score! - b.was.score!) - Math.abs(a.m.score! - a.was.score!))
    .map(({ m, was }) => `${m.label}: ${m.detail} (last year ${was.detail}).`);
  // Without a comparison, show this year's score on everything it has.
  return enough
    ? { current, previous, score: now, previousScore: before, change, reasons }
    : { current, previous, score: current.score, previousScore: null, change: null, reasons: [] };
}
