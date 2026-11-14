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
