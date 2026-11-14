import { randomUUID } from "node:crypto";
import { canonicalCrop, familyOf, maturityDays } from "@/lib/crops";
import { getStore } from "@/lib/db";
import { cleanGeometry, cleanName } from "@/lib/garden-api";
import { json, noContent } from "@/lib/http";
import { saveDataUrl } from "@/lib/media";
import { isActive } from "@/lib/plantings";
import { addDays, gardenTz, todayYmd } from "@/lib/time";
import type { Bed } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function OPTIONS() {
  return noContent();
}

type Incoming = { name?: unknown; crop?: unknown; crops?: unknown; geometry?: unknown; group?: unknown };

/** A crop name we can store: known crops get their usual name, others are kept if they look like a plant name. */
function cleanCrop(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.toLowerCase().replace(/[^a-z\- ']/g, " ").replace(/\s+/g, " ").trim();
  if (!raw || raw.length > 30 || raw === "nothing" || raw === "empty") return null;
  const known = canonicalCrop(raw);
  return familyOf(known) ? known : raw;
}

function cropsOf(item: Incoming): string[] {
  const list = Array.isArray(item?.crops) ? item.crops : item?.crop ? [item.crop] : [];
  return [...new Set(list.map(cleanCrop).filter((c): c is string => Boolean(c)))].slice(0, 4);
}

/**
 * Build the garden from a drawing.
 * - A drawn bed whose name matches an existing bed moves that bed (its history stays).
 * - Other drawn beds are created.
 * - "replace" removes beds that weren't in the drawing; ones with planting history are archived (off the map, history kept).
 * - A crop on a bed is recorded as growing there now, if it isn't already.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    mode?: unknown;
    widthFt?: unknown;
    lengthFt?: unknown;
    beds?: unknown;
    backgroundDataUrl?: unknown;
    units?: unknown;
    outline?: unknown;
  } | null;
  if (!body || !Array.isArray(body.beds) || body.beds.length === 0) return json({ error: "No beds to create." }, 400);
  if (body.beds.length > 60) return json({ error: "That's more than 60 beds." }, 400);
  const size = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 3 && n <= 1000 ? Math.round(n * 10) / 10 : null;
  };
  const widthFt = size(body.widthFt);
  const lengthFt = size(body.lengthFt);
  if (!widthFt || !lengthFt) return json({ error: "Set the garden's width and length." }, 400);
  const replace = body.mode === "replace";

  const store = await getStore();
  const [layout, beds, plantings] = await Promise.all([store.getLayout(), store.listBeds(), store.listPlantings()]);
  const nextLayout = { ...layout, widthFt, lengthFt };
  if (body.units === "ft" || body.units === "m") nextLayout.units = body.units;
  nextLayout.outline = cleanOutline(body.outline, widthFt, lengthFt);
  if (typeof body.backgroundDataUrl === "string") {
    const saved = await saveDataUrl(body.backgroundDataUrl);
    if (saved) nextLayout.imageUrl = saved.url;
  }

  const today = todayYmd(new Date(), gardenTz());
  const byName = new Map(beds.map((bed) => [bed.name.toLowerCase(), bed]));
  // An archived bed with a drawn bed's name comes back onto the map.
  const used = new Set<string>();
  let created = 0;
  let moved = 0;
  let planted = 0;

  // Validate everything before writing anything.
  const plan: Array<{ existing: Bed | null; bed: Bed; crops: string[]; group: number | null }> = [];
  (body.beds as Incoming[]).forEach((item, index) => {
    const geometry = cleanGeometry(item?.geometry, widthFt, lengthFt);
    if (!geometry) return;
    const name = cleanName(item?.name, `Bed ${index + 1}`);
    const existing = byName.get(name.toLowerCase());
    const reuse = existing && !used.has(existing.id) ? existing : null;
    if (reuse) used.add(reuse.id);
    plan.push({
      existing: reuse,
      bed: reuse ? { ...reuse, geometry, archived: false } : { id: `bed-${randomUUID().slice(0, 8)}`, name, row: "", geometry },
      crops: cropsOf(item),
      group: Number.isInteger(item?.group) ? (item.group as number) : null,
    });
  });
  if (!plan.length) return json({ error: "None of those beds had a usable shape." }, 400);

  await store.saveLayout(nextLayout);
  for (const item of plan) {
    if (item.existing) {
      await store.updateBed(item.bed);
      moved++;
    } else {
      await store.insertBed(item.bed);
      created++;
    }
    for (const crop of item.crops) {
      const growing = plantings.some(
        (p) => p.bed_id === item.bed.id && isActive(p, today) && p.crop.toLowerCase() === crop,
      );
      if (!growing) {
        // The other half of an L-shaped bed keeps the dates of the half that's already planted.
        const sibling = plan
          .filter((other) => other !== item && other.group !== null && other.group === item.group)
          .map((other) => plantings.find((p) => p.bed_id === other.bed.id && isActive(p, today) && p.crop.toLowerCase() === crop))
          .find(Boolean);
        const days = sibling?.days_to_maturity ?? maturityDays(crop);
        const planted_date = sibling?.planted_date ?? today;
        await store.insertPlanting({
          id: `planting-${randomUUID().slice(0, 8)}`,
          bed_id: item.bed.id,
          crop,
          planted_date,
          expected_harvest_date: sibling?.expected_harvest_date ?? addDays(today, days),
          removed_date: null,
          season_year: Number(planted_date.slice(0, 4)),
          days_to_maturity: days,
          source_session_id: null,
        });
        planted++;
      }
    }
  }

  let removed = 0;
  const archived: string[] = [];
  if (replace) {
    for (const bed of beds) {
      if (used.has(bed.id) || bed.archived) continue;
      if (plantings.some((p) => p.bed_id === bed.id)) {
        // Beds with history leave the map but stay in the records.
        await store.updateBed({ ...bed, archived: true });
        archived.push(bed.name);
        continue;
      }
      await store.deleteBed(bed.id);
      removed++;
    }
  }

  return json({ created, moved, removed, planted, archived }, 201);
}

function cleanOutline(value: unknown, widthFt: number, lengthFt: number): Array<[number, number]> | null {
  if (!Array.isArray(value) || value.length < 3 || value.length > 400) return null;
  const points: Array<[number, number]> = [];
  for (const p of value) {
    if (!Array.isArray(p) || p.length !== 2) return null;
    const x = Number(p[0]);
    const y = Number(p[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    points.push([Math.min(widthFt, Math.max(0, Math.round(x * 10) / 10)), Math.min(lengthFt, Math.max(0, Math.round(y * 10) / 10))]);
  }
  return points;
}
