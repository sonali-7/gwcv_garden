import { randomUUID } from "node:crypto";
import { canonicalCrop, maturityDays } from "@/lib/crops";
import { getStore } from "@/lib/db";
import { json, noContent } from "@/lib/http";
import { addDays, gardenTz, todayYmd } from "@/lib/time";
import type { Planting } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function OPTIONS() {
  return noContent();
}

export async function GET() {
  return json(await (await getStore()).listPlantings());
}

/** Add a crop to a bed, usually a planned one from the garden view's suggestions. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const store = await getStore();
  const beds = await store.listBeds();
  const bed = beds.find((item) => item.id === body?.bed_id);
  if (!bed) return json({ error: "Pick a bed." }, 400);
  const crop = typeof body?.crop === "string" ? canonicalCrop(body.crop).slice(0, 40) : "";
  if (!crop) return json({ error: "Pick a crop." }, 400);
  const today = todayYmd(new Date(), gardenTz());
  const date =
    typeof body?.planted_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.planted_date) ? body.planted_date : today;
  const days = maturityDays(crop);
  const planting: Planting = {
    id: `planting-${randomUUID().slice(0, 8)}`,
    bed_id: bed.id,
    crop,
    planted_date: date,
    expected_harvest_date: addDays(date, days),
    removed_date: null,
    season_year: Number(date.slice(0, 4)),
    days_to_maturity: days,
    source_session_id: null,
  };
  await store.insertPlanting(planting);
  return json(planting, 201);
}
