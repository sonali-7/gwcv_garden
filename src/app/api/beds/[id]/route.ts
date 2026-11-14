import { firstOverlap } from "@/lib/bed-space";
import { getStore } from "@/lib/db";
import { canDelete } from "@/lib/drop-plan";
import { gardenTz, todayYmd } from "@/lib/time";
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
  const mine = (await store.listPlantings()).filter((planting) => planting.bed_id === id);
  // Plans that haven't started go with the bed; anything planted (or logged by text) is history rotation needs.
  const today = todayYmd(new Date(), gardenTz());
  if (mine.some((planting) => !canDelete(planting, today))) {
    return json({ error: "This bed has planting history, so it stays. Rename or move it instead." }, 409);
  }
  for (const planting of mine) await store.deletePlanting(planting.id);
  await store.deleteBed(id);
  return noContent();
}
