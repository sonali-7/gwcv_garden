import { randomUUID } from "node:crypto";
import { firstOverlap, openSpot } from "@/lib/bed-space";
import { getStore } from "@/lib/db";
import { cleanGeometry, cleanName } from "@/lib/garden-api";
import { json, noContent } from "@/lib/http";
import type { Bed } from "@/lib/types";

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
  const geometry = asked ?? openSpot(taken, layout.widthFt, layout.lengthFt, Math.min(8, layout.widthFt), Math.min(4, layout.lengthFt));
  if (!geometry) return json({ error: "There's no open ground left. Make a bed smaller or remove one first." }, 409);
  const bed: Bed = {
    id: `bed-${randomUUID().slice(0, 8)}`,
    name: cleanName(body?.name, `Bed ${beds.length + 1}`),
    row: cleanName(body?.row, ""),
    geometry,
  };
  await store.insertBed(bed);
  return json(bed, 201);
}
