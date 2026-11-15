import { randomUUID } from "node:crypto";
import { firstOverlap, openSpot } from "@/lib/bed-space";
import { areasOf, rectInArea } from "@/lib/garden-areas";
import { getStore } from "@/lib/db";
import { cleanGeometry, cleanName } from "@/lib/garden-api";
import { json, noContent } from "@/lib/http";
import type { Bed, GardenLayout } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function OPTIONS() {
  return noContent();
}

export async function GET() {
  return json(await (await getStore()).listBeds());
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const store = await getStore();
  const [beds, layout] = await Promise.all([store.listBeds(), store.getLayout()]);
  if (beds.length >= 60) return json({ error: "That's a lot of beds. Remove one first." }, 400);
  // New patches go on open ground; patches can't share ground.
  const taken = beds.filter((item) => !item.archived && item.geometry).map((item) => item.geometry!);
  const asked = cleanGeometry(body?.geometry, layout.widthFt, layout.lengthFt);
  if (asked) {
    const hit = firstOverlap(asked, beds.filter((item) => !item.archived));
    if (hit) return json({ error: `That would overlap ${hit.name}.` }, 409);
  }
  const geometry = asked ?? spotInAreas(taken, layout) ?? openSpot(taken, layout.widthFt, layout.lengthFt, Math.min(8, layout.widthFt), Math.min(4, layout.lengthFt));
  if (!geometry) return json({ error: "There's no open ground left. Make a bed smaller or remove one first." }, 409);
  const bed: Bed = {
    id: `bed-${randomUUID().slice(0, 8)}`,
    name: cleanName(body?.name, nextPlotName(beds)),
    row: cleanName(body?.row, ""),
    geometry,
  };
  await store.insertBed(bed);
  return json(bed, 201);
}

/** "Plot N" with the lowest N not already used by a plot on the map. */
function nextPlotName(beds: Bed[]): string {
  const used = new Set(
    beds.filter((bed) => !bed.archived).map((bed) => /^plot (\d+)$/i.exec(bed.name.trim())?.[1]).filter(Boolean).map(Number),
  );
  let n = 1;
  while (used.has(n)) n += 1;
  return `Plot ${n}`;
}

/** With growing areas, a new plot goes on open ground inside one of them (the first with room), not on the grass between. */
function spotInAreas(taken: NonNullable<Bed["geometry"]>[], layout: GardenLayout): NonNullable<Bed["geometry"]> | null {
  for (const area of areasOf(layout)) {
    const local = taken.map((g) => ({ ...g, x: g.x - area.x, y: g.y - area.y }));
    // An odd-shaped area's box includes ground outside its edge: skip spots that aren't wholly inside the shape.
    for (let tries = 0; tries < 200; tries++) {
      const spot = openSpot(local, area.w, area.h, Math.min(8, area.w), Math.min(4, area.h));
      if (!spot) break;
      const placed = { ...spot, x: spot.x + area.x, y: spot.y + area.y };
      if (rectInArea(placed, area)) return placed;
      local.push(spot);
    }
  }
  return null;
}
