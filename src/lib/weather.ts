/**
 * Rain near the garden, from Open-Meteo (free, no API key): https://open-meteo.com
 * Used by the watering rule: a good soaking counts as a watering, and rain due tomorrow means
 * there's no need to water today. Only the garden's town (the "Near" setting) is sent, never anything about people.
 * Any failure (no town set, no network, unknown town) returns null, and watering works as if there were no weather.
 */

import type { Store } from "./store";

export type RainDay = { date: string; mm: number };
export type Rain = {
  /** The place Open-Meteo matched, e.g. "Princeton, New Jersey". */
  place: string;
  /** Daily totals in the garden's local dates: the past week, today, and the next two days. */
  days: RainDay[];
};

/** About a quarter inch: enough rain to count as watering. */
export const SOAKING_MM = 6;

const TIMEOUT_MS = 2500;
const KEEP_MS = 60 * 60 * 1000;
const KEEP_FAILED_MS = 10 * 60 * 1000;

const US_STATES: Record<string, string> = {
  al: "alabama", ak: "alaska", az: "arizona", ar: "arkansas", ca: "california", co: "colorado", ct: "connecticut",
  de: "delaware", dc: "district of columbia", fl: "florida", ga: "georgia", hi: "hawaii", id: "idaho", il: "illinois",
  in: "indiana", ia: "iowa", ks: "kansas", ky: "kentucky", la: "louisiana", me: "maine", md: "maryland",
  ma: "massachusetts", mi: "michigan", mn: "minnesota", ms: "mississippi", mo: "missouri", mt: "montana",
  ne: "nebraska", nv: "nevada", nh: "new hampshire", nj: "new jersey", nm: "new mexico", ny: "new york",
  nc: "north carolina", nd: "north dakota", oh: "ohio", ok: "oklahoma", or: "oregon", pa: "pennsylvania",
  ri: "rhode island", sc: "south carolina", sd: "south dakota", tn: "tennessee", tx: "texas", ut: "utah",
  vt: "vermont", va: "virginia", wa: "washington", wv: "west virginia", wi: "wisconsin", wy: "wyoming",
};

/** "Princeton, NJ" → town "Princeton" and hints ["new jersey", "nj"], used to pick the right Princeton. */
export function parseLocation(text: string): { town: string; hints: string[] } {
  const [town = "", ...rest] = text.split(",").map((part) => part.trim()).filter(Boolean);
  const hints = rest.flatMap((part) => {
    const key = part.toLowerCase().replace(/\./g, "");
    return US_STATES[key] ? [US_STATES[key], key] : [key];
  });
  return { town, hints };
}

type Place = { name: string; latitude: number; longitude: number; admin1?: string; country?: string; country_code?: string };

/** The search result matching the hints (state or country), else the first one. */
export function pickPlace(results: Place[], hints: string[]): Place | null {
  if (!results.length) return null;
  if (!hints.length) return results[0];
  const fits = (place: Place) =>
    hints.some((hint) => [place.admin1, place.country, place.country_code].some((field) => field?.toLowerCase() === hint));
  return results.find(fits) ?? results[0];
}

/** Daily rain from Open-Meteo's forecast response. */
export function rainFromResponse(json: unknown, place: string): Rain | null {
  const daily = (json as { daily?: { time?: unknown; precipitation_sum?: unknown } })?.daily;
  if (!daily || !Array.isArray(daily.time) || !Array.isArray(daily.precipitation_sum)) return null;
  const days: RainDay[] = [];
  daily.time.forEach((date, i) => {
    // Missing values (null) mean unknown, not dry, so they're skipped.
    const mm = (daily.precipitation_sum as unknown[])[i];
    if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && typeof mm === "number" && Number.isFinite(mm)) {
      days.push({ date, mm });
    }
  });
  return days.length ? { place, days } : null;
}

/** The most recent day, up to today, with enough rain to count as watering. */
export function lastSoaking(rain: Rain, today: string): RainDay | null {
  return [...rain.days].reverse().find((day) => day.date <= today && day.mm >= SOAKING_MM) ?? null;
}

/** Enough rain forecast for tomorrow that watering today can wait. */
export function soakingTomorrow(rain: Rain, tomorrow: string): RainDay | null {
  return rain.days.find((day) => day.date === tomorrow && day.mm >= SOAKING_MM) ?? null;
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Open-Meteo ${response.status}`);
  return response.json();
}

const cache = (globalThis as { __gwcvRain?: Map<string, { at: number; rain: Rain | null }> }).__gwcvRain ?? new Map();
(globalThis as { __gwcvRain?: typeof cache }).__gwcvRain = cache;

type GeoHit = { at: number; place: Place | null };
const geoCache = (globalThis as { __gwcvGeo?: Map<string, GeoHit> }).__gwcvGeo ?? new Map();
(globalThis as { __gwcvGeo?: typeof geoCache }).__gwcvGeo = geoCache;

async function geocode(location: string): Promise<Place | null> {
  const key = location.trim().toLowerCase();
  const hit = geoCache.get(key);
  // Keep coordinates for a day — towns don't move; avoids a second HTTP hop on rain refresh.
  if (hit && Date.now() - hit.at < 24 * KEEP_MS) return hit.place;
  const { town, hints } = parseLocation(location);
  if (!town) {
    geoCache.set(key, { at: Date.now(), place: null });
    return null;
  }
  const found = (await getJson(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(town)}&count=10&language=en&format=json`,
  )) as { results?: Place[] };
  const place = pickPlace(found.results ?? [], hints);
  geoCache.set(key, { at: Date.now(), place });
  return place;
}

/** Rain near the garden's town, cached for an hour (ten minutes after a failure). Null if unknown. */
export async function rainNear(location: string): Promise<Rain | null> {
  const key = location.trim().toLowerCase();
  if (!key) return null;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < (hit.rain ? KEEP_MS : KEEP_FAILED_MS)) return hit.rain;
  let rain: Rain | null = null;
  try {
    const place = await geocode(location);
    if (place) {
      const forecast = await getJson(
        `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
          "&daily=precipitation_sum&past_days=7&forecast_days=3&timezone=auto",
      );
      rain = rainFromResponse(forecast, [place.name, place.admin1 ?? place.country].filter(Boolean).join(", "));
    }
  } catch (error) {
    console.warn("[weather] couldn't get rain:", error instanceof Error ? error.message : error);
  }
  cache.set(key, { at: Date.now(), rain });
  return rain;
}

/** Rain near the garden's town as set under "Near" in Edit layout, or null. */
export async function gardenRain(store: Store): Promise<Rain | null> {
  return rainNear((await store.getLayout()).location ?? "");
}
