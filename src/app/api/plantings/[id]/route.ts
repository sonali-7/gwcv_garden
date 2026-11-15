import { getStore } from "@/lib/db";
import { json, noContent } from "@/lib/http";
import { canDelete } from "@/lib/drop-plan";
import { addDays, gardenTz, todayYmd } from "@/lib/time";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export function OPTIONS() {
  return noContent();
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (value: unknown): value is string =>
  typeof value === "string" && YMD.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));

/**
 * Update a planting:
 * - { planted: true } confirms a plan was planted (today, or on planted_date if given and not in the future);
 *   the harvest date moves to match.
 * - { removed_date: "YYYY-MM-DD" } marks it pulled; it stays in the bed's history for rotation.
 */
export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const store = await getStore();
  const planting = (await store.listPlantings()).find((item) => item.id === id);
  if (!planting) return json({ error: "That planting is gone." }, 404);
  const today = todayYmd(new Date(), gardenTz());

  if (body?.planted === true) {
    const date = isDate(body.planted_date) ? body.planted_date : today;
    if (date > today) return json({ error: "It can't be planted in the future. Leave it as a plan until then." }, 400);
    const next = {
      ...planting,
      status: "planted" as const,
      planted_date: date,
      expected_harvest_date: addDays(date, planting.days_to_maturity),
      season_year: Number(date.slice(0, 4)),
    };
    await store.updatePlanting(next);
    return json(next);
  }

  const removed = body?.removed_date;
  if (!isDate(removed)) return json({ error: "Send { planted: true } or removed_date as YYYY-MM-DD." }, 400);
  if (removed < planting.planted_date) return json({ error: "It can't be pulled before it was planted." }, 400);
  const next = { ...planting, removed_date: removed };
  await store.updatePlanting(next);
  return json(next);
}

/** Remove a plan (one that hasn't been confirmed planted). Real plantings belong to the text log, so they stay. */
export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const store = await getStore();
  const planting = (await store.listPlantings()).find((item) => item.id === id);
  if (!planting) return noContent();
  if (!canDelete(planting, todayYmd(new Date(), gardenTz()))) {
    return json({ error: "Only planned crops can be removed here." }, 409);
  }
  await store.deletePlanting(id);
  return noContent();
}
