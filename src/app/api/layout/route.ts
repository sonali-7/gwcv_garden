import { getStore } from "@/lib/db";
import { cleanAreas } from "@/lib/garden-areas";
import { json, noContent } from "@/lib/http";
import { saveDataUrl } from "@/lib/media";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function OPTIONS() {
  return noContent();
}

export async function GET() {
  return json(await (await getStore()).getLayout());
}

export async function PUT(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return json({ error: "Nothing to save." }, 400);
  const store = await getStore();
  const layout = await store.getLayout();
  const size = (value: unknown, fallback: number) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 3 && n <= 1000 ? Math.round(n * 10) / 10 : fallback;
  };
  const next = { ...layout };
  if ("widthFt" in body) next.widthFt = size(body.widthFt, layout.widthFt);
  if ("lengthFt" in body) next.lengthFt = size(body.lengthFt, layout.lengthFt);
  if (body.units === "ft" || body.units === "m") next.units = body.units;
  if (body.outline === null) next.outline = null;
  // Growing areas (see garden-areas.ts); an empty list or null goes back to a single garden.
  if ("areas" in body) {
    const areas = cleanAreas(body.areas, next.widthFt, next.lengthFt);
    if (areas) next.areas = areas;
    else delete next.areas;
  }
  if (typeof body.location === "string") next.location = body.location.replace(/\s+/g, " ").trim().slice(0, 80);
  if (body.imageDataUrl === null) next.imageUrl = null;
  if (typeof body.imageDataUrl === "string") {
    const saved = await saveDataUrl(body.imageDataUrl);
    if (!saved) return json({ error: "Use a jpg, png, webp, or gif under 4MB." }, 400);
    next.imageUrl = saved.url;
  }
  await store.saveLayout(next);
  return json(next);
}
