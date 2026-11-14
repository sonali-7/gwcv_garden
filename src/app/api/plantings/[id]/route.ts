import { getStore } from "@/lib/db";
import { json, noContent } from "@/lib/http";
import { gardenTz, todayYmd } from "@/lib/time";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export function OPTIONS() {
  return noContent();
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
