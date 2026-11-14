import { firstOverlap } from "@/lib/bed-space";
import { getStore } from "@/lib/db";
import { cleanGeometry, cleanName } from "@/lib/garden-api";
import { json, noContent } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export function OPTIONS() {
  return noContent();
}

export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return json({ error: "Nothing to change." }, 400);
  const store = await getStore();
  const [beds, layout] = await Promise.all([store.listBeds(), store.getLayout()]);
  const bed = beds.find((item) => item.id === id);
  if (!bed) return json({ error: "That bed is gone." }, 404);
  const next = {
    ...bed,
    name: "name" in body ? cleanName(body.name, bed.name) : bed.name,
    geometry: "geometry" in body ? cleanGeometry(body.geometry, layout.widthFt, layout.lengthFt) ?? bed.geometry : bed.geometry,
  };
  // Patches can't share ground. Only checked when the bed moves, so older overlapping beds can still be renamed.
  if (next.geometry && JSON.stringify(next.geometry) !== JSON.stringify(bed.geometry)) {
    const others = beds.filter((item) => item.id !== id && !item.archived);
    const hit = firstOverlap(next.geometry, others);
    if (hit) return json({ error: `That would overlap ${hit.name}. Move it to open ground.` }, 409);
  }
  await store.updateBed(next);
  return json(next);
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const store = await getStore();
  const plantings = await store.listPlantings();
  if (plantings.some((planting) => planting.bed_id === id)) {
    return json({ error: "This bed has planting history, so it stays. Rename or move it instead." }, 409);
  }
  await store.deleteBed(id);
  return noContent();
}
