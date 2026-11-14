import { getStore } from "@/lib/db";
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
    return Number.isFinite(n) && n >= 5 && n <= 1000 ? Math.round(n) : fallback;
  };
  const next = { ...layout };
  if ("widthFt" in body) next.widthFt = size(body.widthFt, layout.widthFt);
  if ("lengthFt" in body) next.lengthFt = size(body.lengthFt, layout.lengthFt);
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
