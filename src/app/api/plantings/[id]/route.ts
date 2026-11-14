import { getStore } from "@/lib/db";
import { json, noContent } from "@/lib/http";
import { gardenTz, todayYmd } from "@/lib/time";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export function OPTIONS() {
  return noContent();
}

/** Mark a planting pulled on a date: { removed_date: "YYYY-MM-DD" }. It stays in the bed's history for rotation. */
export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const removed = body?.removed_date;
  if (typeof removed !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(removed) || Number.isNaN(Date.parse(`${removed}T12:00:00Z`))) {
    return json({ error: "Send removed_date as YYYY-MM-DD." }, 400);
  }
  const store = await getStore();
  const planting = (await store.listPlantings()).find((item) => item.id === id);
  if (!planting) return json({ error: "That planting is gone." }, 404);
  if (removed < planting.planted_date) return json({ error: "It can't be pulled before it was planted." }, 400);
  const next = { ...planting, removed_date: removed };
  await store.updatePlanting(next);
  return json(next);
}

/** Remove a planned planting. Past and current plantings belong to the text log, so they stay. */
export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const store = await getStore();
  const planting = (await store.listPlantings()).find((item) => item.id === id);
  if (!planting) return noContent();
  if (planting.planted_date <= todayYmd(new Date(), gardenTz()) || planting.source_session_id) {
    return json({ error: "Only planned crops can be removed here." }, 409);
  }
  await store.deletePlanting(id);
  return noContent();
}
