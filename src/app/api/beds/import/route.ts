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

type Incoming = { name?: unknown; crop?: unknown; geometry?: unknown; group?: unknown };

/**
 * Build the garden from a drawing.
 * - A drawn bed whose name matches an existing bed moves that bed (its history stays).
 * - Other drawn beds are created.
 * - "replace" removes beds that weren't in the drawing, unless they have planting history.
 * - A crop on a bed is recorded as growing there now, if it isn't already.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    mode?: unknown;
    widthFt?: unknown;
    lengthFt?: unknown;
    beds?: unknown;
    backgroundDataUrl?: unknown;
  } | null;
  if (!body || !Array.isArray(body.beds) || body.beds.length === 0) return json({ error: "No beds to create." }, 400);
  if (body.beds.length > 60) return json({ error: "That's more than 60 beds." }, 400);
  const size = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 5 && n <= 1000 ? Math.round(n) : null;
  };
  const widthFt = size(body.widthFt);
  const lengthFt = size(body.lengthFt);
  if (!widthFt || !lengthFt) return json({ error: "Set the garden's width and length (5 to 1000 ft)." }, 400);
  const replace = body.mode === "replace";

  const store = await getStore();
  const [layout, beds, plantings] = await Promise.all([store.getLayout(), store.listBeds(), store.listPlantings()]);
  const nextLayout = { ...layout, widthFt, lengthFt };
  if (typeof body.backgroundDataUrl === "string") {
    const saved = await saveDataUrl(body.backgroundDataUrl);
    if (saved) nextLayout.imageUrl = saved.url;
  }

  const today = todayYmd(new Date(), gardenTz());
  const byName = new Map(beds.map((bed) => [bed.name.toLowerCase(), bed]));
  const used = new Set<string>();
  let created = 0;
  let moved = 0;
  let planted = 0;

  // Validate everything before writing anything.
  const plan: Array<{ existing: Bed | null; bed: Bed; crop: string | null; group: number | null }> = [];
  (body.beds as Incoming[]).forEach((item, index) => {
    const geometry = cleanGeometry(item?.geometry, widthFt, lengthFt);
    if (!geometry) return;
    const name = cleanName(item?.name, `Bed ${index + 1}`);
    const existing = byName.get(name.toLowerCase());
    const reuse = existing && !used.has(existing.id) ? existing : null;
    if (reuse) used.add(reuse.id);
    let crop: string | null = null;
    if (typeof item?.crop === "string" && item.crop.trim()) {
      const c = canonicalCrop(item.crop.toLowerCase().trim());
      crop = familyOf(c) ? c : null;
    }
    plan.push({
      existing: reuse,
      bed: reuse ? { ...reuse, geometry } : { id: `bed-${randomUUID().slice(0, 8)}`, name, row: "", geometry },
      crop,
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
    if (item.crop) {
      const growing = plantings.some(
        (p) => p.bed_id === item.bed.id && isActive(p, today) && p.crop.toLowerCase() === item.crop,
      );
      if (!growing) {
        // The other half of an L-shaped bed keeps the dates of the half that's already planted.
        const sibling = plan
          .filter((other) => other !== item && other.group !== null && other.group === item.group)
          .map((other) => plantings.find((p) => p.bed_id === other.bed.id && isActive(p, today) && p.crop.toLowerCase() === item.crop))
          .find(Boolean);
        const days = sibling?.days_to_maturity ?? maturityDays(item.crop);
        const planted_date = sibling?.planted_date ?? today;
        await store.insertPlanting({
          id: `planting-${randomUUID().slice(0, 8)}`,
          bed_id: item.bed.id,
          crop: item.crop,
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
  const kept: string[] = [];
  if (replace) {
    for (const bed of beds) {
      if (used.has(bed.id)) continue;
      if (plantings.some((p) => p.bed_id === bed.id)) {
        kept.push(bed.name);
        continue;
      }
      await store.deleteBed(bed.id);
      removed++;
    }
  }

  return json({ created, moved, removed, planted, kept }, 201);
}
