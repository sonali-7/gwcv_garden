import { getStore } from "@/lib/db";
import { cleanAreas } from "@/lib/garden-areas";
import { json, noContent } from "@/lib/http";
import type { Bed, GardenLayout, Planting } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function OPTIONS() {
  return noContent();
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const id = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 80;
const num = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const r1 = (n: number) => Math.round(n * 10) / 10;

function bed(value: unknown): Bed | null {
  const b = value as Record<string, unknown> | null;
  if (!b || !id(b.id) || typeof b.name !== "string") return null;
  const g = b.geometry as Record<string, unknown> | null;
  const geometry =
    g && num(g.x, 0, 2000) && num(g.y, 0, 2000) && num(g.w, 0.1, 2000) && num(g.h, 0.1, 2000)
      ? { x: r1(g.x as number), y: r1(g.y as number), w: r1(g.w as number), h: r1(g.h as number) }
      : null;
  return {
    id: b.id,
    name: b.name.replace(/\s+/g, " ").trim().slice(0, 60) || "Plot",
    row: typeof b.row === "string" ? b.row.slice(0, 40) : "",
    geometry,
    ...(b.archived === true ? { archived: true } : {}),
  };
}

function planting(value: unknown): Planting | null {
  const p = value as Record<string, unknown> | null;
  if (!p || !id(p.id) || !id(p.bed_id) || typeof p.crop !== "string" || !p.crop.trim()) return null;
  if (typeof p.planted_date !== "string" || !DATE.test(p.planted_date)) return null;
  if (typeof p.expected_harvest_date !== "string" || !DATE.test(p.expected_harvest_date)) return null;
  if (p.removed_date !== null && (typeof p.removed_date !== "string" || !DATE.test(p.removed_date))) return null;
  if (!num(p.season_year, 1900, 3000) || !num(p.days_to_maturity, 1, 4000)) return null;
  return {
    id: p.id,
    bed_id: p.bed_id,
    crop: p.crop.slice(0, 40),
    planted_date: p.planted_date,
    expected_harvest_date: p.expected_harvest_date,
    removed_date: (p.removed_date as string | null) ?? null,
    season_year: p.season_year as number,
    days_to_maturity: p.days_to_maturity as number,
    source_session_id: id(p.source_session_id) ? p.source_session_id : null,
    ...(p.status === "planned" || p.status === "planted" ? { status: p.status } : {}),
  };
}

function layout(value: unknown, current: GardenLayout): GardenLayout | null {
  const l = value as Record<string, unknown> | null;
  if (!l || !num(l.widthFt, 3, 1000) || !num(l.lengthFt, 3, 1000)) return null;
  const widthFt = r1(l.widthFt as number);
  const lengthFt = r1(l.lengthFt as number);
  const outline = Array.isArray(l.outline)
    ? (l.outline as unknown[]).flatMap((p) =>
        Array.isArray(p) && num(p[0], 0, widthFt) && num(p[1], 0, lengthFt) ? [[r1(p[0] as number), r1(p[1] as number)] as [number, number]] : [],
      )
    : [];
  return {
    ...current,
    widthFt,
    lengthFt,
    units: l.units === "m" ? "m" : "ft",
    location: typeof l.location === "string" ? l.location.slice(0, 80) : current.location,
    imageUrl: typeof l.imageUrl === "string" || l.imageUrl === null ? (l.imageUrl as string | null) : current.imageUrl,
    outline: outline.length >= 3 ? outline : null,
    areas: cleanAreas(l.areas, widthFt, lengthFt),
  };
}

/**
 * Undo one garden edit: put back the records it changed and remove the ones it created.
 * The browser works out which records those are from what it saw before and after the edit.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const part = (key: string) => (body?.[key] ?? {}) as { restore?: unknown; remove?: unknown };
  const list = (v: unknown) => (Array.isArray(v) ? v.slice(0, 500) : []);
  const beds = list(part("beds").restore).map(bed);
  const plantings = list(part("plantings").restore).map(planting);
  const removeBeds = list(part("beds").remove).filter(id);
  const removePlantings = list(part("plantings").remove).filter(id);
  if (beds.some((b) => !b) || plantings.some((p) => !p)) return json({ error: "Couldn't undo that change." }, 400);

  const store = await getStore();
  const nextLayout = body?.layout ? layout(body.layout, await store.getLayout()) : null;
  if (body?.layout && !nextLayout) return json({ error: "Couldn't undo that change." }, 400);

  const [haveBeds, havePlantings] = await Promise.all([store.listBeds(), store.listPlantings()]);
  const bedIds = new Set(haveBeds.map((b) => b.id));
  const plantingIds = new Set(havePlantings.map((p) => p.id));
  if (nextLayout) await store.saveLayout(nextLayout);
  for (const b of beds as Bed[]) await (bedIds.has(b.id) ? store.updateBed(b) : store.insertBed(b));
  for (const p of plantings as Planting[]) await (plantingIds.has(p.id) ? store.updatePlanting(p) : store.insertPlanting(p));
  for (const pid of removePlantings) if (plantingIds.has(pid)) await store.deletePlanting(pid);
  for (const bid of removeBeds) if (bedIds.has(bid)) await store.deleteBed(bid);
  return noContent();
}
